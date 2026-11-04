@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 goto nonode
set OPEN_BROWSER=1
set OPEN_PATH=/index.html
echo Starting the Ashen Roads server... KEEP THIS WINDOW OPEN while you play.
echo Your browser opens by itself. Press CREATE ROOM there and share the code.
echo.
node server\server.js
echo.
echo The server stopped. If there is an error above, that is the reason.
pause
exit /b
:nonode
echo Node.js is not installed. Download it from https://nodejs.org (LTS), install, then run this again.
start "" https://nodejs.org
pause
