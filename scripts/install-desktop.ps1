$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$appName = "Spotify Media Guard"
$source = Join-Path $root "dist\$appName-win32-x64"
$desktopTarget = Join-Path $env:USERPROFILE "Desktop\$appName"
$shortcutPath = Join-Path $env:USERPROFILE "Desktop\$appName.lnk"

if (-not (Test-Path -LiteralPath $source)) {
    npm run package:win
}

$selfPid = $PID
$running = Get-CimInstance Win32_Process | Where-Object {
    $_.ProcessId -ne $selfPid -and (
        $_.Name -eq "$appName.exe" -or
        $_.ExecutablePath -like "$desktopTarget*"
    )
}

foreach ($process in $running) {
    Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue
}

Start-Sleep -Milliseconds 500

if (Test-Path -LiteralPath $desktopTarget) {
    Remove-Item -LiteralPath $desktopTarget -Recurse -Force
}

Copy-Item -LiteralPath $source -Destination $desktopTarget -Recurse -Force

$targetExe = Join-Path $desktopTarget "$appName.exe"
$wsh = New-Object -ComObject WScript.Shell
$shortcut = $wsh.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $targetExe
$shortcut.WorkingDirectory = $desktopTarget
$shortcut.IconLocation = $targetExe
$shortcut.Save()

Write-Host "Installed to: $targetExe" -ForegroundColor Green
Write-Host "Shortcut created: $shortcutPath" -ForegroundColor Green
