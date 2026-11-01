import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, CheckCircle2, Download, FileVideo, Film, LoaderCircle, Music, Plus, RotateCcw, Trash2, Upload, X } from 'lucide-react';
import './free-tool.css';

/* The twelve free media tools, one screen: the media on the left (your file, then the result beside it), the choices on the
   right, one button. Processing is the local ffmpeg behind POST /api/media/process; every control here is one the server
   uses, so nothing on the screen is for show. */
const fmt = (s) => { const t = Math.round(Math.max(0, s || 0) * 10) / 10, m = Math.floor(t / 60), r = t % 60, whole = Number.isInteger(r); return `${m}:${r.toFixed(whole ? 0 : 1).padStart(whole ? 2 : 4, '0')}`; };
const size = (b) => (b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
const ASPECTS = [['9:16', 'TikTok · Reels · Shorts', 9, 16], ['1:1', 'Square', 1, 1], ['4:5', 'Feed portrait', 4, 5], ['16:9', 'YouTube · landscape', 16, 9]];

/* what each tool says it does, in a line (the right panel's lead when nothing needs choosing) */
const ABOUT = {
  'Audio Balancer': 'Evens out the loudness to a steady −16 LUFS, the level podcasts and social apps expect. Saved as an MP3.',
  'Video Compressor': 'Makes the file smaller with H.264 and keeps the picture size.',
  'MP3 Converter': 'Pulls the sound out of any video or audio file as a high-quality MP3.',
  'Video Trimmer': 'Cuts the video to the part between the start and the end.',
  'Aspect Ratio Converter': 'Puts the video into a new frame shape for the platform you are posting to.',
  'Video to GIF': 'Turns a stretch of the video into a looping GIF, up to 15 seconds.',
  'Video Speed Changer': 'Plays the video faster or slower, with the sound kept in time.',
  'Volume Booster': 'Makes quiet video or audio louder, or turns it down.',
  'Video Merger': 'Joins the videos into one, in the order shown.',
  'MP4 Converter': 'Turns MOV, WebM, MKV, AVI and more into a widely playable MP4.',
  'Video Reverser': 'Plays the video backwards. The sound is removed.',
  'Mute Video': 'Removes the audio and keeps the picture untouched, without re-encoding.',
};

function Pills({ label, items, value, onChange }) {
  return <div className="ftl2-pills" role="radiogroup" aria-label={label}>{items.map(([k, text]) => <button key={String(k)} type="button" role="radio" aria-checked={value === k} className={value === k ? 'on' : ''} onClick={() => onChange(k)}>{text}</button>)}</div>;
}
const Field = ({ label, value, children }) => <div className="ftl2-field"><div><span>{label}</span>{value != null && <b>{value}</b>}</div>{children}</div>;

export default function FreeTool({ tool, upload, go }) {
  const [name, , Icon, action] = tool;
  const multiple = !!upload?.multiple;
  const [files, setFiles] = useState([]);
  const [urls, setUrls] = useState([]);
  const [meta, setMeta] = useState({}); // per file: { duration, width, height }
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false), [elapsed, setElapsed] = useState(0);
  const [result, setResult] = useState(null);
  const [view, setView] = useState('result');
  const [drag, setDrag] = useState(false);
  /* choices */
  const [start, setStart] = useState(0), [end, setEnd] = useState(0);
  const [aspect, setAspect] = useState('9:16'), [fit, setFit] = useState('fit');
  const [level, setLevel] = useState(100), [quality, setQuality] = useState('balanced');
  const [gifLength, setGifLength] = useState(8), [gifWidth, setGifWidth] = useState(480), [fps, setFps] = useState('original');
  const input = useRef(null), video = useRef(null), clock = useRef(null), abort = useRef(null);

  const first = files[0], firstMeta = meta[0] || {}, duration = firstMeta.duration || 0;
  const isVideo = (f) => f && (f.type.startsWith('video/') || /\.(mp4|mov|webm|mkv|avi|m4v|wmv|flv|3gp|mpe?g|ogv|qt)$/i.test(f.name));
  const isAudio = (f) => f && f.type.startsWith('audio/');

  useEffect(() => () => { urls.forEach((u) => URL.revokeObjectURL(u)); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { if (result?.url) URL.revokeObjectURL(result.url); }, [result]);
  useEffect(() => () => { clearInterval(clock.current); abort.current?.abort(); }, []);
  useEffect(() => { if (name === 'Video Speed Changer') setLevel(200); else if (name === 'Volume Booster') setLevel(150); else setLevel(100); }, [name]);

  const take = useCallback((incoming) => {
    const picked = Array.from(incoming || []);
    if (!picked.length) return;
    if (picked.some((f) => f.size > 5 * 1024 ** 3)) { setError('Choose files smaller than 5 GB each.'); return; }
    if (picked.some((f) => !/^(video|audio)\//.test(f.type) && !isVideo(f))) { setError('Choose video or audio files.'); return; }
    setError(''); setResult(null);
    setFiles((old) => (multiple ? [...old, ...picked] : [picked[0]]));
    setUrls((old) => { const added = (multiple ? picked : [picked[0]]).map((f) => URL.createObjectURL(f)); if (!multiple) old.forEach((u) => URL.revokeObjectURL(u)); return multiple ? [...old, ...added] : added; });
  }, [multiple]); // eslint-disable-line react-hooks/exhaustive-deps

  /* read each file's length and shape (a hidden element, once per file) */
  useEffect(() => {
    urls.forEach((url, i) => {
      if (meta[i]?.url === url) return;
      const el = document.createElement(isAudio(files[i]) ? 'audio' : 'video'); el.preload = 'metadata'; el.src = url;
      el.onloadedmetadata = () => {
        setMeta((m) => ({ ...m, [i]: { url, duration: el.duration || 0, width: el.videoWidth, height: el.videoHeight } }));
        if (i === 0) { setStart(0); setEnd(Math.round((el.duration || 0) * 10) / 10); setGifLength(Math.min(8, Math.floor(el.duration || 8) || 8)); }
      };
    });
  }, [urls]); // eslint-disable-line react-hooks/exhaustive-deps

  const reset = () => { urls.forEach((u) => URL.revokeObjectURL(u)); setFiles([]); setUrls([]); setMeta({}); setResult(null); setError(''); };
  const removeAt = (i) => { URL.revokeObjectURL(urls[i]); setFiles((f) => f.filter((_, k) => k !== i)); setUrls((u) => u.filter((_, k) => k !== i)); setMeta((m) => { const n = {}; Object.entries(m).forEach(([k, v]) => { const j = Number(k); if (j < i) n[j] = v; else if (j > i) n[j - 1] = v; }); return n; }); setResult(null); };
  const swap = (i, d) => { const j = i + d; if (j < 0 || j >= files.length) return; const swapIn = (arr) => { const a = [...arr]; [a[i], a[j]] = [a[j], a[i]]; return a; }; setFiles(swapIn); setUrls(swapIn); setMeta((m) => ({ ...m, [i]: m[j], [j]: m[i] })); setResult(null); };

  const needsTwo = name === 'Video Merger' && files.length < 2;
  const badTrim = name === 'Video Trimmer' && (end - start < 0.2 || end > duration + 0.1);
  const ready = files.length > 0 && !needsTwo && !badTrim && !busy;

  const run = async () => {
    if (!ready) return;
    setBusy(true); setError(''); setElapsed(0); setResult(null);
    const began = Date.now(); clock.current = setInterval(() => setElapsed((Date.now() - began) / 1000), 200);
    const ctl = new AbortController(); abort.current = ctl;
    try {
      const form = new FormData();
      form.set('tool', name); form.set('start', String(start)); form.set('end', String(end)); form.set('format', aspect); form.set('fit', fit);
      form.set('level', String(level)); form.set('quality', quality); form.set('fps', fps === '60' ? '60' : ''); form.set('length', String(gifLength)); form.set('width', String(gifWidth));
      for (const f of files) form.append('file', f, f.name);
      const response = await fetch('/api/media/process', { method: 'POST', body: form, signal: ctl.signal });
      if (!response.ok) { const detail = await response.json().catch(() => ({})); throw new Error(detail.error || 'Processing failed. Try another file.'); }
      const blob = await response.blob();
      if (!blob.size) throw new Error('The result came back empty.');
      const fileName = (response.headers.get('X-Download-Name') || 'result').replace(/[^\w.\-]/g, '_');
      setResult({ url: URL.createObjectURL(blob), name: fileName, size: blob.size, kind: /\.mp3$/i.test(fileName) ? 'audio' : /\.gif$/i.test(fileName) ? 'image' : 'video' });
      setView('result');
    } catch (cause) { if (cause?.name !== 'AbortError') setError(cause.message || 'Processing failed.'); }
    finally { clearInterval(clock.current); setBusy(false); }
  };
  useEffect(() => {
    const on = (e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); void run(); } };
    window.addEventListener('keydown', on); return () => window.removeEventListener('keydown', on);
  }); // eslint-disable-line react-hooks/exhaustive-deps

  const savedPct = result && first && name === 'Video Compressor' ? Math.round((1 - result.size / first.size) * 100) : null;
  const total = useMemo(() => Object.values(meta).reduce((s, m) => s + (m?.duration || 0), 0), [meta]);
  const showSettings = files.length > 0;
  const frame = ASPECTS.find(([k]) => k === aspect);

  const media = (src, kind, f) => kind === 'image' ? <img className="ftl2-media" src={src} alt="The GIF"/> : kind === 'audio' || isAudio(f) ? <div className="ftl2-audio"><Music size={34}/><audio src={src} controls/></div> : <video ref={video} className="ftl2-media" src={src} controls playsInline/>;

  return <div className="ftl2-root">
    <input ref={input} type="file" hidden multiple={multiple} accept={upload?.formats} onChange={(e) => { take(e.target.files); e.target.value = ''; }}/>
    <section className="ftl2-stage" aria-label="Media">
      <header className="ftl2-head"><span className="ftl2-icon"><Icon size={19}/></span><div><h2>{name}</h2><p>{ABOUT[name]}</p></div>
        {result && first && <div className="ftl2-seg" role="tablist" aria-label="Compare">{[['original', name === 'Video Merger' ? 'Videos' : 'Original'], ['result', 'Result']].map(([k, t]) => <button key={k} type="button" role="tab" aria-selected={view === k} className={view === k ? 'on' : ''} onClick={() => setView(k)}>{t}</button>)}</div>}
        {showSettings && !busy && <button type="button" className="ftl2-ghost" onClick={reset}><X size={14}/> Start over</button>}</header>
      <div className={`ftl2-body${drag ? ' is-drag' : ''}`} onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={(e) => { e.preventDefault(); setDrag(false); take(e.dataTransfer.files); }}>
        {!showSettings && <button type="button" className="ftl2-drop" onClick={() => input.current?.click()}><span><Upload size={26}/></span><b>{multiple ? 'Add the videos to join' : 'Drop a file here'}</b><small>or click to browse · {upload?.formats} · up to 5 GB</small></button>}
        {showSettings && name !== 'Video Merger' && (result && view === 'result' ? media(result.url, result.kind, null) : media(urls[0], 'video', first))}
        {showSettings && name === 'Video Merger' && (result && view === 'result' ? media(result.url, 'video') : <ol className="ftl2-list">
          {files.map((f, i) => <li key={`${f.name}-${i}`}><video src={urls[i]} muted preload="metadata" aria-hidden/><span><b>{f.name}</b><small>{meta[i]?.duration ? fmt(meta[i].duration) : '…'} · {size(f.size)}</small></span>
            <div><button type="button" aria-label="Move up" disabled={i === 0 || busy} onClick={() => swap(i, -1)}><ArrowUp size={14}/></button><button type="button" aria-label="Move down" disabled={i === files.length - 1 || busy} onClick={() => swap(i, 1)}><ArrowDown size={14}/></button><button type="button" aria-label={`Remove ${f.name}`} disabled={busy} onClick={() => removeAt(i)}><Trash2 size={14}/></button></div></li>)}
          <li className="ftl2-add"><button type="button" onClick={() => input.current?.click()}><Plus size={15}/> Add another video</button></li></ol>)}
        {busy && <div className="ftl2-busy" role="status" aria-live="polite"><LoaderCircle className="ftl2-spin" size={28}/><b>Working on it…</b><small>{elapsed.toFixed(0)} s · on this computer, nothing is uploaded</small><i/></div>}
      </div>
    </section>
    <section className="ftl2-panel" aria-label="Settings">
      {!showSettings && <div className="ftl2-empty"><Film size={22}/><b>Choose a file to start</b><small>{ABOUT[name]}</small></div>}
      {showSettings && <div className="ftl2-options">
        {name === 'Video Trimmer' && <>
          <Field label="Start" value={fmt(start)}><input type="range" min={0} max={duration || 1} step={0.1} value={start} onChange={(e) => { const v = Number(e.target.value); setStart(Math.min(v, end - 0.2)); if (video.current) video.current.currentTime = v; }} aria-label="Start time"/></Field>
          <Field label="End" value={fmt(end)}><input type="range" min={0} max={duration || 1} step={0.1} value={end} onChange={(e) => { const v = Number(e.target.value); setEnd(Math.max(v, start + 0.2)); if (video.current) video.current.currentTime = v; }} aria-label="End time"/></Field>
          <div className="ftl2-two"><button type="button" className="ftl2-btn" onClick={() => video.current && setStart(Math.min(video.current.currentTime, end - 0.2))}>Start at playhead</button><button type="button" className="ftl2-btn" onClick={() => video.current && setEnd(Math.max(video.current.currentTime, start + 0.2))}>End at playhead</button></div>
          <p className="ftl2-sum">New length <b>{fmt(Math.max(0, end - start))}</b> of {fmt(duration)}</p></>}
        {name === 'Video Compressor' && <><Field label="Quality"><Pills label="Quality" items={[['small', 'Smallest'], ['balanced', 'Balanced'], ['high', 'Best looking']]} value={quality} onChange={setQuality}/></Field><p className="ftl2-sum">Now <b>{size(first.size)}</b>{savedPct != null ? <> · <b className="good">{savedPct}% smaller</b></> : ' · the result shows how much smaller'}</p></>}
        {name === 'Aspect Ratio Converter' && <><Field label="Shape"><div className="ftl2-aspects" role="radiogroup" aria-label="Aspect ratio">{ASPECTS.map(([k, hint, w, h]) => <button key={k} type="button" role="radio" aria-checked={aspect === k} className={aspect === k ? 'on' : ''} onClick={() => setAspect(k)}><i style={{ aspectRatio: `${w}/${h}` }}/><b>{k}</b><small>{hint}</small></button>)}</div></Field>
          <Field label="When the shape differs"><Pills label="Fit" items={[['fit', 'Keep everything (bars)'], ['fill', 'Fill the frame (crop)']]} value={fit} onChange={setFit}/></Field>
          {firstMeta.width ? <p className="ftl2-sum">{firstMeta.width}×{firstMeta.height} → <b>{frame?.[0]}</b></p> : null}</>}
        {name === 'Video to GIF' && <><Field label="Starts at" value={fmt(start)}><input type="range" min={0} max={Math.max(0, duration - 1)} step={0.5} value={start} onChange={(e) => { const v = Number(e.target.value); setStart(v); if (video.current) video.current.currentTime = v; }} aria-label="GIF start"/></Field>
          <Field label="Length" value={`${gifLength} s`}><input type="range" min={1} max={Math.min(15, Math.max(1, Math.floor(duration - start)))} step={1} value={Math.min(gifLength, 15)} onChange={(e) => setGifLength(Number(e.target.value))} aria-label="GIF length"/></Field>
          <Field label="Width"><Pills label="Width" items={[[360, 'Small'], [480, 'Medium'], [640, 'Large']]} value={gifWidth} onChange={setGifWidth}/></Field></>}
        {name === 'Video Speed Changer' && <><Field label="Speed" value={`${(level / 100).toFixed(2).replace(/\.?0+$/, '')}×`}><input type="range" min={25} max={200} step={5} value={level} onChange={(e) => setLevel(Number(e.target.value))} aria-label="Speed"/></Field>
          <Pills label="Speed presets" items={[[50, '0.5×'], [75, '0.75×'], [100, '1×'], [150, '1.5×'], [200, '2×']]} value={level} onChange={setLevel}/>
          {duration ? <p className="ftl2-sum">{fmt(duration)} → <b>{fmt(duration * 100 / level)}</b></p> : null}</>}
        {name === 'Volume Booster' && <><Field label="Volume" value={`${level}%`}><input type="range" min={25} max={200} step={5} value={level} onChange={(e) => setLevel(Number(e.target.value))} aria-label="Volume"/></Field>
          <Pills label="Volume presets" items={[[50, '50%'], [100, '100%'], [150, '150%'], [200, '200%']]} value={level} onChange={setLevel}/><p className="ftl2-sum">{level === 100 ? 'No change' : <><b>{level > 100 ? '+' : ''}{(20 * Math.log10(level / 100)).toFixed(1)} dB</b> against the original</>}</p></>}
        {name === 'MP4 Converter' && <Field label="Frame rate"><Pills label="Frame rate" items={[['original', 'Keep original'], ['60', '60 fps']]} value={fps} onChange={setFps}/></Field>}
        {name === 'Video Merger' && <p className="ftl2-sum">{files.length} video{files.length === 1 ? '' : 's'} · <b>{fmt(total)}</b> in total{needsTwo ? ' · add one more to merge' : ''}</p>}
        {['Audio Balancer', 'MP3 Converter', 'Video Reverser', 'Mute Video'].includes(name) && <div className="ftl2-note"><CheckCircle2 size={16}/><span>Nothing to choose. {name === 'Video Reverser' ? 'Long videos take a while to reverse.' : 'It is ready to run.'}</span></div>}
        {first && <div className="ftl2-file"><FileVideo size={15}/><span>{multiple ? `${files.length} file${files.length === 1 ? '' : 's'}` : first.name}</span><small>{multiple ? size(files.reduce((s, f) => s + f.size, 0)) : `${size(first.size)}${duration ? ` · ${fmt(duration)}` : ''}`}</small></div>}
      </div>}
      {error && <p className="ftl2-error" role="alert">{error}</p>}
      <div className="ftl2-foot">
        {result && <div className="ftl2-done" role="status"><CheckCircle2 size={18}/><span><b>Ready</b><small>{result.name} · {size(result.size)}</small></span><a className="ftl2-download" href={result.url} download={result.name}><Download size={15}/> Download</a></div>}
        <button type="button" className="ftl2-run" disabled={!ready} onClick={run}>{busy ? <><LoaderCircle className="ftl2-spin" size={17}/> Working…</> : result ? <><RotateCcw size={16}/> Run again</> : <>{action}</>}{!busy && <kbd>⌘↵</kbd>}</button>
      </div>
    </section>
  </div>;
}
