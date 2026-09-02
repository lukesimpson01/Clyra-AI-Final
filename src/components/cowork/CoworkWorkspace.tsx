import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Check, Monitor, Plus, Search, X } from "lucide-react";
import { cn } from "../../lib/utils";

/**
 * Clyra Cowork — conversations with a team of persistent AI workers.
 *
 * Presentation only. Every reply, permission check and handoff is decided by
 * the server (lib/bots/*); this component sends a message and renders what
 * comes back, which is what keeps the security guarantees in one enforceable
 * place instead of duplicated in UI state that can drift.
 */

type BotStatus = "idle" | "thinking" | "browsing" | "coding" | "waiting" | "needs_approval" | "done" | "error";

type Participant = { id: string; name: string; avatar: string; status: BotStatus };

type Bot = {
  id: string;
  name: string;
  slug: string;
  role: string;
  avatar: string;
  status: BotStatus;
  permissions: { granted: string[]; canMessage: "all" | "none" | string[] };
};

type Conversation = {
  id: string;
  title: string;
  botIds: string[];
  isGroup: boolean;
  lastMessage: string;
  lastMessageAt: string | null;
  unread: number;
  participants: Participant[];
};

type Message = {
  id: string;
  author: "user" | "bot" | "system";
  botId: string | null;
  botName: string | null;
  text: string;
  at: string;
};

/** Stable per-bot colour, so an avatar looks the same everywhere it appears. */
const AVATAR_COLOURS = [
  "#2bb3a3", "#f0932b", "#8b7bf7", "#7c6cf6", "#3b82f6", "#e8590c", "#16a34a", "#db2777",
];
const colourFor = (seed: string) => {
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) hash = (hash * 31 + seed.charCodeAt(index)) >>> 0;
  return AVATAR_COLOURS[hash % AVATAR_COLOURS.length];
};

const clockTime = (iso: string | null) => {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const today = new Date();
  const sameDay = date.toDateString() === today.toDateString();
  if (sameDay) return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return "Yesterday";
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
};

