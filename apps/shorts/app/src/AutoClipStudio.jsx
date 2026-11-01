import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlignVerticalJustifyCenter, AlignVerticalJustifyEnd, AlignVerticalJustifyStart, ArrowLeft, Check, ChevronDown, ChevronRight, Film, Maximize2, Minus, Palette, Pause, PenLine, Play, Plus, ScanFace, Sparkles, Type, Wand2, X, Youtube } from 'lucide-react';
import './story-wizard.css';
import './fake-text-workspace.css';
import './autoclip-studio-v3.css';
import { SUB_ANIMATIONS, WORD_IDS, LINE_IDS, captionStyle, customStyle, captionPayload, captionCss } from './subtitleStyles.js';
import { CAPTION_FONTS, loadCaptionFont } from './captionFonts.js';
import { planStages, stageOfEvent, createProgress, etaText } from './clipProgress.js';
import { clock } from './AutoClipSourcePage.jsx';
import ClipResults, { clipKey } from './ClipResults.jsx';
import { writeCopy } from './clipCopy.js';
import { announceProject } from './projectThumb.js';

/* AI clipper: the Fake Text story's workspace (steps, an editor card, a live 9:16 preview), the advanced editor's caption
   catalog, and Clyra's clipper behind it (server/localApi.js relays /api/clipper/* to Clyra). The last step asks how
   many clips and starts them; the run fills the page with what is happening, true to the pipeline's own events. With
   "Pick a face", the clips come back clean, the faces in each are shown, and the chosen ones are followed and the
   captions burned in a second pass (POST /api/clipper/rerender). */
const STEPS = ['Source', 'Moments', 'Captions', 'Framing', 'Generate'];
/* moments the clipper's scorer knows (clipper-pipeline.py keyword_set); a typed description searches for that instead */
const MOMENTS = [
  ['viral', 'Viral hooks', 'Big reveals, wild claims, the best 60 seconds'],
  ['funny', 'Funny', 'Laughs, awkward beats, jokes that land'],
  ['shocking', 'Shocking', 'Twists, surprises, “wait, what?”'],
  ['reaction', 'Reactions', 'Faces and responses in the moment'],
  ['dramatic', 'High stakes', 'Problems, danger, the turning point'],
  ['angry', 'Drama', 'Arguments, call-outs, heated moments'],
  ['sad', 'Emotional', 'Tears, goodbyes, heartfelt moments'],
  ['inspirational', 'Inspiring', 'Dreams, lessons, comebacks'],
  ['action', 'Action', 'Stunts, challenges, fast movement'],
];
const LENGTHS = [['Auto', 45], ['< 30s', 25], ['30–60s', 45], ['60–90s', 75], ['90s+', 120]];
const QUICK_COUNTS = [1, 2, 3, 5, 10];
const ASPECTS = ['9:16', '1:1', '16:9'];
const LANGUAGES = ['Auto detect', 'English', 'Spanish', 'French', 'German', 'Portuguese', 'Italian', 'Japanese', 'Korean', 'Hindi'];
/* Low sits above the app's own buttons and description on TikTok, Reels and Shorts */
const PLACES = [['Top', 22, AlignVerticalJustifyStart], ['Center', 50, AlignVerticalJustifyCenter], ['Low', 72, AlignVerticalJustifyEnd]];
const CAPTION_TABS = [['style', 'Style', Sparkles], ['font', 'Font', Type], ['colors', 'Colours', Palette], ['place', 'Place & motion', AlignVerticalJustifyCenter]];
const SWATCHES = ['#ffffff', '#f2d31a', '#ffdd00', '#a6f24a', '#22e5e5', '#4bd8f4', '#1d5cff', '#fb73d4', '#e0222a', '#ff8a00', '#000000'];
/* every animation of the editor's catalog but Bounce, which reads as a glitch on a caption that changes word by word */
const ANIMATIONS = SUB_ANIMATIONS.filter((a) => a !== 'Bounce');
const SAMPLE = 'I GAVE AWAY ONE MILLION DOLLARS TO THIS GUY';
const MOMENT_NAME = Object.fromEntries(MOMENTS.map(([k, n]) => [k, n]));

function youtubeId(url) {
  try {
    const parsed = new URL(url);
    const part = parsed.hostname === 'youtu.be' ? parsed.pathname.slice(1).split('/')[0] : parsed.searchParams.get('v') || parsed.pathname.match(/^\/(?:shorts|embed|live)\/([^/]+)/)?.[1];
    return /^[a-zA-Z0-9_-]{11}$/.test(part || '') ? part : null;
  } catch { return null; }
}
/* the clipper names clips "<source> - moment N": name them after the video the person chose */
function clipTitle(clip, i, sourceTitle) {
  const raw = String(clip.title || '').trim();
  if (raw && !/^[0-9a-f]{8}[ -]?[0-9a-f]{4}/i.test(raw) && !/^source master\b/i.test(raw)) return raw;
  return `${sourceTitle || 'Clip'} · Moment ${clip.rank || i + 1}`;
}
/* faces worth asking about: seen often and surely (a mask, a QR code or a dark blur seen once is not a person) */
const facesOf = (clip) => { const all = clip.available_faces || []; return all.filter((f, i) => i === 0 || ((f.confidence ?? 1) >= 0.6 && (f.bboxSamples?.length ?? 4) >= 4)); };
const fileName = (output) => String(output).split(/[\\/]/).pop();
const mediaOf = (output) => `/api/clipper/media/${encodeURIComponent(fileName(output))}`;
const downloadOf = (output) => `/api/clipper/download/${encodeURIComponent(fileName(output))}`;

/** Server-sent events from a clipper POST: each JSON event to `on`; an error event throws. The job runs on in Clyra
 *  whatever happens to this connection: a stream that drops is picked up where it left off
 *  (GET /api/clipper/jobs/:jobId/events?from=N), so no clip and no error is missed. `job` gets the job's id. */
