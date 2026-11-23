@echo off
chcp 65001 >nul
title VISION AI KIOSK POS - NẠP DỮ LIỆU POSTGRESQL
color 0B

echo ========================================================
echo     VISION AI KIOSK POS - NẠP DỮ LIỆU POSTGRESQL
echo ========================================================
echo.

set PG_BIN="C:\Program Files\PostgreSQL\16\bin"
if not exist %PG_BIN% set PG_BIN="C:\Program Files\PostgreSQL\17\bin"
if not exist %PG_BIN% set PG_BIN="C:\Program Files\PostgreSQL\15\bin"
if not exist %PG_BIN% set PG_BIN="C:\Program Files\PostgreSQL\14\bin"

set PSQL_CMD=psql
if exist %PG_BIN%\psql.exe set PSQL_CMD=%PG_BIN%\psql.exe

where %PSQL_CMD% >nul 2>nul
if %errorlevel% neq 0 (
    echo [LỖI] Không tìm thấy công cụ psql của PostgreSQL!
    echo Nếu đã cài đặt PostgreSQL, vui lòng nhập đường dẫn thư mục bin:
    set /p USER_BIN="Nhập đường dẫn (ví dụ C:\Program Files\PostgreSQL\16\bin): "
    if exist "%USER_BIN%\psql.exe" (
        set PSQL_CMD="%USER_BIN%\psql.exe"
    ) else (
        echo Không tìm thấy psql.exe! Hãy cài đặt PostgreSQL trước.
        pause
        exit /b 1
    )
)

echo.
echo Nhập thông tin PostgreSQL trên máy này (bấm Enter để nhận giá trị mặc định):
set /p PG_USER="Username [postgres]: "
if "%PG_USER%"=="" set PG_USER=postgres

set /p PG_PASSWORD="Password [postgres]: "
if "%PG_PASSWORD%"=="" set PG_PASSWORD=postgres

set /p PG_PORT="Port [5432]: "
if "%PG_PORT%"=="" set PG_PORT=5432

set PGPASSWORD=%PG_PASSWORD%

:: Tự động giải nén file zip nếu chưa có file .sql
if not exist "%~dp0VisionAIKiosk_backup.sql" (
    if exist "%~dp0VisionAIKiosk_backup.zip" (
        echo [THÔNG BÁO] Đang giải nén file VisionAIKiosk_backup.zip...
        powershell -Command "Expand-Archive -Path '%~dp0VisionAIKiosk_backup.zip' -DestinationPath '%~dp0' -Force"
    )
)

echo.
echo [1/2] Đang tạo database "VisionAIKiosk" nếu chưa có...
%PSQL_CMD% -h localhost -p %PG_PORT% -U %PG_USER% -d postgres -c "CREATE DATABASE \"VisionAIKiosk\";" 2>nul

echo [2/2] Đang nạp toàn bộ cấu trúc và dữ liệu từ VisionAIKiosk_backup.sql...
%PSQL_CMD% -h localhost -p %PG_PORT% -U %PG_USER% -d VisionAIKiosk -f "%~dp0VisionAIKiosk_backup.sql"

if %errorlevel% equ 0 (
    echo.
    echo ========================================================
    echo   NẠP CƠ SỞ DỮ LIỆU THÀNH CÔNG!
    echo   Bây giờ bạn có thể nhấp đúp file "Chay-Kiosk.bat" để dùng.
    echo ========================================================
) else (
    echo.
    echo [CHÚ Ý] Quá trình nạp hoàn tất. Vui lòng kiểm tra lại thông báo ở trên.
)

pause
exit /b 0
