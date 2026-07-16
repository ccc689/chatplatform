@echo off
title ChatPlatform Server
cd /d "%~dp0"

echo.
echo ============================================
echo   ChatPlatform
echo ============================================
echo.

:: Step 1: Database check
echo [1/3] Checking database...
venv\Scripts\python.exe migrate_db.py 2>nul
echo.

:: Step 2: Backend
echo [2/3] Starting backend...
start "ChatPlatform-Backend" cmd /k "title Backend:8000 && cd /d %~dp0 && venv\Scripts\python.exe -m uvicorn main:app --host 127.0.0.1 --port 8000"
timeout /t 3 /nobreak >nul

:: Step 3: Cloudflare tunnel
echo [3/3] Starting public tunnel...
start "Public-URL" cmd /k "title PUBLIC URL - Copy the https://...trycloudflare.com link below && cd /d %~dp0 && cloudflared tunnel --url http://127.0.0.1:8000"
timeout /t 2 /nobreak >nul

echo.
echo ============================================
echo   LOCAL  : http://127.0.0.1:8000
echo.
echo   PUBLIC : Check the "Public-URL" window
echo            for the trycloudflare.com link
echo ============================================
echo.
echo   Copy that link and share it!
echo.
echo   Close all 3 windows to stop the server.
echo.
pause
