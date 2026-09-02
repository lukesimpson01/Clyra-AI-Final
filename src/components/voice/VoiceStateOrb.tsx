import { useEffect, useRef } from "react";
import type { VoiceCallStatus } from "../../hooks/useVoiceCall";

/**
 * The call's state, drawn as a soft liquid blob wrapping the Bloub avatar.
 *
 * Google's design library is explicit that Gemini's visual language is "soft,
 * glowing organic shapes" with "sharp, almost opaque leading edges that
 * diffuse at the tail" — filled, blurred forms, not wireframe rings. The
 * first version of this component drew thin stroked circles and arcs, which
 * read as a technical diagram sitting next to Bloub rather than one blob. This
 * version draws filled, blurred, organic shapes instead, and the motion is
 * still what tells listening from thinking from speaking apart:
 *
 *   listening — a soft ring that breathes outward with a blurred, diffusing
 *               edge, faster and brighter the louder the room is
 *   thinking  — lobes of colour orbiting and folding into the centre, energy
 *               being gathered rather than broadcast
 *   speaking  — the blob itself pulses and deforms with the assistant's
 *               actual output level, an organic wobble rather than a bar chart
 *   idle      — a slow, barely-there breath so the surface never looks frozen
 *
 * Canvas with one rAF loop, no React state per frame — publishing a frame
 * through setState at 60fps is what made the boot orb lag; this never does.
 */

type Props = {
  status: VoiceCallStatus;
  /** 0–1 microphone energy. Drives the listening ripple. */
  micLevel: number;
  /** 0–1 assistant energy. Drives the speaking pulse. */
  botLevel: number;
  muted: boolean;
  size?: number;
  accent?: string;
  className?: string;
};

const prefersReducedMotion = () =>
  typeof window !== "undefined"
  && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

const hexToRgb = (hex: string) => {
  const value = hex.replace("#", "");
  const full = value.length === 3 ? value.split("").map((c) => c + c).join("") : value;
  const int = Number.parseInt(full, 16);
  return { r: (int >> 16) & 255, g: (int >> 8) & 255, b: int & 255 };
};

