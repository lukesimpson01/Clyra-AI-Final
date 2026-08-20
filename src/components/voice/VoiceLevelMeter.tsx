import { useEffect, useRef, type CSSProperties, type MutableRefObject } from "react";
import type { VoiceCallState } from "../../lib/voiceCallStateMachine";
import type { VoiceWaveformSignal } from "./VoiceWaveform";

const BAR_COUNT = 11;
const SHAPE = [0.38, 0.52, 0.7, 0.86, 0.96, 1, 0.96, 0.86, 0.7, 0.52, 0.38];

export function VoiceLevelMeter({ signalRef, fallbackLevel, phase, muted }: {
  signalRef: MutableRefObject<VoiceWaveformSignal>;
  fallbackLevel: number;
  phase: VoiceCallState;
  muted: boolean;
}) {
  const barsRef = useRef<Array<HTMLSpanElement | null>>([]);
  const phaseRef = useRef(phase);
  const levelRef = useRef(fallbackLevel);
  phaseRef.current = phase;
  levelRef.current = fallbackLevel;

  useEffect(() => {
    let frame = 0;
    let previous = performance.now();
    const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const smoothed = new Float32Array(BAR_COUNT);
    const render = (now: number) => {
      frame = requestAnimationFrame(render);
      if (now - previous < (reducedMotion ? 100 : 16)) return;
      previous = now;
      const signal = signalRef.current;
      const fresh = now - signal.updatedAt < 500;
      const raw = muted ? 0 : Math.max(0, Math.min(1, fresh ? signal.level : levelRef.current));
      const activeSpeech = phaseRef.current === "user_speaking" || phaseRef.current === "assistant_speaking";
      const thinking = phaseRef.current === "thinking" || phaseRef.current === "assistant_starting";
      for (let index = 0; index < BAR_COUNT; index += 1) {
        const mirroredIndex = index <= BAR_COUNT / 2 ? index : BAR_COUNT - 1 - index;
        const sourceBand = signal.bands[Math.min(signal.bands.length - 1, Math.floor(mirroredIndex / (BAR_COUNT / 2) * signal.bands.length))] || 0;
        const breathing = !activeSpeech && !thinking && !reducedMotion
          ? 0.12 + (Math.sin(now / 820 + index * 0.44) + 1) * 0.028
          : 0;
        const cognitive = thinking && !reducedMotion
          ? 0.2 + Math.sin(now / 360 - index * 0.58) * 0.075
          : 0;
        const speechMotion = activeSpeech && !reducedMotion
          ? 0.025 * Math.sin(now / 135 + index * 0.72)
          : 0;
        const audio = (raw * 0.72 + sourceBand * 0.28) * SHAPE[index]! * (activeSpeech ? 1 : 0.64) + speechMotion;
        const target = muted ? 0.065 : Math.max(0.12, breathing, cognitive, audio);
        const rate = target > smoothed[index]! ? 0.2 : 0.085;
        smoothed[index] = smoothed[index]! + (target - smoothed[index]!) * rate;
        barsRef.current[index]?.style.setProperty("--meter-level", smoothed[index]!.toFixed(3));
      }
    };
    frame = requestAnimationFrame(render);
    return () => cancelAnimationFrame(frame);
  }, [muted, signalRef]);

  return (
    <div className="clyra-desktop-meter" data-phase={muted ? "muted" : phase} aria-hidden="true">
      {Array.from({ length: BAR_COUNT }, (_, index) => (
        <span key={index} style={{ "--bar-index": index } as CSSProperties} ref={(node) => { barsRef.current[index] = node; }} />
      ))}
    </div>
  );
}
