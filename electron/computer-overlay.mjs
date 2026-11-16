/**
 * Full-screen blue glow, input shield and floating control bar for computer use.
 *
 * - The glow fades in when the AI is driving and fades out on pause, human-needed, stop and finish.
 * - While the AI drives, each overlay swallows physical mouse clicks. The run controller wraps every injected action in
 *   `inject()`, which lets events through for those few milliseconds so the AI's own clicks reach the app. A real click
 *   landing inside that window would pass through too; keyboard input is not intercepted at all.
 * - The bar is a non-activating panel, so typing a message in it never steals keyboard focus from the app being driven.
 */
import { BrowserWindow, ipcMain, screen } from "electron";

const FADE_IN_MS = 380;
const FADE_OUT_MS = 320;
const BAR_WIDTH = 468; // 420 dock + 24 each side so its soft shadow is never clipped into a visible rectangle
const BAR_HEIGHT = 120; // replaced by the real content height as soon as the bar reports it

export class ComputerOverlay {
  constructor({ overlayHtml, barHtml, barPreload }) {
    this.overlayHtml = overlayHtml;
    this.barHtml = barHtml;
    this.barPreload = barPreload;
    this.overlays = [];
    this.bar = null;
    this.glowOn = false;
    this.blocking = false;
    this.run = null;
    this.registered = false;
    this.barHeight = BAR_HEIGHT;
  }

  registerIpc(controllerFor) {
    if (this.registered) return;
    this.registered = true;
    const guard = (event) => Boolean(this.bar && !this.bar.isDestroyed() && event.sender === this.bar.webContents);
    ipcMain.handle("computer-bar:pause", (event) => guard(event) ? controllerFor().pause() : { ok: false });
    ipcMain.handle("computer-bar:resume", (event) => guard(event) ? controllerFor().resume() : { ok: false });
    ipcMain.handle("computer-bar:human-done", (event) => guard(event) ? controllerFor().resume({ fromHuman: true }) : { ok: false });
    ipcMain.handle("computer-bar:stop", (event) => guard(event) ? controllerFor().stop() : { ok: false });
    ipcMain.handle("computer-bar:send", (event, text) => guard(event) ? controllerFor().sendMessage(text) : { ok: false });
    ipcMain.on("computer-bar:ready", (event) => { if (guard(event)) this.pushState(); });
    ipcMain.on("computer-bar:size", (event, height) => {
      if (!guard(event)) return;
      this.barHeight = Math.max(90, Math.min(560, Number(height) || BAR_HEIGHT));
      this.placeBar(this.barHeight);
    });
  }

