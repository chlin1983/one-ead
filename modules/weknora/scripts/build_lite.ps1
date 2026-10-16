# =======================================================
# WeKnora Lite - PowerShell Build Pipeline
# =======================================================

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ModuleDir = Resolve-Path "$ScriptDir\.."
$RepoDir = Join-Path $ModuleDir "WeKnora"

Write-Host "=== WeKnora Lite Build Pipeline ===" -ForegroundColor Cyan
Write-Host "Module Dir : $ModuleDir"
Write-Host "Repo Dir   : $RepoDir`n"

if (-not (Test-Path "$RepoDir\cmd\server\main.go")) {
    Write-Error "Could not find WeKnora repository at $RepoDir."
    exit 1
}

# 1. Frontend
Write-Host "[1/3] Building frontend assets..." -ForegroundColor Yellow
if (Get-Command npm -ErrorAction SilentlyContinue) {
    if ($env:SKIP_FRONTEND -eq "1") {
        Write-Host "SKIP_FRONTEND=1 detected, skipping frontend build." -ForegroundColor Gray
    } else {
        Push-Location "$RepoDir\frontend"
        try {
            npm install --prefer-offline
            npm run build
        } finally {
            Pop-Location
        }
        if (Test-Path "$RepoDir\frontend\dist") {
            $WebDir = "$RepoDir\web"
            if (Test-Path $WebDir) { Remove-Item -Recurse -Force $WebDir }
            Copy-Item -Recurse -Force "$RepoDir\frontend\dist" $WebDir
            Write-Host "[OK] Frontend assets generated at web/" -ForegroundColor Green
        }
    }
} else {
    Write-Warning "npm not found in PATH. Skipping frontend build."
}

# 2. Go check
Write-Host "`n[2/3] Checking Go compiler..." -ForegroundColor Yellow
if (-not (Get-Command go -ErrorAction SilentlyContinue)) {
    Write-Host "`n[!] Go compiler ('go') not found in PATH." -ForegroundColor Red
    Write-Host "Please install Go 1.23+ from https://go.dev/dl/"
    Write-Host "For CGO (required for SQLite FTS5/vector), install MinGW-w64 or w64devkit."
    exit 1
}

# 3. Go compile
Write-Host "`n[3/3] Compiling WeKnora Lite binary..." -ForegroundColor Yellow
$env:EDITION = "lite"
$env:CGO_ENABLED = "1"
$env:CGO_CFLAGS = "-Wno-deprecated-declarations"

$TargetBinary = Join-Path $ModuleDir "WeKnora-lite.exe"
Push-Location $RepoDir
try {
    go build -tags "sqlite_fts5" -ldflags="-w -s -X 'google.golang.org/protobuf/reflect/protoregistry.conflictPolicy=warn'" -o $TargetBinary ./cmd/server
    if ($LASTEXITCODE -eq 0) {
        Write-Host "`n=== Build Succeeded! ===" -ForegroundColor Green
        Write-Host "Binary: $TargetBinary`n"
    } else {
        Write-Error "Go build failed with exit code $LASTEXITCODE."
    }
} finally {
    Pop-Location
}
