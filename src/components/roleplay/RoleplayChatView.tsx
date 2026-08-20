import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  ArrowLeft, ArrowUp, Brain, ChevronLeft, ChevronRight, Copy, Loader2, Pencil,
  RefreshCw, UserRound, X,
} from "lucide-react";
import { cn } from "../../lib/utils";
import { roleplayApi } from "../../lib/roleplay/api";
import { buildRoleplaySystemPrompt, extractOutfitUpdate, outfitFromPrefix, stripPartialOutfitMarker } from "../../lib/roleplay/systemPrompt";
import { streamRoleplayReply } from "../../lib/roleplay/streamChat";
import { DIALOGUE_FORMAT_LABEL, RESPONSE_STYLE_LABEL } from "../../lib/roleplay/types";
import type {
  DialogueFormat, ResponseStyle, RoleplayCharacter, RoleplayChat,
  RoleplayMemory, RoleplayMessage, RoleplayPersona,
} from "../../lib/roleplay/types";
import { characterAmbient, characterWorld } from "../../lib/roleplay/helpers";
import { RoleplayPortrait } from "./RoleplayCharacterCard";

// Mirrors the main Chat tool's exact bubble geometry/easing (src/App.tsx /
// src/index.css .clyra-chat-user-bubble / .clyra-assistant-message) so a
// roleplay turn reads and moves identically to a normal chat turn, without
// forking Chat's own deeply-coupled implementation.
const CHAT_EASE_OUT = [0.16, 1, 0.3, 1] as const;

