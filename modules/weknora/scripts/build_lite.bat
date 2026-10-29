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

set PINNED_COMMIT=2fbfb4471581cd5e7d731bc7a2d443fe7d8e95b5
set PATCH_FILE=%MODULE_DIR%\patches\weknora_lite.patch

:: Verify upstream revision
set CURRENT_COMMIT=unknown
for /f %%i in ('git rev-parse HEAD 2^>nul') do set CURRENT_COMMIT=%%i
if not "!CURRENT_COMMIT!"=="%PINNED_COMMIT%" (
    echo.
    echo [ERROR] ===============================================================
    echo [ERROR] Upstream repository commit differs from reviewed pin!
    echo [ERROR] Expected pinned commit: %PINNED_COMMIT%
    echo [ERROR] Actual checked out commit: !CURRENT_COMMIT!
    echo [ERROR]
    echo [ERROR] Build halted by default to enforce reviewed code and patch integrity.
    echo [ERROR] Updating to a new pin requires an explicit review, verifying
    echo [ERROR] weknora_lite.patch applies cleanly, and updating PINNED_COMMIT in build_lite.bat.
    echo [ERROR] ===============================================================
    exit /b 1
) else (
    echo [INFO] Upstream revision verified: %PINNED_COMMIT%
)

:: Verify and apply Lite patches strictly
if not exist "%PATCH_FILE%" (
    echo [ERROR] Required patch file not found at "%PATCH_FILE%".
    exit /b 1
)

git apply --ignore-whitespace --reverse --check "%PATCH_FILE%" >nul 2>&1
if !errorlevel! equ 0 (
    echo [INFO] WeKnora Lite standalone patches are already applied.
    set PATCH_APPLIED=1
) else (
    git apply --ignore-whitespace --check "%PATCH_FILE%" >nul 2>&1
    if !errorlevel! equ 0 (
        echo [INFO] Cleanly applying WeKnora Lite standalone patches...
        git apply --ignore-whitespace "%PATCH_FILE%"
        if !errorlevel! neq 0 (
            echo [ERROR] Failed to apply WeKnora Lite patches! Aborting build.
            exit /b 1
        )
        set PATCH_APPLIED=1
    ) else (
        echo.
        echo [ERROR] ===============================================================
        echo [ERROR] WeKnora Lite patch cannot be cleanly applied to current checkout!
        echo [ERROR] It is neither applied nor cleanly applicable.
        echo [ERROR] Pinned commit: %PINNED_COMMIT%
        echo [ERROR] Current commit: !CURRENT_COMMIT!
        echo [ERROR] Build halted to prevent creating an unpatched/vulnerable binary.
        echo [ERROR] ===============================================================
        exit /b 1
    )
)

:: Step 1: Check Node.js and build Frontend assets
echo [1/3] Checking frontend assets...
if not defined REBUILD_FRONTEND (
    if exist "%REPO_DIR%\web\index.html" (
        echo [INFO] Frontend assets already built at "%REPO_DIR%\web". Skipping frontend build.
        goto check_go
    )
)
if defined SKIP_FRONTEND (
    echo [INFO] SKIP_FRONTEND set, skipping frontend build.
    goto check_go
)

where npm >nul 2>nul
if %errorlevel% equ 0 (
    echo [INFO] Building frontend SPA...
    cd /d "%REPO_DIR%\frontend"
    call npm install --prefer-offline --ignore-scripts
    call npm run build
    cd /d "%REPO_DIR%"
    if exist "%REPO_DIR%\frontend\dist" (
        if exist "%REPO_DIR%\web" rmdir /s /q "%REPO_DIR%\web"
        xcopy /E /I /Y "%REPO_DIR%\frontend\dist" "%REPO_DIR%\web" >nul
        if not exist "%MODULE_DIR%\dist" mkdir "%MODULE_DIR%\dist"
        xcopy /E /I /Y "%REPO_DIR%\frontend\dist" "%MODULE_DIR%\dist" >nul
        echo [SUCCESS] Frontend built and copied to web/ and dist/ directories.
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
set CGO_ENABLED=1
set CGO_CFLAGS=-Wno-deprecated-declarations
set CGO_LDFLAGS=

go build -tags "lite,sqlite_fts5" -ldflags="-w -s -X 'github.com/Tencent/WeKnora/internal/handler.Edition=lite' -X 'google.golang.org/protobuf/reflect/protoregistry.conflictPolicy=warn'" -o "%MODULE_DIR%\WeKnora-lite.exe" ./cmd/server
if %errorlevel% equ 0 (
    echo.
    echo =======================================================
    echo [SUCCESS] WeKnora Lite compiled successfully!
    echo Binary: %MODULE_DIR%\WeKnora-lite.exe
    echo =======================================================
    (
        echo {
        echo   "build_date": "%date%",
        echo   "build_time": "%time%",
        echo   "pinned_commit": "%PINNED_COMMIT%",
        echo   "actual_commit": "!CURRENT_COMMIT!",
        echo   "patch_file": "weknora_lite.patch",
        echo   "edition": "lite"
        echo }
    ) > "%MODULE_DIR%\build_info.json"
    echo [INFO] Build metadata recorded at "%MODULE_DIR%\build_info.json".
    exit /b 0
) else (
    echo.
    echo [ERROR] Compilation failed. Please ensure a C compiler GCC or MinGW is available for CGO.
    exit /b %errorlevel%
)
