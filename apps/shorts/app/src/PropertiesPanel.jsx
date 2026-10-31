import React, { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, Link2, Unlink2, Timer, Layers, Type as TypeIcon, Shapes, Video, ImagePlus, Subtitles, Volume2, Music2 } from "lucide-react";
import { PROPERTY_DEFS, keyframeAt, nextKeyframeTime, prevKeyframeTime } from "./animationEngine.js";
import { EasingMenu, EasingCurve, AnimateGuide, AssistantsSection, ExpressionField } from "./MotionInspector.jsx";

/* After Effects–style Properties panel: groups with twirl arrows; every property has a stopwatch (animate on/off), blue scrubbable values,
   previous / add / next keyframe buttons. Same engine as the rest of the editor — nothing here is separate state. */
const fmtVal = (v, def) => { const n = Number(v); const d = (def?.step ?? 1) < 1 ? 1 : 0; return (Math.round(n * 10 ** d) / 10 ** d).toFixed(d); };

function ScrubNum({ prop, value, api, label, unit }) {
  const def = PROPERTY_DEFS[prop], [editing, setEditing] = useState(false), [draft, setDraft] = useState("");
  const down = (e) => {
    if (e.button !== 0 || editing) return;
    e.preventDefault();
    const x0 = e.clientX, base = Number(value), range = (def.max ?? 100) - (def.min ?? 0), step = def.step || 1;
    let began = false;
    const move = (ev) => {
      const dx = ev.clientX - x0;
      if (!began && Math.abs(dx) < 3) return;
      if (!began) { began = true; api.edit(prop, null, "start"); }
      const v = base + dx * (ev.shiftKey ? step * 0.1 : Math.max(step * 0.5, range / 600));
      api.edit(prop, Math.min(def.max, Math.max(def.min, Math.round(v / (step / 10)) * (step / 10))), "move");
    };
    const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); if (began) api.edit(prop, null, "end"); else { setDraft(fmtVal(value, def)); setEditing(true); } };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", up);
  };
  const commit = () => { setEditing(false); const n = parseFloat(draft); if (Number.isFinite(n) && n !== Number(value)) api.edit(prop, n, "commit"); };
  return editing ? (
    <input className="ap-edit" autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === "Enter") commit(); if (e.key === "Escape") setEditing(false); }} aria-label={label} />
  ) : (
    <span className="ap-num" role="spinbutton" aria-label={label} aria-valuenow={Number(value)} tabIndex={0} onPointerDown={down} onKeyDown={(e) => { if (e.key === "ArrowUp" || e.key === "ArrowDown") { e.preventDefault(); api.edit(prop, Number(value) + (e.key === "ArrowUp" ? 1 : -1) * (def.step || 1) * (e.shiftKey ? 10 : 1), "commit"); } }} title="Drag to change · click to type · Shift = fine">{fmtVal(value, def)}{unit || def.unit ? <em>{unit ?? def.unit}</em> : null}</span>
  );
}

