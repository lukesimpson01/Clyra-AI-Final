const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("computerBar", {
  pause: () => ipcRenderer.invoke("computer-bar:pause"),
  resume: () => ipcRenderer.invoke("computer-bar:resume"),
  humanDone: () => ipcRenderer.invoke("computer-bar:human-done"),
  stop: () => ipcRenderer.invoke("computer-bar:stop"),
  send: (text) => ipcRenderer.invoke("computer-bar:send", String(text || "")),
  onState: (listener) => {
    const handler = (_event, state) => listener(state);
    ipcRenderer.on("computer-bar:state", handler);
    return () => ipcRenderer.removeListener("computer-bar:state", handler);
  },
  ready: () => ipcRenderer.send("computer-bar:ready"),
  size: (height) => ipcRenderer.send("computer-bar:size", Math.round(Number(height) || 0)),
});
