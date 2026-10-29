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
let guardEnabled = false;
let savedSnapshot = "";
const paletteNames = { bg: "Background", panel: "Surface", text: "Text", muted: "Secondary text", green: "Accent", cyan: "Highlight", border: "Borders" };

function showSettings(open) {
  $("settingsPage").hidden = !open;
  $("dashboardPage").hidden = open;
  $("settingsBtn").hidden = open;
  window.scrollTo(0, 0);
  (open ? $("backBtn") : $("settingsBtn")).focus();
}

function applyTheme(theme) {
  for (const key of Object.keys(paletteNames)) {
    if (/^#[0-9a-f]{6}$/i.test(theme[key])) document.documentElement.style.setProperty("--" + key, theme[key]);
  }
}

async function importSettings(text) {
  try {
    if (text.length > 100000) throw new Error("Settings JSON is too large.");
    const value = JSON.parse(text.replace(/^\uFEFF/, ""));
    const validated = await window.mediaGuard.validateSettings(value);
    writeForm(validated);
    $("importStatus").textContent = "Imported into preview. Save Settings to keep these changes.";
    $("importStatus").style.color = "var(--green)";
  } catch (error) {
    $("importStatus").textContent = "Import rejected: " + error.message;
    $("importStatus").style.color = "var(--danger)";
  }
}

function renderGuardState(state) {
  guardEnabled = Boolean(state.running);
  $("guardToggleBtn").setAttribute("aria-checked", String(guardEnabled));
  $("guardToggleLabel").textContent = guardEnabled ? "Guard on" : "Guard off";
}

function renderWindowState(state) {
  const button = $("maximizeBtn");
  button.title = state.maximized ? "Restore" : "Maximize";
  button.setAttribute("aria-label", button.title);
  button.innerHTML = state.maximized ? '<i data-lucide="copy"></i>' : '<i data-lucide="square"></i>';
  window.lucide.createIcons();
}

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
  settings.theme = Object.fromEntries(Object.keys(paletteNames).map(key => [key, $("color-" + key).value]));
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
  for (const key of Object.keys(paletteNames)) $("color-" + key).value = settings.theme[key];
  applyTheme(settings.theme);
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
  const draft = readForm();
  const snapshot = JSON.stringify(draft, null, 2);
  $("preview").textContent = snapshot;
  $("dirtyState").textContent = savedSnapshot && snapshot !== savedSnapshot ? "Unsaved changes" : "";
  applyTheme(draft.theme);
}

async function loadSettings() {
  setStatus("LOADING");
  const settings = await window.mediaGuard.readSettings();
  savedSnapshot = JSON.stringify(settings, null, 2);
  writeForm(settings);
  setStatus("READY");
}

async function saveSettings() {
  setStatus("SAVING", "warn");
  const settings = await window.mediaGuard.writeSettings(readForm());
  savedSnapshot = JSON.stringify(settings, null, 2);
  writeForm(settings);
  setStatus("SAVED");
}

async function resetSettings() {
  setStatus("RESETTING", "warn");
  const settings = await window.mediaGuard.resetSettings();
  savedSnapshot = JSON.stringify(settings, null, 2);
  writeForm(settings);
  setStatus("RESET");
}

for (const id of [...fields, ...adFields, ...cpuFields, "adTrackNumbers"]) {
  window.addEventListener("DOMContentLoaded", () => {
    $(id).addEventListener("input", renderPreview);
    $(id).addEventListener("change", renderPreview);
  });
}

window.addEventListener("DOMContentLoaded", async () => {
  for (const [key, name] of Object.entries(paletteNames)) {
    const label = document.createElement("label");
    const swatch = document.createElement("input");
    swatch.type = "color";
    swatch.id = "color-" + key;
    swatch.setAttribute("aria-label", name);
    swatch.addEventListener("input", renderPreview);
    label.append(swatch, document.createTextNode(name));
    $("palette").append(label);
  }
  $("settingsBtn").addEventListener("click", () => showSettings(true));
  $("backBtn").addEventListener("click", () => showSettings(false));
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && !$("settingsPage").hidden) showSettings(false);
  });
  $("exportBtn").addEventListener("click", () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(readForm(), null, 2)], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "spotify-media-guard-settings.json";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  $("importFileBtn").addEventListener("click", () => $("importFile").click());
  $("importFile").addEventListener("change", async event => {
    const file = event.target.files[0];
    if (file) {
      if (file.size > 100000) { $("importStatus").textContent = "Import rejected: file is too large."; return; }
      await importSettings(await file.text());
      event.target.value = "";
    }
  });
  $("importPasteBtn").addEventListener("click", () => importSettings($("importText").value));
  $("saveBtn").addEventListener("click", () => saveSettings().catch((error) => setStatus(error.message, "error")));
  $("resetBtn").addEventListener("click", () => resetSettings().catch((error) => setStatus(error.message, "error")));
  $("reloadBtn").addEventListener("click", () => loadSettings().catch((error) => setStatus(error.message, "error")));
  window.lucide.createIcons();
  window.mediaGuard.onGuardState(renderGuardState);
  window.mediaGuard.onWindowState(renderWindowState);
  $("trayBtn").addEventListener("click", () => window.mediaGuard.moveToTray());
  $("minimizeBtn").addEventListener("click", () => window.mediaGuard.minimize());
  $("maximizeBtn").addEventListener("click", async () => renderWindowState(await window.mediaGuard.maximize()));
  $("closeBtn").addEventListener("click", () => window.mediaGuard.close());
  $("guardToggleBtn").addEventListener("click", async () => {
    $("guardToggleBtn").disabled = true;
    try {
      renderGuardState(guardEnabled ? await window.mediaGuard.stopGuard() : await window.mediaGuard.startGuard({ monitorOnly: false }));
      setStatus(guardEnabled ? "GUARD ON" : "GUARD OFF", guardEnabled ? "ready" : "warn");
    } catch (error) {
      setStatus(error.message, "error");
    } finally {
      $("guardToggleBtn").disabled = false;
    }
  });
  $("openLogsBtn").addEventListener("click", () => window.mediaGuard.openLogs());
  window.mediaGuard.onGuardLog(appendLog);

  try {
    await loadSettings();
    const status = await window.mediaGuard.guardStatus();
    renderGuardState(status);
    setStatus(status.running ? "GUARD ON" : "READY");
    renderCpuStats(await window.mediaGuard.cpuStats());
    window.setInterval(async () => renderCpuStats(await window.mediaGuard.cpuStats()), 1000);
  } catch (error) {
    setStatus(error.message, "error");
  }
});
