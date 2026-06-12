param(
    [int]$Samples = 0,
    [int]$PollMilliseconds = 500,
    [switch]$DisableRestart,
    [string]$StopFile = ""
)

$ErrorActionPreference = "Stop"

if ([System.Threading.Thread]::CurrentThread.ApartmentState -ne "STA") {
    $argsList = @("-Sta", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "`"$PSCommandPath`"")
    if ($Samples -gt 0) {
        $argsList += @("-Samples", $Samples)
    }
    $argsList += @("-PollMilliseconds", $PollMilliseconds)
    if ($DisableRestart) {
        $argsList += "-DisableRestart"
    }
    if (-not [string]::IsNullOrWhiteSpace($StopFile)) {
        $argsList += @("-StopFile", "`"$StopFile`"")
    }

    $process = Start-Process -FilePath "powershell.exe" -ArgumentList $argsList -Wait -PassThru
    exit $process.ExitCode
}

$logDir = Join-Path $env:APPDATA "SpotifyPlayLogger"
$eventLogPath = Join-Path $logDir "windows_media_play_log.txt"
$rawLogPath = Join-Path $logDir "windows_media_raw_log.txt"
$savedSpotifyPathFile = Join-Path $logDir "last_spotify_path.txt"
$settingsPath = Join-Path $logDir "settings.json"
$defaultSettingsPath = Join-Path (Split-Path -Parent $PSCommandPath) "settings.default.json"
New-Item -ItemType Directory -Path $logDir -Force | Out-Null

function Read-Settings {
    if (-not (Test-Path -LiteralPath $settingsPath) -and (Test-Path -LiteralPath $defaultSettingsPath)) {
        Copy-Item -LiteralPath $defaultSettingsPath -Destination $settingsPath -Force
    }

    if (Test-Path -LiteralPath $settingsPath) {
        try {
            return Get-Content -LiteralPath $settingsPath -Raw | ConvertFrom-Json
        }
        catch {
            Write-Warning "Could not read settings.json; using built-in defaults. $($_.Exception.Message)"
        }
    }

    return [pscustomobject]@{
        pollMilliseconds = 500
        restartCooldownSeconds = 90
        restartTimeoutSeconds = 60
        autoRestart = $true
        useColor = $true
        adDetection = [pscustomobject]@{
            adTrackNumbers = @(5)
            normalSongTrackNumber = 2
            maxShortAdSeconds = 90
            treatShortNonSongTrackAsAd = $true
            treatBlankShortMediaAsAd = $true
        }
    }
}

$settings = Read-Settings
if ($PSBoundParameters.ContainsKey("PollMilliseconds") -and $PollMilliseconds -ne 500) {
    $effectivePollMilliseconds = $PollMilliseconds
}
else {
    $effectivePollMilliseconds = [int]$settings.pollMilliseconds
}

$PollMilliseconds = [Math]::Max(100, $effectivePollMilliseconds)

Add-Type -AssemblyName System.Runtime.WindowsRuntime -ErrorAction SilentlyContinue
$managerType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType=WindowsRuntime]
$mediaPropsType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties, Windows.Media.Control, ContentType=WindowsRuntime]
$boolType = [bool]
$restartCooldownSeconds = [Math]::Max(5, [int]$settings.restartCooldownSeconds)
$restartTimeoutSeconds = [Math]::Max(5, [int]$settings.restartTimeoutSeconds)
$autoRestartEnabled = [bool]$settings.autoRestart -and -not $DisableRestart
$script:UseColor = [string]::IsNullOrWhiteSpace($env:NO_COLOR) -and [bool]$settings.useColor

function Write-Color($text, $color = "Gray", [switch]$NoNewline) {
    if ($script:UseColor) {
        Write-Host $text -ForegroundColor $color -NoNewline:$NoNewline
    }
    else {
        Write-Host $text -NoNewline:$NoNewline
    }
}

