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
    win.showInactive();
    await win.webContents.executeJavaScript(`window.__setAIPresence(${JSON.stringify(payload)}); true`, true);
    return { ok: true };
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
    const previous = this.hasMoved ? this.lastPoint : screen.getCursorScreenPoint();
    const motion = planCursorMotion(previous, point);
    if (!this.hasMoved) {
      await this.setCursor({ ...previous, label, kind: "move", durationMs: 0 });
      this.hasMoved = true;
    }
    await this.setCursor({ ...point, label, kind: "move", durationMs: motion.durationMs });
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
$toX = ${point.x}; $toY = ${point.y}; $duration = ${motion.durationMs}
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
        const started = Date.now();
        for (const [index, frame] of motion.frames.entries()) {
          await execFileAsync(this.xdotool, ["mousemove", "--sync", String(frame.x), String(frame.y)], { timeout: 3_000 });
          const next = motion.frames[index + 1];
          if (next) await wait(Math.max(0, next.atMs - (Date.now() - started)));
        }
      }
    } catch (error) {
      await this.setCursor(null);
      throw error; // Never report a simulated move as a successful OS action.
    }
    this.lastPoint = point;
    return { ok: true, point, durationMs: motion.durationMs };
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
    if (this.manualControl) void this.setCursor(null);
    return { ok: true, manualControl: this.manualControl };
  }

  /** Pause prevents every subsequent injected input and removes the visible
   * control affordance. Existing desktop actions are intentionally atomic
   * (no held mouse buttons); the next queued action is therefore fenced. */
  async setPaused(enabled) {
    this.paused = Boolean(enabled);
    if (this.paused) await this.setCursor(null);
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
    try {
      if (this.cursorWindow && !this.cursorWindow.isDestroyed()) this.cursorWindow.destroy();
    } catch {
      /* ignore */
    }
    this.cursorWindow = null;
  }
}

const AI_PRESENCE_HTML = `<!doctype html><html><head><meta charset="utf-8"><style>
  *{box-sizing:border-box;margin:0;padding:0}html,body{width:100%;height:100%;overflow:hidden;background:transparent;pointer-events:none;user-select:none;-webkit-user-select:none}
  #edge{position:fixed;inset:0;opacity:0;transition:opacity 120ms ease;background:linear-gradient(90deg,rgba(47,129,255,.34),transparent 7%,transparent 93%,rgba(47,129,255,.34)),linear-gradient(0deg,rgba(47,129,255,.20),transparent 8%,transparent 92%,rgba(47,129,255,.20));box-shadow:inset 0 0 32px rgba(62,141,255,.28)}
  #cursor{position:fixed;left:0;top:0;width:17px;height:17px;border-radius:50%;transform:translate(-50%,-50%);border:2px solid #fff;background:#1e6fff;box-shadow:0 0 0 2px rgba(30,111,255,.18),0 3px 11px rgba(20,79,176,.28);opacity:0;transition:left 0ms cubic-bezier(.65,0,.35,1),top 0ms cubic-bezier(.65,0,.35,1),opacity 100ms ease}
  #cursor.guide{background:radial-gradient(circle at 36% 30%,#fff 0 8%,#c6e7ff 10% 22%,#50a4ff 45%,#2678dd 100%)}
  #pulse{position:fixed;left:0;top:0;width:42px;height:42px;border:2px solid rgba(93,173,255,.86);border-radius:50%;transform:translate(-50%,-50%) scale(.35);opacity:0}
  #pulse.click{animation:ripple 430ms ease-out}@keyframes ripple{0%{opacity:.92;transform:translate(-50%,-50%) scale(.35)}100%{opacity:0;transform:translate(-50%,-50%) scale(1.25)}}
  #label{position:fixed;left:0;top:0;transform:translate(16px,14px);padding:5px 8px;border-radius:7px;background:rgba(8,30,72,.86);color:#fff;font:500 11px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;letter-spacing:.01em;white-space:nowrap;opacity:0;transition:opacity 100ms ease}
  body.active #cursor,body.active #label{opacity:1}body.controlling #edge{opacity:1}
</style></head><body><div id="edge"></div><div id="pulse"></div><div id="cursor"></div><div id="label"></div><script>
  const cursor=document.getElementById('cursor'), pulse=document.getElementById('pulse'), label=document.getElementById('label');
  window.__setAIPresence=(value)=>{const on=Boolean(value);document.body.classList.toggle('active',on);if(!on)return;const x=Math.round(value.x||0),y=Math.round(value.y||0);cursor.style.transitionDuration=(value.durationMs||0)+'ms,'+(value.durationMs||0)+'ms,100ms';cursor.style.left=pulse.style.left=label.style.left=x+'px';cursor.style.top=pulse.style.top=label.style.top=y+'px';cursor.classList.toggle('guide',Boolean(value.guide));document.body.classList.toggle('controlling',!value.guide&&!value.paused);label.textContent=value.label||'Clyra';pulse.classList.remove('click');if(value.kind==='click'){void pulse.offsetWidth;pulse.classList.add('click')}};
  window.__openCluelySetAICursor=window.__setAIPresence;
</script></body></html>`;
