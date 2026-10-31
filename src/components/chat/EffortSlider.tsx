import { useCallback, useEffect, useRef, useState } from "react";
import { animate, motion, useMotionValue, useReducedMotion, useTransform } from "motion/react";
import type { ComposerEffortOption } from "./ClyraComposerShell";

/**
 * Reasoning effort: a small popover attached to its button holding a horizontal slider.
 *
 * The thumb is a motion value, so dragging never re-renders React: it follows the pointer 1:1 on the compositor
 * (transform only), with a light rubber band past either end. On release, or on a click anywhere on the track, it
 * springs to the nearest stop, carrying the pointer's velocity, so a flick lands softly. The level's name previews
 * live while dragging and commits on release. Arrow keys, Home/End and the level names below move it the same way.
 * The popover rises from its button in 200ms and fades out in 140ms.
 */
const WIDTH = 248;
const PAD = 14;
const TRACK_H = 26;
const THUMB = 22;
const INSET = (TRACK_H - THUMB) / 2;
/* settle: quick, soft, no visible overshoot */
const SETTLE = { type: "spring", stiffness: 560, damping: 44, mass: 0.7 } as const;
const EASE_OUT = [0.22, 1, 0.36, 1] as const;

export function EffortSlider({
  efforts,
  current,
  accentColor,
  open,
  defaultValue,
  fixedAnchor,
}: {
  efforts: ComposerEffortOption[];
  current: string;
  accentColor: string;
  open: boolean;
  defaultValue?: string;
  /** When set (portal use), position the popover at this viewport point instead of anchoring it to its in-flow parent. */
  fixedAnchor?: { left: number; bottom: number } | null;
}) {
  const count = efforts.length;
  const index = Math.max(0, efforts.findIndex((e) => e.value === current));
  const reduceMotion = useReducedMotion();
  const trackRef = useRef<HTMLDivElement>(null);
  const inner = WIDTH - PAD * 2;
  const travel = inner - THUMB - INSET * 2;
  const step = count > 1 ? travel / (count - 1) : 0;

  const x = useMotionValue(index * step);
  const fill = useTransform(x, (v) => Math.max(0, v) + THUMB + INSET * 2);
  const [pressed, setPressed] = useState(false);
  /* the stop under the thumb while dragging: previews the level before it commits */
  const [preview, setPreview] = useState<number | null>(null);
  const session = useRef<{ id: number; grab: number; moved: boolean; downX: number } | null>(null);
  const lastShown = useRef(index);
  const shownIndex = preview ?? index;
  const direction = shownIndex >= lastShown.current ? 1 : -1;
  useEffect(() => { lastShown.current = shownIndex; }, [shownIndex]);

  const settle = useCallback((to: number, velocity = 0) => {
    if (reduceMotion || !open) { x.set(to * step); return; }
    animate(x, to * step, { ...SETTLE, velocity });
  }, [open, reduceMotion, step, x]);

  /* the level changed from outside (keys, labels, reset, another surface): glide there */
  useEffect(() => { if (!session.current) settle(index); }, [index, settle]);
  useEffect(() => { if (!open) { session.current = null; setPressed(false); setPreview(null); x.set(index * step); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const commit = useCallback((i: number) => {
    const next = Math.min(count - 1, Math.max(0, i));
    const target = efforts[next];
    if (target && target.value !== current) target.onPick();
    return next;
  }, [count, current, efforts]);

  const localX = (clientX: number) => {
    const rect = trackRef.current?.getBoundingClientRect();
    return rect ? clientX - rect.left - INSET : 0;
  };
  /* past either end the thumb gives a little, then resists */
  const band = (v: number) => (v < 0 ? -Math.sqrt(-v) * 2 : v > travel ? travel + Math.sqrt(v - travel) * 2 : v);
  const nearest = (v: number) => Math.round(Math.min(travel, Math.max(0, v)) / (step || 1));

  return (
    <div
      style={{
        ...(fixedAnchor
          ? { position: "fixed" as const, left: fixedAnchor.left, bottom: fixedAnchor.bottom }
          : { position: "absolute" as const, bottom: "calc(100% + 10px)", left: -6 }),
        width: WIDTH,
        padding: `${PAD}px ${PAD}px 12px`,
        borderRadius: 18,
        background: "#FFFFFF",
        zIndex: 20,
        boxShadow: "0 0 0 1px rgba(16,18,24,0.07), 0 8px 24px -10px rgba(16,18,24,0.18)",
        opacity: open ? 1 : 0,
        transform: open ? "none" : "translateY(4px) scale(.98)",
        transformOrigin: "16% 100%",
        pointerEvents: open ? "auto" : "none",
        visibility: open ? "visible" : "hidden",
        transition: open
          ? `opacity .18s ease-out, transform .2s cubic-bezier(.22,1,.36,1), visibility 0s`
          : `opacity .14s ease-in, transform .14s ease-in, visibility 0s linear .14s`,
        userSelect: "none",
        willChange: "transform, opacity",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", height: 22 }}>
        <div style={{ position: "relative", height: 20, minWidth: 0, flex: 1, overflow: "hidden" }}>
          <motion.span
            key={efforts[shownIndex]?.value}
            initial={reduceMotion ? false : { opacity: 0, x: direction * 8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.22, ease: EASE_OUT }}
            style={{ position: "absolute", left: 0, top: 0, display: "flex", alignItems: "baseline", gap: 7, whiteSpace: "nowrap" }}
          >
            <span style={{ fontSize: 14.5, fontWeight: 600, letterSpacing: "-0.015em", color: "#0D0D0D" }}>{efforts[shownIndex]?.label}</span>
            <span style={{ fontSize: 12, color: "#8F8F8F" }}>{efforts[shownIndex]?.hint}</span>
          </motion.span>
        </div>
        <button
          type="button"
          title="Reset to default"
          aria-label="Reset effort"
          onClick={() => commit(efforts.findIndex((e) => e.value === defaultValue))}
          className="clyra-effort-reset"
        >
          <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7" /><path d="M3 4v5h5" /></svg>
        </button>
      </div>

      <div style={{ marginTop: 12 }}>
        <div
          ref={trackRef}
          role="slider"
          tabIndex={0}
          aria-label="Reasoning effort"
          aria-valuemin={0}
          aria-valuemax={count - 1}
          aria-valuenow={index}
          aria-valuetext={efforts[index]?.label}
          onKeyDown={(e) => {
            const to = e.key === "ArrowRight" || e.key === "ArrowUp" ? index + 1
              : e.key === "ArrowLeft" || e.key === "ArrowDown" ? index - 1
              : e.key === "Home" ? 0 : e.key === "End" ? count - 1 : null;
            if (to === null) return;
            e.preventDefault();
            commit(to);
          }}
          onPointerDown={(e) => {
            if (e.button !== 0) return;
            e.currentTarget.setPointerCapture(e.pointerId);
            const at = localX(e.clientX) - THUMB / 2;
            const onThumb = Math.abs(at - x.get()) <= THUMB / 2 + 4;
            /* grabbing the thumb keeps its offset; pressing the track pulls the thumb to the pointer */
            session.current = { id: e.pointerId, grab: onThumb ? at - x.get() : 0, moved: false, downX: e.clientX };
            setPressed(true);
            if (!onThumb) {
              const to = nearest(at);
              setPreview(to);
              settle(to);
            }
          }}
          onPointerMove={(e) => {
            const s = session.current;
            if (!s || s.id !== e.pointerId) return;
            if (!s.moved && Math.abs(e.clientX - s.downX) < 3) return;
            s.moved = true;
            x.stop();
            const v = band(localX(e.clientX) - THUMB / 2 - s.grab);
            x.set(v);
            const to = nearest(v);
            setPreview((p) => (p === to ? p : to));
          }}
          onPointerUp={(e) => {
            const s = session.current;
            if (!s || s.id !== e.pointerId) return;
            session.current = null;
            setPressed(false);
            const to = s.moved ? nearest(x.get()) : nearest(localX(e.clientX) - THUMB / 2 - s.grab);
            setPreview(null);
            const committed = commit(to);
            settle(committed, s.moved ? x.getVelocity() : 0);
          }}
          onPointerCancel={() => { session.current = null; setPressed(false); setPreview(null); settle(index); }}
          className="clyra-effort-track"
          style={{ height: TRACK_H, borderRadius: TRACK_H / 2 }}
        >
          <motion.div aria-hidden className="clyra-effort-fill" style={{ width: fill, borderRadius: TRACK_H / 2, background: accentColor }} />
          {efforts.map((_, i) => (
            <span
              key={i}
              aria-hidden
              className="clyra-effort-stop"
              style={{ left: INSET + i * step + THUMB / 2 - 2, background: i <= shownIndex ? "rgba(255,255,255,.7)" : "rgba(16,18,24,.18)" }}
            />
          ))}
          <motion.div
            aria-hidden
            className="clyra-effort-thumb"
            style={{ x, top: INSET, left: INSET, width: THUMB, height: THUMB }}
            animate={{ scale: pressed ? 1.08 : 1 }}
            transition={{ duration: 0.16, ease: EASE_OUT }}
          />
        </div>
        <div style={{ position: "relative", height: 18, marginTop: 8, marginLeft: INSET + THUMB / 2, width: travel, display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
          {efforts.map((e, i) => {
            const on = i === shownIndex;
            return (
              <button
                key={e.value}
                type="button"
                onClick={() => commit(i)}
                className="clyra-effort-label"
                data-on={on ? "true" : undefined}
                style={on ? { color: accentColor } : undefined}
              >
                <span className="clyra-effort-label-icon" aria-hidden>{e.icon}</span>
                {e.label}
              </button>
            );
          })}
        </div>
      </div>
      <style>{`
        .clyra-effort-track { position: relative; width: 100%; background: #F0F1F3; cursor: pointer; outline: none; touch-action: none; overflow: hidden; }
        .clyra-effort-track:focus-visible { box-shadow: 0 0 0 2px #fff, 0 0 0 4px rgba(16,18,24,.35); }
        .clyra-effort-fill { position: absolute; left: 0; top: 0; bottom: 0; }
        .clyra-effort-stop { position: absolute; top: 50%; margin-top: -2px; width: 4px; height: 4px; border-radius: 2px; transition: background-color .2s ease; pointer-events: none; }
        .clyra-effort-thumb { position: absolute; border-radius: 50%; background: #fff; box-shadow: 0 1px 3px rgba(16,18,24,.22), 0 0 0 .5px rgba(16,18,24,.1); will-change: transform; cursor: grab; }
        .clyra-effort-track:active .clyra-effort-thumb { cursor: grabbing; }
        .clyra-effort-label { display: inline-flex; align-items: center; gap: 4px; padding: 1px 5px; margin: 0 -5px; border: 0; background: transparent; cursor: pointer; font: 500 11.5px/16px inherit; font-family: inherit; color: #8F8F8F; border-radius: 8px; white-space: nowrap; transition: color .18s ease; }
        .clyra-effort-label[data-on] { font-weight: 600; }
        .clyra-effort-label:hover { color: #0D0D0D; }
        .clyra-effort-label-icon { display: grid; place-items: center; opacity: .72; transition: opacity .18s ease; }
        .clyra-effort-label[data-on] .clyra-effort-label-icon { opacity: 1; }
        .clyra-effort-label-icon svg { width: 12px; height: 12px; display: block; }
        .clyra-effort-reset { display: grid; place-items: center; width: 22px; height: 22px; flex: 0 0 22px; border: 0; border-radius: 11px; background: transparent; color: #A0A0A0; cursor: pointer; transition: color .15s ease, background-color .15s ease, transform .3s cubic-bezier(.22,1,.36,1); }
        .clyra-effort-reset:hover { background: rgba(16,18,24,.05); color: #5D5D5D; transform: rotate(-40deg); }
      `}</style>
    </div>
  );
}
