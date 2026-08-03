@echo off
setlocal
cd /d "%~dp0"

echo [1/3] Building frontend...
cd frontend
call npm run build
if errorlevel 1 goto :error
cd ..

echo [2/3] Compiling backend to plain JS...
cd backend
call npm run build
if errorlevel 1 goto :error
cd ..

echo [3/3] Building FollowEnglish.exe launcher...
cd launcher
where go-winres >nul 2>nul
if errorlevel 1 (
  if exist rsrc_windows_amd64.syso (
    echo go-winres not found, using existing rsrc_windows_amd64.syso.
  ) else (
    echo go-winres not found and rsrc_windows_amd64.syso is missing.
    echo Install go-winres, then rerun build.bat.
    goto :error
  )
) else (
  go-winres simply --arch amd64 --icon icon.ico --manifest gui --product-name "FollowEnglish" --file-description "FollowEnglish - English listening practice" --out rsrc
  if errorlevel 1 goto :error
)
go build -ldflags "-H=windowsgui -s -w" -o "..\FollowEnglish.exe" .
if errorlevel 1 goto :error
cd ..

echo.
echo Done. Run FollowEnglish.exe to start the app.
goto :eof

:error
echo.
echo Build failed - see the error above.
exit /b 1
