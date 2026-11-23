@echo off
title Vision AI Kiosk - Cai Dat Database
color 0B

echo ========================================================
echo       VISION AI KIOSK POS - CAI DAT DATABASE
echo ========================================================
echo.

cd /d "%~dp0server"

:: Kiem tra Node.js
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] May tinh chua cai dat Node.js!
    echo Vui long cai dat Node.js tu: https://nodejs.org/
    pause
    exit /b 1
)

:: Kiem tra node_modules
if not exist "node_modules" (
    echo [INFO] Dang cai dat thu vien server...
    call npm install
)

:: Chay script nap database bang Node.js
node src/scripts/restore_db.js

pause
exit /b 0
