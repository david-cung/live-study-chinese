@echo off
setlocal
title Lop Tieng Trung Live
cd /d "%~dp0"

echo ==================================================
echo    LOP TIENG TRUNG LIVE - chay tren Windows
echo ==================================================
echo.

rem ---------- 1. Node.js ----------
where node >nul 2>nul
if errorlevel 1 (
  echo [!] May chua cai Node.js.
  where winget >nul 2>nul
  if errorlevel 1 goto :no_node
  choice /c YN /m "Tu dong cai Node.js LTS bang winget"
  if errorlevel 2 goto :no_node
  winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
  echo.
  echo Da cai xong Node.js. Dong cua so nay roi mo lai BAT-LIVE.bat.
  pause
  exit /b 0
)
for /f %%v in ('node -p "process.versions.node.split('.')[0]"') do set NODE_MAJOR=%%v
if %NODE_MAJOR% LSS 20 (
  echo [!] Node.js qua cu ^(ban %NODE_MAJOR%^). Can Node 22 tro len: https://nodejs.org
  pause
  exit /b 1
)

rem ---------- 2. Already running? ----------
netstat -ano | findstr /r /c:":3002 .*LISTENING" >nul
if not errorlevel 1 (
  echo App dang chay roi. Mo bang dieu khien...
  start "" http://localhost:3002
  timeout /t 3 >nul
  exit /b 0
)

rem ---------- 3. Libraries ----------
rem node_modules copied from a Mac has the wrong native binaries, so install once on this machine
if not exist "node_modules\.cai-tren-windows" (
  if exist node_modules (
    echo Xoa thu vien chep tu may khac...
    rmdir /s /q node_modules
  )
  echo Lan dau chay: dang cai thu vien, doi 1-3 phut...
  call npm install --no-audit --no-fund
  if errorlevel 1 (
    echo.
    echo [!] Cai thu vien bi loi. Kiem tra mang internet roi chay lai.
    pause
    exit /b 1
  )
  echo ok> "node_modules\.cai-tren-windows"
)

rem ---------- 4. Cursor CLI for AI replies ----------
where cursor-agent >nul 2>nul
if errorlevel 1 (
  echo [!] Chua cai Cursor CLI ^(cursor-agent^): AI se khong tra loi binh luan, cac phan khac van chay.
  echo     Cai bang PowerShell:  irm 'https://cursor.com/install?win32=true' ^| iex
  echo     Cai xong thi chay "cursor-agent login" mot lan roi mo lai file nay.
  echo.
)

rem ---------- 5. Start ----------
echo Bang dieu khien : http://localhost:3002
echo Link LIVE Studio: http://lvh.me:3002/?view=stage   ^(Custom resolution 1080 x 1920^)
echo.
echo Dong cua so nay la TAT app.
echo.
rem Live mode: the stage page never reloads by itself while streaming
set LIVE_MODE=1
start "" /min powershell -NoProfile -WindowStyle Hidden -Command "for($i=0;$i -lt 90;$i++){try{Invoke-WebRequest -UseBasicParsing http://localhost:3002/api/lessons -TimeoutSec 2 | Out-Null; Start-Process 'http://localhost:3002'; break}catch{Start-Sleep 1}}"
call npm run dev
echo.
echo App da dung.
pause
exit /b 0

:no_node
echo Tai Node.js ban LTS tai https://nodejs.org , cai xong thi mo lai file nay.
start "" https://nodejs.org
pause
exit /b 1
