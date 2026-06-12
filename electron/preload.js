const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("mediaGuard", {
  readSettings: () => ipcRenderer.invoke("settings:read"),
  writeSettings: (settings) => ipcRenderer.invoke("settings:write", settings),
  resetSettings: () => ipcRenderer.invoke("settings:reset"),
  startGuard: (options) => ipcRenderer.invoke("guard:start", options),
  stopGuard: () => ipcRenderer.invoke("guard:stop"),
  guardStatus: () => ipcRenderer.invoke("guard:status"),
  openLogs: () => ipcRenderer.invoke("path:openLogs"),
  onGuardLog: (handler) => {
    const listener = (_event, entry) => handler(entry);
    ipcRenderer.on("guard-log", listener);
    return () => ipcRenderer.removeListener("guard-log", listener);
  }
});
