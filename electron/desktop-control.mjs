/**
 * OS-level desktop control for Clyra Screen Companion.
 * Linux: xdotool. macOS: AppleScript. Windows: native SendInput via PowerShell.
 * Draws Atlas-style AI cursor — also used in Guide mode to point without clicking.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { app, BrowserWindow, screen } from "electron";
import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { planCursorMotion } from "./ai-cursor-motion.mjs";

const execFileAsync = promisify(execFile);
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function which(bin) {
  try {
    const { stdout } = await execFileAsync(process.platform === "win32" ? "where" : "which", [bin], { timeout: 2_000 });
    return String(stdout || "").split(/\r?\n/).map((value) => value.trim()).find(Boolean) || null;
  } catch {
    return null;
  }
}

const WINDOWS_INPUT = String.raw`
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class ClyraWindowsInput {
  [StructLayout(LayoutKind.Sequential)] public struct INPUT { public uint type; public INPUTUNION U; }
  [StructLayout(LayoutKind.Explicit)] public struct INPUTUNION { [FieldOffset(0)] public KEYBDINPUT ki; }
  [StructLayout(LayoutKind.Sequential)] public struct KEYBDINPUT { public ushort wVk; public ushort wScan; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; }
  [DllImport("user32.dll", SetLastError=true)] public static extern bool GetCursorPos(out POINT point);
  [DllImport("user32.dll", SetLastError=true)] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll", SetLastError=true)] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extraInfo);
  [DllImport("user32.dll", SetLastError=true)] public static extern uint SendInput(uint count, INPUT[] inputs, int size);
  const uint KEYEVENTF_UNICODE = 0x0004;
  const uint KEYEVENTF_KEYUP = 0x0002;
  public static void TypeText(string value) {
    foreach (char character in value ?? String.Empty) {
      INPUT[] inputs = new INPUT[2];
      inputs[0].type = 1;
      inputs[0].U.ki.wScan = character;
      inputs[0].U.ki.dwFlags = KEYEVENTF_UNICODE;
      inputs[1].type = 1;
      inputs[1].U.ki.wScan = character;
      inputs[1].U.ki.dwFlags = KEYEVENTF_UNICODE | KEYEVENTF_KEYUP;
      SendInput(2, inputs, Marshal.SizeOf(typeof(INPUT)));
    }
  }
}
'@
`;

async function runWindowsPowerShell(script, timeout = 4_000) {
  await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script], {
    timeout,
    windowsHide: true,
  });
}

function windowsSendKeys(key) {
  const normalized = String(key || "").trim().toLowerCase().replace(/\s+/g, "");
  const aliases = {
    "cmd+l": "^l",
    "command+l": "^l",
    "ctrl+l": "^l",
    "control+l": "^l",
    "cmd+c": "^c",
    "command+c": "^c",
    "ctrl+c": "^c",
    "control+c": "^c",
    "cmd+v": "^v",
    "command+v": "^v",
    "ctrl+v": "^v",
    "control+v": "^v",
    enter: "{ENTER}",
    return: "{ENTER}",
    tab: "{TAB}",
    escape: "{ESC}",
    esc: "{ESC}",
    backspace: "{BACKSPACE}",
    delete: "{DELETE}",
    left: "{LEFT}",
    right: "{RIGHT}",
    up: "{UP}",
    down: "{DOWN}",
  };
  return aliases[normalized] || `{${String(key || "").toUpperCase()}}`;
}

export class DesktopControlService {
  constructor() {
    this.cursorWindow = null;
    this.manualControl = false;
    this.paused = false;
    this.active = false;
    this.guideOnly = false;
    this.xdotool = null;
    this.lastPoint = { x: 0, y: 0 };
    this.macPointerPromise = null;
    this.hasMoved = false;
    this.positionTrackingTimer = null;
  }

  async initialize() {
    this.xdotool = process.platform === "linux" ? await which("xdotool") : null;
    const driver = process.platform === "darwin" ? "coregraphics"
      : process.platform === "win32" ? "powershell-sendinput"
        : this.xdotool ? "xdotool" : "none";
    return { ok: true, driver };
  }

  // Build once on demand; compiling at startup would block the launcher.
  // The binary is local to this user account and is rebuilt when source changes.
  async macPointerBinary() {
    if (process.platform !== "darwin") throw new Error("CoreGraphics input requires macOS.");
    if (!this.macPointerPromise) {
      this.macPointerPromise = (async () => {
        const source = await fs.readFile(new URL("./native-pointer.swift", import.meta.url), "utf8");
        const folder = path.join(app.getPath("userData"), "native-input");
        const hash = crypto.createHash("sha256").update(source).digest("hex").slice(0, 14);
        const binary = path.join(folder, "clyra-pointer-" + hash);
        try { await fs.access(binary); return binary; } catch { /* compile once */ }
        await fs.mkdir(folder, { recursive: true });
        const sourcePath = path.join(folder, "clyra-pointer-" + hash + ".swift");
        await fs.writeFile(sourcePath, source, { mode: 0o600 });
        await execFileAsync("xcrun", ["swiftc", sourcePath, "-O", "-o", binary], { timeout: 90_000 });
        return binary;
      })().catch((error) => { this.macPointerPromise = null; throw new Error("macOS pointer backend unavailable: " + (error?.message || error)); });
    }
    return this.macPointerPromise;
  }

  async macInput(...args) {
    const binary = await this.macPointerBinary();
    await execFileAsync(binary, args.map(String), { timeout: 15_000 });
  }

  async ensureCursorOverlay(display = screen.getPrimaryDisplay()) {
    if (this.cursorWindow && !this.cursorWindow.isDestroyed()) {
      // Screen coordinates can be negative on a left-hand monitor. Keeping
      // the transparent overlay on the display that owns the target avoids
      // mixing physical and device-independent coordinates.
      this.cursorWindow.setBounds(display.bounds, false);
      return this.cursorWindow;
    }
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
    // Windows does not support the macOS screen-saver window level. Keeping
    // the overlay at the normal floating level avoids it disappearing behind
    // a controlled app or showing a black surface on Windows 10.
    if (process.platform === "darwin") {
      this.cursorWindow.setAlwaysOnTop(true, "pop-up-menu", 1);
    } else {
      this.cursorWindow.setAlwaysOnTop(true, "floating");
      try {
        this.cursorWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
      } catch {
        /* older Electron */
      }
    }
    await this.cursorWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(AI_PRESENCE_HTML)}`);
    return this.cursorWindow;
  }

  async setCursor(cursor) {
    if (!cursor) {
      if (this.cursorWindow && !this.cursorWindow.isDestroyed()) {
        this.cursorWindow.webContents.executeJavaScript('window.__setAIPresence(false); true', true).catch(() => {});
        // Stopping or pausing control must not leave a delayed AI cursor on
        // screen. The window remains reusable, but is hidden immediately.
        try { this.cursorWindow.hide(); } catch (_) {}
      }
      return { ok: true };
    }
    const x = Number(cursor.x);
    const y = Number(cursor.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return { ok: false, error: "Cursor coordinates are invalid." };
    const display = screen.getDisplayNearestPoint({ x: Math.round(x), y: Math.round(y) });
    const win = await this.ensureCursorOverlay(display);
    const payload = {
      x: Math.round(x - display.bounds.x),
      y: Math.round(y - display.bounds.y),
      label: String(cursor.label || "Clyra").slice(0, 96),
      kind: String(cursor.kind || "move"),
      guide: Boolean(cursor.guide),
      paused: this.paused,
      durationMs: Math.max(0, Math.min(450, Number(cursor.durationMs) || 0)),
    };
    if (!win.isVisible()) win.showInactive();
    await win.webContents.executeJavaScript(`window.__setAIPresence(${JSON.stringify(payload)}); true`, true);
    return { ok: true };
  }

  /** Follow the REAL OS cursor rather than animating to an unconfirmed target.
   * A single in-flight paint limits IPC work on lower-powered hardware. */
  trackPhysicalPointer(label) {
    if (this.positionTrackingTimer) clearInterval(this.positionTrackingTimer);
    let painting = false;
    let stopped = false;
    let last = null;
    const sample = async (force = false) => {
      if (stopped || painting || this.paused || this.manualControl) return;
      const current = screen.getCursorScreenPoint();
      if (!force && last && current.x === last.x && current.y === last.y) return;
      last = current;
      painting = true;
      try { await this.setCursor({ ...current, label, kind: "move", durationMs: 0 }); }
      finally { painting = false; }
    };
    void sample().catch(() => {});
    this.positionTrackingTimer = setInterval(() => { void sample().catch(() => {}); }, 16);
    return async () => {
      if (this.positionTrackingTimer) clearInterval(this.positionTrackingTimer);
      this.positionTrackingTimer = null;
      // Do not permit a late stale frame to paint over the landed point.
      stopped = true;
      while (painting) await wait(4);
      if (!this.paused && !this.manualControl) {
        const current = screen.getCursorScreenPoint();
        await this.setCursor({ ...current, label, kind: "move", durationMs: 0 });
      }
    };
  }

  /**
   * Visual pointer only — does not move the OS mouse or click.
   * Used when the AI is explaining where to press.
   */
  async point(x, y, label = "Look here") {
    this.guideOnly = true;
    const point = { x: Math.round(x), y: Math.round(y) };
    this.lastPoint = point;
    await this.setCursor({ ...point, label, kind: "point", guide: true });
    return { ok: true, point, guide: true };
  }

  async move(x, y, label = "Moving") {
    const point = { x: Math.round(Number(x)), y: Math.round(Number(y)) };
    if (![point.x, point.y].every(Number.isFinite)) throw new Error("Desktop coordinates must be finite.");
    if (!screen.getAllDisplays().some((display) => point.x >= display.bounds.x && point.y >= display.bounds.y && point.x < display.bounds.x + display.bounds.width && point.y < display.bounds.y + display.bounds.height)) {
      throw new Error("Desktop target is outside the connected displays.");
    }
    if (this.guideOnly) return this.point(point.x, point.y, label);
    if (this.paused || this.manualControl) return { ok: false, skipped: this.paused ? "paused" : "manualControl", point };
    if (process.platform === "darwin") await this.macPointerBinary();
    if (!this.xdotool && !["darwin", "win32"].includes(process.platform)) throw new Error("Native desktop mouse input is unavailable (xdotool required).");
    const previous = screen.getCursorScreenPoint();
    const motion = planCursorMotion(previous, point);
    const stopTracking = this.trackPhysicalPointer(label);
    try {
      if (process.platform === "darwin") {
        await this.macInput("move", point.x, point.y, motion.durationMs);
      } else if (process.platform === "win32") {
        // One native process moves the real OS pointer at 16 ms intervals.
        // Spawning PowerShell once PER frame would make this visibly lag.
        const script = `${WINDOWS_INPUT}
