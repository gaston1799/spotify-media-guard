$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.IO.Compression.FileSystem
$root = Join-Path ([IO.Path]::GetTempPath()) ("guard-updater-test-" + [Guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $root | Out-Null
$install = Join-Path $root "Spotify Media Guard"
$job = Join-Path $root "job"
$payload = Join-Path $root "payload\Spotify Media Guard-win32-x64"
New-Item -ItemType Directory -Path $install,$job,(Join-Path $payload "resources") -Force | Out-Null
# A small Windows binary exercises replacement without opening another copy of the app.
$binary = Join-Path $env:SystemRoot "System32\where.exe"
Copy-Item -LiteralPath $binary -Destination (Join-Path $payload "Spotify Media Guard.exe")
Copy-Item -LiteralPath $binary -Destination (Join-Path $install "Spotify Media Guard.exe")
Set-Content -LiteralPath (Join-Path $payload "resources\app.asar") -Value "fixture"
Set-Content -LiteralPath (Join-Path $install "keep.txt") -Value "preserved"
$zip = Join-Path $job "update.zip"
[IO.Compression.ZipFile]::CreateFromDirectory((Join-Path $root "payload"),$zip)
$plan = @{
    installDir=$install; executable=(Join-Path $install "Spotify Media Guard.exe")
    zipPath=$zip; jobDir=$job; ownerPid=2147483647
    version=([Diagnostics.FileVersionInfo]::GetVersionInfo($binary)).ProductVersion
    resultPath=(Join-Path $root "result.json")
}
$planPath = Join-Path $job "plan.json"
$plan | ConvertTo-Json | Set-Content -LiteralPath $planPath -Encoding UTF8
$helper = Join-Path $PSScriptRoot "apply-update.ps1"
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $helper -PlanPath $planPath -PrepareOnly
if ($LASTEXITCODE -ne 0) { throw "Prepare failed" }
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $helper -PlanPath $planPath
if ($LASTEXITCODE -ne 0) { throw "Apply failed" }
$result = Get-Content $plan.resultPath -Raw | ConvertFrom-Json
if (-not $result.success -or -not (Test-Path (Join-Path $install "keep.txt")) -or -not (Test-Path $result.backup)) { throw "Replacement or preservation failed" }
Write-Output "PASS: prepared, replaced, preserved extra file, retained backup"

$job2 = Join-Path $root "rollback-job"
New-Item -ItemType Directory -Path $job2 | Out-Null
$plan.jobDir = $job2
$planPath2 = Join-Path $job2 "plan.json"
$plan | ConvertTo-Json | Set-Content -LiteralPath $planPath2 -Encoding UTF8
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $helper -PlanPath $planPath2
if ($LASTEXITCODE -ne 1) { throw "Expected failed replacement" }
$result = Get-Content $plan.resultPath -Raw | ConvertFrom-Json
if ($result.success -or -not (Test-Path (Join-Path $install "keep.txt")) -or -not (Test-Path $plan.executable)) { throw "Rollback failed" }
Write-Output "PASS: missing stage rolls back to original installation"

$badJob = Join-Path $root "bad-job"
New-Item -ItemType Directory -Path $badJob | Out-Null
$badZip = Join-Path $badJob "bad.zip"
$archive = [IO.Compression.ZipFile]::Open($badZip,[IO.Compression.ZipArchiveMode]::Create)
[void]$archive.CreateEntry("../escape.txt")
$archive.Dispose()
$plan.jobDir = $badJob
$plan.zipPath = $badZip
$badPlan = Join-Path $badJob "plan.json"
$plan | ConvertTo-Json | Set-Content -LiteralPath $badPlan -Encoding UTF8
$ErrorActionPreference = "Continue"
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $helper -PlanPath $badPlan -PrepareOnly 2>$null
$ErrorActionPreference = "Stop"
if ($LASTEXITCODE -eq 0 -or (Test-Path (Join-Path $root "escape.txt"))) { throw "Unsafe archive accepted" }
Write-Output "PASS: traversal archive rejected"
Write-Output ("Test evidence: " + $root)
