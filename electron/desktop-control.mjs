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
  [StructLayout(LayoutKind.Explicit)] public struct INPUTUNION {
    [FieldOffset(0)] public KEYBDINPUT ki;
    [FieldOffset(0)] public MOUSEINPUT mi;
    [FieldOffset(0)] public HARDWAREINPUT hi;
  }
  [StructLayout(LayoutKind.Sequential)] public struct MOUSEINPUT {
    public int dx; public int dy; public uint mouseData; public uint dwFlags; public uint time; public IntPtr dwExtraInfo;
  }
  [StructLayout(LayoutKind.Sequential)] public struct HARDWAREINPUT {
    public uint uMsg; public ushort wParamL; public ushort wParamH;
  }
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
    /** "calm" = slower, eased pointer travel and human typing, used by computer use. */
    this.profile = "default";
    this.cursorDisplayId = null;
    /** Where the AI's own (virtual) cursor is. The person's real pointer is never moved by computer use on macOS. */
    this.virtualPos = null;
    this.cursorEnabled = true;
  }

  setCursorEnabled(on) { this.cursorEnabled = Boolean(on); if (!on) { this.virtualPos = this.virtualPos; void this.setCursor(null); } }

  async glide(x, y, label, { quick = false } = {}) {
    const target = { x: Math.round(x), y: Math.round(y) };
    const from = this.virtualPos || screen.getCursorScreenPoint();
    const motion = planCursorMotion(from, target, { speed: quick ? "fast" : "calm" });
    this.virtualPos = target;
    await this.setCursor({ ...target, fromX: from.x, fromY: from.y, label, kind: "move", durationMs: motion.durationMs });
    if (motion.durationMs) await wait(motion.durationMs);
    return motion.durationMs;
  }

  /** A click that leaves the person's pointer alone: the pulse lands on the exact frame it is sent. `press` tries the
   * Accessibility route first; if the control cannot be pressed that way, a real click is made and the pointer is put back. */
  async softClick(x, y, { button = "left", count = 1, label = "Clicking", press, around } = {}) {
    if (this.paused || this.manualControl || !this.cursorEnabled) return { ok: false, skipped: "paused" };
    await this.setCursor({ x, y, label, kind: "click", durationMs: 0 });
    let via = "";
    if (press && count === 1) { try { const done = await press(button === "right" ? "menu" : "press"); if (done) via = "accessibility"; } catch { /* fall back below */ } }
    if (!via) {
      // A real click has to pass through the shield, so it opens for these few milliseconds.
      const send = () => this.macInput("clickrestore", Math.round(x), Math.round(y), button, count);
      await (around ? around(send) : send());
      via = "pointer";
    }
    this.virtualPos = { x: Math.round(x), y: Math.round(y) };
    return { ok: true, point: { x, y }, via };
  }

  async pidScroll(pid, x, y, lines, label = "Scrolling") {
    if (this.paused || this.manualControl || !this.cursorEnabled) return { ok: false, skipped: "paused" };
    await this.setCursor({ x, y, label, kind: "scroll", durationMs: 0 });
    await this.macInput("scrollpid", pid, Math.round(x), Math.round(y), Math.round(lines));
    return { ok: true };
  }

  /** Where the AI's cursor is: its own position when it has one, otherwise the real pointer. */
  cursorPoint() { return this.virtualPos || screen.getCursorScreenPoint(); }

  setProfile(profile) { this.profile = profile === "calm" ? "calm" : "default"; }

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
        // Packaged apps ship an executable in app.asar.unpacked; end users do
        // not need Xcode, a network download or an on-device compiler.
        if (app.isPackaged) {
          const shipped = path.join(process.resourcesPath, "app.asar.unpacked", "electron", "native-pointer-darwin");
          await fs.access(shipped);
          return shipped;
        }
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
    await execFileAsync(binary, args.map(String), { timeout: args[0] === "type" ? 90_000 : 15_000 });
  }

  async ensureCursorOverlay(display = screen.getPrimaryDisplay()) {
    if (this.cursorWindow && !this.cursorWindow.isDestroyed()) {
      // Screen coordinates can be negative on a left-hand monitor. Keeping
      // the transparent overlay on the display that owns the target avoids
      // mixing physical and device-independent coordinates.
      const current = this.cursorWindow.getBounds();
      if (current.x !== display.bounds.x || current.y !== display.bounds.y
        || current.width !== display.bounds.width || current.height !== display.bounds.height) {
        this.cursorWindow.setBounds(display.bounds, false);
      }
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
      // Without this macOS pushes the window below the menu bar, which offsets the cursor by the bar's height.
      enableLargerThanScreen: true,
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
      // Above the glow, the control bar, the Dock and the menu bar, on every Space and over full-screen apps.
      this.cursorWindow.setAlwaysOnTop(true, "screen-saver", 5);
      try { this.cursorWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true }); } catch { /* older Electron */ }
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
    if (this.paused || !this.cursorEnabled) return { ok: true, skipped: "hidden" };
    const x = Number(cursor.x);
    const y = Number(cursor.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return { ok: false, error: "Cursor coordinates are invalid." };
    const display = screen.getDisplayNearestPoint({ x: Math.round(x), y: Math.round(y) });
    const win = await this.ensureCursorOverlay(display);
    const jump = this.cursorDisplayId !== null && this.cursorDisplayId !== display.id;
    this.cursorDisplayId = display.id;
    const payload = {
      jump,
      fromX: Number.isFinite(Number(cursor.fromX)) ? Math.round(Number(cursor.fromX) - display.bounds.x) : undefined,
      fromY: Number.isFinite(Number(cursor.fromY)) ? Math.round(Number(cursor.fromY) - display.bounds.y) : undefined,
      x: Math.round(x - display.bounds.x),
      y: Math.round(y - display.bounds.y),
      label: String(cursor.label || "Clyra").slice(0, 96),
      kind: String(cursor.kind || "move"),
      guide: Boolean(cursor.guide),
      paused: this.paused,
      durationMs: Math.max(0, Math.min(1400, Number(cursor.durationMs) || 0)),
    };
    if (!win.isVisible()) win.showInactive();
    else if (Date.now() - (this.lastRaise || 0) > 1500) { this.lastRaise = Date.now(); try { win.moveTop(); } catch { /* ignore */ } }
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
    const calm = this.profile === "calm";
    const motion = planCursorMotion(previous, point, calm ? { speed: "calm" } : {});
    // Calm profile: the AI cursor glides itself from one pushed target (no per-frame IPC) while the real pointer follows the same easing.
    if (calm) await this.setCursor({ ...point, fromX: previous.x, fromY: previous.y, label, kind: "move", durationMs: motion.durationMs });
    const stopTracking = calm ? async () => {} : this.trackPhysicalPointer(label);
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
    // The last synthetic move event can land a frame after the helper exits.
    let actual = screen.getCursorScreenPoint();
    for (let tries = 0; tries < 12 && Math.hypot(actual.x - point.x, actual.y - point.y) > 4; tries += 1) {
      await wait(25);
      actual = screen.getCursorScreenPoint();
    }
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
    // Let the app register the pointer over its control before the press; instant move+click is dropped by some apps.
    await wait(this.profile === "calm" ? 60 : 90);
    // The ripple and press animation land on the exact frame the click is sent.
    if (this.profile === "calm") void this.setCursor({ ...point, label, kind: "click", durationMs: 0 }).catch(() => {});
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
    if (this.profile !== "calm") await this.setCursor({ ...point, label: "Clicked", kind: "click" });
    return { ok: true, point };
  }

  async typeText(text, label = "Typing") {
    if (this.guideOnly) {
      await this.setCursor({ ...this.lastPoint, label: `Type: ${String(text || "").slice(0, 40)}`, kind: "point", guide: true });
      return { ok: true, skipped: "guide" };
    }
    if (this.paused || this.manualControl) return { ok: false, skipped: this.paused ? "paused" : "manualControl" };
    const value = String(text || "");
    if (!value) return { ok: true };
    await this.setCursor({ ...this.cursorPoint(), label, kind: "type", durationMs: 0 });
    if (this.xdotool) {
      await execFileAsync(this.xdotool, ["type", "--clearmodifiers", "--delay", "12", "--", value], { timeout: 20_000 });
    } else if (process.platform === "darwin" && this.profile === "calm") {
      // One real key event per character with a human rhythm; the AI cursor shows a text caret while it runs.
      const perChar = Math.max(24, Math.min(70, Math.round(2600 / Math.max(1, value.length))));
      await this.macInput("type", Buffer.from(value, "utf8").toString("base64"), perChar);
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
    if (this.paused || this.manualControl) return { ok: false, skipped: this.paused ? "paused" : "manualControl" };
    await this.setCursor({ ...this.cursorPoint(), label, kind: "key", durationMs: 0 });
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
          if (this.paused || this.guideOnly || this.manualControl) return { ok: false, skipped: this.paused ? "paused" : this.guideOnly ? "guide" : "manualControl" };
          // Positive deltaY means down, matching browser wheel semantics.
          const amount = Math.max(-20, Math.min(20, Number(action.deltaY ?? action.amount) || 0));
          if (!amount) return { ok: true, deltaY: 0 };
          if (process.platform === "win32") {
            const wheel = Math.round(amount > 0 ? -120 : 120);
            const repeats = Math.max(1, Math.round(Math.abs(amount)));
            await runWindowsPowerShell(`${WINDOWS_INPUT}\nfor ($i = 0; $i -lt ${repeats}; $i++) { [ClyraWindowsInput]::mouse_event(0x0800, 0, 0, ${wheel}, [UIntPtr]::Zero) }`);
          } else if (process.platform === "darwin") {
            const point = screen.getCursorScreenPoint();
            await this.macInput("scroll", point.x, point.y, -Math.round(amount));
          } else if (this.xdotool) {
            const button = amount > 0 ? "5" : "4";
            await execFileAsync(this.xdotool, ["click", "--repeat", String(Math.max(1, Math.round(Math.abs(amount)))), button], { timeout: 3_000 });
          } else {
            return { ok: false, error: "Scrolling is unavailable on this platform" };
          }
          const actual = screen.getCursorScreenPoint();
          await this.setCursor({ ...actual, label: "Scrolling", kind: "scroll" });
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
  :root{--blue:#1e6fff}
  *{box-sizing:border-box;margin:0;padding:0}
  html,body{width:100%;height:100%;background:transparent;overflow:hidden;pointer-events:none;user-select:none;-webkit-user-select:none}
  #rig{position:fixed;left:0;top:0;width:0;height:0;opacity:0;transition:opacity 220ms cubic-bezier(.32,.72,0,1);will-change:transform}
  body.active #rig{opacity:1}
  #pointer{position:absolute;left:0;top:0;width:0;height:0;will-change:transform}
  #arrow{position:absolute;left:-1.5px;top:-1.5px;width:22px;height:22px;overflow:visible;transform-origin:1.5px 1.5px;filter:drop-shadow(0 1px 1.5px rgba(10,24,60,.35)) drop-shadow(0 0 6px rgba(30,111,255,.28));transition:transform 160ms cubic-bezier(.3,1.4,.5,1),opacity 140ms ease}
  #arrow.press{transform:scale(.82)}
  #arrow.hide{opacity:0;transform:scale(.7)}
  #caret{position:absolute;left:-1px;top:-10px;width:2px;height:20px;border-radius:1px;background:var(--blue);box-shadow:0 0 0 1px rgba(255,255,255,.9),0 0 8px rgba(30,111,255,.5);opacity:0;transform:scaleY(.6);transition:opacity 140ms ease,transform 180ms cubic-bezier(.3,1.4,.5,1)}
  #caret::before,#caret::after{content:"";position:absolute;left:-3px;width:8px;height:2px;background:var(--blue);border-radius:1px;box-shadow:0 0 0 .75px rgba(255,255,255,.9)}
  #caret::before{top:-1px}#caret::after{bottom:-1px}
  body.typing #caret{opacity:1;transform:none;animation:blink 1.05s steps(1,end) infinite}
  body.typing #caret.flash{animation:none}
  @keyframes blink{0%,58%{opacity:1}59%,100%{opacity:.18}}
  .ring{position:absolute;left:0;top:0;width:44px;height:44px;margin:-22px 0 0 -22px;border-radius:50%;border:1.5px solid rgba(30,111,255,.75);background:radial-gradient(circle,rgba(30,111,255,.26),rgba(30,111,255,0) 68%);opacity:0;transform:scale(.18);pointer-events:none}
  .ring.go{animation:ring 520ms cubic-bezier(.16,.84,.3,1) forwards}
  @keyframes ring{0%{opacity:.95;transform:scale(.18)}60%{opacity:.5}100%{opacity:0;transform:scale(1)}}
  .dot{position:absolute;left:0;top:0;width:10px;height:10px;margin:-5px 0 0 -5px;border-radius:50%;background:var(--blue);opacity:0;pointer-events:none}
  .dot.go{animation:dot 360ms ease-out forwards}
  @keyframes dot{0%{opacity:.85;transform:scale(.4)}100%{opacity:0;transform:scale(1.7)}}
  #chip{position:absolute;left:0;top:0;display:flex;align-items:center;gap:6px;height:24px;padding:0 10px 0 7px;border-radius:12px;background:rgba(255,255,255,.94);color:#1d2230;border:1px solid rgba(30,111,255,.16);box-shadow:0 6px 18px rgba(14,30,70,.16),0 1px 2px rgba(14,30,70,.12);font:500 11.5px/1 -apple-system,BlinkMacSystemFont,"SF Pro Text","Segoe UI",sans-serif;letter-spacing:.005em;white-space:nowrap;will-change:transform;opacity:0;transition:opacity 180ms ease}
  body.active #chip{opacity:1}
  @media(prefers-color-scheme:dark){#chip{background:rgba(30,32,38,.94);color:#f2f4f8;border-color:rgba(120,165,255,.28)}}
  #ico{position:relative;width:15px;height:15px;flex:none;color:var(--blue);display:grid;place-items:center}
  #ico svg{position:absolute;inset:0;width:15px;height:15px;opacity:0;transform:scale(.6) rotate(-12deg);transition:opacity 160ms ease,transform 260ms cubic-bezier(.3,1.5,.5,1)}
  #ico svg.on{opacity:1;transform:none}
  #ico .spin{animation:spin 1s linear infinite}
  @keyframes spin{to{transform:rotate(360deg)}}
  #txt{display:inline-block;max-width:220px;overflow:hidden;text-overflow:ellipsis}
  #txt.swap{animation:swap 260ms cubic-bezier(.3,1.2,.5,1)}
  @keyframes swap{0%{opacity:0;transform:translateY(5px)}100%{opacity:1;transform:none}}
  #dots{display:none;gap:2px;margin-left:1px}
  body.thinking #dots{display:inline-flex}
  #dots i{width:3px;height:3px;border-radius:50%;background:var(--blue);opacity:.35;animation:pulse 1.1s ease-in-out infinite}
  #dots i:nth-child(2){animation-delay:.16s}#dots i:nth-child(3){animation-delay:.32s}
  @keyframes pulse{0%,100%{opacity:.25;transform:scale(.8)}40%{opacity:1;transform:scale(1.15)}}
  body.thinking #arrow{animation:bob 2.4s ease-in-out infinite}
  @keyframes bob{0%,100%{transform:translateY(0)}50%{transform:translateY(-1.5px)}}
  @media(prefers-reduced-motion:reduce){.ring.go,.dot.go{animation-duration:1ms}#txt.swap{animation:none}body.thinking #arrow,#dots i,body.typing #caret{animation:none}}
</style></head><body>
<div id="rig"><div id="pointer">
  <div class="ring" id="ring"></div><div class="dot" id="dot"></div>
  <svg id="arrow" viewBox="0 0 22 22" aria-hidden="true"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#4b93ff"/><stop offset="1" stop-color="#1e6fff"/></linearGradient></defs><path d="M2.4 2.4 L19.4 8.2 L11.2 11.4 L8.2 19.6 Z" fill="url(#g)" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>
  <div id="caret"></div>
</div>
<div id="chip"><span id="ico"></span><span id="txt"></span><span id="dots"><i></i><i></i><i></i></span></div></div>
<script>
const rig=document.getElementById("rig"),pointer=document.getElementById("pointer"),arrow=document.getElementById("arrow"),chip=document.getElementById("chip"),txt=document.getElementById("txt"),ico=document.getElementById("ico"),ring=document.getElementById("ring"),dot=document.getElementById("dot"),caret=document.getElementById("caret");
const reduced=matchMedia("(prefers-reduced-motion: reduce)").matches;
const ICONS={
  move:'<path d="M5 3l14 7-6 2-2 6z" fill="currentColor"/>',
  click:'<path d="M9 4l9 5-4 1.3L12.2 14z" fill="currentColor"/><path d="M5 5l1.5 1.5M4 9h2M8 3v2" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
  type:'<rect x="3" y="7" width="18" height="10" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M7 11h.01M11 11h.01M15 11h.01M8 14h8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  key:'<rect x="3" y="6" width="18" height="12" rx="3" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M8 12h8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  scroll:'<rect x="7" y="3" width="10" height="18" rx="5" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M12 7v3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  open:'<rect x="4" y="4" width="16" height="16" rx="4" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M9 15l6-6M10 9h5v5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" fill="none"/>',
  search:'<circle cx="10.5" cy="10.5" r="5.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M15 15l5 5" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/>',
  think:'<circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="1.8" stroke-opacity=".25"/><path d="M12 4a8 8 0 0 1 8 8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  verify:'<circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M8.5 12.2l2.4 2.4 4.6-5" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/>',
  done:'<circle cx="12" cy="12" r="9" fill="currentColor"/><path d="M8 12.3l2.8 2.8 5.2-5.6" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
  wait:'<circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M12 8v4.4l3 1.6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>'
};
const iconFor=(kind,label)=>{
  const l=(label||"").toLowerCase();
  if(kind==="think")return"think"; if(kind==="done")return"done"; if(kind==="type")return"type"; if(kind==="key")return"key"; if(kind==="scroll")return"scroll";
  if(/open|launch/.test(l))return"open"; if(/search|find|look/.test(l))return"search"; if(/verif|check|confirm/.test(l))return"verify"; if(/wait/.test(l))return"wait";
  if(kind==="click"||kind==="double_click"||kind==="right_click")return"click"; return"move";
};
const svgs={};
for(const k in ICONS){const s=document.createElementNS("http://www.w3.org/2000/svg","svg");s.setAttribute("viewBox","0 0 24 24");s.innerHTML=ICONS[k];if(k==="think")s.classList.add("spin");ico.appendChild(s);svgs[k]=s;}
let cur={x:-100,y:-100},raf=0,lastLabel="",lastIcon="",pressTimer=0,hideTimer=0;
const ease=t=>t<.5?4*t*t*t:1-Math.pow(-2*t+2,3)/2;
function place(x,y){
  cur.x=x;cur.y=y;
  pointer.style.transform="translate3d("+x+"px,"+y+"px,0)";
  const w=chip.offsetWidth||90,h=24,pad=10;
  let cx=x+16,cy=y+18;
  if(cx+w>innerWidth-pad)cx=x-w-12;
  if(cy+h>innerHeight-pad)cy=y-h-10;
  if(cx<pad)cx=pad; if(cy<pad)cy=pad;
  chip.style.transform="translate3d("+Math.round(cx)+"px,"+Math.round(cy)+"px,0)";
}
function glide(x,y,ms,jump){
  cancelAnimationFrame(raf);
  if(jump||reduced||ms<=0||cur.x<-50){place(x,y);return;}
  const fx=cur.x,fy=cur.y,t0=performance.now();
  const step=now=>{const t=Math.min(1,(now-t0)/ms),e=ease(t);place(fx+(x-fx)*e,fy+(y-fy)*e);if(t<1)raf=requestAnimationFrame(step);};
  raf=requestAnimationFrame(step);
}
function setLabel(text,iconKey){
  if(text!==lastLabel){txt.textContent=text;txt.classList.remove("swap");void txt.offsetWidth;if(lastLabel)txt.classList.add("swap");lastLabel=text;}
  if(iconKey!==lastIcon){for(const k in svgs)svgs[k].classList.toggle("on",k===iconKey);lastIcon=iconKey;}
}
function burst(){
  for(const el of [ring,dot]){el.classList.remove("go");void el.offsetWidth;el.classList.add("go");}
  arrow.classList.add("press");clearTimeout(pressTimer);pressTimer=setTimeout(()=>arrow.classList.remove("press"),150);
}
window.__setAIPresence=(value)=>{
  if(!value){
    document.body.classList.remove("active","typing","thinking");lastLabel="";
    clearTimeout(hideTimer);hideTimer=setTimeout(()=>{cur={x:-100,y:-100};},400);
    return;
  }
  clearTimeout(hideTimer);
  const x=Number(value.x),y=Number(value.y);
  if(!Number.isFinite(x)||!Number.isFinite(y))return;
  const kind=String(value.kind||"move");
  const wasActive=document.body.classList.contains("active");
  document.body.classList.add("active");
  document.body.classList.toggle("typing",kind==="type");
  document.body.classList.toggle("thinking",kind==="think");
  arrow.classList.toggle("hide",kind==="type");
  if(!wasActive&&Number.isFinite(value.fromX)){cur={x:Number(value.fromX),y:Number(value.fromY)};place(cur.x,cur.y);}
  setLabel(String(value.label||"Clyra"),iconFor(kind,value.label));
  if(kind==="click"||kind==="double_click"||kind==="right_click")burst();
  glide(x,y,Number(value.durationMs)||0,Boolean(value.jump));
};
window.__openCluelySetAICursor=window.__setAIPresence;
</script></body></html>`;
