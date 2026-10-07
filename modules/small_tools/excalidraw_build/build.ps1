# Script to rebuild Excalidraw offline assets for One EAD
$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

Write-Host "Installing dependencies..." -ForegroundColor Cyan
npm --prefix "$ScriptDir" install

Write-Host "Building production bundle..." -ForegroundColor Cyan
npm --prefix "$ScriptDir" run build

Write-Host "Copying fonts..." -ForegroundColor Cyan
$fontsSrc = Join-Path $ScriptDir "node_modules/@excalidraw/excalidraw/dist/prod/fonts"
$fontsDst = Join-Path $ScriptDir "../web/excalidraw/fonts"
if (Test-Path $fontsSrc) {
    Copy-Item -Path "$fontsSrc/*" -Destination $fontsDst -Recurse -Force
}

Write-Host "Cleaning up node_modules to save space..." -ForegroundColor Yellow
Remove-Item -Path "$ScriptDir/node_modules" -Recurse -Force -ErrorAction SilentlyContinue

Write-Host "Excalidraw build complete!" -ForegroundColor Green
