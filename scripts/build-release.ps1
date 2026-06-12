$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

npm ci
npm run package:win

$package = Get-Content -LiteralPath (Join-Path $root "package.json") -Raw | ConvertFrom-Json
$version = $package.version
$appName = "Spotify Media Guard"
$appFolder = Join-Path $root "dist\$appName-win32-x64"
$zipPath = Join-Path $root "dist\$appName-v$version-win32-x64.zip"

if (-not (Test-Path -LiteralPath $appFolder)) {
    throw "Packaged app folder was not found: $appFolder"
}

if (Test-Path -LiteralPath $zipPath) {
    Remove-Item -LiteralPath $zipPath -Force
}

Compress-Archive -LiteralPath $appFolder -DestinationPath $zipPath -Force
Write-Host "Release zip created: $zipPath" -ForegroundColor Green
