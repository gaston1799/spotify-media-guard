const { app, BrowserWindow, ipcMain, shell, Tray, Menu } = require("electron");
const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");
const { validateSettings } = require("./settings.cjs");
const { createUpdateChecker, releaseUrl } = require("./updates.cjs");
const { createHistoryLoader } = require("./history.cjs");
const checkUpdates = createUpdateChecker(app.getVersion());

const appRoot = path.resolve(__dirname, "..");
const settingsDir = path.join(app.getPath("appData"), "SpotifyPlayLogger");
const loadHistory = createHistoryLoader(appRoot, settingsDir, app.getVersion());
const settingsPath = path.join(settingsDir, "settings.json");
const eventLogPath = path.join(settingsDir, "windows_media_play_log.txt");
const cpuStatsPath = path.join(settingsDir, "spotify_cpu_stats.json");
const stopFilePath = path.join(settingsDir, `stop.${process.pid}.guard`);
const pidFilePath = path.join(settingsDir, `worker.${process.pid}.pid`);
const runtimeLoggerScriptPath = path.join(settingsDir, "WindowsMediaLogger.ps1");
const defaultSettingsPath = path.join(appRoot, "settings.default.json");
const loggerScriptPath = path.join(appRoot, "WindowsMediaLogger.ps1");
const windowsDir = process.env.WINDIR || process.env.SystemRoot || "C:\\Windows";
const powerShellCandidates = [
  path.join(windowsDir, "Sysnative", "WindowsPowerShell", "v1.0", "powershell.exe"),
  path.join(windowsDir, "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
  path.join(windowsDir, "SysWOW64", "WindowsPowerShell", "v1.0", "powershell.exe"),
  path.join(process.env.LOCALAPPDATA || "", "Microsoft", "WindowsApps", "pwsh.exe"),
  "powershell.exe",
  "pwsh.exe"
];

let mainWindow = null;
let guardRunning = false;
let logTailTimer = null;
let logTailOffset = 0;
let tray = null;
let guardStartedAt = 0;
let workerCheckTimer = null;
let worker = null;

function lifecycleLog(kind, message) {
  fs.mkdirSync(settingsDir, { recursive: true });
  fs.appendFileSync(eventLogPath, `${new Date().toISOString()} | ${kind} | appPid=${process.pid} | ${message}\n`);
}

function workerAlive() {
  if (worker && worker.exitCode === null && !worker.killed) return true;
  try {
    const pid = Number(fs.readFileSync(pidFilePath, "utf8").replace(/^\uFEFF/, "").trim());
    if (!Number.isInteger(pid) || pid <= 0) return false;
    process.kill(pid, 0);
    return true;
  } catch { return false; }
}

function refreshWorkerState() {
  if (guardRunning && Date.now() - guardStartedAt > 10000 && !workerAlive()) {
    guardRunning = false;
    lifecycleLog("guard_exit", "Worker exited; guard is off");
    updateGuardState();
  }
}

// Use the stable app identity across portable folders and shortcut launches.
app.setAppUserModelId("SpotifyMediaGuard");
const ownsInstance = app.requestSingleInstanceLock();
if (!ownsInstance) app.quit();

function showWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
  refreshWorkerState();
  lifecycleLog("window_show", "Existing window restored");
}

function updateGuardState() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("guard-state", { running: guardRunning });
  }
  if (!tray) return;
  tray.setToolTip(`Spotify Media Guard - Guard ${guardRunning ? "On" : "Off"}`);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "Show Spotify Media Guard", click: showWindow },
    { label: "Guard enabled", type: "checkbox", checked: guardRunning,
      click: () => guardRunning ? stopGuard() : startGuard() },
    { type: "separator" },
    { label: "Quit", click: () => app.quit() }
  ]));
}

app.on("second-instance", showWindow);

function readJsonFile(filePath) {
  const text = fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "");
  return JSON.parse(text);
}

function mergeDefaults(defaults, value) {
  if (Array.isArray(defaults)) {
    return Array.isArray(value) ? value : defaults;
  }

  if (defaults && typeof defaults === "object") {
    const merged = {};
    const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
    for (const [key, defaultValue] of Object.entries(defaults)) {
      merged[key] = mergeDefaults(defaultValue, source[key]);
    }
    return merged;
  }

  return value === undefined || value === null || value === "" ? defaults : value;
}

function ensureSettings() {
  fs.mkdirSync(settingsDir, { recursive: true });
  if (!fs.existsSync(settingsPath)) {
    fs.copyFileSync(defaultSettingsPath, settingsPath);
  }
}

