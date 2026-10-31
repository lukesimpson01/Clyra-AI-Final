import { useEffect, useRef, useState } from "react";
import { ImportIcon, Music2, Pause, Play, Send, Shuffle, Trash2, Wand2, X } from "lucide-react";
import type { MessageItem, ShortsProject } from "../../../lib/shorts/schema";
import type { FakeTextSegmentPlan } from "../../../lib/shorts/faketext-timeline";
import { BUBBLE_ENTER_MS } from "../../../lib/shorts/faketext-timeline";
import { addSfxCue, removeSfxCue } from "../../../lib/shorts/ops";
import { shortsApi, type LibraryTrack } from "../api";
import { nextMessageId } from "./FakeTextStoryEditor";
import { AIWriterModal } from "./AIWriterModal";
import { ImportModal } from "./ImportModal";

type Props = {
  project: ShortsProject;
  messages: MessageItem[];
  segments: FakeTextSegmentPlan[];
  onUpdate: (updater: (prev: ShortsProject) => ShortsProject) => void;
  onJumpTime: (ms: number) => void;
};

function reindex(items: MessageItem[]): MessageItem[] {
  return items.map((item, index) => ({ ...item, startMs: index, durationMs: Math.max(100, item.durationMs) }));
}

function senderFor(side: "left" | "right", contactName: string) {
  return side === "right" ? "You" : contactName || "Unknown";
}

function freshMessage(side: "left" | "right", contactName: string, text = ""): MessageItem {
  return {
    id: nextMessageId(),
    type: "message",
    startMs: 0,
    durationMs: 100,
    side,
    sender: senderFor(side, contactName),
    text,
    receipt: side === "right" ? "read" : "none",
    typingMs: 0,
    speechMs: 0,
  };
}

