/**
 * Apps people make in Vibe Coder (or import from the Library and then change) that they have added to
 * Clyra's app launcher and Settings. Each carries a "User generated" badge so they are never mistaken
 * for built-in Clyra tools. Stored on this device; the project itself stays in Vibe Coder.
 */
import { useEffect, useState } from "react";

export type UserApp = { id: string; name: string; projectId: string; addedAt: number };

const KEY = "clyra.userApps.v1";
const EVENT = "clyra:user-apps-changed";
export const USER_APP_BADGE = "User generated";
/** The app shell already listens for this event and opens Vibe Coder on the project id in `detail`. */
export const OPEN_PROJECT_EVENT = "clyra:open-vibe-project";

export function readUserApps(): UserApp[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) ?? "[]") as UserApp[];
    return Array.isArray(parsed) ? parsed.filter((app) => app && typeof app.projectId === "string" && typeof app.name === "string") : [];
  } catch {
    return [];
  }
}

function write(apps: UserApp[]) {
  try { localStorage.setItem(KEY, JSON.stringify(apps)); } catch { /* storage unavailable: the change lasts for this session only */ }
  window.dispatchEvent(new CustomEvent(EVENT));
}

export function addUserApp(projectId: string, name: string): void {
  const apps = readUserApps();
  const clean = name.trim().slice(0, 80) || "Untitled app";
  const existing = apps.find((app) => app.projectId === projectId);
  if (existing) { write(apps.map((app) => (app.projectId === projectId ? { ...app, name: clean } : app))); return; }
  write([...apps, { id: `app-${projectId}`, name: clean, projectId, addedAt: Date.now() }]);
}

export function removeUserApp(projectId: string): void {
  write(readUserApps().filter((app) => app.projectId !== projectId));
}

export function isUserApp(projectId: string): boolean {
  return readUserApps().some((app) => app.projectId === projectId);
}

/** Asks the app shell to open Vibe Coder on this project. */
export function requestOpenUserApp(projectId: string): void {
  window.dispatchEvent(new CustomEvent(OPEN_PROJECT_EVENT, { detail: projectId }));
}

export function useUserApps(): UserApp[] {
  const [apps, setApps] = useState<UserApp[]>(() => readUserApps());
  useEffect(() => {
    const refresh = () => setApps(readUserApps());
    window.addEventListener(EVENT, refresh);
    window.addEventListener("storage", refresh);
    return () => { window.removeEventListener(EVENT, refresh); window.removeEventListener("storage", refresh); };
  }, []);
  return apps;
}
