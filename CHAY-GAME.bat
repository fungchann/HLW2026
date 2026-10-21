@echo off
chcp 65001 >nul
title Halloween iNET 2026 - May chu game (KHONG tat cua so nay)
cd /d "%~dp0"
rem Choi nhu that: moi trinh duyet la 1 nguoi choi, khong dung dang nhap demo
set GUEST_LOGIN=true
set ALLOW_DEMO_LOGIN=false
rem Duong dan trang quan tri nam trong file .env tren may (khong dua len GitHub)
set ADMIN_PATH=
if exist ".env" for /f "tokens=1,* delims==" %%a in ('findstr /b "ADMIN_PATH=" ".env"') do set ADMIN_PATH=%%b

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  [!] May tinh chua cai Node.js.
  echo      Trang tai Node.js vua duoc mo: hay tai ban "LTS", cai dat binh thuong,
  echo      sau do bam dup lai file CHAY-GAME.bat nay.
  start "" https://nodejs.org/
  echo.
  pause
  exit /b 1
)

rem Neu ban game cu van dang chay (cua so mo tu truoc) thi tat di de luon chay code moi nhat
powershell -NoProfile -Command "$c = Get-NetTCPConnection -LocalPort 8080 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1; if ($c) { $p = Get-CimInstance Win32_Process -Filter ('ProcessId=' + $c.OwningProcess); if ($p -and $p.Name -eq 'node.exe' -and $p.CommandLine -like '*index.js*') { Write-Host '  Dang tat ban game cu dang chay...'; $pp = Get-CimInstance Win32_Process -Filter ('ProcessId=' + $p.ParentProcessId); Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue; if ($pp -and $pp.CommandLine -like '*CHAY-GAME*') { Stop-Process -Id $pp.ProcessId -Force -ErrorAction SilentlyContinue }; Start-Sleep -Milliseconds 800 } }"

echo ================================================================
echo    HALLOWEEN iNET 2026 - DANG KHOI DONG...
echo.
echo    Trang GAME  : http://localhost:8080/
echo    Trang ADMIN : http://localhost:8080/%ADMIN_PATH%/
echo.
echo    * Trinh duyet se tu mo 2 trang tren sau vai giay.
echo    * KHONG DONG cua so den nay trong luc dang xem / choi.
echo    * Muon tat game: dong cua so nay.
echo ================================================================
echo.

start "" powershell -NoProfile -WindowStyle Hidden -Command "Start-Sleep -Seconds 3; Start-Process 'http://localhost:8080/'; Start-Process 'http://localhost:8080/%ADMIN_PATH%/'; $f = Join-Path '%~dp0' 'data\INITIAL_ADMIN_PASSWORD.txt'; if (Test-Path $f) { Start-Process notepad $f }"

node --disable-warning=ExperimentalWarning server\index.js

echo.
echo  May chu game da dung. Bam phim bat ky de dong cua so.
pause >nul
