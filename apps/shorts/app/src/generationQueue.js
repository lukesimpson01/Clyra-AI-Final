import { useSyncExternalStore } from 'react';
import { streamEvents } from './clipperStream.js';
import { planStages, stageOfEvent, createProgress } from './clipProgress.js';
import { writeCopy } from './clipCopy.js';
import { announceProject } from './projectThumb.js';
import { captionPayload } from './subtitleStyles.js';
import { gameplay, defaultBackground } from './FakeTextWorkspace.jsx';
import { messageTimeline } from './ClyraStudioPhone.jsx';

/* The generation queue: videos the brainstormer (or anything else) sends off to be made. The work runs in Clyra's server
   (the clipper's jobs, the story renderer), so it goes on while you move around the app, and a page reload picks the
   running jobs up again. Finished clips are written up (title, caption, hashtags) and saved to Projects.
   A job: { id, kind: 'clip' | 'fake-text', title, detail, status: queued | running | done | error | cancelled,
   percent, eta, step, params, result, error, created, startedAt, finishedAt, jobId }. */
const KEY = 'shorts-queue';
const mediaOf = (output) => `/api/clipper/media/${encodeURIComponent(String(output).split(/[\\/]/).pop())}`;
const LENGTHS = { short: 25, medium: 45, long: 75 };

const load = () => { try { const v = JSON.parse(localStorage.getItem(KEY) || '[]'); return Array.isArray(v) ? v.slice(0, 30) : []; } catch { return []; } };
let jobs = load();
const listeners = new Set(), models = new Map(), controllers = new Map();
let saveTimer = 0, ticker = 0;

const save = () => { clearTimeout(saveTimer); saveTimer = setTimeout(() => { try { localStorage.setItem(KEY, JSON.stringify(jobs.slice(0, 30))); } catch { /* storage is full or off */ } }, 400); };
const publish = () => { save(); listeners.forEach((l) => l()); };
const patch = (id, fields) => { jobs = jobs.map((j) => (j.id === id ? { ...j, ...fields } : j)); publish(); };

export const subscribe = (listener) => { listeners.add(listener); return () => listeners.delete(listener); };
export const getJobs = () => jobs;
/** The queue, live: newest first. */
export const useJobs = () => useSyncExternalStore(subscribe, getJobs);

