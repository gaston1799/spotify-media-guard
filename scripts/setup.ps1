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

npm install

if ($Package) {
    npm run package:win
}

if ($InstallDesktop) {
    npm run install:desktop
}

Write-Host "Setup complete." -ForegroundColor Green
