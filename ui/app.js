const fields = [
  "pollMilliseconds",
  "restartCooldownSeconds",
  "restartTimeoutSeconds",
  "autoRestart",
  "useColor"
];

const adFields = [
  "normalSongTrackNumber",
  "maxShortAdSeconds",
  "treatDisabledNextAsAd",
  "treatShortNonSongTrackAsAd",
  "treatBlankShortMediaAsAd"
];

const cpuFields = ["cpuMonitoringEnabled", "spikeThresholdPercent"];

const $ = (id) => document.getElementById(id);

let current = null;

function setStatus(text, tone = "ready") {
  const node = $("saveStatus");
  node.textContent = text;
  node.style.color = tone === "error" ? "var(--danger)" : tone === "warn" ? "var(--warn)" : "var(--cyan)";
}

function appendLog(entry) {
  const line = `${entry.time} [${String(entry.kind).toUpperCase()}] ${entry.message}`;
  const node = $("liveLog");
  node.textContent += `${line}\n`;
  node.scrollTop = node.scrollHeight;
}

function readForm() {
  const settings = structuredClone(current);
  for (const key of fields) {
    const input = $(key);
    settings[key] = input.type === "checkbox" ? input.checked : Number(input.value);
  }
  for (const key of adFields) {
    const input = $(key);
    settings.adDetection[key] = input.type === "checkbox" ? input.checked : Number(input.value);
  }
  settings.adDetection.adTrackNumbers = $("adTrackNumbers").value
    .split(",")
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isFinite(value));
  settings.cpuMonitoring.enabled = $("cpuMonitoringEnabled").checked;
  settings.cpuMonitoring.spikeThresholdPercent = Number($("spikeThresholdPercent").value);
  return settings;
}

function writeForm(settings) {
  current = settings;
  for (const key of fields) {
    const input = $(key);
    if (input.type === "checkbox") input.checked = Boolean(settings[key]);
    else input.value = settings[key];
  }
  for (const key of adFields) {
    const input = $(key);
    const value = settings.adDetection[key];
    if (input.type === "checkbox") input.checked = Boolean(value);
    else input.value = value;
  }
  $("adTrackNumbers").value = settings.adDetection.adTrackNumbers.join(", ");
  $("cpuMonitoringEnabled").checked = Boolean(settings.cpuMonitoring.enabled);
  $("spikeThresholdPercent").value = settings.cpuMonitoring.spikeThresholdPercent;
  renderPreview();
}

function formatPercent(value) {
  return Number.isFinite(value) ? `${value.toFixed(1)}%` : "--";
}

function formatDuration(value) {
  return Number.isFinite(value) ? `${value.toFixed(1)}s` : "--";
}

function renderCpuStats(stats) {
  if (!stats) return;
  $("cpuCurrent").textContent = formatPercent(stats.currentPercent);
  $("cpuHighest").textContent = formatPercent(stats.highestPercent);
  $("cpuActiveDuration").textContent = stats.spikeActive ? formatDuration(stats.activeDurationSeconds) : "idle";
  $("cpuLongest").textContent = formatDuration(stats.longestSpikeSeconds);
  $("cpuSpikeCount").textContent = String(stats.spikeCount ?? 0);
  $("cpuProcessCount").textContent = String(stats.processCount ?? 0);
  $("cpuCulprit").textContent = stats.peakProcess || "Waiting for samples";
}

function renderPreview() {
  $("preview").textContent = JSON.stringify(readForm(), null, 2);
}

async function loadSettings() {
  setStatus("LOADING");
  writeForm(await window.mediaGuard.readSettings());
  setStatus("READY");
}

async function saveSettings() {
  setStatus("SAVING", "warn");
  writeForm(await window.mediaGuard.writeSettings(readForm()));
  setStatus("SAVED");
}

async function resetSettings() {
  setStatus("RESETTING", "warn");
  writeForm(await window.mediaGuard.resetSettings());
  setStatus("RESET");
}

for (const id of [...fields, ...adFields, ...cpuFields, "adTrackNumbers"]) {
  window.addEventListener("DOMContentLoaded", () => {
    $(id).addEventListener("input", renderPreview);
    $(id).addEventListener("change", renderPreview);
  });
}

window.addEventListener("DOMContentLoaded", async () => {
  $("saveBtn").addEventListener("click", () => saveSettings().catch((error) => setStatus(error.message, "error")));
  $("resetBtn").addEventListener("click", () => resetSettings().catch((error) => setStatus(error.message, "error")));
  $("reloadBtn").addEventListener("click", () => loadSettings().catch((error) => setStatus(error.message, "error")));
  $("startGuardBtn").addEventListener("click", async () => {
    await window.mediaGuard.startGuard({ monitorOnly: false });
    setStatus("GUARD ON");
  });
  $("stopGuardBtn").addEventListener("click", async () => {
    await window.mediaGuard.stopGuard();
    setStatus("GUARD OFF", "warn");
  });
  $("openLogsBtn").addEventListener("click", () => window.mediaGuard.openLogs());
  window.mediaGuard.onGuardLog(appendLog);

  try {
    await loadSettings();
    const status = await window.mediaGuard.guardStatus();
    setStatus(status.running ? "GUARD ON" : "READY");
    renderCpuStats(await window.mediaGuard.cpuStats());
    window.setInterval(async () => renderCpuStats(await window.mediaGuard.cpuStats()), 1000);
  } catch (error) {
    setStatus(error.message, "error");
  }
});
