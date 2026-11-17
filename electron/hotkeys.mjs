/**
 * Clyra's hotkey registry: every global shortcut in one place, each with a default the person can change.
 *
 * - Overrides are kept in userData/hotkeys.json ({ id: "Alt+Cmd+N" | "" }); "" turns a shortcut off.
 * - Changing one re-registers it at once, refuses a combination another Clyra action already owns, and reports one macOS or
 *   another app has taken.
 * - While a new combination is being recorded the shortcuts are suspended, so pressing it does not run the action.
 * - Shortcuts owned by other managers (Flow dictation, the Notch's own hotkeys) are listed read-only so the palette shows
 *   everything in one place.
 */
import { globalShortcut, ipcMain } from "electron";
import { promises as fs } from "node:fs";
import path from "node:path";

export const GROUPS = ["General", "Chat", "Voice", "AI control", "Notch", "App"];

export class HotkeyManager {
  /** @param {{userData: string, actions: Record<string, () => void | Promise<void>>, readonly?: Array<{id:string,label:string,group:string,accelerator:string,note?:string}>}} options */
  constructor({ userData, actions, readonly = [], authorize = () => {} }) {
    this.file = path.join(userData, "hotkeys.json");
    this.actions = actions;
    this.readonly = readonly;
    this.authorize = authorize;
    this.overrides = {};
    this.registered = new Map(); // id -> accelerator actually registered
    this.suspended = false;
    this.registry = [
      { id: "front", label: "Bring Clyra to the front", group: "General", default: "Alt+Space" },
      { id: "hotkeys", label: "Show all hotkeys", group: "General", default: "CommandOrControl+/" },
      { id: "taskview", label: "Task View", group: "General", default: "CommandOrControl+J" },
      { id: "launcher", label: "App launcher", group: "General", default: "CommandOrControl+K" },
      { id: "sidebar", label: "Open or close the chat sidebar", group: "Chat", default: "Alt+B" },
      { id: "newChat", label: "New chat", group: "Chat", default: "Alt+N" },
      { id: "voiceCall", label: "Start or end a voice call", group: "Voice", default: "Alt+V" },
      { id: "callMute", label: "Mute or unmute the call", group: "Voice", default: "Alt+M" },
      { id: "screenShare", label: "Share or stop sharing the screen", group: "Voice", default: "Alt+S" },
      { id: "camera", label: "Turn the camera on or off", group: "Voice", default: "Alt+C" },
      { id: "aiPause", label: "Pause or resume AI control", group: "AI control", default: "Alt+P" },
      { id: "notchToggle", label: "Open or close the Notch", group: "Notch", default: "Alt+O" },
      { id: "notchRestart", label: "Restart the Notch", group: "Notch", default: "Alt+U" },
      { id: "notchQuit", label: "Quit the Notch", group: "Notch", default: "Alt+Q" },
      { id: "reload", label: "Reload Clyra's window", group: "App", default: "Alt+L" },
      { id: "restart", label: "Restart Clyra", group: "App", default: "Alt+R" },
      { id: "devtools", label: "Developer tools", group: "App", default: "Alt+I" },
    ];
  }

  async load() {
    try { this.overrides = JSON.parse(await fs.readFile(this.file, "utf8")) || {}; } catch { this.overrides = {}; }
    this.registerAll();
    this.registerIpc();
  }

  async save() {
    try { await fs.mkdir(path.dirname(this.file), { recursive: true }); await fs.writeFile(this.file, JSON.stringify(this.overrides, null, 1)); } catch { /* best effort */ }
  }

  accelerator(entry) {
    return Object.prototype.hasOwnProperty.call(this.overrides, entry.id) ? this.overrides[entry.id] : entry.default;
  }

  unregisterAll() {
    for (const accelerator of this.registered.values()) { try { globalShortcut.unregister(accelerator); } catch { /* gone */ } }
    this.registered.clear();
  }

  registerAll() {
    this.unregisterAll();
    if (this.suspended) return;
    for (const entry of this.registry) this.registerOne(entry);
  }

  registerOne(entry) {
    const accelerator = this.accelerator(entry);
    if (!accelerator) return false;
    try {
      const ok = globalShortcut.register(accelerator, () => { void Promise.resolve(this.actions[entry.id]?.()).catch((error) => console.warn(`[hotkeys] ${entry.id} failed:`, error?.message || error)); });
      if (ok) this.registered.set(entry.id, accelerator);
      else console.warn(`[hotkeys] ${accelerator} (${entry.label}) is owned by another app.`);
      return ok;
    } catch (error) {
      console.warn(`[hotkeys] cannot register ${accelerator}:`, error?.message || error);
      return false;
    }
  }

  list() {
    const mine = this.registry.map((entry) => ({
      id: entry.id, label: entry.label, group: entry.group, accelerator: this.accelerator(entry), default: entry.default,
      editable: true, active: this.registered.has(entry.id) || !this.accelerator(entry),
    }));
    const others = this.readonly.map((entry) => ({ ...entry, default: entry.accelerator, editable: false, active: true }));
    return [...mine, ...others];
  }

  /** Records a new combination for one action. */
  async set(id, accelerator) {
    const entry = this.registry.find((item) => item.id === id);
    if (!entry) return { ok: false, error: "Unknown hotkey." };
    const next = String(accelerator || "").trim();
    if (next) {
      const clash = this.registry.find((item) => item.id !== id && this.accelerator(item) === next) || this.readonly.find((item) => item.accelerator === next);
      if (clash) return { ok: false, error: `${prettyName(next)} already runs “${clash.label}”.` };
    }
    const previous = this.accelerator(entry);
    this.overrides[id] = next;
    if (this.registered.has(id)) { try { globalShortcut.unregister(this.registered.get(id)); } catch { /* ignore */ } this.registered.delete(id); }
    if (next && !this.suspended && !this.registerOne(entry)) {
      this.overrides[id] = previous;
      this.registerOne(entry);
      return { ok: false, error: `${prettyName(next)} is already used by macOS or another app.` };
    }
    await this.save();
    return { ok: true, hotkeys: this.list() };
  }

  async reset(id) {
    const entry = this.registry.find((item) => item.id === id);
    if (!entry) return { ok: false, error: "Unknown hotkey." };
    delete this.overrides[id];
    this.registerAll();
    await this.save();
    return { ok: true, hotkeys: this.list() };
  }

  suspend(on) {
    this.suspended = Boolean(on);
    if (this.suspended) this.unregisterAll(); else this.registerAll();
  }

  registerIpc() {
    ipcMain.handle("hotkeys:list", (event) => { this.authorize(event); return { ok: true, hotkeys: this.list(), groups: GROUPS }; });
    ipcMain.handle("hotkeys:set", (event, id, accelerator) => { this.authorize(event); return this.set(String(id), String(accelerator ?? "")); });
    ipcMain.handle("hotkeys:reset", (event, id) => { this.authorize(event); return this.reset(String(id)); });
    ipcMain.handle("hotkeys:suspend", (event, on) => { this.authorize(event); this.suspend(Boolean(on)); return { ok: true }; });
  }

  destroy() { this.unregisterAll(); }
}

function prettyName(accelerator) {
  return String(accelerator).replace(/CommandOrControl/g, "⌘").replace(/Command/g, "⌘").replace(/Control/g, "⌃").replace(/Alt/g, "⌥").replace(/Shift/g, "⇧").replace(/\+/g, "");
}
