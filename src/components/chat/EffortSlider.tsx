import { useCallback, useEffect, useRef, useState } from "react";
import type { ComposerEffortOption } from "./ClyraComposerShell";

/**
 * Reasoning effort: a small popover attached to its button (with a caret) holding a horizontal slider.
 * Drag the thumb, click the track, click a level name or use the arrow keys — every route animates the same way:
 * the thumb springs to the stop, the fill follows, the level name slides in and a soft ring pulses out of the thumb.
 * It opens with a springy scale from the button and closes with a quick fade.
 */
const WIDTH = 218;
const PAD = 14;
const TRACK_H = 24;
const THUMB = 20;
const EASE = "cubic-bezier(.16,1,.3,1)";
const SPRING = "cubic-bezier(.34,1.5,.5,1)";

export function EffortSlider({
  efforts,
  current,
  accentColor,
  open,
  defaultValue,
}: {
  efforts: ComposerEffortOption[];
  current: string;
  accentColor: string;
  open: boolean;
  defaultValue?: string;
}) {
  const count = efforts.length;
  const index = Math.max(0, efforts.findIndex((e) => e.value === current));
  const trackRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<number | null>(null);   // 0..1 along the track while dragging
  const [swept, setSwept] = useState(false);                // the fill sweeps out from empty each time it opens
  const [pulse, setPulse] = useState(0);                    // bumps on every change, restarting the thumb ring
  const lastIndex = useRef(index);
  const direction = useRef(1);
  const inner = WIDTH - PAD * 2;
  const travel = inner - THUMB;
  const ratio = drag ?? (count > 1 ? index / (count - 1) : 0);
  const active = efforts[index] ?? efforts[0];

  useEffect(() => {
    if (!open) { setDrag(null); setSwept(false); return undefined; }
    const id = window.setTimeout(() => setSwept(true), 110);
    return () => window.clearTimeout(id);
  }, [open]);

  useEffect(() => {
    if (index !== lastIndex.current) {
      direction.current = index > lastIndex.current ? 1 : -1;
      lastIndex.current = index;
      setPulse((n) => n + 1);
    }
  }, [index]);

  const pickIndex = useCallback((i: number) => { const t = efforts[Math.min(count - 1, Math.max(0, i))]; if (t && t.value !== current) t.onPick(); }, [count, current, efforts]);
  const pickFromRatio = useCallback((r: number) => pickIndex(Math.round(Math.min(1, Math.max(0, r)) * (count - 1))), [count, pickIndex]);
  const ratioFromEvent = (clientX: number) => {
    const rect = trackRef.current?.getBoundingClientRect();
    return rect ? Math.min(1, Math.max(0, (clientX - rect.left - THUMB / 2) / travel)) : 0;
  };

  const shown = swept ? ratio : 0;
  const thumbLeft = shown * travel;
  const fillWidth = thumbLeft + THUMB / 2 + 2;
  const move = drag === null ? `${swept ? ".5s" : ".75s"}` : "0s";
  const stagger = (n: number): React.CSSProperties => ({
    opacity: open ? 1 : 0,
    transform: open ? "none" : "translateY(6px)",
    transition: `opacity .35s ease ${open ? 0.07 + n * 0.05 : 0}s, transform .55s ${EASE} ${open ? 0.07 + n * 0.05 : 0}s`,
  });

  return (
    <div
      style={{
        position: "absolute",
        bottom: "calc(100% + 11px)",
        left: -6,
        width: WIDTH,
        padding: `${PAD}px ${PAD}px 11px`,
        borderRadius: 20,
        background: "linear-gradient(180deg, #FFFFFF 0%, #FAFBFD 100%)",
        zIndex: 20,
        boxShadow: "0 1px 1px rgba(16,18,24,0.04), 0 14px 36px -12px rgba(16,18,24,0.24), inset 0 0 0 1px rgba(16,18,24,0.07)",
        opacity: open ? 1 : 0,
        transform: open ? "none" : "translateY(10px) scale(.88)",
        transformOrigin: "16% 100%",
        pointerEvents: open ? "auto" : "none",
        visibility: open ? "visible" : "hidden",
        transition: open
          ? `opacity .2s ease, transform .55s ${SPRING}, visibility 0s`
          : `opacity .15s ease, transform .2s cubic-bezier(.4,0,1,1), visibility 0s linear .2s`,
        userSelect: "none",
      }}
    >
      {/* caret: attaches the popover to the button it belongs to */}
      <span aria-hidden="true" style={{ position: "absolute", left: 30, bottom: -5, width: 10, height: 10, background: "#FAFBFD", transform: "rotate(45deg)", borderRadius: 2, boxShadow: "inset -1px -1px 0 rgba(16,18,24,0.07)" }} />

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", height: 22, ...stagger(0) }}>
        <div style={{ position: "relative", height: 20, minWidth: 0, flex: 1, overflow: "hidden" }}>
          <span
            key={active?.value}
            style={{ position: "absolute", left: 0, top: 0, display: "flex", alignItems: "baseline", gap: 7, whiteSpace: "nowrap", animation: `clyraEffortIn${direction.current > 0 ? "R" : "L"} .42s ${EASE} both` }}
          >
            <span style={{ fontSize: 14.5, fontWeight: 650, letterSpacing: "-0.018em", color: accentColor }}>{active?.label}</span>
            <span style={{ fontSize: 11.5, color: "#8A919E" }}>{active?.hint}</span>
          </span>
        </div>
        <button
          type="button"
          title="Reset to default"
          aria-label="Reset effort"
          onClick={() => pickIndex(efforts.findIndex((e) => e.value === defaultValue))}
          style={{ display: "grid", placeItems: "center", width: 22, height: 22, border: "none", background: "transparent", color: "#A0A7B4", cursor: "pointer", borderRadius: 11, flex: "0 0 22px", transition: "color .2s ease, background .2s ease, transform .4s " + EASE }}
          onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(16,18,24,.05)"; e.currentTarget.style.color = "#5F636B"; e.currentTarget.style.transform = "rotate(-40deg)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "#A0A7B4"; e.currentTarget.style.transform = "none"; }}
        >
          <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7" /><path d="M3 4v5h5" /></svg>
        </button>
      </div>

      <div style={{ marginTop: 11, ...stagger(1) }}>
        <div
          ref={trackRef}
          role="slider"
          tabIndex={0}
          aria-label="Reasoning effort"
          aria-valuemin={0}
          aria-valuemax={count - 1}
          aria-valuenow={index}
          aria-valuetext={active?.label}
          onKeyDown={(e) => {
            if (e.key === "ArrowRight" || e.key === "ArrowUp") { e.preventDefault(); pickIndex(index + 1); }
            if (e.key === "ArrowLeft" || e.key === "ArrowDown") { e.preventDefault(); pickIndex(index - 1); }
          }}
          onPointerDown={(e) => { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); setDrag(ratioFromEvent(e.clientX)); }}
          onPointerMove={(e) => { if (drag !== null) setDrag(ratioFromEvent(e.clientX)); }}
          onPointerUp={(e) => { const r = ratioFromEvent(e.clientX); setDrag(null); pickFromRatio(r); }}
          onPointerCancel={() => setDrag(null)}
          style={{ position: "relative", width: "100%", height: TRACK_H, borderRadius: TRACK_H / 2, background: "#EEF0F4", cursor: "pointer", outline: "none", touchAction: "none", boxShadow: "inset 0 1px 2px rgba(16,18,24,0.07)" }}
        >
          <div style={{ position: "absolute", inset: 0, borderRadius: TRACK_H / 2, overflow: "hidden" }}>
            <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: fillWidth, background: `linear-gradient(90deg, ${accentColor}, ${accentColor})`, borderRadius: TRACK_H / 2, transition: `width ${move} ${drag === null ? SPRING : "linear"}` }} />
            {efforts.map((_, i) => (
              <span key={i} style={{ position: "absolute", top: "50%", marginTop: -2, left: (count > 1 ? i / (count - 1) : 0) * travel + THUMB / 2 - 2, width: 4, height: 4, borderRadius: 2, background: i <= index ? "rgba(255,255,255,.65)" : "rgba(16,18,24,.2)", transition: "background .3s ease" }} />
            ))}
          </div>
          {/* soft ring pulsing out of the thumb on every change */}
          <span key={pulse} aria-hidden="true" style={{ position: "absolute", top: (TRACK_H - THUMB) / 2, left: thumbLeft, width: THUMB, height: THUMB, borderRadius: "50%", pointerEvents: "none", transition: `left ${move} ${SPRING}`, animation: pulse ? `clyraEffortRing .7s ${EASE} both` : "none" }} />
          <div style={{ position: "absolute", top: (TRACK_H - THUMB) / 2, left: thumbLeft, width: THUMB, height: THUMB, borderRadius: "50%", background: "#FFFFFF", boxShadow: "0 1px 4px rgba(16,18,24,.28), 0 0 0 .5px rgba(16,18,24,.12)", transition: `left ${move} ${drag === null ? SPRING : "linear"}, transform .25s ${EASE}`, transform: drag !== null ? "scale(1.1)" : "none" }} />
        </div>
        <div style={{ position: "relative", height: 18, marginTop: 7 }}>
          {efforts.map((e, i) => {
            const center = (count > 1 ? i / (count - 1) : 0) * travel + THUMB / 2;
            const on = i === index;
            return (
              <button
                key={e.value}
                type="button"
                onClick={() => pickIndex(i)}
                style={{ position: "absolute", top: 0, left: center, transform: `translateX(-50%) scale(${on ? 1.04 : 1})`, padding: "1px 5px", border: "none", background: "transparent", cursor: "pointer", fontFamily: "inherit", fontSize: 11.5, fontWeight: on ? 650 : 500, color: on ? accentColor : "#8A919E", letterSpacing: "-0.004em", whiteSpace: "nowrap", transition: `color .3s ease, transform .4s ${SPRING}` }}
              >
                {e.label}
              </button>
            );
          })}
        </div>
      </div>
      <style>{`
        @keyframes clyraEffortInR { from { opacity: 0; transform: translateX(10px); filter: blur(2px); } to { opacity: 1; transform: none; filter: blur(0); } }
        @keyframes clyraEffortInL { from { opacity: 0; transform: translateX(-10px); filter: blur(2px); } to { opacity: 1; transform: none; filter: blur(0); } }
        @keyframes clyraEffortRing { 0% { box-shadow: 0 0 0 0 color-mix(in srgb, ${accentColor} 40%, transparent); } 100% { box-shadow: 0 0 0 14px color-mix(in srgb, ${accentColor} 0%, transparent); } }
      `}</style>
    </div>
  );
}