function Get-EventColor($kind) {
    switch ($kind) {
        "logger_start" { "Cyan"; break }
        "song" { "Green"; break }
        "song_change" { "DarkGreen"; break }
        "pause" { "Yellow"; break }
        "resume" { "Green"; break }
        "ad_or_placeholder" { "Magenta"; break }
        "restart_spotify" { "Yellow"; break }
        "restart_exit" { "DarkYellow"; break }
        "waiting_for_spotify_media" { "Cyan"; break }
        "spotify_media_detected" { "Green"; break }
        "play_command" { "Cyan"; break }
        "play_command_error" { "Red"; break }
        "restart_timeout" { "Red"; break }
        "restart_missing" { "Red"; break }
        "not_playing" { "DarkGray"; break }
        "error" { "Red"; break }
        default { "Gray"; break }
    }
}

function Get-EventLabel($kind) {
    switch ($kind) {
        "logger_start" { "START"; break }
        "song" { "SONG"; break }
        "song_change" { "RAW"; break }
        "pause" { "PAUSE"; break }
        "resume" { "RESUME"; break }
        "ad_or_placeholder" { "AD"; break }
        "restart_spotify" { "RESTART"; break }
        "restart_exit" { "EXIT"; break }
        "waiting_for_spotify_media" { "WAIT"; break }
        "spotify_media_detected" { "FOUND"; break }
        "play_command" { "PLAY"; break }
        "play_command_error" { "PLAY_ERR"; break }
        "restart_timeout" { "TIMEOUT"; break }
        "restart_missing" { "MISSING"; break }
        "not_playing" { "IDLE"; break }
        "error" { "ERROR"; break }
        default { $kind.ToUpperInvariant(); break }
    }
}

function Write-Banner {
    $mode = if ($autoRestartEnabled) { "auto restart" } else { "monitor only" }
    $spotifyPath = Resolve-SpotifyPath

    Write-Color "+------------------------------------------------------------+" "DarkCyan"
    Write-Color "| Spotify Media Guard                                       |" "Cyan"
    Write-Color "+------------------------------------------------------------+" "DarkCyan"
    Write-Color "  Mode       : " "DarkGray" -NoNewline
    Write-Color $mode $(if ($autoRestartEnabled) { "Green" } else { "Yellow" })
    Write-Color "  Poll       : " "DarkGray" -NoNewline
    Write-Color "$PollMilliseconds ms" "White"
    Write-Color "  Spotify    : " "DarkGray" -NoNewline
    if ([string]::IsNullOrWhiteSpace($spotifyPath)) {
        Write-Color "URI fallback" "Yellow"
    }
    else {
        Write-Color $spotifyPath "Green"
    }
    Write-Color "  Cooldown   : " "DarkGray" -NoNewline
    Write-Color "$restartCooldownSeconds sec" "White"
    Write-Color "  Timeout    : " "DarkGray" -NoNewline
    Write-Color "$restartTimeoutSeconds sec" "White"
    Write-Color "  Settings   : " "DarkGray" -NoNewline
    Write-Color $settingsPath "White"
    Write-Color "  Event log  : " "DarkGray" -NoNewline
    Write-Color $eventLogPath "White"
    Write-Color "  Raw log    : " "DarkGray" -NoNewline
    Write-Color "$rawLogPath (changes only)" "White"
    Write-Color "  Stop       : Ctrl+C" "DarkGray"
    Write-Color "+------------------------------------------------------------+" "DarkCyan"
    Write-Host ""
}

function Await-WinRtOperation($operation, [Type]$resultType) {
    $method = [System.WindowsRuntimeSystemExtensions].GetMethods() |
        Where-Object {
            $_.Name -eq "AsTask" -and
            $_.IsGenericMethodDefinition -and
            $_.GetParameters().Count -eq 1 -and
            $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
        } |
        Select-Object -First 1

    if ($null -eq $method) {
        throw "Could not find Windows Runtime AsTask helper method."
    }

    $task = $method.MakeGenericMethod($resultType).Invoke($null, @($operation))
    return $task.GetAwaiter().GetResult()
}

