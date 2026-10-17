const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("flowCapture", {
  ready: () => ipcRenderer.send("flow:ready"),
  live: () => ipcRenderer.send("flow:live"),
  stopped: () => ipcRenderer.send("flow:stopped"),
  failed: (message) => ipcRenderer.send("flow:failed", String(message || "")),
  level: (value) => ipcRenderer.send("flow:level", Number(value) || 0),
  chunk: (buffer) => ipcRenderer.send("flow:chunk", buffer),
  onStart: (callback) => ipcRenderer.on("flow:start", () => callback()),
  onStop: (callback) => ipcRenderer.on("flow:stop", () => callback()),
});
