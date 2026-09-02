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
