import test from 'node:test';
import assert from 'node:assert/strict';
import { createNominatimLimiter } from './nominatimLimiter.js';

const response = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

test('requests are serialized at no more than one per second', async () => {
  let clock = 0;
  const starts = [];
  const limiter = createNominatimLimiter({
    now: () => clock,
    sleep: async (ms) => { clock += ms; },
    fetchImpl: async (url) => { starts.push(clock); return response([{ url }]); },
  });
  await Promise.all([limiter.request('a', 'https://n/a'), limiter.request('b', 'https://n/b'), limiter.request('c', 'https://n/c')]);
  assert.equal(starts.length, 3);
  assert.ok(starts[1] - starts[0] >= 1000);
  assert.ok(starts[2] - starts[1] >= 1000);
});

test('identical in-flight queries share one request', async () => {
  let calls = 0;
  let clock = 0;
  const limiter = createNominatimLimiter({
    now: () => clock,
    sleep: async () => {},
    fetchImpl: async () => { calls += 1; return response([{ name: 'Sydney' }]); },
  });
  const [x, y] = await Promise.all([limiter.request('sydney', 'https://n/s'), limiter.request('sydney', 'https://n/s')]);
  assert.equal(calls, 1);
  assert.deepEqual(x.data, y.data);
});

test('fresh results are served from cache without a request; expired ones are refetched', async () => {
  let calls = 0;
  let clock = 0;
  const limiter = createNominatimLimiter({
    now: () => clock,
    sleep: async () => {},
    cacheTtlMs: 1000,
    fetchImpl: async () => { calls += 1; return response([{ n: calls }]); },
  });
  await limiter.request('k', 'https://n/k');
  const hit = await limiter.request('k', 'https://n/k');
  assert.equal(hit.cached, true);
  assert.equal(calls, 1);
  clock = 5000;
  await limiter.request('k', 'https://n/k');
  assert.equal(calls, 2);
});

test('the cache is bounded and evicts least-recently-used entries', async () => {
  let calls = 0;
  const limiter = createNominatimLimiter({
    now: () => 0,
    sleep: async () => {},
    cacheLimit: 2,
    fetchImpl: async () => { calls += 1; return response([]); },
  });
  await limiter.request('a', 'u');
  await limiter.request('b', 'u');
  await limiter.request('a', 'u');
  await limiter.request('c', 'u');
  assert.equal(limiter.stats().cached, 2);
  calls = 0;
  await limiter.request('b', 'u');
  assert.equal(calls, 1, 'b was evicted');
});

test('HTTP 429 is reported as rate-limited and never cached', async () => {
  const limiter = createNominatimLimiter({ now: () => 0, sleep: async () => {}, fetchImpl: async () => response({}, 429) });
  const result = await limiter.request('busy', 'u');
  assert.equal(result.rateLimited, true);
  assert.equal(limiter.stats().cached, 0);
});

test('a network failure returns a clean error and does not poison the queue', async () => {
  let n = 0;
  const limiter = createNominatimLimiter({
    now: () => 0,
    sleep: async () => {},
    fetchImpl: async () => { n += 1; if (n === 1) throw new TypeError('Failed to fetch'); return response([{ ok: true }]); },
  });
  const failed = await limiter.request('x', 'u');
  assert.deepEqual(failed, { ok: false, error: 'network unavailable' });
  const next = await limiter.request('y', 'u');
  assert.equal(next.ok, true);
});

test('the User-Agent identifies Clyra Eye on every request', async () => {
  let agent = null;
  const limiter = createNominatimLimiter({
    now: () => 0,
    sleep: async () => {},
    fetchImpl: async (_u, init) => { agent = init.headers['User-Agent']; return response([]); },
  });
  await limiter.request('ua', 'u');
  assert.match(agent, /ClyraEye/);
});
