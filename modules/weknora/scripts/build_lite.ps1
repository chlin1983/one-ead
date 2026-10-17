# =======================================================
# WeKnora Lite - PowerShell Build Pipeline
# =======================================================

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ModuleDir = Resolve-Path "$ScriptDir\.."
$RepoDir = Join-Path $ModuleDir "WeKnora"

$ToolsGo = Join-Path $ModuleDir "tools\go\bin"
$ToolsGcc = Join-Path $ModuleDir "tools\w64devkit\bin"
if (Test-Path $ToolsGo) { $env:PATH = "$ToolsGo;$env:PATH" }
if (Test-Path $ToolsGcc) { $env:PATH = "$ToolsGcc;$env:PATH" }

Write-Host "=== WeKnora Lite Build Pipeline ===" -ForegroundColor Cyan
Write-Host "Module Dir : $ModuleDir"
Write-Host "Repo Dir   : $RepoDir`n"

if (-not (Test-Path "$RepoDir\cmd\server\main.go")) {
    Write-Error "Could not find WeKnora repository at $RepoDir."
    exit 1
}

$PinnedCommit = "2fbfb4471581cd5e7d731bc7a2d443fe7d8e95b5"
$PatchFile = Join-Path $ModuleDir "patches\weknora_lite.patch"

# Verify upstream revision
Push-Location $RepoDir
try {
    $CurrentCommit = (git rev-parse HEAD 2>$null).Trim()
    if ($CurrentCommit -ne $PinnedCommit) {
        Write-Warning "Repository commit ($CurrentCommit) differs from pinned revision ($PinnedCommit)."
    } else {
        Write-Host "[INFO] Upstream revision verified: $PinnedCommit" -ForegroundColor Green
    }

    # Strict patch check
    if (-not (Test-Path $PatchFile)) {
        Write-Error "Required patch file not found at $PatchFile"
        exit 1
    }

    git apply --ignore-whitespace --reverse --check $PatchFile 2>$null
    if ($LASTEXITCODE -eq 0) {
        Write-Host "[INFO] WeKnora Lite standalone patches are already applied." -ForegroundColor Green
    } else {
        git apply --ignore-whitespace --check $PatchFile 2>$null
        if ($LASTEXITCODE -eq 0) {
            Write-Host "[INFO] Cleanly applying WeKnora Lite standalone patches..." -ForegroundColor Cyan
            git apply --ignore-whitespace $PatchFile
            if ($LASTEXITCODE -ne 0) {
                Write-Error "Failed to apply WeKnora Lite patches! Aborting build."
                exit 1
            }
        } else {
            Write-Error "WeKnora Lite patch cannot be cleanly applied to current checkout! It is neither applied nor cleanly applicable."
            exit 1
        }
    }
} finally {
    Pop-Location
}

# 1. Frontend
Write-Host "[1/3] Building frontend assets..." -ForegroundColor Yellow
if (Get-Command npm -ErrorAction SilentlyContinue) {
    if ($env:SKIP_FRONTEND -eq "1") {
        Write-Host "SKIP_FRONTEND=1 detected, skipping frontend build." -ForegroundColor Gray
    } else {
        Push-Location "$RepoDir\frontend"
        try {
            npm install --prefer-offline --ignore-scripts
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
$env:GOTOOLCHAIN = "local"
$env:CGO_ENABLED = "1"
$env:CGO_CFLAGS = "-Wno-deprecated-declarations"
$env:CGO_LDFLAGS = ""

$TargetBinary = Join-Path $ModuleDir "WeKnora-lite.exe"
Push-Location $RepoDir
try {
    go build -tags "lite,sqlite_fts5" -ldflags="-w -s -X 'github.com/Tencent/WeKnora/internal/handler.Edition=lite' -X 'google.golang.org/protobuf/reflect/protoregistry.conflictPolicy=warn'" -o $TargetBinary ./cmd/server
    if ($LASTEXITCODE -eq 0) {
        Write-Host "`n=== Build Succeeded! ===" -ForegroundColor Green
        Write-Host "Binary: $TargetBinary`n"
        $BuildInfo = @{
            build_time    = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
            pinned_commit = $PinnedCommit
            actual_commit = $CurrentCommit
            patch_file    = "weknora_lite.patch"
            edition       = "lite"
        }
        $BuildInfoJson = Join-Path $ModuleDir "build_info.json"
        $BuildInfo | ConvertTo-Json | Set-Content $BuildInfoJson
        Write-Host "[INFO] Build metadata recorded at $BuildInfoJson" -ForegroundColor Cyan
    } else {
        Write-Error "Go build failed with exit code $LASTEXITCODE."
    }
} finally {
    Pop-Location
}