export function ScriptTab({ project, messages, segments, onUpdate, onJumpTime }: Props) {
  const [composerText, setComposerText] = useState("");
  const [composerSide, setComposerSide] = useState<"left" | "right">("left");
  const [aiWriterOpen, setAiWriterOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const dragIndex = useRef<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const avatarInput = useRef<HTMLInputElement | null>(null);
  const [avatarBusy, setAvatarBusy] = useState(false);

  const otherItems = project.items.filter((item) => item.type !== "message");
  const contact = project.fakeText.contact;

  const setMessages = (next: MessageItem[]) => {
    onUpdate((prev) => ({ ...prev, items: [...otherItems, ...reindex(next)] }));
  };

  const addMessage = (side: "left" | "right", text = "") => {
    const list = [...messages, freshMessage(side, contact.name, text)];
    setMessages(list);
  };

  const updateText = (id: string, text: string) => {
    onUpdate((prev) => ({ ...prev, items: prev.items.map((item) => (item.id === id && item.type === "message" ? { ...item, text } : item)) }));
  };

  const updateSide = (id: string, side: "left" | "right") => {
    setMessages(messages.map((item) => (item.id === id ? { ...item, side, sender: senderFor(side, contact.name) } : item)));
  };

  const removeMessage = (id: string) => setMessages(messages.filter((item) => item.id !== id));

  const duplicateMessage = (id: string) => {
    const index = messages.findIndex((item) => item.id === id);
    if (index < 0) return;
    const copy = { ...messages[index], id: nextMessageId() };
    const next = [...messages];
    next.splice(index + 1, 0, copy);
    setMessages(next);
  };

  const swapAll = () => setMessages(messages.map((item) => { const side = item.side === "left" ? "right" : "left"; return { ...item, side, sender: senderFor(side, contact.name) }; }));

  const deleteAll = () => {
    setMessages([]);
    setConfirmClear(false);
  };

  const reorder = (from: number, to: number) => {
    if (from === to) return;
    const next = [...messages];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    setMessages(next);
  };

  const setContactName = (name: string) => {
    onUpdate((prev) => ({
      ...prev,
      fakeText: { ...prev.fakeText, contact: { ...prev.fakeText.contact, name } },
      items: prev.items.map((item) => (item.type === "message" && item.side === "left" ? { ...item, sender: name || "Unknown" } : item)),
    }));
  };

  const onPickAvatar = async (file: File) => {
    setAvatarBusy(true);
    try {
      const dataUrl = await readAsDataUrl(file);
      const { assetPath } = await shortsApi.uploadFakeTextImage(project.id, dataUrl);
      onUpdate((prev) => ({ ...prev, fakeText: { ...prev.fakeText, contact: { ...prev.fakeText.contact, avatar: assetPath } } }));
    } catch {
      // Non-critical: the initial-letter fallback keeps the header looking right.
    } finally {
      setAvatarBusy(false);
    }
  };

  const submitComposer = () => {
    const text = composerText.trim();
    if (!text) return;
    addMessage(composerSide, text);
    setComposerText("");
  };

  const applyGenerated = (generatedContactName: string, generated: Array<{ side: "left" | "right"; text: string; reaction?: string }>) => {
    onUpdate((prev) => {
      const name = generatedContactName || prev.fakeText.contact.name;
      const built = generated.map((entry) => {
        const msg = freshMessage(entry.side, name, entry.text);
        if (entry.reaction) msg.reaction = entry.reaction;
        return msg;
      });
      return {
        ...prev,
        fakeText: { ...prev.fakeText, contact: { ...prev.fakeText.contact, name } },
        items: [...otherItems, ...reindex(built)],
      };
    });
  };

  const avatarUrl = contact.avatar ? shortsApi.assetUrl(project.id, contact.avatar) : "";

  return (
    <>
      <div className="ft-panel-header">
        <span className="ft-panel-title">Text Script</span>
        <div className="ft-panel-header-spacer" />
        <button type="button" className="ft-btn ft-btn--sm" onClick={() => setImportOpen(true)}><ImportIcon size={13} strokeWidth={2} /> Import</button>
        <button type="button" className="ft-btn ft-btn--sm ft-btn--primary" onClick={() => setAiWriterOpen(true)}><Wand2 size={13} strokeWidth={2} /> AI Writer</button>
      </div>
      <div className="ft-panel-body">
        <div className="ft-section">
          <div className="ft-contact-row">
            <button type="button" className="ft-avatar-btn" onClick={() => avatarInput.current?.click()} disabled={avatarBusy} aria-label="Change profile picture">
              {avatarUrl ? <img src={avatarUrl} alt="" /> : (contact.name[0] || "?").toUpperCase()}
            </button>
            <input ref={avatarInput} type="file" accept="image/png,image/jpeg,image/webp,image/gif" style={{ display: "none" }} onChange={(event) => { const file = event.target.files?.[0]; if (file) void onPickAvatar(file); event.target.value = ""; }} />
            <div style={{ flex: 1 }}>
              <div className="ft-field-label">Profile Name</div>
              <input className="ft-input" value={contact.name} onChange={(event) => setContactName(event.target.value.slice(0, 60))} placeholder="Unknown" />
            </div>
          </div>
        </div>

        <div className="ft-divider" />

        <div className="ft-row-between" style={{ marginBottom: 10 }}>
          <span className="ft-field-label" style={{ marginBottom: 0 }}>Messages</span>
          <div className="ft-row">
            <button type="button" className="ft-btn ft-btn--sm" onClick={swapAll} disabled={!messages.length}><Shuffle size={13} strokeWidth={2} /> Swap All</button>
            {confirmClear ? (
              <>
                <span style={{ fontSize: 12, color: "var(--ft-ink-2)" }}>Clear all messages?</span>
                <button type="button" className="ft-btn ft-btn--sm ft-btn--danger" onClick={deleteAll}>Confirm</button>
                <button type="button" className="ft-btn ft-btn--sm" onClick={() => setConfirmClear(false)}>Cancel</button>
              </>
            ) : (
              <button type="button" className="ft-btn ft-btn--sm ft-btn--danger" onClick={() => setConfirmClear(true)} disabled={!messages.length}><Trash2 size={13} strokeWidth={2} /> Delete All</button>
            )}
          </div>
        </div>

        {messages.length === 0 ? <p className="ft-empty" style={{ padding: "18px 0" }}>No messages yet. Write one below, or use AI Writer / Import.</p> : null}

        <div className="ft-msg-list">
          {messages.map((message, index) => {
            const segmentStart = segments.find((segment) => segment.startIndex === index && index > 0);
            return (
              <div key={message.id}>
                {segmentStart ? (
                  <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "14px 0 10px", color: "var(--ft-ink-3)", fontSize: 11, fontWeight: 650, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                    <div style={{ flex: 1, height: 1, background: "var(--ft-border)" }} />
                    New screen — chat clears and continues
                    <div style={{ flex: 1, height: 1, background: "var(--ft-border)" }} />
                  </div>
                ) : null}
                <MessageRow
                  project={project}
                  onUpdate={onUpdate}
                  message={message}
                  onChangeText={(text) => updateText(message.id, text)}
                  onChangeSide={(side) => updateSide(message.id, side)}
                  onDelete={() => removeMessage(message.id)}
                  onJump={() => onJumpTime(message.startMs + BUBBLE_ENTER_MS)}
                  dragging={dragOverIndex === index}
                  onDragStart={() => { dragIndex.current = index; }}
                  onDragEnter={() => setDragOverIndex(index)}
                  onDragEnd={() => { if (dragIndex.current !== null && dragOverIndex !== null) reorder(dragIndex.current, dragOverIndex); dragIndex.current = null; setDragOverIndex(null); }}
                />
              </div>
            );
          })}
        </div>

        <div className="ft-msg-pill-row" style={{ marginTop: 10 }}>
          <div className="ft-msg-pill">
            <textarea
              className="ft-msg-text"
              rows={1}
              placeholder="Type your message here…"
              value={composerText}
              onChange={(event) => setComposerText(event.target.value.slice(0, 500))}
              onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); submitComposer(); } }}
            />
          </div>
          <button type="button" className={`ft-switch ft-switch--navy${composerSide === "right" ? " on" : ""}`} onClick={() => setComposerSide(composerSide === "left" ? "right" : "left")} aria-pressed={composerSide === "right"} aria-label="Sender">
            <span className="ft-switch-knob"><SenderGlyph on={composerSide === "right"} /></span>
          </button>
          <button type="button" className="ft-row-icon-btn ft-row-icon-btn--primary" onClick={submitComposer} disabled={!composerText.trim()} aria-label="Send">
            <Send size={14} strokeWidth={2.2} />
          </button>
        </div>
        <button type="button" className="ft-add-btn" onClick={() => addMessage(composerSide)}>+ Add Message</button>
      </div>

      {aiWriterOpen ? (
        <AIWriterModal
          contactName={contact.name}
          onClose={() => setAiWriterOpen(false)}
          onApply={(name, generated) => {
            if (messages.length > 0 && !window.confirm(`Replace the ${messages.length} existing message(s) with the generated conversation?`)) return;
            applyGenerated(name, generated);
            setAiWriterOpen(false);
          }}
        />
      ) : null}
      {importOpen ? <ImportModal onClose={() => setImportOpen(false)} onApply={(parsed) => { setMessages([...messages, ...parsed.map((entry) => freshMessage(entry.side, contact.name, entry.text))]); setImportOpen(false); }} /> : null}
    </>
  );
}

