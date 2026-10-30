const assert = require("node:assert/strict");
const { createUpdateChecker, fetchLatestRelease } = require("../electron/updates.cjs");
const release = { tag_name: "v0.9.2", name: "Fallback test", draft: false, prerelease: false, assets: [] };

(async () => {
  for (const status of [403, 429, 500]) {
    const calls = [];
    const request = async url => {
      calls.push(url);
      return url.includes("api.github.com") ? { ok: false, status } : { ok: true, json: async () => release };
    };
    const check = createUpdateChecker("0.9.0", request);
    const result = await check();
    assert.equal(result.available, true);
    assert.equal(result.latestVersion, "0.9.2");
    assert.equal(await check(), result);
    assert.equal(calls.length, 2);
    assert.ok(calls[1].includes("raw.githubusercontent.com"));
  }
  assert.equal(await fetchLatestRelease("0.9.0", async () => ({ ok: true, json: async () => release })), release);
  await assert.rejects(fetchLatestRelease("0.9.0", async () => ({ ok: false, status: 403 })), /sources unavailable/);
  const failed = await createUpdateChecker("0.9.0", async () => { throw new Error("offline"); })();
  assert.equal(failed.available, false);
  assert.equal(failed.error, "offline");
  console.log("PASS: API success, 403/429/500 fallback, cache, and offline failures");
})().catch(error => { console.error(error); process.exitCode = 1; });
