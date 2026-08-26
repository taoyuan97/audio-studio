@echo off
rem ============================================================
rem  Audio Studio - Start frontend (Vite dev, port 5173)
rem  Double-click to run. Opens default browser when ready.
rem  Stop with Ctrl+C or scripts\stop-all.bat
rem  Pure ASCII on purpose: safe under any console code page.
rem ============================================================
title audio-studio-frontend
setlocal

set "ROOT=%~dp0.."
set "FRONTEND=%ROOT%\frontend"

rem ---- preflight checks ----
where pnpm >nul 2>nul
if errorlevel 1 (
    echo [error] pnpm not found. Install Node.js + pnpm first:
    echo     https://pnpm.io/installation
    echo.
    pause
    exit /b 1
)

if not exist "%FRONTEND%\node_modules" (
    echo [error] Frontend dependencies missing. Please run:
    echo     cd frontend ^&^& pnpm install
    echo.
    pause
    exit /b 1
)

rem ---- start (--open: open default browser when ready) ----
echo [start] frontend http://localhost:5173/  (browser opens when ready)
echo.
cd /d "%FRONTEND%"
call pnpm exec vite --open

rem ---- keep window open on abnormal exit ----
echo.
echo [end] frontend exited.
pause
