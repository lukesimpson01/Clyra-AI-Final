import { ClyraFace } from "./ClyraFace";
import type { VoiceCallState } from "./state/voiceSession";

type Props = {
  state: VoiceCallState;
  micLevel: number;
  botLevel: number;
  muted: boolean;
  /** True once 5s have passed with no speech/typing/button activity while
   * `state === "ready"` -- dims the ball, since both mean "nothing is being
   * heard right now". */
  resting?: boolean;
  /** Composer is open -- the reference shows a distinct "typing" face while
   * actively composing rather than leaving the listening/rest look up. */
  typing?: boolean;
  compact?: boolean;
  lowPower?: boolean;
};

/**
 * Clyra's voice presence: a flat-blue "ball" with two capsule-shaped eyes
 * that morph per call state (see ClyraFace.tsx). `micLevel`/`botLevel` are
 * accepted for interface stability with callers but unused -- the reference
 * mockup's own face doesn't react to live audio level, only to call state.
 */
export function VoicePresence({ state, muted, resting = false, typing = false, compact = false, lowPower = false }: Props) {
  return (
    <div
      className={`clyra-voice-presence${compact ? " clyra-voice-presence--compact" : ""}`}
      data-state={state}
      data-low-power={lowPower || undefined}
      role="img"
      aria-label={state === "responding" ? "Clyra is responding" : state === "thinking" ? "Clyra is thinking" : "Clyra voice presence"}
    >
      <ClyraFace state={state} muted={muted} resting={resting} typing={typing} lowPower={lowPower} />
    </div>
  );
}
