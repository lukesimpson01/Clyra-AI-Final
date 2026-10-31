import { BrowserWindow, ipcMain, session } from "electron";

/**
 * Hidden microphone host for Clyra Flow. It is a 1x1, never-shown window with
 * its own session, so recording works with no Clyra window and no local
 * service: the global hotkey -> this window records -> the main-process
 * FlowEngine transcribes. Created at launch so capture starts instantly.
 */
export class FlowNative {
  constructor({ preloadPath, capturePath, log = console }) {
    this.preloadPath = preloadPath;
    this.capturePath = capturePath;
    this.log = log;
    this.window = null;
    this.windowReady = null;
    this.chunks = [];
    this.bytes = 0;
    this.onLevel = null;
    this.liveWaiter = null;
    this.stopWaiter = null;
    this.maxBytes = 16_000 * 2 * 60 * 5; // five minutes of 16 kHz mono PCM16

    const mine = (event) => Boolean(this.window && !this.window.isDestroyed() && event.sender.id === this.window.webContents.id);
    this.onReady = (event) => { if (mine(event)) this.readyResolve?.(); };
    this.onLive = (event) => { if (mine(event)) this.liveWaiter?.resolve(); };
    this.onFailed = (event, message) => { if (mine(event)) this.liveWaiter?.reject(new Error(message || "Microphone unavailable.")); };
    this.onStopped = (event) => { if (mine(event)) this.stopWaiter?.resolve(); };
    this.onLevelMsg = (event, value) => { if (mine(event)) this.onLevel?.(Number(value) || 0); };
    this.onChunk = (event, buffer) => {
      if (!mine(event) || !(this.capturing || this.warming) || this.bytes > this.maxBytes) return;
      const chunk = Buffer.from(buffer);
      this.chunks.push(chunk);
      this.bytes += chunk.length;
      // Pre-warmed but not recording yet: keep only the last ~1.2 s as a pre-roll for the first words.
      if (!this.capturing) {
        const keep = 16_000 * 2 * 1.2;
        while (this.chunks.length > 1 && this.bytes - this.chunks[0].length >= keep) this.bytes -= this.chunks.shift().length;
      }
    };
    ipcMain.on("flow:ready", this.onReady);
    ipcMain.on("flow:live", this.onLive);
    ipcMain.on("flow:failed", this.onFailed);
    ipcMain.on("flow:stopped", this.onStopped);
    ipcMain.on("flow:level", this.onLevelMsg);
    ipcMain.on("flow:chunk", this.onChunk);
    this.capturing = false;
    this.warming = false;
  }

  /** Create the hidden window (idempotent). Resolves once its page is ready. */
  ensureWindow() {
    if (this.window && !this.window.isDestroyed()) return this.windowReady;
    const ses = session.fromPartition("flow-capture");
    // This session only ever hosts our own capture page, so it may use the mic.
    ses.setPermissionRequestHandler((_contents, permission, callback) => callback(permission === "media"));
    ses.setPermissionCheckHandler((_contents, permission) => permission === "media");
    this.window = new BrowserWindow({
      show: false,
      width: 1,
      height: 1,
      frame: false,
      skipTaskbar: true,
      focusable: false,
      webPreferences: {
        session: ses,
        preload: this.preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: false,
        autoplayPolicy: "no-user-gesture-required",
      },
    });
    this.window.on("closed", () => { this.window = null; this.windowReady = null; });
    this.windowReady = new Promise((resolve) => { this.readyResolve = resolve; });
    this.window.loadFile(this.capturePath).catch((error) => this.log.warn("[flow] capture page failed:", error?.message || error));
    return this.windowReady;
  }

  /** Hotkey key-down: open the mic early and keep a short rolling pre-roll (see start()). */
  warm() {
    if (this.capturing || this.warming || !this.window || this.window.isDestroyed()) return;
    this.chunks = [];
    this.bytes = 0;
    this.warming = true;
    this.window.webContents.send("flow:warm");
  }

  /** The key press turned out not to be a dictation tap: discard the pre-roll and release the mic. */
  cool() {
    if (!this.warming || this.capturing) return;
    this.warming = false;
    this.chunks = [];
    this.bytes = 0;
    try { this.window?.webContents.send("flow:cool"); } catch { /* window closing */ }
  }

  /** Begin recording. Resolves when the microphone is genuinely live. */
  async start() {
    await Promise.race([this.ensureWindow(), new Promise((_resolve, reject) => setTimeout(() => reject(new Error("The microphone host did not start.")), 6_000))]);
    // A pre-warmed recording already holds the audio since key-down; keep it as the pre-roll.
    if (!this.warming) { this.chunks = []; this.bytes = 0; }
    this.warming = false;
    this.capturing = true;
    const live = new Promise((resolve, reject) => { this.liveWaiter = { resolve, reject }; });
    this.window.webContents.send("flow:start");
    try {
      await Promise.race([live, new Promise((_resolve, reject) => setTimeout(() => reject(new Error("The microphone did not start.")), 6_000))]);
    } catch (error) {
      this.capturing = false;
      throw error;
    } finally {
      this.liveWaiter = null;
    }
  }

  /** Stop recording and return everything captured as one PCM16 buffer. */
  async stop() {
    if (!this.window || this.window.isDestroyed()) { this.capturing = false; return Buffer.concat(this.chunks); }
    const stopped = new Promise((resolve) => { this.stopWaiter = { resolve }; });
    this.window.webContents.send("flow:stop");
    await Promise.race([stopped, new Promise((resolve) => setTimeout(resolve, 1_200))]);
    this.stopWaiter = null;
    this.capturing = false;
    const pcm = Buffer.concat(this.chunks);
    this.chunks = [];
    this.bytes = 0;
    return pcm;
  }

  /** Audio captured so far from byte offset `start` (and optionally up to `end`) without stopping. */
  slice(start = 0, end = Infinity) {
    const all = Buffer.concat(this.chunks);
    const from = Math.max(0, start - (start % 2));
    return all.subarray(from, Math.min(all.length, end));
  }

  /** The most recent audio so far (without stopping), for live partial transcripts. */
  snapshot(maxBytes = 16_000 * 2 * 14) {
    const all = Buffer.concat(this.chunks);
    return all.length > maxBytes ? all.subarray(all.length - maxBytes) : all;
  }

  cancel() {
    this.capturing = false;
    this.warming = false;
    this.chunks = [];
    this.bytes = 0;
    try { if (this.window && !this.window.isDestroyed()) this.window.webContents.send("flow:stop"); } catch { /* window closing */ }
  }

  destroy() {
    ipcMain.removeListener("flow:ready", this.onReady);
    ipcMain.removeListener("flow:live", this.onLive);
    ipcMain.removeListener("flow:failed", this.onFailed);
    ipcMain.removeListener("flow:stopped", this.onStopped);
    ipcMain.removeListener("flow:level", this.onLevelMsg);
    ipcMain.removeListener("flow:chunk", this.onChunk);
    try { this.window?.destroy(); } catch { /* already destroyed */ }
    this.window = null;
  }
}
