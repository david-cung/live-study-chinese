@echo off
cd /d "%~dp0"
if not exist node_modules call npm ci
if errorlevel 1 goto failed
call npm run voice:setup
if errorlevel 1 goto failed
call npm run voice:start
if errorlevel 1 goto failed
exit /b 0
:failed
echo Khong khoi dong duoc giong Viet. Xem loi o tren.
pause
exit /b 1
