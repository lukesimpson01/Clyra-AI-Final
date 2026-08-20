import { motion } from "motion/react";
import type { MutableRefObject } from "react";
import type { VoiceCallState } from "../../lib/voiceCallStateMachine";
import type { VoiceWaveformSignal } from "./VoiceWaveform";
import { VoiceLevelMeter } from "./VoiceLevelMeter";

function formatDuration(seconds: number) {
  const safe = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(safe / 60)).padStart(2, "0")}:${String(safe % 60).padStart(2, "0")}`;
}

export function voiceCallUIState(phase: VoiceCallState, muted: boolean, ending: boolean) {
  if (ending) return "ending";
  if (phase === "starting" || phase === "connecting" || phase === "ready") return "connecting";
  if (phase === "thinking" || phase === "transcribing" || phase === "endpointing") return "thinking";
  if (phase === "assistant_starting" || phase === "assistant_speaking") return "speaking";
  if (phase === "recovering") return "reconnecting";
  if (phase === "error") return "error";
  // Muting only closes the input stream. A typed turn can still be thinking or
  // speaking, and those truthful active states take precedence in the UI.
  if (muted || phase === "muted") return "muted";
  return "listening";
}

const labels = {
  connecting: "Connecting…",
  listening: "Listening…",
  thinking: "Thinking…",
  speaking: "Speaking…",
  muted: "Muted",
  reconnecting: "Reconnecting…",
  ending: "Ending call…",
  error: "Voice unavailable",
} as const;

export function VoiceActivityCapsule({ phase, muted, ending, elapsedSeconds, signalRef, fallbackLevel }: {
  phase: VoiceCallState;
  muted: boolean;
  ending: boolean;
  elapsedSeconds: number;
  signalRef: MutableRefObject<VoiceWaveformSignal>;
  fallbackLevel: number;
}) {
  const state = voiceCallUIState(phase, muted, ending);
  return (
    <motion.div layout data-state={state} className="clyra-activity-capsule" aria-live="polite"
      transition={{ layout: { type: "spring", bounce: 0, duration: .38 } }}>
      <VoiceLevelMeter signalRef={signalRef} fallbackLevel={fallbackLevel} phase={ending ? "ending" : phase} muted={state === "muted" || ending} />
      <span className="clyra-activity-capsule__label">{labels[state]}</span>
      <time>{formatDuration(elapsedSeconds)}</time>
    </motion.div>
  );
}
