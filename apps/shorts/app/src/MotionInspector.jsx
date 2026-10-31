import React, { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, MoreHorizontal, Link2, Unlink2, Sparkles, RotateCcw, Copy, ClipboardPaste, Repeat, FlipHorizontal2, Layers2, Trash2 } from "lucide-react";
import {
  EASING_OPTIONS, EASING_LABELS, DEFAULT_BEZIER, PROPERTY_DEFS, easingAt, customEasing, isCustomEasing,
  nextKeyframeTime, prevKeyframeTime, keyframeAt, PROCEDURAL_TYPES, validateExpression,
} from "./animationEngine.js";

/* ---------- small pieces ---------- */
export function EasingCurve({ easing, size = 26, active }) {
  const pts = useMemo(() => Array.from({ length: 33 }, (_, i) => { const p = i / 32, v = easingAt(p, easing); return `${(2 + p * (size - 4)).toFixed(1)},${(size - 2 - Math.max(-0.35, Math.min(1.35, v)) * (size - 4)).toFixed(1)}`; }).join(" "), [easing, size]);
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className={"mi-curve" + (active ? " on" : "")} aria-hidden="true">
      <polyline points={pts} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/* Live easing preview: a dot travelling along the eased value. UI-only (rAF); never touches timeline state. */
function EasingPreview({ easing }) {
  const dot = useRef(null), bar = useRef(null);
  useEffect(() => {
    let id, start = performance.now();
    const tick = (now) => {
      const phase = ((now - start) / 1400) % 1.6, p = Math.min(1, phase / 1.1), v = easingAt(p, easing);
      if (dot.current) dot.current.style.transform = `translateX(${v * 100}%)`;
      if (bar.current) bar.current.style.opacity = phase > 1.1 ? 0.5 : 1;
      id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, [easing]);
  return (
    <div className="mi-preview" ref={bar}>
      <div className="mi-preview-rail"><i ref={dot} /></div>
    </div>
  );
}

/* Bézier curve editor used for Custom easing (and by the Graph Editor). */
export function BezierEditor({ value, onChange, size = 132 }) {
  const pts = isCustomEasing(value) ? value.points : DEFAULT_BEZIER, box = useRef(null);
  const toXY = (px, py) => [px * (size - 24) + 12, (1 - py) * (size - 24) + 12];
  const drag = (index) => (event) => {
    event.preventDefault();
    const rect = box.current.getBoundingClientRect(), next = [...pts];
    const move = (e) => {
      const x = Math.max(0, Math.min(1, (e.clientX - rect.left - 12) / (size - 24))), y = Math.max(-0.5, Math.min(1.5, 1 - (e.clientY - rect.top - 12) / (size - 24)));
      next[index * 2] = +x.toFixed(3); next[index * 2 + 1] = +y.toFixed(3);
      onChange(customEasing(next));
    };
    const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", up);
  };
  const [x0, y0] = toXY(0, 0), [x1, y1] = toXY(1, 1), [c1x, c1y] = toXY(pts[0], pts[1]), [c2x, c2y] = toXY(pts[2], pts[3]);
  return (
    <svg ref={box} width={size} height={size} className="mi-bezier" aria-label="Custom easing curve">
      <rect x="12" y="12" width={size - 24} height={size - 24} rx="3" fill="none" stroke="#dfe3ec" />
      <line x1={x0} y1={y0} x2={c1x} y2={c1y} stroke="#9eb0f7" /><line x1={x1} y1={y1} x2={c2x} y2={c2y} stroke="#9eb0f7" />
      <path d={`M${x0},${y0} C${c1x},${c1y} ${c2x},${c2y} ${x1},${y1}`} fill="none" stroke="#3f61e8" strokeWidth="2" />
      <circle cx={c1x} cy={c1y} r="6" className="mi-handle" onPointerDown={drag(0)} /><circle cx={c2x} cy={c2y} r="6" className="mi-handle" onPointerDown={drag(1)} />
    </svg>
  );
}

export function EasingMenu({ easing, onPick, onClose }) {
  const [hover, setHover] = useState(null);
  const shown = hover ?? easing;
  const ref = useRef(null);
  useEffect(() => {
    const away = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose(); };
    const key = (e) => e.key === "Escape" && onClose();
    window.addEventListener("pointerdown", away, true); window.addEventListener("keydown", key);
    return () => { window.removeEventListener("pointerdown", away, true); window.removeEventListener("keydown", key); };
  }, [onClose]);
  const current = isCustomEasing(easing) ? "Custom" : easing;
  return (
    <div className="mi-menu mi-easing" ref={ref} role="menu">
      <div className="mi-easing-list">
        {EASING_OPTIONS.map((name) => (
          <button key={name} role="menuitemradio" aria-checked={current === name} className={current === name ? "on" : ""} onMouseEnter={() => setHover(name)} onMouseLeave={() => setHover(null)} onClick={() => { onPick(name); onClose(); }}>
            <EasingCurve easing={name} size={22} /> {EASING_LABELS[name]}
          </button>
        ))}
        <button role="menuitemradio" aria-checked={current === "Custom"} className={current === "Custom" ? "on" : ""} onMouseEnter={() => setHover(customEasing())} onMouseLeave={() => setHover(null)} onClick={() => onPick(isCustomEasing(easing) ? easing : customEasing())}>
          <EasingCurve easing={customEasing()} size={22} /> Custom curve…
        </button>
      </div>
      <div className="mi-easing-side">
        <EasingPreview easing={shown} />
        {current === "Custom" && <BezierEditor value={easing} onChange={onPick} />}
        <small>{hover ? "Preview" : "Current"} · {isCustomEasing(shown) ? "Custom" : EASING_LABELS[shown] || "Linear"}</small>
      </div>
    </div>
  );
}

/* ---------- property row ---------- */
function useScrub(step, min, max, get, apply) {
  return (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const startX = event.clientX, base = Number(get()), range = max - min, fine = event.shiftKey;
    let began = false;
    const move = (e) => {
      const dx = e.clientX - startX;
      if (!began && Math.abs(dx) < 2) return;
      if (!began) { began = true; apply(base, "start"); }
      const v = base + dx * (fine ? step * 0.1 : Math.max(step, range / 400));
      apply(Math.min(max, Math.max(min, Math.round(v / step) * step)), "move");
    };
    const up = (e) => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); if (began) apply(null, "end"); };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", up);
  };
}

