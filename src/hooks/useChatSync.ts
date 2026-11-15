import { useEffect, useRef, type Dispatch, type MutableRefObject, type SetStateAction } from "react";

type SyncChat = { id: string; updatedAt: number; messages: any[]; kind?: string };

/**
 * Keeps this window's chats in step with the shared store the Notch also reads and writes. Local edits go up after a short
 * pause (so a streaming reply is one trickle, not a flood); chats the Notch changes come back over server-sent events and
 * replace the local copy only when they are newer, so neither side can overwrite a reply the other is still writing.
 */
export function useChatSync<T extends SyncChat>({
  chats,
  setChats,
  currentChatIdRef,
  setMessages,
  profileName,
}: {
  chats: T[];
  setChats: Dispatch<SetStateAction<T[]>>;
  currentChatIdRef: MutableRefObject<string | null>;
  setMessages: Dispatch<SetStateAction<any[]>>;
  profileName?: string | null;
}) {
  const chatsRef = useRef(chats);
  chatsRef.current = chats;
  const synced = useRef(new Map<string, number>());
  const known = useRef(new Set<string>());
  const timer = useRef<number | null>(null);

  useEffect(() => {
    if (timer.current != null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      timer.current = null;
      const present = new Set<string>();
      for (const chat of chatsRef.current) {
        if (chat.kind === "vibe") continue;
        present.add(chat.id);
        if ((synced.current.get(chat.id) ?? 0) >= chat.updatedAt) continue;
        synced.current.set(chat.id, chat.updatedAt);
        void fetch(`/api/chat-sync/${encodeURIComponent(chat.id)}?source=clyra`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat }),
        }).catch(() => synced.current.delete(chat.id));
      }
      for (const id of known.current) {
        if (present.has(id)) continue;
        synced.current.delete(id);
        void fetch(`/api/chat-sync/${encodeURIComponent(id)}?source=clyra`, { method: "DELETE" }).catch(() => undefined);
      }
      known.current = present;
    }, 600);
    return () => { if (timer.current != null) window.clearTimeout(timer.current); };
  }, [chats]);

  useEffect(() => {
    const name = (profileName || "").trim();
    if (!name) return;
    void fetch("/api/chat-sync-profile", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) }).catch(() => undefined);
  }, [profileName]);

  useEffect(() => {
    let closed = false;
    const apply = (remote: T) => {
      if (closed || !remote?.id || !Array.isArray(remote.messages)) return;
      const local = chatsRef.current.find((chat) => chat.id === remote.id);
      if (local && local.updatedAt >= remote.updatedAt) return;
      synced.current.set(remote.id, remote.updatedAt);
      known.current.add(remote.id);
      setChats((previous) => {
        const without = previous.filter((chat) => chat.id !== remote.id);
        return [remote, ...without].sort((a, b) => b.updatedAt - a.updatedAt);
      });
      if (currentChatIdRef.current === remote.id) setMessages(remote.messages);
    };
    const pull = (id: string) => fetch(`/api/chat-sync/${encodeURIComponent(id)}`).then((r) => (r.ok ? r.json() : null)).then((body) => body?.chat && apply(body.chat)).catch(() => undefined);

    void fetch("/api/chat-sync").then((r) => (r.ok ? r.json() : null)).then((body) => {
      for (const chat of body?.chats ?? []) if (chat.kind !== "vibe") apply(chat);
    }).catch(() => undefined);

    const source = new EventSource("/api/chat-sync/events");
    source.onmessage = (event) => {
      try {
        const change = JSON.parse(event.data) as { id: string; source: string; deleted?: boolean };
        if (change.source === "clyra") return;
        if (change.deleted) { setChats((previous) => previous.filter((chat) => chat.id !== change.id)); return; }
        void pull(change.id);
      } catch { /* ignore a damaged frame */ }
    };
    return () => { closed = true; source.close(); };
  }, [currentChatIdRef, setChats, setMessages]);
}
