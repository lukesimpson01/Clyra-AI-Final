/* Workspace preferences.

   Every setting the Settings panel offers is declared here once, with its
   storage key and its default, and every surface reads it through the same
   two helpers. A setting that is not in this table does not exist — which is
   what stops the panel offering a control that nothing is listening to. */

export const PREFERENCES = {
  /* Appearance */
  density: { key: "clyra-notes:density", fallback: "comfortable" },
  reduceMotion: { key: "clyra-notes:reduce-motion", fallback: "0" },

  /* Defaults applied to newly created notes */
  noteFont: { key: "clyra-notes:default-font", fallback: "default" },
  noteTextSize: { key: "clyra-notes:default-text-size", fallback: "medium" },
  fullWidth: { key: "clyra-notes:full-width-default", fallback: "0" },

  /* Typing behaviour inside the editor */
  spellcheck: { key: "clyra-notes:spellcheck", fallback: "1" },
  markdownShortcuts: { key: "clyra-notes:markdown-shortcuts", fallback: "1" },
  smartMath: { key: "clyra-notes:smart-math", fallback: "1" },
  codeDetection: { key: "clyra-notes:code-detection", fallback: "1" },

  /* The tools rail */
  railAuto: { key: "clyra-notes:rail-auto", fallback: "0" },
  /* An empty value means the rail opens on its list of tools. */
  railPanel: { key: "clyra-notes:rail-panel", fallback: "" },

  /* Study */
  studyLimit: { key: "clyra-notes:study-limit", fallback: "60" },
  studyFlagRating: { key: "clyra-notes:study-flag-rating", fallback: "1" },
};

/* These are the chords owned by Notes itself. Store the portable key names,
   then render the right symbols for macOS or Windows in every surface. */
export const SHORTCUTS = [
  ["commandPalette", "Command palette", "meta+s"],
  ["search", "Search notes", "meta+p"],
  ["newPage", "New note", "meta+n"],
  ["terminal", "Open terminal", "meta+t"],
  ["appLauncher", "App launcher", "meta+k"],
  ["taskView", "Task view", "meta+j"],
  ["toggleSidebar", "Toggle sidebar", "meta+backslash"],
  ["toggleTools", "Toggle tools panel", "meta+shift+backslash"],
  ["closeTab", "Close tab", "meta+w"],
  ["reopenTab", "Reopen closed tab", "meta+shift+t"],
  ["back", "Back", "meta+["],
  ["forward", "Forward", "meta+]"],
];
const SHORTCUT_KEY = "clyra-notes:shortcuts";
const shortcutDefaults = Object.fromEntries(SHORTCUTS.map(([id, , value]) => [id, value]));
const isMac = () => /Mac|iPhone|iPad/.test(navigator.platform || "");
export function readShortcuts() {
  try { return { ...shortcutDefaults, ...(JSON.parse(localStorage.getItem(SHORTCUT_KEY) || "{}") || {}) }; }
  catch { return { ...shortcutDefaults }; }
}
export const shortcutValue = (id) => readShortcuts()[id] || shortcutDefaults[id] || "";
export function shortcutLabel(id) {
  return shortcutValue(id).split("+").map((part) => ({
    meta: isMac() ? "⌘" : "Ctrl", ctrl: "Ctrl", alt: isMac() ? "⌥" : "Alt", shift: "⇧", backslash: "\\",
  }[part] || (part.length === 1 ? part.toUpperCase() : part))).join(" ");
}
export function shortcutMatches(event, id) {
  const parts = shortcutValue(id).split("+");
  const key = parts.at(-1);
  const wantsMeta = parts.includes("meta");
  const wantsShift = parts.includes("shift");
  const wantsAlt = parts.includes("alt");
  const actual = event.key === "\\" ? "backslash" : String(event.key || "").toLowerCase();
  return actual === key && (event.metaKey || event.ctrlKey) === wantsMeta && event.shiftKey === wantsShift && event.altKey === wantsAlt;
}
export function writeShortcut(id, value) {
  const next = readShortcuts(); next[id] = value; localStorage.setItem(SHORTCUT_KEY, JSON.stringify(next));
  window.dispatchEvent(new CustomEvent("clyra:shortcuts", { detail: { id, value } }));
}
export function resetShortcuts() {
  try { localStorage.removeItem(SHORTCUT_KEY); } catch { /* storage may be unavailable */ }
  window.dispatchEvent(new CustomEvent("clyra:shortcuts", { detail: { reset: true } }));
}

export function readPreference(name) {
  const entry = PREFERENCES[name];
  if (!entry) return null;
  try { return localStorage.getItem(entry.key) ?? entry.fallback; } catch { return entry.fallback; }
}

export function writePreference(name, value) {
  const entry = PREFERENCES[name];
  if (!entry) return;
  try { localStorage.setItem(entry.key, String(value)); } catch { /* storage may be unavailable */ }
  window.dispatchEvent(new CustomEvent("clyra:preference", { detail: { name, value } }));
}

export const prefOn = (name) => readPreference(name) === "1";
export const prefNumber = (name) => Number(readPreference(name)) || Number(PREFERENCES[name]?.fallback) || 0;
