@echo off
setlocal
cd /d "%~dp0"

echo ======================================================================
echo  [One EAD] Stopping server on port 8100 & WeKnora on port 8082
echo ======================================================================

set FOUND=0
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :8100 ^| findstr LISTENING') do (
    set FOUND=1
    echo Terminating server process PID %%a (port 8100)
    taskkill /PID %%a /F >nul 2>&1
)

for /f "tokens=5" %%a in ('netstat -ano ^| findstr :8082 ^| findstr LISTENING') do (
    set FOUND=1
    echo Terminating WeKnora process PID %%a (port 8082)
    taskkill /PID %%a /F >nul 2>&1
)

taskkill /IM WeKnora-lite.exe /F >nul 2>&1

if "%FOUND%"=="1" (
    echo [One EAD] Services stopped successfully.
) else (
    echo [One EAD] No active server processes found.
)

echo.
ping 127.0.0.1 -n 3 >nul