const newId = () => `q${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const add = (job) => { const full = { status: 'queued', percent: 0, eta: null, step: 'Waiting its turn', created: Date.now(), ...job, id: newId() }; jobs = [full, ...jobs]; publish(); pump(); return full.id; };

/** Send a YouTube link to be clipped. `moment`: a preset key (viral, funny...) or a sentence. */
export function enqueueClip({ url, moment = 'viral', count = 3, length = 'medium', title = '' }) {
  return add({ kind: 'clip', title: title || 'Clips from a video', detail: `${count} clip${count === 1 ? '' : 's'} · ${moment}`, params: { url, moment, count: Math.max(1, Math.min(10, Number(count) || 3)), seconds: LENGTHS[length] || Number(length) || 45 } });
}
/** Send a text-message story to be rendered. */
export function enqueueFakeText({ name = 'Unknown', theme = 'ios-dark', messages, videoIndex = 0, background = {}, title = '' }) {
  return add({ kind: 'fake-text', title: title || `${name} story`, detail: `${messages.length} messages · ${gameplay[videoIndex]?.name || 'gameplay'}`, params: { name, theme, messages, videoIndex, background } });
}
export function cancelJob(id) {
  const job = jobs.find((j) => j.id === id); if (!job) return;
  if (job.status === 'queued') { patch(id, { status: 'cancelled', step: 'Cancelled', finishedAt: Date.now() }); return; }
  if (job.kind === 'clip' && job.jobId) void fetch(`/api/clipper/jobs/${encodeURIComponent(job.jobId)}/cancel`, { method: 'POST' }).catch(() => {});
  controllers.get(id)?.abort(); patch(id, { status: 'cancelled', step: 'Cancelled', finishedAt: Date.now() }); models.delete(id);
}
export function dismissJob(id) { jobs = jobs.filter((j) => j.id !== id); publish(); }
export function clearFinished() { jobs = jobs.filter((j) => j.status === 'queued' || j.status === 'running'); publish(); }
export function retryJob(id) {
  const job = jobs.find((j) => j.id === id); if (!job) return;
  dismissJob(id);
  add({ kind: job.kind, title: job.title, detail: job.detail, params: job.params });
}

/* ---- running ---- */
const running = (kind) => jobs.some((j) => j.kind === kind && j.status === 'running');
function pump() {
  for (const kind of ['clip', 'fake-text']) {
    if (running(kind)) continue;
    const next = [...jobs].reverse().find((j) => j.kind === kind && j.status === 'queued');
    if (next) void (kind === 'clip' ? runClip(next) : runFakeText(next));
  }
  startTicker();
}
/* the ring and the time move between the pipeline's events: a reading of every running clip's model, twice a second */
function startTicker() {
  if (ticker) return;
  ticker = setInterval(() => {
    const now = Date.now(); let changed = false;
    jobs = jobs.map((j) => {
      const model = models.get(j.id);
      if (j.status !== 'running' || !model) return j;
      const s = model.snapshot(now); changed = true;
      return { ...j, percent: s.percent, eta: s.eta, step: s.current?.label || j.step };
    });
    if (changed) publish();
    if (!jobs.some((j) => j.status === 'running')) { clearInterval(ticker); ticker = 0; }
  }, 500);
}

async function probe(url) {
  try { const r = await fetch('/api/clipper/probe', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url }) }); return r.ok ? await r.json() : null; } catch { return null; }
}

async function runClip(job, resume = false) {
  const p = job.params, ctl = new AbortController(); controllers.set(job.id, ctl);
  patch(job.id, { status: 'running', startedAt: job.startedAt || Date.now(), step: 'Reading the video' });
  startTicker();
  try {
    const info = (await probe(p.url)) || {};
    const title = info.title || job.title;
    const plan = planStages({ kind: 'generate', duration: info.duration || 600, clips: p.count, clipLength: p.seconds, fromLink: true, faces: 'auto', captions: true, title: info.title || '' });
    const model = createProgress(plan, Date.now()); model.enter('source', Date.now()); models.set(job.id, model);
    patch(job.id, { title: info.title ? `${info.title}` : job.title });
    const config = {
      moment_type: p.moment, clip_duration: p.seconds, clip_count: p.count, aspect_ratio: '9:16', render_quality: 'premium', language: 'auto', remove_fillers: false, lead_in: 0, clip_name: 'clip',
      captions_enabled: true, burn_captions: true, subtitle_style: 'phrase', caption: captionPayload({ mode: 'Lines', id: 37, animation: 'Pop', sizePct: 8.5, yPct: 72 }),
      auto_reframe: true, face_tracking: { enabled: true, mode: 'smooth', allowZoom: true, smartReframe: true, reframeMode: 'auto', speakerMode: 'auto', trackingQuality: 'balanced' },
    };
    let made = [];
    await streamEvents('/api/clipper/start', { url: p.url, config }, ctl.signal, (event) => {
      const now = Date.now(), at = stageOfEvent(event, 'generate');
      if (at?.startsWith('done-')) model.complete(`render-${at.slice(5)}`, now); else if (at) model.enter(at, now);
      if (event.type === 'clip_result' && event.result?.output) { const r = event.result; made = made.some((c) => c.output === r.output) ? made : [...made, r]; }
      else if (event.type === 'complete' && Array.isArray(event.results) && !made.length) made = event.results.filter((r) => r?.output);
    }, (id) => patch(job.id, { jobId: id }), resume ? job.jobId : null);
    model.trim(made.length); model.finish(Date.now());
    patch(job.id, { percent: 99, step: 'Writing the titles and hashtags' });
    const copies = await Promise.all(made.map((clip) => writeCopy({ clip, sourceTitle: title, channel: info.channel || '', moment: p.moment }).catch(() => null)));
    made.forEach((clip, i) => announceProject({ name: copies[i]?.title || clip.title || title, tool: '/create/auto-clip', source: mediaOf(clip.output), duration: Number.parseFloat(clip.clip_duration) || null, video: mediaOf(clip.output) }));
    patch(job.id, { status: made.length ? 'done' : 'error', percent: 100, eta: 0, step: made.length ? 'Saved to Projects' : 'No clips found', error: made.length ? '' : 'The clipper finished without a clip for this video. Try another moment.', result: { clips: made.map((c, i) => ({ output: c.output, title: copies[i]?.title || c.title })) }, finishedAt: Date.now() });
  } catch (cause) {
    if (cause?.name !== 'AbortError' && jobs.find((j) => j.id === job.id)?.status === 'running') patch(job.id, { status: 'error', step: 'Stopped', error: cause instanceof Error ? cause.message : String(cause), finishedAt: Date.now() });
  } finally { models.delete(job.id); controllers.delete(job.id); pump(); }
}

async function runFakeText(job, resume = false) {
  const p = job.params, ctl = new AbortController(); controllers.set(job.id, ctl);
  patch(job.id, { status: 'running', startedAt: job.startedAt || Date.now(), step: resume ? 'Reconnecting to the renderer' : 'Sending the story to the renderer', percent: resume ? job.percent : 1 });
  startTicker();
  try {
    const messages = p.messages.map((m, i) => ({ id: `q-${i}`, side: m.side === 'right' ? 'right' : 'left', text: String(m.text || '') }));
    const timeline = messageTimeline(messages);
    const libraryUrl = `/media/fake-text-gameplay/${(gameplay[p.videoIndex] || gameplay[0]).file}`;
    const spec = { name: p.name, theme: p.theme, sounds: true, messages, background: { ...defaultBackground, ...p.background }, durationMs: timeline.duration, videoUrl: libraryUrl, posterUrl: libraryUrl.replace('-60.mp4', '.jpg') };
    let created = { id: job.renderId };
    if (!resume) {
      const form = new FormData(); form.append('spec', JSON.stringify(spec));
      const response = await fetch('/api/story/render', { method: 'POST', body: form, signal: ctl.signal });
      created = await response.json();
      if (!response.ok) throw new Error(created.error || 'Could not start the render.');
      patch(job.id, { renderId: created.id });
    }
    const first = job.startedAt || Date.now();
    for (;;) {
      const status = await fetch(`/api/story/render/${created.id}/status`, { signal: ctl.signal }).then((r) => r.json());
      if (status.state === 'error') throw new Error(status.message || 'The render failed.');
      const pct = Math.min(99, Number(status.progress) || 0), spent = (Date.now() - first) / 1000;
      /* the renderer reports frames, not stages: the time left is the pace so far applied to what remains */
      patch(job.id, { percent: pct, step: status.message || 'Rendering', eta: pct >= 3 ? spent / pct * (100 - pct) : null });
      if (status.state === 'complete') {
        announceProject({ name: `${p.name} story`, tool: '/create/text-video', source: status.viewUrl, duration: timeline.duration / 1000 });
        patch(job.id, { status: 'done', percent: 100, step: 'Saved to Projects', result: { url: status.resultUrl, view: status.viewUrl }, finishedAt: Date.now() });
        break;
      }
      await new Promise((r) => setTimeout(r, 700));
    }
  } catch (cause) {
    if (cause?.name !== 'AbortError' && jobs.find((j) => j.id === job.id)?.status === 'running') patch(job.id, { status: 'error', step: 'Stopped', error: cause instanceof Error ? cause.message : String(cause), finishedAt: Date.now() });
  } finally { controllers.delete(job.id); pump(); }
}

/* a reload: running clip jobs are still going in Clyra, so watch them again; the rest cannot be picked up */
jobs = jobs.map((j) => {
  if (j.status === 'running' && j.kind === 'clip' && j.jobId) { queueMicrotask(() => void runClip(j, true)); return j; }
  if (j.status === 'running' && j.kind === 'fake-text' && j.renderId) { queueMicrotask(() => void runFakeText(j, true)); return j; }
  if (j.status === 'running') return { ...j, status: 'error', step: 'Stopped', error: 'The page was reloaded while this was being made. Try it again.', finishedAt: Date.now() };
  return j;
});
queueMicrotask(pump);
