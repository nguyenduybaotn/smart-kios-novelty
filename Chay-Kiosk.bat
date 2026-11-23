@echo off
chcp 65001 >nul
title VISION AI KIOSK POS - KHỞI ĐỘNG HỆ THỐNG
color 0A

echo ========================================================
echo         VISION AI KIOSK POS - KHỞI ĐỘNG HỆ THỐNG
echo ========================================================
echo.

cd /d "%~dp0server"

:: 1. Kiểm tra xem Node.js đã được cài đặt chưa
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [LỖI] Máy tính chưa cài đặt Node.js!
    echo Vui lòng tải và cài đặt Node.js từ: https://nodejs.org/
    pause
    exit /b 1
)

:: 2. Kiểm tra dependencies của server
if not exist "node_modules" (
    echo [THÔNG BÁO] Đang cài đặt thư viện cần thiết lần đầu...
    call npm install
)

:: 3. Khởi động Backend Server
echo [1/2] Đang khởi động máy chủ Kiosk (Cổng 8095)...
start "Vision AI Kiosk Server" /min cmd /c "node src/index.js"

:: Chờ 3 giây để server khởi động hoàn tất
timeout /t 3 /nobreak >nul

:: 4. Mở giao diện trên trình duyệt Chrome hoặc Edge
echo [2/2] Đang mở giao diện Kiosk trên trình duyệt...

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
echo   HỆ THỐNG ĐÃ SẴN SÀNG TẠI: http://localhost:8095
echo   Tài khoản: admin  ^|  Mật khẩu: 123456
echo ========================================================
echo.
timeout /t 5 >nul
exit
