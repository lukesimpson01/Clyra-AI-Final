import { EventEmitter } from "node:events";
import fs from "node:fs";
import path from "node:path";
import { clyraDataPath } from "../runtime-paths";

/**
 * One shared copy of the person's chats, so Clyra's chat and the Notch show the same conversations live.
 * The shape is Clyra's own ChatSession: messages are stored exactly as the chat renders them (agent run, steps, to-dos),
 * so either side can paint a chat the other one wrote.
 */
export type SyncedChat = { id: string; title: string; updatedAt: number; messages: unknown[]; kind?: string; pinned?: boolean; archived?: boolean };
export type ChatSyncChange = { id: string; source: string; updatedAt: number; deleted?: boolean };

const MAX_CHATS = 300;
const MAX_CHAT_BYTES = 4_000_000;
const bus = new EventEmitter();
bus.setMaxListeners(50);
let cache: Map<string, SyncedChat> | null = null;
let writeTimer: NodeJS.Timeout | null = null;

const file = () => clyraDataPath("data", "chat-sync.json");

function load() {
  if (cache) return cache;
  cache = new Map();
  try {
    const rows = JSON.parse(fs.readFileSync(file(), "utf8"));
    if (Array.isArray(rows)) for (const row of rows) if (row && typeof row.id === "string") cache.set(row.id, row);
  } catch { /* first run */ }
  return cache;
}

function persistSoon() {
  if (writeTimer) return;
  writeTimer = setTimeout(() => {
    writeTimer = null;
    try {
      const target = file();
      fs.mkdirSync(path.dirname(target), { recursive: true });
      const temp = `${target}.tmp`;
      fs.writeFileSync(temp, JSON.stringify([...load().values()]), "utf8");
      fs.renameSync(temp, target);
    } catch (error) {
      console.warn("[chat-sync] could not save:", error instanceof Error ? error.message : error);
    }
  }, 400);
}

export function listChatSummaries() {
  return [...load().values()]
    .filter((chat) => chat.kind !== "vibe" && !chat.archived)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map((chat) => ({ id: chat.id, title: chat.title, updatedAt: chat.updatedAt, pinned: Boolean(chat.pinned), count: chat.messages.length }));
}

export const listChats = () => [...load().values()];
export const getChat = (id: string) => load().get(id) ?? null;

export function putChat(chat: SyncedChat, source: string) {
  if (!chat || typeof chat.id !== "string" || !Array.isArray(chat.messages) || typeof chat.updatedAt !== "number") return false;
  if (JSON.stringify(chat).length > MAX_CHAT_BYTES) return false;
  const chats = load();
  const existing = chats.get(chat.id);
  if (existing && existing.updatedAt > chat.updatedAt) return false;
  chats.set(chat.id, chat);
  if (chats.size > MAX_CHATS) {
    const oldest = [...chats.values()].sort((a, b) => a.updatedAt - b.updatedAt)[0];
    if (oldest) chats.delete(oldest.id);
  }
  persistSoon();
  bus.emit("change", { id: chat.id, source, updatedAt: chat.updatedAt } satisfies ChatSyncChange);
  return true;
}

export function deleteChat(id: string, source: string) {
  if (!load().delete(id)) return false;
  persistSoon();
  bus.emit("change", { id, source, updatedAt: Date.now(), deleted: true } satisfies ChatSyncChange);
  return true;
}

export function onChatChange(listener: (change: ChatSyncChange) => void) {
  bus.on("change", listener);
  return () => bus.off("change", listener);
}

/** The person's first name, so the Notch can greet them the way Clyra does. */
const profileFile = () => clyraDataPath("data", "chat-sync-profile.json");
export function getProfileName() {
  try { return String(JSON.parse(fs.readFileSync(profileFile(), "utf8")).name || ""); } catch { return ""; }
}
export function setProfileName(name: string) {
  try {
    fs.mkdirSync(path.dirname(profileFile()), { recursive: true });
    fs.writeFileSync(profileFile(), JSON.stringify({ name: name.slice(0, 60) }), "utf8");
  } catch { /* best effort */ }
}
