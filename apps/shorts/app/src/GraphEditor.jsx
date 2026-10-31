import React, { useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import { sampleProperty, easingAt, easingSpeedAt, customEasing, isCustomEasing, EASING_OPTIONS, EASING_LABELS, PROPERTY_DEFS, snapToFrame, clampToProperty } from "./animationEngine.js";

/* Graph Editor: value graph + speed graph for one property channel.
   Everything drawn is produced by the same sampleProperty() the preview and export use,
   and every drag writes real keyframe / easing data back to the layer. */
const BEZIER_OF = {
  Linear: [0, 0, 1, 1], "Ease in": [0.42, 0, 1, 1], "Ease out": [0, 0, 0.58, 1], "Ease in-out": [0.42, 0, 0.58, 1], Smooth: [0.4, 0, 0.2, 1],
};
const W = 440, H = 176, M = { l: 38, r: 12, t: 12, b: 20 };

export default function GraphEditor({ layer, time, fps, selKf, api, onClose, ctx }) {
  const animated = Object.keys(layer.keyframes || {}).filter((k) => layer.keyframes[k]?.length > 0 && PROPERTY_DEFS[k]?.type !== "color");
  const [prop, setProp] = useState(animated[0] || "x");
  const [view, setView] = useState("value");
  const [segId, setSegId] = useState(null);
  const svg = useRef(null);
  const active = animated.includes(prop) ? prop : animated[0];
  const frames = useMemo(() => [...(layer.keyframes?.[active] || [])].sort((a, b) => a.time - b.time), [layer.keyframes, active]);

  if (!active || frames.length === 0) {
    return (
      <div className="ae-graph" role="dialog" aria-label="Graph editor">
        <header><strong>Graph editor</strong><button onClick={onClose} aria-label="Close graph editor"><X size={15} /></button></header>
        <p className="ae-graph-empty">Animate a property first — press its ◆ button at two different times, then shape the motion here.</p>
      </div>
    );
  }
  const t0 = frames[0].time, t1 = frames.at(-1).time, span = Math.max(0.5, t1 - t0), pad = Math.max(0.2, span * 0.12);
  const from = t0 - pad, to = t1 + pad, N = 180;
  const samples = Array.from({ length: N + 1 }, (_, i) => { const t = from + ((to - from) * i) / N; return [t, Number(sampleProperty(layer, active, t, ctx))]; });
  let vmin = Math.min(...samples.map((s) => s[1])), vmax = Math.max(...samples.map((s) => s[1]));
  if (view === "speed") {
    const sp = samples.map(([t, v], i) => (i === 0 ? 0 : (v - samples[i - 1][1]) / ((to - from) / N)));
    vmin = Math.min(0, ...sp); vmax = Math.max(0.0001, ...sp);
    samples.forEach((s, i) => (s[1] = sp[i]));
  }
  if (vmax - vmin < 1e-6) { vmax += 1; vmin -= 1; }
  const vpad = (vmax - vmin) * 0.12; vmin -= vpad; vmax += vpad;
  const gx = (t) => M.l + ((t - from) / (to - from)) * (W - M.l - M.r), gy = (v) => H - M.b - ((v - vmin) / (vmax - vmin)) * (H - M.t - M.b);
  const tOf = (x) => from + ((x - M.l) / (W - M.l - M.r)) * (to - from), vOf = (y) => vmin + ((H - M.b - y) / (H - M.t - M.b)) * (vmax - vmin);
  const path = samples.map(([t, v], i) => `${i ? "L" : "M"}${gx(t).toFixed(1)},${gy(v).toFixed(1)}`).join(" ");

  /* current segment = arrival keyframe */
  const arrival = frames.find((f) => f.id === segId) || frames.find((f) => f.time > time + 0.5 / fps) || frames.at(-1), ai = frames.indexOf(arrival), before = frames[ai - 1];
  const bez = arrival && before ? (isCustomEasing(arrival.ease) ? arrival.ease.points : BEZIER_OF[arrival.ease]) : null;
  const toLocal = (e) => { const r = svg.current.getBoundingClientRect(); return [((e.clientX - r.left) / r.width) * W, ((e.clientY - r.top) / r.height) * H]; };
  const targets = () => { const own = selKf.filter((k) => k.startsWith(layer.id + "|" + active + "|")).map((k) => k.split("|")[2]); return own.length ? own : arrival ? [arrival.id] : []; };

  const dragKey = (f) => (e) => {
    e.preventDefault(); e.stopPropagation(); setSegId(f.id); api.begin();
    const move = (ev) => { const [x, y] = toLocal(ev); api.moveKey(active, f.id, snapToFrame(Math.max(0, tOf(x)), fps), view === "value" ? clampToProperty(active, vOf(y)) : undefined, true); };
    const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); api.end(); };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", up);
  };
  const dragHandle = (which) => (e) => {
    if (!before || !arrival) return;
    e.preventDefault(); e.stopPropagation(); api.begin();
    const move = (ev) => {
      const [x, y] = toLocal(ev), tt = Math.max(0, Math.min(1, (tOf(x) - before.time) / (arrival.time - before.time))), vv = (vOf(y) - before.value) / (arrival.value - before.value || 1);
      const next = [...(bez || [0.42, 0, 0.58, 1])];
      next[which * 2] = +tt.toFixed(3); next[which * 2 + 1] = +Math.max(-0.6, Math.min(1.6, vv)).toFixed(3);
      api.setEase(active, targets(), customEasing(next), true);
    };
    const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); api.end(); };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", up);
  };
  const pickSegment = (e) => { const [x] = toLocal(e), tt = tOf(x), hit = frames.find((f, i) => i > 0 && tt >= frames[i - 1].time && tt <= f.time); if (hit) setSegId(hit.id); };

  const hx = (i) => (bez ? gx(before.time + bez[i * 2] * (arrival.time - before.time)) : 0), hy = (i) => (bez ? gy(before.value + bez[i * 2 + 1] * (arrival.value - before.value)) : 0);
  const showHandles = view === "value" && bez && arrival.ease !== "Hold";
  const apply = (ease) => api.setEase(active, ease === "all-linear" ? frames.slice(1).map((f) => f.id) : targets(), ease === "all-linear" ? "Linear" : ease === "all-smooth" ? "Smooth" : ease, false);
  const allIds = frames.slice(1).map((f) => f.id);
  const influenceOut = bez ? Math.round(bez[0] * 100) : 0, influenceIn = bez ? Math.round((1 - bez[2]) * 100) : 0;
  const setInfluence = (which, pct) => { if (!bez) return; const next = [...bez]; if (which === "out") next[0] = pct / 100; else next[2] = 1 - pct / 100; api.setEase(active, targets(), customEasing(next), false); };
  const phaseX = gx(Math.max(from, Math.min(to, time)));

  return (
    <div className="ae-graph" role="dialog" aria-label="Graph editor">
      <header>
        <strong>Graph editor</strong>
        <div className="ae-graph-tabs" role="tablist">{["value", "speed"].map((v) => <button key={v} role="tab" aria-selected={view === v} className={view === v ? "on" : ""} onClick={() => setView(v)}>{v === "value" ? "Value" : "Speed"}</button>)}</div>
        <button onClick={onClose} aria-label="Close graph editor"><X size={15} /></button>
      </header>
      <div className="ae-graph-channels">
        {animated.map((k) => <button key={k} className={k === active ? "on" : ""} onClick={() => { setProp(k); setSegId(null); }}>{PROPERTY_DEFS[k].label}</button>)}
      </div>
      <svg ref={svg} viewBox={`0 0 ${W} ${H}`} className="ae-graph-plot" onPointerDown={pickSegment}>
        {[0, 0.25, 0.5, 0.75, 1].map((k) => <g key={k}><line x1={M.l} x2={W - M.r} y1={gy(vmin + (vmax - vmin) * k)} y2={gy(vmin + (vmax - vmin) * k)} className="grid" /><text x={M.l - 5} y={gy(vmin + (vmax - vmin) * k) + 3} textAnchor="end">{(vmin + (vmax - vmin) * k).toFixed(Math.abs(vmax - vmin) < 5 ? 2 : 0)}</text></g>)}
        {Array.from({ length: 6 }, (_, i) => from + ((to - from) * i) / 5).map((t, i) => <text key={i} x={gx(t)} y={H - 5} textAnchor="middle">{t.toFixed(1)}s</text>)}
        {before && arrival && <rect x={gx(before.time)} y={M.t} width={gx(arrival.time) - gx(before.time)} height={H - M.t - M.b} className="seg" />}
        <line x1={phaseX} x2={phaseX} y1={M.t} y2={H - M.b} className="head" />
        <path d={path} className="curve" />
        {showHandles && <>
          <line x1={gx(before.time)} y1={gy(before.value)} x2={hx(0)} y2={hy(0)} className="arm" /><line x1={gx(arrival.time)} y1={gy(arrival.value)} x2={hx(1)} y2={hy(1)} className="arm" />
          <circle cx={hx(0)} cy={hy(0)} r="5.5" className="handle" onPointerDown={dragHandle(0)}><title>Drag to change out-influence and value speed</title></circle>
          <circle cx={hx(1)} cy={hy(1)} r="5.5" className="handle" onPointerDown={dragHandle(1)}><title>Drag to change in-influence and value speed</title></circle>
        </>}
        {view === "value" && frames.map((f) => <circle key={f.id} cx={gx(f.time)} cy={gy(Number(f.value))} r="5" className={"key" + (f.id === arrival.id ? " cur" : "")} onPointerDown={dragKey(f)}><title>{`${f.time.toFixed(2)}s · ${Math.round(Number(f.value) * 100) / 100}`}</title></circle>)}
        {view === "speed" && frames.map((f) => <line key={f.id} x1={gx(f.time)} x2={gx(f.time)} y1={M.t} y2={H - M.b} className="kline" />)}
      </svg>
      <div className="ae-graph-presets" aria-label="Easing presets">
        {EASING_OPTIONS.map((name) => <button key={name} className={arrival?.ease === name ? "on" : ""} onClick={() => apply(name)}>{EASING_LABELS[name]}</button>)}
        <button className={isCustomEasing(arrival?.ease) ? "on" : ""} onClick={() => apply(isCustomEasing(arrival?.ease) ? arrival.ease : customEasing())}>Custom</button>
      </div>
      <footer>
        <label>Out influence <b>{influenceOut}%</b><input type="range" min="0" max="100" value={influenceOut} disabled={!bez} onChange={(e) => setInfluence("out", Number(e.target.value))} /></label>
        <label>In influence <b>{influenceIn}%</b><input type="range" min="0" max="100" value={influenceIn} disabled={!bez} onChange={(e) => setInfluence("in", Number(e.target.value))} /></label>
        <span className="ae-graph-reset"><button onClick={() => apply("all-linear")}>Reset to Linear</button><button onClick={() => apply("all-smooth")}>Reset to Smooth</button></span>
      </footer>
    </div>
  );
}