function MessageRow({ message, project, onUpdate, onChangeText, onChangeSide, onDelete, onJump, dragging, onDragStart, onDragEnter, onDragEnd }: {
  message: MessageItem;
  project: ShortsProject;
  onUpdate: (updater: (prev: ShortsProject) => ShortsProject, rebuild?: boolean) => void;
  onChangeText: (text: string) => void;
  onChangeSide: (side: "left" | "right") => void;
  onDelete: () => void;
  onJump: () => void;
  dragging: boolean;
  onDragStart: () => void;
  onDragEnter: () => void;
  onDragEnd: () => void;
}) {
  const [sfxOpen, setSfxOpen] = useState(false);
  const cue = project.audio.sfx.find((candidate) => Math.abs(candidate.atMs - message.startMs) < 50);

  return (
    <div
      className={`ft-msg-pill-row${dragging ? " dragging" : ""}`}
      draggable
      onDragStart={onDragStart}
      onDragEnter={(event) => { event.preventDefault(); onDragEnter(); }}
      onDragOver={(event) => event.preventDefault()}
      onDragEnd={onDragEnd}
      onClick={onJump}
    >
      <div className="ft-msg-pill">
        <div style={{ position: "relative" }}>
          <button
            type="button"
            className={`ft-sfx-btn${cue ? " active" : ""}`}
            onClick={(event) => { event.stopPropagation(); setSfxOpen((value) => !value); }}
            aria-label={cue ? `Sound effect: ${cue.file}` : "Add a sound effect"}
            title={cue ? cue.file.replace(/\.[^.]+$/, "") : "Add a sound effect"}
          >
            <Music2 size={14} strokeWidth={2} />
          </button>
          {sfxOpen ? (
            <SfxPopover
              atMs={message.startMs}
              cue={cue}
              onClose={() => setSfxOpen(false)}
              onAttach={(file) => onUpdate((prev) => addSfxCue(prev, file, message.startMs).project, false)}
              onRemove={() => cue && onUpdate((prev) => removeSfxCue(prev, cue.id), false)}
            />
          ) : null}
        </div>
        <textarea
          className="ft-msg-text"
          rows={1}
          value={message.text}
          onClick={(event) => event.stopPropagation()}
          onChange={(event) => onChangeText(event.target.value.slice(0, 500))}
          onInput={(event) => autoGrow(event.currentTarget)}
        />
        {message.speechMs > 0 ? <span className="ft-msg-duration">{(message.speechMs / 1000).toFixed(1)}s</span> : null}
      </div>
      <button
        type="button"
        className={`ft-switch ft-switch--navy${message.side === "right" ? " on" : ""}`}
        onClick={(event) => { event.stopPropagation(); onChangeSide(message.side === "left" ? "right" : "left"); }}
        aria-pressed={message.side === "right"}
        aria-label="Switch sender"
        title="Switch sender"
      >
        <span className="ft-switch-knob"><SenderGlyph on={message.side === "right"} /></span>
      </button>
      <button type="button" className="ft-row-icon-btn" onClick={(event) => { event.stopPropagation(); onDelete(); }} aria-label="Delete">
        <Trash2 size={14} strokeWidth={1.8} />
      </button>
    </div>
  );
}

