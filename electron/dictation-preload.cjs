const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("clyraDictationPill", {
  onState(callback) {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("dictation:pill-state", listener);
    return () => ipcRenderer.removeListener("dictation:pill-state", listener);
  },
  // Loudness straight from the main process, ~30 times a second, separate from state changes.
  onLevel(callback) {
    const listener = (_event, level) => callback(level);
    ipcRenderer.on("dictation:pill-level", listener);
    return () => ipcRenderer.removeListener("dictation:pill-level", listener);
  },
  action(action) {
    ipcRenderer.send("dictation:pill-action", action);
  },
  // The pill window is click-through except while the pointer is over its capsule.
  move(dx, dy) {
    ipcRenderer.send("dictation:pill-move", { dx, dy });
  },
  setInteractive(interactive) {
    ipcRenderer.send("dictation:pill-interactive", Boolean(interactive));
  },
});