function Normalize-Text($value) {
    if ($null -eq $value) {
        return ""
    }

    return (($value.ToString() -replace "\s+", " ").Trim())
}

function Format-MediaTitle($session) {
    if (-not [string]::IsNullOrWhiteSpace($session.Artist) -and -not [string]::IsNullOrWhiteSpace($session.Title)) {
        return "$($session.Artist) - $($session.Title)"
    }

    if (-not [string]::IsNullOrWhiteSpace($session.Title)) {
        return $session.Title
    }

    return "(no title)"
}

function Format-MediaTiming($session) {
    return "posSec=$([Math]::Round($session.Position, 1)) durSec=$([Math]::Round($session.Duration, 1)) track=$($session.TrackNumber) kind=$($session.Kind)"
}

function Format-MediaEvent($session) {
    return "$(Format-MediaTitle $session) | $(Format-MediaTiming $session)"
}

function Write-Log($path, $kind, $message) {
    $stamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss zzz"
    $line = "$stamp | $kind | $message"
    Add-Content -LiteralPath $path -Value $line

    $clock = Get-Date -Format "HH:mm:ss"
    $label = Get-EventLabel $kind
    $color = Get-EventColor $kind
    Write-Color $clock "DarkGray" -NoNewline
    Write-Color " [" "DarkGray" -NoNewline
    Write-Color ("{0,-8}" -f $label) $color -NoNewline
    Write-Color "] " "DarkGray" -NoNewline
    Write-Color $message $color
}

function Write-RawSnapshot($kind, $session) {
    Write-Log $rawLogPath $kind "source=$($session.Source) | status=$($session.Status) | title=$($session.Title) | artist=$($session.Artist) | album=$($session.Album) | albumArtist=$($session.AlbumArtist) | $(Format-MediaTiming $session)"
}

function Get-RunningSpotifyPath {
    $processes = @(Get-Process -Name "Spotify" -ErrorAction SilentlyContinue)

    foreach ($process in $processes) {
        try {
            $path = $process.MainModule.FileName
            if (-not [string]::IsNullOrWhiteSpace($path) -and (Test-Path -LiteralPath $path)) {
                return $path
            }
        }
        catch {
            # Windows can deny MainModule access for some process types; keep using fallbacks.
        }
    }

    return $null
}

function Save-SpotifyPath($path) {
    if ([string]::IsNullOrWhiteSpace($path) -or -not (Test-Path -LiteralPath $path)) {
        return
    }

    Set-Content -LiteralPath $savedSpotifyPathFile -Value $path -Encoding UTF8
    $global:SpotifyExePath = $path
}

function Get-SavedSpotifyPath {
    if ($global:SpotifyExePath -and (Test-Path -LiteralPath $global:SpotifyExePath)) {
        return $global:SpotifyExePath
    }

    if (Test-Path -LiteralPath $savedSpotifyPathFile) {
        $path = (Get-Content -LiteralPath $savedSpotifyPathFile -Raw).Trim()
        if (-not [string]::IsNullOrWhiteSpace($path) -and (Test-Path -LiteralPath $path)) {
            $global:SpotifyExePath = $path
            return $path
        }
    }

    return $null
}

function Find-CommonSpotifyPath {
    $candidates = @(
        (Join-Path $env:APPDATA "Spotify\Spotify.exe"),
        (Join-Path $env:LOCALAPPDATA "Microsoft\WindowsApps\Spotify.exe")
    )

    foreach ($candidate in $candidates) {
        if (Test-Path -LiteralPath $candidate) {
            return $candidate
        }
    }

    return $null
}

