import { AnimatePresence, motion, useAnimationControls, useReducedMotion } from "framer-motion";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { getOrbAnchorRect } from "../../voice/orbAnchor";
import type { UseVoiceCallOptions } from "../../hooks/useVoiceCall";
import type { AgentSurface, AgentTask, ApprovalRequest, VoiceCallState } from "../../voice/state/voiceSession";
import { VoiceActivitySurface } from "../../voice/VoiceActivitySurface";
import { VoiceComposer } from "../../voice/VoiceComposer";
import { VoiceControlBar } from "../../voice/VoiceControlBar";
import { VoicePresence } from "../../voice/VoicePresence";

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

type Props = {
  call: VoiceCallScreenCall;
  testMode: boolean;
  avatarColor?: string;
  onOpenSettings?: () => void;
};

const time = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
const activeState = (state: VoiceCallState) => state === "acting_browser" || state === "acting_computer" || state === "acting_clyra" || state === "paused" || state === "user_takeover";

/** A subtle, state-specific breathing scale for the Clyra presence. */
function presenceScale(state: VoiceCallState): number {
  if (state === "thinking") return 0.985;
  if (state === "responding") return 1.008;
  if (state === "paused") return 0.97;
  if (state === "user_takeover") return 0.96;
  return 1;
}

const EASE = [0.22, 1, 0.36, 1] as const;

/** Stagger header and copy before the controls; on hangup, let controls clear
 * before the overall surface fades. */
function groupMotion(phase: "entering" | "live" | "ending", delay: number, distance: number, reduced: boolean | null) {
  if (reduced) return { animate: { opacity: phase === "live" ? 1 : 0, y: 0 }, transition: { duration: 0.08 } };
  if (phase === "entering") return { animate: { opacity: 0, y: distance }, transition: { duration: 0 } };
  if (phase === "ending") return { animate: { opacity: 0, y: 0 }, transition: { duration: 0.18, ease: "easeOut" as const } };
  return { animate: { opacity: 1, y: 0 }, transition: { duration: 0.32, delay, ease: EASE } };
}

/** One status line owns the row above the response text. "Speak when ready…"
 * and "Resting…" reflect the actual call state rather than demo copy. */
function primaryLine(call: VoiceCallScreenCall): { kind: "muted" | "listening" | "thinking" | "ready" | "aux"; text: string } | null {
  if (call.muted && (call.state === "ready" || call.state === "listening" || call.state === "transcribing")) {
    return { kind: "muted", text: "Microphone off" };
  }
  if (call.state === "listening" || call.state === "transcribing") {
    // The recognized words are rendered in the dedicated subtitle directly
    // below the presence. Keeping this line as a stable state label avoids
    // remounting the status row for every real interim STT update.
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

/** Full-screen Clyra Voice: one presence, one truthfully-derived state, one control locus. */
export function VoiceCallScreen({ call }: Props) {
  const reduced = useReducedMotion();
  const duration = useMemo(() => time(call.elapsedSeconds), [call.elapsedSeconds]);
  const hasActivity = Boolean(call.activeTask && call.activeSurface);
  const response = call.error || call.responseText;
  // Once there's a response lingering in the otherwise-quiet "ready" state
  // (right after a turn finishes), the response owns the row -- showing
  // "Speak when ready…"/"Resting…"/"Microphone off" underneath it at the same
  // time was overlapping the two. A real state change (actual speech,
  // thinking, an agent task) still takes priority over a stale response.
  const line = (call.state === "ready" || call.state === "error") && response ? null : primaryLine(call);
  const kind = line?.kind ?? null;
  const listeningText = "Listening";
  const auxText = line && line.kind === "aux" ? line.text : "";
  const readyText = call.resting ? "Resting — speak or type to wake" : "Speak when ready, or press type.";
  // Partial captions come from Pipecat's actual `onUserTranscript` events.
  // Preserve the finalized utterance through the thinking beat so people can
  // confirm what Clyra heard, then clear it once the response starts.
  const liveSubtitle = call.state === "transcribing"
    ? call.partialTranscript.trim()
    : call.state === "thinking"
      ? call.committedTranscript.trim()
      : "";

  const phase: "entering" | "live" | "ending" = call.state === "entering" ? "entering" : call.state === "ending" ? "ending" : "live";

  // Shared-element flight: the orb leaves the chat home's orb on call start and
  // returns to it on hang-up. Measured from the real DOM positions so it stays
  // correct at any window size; with no home orb on screen it just blooms in.
  const flyRef = useRef<HTMLDivElement | null>(null);
  const flight = useAnimationControls();
  const homeRectRef = useRef<DOMRect | null>(null);
  const delta = () => {
    const from = homeRectRef.current;
    const el = flyRef.current;
    if (!from || !el) return null;
    // Natural (untransformed) box: offsetParent walk avoids reading mid-animation transforms.
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
          </motion.header>

          <main className={`clyra-voice-call__main${hasActivity ? " clyra-voice-call__main--activity" : ""}`}>
            <motion.div
              ref={flyRef}
              className="clyra-voice-call__fly"
              animate={flight}
              initial={{ opacity: 0 }}
              style={{ willChange: "transform" }}
            >
            <motion.div
              layout
              className="clyra-voice-call__presence"
              animate={{ scale }}
              transition={{ duration: reduced ? 0.1 : 0.3, ease: EASE }}
            >
              <VoicePresence state={call.state} micLevel={call.micLevel} botLevel={call.botLevel} muted={call.muted} resting={call.resting} typing={call.composerOpen} compact={hasActivity} lowPower={call.lowPowerMode} />
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

            <AnimatePresence mode="popLayout">
              {hasActivity && call.activeTask ? (
                <VoiceActivitySurface key={call.activeTask.id} task={call.activeTask} surface={call.activeSurface} controlling={activeState(call.state) && call.state !== "paused" && call.state !== "user_takeover"} onToggleExpanded={call.toggleSurfaceExpanded} />
              ) : (
                <motion.div className="clyra-voice-call__copy" aria-live="polite" animate={headerGroup.animate} transition={headerGroup.transition}>
                  {/* Keep status layers mounted and cross-fade them. Swapping via
                     key/mode="wait" would remount "Listening" for every partial
                     transcript token and create visible flicker. */}
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
                <VoiceComposer key="voice-controls" open={call.composerOpen} muted={call.muted} disabled={call.state === "entering" || call.state === "ending"} onOpen={call.openComposer} onClose={call.closeComposer} onMute={call.toggleMute} onEnd={() => void call.endCall()} onSend={call.sendText} />
              )}
            </AnimatePresence>
          </motion.footer>
        </motion.section>
      ) : null}
    </AnimatePresence>
  );
}

export type { UseVoiceCallOptions };
