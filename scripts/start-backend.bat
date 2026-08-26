@echo off
rem ============================================================
rem  Audio Studio - Start backend (FastAPI / uvicorn, port 8000)
rem  Double-click to run. Stop with Ctrl+C or scripts\stop-all.bat
rem  Pure ASCII on purpose: safe under any console code page.
rem ============================================================
title audio-studio-backend
setlocal

set "ROOT=%~dp0.."
set "BACKEND=%ROOT%\backend"
set "VENV_PY=%BACKEND%\.venv\Scripts\python.exe"

rem ---- preflight checks ----
if not exist "%VENV_PY%" (
    echo [error] Backend venv not found: %BACKEND%\.venv
    echo Please install dependencies first:
    echo     cd backend ^&^& uv sync
    echo.
    pause
    exit /b 1
)

if not exist "%BACKEND%\.env" (
    echo [note] backend\.env not found, running with default settings.
    echo        Copy backend\.env.example to .env to configure API keys,
    echo        or set FAKE_MODE=true to try generation without keys.
    echo.
)

rem ---- start (single process, no --reload: predictable stop) ----
echo [start] backend http://localhost:8000  (API docs: /docs)
echo.
cd /d "%BACKEND%"
".venv\Scripts\python.exe" -m uvicorn app.main:create_app --factory --port 8000

rem ---- keep window open on abnormal exit ----
echo.
echo [end] backend exited.
pause