function Find-WindowsAppsSpotifyPath {
    $windowsApps = Join-Path $env:ProgramFiles "WindowsApps"
    if (-not (Test-Path -LiteralPath $windowsApps)) {
        return $null
    }

    try {
        $spotifyExe = Get-ChildItem -LiteralPath $windowsApps -Directory -Filter "SpotifyAB.SpotifyMusic_*" -ErrorAction Stop |
            Sort-Object LastWriteTimeUtc -Descending |
            ForEach-Object {
                $candidate = Join-Path $_.FullName "Spotify.exe"
                if (Test-Path -LiteralPath $candidate) {
                    $candidate
                }
            } |
            Select-Object -First 1

        return $spotifyExe
    }
    catch {
        return $null
    }
}

function Resolve-SpotifyPath {
    $runningPath = Get-RunningSpotifyPath
    if ($runningPath) {
        Save-SpotifyPath $runningPath
        return $runningPath
    }

    $savedPath = Get-SavedSpotifyPath
    if ($savedPath) {
        return $savedPath
    }

    $commonPath = Find-CommonSpotifyPath
    if ($commonPath) {
        Save-SpotifyPath $commonPath
        return $commonPath
    }

    $windowsAppsPath = Find-WindowsAppsSpotifyPath
    if ($windowsAppsPath) {
        Save-SpotifyPath $windowsAppsPath
        return $windowsAppsPath
    }

    return $null
}

function Stop-SpotifyProcesses {
    $processes = @(Get-Process -Name "Spotify" -ErrorAction SilentlyContinue)

    foreach ($process in $processes) {
        try {
            Stop-Process -Id $process.Id -Force -ErrorAction Stop
            Write-Log $eventLogPath "restart_exit" "Stopped Spotify process $($process.Id)"
        }
        catch {
            Write-Log $eventLogPath "error" "Could not stop Spotify process $($process.Id): $($_.Exception.Message)"
        }
    }
}

function Wait-SpotifyClosed {
    while (@(Get-Process -Name "Spotify" -ErrorAction SilentlyContinue).Count -gt 0) {
        Start-Sleep -Milliseconds 250
    }
}

function Start-SpotifyResolved($launchPath) {
    if (-not [string]::IsNullOrWhiteSpace($launchPath) -and (Test-Path -LiteralPath $launchPath)) {
        try {
            Start-Process -FilePath $launchPath | Out-Null
            Write-Log $eventLogPath "restart_exit" "Started Spotify from $launchPath"
            return
        }
        catch {
            Write-Log $eventLogPath "error" "Spotify path launch failed: $($_.Exception.Message)"
        }
    }

    try {
        Start-Process -FilePath "spotify:" | Out-Null
        Write-Log $eventLogPath "restart_exit" "Started Spotify with URI fallback"
    }
    catch {
        Write-Log $eventLogPath "error" "Spotify URI fallback failed: $($_.Exception.Message)"
    }
}

function Get-MediaKind($source, $title, $artist, $durationSeconds, $trackNumber) {
    $isSpotify = $source -like "*Spotify*"
    $blankTitle = [string]::IsNullOrWhiteSpace($title)
    $emDash = [char]0x2014
    $placeholderTitle = $title -eq "-" -or $title -eq $emDash -or $title -eq "Advertisement"
    $blankArtist = [string]::IsNullOrWhiteSpace($artist)
    $adTrackNumbers = @($settings.adDetection.adTrackNumbers | ForEach-Object { [int]$_ })
    $normalSongTrackNumber = [int]$settings.adDetection.normalSongTrackNumber
    $maxShortAdSeconds = [int]$settings.adDetection.maxShortAdSeconds
    $spotifyAdTrackNumber = ($adTrackNumbers -contains [int]$trackNumber) -and $durationSeconds -gt 0 -and $durationSeconds -le $maxShortAdSeconds
    $spotifySuspiciousShortTrack = [bool]$settings.adDetection.treatShortNonSongTrackAsAd -and $trackNumber -ne $normalSongTrackNumber -and $durationSeconds -gt 0 -and $durationSeconds -le $maxShortAdSeconds

    if ($isSpotify -and $spotifyAdTrackNumber) {
        return "spotify_ad_or_placeholder"
    }

    if ($isSpotify -and $spotifySuspiciousShortTrack) {
        return "spotify_ad_or_placeholder"
    }

    if ([bool]$settings.adDetection.treatBlankShortMediaAsAd -and $isSpotify -and ($blankTitle -or $placeholderTitle) -and $blankArtist -and $durationSeconds -gt 0 -and $durationSeconds -le $maxShortAdSeconds) {
        return "spotify_ad_or_placeholder"
    }

    if ($isSpotify -and -not $blankTitle -and -not $blankArtist) {
        return "spotify_song"
    }

    if ($isSpotify) {
        return "spotify_unknown"
    }

    if (-not $blankTitle -or -not $blankArtist) {
        return "media"
    }

    return "unknown"
}

