/**
 * Self-contained Clyra voice-call screen.
 *
 * This file is intentionally dependency-free from the rest of the codebase:
 * every type, helper, sub-component and math utility it needs is defined
 * inline below. The only imports are external npm packages (react,
 * framer-motion, lucide-react). VoiceCallHost renders <VoiceCallScreen /> and
 * drives it through the `call` prop, so this whole file can be blanked out and
 * replaced with your own implementation as long as you keep the named export
 * `VoiceCallScreen` and accept the `VoiceCallScreenProps` shape below.
 */
import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useAnimationControls, useReducedMotion } from "framer-motion";
import { Camera, Monitor, ExternalLink, FileText, Globe2, Hand, Mail, Maximize2, MessageSquareText, Minimize2, Pause, Play, Square } from "lucide-react";
import { VoiceMediaSurface } from "./VoiceMediaSurface";

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export type VoiceCallState =
  | "entering"
  | "idle"
  | "ready"
  | "listening"
  | "transcribing"
  | "thinking"
  | "responding"
  | "acting_browser"
  | "acting_computer"
  | "acting_clyra"
  | "awaiting_approval"
  | "user_takeover"
  | "paused"
  | "error"
  | "ending";

export type ApprovalRequest = {
  id: string;
  title: string;
  detail: string;
  confirmLabel?: string;
  payload?: unknown;
};

export type AgentPlanStep = {
  id: string;
  label: string;
  status: "pending" | "active" | "complete" | "blocked";
};

export type AgentTask = {
  id: string;
  label: string;
  detail?: string;
  kind: "browser" | "computer" | "integration" | "clyra";
  status: "running" | "paused" | "waiting" | "complete" | "failed";
  progress?: number;
  steps?: AgentPlanStep[];
  canTakeControl?: boolean;
  canPause?: boolean;
  canStop?: boolean;
};

export type AgentSurface = {
  id: string;
  kind: "browser" | "email" | "document" | "file" | "map" | "app";
  title: string;
  subtitle?: string;
  url?: string;
  preview?: string;
  content?: unknown;
  expanded?: boolean;
};

export type VoiceCallScreenCall = {
  active: boolean;
  state: VoiceCallState;
  status: VoiceCallState;
  muted: boolean;
  resting: boolean;
  composerOpen: boolean;
  micLevel: number;
  botLevel: number;
  partialTranscript: string;
  committedTranscript: string;
  responseText: string;
  elapsedSeconds: number;
  error: string | null;
  actionLabel?: string;
  activeTask?: AgentTask;
  activeSurface?: AgentSurface;
  requiresApproval?: ApprovalRequest;
  lowPowerMode: boolean;
  endCall: () => void | Promise<void>;
  toggleMute: () => void;
  sendText: (text: string) => void | Promise<void>;
  openComposer: () => void;
  closeComposer: () => void;
  pauseTask: () => void;
  resumeTask: () => void;
  takeControl: () => void;
  stopTask: () => void;
  confirmApproval: () => void;
  rejectApproval: () => void;
  toggleSurfaceExpanded: () => void;
};

export type VoiceCallScreenProps = {
  call: VoiceCallScreenCall;
  testMode: boolean;
  avatarColor?: string;
  onOpenSettings?: () => void;
  mediaMode?: "camera" | "screen" | null;
  onMediaModeChange?: (mode: "camera" | "screen" | null) => void;
};

/* ------------------------------------------------------------------ */
/* Math helpers (inlined from src/voice/bloub)                         */
/* ------------------------------------------------------------------ */

const TAU = Math.PI * 2;
const clamp = (v: number, lo = 0, hi = 1) => (v < lo ? lo : v > hi ? hi : v);
const r2 = (v: number) => Math.round(v * 100) / 100;

function loopNoise(t: number, period: number, seed = 0): number {
  const p = (t / period) * TAU;
  return (
    0.55 * Math.sin(p + seed) +
    0.3 * Math.sin(2 * p + seed * 1.7 + 1.1) +
    0.15 * Math.sin(3 * p + seed * 2.3 + 2.4)
  );
}

/** Capsule (stadium) centred on the origin: the exact shape of the bot's eyes. */
function capsulePath(w: number, h: number): string {
  const hw = Math.max(w, 0.01) / 2;
  const hh = Math.max(h, 0.01) / 2;
  const r = Math.min(hw, hh);
  return (
    `M${r2(-hw)} ${r2(-hh + r)}` +
    `A${r2(r)} ${r2(r)} 0 0 1 ${r2(-hw + r)} ${r2(-hh)}` +
    `L${r2(hw - r)} ${r2(-hh)}` +
    `A${r2(r)} ${r2(r)} 0 0 1 ${r2(hw)} ${r2(-hh + r)}` +
    `L${r2(hw)} ${r2(hh - r)}` +
    `A${r2(r)} ${r2(r)} 0 0 1 ${r2(hw - r)} ${r2(hh)}` +
    `L${r2(-hw + r)} ${r2(hh)}` +
    `A${r2(r)} ${r2(r)} 0 0 1 ${r2(-hw)} ${r2(hh - r)}Z`
  );
}

