import { BrowserWindow, ipcMain } from "electron";

const READY_TIMEOUT_MS = 15_000;

/**
 * Hosts Spotify's official Web Playback SDK in a hidden window so Clyra is
 * itself a Spotify Connect device ("Clyra"). The token is requested from the
 * main process on demand and only ever sent to this dedicated window.
 * Playback needs Spotify Premium and a Widevine-capable Electron build; when
 * either is missing `ensure()` resolves null and callers fall back to another
 * device.
 */
export class SpotifyPlayerHost {
  constructor({ preloadPath, htmlPath, getToken }) {
    this.preloadPath = preloadPath;
    this.htmlPath = htmlPath;
    this.getToken = getToken;
    this.window = null;
    this.deviceId = "";
    this.lastError = "";
    this.waiters = [];
    this.registered = false;
  }

  register() {
    if (this.registered) return;
    this.registered = true;
    ipcMain.handle("spotify-player:token", (event) => {
      if (!this.window || event.sender !== this.window.webContents) throw new Error("Unauthorized");
      return this.getToken();
    });
    ipcMain.on("spotify-player:status", (event, payload) => {
      if (!this.window || event.sender !== this.window.webContents || !payload) return;
      if (payload.state === "ready" && typeof payload.deviceId === "string") {
        this.deviceId = payload.deviceId;
        this.lastError = "";
        this.flush(payload.deviceId);
      } else if (payload.state === "offline") {
        this.deviceId = "";
      } else if (payload.state === "error") {
        this.lastError = String(payload.message || payload.kind || "player error").slice(0, 200);
        if (["initialization_error", "authentication_error", "account_error", "sdk_load", "connect_failed"].includes(payload.kind)) this.flush(null);
      }
    });
  }

  flush(value) {
    const waiters = this.waiters;
    this.waiters = [];
    for (const resolve of waiters) resolve(value);
  }

  /** Start the hidden player if needed; resolves its Connect device id or null. */
  async ensure() {
    this.register();
    if (this.deviceId && this.window && !this.window.isDestroyed()) return this.deviceId;
    if (!this.window || this.window.isDestroyed()) {
      this.lastError = "";
      this.window = new BrowserWindow({
        show: false,
        width: 1,
        height: 1,
        webPreferences: {
          preload: this.preloadPath,
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
          backgroundThrottling: false,
          autoplayPolicy: "no-user-gesture-required",
          partition: "persist:clyra-spotify-player",
        },
      });
      this.window.on("closed", () => {
        this.window = null;
        this.deviceId = "";
        this.flush(null);
      });
      void this.window.loadFile(this.htmlPath).catch((error) => { this.lastError = error?.message || "load failed"; this.flush(null); });
    }
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.waiters = this.waiters.filter((fn) => fn !== done);
        resolve(null);
      }, READY_TIMEOUT_MS);
      const done = (value) => { clearTimeout(timer); resolve(value); };
      this.waiters.push(done);
    });
  }

  dispose() {
    if (this.window && !this.window.isDestroyed()) this.window.destroy();
    this.window = null;
    this.deviceId = "";
  }
}
