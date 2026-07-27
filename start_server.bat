@echo off
title ChatPlatform Server
cd /d "%~dp0"

echo.
echo ============================================
echo   ChatPlatform Server
echo ============================================
echo.

:: Step 1: Database check
echo [1/3] Checking database...
venv\Scripts\python.exe migrate_db.py 2>nul
echo.

:: Step 2: Start backend in background
echo [2/3] Starting backend on port 8000...
start "Backend" /MIN cmd /c "cd /d %CD% && venv\Scripts\python.exe -m uvicorn main:app --host 127.0.0.1 --port 8000"
echo   Backend started (minimized window)
echo   LOCAL: http://127.0.0.1:8000
echo.

:: Step 3: Cloudflare tunnel (runs in this window so URL is visible)
echo [3/3] Starting public tunnel...
echo   (This may take 5-10 seconds, please wait...)
echo   Look for the https://...trycloudflare.com link below:
echo   --------------------------------------------------
cloudflared tunnel --url http://127.0.0.1:8000

pause
