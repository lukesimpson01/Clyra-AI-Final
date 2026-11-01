import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronRight, Cloud, Film, Link2, RotateCcw, X } from 'lucide-react';
import './story-wizard.css';
import './fake-text-workspace.css';
import './autoclip-studio-v3.css';

/* The AI clipper's first step, as a page of its own: a link and a drop zone together. Once a video is chosen it shows
   where the drop zone was (a link's picture, title and length; a file's own player), and anything longer than an hour
   asks for the hour to clip from on a mini timeline with a graph of where it matters. */
const STEPS = ['Source', 'Moments', 'Captions', 'Framing', 'Generate'];
const LIMIT = 3600;
function YoutubeMark({ size = 20 }) { return <svg width={size} height={size * 0.75} viewBox="0 0 24 18" aria-hidden="true"><rect width="24" height="18" rx="5" fill="#ff0033"/><path d="M10 4.7v8.6l7-4.3-7-4.3Z" fill="#fff"/></svg>; }
function youtubeVideoId(url) {
  try {
    const parsed = new URL(url.trim());
    if (!['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be'].includes(parsed.hostname) || parsed.protocol !== 'https:') return null;
    const id = parsed.hostname === 'youtu.be' ? parsed.pathname.slice(1).split('/')[0] : parsed.searchParams.get('v') || parsed.pathname.match(/^\/(?:shorts|live|embed)\/([^/]+)/)?.[1];
    return /^[A-Za-z0-9_-]{11}$/.test(id || '') ? id : null;
  } catch { return null; }
}
const bytes = (n) => (n > 1e9 ? `${(n / 1e9).toFixed(1)} GB` : `${Math.max(1, Math.round(n / 1e6))} MB`);
export const clock = (s) => { s = Math.max(0, Math.round(s)); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60; return h ? `${h}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}` : `${m}:${String(x).padStart(2, '0')}`; };

/** A file's look along its length, cheaply: a few small frames (the strip) and how much changes between them (the graph). */
function useFileTimeline(url, duration) {
  const [state, setState] = useState({ frames: [], activity: [] });
  useEffect(() => {
    if (!url || !(duration > LIMIT)) { setState({ frames: [], activity: [] }); return undefined; }
    let live = true; const v = document.createElement('video'); v.muted = true; v.preload = 'auto'; v.src = url;
    const c = document.createElement('canvas'); c.width = 64; c.height = 36; const g = c.getContext('2d', { willReadFrequently: true });
    const n = 28, frames = [], activity = []; let last = null;
    const seek = (t) => new Promise((done) => { const on = () => { v.removeEventListener('seeked', on); done(); }; v.addEventListener('seeked', on); v.currentTime = t; setTimeout(on, 2500); });
    (async () => {
      await new Promise((r) => { v.onloadeddata = r; v.onerror = r; setTimeout(r, 4000); });
      for (let i = 0; i < n && live; i++) {
        await seek((i + 0.5) * duration / n);
        g.drawImage(v, 0, 0, 64, 36);
        const px = g.getImageData(0, 0, 64, 36).data; let diff = 0;
        if (last) for (let j = 0; j < px.length; j += 16) diff += Math.abs(px[j] - last[j]) + Math.abs(px[j + 1] - last[j + 1]);
        last = px; activity.push(diff); if (i % 4 === 0) frames.push(c.toDataURL('image/jpeg', 0.6));
        if (live) setState({ frames: [...frames], activity: [...activity] });
      }
    })();
    return () => { live = false; v.removeAttribute('src'); v.load(); };
  }, [url, duration]);
  return state;
}