  makeOverlay(display) {
    const win = new BrowserWindow({
      x: display.bounds.x, y: display.bounds.y, width: display.bounds.width, height: display.bounds.height,
      frame: false, transparent: true, resizable: false, movable: false, focusable: false, skipTaskbar: true,
      hasShadow: false, show: false, alwaysOnTop: true, enableLargerThanScreen: true,
      webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true },
    });
    if (process.platform === "darwin") win.setAlwaysOnTop(true, "status", 1);
    else win.setAlwaysOnTop(true, "screen-saver");
    try { win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true }); } catch { /* older Electron */ }
    win.setIgnoreMouseEvents(true);
    void win.loadFile(this.overlayHtml);
    return win;
  }

  makeBar() {
    const win = new BrowserWindow({
      width: BAR_WIDTH, height: BAR_HEIGHT, frame: false, transparent: true, resizable: false, movable: false,
      skipTaskbar: true, hasShadow: false, show: false, alwaysOnTop: true, fullscreenable: false,
      // Without this macOS keeps the window fully above the Dock, which is what held the bar awkwardly high.
      enableLargerThanScreen: true,
      ...(process.platform === "darwin" ? { type: "panel" } : {}),
      webPreferences: { preload: this.barPreload, nodeIntegration: false, contextIsolation: true, sandbox: false },
    });
    win.setAlwaysOnTop(true, "screen-saver", 2);
    try { win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true }); } catch { /* older Electron */ }
    void win.loadFile(this.barHtml);
    return win;
  }

  barBounds() { return this.bar && !this.bar.isDestroyed() && this.bar.isVisible() ? this.bar.getBounds() : null; }

  placeBar(height) {
    if (!this.bar || this.bar.isDestroyed()) return;
    const display = screen.getPrimaryDisplay();
    const { x, y, width, height: h } = display.workArea;
    this.bar.setBounds({ x: Math.round(x + (width - BAR_WIDTH) / 2), y: Math.round(y + h - height + 20), width: BAR_WIDTH, height }, false);
  }

  /** The control bar alone: up from the first moment, so a task can always be stopped, even while it is still being planned. */
  async showBar(controller) {
    this.run = controller;
    if (!this.bar || this.bar.isDestroyed()) this.bar = this.makeBar();
    if (this.bar.webContents.isLoading()) await new Promise((resolve) => this.bar.webContents.once("did-finish-load", resolve));
    this.placeBar(this.barHeight);
    this.bar.showInactive();
    this.pushState();
  }

  async show(controller) {
    this.run = controller;
    if (!this.overlays.length || this.overlays.some((win) => win.isDestroyed())) {
      this.overlays.forEach((win) => { try { win.destroy(); } catch { /* gone */ } });
      this.overlays = screen.getAllDisplays().map((display) => this.makeOverlay(display));
    }
    if (!this.bar || this.bar.isDestroyed()) this.bar = this.makeBar();
    await Promise.all([...this.overlays, this.bar].map((win) => win.webContents.isLoading()
      ? new Promise((resolve) => win.webContents.once("did-finish-load", resolve)) : null));
    this.placeBar(this.barHeight);
    for (const win of this.overlays) win.showInactive();
    this.bar.showInactive();
    await this.setGlow(true);
    this.pushState();
  }

  async hide() {
    await this.setGlow(false);
    this.pushState();
    await new Promise((resolve) => setTimeout(resolve, FADE_OUT_MS + 60));
    if (this.run?.active) return; // a new run started during the fade
    for (const win of [...this.overlays, this.bar]) { try { if (win && !win.isDestroyed()) win.hide(); } catch { /* gone */ } }
  }

  /** Smoothly shows or hides the glow. The shield follows the glow only while the AI is actually driving. */
  async setGlow(on) {
    this.glowOn = Boolean(on);
    this.blocking = this.glowOn;
    for (const win of this.overlays) {
      if (win.isDestroyed()) continue;
      win.setIgnoreMouseEvents(!this.blocking);
      win.webContents.executeJavaScript(`window.__glow(${this.glowOn})`, true).catch(() => {});
    }
    this.pushState();
    await new Promise((resolve) => setTimeout(resolve, this.glowOn ? 120 : 80));
  }

  /** Lets the AI's own input reach apps: the shield opens for the action and closes straight after. */
  async inject(work) {
    const wasBlocking = this.blocking;
    this.onInject?.();
    const bar = this.bar && !this.bar.isDestroyed() ? this.bar : null;
    // The AI's clicks go through the shield and through the control bar too: an app's key that sits under the bar must
    // not press the bar's own Stop button.
    if (wasBlocking) for (const win of this.overlays) if (!win.isDestroyed()) win.setIgnoreMouseEvents(true);
    bar?.setIgnoreMouseEvents(true);
    try { return await work(); } finally {
      // The click's release can still be in flight when the helper exits; re-blocking at once would hand it to the shield
      // (which belongs to Clyra) and pull Clyra to the front.
      await new Promise((resolve) => setTimeout(resolve, 120));
      if (wasBlocking && this.blocking) for (const win of this.overlays) if (!win.isDestroyed()) win.setIgnoreMouseEvents(false);
      if (bar && !bar.isDestroyed()) bar.setIgnoreMouseEvents(false);
    }
  }

  pushState() {
    if (!this.bar || this.bar.isDestroyed() || !this.run) return;
    const state = this.run.getState();
    try { if (!this.bar.webContents.isLoading()) this.bar.webContents.send("computer-bar:state", state); } catch { /* bar is closing */ }
  }

  destroy() {
    for (const win of [...this.overlays, this.bar]) { try { if (win && !win.isDestroyed()) win.destroy(); } catch { /* gone */ } }
    this.overlays = [];
    this.bar = null;
  }
}
