const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("mediaGuard", {
  readAgentGuide: () => ipcRenderer.invoke("guide:read"),
  openAgentGuide: () => ipcRenderer.invoke("guide:open"),
  readSettings: () => ipcRenderer.invoke("settings:read"),
  checkUpdates: () => ipcRenderer.invoke("updates:check"),
  installUpdate: () => ipcRenderer.invoke("updates:install"),
  updateResult: () => ipcRenderer.invoke("updates:result"),
  onUpdateProgress: (handler) => {
    const listener = (_event, message) => handler(message);
    ipcRenderer.on("update-progress", listener);
    return () => ipcRenderer.removeListener("update-progress", listener);
  },
  releaseHistory: () => ipcRenderer.invoke("updates:history"),
  openRelease: (version) => ipcRenderer.invoke("updates:release", version),
  openUpdate: () => ipcRenderer.invoke("updates:open"),
  writeSettings: (settings) => ipcRenderer.invoke("settings:write", settings),
  validateSettings: (settings) => ipcRenderer.invoke("settings:validate", settings),
  resetSettings: () => ipcRenderer.invoke("settings:reset"),
  startGuard: (options) => ipcRenderer.invoke("guard:start", options),
  stopGuard: () => ipcRenderer.invoke("guard:stop"),
  guardStatus: () => ipcRenderer.invoke("guard:status"),
  cpuStats: () => ipcRenderer.invoke("cpu:stats"),
  openLogs: () => ipcRenderer.invoke("path:openLogs"),
  moveToTray: () => ipcRenderer.invoke("window:tray"),
  minimize: () => ipcRenderer.invoke("window:minimize"),
  maximize: () => ipcRenderer.invoke("window:maximize"),
  close: () => ipcRenderer.invoke("window:close"),
  onGuardState: (handler) => {
    const listener = (_event, state) => handler(state);
    ipcRenderer.on("guard-state", listener);
    return () => ipcRenderer.removeListener("guard-state", listener);
  },
  onWindowState: (handler) => {
    const listener = (_event, state) => handler(state);
    ipcRenderer.on("window-state", listener);
    return () => ipcRenderer.removeListener("window-state", listener);
  },
  onGuardLog: (handler) => {
    const listener = (_event, entry) => handler(entry);
    ipcRenderer.on("guard-log", listener);
    return () => ipcRenderer.removeListener("guard-log", listener);
  }
});