function readSettings() {
  ensureSettings();
  const defaults = readJsonFile(defaultSettingsPath);
  let saved = {};

  try {
    saved = readJsonFile(settingsPath);
  } catch (error) {
    const backupPath = `${settingsPath}.invalid-${Date.now()}.json`;
    try {
      fs.copyFileSync(settingsPath, backupPath);
    } catch {
      // Best effort only; falling back to defaults is the important part.
    }
    saved = {};
  }

  const merged = mergeDefaults(defaults, saved);
  fs.writeFileSync(settingsPath, JSON.stringify(merged, null, 2), "utf8");
  return merged;
}

function writeSettings(settings) {
  ensureSettings();
  const validated = validateSettings(settings, readJsonFile(defaultSettingsPath));
  fs.writeFileSync(settingsPath, JSON.stringify(validated, null, 2), "utf8");
  return readSettings();
}

function sendLog(kind, message) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send("guard-log", {
    time: new Date().toLocaleTimeString(),
    kind,
    message
  });
}

function resolvePowerShellPath() {
  for (const candidate of powerShellCandidates) {
    if (!candidate) continue;
    if (candidate.includes("\\") || candidate.includes("/")) {
      if (fs.existsSync(candidate)) return candidate;
      continue;
    }
    return candidate;
  }
  return path.join(windowsDir, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
}

function ensureRuntimeLoggerScript() {
  fs.mkdirSync(settingsDir, { recursive: true });
  const source = fs.readFileSync(loggerScriptPath, "utf8").replace(/^\uFEFF/, "");
  fs.writeFileSync(runtimeLoggerScriptPath, source, "utf8");
  return runtimeLoggerScriptPath;
}

function prepareGuardLaunch({ monitorOnly = false } = {}) {
  fs.mkdirSync(settingsDir, { recursive: true });
  const powerShellPath = resolvePowerShellPath();
  const scriptPath = ensureRuntimeLoggerScript();
  const psArgs = [
    "-Sta",
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    scriptPath,
    "-StopFile",
    stopFilePath
  ];
  psArgs.push("-PidFile", pidFilePath);

  if (monitorOnly) {
    psArgs.push("-DisableRestart");
  }

  return { powerShellPath, psArgs };
}

function startLogTail() {
  if (logTailTimer) return;
  fs.mkdirSync(settingsDir, { recursive: true });
  if (fs.existsSync(eventLogPath)) {
    logTailOffset = fs.statSync(eventLogPath).size;
  }

  logTailTimer = setInterval(() => {
    try {
      if (!fs.existsSync(eventLogPath)) return;
      const size = fs.statSync(eventLogPath).size;
      if (size < logTailOffset) logTailOffset = 0;
      if (size === logTailOffset) return;

      const fd = fs.openSync(eventLogPath, "r");
      const buffer = Buffer.alloc(size - logTailOffset);
      fs.readSync(fd, buffer, 0, buffer.length, logTailOffset);
      fs.closeSync(fd);
      logTailOffset = size;

      for (const line of buffer.toString("utf8").split(/\r?\n/).filter(Boolean)) {
        sendLog("guard_log", line);
      }
    } catch (error) {
      sendLog("guard_error", `Log tail failed: ${error.message}`);
    }
  }, 750);
}

function stopLogTail() {
  if (!logTailTimer) return;
  clearInterval(logTailTimer);
  logTailTimer = null;
}

async function startGuard({ monitorOnly = false } = {}) {
  if (guardRunning) {
    return { running: true, pid: null };
  }

  guardRunning = true;
  guardStartedAt = Date.now();
  try {
    if (workerAlive()) {
      const deadline = Date.now() + 15000;
      while (workerAlive() && Date.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, 200));
      }
      if (workerAlive()) throw new Error("Previous guard is still stopping. Try again shortly.");
    }
    if (fs.existsSync(pidFilePath)) fs.unlinkSync(pidFilePath);
    if (fs.existsSync(stopFilePath)) fs.unlinkSync(stopFilePath);
    const { powerShellPath, psArgs } = prepareGuardLaunch({ monitorOnly });
    const child = spawn(powerShellPath, psArgs, {
      cwd: settingsDir, windowsHide: true, stdio: ["ignore", "ignore", "pipe"],
      env: { ...process.env, APPDATA: app.getPath("appData") }
    });
    child.stderr.on("data", chunk => lifecycleLog("guard_error", chunk.toString("utf8").slice(0, 4000).trim()));
    worker = child;
    child.on("exit", (code, signal) => {
      if (worker !== child) return;
      worker = null;
      guardRunning = false;
      lifecycleLog("guard_exit", `Worker exited; code=${code} signal=${signal || "none"}`);
      updateGuardState();
    });
    await new Promise((resolve, reject) => {
      child.once("spawn", resolve);
      child.once("error", reject);
    });
    guardRunning = true;
    lifecycleLog("guard_launch", "Worker requested");
    updateGuardState();
    startLogTail();
    sendLog("guard_start", `PowerShell guard started using ${powerShellPath}; pid=${child.pid}`);
    return { running: true, pid: null };
  } catch (error) {
    worker = null;
    guardRunning = false;
    updateGuardState();
    sendLog("guard_error", `Could not launch guard: ${error.message}`);
    return { running: false, pid: null };
  }
}

