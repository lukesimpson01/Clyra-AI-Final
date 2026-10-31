import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Check, ChevronDown, ChevronRight, CirclePlay, Film, Maximize2, Subtitles, X, Youtube } from 'lucide-react';
import './autoclip-studio-v2.css';

const presets = [
  { id: 2, name: 'Viral', font: 'Arial Black, sans-serif', weight: 900 },
  { id: 4, name: 'Clean', font: 'Arial, sans-serif', weight: 700 },
  { id: 18, name: 'Bold', font: 'Impact, Arial Black, sans-serif', weight: 900 },
  { id: 5, name: 'Classic', font: 'Georgia, serif', weight: 700 },
  { id: 143, name: 'Matte', font: 'Arial, sans-serif', weight: 800 },
];
const morePresets = [215, 9, 24, 39, 48, 54, 58, 72, 78, 108, 113];
const animations = ['Pop', 'Fade', 'Slide up', 'Bounce', 'Typewriter', 'None'];
const tabs = [['clips', 'Clip settings'], ['subtitles', 'Subtitles'], ['source', 'Source']];
const fmt = value => `${Math.floor(value / 60)}:${String(Math.floor(value % 60)).padStart(2, '0')}`;

function youtubeId(url) {
  try {
    const parsed = new URL(url);
    const part = parsed.hostname === 'youtu.be' ? parsed.pathname.slice(1).split('/')[0] : parsed.searchParams.get('v') || parsed.pathname.match(/^\/(?:shorts|embed|live)\/([^/]+)/)?.[1];
    return /^[a-zA-Z0-9_-]{11}$/.test(part || '') ? part : null;
  } catch { return null; }
}

/* the clipper names clips after the uploaded file, which it stores under an id: name them after what the user picked */
function clipTitle(clip, i, source) {
  const raw = String(clip.title || '').trim();
  const machine = !raw || /^[0-9a-f]{8}[ -]?[0-9a-f]{4}/i.test(raw);
  if (!machine) return raw;
  const base = source.type === 'youtube-link' ? 'YouTube video' : String(source.name || 'Clip').replace(/\.[a-z0-9]{2,4}$/i, '');
  return `${base} · Moment ${i + 1}`;
}
/* the clipper's reason is a scoring note ("44 -- Solid setup… Timeline evidence: …"): keep only its plain sentence */
function clipNote(clip) {
  const text = String(clip.reason || '').replace(/^\s*\d+\s*[-–—:]+\s*/, '').replace(/\s*Timeline evidence:.*$/is, '').trim();
  if (!text || /needs |prompt-relevant|cleaner ending/i.test(text)) return '';
  return text.length > 90 ? `${text.slice(0, 88)}…` : text;
}

function Choices({ label, items, value, onChange }) {
  return <div className="acs2-choices" role="group" aria-label={label}>
    {items.map(item => <button key={item} type="button" aria-pressed={value === item} className={value === item ? 'active' : ''} onClick={() => onChange(item)}>{item}</button>)}
  </div>;
}

function Field({ title, aside, children }) {
  return <div className="acs2-field"><div className="acs2-field-heading"><strong>{title}</strong>{aside && <span>{aside}</span>}</div>{children}</div>;
}

function ProgressRing({ progress }) {
  return <div className="acs2-ring" aria-label={`${progress}% complete`}>
    <svg viewBox="0 0 120 120" aria-hidden="true"><circle className="acs2-ring-track" cx="60" cy="60" r="50"/><circle className="acs2-ring-value" cx="60" cy="60" r="50" style={{ strokeDashoffset: 314.159 * (1 - progress / 100) }}/></svg>
    <span>{progress}%</span>
  </div>;
}

