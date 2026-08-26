@echo off
rem ============================================================
rem  Audio Studio - Stop backend + frontend (double insurance)
rem
rem  1) Kill by window title (audio-studio-backend/frontend)
rem  2) Kill by port 8000/5173 with process-name check
rem     (python.exe / node.exe - avoid killing unrelated apps)
rem  Pure ASCII on purpose: safe under any console code page.
rem  See README.md for Chinese documentation.
rem ============================================================
setlocal enabledelayedexpansion
title audio-studio-stop
set "KILLED=0"

echo [stop] Audio Studio services...
echo.

rem ---- pass 1: kill by window title (whole process tree) ----
taskkill /F /T /FI "WINDOWTITLE eq audio-studio-backend*" >nul 2>nul
if not errorlevel 1 (
    set "KILLED=1"
    echo   - backend window killed [title match]
)
taskkill /F /T /FI "WINDOWTITLE eq audio-studio-frontend*" >nul 2>nul
if not errorlevel 1 (
    set "KILLED=1"
    echo   - frontend window killed [title match]
)

rem ---- pass 2: kill by port (with process-name check) ----
call :kill_port 8000 python.exe "backend uvicorn"
call :kill_port 5173 node.exe "frontend vite"

if "%KILLED%"=="0" (
    echo   - no running Audio Studio services found.
) else (
    echo.
    echo [done] all services stopped, windows will close.
)
timeout /t 3 >nul
exit /b 0

rem ------------------------------------------------------------
rem :kill_port PORT EXPECTED_PROCESS LABEL
rem Find PIDs listening on PORT; kill only if process name matches.
rem ------------------------------------------------------------
:kill_port
set "PORT=%~1"
set "EXPECT=%~2"
set "LABEL=%~3"
for /f "tokens=5" %%P in ('netstat -ano ^| findstr /R /C:":%PORT% .*LISTENING"') do (
    set "PID=%%P"
    if not "!PID!"=="0" (
        tasklist /FI "PID eq !PID!" /NH 2>nul | findstr /I "!EXPECT!" >nul
        if not errorlevel 1 (
            taskkill /F /T /PID !PID! >nul 2>nul
            set "KILLED=1"
            echo   - killed %LABEL% [port %PORT%, PID !PID!]
        )
    )
)
goto :eof
