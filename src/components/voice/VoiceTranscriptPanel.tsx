import { useEffect, useRef, useState, type FormEvent } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Pencil, RefreshCw, Send, X } from "lucide-react";
import type { VoiceTurn } from "../../hooks/useVoiceCall";
import { SPRING_SHEET, prefersReducedMotion } from "../../lib/motion";

export function VoiceTranscriptPanel({ open, turns, liveUser, liveAssistant, onClose, onSend, onUpdateUser, onResendUser }: {
  open: boolean; turns: VoiceTurn[]; liveUser: string; liveAssistant: string; onClose: () => void;
  onSend: (text: string) => boolean | void; onUpdateUser: (id: string, content: string) => void;
  onResendUser: (id: string, contentOverride?: string) => boolean | void;
}) {
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  const followLiveRef = useRef(true);
  useEffect(() => {
    if (!open || !listRef.current || !followLiveRef.current) return;
    listRef.current.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [open, turns, liveUser, liveAssistant]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const text = draft.trim();
    if (text && onSend(text) !== false) setDraft("");
  };

  return (
    <AnimatePresence>
      {open ? (
        <motion.aside initial={{ opacity: 0, x: 18 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 14 }}
          transition={prefersReducedMotion() ? { duration: .12 } : SPRING_SHEET} className="clyra-call-transcript" aria-label="Call transcript">
          <header><div><h2>Clyra Voice</h2><p>Live transcript</p></div><button type="button" onClick={onClose} aria-label="Close transcript"><X /></button></header>
          <div ref={listRef} className="clyra-call-transcript__list" aria-live="polite" onScroll={(event) => {
            const node = event.currentTarget;
            followLiveRef.current = node.scrollHeight - node.scrollTop - node.clientHeight < 72;
          }}>
            {!turns.length && !liveUser && !liveAssistant ? <p className="clyra-call-transcript__empty">Your words and Clyra’s replies will appear here.</p> : null}
            {turns.map((turn) => (
              <article key={turn.id} className="clyra-call-transcript__turn">
                <div><strong>{turn.role === "user" ? "You" : "Clyra"}</strong>
                  {turn.role === "user" ? <button type="button" aria-label="Edit message" onClick={() => { setEditing(turn.id); setEditDraft(turn.content); }}><Pencil /></button> : null}
                </div>
                {editing === turn.id ? (
                  <form onSubmit={(event) => { event.preventDefault(); const value = editDraft.trim(); if (value) { onUpdateUser(turn.id, value); setEditing(null); } }} className="clyra-call-transcript__edit">
                    <input value={editDraft} onChange={(event) => setEditDraft(event.target.value)} aria-label="Edit transcript message" autoFocus />
                    <button type="submit">Save</button><button type="button" onClick={() => setEditing(null)}>Cancel</button>
                    <button type="button" onClick={() => { onResendUser(turn.id, editDraft); setEditing(null); }}><RefreshCw />Resend</button>
                  </form>
                ) : <p>{turn.content}</p>}
              </article>
            ))}
            {liveUser && turns.at(-1)?.content !== liveUser ? <article className="clyra-call-transcript__turn"><div><strong>You</strong></div><p>{liveUser}</p></article> : null}
            {liveAssistant && turns.at(-1)?.content !== liveAssistant ? <article className="clyra-call-transcript__turn"><div><strong>Clyra</strong></div><p>{liveAssistant}</p></article> : null}
          </div>
          <form onSubmit={submit} className="clyra-call-transcript__composer"><input value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Message Clyra…" aria-label="Message Clyra" /><button type="submit" disabled={!draft.trim()} aria-label="Send message"><Send /></button></form>
        </motion.aside>
      ) : null}
    </AnimatePresence>
  );
}
