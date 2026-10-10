@echo off
setlocal
REM Launch One EAD from the workspace root.
cd /d "%~dp0"

REM ----------------------------------------------------------------------
REM 1. Verify Python is installed and accessible in PATH
REM ----------------------------------------------------------------------
python --version >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo.
    echo ======================================================================
    echo  [ERROR] Python was not found in your system PATH.
    echo.
    echo  One EAD requires Python 3.10 or higher.
    echo  Please install Python from: https://www.python.org/downloads/
    echo.
    echo  IMPORTANT: During installation, check "Add Python to PATH".
    echo ======================================================================
    echo.
    pause
    exit /b 1
)

REM ----------------------------------------------------------------------
REM 2. Smart dependency check & automatic first-time setup
REM    - Fast path: if dependencies were verified (.deps_ok exists),
REM      launch instantly with zero startup overhead.
REM    - First-time run / new PC: run check_deps.py to install packages.
REM ----------------------------------------------------------------------
if exist ".deps_ok" goto launch

echo ======================================================================
echo  [One EAD] Verifying environment and Python dependencies...
echo ======================================================================
python server\check_deps.py
if %ERRORLEVEL% neq 0 (
    echo.
    echo ======================================================================
    echo  [ERROR] Dependency setup failed.
    echo  Please check the error messages above and run start.bat again.
    echo ======================================================================
    echo.
    pause
    exit /b 1
)

:launch
python run.py %*