async function streamEvents(url, body, signal, on, job = () => {}) {
  let jobId = null, seen = 0, attempts = 0, finished = false;
  const read = async (response) => {
    const reader = response.body.getReader(), decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return;
      buffer += decoder.decode(value, { stream: true });
      const frames = buffer.split('\n\n'); buffer = frames.pop() || '';
      for (const frame of frames) {
        const line = frame.split('\n').find((entry) => entry.startsWith('data: '));
        if (!line) continue;
        seen += 1;
        let event; try { event = JSON.parse(line.slice(6)); } catch { continue; }
        if (event.type === 'job' && event.jobId) { jobId = event.jobId; job(jobId); }
        if (event.type === 'complete') finished = true;
        if (event.type === 'error') { finished = true; throw new Error(String(event.message || 'The clipper failed.')); }
        on(event);
      }
    }
  };
  const first = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal });
  if (!first.ok || !first.body) { const detail = await first.json().catch(() => ({})); throw new Error(detail.error || `The clipper could not start (${first.status})`); }
  let response = first;
  for (;;) {
    try { await read(response); return; }
    catch (cause) {
      if (finished || signal.aborted || cause?.name === 'AbortError' || !jobId || attempts >= 20) throw cause;
      attempts += 1;
      await new Promise((r) => setTimeout(r, Math.min(8000, 800 * attempts)));
      response = await fetch(`/api/clipper/jobs/${encodeURIComponent(jobId)}/events?from=${seen}`, { signal }).catch((e) => { if (e?.name === 'AbortError') throw e; return null; });
      if (!response?.ok || !response.body) { if (response?.status === 404) throw new Error('The clipper job ended while the connection was down. Generate again.'); response = { body: new ReadableStream({ start(c) { c.error(new TypeError('reconnecting')); } }) }; }
    }
  }
}

function Pills({ label, items, value, onChange }) {
  return <div className="ftl-pills acp-pills" role="group" aria-label={label}>{items.map(([key, text]) => <button key={String(key)} type="button" aria-pressed={value === key} className={value === key ? 'active' : ''} onClick={() => onChange(key)}>{text}</button>)}</div>;
}
function Toggle({ label, hint, on, onChange }) {
  return <div className="ftl-toggle acp-toggle"><span><b>{label}</b>{hint && <small>{hint}</small>}</span><button type="button" role="switch" aria-checked={on} aria-label={label} className={on ? 'on' : ''} onClick={() => onChange(!on)}><i/></button></div>;
}
function Section({ title, aside, children }) {
  return <section className="acp-section"><div className="ftl-section-heading"><strong>{title}</strong>{aside}</div>{children}</section>;
}

/** The caption as the clip will show it: one word at a time, or three to four together with only the spoken one lit. */
function CaptionPreview({ mode, style, animation, sizePct, yPct, width, word }) {
  const words = SAMPLE.split(' ');
  const group = Math.floor(word / 4) * 4;
  const shown = mode === 'Lines' ? words.slice(group, group + 4) : [words[word % words.length]];
  const active = mode === 'Lines' ? word - group : 0, px = width * sizePct / 100;
  const anim = `acp-a-${String(animation).toLowerCase().replace(/\s+/g, '-')}`;
  return <div className={`acp-cap ${anim}`} key={`${mode}-${animation}-${mode === 'Lines' ? group : word}`} style={{ top: `${yPct}%` }}>
    <span className="acp-cap-line" style={style.box ? { background: style.box[0], borderRadius: px * 0.2, padding: `${px * style.box[1] * 0.2}px ${px * style.box[1] * 1.3}px` } : undefined}>
      {shown.map((w, i) => <React.Fragment key={i}><span className={mode === 'Lines' && animation === 'Typewriter' && i > active ? 'acp-cap-wait' : ''} style={captionCss(style, px, i === active)}>{w}</span>{i < shown.length - 1 ? ' ' : ''}</React.Fragment>)}
    </span>
  </div>;
}

/** The run's ring: one decimal of progress, a light that sweeps from the start to where it is and back. */
function Ring({ percent }) {
  const r = 52, circ = 2 * Math.PI * r, arc = circ * percent / 100;
  return <div className="acp-ring" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-label="Progress">
    <svg viewBox="0 0 120 120" aria-hidden><defs><linearGradient id="acp-ring-shine" x1="0" x2="1"><stop offset="0" stopColor="#fff" stopOpacity="0"/><stop offset=".5" stopColor="#fff" stopOpacity=".95"/><stop offset="1" stopColor="#fff" stopOpacity="0"/></linearGradient></defs>
      <circle className="acp-ring-track" cx="60" cy="60" r={r}/>
      <circle className="acp-ring-value" cx="60" cy="60" r={r} style={{ strokeDasharray: `${arc} ${circ}` }}/>
      {arc > 14 && <circle className="acp-ring-shine" cx="60" cy="60" r={r} style={{ '--arc': `${Math.max(0, arc - 16)}px`, strokeDasharray: `16 ${circ}` }}/>}
    </svg>
    <span><b>{percent.toFixed(1)}</b><i>%</i></span>
  </div>;
}