function Get-MediaSessions {
    $manager = Await-WinRtOperation ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) $managerType
    $sessions = @($manager.GetSessions())
    $items = @()

    foreach ($session in $sessions) {
        $props = Await-WinRtOperation ($session.TryGetMediaPropertiesAsync()) $mediaPropsType
        $playback = $session.GetPlaybackInfo()
        $timeline = $session.GetTimelineProperties()

        $source = Normalize-Text $session.SourceAppUserModelId
        $status = Normalize-Text $playback.PlaybackStatus
        $title = Normalize-Text $props.Title
        $artist = Normalize-Text $props.Artist
        $album = Normalize-Text $props.AlbumTitle
        $albumArtist = Normalize-Text $props.AlbumArtist
        $duration = [Math]::Max(0, ($timeline.EndTime - $timeline.StartTime).TotalSeconds)
        $position = [Math]::Max(0, ($timeline.Position - $timeline.StartTime).TotalSeconds)
        $kind = Get-MediaKind $source $title $artist $duration $props.TrackNumber

        $items += [pscustomobject]@{
            Session = $session
            Source = $source
            Status = $status
            Title = $title
            Artist = $artist
            Album = $album
            AlbumArtist = $albumArtist
            TrackNumber = $props.TrackNumber
            Duration = $duration
            Position = $position
            Kind = $kind
        }
    }

    return $items
}

function Restart-SpotifyAndResume {
    Write-Log $eventLogPath "restart_spotify" "Ad/placeholder detected; restarting Spotify"
    $launchPath = Resolve-SpotifyPath
    if ([string]::IsNullOrWhiteSpace($launchPath)) {
        Write-Log $eventLogPath "restart_missing" "Spotify.exe was not found; using URI fallback"
    }
    else {
        Write-Log $eventLogPath "restart_exit" "Resolved Spotify path: $launchPath"
    }

    Stop-SpotifyProcesses
    Wait-SpotifyClosed
    Start-SpotifyResolved $launchPath

    $deadline = (Get-Date).AddSeconds($restartTimeoutSeconds)
    Write-Log $eventLogPath "waiting_for_spotify_media" "Waiting for Spotify song metadata after restart"
    while ((Get-Date) -lt $deadline) {
        Start-Sleep -Milliseconds $PollMilliseconds
        $spotifySong = @(Get-MediaSessions | Where-Object { $_.Kind -eq "spotify_song" } | Select-Object -First 1)

        if ($spotifySong.Count -gt 0) {
            $item = $spotifySong[0]
            Write-Log $eventLogPath "spotify_media_detected" (Format-MediaEvent $item)
            Write-RawSnapshot "media_after_restart" $item

            try {
                $played = Await-WinRtOperation ($item.Session.TryPlayAsync()) $boolType
                Write-Log $eventLogPath "play_command" "Sent play command; accepted=$played"
            }
            catch {
                Write-Log $eventLogPath "play_command_error" $_.Exception.Message
            }

            return
        }
    }

    Write-Log $eventLogPath "restart_timeout" "Spotify restarted, but no song metadata appeared within 60 seconds"
}

Write-Banner

