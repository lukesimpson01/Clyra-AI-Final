/* Workspace state: the page cache, the tab strip, autosave and undo.

   Edits apply to the local cache first and persist on a debounce, so typing
   never waits on the network and navigating away cannot lose a keystroke. */
import { api } from "./api.js";
import { toast } from "./dom.js";

const listeners = new Set();
export const subscribe = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
export const emit = (reason) => listeners.forEach((fn) => fn(reason));

export const state = {
  pages: [],
  pageById: new Map(),
  classes: [],
  decks: [],
  tests: [],
  study: { due: 0, total: 0, reviewedToday: 0 },
  inbox: [],
  trashCount: 0,
  aiConfigured: false,
  ready: false,

  view: { kind: "home" },
  tabs: [],
  activeTab: null,
  closedTabs: [],

  open: new Map(),        // pageId -> loaded page with blocks
  expanded: new Set(),
  collapsedSections: new Set(),
  sidebarWidth: 300,
  sidebarHidden: false,
  saveStatus: "idle",     // idle | saving | saved | offline | error
};

let tabSeed = 1;
const newTabId = () => `t${Date.now().toString(36)}${tabSeed++}`;

const persisted = {
  read(key, fallback) {
    try { const raw = localStorage.getItem(`clyra-notes:${key}`); return raw ? JSON.parse(raw) : fallback; }
    catch { return fallback; }
  },
  write(key, value) {
    try { localStorage.setItem(`clyra-notes:${key}`, JSON.stringify(value)); } catch { /* private mode */ }
  },
};

export function restoreSession() {
  state.sidebarWidth = persisted.read("sidebarWidth", 300);
  state.sidebarHidden = persisted.read("sidebarHidden", false);
  state.expanded = new Set(persisted.read("expanded", []));
  state.collapsedSections = new Set(persisted.read("collapsedSections", []));
  /* Notes always opens on Home. Previously open pages are kept as tabs to
     the right of it, so nothing is lost, but the landing surface is
     predictable rather than wherever the last session happened to stop. */
  const session = persisted.read("session", null);
  const home = { id: newTabId(), kind: "home" };
  const restored = (session?.tabs || [])
    .filter((tab) => tab && tab.kind && tab.kind !== "home")
    .slice(0, 8);
  state.tabs = [home, ...restored];
  state.activeTab = home.id;
}

export function saveSession() {
  persisted.write("session", { tabs: state.tabs, activeTab: state.activeTab });
  persisted.write("expanded", [...state.expanded]);
  persisted.write("collapsedSections", [...state.collapsedSections]);
  persisted.write("sidebarWidth", state.sidebarWidth);
  persisted.write("sidebarHidden", state.sidebarHidden);
}

export function indexPages(pages) {
  state.pages = pages;
  state.pageById = new Map(pages.map((page) => [String(page.id), page]));
}

export const getPageMeta = (id) => state.pageById.get(String(id));
export const childrenOf = (parentId) =>
  state.pages
    .filter((page) => String(page.parent_id ?? "") === String(parentId ?? "") && page.kind !== "record")
    .sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0));
export const hasChildren = (id) => state.pages.some((page) => String(page.parent_id ?? "") === String(id) && page.kind !== "record");

export async function loadWorkspace() {
  const data = await api.get("/api/notes/bootstrap");
  indexPages(data.pages || []);
  state.classes = data.classes || [];
  state.decks = data.decks || [];
  state.tests = data.tests || [];
  state.study = data.study || state.study;
  state.inbox = data.inbox || [];
  state.trashCount = data.trash || 0;
  state.aiConfigured = Boolean(data.ai);
  state.ready = true;
  emit("workspace");
}

export async function refreshPages() {
  indexPages(await api.get("/api/notes/pages"));
  emit("pages");
}

/* ------------------------------------------------------------- tabs */


export const activeTab = () => state.tabs.find((tab) => tab.id === state.activeTab) || null;

export function openTab(target, { newTab = false, background = false } = {}) {
  const current = activeTab();
  if (!newTab && current) {
    Object.assign(current, target, { id: current.id });
    state.activeTab = current.id;
  } else {
    const tab = { id: newTabId(), ...target };
    const index = current ? state.tabs.indexOf(current) + 1 : state.tabs.length;
    state.tabs.splice(index, 0, tab);
    if (!background) state.activeTab = tab.id;
  }
  saveSession();
  emit("tabs");
}

