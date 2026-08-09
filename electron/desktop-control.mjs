/**
 * OS-level desktop control for Clyra Screen Companion.
 * Linux: xdotool | macOS: cliclick / AppleScript | Windows: PowerShell
 * Draws Atlas-style AI cursor — also used in Guide mode to point without clicking.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { BrowserWindow, screen } from "electron";

const execFileAsync = promisify(execFile);
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function which(bin) {
  const cmd = process.platform === "win32" ? "where" : "which";
  try {
    const { stdout } = await execFileAsync(cmd, [bin], { timeout: 2_000, windowsHide: true });
    return (
      String(stdout || "")
        .split(/\r?\n/)
        .map((s) => s.trim())
        .find(Boolean) || null
    );
  } catch {
    return null;
  }
}

async function runPowerShell(script, timeout = 8_000) {
  await execFileAsync("powershell", ["-NoProfile", "-Command", script], {
    timeout,
    windowsHide: true,
  });
}

export class DesktopControlService {
  constructor() {
    this.cursorWindow = null;
    this.manualControl = false;
    this.active = false;
    this.guideOnly = false;
    this.xdotool = null;
    this.cliclick = null;
    this.driver = "none";
    this.lastPoint = { x: 0, y: 0 };
  }

  async initialize() {
    this.xdotool = await which("xdotool");
    this.cliclick = process.platform === "darwin" ? await which("cliclick") : null;
    if (this.xdotool) this.driver = "xdotool";
    else if (this.cliclick) this.driver = "cliclick";
    else if (process.platform === "darwin") this.driver = "applescript";
    else if (process.platform === "win32") this.driver = "powershell";
    else this.driver = "none";
    return { ok: this.driver !== "none", driver: this.driver, platform: process.platform };
  }

  async ensureCursorOverlay() {
    if (this.cursorWindow && !this.cursorWindow.isDestroyed()) return this.cursorWindow;
    const display = screen.getPrimaryDisplay();
    const { width, height } = display.bounds;
    this.cursorWindow = new BrowserWindow({
      width,
      height,
      x: display.bounds.x,
      y: display.bounds.y,
      frame: false,
      transparent: true,
      resizable: false,
      movable: false,
      focusable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      hasShadow: false,
      show: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
      },
    });
    this.cursorWindow.setIgnoreMouseEvents(true, { forward: true });
    this.cursorWindow.setAlwaysOnTop(true, "screen-saver");
    await this.cursorWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(CURSOR_HTML)}`);
    return this.cursorWindow;
  }

  async setCursor(cursor) {
    if (!cursor) {
      if (this.cursorWindow && !this.cursorWindow.isDestroyed()) this.cursorWindow.hide();
      return { ok: true };
    }
    const win = await this.ensureCursorOverlay();
    const point = {
      x: Math.round(Number(cursor.x) || 0),
      y: Math.round(Number(cursor.y) || 0),
      label: String(cursor.label || "Working"),
      kind: String(cursor.kind || "move"),
      guide: Boolean(cursor.guide),
    };
    this.lastPoint = { x: point.x, y: point.y };
    win.showInactive();
    await win.webContents.executeJavaScript(
      `window.__clyraSetCursor(${JSON.stringify(point)}); true`,
      true,
    );
    return { ok: true, point };
  }

  async point(x, y, label = "Look here") {
    this.guideOnly = true;
    const point = { x: Math.round(x), y: Math.round(y) };
    this.lastPoint = point;
    await this.setCursor({ ...point, label, kind: "point", guide: true });
    return { ok: true, point, guide: true };
  }

  async move(x, y, label = "Moving") {
    const point = { x: Math.round(x), y: Math.round(y) };
    await this.setCursor({ ...point, label, kind: "move", guide: this.guideOnly });
    if (this.manualControl || this.guideOnly) {
      return { ok: true, skipped: this.guideOnly ? "guide" : "manualControl", point };
    }
    try {
      if (this.xdotool) {
        await execFileAsync(this.xdotool, ["mousemove", "--sync", String(point.x), String(point.y)], {
          timeout: 3_000,
        });
      } else if (this.cliclick) {
        await execFileAsync(this.cliclick, [`m:${point.x},${point.y}`], { timeout: 3_000 });
      } else if (process.platform === "darwin") {
        // CGEvent via osascript is unreliable for mouse position; try cliclick-less fallback.
        await execFileAsync(
          "osascript",
          [
            "-e",
            `tell application "System Events" to set position of mouse to {${point.x}, ${point.y}}`,
          ],
          { timeout: 3_000 },
        ).catch(() => undefined);
      } else if (process.platform === "win32") {
        await runPowerShell(
          `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point(${point.x},${point.y})`,
        );
      }
    } catch {
      /* ignore move failures; cursor overlay still updates */
    }
    this.lastPoint = point;
    return { ok: true, point };
  }

  async click(x, y, button = "left", label = "Clicking") {
    if (this.guideOnly) {
      return this.point(x ?? this.lastPoint.x, y ?? this.lastPoint.y, label || "Click here");
    }
    const point = { x: Math.round(x ?? this.lastPoint.x), y: Math.round(y ?? this.lastPoint.y) };
    await this.move(point.x, point.y, label);
    if (this.manualControl) return { ok: true, skipped: "manualControl", point };
    try {
      if (this.xdotool) {
        const btn = button === "right" ? "3" : button === "middle" ? "2" : "1";
        await execFileAsync(this.xdotool, ["click", btn], { timeout: 3_000 });
      } else if (this.cliclick) {
        await execFileAsync(this.cliclick, [`c:${point.x},${point.y}`], { timeout: 3_000 });
      } else if (process.platform === "darwin") {
        await execFileAsync(
          "osascript",
          [
            "-e",
            `tell application "System Events" to click at {${point.x}, ${point.y}}`,
          ],
          { timeout: 3_000 },
        ).catch(() => undefined);
      } else if (process.platform === "win32") {
        const isRight = button === "right";
        const down = isRight ? 0x0008 : 0x0002;
        const up = isRight ? 0x0010 : 0x0004;
        await runPowerShell(`
Add-Type -AssemblyName System.Windows.Forms;
[System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point(${point.x},${point.y});
Add-Type @"
using System; using System.Runtime.InteropServices;
public class M { [DllImport("user32.dll")] public static extern void mouse_event(int f,int a,int b,int c,int d); }
"@;
[M]::mouse_event(${down},0,0,0,0); [M]::mouse_event(${up},0,0,0,0);
`);
      }
    } catch {
      /* ignore */
    }
    await this.setCursor({ ...point, label: "Clicked", kind: "click" });
    return { ok: true, point };
  }

  async typeText(text, label = "Typing") {
    if (this.guideOnly) {
      await this.setCursor({
        ...this.lastPoint,
        label: `Type: ${String(text || "").slice(0, 40)}`,
        kind: "point",
        guide: true,
      });
      return { ok: true, skipped: "guide" };
    }
    await this.setCursor({ ...this.lastPoint, label, kind: "type" });
    if (this.manualControl) return { ok: true, skipped: "manualControl" };
    const value = String(text || "");
    if (!value) return { ok: true };
    try {
      if (this.xdotool) {
        await execFileAsync(this.xdotool, ["type", "--clearmodifiers", "--delay", "12", "--", value], {
          timeout: 20_000,
        });
      } else if (this.cliclick) {
        await execFileAsync(this.cliclick, [`t:${value}`], { timeout: 20_000 });
      } else if (process.platform === "darwin") {
        const escaped = value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
        await execFileAsync(
          "osascript",
          ["-e", `tell application "System Events" to keystroke "${escaped}"`],
          { timeout: 20_000 },
        );
      } else if (process.platform === "win32") {
        const escaped = value.replace(/'/g, "''");
        await runPowerShell(
          `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('${escaped}')`,
          20_000,
        );
      }
    } catch {
      /* ignore */
    }
    return { ok: true };
  }

  async key(key, label = "Key") {
    if (this.guideOnly) {
      await this.setCursor({ ...this.lastPoint, label: `Press ${key}`, kind: "point", guide: true });
      return { ok: true, skipped: "guide" };
    }
    await this.setCursor({ ...this.lastPoint, label, kind: "key" });
    if (this.manualControl) return { ok: true, skipped: "manualControl" };
    try {
      if (this.xdotool) {
        await execFileAsync(this.xdotool, ["key", "--clearmodifiers", String(key)], { timeout: 3_000 });
      } else if (this.cliclick) {
        await execFileAsync(this.cliclick, [`kp:${key}`], { timeout: 3_000 });
      } else if (process.platform === "darwin") {
        await execFileAsync(
          "osascript",
          ["-e", `tell application "System Events" to key code 36`],
          { timeout: 3_000 },
        ).catch(() => undefined);
      } else if (process.platform === "win32") {
        const map = { Return: "{ENTER}", Enter: "{ENTER}", Tab: "{TAB}", Escape: "{ESC}" };
        const send = map[key] || `{${key}}`;
        await runPowerShell(
          `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('${send}')`,
        );
      }
    } catch {
      /* ignore */
    }
    return { ok: true };
  }

  setManualControl(enabled) {
    this.manualControl = Boolean(enabled);
    if (this.manualControl) void this.setCursor(null);
    return { ok: true, manualControl: this.manualControl };
  }

  setGuideOnly(enabled) {
    this.guideOnly = Boolean(enabled);
    return { ok: true, guideOnly: this.guideOnly };
  }

  async runAction(action) {
    if (!action || typeof action !== "object") throw new Error("Invalid desktop action");
    this.active = true;
    try {
      switch (action.type) {
        case "point":
          return this.point(action.x, action.y, action.label || "Look here");
        case "move":
          return this.move(action.x, action.y, action.label || "Moving");
        case "click":
          return this.click(action.x, action.y, action.button, action.label || "Clicking");
        case "type":
          return this.typeText(action.text, action.label || "Typing");
        case "key":
          return this.key(action.key, action.label || "Key");
        case "wait":
          await wait(Math.max(0, Math.min(5_000, Number(action.ms) || 300)));
          return { ok: true };
        default:
          throw new Error(`Unsupported desktop action: ${action.type}`);
      }
    } finally {
      this.active = false;
    }
  }

  destroy() {
    try {
      if (this.cursorWindow && !this.cursorWindow.isDestroyed()) this.cursorWindow.destroy();
    } catch {
      /* ignore */
    }
    this.cursorWindow = null;
  }
}

