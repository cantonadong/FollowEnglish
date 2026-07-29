import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { UploadPanel, type UploadUiState } from "../../components/upload/UploadPanel";
import "./UploadPreview.css";

type Scenario = "idle" | "uploading" | "transcoding" | "transcribing" | "ready" | "error";

const SCENARIOS: { key: Scenario; label: string }[] = [
  { key: "idle", label: "normal 待上传" },
  { key: "uploading", label: "uploading 上传中" },
  { key: "transcoding", label: "transcoding 转码中" },
  { key: "transcribing", label: "transcribing 识别中" },
  { key: "ready", label: "ready 完成" },
  { key: "error", label: "error 失败" },
];

const STATIC_SNAPSHOT: Record<Scenario, { percent?: number; elapsedSeconds?: number }> = {
  idle: {},
  uploading: { percent: 42 },
  transcoding: { percent: 68 },
  transcribing: {},
  ready: {},
  error: {},
};

export function UploadPreview() {
  const navigate = useNavigate();
  const [tab, setTab] = useState<Scenario>("idle");
  const [simRunning, setSimRunning] = useState(false);
  const [simState, setSimState] = useState<UploadUiState>("idle");
  const [percent, setPercent] = useState(0);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [fileName, setFileName] = useState<string | undefined>();
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  function clearTimer() {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
  }

  useEffect(() => clearTimer, []);

  // Live "loading" animation for the transcribing tab snapshot (indeterminate progress still needs to feel alive).
  useEffect(() => {
    if (simRunning || tab !== "transcribing") return;
    let t = 0;
    const id = setInterval(() => {
      t += 1;
      setElapsedSeconds(t);
    }, 1000);
    return () => clearInterval(id);
  }, [tab, simRunning]);

  function runSimulation(file: File) {
    clearTimer();
    setSimRunning(true);
    setFileName(file.name);
    setSimState("uploading");
    setPercent(0);

    let phase: "uploading" | "transcoding" | "transcribing" = "uploading";
    let p = 0;
    let elapsed = 0;

    timerRef.current = setInterval(() => {
      if (phase === "uploading") {
        p += 8;
        setPercent(Math.min(p, 100));
        if (p >= 100) {
          phase = "transcoding";
          p = 0;
          setSimState("transcoding");
        }
      } else if (phase === "transcoding") {
        p += 6;
        setPercent(Math.min(p, 100));
        if (p >= 100) {
          phase = "transcribing";
          setSimState("transcribing");
        }
      } else if (phase === "transcribing") {
        elapsed += 1;
        setElapsedSeconds(elapsed);
        if (elapsed >= 3) {
          clearTimer();
          setSimState("ready");
          setTimeout(() => navigate("/preview/player"), 1200);
        }
      }
    }, 200);
  }

  function handleRetry() {
    clearTimer();
    setSimRunning(false);
    setSimState("idle");
    setTab("idle");
  }

  const displayState: UploadUiState = simRunning ? simState : tab;
  const displayPercent = simRunning ? percent : STATIC_SNAPSHOT[tab].percent ?? 0;

  return (
    <div className="upload-preview">
      <div className="upload-preview__toolbar">
        <span className="upload-preview__label">上传页 Preview　场景：</span>
        {SCENARIOS.map((s) => (
          <button
            key={s.key}
            className={
              "upload-preview__tab" + (tab === s.key && !simRunning ? " upload-preview__tab--active" : "")
            }
            onClick={() => {
              clearTimer();
              setSimRunning(false);
              setTab(s.key);
              setElapsedSeconds(0);
            }}
          >
            {s.label}
          </button>
        ))}
      </div>

      <div className="upload-preview__hint-bar">
        提示：在"normal 待上传"状态下拖拽/选择一个真实文件，可触发完整模拟流程（上传→转码→识别→完成→自动跳转播放页 Preview），全部为前端模拟，不发送到后端。
      </div>

      <div className="upload-preview__stage">
        <div className="upload-preview__card">
          <h1 className="upload-preview__app-title">FollowEnglish</h1>
          <p className="upload-preview__app-subtitle">上传视频，自动生成英文字幕，开始精听 / shadowing 练习</p>
          <UploadPanel
            state={displayState}
            percent={displayPercent}
            elapsedSeconds={elapsedSeconds}
            errorMessage="ffmpeg 转码失败：不支持的编码格式（模拟错误信息）"
            fileName={fileName}
            onFileSelected={runSimulation}
            onRetry={handleRetry}
          />
        </div>
      </div>
    </div>
  );
}