/** The checklist, as the chat's to-do list: a pill with the current task and N/M, rows that tick and strike through. */
function Checklist({ items, live }) {
  const done = items.filter((t) => t.status === 'done').length, current = items.find((t) => t.status === 'running') ?? items.find((t) => t.status === 'pending');
  const [open, setOpen] = useState(true);
  return <section className="acp-plan is-open" aria-label="What the clipper is doing">
    <button type="button" className="acp-plan__trigger" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
      <span className={`acp-plan__ring${live && done < items.length ? ' is-working' : ''}`} aria-hidden><svg viewBox="0 0 28 28"><circle className="acp-plan__track" cx="14" cy="14" r="11"/><circle className="acp-plan__value" cx="14" cy="14" r="11"/></svg></span>
      <span className="acp-plan__title">{done === items.length ? 'All done' : current?.label ?? 'Starting'}</span>
      <span className="acp-plan__counter" key={done}>{done}/{items.length}</span><ChevronDown className="acp-plan__chevron" size={13} aria-hidden/>
    </button>
    <div className="acp-plan__disclosure" data-open={open}><div className="acp-plan__inner"><ol className="acp-plan__list">
      {items.map((item) => <li key={item.id} className={`acp-plan__item is-${item.status === 'done' ? 'done' : item.status === 'running' ? 'current' : 'pending'}`}>
        <span className="acp-plan__status" aria-hidden><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12 4 4L19 6"/></svg></span>
        <span className="acp-plan__text">{item.label}{item.detail && item.status === 'running' ? <small> · {item.detail}</small> : null}</span>
      </li>)}
    </ol></div></div>
  </section>;
}

