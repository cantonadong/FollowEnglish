// FollowEnglish desktop launcher: runs the backend as a hidden child process,
// shows a system tray icon (no console window for either process), enforces
// a single running instance, and opens the browser once ready.
package main

import (
	_ "embed"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"syscall"
	"time"
	"unsafe"

	"fyne.io/systray"
	"golang.org/x/sys/windows"
)

//go:embed icon.ico
var iconBytes []byte

const (
	appURL     = "http://localhost:4000"
	mutexName  = "Global\\FollowEnglish_SingleInstance_Mutex"
	CreateNoWindow = 0x08000000
)

var nodeCmd *exec.Cmd

func main() {
	mutexNamePtr, _ := windows.UTF16PtrFromString(mutexName)
	handle, err := windows.CreateMutex(nil, false, mutexNamePtr)
	if err == nil && handle != 0 {
		defer windows.CloseHandle(handle)
	}
	if err == windows.ERROR_ALREADY_EXISTS {
		// Another instance is already running — just surface it, don't spawn a second server/tray.
		openBrowser(appURL)
		return
	}

	systray.Run(onReady, onExit)
}

func onReady() {
	systray.SetIcon(iconBytes)
	systray.SetTitle("FollowEnglish")
	systray.SetTooltip("FollowEnglish - 英文听力练习")

	mOpen := systray.AddMenuItem("打开 FollowEnglish", "在浏览器中打开")
	systray.AddSeparator()
	mQuit := systray.AddMenuItem("退出", "停止服务并退出")

	startBackend()

	go func() {
		for {
			select {
			case <-mOpen.ClickedCh:
				openBrowser(appURL)
			case <-mQuit.ClickedCh:
				systray.Quit()
				return
			}
		}
	}()

	go waitForServerThenOpen()
}

func onExit() {
	stopBackend()
}

func startBackend() {
	exeDir := selfDir()
	backendDir := filepath.Join(exeDir, "backend")
	serverScript := filepath.Join(backendDir, "dist", "server.js")

	cmd := exec.Command("node", serverScript)
	cmd.Dir = backendDir
	cmd.SysProcAttr = &syscall.SysProcAttr{
		HideWindow:    true,
		CreationFlags: CreateNoWindow,
	}
	cmd.Stdout = nil
	cmd.Stderr = nil

	if err := cmd.Start(); err == nil {
		nodeCmd = cmd
		attachToJobObject(cmd.Process.Pid) // see comment on attachToJobObject
		go cmd.Wait()                      // reap the process; ignore exit status
	}
}

func stopBackend() {
	if nodeCmd != nil && nodeCmd.Process != nil {
		_ = nodeCmd.Process.Kill()
	}
}

// Puts the node child in a Windows Job Object configured to kill all its
// processes when the job handle closes. The job handle is only ever held by
// this process and is closed automatically on any exit path — graceful quit,
// crash, or being killed from Task Manager — so the backend can never be
// left running as an orphan no matter how this launcher goes away.
func attachToJobObject(pid int) {
	job, err := windows.CreateJobObject(nil, nil)
	if err != nil || job == 0 {
		return
	}

	info := windows.JOBOBJECT_EXTENDED_LIMIT_INFORMATION{
		BasicLimitInformation: windows.JOBOBJECT_BASIC_LIMIT_INFORMATION{
			LimitFlags: windows.JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
		},
	}
	windows.SetInformationJobObject(
		job,
		windows.JobObjectExtendedLimitInformation,
		uintptr(unsafe.Pointer(&info)),
		uint32(unsafe.Sizeof(info)),
	)

	handle, err := windows.OpenProcess(windows.PROCESS_ALL_ACCESS, false, uint32(pid))
	if err != nil {
		return
	}
	windows.AssignProcessToJobObject(job, handle)
	// Intentionally not closing `job` or `handle`: the job must stay alive
	// for the life of this process so KILL_ON_JOB_CLOSE fires on exit, and
	// Windows itself reclaims both handles when this process terminates.
}

// Polls the health endpoint briefly before opening the browser, so the first
// launch (which needs a moment for Node to boot) doesn't show a connection
// error.
func waitForServerThenOpen() {
	for i := 0; i < 50; i++ {
		conn, err := net.DialTimeout("tcp", "localhost:4000", 200*time.Millisecond)
		if err == nil {
			conn.Close()
			openBrowser(appURL)
			return
		}
		time.Sleep(200 * time.Millisecond)
	}
	openBrowser(appURL) // open anyway; the page will just need a manual refresh
}

func openBrowser(url string) {
	cmd := exec.Command("rundll32", "url.dll,FileProtocolHandler", url)
	cmd.SysProcAttr = &syscall.SysProcAttr{
		HideWindow:    true,
		CreationFlags: CreateNoWindow,
	}
	_ = cmd.Start()
}

func selfDir() string {
	exePath, err := os.Executable()
	if err != nil {
		wd, _ := os.Getwd()
		return wd
	}
	resolved, err := filepath.EvalSymlinks(exePath)
	if err != nil {
		resolved = exePath
	}
	return filepath.Dir(resolved)
}
