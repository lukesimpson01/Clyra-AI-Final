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
export const TAP_MAX_MS = 700;
export const HOTKEY_LABEL = process.platform === "darwin" ? "Right ⌥ Option" : "Right Alt";

const mac = process.platform === "darwin";
/**
 * Hotkey choices (tray -> "Dictation hotkey"). A "tap" preset toggles dictation when you tap a single
 * modifier key on its own (needs the OS key hook); the global-shortcut combos are the always-available
 * backup and are registered alongside it, so dictation is reachable even if the key hook is blocked.
 */
export const HOTKEY_PRESETS = [
  { id: "right-option", label: `Tap ${mac ? "Right ⌥ Option" : "Right Alt"}`, tap: "AltRight", tapLabel: mac ? "Right ⌥ Option" : "Right Alt", combos: ["Control+Space", "Control+Alt+Space"] },
  { id: "right-command", label: `Tap ${mac ? "Right ⌘ Command" : "Right Win"}`, tap: "MetaRight", tapLabel: mac ? "Right ⌘ Command" : "Right Win", combos: ["Control+Space", "Control+Alt+Space"] },
  { id: "right-control", label: "Tap Right ⌃ Control", tap: "CtrlRight", tapLabel: "Right ⌃ Control", combos: ["Control+Space", "Control+Alt+Space"] },
  { id: "ctrl-space", label: "⌃ Space", tap: null, tapLabel: "", combos: ["Control+Space", "Control+Alt+Space", "Control+Alt+D"] },
  { id: "alt-space", label: mac ? "⌥ Space" : "Alt Space", tap: null, tapLabel: "", combos: ["Alt+Space", "Control+Space", "Control+Alt+Space"] },
];
export const DEFAULT_HOTKEY = "right-option";

/**
 * A "tap" is a clean press-and-release of the key by itself: no other key in between and
 * released within TAP_MAX_MS. Each tap toggles dictation (tap to start, tap to stop). Holding the
 * key, or using it with another key (Option+letter typing), is never mistaken for the hotkey.
 */
export function createTapMachine({ now = () => Date.now(), onTap, onPress = () => {}, onAbort = () => {} }) {
  let downAt = null;
  let dirty = false;
  return {
    press() {
      // Ignore auto-repeat, but never trust a key-down older than 30s: its key-up was lost,
      // and honouring it would lock the hotkey forever.
      if (downAt !== null && now() - downAt < 30_000) return;
      downAt = now();
      dirty = false;
      // Key-down is the earliest signal that dictation may be coming: let the caller open the mic now,
      // so the words you start saying right after the tap are already being recorded.
      onPress();
    },
    release() {
      const held = downAt === null ? Infinity : now() - downAt;
      const clean = !dirty && held <= TAP_MAX_MS;
      downAt = null;
      dirty = false;
      if (clean) onTap(); else if (held !== Infinity) onAbort();
    },
    otherKey() {
      if (downAt !== null && !dirty) { dirty = true; onAbort(); }
    },
    reset() { downAt = null; dirty = false; },
  };
}

/** Starts the OS key hook. Returns a stop() function, or null if unavailable. */
export function startHotkeyListener(machine, log = console, keyName = "AltRight") {
  let hook;
  let keys;
  try {
    ({ uIOhook: hook, UiohookKey: keys } = require("uiohook-napi"));
  } catch (error) {
    log.warn("[flow] key hook unavailable:", error?.message || error);
    return null;
  }
  const target = keys[keyName] ?? keys.AltRight;
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