function stopGuard(reason = "User disabled guard") {
  fs.mkdirSync(settingsDir, { recursive: true });
  fs.writeFileSync(stopFilePath, new Date().toISOString(), "utf8");
  guardRunning = false;
  lifecycleLog("guard_stop_request", reason);
  updateGuardState();
  sendLog("guard_stop", "Stop requested through guard stop file");
  setTimeout(stopLogTail, 1500);
  return { running: false, pid: null };
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 760,
    minWidth: 780,
    minHeight: 560,
    frame: false,
    backgroundColor: "#050807",
    title: "Spotify Media Guard",
    icon: path.join(appRoot, "assets", "app-icon.ico"),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.setMenu(null);
  mainWindow.loadFile(path.join(appRoot, "ui", "index.html"));
  mainWindow.on("maximize", () => mainWindow.webContents.send("window-state", { maximized: true }));
  mainWindow.on("unmaximize", () => mainWindow.webContents.send("window-state", { maximized: false }));

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

ipcMain.handle("settings:read", () => readSettings());
ipcMain.handle("settings:write", (_event, settings) => writeSettings(settings));
ipcMain.handle("settings:validate", (_event, settings) => validateSettings(settings, readJsonFile(defaultSettingsPath)));
ipcMain.handle("updates:check", () => checkUpdates());
ipcMain.handle("updates:history", () => loadHistory());
ipcMain.handle("updates:release", (_event, version) => {
  if (typeof version !== "string" || !/^\d+\.\d+\.\d+$/.test(version)) throw new Error("Invalid release version");
  return shell.openExternal("https://github.com/gaston1799/spotify-media-guard/releases/tag/v" + version);
});
ipcMain.handle("updates:open", () => shell.openExternal(releaseUrl));
ipcMain.handle("settings:reset", () => {
  fs.copyFileSync(defaultSettingsPath, settingsPath);
  return readSettings();
});
ipcMain.handle("guard:start", (_event, options) => startGuard(options));
ipcMain.handle("guard:stop", () => stopGuard());
ipcMain.handle("guard:status", () => {
  refreshWorkerState();
  return { running: guardRunning, pid: null };
});
ipcMain.handle("window:tray", () => {
  lifecycleLog("window_tray", "Window hidden; worker left running");
  mainWindow?.hide();
});
ipcMain.handle("window:minimize", () => mainWindow?.minimize());
ipcMain.handle("window:maximize", () => {
  if (mainWindow?.isMaximized()) mainWindow.unmaximize();
  else mainWindow?.maximize();
  return { maximized: mainWindow?.isMaximized() ?? false };
});
ipcMain.handle("window:close", () => app.quit());
ipcMain.handle("cpu:stats", () => {
  try {
    return fs.existsSync(cpuStatsPath) ? readJsonFile(cpuStatsPath) : null;
  } catch {
    return null;
  }
});
ipcMain.handle("path:openLogs", () => {
  fs.mkdirSync(settingsDir, { recursive: true });
  shell.openPath(settingsDir);
});

app.whenReady().then(() => {
  if (!ownsInstance) return;
  tray = new Tray(path.join(appRoot, "assets", "app-icon.ico"));
  tray.on("click", showWindow);
  updateGuardState();
  createWindow();
  startGuard({ monitorOnly: process.argv.includes("--monitor-only") });
  workerCheckTimer = setInterval(refreshWorkerState, 2000);
});

app.on("activate", () => {
  if (!ownsInstance) return;
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
  showWindow();
});

app.on("before-quit", () => {
  if (ownsInstance) stopGuard("App quit");
  if (workerCheckTimer) clearInterval(workerCheckTimer);
  tray?.destroy();
});
