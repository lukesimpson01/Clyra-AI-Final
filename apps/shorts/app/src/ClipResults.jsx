import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, Check, ChevronRight, Clapperboard, Copy, Download, Film, FolderOpen, Maximize2, Minimize2, Pause, Play, RefreshCw, SlidersHorizontal, Volume2, VolumeX, Wand2, X } from 'lucide-react';
import { hashtagLine } from './clipCopy.js';

/* The finished clips: a rail of every clip, the chosen one in a full-length player (scrubber, time, mute, fullscreen), and
   what goes with it in three tabs (the post, the score, the file) so the page never scrolls on a desktop screen. The
   clips are the clipper's own files, captions burned in, so the player shows the whole frame. */
const fileName = (output) => String(output).split(/[\\/]/).pop();
const mediaOf = (clip) => `/api/clipper/media/${encodeURIComponent(fileName(clip.output))}${clip._v ? `?v=${clip._v}` : ''}`;
const downloadOf = (clip) => `/api/clipper/download/${encodeURIComponent(fileName(clip.output))}`;
export const clipKey = (clip) => clip.id || clip.artifact_id || clip.output;
const stamp = (seconds) => { const s = Math.max(0, Math.floor(seconds || 0)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
/* what the clipper judged, in words people can act on */
const PARTS = { hook: 'Opening hook', context_independence: 'Stands on its own', speech_density: 'Speech density', clarity: 'Clarity', pacing: 'Pacing', query_relevance: 'Fits your moment' };
const scoreOf = (clip) => Math.round(clip.score ?? (clip.virality_score != null ? clip.virality_score * 10 : 0));
const tierOf = (score) => (score >= 80 ? ['Strong', 'high'] : score >= 62 ? ['Good', 'mid'] : ['Fair', 'low']);

function Gauge({ score }) {
  const [label, tone] = tierOf(score), r = 26, circ = 2 * Math.PI * r;
  return <div className={`acr-gauge is-${tone}`} role="img" aria-label={`Clip score ${score} out of 100, ${label}`}>
    <svg viewBox="0 0 64 64" aria-hidden><circle className="acr-gauge-track" cx="32" cy="32" r={r}/><circle className="acr-gauge-value" cx="32" cy="32" r={r} style={{ strokeDasharray: `${circ * score / 100} ${circ}` }}/></svg>
    <b>{score}</b>
  </div>;
}

/** The player: a custom bar over the video (play, a scrubber you can drag or arrow through, the time, mute, fullscreen). */
function Player({ clip }) {
  const box = useRef(null), video = useRef(null), track = useRef(null);
  const [playing, setPlaying] = useState(false), [time, setTime] = useState(0), [length, setLength] = useState(0), [muted, setMuted] = useState(false), [full, setFull] = useState(false), [drag, setDrag] = useState(false), [hover, setHover] = useState(null), [awake, setAwake] = useState(true);
  const wake = useRef(0);
  const src = mediaOf(clip);
  useEffect(() => { setPlaying(false); setTime(0); setLength(0); const v = video.current; if (v) { v.currentTime = 0; v.play().then(() => setPlaying(true)).catch(() => {}); } }, [src]);
  useEffect(() => { const on = () => setFull(document.fullscreenElement === box.current); document.addEventListener('fullscreenchange', on); return () => document.removeEventListener('fullscreenchange', on); }, []);
  const toggle = useCallback(() => { const v = video.current; if (!v) return; if (v.paused) void v.play().catch(() => {}); else v.pause(); }, []);
  const seekTo = useCallback((fraction) => { const v = video.current; if (v && length) { v.currentTime = Math.min(length, Math.max(0, fraction * length)); setTime(v.currentTime); } }, [length]);
  const fraction = (e) => { const rect = track.current.getBoundingClientRect(); return Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)); };
  const fullscreen = () => { if (document.fullscreenElement) void document.exitFullscreen(); else void box.current?.requestFullscreen?.(); };
  const poke = () => { setAwake(true); clearTimeout(wake.current); wake.current = setTimeout(() => setAwake(false), 2400); };
  useEffect(() => () => clearTimeout(wake.current), []);
  const onKey = (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    const v = video.current; if (!v) return;
    if (e.key === ' ' || e.key === 'k') { e.preventDefault(); toggle(); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); v.currentTime = Math.max(0, v.currentTime - 5); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); v.currentTime = Math.min(length, v.currentTime + 5); }
    else if (e.key === 'm') setMuted((m) => !m);
    else if (e.key === 'f') fullscreen();
    else return;
    poke();
  };
  const shown = drag || hover != null ? (hover ?? time / (length || 1)) : null;
  return <div ref={box} className={`acr-player${full ? ' is-full' : ''}${awake || !playing || drag ? ' is-awake' : ''}`} tabIndex={0} onKeyDown={onKey} onMouseMove={poke} onMouseLeave={() => setAwake(false)} aria-label="Clip player">
    <video ref={video} key={src} src={src} muted={muted} playsInline preload="auto" onClick={toggle} onDoubleClick={fullscreen}
      onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)}
      onLoadedMetadata={(e) => setLength(e.currentTarget.duration || 0)} onTimeUpdate={(e) => { if (!drag) setTime(e.currentTarget.currentTime); }}/>
    {!playing && <button type="button" className="acr-bigplay" aria-label="Play" onClick={toggle}><Play size={26} fill="currentColor"/></button>}
    <div className="acr-controls">
      <div ref={track} className={`acr-scrub${drag ? ' is-drag' : ''}`} role="slider" tabIndex={0} aria-label="Seek" aria-valuemin={0} aria-valuemax={Math.round(length)} aria-valuenow={Math.round(time)} aria-valuetext={`${stamp(time)} of ${stamp(length)}`}
        onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); setDrag(true); const f = fraction(e); setTime(f * length); seekTo(f); }}
        onPointerMove={(e) => { const f = fraction(e); setHover(f); if (drag) { setTime(f * length); seekTo(f); } }}
        onPointerUp={() => setDrag(false)} onPointerLeave={() => setHover(null)}
        onKeyDown={(e) => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.stopPropagation(); e.preventDefault(); const v = video.current; v.currentTime = Math.min(length, Math.max(0, v.currentTime + (e.key === 'ArrowLeft' ? -2 : 2))); } }}>
        <span className="acr-scrub-rail"><i style={{ width: `${length ? time / length * 100 : 0}%` }}/><b style={{ left: `${length ? time / length * 100 : 0}%` }}/></span>
        {shown != null && <em style={{ left: `${shown * 100}%` }}>{stamp(shown * length)}</em>}
      </div>
      <div className="acr-bar">
        <button type="button" aria-label={playing ? 'Pause' : 'Play'} onClick={toggle}>{playing ? <Pause size={17} fill="currentColor"/> : <Play size={17} fill="currentColor"/>}</button>
        <span className="acr-time">{stamp(time)} <small>/ {stamp(length)}</small></span><span className="acr-gap"/>
        <button type="button" aria-label={muted ? 'Unmute' : 'Mute'} aria-pressed={muted} onClick={() => setMuted((m) => !m)}>{muted ? <VolumeX size={17}/> : <Volume2 size={17}/>}</button>
        <button type="button" aria-label={full ? 'Exit fullscreen' : 'Fullscreen'} onClick={fullscreen}>{full ? <Minimize2 size={16}/> : <Maximize2 size={16}/>}</button>
      </div>
    </div>
  </div>;
}

