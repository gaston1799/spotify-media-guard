# Spotify Media Guard

Windows-only Electron app that watches Spotify through Windows media controls and can restart Spotify when ad-like media metadata appears.

It does not use the Spotify Web API, does not need a Spotify login, and does not host a localhost settings page.

## Features

- Update & Restart downloads the verified Windows release, prepares it, stops the guard, replaces the installation, and relaunches. Settings/logs remain in AppData; a backup folder is retained beside the app for recovery. Use a dedicated Spotify Media Guard folder with write access.

- Named update banner opens Settings with latest release notes and download controls.
- Version History starts at v0.7.0, fetches changelog.json once per app session, and uses a local cache or bundled copy offline.

Release history is maintained in `changelog.json`. Add the version, release date, title, and categorized changes when publishing. GitHub Releases remains the authority for update availability.

- Checks GitHub for stable releases at startup and from Settings. An available-update badge opens Settings; Download Update remains available alongside Update & Restart.

- Dashboard with a separate Settings page; Escape returns to the dashboard and preserves unsaved edits.
- Local color palette with live preview, validated JSON import from a file or pasted text, and JSON export.
- System tray menu, a custom title bar, and one app instance per Windows user session. Opening the shortcut restores the existing window.

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

For another computer, this is the recommended installation path. Do not clone the source or install Node.js unless you intend to develop the app.

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
- Node.js 22.12 or newer when building from source. Node.js is not needed for the release ZIP.

Install dependencies:

```powershell
npm ci
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

## Publishing Update Metadata

After publishing a stable release and its Windows ZIP, run
`powershell -NoProfile -File scripts/publish-update-manifest.ps1`, then commit
and push `update-manifest.json`. This retrieves the published ZIP's size and
SHA-256 digest; never point the manifest at an unpublished asset. Update checks
and installation use this raw repository file if the GitHub API is unavailable.
Run `node scripts/test-updates.cjs` to test API rate-limit fallback behavior.

Windows may block unsigned downloaded apps the first time they run. If that happens, right-click the exe, open Properties, choose Unblock if available, then run it again.
