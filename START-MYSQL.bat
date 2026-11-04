@echo off
cd /d "%~dp0"
title Ashen Roads (MySQL login)
where node >nul 2>nul
if errorlevel 1 goto nonode
rem Accounts are saved by PHP in MySQL (phpMyAdmin). XAMPP Apache + MySQL must be running.
rem This window only runs the multiplayer rooms (Node). Keep it open.
set AUTH_MODE=php
set AUTH_SECRET=220d7bd06baf1e1aa6539138e078f6246f48dfa9799c8099a7b3959684d14ef4
set PHP_API_URL=http://localhost/ashen_roads/api/index.php
set OPEN_BROWSER=1
set OPEN_PATH=/index.html
echo.
echo  1) XAMPP: Apache + MySQL = Running
echo  2) This folder must be C:\xampp\htdocs\ashen_roads
echo  3) Test: http://localhost/ashen_roads/api/index.php?r=health  must show "storage":"mysql","db_ok":true
echo.
node server\server.js
pause
exit /b
:nonode
echo Node.js is not installed. Download it from https://nodejs.org (LTS).
start "" https://nodejs.org
pause
