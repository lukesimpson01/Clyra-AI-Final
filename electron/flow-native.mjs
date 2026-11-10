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
    // One growing buffer rather than a list of pieces: reading the audio so far (for live words) no longer
    // re-joins the whole recording every time.
    this.store = Buffer.allocUnsafe(16_000 * 2 * 20);
    this.bytes = 0;
    this.onLevel = null;
    this.onPcm = null;   // (chunk: Buffer) => void, called after the chunk is stored, only while recording
    this.onFull = null;  // the recording hit its length limit
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
      if (!mine(event) || !(this.capturing || this.warming)) return;
      if (this.bytes >= this.maxBytes) { if (this.capturing && !this.full) { this.full = true; this.onFull?.(); } return; }
      const chunk = Buffer.from(buffer);
      this.append(chunk);
      // Pre-warmed but not recording yet: keep only the last ~1.2 s as a pre-roll for the first words.
      if (!this.capturing) {
        const keep = 16_000 * 2 * 1.2;
        if (this.bytes > keep * 2) { this.store.copyWithin(0, this.bytes - keep, this.bytes); this.bytes = keep; }
        return;
      }
      if (this.live) this.onPcm?.(chunk);
    };
    ipcMain.on("flow:ready", this.onReady);
    ipcMain.on("flow:live", this.onLive);
    ipcMain.on("flow:failed", this.onFailed);
    ipcMain.on("flow:stopped", this.onStopped);
    ipcMain.on("flow:level", this.onLevelMsg);
    ipcMain.on("flow:chunk", this.onChunk);
    this.capturing = false;
    this.warming = false;
    this.live = false;
    this.full = false;
  }

  append(chunk) {
    if (this.bytes + chunk.length > this.store.length) {
      const grown = Buffer.allocUnsafe(Math.max(this.store.length * 2, this.bytes + chunk.length));
      this.store.copy(grown, 0, 0, this.bytes);
      this.store = grown;
    }
    chunk.copy(this.store, this.bytes);
    this.bytes += chunk.length;
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
    this.bytes = 0;
    this.warming = true;
    this.window.webContents.send("flow:warm");
  }

  /** The key press turned out not to be a dictation tap: discard the pre-roll and release the mic. */
  cool() {
    if (!this.warming || this.capturing) return;
    this.warming = false;
    this.bytes = 0;
    try { this.window?.webContents.send("flow:cool"); } catch { /* window closing */ }
  }

  /** Begin recording. Resolves when the microphone is genuinely live. */
  async start() {
    await Promise.race([this.ensureWindow(), new Promise((_resolve, reject) => setTimeout(() => reject(new Error("The microphone host did not start.")), 6_000))]);
    // A pre-warmed recording already holds the audio since key-down; keep it as the pre-roll.
    if (!this.warming) this.bytes = 0;
    this.warming = false;
    this.capturing = true;
    this.live = false;
    this.full = false;
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
    // From here on every chunk is also handed to onPcm; the caller first reads the pre-roll with slice(0).
    this.live = true;
  }

  /** Stop recording and return everything captured as one PCM16 buffer. */
  async stop() {
    if (!this.window || this.window.isDestroyed()) { this.capturing = false; this.live = false; return Buffer.from(this.store.subarray(0, this.bytes)); }
    const stopped = new Promise((resolve) => { this.stopWaiter = { resolve }; });
    this.window.webContents.send("flow:stop");
    await Promise.race([stopped, new Promise((resolve) => setTimeout(resolve, 1_200))]);
    this.stopWaiter = null;
    this.capturing = false;
    this.live = false;
    // A copy: the store is reused by the next recording while this one is still being transcribed.
    const pcm = Buffer.from(this.store.subarray(0, this.bytes - (this.bytes % 2)));
    this.bytes = 0;
    return pcm;
  }

  /** Audio captured so far from byte offset `start` (and optionally up to `end`) without stopping. */
  slice(start = 0, end = Infinity) {
    const from = Math.max(0, Math.min(this.bytes, start - (start % 2)));
    const to = Math.max(from, Math.min(this.bytes, end));
    // Copied, because the bytes are written to a file asynchronously while recording continues.
    return Buffer.from(this.store.subarray(from, to - ((to - from) % 2)));
  }

  cancel() {
    this.capturing = false;
    this.warming = false;
    this.live = false;
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
