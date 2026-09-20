# Spotify Media Guard

Windows-only Electron app that watches Spotify through Windows media controls and can restart Spotify when ad-like media metadata appears.

It does not use the Spotify Web API, does not need a Spotify login, and does not host a localhost settings page.

## Features

- Electron desktop settings UI.
- Uses the Spotify Media Guard shield as the Windows EXE, shortcut, taskbar, and app-window icon.
- No Spotify API key, login, or Premium requirement.
- Detects Spotify song, pause, resume, and ad-like placeholder metadata.
- Logs media position, duration, track number, skip-control state, and detection kind.
- Monitors only Spotify processes for combined CPU usage, peak subprocess, spike count, and spike duration in the live dashboard.
- Can treat Spotify media with disabled Next as ad-like before the older metadata heuristics.
- Restarts Spotify when ad-like metadata is detected.
- Tries a normal Spotify window close before force-stopping processes. If it has to force-stop, it sends one Next command after reopening to avoid replaying the previous song.
- Reopens Spotify without activating its window. If Spotify still takes focus, restores the app that was focused before the restart, but only while Spotify remains the foreground app.
- Streams PowerShell guard logs into the Electron UI.
- Resolves Spotify dynamically from running processes, saved paths, common install paths, Microsoft Store paths, and the `spotify:` URI fallback.

## Run The Release Build

Download the release zip, extract it, and run:

```text
Spotify Media Guard.exe
```

The app is portable. It stores settings and logs in:

```text
%APPDATA%\SpotifyPlayLogger\
```

## Build From Source

Requirements:

- Windows 10 or newer.
- PowerShell 5.1 or newer.
- Node.js LTS.

Install dependencies:

```powershell
npm install
```

Run in development:

```powershell
npm start
```

Run with restart disabled:

```powershell
npm run start:monitor
```

Package a Windows app folder:

```powershell
npm run package:win
```

Create a release zip:

```powershell
npm run release:win
```

Install the packaged app to your Desktop:

```powershell
npm run install:desktop
```

One-shot setup:

```powershell
.\scripts\setup.ps1 -Package -InstallDesktop
```

## Settings And Logs

```text
%APPDATA%\SpotifyPlayLogger\settings.json
%APPDATA%\SpotifyPlayLogger\windows_media_play_log.txt
%APPDATA%\SpotifyPlayLogger\windows_media_raw_log.txt
%APPDATA%\SpotifyPlayLogger\spotify_cpu_stats.json
%APPDATA%\SpotifyPlayLogger\spotify_cpu_spikes.txt
```

CPU spike monitoring is enabled by default with a configurable 15% combined-CPU threshold. The stats file contains the current session snapshot; the spike log is append-only history.

Default detection settings live in:

```text
settings.default.json
```

## Notes

Windows may block unsigned downloaded apps the first time they run. If that happens, right-click the exe, open Properties, choose Unblock if available, then run it again.
