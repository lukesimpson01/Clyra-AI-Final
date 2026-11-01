import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Check, ChevronRight, Import, Pause, Play, Plus, Search, Send, Shuffle, Trash2, Upload, Wand2, X } from 'lucide-react';
import ClyraStudioPhone, { messageTimeline } from './ClyraStudioPhone.jsx';
import ClyraStudioTheme from './ClyraStudioTheme.jsx';
import { announceProject } from './projectThumb.js';
import { peekHandoff, clearHandoff } from './handoff.js';
import { fileToDataUrl } from './imageData.js';
import ClyraStudioScript from './ClyraStudioScript.jsx';
import './fake-text-workspace.css';
import EmbedAddButton from './EmbedAddButton.jsx';

const steps = ['Script', 'Theme', 'Video', 'Audio'];
export const gameplay = [
  { name: 'Subway-style', category: 'Subway', file: 'subway-01-60.mp4' },
  { name: 'Minecraft Parkour', category: 'Minecraft', file: 'minecraft-01-60.mp4' },
  { name: 'Driving', category: 'GTA', file: 'gta-01-60.mp4' },
  { name: 'Trackmania', category: 'Trackmania', file: 'trackmania-01-60.mp4' },
];
const sampleMessages = [
  { id: 'sample-1', side: 'left', text: 'hello' },
  { id: 'sample-2', side: 'right', text: 'hey bro' },
  { id: 'sample-3', side: 'right', text: 'what is going on?' },
  { id: 'sample-4', side: 'left', text: 'nothing much' },
];
const defaultTheme = 'ios-dark';
export const defaultBackground = { zoom: 100, speed: 100, offsetX: 0, offsetY: 0, dim: 0, blur: 0, trim: 0, muted: true };
const createMessage = (side, text = '', extra = {}) => ({ id: `ft-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`, side, text, ...extra });

function Slider({ label, value, min, max, unit = '%', onChange }) {
  return <label className="ftl-slider"><span>{label}<b>{value}{unit}</b></span><input type="range" min={min} max={max} value={value} onChange={event => onChange(Number(event.target.value))}/></label>;
}
function Toggle({ label, value, onChange }) {
  return <div className="ftl-toggle"><span>{label}</span><button role="switch" aria-checked={value} aria-label={label} className={value ? 'on' : ''} onClick={() => onChange(!value)}><i/></button></div>;
}
function Button({ children, onClick, primary, danger, disabled }) {
  return <button type="button" className={`ftl-btn ${primary ? 'primary' : ''} ${danger ? 'danger' : ''}`} onClick={onClick} disabled={disabled}>{children}</button>;
}