function Avatar({ name, avatar, size = 34, dot }: { name: string; avatar?: string; size?: number; dot?: boolean }) {
  return (
    <span className="relative inline-flex shrink-0" style={{ width: size, height: size }}>
      <span
        className="grid h-full w-full place-items-center rounded-full text-white"
        style={{ background: colourFor(name), fontSize: size * 0.44 }}
      >
        {avatar || name.slice(0, 1).toUpperCase()}
      </span>
      {dot ? <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border-2 border-white bg-[#ef4444]" /> : null}
    </span>
  );
}

/** Overlapping avatars for a group row, mirroring the reference layout. */
function GroupAvatar({ participants, size = 34 }: { participants: Participant[]; size?: number }) {
  const shown = participants.slice(0, 3);
  const inner = size * 0.62;
  return (
    <span className="relative shrink-0" style={{ width: size, height: size }}>
      {shown.map((participant, index) => (
        <span
          key={participant.id}
          className="absolute grid place-items-center rounded-full border-2 border-white text-white"
          style={{
            width: inner, height: inner, fontSize: inner * 0.44,
            background: colourFor(participant.name),
            left: index === 0 ? 0 : index === 1 ? size - inner : (size - inner) / 2,
            top: index === 2 ? size - inner : 0,
            zIndex: index,
          }}
        >
          {participant.avatar || participant.name.slice(0, 1).toUpperCase()}
        </span>
      ))}
    </span>
  );
}

export function CoworkWorkspace() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [bots, setBots] = useState<Bot[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [participants, setParticipants] = useState<Bot[]>([]);
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [composing, setComposing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const active = useMemo(
    () => conversations.find((conversation) => conversation.id === activeId) ?? null,
    [conversations, activeId],
  );

  const loadSidebar = useCallback(async () => {
    try {
      const [threadResponse, botResponse] = await Promise.all([
        fetch("/api/cowork/conversations", { cache: "no-store" }),
        fetch("/api/bots", { cache: "no-store" }),
      ]);
      const threads = await threadResponse.json();
      const botPayload = await botResponse.json();
      if (!threads?.ok) throw new Error(threads?.error || "Could not load conversations.");
      setConversations(threads.conversations);
      if (botPayload?.ok) setBots(botPayload.bots);
      setError(null);
      setActiveId((current) => current ?? threads.conversations[0]?.id ?? null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load Cowork.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadSidebar(); }, [loadSidebar]);

  const loadThread = useCallback(async (id: string) => {
    try {
      const response = await fetch(`/api/cowork/conversations/${id}`, { cache: "no-store" });
      const payload = await response.json();
      if (!payload?.ok) throw new Error(payload?.error || "Could not open that conversation.");
      setMessages(payload.messages);
      setParticipants(payload.participants);
      // Opening clears the unread badge server-side; mirror it immediately.
      setConversations((current) => current.map((item) => item.id === id ? { ...item, unread: 0 } : item));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not open that conversation.");
    }
  }, []);

  useEffect(() => {
    if (!activeId) { setMessages([]); setParticipants([]); return; }
    void loadThread(activeId);
  }, [activeId, loadThread]);

  useEffect(() => {
    const node = scrollRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [messages.length, sending]);

  const send = async () => {
    const text = draft.trim();
    if (!text || !activeId || sending) return;
    setDraft("");
    setSending(true);
    // Optimistic echo so the thread never feels like it swallowed the message.
    const optimistic: Message = {
      id: `pending-${Date.now()}`, author: "user", botId: null, botName: null,
      text, at: new Date().toISOString(),
    };
    setMessages((current) => [...current, optimistic]);
    try {
      const response = await fetch(`/api/cowork/conversations/${activeId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const payload = await response.json();
      if (!payload?.ok) throw new Error(payload?.error || "Could not send that message.");
      setMessages(payload.messages);
      void loadSidebar();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not send that message.");
      setMessages((current) => current.filter((message) => message.id !== optimistic.id));
      setDraft(text);
    } finally {
      setSending(false);
    }
  };

  const visible = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return conversations;
    return conversations.filter((conversation) =>
      `${conversation.title} ${conversation.lastMessage}`.toLowerCase().includes(term));
  }, [conversations, query]);

  const thinking = participants.filter((bot) => bot.status === "thinking");

  return (
    <div className="flex h-full min-h-0 overflow-hidden bg-white">
      {/* ── Sidebar ─────────────────────────────────────────────── */}
      <aside className="flex w-[288px] shrink-0 flex-col border-r border-slate-200/70 bg-white">
        <div className="flex items-center justify-end px-4 pb-2 pt-3.5">
          <button
            type="button"
            onClick={() => setComposing(true)}
            aria-label="New message"
            className="grid h-8 w-8 place-items-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900"
          >
            <Plus className="h-[18px] w-[18px]" />
          </button>
        </div>

        <div className="px-4 pb-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search"
              aria-label="Search conversations"
              className="h-10 w-full rounded-xl border border-slate-200 bg-white pl-9 pr-3 text-[13.5px] text-slate-800 outline-none transition-colors placeholder:text-slate-400 focus:border-slate-300"
            />
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
          {loading ? (
            <div className="grid gap-1 px-2">
              {[0, 1, 2, 3].map((key) => <div key={key} className="h-[58px] animate-pulse rounded-xl bg-slate-100" />)}
            </div>
          ) : visible.length === 0 ? (
            <p className="px-3 py-8 text-center text-[12.5px] leading-5 text-slate-400">
              {conversations.length ? "Nothing matches that search." : "No conversations yet."}
            </p>
          ) : (
            visible.map((conversation) => {
              const isActive = conversation.id === activeId;
              const busy = conversation.participants.some((participant) =>
                ["thinking", "browsing", "coding"].includes(participant.status));
              return (
                <button
                  key={conversation.id}
                  type="button"
                  onClick={() => setActiveId(conversation.id)}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-xl px-2.5 py-2.5 text-left transition-colors",
                    isActive ? "bg-slate-100" : "hover:bg-slate-50",
                  )}
                >
                  {conversation.isGroup
                    ? <GroupAvatar participants={conversation.participants} />
                    : (
                      <Avatar
                        name={conversation.participants[0]?.name || conversation.title}
                        avatar={conversation.participants[0]?.avatar}
                        dot={conversation.unread > 0}
                      />
                    )}
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline gap-2">
                      <span className="min-w-0 flex-1 truncate text-[14px] font-semibold tracking-[-.01em] text-slate-900">
                        {conversation.title}
                      </span>
                      <span className="shrink-0 text-[11.5px] tabular-nums text-slate-400">
                        {clockTime(conversation.lastMessageAt)}
                      </span>
                    </span>
                    <span className="mt-0.5 block truncate text-[12.5px] text-slate-500">
                      {busy ? "Typing…" : conversation.lastMessage || "No messages yet"}
                    </span>
                  </span>
                </button>
              );
            })
          )}
        </div>

        <div className="flex items-center gap-2.5 border-t border-slate-200/70 px-4 py-3">
          <span className="grid h-8 w-8 place-items-center rounded-full bg-slate-100 text-[11px] font-semibold text-slate-600">
            YOU
          </span>
          <span className="truncate text-[13.5px] font-medium text-slate-800">Your team</span>
        </div>
      </aside>

      {/* ── Thread ──────────────────────────────────────────────── */}
      <section className="flex min-w-0 flex-1 flex-col bg-white">
        {active ? (
          <>
            <header className="flex shrink-0 items-center gap-2.5 border-b border-slate-200/70 px-5 py-3">
              {active.isGroup
                ? <GroupAvatar participants={active.participants} size={26} />
                : <Avatar name={active.participants[0]?.name || active.title} avatar={active.participants[0]?.avatar} size={26} />}
              <p className="min-w-0 flex-1 truncate text-[14.5px] font-semibold tracking-[-.01em] text-slate-900">
                {active.title}
              </p>
              <button
                type="button"
                aria-label="View screen"
                title="Watch this bot work"
                className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
              >
                <Monitor className="h-[18px] w-[18px]" />
              </button>
            </header>

            <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
              <div className="mx-auto flex w-full max-w-[720px] flex-col gap-3">
                {messages.length === 0 ? (
                  <p className="py-10 text-center text-[13px] text-slate-400">
                    Say hello to {active.isGroup ? "the group" : active.title}.
                  </p>
                ) : (
                  messages.map((message, index) => {
                    const previous = messages[index - 1];
                    const showTime = index === 0
                      || Date.parse(message.at) - Date.parse(previous?.at ?? message.at) > 5 * 60_000;

                    if (message.author === "system") {
                      return (
                        <div key={message.id} className="flex flex-col items-center gap-2">
                          {showTime ? <TimeDivider at={message.at} /> : null}
                          <p className="text-[12.5px] text-slate-400">{message.text}</p>
                        </div>
                      );
                    }

                    const isUser = message.author === "user";
                    return (
                      <div key={message.id} className="flex flex-col gap-2">
                        {showTime ? <TimeDivider at={message.at} /> : null}
                        <div className={cn("flex w-full", isUser ? "justify-end" : "justify-start")}>
                          {isUser ? (
                            <div className="clyra-chat-user-bubble max-w-[85%] whitespace-pre-wrap rounded-[24px] border border-slate-200/70 px-5 py-3.5 text-[14px] leading-[22px] text-[#172033] shadow-none sm:max-w-[75%]">
                              {message.text}
                            </div>
                          ) : (
                            <div className="max-w-[90%] sm:max-w-[80%]">
                              {/* The speaker's name only matters when more than
                                  one bot can be talking. */}
                              {active.isGroup && message.botName ? (
                                <p className="mb-1 text-[11.5px] font-semibold" style={{ color: colourFor(message.botName) }}>
                                  {message.botName}
                                </p>
                              ) : null}
                              <p className="whitespace-pre-wrap text-[14px] leading-[22px] text-[#303136]">{message.text}</p>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}

                {sending ? (
                  <div className="flex items-center gap-2.5 pt-1">
                    <ThinkingDots />
                    <span className="text-[13px] text-slate-500">
                      {thinking.length ? `${thinking.map((bot) => bot.name).join(", ")} thinking` : "Thinking"}
                    </span>
                  </div>
                ) : null}
              </div>
            </div>

            {error ? (
              <p className="mx-6 mb-2 rounded-xl bg-rose-50 px-3 py-2 text-[12px] text-rose-700">{error}</p>
            ) : null}

            <div className="shrink-0 px-6 pb-5">
              <div className="mx-auto flex w-full max-w-[720px] items-center gap-2 rounded-[26px] border border-slate-200/80 bg-white px-3 py-2 shadow-[0_1px_2px_rgba(15,23,42,.04)]">
                <button
                  type="button"
                  aria-label="Add attachment"
                  className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-slate-100 text-slate-500 transition-colors hover:bg-slate-200 hover:text-slate-700"
                >
                  <Plus className="h-4 w-4" />
                </button>
                <textarea
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      void send();
                    }
                  }}
                  rows={1}
                  placeholder={`Message ${active.title}`}
                  aria-label={`Message ${active.title}`}
                  className="max-h-[140px] min-h-[24px] flex-1 resize-none bg-transparent py-2 text-[14px] leading-[22px] text-slate-800 outline-none placeholder:text-slate-400"
                />
                <button
                  type="button"
                  onClick={() => void send()}
                  disabled={!draft.trim() || sending}
                  aria-label="Send message"
                  className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[#4169f6] text-white transition-all hover:bg-[#3158ea] active:scale-[.96] disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400"
                >
                  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 19V5M5 12l7-7 7 7" />
                  </svg>
                </button>
              </div>
              {active.isGroup ? (
                <p className="mx-auto mt-2 w-full max-w-[720px] text-[11.5px] text-slate-400">
                  Everyone replies. Use @Name to ask just one of them.
                </p>
              ) : null}
            </div>
          </>
        ) : !loading ? (
          <div className="grid flex-1 place-items-center px-6">
            <div className="max-w-[380px] text-center">
              <p className="text-[17px] font-semibold tracking-[-.02em] text-slate-900">Message your team</p>
              <p className="mt-1.5 text-[13px] leading-5 text-slate-500">
                Start a conversation with one worker, or put several in a group and let them
                work it out between themselves.
              </p>
              <button
                type="button"
                onClick={() => setComposing(true)}
                className="mt-4 h-10 rounded-xl bg-[#4169f6] px-4 text-[13.5px] font-medium text-white transition-colors hover:bg-[#3158ea]"
              >
                New message
              </button>
            </div>
          </div>
        ) : null}
      </section>

      <AnimatePresence>
        {composing ? (
          <NewMessageDialog
            bots={bots}
            onClose={() => setComposing(false)}
            onCreated={(conversation) => {
              setComposing(false);
              setConversations((current) =>
                current.some((item) => item.id === conversation.id) ? current : [conversation, ...current]);
              setActiveId(conversation.id);
              void loadSidebar();
            }}
          />
        ) : null}
      </AnimatePresence>
    </div>
  );
}

function TimeDivider({ at }: { at: string }) {
  return (
    <p className="py-1 text-center text-[12px] tabular-nums text-slate-400">
      {new Date(at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
    </p>
  );
}

function ThinkingDots() {
  return (
    <span className="flex items-center gap-1" aria-hidden>
      {["#f0932b", "#f0932b", "#f0932b"].map((colour, index) => (
        <motion.span
          key={index}
          className="h-[7px] w-[7px] rounded-full"
          style={{ background: colour }}
          animate={{ opacity: [0.3, 1, 0.3] }}
          transition={{ duration: 1.1, repeat: Infinity, delay: index * 0.16, ease: "easeInOut" }}
        />
      ))}
    </span>
  );
}

/**
 * Pick recipients by typing a name.
 *
 * Choosing more than one makes it a group, which is the only difference
 * between a direct thread and a group as far as the user is concerned.
 */
function NewMessageDialog({
  bots,
  onClose,
  onCreated,
}: {
  bots: Bot[];
  onClose: () => void;
  onCreated: (conversation: Conversation) => void;
}) {
  const [term, setTerm] = useState("");
  const [picked, setPicked] = useState<Bot[]>([]);
  const [title, setTitle] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const matches = useMemo(() => {
    const needle = term.trim().toLowerCase();
    const remaining = bots.filter((bot) => !picked.some((item) => item.id === bot.id));
    if (!needle) return remaining;
    return remaining.filter((bot) => `${bot.name} ${bot.role}`.toLowerCase().includes(needle));
  }, [bots, picked, term]);

  const add = (bot: Bot) => { setPicked((current) => [...current, bot]); setTerm(""); };
  const remove = (id: string) => setPicked((current) => current.filter((bot) => bot.id !== id));

  const submit = async () => {
    if (!picked.length || saving) return;
    setSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/cowork/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ botIds: picked.map((bot) => bot.id), title: title.trim() }),
      });
      const payload = await response.json();
      if (!payload?.ok) throw new Error(payload?.error || "Could not start that conversation.");
      onCreated({ ...payload.conversation, participants: picked.map((bot) => ({ id: bot.id, name: bot.name, avatar: bot.avatar, status: bot.status })) });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not start that conversation.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 grid place-items-center bg-slate-950/25 p-6 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, y: 8, scale: 0.99 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 8, scale: 0.99 }}
        transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
        onClick={(event) => event.stopPropagation()}
        className="w-full max-w-[480px] overflow-hidden rounded-2xl bg-white shadow-[0_24px_70px_rgba(15,23,42,.18)]"
      >
        <div className="flex items-center justify-between gap-4 border-b border-slate-200/70 px-5 py-3.5">
          <p className="text-[15px] font-semibold tracking-[-.01em] text-slate-900">New message</p>
          <button type="button" onClick={onClose} aria-label="Close" className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-1.5 border-b border-slate-200/70 px-4 py-3">
          <span className="text-[13px] text-slate-400">To:</span>
          {picked.map((bot) => (
            <span key={bot.id} className="flex items-center gap-1.5 rounded-lg bg-[#eef3ff] py-1 pl-1.5 pr-1 text-[12.5px] font-medium text-[#2c4bb8]">
              <Avatar name={bot.name} avatar={bot.avatar} size={18} />
              {bot.name}
              <button type="button" onClick={() => remove(bot.id)} aria-label={`Remove ${bot.name}`} className="grid h-5 w-5 place-items-center rounded text-[#2c4bb8]/60 hover:text-[#2c4bb8]">
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
          <input
            ref={inputRef}
            value={term}
            onChange={(event) => setTerm(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && matches[0]) { event.preventDefault(); add(matches[0]); }
              if (event.key === "Backspace" && !term && picked.length) remove(picked[picked.length - 1].id);
            }}
            placeholder={picked.length ? "Add another…" : "Type a name"}
            aria-label="Recipients"
            className="min-w-[140px] flex-1 bg-transparent py-1 text-[13.5px] text-slate-800 outline-none placeholder:text-slate-400"
          />
        </div>

        <div className="max-h-[260px] overflow-y-auto p-2">
          {bots.length === 0 ? (
            <p className="px-3 py-6 text-center text-[12.5px] text-slate-400">
              No bots yet — create one first.
            </p>
          ) : matches.length === 0 ? (
            <p className="px-3 py-6 text-center text-[12.5px] text-slate-400">
              {term.trim()
                ? `No one matches “${term.trim()}”.`
                : "Everyone is already in this conversation."}
            </p>
          ) : (
            matches.map((bot) => (
              <button
                key={bot.id}
                type="button"
                onClick={() => add(bot)}
                className="flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left transition-colors hover:bg-slate-50"
              >
                <Avatar name={bot.name} avatar={bot.avatar} size={32} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13.5px] font-medium text-slate-900">{bot.name}</span>
                  <span className="block truncate text-[12px] text-slate-500">{bot.role}</span>
                </span>
              </button>
            ))
          )}
        </div>

        {picked.length > 1 ? (
          <div className="border-t border-slate-200/70 px-4 py-3">
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder={picked.map((bot) => bot.name).join(", ")}
              aria-label="Group name"
              className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-[13.5px] text-slate-800 outline-none focus:border-blue-400"
            />
            <p className="mt-1.5 text-[11.5px] text-slate-400">
              Group name — leave blank to use everyone's names.
            </p>
          </div>
        ) : null}

        {error ? <p className="mx-4 mb-2 rounded-xl bg-rose-50 px-3 py-2 text-[12px] text-rose-700">{error}</p> : null}

        <div className="flex justify-end gap-2 border-t border-slate-200/70 px-4 py-3">
          <button type="button" onClick={onClose} className="h-9 rounded-xl px-3 text-[13px] font-medium text-slate-500 hover:text-slate-900">
            Cancel
          </button>
          <button
            type="button"
            disabled={!picked.length || saving}
            onClick={() => void submit()}
            className="flex h-9 items-center gap-1.5 rounded-xl bg-[#4169f6] px-4 text-[13px] font-medium text-white transition-colors hover:bg-[#3158ea] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {saving ? "Starting…" : <>Start{picked.length > 1 ? " group" : ""} <Check className="h-3.5 w-3.5" strokeWidth={2.6} /></>}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