export function RoleplayChatView({
  character,
  chat,
  personas,
  onBack,
  onCharacterChange,
  onChatChange,
}: {
  character: RoleplayCharacter;
  chat: RoleplayChat;
  personas: RoleplayPersona[];
  onBack: () => void;
  onCharacterChange: (c: RoleplayCharacter) => void;
  onChatChange: (c: RoleplayChat) => void;
}) {
  const [messages, setMessages] = useState<RoleplayMessage[]>(chat.messages);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [memories, setMemories] = useState<RoleplayMemory[]>([]);
  const [inspector, setInspector] = useState<"memory" | "character" | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  // Synchronous guard against a double-send: `sending` (React state) only
  // updates on the next render, so two calls issued in the same tick (e.g.
  // an Enter keydown firing twice in quick succession) could both read it as
  // false and race. This ref is set before any async work starts.
  const sendingRef = useRef(false);

  const persona = personas.find((p) => p.id === chat.personaId) || personas[0] || null;

  useEffect(() => {
    void roleplayApi.listMemories(character.id).then(setMemories).catch(() => {});
  }, [character.id]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, sending]);

  const persist = (next: RoleplayMessage[], patch: Partial<RoleplayChat> = {}) => {
    setMessages(next);
    const nextChat = { ...chat, ...patch, messages: next, updatedAt: new Date().toISOString() };
    onChatChange(nextChat);
    void roleplayApi.saveChat(nextChat).catch(() => {});
  };

  const activeText = (m: RoleplayMessage) => (m.role === "assistant" ? m.swipes[m.activeSwipe] ?? m.content : m.content);

  const historyFor = (upTo: RoleplayMessage[]) => upTo.map((m) => ({ role: m.role, content: activeText(m) }));

  const requestReply = async (history: RoleplayMessage[]) => {
    sendingRef.current = true;
    setSending(true);
    const controller = new AbortController();
    abortRef.current = controller;
    const placeholderId = crypto.randomUUID();
    const placeholder: RoleplayMessage = { id: placeholderId, role: "assistant", content: "", createdAt: new Date().toISOString(), personaId: null, swipes: [""], activeSwipe: 0 };
    let working = [...history, placeholder];
    setMessages(working);
    try {
      const systemPrompt = buildRoleplaySystemPrompt({
        character,
        persona,
        memories,
        currentOutfit: chat.currentOutfit,
        dialogueFormat: chat.dialogueFormat,
      });
      const full = await streamRoleplayReply(systemPrompt, historyFor(history), (partial) => {
        // A wardrobe trailer is bookkeeping, not prose: it must never be
        // visible, not even for the frames while it is still arriving.
        const shown = stripPartialOutfitMarker(partial);
        working = working.map((m) => (m.id === placeholderId ? { ...m, content: shown, swipes: [shown] } : m));
        setMessages(working);
      }, controller.signal);
      const { content: reply, outfit } = extractOutfitUpdate(full);
      // Two sources, cheapest first: an explicit trailer, or the outfit the
      // reply already states in its own prefix. Relying on the trailer alone
      // left the story's appearance permanently blank whenever the model chose
      // not to emit it.
      const stated = outfit ?? outfitFromPrefix(reply, character.name);
      const finalMessages = history.concat({ ...placeholder, content: reply, swipes: [reply] });
      const changed = stated && stated !== (chat.currentOutfit || "").trim();
      persist(finalMessages, changed ? { currentOutfit: stated, outfitUpdatedAt: new Date().toISOString() } : {});

      // Light-touch memory extraction: after every exchange, ask for durable
      // facts from the last few turns rather than every single message.
      if (finalMessages.length % 4 === 0) {
        const transcript = finalMessages.slice(-6).map((m) => `${m.role === "user" ? persona?.name || "User" : character.name}: ${activeText(m)}`).join("\n");
        void roleplayApi.extractMemories(character.id, transcript, chat.id).then((fresh) => {
          if (fresh.length) setMemories((prev) => [...fresh, ...prev]);
        }).catch(() => {});
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "The character couldn't respond.";
      persist(history.concat({ ...placeholder, content: `*(${message})*`, swipes: [`*(${message})*`] }));
    } finally {
      sendingRef.current = false;
      setSending(false);
      abortRef.current = null;
    }
  };

  const send = () => {
    const text = input.trim();
    if (!text || sendingRef.current) return;
    setInput("");
    const userMessage: RoleplayMessage = { id: crypto.randomUUID(), role: "user", content: text, createdAt: new Date().toISOString(), personaId: persona?.id || null, swipes: [], activeSwipe: 0 };
    const next = [...messages, userMessage];
    persist(next);
    void requestReply(next);
  };

  const regenerate = (messageId: string) => {
    const index = messages.findIndex((m) => m.id === messageId);
    if (index === -1 || sendingRef.current) return;
    void requestReply(messages.slice(0, index));
  };

  const swipe = (messageId: string, direction: 1 | -1) => {
    setMessages((prev) => prev.map((m) => {
      if (m.id !== messageId || m.swipes.length < 2) return m;
      const next = Math.max(0, Math.min(m.swipes.length - 1, m.activeSwipe + direction));
      return { ...m, activeSwipe: next };
    }));
  };

  const continueReply = () => {
    if (sendingRef.current || !messages.length) return;
    const last = messages[messages.length - 1];
    if (last.role !== "assistant") return;
    void requestReply(messages);
  };

  const startEdit = (message: RoleplayMessage) => { setEditingId(message.id); setEditValue(activeText(message)); };
  const saveEdit = () => {
    if (!editingId) return;
    persist(messages.map((m) => (m.id === editingId ? { ...m, content: editValue, swipes: m.role === "assistant" ? m.swipes.map((s, i) => (i === m.activeSwipe ? editValue : s)) : m.swipes } : m)));
    setEditingId(null);
  };

  const updateStyle = (responseStyle: ResponseStyle) => {
    const next = { ...character, responseStyle };
    onCharacterChange(next);
    void roleplayApi.updateCharacter(character.id, { responseStyle });
  };
  // Format belongs to the story: the same character can be played terse in one
  // and fully described in another.
  // A chat is created titled after its character, so using the title verbatim
  // rendered "Mara Vale · Mara Vale · as You". Fall back to the world instead
  // of repeating the name that is already the line above.
  const storySubtitle = chat.title && chat.title.trim() !== character.name.trim()
    ? chat.title
    : characterWorld(character);

  const storyFormat = chat.dialogueFormat ?? character.dialogueFormat ?? "name";
  const updateFormat = (dialogueFormat: DialogueFormat) => {
    const next = { ...chat, dialogueFormat, updatedAt: new Date().toISOString() };
    onChatChange(next);
    void roleplayApi.saveChat(next).catch(() => {});
  };

  const updateStoryOutfit = (currentOutfit: string) => {
    onChatChange({ ...chat, currentOutfit });
  };
  const commitStoryOutfit = () => {
    void roleplayApi.saveChat({ ...chat, updatedAt: new Date().toISOString() }).catch(() => {});
  };

  const toggleInspector = (panel: "memory" | "character") => setInspector((current) => current === panel ? null : panel);
  const inspectorKeyDown = (event: KeyboardEvent<HTMLButtonElement>, panel: "memory" | "character") => {
    if (event.key === "Enter" || event.key === " ") { event.preventDefault(); toggleInspector(panel); }
  };

  return (
    <div
      className="rp-chat-shell clyra-chat-page flex h-full min-h-0 flex-1 flex-col"
      style={{ ["--rp-character-ambient" as string]: characterAmbient(character.name, 0.05) }}
    >
      <header className="rp-chat-header">
        <button type="button" onPointerUp={onBack} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onBack(); } }} aria-label="Back to library" className="rp-icon-button"><ArrowLeft className="h-4 w-4" /></button>
        <RoleplayPortrait character={character} className="h-9 w-9 shrink-0 rounded-[11px]" initialsClassName="text-[11px]" />
        <div className="min-w-0 flex-1"><p className="truncate text-[13.5px] font-semibold text-[var(--rp-text)]">{character.name}</p><p className="truncate text-[10.5px] text-[var(--rp-text-tertiary)]">{storySubtitle} · as {persona?.name || "You"}</p></div>
        <button type="button" onPointerUp={() => toggleInspector("memory")} onKeyDown={(event) => inspectorKeyDown(event, "memory")} className="rp-header-action" data-active={inspector === "memory"} aria-expanded={inspector === "memory"}><Brain /> <span>Memory</span></button>
        <button type="button" onPointerUp={() => toggleInspector("character")} onKeyDown={(event) => inspectorKeyDown(event, "character")} className="rp-header-action" data-active={inspector === "character"} aria-expanded={inspector === "character"}><UserRound /> <span>Character</span></button>
      </header>

      <div className="flex min-h-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col">
      <div ref={scrollRef} id="chat-container" className="clyra-visible-scrollbar min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[760px] px-5 pb-8 pt-7">
          {messages.length <= 1 ? <div className="rp-chat-intro"><RoleplayPortrait character={character} className="h-20 w-20 rounded-[20px]" initialsClassName="text-[22px]" /><p>{characterWorld(character)}</p><h1>{character.name}</h1><span>{character.tagline || character.scenario}</span></div> : null}
          {messages.map((message, index) => {
            const isUser = message.role === "user";
            const text = activeText(message);
            const isLast = index === messages.length - 1;
            const isEditing = editingId === message.id;
            return (
              <motion.div
                key={message.id}
                initial={{ opacity: 0, y: 0, scale: 0.994 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={{ type: "tween", ease: CHAT_EASE_OUT, duration: isUser ? 0.5 : 0.4 }}
                className={cn("group flex", isUser ? "mb-7 justify-end" : "mb-[18px]")}
              >
                <div className={cn("flex flex-col gap-1", isUser ? "items-end" : "items-start", isUser ? "max-w-[min(82%,620px)]" : "max-w-full")}>
                  {!isUser && !isEditing ? <p className="mb-1 text-[11px] font-semibold text-[var(--rp-text-secondary)]">{character.name}</p> : null}
                  {isEditing ? (
                    <textarea
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); saveEdit(); } if (e.key === "Escape") setEditingId(null); }}
                      autoFocus
                      className={cn(
                        "w-full resize-none rounded-[14px] border border-[var(--clyra-color-accent)]/40 bg-[var(--clyra-color-surface)] px-3.5 py-2.5 text-[14px] leading-[1.5] text-[var(--clyra-color-label)] outline-none",
                      )}
                    />
                  ) : (
                    <div
                      className={cn(
                        "whitespace-pre-wrap text-[14px] leading-[1.62] text-[var(--rp-text)]",
                        isUser
                          ? "rounded-[16px_16px_5px_16px] border border-[var(--rp-border)] bg-[var(--rp-surface-secondary)] px-3.5 py-2.5"
                          : "px-0",
                      )}
                    >
                      {text || (sending && isLast ? <span className="flex items-center gap-2 text-[12px] text-[var(--rp-text-tertiary)]"><Loader2 className="h-3.5 w-3.5 animate-spin" /> {character.name} is responding…</span> : text)}
                    </div>
                  )}

                  {!isEditing && (
                    <div className="flex items-center gap-2 px-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                      {!isUser && message.swipes.length > 1 ? (
                        <div className="flex items-center gap-1 text-[10px] text-[var(--clyra-color-label-tertiary)]">
                          <button type="button" onClick={() => swipe(message.id, -1)} disabled={message.activeSwipe === 0} className="disabled:opacity-30"><ChevronLeft className="h-3 w-3" /></button>
                          {message.activeSwipe + 1}/{message.swipes.length}
                          <button type="button" onClick={() => swipe(message.id, 1)} disabled={message.activeSwipe === message.swipes.length - 1} className="disabled:opacity-30"><ChevronRight className="h-3 w-3" /></button>
                        </div>
                      ) : null}
                      {!isUser && !sending ? (
                        <button type="button" onClick={() => regenerate(message.id)} title="Regenerate" className="text-[var(--clyra-color-label-tertiary)] hover:text-[var(--clyra-color-label)]"><RefreshCw className="h-3 w-3" /></button>
                      ) : null}
                      <button type="button" onClick={() => void navigator.clipboard.writeText(text)} title="Copy" className="text-[var(--rp-text-tertiary)] hover:text-[var(--rp-text)]"><Copy className="h-3 w-3" /></button>
                      <button type="button" onClick={() => startEdit(message)} title="Edit" className="text-[var(--clyra-color-label-tertiary)] hover:text-[var(--clyra-color-label)]"><Pencil className="h-3 w-3" /></button>
                    </div>
                  )}
                </div>
              </motion.div>
            );
          })}
          {!sending && messages.length && messages[messages.length - 1].role === "assistant" ? (
            <button type="button" onClick={continueReply} className="mb-6 text-[11px] font-semibold text-[var(--rp-text-secondary)] hover:text-[var(--rp-accent)]">
              Continue response →
            </button>
          ) : null}
        </div>
      </div>

      <div className="shrink-0 px-4 pb-5 pt-2">
        <div className="rp-chat-composer mx-auto w-full max-w-[760px]">
          <textarea rows={1}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
            placeholder={`Message ${character.name}…`}
            className="max-h-[150px] min-h-[32px] w-full resize-none bg-transparent px-2 py-1 text-[14px] leading-[1.45] text-[var(--rp-text)] outline-none placeholder:text-[var(--rp-text-tertiary)]"
          />
          <div className="flex items-center justify-between pt-1"><div className="flex min-w-0 items-center gap-2"><label className="rp-style-select">Style <select value={character.responseStyle} onChange={(event) => updateStyle(event.target.value as ResponseStyle)}>{Object.entries(RESPONSE_STYLE_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label className="rp-style-select">Format <select value={storyFormat} onChange={(event) => updateFormat(event.target.value as DialogueFormat)}>{Object.entries(DIALOGUE_FORMAT_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></div><button type="button" onClick={send} aria-label={`Send message to ${character.name}`} disabled={!input.trim() || sending} className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[var(--rp-accent)] text-white transition-transform active:scale-[var(--clyra-press-scale)] disabled:opacity-30">
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-4 w-4" />}
          </button></div>
        </div>
      </div>
      </div>

      <AnimatePresence initial={false}>{inspector ? <motion.aside initial={{ width: 0, opacity: 0 }} animate={{ width: 292, opacity: 1 }} exit={{ width: 0, opacity: 0 }} transition={{ duration: .28, ease: CHAT_EASE_OUT }} className="rp-chat-inspector"><div className="w-[292px] p-4"><div className="mb-5 flex items-center justify-between"><h2>{inspector === "memory" ? "Memory" : "Character"}</h2><button type="button" onClick={() => setInspector(null)} className="rp-icon-button" aria-label="Close inspector"><X className="h-4 w-4" /></button></div>{inspector === "memory" ? <><p className="rp-inspector-note"><span /> Memory active</p>{memories.length ? <div className="mt-4 space-y-2">{memories.map((memory) => <article key={memory.id} className="rp-memory-item"><p>{memory.text}</p><div><button type="button" onClick={() => void roleplayApi.updateMemory(character.id, memory.id, { pinned: !memory.pinned }).then(() => setMemories((prev) => prev.map((m) => m.id === memory.id ? { ...m, pinned: !m.pinned } : m)))}>{memory.pinned ? "Pinned" : "Pin"}</button><button type="button" onClick={() => void roleplayApi.deleteMemory(character.id, memory.id).then(() => setMemories((prev) => prev.filter((m) => m.id !== memory.id)))}>Forget</button></div></article>)}</div> : <p className="mt-4 text-[12px] leading-relaxed text-[var(--rp-text-tertiary)]">Story facts and relationship details will appear here as you talk.</p>}</> : <><RoleplayPortrait character={character} className="aspect-[4/5] w-full rounded-[16px]" initialsClassName="text-[28px]" /><h3 className="mt-4 text-[16px] font-semibold">{character.name}</h3><p className="mt-1 text-[11.5px] text-[var(--rp-text-secondary)]">{characterWorld(character)}</p><div className="rp-inspector-section"><h4>Scenario</h4><p>{character.scenario || "No scenario set."}</p></div><div className="rp-inspector-section"><h4>Appearance in this story</h4><textarea value={chat.currentOutfit ?? ""} onChange={(event) => updateStoryOutfit(event.target.value)} onBlur={commitStoryOutfit} placeholder="Describe what they look like right now…" /><p className="mt-1 text-[10.5px] leading-[1.45] text-[var(--rp-text-tertiary)]">{chat.outfitUpdatedAt ? "Updated by the story — edit any time." : "Starts from their default and follows the story from here."}</p></div></>}</div></motion.aside> : null}</AnimatePresence>
      </div>
    </div>
  );
}
