const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("musicLevel", {
  level: (rms, bands) => ipcRenderer.send("music:level", Number(rms) || 0, Array.isArray(bands) ? bands.slice(0, 8).map(Number) : []),
  live: () => ipcRenderer.send("music:live"),
  failed: (message) => ipcRenderer.send("music:failed", String(message || "")),
  onStart: (callback) => ipcRenderer.on("music:start", () => callback()),
  onStop: (callback) => ipcRenderer.on("music:stop", () => callback()),
});
