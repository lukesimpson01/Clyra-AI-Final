/* The AI clipper's progress, as the person sees it: a plan of stages with an expected length each (from the video's
   length, the clip count and what is asked), moved on by the pipeline's real events. Between events the current stage
   creeps toward its end on an easing curve, so the ring never freezes and never runs past what is true; the ETA is the
   time the rest is expected to take, scaled by how fast the finished stages actually went. Pure: no DOM, no timers. */

/** The stages of a run. `kind`: 'generate' (find and make clips) or 'follow' (a picked face followed, captions burned). */
export function planStages({ kind = 'generate', duration = 600, clips = 3, clipLength = 45, fromLink = true, faces = 'auto', captions = true, title = '' } = {}) {
  const D = Math.max(30, duration), L = Math.max(10, clipLength), n = Math.max(1, clips);
  const name = title ? `“${title.length > 46 ? `${title.slice(0, 44)}…` : title}”` : 'the video';
  if (kind === 'follow') {
    return Array.from({ length: n }, (_, i) => [
      { id: `subs-${i + 1}`, clip: i + 1, label: n > 1 ? `Adding subtitles to clip ${i + 1}` : 'Adding subtitles', group: `Clip ${i + 1}`, expected: 12 + L * 3.2 },
      { id: `render-${i + 1}`, clip: i + 1, label: n > 1 ? `Rendering clip ${i + 1}` : 'Rendering', group: `Clip ${i + 1}`, expected: 10 + L * 1.4 },
    ]).flat();
  }
  const stages = [
    { id: 'source', label: `Getting ${name}`, expected: fromLink ? 15 + D * 0.08 : 6 + D * 0.01 },
    /* a link brings its own captions (seconds); an upload is transcribed in full */
    { id: 'speech', label: 'Reading the speech', expected: fromLink ? 14 : 20 + D * 0.4 },
    { id: 'moments', label: 'Finding the best moments', expected: 18 + D * 0.03 + n * 2 },
  ];
  for (let i = 1; i <= n; i++) {
    stages.push(
      { id: `frame-${i}`, clip: i, label: faces === 'off' ? `Cutting clip ${i}` : faces === 'pick' ? `Scanning faces in clip ${i}` : `Framing clip ${i}`, group: `Clip ${i}`, expected: faces === 'off' ? 8 : 12 + L * 3.2 },
      { id: `words-${i}`, clip: i, label: `Timing the words in clip ${i}`, group: `Clip ${i}`, expected: 8 + L * 0.6 },
      { id: `render-${i}`, clip: i, label: captions ? `Captioning and rendering clip ${i}` : `Rendering clip ${i}`, group: `Clip ${i}`, expected: 10 + L * 1.6 },
    );
  }
  return stages;
}

/** Which stage a pipeline event belongs to, or null (a log line, a stage it does not say). */
export function stageOfEvent(event, kind = 'generate') {
  const step = String(event?.step || ''), message = String(event?.message || '');
  const k = Number((message.match(/candidate (\d+)/i) || message.match(/clip (\d+)/i) || [])[1]) || null;
  if (kind === 'follow') {
    if (step === 'render' && /encod|re-encod|burn|export|mix/i.test(message)) return 'render';
    if (step === 'clip' || step === 'render' || step === 'subtitles') return 'subs';
    return null;
  }
  if (event?.type === 'clip_result') return k ? `done-${k}` : 'done';
  if (step === 'captions' || step === 'source-audit') return /title and captions|own captions|transcri|whisper|fish|caption words|cached timed transcript/i.test(message) ? 'speech' : step === 'source-audit' ? 'speech' : 'source';
  if (['audio', 'vision', 'ocr', 'timeline', 'analyze', 'rank', 'verify'].includes(step)) return 'moments';
  if (step === 'clip' && k) return /framing|face|track|people/i.test(message) ? `frame-${k}` : `frame-${k}`;
  if (step === 'transcribe' && k) return `words-${k}`;
  if ((step === 'render' || step === 'subtitles') && k) return `render-${k}`;
  return null;
}

