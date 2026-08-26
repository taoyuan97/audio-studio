@echo off
rem ============================================================
rem  Audio Studio - Start backend + frontend (two windows)
rem  Opens default browser when frontend is ready.
rem  Stop with scripts\stop-all.bat
rem  Pure ASCII on purpose: safe under any console code page.
rem ============================================================
setlocal

set "ROOT=%~dp0"

start "audio-studio-backend"  cmd /c ""%ROOT%start-backend.bat""
start "audio-studio-frontend" cmd /c ""%ROOT%start-frontend.bat""

echo [done] launched in separate windows:
echo   - backend  http://localhost:8000
echo   - frontend http://localhost:5173/  (browser opens when ready)
echo.
echo To stop all services, double-click scripts\stop-all.bat
timeout /t 3 >nul
