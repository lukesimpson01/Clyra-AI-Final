const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("capturePicker", { choose: (id) => ipcRenderer.send("capture-picker:choose", id) });
