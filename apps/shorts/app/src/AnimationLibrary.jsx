import React, { useEffect, useMemo, useRef, useState } from "react";
import { Search, Trash2, Bookmark } from "lucide-react";
import { ANIMATION_PRESETS, PRESET_CATEGORIES, DIRECTIONS, previewPose, presetById, presetOptions, loadCustomPresets } from "./animationPresets.js";
import { EASING_OPTIONS, EASING_LABELS } from "./animationEngine.js";

/* A preset card whose hover preview is sampled from the real engine (previewPose → sampleProperty),
   so what you see on hover is exactly what Apply creates. rAF drives only this little UI preview. */
function PresetCard({ preset, onApply, custom }) {
  const box = useRef(null), [hover, setHover] = useState(false);
  useEffect(() => {
    const el = box.current;
    if (!hover || !el || custom) { if (el) { el.style.cssText = ""; } return; }
    let id; const start = performance.now(), len = Math.max(0.8, preset.duration) + 0.7;
    const frame = (now) => {
      const t = Math.min(((now - start) / 1000) % len, len);
      const sampleT = preset.phase === "out" ? Math.max(0, 2 - preset.duration + Math.min(t, preset.duration)) : preset.phase === "loop" ? t : Math.min(t, 2);
      const p = previewPose(preset, preset.phase === "out" ? Math.min(2, sampleT) : sampleT);
      const parts = [];
      if (p.blur > 0.2) parts.push(`blur(${(p.blur / 4).toFixed(1)}px)`);
      if (p.brightness && Math.abs(p.brightness - 100) > 1) parts.push(`brightness(${p.brightness}%)`);
      el.style.transform = `translate(${(p.x - 50) * 1.2}px, ${(p.y - 50) * 1.2}px) rotate(${p.rotation}deg) scale(${Math.max(0, p.scale) / 100})`;
      el.style.opacity = Math.max(0, Math.min(1, p.opacity / 100));
      el.style.filter = parts.join(" ");
      el.style.clipPath = p.reveal < 99.5 ? `inset(0 ${100 - p.reveal}% 0 0)` : "none";
      el.style.boxShadow = p.glow > 1 ? `0 0 ${p.glow / 2}px #4568ee` : "";
      id = requestAnimationFrame(frame);
    };
    id = requestAnimationFrame(frame);
    return () => { cancelAnimationFrame(id); el.style.cssText = ""; };
  }, [hover, preset, custom]);
  return (
    <div className="al-card" draggable onDragStart={(e) => { e.dataTransfer.setData("application/x-frame-preset", preset.id); e.dataTransfer.effectAllowed = "copy"; }}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)} onFocus={() => setHover(true)} onBlur={() => setHover(false)}>
      <div className="al-stage"><span className="al-sample" ref={box}>Aa</span></div>
      <div className="al-meta"><span>{preset.name}</span><button onClick={() => onApply(preset)} aria-label={`Apply ${preset.name}`}>Apply</button></div>
    </div>
  );
}

export function PresetGrid({ onApply, textLayer, shapeLayer }) {
  const [q, setQ] = useState(""), [cat, setCat] = useState("All"), custom = useMemo(loadCustomPresets, [q, cat]);
  const list = useMemo(() => {
    const all = [...ANIMATION_PRESETS.filter((p) => (!p.textOnly || textLayer) && (!p.shapeOnly || shapeLayer)), ...custom];
    const needle = q.trim().toLowerCase();
    return all.filter((p) => (cat === "All" || p.category === cat) && (!needle || p.name.toLowerCase().includes(needle) || p.category.toLowerCase().includes(needle)));
  }, [q, cat, custom, textLayer, shapeLayer]);
  const cats = ["All", ...PRESET_CATEGORIES, ...(custom.length ? ["Custom"] : [])];
  return (
    <div className="al-root">
      <label className="al-search"><Search size={14} /><input placeholder="Search animations" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search animations" /></label>
      <div className="al-cats" role="tablist">{cats.map((c) => <button key={c} role="tab" aria-selected={cat === c} className={cat === c ? "on" : ""} onClick={() => setCat(c)}>{c}</button>)}</div>
      <div className="al-grid">
        {list.map((p) => <PresetCard key={p.id} preset={p} onApply={onApply} custom={p.category === "Custom"} />)}
        {!list.length && <p className="ae-help">No animations match "{q}".</p>}
      </div>
    </div>
  );
}

