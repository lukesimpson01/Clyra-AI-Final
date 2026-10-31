import React, { useEffect, useMemo, useState } from "react";
import { Play, Pause, Plus, Search, Upload, X, Loader2, Copy, Check, RotateCcw } from "lucide-react";
import { ALL_MUSIC, MUSIC_SECTIONS, searchMusic } from "./musicLibrary.js";
import { sfxById } from "./sfxLibrary.js";
import { previewSfx, stopPreview, previewProgress } from "./sfxPlayback.js";
import { ensureLoaded } from "./soundStore.js";
import { TRENDING_SOUNDS, TRENDING_AS_OF, TRENDING_SOURCES, soundSearchLinks } from "./trendingSounds.js";

const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

/* Crayo-style music list: compact bordered rows — ▷ title + length — with "View more ›" per section. */
export default function MusicBrowser({ onAdd, onUpload, uploaded, onRemoveUpload, onImportFile, rev }) {
  const [q, setQ] = useState(""), [now, setNow] = useState(null), [prog, setProg] = useState(null), [busy, setBusy] = useState(null), [openAll, setOpenAll] = useState({}), [credit, setCredit] = useState(null), [copied, setCopied] = useState(false);
  const fileRef = React.useRef(null), slotRef = React.useRef(null), [error,setError]=useState('');
  useEffect(() => () => stopPreview(), []);
  useEffect(() => { if (!now) { setProg(null); return; } let id; const tick = () => { setProg(previewProgress()); id = requestAnimationFrame(tick); }; id = requestAnimationFrame(tick); return () => cancelAnimationFrame(id); }, [now]);
  const list = useMemo(() => searchMusic(q, "All"), [q, rev]);
  const sections = useMemo(() => MUSIC_SECTIONS.map((s) => ({ ...s, items: list.filter((m) => m.section === s.id) })).filter((s) => s.items.length), [list]);
  const live = (m) => sfxById(m.id) || m;
  const load = async(m)=>{setError('');setBusy(m.id);const ready=await ensureLoaded(m.id);setBusy(null);if(!ready)setError(`Could not load ${m.title}. Please retry.`);return ready;};
  const play = async (m) => { if (now === m.id) { stopPreview(); setNow(null); return; } if(!await load(m))return;previewSfx(m.id, () => setNow((n) => (n === m.id ? null : n))); setNow(m.id); };
  const add = async (m) => { if(await load(m))onAdd(m.id); };
  const copyCredit = (m) => { try { navigator.clipboard?.writeText(m.attribution); } catch { /* blocked */ } setCopied(true); setTimeout(() => setCopied(false), 1500); };
  const cur = now ? ALL_MUSIC.find((m) => m.id === now) : null;
  return (
    <div className="cm-root">
      <input ref={fileRef} type="file" accept="audio/*" hidden onChange={(e) => { const f = e.target.files?.[0], id = slotRef.current; if (f && id) onImportFile(f, id); slotRef.current = null; e.target.value = ""; }} />
      <h2>Music</h2>
      {error&&<p role="alert">{error}</p>}
      <div className="cm-actions"><button className="blue" onClick={() => setOpenAll(Object.fromEntries(MUSIC_SECTIONS.map((s) => [s.id, true])))}>Browse all</button><button onClick={onUpload}><Upload size={15} /> Upload a file</button></div>
      <label className="cm-search"><Search size={14} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search music" aria-label="Search music" />{q && <button aria-label="Clear" onClick={() => setQ("")}><X size={13} /></button>}</label>
      {uploaded && <div className="cm-row mine"><span className="cm-play" aria-hidden="true"><Upload size={13} /></span><span className="cm-title"><strong>{uploaded}</strong><small>Your upload</small></span><button className="cm-icon" onClick={onRemoveUpload} aria-label="Remove uploaded track"><X size={14} /></button></div>}
      {sections.map((s) => {
        const all = !!openAll[s.id] || !!q, items = all ? s.items : s.items.slice(0, 4);
        return (
          <section className="cm-sec" key={s.id}>
            <div className="cm-head"><h3>{s.title}</h3>{s.items.length > 4 && !q && <button onClick={() => setOpenAll((o) => ({ ...o, [s.id]: !o[s.id] }))}>{all ? "Show less" : "View more ›"}</button>}</div>
            {s.items.some((m) => m.take) && <p className="cm-sub">{s.sub}</p>}
            {items.map((m) => {
              const isNow = now === m.id, loading = busy === m.id, e = live(m);
              return (
                <div className={"cm-row" + (isNow ? " now" : "")} key={m.id}>
                  <button className="cm-play" onClick={() => play(m)} aria-label={`${isNow ? "Stop" : "Preview"} ${m.title}`}>{loading ? <Loader2 size={14} className="spin" /> : isNow ? <Pause size={14} fill="currentColor" /> : <Play size={14} />}</button>
                  <span className="cm-title"><strong>{m.title}</strong><small>{m.artist}{e.replaced&&!e.recording ? " · your copy" : ""} · {mmss(e.dur || m.dur)}</small></span>
                  {m.bundled && <button className="cm-chip" onClick={() => setCredit(credit === m.id ? null : m.id)} aria-expanded={credit === m.id}>CC BY</button>}
                  {m.take && <button className="cm-icon" onClick={() => { slotRef.current = m.id; fileRef.current?.click(); }} aria-label={`Use my own copy of ${m.title}`} title="Use my own licensed copy"><Upload size={13} /></button>}
                  <button className="cm-add" onClick={() => add(m)} disabled={loading} aria-label={`Add ${m.title} to timeline`}><Plus size={14} /><span>Add</span></button>
                  {credit === m.id && <div className="cm-credit"><pre>{m.attribution}</pre><button onClick={() => copyCredit(m)}>{copied ? <><Check size={12} /> Copied</> : <><Copy size={12} /> Copy credit</>}</button><small>CC BY 4.0 — credit in your video description.</small></div>}
                </div>
              );
            })}
          </section>
        );
      })}
      {!sections.length && <p className="cm-none">No music matches “{q}”.</p>}
      <details className="cm-trend">
        <summary>Trending on TikTok <small>{TRENDING_AS_OF}</small></summary>
        <p>Editorial picks, not usage data. Copyrighted songs aren't downloaded — open the sound, then import a copy you have rights to.</p>
        {TRENDING_SOUNDS.map((s) => { const l = soundSearchLinks(s); return <div className="cm-trow" key={s.title}><span><strong>{s.title}</strong><small>{s.by}</small></span><span><a href={l.tiktok} target="_blank" rel="noreferrer">TikTok</a><a href={l.youtube} target="_blank" rel="noreferrer">YouTube</a></span></div>; })}
        <div className="cm-src">{TRENDING_SOURCES.map(([n, u]) => <a key={u} href={u} target="_blank" rel="noreferrer">{n}</a>)}</div>
      </details>
      <p className="cm-foot">Source recordings. Kevin MacLeod tracks: CC BY 4.0. Other recordings retain their original rights.</p>
      {cur && prog && <div className="cm-now" role="status"><button onClick={() => { stopPreview(); setNow(null); }} aria-label="Stop preview"><Pause size={14} fill="currentColor" /></button><span><strong>{cur.title}</strong><i><b style={{ width: `${(prog.t / prog.dur) * 100}%` }} /></i></span><small>{mmss(prog.t)}</small><button className="add" onClick={() => add(cur)}><Plus size={13} /> Add</button></div>}
    </div>
  );
}
