/**
 * User-owned app shortcuts for the Clyra launcher. These are pointers to
 * existing Clyra Code projects, never executable source or imported secrets.
 * Keep the radial system launcher fixed; generated apps appear in a separate
 * list and open the same Vibe Coder workspace.
 */
export type GeneratedAppShortcut = { projectId: string; name: string; addedAt: number };
export const GENERATED_APPS_EVENT = "clyra:generated-apps-changed";
const KEY = "clyra-code:generated-apps-v1";
const MAX_APPS = 40;
const VALID_ID = /^[a-zA-Z0-9_-]{1,96}$/;

function safeShortcut(value: unknown): GeneratedAppShortcut | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Partial<GeneratedAppShortcut>;
  if (typeof record.projectId !== "string" || !VALID_ID.test(record.projectId)) return null;
  if (typeof record.name !== "string" || !record.name.trim()) return null;
  return {
    projectId: record.projectId,
    name: record.name.trim().slice(0, 72),
    addedAt: typeof record.addedAt === "number" && Number.isFinite(record.addedAt) ? record.addedAt : 0,
  };
}

export function readGeneratedApps(): GeneratedAppShortcut[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(KEY) || "[]");
    if (!Array.isArray(parsed)) return [];
    const seen = new Set<string>();
    return parsed.map(safeShortcut).filter((entry): entry is GeneratedAppShortcut => {
      if (!entry || seen.has(entry.projectId)) return false;
      seen.add(entry.projectId);
      return true;
    }).slice(0, MAX_APPS);
  } catch {
    return [];
  }
}

export function setGeneratedApp(projectId: string, name: string, enabled: boolean): GeneratedAppShortcut[] {
  if (typeof window === "undefined" || !VALID_ID.test(projectId)) return [];
  let next = readGeneratedApps().filter((item) => item.projectId !== projectId);
  if (enabled) {
    const entry = safeShortcut({ projectId, name, addedAt: Date.now() });
    if (entry) next = [entry, ...next].slice(0, MAX_APPS);
  }
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next));
    window.dispatchEvent(new Event(GENERATED_APPS_EVENT));
  } catch { /* private mode: no persistence; never fail a code task */ }
  return next;
}