export default function AutoClipStudio({ source, onBack, onEditor, onProjects }) {
  const meta = source.meta || {};
  const sourceTitle = meta.title || (source.type === 'youtube-link' ? 'YouTube video' : String(source.name || 'Video').replace(/\.[a-z0-9]{2,4}$/i, ''));
  const [step, setStep] = useState(1);
  /* moments */
  const [moment, setMoment] = useState('viral');
  const [prompt, setPrompt] = useState('');
  const [custom, setCustom] = useState(false);
  /* the last step */
  const [count, setCount] = useState(3);
  const [length, setLength] = useState('Auto');
  const [aspect, setAspect] = useState('9:16');
  const [language, setLanguage] = useState('Auto detect');
  const [fillers, setFillers] = useState(false);
  const [lead, setLead] = useState(false);
  /* captions */
  const [captions, setCaptions] = useState(true);
  const [mode, setMode] = useState('Lines');
  const [styleId, setStyleId] = useState(37);
  const [animation, setAnimation] = useState('Pop');
  const [sizePct, setSizePct] = useState(8.5);
  const [yPct, setYPct] = useState(72);
  const [font, setFont] = useState(null);
  const [upper, setUpper] = useState(null);
  const [customColors, setCustomColors] = useState(false);
  const [colors, setColors] = useState({ text: '#ffffff', spoken: '#f2d31a', outline: '#000000' });
  const [capTab, setCapTab] = useState('style');
  /* framing */
  const [tracking, setTracking] = useState('auto');
  const [motion, setMotion] = useState('smooth');
  const [zoom, setZoom] = useState(true);
  /* run */
  const [phase, setPhase] = useState('setup'); // setup | running | faces | following | done
  const [snap, setSnap] = useState(null);
  const [serverMessage, setServerMessage] = useState('');
  const [clips, setClips] = useState([]);
  const [faces, setFaces] = useState({});
  const [error, setError] = useState('');
  const [full, setFull] = useState(false);
  const [playing, setPlaying] = useState(true);
  const [word, setWord] = useState(0);
  const [copies, setCopies] = useState({});
  const saved = useRef(new Set()), writing = useRef(new Set());
  const [tick, setTick] = useState(0);
  const abort = useRef(null), sourceUrl = useRef(null), previewBox = useRef(null), jobRef = useRef(null), model = useRef(null), startedAt = useRef(0);
  const [previewW, setPreviewW] = useState(240);

  useEffect(() => {
    if (source.type === 'youtube-link') return undefined;
    sourceUrl.current = URL.createObjectURL(source);
    return () => { if (sourceUrl.current) URL.revokeObjectURL(sourceUrl.current); };
  }, [source]);
  useEffect(() => () => abort.current?.abort(), []);
  useEffect(() => {
    if (!playing || phase !== 'setup') return undefined;
    const timer = setInterval(() => setWord((w) => (w + 1) % SAMPLE.split(' ').length), mode === 'Lines' ? 380 : 480);
    return () => clearInterval(timer);
  }, [playing, mode, phase]);
  useEffect(() => {
    const el = previewBox.current; if (!el) return undefined;
    const ro = new ResizeObserver(() => setPreviewW(el.clientWidth || 240)); ro.observe(el); return () => ro.disconnect();
  }, [phase, step]);
  useEffect(() => {
    if (!full) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setFull(false); };
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  }, [full]);
  useEffect(() => { const ids = mode === 'Lines' ? LINE_IDS : WORD_IDS; if (!ids.includes(styleId)) setStyleId(ids[0]); }, [mode]); // eslint-disable-line react-hooks/exhaustive-deps
  /* the run's clock: ten readings a second of the model (the ring and the ETA move between the pipeline's events) */
  useEffect(() => {
    if (phase !== 'running' && phase !== 'following') return undefined;
    const timer = setInterval(() => { if (model.current) setSnap(model.current.snapshot(Date.now())); setTick((t) => t + 1); }, 100);
    return () => clearInterval(timer);
  }, [phase]);

  const yt = source.type === 'youtube-link' ? youtubeId(source.url) : null;
  const look = { font, upper, colors: customColors ? colors : null };
  const caption = useMemo(() => captionPayload({ mode, id: styleId, animation, sizePct, yPct, ...look }), [mode, styleId, animation, sizePct, yPct, font, upper, customColors, colors]); // eslint-disable-line react-hooks/exhaustive-deps
  const previewStyle = customStyle(mode, styleId, look);
  useEffect(() => { if (font) void loadCaptionFont(font); }, [font]);
  useEffect(() => { if (capTab === 'font') CAPTION_FONTS.forEach((f) => void loadCaptionFont(f.name)); }, [capTab]);
  const picking = tracking === 'pick';
  const ask = custom ? prompt.trim() : '';
  const momentText = ask || MOMENT_NAME[moment] || 'the best moments';
  const range = meta.range;
  const workDuration = range ? range.end - range.start : meta.duration || 600;
  const faceTracking = (selectedPersonId) => ({ enabled: tracking !== 'off', mode: motion, allowZoom: zoom, smartReframe: true, reframeMode: 'auto', speakerMode: 'auto', trackingQuality: 'balanced', ...(selectedPersonId ? { selectedPersonId } : {}) });

  const upload = (file, signal) => new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api/clipper/upload?filename=${encodeURIComponent(file.name || 'video.mp4')}`);
    xhr.setRequestHeader('Content-Type', file.type || 'video/mp4');
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) setServerMessage(`Uploading your video · ${Math.round(e.loaded / e.total * 100)}%`); };
    xhr.onload = () => { try { const body = JSON.parse(xhr.responseText); if (xhr.status < 300 && body.ok && body.uploadId) resolve(body.uploadId); else reject(new Error(body.error || `Upload failed (${xhr.status})`)); } catch { reject(new Error('Upload failed')); } };
    xhr.onerror = () => reject(new Error('Upload failed. Check the connection and try again.'));
    signal.addEventListener('abort', () => xhr.abort(), { once: true });
    xhr.send(file);
  });

  const generate = async () => {
    const ctl = new AbortController(); abort.current = ctl;
    const seconds = LENGTHS.find(([k]) => k === length)?.[1] ?? 45;
    const plan = planStages({ kind: 'generate', duration: workDuration, clips: count, clipLength: seconds, fromLink: source.type === 'youtube-link', faces: tracking, captions: captions && !picking, title: sourceTitle });
    model.current = createProgress(plan, Date.now()); model.current.enter('source', Date.now()); startedAt.current = Date.now();
    setSnap(model.current.snapshot(Date.now()));
    setPhase('running'); setClips([]); setFaces({}); setError(''); setServerMessage('');
    const config = {
      moment_type: ask || moment, clip_duration: seconds, clip_count: count, aspect_ratio: aspect, render_quality: 'premium',
      language: language === 'Auto detect' ? 'auto' : language, remove_fillers: fillers, lead_in: lead ? 2 : 0, clip_name: 'clip',
      ...(range ? { source_start_seconds: Math.floor(range.start), source_duration_seconds: Math.ceil(range.end - range.start) } : {}),
      /* picking a face: clean clips first; the captions go on with the face, after the pick */
      captions_enabled: captions && !picking, burn_captions: captions && !picking, subtitle_style: mode === 'Lines' ? 'phrase' : 'word', caption,
      auto_reframe: tracking !== 'off', face_tracking: faceTracking(null),
    };
    let made = [];
    try {
      const body = source.type === 'youtube-link' ? { url: source.url, config } : { uploadId: await upload(source, ctl.signal), config };
      await streamEvents('/api/clipper/start', body, ctl.signal, (event) => {
        const now = Date.now(), at = stageOfEvent(event, 'generate');
        if (at?.startsWith('done-')) model.current.complete(`render-${at.slice(5)}`, now);
        else if (at) model.current.enter(at, now);
        if (event.type === 'progress' && event.message) setServerMessage(String(event.message));
        if (event.type === 'clip_result' && event.result?.output) { const r = event.result; made = made.some((c) => c.output === r.output) ? made : [...made, r]; setClips(made); }
        else if (event.type === 'complete' && Array.isArray(event.results) && !made.length) { made = event.results.filter((r) => r?.output); setClips(made); }
      }, (id) => { jobRef.current = id; });
      model.current.trim(made.length); model.current.finish(Date.now()); setSnap(model.current.snapshot(Date.now()));
      await new Promise((r) => setTimeout(r, 700));
      if (picking && made.some((c) => facesOf(c).length)) {
        setFaces(Object.fromEntries(made.map((c) => [c.artifact_id, facesOf(c)[0]?.id ?? null])));
        setPhase('faces');
      } else setPhase('done');
    } catch (cause) {
      if (cause?.name === 'AbortError') { setPhase('setup'); return; }
      setError(cause instanceof Error ? cause.message : String(cause)); setPhase(made.length ? 'done' : 'setup');
    }
  };

  /* the face chosen for each clip followed, and the captions burned in: one clip at a time */
  const follow = async () => {
    const ctl = new AbortController(); abort.current = ctl;
    const list = [...clips];
    model.current = createProgress(planStages({ kind: 'follow', clips: list.length, clipLength: LENGTHS.find(([k]) => k === length)?.[1] ?? 45 }), Date.now());
    startedAt.current = Date.now();
    setPhase('following'); setError(''); setServerMessage('');
    try {
      for (const [i, clip] of list.entries()) {
        const n = i + 1; model.current.enter(`subs-${n}`, Date.now());
        let fresh = null;
        await streamEvents('/api/clipper/rerender', {
          artifactId: clip.artifact_id, faceTracking: faceTracking(faces[clip.artifact_id] || null), captionsEnabled: captions, burnCaptions: captions,
          subtitleStyle: mode === 'Lines' ? 'phrase' : 'word', caption, aspectRatio: aspect, renderQuality: 'premium',
        }, ctl.signal, (event) => {
          const at = stageOfEvent(event, 'follow');
          if (at === 'render') model.current.enter(`render-${n}`, Date.now());
          if (event.type === 'progress' && event.message) setServerMessage(String(event.message));
          if (event.type === 'clip_result' && event.result?.output) fresh = event.result;
        }, (id) => { jobRef.current = id; });
        model.current.complete(`render-${n}`, Date.now());
        if (fresh) { list[i] = { ...clip, ...fresh, title: clip.title, reason: clip.reason, rank: clip.rank, virality_score: clip.virality_score ?? fresh.virality_score, _v: Date.now() }; setClips([...list]); }
      }
      model.current.finish(Date.now()); setSnap(model.current.snapshot(Date.now()));
      await new Promise((r) => setTimeout(r, 700));
      setPhase('done');
    } catch (cause) {
      if (cause?.name === 'AbortError') { setPhase('faces'); return; }
      setError(cause instanceof Error ? cause.message : String(cause)); setPhase('done');
    }
  };

  /* each finished clip gets its post written (title, caption, hashtags), then is saved to Projects under that title */
  const write = async (clip, again = false) => {
    const key = clipKey(clip);
    if (writing.current.has(key) && !again) return;
    writing.current.add(key);
    if (again) setCopies((m) => { const n = { ...m }; delete n[key]; return n; });
    const result = await writeCopy({ clip, sourceTitle, channel: meta.channel, moment: ask || moment }).catch(() => null);
    writing.current.delete(key);
    if (result) setCopies((m) => ({ ...m, [key]: result }));
  };
  useEffect(() => {
    if (phase !== 'done') return;
    for (const clip of clips) if (!copies[clipKey(clip)]) void write(clip);
  }, [phase, clips]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (phase !== 'done') return;
    clips.forEach((clip, i) => {
      const key = clipKey(clip), tag = `${key}|${clip.output}`;
      if (!copies[key] || saved.current.has(tag)) return;
      saved.current.add(tag);
      announceProject({ name: copies[key].title || clipTitle(clip, i, sourceTitle), tool: '/create/auto-clip', source: mediaOf(clip.output), duration: Number.parseFloat(clip.clip_duration) || null, video: mediaOf(clip.output) });
    });
  }, [phase, clips, copies]); // eslint-disable-line react-hooks/exhaustive-deps

  /* Cancel stops the job in Clyra too (a dropped connection alone never does) */
  const cancel = () => { const id = jobRef.current; if (id) void fetch(`/api/clipper/jobs/${encodeURIComponent(id)}/cancel`, { method: 'POST' }).catch(() => {}); jobRef.current = null; abort.current?.abort(); };
  const sourceLabel = sourceTitle;

  /* ---------- the run, filling the page ---------- */
  if (phase === 'running' || phase === 'following') {
    const s = snap ?? { percent: 0, eta: null, current: null, stages: [] };
    const cur = s.current;
    const totalClips = phase === 'following' ? clips.length : count;
    const clipNo = cur?.clip ?? null;
    /* the checklist: the shared steps, then one row a clip (its own current step as its detail) */
    const items = [];
    for (const st of s.stages) {
      if (!st.clip) { items.push({ id: st.id, label: st.label, status: st.status }); continue; }
      const id = `clip-${st.clip}`; let row = items.find((x) => x.id === id);
      if (!row) { row = { id, label: phase === 'following' ? `Clip ${st.clip} of ${totalClips}` : `Clip ${st.clip} of ${totalClips}`, status: 'pending', parts: [] }; items.push(row); }
      row.parts.push(st);
    }
    for (const row of items) if (row.parts) { row.status = row.parts.every((p) => p.status === 'done') ? 'done' : row.parts.some((p) => p.status !== 'pending') ? 'running' : 'pending'; row.detail = row.parts.find((p) => p.status === 'running')?.label.replace(/ (in |to )?clip \d+$/i, '').replace(/ clip \d+/i, ''); }
    /* what the person reads, a few true things about this very run, turning over every few seconds */
    const facts = (() => {
      const id = cur?.id || '', out = [];
      const clean = serverMessage.replace(/\.\.\.$|…$/, '').replace(/\bcandidates?\b/gi, (w) => (w.endsWith('s') ? 'clips' : 'clip')).replace(/^Clip (\d+):/, 'Clip $1 ·').trim();
      if (phase === 'following') {
        const pick = clipNo && clips[clipNo - 1] ? facesOf(clips[clipNo - 1]).find((f) => f.id === faces[clips[clipNo - 1].artifact_id]) : null;
        out.push(pick ? `Keeping ${pick.label || 'your pick'} in frame in clip ${clipNo}` : `Following whoever speaks in clip ${clipNo}`);
        if (captions) out.push(`Adding ${mode === 'Lines' ? 'three-to-four-word' : 'word-by-word'} captions with ${animation.toLowerCase()} in`, 'Timing every word to the voice');
        out.push('Rendering in 1080 × 1920');
      } else if (id === 'source') out.push(`Getting “${sourceTitle}”`, meta.channel ? `${meta.channel} · ${clock(meta.duration || 0)} of video` : `${clock(workDuration)} of video to look through`, range ? `Only ${clock(range.start)} – ${clock(range.end)}, the part you picked` : 'Keeping the original quality for the final clips');
      else if (id === 'speech') out.push(`Reading every word said in “${sourceTitle}”`, source.type === 'youtube-link' ? 'Using the video’s own captions when it has them' : 'Turning the speech into timed words', 'Words are timed to the audio again for each clip');
      else if (id === 'moments') out.push(`Looking for ${ask ? `“${ask}”` : momentText.toLowerCase()}`, `Weighing hooks, pacing and endings for ${count} clip${count === 1 ? '' : 's'}`, 'Checking the audio for laughs, shouts and silence');
      else if (id.startsWith('frame')) out.push(picking ? `Scanning the faces in clip ${clipNo}` : tracking === 'off' ? `Cutting clip ${clipNo}` : `Keeping whoever speaks in frame in clip ${clipNo}`, picking ? 'You choose who to follow next' : zoom && tracking !== 'off' ? 'A gentle punch-in on the face' : `${aspect} framing`);
      else if (id.startsWith('words')) out.push(`Timing each word in clip ${clipNo}`);
      else if (id.startsWith('render')) out.push(`Rendering clip ${clipNo} in 1080 × 1920`, captions && !picking ? `Burning in ${mode === 'Lines' ? 'line' : 'word'} style ${styleId} with ${animation.toLowerCase()}` : 'Clean, ready for captions');
      if (clean && !out.some((x) => x.toLowerCase() === clean.toLowerCase())) out.push(clean);
      return out;
    })();
    const fact = facts[Math.floor(tick / 34) % facts.length] || 'Starting';
    const elapsed = (Date.now() - startedAt.current) / 1000;
    return <div className="ftl-root acp-root">
      <section className="acp-run">
        <header className="acp-run-head">
          <div><h2>{phase === 'following' ? 'Following your picks' : 'Making your clips'}</h2><small>{sourceLabel}</small></div>
          {clipNo && totalClips > 1 && <span className="acp-run-count" key={clipNo}>Clip {clipNo} / {totalClips}</span>}
          <button type="button" className="ftl-btn" onClick={cancel}>Cancel</button>
        </header>
        <div className="acp-run-body">
          <div className="acp-run-main">
            <Ring percent={s.percent}/>
            <p className="acp-run-fact" key={fact}><span className="acp-shimmer-text">{fact}</span></p>
            <p className="acp-run-eta">{etaText(s.eta)}<span> · {clock(elapsed)} so far</span></p>
            {clips.length > 0 && <div className="acp-ready-strip">{clips.map((c) => <video key={`${c.output}-${c._v || ''}`} src={`${mediaOf(c.output)}${c._v ? `?v=${c._v}` : ''}`} muted playsInline preload="metadata"/>)}<small>{clips.length} ready</small></div>}
          </div>
          <Checklist items={items} live/>
        </div>
      </section>
    </div>;
  }

  /* ---------- results ---------- */
  if (phase === 'done') return <div className="ftl-root acp-root acp-results-root">
    <ClipResults clips={clips} copies={copies} titleOf={(clip, i) => clipTitle(clip, i, sourceTitle)} sourceTitle={sourceLabel} momentText={momentText} error={error} setError={setError}
      onAdjust={() => setPhase('setup')} onAgain={generate} onEditor={onEditor} onProjects={onProjects} onRewrite={(clip) => void write(clip, true)}/>
  </div>;

  /* ---------- pick a face ---------- */
  if (phase === 'faces') return <div className="ftl-root acp-root">
    <header className="acp-top"><button type="button" className="acp-back" aria-label="Back to settings" onClick={() => setPhase('setup')}><ArrowLeft size={17}/></button><div><h2>Who should the clips follow?</h2><small>Pick a face in each clip. Clyra keeps it in frame, then adds your captions.</small></div><button type="button" className="ftl-btn" onClick={() => setPhase('done')}>Skip</button><button type="button" className="sw-next acp-cta" onClick={follow}><ScanFace size={15}/> Follow and add captions</button></header>
    <div className="acp-faces">{clips.map((clip, i) => <article key={clip.output} className="acp-face-row">
      <div className="acp-face-clip"><video src={mediaOf(clip.output)} muted playsInline preload="metadata"/><span>{clip.clip_duration}</span></div>
      <div className="acp-face-body"><strong>{clipTitle(clip, i, sourceTitle)}</strong>
        {facesOf(clip).length ? <div className="acp-face-grid" role="radiogroup" aria-label={`Face to follow in clip ${i + 1}`}>{facesOf(clip).map((face, j) => <button key={face.id} type="button" role="radio" aria-checked={faces[clip.artifact_id] === face.id} className={faces[clip.artifact_id] === face.id ? 'active' : ''} onClick={() => setFaces((m) => ({ ...m, [clip.artifact_id]: face.id }))}>
          {face.thumbnailUrl ? <img src={face.thumbnailUrl} alt={`Face ${j + 1}`}/> : <ScanFace size={22}/>}<small>{face.label || `Person ${j + 1}`}</small>{faces[clip.artifact_id] === face.id && <i><Check size={11}/></i>}
        </button>)}
          <button type="button" role="radio" aria-checked={!faces[clip.artifact_id]} className={!faces[clip.artifact_id] ? 'active auto' : 'auto'} onClick={() => setFaces((m) => ({ ...m, [clip.artifact_id]: null }))}><Wand2 size={20}/><small>Whoever speaks</small></button>
        </div> : <p className="acp-muted">No clear face here: it keeps automatic framing.</p>}
      </div>
    </article>)}</div>
  </div>;

  /* ---------- setup ---------- */
  const backdrop = yt ? <img className="acp-stage-bg" src={meta.thumbnail || `https://i.ytimg.com/vi/${yt}/hqdefault.jpg`} alt="" onError={(e) => { if (!e.currentTarget.src.includes('hqdefault')) e.currentTarget.src = `https://i.ytimg.com/vi/${yt}/hqdefault.jpg`; }}/> : sourceUrl.current ? <video className="acp-stage-bg" src={sourceUrl.current} autoPlay muted loop playsInline onLoadedMetadata={(e) => { if (range) e.currentTarget.currentTime = range.start; }}/> : <div className="acp-stage-bg acp-stage-empty"/>;
  const stageView = (big = false) => <div className={`acp-stage ${aspect === '1:1' ? 'square' : aspect === '16:9' ? 'wide' : ''} ${big ? 'big' : ''}`} ref={big ? undefined : previewBox}>
    {backdrop}
    {captions && <CaptionPreview mode={mode} style={previewStyle} animation={animation} sizePct={sizePct} yPct={yPct} width={big ? Math.min(innerHeight * 0.5, 540) : previewW} word={word}/>}
    {picking && <div className="acp-face-hint"><ScanFace size={13}/> You pick the face after the clips are found</div>}
  </div>;
  const summary = [
    ['Moments', momentText],
    ['Captions', captions ? `${mode === 'Lines' ? '3–4 words' : 'One word'} · ${font || `style ${styleId}`} · ${PLACES.find(([, v]) => v === yPct)?.[0] ?? `${yPct}%`} · ${animation}` : 'Off'],
    ['Framing', tracking === 'pick' ? 'You pick a face' : tracking === 'off' ? 'Centred, no tracking' : 'Follows whoever speaks'],
    ['Part', range ? `${clock(range.start)} – ${clock(range.end)}` : meta.duration ? `All ${clock(meta.duration)}` : 'The whole video'],
  ];
  return <div className="ftl-root acp-root">
    <div className="sw-steps ftl-steps"><div>{STEPS.map((item, i) => <React.Fragment key={item}><button type="button" className={step === i ? 'active' : ''} aria-current={step === i ? 'step' : undefined} onClick={() => (i === 0 ? onBack?.() : setStep(i))}><b>{i < step ? <Check size={11}/> : i + 1}</b><span>{item}</span></button>{i < STEPS.length - 1 && <ChevronRight size={16}/>}</React.Fragment>)}</div>
      {step < STEPS.length - 1 && <button type="button" className="sw-next" onClick={() => setStep(step + 1)}>Next <ChevronRight size={15}/></button>}</div>
    {error && <div className="ftl-error" role="alert"><span>{error}</span><button type="button" aria-label="Dismiss" onClick={() => setError('')}><X size={14}/></button></div>}
    <div className="ftl-main acp-main">
      <section className="ftl-editor">
        <div className="ftl-panel-header"><strong>{['Source', 'Find moments', 'Captions', 'Framing', 'Ready to generate'][step]}</strong><span/><button type="button" className="acp-source-chip" onClick={onBack} title="Choose a different video">{yt ? <Youtube size={15} fill="#ff0033" color="#ff0033"/> : <Film size={14}/>}<span>{sourceLabel}</span></button></div>
        <div className="ftl-panel-body" key={step}>
          {step === 1 && <div className="acp-moment-list" role="radiogroup" aria-label="Moments to find">
            {MOMENTS.map(([key, name, hint]) => { const on = !custom && moment === key; return <button key={key} type="button" role="radio" aria-checked={on} className={on ? 'active' : ''} onClick={() => { setMoment(key); setCustom(false); }}><span className="acp-moment-text"><b>{name}</b><small>{hint}</small></span><i aria-hidden>{on && <Check size={11} strokeWidth={3}/>}</i></button>; })}
            <label className={`acp-moment-custom${custom ? ' active' : ''}`} onClick={() => setCustom(true)}><PenLine size={15} aria-hidden/><input aria-label="Describe your own moment" maxLength={300} value={prompt} onFocus={() => setCustom(true)} onChange={(e) => { setPrompt(e.target.value); setCustom(true); }} placeholder="Describe your own: when he opens the vault, the funniest fail…"/><i aria-hidden>{custom && <Check size={11} strokeWidth={3}/>}</i></label>
          </div>}
          {step === 2 && <>
            <Toggle label="Captions" hint="Timed to every word that is said" on={captions} onChange={setCaptions}/>
            {captions && <>
              <div className="acp-mode" role="radiogroup" aria-label="How the words show">{[['Word', 'One word', 'A single word at a time'], ['Lines', '3–4 words', 'A short line, the spoken word lit']].map(([key, name, hint]) => <button key={key} type="button" role="radio" aria-checked={mode === key} className={mode === key ? 'active' : ''} onClick={() => setMode(key)}><b>{name}</b><small>{hint}</small></button>)}</div>
              <div className="acp-tabs" role="tablist" aria-label="Caption settings">{CAPTION_TABS.map(([key, name, Icon]) => <button key={key} type="button" role="tab" aria-selected={capTab === key} className={capTab === key ? 'active' : ''} onClick={() => setCapTab(key)}><Icon size={13}/>{name}</button>)}</div>
              <div className="acp-tab-body" role="tabpanel" key={capTab}>
                {capTab === 'style' && <div className="acp-styles" role="radiogroup" aria-label="Caption style">{(mode === 'Lines' ? LINE_IDS : WORD_IDS).map((id) => { const st = customStyle(mode, id, look); return <button key={id} type="button" role="radio" aria-checked={styleId === id} aria-label={`Style ${id}`} className={styleId === id ? 'active' : ''} onClick={() => setStyleId(id)}>
                  <span className="acp-style-swatch">{mode === 'Lines' ? <span style={st.box ? { background: st.box[0], borderRadius: 4, padding: '1px 6px' } : undefined}><span style={captionCss(st, 14, false)}>Aa </span><span style={captionCss(st, 14, true)}>Bb</span></span> : <span style={captionCss(st, 16, false)}>Aa</span>}</span></button>; })}</div>}
                {capTab === 'font' && <>
                  <div className="acp-fonts" role="radiogroup" aria-label="Font">
                    <button type="button" role="radio" aria-checked={!font} className={!font ? 'active' : ''} onClick={() => setFont(null)}><span style={{ fontFamily: captionStyle(mode, styleId).font, fontWeight: captionStyle(mode, styleId).weight }}>Aa</span><small>Style’s own</small></button>
                    {CAPTION_FONTS.map((f) => <button key={f.id} type="button" role="radio" aria-checked={font === f.name} className={font === f.name ? 'active' : ''} onClick={() => setFont(f.name)} title={f.name}><span style={{ fontFamily: `'${f.name}', sans-serif` }}>Aa</span><small>{f.name}</small></button>)}
                  </div>
                  <div className="acp-inline-row"><span>Case</span><Pills label="Letter case" items={[[null, 'As styled'], [false, 'Aa'], [true, 'AA']]} value={upper} onChange={setUpper}/><label className="ftl-slider acp-size"><span>Size <b>{sizePct.toFixed(1)}%</b></span><input type="range" min="4" max="13" step="0.1" value={sizePct} onChange={(e) => setSizePct(Number(e.target.value))} aria-label="Caption size"/></label></div>
                </>}
                {capTab === 'colors' && <>
                  <Toggle label="Custom colours" hint="Your own colours over the style’s" on={customColors} onChange={setCustomColors}/>
                  <div className={`acp-colors${customColors ? '' : ' is-off'}`}>{[['text', 'Text', 'Every word'], ['spoken', mode === 'Lines' ? 'Spoken word' : 'Word', mode === 'Lines' ? 'The word being said' : 'The word on screen'], ['outline', 'Outline', 'The edge around each letter']].map(([key, name, hint]) => <div key={key} className="acp-color">
                    <label className="acp-color-well" style={{ background: colors[key] }}><input type="color" aria-label={`${name} colour`} disabled={!customColors} value={colors[key]} onChange={(e) => setColors((c) => ({ ...c, [key]: e.target.value }))}/></label>
                    <span><b>{name}</b><small>{hint}</small></span>
                    <div className="acp-swatches">{SWATCHES.map((c) => <button key={c} type="button" disabled={!customColors} aria-label={`${name} ${c}`} aria-pressed={colors[key] === c} className={colors[key] === c ? 'active' : ''} style={{ background: c }} onClick={() => setColors((v) => ({ ...v, [key]: c }))}/>)}</div>
                  </div>)}</div>
                </>}
                {capTab === 'place' && <>
                  <Section title="POSITION"><div className="acp-places" role="radiogroup" aria-label="Caption position">{PLACES.map(([name, v, Icon]) => <button key={name} type="button" role="radio" aria-checked={yPct === v} className={yPct === v ? 'active' : ''} onClick={() => setYPct(v)}><span className="acp-place-mini" aria-hidden><i style={{ top: `${v}%` }}/></span><Icon size={14}/>{name}</button>)}</div>
                    <label className="ftl-slider acp-height"><span>Fine-tune height <b>{yPct}%</b></span><input type="range" min="10" max="90" value={yPct} onChange={(e) => setYPct(Number(e.target.value))} aria-label="Caption height"/></label></Section>
                  <Section title="ANIMATION"><Pills label="Caption animation" items={ANIMATIONS.map((a) => [a, a])} value={animation} onChange={setAnimation}/></Section>
                </>}
              </div>
            </>}
          </>}
          {step === 3 && <>
            <Section title="FOLLOW FACES"><div className="acp-track" role="radiogroup" aria-label="Face tracking">{[['auto', 'Automatic', 'Keeps whoever speaks in frame', Wand2], ['pick', 'Pick a face', 'Choose who to follow once the clips are found', ScanFace], ['off', 'Off', 'A centred crop, no tracking', Film]].map(([key, name, hint, Icon]) => <button key={key} type="button" role="radio" aria-checked={tracking === key} className={tracking === key ? 'active' : ''} onClick={() => setTracking(key)}><Icon size={18}/><b>{name}</b><small>{hint}</small></button>)}</div></Section>
            {tracking !== 'off' && <>
              <Section title="CAMERA MOTION"><Pills label="Tracking motion" items={[['smooth', 'Smooth'], ['responsive', 'Responsive']]} value={motion} onChange={setMotion}/></Section>
              <Toggle label="Punch-in zoom" hint="Push in gently on the face" on={zoom} onChange={setZoom}/>
            </>}
            {picking && <div className="ftl-audio-note">After the clips are found you’ll see the faces in each one. Pick who to follow; Clyra reframes on them and adds your captions.</div>}
          </>}
          {step === 4 && <>
            <Section title="HOW MANY CLIPS"><div className="acp-count-row"><div className="acp-stepper"><button type="button" aria-label="Fewer clips" disabled={count <= 1} onClick={() => setCount((c) => Math.max(1, c - 1))}><Minus size={14}/></button><input aria-label="Number of clips" inputMode="numeric" value={count} onChange={(e) => { const n = parseInt(e.target.value.replace(/\D/g, ''), 10); if (Number.isFinite(n)) setCount(Math.min(20, Math.max(1, n))); }}/><button type="button" aria-label="More clips" disabled={count >= 20} onClick={() => setCount((c) => Math.min(20, c + 1))}><Plus size={14}/></button></div><Pills label="Quick counts" items={QUICK_COUNTS.map((n) => [n, String(n)])} value={count} onChange={setCount}/></div></Section>
            <div className="acp-two"><Section title="LENGTH"><Pills label="Clip length" items={LENGTHS.map(([k]) => [k, k])} value={length} onChange={setLength}/></Section><Section title="SHAPE"><Pills label="Aspect ratio" items={ASPECTS.map((a) => [a, a])} value={aspect} onChange={setAspect}/></Section></div>
            <Section title="SPOKEN LANGUAGE"><select className="ftl-select" aria-label="Spoken language" value={language} onChange={(e) => setLanguage(e.target.value)}>{LANGUAGES.map((l) => <option key={l}>{l}</option>)}</select></Section>
            <Toggle label="Remove filler words" hint="Cut “um”, “uh” and long pauses" on={fillers} onChange={setFillers}/>
            <Toggle label="Lead-in" hint="Start each clip two seconds early for context" on={lead} onChange={setLead}/>
            <div className="ftl-divider"/>
            <dl className="acp-summary">{summary.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
            <button type="button" className="sw-next acp-generate" onClick={generate}><Wand2 size={16}/> Generate {count} clip{count === 1 ? '' : 's'}</button>
          </>}
        </div>
      </section>
      <section className="ftl-preview acp-preview">
        <div className="ftl-panel-header"><strong>Clip preview</strong><span/><button type="button" className="acp-icon" aria-label={playing ? 'Pause preview' : 'Play preview'} onClick={() => setPlaying((v) => !v)}>{playing ? <Pause size={14}/> : <Play size={14}/>}</button><button type="button" className="acp-icon" aria-label="Fullscreen preview" onClick={() => setFull(true)}><Maximize2 size={14}/></button></div>
        <div className="acp-preview-body">{stageView()}<p className="acp-muted">{captions ? `${mode === 'Lines' ? '3–4 words' : 'One word'} · style ${styleId} · ${animation}` : 'No captions'} · {aspect}</p></div>
      </section>
    </div>
    {full && <div className="acp-full" role="dialog" aria-label="Fullscreen preview"><button type="button" className="acp-full-close" aria-label="Close fullscreen preview" onClick={() => setFull(false)}><X size={20}/></button>{stageView(true)}</div>}
  </div>;
}