/* One property row (one or more channels sharing a stopwatch). */
function PRow({ layer, keys, label, time, fps, api, children, linked, onLink }) {
  const [menu, setMenu] = useState(null), navRef = useRef(null), defs = keys.map((k) => PROPERTY_DEFS[k]);
  const toggleMenu = () => { if (menu) { setMenu(null); return; } const r = navRef.current?.getBoundingClientRect(); setMenu(r ? { top: r.bottom + 4, right: Math.max(8, window.innerWidth - r.right) } : { top: 80, right: 20 }); };
  const all = keys.flatMap((k) => layer.keyframes?.[k] || []), enabled = keys.some((k) => layer.animationEnabled?.[k] !== false);
  const animated = all.length > 0 && enabled, here = keys.every((k) => keyframeAt(layer.keyframes?.[k] || [], time, fps)), hasPrev = prevKeyframeTime(all, time, fps) !== null, hasNext = nextKeyframeTime(all, time, fps) !== null;
  const segment = useMemo(() => { const f = [...(layer.keyframes?.[keys[0]] || [])].sort((a, b) => a.time - b.time); return f.find((x) => x.time > time + 0.5 / fps) || f.at(-1); }, [layer.keyframes, time, fps, keys]);
  const stopwatch = () => { if (animated) keys.forEach((k) => api.clearKeys(k)); else api.toggleKeys(keys); };
  return (
    <div className={"ap-row" + (animated ? " animated" : "")}>
      <button className={"ap-stop" + (animated ? " on" : "")} onClick={stopwatch} aria-pressed={animated} title={animated ? "Stop animating (removes keyframes, keeps the current value)" : "Start animating — adds a keyframe at the playhead"} aria-label={`${label}: animate`}><Timer size={14} /></button>
      <span className="ap-label">{label}</span>
      <span className="ap-vals">{children || keys.map((k, i) => <React.Fragment key={k}><ScrubNum prop={k} value={api.sample(k)} api={api} label={`${label}${keys.length > 1 ? " " + "XYZ"[i] : ""}`} />{i < keys.length - 1 && (onLink ? <button className={"ap-link" + (linked ? " on" : "")} onClick={onLink} aria-pressed={linked} title="Link values">{linked ? <Link2 size={12} /> : <Unlink2 size={12} />}</button> : <i className="ap-sep" />)}</React.Fragment>)}</span>
      <span className="ap-nav" ref={navRef}>
        <button disabled={!hasPrev} onClick={() => api.jump(keys[0], -1, all)} aria-label="Previous keyframe" title="Previous keyframe"><ChevronLeft size={13} /></button>
        <button className={"ap-key" + (here ? " on" : animated ? " dot" : "")} onClick={() => api.toggleKeys(keys)} aria-pressed={here} aria-label={here ? `Remove ${label} keyframe` : `Add ${label} keyframe`} title={here ? "Remove keyframe at playhead" : "Add keyframe at playhead"}><svg width="13" height="13" viewBox="0 0 14 14"><path d="M7 1.2 12.8 7 7 12.8 1.2 7Z" /></svg></button>
        <button disabled={!hasNext} onClick={() => api.jump(keys[0], 1, all)} aria-label="Next keyframe" title="Next keyframe"><ChevronRight size={13} /></button>
        {all.length > 1 && <button className="ap-ease" onClick={toggleMenu} aria-label="Easing" title="Easing"><EasingCurve easing={segment?.ease} size={16} /></button>}
        {menu && <div className="ap-menu-fixed" style={{ top: menu.top, right: menu.right }}><EasingMenu easing={segment?.ease || "Linear"} onPick={(e) => keys.forEach((k) => api.setEase(k, e))} onClose={() => setMenu(null)} /></div>}
      </span>
    </div>
  );
}

function Group({ title, icon: Icon, open: initial = true, children, badge, onReset }) {
  const [open, setOpen] = useState(initial);
  return (
    <section className={"ap-group" + (open ? " open" : "")}>
      <button className="ap-group-head" onClick={() => setOpen(!open)} aria-expanded={open}><ChevronDown size={14} />{Icon && <Icon size={14} />}<span>{title}</span>{badge ? <i>{badge}</i> : null}{onReset && <em role="button" tabIndex={0} className="ap-reset" onClick={(e) => { e.stopPropagation(); onReset(); }} onKeyDown={(e) => { if (e.key === "Enter") { e.stopPropagation(); onReset(); } }}>Reset</em>}</button>
      {open && <div className="ap-group-body">{children}</div>}
    </section>
  );
}
const SelectRow = ({ label, value, options, onChange }) => <div className="ap-row plain"><span className="ap-stop ghost" /><span className="ap-label">{label}</span><span className="ap-vals"><select value={value} onChange={(e) => onChange(e.target.value)}>{options.map(([v, n]) => <option key={v} value={v}>{n}</option>)}</select></span></div>;
const ColorRow = ({ label, value, onChange, children }) => <div className="ap-row plain"><span className="ap-stop ghost" /><span className="ap-label">{label}</span><span className="ap-vals"><input type="color" className="ap-color" value={String(value).slice(0, 7)} onChange={(e) => onChange(e.target.value)} aria-label={label} /><code>{String(value).toUpperCase().slice(0, 7)}</code>{children}</span></div>;
const Toggle = ({ label, checked, onChange }) => <div className="ap-row plain"><span className="ap-stop ghost" /><span className="ap-label">{label}</span><span className="ap-vals"><label className="ap-switch"><input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} /><i /></label></span></div>;
const swatch = (api, key, edit, label) => <><input type="color" className="ap-color" value={String(api.sample(key)).slice(0, 7)} onChange={(e) => edit(key, e.target.value)} aria-label={label} /><code>{String(api.sample(key)).toUpperCase().slice(0, 7)}</code></>;
const KIND_ICON = { text: TypeIcon, shape: Shapes, video: Video, image: ImagePlus, subtitle: Subtitles, sfx: Volume2 };

