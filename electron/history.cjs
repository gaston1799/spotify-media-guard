const fs = require("fs");
const path = require("path");
const { isNewer } = require("./updates.cjs");
const historyUrl = "https://raw.githubusercontent.com/gaston1799/spotify-media-guard/main/changelog.json";

function validateHistory(data) {
  if (data?.schemaVersion !== 1 || !Array.isArray(data.releases) || data.releases.length > 200) throw new Error("Invalid changelog format");
  const seen = new Set();
  const releases = data.releases.map(entry => {
    if (!/^\d+\.\d+\.\d+$/.test(entry.version) || seen.has(entry.version)) throw new Error("Invalid or duplicate version");
    seen.add(entry.version);
    if (typeof entry.title !== "string" || entry.title.length > 200 ||
        !/^\d{4}-\d{2}-\d{2}$/.test(entry.date) || !Number.isFinite(Date.parse(entry.date)) ||
        !entry.changes || typeof entry.changes !== "object" || Array.isArray(entry.changes)) throw new Error("Invalid changelog entry");
    const changes = Object.fromEntries(Object.entries(entry.changes).map(([category, items]) => {
      if (category.length > 60 || !Array.isArray(items) || items.length > 50 ||
          items.some(item => typeof item !== "string" || item.length > 2000)) throw new Error("Invalid changes");
      return [category, items];
    }));
    return { version: entry.version, title: entry.title, date: entry.date, changes };
  });
  releases.sort((a, b) => isNewer(a.version, b.version) ? -1 : isNewer(b.version, a.version) ? 1 : 0);
  return { schemaVersion: 1, releases };
}

function createHistoryLoader(appRoot, settingsDir, installedVersion, fetchHistory = fetch) {
  const cachePath = path.join(settingsDir, "changelog-cache.json");
  let pending;
  return async () => {
    if (pending) return pending;
    pending = (async () => {
      // Merge with the bundle so an older cached or remote file cannot erase shipped notes.
      const bundled = validateHistory(JSON.parse(fs.readFileSync(path.join(appRoot, "changelog.json"), "utf8")));
      let data = bundled;
      let source = "bundled";
      try {
        data = validateHistory(JSON.parse(fs.readFileSync(cachePath, "utf8")));
        source = "cached";
      } catch {}
      try {
        const response = await fetchHistory(historyUrl, { signal: AbortSignal.timeout(8000) });
        if (!response.ok) throw new Error("History fetch failed");
        const text = await response.text();
        if (text.length > 500000) throw new Error("History too large");
        data = validateHistory(JSON.parse(text));
        source = "online";
        try {
          fs.mkdirSync(settingsDir, { recursive: true });
          fs.writeFileSync(cachePath, JSON.stringify(data), "utf8");
        } catch {}
      } catch {}
      const entries = new Map(bundled.releases.map(entry => [entry.version, entry]));
      for (const entry of data.releases) entries.set(entry.version, entry);
      return { ...validateHistory({ schemaVersion: 1, releases: [...entries.values()] }), source, installedVersion };
    })();
    return pending;
  };
}
module.exports = { createHistoryLoader, validateHistory };