function DiamondCluster({ frames, time, fps, enabledAnim, onToggle, onJump }) {
  const here = !!keyframeAt(frames, time, fps), animated = frames.length > 0 && enabledAnim;
  const prev = prevKeyframeTime(frames, time, fps) !== null, next = nextKeyframeTime(frames, time, fps) !== null;
  return (
    <span className="mi-diamonds">
      <button className="mi-step" disabled={!prev} onClick={() => onJump(-1)} title="Previous keyframe" aria-label="Previous keyframe"><ChevronLeft size={12} /></button>
      <button className={"mi-diamond" + (here ? " on" : animated ? " dot" : "")} onClick={onToggle} title={here ? "Remove keyframe at playhead" : "Add keyframe at playhead"} aria-pressed={here} aria-label="Toggle keyframe">
        <svg width="14" height="14" viewBox="0 0 14 14"><path d="M7 1.2 12.8 7 7 12.8 1.2 7Z" /></svg>
      </button>
      <button className="mi-step" disabled={!next} onClick={() => onJump(1)} title="Next keyframe" aria-label="Next keyframe"><ChevronRight size={12} /></button>
    </span>
  );
}

function RowMenu({ api, propKey, frames, loop, enabledAnim, onClose }) {
  const ref = useRef(null);
  useEffect(() => {
    const away = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose(); };
    window.addEventListener("pointerdown", away, true);
    return () => window.removeEventListener("pointerdown", away, true);
  }, [onClose]);
  const item = (Icon, label, fn, disabled) => <button disabled={disabled} onClick={() => { fn(); onClose(); }}><Icon size={13} /> {label}</button>;
  return (
    <div className="mi-menu mi-more" ref={ref} role="menu">
      {item(Sparkles, enabledAnim ? "Disable animation (keep static)" : "Enable animation", () => api.setEnabled(propKey, !enabledAnim), !frames.length)}
      {item(Repeat, loop === "repeat" ? "Stop repeating" : "Repeat", () => api.setLoop(propKey, loop === "repeat" ? "none" : "repeat"), frames.length < 2)}
      {item(Repeat, loop === "pingpong" ? "Stop ping-pong" : "Ping-pong", () => api.setLoop(propKey, loop === "pingpong" ? "none" : "pingpong"), frames.length < 2)}
      {item(FlipHorizontal2, "Reverse animation", () => api.reverse(propKey), frames.length < 2)}
      {item(Layers2, "Duplicate animation", () => api.duplicate(propKey), frames.length < 2)}
      {item(Copy, "Copy keyframes", () => api.copy(propKey), !frames.length)}
      {item(ClipboardPaste, "Paste at playhead", () => api.paste(propKey), !api.hasClipboard)}
      {item(RotateCcw, "Reset property", () => api.reset(propKey), false)}
    </div>
  );
}

