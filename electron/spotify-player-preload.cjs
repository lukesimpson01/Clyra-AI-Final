const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("clyraPlayer", {
  token: () => ipcRenderer.invoke("spotify-player:token"),
  status: (payload) => ipcRenderer.send("spotify-player:status", payload),
});