function CopyRow({ label, text, multiline, onCopy, copied }) {
  return <div className="acr-field">
    <div className="acr-field-head"><span>{label}</span><button type="button" onClick={() => onCopy(text, label)} aria-label={`Copy ${label.toLowerCase()}`}>{copied === label ? <><Check size={12}/>Copied</> : <><Copy size={12}/>Copy</>}</button></div>
    <p className={multiline ? 'is-long' : ''}>{text}</p>
  </div>;
}

export default function ClipResults({ clips, copies, titleOf, sourceTitle, momentText, error, setError, onAdjust, onAgain, onEditor, onProjects, onRewrite }) {
  const ordered = [...clips].sort((a, b) => scoreOf(b) - scoreOf(a));
  const [pick, setPick] = useState(() => ordered[0] ? clipKey(ordered[0]) : null);
  const [tab, setTab] = useState('post');
  const [copied, setCopied] = useState('');
  const clip = ordered.find((c) => clipKey(c) === pick) ?? ordered[0];
  useEffect(() => { if (clip && clipKey(clip) !== pick) setPick(clipKey(clip)); }, [clip, pick]);
  const copy = async (text, key) => { try { await navigator.clipboard.writeText(text); setCopied(key); setTimeout(() => setCopied(''), 1400); } catch { /* the clipboard refused */ } };
  const header = <header className="acp-top"><button type="button" className="acp-back" aria-label="Back to settings" onClick={onAdjust}><ArrowLeft size={17}/></button><div><h2>{clips.length ? `${clips.length} clip${clips.length === 1 ? '' : 's'} ready` : 'No clips this time'}</h2><small>From {sourceTitle} · {momentText}</small></div><button type="button" className="ftl-btn" onClick={onAdjust}><SlidersHorizontal size={14}/> Adjust settings</button><button type="button" className="sw-next acp-cta" onClick={onAgain}><Wand2 size={15}/> Generate again</button></header>;
  if (!clip) return <>{header}<div className="acp-empty"><Film size={28}/><p>The clipper finished without a clip for these settings. Try another moment, a longer length or the whole video.</p><button type="button" className="sw-next" onClick={onAdjust}>Change settings</button></div></>;

  const copy1 = copies[clipKey(clip)], score = scoreOf(clip), [tierName, tone] = tierOf(score);
  const parts = Object.entries(clip.score_breakdown || {}).filter(([k, v]) => PARTS[k] && v?.max).map(([k, v]) => ({ key: k, label: PARTS[k], score: v.score, max: v.max }));
  const note = String(clip.reason || '').replace(/^\s*\d+\s*[-–—:]+\s*/, '').replace(/\s*Timeline evidence:.*$/is, '').trim();
  const all = copy1 ? `${copy1.title}\n\n${copy1.caption}\n\n${hashtagLine(copy1)}` : '';
  return <>
    {header}
    {error && <div className="ftl-error" role="alert"><span>{error}</span><button type="button" aria-label="Dismiss" onClick={() => setError('')}><X size={14}/></button></div>}
    <div className="acr">
      <nav className="acr-rail" aria-label="Clips">
        {ordered.map((c, i) => { const on = clipKey(c) === clipKey(clip), s = scoreOf(c); return <button key={clipKey(c)} type="button" aria-current={on ? 'true' : undefined} className={on ? 'active' : ''} onClick={() => setPick(clipKey(c))}>
          <span className="acr-thumb"><video src={`${mediaOf(c)}#t=0.8`} muted playsInline preload="metadata"/><small>{c.clip_duration}</small></span>
          <span className="acr-rail-text"><b>{copies[clipKey(c)]?.title || titleOf(c, i)}</b><small>{c.source_start && c.source_end ? `${c.source_start} – ${c.source_end}` : `Clip ${i + 1}`}</small></span>
          <span className={`acr-chip is-${tierOf(s)[1]}`}>{s}</span>
        </button>; })}
      </nav>
      <section className="acr-stage" aria-label="Preview"><Player clip={clip}/></section>
      <div className="acr-side" role="complementary" aria-label="Clip details">
        <div className="acr-tabs" role="tablist">{[['post', 'Post'], ['score', 'Score'], ['file', 'Export']].map(([k, n]) => <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? 'active' : ''} onClick={() => setTab(k)}>{n}</button>)}</div>
        <div className="acr-pane" role="tabpanel" key={`${tab}-${clipKey(clip)}`}>
          {tab === 'post' && (copy1 ? <>
            <CopyRow label="Title" text={copy1.title} onCopy={copy} copied={copied}/>
            <CopyRow label="Caption" text={copy1.caption} multiline onCopy={copy} copied={copied}/>
            <div className="acr-field"><div className="acr-field-head"><span>Hashtags</span><button type="button" onClick={() => copy(hashtagLine(copy1), 'Hashtags')}>{copied === 'Hashtags' ? <><Check size={12}/>Copied</> : <><Copy size={12}/>Copy</>}</button></div>
              <div className="acr-tags">{copy1.hashtags.map((t) => <span key={t}>#{t}</span>)}</div></div>
            <div className="acr-actions"><button type="button" className="ftl-btn primary" onClick={() => copy(all, 'all')}>{copied === 'all' ? <><Check size={14}/>Copied</> : <><Copy size={14}/>Copy everything</>}</button><button type="button" className="ftl-btn" onClick={() => onRewrite(clip)} title="Write a different version"><RefreshCw size={14}/>Rewrite</button></div>
            <p className="acr-note">{copy1.source === 'ai' ? 'Written from what is said in this clip and the video it came from.' : 'Built from the clip’s own words. Rewrite to try the AI version.'}</p>
          </> : <div className="acr-writing" role="status"><span className="acp-shimmer-text">Writing the title, caption and hashtags…</span><i/><i/><i/></div>)}
          {tab === 'score' && <>
            <div className="acr-score"><Gauge score={score}/><div><b>{tierName} clip</b><small>Clip potential out of 100: how well it works on its own, not a promise of views.</small></div></div>
            {parts.length ? <ul className="acr-parts">{parts.map((p) => <li key={p.key}><span>{p.label}</span><i className={`is-${tone}`}><b style={{ width: `${p.score / p.max * 100}%` }}/></i><em>{p.score}<small>/{p.max}</small></em></li>)}</ul> : null}
            {note && <p className="acr-note acr-reason">{note}</p>}
            <dl className="acr-facts"><div><dt>Length</dt><dd>{clip.clip_duration}</dd></div>{clip.source_start && <div><dt>In the video</dt><dd>{clip.source_start} – {clip.source_end}</dd></div>}{clip.output_quality && <div><dt>Quality</dt><dd>{clip.output_quality}</dd></div>}</dl>
          </>}
          {tab === 'file' && <>
            <a className="acr-export" href={downloadOf(clip)} download><span><Download size={18}/></span><div><b>Download MP4</b><small>{clip.output_quality || '1080 × 1920'} with the captions in</small></div><ChevronRight size={16}/></a>
            <button type="button" className="acr-export" onClick={() => onEditor?.(clip)}><span><Clapperboard size={18}/></span><div><b>Open in the advanced editor</b><small>Trim, restyle the captions, add music and effects</small></div><ChevronRight size={16}/></button>
            <button type="button" className="acr-export" onClick={onProjects}><span><FolderOpen size={18}/></span><div><b>Find it in Projects</b><small>Every clip is saved there automatically</small></div><ChevronRight size={16}/></button>
          </>}
        </div>
      </div>
    </div>
  </>;
}
