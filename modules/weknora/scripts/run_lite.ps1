# =======================================================
# WeKnora Lite - PowerShell Launcher
# =======================================================

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ModuleDir = Resolve-Path "$ScriptDir\.."
$RepoDir = Join-Path $ModuleDir "WeKnora"

$Binary = Join-Path $ModuleDir "WeKnora-lite.exe"
if (-not (Test-Path $Binary)) {
    $Alt = Join-Path $RepoDir "WeKnora-lite.exe"
    if (Test-Path $Alt) { $Binary = $Alt }
    else {
        Write-Error "WeKnora-lite.exe not found. Please compile or run build_lite.ps1 first."
        exit 1
    }
}

$EnvFile = Join-Path $ModuleDir ".env.lite"
if (-not (Test-Path $EnvFile)) {
    $AltEnv = Join-Path $RepoDir ".env.lite"
    if (Test-Path $AltEnv) { $EnvFile = $AltEnv }
    else {
        Copy-Item (Join-Path $ModuleDir "configs\.env.lite.template") $EnvFile
    }
}

Write-Host "Loading environment from $EnvFile..." -ForegroundColor Cyan
Get-Content $EnvFile | ForEach-Object {
    $line = $_.Trim()
    if ($line -and -not $line.StartsWith("#") -and ($line -match "^([^=]+)=(.*)$")) {
        $key = $matches[1].Trim()
        $val = $matches[2].Trim()
        [System.Environment]::SetEnvironmentVariable($key, $val, "Process")
    }
}

$HostAddr = [System.Environment]::GetEnvironmentVariable("SERVER_HOST")
if (-not $HostAddr) { $HostAddr = "127.0.0.1" }
$Port = [System.Environment]::GetEnvironmentVariable("SERVER_PORT")
if (-not $Port) { $Port = "8082" }

Write-Host "Launching WeKnora Lite on http://$($HostAddr):$Port..." -ForegroundColor Green
Push-Location $ModuleDir
try {
    & $Binary
} finally {
    Pop-Location
}