const CURSOR_HTML = `<!doctype html>
<html><head><meta charset="utf-8" />
<style>
  html,body{margin:0;width:100%;height:100%;overflow:hidden;background:transparent;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
  #cursor{position:absolute;left:0;top:0;transform:translate(-4px,-2px);pointer-events:none;opacity:0;transition:opacity .14s ease,left .18s ease,top .18s ease}
  #cursor.show{opacity:1}
  #ring{position:absolute;left:-14px;top:-14px;width:36px;height:36px;border-radius:50%;border:2px solid rgba(59,130,246,.85);box-shadow:0 0 0 6px rgba(59,130,246,.12);opacity:0;transform:scale(.7)}
  #cursor.guide #ring{opacity:1;animation:ring 1.4s ease-out infinite}
  @keyframes ring{0%{transform:scale(.75);opacity:.95}70%{transform:scale(1.35);opacity:0}100%{transform:scale(1.35);opacity:0}}
  #arrow{width:18px;height:18px;filter:drop-shadow(0 2px 4px rgba(0,0,0,.4))}
  #pointer{width:14px;height:14px;border-radius:50%;background:#111;border:2px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.35);display:none}
  #cursor.control #arrow{display:none}
  #cursor.control #pointer{display:block}
  #label{margin-top:8px;margin-left:10px;display:inline-block;max-width:260px;padding:5px 9px;border-radius:7px;background:#171817;color:#fff;font-size:11px;font-weight:600;letter-spacing:-.01em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;box-shadow:0 6px 18px rgba(0,0,0,.28)}
  #cursor.guide #label{background:#1d4ed8}
</style></head>
<body>
  <div id="cursor">
    <div id="ring"></div>
    <svg id="arrow" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M4 3.5L20 12L12.2 13.8L9.5 21L4 3.5Z" fill="#111" stroke="#fff" stroke-width="1.4" stroke-linejoin="round"/>
    </svg>
    <div id="pointer"></div>
    <div id="label"></div>
  </div>
  <script>
    window.__clyraSetCursor = (point) => {
      const el = document.getElementById('cursor');
      const label = document.getElementById('label');
      el.style.left = (point.x || 0) + 'px';
      el.style.top = (point.y || 0) + 'px';
      label.textContent = point.label || '';
      el.classList.toggle('guide', Boolean(point.guide) || point.kind === 'point');
      el.classList.toggle('control', !point.guide && point.kind !== 'point');
      el.classList.add('show');
    };
  </script>
</body></html>`;