export default function PropertiesPanel({ onKeyAll, keyAllOn, layer, time, fps, api, patch, edit, layers, mode, setMode, hasAudio, graphOpen, setGraphOpen, guide, onAnimate, onDoneGuide, onPlay, duration }) {
  if (!layer) return null;
  const kind = layer.kind, adv = mode === "advanced", isShape = kind === "shape", isMedia = kind === "image" || kind === "video", isText = kind === "text", Icon = (layer.music ? Music2 : KIND_ICON[kind]) || Layers;
  const row = (keys, label, extra = {}) => <PRow layer={layer} keys={Array.isArray(keys) ? keys : [keys]} label={label} time={time} fps={fps} api={api} {...extra} />;
  const twoKeys = ["x", "y"].some((k) => new Set((layer.keyframes?.[k] || []).map((f) => f.time.toFixed(3))).size > 1);
  const linked = layer.linkSize ?? !isShape;
  if (kind === "sfx") return (
    <div className="ap-root">
      <div className="ap-head"><Icon size={15} /><strong>{layer.name}</strong><small>Audio</small></div>
      <Group title="Audio levels">{row("volume", "Volume")}{row("pan", "Pan")}</Group>
      <Group title="Timing">
        <div className="ap-row plain"><span className="ap-stop ghost" /><span className="ap-label">Start</span><span className="ap-vals"><input className="ap-time" type="number" step={1 / fps} value={+layer.start.toFixed(3)} onChange={(e) => edit("start", Math.max(0, Number(e.target.value)))} /> s</span></div>
        <div className="ap-row plain"><span className="ap-stop ghost" /><span className="ap-label">Length</span><span className="ap-vals"><input className="ap-time" type="number" step={1 / fps} value={+layer.duration.toFixed(3)} onChange={(e) => edit("duration", Math.max(0.05, Number(e.target.value)))} /> s</span></div>
      </Group>
    </div>
  );
  return (
    <div className="ap-root">
      <div className="ap-head"><Icon size={15} /><strong>{layer.name}</strong>
        <button className={"ap-keyall" + (keyAllOn ? " on" : "")} onClick={onKeyAll} title="Keyframe all properties at the playhead" aria-label="Keyframe all properties" aria-pressed={keyAllOn}><svg width="13" height="13" viewBox="0 0 14 14"><path d="M7 1 13 7 7 13 1 7Z" /></svg></button>
        <span className="ap-mode" role="group" aria-label="Properties detail"><i style={{ transform: adv ? "translateX(100%)" : "none" }} />{[["basic", "Basic"], ["advanced", "Advanced"]].map(([id, n]) => <button key={id} className={mode === id ? "on" : ""} aria-pressed={mode === id} onClick={() => setMode(id)}>{n}</button>)}</span>
      </div>
      <AnimateGuide guide={guide} onAnimate={onAnimate} onDone={onDoneGuide} hasKeys={Object.keys(layer.keyframes || {}).length > 0} twoKeys={twoKeys} onPlay={onPlay} />
      <Group title="Transform" icon={Layers} onReset={() => ["anchorX", "anchorY", "x", "y", "scale", "rotation", "opacity"].forEach((k) => api.reset(k))}>
        {row(["anchorX", "anchorY"], "Anchor Point")}
        {row(["x", "y"], "Position")}
        {row("scale", "Scale")}
        {adv && row("skewX", "Skew")}
        {row("rotation", "Rotation")}
        {row("opacity", "Opacity")}
      </Group>
      {isShape && <Group title="Contents" icon={Shapes}>
        <SelectRow label="Shape" value={layer.shapeType || "rect"} options={[["rect", "Rectangle"], ["ellipse", "Ellipse"], ["polygon", "Polygon"], ["star", "Star"], ["line", "Line"], ["arrow", "Arrow"]]} onChange={(v) => patch({ shapeType: v, ...(v === "polygon" && !layer.sides ? { sides: 5 } : {}) })} />
        {row(["width", "height"], "Size", { linked, onLink: () => patch({ linkSize: !linked }) })}
        {row("cornerRadius", "Roundness")}
        {row("color", "Fill", { children: swatch(api, "color", edit, "Fill colour") })}
        <Toggle label="Gradient" checked={!!layer.gradient} onChange={(v) => patch({ gradient: v })} />
        {layer.gradient && row("color2", "Gradient end", { children: swatch(api, "color2", edit, "Gradient end colour") })}
        {row("strokeColor", "Stroke", { children: swatch(api, "strokeColor", edit, "Stroke colour") })}
        {row("strokeWidth", "Stroke width")}
        {layer.shapeType === "polygon" && <div className="ap-row plain"><span className="ap-stop ghost" /><span className="ap-label">Points</span><span className="ap-vals"><input className="ap-time" type="number" min="3" max="12" value={layer.sides || 5} onChange={(e) => patch({ sides: Math.max(3, Math.min(12, Number(e.target.value))) })} /></span></div>}
        <div className="ap-row plain"><span className="ap-stop ghost" /><span className="ap-label">Dashes</span><span className="ap-vals"><input className="ap-range" type="range" min="0" max="20" value={layer.dash || 0} onChange={(e) => patch({ dash: Number(e.target.value) })} /></span></div>
      </Group>}
      {isMedia && <Group title="Contents" icon={kind === "video" ? Video : ImagePlus}>
        {row(["width", "height"], "Size", { linked, onLink: () => patch({ linkSize: !linked }) })}
        <SelectRow label="Fit" value={layer.fit || "Cover"} options={[["Cover", "Cover"], ["Contain", "Contain"]]} onChange={(v) => patch({ fit: v })} />
        {row("cornerRadius", "Roundness")}
        {row("vignette", "Vignette")}
        <Toggle label="Flip horizontal" checked={!!layer.flipH} onChange={(v) => patch({ flipH: v })} />
        <Toggle label="Flip vertical" checked={!!layer.flipV} onChange={(v) => patch({ flipV: v })} />
      </Group>}
      {isText && <Group title="Text" icon={TypeIcon}>
        <div className="ap-row plain col"><textarea className="ap-text" rows={2} aria-label="Text" value={layer.text} onChange={(e) => edit("text", e.target.value)} /></div>
        {row("fontSize", "Font size")}
        {row("letterSpacing", "Tracking")}
        {row("arc", "Curve")}
        {row("color", "Fill", { children: swatch(api, "color", edit, "Fill colour") })}
        <div className="ap-row plain"><span className="ap-stop ghost" /><span className="ap-label">Stroke</span><span className="ap-vals"><input className="ap-range" type="range" min="0" max="24" value={layer.outline || 0} onChange={(e) => edit("outline", Number(e.target.value))} /><input type="color" className="ap-color" value={layer.outlineColor || "#000000"} onChange={(e) => edit("outlineColor", e.target.value)} aria-label="Stroke colour" /></span></div>
      </Group>}
      <Group title="Effects" open={adv || false}>
        {row("blur", "Blur")}{row("glow", "Glow")}{row("shadowBlur", "Drop shadow")}
        {adv && <>{row("brightness", "Brightness")}{row("contrast", "Contrast")}{row("saturation", "Saturation")}{row("hue", "Hue")}{row("reveal", "Reveal")}
          <SelectRow label="Blend mode" value={layer.blend || "normal"} options={["normal", "multiply", "screen", "overlay", "darken", "lighten", "add", "difference"].map((m) => [m, m[0].toUpperCase() + m.slice(1)])} onChange={(v) => patch({ blend: v })} /></>}
      </Group>
      {adv && <Group title="Mask" open={!!layer.mask?.type && layer.mask.type !== "none"}>
        <SelectRow label="Mode" value={layer.mask?.type || "none"} options={[["none", "None"], ["rect", "Rectangle"], ["ellipse", "Ellipse"]]} onChange={(v) => patch({ mask: { ...(layer.mask || {}), type: v } })} />
        {layer.mask?.type && layer.mask.type !== "none" && <>{row(["maskW", "maskH"], "Mask size")}{row(["maskX", "maskY"], "Mask position")}{row("maskFeather", "Feather")}<Toggle label="Invert" checked={!!layer.mask.invert} onChange={(v) => patch({ mask: { ...layer.mask, invert: v } })} /></>}
      </Group>}
      <Group title="Timing" open={false}>
        <div className="ap-row plain"><span className="ap-stop ghost" /><span className="ap-label">Start</span><span className="ap-vals"><input className="ap-time" type="number" min="0" max={duration} step={1 / fps} value={+layer.start.toFixed(3)} onChange={(e) => edit("start", Math.max(0, Number(e.target.value)))} /> s</span></div>
        <div className="ap-row plain"><span className="ap-stop ghost" /><span className="ap-label">Length</span><span className="ap-vals"><input className="ap-time" type="number" min="0.1" step={1 / fps} value={+layer.duration.toFixed(3)} onChange={(e) => edit("duration", Math.max(0.1, Number(e.target.value)))} /> s</span></div>
        <SelectRow label="Parent" value={layer.parentId || ""} options={[["", "None"], ...layers.filter((o) => o.id !== layer.id && o.kind !== "sfx" && o.parentId !== layer.id).map((o) => [o.id, o.name])]} onChange={(v) => patch({ parentId: v || null })} />
      </Group>
      {adv && <Group title="Assistants & expressions" open={false}><AssistantsSection layer={layer} api={api} hasAudio={hasAudio} /><div style={{ height: 8 }} /><ExpressionField layer={layer} api={api} /></Group>}
      <button className={"ap-graph" + (graphOpen ? " on" : "")} onClick={() => setGraphOpen(!graphOpen)} aria-pressed={graphOpen}>{graphOpen ? "Hide" : "Open"} graph editor</button>
    </div>
  );
}
