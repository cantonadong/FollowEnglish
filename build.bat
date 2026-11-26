@echo off
setlocal
cd /d "%~dp0"

echo Building FollowEnglish.exe...

echo [1/4] Building frontend...
pushd frontend
call npm.cmd run build
if errorlevel 1 (
  popd
  goto :error
)
popd

echo [2/4] Compiling backend...
pushd backend
call npm.cmd run build
if errorlevel 1 (
  popd
  goto :error
)
popd

echo [3/4] Building Rust subtitle engine...
cargo build --release
if errorlevel 1 goto :error

echo [4/4] Building Windows launcher...
pushd launcher
where go-winres >nul 2>nul
if not errorlevel 1 (
  go-winres simply --arch amd64 --icon icon.ico --manifest gui --product-name "FollowEnglish" --file-description "FollowEnglish - English listening practice" --out rsrc
  if errorlevel 1 (
    popd
    goto :error
  )
) else (
  where llvm-rc >nul 2>nul
  if not errorlevel 1 (
    llvm-rc /fo "%TEMP%\FollowEnglish-icon.res" icon.rc
    if not errorlevel 1 llvm-cvtres /machine:X64 /out:rsrc_windows_amd64.syso "%TEMP%\FollowEnglish-icon.res"
    if errorlevel 1 (
      popd
      goto :error
    )
  )
)
go build -buildvcs=false -ldflags "-H=windowsgui -s -w" -o "..\FollowEnglish.exe" .
if errorlevel 1 (
  popd
  goto :error
)
popd

if not exist "%~dp0FollowEnglish.exe" (
  echo.
  echo Build finished, but FollowEnglish.exe was not found.
  exit /b 1
)

echo.
echo EXE created successfully:
echo %~dp0FollowEnglish.exe
exit /b 0

:error
echo.
echo Failed to build FollowEnglish.exe.
exit /b 1
