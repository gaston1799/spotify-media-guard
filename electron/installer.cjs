const fsp = require("fs/promises");
const path = require("path");
const crypto = require("crypto");
const { spawn } = require("child_process");
const { isNewer } = require("./updates.cjs");

async function launchExternalHelper(powerShell, helper, planPath, shell) {
  const quote = value => '"' + value.replace(/"/g, '""') + '"';
  const command = quote(powerShell) + " -NoProfile -ExecutionPolicy Bypass -File " + quote(helper) + " -PlanPath " + quote(planPath);
  const launcher = path.join(path.dirname(helper), "launch-update.vbs");
  await fsp.writeFile(launcher, 'Set s = CreateObject("WScript.Shell")\r\ns.Run "' + command.replace(/"/g, '""') + '", 0, False\r\n', "utf8");
  const error = await shell.openPath(launcher);
  if (error) throw new Error("Could not start updater: " + error);
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try { await fsp.access(path.join(path.dirname(helper), "helper-ready")); return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error("Update helper did not become ready. The app will stay open.");
}

function prepareFiles(powerShell, helper, planPath) {
  const child = spawn(powerShell, ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", helper,
    "-PlanPath", planPath, "-PrepareOnly"], {
    cwd: path.dirname(helper), windowsHide: true, stdio: ["ignore", "ignore", "pipe"]
  });
  return new Promise((resolve, reject) => {
    let error = "";
    child.stderr.on("data", chunk => { error = (error + chunk).slice(-4000); });
    child.once("error", reject);
    child.once("exit", code => code === 0 ? resolve() : reject(new Error(error || "Update preparation failed.")));
  });
}

async function prepareUpdate({ installedVersion, executable, appRoot, settingsDir, tempDir, powerShell, onProgress }) {
  const response = await fetch("https://api.github.com/repos/gaston1799/spotify-media-guard/releases/latest", {
    headers: { Accept: "application/vnd.github+json", "User-Agent": "Spotify-Media-Guard/" + installedVersion },
    signal: AbortSignal.timeout(15000)
  });
  if (!response.ok) throw new Error("Could not retrieve the release (HTTP " + response.status + ").");
  const release = await response.json();
  if (release.draft || release.prerelease || !isNewer(release.tag_name, installedVersion)) throw new Error("No newer stable update is available.");
  const asset = release.assets?.find(item => item.name === "Spotify.Media.Guard-v" + release.tag_name.replace(/^v/, "") + "-win32-x64.zip");
  if (!asset || !/^sha256:[0-9a-f]{64}$/i.test(asset.digest || "")) throw new Error("A verified Windows update package is not available. Use Download Update.");
  const url = new URL(asset.browser_download_url);
  if (url.origin !== "https://github.com" || !url.pathname.startsWith("/gaston1799/spotify-media-guard/releases/download/")) throw new Error("Unexpected update source.");
  if (!Number.isSafeInteger(asset.size) || asset.size < 1 || asset.size > 600 * 1024 * 1024) throw new Error("Update package has an invalid size.");
  const installDir = path.dirname(executable);
  if (path.basename(executable) !== "Spotify Media Guard.exe" ||
      !["Spotify Media Guard", "Spotify Media Guard-win32-x64"].includes(path.basename(installDir))) {
    throw new Error("Extract the app into its own Spotify Media Guard folder before updating, or use Download Update.");
  }
  const jobDir = await fsp.mkdtemp(path.join(tempDir, "spotify-guard-update-"));
  const zipPath = path.join(jobDir, "update.zip");
  onProgress("Downloading v" + release.tag_name.replace(/^v/, "") + "...");
  const download = await fetch(url, { signal: AbortSignal.timeout(180000) });
  if (!download.ok || !download.body) throw new Error("Update download failed.");
  const hash = crypto.createHash("sha256");
  let received = 0;
  let lastPercent = -1;
  const file = await fsp.open(zipPath, "wx");
  try {
    for await (const chunk of download.body) {
      received += chunk.length;
      if (received > asset.size) throw new Error("Update exceeded expected size.");
      hash.update(chunk);
      await file.writeFile(chunk);
      const percent = Math.floor(received / asset.size * 100);
      if (percent >= lastPercent + 5) { lastPercent = percent; onProgress("Downloading update: " + percent + "%"); }
    }
  } finally { await file.close(); }
  if (received !== asset.size || "sha256:" + hash.digest("hex") !== asset.digest.toLowerCase()) throw new Error("Update checksum verification failed.");
  const helper = path.join(jobDir, "apply-update.ps1");
  await fsp.copyFile(path.join(appRoot, "scripts", "apply-update.ps1"), helper);
  const planPath = path.join(jobDir, "plan.json");
  const plan = { installDir, executable, zipPath, jobDir, ownerPid: process.pid,
    version: release.tag_name, resultPath: path.join(settingsDir, "update-result.json") };
  await fsp.writeFile(planPath, JSON.stringify(plan), "utf8");
  onProgress("Verifying and preparing update...");
  await prepareFiles(powerShell, helper, planPath);
  return { helper, planPath, powerShell };
}

module.exports = { prepareUpdate, launchExternalHelper };
