@echo off
setlocal
cd /d "%~dp0"

echo Building FollowEnglish.exe...

echo [1/3] Building frontend...
pushd frontend
call npm.cmd run build
if errorlevel 1 (
  popd
  goto :error
)
popd

echo [2/3] Compiling backend...
pushd backend
call npm.cmd run build
if errorlevel 1 (
  popd
  goto :error
)
popd

echo [3/3] Building Windows launcher...
pushd launcher
where go-winres >nul 2>nul
if errorlevel 1 (
  if not exist rsrc_windows_amd64.syso (
    echo go-winres was not found and launcher\rsrc_windows_amd64.syso is missing.
    echo Install go-winres, then rerun this script.
    popd
    goto :error
  )
) else (
  go-winres simply --arch amd64 --icon icon.ico --manifest gui --product-name "FollowEnglish" --file-description "FollowEnglish - English listening practice" --out rsrc
  if errorlevel 1 (
    popd
    goto :error
  )
)
go build -ldflags "-H=windowsgui -s -w" -o "..\FollowEnglish.exe" .
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
