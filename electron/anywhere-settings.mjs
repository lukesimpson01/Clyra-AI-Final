/* Persisted setting for Clyra Anywhere — the system-wide background layer
 * (dictation, selected-text AI, the agent overlay). Off by default: turning
 * it on is what changes the window's close button from "quit the app" into
 * "keep the background service running," and that is a real behaviour change
 * a user should opt into, not one a fresh install silently adopts.
 *
 * Stored as a small JSON file under userData, matching every other piece of
 * local state in this app (the browser profile, Google Workspace tokens,
 * local memory) — there is no existing settings-store dependency to reuse,
 * and adding one for a single boolean would be exactly the kind of
 * unnecessary replacement API the brief asks not to introduce.
 */
import fs from "node:fs";
import path from "node:path";

let cache = null;
let filePath = null;

export function initAnywhereSettings(userDataDir) {
  filePath = path.join(userDataDir, "clyra-anywhere.json");
  try {
    cache = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    cache = { enabled: false };
  }
  if (typeof cache.enabled !== "boolean") cache.enabled = false;
  return cache;
}

export function isAnywhereEnabled() {
  return Boolean(cache?.enabled);
}

export function setAnywhereEnabled(value) {
  cache = { ...cache, enabled: Boolean(value) };
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(cache, null, 2), "utf8");
  } catch (error) {
    console.warn("[anywhere] could not persist setting:", error);
  }
  return cache.enabled;
}

/**
 * Clyra Flow background mode: keep the dictation hotkey alive (tray + login
 * item) even when Clyra's window is closed. Independent of "Clyra Anywhere" and
 * on unless the user turns it off.
 */
export function isFlowBackgroundEnabled() {
  return cache?.flowBackground !== false;
}

export function setFlowBackgroundEnabled(value) {
  cache = { ...cache, flowBackground: Boolean(value) };
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(cache, null, 2), "utf8");
  } catch (error) {
    console.warn("[flow] could not persist setting:", error);
  }
  return cache.flowBackground;
}
