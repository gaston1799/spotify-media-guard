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
  "treatShortNonSongTrackAsAd",
  "treatBlankShortMediaAsAd"
];

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
  renderPreview();
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

for (const id of [...fields, ...adFields, "adTrackNumbers"]) {
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
  } catch (error) {
    setStatus(error.message, "error");
  }
});
