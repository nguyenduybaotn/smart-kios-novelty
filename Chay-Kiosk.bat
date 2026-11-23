@echo off
title Vision AI Kiosk POS - Khoi Dong
color 0A

echo ========================================================
echo         VISION AI KIOSK POS - KHOI DONG HE THONG
echo ========================================================
echo.

cd /d "%~dp0server"

:: 1. Kiem tra Node.js
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] May tinh chua cai dat Node.js!
    echo Vui long cai dat Node.js tu: https://nodejs.org/
    pause
    exit /b 1
)

:: 2. Kiem tra thu vien server
if not exist "node_modules" (
    echo [INFO] Dang cai dat thu vien can thiet...
    call npm install
)

:: 3. Khoi dong Backend Server
echo [1/2] Dang khoi dong may chu Kiosk (Cong 8095)...
start "Vision AI Kiosk Server" /min cmd /c "node src/index.js"

:: Cho 3 giay de server san sang
timeout /t 3 /nobreak >nul

:: 4. Mo trinh duyet Chrome hoac Edge
echo [2/2] Dang mo giao dien Kiosk tren trinh duyet...

set CHROME="C:\Program Files\Google\Chrome\Application\chrome.exe"
set CHROME_X86="C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"
set EDGE="C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"

if exist %CHROME% (
    start "" %CHROME% --app=http://localhost:8095 --start-maximized
) else if exist %CHROME_X86% (
    start "" %CHROME_X86% --app=http://localhost:8095 --start-maximized
) else if exist %EDGE% (
    start "" %EDGE% --app=http://localhost:8095 --start-maximized
) else (
    start http://localhost:8095
)

echo.
echo ========================================================
echo   HE THONG DA SAN SANG TAI: http://localhost:8095
echo   Tai khoan: admin  ^|  Mat khau: 123456
echo ========================================================
echo.
timeout /t 5 >nul
exit