export function PropertyRow({ layer, propKey, label, time, fps, api, time01 }) {
  const def = PROPERTY_DEFS[propKey];
  const frames = layer.keyframes?.[propKey] || [], enabledAnim = layer.animationEnabled?.[propKey] !== false;
  const value = api.sample(propKey), [menu, setMenu] = useState(null);
  const segment = useMemo(() => {
    const s = [...frames].sort((a, b) => a.time - b.time);
    return s.find((f) => f.time > time + 0.5 / fps) || s.at(-1);
  }, [frames, time, fps]);
  const smooth = frames.length > 1 && frames.slice(1).every((f) => f.ease === "Smooth");
  const set = (v, phase) => api.edit(propKey, v, phase);
  const scrub = useScrub(def.step || 1, def.min ?? 0, def.max ?? 100, () => value, (v, phase) => set(v, phase));
  if (def.type === "color") {
    return (
      <div className={"mi-row" + (frames.length ? " animated" : "")}>
        <div className="mi-line">
          <span className="mi-label">{label}</span>
          <input type="color" aria-label={label} value={String(value).slice(0, 7)} onChange={(e) => set(e.target.value, "move")} />
          <span className="mi-spacer" />
          <DiamondCluster frames={frames} time={time} fps={fps} enabledAnim={enabledAnim} onToggle={() => api.toggleKey(propKey)} onJump={(d) => api.jump(propKey, d)} />
          {frames.length > 1 && <button className="mi-ease" onClick={() => setMenu("ease")} title="Easing"><EasingCurve easing={segment?.ease} size={18} /><ChevronDown size={10} /></button>}
          <button className="mi-more-btn" onClick={() => setMenu(menu === "more" ? null : "more")} aria-label="More"><MoreHorizontal size={14} /></button>
          {menu === "ease" && <EasingMenu easing={segment?.ease || "Linear"} onPick={(e) => api.setEase(propKey, e)} onClose={() => setMenu(null)} />}
          {menu === "more" && <RowMenu api={api} propKey={propKey} frames={frames} loop={layer.keyframeLoop?.[propKey]} enabledAnim={enabledAnim} onClose={() => setMenu(null)} />}
        </div>
      </div>
    );
  }
  const shown = Math.round(Number(value) * 100) / 100;
  return (
    <div className={"mi-row" + (frames.length ? " animated" : "") + (frames.length && !enabledAnim ? " paused" : "")}>
      <div className="mi-line">
        <span className="mi-label mi-scrub" onPointerDown={scrub} title="Drag to change · Shift for fine control">{label}</span>
        <span className="mi-field">
          <input type="number" aria-label={label} min={def.min} max={def.max} step={def.step} value={shown} onChange={(e) => e.target.value !== "" && set(Number(e.target.value), "commit")} />
          <em>{def.unit}</em>
        </span>
        <span className="mi-spacer" />
        <DiamondCluster frames={frames} time={time} fps={fps} enabledAnim={enabledAnim} onToggle={() => api.toggleKey(propKey)} onJump={(d) => api.jump(propKey, d)} />
        {frames.length > 1 && (
          <button className={"mi-smooth" + (smooth ? " on" : "")} onClick={() => api.setEase(propKey, smooth ? "Linear" : "Smooth", "all")} title="Smooth Motion — gentle acceleration and deceleration" aria-pressed={smooth}>Smooth</button>
        )}
        {frames.length > 1 && <button className="mi-ease" onClick={() => setMenu(menu === "ease" ? null : "ease")} title="Easing for this segment"><EasingCurve easing={segment?.ease} size={18} /><ChevronDown size={10} /></button>}
        <button className="mi-more-btn" onClick={() => setMenu(menu === "more" ? null : "more")} aria-label="More options"><MoreHorizontal size={14} /></button>
        {menu === "ease" && <EasingMenu easing={segment?.ease || "Linear"} onPick={(e) => api.setEase(propKey, e)} onClose={() => setMenu(null)} />}
        {menu === "more" && <RowMenu api={api} propKey={propKey} frames={frames} loop={layer.keyframeLoop?.[propKey]} enabledAnim={enabledAnim} onClose={() => setMenu(null)} />}
      </div>
      <input className="mi-slider" type="range" aria-label={`${label} slider`} min={def.min} max={def.max} step={def.step} value={Number(value)} onChange={(e) => set(Number(e.target.value), "move")} onPointerDown={() => api.edit(propKey, null, "start")} onPointerUp={() => api.edit(propKey, null, "end")} />
    </div>
  );
}

