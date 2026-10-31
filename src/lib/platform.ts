/**
 * OS detection for shortcut labels and platform-specific chrome.
 *
 * The Electron preload bridge exposes the real `process.platform` synchronously
 * (before any page script runs), so the result is authoritative and available
 * at first paint — there is no async resolve, no effect, and therefore no flash
 * of a wrong label. The web app falls back to `navigator.userAgent`.
 */

export type OperatingSystem = "macos" | "windows" | "linux" | "unknown";

function detectOperatingSystem(): OperatingSystem {
  if (typeof window === "undefined") return "unknown";
  const bridge = (window as unknown as { clyraDesktop?: { platform?: string } }).clyraDesktop;
  if (bridge?.platform) {
    if (bridge.platform === "darwin") return "macos";
    if (bridge.platform === "win32") return "windows";
    if (bridge.platform === "linux") return "linux";
  }
  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
  if (/windows/i.test(ua)) return "windows";
  if (/macintosh|mac os x/i.test(ua)) return "macos";
  if (/linux|x11/i.test(ua)) return "linux";
  return "unknown";
}

export const os: OperatingSystem = detectOperatingSystem();
export const isMacOS = os === "macos";
export const isWindows = os === "windows";
export const isLinux = os === "linux";

/** The primary modifier key for the current OS: ⌘ on macOS, Ctrl everywhere else. */
export const modKey = isMacOS ? "⌘" : "Ctrl";

/** Render a shortcut for the current OS — `shortcut("J")` → "⌘ J" / "Ctrl + J". */
export function shortcut(key: string): string {
  return isMacOS ? `⌘ ${key}` : `Ctrl + ${key}`;
}
