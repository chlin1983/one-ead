@echo off
setlocal enabledelayedexpansion

set SCRIPT_DIR=%~dp0
set MODULE_DIR=%SCRIPT_DIR%..
set REPO_DIR=%MODULE_DIR%\WeKnora

:: Check binary
set BINARY=%MODULE_DIR%\WeKnora-lite.exe
if not exist "%BINARY%" (
    if exist "%REPO_DIR%\WeKnora-lite.exe" (
        set BINARY=%REPO_DIR%\WeKnora-lite.exe
    ) else (
        echo [ERROR] WeKnora-lite.exe not found.
        echo Please run build_lite.bat first or compile the Lite binary.
        pause
        exit /b 1
    )
)

:: Check .env.lite
set ENV_FILE=%MODULE_DIR%\.env.lite
if not exist "%ENV_FILE%" (
    if exist "%REPO_DIR%\.env.lite" (
        set ENV_FILE=%REPO_DIR%\.env.lite
    ) else (
        echo [INFO] .env.lite not found, creating from template...
        copy "%MODULE_DIR%\configs\.env.lite.template" "%MODULE_DIR%\.env.lite" >nul
        set ENV_FILE=%MODULE_DIR%\.env.lite
    )
)

echo Loading environment from %ENV_FILE%...
for /f "usebackq tokens=1,* delims==" %%A in ("%ENV_FILE%") do (
    set "LINE=%%A"
    if not "!LINE:~0,1!"=="#" (
        if not "%%A"=="" set "%%A=%%B"
    )
)

echo Starting WeKnora Lite on %SERVER_HOST%:%SERVER_PORT%...
cd /d "%MODULE_DIR%"
"%BINARY%"