/** Shared-element orb anchor. The chat home orb writes its element to
 * `window.__clyraOrbAnchorEl` (see src/voice/orbAnchor.ts); we read it here so
 * the call's orb can fly out of / back into the same spot. With no anchor the
 * presence simply blooms in. */
function getOrbAnchorRect(): DOMRect | null {
  const el = (window as { __clyraOrbAnchorEl?: HTMLElement | null }).__clyraOrbAnchorEl;
  if (!el || !el.isConnected) return null;
  const rect = el.getBoundingClientRect();
  return rect.width > 8 && rect.height > 8 ? rect : null;
}

/* ------------------------------------------------------------------ */
/* ClyraFace (inlined from src/voice/ClyraFace.tsx)                    */
/* ------------------------------------------------------------------ */

interface HomeFaceHandle {
  track: (nx: number, ny: number) => void;
  setLook: (mode: "forward" | "down") => void;
}

type Mood = "rest" | "muted" | "thinking" | "responding" | "acting" | "paused" | "takeover" | "typing";

interface EyeTarget {
  w: number;
  h: number;
  y: number;
  rotate: number;
}

const MOODS: Record<Mood, EyeTarget> = {
  rest: { w: 22, h: 50, y: -3, rotate: 0 },
  muted: { w: 27, h: 10, y: 8, rotate: 0 },
  thinking: { w: 17, h: 17, y: -11, rotate: 0 },
  responding: { w: 26, h: 27, y: -14, rotate: 0 },
  acting: { w: 22, h: 22, y: -5, rotate: 0 },
  paused: { w: 29, h: 25, y: 14, rotate: 0 },
  takeover: { w: 24, h: 24, y: -5, rotate: 0 },
  typing: { w: 20, h: 20, y: 14, rotate: 0 },
};

const BALL_FILTER: Partial<Record<Mood, string>> = {
  muted: "saturate(0.3) brightness(1.08)",
  paused: "saturate(0.56) brightness(1.05)",
  takeover: "saturate(0.8) brightness(1.03)",
};

const EYE_GAP = 30;
const BLINK_DURATION_MS = 200;
const GAZE_RANGE_X = 22;
const GAZE_RANGE_Y = 16;
const GAZE_DOWN = 18;

function moodFor(state: VoiceCallState, muted: boolean, resting: boolean, typing: boolean): Mood {
  if (typing) return "typing";
  if (muted && (state === "ready" || state === "listening" || state === "transcribing" || state === "error" || state === "entering" || state === "awaiting_approval")) return "muted";
  if (state === "thinking") return "thinking";
  if (state === "responding") return "responding";
  if (state === "acting_browser" || state === "acting_computer" || state === "acting_clyra") return "acting";
  if (state === "user_takeover") return "takeover";
  if (state === "paused") return "paused";
  if (resting) return "rest";
  return "rest";
}

function dotPulse(t: number, index: number): number {
  const p = ((((t - index * 0.5) / 1.5) % 1) + 1) % 1;
  const k = p < 0.5 ? 0.5 - 0.5 * Math.cos(p * Math.PI * 2) : 0;
  return clamp(k * 2);
}

type FaceProps = {
  state: VoiceCallState;
  muted: boolean;
  resting?: boolean;
  typing?: boolean;
  lowPower?: boolean;
};