export default function AutoClipStudio({ source, onBack, onEditor }) {
  const [tab, setTab] = useState('clips');
  const [count, setCount] = useState(5);
  const [length, setLength] = useState('60s');
  const [lead, setLead] = useState('Off');
  const [language, setLanguage] = useState('Auto detect');
  const [focus, setFocus] = useState('');
  const [style, setStyle] = useState(2);
  const [hoverStyle, setHoverStyle] = useState(null);
  const [showAll, setShowAll] = useState(false);
  const [timing, setTiming] = useState('Word');
  const [animation, setAnimation] = useState('Pop');
  const [textColor, setTextColor] = useState('#ffffff');
  const [highlightColor, setHighlightColor] = useState('#ffd83d');
  const [outlineColor, setOutlineColor] = useState('#141414');
  const [position, setPosition] = useState(18);
  const [size, setSize] = useState(27);
  const [sample, setSample] = useState('SO HERE IS THE MOMENT');
  const [playing, setPlaying] = useState(true);
  const [time, setTime] = useState(0);
  const [progress, setProgress] = useState(null);
  const [done, setDone] = useState(false);
  const [full, setFull] = useState(false);
  const generationRef = useRef(0);
  const finishRef = useRef(0);
  const sourceUrl = useRef(null);

  useEffect(() => {
    if (source.type === 'youtube-link') return;
    sourceUrl.current = URL.createObjectURL(source);
    return () => { if (sourceUrl.current) URL.revokeObjectURL(sourceUrl.current); };
  }, [source]);
  useEffect(() => () => { cancelAnimationFrame(generationRef.current); clearTimeout(finishRef.current); }, []);
  useEffect(() => {
    if (!full) return;
    const onKey = event => { if (event.key === 'Escape') setFull(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [full]);

  const words = sample.trim().split(/\s+/).filter(Boolean);
  const duration = Math.max(2.4, words.length * 0.72);
  const index = Math.min(Math.max(0, words.length - 1), Math.floor(time / 0.72));
  const start = Math.floor(index / 4) * 4;
  const shown = timing === 'Word' ? [words[index] || 'WORD'] : words.slice(start, start + 4);
  const currentStyle = hoverStyle ?? style;
  const preset = presets.find(item => item.id === currentStyle) || presets[0];
  const previewCanvas = <div className="acs2-video" aria-label="Black subtitle preview"><div className={`acs2-caption acs2-motion-${animation.toLowerCase().replace(/\s+/g, '-')}`} key={`${currentStyle}-${index}-${animation}-${timing}`} style={{ bottom: `${position}%`, fontSize: `${size / 247 * 100}cqw`, fontFamily: preset.font, fontWeight: preset.weight, color: textColor, WebkitTextStroke: `1.4px ${outlineColor}` }}><span className="acs2-caption-highlight" style={{ backgroundColor: highlightColor }}>{shown.join(' ')}</span></div></div>;

  useEffect(() => {
    if (!playing || done || progress !== null) return;
    let frame = 0;
    let last = performance.now();
    const tick = now => {
      const delta = Math.min(0.08, (now - last) / 1000);
      last = now;
      setTime(value => (value + delta) % duration);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, duration, done, progress]);

  /* Generate: Clyra's clipper (its Vision engine: transcript, moments, face tracking, captions) makes the clips. The
     upload and the run go through this app's server to Clyra (server/localApi.js `toClyra`); clips arrive as they are
     encoded. */
  const [clips, setClips] = useState([]);
  const [runError, setRunError] = useState('');
  const [runMessage, setRunMessage] = useState('');
  const runAbort = useRef(null);
  const upload = file => new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api/clipper/upload?filename=${encodeURIComponent(file.name || 'video.mp4')}`);
    xhr.setRequestHeader('Content-Type', file.type || 'video/mp4');
    xhr.upload.onprogress = event => { if (event.lengthComputable) { setProgress(Math.round(event.loaded / event.total * 8)); setRunMessage('Uploading your video'); } };
    xhr.onload = () => { try { const body = JSON.parse(xhr.responseText); if (xhr.status < 300 && body.ok && body.uploadId) resolve(body.uploadId); else reject(new Error(body.error || `Upload failed (${xhr.status})`)); } catch { reject(new Error('Upload failed')); } };
    xhr.onerror = () => reject(new Error('Upload failed. Check the connection and try again.'));
    runAbort.current?.signal.addEventListener('abort', () => xhr.abort(), { once: true });
    xhr.send(file);
  });
  const generate = async () => {
    setPlaying(false); setProgress(0); setClips([]); setRunError(''); setRunMessage('Starting');
    runAbort.current = new AbortController();
    const seconds = Number.parseInt(length, 10) || 60, lead_in = Number.parseInt(lead, 10) || 0;
    const config = {
      moment_type: focus.trim() || 'viral', clip_duration: Math.max(15, Math.min(180, seconds)), clip_count: Math.max(1, Math.min(20, count)),
      aspect_ratio: '9:16', render_quality: 'premium', captions_enabled: true, burn_captions: true, remove_fillers: false, clip_name: 'clip',
      lead_in, language: language === 'Auto detect' ? 'auto' : language, subtitle_style: timing === 'Word' ? 'word' : 'line',
      caption: { preset: preset.name, font: preset.font, weight: preset.weight, animation, textColor, highlightColor, outlineColor, position, size },
      auto_reframe: true,
      face_tracking: { enabled: true, mode: 'smooth', allowZoom: false, smartReframe: true, reframeMode: 'auto', speakerMode: 'auto', trackingQuality: 'high_quality' },
    };
    try {
      const body = source.type === 'youtube-link' ? { url: source.url, config } : { uploadId: await upload(source), config };
      const response = await fetch('/api/clipper/start', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: runAbort.current.signal });
      if (!response.ok || !response.body) { const detail = await response.json().catch(() => ({})); throw new Error(detail.error || `The clipper could not start (${response.status})`); }
      const reader = response.body.getReader(), decoder = new TextDecoder();
      let buffer = '', made = 0;
      for (;;) {
        const { value, done: ended } = await reader.read();
        if (ended) break;
        buffer += decoder.decode(value, { stream: true });
        const frames = buffer.split('\n\n'); buffer = frames.pop() || '';
        for (const frame of frames) {
          const line = frame.split('\n').find(entry => entry.startsWith('data: '));
          if (!line) continue;
          let event; try { event = JSON.parse(line.slice(6)); } catch { continue; }
          if (event.type === 'progress') { if (typeof event.overall === 'number') setProgress(value => Math.max(value, Math.min(99, Math.round(8 + event.overall * .92)))); if (event.message) setRunMessage(String(event.message)); }
          else if (event.type === 'clip_result' && event.result?.output) { made += 1; const result = event.result; setClips(list => list.some(c => c.output === result.output) ? list : [...list, result]); setRunMessage(`${made} clip${made === 1 ? '' : 's'} ready`); }
          else if (event.type === 'error') throw new Error(String(event.message || 'The clipper failed.'));
          else if (event.type === 'complete') { if (Array.isArray(event.results)) setClips(list => list.length ? list : event.results); }
        }
      }
      setProgress(null); setDone(true);
    } catch (cause) {
      if (cause?.name === 'AbortError') { setProgress(null); return; }
      setProgress(null); setRunError(cause instanceof Error ? cause.message : String(cause));
    }
  };
  useEffect(() => () => runAbort.current?.abort(), []);
  const mediaOf = output => `/api/clipper/media/${encodeURIComponent(String(output).split(/[\\/]/).pop())}`;
  const downloadOf = output => `/api/clipper/download/${encodeURIComponent(String(output).split(/[\\/]/).pop())}`;

  const selectPreset = id => {
    setStyle(id);
    setHoverStyle(null);
  };

  return <div className="acs2-root">
    <div className="acs2-heading"><button className="acs2-back" aria-label="Back to AutoClip" onClick={onBack}><ArrowLeft size={18}/></button><div><h2>{done ? 'Your clips are ready' : 'New autoclip'}</h2><small>{progress !== null ? runMessage || 'Generating with Clyra' : 'Generated with Clyra’s clipper'}</small></div><button className="acs2-source-chip" onClick={() => setTab('source')}><span>{source.type === 'youtube-link' ? <Youtube size={18} fill="#ff0033" color="#ff0033"/> : <Film size={17}/>}</span><strong>{source.type === 'youtube-link' ? 'YouTube video' : source.name}</strong><ChevronDown size={14}/></button></div>
    {done ? <div className="acs2-results"><div className="acs2-done-mark"><Check size={28}/></div><h3>{clips.length} clip{clips.length === 1 ? '' : 's'} ready</h3><p>{clips.length ? 'Made by Clyra’s clipper from your video: play one, download it, or open it in the editor.' : 'The clipper finished without a clip for these settings: try another length or focus.'}</p><div className="acs2-results-grid">{clips.map((clip, i) => <article key={clip.output || i}><div className="acs2-result-video"><video src={mediaOf(clip.output)} muted loop playsInline preload="metadata" onMouseEnter={e => void e.currentTarget.play().catch(() => {})} onMouseLeave={e => e.currentTarget.pause()} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}/><span>{clip.clip_duration || `Clip ${i + 1}`}</span></div><strong>{clipTitle(clip, i, source)}</strong><small>{clipNote(clip) || `${length} · ${preset.name} captions`}</small><a className="acs2-download" href={downloadOf(clip.output)} download>Download MP4</a><button onClick={onEditor}>Polish and export</button></article>)}</div><button className="acs2-adjust" onClick={() => { setDone(false); setPlaying(true); }}>Adjust settings</button></div> : <>
      <nav className="acs2-steps" aria-label="AutoClip editor sections"><div>{tabs.map(([id, label], i) => <React.Fragment key={id}><button type="button" className={tab === id ? 'active' : ''} aria-current={tab === id ? 'step' : undefined} onClick={() => setTab(id)}><b>{i + 1}</b><span>{label}</span></button>{i < tabs.length - 1 && <ChevronRight size={16}/>}</React.Fragment>)}</div><button className="acs2-step-next" onClick={() => setTab(tabs[Math.min(tabs.length - 1, tabs.findIndex(([id]) => id === tab) + 1)][0])}>{tab === 'source' ? 'Source ✓' : 'Next ❯'}</button></nav>
      <div className="acs2-workspace">
        <section className="acs2-editor"><div className="acs2-editor-body" key={tab}>
          {tab === 'clips' && <>
            <div className="acs2-panel-title"><h3>Clip settings</h3><p>Choose what the finished clips should feel like.</p></div>
            <Field title="How many clips"><Choices label="How many clips" items={[3, 5, 8, 12, 20]} value={count} onChange={setCount}/></Field>
            <Field title="Clip length"><Choices label="Clip length" items={['30s', '45s', '60s', '90s']} value={length} onChange={setLength}/></Field>
            <Field title="Lead-in" aside="Before the first line"><Choices label="Lead-in" items={['Off', '2s', '4s']} value={lead} onChange={setLead}/><p>Open each clip a little before the first line so the reaction has context.</p></Field>
            <Field title="Spoken language"><select aria-label="Spoken language" value={language} onChange={event => setLanguage(event.target.value)}>{['Auto detect', 'English', 'Spanish', 'French', 'German', 'Portuguese'].map(item => <option key={item}>{item}</option>)}</select></Field>
            <Field title="Focus (optional)" aside={`${focus.length}/500`}><textarea maxLength={500} value={focus} onChange={event => setFocus(event.target.value)} placeholder="e.g. only the parts about pricing"/></Field>
          </>}
          {tab === 'subtitles' && <>
            <div className="acs2-panel-title"><h3>Subtitles</h3><p>Every change appears in the preview beside this editor.</p></div>
            <Field title="Preview text"><input aria-label="Preview subtitle text" value={sample} maxLength={100} onChange={event => { setSample(event.target.value); setTime(0); }}/></Field>
            <Field title="Subtitle style" aside={<button className="acs2-inline" onClick={() => setShowAll(value => !value)}>{showAll ? 'Show fewer' : 'All 16 styles'}</button>}><div className="acs2-styles">{presets.map(item => <button key={item.id} className={style === item.id ? 'active' : ''} onMouseEnter={() => setHoverStyle(item.id)} onMouseLeave={() => setHoverStyle(null)} onFocus={() => setHoverStyle(item.id)} onBlur={() => setHoverStyle(null)} onClick={() => selectPreset(item.id)}><b style={{ fontFamily: item.font, fontWeight: item.weight }}>Aa</b><small>{item.name}</small></button>)}</div>{showAll && <div className="acs2-more-styles">{morePresets.map(id => <button key={id} className={style === id ? 'active' : ''} onMouseEnter={() => setHoverStyle(id)} onMouseLeave={() => setHoverStyle(null)} onClick={() => selectPreset(id)}>Style {id}</button>)}</div>}</Field>
            <div className="acs2-duo"><Field title="Timing"><Choices label="Subtitle timing" items={['Word', 'Lines']} value={timing} onChange={setTiming}/></Field><Field title="Animation"><select aria-label="Subtitle animation" value={animation} onChange={event => setAnimation(event.target.value)}>{animations.map(item => <option key={item}>{item}</option>)}</select></Field></div>
            <div className="acs2-color-grid"><Field title="Text"><input type="color" aria-label="Subtitle text color" value={textColor} onChange={event => setTextColor(event.target.value)}/></Field><Field title="Highlight"><input type="color" aria-label="Subtitle highlight color" value={highlightColor} onChange={event => setHighlightColor(event.target.value)}/></Field><Field title="Outline"><input type="color" aria-label="Subtitle outline color" value={outlineColor} onChange={event => setOutlineColor(event.target.value)}/></Field></div>
            <div className="acs2-duo"><Field title="Position" aside={`${position}%`}><input type="range" aria-label="Subtitle position" min="7" max="72" value={position} onChange={event => setPosition(Number(event.target.value))}/></Field><Field title="Size" aside={`${size}px`}><input type="range" aria-label="Subtitle size" min="16" max="42" value={size} onChange={event => setSize(Number(event.target.value))}/></Field></div>
          </>}
          {tab === 'source' && <>
            <div className="acs2-panel-title"><h3>Source video</h3><p>Check the video you selected. This local workflow does not download it.</p></div>
            {source.type === 'youtube-link' ? <div className="acs2-source-video"><iframe title="Selected YouTube video" src={`https://www.youtube-nocookie.com/embed/${youtubeId(source.url)}?rel=0`} allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowFullScreen referrerPolicy="strict-origin-when-cross-origin"/><div className="acs2-source-identity"><img src={`https://i.ytimg.com/vi/${youtubeId(source.url)}/mqdefault.jpg`} alt="YouTube video thumbnail"/><p>{source.url}<small>Some videos cannot be embedded by their owner.</small></p></div></div> : <div className="acs2-source-video">{sourceUrl.current ? <video src={sourceUrl.current} controls/> : <div className="acs2-file-placeholder"><Film size={34}/>{source.name}</div>}</div>}
            <button className="acs2-change" onClick={onBack}>Choose a different video</button>
          </>}
        </div></section>
        <section className="acs2-preview"><div className="acs2-preview-heading"><div><span><Subtitles size={15}/> LIVE PREVIEW</span><h3>Clip preview</h3><p>Subtitle styling on a blank canvas.</p></div><div className="acs2-preview-actions"><b>9:16</b><button type="button" aria-label="Fullscreen clip preview" onClick={() => setFull(true)}><Maximize2 size={16}/></button></div></div><div className="acs2-preview-stage">{previewCanvas}</div></section>
      </div>
      <footer className="acs2-footer"><span>Clyra’s clipper makes up to {count} clips on this computer: transcript, best moments, framing and captions.</span><button onClick={generate}>Generate {count} clips</button></footer>
      {progress !== null && <div className="acs2-generating" role="status" aria-live="polite"><div className="acs2-generating-card"><ProgressRing progress={progress}/><h2>{progress === 100 ? 'Clips are ready' : 'Creating your clips'}</h2><p>{runMessage || 'Analyzing your source'}</p><small>{clips.length ? `${clips.length} clip${clips.length === 1 ? '' : 's'} ready so far` : 'Clyra’s clipper is working on your video'}</small><button type="button" className="acs2-cancel" onClick={() => runAbort.current?.abort()}>Cancel</button></div></div>}
      {runError && <div className="acs2-error" role="alert"><span>{runError}</span><button type="button" aria-label="Dismiss" onClick={() => setRunError('')}><X size={14}/></button></div>}
      {full && <div className="acs2-fullscreen" role="dialog" aria-label="Fullscreen clip preview">{source.type === 'youtube-link' ? <div className="acs2-full-backdrop" style={{ backgroundImage: `url(https://i.ytimg.com/vi/${youtubeId(source.url)}/maxresdefault.jpg)` }}/>: sourceUrl.current ? <video className="acs2-full-backdrop" src={sourceUrl.current} autoPlay muted loop playsInline/> : <div className="acs2-full-backdrop"/>}<button type="button" className="acs2-full-close" aria-label="Close fullscreen clip preview" onClick={() => setFull(false)}><X size={20}/></button>{previewCanvas}</div>}
    </>}
  </div>;
}
