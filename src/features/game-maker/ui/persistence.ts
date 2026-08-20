/**
 * Project persistence (spec §139, §140, §144).
 *
 * Server-backed through the existing project API, with IndexedDB as the
 * local cache so a reload restores instantly and an offline session is not
 * lost. Large projects never go into localStorage.
 */
import type { GameProjectIR } from "../ir/types";

const DB_NAME = "clyra-game-maker";
const STORE = "projects";
const LAST_KEY = "__last";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB is unavailable."));
  });
}

async function withStore<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const transaction = db.transaction(STORE, mode);
    const request = run(transaction.objectStore(STORE));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("The local project cache failed."));
    transaction.oncomplete = () => db.close();
  });
}

const SERVER_ROOT = "/api/game-maker/projects";

/** Write-through: IndexedDB first (never fails the edit), then the server. */
export async function storeProject(project: GameProjectIR) {
  try {
    await withStore("readwrite", (store) => store.put(project, project.projectId));
    await withStore("readwrite", (store) => store.put(project.projectId, LAST_KEY));
  } catch {
    // A private-mode browser with no IndexedDB must not break editing.
  }
  try {
    await fetch(`${SERVER_ROOT}/${encodeURIComponent(project.projectId)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(project),
    });
  } catch {
    // Offline: the local copy is authoritative until the next successful save.
  }
}

export async function loadStoredProject(): Promise<GameProjectIR | null> {
  let lastId: string | undefined;
  try {
    lastId = await withStore<string>("readonly", (store) => store.get(LAST_KEY) as IDBRequest<string>);
  } catch {
    lastId = undefined;
  }
  if (!lastId) return null;

  // Prefer the server copy when it is newer (another tab or machine).
  try {
    const response = await fetch(`${SERVER_ROOT}/${encodeURIComponent(lastId)}`);
    if (response.ok) {
      const remote = (await response.json()) as GameProjectIR;
      const local = await withStore<GameProjectIR | undefined>("readonly", (store) => store.get(lastId!) as IDBRequest<GameProjectIR | undefined>).catch(() => undefined);
      if (!local || (remote?.metadata?.updatedAt ?? 0) >= (local.metadata?.updatedAt ?? 0)) return remote;
      return local;
    }
  } catch {
    // Fall through to the local copy.
  }

  try {
    return (await withStore<GameProjectIR | undefined>("readonly", (store) => store.get(lastId!) as IDBRequest<GameProjectIR | undefined>)) ?? null;
  } catch {
    return null;
  }
}

export async function listStoredProjects(): Promise<{ id: string; name: string; updatedAt: number; mode: string }[]> {
  try {
    const response = await fetch(SERVER_ROOT);
    if (response.ok) return (await response.json()) as { id: string; name: string; updatedAt: number; mode: string }[];
  } catch {
    // Fall through to the local cache.
  }
  try {
    const db = await openDb();
    return await new Promise((resolve) => {
      const transaction = db.transaction(STORE, "readonly");
      const request = transaction.objectStore(STORE).getAll();
      request.onsuccess = () => {
        const projects = (request.result as unknown[]).filter((entry): entry is GameProjectIR => typeof entry === "object" && entry !== null && "projectId" in entry);
        resolve(projects.map((project) => ({ id: project.projectId, name: project.metadata.name, updatedAt: project.metadata.updatedAt, mode: project.runtime.mode })));
      };
      request.onerror = () => resolve([]);
      transaction.oncomplete = () => db.close();
    });
  } catch {
    return [];
  }
}

export async function loadProjectById(projectId: string): Promise<GameProjectIR | null> {
  try {
    const response = await fetch(`${SERVER_ROOT}/${encodeURIComponent(projectId)}`);
    if (response.ok) return (await response.json()) as GameProjectIR;
  } catch {
    // Fall through.
  }
  try {
    return (await withStore<GameProjectIR | undefined>("readonly", (store) => store.get(projectId) as IDBRequest<GameProjectIR | undefined>)) ?? null;
  } catch {
    return null;
  }
}

export async function forgetLastProject() {
  try {
    await withStore("readwrite", (store) => store.delete(LAST_KEY));
  } catch {
    // Nothing to forget.
  }
}
