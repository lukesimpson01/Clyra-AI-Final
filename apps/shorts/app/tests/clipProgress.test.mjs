import test from 'node:test';
import assert from 'node:assert/strict';
import { planStages, stageOfEvent, createProgress, etaText } from '../src/clipProgress.js';

test('the pipeline\'s real messages land in the right stage', () => {
  assert.equal(stageOfEvent({ step: 'captions', message: 'Preparing the public video source...' }), 'source');
  assert.equal(stageOfEvent({ step: 'captions', message: "Reading the video's title and captions..." }), 'speech');
  assert.equal(stageOfEvent({ step: 'captions', message: "Using the video's own captions (2365 words)." }), 'speech');
  assert.equal(stageOfEvent({ step: 'rank', message: 'Combining transcript, audio, and visual evidence...' }), 'moments');
  assert.equal(stageOfEvent({ step: 'clip', message: 'Planning subject framing for candidate 3...' }), 'frame-3');
  assert.equal(stageOfEvent({ step: 'transcribe', message: 'Aligning word timing for candidate 2...' }), 'words-2');
  assert.equal(stageOfEvent({ step: 'render', message: 'Encoding candidate 2 of 3...' }), 'render-2');
  assert.equal(stageOfEvent({ type: 'clip_result', message: 'Candidate 1 ready' }), 'done-1');
  assert.equal(stageOfEvent({ step: 'render', message: 'Re-encoding refined clip...' }, 'follow'), 'render');
  assert.equal(stageOfEvent({ step: 'clip', message: 'Planning timestamped subject framing for saved clip...' }, 'follow'), 'subs');
});

test('progress never freezes between events, never goes back, and only reaches 100 at the end', () => {
  const stages = planStages({ duration: 760, clips: 3, clipLength: 27, faces: 'pick', captions: false, title: 'I Spent 50 Hours Buried Alive' });
  assert.equal(stages[0].label, 'Getting “I Spent 50 Hours Buried Alive”');
  assert.ok(stages.some((s) => s.label === 'Scanning faces in clip 2') && stages.some((s) => s.label === 'Rendering clip 3'));
  let t = 0; const p = createProgress(stages, t);
  p.enter('source', t);
  const seen = [];
  for (let s = 0; s <= 60; s += 5) seen.push(p.snapshot(t + s * 1000).percent);
  /* a minute in one stage with no event: still moving, a little each time, and short of that stage's share */
  for (let i = 1; i < seen.length; i++) assert.ok(seen[i] > seen[i - 1], `moved at ${i * 5}s: ${seen}`);
  const share = stages[0].expected / stages.reduce((a, s) => a + s.expected, 0) * 100;
  assert.ok(seen.at(-1) < share, `${seen.at(-1)} < ${share}`);
  t = 90_000; p.enter('speech', t); p.enter('moments', t + 12_000);
  const a = p.snapshot(t + 13_000).percent;
  p.enter('frame-1', t + 40_000);
  const b = p.snapshot(t + 40_000).percent;
  assert.ok(b > a);
  p.complete('render-3', t + 400_000);
  const end = p.snapshot(t + 400_000);
  assert.ok(end.percent < 100);
  p.finish(t + 401_000);
  assert.equal(p.snapshot(t + 401_000).percent, 100);
  assert.ok(Number.isInteger(end.percent * 10), 'one decimal');
});

test('the ETA counts down and is calibrated by how fast the stages really run', () => {
  const stages = planStages({ duration: 600, clips: 2, clipLength: 30 });
  const fast = createProgress(stages, 0), slow = createProgress(stages, 0);
  for (const [model, factor] of [[fast, 0.5], [slow, 2]]) {
    let t = 0;
    for (const s of stages.slice(0, 3)) { model.enter(s.id, t); t += s.expected * 1000 * factor; }
    model.enter(stages[3].id, t);
    for (let i = 0; i < 80; i++) model.snapshot(t);
  }
  const f = fast.snapshot(1e9 * 0).eta, s = slow.snapshot(0).eta;
  /* stages of a kind not seen yet only lean toward the run's pace (a cached download says little about framing) */
  assert.ok(s > f * 1.8, `slow run says longer: ${s} vs ${f}`);
  /* a kind that has run sets its own pace: clip 1's framing took three times its plan, so clip 2's is expected to */
  const plan = planStages({ duration: 600, clips: 2, clipLength: 30 }), m = createProgress(plan, 0);
  let t = 0;
  for (const st of plan.slice(0, 3)) { m.enter(st.id, t); t += st.expected * 1000; }
  const frame1 = plan.find((x) => x.id === 'frame-1');
  m.enter('frame-1', t); t += frame1.expected * 3000; m.enter('words-1', t);
  const asPlanned = createProgress(plan, 0); let u = 0;
  for (const st of plan.slice(0, 4)) { asPlanned.enter(st.id, u); u += st.expected * 1000; }
  asPlanned.enter('words-1', u);
  for (let i = 0; i < 80; i++) { m.snapshot(t); asPlanned.snapshot(u); }
  assert.ok(m.snapshot(t).eta - asPlanned.snapshot(u).eta > frame1.expected * 1.5, 'clip 2 framing is expected to be as slow as clip 1\'s');
  assert.equal(etaText(200), 'About 3 min left');
  assert.equal(etaText(30), 'About 30 s left');
  assert.equal(etaText(70), 'About a minute left');
});

test('a run that makes fewer clips than asked ends where they did', () => {
  const p = createProgress(planStages({ clips: 5 }), 0);
  p.trim(2);
  assert.ok(!p.stages.some((s) => s.clip > 2));
});
