import { useSyncExternalStore } from "react";

/**
 * Home-screen data shared by every Clyra app.
 *
 * Activity: any app calls `publishActivity` when something starts, progresses or finishes (a Shorts render, a Vibe Coder
 * task). Entries are keyed, so republishing the same key updates it in place. They persist locally and sync across
 * windows, and the home screen reads them back with `useActivity`.
 *
 * Todos: a small persistent checklist. Items are either typed by the user or accepted from an AI suggestion.
 */

export type ActivityApp = "shorts" | "vibe" | "chat" | "notes" | "browser" | "study" | "agents" | "automation";
export type ActivityStatus = "running" | "done" | "failed";
export type ActivityEntry = {
  key: string;
  app: ActivityApp;
  title: string;
  detail?: string;
  status: ActivityStatus;
  /** 0–100 while running, when the app knows it. */
  progress?: number;
  startedAt: number;
  updatedAt: number;
  /** Set once the user has seen it finish on the home screen. */
  seen?: boolean;
};

export type TodoItem = { id: string; text: string; done: boolean; ai?: boolean; createdAt: number; doneAt?: number };

const ACTIVITY_KEY = "clyra-activity-v1";
const TODO_KEY = "clyra-todos-v1";
const ACTIVITY_CAP = 40;
const STALE_RUNNING_MS = 6 * 60 * 60 * 1000;

function makeStore<T>(storageKey: string, initial: T, normalise: (value: unknown) => T) {
  let value: T = initial;
  let loaded = false;
  const listeners = new Set<() => void>();
  const read = () => {
    try {
      const raw = window.localStorage.getItem(storageKey);
      value = raw ? normalise(JSON.parse(raw)) : initial;
    } catch { value = initial; }
  };
  const ensure = () => { if (!loaded && typeof window !== "undefined") { loaded = true; read(); } };
  const emit = () => listeners.forEach((l) => l());
  if (typeof window !== "undefined") {
    window.addEventListener("storage", (event) => { if (event.key === storageKey) { read(); emit(); } });
  }
  return {
    get: () => { ensure(); return value; },
    set: (next: T) => {
      ensure();
      value = next;
      try { window.localStorage.setItem(storageKey, JSON.stringify(next)); } catch { /* storage unavailable: stay in memory */ }
      emit();
    },
    subscribe: (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; },
  };
}

const activityStore = makeStore<ActivityEntry[]>(ACTIVITY_KEY, [], (raw) => {
  const now = Date.now();
  return (Array.isArray(raw) ? raw : [])
    .filter((e): e is ActivityEntry => !!e && typeof e.key === "string" && typeof e.title === "string")
    // A run that was "running" when the app closed can never report back; don't show it as live forever.
    .map((e) => (e.status === "running" && now - e.updatedAt > STALE_RUNNING_MS ? { ...e, status: "failed" as const, detail: "Interrupted" } : e))
    .slice(0, ACTIVITY_CAP);
});

export function publishActivity(entry: Pick<ActivityEntry, "key" | "app" | "title"> & Partial<Pick<ActivityEntry, "detail" | "status" | "progress">>) {
  const now = Date.now();
  const list = activityStore.get();
  const existing = list.find((e) => e.key === entry.key);
  const status = entry.status ?? existing?.status ?? "running";
  const next: ActivityEntry = {
    key: entry.key,
    app: entry.app,
    title: entry.title || existing?.title || "Task",
    detail: entry.detail ?? (status !== existing?.status ? undefined : existing?.detail),
    status,
    progress: status === "running" ? (entry.progress ?? existing?.progress) : undefined,
    startedAt: existing?.startedAt ?? now,
    updatedAt: now,
    seen: status === "running" ? false : existing?.status === status ? existing?.seen : false,
  };
  activityStore.set([next, ...list.filter((e) => e.key !== entry.key)].slice(0, ACTIVITY_CAP));
}

export function dismissActivity(key: string) {
  activityStore.set(activityStore.get().filter((e) => e.key !== key));
}

export function clearFinishedActivity() {
  activityStore.set(activityStore.get().filter((e) => e.status === "running"));
}

export function useActivity(): ActivityEntry[] {
  return useSyncExternalStore(activityStore.subscribe, activityStore.get, activityStore.get);
}

const todoStore = makeStore<TodoItem[]>(TODO_KEY, [], (raw) =>
  (Array.isArray(raw) ? raw : []).filter((t): t is TodoItem => !!t && typeof t.id === "string" && typeof t.text === "string").slice(0, 200),
);

const newId = () => `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export const todos = {
  add(text: string, ai = false) {
    const clean = text.replace(/\s+/g, " ").trim().slice(0, 140);
    if (!clean) return;
    const list = todoStore.get();
    if (list.some((t) => !t.done && t.text.toLowerCase() === clean.toLowerCase())) return;
    todoStore.set([{ id: newId(), text: clean, done: false, ai, createdAt: Date.now() }, ...list]);
  },
  toggle(id: string) {
    todoStore.set(todoStore.get().map((t) => (t.id === id ? { ...t, done: !t.done, doneAt: t.done ? undefined : Date.now() } : t)));
  },
  remove(id: string) {
    todoStore.set(todoStore.get().filter((t) => t.id !== id));
  },
  clearDone() {
    todoStore.set(todoStore.get().filter((t) => !t.done));
  },
};

export function useTodos(): TodoItem[] {
  return useSyncExternalStore(todoStore.subscribe, todoStore.get, todoStore.get);
}

export function timeAgo(ts: number, now = Date.now()) {
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hr ago`;
  const d = Math.round(h / 24);
  return d === 1 ? "yesterday" : `${d} days ago`;
}

export function ordinalDate(date: Date) {
  const day = date.getDate();
  const suffix = day % 100 >= 11 && day % 100 <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[day % 10] ?? "th";
  const weekday = date.toLocaleDateString("en-GB", { weekday: "long" });
  const month = date.toLocaleDateString("en-GB", { month: "long" });
  return `${weekday} ${day}${suffix} ${month}`;
}
