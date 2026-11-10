const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("clyraDictationPill", {
  onState(callback) {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("dictation:pill-state", listener);
    return () => ipcRenderer.removeListener("dictation:pill-state", listener);
  },
  // Loudness + auto-stop countdown, several times a second, kept apart from full state updates.
  onMeter(callback) {
    const listener = (_event, meter) => callback(meter);
    ipcRenderer.on("dictation:pill-meter", listener);
    return () => ipcRenderer.removeListener("dictation:pill-meter", listener);
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
