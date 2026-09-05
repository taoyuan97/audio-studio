@echo off
rem ============================================================
rem  Audio Studio - production build + single-process server
rem  Serves frontend/dist and API from http://localhost:8000
rem ============================================================
title audio-studio-production
setlocal

set "ROOT=%~dp0.."
set "BACKEND=%ROOT%\backend"
set "FRONTEND=%ROOT%\frontend"
set "VENV_PY=%BACKEND%\.venv\Scripts\python.exe"

if not exist "%VENV_PY%" (
    echo [error] Backend venv not found. Run: cd backend ^&^& uv sync
    pause
    exit /b 1
)

where pnpm >nul 2>nul
if errorlevel 1 (
    echo [error] pnpm not found. Install Node.js and pnpm first.
    pause
    exit /b 1
)

if not exist "%FRONTEND%\node_modules" (
    echo [error] Frontend dependencies missing. Run: cd frontend ^&^& pnpm install
    pause
    exit /b 1
)

echo [build] frontend production bundle
cd /d "%FRONTEND%"
call pnpm build
if errorlevel 1 (
    echo [error] Frontend build failed.
    pause
    exit /b 1
)

echo [start] single-process production server http://localhost:8000
cd /d "%BACKEND%"
set "SERVE_FRONTEND=true"
"%VENV_PY%" -m uvicorn app.main:create_app --factory --host 127.0.0.1 --port 8000

echo.
echo [end] production server exited.
pause
