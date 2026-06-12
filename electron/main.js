const { app, BrowserWindow, ipcMain, shell } = require("electron");
const path = require("path");
const fs = require("fs");

const appRoot = path.resolve(__dirname, "..");
const settingsDir = path.join(app.getPath("appData"), "SpotifyPlayLogger");
const settingsPath = path.join(settingsDir, "settings.json");
const eventLogPath = path.join(settingsDir, "windows_media_play_log.txt");
const stopFilePath = path.join(settingsDir, "stop.guard");
const launcherPath = path.join(settingsDir, "launch-guard.vbs");
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
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), "utf8");
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

function quoteVbs(value) {
  return String(value).replace(/"/g, '""');
}

function ensureRuntimeLoggerScript() {
  fs.mkdirSync(settingsDir, { recursive: true });
  const source = fs.readFileSync(loggerScriptPath, "utf8").replace(/^\uFEFF/, "");
  fs.writeFileSync(runtimeLoggerScriptPath, source, "utf8");
  return runtimeLoggerScriptPath;
}

function writeGuardLauncher({ monitorOnly = false } = {}) {
  fs.mkdirSync(settingsDir, { recursive: true });
  const powerShellPath = resolvePowerShellPath();
  const scriptPath = ensureRuntimeLoggerScript();
  const psArgs = [
    "-Sta",
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    `"${scriptPath}"`,
    "-StopFile",
    `"${stopFilePath}"`
  ];

  if (monitorOnly) {
    psArgs.push("-DisableRestart");
  }

  const command = `"${powerShellPath}" ${psArgs.join(" ")}`;
  const vbs = [
    'Set WshShell = CreateObject("WScript.Shell")',
    `WshShell.Run "${quoteVbs(command)}", 0, False`
  ].join("\r\n");

  fs.writeFileSync(launcherPath, vbs, "utf8");
  return powerShellPath;
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

  try {
    if (fs.existsSync(stopFilePath)) fs.unlinkSync(stopFilePath);
    const powerShellPath = writeGuardLauncher({ monitorOnly });
    const result = await shell.openPath(launcherPath);
    if (result) {
      sendLog("guard_error", `ShellExecute failed: ${result}`);
      return { running: false, pid: null };
    }
    guardRunning = true;
    startLogTail();
    sendLog("guard_start", `PowerShell guard launched with ShellExecute using ${powerShellPath}`);
    return { running: true, pid: null };
  } catch (error) {
    sendLog("guard_error", `Could not launch guard: ${error.message}`);
    return { running: false, pid: null };
  }
}

function stopGuard() {
  fs.mkdirSync(settingsDir, { recursive: true });
  fs.writeFileSync(stopFilePath, new Date().toISOString(), "utf8");
  guardRunning = false;
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
    backgroundColor: "#050807",
    title: "Spotify Media Guard",
    icon: path.join(appRoot, "assets", "app-icon.svg"),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.setMenu(null);
  mainWindow.loadFile(path.join(appRoot, "ui", "index.html"));

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

ipcMain.handle("settings:read", () => readSettings());
ipcMain.handle("settings:write", (_event, settings) => writeSettings(settings));
ipcMain.handle("settings:reset", () => {
  fs.copyFileSync(defaultSettingsPath, settingsPath);
  return readSettings();
});
ipcMain.handle("guard:start", (_event, options) => startGuard(options));
ipcMain.handle("guard:stop", () => stopGuard());
ipcMain.handle("guard:status", () => ({ running: guardRunning, pid: null }));
ipcMain.handle("path:openLogs", () => {
  fs.mkdirSync(settingsDir, { recursive: true });
  shell.openPath(settingsDir);
});

app.whenReady().then(() => {
  createWindow();
  startGuard({ monitorOnly: process.argv.includes("--monitor-only") });
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

app.on("before-quit", () => {
  stopGuard();
});
