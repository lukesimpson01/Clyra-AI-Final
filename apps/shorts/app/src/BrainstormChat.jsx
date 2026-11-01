import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowUp, Check, ChevronDown, Film, Link2, ListChecks, MessagesSquare, Play, RotateCcw, Scissors, Sparkles, Square, WandSparkles, X } from 'lucide-react';
import { ask } from './brainstormAgent.js';
import { enqueueClip, enqueueFakeText, useJobs } from './generationQueue.js';
import { putHandoff, peekHandoff, clearHandoff } from './handoff.js';
import QueuePanel from './QueuePanel.jsx';
import './brainstorm-chat.css';

/* The brainstormer as a chat. You talk, it proposes ideas as cards (a script, or a link and a moment), and each card can be
   opened in its tool already filled in, or sent to the background queue. Tell it to go ahead and it starts the plan itself;
   the work runs in Clyra's server and shows in the queue here and on the home screen. */
const KEY = 'shorts-brainstorm';
const STARTERS = [
  ['A fake text story with a twist', 'Write me a fake text story about a group chat that finds out one of them is not who they say they are.'],
  ['Clips from a YouTube video', 'I want clips from a YouTube video. What do you need from me?'],
  ['Ideas for a page about space', 'Give me three short video ideas for a page about space facts.'],
  ['What is working right now', 'What kind of short videos are working well right now, and which can you make for me?'],
];
const uid = () => Math.random().toString(36).slice(2, 9);
const loadChat = () => { try { const v = JSON.parse(localStorage.getItem(KEY) || '[]'); return Array.isArray(v) ? v.slice(-30) : []; } catch { return []; } };

/* the words of a reply arriving, as the chat does: a steady run of words, then the cards */
function useReveal(text, live) {
  const words = React.useMemo(() => String(text).split(/(\s+)/), [text]);
  const [n, setN] = useState(live ? 0 : words.length);
  useEffect(() => {
    if (!live) { setN(words.length); return undefined; }
    if (n >= words.length) return undefined;
    const step = Math.max(2, Math.ceil(words.length / 90));
    const t = setTimeout(() => setN((v) => Math.min(words.length, v + step)), 22);
    return () => clearTimeout(t);
  }, [n, live, words]);
  return { shown: words.slice(0, n).join(''), done: n >= words.length };
}

function Bubbles({ messages }) {
  const shown = messages.slice(0, 5);
  return <div className="bc-phone" aria-label="Preview of the first messages">
    {shown.map((m, i) => <span key={i} className={`bc-sms ${m.side}`} style={{ '--i': i }}>{m.text}</span>)}
    {messages.length > shown.length && <small>+ {messages.length - shown.length} more</small>}
  </div>;
}

function IdeaCard({ idea, queued, jobs, onOpen, onMake, onFollow, index }) {
  const job = queued && jobs.find((j) => j.id === queued);
  const Icon = idea.kind === 'fake-text' ? MessagesSquare : idea.kind === 'clip' ? Scissors : Sparkles;
  const kindLabel = idea.kind === 'fake-text' ? 'Fake text story' : idea.kind === 'clip' ? 'AI clips' : 'Idea';
  return <article className={`bc-idea k-${idea.kind}`} style={{ '--i': index }}>
    <header><span className="bc-kind"><Icon size={12}/>{kindLabel}</span>{idea.kind === 'fake-text' && <small>{idea.fakeText.messages.length} messages</small>}</header>
    <h4>{idea.title}</h4>
    {idea.pitch && <p>{idea.pitch}</p>}
    {idea.kind === 'fake-text' && <Bubbles messages={idea.fakeText.messages}/>}
    {idea.kind === 'clip' && <div className="bc-clipmeta"><span><Link2 size={12}/>{new URL(idea.clip.url).hostname.replace(/^www\./, '')}</span><span>{idea.clip.moment.length > 40 ? `${idea.clip.moment.slice(0, 38)}…` : idea.clip.moment}</span><span>{idea.clip.count} clip{idea.clip.count === 1 ? '' : 's'}</span></div>}
    {idea.kind === 'idea' && <div className="bc-follow"><button type="button" onClick={() => onFollow(`Write “${idea.title}” as a fake text story.`)}>As a fake text story</button></div>}
    {idea.kind !== 'idea' && <footer>
      {job ? <span className={`bc-state is-${job.status}`}>{job.status === 'running' ? <><i className="bc-spin"/>Making it · {Math.round(job.percent)}%</> : job.status === 'done' ? <><Check size={13} strokeWidth={3}/>Saved to Projects</> : job.status === 'queued' ? 'In the queue' : job.status === 'error' ? 'Did not finish' : 'Cancelled'}</span>
        : <><button type="button" className="bc-btn primary" onClick={() => onMake(idea)}><Play size={13} fill="currentColor"/>Make it for me</button><button type="button" className="bc-btn" onClick={() => onOpen(idea)}>Open in {idea.kind === 'fake-text' ? 'Fake Text' : 'AutoClip'}</button></>}
    </footer>}
  </article>;
}