export function closeTab(id) {
  const index = state.tabs.findIndex((tab) => tab.id === id);
  if (index === -1) return;
  const [removed] = state.tabs.splice(index, 1);
  state.closedTabs.push(removed);
  if (state.closedTabs.length > 12) state.closedTabs.shift();
  if (state.activeTab === id) state.activeTab = (state.tabs[index] || state.tabs[index - 1] || null)?.id ?? null;
  if (!state.tabs.length) openTab({ kind: "home" }, { newTab: true });
  saveSession();
  emit("tabs");
}

export function reopenTab() {
  const tab = state.closedTabs.pop();
  if (!tab) return;
  state.tabs.push({ ...tab, id: newTabId() });
  state.activeTab = state.tabs[state.tabs.length - 1].id;
  saveSession();
  emit("tabs");
}

export function selectTab(id) {
  if (state.activeTab === id) return;
  state.activeTab = id;
  saveSession();
  emit("tabs");
}

export function moveTab(id, toIndex) {
  const from = state.tabs.findIndex((tab) => tab.id === id);
  if (from === -1) return;
  const [tab] = state.tabs.splice(from, 1);
  state.tabs.splice(Math.max(0, Math.min(toIndex, state.tabs.length)), 0, tab);
  saveSession();
  emit("tabs");
}

export function cycleTab(direction) {
  if (state.tabs.length < 2) return;
  const index = state.tabs.findIndex((tab) => tab.id === state.activeTab);
  selectTab(state.tabs[(index + direction + state.tabs.length) % state.tabs.length].id);
}

/* ------------------------------------------------------- page loading */

export async function loadPage(id, { force = false } = {}) {
  const key = String(id);
  if (!force && state.open.has(key)) return state.open.get(key);
  const page = await api.get(`/api/notes/pages/${key}`);
  state.open.set(key, page);
  return page;
}

export const cachedPage = (id) => state.open.get(String(id)) || null;
export const dropPage = (id) => state.open.delete(String(id));

/* ------------------------------------------------------------ saving */

const pending = new Map();     // pageId -> { timer, blocks, meta }
let inflight = 0;

const setStatus = (status) => {
  if (state.saveStatus === status) return;
  state.saveStatus = status;
  emit("save-status");
};

/* Two seconds of quiet before writing. Long enough that a paragraph is one
   write, short enough that a crash costs at most a sentence. */
const SAVE_DELAY = 900;

export function queueBlockSave(pageId, blocks) {
  const key = String(pageId);
  const entry = pending.get(key) || {};
  entry.blocks = blocks;
  clearTimeout(entry.timer);
  entry.timer = setTimeout(() => flushPage(key), SAVE_DELAY);
  pending.set(key, entry);
  setStatus("saving");
}

export function queueMetaSave(pageId, patch) {
  const key = String(pageId);
  const entry = pending.get(key) || {};
  entry.meta = { ...(entry.meta || {}), ...patch };
  clearTimeout(entry.timer);
  entry.timer = setTimeout(() => flushPage(key), SAVE_DELAY);
  pending.set(key, entry);
  setStatus("saving");
}

export async function flushPage(pageId) {
  const key = String(pageId);
  const entry = pending.get(key);
  if (!entry) return;
  clearTimeout(entry.timer);
  pending.delete(key);
  const { blocks, meta } = entry;
  inflight += 1;
  setStatus("saving");
  try {
    if (meta) {
      const updated = await api.patch(`/api/notes/pages/${key}`, meta);
      const cached = state.pageById.get(key);
      if (cached) Object.assign(cached, meta.title !== undefined ? { title: meta.title } : {}, meta.icon !== undefined ? { icon: meta.icon } : {}, meta);
      const open = state.open.get(key);
      if (open && updated) Object.assign(open, { ...updated, blocks: open.blocks });
      emit("pages");
    }
    if (blocks) await api.put(`/api/notes/pages/${key}/blocks`, { blocks });
    inflight -= 1;
    if (!inflight && !pending.size) { setStatus("saved"); setTimeout(() => setStatus("idle"), 1600); }
  } catch (error) {
    inflight -= 1;
    /* The edit stays in memory and is retried, so the user's text is never
       discarded because a save failed. */
    pending.set(key, { ...entry, timer: setTimeout(() => flushPage(key), 5000) });
    setStatus(error.status === 0 ? "offline" : "error");
  }
}

export const flushAll = () => Promise.all([...pending.keys()].map(flushPage));
export const hasUnsaved = () => pending.size > 0 || inflight > 0;

window.addEventListener("beforeunload", (event) => {
  if (!hasUnsaved()) return;
  flushAll();
  event.preventDefault();
  event.returnValue = "";
});

/* Saving on hide is what makes closing the window or switching apps safe. */
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") flushAll(); });

export async function withError(work, message) {
  try { return await work(); }
  catch (error) { toast(error?.message || message || "Something went wrong", "error"); return null; }
}
