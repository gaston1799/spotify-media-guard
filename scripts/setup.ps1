param(
    [switch]$Package,
    [switch]$InstallDesktop
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    throw "Node.js is required. Install the current LTS from https://nodejs.org/ and run this script again."
}

if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    throw "npm is required and should be installed with Node.js."
}

$nodeVersion = (& node -p "process.versions.node").Trim()
$nodeParts = $nodeVersion.Split(".")
$nodeMajor = [int]$nodeParts[0]
$nodeMinor = [int]$nodeParts[1]
if ($nodeMajor -lt 22 -or ($nodeMajor -eq 22 -and $nodeMinor -lt 12)) {
    throw "Node.js 22.12 or newer is required. Installed version: $nodeVersion"
}

npm ci
if ($LASTEXITCODE -ne 0) {
    throw "npm ci failed. Do not add packages manually; use the committed package-lock.json."
}

if ($Package) {
    npm run package:win
    if ($LASTEXITCODE -ne 0) {
        throw "Windows packaging failed."
    }
}

if ($InstallDesktop) {
    npm run install:desktop
}

Write-Host "Setup complete." -ForegroundColor Green