/* the plan the brainstormer started, as the chat's to-do list: a pill with N/M, rows that spin and tick */
function Plan({ items, jobs }) {
  const [open, setOpen] = useState(true);
  const rows = items.map((it) => ({ ...it, job: jobs.find((j) => j.id === it.queueId) }));
  const done = rows.filter((r) => r.job?.status === 'done').length;
  const current = rows.find((r) => r.job?.status === 'running') || rows.find((r) => r.job?.status === 'queued');
  return <div className={`bc-plan${open ? ' is-open' : ''}`}>
    <button type="button" className="bc-plan-head" aria-expanded={open} onClick={() => setOpen((v) => !v)}><ListChecks size={14}/><span>{done === rows.length ? 'All made and saved to Projects' : current ? `Making “${current.title}”` : 'Plan'}</span><em key={done}>{done}/{rows.length}</em><ChevronDown size={13} className="bc-chev"/></button>
    <div className="bc-plan-body" data-open={open}><ol>{rows.map((r) => { const s = r.job?.status; return <li key={r.queueId} className={`is-${s === 'done' ? 'done' : s === 'running' ? 'now' : s === 'error' ? 'bad' : 'wait'}`}><span className="bc-tick" aria-hidden>{s === 'running' ? <i className="bc-spin"/> : s === 'done' ? <Check size={11} strokeWidth={3.2}/> : s === 'error' ? <X size={11} strokeWidth={3.2}/> : null}</span><span>{r.title}{s === 'running' ? <small> · {Math.round(r.job.percent)}%</small> : null}</span></li>; })}</ol></div>
  </div>;
}

function Message({ m, latest, jobs, queuedBy, actions }) {
  const { shown, done } = useReveal(m.text, latest && m.role === 'assistant' && m.fresh);
  if (m.role === 'user') return <div className="bc-msg user"><p>{m.text}</p></div>;
  return <div className={`bc-msg bot${m.error ? ' is-error' : ''}`}>
    <span className="bc-avatar" aria-hidden><WandSparkles size={14}/></span>
    <div className="bc-bot-body">
      <p>{shown}{!done && <i className="bc-caret" aria-hidden/>}</p>
      {done && m.plan?.length ? <Plan items={m.plan} jobs={jobs}/> : null}
      {done && m.ideas?.length ? <div className="bc-ideas">{m.ideas.map((idea, i) => <IdeaCard key={idea.id} idea={idea} index={i} jobs={jobs} queued={queuedBy[idea.id]} {...actions}/>)}</div> : null}
      {done && m.error && <button type="button" className="bc-retry" onClick={actions.onRetry}><RotateCcw size={13}/>Try again</button>}
    </div>
  </div>;
}

