/**
 * While the voice call is sharing the screen: a soft blue rim breathes around the display and a small pill says
 * "Clyra can see your screen" with a Stop button. Neither window takes focus; the rim lets every click through.
 */
import { BrowserWindow, ipcMain, screen } from "electron";

export class ScreenShareIndicator {
  constructor({ rimHtml, pillHtml, pillPreload, onStop }) {
    this.rimHtml = rimHtml; this.pillHtml = pillHtml; this.pillPreload = pillPreload; this.onStop = onStop;
    this.rims = []; this.pill = null; this.on = false;
    ipcMain.on("screenshare:stop", (event) => { if (this.pill && !this.pill.isDestroyed() && event.sender === this.pill.webContents) this.onStop?.(); });
  }

  level(win) {
    if (process.platform === "darwin") win.setAlwaysOnTop(true, "status", 2); else win.setAlwaysOnTop(true, "screen-saver");
    try { win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true }); } catch { /* older Electron */ }
  }

  async show({ pill = true } = {}) {
    if (this.on) return;
    this.on = true;
    const primary = screen.getPrimaryDisplay();
    this.rims = screen.getAllDisplays().map((display) => {
      const win = new BrowserWindow({ x: display.bounds.x, y: display.bounds.y, width: display.bounds.width, height: display.bounds.height, frame: false, transparent: true, focusable: false, skipTaskbar: true, hasShadow: false, show: false, enableLargerThanScreen: true, webPreferences: { sandbox: true, contextIsolation: true } });
      win.setIgnoreMouseEvents(true); this.level(win);
      void win.loadFile(this.rimHtml).then(() => { if (!win.isDestroyed() && this.on) { win.showInactive(); void win.webContents.executeJavaScript("window.__on(true)").catch(() => {}); } });
      return win;
    });
    if (!pill) return;
    const width = 300, height = 60;
    this.pill = new BrowserWindow({ x: Math.round(primary.bounds.x + (primary.bounds.width - width) / 2), y: primary.bounds.y + 34, width, height, frame: false, transparent: true, resizable: false, focusable: false, skipTaskbar: true, hasShadow: false, show: false, enableLargerThanScreen: true, ...(process.platform === "darwin" ? { type: "panel" } : {}), webPreferences: { preload: this.pillPreload, sandbox: false, contextIsolation: true } });
    this.pill.setAlwaysOnTop(true, process.platform === "darwin" ? "screen-saver" : "screen-saver", 3);
    try { this.pill.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true }); } catch { /* older Electron */ }
    void this.pill.loadFile(this.pillHtml).then(() => { if (!this.pill?.isDestroyed() && this.on) { this.pill.showInactive(); void this.pill.webContents.executeJavaScript("window.__on(true)").catch(() => {}); } });
  }

  async hide() {
    if (!this.on) return;
    this.on = false;
    const wins = [...this.rims, this.pill].filter((w) => w && !w.isDestroyed());
    await Promise.all(wins.map((w) => w.webContents.executeJavaScript("window.__on(false)").catch(() => {})));
    await new Promise((resolve) => setTimeout(resolve, 520));
    for (const w of wins) { try { if (!w.isDestroyed()) w.destroy(); } catch { /* gone */ } }
    this.rims = []; this.pill = null;
  }
}
