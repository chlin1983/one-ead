@echo off
setlocal enabledelayedexpansion

echo =======================================================
echo          WeKnora Lite - Windows Build Pipeline
echo =======================================================
echo.

set SCRIPT_DIR=%~dp0
set MODULE_DIR=%SCRIPT_DIR%..
set REPO_DIR=%MODULE_DIR%\WeKnora

if exist "%MODULE_DIR%\tools\go\bin" (
    set "PATH=%MODULE_DIR%\tools\go\bin;%PATH%"
)
if exist "%MODULE_DIR%\tools\w64devkit\bin" (
    set "PATH=%MODULE_DIR%\tools\w64devkit\bin;%PATH%"
)

cd /d "%REPO_DIR%"
if not exist "%REPO_DIR%\cmd\server\main.go" (
    echo [ERROR] Could not find WeKnora repository at "%REPO_DIR%".
    echo Please ensure WeKnora has been cloned properly.
    exit /b 1
)

:: Apply Lite Mode Patches (Offline DocExtractor, AutoAuth, SQLite) if present
if exist "%MODULE_DIR%\patches\weknora_lite.patch" (
    git apply --check "%MODULE_DIR%\patches\weknora_lite.patch" >nul 2>&1
    if !errorlevel! equ 0 (
        echo [INFO] Applying WeKnora Lite standalone patches...
        git apply "%MODULE_DIR%\patches\weknora_lite.patch"
    )
)

:: Step 1: Check Node.js and build Frontend assets
echo [1/3] Checking frontend assets...
if exist "%REPO_DIR%\web\index.html" (
    echo [INFO] Frontend assets already built at "%REPO_DIR%\web". Skipping frontend build.
    goto check_go
)
if defined SKIP_FRONTEND (
    echo [INFO] SKIP_FRONTEND set, skipping frontend build.
    goto check_go
)

where npm >nul 2>nul
if %errorlevel% equ 0 (
    echo [INFO] Building frontend SPA...
    cd /d "%REPO_DIR%\frontend"
    call npm install --prefer-offline
    call npm run build
    cd /d "%REPO_DIR%"
    if exist "%REPO_DIR%\frontend\dist" (
        if exist "%REPO_DIR%\web" rmdir /s /q "%REPO_DIR%\web"
        xcopy /E /I /Y "%REPO_DIR%\frontend\dist" "%REPO_DIR%\web" >nul
        echo [SUCCESS] Frontend built and copied to web/ directory.
    ) else (
        echo [WARN] frontend\dist not found, check frontend build logs.
    )
) else (
    echo [WARN] npm not found in PATH. Skipping frontend build.
)

:check_go

:: Step 2: Check Go toolchain
echo.
echo [2/3] Checking Go toolchain...
where go >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] Go compiler 'go' is not installed or not in system PATH.
    echo To compile the Lite binary on Windows, please install:
    echo   1. Go 1.23+ : https://go.dev/dl/
    echo   2. GCC / MinGW: CGO is required for SQLite FTS5 and sqlite-vec
    echo      Recommended: w64devkit https://github.com/skeeto/w64devkit/releases
    echo.
    exit /b 1
)

:: Step 3: Compile Go Lite binary
echo.
echo [3/3] Compiling WeKnora Lite standalone binary...
set EDITION=lite
set GOTOOLCHAIN=local
set CGO_ENABLED=1
set CGO_CFLAGS=-Wno-deprecated-declarations
set CGO_LDFLAGS=

go build -tags "sqlite_fts5,duckdb_use_lib" -ldflags="-w -s -X 'github.com/Tencent/WeKnora/internal/handler.Edition=lite' -X 'google.golang.org/protobuf/reflect/protoregistry.conflictPolicy=warn'" -o "%MODULE_DIR%\WeKnora-lite.exe" ./cmd/server
if %errorlevel% equ 0 (
    echo.
    echo =======================================================
    echo [SUCCESS] WeKnora Lite compiled successfully!
    echo Binary: %MODULE_DIR%\WeKnora-lite.exe
    echo =======================================================
    exit /b 0
) else (
    echo.
    echo [ERROR] Compilation failed. Please ensure a C compiler GCC or MinGW is available for CGO.
    exit /b %errorlevel%
)
