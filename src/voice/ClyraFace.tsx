import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { capsulePath } from "./bloub/shape";
import { loopNoise, clamp } from "./bloub/math";
import type { VoiceCallState } from "./state/voiceSession";
import type { HomeFaceHandle } from "./homeFace";

type Mood = "rest" | "muted" | "thinking" | "responding" | "acting" | "paused" | "takeover" | "typing";

interface EyeTarget {
  /** capsule width/height, in the same -100..100 viewBox units as the reference. */
  w: number;
  h: number;
  y: number;
  rotate: number;
}

/**
 * Base (noise-free) eye poses per mood, read off the live reference file's own
 * DOM (a flat #3f7df6 "ball" div + two `capsulePath` eyes, no sphere
 * projection) -- see src/voice/bloub/NOTICE.md. The reference's own captures
 * include a continuous ambient gaze drift on top of these, which is why raw
 * sampled numbers looked asymmetric; that drift is reproduced separately below
 * via `loopNoise` rather than baked into these targets.
 */
const MOODS: Record<Mood, EyeTarget> = {
  rest: { w: 22, h: 50, y: -3, rotate: 0 },
  muted: { w: 27, h: 10, y: 8, rotate: 0 },
  thinking: { w: 17, h: 17, y: -11, rotate: 0 },
  responding: { w: 26, h: 27, y: -14, rotate: 0 },
  acting: { w: 22, h: 22, y: -5, rotate: 0 },
  paused: { w: 29, h: 25, y: 14, rotate: 0 },
  takeover: { w: 24, h: 24, y: -5, rotate: 0 },
  // The reference only shows this while the composer is open AND the user
  // typed within the last 2s (`now - lastTypeAt < 2000`); the gaze drops
  // toward the keyboard exactly like the reference's typing pose.
  typing: { w: 20, h: 20, y: 14, rotate: 0 }
};

const BALL_FILTER: Partial<Record<Mood, string>> = {
  muted: "saturate(0.3) brightness(1.08)",
  paused: "saturate(0.56) brightness(1.05)",
  takeover: "saturate(0.8) brightness(1.03)"
};

const EYE_GAP = 30;
const BLINK_DURATION_MS = 200;

/** Gaze travel, in the same -100..100 viewBox units as the eyes. */
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

/** Same pulse curve as the reference's three thinking dots: index 0/1/2 chase each other. */
function dotPulse(t: number, index: number): number {
  const p = ((((t - index * 0.5) / 1.5) % 1) + 1) % 1;
  const k = p < 0.5 ? 0.5 - 0.5 * Math.cos(p * Math.PI * 2) : 0;
  return clamp(k * 2);
}

type Props = {
  state: VoiceCallState;
  muted: boolean;
  resting?: boolean;
  typing?: boolean;
  lowPower?: boolean;
};

/**
 * Clyra's voice-call presence: a flat-blue "ball" with two capsule-shaped
 * eyes morphing between moods, matching the reference mockup's own
 * (non-bloub) implementation rather than bloub's full sphere-projected
 * engine, which the mockup doesn't actually use. See bloub/NOTICE.md.
 */
export const ClyraFace = forwardRef<HomeFaceHandle, Props>(function ClyraFace(
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

  // Cursor-follow / look-down override, driven from outside through the ref.
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

    const render = (now: number) => {
      if (disposed) return;
      raf = requestAnimationFrame(render);
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

      // External gaze: track the cursor or cast the eyes down, eased toward
      // the target so the motion reads as a glance rather than a jump.
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
