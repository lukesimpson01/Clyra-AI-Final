import { BrowserWindow, desktopCapturer, ipcMain, session } from "electron";

/**
 * The loudness of whatever the Mac is playing, for the Notch's wave. A hidden window listens to the system's audio loopback
 * (only while music plays, and only to measure it: nothing is recorded or kept) and reports the level ~40 times a second.
 * It lives in Clyra because Clyra already holds the screen-recording permission, so the Notch never has to ask for its own.
 */
export class MusicLevel {
  constructor({ preloadPath, pagePath, onLevel, onState, log = console }) {
    this.preloadPath = preloadPath;
    this.pagePath = pagePath;
    this.onLevel = onLevel;
    this.onState = onState;
    this.log = log;
    this.window = null;
    this.wanted = false;
    const mine = (event) => Boolean(this.window && !this.window.isDestroyed() && event.sender.id === this.window.webContents.id);
    ipcMain.on("music:level", (event, rms) => { if (mine(event)) this.onLevel?.(Number(rms) || 0); });
    ipcMain.on("music:live", (event) => { if (mine(event)) this.onState?.({ live: true }); });
    ipcMain.on("music:failed", (event, message) => {
      if (!mine(event)) return;
      this.log.warn("[music] loudness unavailable:", message);
      this.onState?.({ live: false, error: message });
    });
  }

  ensureWindow() {
    if (this.window && !this.window.isDestroyed()) return this.window;
    const ses = session.fromPartition("music-level");
    ses.setPermissionRequestHandler((_contents, permission, callback) => callback(permission === "media" || permission === "display-capture"));
    ses.setPermissionCheckHandler((_contents, permission) => permission === "media" || permission === "display-capture");
    ses.setDisplayMediaRequestHandler(async (_request, callback) => {
      try {
        const sources = await desktopCapturer.getSources({ types: ["screen"], thumbnailSize: { width: 0, height: 0 } });
        if (!sources[0]) { callback({}); return; }
        callback({ video: sources[0], audio: "loopback" });
      } catch (error) {
        this.log.warn("[music] could not open system audio:", error?.message || error);
        callback({});
      }
    }, { useSystemPicker: false });
    this.window = new BrowserWindow({
      show: false, width: 1, height: 1, frame: false, skipTaskbar: true, focusable: false,
      webPreferences: { session: ses, preload: this.preloadPath, contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false },
    });
    this.window.on("closed", () => { this.window = null; });
    this.window.loadFile(this.pagePath).catch((error) => this.log.warn("[music] page failed:", error?.message || error));
    return this.window;
  }

  /** Music started or stopped playing in the Notch. */
  set(on) {
    if (on === this.wanted) return;
    this.wanted = on;
    if (on) {
      const win = this.ensureWindow();
      const send = () => win.webContents.send("music:start");
      if (win.webContents.isLoading()) win.webContents.once("did-finish-load", send); else send();
    } else if (this.window && !this.window.isDestroyed()) {
      this.window.webContents.send("music:stop");
    }
  }

  destroy() {
    try { this.window?.destroy(); } catch { /* gone */ }
    this.window = null;
  }
}
