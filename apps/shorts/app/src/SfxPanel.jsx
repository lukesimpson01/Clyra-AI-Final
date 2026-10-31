import React, { useEffect, useMemo, useRef, useState } from "react";
import { Play, Square, Star, Plus, Search, Info, Trash2, Save, Upload, FileAudio, X, SlidersHorizontal } from "lucide-react";
import { SFX_CATEGORIES, SFX_COUNT, searchSfx, sfxSuggestions, sfxById, soundDuration, allSfx } from "./sfxLibrary.js";
import { previewSfx, stopPreview, sfxPeaks } from "./sfxPlayback.js";
import {ensureLoaded} from './soundStore.js';

const KEY = { fav: "frame-sfx-favorites", recent: "frame-sfx-recent", combos: "frame-sfx-combos" };
const read = (k, d) => { try { return JSON.parse(localStorage.getItem(k) || "null") ?? d; } catch { return d; } };
const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* quota: preference only */ } };
export const pushRecentSfx = (id) => write(KEY.recent, [id, ...read(KEY.recent, []).filter((x) => x !== id)].slice(0, 12));
export const loadCombos = () => read(KEY.combos, []);
export const saveCombo = (name, clips) => write(KEY.combos, [...loadCombos(), { id: "combo-" + Date.now().toString(36), name, clips }]);
export const deleteCombo = (id) => write(KEY.combos, loadCombos().filter((c) => c.id !== id));

/** Waveform of a clip. `segments` makes it show the edited result (cuts / speed) of that one clip. */
export function SfxWave({ id, segments = null, className = "ae-sfx-wave", buckets = 40, rev = 0 }) {
  const ref = useRef(null), segKey = segments ? JSON.stringify(segments) : "";
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const peaks = sfxPeaks(id, buckets, segments), ctx = c.getContext("2d"), w = c.width, h = c.height;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = getComputedStyle(c).color || "#2fae75";
    const bw = w / Math.max(1, peaks.length);
    peaks.forEach((p, i) => { const ph = Math.max(2, p * h); ctx.fillRect(i * bw + 0.5, (h - ph) / 2, Math.max(1, bw - 1.2), ph); });
  }, [id, segKey, buckets, rev]);
  return <canvas ref={ref} className={className} width="160" height="40" aria-hidden="true" />;
}

const durCache = new Map();
const dOf = (e) => { const k = e.id + (e.samples ? e.samples.length : ""); if (!durCache.has(k)) durCache.set(k, soundDuration(e) || 0); return durCache.get(k); };

/* Crayo-style compact sound row: ▷ name + length, tiny waveform, ★, edit (✎) and add. */
function SfxRow({ entry, playing, fav, onPlay, onFav, onAdd, onEdit, onReplace }) {
  const d = dOf(entry);
  return (
    <div className={"cs-row" + (playing ? " now" : "")} role="listitem" draggable onDragStart={(e) => { e.dataTransfer.setData("application/x-frame-sfx", entry.id); e.dataTransfer.effectAllowed = "copy"; }}>
      <button className="cs-play" onClick={onPlay} aria-label={playing ? `Stop ${entry.name}` : `Preview ${entry.name}`}>{playing ? <Square size={11} fill="currentColor" /> : <Play size={13} />}</button>
      <span className="cs-title"><strong>{entry.name}</strong><small>{d.toFixed(1)}s{entry.imported&&!entry.originalRecording?' · your file':' · source recording'} · {(entry.tags || []).slice(0, 3).join(", ")}</small></span>
      <SfxWave id={entry.id} className="cs-wave" rev={entry.samples ? entry.samples.length : 0} />
      <button className={"cs-icon" + (fav ? " on" : "")} onClick={onFav} aria-pressed={fav} aria-label={fav ? `Unfavourite ${entry.name}` : `Favourite ${entry.name}`}><Star size={13} fill={fav ? "currentColor" : "none"} /></button>
      {entry.group === "brainrot" && <button className="cs-icon" onClick={onReplace} title="Use my own file for this sound" aria-label={`Use my own file for ${entry.name}`}><Upload size={13} /></button>}
      <button className="cs-icon edit" onClick={onEdit} title="Edit this sound — cut, slow down, speed up (opens on a new timeline clip)" aria-label={`Edit ${entry.name}`}><SlidersHorizontal size={13} /></button>
      <button className="cs-add" onClick={onAdd} aria-label={`Add ${entry.name} to timeline`}><Plus size={14} /><span>Add</span></button>
    </div>
  );
}

