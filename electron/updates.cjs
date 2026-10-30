const releaseUrl = "https://github.com/gaston1799/spotify-media-guard/releases/latest";
const apiUrl = "https://api.github.com/repos/gaston1799/spotify-media-guard/releases/latest";
const manifestUrl = "https://raw.githubusercontent.com/gaston1799/spotify-media-guard/main/update-manifest.json";

async function fetchLatestRelease(installedVersion, request = fetch) {
  try {
    const response = await request(apiUrl, {
      headers: { Accept: "application/vnd.github+json", "User-Agent": "Spotify-Media-Guard/" + installedVersion },
      signal: AbortSignal.timeout(10000)
    });
    if (!response.ok) throw new Error("GitHub returned HTTP " + response.status);
    return await response.json();
  } catch {
    const response = await request(manifestUrl, { signal: AbortSignal.timeout(10000), cache: "no-store" });
    if (!response.ok) throw new Error("Update sources unavailable. Use Download Update or try again later.");
    const release = await response.json();
    versionParts(release.tag_name);
    if (release.draft !== false || release.prerelease !== false || !Array.isArray(release.assets)) {
      throw new Error("Invalid update manifest.");
    }
    return release;
  }
}

function versionParts(version) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) throw new Error("Unsupported release version: " + version);
  return match.slice(1).map(Number);
}

function isNewer(latest, installed) {
  const next = versionParts(latest);
  const current = versionParts(installed);
  for (let i = 0; i < 3; i++) {
    if (next[i] !== current[i]) return next[i] > current[i];
  }
  return false;
}

function createUpdateChecker(installedVersion, fetchRelease = fetch) {
  let pending = null;
  let cached = null;
  let checkedAt = 0;
  return async function check() {
    if (pending) return pending;
    if (cached && Date.now() - checkedAt < 60000) return cached;
    pending = (async () => {
      try {
        const release = await fetchLatestRelease(installedVersion, fetchRelease);
        if (release.draft || release.prerelease) throw new Error("No stable release available.");
        const available = isNewer(release.tag_name, installedVersion);
        cached = { installedVersion, latestVersion: release.tag_name.replace(/^v/, ""), title: typeof release.name === "string" ? release.name.slice(0, 200) : release.tag_name, notes: typeof release.body === "string" ? release.body.slice(0, 20000) : "", available, releaseUrl, checkedAt: new Date().toISOString() };
        checkedAt = Date.now();
        return cached;
      } catch (error) {
        return { installedVersion, available: false, error: error.name === "TimeoutError" ? "Update check timed out." : error.message };
      }
    })();
    try { return await pending; } finally { pending = null; }
  };
}

module.exports = { createUpdateChecker, fetchLatestRelease, isNewer, releaseUrl };
