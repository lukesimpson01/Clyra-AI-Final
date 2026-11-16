const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("shareIndicator", { stop: () => ipcRenderer.send("screenshare:stop") });