export function SfxLibrary({ onAdd, onEdit, syncHint, combos, onInsertCombo, onDeleteCombo, onSaveCombo, canSaveCombo, onImportFiles, rev, importMsg }) {
  const [q, setQ] = useState(""), [onlyFav, setOnlyFav] = useState(false), [playing, setPlaying] = useState(null), [favs, setFavs] = useState(() => read(KEY.fav, []));
  const [comboName, setComboName] = useState(""), fileRef = useRef(null), slotRef = useRef(null), [error,setError]=useState(''),[busy,setBusy]=useState(false);
  useEffect(() => () => stopPreview(), []);
  const results = useMemo(() => searchSfx(q, { favorites: onlyFav ? favs : null }), [q, onlyFav, favs, rev]);
  const normal = results.filter((e) => e.group !== "brainrot" && e.category !== "My sounds"), brain = results.filter((e) => e.group === "brainrot"), mine = results.filter((e) => e.category === "My sounds");
  const suggestions = useMemo(() => (q.length < 1 ? ["whoosh", "boom", "razor", "pop", "fah", "typing"] : sfxSuggestions(q)), [q]);
  const toggleFav = (id) => setFavs((cur) => { const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]; write(KEY.fav, next); return next; });
  const load=async(id)=>{setError('');setBusy(true);const ready=await ensureLoaded(id);setBusy(false);if(!ready)setError(`Could not load ${sfxById(id)?.name??'this sound'}. Please retry.`);return ready;};
  const play = async(id) => { if (playing === id) { stopPreview(); setPlaying(null); } else if(await load(id)){ previewSfx(id, () => setPlaying((p) => (p === id ? null : p))); setPlaying(id); pushRecentSfx(id); } };
  const add = async(id) => { if(!await load(id))return;pushRecentSfx(id); onAdd(id); };
  const pick = (slot) => { slotRef.current = slot; fileRef.current?.click(); };
  const Section = ({ title, sub, items }) => items.length ? (
    <section className="cs-sec">
      <div className="cs-head"><h3>{title}</h3><small>{items.length} · {sub}</small></div>
      <div className="cs-list" role="list">{items.map((e) => <SfxRow key={e.id} entry={e} playing={playing === e.id} fav={favs.includes(e.id)} onPlay={() => play(e.id)} onFav={() => toggleFav(e.id)} onAdd={() => add(e.id)} onEdit={() => onEdit(e.id)} onReplace={() => pick(e.id)} />)}</div>
    </section>
  ) : null;
  return (
    <div className="cs-root">
      {error&&<p role="alert">{error}</p>}{busy&&<p role="status">Loading recording…</p>}
      <input ref={fileRef} type="file" accept="audio/*" multiple hidden onChange={(e) => { onImportFiles([...e.target.files], slotRef.current); slotRef.current = null; e.target.value = ""; }} />
      {syncHint && <div className="cs-sync">Pick a sound — it will be placed on <b>{syncHint}</b>'s animation.</div>}
      <div className="cs-top"><label className="cs-search"><Search size={14} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search sounds — razor, fah, boom…" aria-label="Search sound effects" />{q && <button aria-label="Clear" onClick={() => setQ("")}><X size={13} /></button>}</label>
        <button className={"cs-fav" + (onlyFav ? " on" : "")} onClick={() => setOnlyFav((v) => !v)} aria-pressed={onlyFav} title="Favourites only"><Star size={14} fill={onlyFav ? "currentColor" : "none"} /></button></div>
      <p className="cs-help">Click + to place at the playhead, or drag a row onto the timeline. ✎ opens the sound editor on a new clip.</p>
      <div className="cs-suggest">{suggestions.map((s) => <button key={s} onClick={() => setQ(s)}>{s}</button>)}</div>
      <Section title="Normal" sub="whooshes, hits, clicks" items={normal} />
      <Section title="Brainrot" sub="meme sounds" items={brain} />
      <Section title="My sounds" sub="your files" items={mine} />
      {!normal.length && !brain.length && !mine.length && <p className="cs-none">{onlyFav ? "Star a sound to find it here." : `No sounds match “${q}”.`}</p>}
      <div className="cs-import">
        <button onClick={() => pick(null)}><FileAudio size={14} /> Import audio files</button>
        <small>Drop several at once — names like “fah.mp3” replace the matching Brainrot sound. Stays on this device.</small>
        {importMsg && <small className="cs-msg" role="status">{importMsg}</small>}
      </div>
      <p className="cs-note"><Info size={12} /> {SFX_COUNT} source recordings. Preview and export use the same audio.</p>
      <details className="sx-combos">
        <summary>Sound combinations{combos.length ? ` · ${combos.length}` : ""}</summary>
        {combos.map((c) => <div key={c.id} className="sx-combo"><button onClick={() => onInsertCombo(c)}>{c.name} <small>{c.clips.length} sounds</small></button><button aria-label={`Delete ${c.name}`} onClick={() => onDeleteCombo(c.id)}><Trash2 size={12} /></button></div>)}
        <div className="sx-combo-save"><input placeholder="Name a combo from selected sounds" value={comboName} onChange={(e) => setComboName(e.target.value)} aria-label="Combination name" /><button disabled={!canSaveCombo || !comboName.trim()} onClick={() => { onSaveCombo(comboName.trim()); setComboName(""); }}><Save size={12} /> Save</button></div>
        {!canSaveCombo && <small className="ae-help">Select sound clips on the timeline (Shift-click) to save them as a combo.</small>}
      </details>
    </div>
  );
}