export default function BrainstormChat({ go }) {
  const [messages, setMessages] = useState(loadChat);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [queuedBy, setQueuedBy] = useState(() => { try { return JSON.parse(localStorage.getItem(`${KEY}-queued`) || '{}'); } catch { return {}; } });
  const jobs = useJobs();
  const scroller = useRef(null), field = useRef(null), ctl = useRef(null), stick = useRef(true);

  useEffect(() => { try { localStorage.setItem(KEY, JSON.stringify(messages.map(({ fresh, ...rest }) => rest))); } catch { /* storage is off */ } }, [messages]);
  useEffect(() => { try { localStorage.setItem(`${KEY}-queued`, JSON.stringify(queuedBy)); } catch { /* storage is off */ } }, [queuedBy]);
  useEffect(() => () => ctl.current?.abort(), []);
  useLayoutEffect(() => { const el = scroller.current; if (el && stick.current) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' }); });
  useEffect(() => { const el = field.current; if (el) { el.style.height = 'auto'; el.style.height = `${Math.min(el.scrollHeight, 150)}px`; } }, [text]);

  const startIdea = useCallback((idea) => {
    if (idea.kind === 'fake-text') return enqueueFakeText({ name: idea.fakeText.contact, theme: idea.fakeText.theme, messages: idea.fakeText.messages, videoIndex: idea.fakeText.videoIndex, background: idea.fakeText.background, title: idea.title });
    if (idea.kind === 'clip') return enqueueClip({ url: idea.clip.url, moment: idea.clip.moment, count: idea.clip.count, length: idea.clip.length, title: idea.title });
    return null;
  }, []);
  const ideasById = useCallback((list) => Object.fromEntries(list.flatMap((m) => m.ideas || []).map((i) => [i.id, i])), []);

  const send = useCallback(async (value) => {
    const content = String(value ?? text).trim();
    if (!content || busy) return;
    setText(''); stick.current = true;
    const history = [...messages.filter((m) => !m.error), { id: uid(), role: 'user', text: content }];
    setMessages([...messages, { id: uid(), role: 'user', text: content }]); setBusy(true);
    const abort = new AbortController(); ctl.current = abort;
    try {
      const result = await ask(history, abort.signal);
      const known = ideasById(history);
      for (const i of result.ideas) known[i.id] = i;
      const plan = [], started = {};
      for (const id of result.run) {
        const idea = known[id]; if (!idea || idea.kind === 'idea' || queuedBy[id] || started[id]) continue;
        const queueId = startIdea(idea); if (queueId) { started[id] = queueId; plan.push({ ideaId: id, queueId, title: idea.title }); }
      }
      if (Object.keys(started).length) setQueuedBy((q) => ({ ...q, ...started }));
      setMessages((m) => [...m, { id: uid(), role: 'assistant', text: result.reply, raw: result.raw, ideas: result.ideas, plan, fresh: true }]);
    } catch (cause) {
      if (cause?.name !== 'AbortError') setMessages((m) => [...m, { id: uid(), role: 'assistant', text: cause.message || 'Something went wrong.', error: true, fresh: true }]);
    } finally { setBusy(false); ctl.current = null; field.current?.focus(); }
  }, [text, busy, messages, queuedBy, startIdea, ideasById]);

  /* a question typed on the home screen opens this chat already sent */
  useEffect(() => { const given = peekHandoff('brainstorm'); if (given?.prompt) { clearHandoff(); void send(given.prompt); } }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const actions = {
    onMake: (idea) => { const id = startIdea(idea); if (id) setQueuedBy((q) => ({ ...q, [idea.id]: id })); },
    onOpen: (idea) => {
      if (idea.kind === 'fake-text') { putHandoff('fake-text', { name: idea.fakeText.contact, messages: idea.fakeText.messages, theme: idea.fakeText.theme, videoIndex: idea.fakeText.videoIndex, background: idea.fakeText.background }); go('/create/text-video'); }
      else { putHandoff('clip', idea.clip); go('/create/auto-clip'); }
    },
    onFollow: (q) => void send(q),
    onRetry: () => { const last = [...messages].reverse().find((m) => m.role === 'user'); setMessages((m) => m.filter((x) => !x.error)); if (last) void send(last.text); },
  };
  const newChat = () => { ctl.current?.abort(); setMessages([]); setQueuedBy({}); setBusy(false); setText(''); };
  const empty = messages.length === 0;
  const lastBot = [...messages].reverse().find((m) => m.role === 'assistant');

  return <div className="bc-root">
    <section className="bc-chat" aria-label="Brainstormer chat">
      <header className="bc-head"><span className="bc-badge"><WandSparkles size={16}/></span><div><h2>AI Brainstormer</h2><p>Plan a video with me, then I can make it in the background.</p></div>{!empty && <button type="button" className="bc-new" onClick={newChat}>New chat</button>}</header>
      <div className="bc-scroll" ref={scroller} onScroll={(e) => { const el = e.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80; }}>
        <div className="bc-thread" role="log" aria-live="polite">
          {empty && <div className="bc-empty"><span className="bc-orb"><WandSparkles size={22}/></span><h3>What should we make?</h3><p>Describe an idea, or paste a YouTube link. I will write the script or pick the moments, and you decide whether to open it or let me make it.</p>
            <div className="bc-starters">{STARTERS.map(([label, prompt]) => <button key={label} type="button" onClick={() => send(prompt)}>{label}</button>)}</div></div>}
          {messages.map((m) => <Message key={m.id} m={m} latest={m === lastBot} jobs={jobs} queuedBy={queuedBy} actions={actions}/>)}
          {busy && <div className="bc-msg bot" role="status"><span className="bc-avatar" aria-hidden><WandSparkles size={14}/></span><div className="bc-bot-body"><p className="bc-think"><span>Thinking it through</span><i/><i/><i/></p></div></div>}
        </div>
      </div>
      <form className="bc-composer" onSubmit={(e) => { e.preventDefault(); void send(); }}>
        <textarea ref={field} rows={1} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(); } }} placeholder={empty ? 'Describe a video, or paste a YouTube link…' : 'Reply, or say “do it” to start making them…'} aria-label="Message the brainstormer"/>
        {busy ? <button type="button" className="bc-send stop" aria-label="Stop" onClick={() => ctl.current?.abort()}><Square size={12} fill="currentColor"/></button> : <button type="submit" className="bc-send" aria-label="Send" disabled={!text.trim()}><ArrowUp size={16} strokeWidth={2.4}/></button>}
      </form>
    </section>
    <div className="bc-side"><QueuePanel go={go} title="Making in the background"/></div>
  </div>;
}