/* Position is two properties edited (and keyframed) together in Basic mode. */
export function PositionRow({ layer, time, fps, api }) {
  const fx = layer.keyframes?.x || [], fy = layer.keyframes?.y || [];
  const frames = fx.length >= fy.length ? fx : fy, enabledAnim = layer.animationEnabled?.x !== false;
  const [menu, setMenu] = useState(null);
  const segment = useMemo(() => { const s = [...frames].sort((a, b) => a.time - b.time); return s.find((f) => f.time > time + 0.5 / fps) || s.at(-1); }, [frames, time, fps]);
  const smooth = frames.length > 1 && frames.slice(1).every((f) => f.ease === "Smooth");
  const field = (k, label) => {
    const def = PROPERTY_DEFS[k], v = Math.round(Number(api.sample(k)) * 10) / 10;
    return <label className="mi-xy"><span>{label}</span><input type="number" aria-label={`Position ${label}`} step={def.step} value={v} onChange={(e) => e.target.value !== "" && api.edit(k, Number(e.target.value), "commit")} /></label>;
  };
  return (
    <div className={"mi-row" + (frames.length ? " animated" : "")}>
      <div className="mi-line">
        <span className="mi-label">Position</span>
        {field("x", "X")}{field("y", "Y")}
        <span className="mi-spacer" />
        <DiamondCluster frames={frames} time={time} fps={fps} enabledAnim={enabledAnim} onToggle={() => api.toggleKeys(["x", "y"])} onJump={(d) => api.jump("x", d, frames)} />
        {frames.length > 1 && <button className={"mi-smooth" + (smooth ? " on" : "")} onClick={() => { api.setEase("x", smooth ? "Linear" : "Smooth", "all"); api.setEase("y", smooth ? "Linear" : "Smooth", "all"); }} aria-pressed={smooth} title="Smooth Motion">Smooth</button>}
        {frames.length > 1 && <button className="mi-ease" onClick={() => setMenu(menu === "ease" ? null : "ease")} title="Easing"><EasingCurve easing={segment?.ease} size={18} /><ChevronDown size={10} /></button>}
        {menu === "ease" && <EasingMenu easing={segment?.ease || "Linear"} onPick={(e) => { api.setEase("x", e); api.setEase("y", e); }} onClose={() => setMenu(null)} />}
      </div>
    </div>
  );
}

/* ---------- sections ---------- */
export function Section({ title, defaultOpen = true, children, count }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className={"mi-section" + (open ? " open" : "")}>
      <button className="mi-section-head" onClick={() => setOpen(!open)} aria-expanded={open}><ChevronDown size={14} />{title}{count ? <i>{count}</i> : null}</button>
      <div className="mi-section-body" hidden={!open}>{children}</div>
    </section>
  );
}

export function AnimateGuide({ guide, onAnimate, onDone, hasKeys, twoKeys, playing, onPlay }) {
  if (twoKeys && guide) return (
    <div className="mi-guide done"><strong>Nice — it's animated.</strong><span>Press play to watch it, or drag a keyframe on the timeline to change the speed.</span><button onClick={() => { onPlay(); onDone(); }}>Play it</button></div>
  );
  if (guide) return (
    <div className="mi-guide"><strong>Step {guide.step} of 2</strong>
      <span>{guide.step === 1 ? "Keyframe placed at the start. Now move the playhead later on the timeline." : "Drag the object in the preview (or change a value) to where it should end up. Shorts animates the movement for you."}</span>
      <button className="ghost" onClick={onDone}>Cancel</button></div>
  );
  return (
    <div className="mi-animate">
      <button className="mi-animate-btn" onClick={onAnimate}><Sparkles size={15} /> Animate</button>
      <small>{hasKeys ? "Add more keyframes with the ◆ buttons." : "Two keyframes at different times — Shorts does the rest."}</small>
    </div>
  );
}