Write-Log $eventLogPath "logger_start" "Windows media session logger started"
Write-Log $rawLogPath "raw_start" "Windows media session raw capture started; meaningful snapshots only"

$sampleCount = 0
$lastRestartAt = [datetime]::MinValue
$lastNoSession = $false
$lastSpotifyTrackKey = ""
$lastSpotifyStatus = ""
$lastSpotifyAdKey = ""
$lastOtherMediaKey = ""

while ($true) {
    $sampleCount++

    if (-not [string]::IsNullOrWhiteSpace($StopFile) -and (Test-Path -LiteralPath $StopFile)) {
        Write-Log $eventLogPath "logger_stop" "Stop file detected; shutting down guard"
        break
    }

    try {
        $sessions = @(Get-MediaSessions)

        if ($sessions.Count -eq 0) {
            if (-not $lastNoSession) {
                Write-Log $eventLogPath "not_playing" "No Windows media sessions"
                Write-Log $rawLogPath "no_sessions" "sessions=0"
            }
            $lastNoSession = $true
            $lastSpotifyStatus = ""
        }

        foreach ($session in $sessions) {
            $lastNoSession = $false

            if ($session.Kind -eq "spotify_song") {
                $trackKey = "$($session.Source)|$($session.Title)|$($session.Artist)|$($session.Album)|$([Math]::Round($session.Duration, 0))"
                if ($trackKey -ne $lastSpotifyTrackKey) {
                    Write-Log $eventLogPath "song" (Format-MediaEvent $session)
                    Write-RawSnapshot "song_change" $session
                    $lastSpotifyTrackKey = $trackKey
                    $lastSpotifyAdKey = ""
                }

                if ($lastSpotifyStatus -ne "" -and $session.Status -ne $lastSpotifyStatus) {
                    if ($session.Status -eq "Playing") {
                        Write-Log $eventLogPath "resume" (Format-MediaEvent $session)
                    }
                    elseif ($session.Status -eq "Paused") {
                        Write-Log $eventLogPath "pause" (Format-MediaEvent $session)
                    }
                    else {
                        Write-Log $eventLogPath "playback_status" "$($session.Status) | $(Format-MediaEvent $session)"
                    }
                    Write-RawSnapshot "status_change" $session
                }

                $lastSpotifyStatus = $session.Status
            }
            elseif ($session.Kind -eq "spotify_ad_or_placeholder") {
                $adKey = "$($session.Source)|$($session.Title)|$([Math]::Round($session.Duration, 0))"
                if ($adKey -ne $lastSpotifyAdKey) {
                    Write-Log $eventLogPath "ad_or_placeholder" "Spotify exposed ad-like media | $(Format-MediaEvent $session)"
                    Write-RawSnapshot "ad_or_placeholder" $session
                    $lastSpotifyAdKey = $adKey
                    $lastSpotifyTrackKey = ""
                    $lastSpotifyStatus = $session.Status
                }

                if (-not $autoRestartEnabled) {
                    continue
                }

                $secondsSinceRestart = ((Get-Date) - $lastRestartAt).TotalSeconds
                if ($secondsSinceRestart -ge $restartCooldownSeconds) {
                    $lastRestartAt = Get-Date
                    Restart-SpotifyAndResume
                }
            }
            else {
                $otherKey = "$($session.Source)|$($session.Status)|$($session.Kind)|$($session.Title)|$($session.Artist)|$([Math]::Round($session.Duration, 0))"
                if ($otherKey -ne $lastOtherMediaKey) {
                    Write-Log $eventLogPath $session.Kind "source=$($session.Source) status=$($session.Status) | $(Format-MediaEvent $session)"
                    Write-RawSnapshot "other_change" $session
                    $lastOtherMediaKey = $otherKey
                }
            }
        }
    }
    catch {
        Write-Log $rawLogPath "error" $_.Exception.Message
    }

    if ($Samples -gt 0 -and $sampleCount -ge $Samples) {
        break
    }

    Start-Sleep -Milliseconds $PollMilliseconds
}