/** Pick up to an hour of a long video: a window dragged over its timeline, its two ends trimmed, the graph behind. */
function RangePicker({ duration, value, onChange, graph, frames, onSeek }) {
  const bar = useRef(null), drag = useRef(null);
  const at = (x) => { const r = bar.current.getBoundingClientRect(); return Math.min(duration, Math.max(0, (x - r.left) / r.width * duration)); };
  const move = (e) => {
    const d = drag.current; if (!d) return;
    const t = at(e.clientX); let { start, end } = value;
    if (d.part === 'start') start = Math.min(Math.max(t, end - LIMIT), end - 60);
    else if (d.part === 'end') end = Math.max(Math.min(t, start + LIMIT), start + 60);
    else { const len = d.end - d.start, s = Math.min(Math.max(0, d.start + t - d.t), duration - len); start = s; end = s + len; }
    onChange({ start: Math.max(0, start), end: Math.min(duration, end) }); onSeek?.(d.part === 'end' ? end : start);
  };
  const up = () => { drag.current = null; window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
  const down = (part) => (e) => { e.preventDefault(); drag.current = { part, t: at(e.clientX), ...value }; window.addEventListener('pointermove', move); window.addEventListener('pointerup', up); };
  const max = Math.max(1e-6, ...graph);
  const pct = (t) => `${t / duration * 100}%`;
  return <div className="acp-range">
    <div className="acp-range-head"><strong>Pick up to an hour to clip from</strong><span>{clock(value.start)} – {clock(value.end)} · {clock(value.end - value.start)}</span></div>
    <div className="acp-range-bar" ref={bar} onPointerDown={(e) => { if (e.target === bar.current) { const t = at(e.clientX), len = value.end - value.start, s = Math.min(Math.max(0, t - len / 2), duration - len); onChange({ start: s, end: s + len }); onSeek?.(s); } }}>
      {frames.length > 0 && <div className="acp-range-frames">{frames.map((f, i) => <img key={i} src={f} alt=""/>)}</div>}
      {graph.length > 0 && <svg className="acp-range-graph" viewBox={`0 0 ${graph.length} 100`} preserveAspectRatio="none" aria-hidden><path d={`M0 100 ${graph.map((v, i) => `L${i + 0.5} ${100 - v / max * 88}`).join(' ')} L${graph.length} 100Z`}/></svg>}
      <div className="acp-range-window" style={{ left: pct(value.start), width: pct(value.end - value.start) }} onPointerDown={down('move')}>
        <span className="acp-range-handle start" onPointerDown={(e) => { e.stopPropagation(); down('start')(e); }} role="slider" aria-label="Start of the part" aria-valuemin={0} aria-valuemax={duration} aria-valuenow={Math.round(value.start)} tabIndex={0} onKeyDown={(e) => { const d = e.key === 'ArrowLeft' ? -10 : e.key === 'ArrowRight' ? 10 : 0; if (d) onChange({ ...value, start: Math.min(Math.max(0, value.start + d, value.end - LIMIT), value.end - 60) }); }}/>
        <span className="acp-range-handle end" onPointerDown={(e) => { e.stopPropagation(); down('end')(e); }} role="slider" aria-label="End of the part" aria-valuemin={0} aria-valuemax={duration} aria-valuenow={Math.round(value.end)} tabIndex={0} onKeyDown={(e) => { const d = e.key === 'ArrowLeft' ? -10 : e.key === 'ArrowRight' ? 10 : 0; if (d) onChange({ ...value, end: Math.max(Math.min(duration, value.end + d, value.start + LIMIT), value.start + 60) }); }}/>
      </div>
    </div>
    <div className="acp-range-ticks">{Array.from({ length: 5 }, (_, i) => <span key={i}>{clock(duration * i / 4)}</span>)}</div>
    <p className="acp-muted">{graph.length ? (frames.length ? 'The graph shows where the picture changes most.' : 'The graph is where viewers rewatch most.') : ''} Drag the window, or its ends, to choose.</p>
  </div>;
}

/** `prefill`: { url, moment, count, length } from the brainstormer: the link is entered, read, and the studio opens with the
 *  moment already typed. */
export default function AutoClipSourcePage({ onFile, prefill = null }) {
  const [url, setUrl] = useState(prefill?.url || ''), [file, setFile] = useState(null), [over, setOver] = useState(false), [playing, setPlaying] = useState(false);
  const [probe, setProbe] = useState(null), [probing, setProbing] = useState(false), [probeError, setProbeError] = useState('');
  const [fileUrl, setFileUrl] = useState(null), [fileDuration, setFileDuration] = useState(0), [range, setRange] = useState(null);
  const input = useRef(null), player = useRef(null), id = youtubeVideoId(url);
  useEffect(() => { if (!file) { setFileUrl(null); setFileDuration(0); return undefined; } const u = URL.createObjectURL(file); setFileUrl(u); return () => URL.revokeObjectURL(u); }, [file]);
  /* a link is read once it is a valid one: its title, length and replay graph */
  useEffect(() => {
    setProbe(null); setProbeError(''); setPlaying(false);
    if (!id) return undefined;
    const ctl = new AbortController(); setProbing(true);
    fetch('/api/clipper/probe', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url: url.trim() }), signal: ctl.signal })
      .then(async (r) => { const b = await r.json().catch(() => ({})); if (!r.ok) throw new Error(b.error || 'This video could not be read'); setProbe(b); })
      .catch((e) => { if (e?.name !== 'AbortError') setProbeError(e.message); })
      .finally(() => { if (!ctl.signal.aborted) setProbing(false); });
    return () => ctl.abort();
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  const duration = file ? fileDuration : probe?.duration || 0;
  const long = duration > LIMIT;
  useEffect(() => { setRange(long ? { start: 0, end: LIMIT } : null); }, [long, file, id]);
  const strip = useFileTimeline(file ? fileUrl : null, file ? fileDuration : 0);
  const graph = file ? strip.activity : probe?.heatmap || [];
  const chosen = !!file || !!id;
  const ready = chosen && !probing && (!!file || !!probe || !!probeError) && (!long || (range && range.end - range.start <= LIMIT + 1));
  const meta = useMemo(() => ({ title: file ? file.name.replace(/\.[a-z0-9]{2,4}$/i, '') : probe?.title || '', channel: probe?.channel || '', duration, thumbnail: probe?.thumbnail || (id ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : ''), range: long ? range : null }), [file, probe, duration, id, long, range]);
  const go = () => {
    if (!ready) return;
    if (file) { file.meta = meta; onFile(file); return; }
    onFile({ name: probe?.title || url.trim(), type: 'youtube-link', url: url.trim(), meta, ...(prefill ? { handoff: prefill } : {}) });
  };
  const sent = useRef(false);
  useEffect(() => { if (prefill?.url && ready && (probe || probeError) && !sent.current) { sent.current = true; go(); } }, [ready, probe, probeError]); // eslint-disable-line react-hooks/exhaustive-deps
  const pick = (f) => { if (f && /^video\//.test(f.type || 'video/')) { setFile(f); setUrl(''); } };
  const clear = () => { setFile(null); setUrl(''); setProbe(null); setProbeError(''); };

  return <div className="ftl-root acp-root">
    <div className="sw-steps ftl-steps"><div>{STEPS.map((item, i) => <React.Fragment key={item}><button type="button" className={i === 0 ? 'active' : ''} aria-current={i === 0 ? 'step' : undefined} disabled={i > 0 && !ready} onClick={() => (i > 0 ? go() : undefined)}><b>{i + 1}</b><span>{item}</span></button>{i < STEPS.length - 1 && <ChevronRight size={16}/>}</React.Fragment>)}</div>
      <button type="button" className="sw-next" disabled={!ready} onClick={go}>Next <ChevronRight size={15}/></button></div>
    <section className="ftl-editor acp-source">
      <div className="acp-source-inner">
        <header className="acp-source-title"><h2>Add your video</h2><p>Paste a link or drop a file. Clyra finds the best moments, frames them and captions them.</p></header>
        <label className={`ftl-message-pill acp-prompt acp-link ${file ? 'muted' : ''}`}><YoutubeMark size={18}/><input type="url" aria-label="Video link" placeholder="Paste a YouTube link: https://www.youtube.com/watch?v=…" value={url} onChange={(e) => { setUrl(e.target.value); if (e.target.value) setFile(null); }} onKeyDown={(e) => { if (e.key === 'Enter') go(); }}/>{url && <button type="button" className="acp-icon" aria-label="Clear link" onClick={() => setUrl('')}><X size={13}/></button>}</label>
        {url && !id && <p className="acp-muted acp-warn" role="alert">That isn’t a YouTube video link. Paste a youtube.com, youtu.be or Shorts link.</p>}
        <div className="acp-or"><span>or</span></div>
        <input ref={input} type="file" accept="video/*" hidden onChange={(e) => pick(e.target.files?.[0] || null)}/>
        {!chosen ? <button type="button" className={`ftl-upload acp-drop ${over ? 'over' : ''}`} onClick={() => input.current?.click()} onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={(e) => { e.preventDefault(); setOver(false); pick(e.dataTransfer.files?.[0] || null); }}>
          <span className="acp-drop-icon"><Cloud size={22}/></span><strong>Drop a video here, or click to browse</strong><small>.mp4, .mov, .webm or .mkv · up to 4 GB · an hour at a time</small></button>
          : <div className="acp-chosen" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); pick(e.dataTransfer.files?.[0] || null); }}>
            <div className="acp-chosen-media">{file ? <video ref={player} src={fileUrl || undefined} controls playsInline onLoadedMetadata={(e) => setFileDuration(e.currentTarget.duration || 0)}/>
              : playing ? <iframe title="Selected YouTube video" src={`https://www.youtube-nocookie.com/embed/${id}?rel=0&autoplay=1${range ? `&start=${Math.floor(range.start)}` : ''}`} allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" referrerPolicy="strict-origin-when-cross-origin" allowFullScreen/>
              : <button type="button" className="acp-poster" aria-label="Play the video" onClick={() => setPlaying(true)}><img src={probe?.thumbnail || `https://i.ytimg.com/vi/${id}/hqdefault.jpg`} alt="" onError={(e) => { if (!e.currentTarget.src.includes('hqdefault')) e.currentTarget.src = `https://i.ytimg.com/vi/${id}/hqdefault.jpg`; }}/><span><YoutubeMark size={44}/></span></button>}</div>
            <div className="acp-chosen-info">
              {file ? <><Film size={16}/><div><strong title={file.name}>{file.name}</strong><small>{bytes(file.size)}{fileDuration ? ` · ${clock(fileDuration)}` : ''}</small></div></>
                : <><Link2 size={16}/><div>{probing ? <><strong className="acp-shimmer-text">Reading the video…</strong><small>Its title and length</small></> : probe ? <><strong title={probe.title}>{probe.title}</strong><small>{probe.channel ? `${probe.channel} · ` : ''}{clock(probe.duration)}</small></> : <><strong>YouTube video</strong><small>{probeError || 'Ready to clip'}</small></>}</div></>}
              <button type="button" className="ftl-btn" onClick={clear}><RotateCcw size={12}/> Change</button>
            </div>
            {long && range && <RangePicker duration={duration} value={range} onChange={setRange} graph={graph} frames={file ? strip.frames : []} onSeek={(t) => { if (player.current) player.current.currentTime = t; }}/>}
            <div className="acp-chosen-go">{long && <span className="acp-muted">{clock(duration)} is longer than an hour: clips come from the part you pick.</span>}<button type="button" className="sw-next acp-cta" disabled={!ready} onClick={go}>Continue <ChevronRight size={15}/></button></div>
          </div>}
      </div>
    </section>
  </div>;
}
