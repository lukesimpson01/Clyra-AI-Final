import React, { useEffect, useMemo, useRef, useState } from "react";
import { X, Play, Square, Scissors, Crop, RotateCcw, Gauge } from "lucide-react";
import { sfxById, soundDuration } from "./sfxLibrary.js";
import { sfxPeaks, previewClip, stopPreview, clipSegments } from "./sfxPlayback.js";
import { defaultSegments, totalOut, cutRange, keepRange, speedRange, isEdited, segOutDur } from "./soundEdit.js";

/* Sound editor for ONE timeline clip. Edits are stored on the clip (`segments`), never on the saved sound:
   editing "Fah" here leaves the "Fah" in the library untouched. With nothing selected, Speed applies to the whole sound. */
const fmt = (s) => `${s.toFixed(2)}s`;
const PRESETS = [0.5, 0.75, 1.25, 1.5, 2];

export default function SoundEditor({ layer, onChange, onClose }) {
  const entry = sfxById(layer.sfxId), segs = clipSegments(layer), speed = layer.speed || 1;
  const baseDur = entry ? soundDuration(entry) : 1, total = totalOut(segs), canvas = useRef(null), wrap = useRef(null);
  const [sel, setSel] = useState(null), [playing, setPlaying] = useState(false), [factor, setFactor] = useState(1.25), [w, setW] = useState(560);
  const drag = useRef(null);
  useEffect(() => { const el = wrap.current; if (!el) return; const ro = new ResizeObserver(() => setW(Math.floor(el.clientWidth))); ro.observe(el); setW(Math.floor(el.clientWidth)); return () => ro.disconnect(); }, []);
  useEffect(() => () => stopPreview(), []);
  const H = 150, peaks = useMemo(() => sfxPeaks(layer.sfxId, Math.max(40, Math.floor(w / 3)), segs), [layer.sfxId, JSON.stringify(segs), w]);
  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1; c.width = w * dpr; c.height = H * dpr;
    const ctx = c.getContext("2d"); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, H);
    const x = (t) => (t / total) * w;
    let acc = 0;
    segs.forEach((s, i) => { const d = segOutDur(s); if (Math.abs(s.rate - 1) > 0.01) { ctx.fillStyle = s.rate > 1 ? "rgba(238,138,69,.13)" : "rgba(69,104,238,.12)"; ctx.fillRect(x(acc), 0, x(d), H); ctx.fillStyle = s.rate > 1 ? "#d9722a" : "#4568ee"; ctx.font = "600 10px system-ui"; ctx.fillText(`${+s.rate.toFixed(2)}×`, x(acc) + 5, 13); } if (i > 0) { ctx.fillStyle = "#c3cbe0"; ctx.fillRect(x(acc) - 0.5, 0, 1, H); } acc += d; });
    ctx.fillStyle = "#c9d2e8"; ctx.fillRect(0, H / 2, w, 1);
    const bw = w / peaks.length; ctx.fillStyle = "#2fae75";
    peaks.forEach((p, i) => { const ph = Math.max(2, p * (H - 28)); ctx.fillRect(i * bw + 0.5, (H - ph) / 2, Math.max(1, bw - 1), ph); });
    if (sel) { ctx.fillStyle = "rgba(69,104,238,.2)"; ctx.fillRect(x(sel[0]), 0, x(sel[1]) - x(sel[0]), H); ctx.fillStyle = "#4568ee"; ctx.fillRect(x(sel[0]) - 1, 0, 2, H); ctx.fillRect(x(sel[1]) - 1, 0, 2, H); }
  }, [peaks, sel, w, total, JSON.stringify(segs)]);
  const tAt = (e) => { const r = canvas.current.getBoundingClientRect(); return Math.max(0, Math.min(total, ((e.clientX - r.left) / r.width) * total)); };
  const down = (e) => { const t = tAt(e), near = sel ? [0, 1].find((k) => Math.abs(sel[k] - t) < (total / w) * 7) : undefined; drag.current = near !== undefined ? { mode: "edge", k: near } : { mode: "new", t0: t, moved: false }; canvas.current.setPointerCapture(e.pointerId); };
  const move = (e) => {
    const d = drag.current; if (!d) return; const t = tAt(e);
    if (d.mode === "edge") setSel((s) => !s ? s : (d.k === 0 ? [Math.min(t, s[1] - 0.01), s[1]] : [s[0], Math.max(t, s[0] + 0.01)]));
    else { if (Math.abs(t - d.t0) > (total / w) * 3) d.moved = true; if (d.moved) setSel([Math.min(d.t0, t), Math.max(d.t0, t)]); }
  };
  const up = () => { const d = drag.current; drag.current = null; if (d?.mode === "new" && !d.moved) setSel(null); };
  const commit = (next) => { const nt = totalOut(next); onChange({ segments: next, duration: Math.max(0.05, nt / speed), sourceOffset: 0 }); setSel(null); stopPreview(); setPlaying(false); };
  const cut = () => sel && commit(cutRange(segs, sel[0], sel[1])), keep = () => sel && commit(keepRange(segs, sel[0], sel[1]));
  const applySpeed = () => commit(sel ? speedRange(segs, factor, sel[0], sel[1]) : speedRange(segs, factor));
  const reset = () => commit(defaultSegments(baseDur));
  const toggle = () => { if (playing) { stopPreview(); setPlaying(false); } else { setPlaying(true); previewClip({ ...layer, sourceOffset: 0 }, () => setPlaying(false)); } };
  useEffect(() => { const k = (e) => { if (e.key === "Escape") onClose(); if ((e.key === "Delete" || e.key === "Backspace") && sel && document.activeElement?.tagName !== "INPUT") { e.preventDefault(); cut(); } if (e.code === "Space" && document.activeElement?.tagName !== "INPUT") { e.preventDefault(); toggle(); } }; window.addEventListener("keydown", k, true); return () => window.removeEventListener("keydown", k, true); });
  const edited = isEdited(segs, baseDur);
  return (
    <div className="se-bg" onClick={onClose}>
      <div className="se" role="dialog" aria-label={`Edit sound ${layer.name}`} onClick={(e) => e.stopPropagation()}>
        <header><div><strong>Edit sound</strong><small>{layer.name} · {fmt(total / speed)}{edited ? " · edited" : ""}</small></div><button onClick={onClose} aria-label="Close sound editor"><X size={17} /></button></header>
        <p className="se-note">Edits apply to <b>this clip on the timeline only</b> — the saved sound in your library stays exactly as it was.</p>
        <div className="se-wave" ref={wrap}>
          <canvas ref={canvas} style={{ width: "100%", height: H }} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} aria-label="Waveform: drag to select a part" />
          <div className="se-ruler">{[0, 0.25, 0.5, 0.75, 1].map((k) => <span key={k}>{fmt((total / speed) * k)}</span>)}</div>
        </div>
        <div className="se-sel" role="status">{sel ? <>Selected <b>{fmt(sel[0] / speed)} – {fmt(sel[1] / speed)}</b> ({fmt((sel[1] - sel[0]) / speed)}) · drag the blue edges to adjust</> : <>Nothing selected — <b>actions apply to the whole sound</b>. Drag across the waveform to select a part.</>}</div>
        <div className="se-actions">
          <button className="primary" onClick={toggle}>{playing ? <Square size={13} fill="currentColor" /> : <Play size={13} fill="currentColor" />} {playing ? "Stop" : "Play"}</button>
          <button onClick={cut} disabled={!sel}><Scissors size={14} /> Cut out selection</button>
          <button onClick={keep} disabled={!sel}><Crop size={14} /> Keep only selection</button>
          <button onClick={reset} disabled={!edited}><RotateCcw size={14} /> Reset</button>
        </div>
        <div className="se-speed">
          <div className="se-speed-head"><Gauge size={14} /><strong>Speed</strong><span>{sel ? "applies to the selection" : "applies to the whole sound"}</span></div>
          <div className="se-speed-row">
            <input type="range" min="0.25" max="4" step="0.05" value={factor} onChange={(e) => setFactor(Number(e.target.value))} aria-label="Speed factor" />
            <output>{factor.toFixed(2)}×</output>
            <button className="primary" onClick={applySpeed}>Apply</button>
          </div>
          <div className="se-chips">{PRESETS.map((p) => <button key={p} className={Math.abs(p - factor) < 0.01 ? "on" : ""} onClick={() => setFactor(p)}>{p}×</button>)}</div>
          <small>Below 1× slows it down (and lowers the pitch); above 1× speeds it up. Stack as many edits as you like.</small>
        </div>
      </div>
    </div>
  );
}
