$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$json = gh api repos/gaston1799/spotify-media-guard/releases/latest
if ($LASTEXITCODE -ne 0) { throw "Could not retrieve the published release." }
$release = $json | ConvertFrom-Json
if ($release.draft -or $release.prerelease) { throw "Expected a published stable release." }
$asset = $release.assets | Where-Object { $_.name -eq "Spotify.Media.Guard-$($release.tag_name)-win32-x64.zip" }
if (-not $asset -or $asset.digest -notmatch '^sha256:[0-9a-f]{64}$' -or $asset.size -le 0) {
    throw "Published release is missing a verified ZIP."
}
$manifest = [ordered]@{
    tag_name = $release.tag_name
    name = $release.name
    body = $release.body
    draft = $false
    prerelease = $false
    assets = @([ordered]@{ name = $asset.name; size = $asset.size; digest = $asset.digest; browser_download_url = $asset.browser_download_url })
}
[IO.File]::WriteAllText((Join-Path $root 'update-manifest.json'), ($manifest | ConvertTo-Json -Depth 6), (New-Object Text.UTF8Encoding $false))
Write-Host "Manifest refreshed from published $($release.tag_name). Commit and push update-manifest.json."
