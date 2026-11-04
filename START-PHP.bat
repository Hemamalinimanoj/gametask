@echo off
cd /d "%~dp0"
echo Ashen Roads (PHP) - open http://localhost:8000  (needs PHP with pdo_sqlite; keep this window open)
php -S localhost:8000
pause