export function AssistantsSection({ layer, api, hasAudio }) {
  const [key, setKey] = useState("x");
  const spec = layer.procedural?.[key];
  const keys = ["x", "y", "scale", "rotation", "opacity"];
  const set = (patch) => api.setProcedural(key, { type: "wiggle", amount: 4, frequency: 2, seed: 1, ...spec, ...patch });
  return (
    <div className="mi-assist">
      <div className="mi-assist-row">
        <select aria-label="Property" value={key} onChange={(e) => setKey(e.target.value)}>{keys.map((k) => <option key={k} value={k}>{PROPERTY_DEFS[k].label}</option>)}</select>
        <select aria-label="Assistant" value={spec?.type || "off"} onChange={(e) => e.target.value === "off" ? api.setProcedural(key, null) : set({ type: e.target.value })}>
          <option value="off">Off</option>
          {PROCEDURAL_TYPES.filter((t) => t !== "follow" && (t !== "audio" || hasAudio)).map((t) => <option key={t} value={t}>{{ wiggle: "Wiggle", oscillate: "Oscillate", bounce: "Bounce", shake: "Smooth shake", audio: "React to audio" }[t]}</option>)}
        </select>
      </div>
      {spec && (
        <div className="mi-assist-sliders">
          <label>Amount · {spec.amount}<input type="range" min="-30" max="30" step="0.5" value={spec.amount} onChange={(e) => set({ amount: Number(e.target.value) })} /></label>
          {spec.type !== "audio" && <label>Speed · {spec.frequency}<input type="range" min="0.1" max="12" step="0.1" value={spec.frequency} onChange={(e) => set({ frequency: Number(e.target.value) })} /></label>}
          {["wiggle", "shake"].includes(spec.type) && <label>Seed · {spec.seed}<input type="range" min="1" max="99" step="1" value={spec.seed} onChange={(e) => set({ seed: Number(e.target.value) })} /></label>}
          {spec.type === "audio" && <>
            <label>Source<select value={spec.mode || "level"} onChange={(e) => set({ mode: e.target.value })}><option value="level">Volume level</option><option value="beat">Musical beats</option></select></label>
            <label>Sensitivity · {spec.sensitivity ?? 0.55}<input type="range" min="0.1" max="0.95" step="0.05" value={spec.sensitivity ?? 0.55} onChange={(e) => set({ sensitivity: Number(e.target.value) })} /></label>
            <label>Smoothing · {spec.smoothing ?? 0.35}<input type="range" min="0" max="0.9" step="0.05" value={spec.smoothing ?? 0.35} onChange={(e) => set({ smoothing: Number(e.target.value) })} /></label>
          </>}
          <button className="ghost" onClick={() => api.bake(key)}>Bake to keyframes</button>
        </div>
      )}
    </div>
  );
}

export function ExpressionField({ layer, api }) {
  const [key, setKey] = useState("x"), expr = layer.expressions?.[key] || "", status = expr ? validateExpression(expr) : { ok: true };
  return (
    <div className="mi-assist">
      <div className="mi-assist-row">
        <select aria-label="Expression property" value={key} onChange={(e) => setKey(e.target.value)}>{["x", "y", "scale", "rotation", "opacity"].map((k) => <option key={k} value={k}>{PROPERTY_DEFS[k].label}</option>)}</select>
      </div>
      <input className={"mi-expr" + (status.ok ? "" : " bad")} placeholder="e.g. value + sin(t * 3) * 4" value={expr} onChange={(e) => api.setExpression(key, e.target.value)} spellCheck={false} aria-label="Expression" />
      <small>{status.ok ? "Sandboxed: t, value, pi · sin cos abs min max clamp lerp noise wiggle…" : status.error}</small>
    </div>
  );
}