/* `embed`: inside the advanced editor's sidebar (src/EmbedTool.jsx): the same menu, its state handed to `onState`. */
export default function FakeTextWorkspace({ go, embed = false, initial: given = null, onState }) {
  /* a script handed over by the brainstormer opens the workspace already filled in */
  const [handed] = useState(() => (embed || given ? null : peekHandoff('fake-text')));
  useEffect(() => { if (handed) clearHandoff(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const initial = given ?? (handed ? { name: handed.name, messages: (handed.messages || []).map((m) => ({ id: `ft-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`, side: m.side === 'right' ? 'right' : 'left', text: String(m.text || '') })), theme: handed.theme, videoIndex: handed.videoIndex, background: handed.background } : null);
  const requested = new URLSearchParams(location.search).get('step');
  const [step, setStep] = useState(Math.max(0, ['script', 'theme', 'video', 'audio'].indexOf(requested)));
  const [name, setName] = useState(initial?.name ?? 'Unknown');
  const [avatar, setAvatar] = useState(initial?.avatar ?? '');
  const [messages, setMessages] = useState(initial?.messages?.length ? initial.messages : sampleMessages);
  const [theme, setTheme] = useState(initial?.theme ?? defaultTheme);
  const [videoIndex, setVideoIndex] = useState(initial?.videoIndex ?? 0);
  const [uploadedVideo, setUploadedVideo] = useState('');
  const [background, setBackground] = useState({ ...defaultBackground, ...(initial?.background || {}) });
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [side, setSide] = useState('left');
  const [composer, setComposer] = useState('');
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState('');
  const [confirmClear, setConfirmClear] = useState(false);
  const [busy, setBusy] = useState(false);
  const [writerOpen, setWriterOpen] = useState(false);
  const [writerTopic, setWriterTopic] = useState('');
  const [writerTone, setWriterTone] = useState('Funny');
  const [writerCount, setWriterCount] = useState(8);
  const [category, setCategory] = useState('All');
  const [voiceQuery, setVoiceQuery] = useState('');
  const [receiverVoice, setReceiverVoice] = useState('William');
  const [senderVoice, setSenderVoice] = useState('Natasha');
  const [language, setLanguage] = useState('Auto Detect Language');
  const [voiceVolume, setVoiceVolume] = useState(70);
  const [progress, setProgress] = useState(null);
  const [renderStatus, setRenderStatus] = useState('');
  const [renderUrl, setRenderUrl] = useState('');
  const [renderViewUrl, setRenderViewUrl] = useState('');
  const [error, setError] = useState('');
  const avatarInput = useRef(null);
  const importFileInput = useRef(null);
  const imageInput = useRef(null);
  const imageUrls = useRef([]);
  const videoInput = useRef(null);
  const dragFrom = useRef(null);
  const progressFrame = useRef(0);
  const renderRun = useRef(0);
  const renderedViewer = useRef(null);
  const renderedBlur = useRef(null);
  const timeline = useMemo(() => messageTimeline(messages), [messages]);

  useEffect(() => () => { if (avatar.startsWith('blob:')) URL.revokeObjectURL(avatar); }, [avatar]);
  useEffect(() => () => { if (uploadedVideo.startsWith('blob:')) URL.revokeObjectURL(uploadedVideo); }, [uploadedVideo]);
  useEffect(() => () => imageUrls.current.forEach(url => URL.revokeObjectURL(url)), []);
  useEffect(() => () => { cancelAnimationFrame(progressFrame.current); renderRun.current++; }, []);
  useEffect(() => { setPlaying(false); setTime(value => Math.min(value, timeline.duration)); }, [timeline.duration]);

  const patchBackground = patch => setBackground(previous => ({ ...previous, ...patch }));
  const move = index => { setPlaying(false); setTime(0); setStep(index); if (!embed) history.replaceState({}, '', `${location.pathname}?step=${['script', 'theme', 'video', 'audio'][index]}`); };
  useEffect(() => { if (embed) onState?.({ name, avatar, messages, theme, videoIndex, gameplayFile: gameplay[videoIndex]?.file }); }, [embed, name, avatar, messages, theme, videoIndex]);
  const updateMessage = (id, patch) => setMessages(items => items.map(item => item.id === id ? { ...item, ...patch } : item));
  const addMessage = (which = side, text = '', extra = {}) => { const added = createMessage(which, text, extra); setMessages(items => [...items, added]); setTime(timeline.duration - 600); };
  const addImage = event => { const file = event.target.files?.[0]; if (!file) return; if (!file.type.startsWith('image/')) { setError('Choose an image file.'); return; } event.target.value = ''; void fileToDataUrl(file).then(imageUrl => addMessage(side, '', { imageUrl, imageName: file.name })); };
  const submit = () => { if (!composer.trim()) return; addMessage(side, composer.trim()); setComposer(''); };
  const swapAll = () => setMessages(items => items.map(item => ({ ...item, side: item.side === 'left' ? 'right' : 'left' })));
  const reorder = (from, to) => { if (from === null || from === to) return; setMessages(items => { const next = [...items]; const [item] = next.splice(from, 1); next.splice(to, 0, item); return next; }); };
  const importFile = async event => { const file = event.target.files?.[0]; if (!file) return; try { const text = await file.text(); let lines = []; if (file.name.toLowerCase().endsWith('.json')) { const obj = JSON.parse(text); if (Array.isArray(obj)) lines = obj; else if (Array.isArray(obj.messages)) { lines = obj.messages; if (obj.profile) setName(String(obj.profile)); if (['ios-light','ios-dark','whatsapp-light','whatsapp-dark'].includes(obj.theme)) setTheme(obj.theme); } else throw Error('JSON must contain a messages array'); } else lines = text.split(/\r?\n/).filter(Boolean).map(value => { const match = value.match(/^(sender|receiver|a|b)\s*:\s*(.*)$/i); return { from: match && /^(sender|a)$/i.test(match[1]) ? 'sender' : 'receiver', text: match ? match[2] : value }; }); setMessages(lines.map((m, i) => ({ id: createMessage('left').id, side: m.from === 'sender' ? 'right' : i % 2 ? 'right' : 'left', text: String(m.text || m.message || '').slice(0, 500) })).filter(m => m.text.trim())); setPlaying(false); setTime(0); } catch (cause) { setError('Import failed: ' + cause.message); } finally { event.target.value = ''; } };
  const importMessages = () => {
    const parsed = importText.split('\n').map(value => value.trim()).filter(Boolean).map((line, i) => {
      const matched = line.match(/^(left|right|sender|receiver|me|them)\s*:\s*(.+)$/i);
      const from = matched ? /^(right|sender|me)$/i.test(matched[1]) ? 'right' : 'left' : i % 2 ? 'right' : 'left';
      return createMessage(from, matched ? matched[2] : line);
    });
    setMessages(items => [...items, ...parsed]); setImportText(''); setImportOpen(false); setTime(0);
  };
  const writeStory = async () => {
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/story/ai-writer', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ topic: writerTopic, tone: writerTone, count: writerCount }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'The local story writer could not finish.');
      setMessages(result.messages.map(item => createMessage(item.side, item.text)));
      setPlaying(false); setTime(0); setWriterOpen(false);
    } catch (cause) { setError(cause.message); }
    finally { setBusy(false); }
  };
  const generate = async () => {
    if (!messages.some(message => message.text.trim() || message.imageUrl)) { setError('Add a message before generating.'); move(0); return; }
    const run = ++renderRun.current;
    setError(''); setPlaying(false); setProgress(0); setRenderUrl(''); setRenderViewUrl(''); setRenderStatus('Uploading story media');
    try {
      const form = new FormData();
      const libraryUrl = `/media/fake-text-gameplay/${gameplay[videoIndex].file}`;
      const spec = { name, theme, messages: messages.map(({ id, side, text, imageName }) => ({ id, side, text, imageName })), background, durationMs: timeline.duration, videoUrl: uploadedVideo ? '' : libraryUrl, posterUrl: uploadedVideo ? '' : libraryUrl.replace('-60.mp4', '.jpg') };
      if (uploadedVideo) {
        const source = await fetch(uploadedVideo);
        form.append('video', await source.blob(), 'background.mp4');
      }
      for (let index = 0; index < messages.length; index++) {
        if (!messages[index].imageUrl) continue;
        const source = await fetch(messages[index].imageUrl);
        form.append(`image-${index}`, await source.blob(), messages[index].imageName || `message-${index}.png`);
      }
      form.append('spec', JSON.stringify(spec));
      const response = await fetch('/api/story/render', { method: 'POST', body: form });
      const created = await response.json();
      if (!response.ok) throw new Error(created.error || 'Could not start the MP4 render.');
      while (renderRun.current === run) {
        const statusResponse = await fetch(`/api/story/render/${created.id}/status`);
        const status = await statusResponse.json();
        if (!statusResponse.ok) throw new Error(status.error || 'The render was interrupted.');
        setProgress(status.progress);
        setRenderStatus(status.message);
        if (status.state === 'error') throw new Error(status.message || 'The render failed.');
        if (status.state === 'complete') { setRenderUrl(status.resultUrl); setRenderViewUrl(status.viewUrl); if (!embed) announceProject({ name: `${name || 'Fake text'} story`, source: status.viewUrl }); break; }
        await new Promise(resolve => setTimeout(resolve, 650));
      }
    } catch (cause) { if (renderRun.current === run) { setProgress(null); setError(cause.message); } }
  };
  const videoUrl = uploadedVideo || `/media/fake-text-gameplay/${gameplay[videoIndex].file}`;

  return <div className={`ftl-root ${step === 0 ? 'ftl-script-source' : ''}`}><input ref={importFileInput} type="file" accept=".txt,.json,text/plain,application/json" hidden onChange={importFile}/><input ref={imageInput} type="file" accept="image/*" hidden onChange={addImage}/>
    <div className="sw-steps ftl-steps"><div>{steps.map((item, i) => <React.Fragment key={item}><button type="button" className={step === i ? 'active' : ''} onClick={() => move(i)}><b>{i + 1}</b><span>{item}</span></button>{i < 3 && <ChevronRight size={16}/>}</React.Fragment>)}</div>{embed && step === 3 ? <EmbedAddButton /> : <button className="sw-next" onClick={() => step === 3 ? generate() : move(step + 1)}>{step === 3 ? 'Generate ✨' : 'Next ❯'}</button>}</div>
    {error && <div className="ftl-error" role="alert">{error}<button onClick={() => setError('')}><X size={14}/></button></div>}
    <div className="ftl-main"><section className="ftl-editor"><div className="ftl-panel-header"><strong>{['Text Script', 'Choose Theme', 'Choose Background', 'Voice & Audio'][step]}</strong><span/>{step === 0 && <><Button onClick={() => setImportOpen(true)}><Import size={13}/> Import</Button><Button primary onClick={() => setWriterOpen(true)} disabled={busy}><Wand2 size={13}/> {busy ? 'Writing…' : 'AI Writer'}</Button></>}</div><div className="ftl-panel-body" key={step}>
      {step === 0 && <ClyraStudioScript name={name} onName={setName} messages={messages} onMessage={updateMessage} onSwapMessage={id => updateMessage(id, { side: messages.find(m => m.id === id)?.side === 'left' ? 'right' : 'left' })} onDeleteMessage={id => setMessages(items => items.filter(m => m.id !== id))} onSwapAll={swapAll} onDeleteAll={() => { setMessages([]); setConfirmClear(false); setTime(0); }} onImport={() => importFileInput.current?.click()} onAI={() => setWriterOpen(true)} onAddImage={() => imageInput.current?.click()} busy={busy} side={side} onSide={setSide} composer={composer} onComposer={setComposer} onSubmit={submit} onAdd={() => addMessage(side)} onReorder={reorder} dragFrom={dragFrom} confirmClear={confirmClear} onConfirmClear={() => confirmClear ? (setMessages([]), setConfirmClear(false), setTime(0)) : setConfirmClear(true)}/>} 
      {step === 1 && <ClyraStudioTheme theme={theme} onChange={setTheme} name={name} messages={messages}/>}
      {step === 2 && <>
        <div className="ftl-label">UPLOAD</div><button className="ftl-upload" onClick={() => videoInput.current?.click()}><Upload size={19}/><span>{uploadedVideo ? 'Uploaded background video selected' : 'Click to upload a background video'}</span></button><input ref={videoInput} type="file" accept="video/mp4,video/quicktime,video/webm" hidden onChange={event => { const file = event.target.files?.[0]; if (file) setUploadedVideo(URL.createObjectURL(file)); }}/><div className="ftl-divider"/>
        <div className="ftl-section-heading"><strong>CHOOSE FROM LIBRARY</strong><div className="ftl-pills">{['All', 'Subway', 'Minecraft', 'GTA', 'Trackmania'].map(item => <button key={item} className={category === item ? 'active' : ''} onClick={() => setCategory(item)}>{item}</button>)}</div></div><div className="ftl-gameplay-grid">{gameplay.map((item, i) => category !== 'All' && item.category !== category ? null : <button key={item.file} className={videoIndex === i && !uploadedVideo ? 'active' : ''} onClick={() => { setVideoIndex(i); setUploadedVideo(''); }}><div><img src={`/media/fake-text-gameplay/${item.file.replace("-60.mp4",".jpg")}`} alt=""/><Play size={18}/></div><strong>{item.name}</strong></button>)}</div>
        <div className="ftl-divider"/><div className="ftl-slider-grid"><Slider label="Scale" value={background.zoom} min={100} max={200} onChange={value => patchBackground({ zoom: value })}/><Slider label="Playback speed" value={background.speed} min={50} max={200} onChange={value => patchBackground({ speed: value })}/><Slider label="Horizontal position" value={background.offsetX} min={-50} max={50} onChange={value => patchBackground({ offsetX: value })}/><Slider label="Vertical position" value={background.offsetY} min={-50} max={50} onChange={value => patchBackground({ offsetY: value })}/><Slider label="Darken" value={background.dim} min={0} max={90} onChange={value => patchBackground({ dim: value })}/><Slider label="Blur" value={background.blur} min={0} max={40} unit="px" onChange={value => patchBackground({ blur: value })}/><Slider label="Start point" value={background.trim} min={0} max={30} unit="s" onChange={value => patchBackground({ trim: value })}/></div><Toggle label="Mute original gameplay audio" value={background.muted} onChange={value => patchBackground({ muted: value })}/>
      </>}
      {step === 3 && <>
        <p className="ftl-audio-note">Voice playback is a local browser sample. Generated speech is not connected.</p><label className="ftl-search"><Search size={15}/><input placeholder="Search voices" value={voiceQuery} onChange={event => setVoiceQuery(event.target.value)}/></label>{[['Receiver voice', receiverVoice, setReceiverVoice], ['Sender voice', senderVoice, setSenderVoice]].map(([label, selected, setter]) => <div className="ftl-voice-section" key={label}><div className="ftl-label">{label.toUpperCase()}</div><div className="ftl-voice-grid">{['William', 'Adam', 'Natasha', 'Rachel', 'Elli', 'Josh', 'Nicole', 'Roger'].filter(item => item.toLowerCase().includes(voiceQuery.toLowerCase())).map(item => <button key={item} className={selected === item ? 'active' : ''} onClick={() => setter(item)}><strong>{item}</strong><span onClick={event => { event.stopPropagation(); speechSynthesis.cancel(); const utterance = new SpeechSynthesisUtterance(`Hello, I am ${item}.`); speechSynthesis.speak(utterance); }}><Play size={12}/></span></button>)}</div></div>)}<div className="ftl-divider"/><div className="ftl-label">LANGUAGE & VOICE SETTINGS</div><select className="ftl-select" value={language} onChange={event => setLanguage(event.target.value)}>{['Auto Detect Language', 'English', 'Spanish', 'French', 'German', 'Portuguese'].map(item => <option key={item}>{item}</option>)}</select><Slider label="Voice volume" value={voiceVolume} min={0} max={100} onChange={setVoiceVolume}/>
      </>}
    </div></section><aside className="ftl-preview"><ClyraStudioPhone name={name} avatar={avatar} messages={messages} theme={theme} videoUrl={videoUrl} posterUrl={uploadedVideo ? '' : '/media/fake-text-gameplay/' + gameplay[videoIndex].file.replace('-60.mp4', '.jpg')} background={background} time={time} setTime={setTime} playing={playing} setPlaying={setPlaying}/></aside></div>
    {importOpen && <div className="ftl-modal-shade"><div className="ftl-modal" role="dialog" aria-modal="true" aria-label="Import messages"><div><h3>Import messages</h3><button aria-label="Close" onClick={() => setImportOpen(false)}><X size={17}/></button></div><p>Paste one message per line. Optional prefixes: left:, right:, receiver:, sender:.</p><textarea value={importText} onChange={event => setImportText(event.target.value)} placeholder={'left: Hey, got a sec?\nright: Yeah, what’s up?'}/><footer><Button onClick={() => setImportOpen(false)}>Cancel</Button><Button primary onClick={importMessages} disabled={!importText.trim()}>Add messages</Button></footer></div></div>}
    {writerOpen && <div className="ftl-modal-shade"><form className="ftl-modal ftl-writer-modal" role="dialog" aria-modal="true" aria-label="Local story writer" onSubmit={event => { event.preventDefault(); void writeStory(); }}><div><h3>Write a text story</h3><button type="button" aria-label="Close" onClick={() => setWriterOpen(false)}><X size={17}/></button></div><p>Describe the idea. A local script engine will draft a conversation; no LLM or external service is connected.</p><label>Story idea<input autoFocus value={writerTopic} onChange={event => setWriterTopic(event.target.value)} placeholder="A surprising message about..." maxLength={120} required/></label><div className="ftl-writer-controls"><label>Tone<select value={writerTone} onChange={event => setWriterTone(event.target.value)}>{['Funny','Suspense','Sweet','Casual'].map(item => <option key={item}>{item}</option>)}</select></label><label>Messages<input type="number" min="4" max="16" value={writerCount} onChange={event => setWriterCount(Number(event.target.value))}/></label></div><footer><Button onClick={() => setWriterOpen(false)}>Cancel</Button><button className="ftl-btn primary" type="submit" disabled={busy || !writerTopic.trim()}>{busy ? 'Writing…' : 'Draft story'}</button></footer></form></div>}
    {progress !== null && <div className="ftl-modal-shade"><div className="ftl-generating" role="status"><div className="ftl-progress-ring" style={{ '--progress': `${progress}%` }}><strong>{progress}%</strong></div><h3>{renderUrl ? 'Your MP4 is ready' : 'Rendering your story'}</h3><p>{renderStatus}</p><small>9:16 · 720 × 1280 · 60 fps · local render</small>{renderUrl && <><div className="ftl-export-viewer" ref={renderedViewer}><video ref={renderedBlur} className="ftl-export-blur" src={renderViewUrl} muted playsInline aria-hidden="true"/><video className="ftl-export-main" src={renderViewUrl} controls playsInline onPlay={event => { const blur = renderedBlur.current; if (blur) { blur.currentTime = event.currentTarget.currentTime; void blur.play().catch(() => {}); } }} onPause={() => renderedBlur.current?.pause()} onSeeking={event => { if (renderedBlur.current) renderedBlur.current.currentTime = event.currentTarget.currentTime; }}/></div><div className="ftl-render-actions"><a href={renderUrl} download="fake-text-story-60fps.mp4">Download MP4</a><button type="button" onClick={() => renderedViewer.current?.requestFullscreen?.()}>Watch fullscreen</button><button type="button" onClick={() => { setProgress(null); setRenderUrl(''); setRenderViewUrl(''); }}>Close</button></div></>}</div></div>}
  </div>;
}
