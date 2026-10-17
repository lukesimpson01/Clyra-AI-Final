import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

/**
 * Clyra Flow hotkey: the Right Option / Right Alt key on its own.
 *   hold  -> push-to-talk (release inserts the text)
 *   tap   -> hands-free (tap again to finish)
 * Nothing in macOS or Windows binds that key alone, and combining it with any
 * other key (Option+letter typing) cancels the gesture, so normal typing is
 * never hijacked. Needs the OS key-event hook (Input Monitoring on macOS);
 * when that is unavailable the caller falls back to a global-shortcut toggle.
 */
export const HOLD_THRESHOLD_MS = 280;
export const HOTKEY_LABEL = process.platform === "darwin" ? "Right ⌥ Option" : "Right Alt";

export function createGestureMachine({ now = () => Date.now(), onStart, onStop, onCancel, onHandsFree }) {
  let downAt = null;
  let mode = "idle"; // idle | hold | handsfree
  let stopOnRelease = false;
  let swallowRelease = false;
  return {
    get mode() { return mode; },
    press() {
      if (downAt !== null) return; // auto-repeat
      downAt = now();
      if (mode === "handsfree") { mode = "idle"; swallowRelease = true; onStop(); return; }
      mode = "hold"; stopOnRelease = false; swallowRelease = false;
      onStart();
    },
    release() {
      const held = downAt !== null ? now() - downAt : 0;
      downAt = null;
      if (swallowRelease) { swallowRelease = false; return; }
      if (mode !== "hold") return;
      if (held >= HOLD_THRESHOLD_MS) { mode = "idle"; onStop(); return; }
      mode = "handsfree"; onHandsFree?.();
    },
    otherKey() {
      if (downAt !== null && mode === "hold" && now() - downAt < 4000) { mode = "idle"; downAt = null; swallowRelease = false; onCancel(); }
    },
    reset() { mode = "idle"; downAt = null; swallowRelease = false; stopOnRelease = false; },
  };
}

/** Starts the OS key hook. Returns a stop() function, or null if unavailable. */
export function startHotkeyListener(machine, log = console) {
  let hook;
  let keys;
  try {
    ({ uIOhook: hook, UiohookKey: keys } = require("uiohook-napi"));
  } catch (error) {
    log.warn("[flow] key hook unavailable:", error?.message || error);
    return null;
  }
  const target = keys.AltRight;
  hook.on("keydown", (event) => {
    if (event.keycode === target) machine.press();
    else machine.otherKey();
  });
  hook.on("keyup", (event) => { if (event.keycode === target) machine.release(); });
  try {
    hook.start();
  } catch (error) {
    log.warn("[flow] key hook failed to start:", error?.message || error);
    return null;
  }
  return () => { try { hook.removeAllListeners(); hook.stop(); } catch { /* already stopped */ } };
}

/**
 * Instant paste: post Cmd+V (Ctrl+V on Windows) straight to the OS. Spawning
 * osascript/PowerShell for the same keystroke cost several seconds on a busy
 * machine. Returns false when the native module is unavailable so the caller
 * can fall back to the scripted path.
 */
export function pasteWithKeyTap() {
  try {
    const { uIOhook, UiohookKey } = require("uiohook-napi");
    uIOhook.keyTap(UiohookKey.V, [process.platform === "darwin" ? UiohookKey.Meta : UiohookKey.Ctrl]);
    return true;
  } catch {
    return false;
  }
}
