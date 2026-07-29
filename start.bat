@echo off
setlocal
cd /d "%~dp0backend"

echo Starting FollowEnglish backend...
start "FollowEnglish Backend" cmd /k "npm run start"

timeout /t 3 /nobreak > nul
start "" http://localhost:4000/

echo.
echo FollowEnglish is starting. If the browser page does not load yet, wait a
echo few seconds and refresh - the backend window shows startup progress.
echo Close the "FollowEnglish Backend" window to stop the server.
