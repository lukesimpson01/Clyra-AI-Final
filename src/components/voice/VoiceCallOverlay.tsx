import { useCallback, useEffect, useRef, useState, type FormEvent, type MutableRefObject, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { createPortal } from "react-dom";
import { ArrowUp, MessageSquareText, Mic, MicOff, PhoneOff, X } from "lucide-react";
import type { VoiceCallState } from "../../lib/voiceCallStateMachine";
import type { VoiceStatus, VoiceTurn } from "../../hooks/useVoiceCall";
import { cn } from "../../lib/utils";
import { prefersReducedMotion, SPRING_CRITICAL } from "../../lib/motion";
import type { VoiceWaveformSignal } from "./VoiceWaveform";
import { voiceCallUIState } from "./VoiceActivityCapsule";
import { VoiceLevelMeter } from "./VoiceLevelMeter";

type VoiceOption = { id: string; label: string; description: string };

type VoiceCallOverlayProps = {
  open: boolean;
  status: VoiceStatus;
  phase: VoiceCallState;
  muted: boolean;
  micLevel: number;
  waveformSignalRef: MutableRefObject<VoiceWaveformSignal>;
  partialTranscript: string;
  assistantText: string;
  error: string | null;
  turns: VoiceTurn[];
  voices: VoiceOption[];
  selectedVoiceId: string;
  onSelectVoice: (id: string) => void;
  onToggleMute: () => void;
  onEnd: () => void;
  onRetry?: () => void;
  onRetryMicrophone?: () => boolean | Promise<boolean>;
  onSendText: (text: string) => boolean | void;
  onUpdateUserMessage: (id: string, content: string) => void;
  onResendUserMessage: (id: string, contentOverride?: string) => boolean | void;
  onOpenNavigation?: () => void;
};

const stateLabels = {
  connecting: "Connecting",
  listening: "Listening",
  thinking: "Thinking",
  speaking: "Speaking",
  muted: "Muted",
  reconnecting: "Reconnecting",
  ending: "Ending call",
  error: "Voice unavailable",
} as const;

function CallButton({ label, danger, warning, disabled, onClick, children }: {
  label: string;
  danger?: boolean;
  warning?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <motion.button layout type="button" aria-label={label} data-tooltip={label} disabled={disabled} onClick={onClick}
      whileTap={disabled ? undefined : { scale: 0.97 }} transition={prefersReducedMotion() ? { duration: 0.08 } : SPRING_CRITICAL}
      className={cn("clyra-desktop-control", danger && "is-danger", warning && "is-warning")}>{children}</motion.button>
  );
}

function formatDuration(seconds: number) {
  const safe = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(safe / 60)).padStart(2, "0")}:${String(safe % 60).padStart(2, "0")}`;
}

export function VoiceCallOverlay(props: VoiceCallOverlayProps) {
  const { open, phase, muted, micLevel, waveformSignalRef, partialTranscript, assistantText, error,
    onToggleMute, onEnd, onRetry, onRetryMicrophone, onSendText } = props;
  const [ending, setEnding] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [messageOpen, setMessageOpen] = useState(false);
  const [message, setMessage] = useState("");
  const callRef = useRef<HTMLElement>(null);
  const composerRef = useRef<HTMLFormElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const startedAtRef = useRef(0);
  const uiState = voiceCallUIState(phase, muted, ending);
  const responseText = uiState === "speaking" ? assistantText.trim() : "";
  const heardText = !responseText && !/^transcribing/i.test(partialTranscript.trim())
    ? partialTranscript.trim()
    : "";

  const endCall = useCallback(() => {
    if (ending) return;
    setEnding(true);
    setMessageOpen(false);
    onEnd();
  }, [ending, onEnd]);

  const submitMessage = useCallback((event?: FormEvent) => {
    event?.preventDefault();
    const clean = message.trim();
    if (!clean || ending) return;
    if (onSendText(clean) === false) return;
    setMessage("");
    setMessageOpen(false);
  }, [ending, message, onSendText]);

  useEffect(() => {
    if (!open) {
      setEnding(false);
      setMessageOpen(false);
      setMessage("");
      return;
    }
    startedAtRef.current = Date.now();
    setElapsedSeconds(0);
    const timer = window.setInterval(() => setElapsedSeconds(Math.floor((Date.now() - startedAtRef.current) / 1_000)), 1_000);
    return () => window.clearInterval(timer);
  }, [open]);

  useEffect(() => {
    if (!messageOpen) return;
    const frame = requestAnimationFrame(() => inputRef.current?.focus());
    const closeOnOutsidePress = (event: PointerEvent) => {
      const target = event.target as Element | null;
      // Keep the dock geometry stable through pointer-up. Collapsing the
      // composer on pointer-down would move Mute/End out from under the cursor
      // and cancel the user's intended click.
      if (target?.closest(".clyra-desktop-dock")) return;
      if (!composerRef.current?.contains(target)) setMessageOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutsidePress);
    return () => { cancelAnimationFrame(frame); document.removeEventListener("pointerdown", closeOnOutsidePress); };
  }, [messageOpen]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && messageOpen) { event.preventDefault(); setMessageOpen(false); }
      if (event.key.toLowerCase() === "m" && !event.metaKey && !event.ctrlKey && !(event.target instanceof HTMLInputElement)) {
        event.preventDefault();
        if (!ending) onToggleMute();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [ending, messageOpen, onToggleMute, open]);

  useEffect(() => {
    if (!open) return;
    let frame = 0;
    let previous = performance.now();
    let smoothed = 0;
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const tick = (now: number) => {
      frame = requestAnimationFrame(tick);
      if (now - previous < (reduced ? 100 : 32)) return;
      previous = now;
      const signal = waveformSignalRef.current;
      const raw = muted || ending ? 0 : Math.max(0, Math.min(1, now - signal.updatedAt < 520 ? signal.level : micLevel));
      smoothed += (raw - smoothed) * 0.11;
      callRef.current?.style.setProperty("--flow-energy", smoothed.toFixed(3));
      callRef.current?.style.setProperty("--flow-bloom-opacity", (0.54 + smoothed * 0.2).toFixed(3));
      callRef.current?.style.setProperty("--flow-local-opacity", (0.38 + smoothed * 0.2).toFixed(3));
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [ending, micLevel, muted, open, waveformSignalRef]);

  const helper = muted ? "Your microphone is off." : "Speak naturally. You can interrupt at any time.";
  const overlay = (
    <AnimatePresence>{open ? (
      <motion.section ref={callRef} key="desktop-voice-call" role="dialog" aria-modal="true" aria-label="Clyra Voice call"
        data-state={uiState} className={cn("clyra-desktop-call", ending && "is-ending", messageOpen && "has-message-composer")}
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.38 } }}
        transition={{ duration: prefersReducedMotion() ? 0.1 : 0.46, ease: [0.16, 1, 0.3, 1] }}>
        <motion.div className="clyra-flow-light" aria-hidden="true"
          initial={{ opacity: 0, y: 110, scaleY: 0.72 }} animate={{ opacity: ending ? 0 : 1, y: ending ? 90 : 0, scaleY: ending ? 0.78 : 1 }}
          transition={{ delay: ending || prefersReducedMotion() ? 0 : 0.12, duration: ending ? 0.42 : 0.88, ease: [0.16, 1, 0.3, 1] }}><i /><i /><i /><i /></motion.div>

        <motion.header className="clyra-call-identity" initial={{ opacity: 0, y: -10, filter: "blur(4px)" }} animate={{ opacity: ending ? 0 : 1, y: ending ? -5 : 0, filter: "blur(0px)" }}
          exit={{ opacity: 0, y: -5 }} transition={{ delay: ending || prefersReducedMotion() ? 0 : 0.09, duration: ending ? 0.26 : 0.42, ease: [0.16, 1, 0.3, 1] }}>
          <strong>Clyra Voice</strong><span>Connected · {formatDuration(elapsedSeconds)}</span>
        </motion.header>

        <main className="clyra-desktop-call-main"><motion.div className="clyra-call-presence" initial={{ opacity: 0, y: 22, scale: 0.975, filter: "blur(7px)" }}
          animate={{ opacity: ending ? 0 : 1, y: ending ? 10 : 0, scale: ending ? 0.985 : 1, filter: ending ? "blur(5px)" : "blur(0px)" }} exit={{ opacity: 0, y: 10, scale: 0.985 }}
          transition={{ delay: ending || prefersReducedMotion() ? 0 : 0.14, duration: ending ? 0.34 : 0.62, ease: [0.16, 1, 0.3, 1] }}>
          <div className="clyra-voice-presence-mark" data-state={uiState} aria-hidden="true"><i /><i /><i /></div>
          <AnimatePresence mode="wait" initial={false}><motion.h1 key={uiState} initial={{ opacity: 0, y: 6, filter: "blur(3px)" }}
            animate={{ opacity: 1, y: 0, filter: "blur(0px)" }} exit={{ opacity: 0, y: -5, filter: "blur(2px)" }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}>{stateLabels[uiState]}</motion.h1></AnimatePresence>
          <VoiceLevelMeter signalRef={waveformSignalRef} fallbackLevel={micLevel} phase={ending ? "ending" : phase} muted={uiState === "muted" || ending} />
          <div className={cn("clyra-call-live-copy", error && "is-error", responseText && "has-response")} aria-live="polite">
            <AnimatePresence mode="wait" initial={false}>
              {error ? <motion.p key="error" className="clyra-call-helper" initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -3 }}>{error}</motion.p>
                : responseText ? <motion.p key="response" className="clyra-call-response" initial={{ opacity: 0, y: 8, filter: "blur(3px)" }} animate={{ opacity: 1, y: 0, filter: "blur(0px)" }} exit={{ opacity: 0, y: -5 }} transition={{ duration: 0.28 }}>{responseText}</motion.p>
                  : heardText ? <motion.p key="heard" className="clyra-call-heard" initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -3 }}>{heardText}</motion.p>
                    : <motion.p key="helper" className="clyra-call-helper" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>{helper}</motion.p>}
            </AnimatePresence>
            {error ? <div className="clyra-call-recovery-actions">
              <button type="button" onClick={() => void (onRetryMicrophone?.() ?? onRetry?.())}>Enable microphone</button>
              {onRetry ? <button type="button" onClick={onRetry}>Reconnect</button> : null}
            </div> : null}
          </div>
        </motion.div></main>

        <motion.nav layout className="clyra-desktop-dock clyra-desktop-dock--minimal" aria-label="Call controls"
          initial={{ opacity: 0, y: 26, scale: 0.965, filter: "blur(5px)" }} animate={{ opacity: ending ? 0 : 1, y: ending ? 16 : 0, scale: ending ? 0.975 : 1, filter: ending ? "blur(4px)" : "blur(0px)" }} exit={{ opacity: 0, y: 14, scale: 0.98 }}
          transition={{ layout: { type: "spring", stiffness: 380, damping: 38, mass: 0.82 }, delay: ending || prefersReducedMotion() ? 0 : 0.18, duration: ending ? 0.3 : 0.56, ease: [0.16, 1, 0.3, 1] }}>
          <CallButton label={muted ? "Unmute microphone" : "Mute microphone"} warning={muted} disabled={ending} onClick={onToggleMute}>
            {muted ? <MicOff /> : <Mic />}
          </CallButton>

          <motion.form ref={composerRef} onSubmit={submitMessage} data-expanded={messageOpen} className="clyra-message-morph">
            <motion.button type="button" className="clyra-desktop-control clyra-message-button" aria-label="Message" data-tooltip="Message"
              aria-hidden={messageOpen} tabIndex={messageOpen ? -1 : 0} disabled={ending} onClick={() => setMessageOpen(true)}
              animate={{ opacity: messageOpen ? 0 : 1, scale: messageOpen ? 0.76 : 1, x: messageOpen ? -9 : 0 }}
              transition={{ duration: messageOpen ? 0.26 : 0.22, delay: messageOpen ? 0 : 0.12, ease: [0.2, 0.75, 0.2, 1] }} whileTap={{ scale: 0.97 }}><MessageSquareText /></motion.button>
            <motion.div className="clyra-message-composer" aria-hidden={!messageOpen}
              animate={{ opacity: messageOpen ? 1 : 0, x: messageOpen ? 0 : 14, scale: messageOpen ? 1 : 0.985 }}
              transition={{ duration: messageOpen ? 0.24 : 0.14, delay: messageOpen ? 0.1 : 0, ease: [0.16, 1, 0.3, 1] }}>
              <MessageSquareText aria-hidden="true" /><input ref={inputRef} disabled={!messageOpen || ending} tabIndex={messageOpen ? 0 : -1} value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Type a message…" aria-label="Type a message" />
              <button type="button" disabled={!messageOpen} tabIndex={messageOpen ? 0 : -1} className="clyra-message-close" onClick={() => setMessageOpen(false)} aria-label="Close message input"><X /></button>
              <button type="submit" tabIndex={messageOpen ? 0 : -1} className="clyra-message-send" disabled={!messageOpen || !message.trim()} aria-label="Send message"><ArrowUp /></button>
            </motion.div>
          </motion.form>

          <CallButton label="End call" danger disabled={ending} onClick={endCall}><PhoneOff /></CallButton>
        </motion.nav>
      </motion.section>
    ) : null}</AnimatePresence>
  );
  return typeof document === "undefined" ? overlay : createPortal(overlay, document.body);
}