/** A live model over `stages`; `now` in ms everywhere so it can be driven by a test clock. */
export function createProgress(stages, now = Date.now()) {
  const list = stages.map((s) => ({ ...s, status: 'pending', startedAt: null, endedAt: null }));
  let current = -1, shown = 0, eta = null, finished = false;
  const index = (id) => list.findIndex((s) => s.id === id);
  const total = () => list.reduce((sum, s) => sum + s.expected, 0) || 1;
  /* how fast the finished stages ran against their plan (1: as planned), per kind of stage: a cached download or a
     video's own captions says nothing about how long framing a clip takes. A kind not seen yet borrows the run's pace,
     held near the plan. */
  const family = (s) => s.id.split('-')[0];
  const ratio = (done) => {
    const planned = done.reduce((sum, s) => sum + s.expected, 0), took = done.reduce((sum, s) => sum + (s.endedAt - s.startedAt) / 1000, 0);
    return planned > 5 ? Math.min(4, Math.max(0.3, took / planned)) : null;
  };
  const pace = (s) => {
    const done = list.filter((x) => x.status === 'done' && x.startedAt != null && x.endedAt != null && x.endedAt > x.startedAt);
    const own = ratio(done.filter((x) => family(x) === family(s)));
    if (own != null) return own;
    const all = ratio(done);
    return all == null ? 1 : Math.min(1.6, Math.max(0.75, all));
  };
  const enter = (i, at) => {
    if (i < 0 || i <= current) return;
    for (let j = Math.max(0, current); j < i; j++) if (list[j].status !== 'done') { list[j].status = 'done'; list[j].startedAt ??= at; list[j].endedAt = at; }
    current = i; list[i].status = 'running'; list[i].startedAt = at;
  };
  return {
    stages: list,
    /** the pipeline is in stage `id` now (earlier ones are over) */
    enter(id, at = Date.now()) { enter(index(id), at); },
    /** stage `id` is over */
    complete(id, at = Date.now()) { const i = index(id); if (i < 0) return; enter(i, at); list[i].status = 'done'; list[i].endedAt = at; },
    /** the run has ended: everything is done */
    finish(at = Date.now()) { for (const s of list) if (s.status !== 'done') { s.status = 'done'; s.startedAt ??= at; s.endedAt = at; } finished = true; },
    /** fewer clips came back than planned: the plan ends where they did */
    trim(lastClip) { for (let i = list.length - 1; i >= 0; i--) if (list[i].clip && list[i].clip > lastClip) list.splice(i, 1); current = Math.min(current, list.length - 1); },
    /** { percent (0..100, one decimal, never down), eta (s), current, stages } at `at` */
    snapshot(at = Date.now()) {
      const all = total();
      let doneWeight = 0, remaining = 0;
      for (const [i, s] of list.entries()) {
        if (s.status === 'done') doneWeight += s.expected;
        else if (s.status === 'running') {
          const elapsed = Math.max(0, (at - s.startedAt) / 1000), expected = s.expected * pace(s);
          /* eases toward the stage's end, never reaching it until the stage is over */
          const share = Math.min(0.96, 1 - Math.exp(-elapsed / Math.max(1, expected)));
          doneWeight += s.expected * share;
          remaining += Math.max(expected * 0.08, expected - elapsed);
        } else if (i > current) remaining += s.expected * pace(s);
      }
      const target = finished ? 100 : Math.min(99.4, (doneWeight / all) * 100);
      shown = Math.max(shown, target);
      /* the ETA moves smoothly: a new estimate pulls the shown one a part of the way */
      eta = finished ? 0 : eta == null ? remaining : eta + (remaining - eta) * 0.12;
      return { percent: Math.round(shown * 10) / 10, eta: Math.max(0, eta), current: list[current] ?? null, stages: list };
    },
  };
}

/** "About 3 min left", "Less than a minute left", "About 40 s left" */
export function etaText(seconds) {
  if (seconds == null || !Number.isFinite(seconds)) return 'Working out the time…';
  if (seconds < 8) return 'Almost done';
  if (seconds < 55) return `About ${Math.max(10, Math.round(seconds / 5) * 5)} s left`;
  if (seconds < 90) return 'About a minute left';
  const m = Math.round(seconds / 60);
  return m >= 60 ? `About ${Math.floor(m / 60)} h ${m % 60} min left` : `About ${m} min left`;
}
