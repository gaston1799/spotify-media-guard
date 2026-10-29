param([Parameter(Mandatory=$true)][string]$PlanPath, [switch]$PrepareOnly)
$ErrorActionPreference = "Stop"
$plan = Get-Content -LiteralPath $PlanPath -Raw | ConvertFrom-Json
$install = [IO.Path]::GetFullPath($plan.installDir)
$job = [IO.Path]::GetFullPath($plan.jobDir)
$parent = Split-Path -Parent $install
if ((Split-Path -Leaf $install) -notin @("Spotify Media Guard", "Spotify Media Guard-win32-x64") -or
    [IO.Path]::GetFullPath($plan.executable) -ne (Join-Path $install "Spotify Media Guard.exe")) {
    throw "Invalid installation target."
}
$stage = Join-Path $parent (".media-guard-stage-" + (Split-Path -Leaf $job))
$backup = Join-Path $parent (".media-guard-backup-" + (Split-Path -Leaf $job))
$unpacked = Join-Path $job "unpacked"
$package = Join-Path $unpacked "Spotify Media Guard-win32-x64"
function Save-Result($ok, $message) {
    @{ success=$ok; message=$message; version=$plan.version; date=(Get-Date).ToString("o"); backup=$backup } |
        ConvertTo-Json | Set-Content -LiteralPath $plan.resultPath -Encoding UTF8
}

if ($PrepareOnly) {
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $archive = [IO.Compression.ZipFile]::OpenRead($plan.zipPath)
    try {
        [long]$size = 0
        foreach ($entry in $archive.Entries) {
            $name = $entry.FullName.Replace("\", "/")
            if ($name.StartsWith("/") -or $name.Contains(":") -or ($name.Split("/") -contains "..") -or
                -not $name.StartsWith("Spotify Media Guard-win32-x64/") -or
                (($entry.ExternalAttributes -shr 16) -band 0xF000) -eq 0xA000) {
                throw "Unsafe archive entry."
            }
            $size += $entry.Length
            if ($size -gt 2147483648) { throw "Update archive is too large." }
        }
    } finally { $archive.Dispose() }
    [IO.Compression.ZipFile]::ExtractToDirectory($plan.zipPath, $unpacked)
    if (-not (Test-Path -LiteralPath (Join-Path $package "Spotify Media Guard.exe")) -or
        -not (Test-Path -LiteralPath (Join-Path $package "resources\app.asar"))) { throw "Incomplete update package." }
    $expected = $plan.version.TrimStart("v")
    if ([Diagnostics.FileVersionInfo]::GetVersionInfo((Join-Path $package "Spotify Media Guard.exe")).ProductVersion -ne $expected) {
        throw "Update version mismatch."
    }
    # Preserve extra portable files; overlay only the files supplied by the release.
    New-Item -ItemType Directory -Path $stage | Out-Null
    foreach ($item in Get-ChildItem -LiteralPath $install -Force) {
        Copy-Item -LiteralPath $item.FullName -Destination $stage -Recurse -Force
    }
    foreach ($item in Get-ChildItem -LiteralPath $package -Force) {
        Copy-Item -LiteralPath $item.FullName -Destination $stage -Recurse -Force
    }
    exit 0
}

$renamed = $false
$applied = $false
Set-Content -LiteralPath (Join-Path $job "helper-ready") -Value "ready" -Encoding ASCII
try {
    $owner = Get-Process -Id $plan.ownerPid -ErrorAction SilentlyContinue
    if ($owner -and -not $owner.WaitForExit(120000)) { throw "App did not exit in time." }
    # Chromium helper processes may hold files briefly after the main process exits.
    $deadline = (Get-Date).AddSeconds(20)
    do {
        try { Move-Item -LiteralPath $install -Destination $backup; $renamed = $true; break }
        catch { if ((Get-Date) -ge $deadline) { throw }; Start-Sleep -Milliseconds 500 }
    } while ($true)
    Move-Item -LiteralPath $stage -Destination $install
    $applied = $true
    Save-Result $true ("Updated to " + $plan.version + ". Previous installation retained at " + $backup)
    Start-Process -FilePath $plan.executable -WorkingDirectory $install
} catch {
    $message = $_.Exception.Message
    if ($renamed) {
        if ($applied -and (Test-Path -LiteralPath $install)) {
            Move-Item -LiteralPath $install -Destination (Join-Path $parent (".media-guard-failed-" + (Split-Path -Leaf $job)))
        }
        Move-Item -LiteralPath $backup -Destination $install
    }
    Save-Result $false ("Update failed: " + $message + ". Original installation preserved.")
    if (Test-Path -LiteralPath $plan.executable) {
        Start-Process -FilePath $plan.executable -WorkingDirectory $install
    }
    exit 1
}