$p = New-Object ClyraWindowsInput+POINT
if (-not [ClyraWindowsInput]::GetCursorPos([ref]$p)) { throw 'GetCursorPos failed' }
$fromX = $p.X; $fromY = $p.Y
$toX = ${(typeof screen.dipToScreenPoint === "function" ? screen.dipToScreenPoint(point) : point).x}; $toY = ${(typeof screen.dipToScreenPoint === "function" ? screen.dipToScreenPoint(point) : point).y}; $duration = ${motion.durationMs}
$count = [Math]::Max(1, [Math]::Min(26, [Math]::Ceiling($duration / 16.0)))
for ($i=1; $i -le $count; $i++) {
  $t = $i / [double]$count
  if ($t -lt 0.5) { $ease = 4 * $t * $t * $t } else { $ease = 1 - [Math]::Pow(-2*$t+2,3)/2 }
  $mx = [int][Math]::Round($fromX + ($toX-$fromX)*$ease)
  $my = [int][Math]::Round($fromY + ($toY-$fromY)*$ease)
  if (-not [ClyraWindowsInput]::SetCursorPos($mx, $my)) { throw 'SetCursorPos failed' }
  if ($i -lt $count -and $duration -gt 0) { Start-Sleep -Milliseconds ([int][Math]::Max(1, $duration / $count)) }
}`;
        await runWindowsPowerShell(script, 10_000);
      } else {
        const chain = [];
        for (const [index, frame] of motion.frames.entries()) {
          chain.push("mousemove", "--sync", String(frame.x), String(frame.y));
          const next = motion.frames[index + 1];
          if (next) chain.push("sleep", String(Math.max(0.002, (next.atMs - frame.atMs) / 1000)));
        }
        // One xdotool process prevents per-frame process spawn latency.
        await execFileAsync(this.xdotool, chain, { timeout: 10_000 });
      }
    } catch (error) {
      await stopTracking();
      await this.setCursor(null);
      throw error; // Never report a simulated move as a successful OS action.
    }
    await stopTracking();
    const actual = screen.getCursorScreenPoint();
    if (Math.hypot(actual.x - point.x, actual.y - point.y) > 4) {
      await this.setCursor(null);
      throw new Error("The OS cursor did not reach the intended coordinate; click cancelled.");
    }
    this.hasMoved = true;
    this.lastPoint = actual;
    return { ok: true, point: actual, durationMs: motion.durationMs };
  }

  async click(x, y, button = "left", label = "Clicking") {
    if (this.guideOnly) {
      return this.point(x ?? this.lastPoint.x, y ?? this.lastPoint.y, label || "Click here");
    }
    const point = { x: Math.round(x ?? this.lastPoint.x), y: Math.round(y ?? this.lastPoint.y) };
    const moved = await this.move(point.x, point.y, label);
    if (!moved.ok) return moved;
    if (this.paused || this.manualControl) return { ok: false, skipped: this.paused ? "paused" : "manualControl", point };
    if (process.platform === "darwin") {
      await this.macInput("click", point.x, point.y, button === "right" ? "right" : button === "middle" ? "middle" : "left");
    } else if (this.xdotool) {
      const btn = button === "right" ? "3" : button === "middle" ? "2" : "1";
      await execFileAsync(this.xdotool, ["click", btn], { timeout: 3_000 });
    } else if (process.platform === "win32") {
      const flags = button === "right"
        ? ["0x0008", "0x0010"]
        : button === "middle"
          ? ["0x0020", "0x0040"]
          : ["0x0002", "0x0004"];
      await runWindowsPowerShell(`${WINDOWS_INPUT}\n[ClyraWindowsInput]::mouse_event(${flags[0]}, 0, 0, 0, [UIntPtr]::Zero); [ClyraWindowsInput]::mouse_event(${flags[1]}, 0, 0, 0, [UIntPtr]::Zero)`);
    }
    await this.setCursor({ ...point, label: "Clicked", kind: "click" });
    return { ok: true, point };
  }

  async typeText(text, label = "Typing") {
    if (this.guideOnly) {
      await this.setCursor({ ...this.lastPoint, label: `Type: ${String(text || "").slice(0, 40)}`, kind: "point", guide: true });
      return { ok: true, skipped: "guide" };
    }
    await this.setCursor({ ...this.lastPoint, label, kind: "type" });
    if (this.paused || this.manualControl) return { ok: true, skipped: this.paused ? "paused" : "manualControl" };
    const value = String(text || "");
    if (!value) return { ok: true };
    if (this.xdotool) {
      await execFileAsync(this.xdotool, ["type", "--clearmodifiers", "--delay", "12", "--", value], { timeout: 20_000 });
    } else if (process.platform === "darwin") {
      const escaped = value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\r?\n/g, "\\n");
      await execFileAsync("osascript", ["-e", `tell application "System Events" to keystroke "${escaped}"`], { timeout: 20_000 });
    } else if (process.platform === "win32") {
      const encoded = Buffer.from(value, "utf8").toString("base64");
      await runWindowsPowerShell(`${WINDOWS_INPUT}\n$value = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('${encoded}')); [ClyraWindowsInput]::TypeText($value)`, 20_000);
    }
    return { ok: true };
  }

  async key(key, label = "Key") {
    if (this.guideOnly) {
      await this.setCursor({ ...this.lastPoint, label: `Press ${key}`, kind: "point", guide: true });
      return { ok: true, skipped: "guide" };
    }
    await this.setCursor({ ...this.lastPoint, label, kind: "key" });
    if (this.paused || this.manualControl) return { ok: true, skipped: this.paused ? "paused" : "manualControl" };
    if (this.xdotool) {
      await execFileAsync(this.xdotool, ["key", "--clearmodifiers", String(key)], { timeout: 3_000 });
    } else if (process.platform === "darwin") {
      const normalized = String(key).toLowerCase();
      if (normalized === "cmd+l" || normalized === "command+l") {
        await execFileAsync("osascript", ["-e", 'tell application "System Events" to keystroke "l" using command down'], { timeout: 3_000 });
      } else {
        await execFileAsync("osascript", ["-e", `tell application "System Events" to key code 36`], { timeout: 3_000 });
      }
    } else if (process.platform === "win32") {
      const send = windowsSendKeys(key).replace(/'/g, "''");
      await runWindowsPowerShell(`Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('${send}')`);
    }
    return { ok: true };
  }

  setManualControl(enabled) {
    this.manualControl = Boolean(enabled);
    if (this.manualControl) {
      if (this.positionTrackingTimer) clearInterval(this.positionTrackingTimer);
      this.positionTrackingTimer = null;
      void this.setCursor(null);
    }
    return { ok: true, manualControl: this.manualControl };
  }

  /** Pause prevents every subsequent injected input and removes the visible
   * control affordance. Existing desktop actions are intentionally atomic
   * (no held mouse buttons); the next queued action is therefore fenced. */
  async setPaused(enabled) {
    this.paused = Boolean(enabled);
    if (this.paused) {
      if (this.positionTrackingTimer) clearInterval(this.positionTrackingTimer);
      this.positionTrackingTimer = null;
      await this.setCursor(null);
    }
    return { ok: true, paused: this.paused };
  }

  setGuideOnly(enabled) {
    this.guideOnly = Boolean(enabled);
    return { ok: true, guideOnly: this.guideOnly };
  }

  async runAction(action) {
    if (!action || typeof action !== "object") throw new Error("Invalid desktop action");
    if (this.paused) return { ok: false, error: "Desktop control is paused." };
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
        case "scroll": {
          if (this.paused || this.guideOnly || this.manualControl) return { ok: true, skipped: this.paused ? "paused" : this.guideOnly ? "guide" : "manualControl" };
          const amount = Math.max(-20, Math.min(20, Number(action.deltaY ?? action.amount) || 0));
          if (process.platform === "win32") {
            const wheel = Math.round(amount >= 0 ? 120 : -120);
            const repeats = Math.max(1, Math.round(Math.abs(amount)));
            await runWindowsPowerShell(`${WINDOWS_INPUT}\nfor ($i = 0; $i -lt ${repeats}; $i++) { [ClyraWindowsInput]::mouse_event(0x0800, 0, 0, ${wheel}, [UIntPtr]::Zero) }`);
          } else if (process.platform === "darwin") {
            await this.macInput("scroll", this.lastPoint.x, this.lastPoint.y, -Math.round(amount));
          } else if (this.xdotool) {
            const button = amount >= 0 ? "4" : "5";
            await execFileAsync(this.xdotool, ["click", "--repeat", String(Math.max(1, Math.round(Math.abs(amount)))), button], { timeout: 3_000 });
          } else {
            return { ok: false, error: "Scrolling is unavailable on this platform" };
          }
          return { ok: true, deltaY: amount };
        }
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
    if (this.positionTrackingTimer) clearInterval(this.positionTrackingTimer);
    this.positionTrackingTimer = null;
    try {
      if (this.cursorWindow && !this.cursorWindow.isDestroyed()) this.cursorWindow.destroy();
    } catch {
      /* ignore */
    }
    this.cursorWindow = null;
  }
}

const AI_PRESENCE_HTML = `<!doctype html>
<html><head><meta charset="utf-8"><style>
  *{box-sizing:border-box;margin:0;padding:0}
  html,body{width:100%;height:100%;background:transparent;overflow:hidden;pointer-events:none;user-select:none;-webkit-user-select:none}
  #cursor{position:fixed;left:0;top:0;width:1px;height:1px;opacity:0;pointer-events:none;will-change:left,top;transition:opacity 100ms ease}
  #arrow{position:absolute;left:-4px;top:-3px;width:34px;height:38px;overflow:visible;transform-origin:4px 3px;filter:drop-shadow(0 0 2.5px rgba(30,111,255,.32)) drop-shadow(0 3px 3px rgba(22,34,55,.18))}
  #pulse{position:fixed;left:0;top:0;width:32px;height:32px;border:2px solid rgba(30,111,255,.6);border-radius:50%;transform:translate(-50%,-50%) scale(.2);opacity:0;pointer-events:none}
  #pulse.is-click{animation:impact 390ms cubic-bezier(.16,1,.3,1)}
  @keyframes impact{0%{opacity:.82;transform:translate(-50%,-50%) scale(.2)}100%{opacity:0;transform:translate(-50%,-50%) scale(1.45)}}
  @keyframes press{0%,100%{transform:scale(1)}35%{transform:scale(.88) translate(1px,1px)}}
  #arrow.is-press{animation:press 250ms cubic-bezier(.22,1,.36,1)}
  #label{position:fixed;left:0;top:0;opacity:0;padding:6px 9px;border:1px solid rgba(36,42,52,.09);border-radius:9px;background:rgba(255,255,255,.96);color:#252a35;box-shadow:0 4px 14px rgba(20,32,52,.13);font:500 11px/1.25 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;white-space:nowrap;max-width:210px;overflow:hidden;text-overflow:ellipsis;pointer-events:none}
  body.active #cursor{opacity:1}body.active #label{opacity:1}
  @media(prefers-reduced-motion:reduce){#pulse.is-click,#arrow.is-press{animation:none}}
</style></head><body>
<div id="cursor"><svg id="arrow" viewBox="0 0 34 38" aria-hidden="true"><path d="M4 3 L4 29.2 Q4 30.5 5.4 30.5 L11.4 24.6 L16.9 34.3 Q17.5 35.4 18.6 34.9 L22 33.1 Q23 32.6 22.4 31.5 L16.9 21.8 L29.1 21.8 Q30.8 21.8 30 20.4 L5.9 2.2 Q4 0.9 4 3 Z" fill="#1e6fff" stroke="#1e6fff" stroke-width="5.4" stroke-linejoin="round"/><path d="M4 3 L4 29.2 Q4 30.5 5.4 30.5 L11.4 24.6 L16.9 34.3 Q17.5 35.4 18.6 34.9 L22 33.1 Q23 32.6 22.4 31.5 L16.9 21.8 L29.1 21.8 Q30.8 21.8 30 20.4 L5.9 2.2 Q4 0.9 4 3 Z" fill="#fff" stroke="#252a35" stroke-width="2.45" stroke-linejoin="round"/></svg></div>
<div id="pulse"></div><div id="label"></div>
<script>
const cursor=document.getElementById("cursor"), arrow=document.getElementById("arrow");
const pulse=document.getElementById("pulse"), label=document.getElementById("label");
let prior=null;
window.__setAIPresence=(value)=>{
  const active=!!value;
  document.body.classList.toggle("active", active);
  if(!active){prior=null;return;}
  const x=Math.round(value.x), y=Math.round(value.y);
  if(!Number.isFinite(x)||!Number.isFinite(y))return;
  cursor.style.left=x+"px";cursor.style.top=y+"px";
  pulse.style.left=x+"px";pulse.style.top=y+"px";
  label.style.left=(x+23)+"px";label.style.top=(y+27)+"px";
  label.textContent=String(value.label||"Clyra");
  label.style.display=value.showLabel===false?"none":"block";
  const click=value.kind==="click"||value.kind==="double_click"||value.kind==="right_click";
  if(click){
    pulse.classList.remove("is-click");arrow.classList.remove("is-press");
    void pulse.offsetWidth;
    pulse.classList.add("is-click");arrow.classList.add("is-press");
  }else if(prior==="click") arrow.classList.remove("is-press");
  prior=click?"click":"move";
};
window.__openCluelySetAICursor=window.__setAIPresence;
</script></body></html>`;
