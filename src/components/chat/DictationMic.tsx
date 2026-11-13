import { useEffect, useMemo, useRef } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Mic } from "lucide-react";
import { canStartDictation, formatDictationElapsed, isDictationHold, isDictationSessionOpen } from "../../lib/composerDictation";
import type { DictationControls } from "../../lib/useDictationController";
import { DictationSteps } from "./DictationSteps";

/** The microphone button every composer uses: tap to start and stop, or hold to talk. Same behaviour as Chat. */
export function DictationMicButton({ dictation, className = "", size = 17, onDark = false }: { dictation: DictationControls; className?: string; size?: number; onDark?: boolean }) {
  const phase = dictation.phase;
  const press = useRef<{ downAt: number; startedHere: boolean } | null>(null);
  const ignoreClick = useRef(false);
  useEffect(() => {
    if (!isDictationSessionOpen(phase)) return undefined;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") dictation.onCancel(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);
  const listening = phase === "listening";
  return (
    <button
      type="button"
      className={`clyra-mic ${className}`.trim()}
      data-on={listening}
      data-dark={onDark || undefined}
      aria-label={listening ? "Stop dictation" : phase === "starting" ? "Cancel starting dictation" : "Dictate"}
      aria-pressed={listening}
      aria-busy={phase === "transcribing"}
      title={listening ? "Tap to stop and transcribe" : phase === "transcribing" ? "Transcribing…" : "Dictate: tap to start, or hold to talk"}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        const starts = canStartDictation(phase);
        press.current = { downAt: performance.now(), startedHere: starts };
        ignoreClick.current = starts;
        if (starts) dictation.onStart();
      }}
      onPointerUp={() => { const p = press.current; press.current = null; if (p?.startedHere && isDictationHold(p.downAt, performance.now())) dictation.onStop(); }}
      onPointerLeave={() => { const p = press.current; press.current = null; if (p?.startedHere && isDictationHold(p.downAt, performance.now())) { dictation.onStop(); ignoreClick.current = false; } }}
      onPointerCancel={() => { press.current = null; }}
      onClick={(e) => {
        e.stopPropagation();
        if (ignoreClick.current) { ignoreClick.current = false; return; }
        if (phase === "listening") dictation.onStop();
        else if (phase === "starting") dictation.onCancel();
        else if (canStartDictation(phase)) dictation.onStart();
      }}
    >
      <Mic size={size} strokeWidth={1.9} style={{ opacity: phase === "transcribing" ? 0.45 : 1 }} />
    </button>
  );
}

/**
 * The recording strip that takes the place of a text field while you speak: a live waveform that follows your voice,
 * the time, and Cancel. It fades in over the field instead of swapping it, and the steps appear above it.
 */
export function DictationStrip({ dictation, height = 44 }: { dictation: DictationControls; height?: number }) {
  const reduced = useReducedMotion();
  const phase = dictation.phase;
  const busy = phase === "starting" || phase === "listening" || phase === "transcribing";
  const bars = useMemo(() => Array.from({ length: 34 }, (_, i) => ({ base: 4 + Math.round(Math.abs(Math.sin(i * 1.7) * 0.6 + Math.sin(i * 0.5)) * 7), env: 0.35 + 0.65 * Math.abs(Math.sin(i / 4.1)) })), []);
  // the level arrives ~30 times a second; the bars ease toward it so they rise fast and fall gently
  const smooth = useRef(0);
  smooth.current += (dictation.level - smooth.current) * (dictation.level > smooth.current ? 0.7 : 0.18);
  return (
    <AnimatePresence initial={false}>
      {busy ? (
        <motion.div
          key="strip"
          className="clyra-dstrip"
          style={{ height }}
          initial={reduced ? false : { opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -2, transition: { duration: 0.16 } }}
          transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
          role="status"
          aria-live="polite"
        >
          <span className="clyra-dstrip__label"><i data-live={phase === "listening"} aria-hidden />{phase === "transcribing" ? "Transcribing…" : phase === "starting" ? "Starting microphone…" : "Listening…"}</span>
          {dictation.flow?.partial ? (
            <span className="clyra-dstrip__partial">{dictation.flow.partial}</span>
          ) : (
            <span className="clyra-dstrip__wave" aria-hidden>
              {phase === "listening" ? bars.map((b, i) => <b key={i} style={{ height: Math.max(3, b.base * (0.4 + smooth.current * 1.6)), opacity: 0.3 + 0.6 * b.env }} />) : null}
            </span>
          )}
          <span className="clyra-dstrip__time">{phase === "listening" ? formatDictationElapsed(dictation.elapsedSeconds) : ""}</span>
          {isDictationSessionOpen(phase) ? <button type="button" className="clyra-dstrip__cancel" onClick={dictation.onCancel} aria-label="Cancel dictation" title="Cancel dictation (Esc)">Cancel</button> : null}
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

/** The dictation stages as rows above a field, opening and closing smoothly. */
export function DictationStepsDrawer({ dictation }: { dictation: DictationControls }) {
  const reduced = useReducedMotion();
  return (
    <AnimatePresence initial={false}>
      {dictation.steps.length ? (
        <motion.div
          key="steps"
          style={{ overflow: "hidden" }}
          initial={reduced ? false : { height: 0, opacity: 0 }}
          animate={{ height: "auto", opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
        >
          <div style={{ padding: "8px 14px 6px" }}><DictationSteps steps={dictation.steps} /></div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