/* Editable controls for presets that are already on the layer. */
export function AppliedPresets({ layer, onChange, onRemove }) {
  const applied = layer.appliedPresets || {}, phases = [["in", "Entrance"], ["out", "Exit"], ["loop", "Continuous"]].filter(([k]) => applied[k]);
  if (!phases.length) return null;
  return (
    <div className="al-applied">
      {phases.map(([phase, label]) => {
        const a = applied[phase], preset = presetById(a.id);
        if (!preset) return null;
        const set = (patch) => onChange(preset, { ...a, ...patch });
        return (
          <div className="al-applied-card" key={phase}>
            <header><span><i>{label}</i><strong>{preset.name}</strong></span><button onClick={() => onRemove(phase)} aria-label={`Remove ${preset.name}`}><Trash2 size={13} /></button></header>
            <div className="al-controls">
              {phase !== "loop" && <label>Duration · {a.duration.toFixed(2)}s<input type="range" min="0.1" max="3" step="0.05" value={a.duration} onChange={(e) => set({ duration: Number(e.target.value) })} /></label>}
              {phase !== "loop" && <label>Delay · {a.delay.toFixed(2)}s<input type="range" min="0" max="3" step="0.05" value={a.delay} onChange={(e) => set({ delay: Number(e.target.value) })} /></label>}
              <label>Intensity · {Math.round(a.intensity * 100)}%<input type="range" min="0.2" max="2" step="0.05" value={a.intensity} onChange={(e) => set({ intensity: Number(e.target.value) })} /></label>
              {(preset.dir || preset.id === "rotate") && <label>Direction<select value={a.direction} onChange={(e) => set({ direction: e.target.value })}>{(preset.id === "rotate" ? ["Right", "Left"] : DIRECTIONS).map((d) => <option key={d}>{d}</option>)}</select></label>}
              {phase !== "loop" && <label>Easing<select value={a.ease || ""} onChange={(e) => set({ ease: e.target.value || null })}><option value="">Preset default</option>{EASING_OPTIONS.filter((x) => x !== "Hold").map((x) => <option key={x} value={x}>{EASING_LABELS[x]}</option>)}</select></label>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

const TEXT_MODES = [["none", "Whole"], ["word", "Word by word"], ["letter", "Letter by letter"], ["line", "Line by line"]];
const TEXT_EFFECTS = [["pop", "Pop"], ["rise", "Rise"], ["drop", "Drop"], ["bounce", "Bounce"], ["spin", "Spin"], ["fade", "Fade"]];
export function TextAnimationControls({ layer, onChange }) {
  const ta = layer.textAnim || { mode: "none" }, set = (patch) => onChange({ ...ta, effect: "pop", duration: 0.35, stagger: 0.08, delay: 0, ...ta, ...patch });
  return (
    <div className="al-text">
      <div className="ae-seg al-seg2">{TEXT_MODES.map(([id, label]) => <button key={id} className={(ta.mode || "none") === id ? "active" : ""} onClick={() => set({ mode: id })}>{label}</button>)}</div>
      {ta.mode && ta.mode !== "none" && <>
        <div className="ae-anim ae-anim-compact">{TEXT_EFFECTS.map(([id, label]) => <button key={id} className={(ta.effect || "pop") === id ? "active" : ""} onClick={() => set({ effect: id })}>{label}</button>)}</div>
        <label className="ae-sub-field"><span>Unit duration · {(ta.duration ?? 0.35).toFixed(2)}s</span><input type="range" min="0.1" max="1.5" step="0.05" value={ta.duration ?? 0.35} onChange={(e) => set({ duration: Number(e.target.value) })} /></label>
        <label className="ae-sub-field"><span>Stagger · {ta.fit ? "auto" : (ta.stagger ?? 0.08).toFixed(2) + "s"}</span><input type="range" min="0.02" max="0.6" step="0.01" disabled={!!ta.fit} value={ta.stagger ?? 0.08} onChange={(e) => set({ stagger: Number(e.target.value) })} /></label>
        <label className="ae-sub-field"><span>Delay · {(ta.delay ?? 0).toFixed(2)}s</span><input type="range" min="0" max="3" step="0.05" value={ta.delay ?? 0} onChange={(e) => set({ delay: Number(e.target.value) })} /></label>
        <label className="ae-switch"><input type="checkbox" checked={!!ta.fit} onChange={(e) => set({ fit: e.target.checked })} /><span>Spread across the layer's length (speech timing)</span></label>
        <label className="ae-switch"><input type="checkbox" checked={!!ta.highlight} onChange={(e) => set({ highlight: e.target.checked })} /><span>Highlight the active {ta.mode}</span></label>
        {ta.highlight && <label className="ae-sub-field"><span>Highlight color</span><input type="color" value={ta.highlightColor || "#ffe14d"} onChange={(e) => set({ highlightColor: e.target.value })} /></label>}
      </>}
    </div>
  );
}

export function SavePreset({ onSave }) {
  const [name, setName] = useState("");
  return (
    <div className="al-save">
      <input placeholder="Name this animation" value={name} onChange={(e) => setName(e.target.value)} aria-label="Preset name" />
      <button disabled={!name.trim()} onClick={() => { onSave(name.trim()); setName(""); }}><Bookmark size={13} /> Save preset</button>
    </div>
  );
}