function SenderGlyph({ on }: { on: boolean }) {
  return (
    <svg width={11} height={11} viewBox="0 0 24 24" fill="none" aria-hidden>
      {on ? (
        <path d="M4 4h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H9l-4 4V16H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Z" fill="#fff" />
      ) : (
        <path d="M4 4h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H9l-4 4V16H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Z" stroke="#53627e" strokeWidth={1.8} strokeLinejoin="round" />
      )}
    </svg>
  );
}

function SfxPopover({ atMs, cue, onClose, onAttach, onRemove }: { atMs: number; cue?: { id: string; file: string }; onClose: () => void; onAttach: (file: string) => void; onRemove: () => void }) {
  const [tracks, setTracks] = useState<LibraryTrack[] | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    shortsApi.listLibrary("sfx").then((result) => setTracks(result.tracks)).catch(() => setTracks([]));
  }, []);

  useEffect(() => {
    const onDocClick = (event: MouseEvent) => { if (popoverRef.current && !popoverRef.current.contains(event.target as Node)) onClose(); };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [onClose]);

  const preview = (file: string) => {
    audioRef.current?.pause();
    if (playing === file) { setPlaying(null); return; }
    const audio = new Audio(shortsApi.libraryFileUrl("sfx", file));
    audio.volume = 0.6;
    audioRef.current = audio;
    void audio.play().catch(() => undefined);
    audio.onended = () => setPlaying((current) => (current === file ? null : current));
    setPlaying(file);
  };

  return (
    <div ref={popoverRef} className="ft-sfx-popover" onClick={(event) => event.stopPropagation()}>
      <div className="ft-sfx-popover-header">Sound effect at {(atMs / 1000).toFixed(1)}s</div>
      {cue ? (
        <button type="button" className="ft-sfx-item ft-sfx-item--remove" onClick={() => { onRemove(); onClose(); }}>
          <X size={12} strokeWidth={2} /> Remove {cue.file.replace(/\.[^.]+$/, "")}
        </button>
      ) : null}
      {tracks === null ? <p className="ft-empty" style={{ padding: "10px 0" }}>Loading…</p> : null}
      {tracks && tracks.length === 0 ? <p className="ft-empty" style={{ padding: "10px 0" }}>No SFX in the library yet.</p> : null}
      <div className="ft-sfx-popover-list">
        {tracks?.map((track) => (
          <div key={track.file} className="ft-sfx-item">
            <button type="button" className="ft-sfx-item-play" onClick={() => preview(track.file)} aria-label={`Preview ${track.file}`}>
              {playing === track.file ? <Pause size={11} strokeWidth={2.2} /> : <Play size={11} strokeWidth={2.2} />}
            </button>
            <button type="button" className="ft-sfx-item-name" onClick={() => { onAttach(track.file); onClose(); }}>{track.file.replace(/\.[^.]+$/, "")}</button>
          </div>
        ))}
      </div>
    </div>
  );
}

function autoGrow(el: HTMLTextAreaElement) {
  el.style.height = "auto";
  el.style.height = `${el.scrollHeight}px`;
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}