const ClyraFace = forwardRef<HomeFaceHandle, FaceProps>(function ClyraFace(
  { state, muted, resting = false, typing = false, lowPower = false },
  ref,
) {
  const ballRef = useRef<HTMLDivElement | null>(null);
  const eyeARef = useRef<SVGPathElement | null>(null);
  const eyeBRef = useRef<SVGPathElement | null>(null);
  const dotsRef = useRef<SVGGElement | null>(null);
  const dotRefs = useRef<(SVGCircleElement | null)[]>([]);
  const inputRef = useRef({ state, muted, resting, typing, lowPower });
  inputRef.current = { state, muted, resting, typing, lowPower };

  const gazeRef = useRef<{ mode: "forward" | "down" | "track"; nx: number; ny: number }>({
    mode: "forward",
    nx: 0,
    ny: 0,
  });
  const gazeCurRef = useRef({ x: 0, y: 0 });

  useImperativeHandle(ref, () => ({
    track: (nx, ny) => {
      gazeRef.current = { mode: "track", nx: clamp(nx, -1, 1), ny: clamp(ny, -1, 1) };
    },
    setLook: (mode) => {
      gazeRef.current = { mode, nx: 0, ny: 0 };
    },
  }), []);

  useEffect(() => {
    let raf = 0;
    let disposed = false;
    let last = performance.now();
    const cur: EyeTarget = { ...MOODS.rest };
    let nextBlinkAt = performance.now() + 2200 + Math.random() * 2200;
    let blinkStartedAt = -Infinity;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let lastPaint = 0;
    const render = (now: number) => {
      if (disposed) return;
      raf = requestAnimationFrame(render);
      // Hidden windows and low-power calls should not spend full-frame CPU on
      // decorative SVG eye motion. Foreground calls retain full frame cadence.
      if (document.hidden) { last = now; return; }
      const frameInterval = inputRef.current.lowPower ? 42 : reducedMotion ? 85 : 0;
      if (now - lastPaint < frameInterval) return;
      lastPaint = now;
      const dt = Math.min(48, Math.max(8, now - last));
      last = now;

      const { state: s, muted: m, resting: r, typing: ty, lowPower: lp } = inputRef.current;
      const mood = moodFor(s, m, r, ty);
      const target = MOODS[mood];
      const rate = clamp((reducedMotion ? 1 : dt / 16.667) * 0.16);
      cur.w += (target.w - cur.w) * rate;
      cur.h += (target.h - cur.h) * rate;
      cur.y += (target.y - cur.y) * rate;
      cur.rotate += (target.rotate - cur.rotate) * rate;

      const gaze = gazeRef.current;
      let targetGx = 0;
      let targetGy = 0;
      if (gaze.mode === "track") {
        targetGx = gaze.nx * GAZE_RANGE_X;
        targetGy = gaze.ny * GAZE_RANGE_Y;
      } else if (gaze.mode === "down") {
        targetGy = GAZE_DOWN;
      }
      const gazeRate = clamp((reducedMotion ? 1 : dt / 16.667) * 0.22);
      gazeCurRef.current.x += (targetGx - gazeCurRef.current.x) * gazeRate;
      gazeCurRef.current.y += (targetGy - gazeCurRef.current.y) * gazeRate;

      const thinking = mood === "thinking";
      const blinkEligible = !reducedMotion && !thinking && mood !== "muted" && mood !== "paused";
      if (blinkEligible && now >= nextBlinkAt) {
        blinkStartedAt = now;
        nextBlinkAt = now + 2200 + Math.random() * 2200;
      }
      const blinkT = (now - blinkStartedAt) / BLINK_DURATION_MS;
      const blinkK = blinkT >= 0 && blinkT <= 1 ? Math.sin(blinkT * Math.PI) : 0;
      const blinkScale = 1 - blinkK * 0.94;

      const t = now / 1000;
      const driftX = reducedMotion || lp ? 0 : loopNoise(t, 7.9, 1.9) * 1.1;
      const driftY = reducedMotion || lp ? 0 : loopNoise(t, 5.3, 0.3) * 0.8;

      const h = Math.max(0.6, cur.h * blinkScale);
      const d = capsulePath(cur.w, h);
      const eyeOpacity = thinking ? 0 : 1;
      const gx = driftX + gazeCurRef.current.x;
      const gy = driftY + gazeCurRef.current.y;

      if (eyeARef.current) {
        eyeARef.current.setAttribute("d", d);
        eyeARef.current.setAttribute("opacity", String(eyeOpacity));
        eyeARef.current.setAttribute(
          "transform",
          `translate(${(-EYE_GAP + gx).toFixed(2)} ${(cur.y + gy).toFixed(2)}) rotate(${cur.rotate.toFixed(2)})`
        );
      }
      if (eyeBRef.current) {
        eyeBRef.current.setAttribute("d", d);
        eyeBRef.current.setAttribute("opacity", String(eyeOpacity));
        eyeBRef.current.setAttribute(
          "transform",
          `translate(${(EYE_GAP + gx).toFixed(2)} ${(cur.y + gy).toFixed(2)}) rotate(${(-cur.rotate).toFixed(2)})`
        );
      }

      if (dotsRef.current) {
        dotsRef.current.setAttribute("opacity", thinking ? "1" : "0");
      }
      if (thinking) {
        const positions = [-EYE_GAP, 0, EYE_GAP];
        for (let i = 0; i < 3; i++) {
          const dot = dotRefs.current[i];
          if (!dot) continue;
          const k = dotPulse(t, i);
          dot.setAttribute("cx", String(positions[i]));
          dot.setAttribute("cy", "-11");
          dot.setAttribute("r", (1.4 + 7.1 * k).toFixed(2));
        }
      }

      if (ballRef.current) {
        const filter = BALL_FILTER[mood] ?? (mood === "rest" && r ? "saturate(0.78) brightness(1.02)" : "");
        if (ballRef.current.style.filter !== filter) ballRef.current.style.filter = filter;
      }
    };

    raf = requestAnimationFrame(render);
    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <div ref={ballRef} className="clyra-face-ball" aria-hidden="true">
      <div className="clyra-face-fluid">
        <span />
        <span />
        <span />
      </div>
      <div className="clyra-face-highlight" />
      <div className="clyra-face-shade" />
      <svg className="clyra-face-eyes" viewBox="-100 -100 200 200">
        <path ref={eyeARef} fill="#fff" d={capsulePath(22, 50)} />
        <path ref={eyeBRef} fill="#fff" d={capsulePath(22, 50)} />
        <g ref={dotsRef} opacity="0">
          {[0, 1, 2].map((i) => (
            <circle
              key={i}
              ref={(el) => {
                dotRefs.current[i] = el;
              }}
              cx={(i - 1) * EYE_GAP}
              cy={-11}
              r={0}
              fill="#fff"
            />
          ))}
        </g>
      </svg>
    </div>
  );
});

ClyraFace.displayName = "ClyraFace";

/* ------------------------------------------------------------------ */
/* VoicePresence (inlined from src/voice/VoicePresence.tsx)            */
/* ------------------------------------------------------------------ */

function VoicePresence({ state, micLevel, muted, resting = false, typing = false, compact = false, lowPower = false }: {
  state: VoiceCallState;
  micLevel: number;
  botLevel: number;
  muted: boolean;
  resting?: boolean;
  typing?: boolean;
  compact?: boolean;
  lowPower?: boolean;
}) {
  // Only real microphone energy affects the audio ring. The responding pose
  // remains state-driven until an actual playback meter is available.
  const isListening = state === "listening" || state === "transcribing";
  const energy = !muted && isListening ? Math.min(1, Math.max(0, micLevel)) : 0;
  return (
    <div
      className={`clyra-voice-presence${compact ? " clyra-voice-presence--compact" : ""}`}
      style={{
        "--voice-energy-opacity": String(energy * 0.55),
        "--voice-energy-scale": String(1.04 + energy * 0.075),
      } as React.CSSProperties}
      data-state={state}
      data-low-power={lowPower || undefined}
      role="img"
      aria-label={state === "responding" ? "Clyra is responding" : state === "thinking" ? "Clyra is thinking" : "Clyra voice presence"}
    >
      <ClyraFace state={state} muted={muted} resting={resting} typing={typing} lowPower={lowPower} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* VoiceComposer (inlined from src/voice/VoiceComposer.tsx)            */
/* ------------------------------------------------------------------ */

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

function VoiceComposer({ open, muted, disabled, onOpen, onClose, onMute, onEnd, onSend, onActivity }: {
  open: boolean;
  muted: boolean;
  disabled?: boolean;
  onOpen: () => void;
  onClose: () => void;
  onMute: () => void;
  onEnd: () => void;
  onSend: (text: string) => void | Promise<void>;
  onActivity?: () => void;
}) {
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
                onChange={(event) => { setValue(event.target.value); onActivity?.(); }}
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

/* ------------------------------------------------------------------ */
/* VoiceControlBar (inlined from src/voice/VoiceControlBar.tsx)        */
/* ------------------------------------------------------------------ */

function VoiceControlBar({ state, task, onPause, onResume, onTakeControl, onStop, onChat }: {
  state: VoiceCallState;
  task: AgentTask;
  onPause: () => void;
  onResume: () => void;
  onTakeControl: () => void;
  onStop: () => void;
  onChat: () => void;
}) {
  const paused = state === "paused";
  const takeover = state === "user_takeover";
  return (
    <div className="clyra-voice-agent-bar" aria-label="Agent controls">
      {task.canPause || takeover ? <button type="button" onClick={paused || takeover ? onResume : onPause}>
          {paused || takeover ? <Play size={16} /> : <Pause size={16} />}
          <span>{takeover ? "Resume Clyra" : paused ? "Resume" : "Pause"}</span>
        </button> : <span aria-hidden />}
      <p>{takeover ? "You’re controlling" : paused ? "Paused" : task.label}</p>
      <div>
        {task.canTakeControl && !takeover ? <button type="button" onClick={onTakeControl}><Hand size={16} /><span>Take Control</span></button> : null}
        <button type="button" onClick={onChat}><MessageSquareText size={16} /><span>Chat</span></button>
        {task.canStop ? <button type="button" onClick={onStop} aria-label="Stop task"><Square size={14} fill="currentColor" /></button> : null}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* VoiceActivitySurface (inlined from src/voice/VoiceActivitySurface)  */
/* ------------------------------------------------------------------ */

function SurfaceIcon({ kind }: { kind: AgentSurface["kind"] }) {
  if (kind === "email") return <Mail size={18} strokeWidth={1.7} />;
  if (kind === "document" || kind === "file") return <FileText size={18} strokeWidth={1.7} />;
  return <Globe2 size={18} strokeWidth={1.7} />;
}

function ResultContent({ content }: { content: unknown }) {
  if (!content) return null;
  if (typeof content === "string") return <p className="clyra-voice-activity__summary">{content}</p>;
  if (typeof content !== "object") return null;
  const record = content as Record<string, unknown>;
  const evidence = Array.isArray(record.evidence) ? record.evidence : [];
  const urls = Array.isArray((record.data as Record<string, unknown> | undefined)?.urls)
    ? ((record.data as Record<string, unknown>).urls as unknown[])
    : Array.isArray(record.urls)
      ? record.urls as unknown[]
      : [];
  const text = typeof record.text === "string" ? record.text : typeof record.detail === "string" ? record.detail : "";
  return (
    <div className="clyra-voice-activity__result">
      {text ? <p className="clyra-voice-activity__summary">{text}</p> : null}
      {[...urls, ...evidence.map((item) => typeof item === "object" && item ? (item as Record<string, unknown>).value : null)]
        .filter((item, index, values): item is string => typeof item === "string" && /^https?:\/\//.test(item) && values.indexOf(item) === index)
        .slice(0, 6)
        .map((url) => (
          <a key={url} href={url} target="_blank" rel="noreferrer" className="clyra-voice-activity__link">
            <span>{new URL(url).hostname.replace(/^www\./, "")}</span><ExternalLink size={13} />
          </a>
        ))}
    </div>
  );
}

function VoiceActivitySurface({ task, surface, controlling, onToggleExpanded }: {
  task: AgentTask;
  surface?: AgentSurface;
  controlling: boolean;
  onToggleExpanded: () => void;
}) {
  const reduced = useReducedMotion();
  const resolved: AgentSurface = surface || {
    id: task.id,
    kind: task.kind === "browser" ? "browser" : "app",
    title: task.kind === "browser" ? "Web research" : "Clyra task",
    subtitle: task.detail,
  };
  return (
    <motion.section
      layout
      initial={{ opacity: 0, y: reduced ? 0 : 12, scale: reduced ? 1 : 0.975 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: reduced ? 0 : 8, scale: reduced ? 1 : 0.985 }}
      transition={{ duration: reduced ? 0.1 : 0.3, ease: [0.22, 1, 0.36, 1] }}
      className={`clyra-voice-activity${resolved.expanded ? " clyra-voice-activity--expanded" : ""}${controlling ? " clyra-voice-activity--controlled" : ""}`}
      aria-label={`${resolved.title} activity surface`}
    >
      <header className="clyra-voice-activity__header">
        <div className="clyra-voice-activity__identity"><SurfaceIcon kind={resolved.kind} /><div><h2>{resolved.title}</h2><p>{resolved.subtitle || task.label}</p></div></div>
        <button type="button" className="clyra-voice-activity__expand" aria-label={resolved.expanded ? "Exit full screen" : "Full screen"} onClick={onToggleExpanded}>
          {resolved.expanded ? <Minimize2 size={17} /> : <Maximize2 size={17} />}
        </button>
      </header>
      <div className="clyra-voice-activity__body">
        {resolved.preview ? <img src={resolved.preview} alt="Live task preview" className="clyra-voice-activity__preview" /> : null}
        {!resolved.preview && task.steps?.length ? (
          <ol className="clyra-voice-activity__steps">
            {task.steps.map((step) => <li key={step.id} data-status={step.status}><span aria-hidden /><p>{step.label}</p></li>)}
          </ol>
        ) : null}
        <AnimatePresence mode="wait"><motion.div key={task.label} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.16 }} className="clyra-voice-activity__status">{task.label}</motion.div></AnimatePresence>
        <ResultContent content={resolved.content} />
      </div>
    </motion.section>
  );
}

/* ------------------------------------------------------------------ */
/* VoiceCallScreen                                                     */
/* ------------------------------------------------------------------ */

const time = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
const activeState = (state: VoiceCallState) => state === "acting_browser" || state === "acting_computer" || state === "acting_clyra" || state === "paused" || state === "user_takeover";

function presenceScale(state: VoiceCallState): number {
  if (state === "thinking") return 0.985;
  if (state === "responding") return 1.008;
  if (state === "paused") return 0.97;
  if (state === "user_takeover") return 0.96;
  return 1;
}

const EASE = [0.22, 1, 0.36, 1] as const;

function groupMotion(phase: "entering" | "live" | "ending", delay: number, distance: number, reduced: boolean | null) {
  if (reduced) return { animate: { opacity: phase === "live" ? 1 : 0, y: 0 }, transition: { duration: 0.08 } };
  if (phase === "entering") return { animate: { opacity: 0, y: distance }, transition: { duration: 0 } };
  if (phase === "ending") return { animate: { opacity: 0, y: 0 }, transition: { duration: 0.18, ease: "easeOut" as const } };
  return { animate: { opacity: 1, y: 0 }, transition: { duration: 0.32, delay, ease: EASE } };
}

function primaryLine(call: VoiceCallScreenCall): { kind: "muted" | "listening" | "thinking" | "ready" | "aux"; text: string } | null {
  if (call.muted && (call.state === "ready" || call.state === "listening" || call.state === "transcribing")) {
    return { kind: "muted", text: "Microphone off" };
  }
  if (call.state === "listening" || call.state === "transcribing") {
    return { kind: "listening", text: "Listening" };
  }
  if (call.state === "thinking") return { kind: "thinking", text: "Thinking" };
  if (call.state === "ready") {
    return { kind: "ready", text: call.resting ? "Resting — speak or type to wake" : "Speak when ready, or press type." };
  }
  if (call.actionLabel) return { kind: "aux", text: call.actionLabel };
  if (call.state === "entering") return { kind: "aux", text: "Connecting" };
  if (call.state === "ending") return { kind: "aux", text: "Ending call" };
  if (call.state === "paused") return { kind: "aux", text: "Paused" };
  if (call.state === "user_takeover") return { kind: "aux", text: "You’re controlling" };
  if (call.state === "awaiting_approval") return { kind: "aux", text: "Needs your approval" };
  if (call.state === "error") return { kind: "aux", text: "Call needs attention" };
  return null;
}

function ApprovalPanel({ approval, onConfirm, onCancel }: { approval: ApprovalRequest; onConfirm: () => void; onCancel: () => void }) {
  const [reviewing, setReviewing] = useState(false);
  useEffect(() => setReviewing(false), [approval.id]);
  return (
    <motion.section initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 6 }} className="clyra-voice-approval" role="dialog" aria-modal="true" aria-labelledby="clyra-voice-approval-title">
      <h2 id="clyra-voice-approval-title">{approval.title}</h2>
      <p>{approval.detail}</p>
      <div>
        <button type="button" onClick={onCancel}>Cancel</button>
        {reviewing ? <button type="button" className="clyra-voice-approval__confirm" onClick={onConfirm}>{approval.confirmLabel || "Confirm"}</button> : <button type="button" onClick={() => setReviewing(true)}>Review</button>}
      </div>
    </motion.section>
  );
}

export function VoiceCallScreen({ call, mediaMode = null, onMediaModeChange }: VoiceCallScreenProps) {
  const reduced = useReducedMotion();
  const duration = useMemo(() => time(call.elapsedSeconds), [call.elapsedSeconds]);
  const hasActivity = Boolean(call.activeTask) || Boolean(mediaMode);
  const response = call.error || call.responseText;
  const [lastTypeAt, setLastTypeAt] = useState(0);
  const [now, setNow] = useState(0);
  useEffect(() => {
    if (!call.composerOpen) return;
    setNow(Date.now());
    const interval = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(interval);
  }, [call.composerOpen]);
  const typing = call.composerOpen && lastTypeAt > 0 && now - lastTypeAt < 2000;
  const line = (call.state === "ready" || call.state === "error") && response ? null : primaryLine(call);
  const kind = line?.kind ?? null;
  const listeningText = "Listening";
  const auxText = line && line.kind === "aux" ? line.text : "";
  const readyText = call.resting ? "Resting — speak or type to wake" : "Speak when ready, or press type.";
  const liveSubtitle = call.state === "transcribing"
    ? call.partialTranscript.trim()
    : call.state === "thinking"
      ? call.committedTranscript.trim()
      : "";

  const phase: "entering" | "live" | "ending" = call.state === "entering" ? "entering" : call.state === "ending" ? "ending" : "live";

  const flyRef = useRef<HTMLDivElement | null>(null);
  const flight = useAnimationControls();
  const homeRectRef = useRef<DOMRect | null>(null);
  const delta = () => {
    const from = homeRectRef.current;
    const el = flyRef.current;
    if (!from || !el) return null;
    let left = 0, top = 0;
    for (let node: HTMLElement | null = el; node; node = node.offsetParent as HTMLElement | null) { left += node.offsetLeft; top += node.offsetTop; }
    const width = el.offsetWidth || 1;
    const height = el.offsetHeight || 1;
    return {
      x: from.left + from.width / 2 - (left + width / 2),
      y: from.top + from.height / 2 - (top + height / 2),
      scale: Math.max(0.2, from.width / width),
    };
  };
  useLayoutEffect(() => {
    if (!call.active) { homeRectRef.current = null; return; }
    homeRectRef.current = getOrbAnchorRect();
    const d = delta();
    if (!d || reduced) {
      flight.set({ x: 0, y: 0, scale: reduced ? 1 : 0.86, opacity: reduced ? 1 : 0 });
      void flight.start({ x: 0, y: 0, scale: 1, opacity: 1, transition: { duration: reduced ? 0.1 : 0.7, ease: EASE } });
      return;
    }
    flight.set({ x: d.x, y: d.y, scale: d.scale, opacity: 1 });
    void flight.start({ x: 0, y: 0, scale: 1, opacity: 1, transition: { type: "spring", stiffness: 120, damping: 20, mass: 0.9 } });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [call.active]);
  useEffect(() => {
    if (phase !== "ending") return;
    const d = delta();
    if (!d) { void flight.start({ opacity: 0, scale: 0.9, transition: { duration: 0.4, ease: EASE } }); return; }
    void flight.start({ x: d.x, y: d.y, scale: d.scale, opacity: 1, transition: { type: "spring", stiffness: 150, damping: 24, mass: 0.9 } });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);
  const headerGroup = groupMotion(phase, 0.38, 4, reduced);
  const controlsGroup = groupMotion(phase, 0.48, 10, reduced);
  const scale = (hasActivity ? 0.72 : 1) * presenceScale(call.state);

  return (
    <AnimatePresence>
      {call.active ? (
        <motion.section
          key="clyra-voice-call"
          initial={{ opacity: 0 }}
          animate={{ opacity: phase === "ending" ? 0 : 1 }}
          exit={{ opacity: 0 }}
          transition={phase === "ending" ? { duration: 0.24, delay: 0.42, ease: "easeOut" } : { duration: reduced ? 0.08 : 0.1, ease: "linear" }}
          className="clyra-voice-call"
          data-state={call.state}
          data-low-power={call.lowPowerMode || undefined}
          aria-label="Clyra voice call"
        >
          <motion.header className="clyra-voice-call__header" animate={headerGroup.animate} transition={headerGroup.transition}>
            <time aria-label={`Call duration ${duration}`}>{duration}</time>
            <div className="clyra-voice-call__media-actions" aria-label="Live media controls">
              <button type="button" aria-label={mediaMode === "camera" ? "Stop camera" : "Start camera"} aria-pressed={mediaMode === "camera"} data-active={mediaMode === "camera"} disabled={call.state === "ending"} onClick={() => onMediaModeChange?.(mediaMode === "camera" ? null : "camera")}><Camera size={17} strokeWidth={1.8} /><span>Camera</span></button>
              <button type="button" aria-label={mediaMode === "screen" ? "Stop screen sharing" : "Start screen sharing"} aria-pressed={mediaMode === "screen"} data-active={mediaMode === "screen"} disabled={call.state === "ending"} onClick={() => onMediaModeChange?.(mediaMode === "screen" ? null : "screen")}><Monitor size={17} strokeWidth={1.8} /><span>Screen</span></button>
            </div>
          </motion.header>

          <main className={`clyra-voice-call__main${hasActivity ? " clyra-voice-call__main--activity" : ""}`}>
            <motion.div
              ref={flyRef}
              className="clyra-voice-call__fly"
              layout="position"
              animate={flight}
              initial={{ opacity: 0 }}
              transition={{ layout: { duration: reduced ? 0.01 : 0.42, ease: EASE } }}
              style={{ willChange: "transform" }}
            >
            <motion.div
              layout
              className="clyra-voice-call__presence"
              animate={{ scale }}
              transition={{ duration: reduced ? 0.1 : 0.3, ease: EASE }}
            >
              <VoicePresence state={call.state} micLevel={call.micLevel} botLevel={call.botLevel} muted={call.muted} resting={call.resting} typing={typing} compact={hasActivity} lowPower={call.lowPowerMode} />
            </motion.div>
            </motion.div>

            <AnimatePresence initial={false}>
              {liveSubtitle ? (
                <motion.p
                  key={liveSubtitle}
                  data-testid="voice-live-subtitle"
                  className="clyra-voice-live-subtitle"
                  initial={reduced ? { opacity: 0 } : { opacity: 0, y: -4, filter: "blur(3px)" }}
                  animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                  exit={reduced ? { opacity: 0 } : { opacity: 0, y: -2, filter: "blur(2px)" }}
                  transition={{ duration: reduced ? 0.08 : 0.22, ease: EASE }}
                  aria-live="polite"
                  aria-atomic="true"
                >
                  {liveSubtitle}
                </motion.p>
              ) : null}
            </AnimatePresence>

            {mediaMode ? <VoiceMediaSurface key={mediaMode} mode={mediaMode} lowPower={call.lowPowerMode} onStop={() => onMediaModeChange?.(null)} /> : null}
            <AnimatePresence mode="popLayout">
              {call.activeTask ? (
                <VoiceActivitySurface key={call.activeTask.id} task={call.activeTask} surface={call.activeSurface} controlling={activeState(call.state) && call.state !== "paused" && call.state !== "user_takeover"} onToggleExpanded={call.toggleSurfaceExpanded} />
              ) : (
                <motion.div className="clyra-voice-call__copy" aria-live="polite" animate={headerGroup.animate} transition={headerGroup.transition}>
                  <motion.p
                    className="clyra-voice-status-line"
                    initial={false}
                    animate={{ opacity: kind === "ready" ? 1 : 0, y: kind === "ready" || reduced ? 0 : 3 }}
                    transition={{ duration: reduced ? 0.08 : 0.24, ease: [0.22, 1, 0.36, 1], delay: kind === "ready" ? 0.09 : 0 }}
                    style={{ color: call.resting ? "rgba(25, 25, 25, .42)" : undefined, pointerEvents: kind === "ready" ? "auto" : "none" }}
                  >
                    {readyText}
                  </motion.p>
                  <motion.p
                    className="clyra-voice-status-line"
                    initial={false}
                    animate={{ opacity: kind === "listening" ? 1 : 0, y: kind === "listening" || reduced ? 0 : 3 }}
                    transition={{ duration: reduced ? 0.08 : 0.24, ease: [0.22, 1, 0.36, 1], delay: kind === "listening" ? 0.09 : 0 }}
                    style={{ pointerEvents: "none" }}
                  >
                    {listeningText}
                  </motion.p>
                  <motion.p
                    className="clyra-voice-status-line"
                    initial={false}
                    animate={{ opacity: kind === "muted" ? 1 : 0, y: kind === "muted" || reduced ? 0 : 3 }}
                    transition={{ duration: reduced ? 0.08 : 0.24, ease: [0.22, 1, 0.36, 1], delay: kind === "muted" ? 0.09 : 0 }}
                    style={{ pointerEvents: "none" }}
                  >
                    Microphone off
                  </motion.p>
                  <motion.p
                    className="clyra-voice-status-line clyra-voice-thinking-label"
                    initial={false}
                    animate={{ opacity: kind === "thinking" ? 1 : 0, y: kind === "thinking" || reduced ? 0 : 3 }}
                    transition={{ duration: reduced ? 0.08 : 0.24, ease: [0.22, 1, 0.36, 1], delay: kind === "thinking" ? 0.09 : 0 }}
                    style={{ pointerEvents: "none" }}
                  >
                    Thinking
                  </motion.p>
                  <motion.p
                    className="clyra-voice-status-line"
                    initial={false}
                    animate={{ opacity: kind === "aux" ? 1 : 0, y: kind === "aux" || reduced ? 0 : 3 }}
                    transition={{ duration: reduced ? 0.08 : 0.24, ease: [0.22, 1, 0.36, 1], delay: kind === "aux" ? 0.09 : 0 }}
                    style={{ pointerEvents: "none" }}
                  >
                    {auxText}
                  </motion.p>
                  <motion.div
                    data-testid={call.responseText ? "voice-speaking-captions" : undefined}
                    className={call.error ? "clyra-voice-response-line clyra-voice-response-line--error" : "clyra-voice-response-line"}
                    initial={false}
                    animate={{ opacity: response ? 1 : 0, y: response || reduced ? 0 : 8 }}
                    transition={
                      reduced
                        ? { duration: 0.08 }
                        : response
                          ? { duration: 0.7, ease: [0.16, 1, 0.3, 1], delay: 0.14 }
                          : { duration: 0.42, ease: [0.22, 1, 0.36, 1] }
                    }
                    style={{ pointerEvents: response ? "auto" : "none" }}
                  >
                    {response}
                  </motion.div>
                </motion.div>
              )}
            </AnimatePresence>
          </main>

          <motion.footer className="clyra-voice-call__footer" animate={controlsGroup.animate} transition={controlsGroup.transition} style={{ pointerEvents: phase === "ending" ? "none" : "auto" }}>
            <AnimatePresence mode="wait">
              {call.requiresApproval ? <ApprovalPanel key={call.requiresApproval.id} approval={call.requiresApproval} onConfirm={call.confirmApproval} onCancel={call.rejectApproval} /> : call.activeTask && activeState(call.state) && !call.composerOpen ? (
                <VoiceControlBar key="agent-controls" state={call.state} task={call.activeTask} onPause={call.pauseTask} onResume={call.resumeTask} onTakeControl={call.takeControl} onStop={call.stopTask} onChat={call.openComposer} />
              ) : (
                <VoiceComposer key="voice-controls" open={call.composerOpen} muted={call.muted} disabled={call.state === "entering" || call.state === "ending"} onOpen={call.openComposer} onClose={call.closeComposer} onMute={call.toggleMute} onEnd={() => void call.endCall()} onSend={call.sendText} onActivity={() => setLastTypeAt(Date.now())} />
              )}
            </AnimatePresence>
          </motion.footer>
        </motion.section>
      ) : null}
    </AnimatePresence>
  );
}
