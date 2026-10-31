import test from 'node:test';
import assert from 'node:assert/strict';
import { createStartupReadiness, CRITICAL_STARTUP_GATES, OPTIONAL_STARTUP_GATES } from './startupReadiness.js';

test('ready resolves only after every critical gate settles', async () => {
  const r = createStartupReadiness({ timeoutMs: 60_000 });
  let resolved = false;
  r.ready.then(() => { resolved = true; });
  r.settle('location', true);
  r.settle('cameraPlaced', true);
  await Promise.resolve();
  assert.equal(resolved, false, 'localImagery still pending');
  r.settle('localImagery', true);
  const result = await r.ready;
  assert.equal(result.timedOut, false);
  assert.equal(r.isFullyReady(), true);
  assert.deepEqual(result.degraded, []);
});

test('optional gates never block the reveal', async () => {
  const r = createStartupReadiness({ timeoutMs: 60_000 });
  for (const gate of OPTIONAL_STARTUP_GATES) r.settle(gate, false);
  for (const gate of CRITICAL_STARTUP_GATES) r.settle(gate, true);
  const result = await r.ready;
  assert.equal(result.timedOut, false);
  assert.deepEqual(result.degraded, OPTIONAL_STARTUP_GATES.slice(), 'optional failures are reported');
});

test('a stuck critical gate degrades at the deadline instead of hanging', async () => {
  const r = createStartupReadiness({ timeoutMs: 20 });
  r.settle('location', true);
  r.settle('cameraPlaced', true);
  const result = await r.ready;
  assert.equal(result.timedOut, true);
  assert.deepEqual(result.degraded, ['localImagery']);
  assert.equal(r.isFullyReady(), false, 'degraded is not fully ready');
});

test('a gate settles once; later reports cannot flip it', async () => {
  const r = createStartupReadiness({ timeoutMs: 60_000 });
  r.settle('location', false);
  r.settle('location', true);
  assert.equal(r.snapshot().degraded.includes('location'), true);
});

test('unknown gates are rejected', () => {
  const r = createStartupReadiness({ timeoutMs: 60_000 });
  assert.throws(() => r.settle('weather', true), /Unknown startup gate/);
});
