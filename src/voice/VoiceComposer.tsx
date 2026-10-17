import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useEffect, useRef, useState } from "react";

type Props = {
  open: boolean;
  muted: boolean;
  disabled?: boolean;
  onOpen: () => void;
  onClose: () => void;
  onMute: () => void;
  onEnd: () => void;
  onSend: (text: string) => void | Promise<void>;
};

const E = [0.22, 1, 0.36, 1] as const;

function MicIcon({ muted }: { muted: boolean }) {
  return (
    <>
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" data-ico="mic" style={{ position: "absolute", opacity: muted ? 0 : 1, transition: "opacity 140ms ease" }}>
        <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
        <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
        <line x1="12" x2="12" y1="19" y2="22" />
      </svg>
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" data-ico="mic" style={{ position: "absolute", opacity: muted ? 1 : 0, transition: "opacity 140ms ease" }}>
        <line x1="2" x2="22" y1="2" y2="22" />
        <path d="M18.89 13.23A7.12 7.12 0 0 0 19 12v-2" />
        <path d="M5 10v2a7 7 0 0 0 12 5" />
        <path d="M15 9.34V5a3 3 0 0 0-5.68-1.33" />
        <path d="M9 9v3a3 3 0 0 0 5.12 2.12" />
        <line x1="12" x2="12" y1="19" y2="22" />
      </svg>
    </>
  );
}

export function VoiceComposer({ open, muted, disabled, onOpen, onClose, onMute, onEnd, onSend }: Props) {
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);
  const reduced = useReducedMotion();

  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => inputRef.current?.focus({ preventScroll: true }), 220);
    return () => window.clearTimeout(t);
  }, [open]);

  const collapse = () => {
    setValue("");
    onClose();
  };

  const submit = () => {
    const text = value.trim();
    if (!text || disabled) return;
    setValue("");
    collapse();
    void onSend(text);
  };

  return (
    <div className="clyra-voice-controls" aria-label="Voice call controls">
      <div className="clyra-voice-controls-v2">
        <div className="clyra-voice-side-control clyra-voice-side-control--mute" style={{ opacity: open ? 0 : 1, transform: open ? "translateX(14px) scale(.84)" : "none", pointerEvents: open ? "none" : "auto" }}>
          <button
            type="button"
            className={`clyra-voice-round-btn${muted ? " clyra-voice-round-btn--muted" : ""}`}
            aria-label={muted ? "Unmute microphone" : "Mute microphone"}
            aria-pressed={muted}
            title={muted ? "Unmute microphone" : "Mute microphone"}
            onClick={onMute}
            disabled={disabled}
            tabIndex={open ? -1 : 0}
          >
            <MicIcon muted={muted} />
          </button>
          <span className="clyra-voice-side-control__label">{muted ? "Muted" : "Mute"}</span>
        </div>

        <div className="clyra-voice-side-control clyra-voice-side-control--end" style={{ opacity: open ? 0 : 1, transform: open ? "scale(.84)" : "none", pointerEvents: open ? "none" : "auto" }}>
          <button type="button" className="clyra-voice-round-btn clyra-voice-round-btn--end" aria-label="End" title="End call" onClick={onEnd} tabIndex={open ? -1 : 0}>
            <svg data-ico="x" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
          </button>
          <span className="clyra-voice-side-control__label">End</span>
        </div>

        <div className="clyra-voice-type-label" style={{ opacity: open ? 0 : 1 }}>Type</div>

        <div className={`clyra-voice-morph ${open ? "clyra-voice-morph--open" : "clyra-voice-morph--closed"}`}>
          <button
            type="button"
            data-morph={open ? "open" : "closed"}
            className="clyra-voice-morph__btn"
            aria-label="Type a message"
            title="Type a message"
            aria-hidden={open}
            onClick={onOpen}
            tabIndex={open ? -1 : 0}
            style={{
              background: open ? "rgba(255,255,255,.94)" : "rgba(0,0,0,.045)",
              borderColor: open ? "rgba(0,0,0,.07)" : "rgba(0,0,0,.025)",
              boxShadow: open ? "0 8px 30px rgba(0,0,0,.055)" : "0 8px 30px rgba(0,0,0,0)",
              cursor: open ? "default" : "pointer",
            }}
          >
            <span className="clyra-voice-morph__icon" style={{ opacity: open ? 0 : 1 }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" data-ico="kb" style={{ display: "block" }}>
                <rect width="20" height="16" x="2" y="4" rx="2" />
                <path d="M6 8h.01M10 8h.01M14 8h.01M18 8h.01M8 12h.01M12 12h.01M16 12h.01" />
                <path d="M7 16h10" />
              </svg>
            </span>
          </button>
        </div>

        <AnimatePresence>
          {open ? (
            <motion.div
              className="clyra-voice-composer-v2"
              initial={{ opacity: 0, x: "-50%", scale: reduced ? 1 : 0.98 }}
              animate={{ opacity: 1, x: "-50%", scale: 1 }}
              exit={{ opacity: 0, x: "-50%", scale: reduced ? 1 : 0.98 }}
              transition={{ duration: reduced ? 0.08 : 0.24, ease: E }}
              onSubmit={(event) => { event.preventDefault(); submit(); }}
            >
              <button type="button" className="clyra-voice-composer-v2__close" aria-label="Close composer" title="Close" onClick={collapse}>
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 6 6 18" />
                  <path d="m6 6 12 12" />
                </svg>
              </button>
              <input
                ref={inputRef}
                value={value}
                onChange={(event) => setValue(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") { event.preventDefault(); collapse(); return; }
                  if (event.key === "Enter") { event.preventDefault(); submit(); }
                }}
                placeholder="Message Clyra…"
                aria-label="Message Clyra"
                autoComplete="off"
                className="clyra-voice-composer-v2__input"
                disabled={disabled}
              />
              <button
                type="button"
                className="clyra-voice-composer-v2__send"
                aria-label="Send"
                title="Send"
                disabled={!value.trim() || disabled}
                onClick={submit}
                style={{ background: value.trim() ? "#1a1a19" : "rgba(0,0,0,.06)", color: value.trim() ? "#ffffff" : "rgba(25,25,25,.35)" }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                  <path d="m5 12 7-7 7 7" />
                  <path d="M12 19V5" />
                </svg>
              </button>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>
    </div>
  );
}