export function VoiceStateOrb({
  status,
  micLevel,
  botLevel,
  muted,
  size = 220,
  accent = "#2f6df6",
  className,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stateRef = useRef({ status, micLevel, botLevel, muted, accent });
  stateRef.current = { status, micLevel, botLevel, muted, accent };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;

    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    context.scale(dpr, dpr);

    const centre = size / 2;
    const coreRadius = size * 0.19;
    const reduced = prefersReducedMotion();

    let smoothedEnergy = 0;
    const ripples: Array<{ born: number; strength: number }> = [];
    let lastRipple = 0;
    let frame = 0;
    let running = true;

    /** A closed organic outline through N points around a centre, each
     *  pushed in or out by an offset — this is what turns a circle into a
     *  blob rather than a perfect geometric ring. Drawn with quadratic
     *  curves through midpoints so the outline is smooth, not faceted. */
    const blobPath = (radiusAt: (angle: number, index: number) => number, points: number) => {
      const coords: Array<[number, number]> = [];
      for (let i = 0; i < points; i += 1) {
        const angle = (i / points) * Math.PI * 2;
        const r = radiusAt(angle, i);
        coords.push([centre + Math.cos(angle) * r, centre + Math.sin(angle) * r]);
      }
      context.beginPath();
      const first = coords[0]!;
      const last = coords[coords.length - 1]!;
      context.moveTo((last[0] + first[0]) / 2, (last[1] + first[1]) / 2);
      for (let i = 0; i < coords.length; i += 1) {
        const current = coords[i]!;
        const next = coords[(i + 1) % coords.length]!;
        const midX = (current[0] + next[0]) / 2;
        const midY = (current[1] + next[1]) / 2;
        context.quadraticCurveTo(current[0], current[1], midX, midY);
      }
      context.closePath();
    };

    const draw = (now: number) => {
      if (!running) return;
      frame = requestAnimationFrame(draw);

      const { status: state, micLevel: mic, botLevel: bot, muted: isMuted, accent: colour } = stateRef.current;
      const { r, g, b } = hexToRgb(colour);
      const rgba = (alpha: number) => `rgba(${r}, ${g}, ${b}, ${alpha})`;

      const target = state === "speaking" ? bot : state === "listening" && !isMuted ? mic : 0;
      smoothedEnergy += (target - smoothedEnergy) * 0.18;

      context.clearRect(0, 0, size, size);
      const seconds = now / 1000;

      /* The core blob, present in every state as filled colour behind Bloub
         so it always reads as one continuous form rather than a decoration
         floating separately around it — "blob", singular. */
      const wobble = reduced ? 0 : 1;
      blobPath((angle, i) => {
        const breathe = state === "idle" || state === "connecting"
          ? Math.sin(seconds * 1.1) * 0.02
          : 0;
        const speakBulge = state === "speaking"
          ? Math.sin(seconds * 5 + i * 1.7) * 0.05 * smoothedEnergy
            + Math.sin(seconds * 2.6 + i * 0.9) * 0.03 * smoothedEnergy
          : 0;
        const thinkPull = state === "thinking"
          ? Math.sin(seconds * 1.6 + i * 1.1) * 0.06
          : 0;
        return coreRadius * (1 + wobble * (breathe + speakBulge + thinkPull));
      }, 24);
      const coreFill = context.createRadialGradient(centre, centre, 0, centre, centre, coreRadius * 1.3);
      coreFill.addColorStop(0, rgba(0.95));
      coreFill.addColorStop(0.7, rgba(0.75));
      coreFill.addColorStop(1, rgba(0.35));
      context.fillStyle = coreFill;
      context.fill();

      if (state === "listening" && !reduced) {
        /* A soft ring breathing outward, its edge deliberately blurred by
           drawing several concentric passes at falling opacity rather than a
           single hard stroke — the "diffuses at the tail" treatment. */
        const interval = isMuted ? 1400 : 620 - Math.min(360, smoothedEnergy * 420);
        if (now - lastRipple > interval) {
          lastRipple = now;
          ripples.push({ born: now, strength: isMuted ? 0.22 : 0.5 + smoothedEnergy * 0.4 });
        }
        const life = 2100;
        for (let index = ripples.length - 1; index >= 0; index -= 1) {
          const age = (now - ripples[index]!.born) / life;
          if (age >= 1) { ripples.splice(index, 1); continue; }
          const radius = coreRadius + age * (size * 0.32);
          const baseFade = (1 - age) ** 1.6 * ripples[index]!.strength;
          for (let pass = 0; pass < 4; pass += 1) {
            const passRadius = radius - pass * 3;
            if (passRadius <= 0) continue;
            context.beginPath();
            context.arc(centre, centre, passRadius, 0, Math.PI * 2);
            context.strokeStyle = rgba(baseFade * (0.22 - pass * 0.045));
            context.lineWidth = 6 - pass;
            context.stroke();
          }
        }
      }

      if (state === "thinking" && !reduced) {
        /* Soft lobes orbiting inward and folding into the core — the
           opposite direction to listening's outward ripple, which is what
           makes the two unmistakable even in peripheral vision. */
        const lobes = 3;
        for (let index = 0; index < lobes; index += 1) {
          const phase = (seconds * 0.55 + index / lobes) % 1;
          const orbitRadius = coreRadius * (0.55 + (1 - phase) * 0.85);
          const angle = seconds * 1.3 + (index * Math.PI * 2) / lobes;
          const x = centre + Math.cos(angle) * orbitRadius;
          const y = centre + Math.sin(angle) * orbitRadius;
          const lobeRadius = coreRadius * 0.32 * (0.5 + (1 - phase) * 0.6);
          const glow = context.createRadialGradient(x, y, 0, x, y, lobeRadius);
          const fade = (1 - Math.abs(phase - 0.5) * 2) * 0.75;
          glow.addColorStop(0, rgba(fade));
          glow.addColorStop(1, rgba(0));
          context.fillStyle = glow;
          context.beginPath();
          context.arc(x, y, lobeRadius, 0, Math.PI * 2);
          context.fill();
        }
      }

      /* The soft glow beneath everything, lifting with energy — composited
         behind the blob and Bloub, both of which paint on top of it. */
      context.globalCompositeOperation = "destination-over";
      const glow = context.createRadialGradient(centre, centre, coreRadius * 0.3, centre, centre, size * 0.46);
      glow.addColorStop(0, rgba(0.2 + smoothedEnergy * 0.22));
      glow.addColorStop(0.55, rgba(0.06 + smoothedEnergy * 0.07));
      glow.addColorStop(1, rgba(0));
      context.fillStyle = glow;
      context.fillRect(0, 0, size, size);
      context.globalCompositeOperation = "source-over";
    };

    frame = requestAnimationFrame(draw);
    return () => { running = false; cancelAnimationFrame(frame); };
  }, [size]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className={className}
      style={{ width: size, height: size, display: "block" }}
    />
  );
}
