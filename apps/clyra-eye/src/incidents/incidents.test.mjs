import test from 'node:test';
import assert from 'node:assert/strict';
import {
  deduplicateIncidents, incidentsWithin, normalizeEonetEvent, normalizeUsgsFeature, rankIncidents,
  statusForAge,
} from './normalize.js';
import {
  createIncidentRegistry, fetchEonetIncidents, fetchUsgsIncidents, recordOutcome, createProviderState,
  nextAttemptDelay, tfnswCapability, youtubeCapability, PROVIDER_HEALTH,
} from './providers.js';

const NOW = Date.parse('2026-10-05T12:00:00Z');
const quake = (overrides = {}, geometry = {}) => ({
  type: 'Feature', id: 'us7000abcd',
  geometry: { type: 'Point', coordinates: [139.7, 35.7, 22.5], ...geometry },
  properties: { mag: 5.4, place: '20 km E of Tokyo, Japan', time: NOW - 3_600_000, updated: NOW - 1_800_000,
    url: 'https://earthquake.usgs.gov/earthquakes/eventpage/us7000abcd', status: 'reviewed', ...overrides },
});
const eonetEvent = (overrides = {}) => ({
  id: 'EONET_1', title: 'Wildfire near Lisbon', categories: [{ id: 'wildfires', title: 'Wildfires' }],
  sources: [{ id: 'InciWeb', url: 'https://example.gov/fire' }], closed: null,
  link: 'https://eonet.gsfc.nasa.gov/api/v3/events/EONET_1',
  geometry: [{ type: 'Point', date: new Date(NOW - 7_200_000).toISOString(), coordinates: [-9.1, 38.7] }], ...overrides,
});
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

test('USGS features normalize into the Incident model with provenance', () => {
  const incident = normalizeUsgsFeature(quake(), { now: NOW });
  assert.equal(incident.type, 'earthquake');
  assert.equal(incident.severity, 5.4);
  assert.equal(incident.status, 'active');
  assert.equal(incident.depthKm, 22.5);
  assert.deepEqual(incident.coordinates, [{ lat: 35.7, lon: 139.7 }]);
  assert.equal(incident.sourceLinks[0].provider, 'USGS');
  assert.equal(incident.confidence, 1);
  assert.match(incident.attribution, /U\.S\. Geological Survey/);
});

test('malformed USGS features are rejected individually, not as a whole feed', () => {
  assert.equal(normalizeUsgsFeature(quake({}, { coordinates: [139, 120, 1] }), { now: NOW }), null, 'bad latitude');
  assert.equal(normalizeUsgsFeature(quake({ mag: 'big' }), { now: NOW }), null, 'magnitude not a number');
  assert.equal(normalizeUsgsFeature(quake({}, { type: 'Polygon' }), { now: NOW }), null, 'not a point');
  assert.equal(normalizeUsgsFeature({ id: 'x' }, { now: NOW }), null, 'no geometry');
  assert.equal(normalizeUsgsFeature(null, { now: NOW }), null);
});

test('unsafe source links are dropped, never rendered', () => {
  const incident = normalizeUsgsFeature(quake({ url: 'javascript:alert(1)' }), { now: NOW });
  assert.deepEqual(incident.sourceLinks, []);
});

test('incident status follows the age of the last update', () => {
  assert.equal(statusForAge(NOW - 3_600_000, NOW), 'active');
  assert.equal(statusForAge(NOW - 5 * 86_400_000, NOW), 'monitoring');
  assert.equal(statusForAge(NOW - 30 * 86_400_000, NOW), 'ended');
});

test('EONET wildfire events map to the wildfire type and keep their latest position', () => {
  const incident = normalizeEonetEvent(eonetEvent(), { now: NOW });
  assert.equal(incident.type, 'wildfire');
  assert.equal(incident.status, 'active');
  assert.deepEqual(incident.coordinates, [{ lat: 38.7, lon: -9.1 }]);
  assert.equal(incident.sourceLinks.length, 2);
});

test('EONET closed events are ended; polygon-only and unknown-category events are handled', () => {
  assert.equal(normalizeEonetEvent(eonetEvent({ closed: '2026-10-01T00:00:00Z' }), { now: NOW }).status, 'ended');
  assert.equal(normalizeEonetEvent(eonetEvent({ geometry: [{ type: 'Polygon', date: '2026-10-05T00:00:00Z', coordinates: [] }] }), { now: NOW }), null);
  assert.equal(normalizeEonetEvent(eonetEvent({ categories: [{ id: 'seaLakeIce', title: 'Sea and Lake Ice' }] }), { now: NOW }).type, 'other verified event');
});

test('the same event from USGS and another provider is merged, sources unioned', () => {
  const a = normalizeUsgsFeature(quake(), { now: NOW });
  const b = { ...a, id: 'other:1', providerIds: ['regional'], sourceLinks: [{ provider: 'Regional', url: 'https://example.gov/quake' }] };
  const merged = deduplicateIncidents([a, b]);
  assert.equal(merged.length, 1);
  assert.deepEqual(merged[0].providerIds.sort(), ['regional', 'usgs']);
  assert.equal(merged[0].sourceLinks.length, 2);
});

test('distinct events far apart in time or place are not merged', () => {
  const a = normalizeUsgsFeature(quake(), { now: NOW });
  const far = normalizeUsgsFeature(quake({ time: NOW - 40 * 3_600_000 }, { coordinates: [10, 10, 1] }), { now: NOW });
  assert.equal(deduplicateIncidents([a, far]).length, 2);
});

test('ranking puts higher severity first; radius filtering attaches distance', () => {
  const big = normalizeUsgsFeature(quake({ mag: 7.1 }), { now: NOW });
  const small = normalizeUsgsFeature(quake({ mag: 3.0, time: NOW - 60_000 }, { coordinates: [139.8, 35.8, 1] }), { now: NOW });
  assert.equal(rankIncidents([small, big])[0].severity, 7.1);
  const near = incidentsWithin([big, small], { lat: 35.7, lon: 139.7 }, 50);
  assert.equal(near.length, 2);
  assert.ok(near[0].distanceKm < 50);
  assert.equal(incidentsWithin([big], { lat: -33.8, lon: 151.2 }, 100).length, 0);
});

test('USGS fetch keeps good records, counts bad ones, and reports bad feeds', async () => {
  const feed = { type: 'FeatureCollection', features: [quake(), quake({ mag: 'x' })] };
  const result = await fetchUsgsIncidents({ fetchImpl: async () => json(feed), window: 'day', now: NOW });
  assert.equal(result.ok, true);
  assert.equal(result.data.length, 1);
  assert.equal(result.rejected, 1);
  const bad = await fetchUsgsIncidents({ fetchImpl: async () => json({ nope: true }), window: 'day', now: NOW });
  assert.equal(bad.ok, false);
  assert.match(bad.error, /GeoJSON/);
});

test('HTTP 429 marks the provider rate-limited; timeouts and network errors go offline', async () => {
  const limited = await fetchEonetIncidents({ fetchImpl: async () => json({}, 429), now: NOW });
  assert.equal(limited.rateLimited, true);
  const state = createProviderState('nasa-eonet', { refreshMs: 1000, now: () => NOW });
  recordOutcome(state, limited);
  assert.equal(state.health, PROVIDER_HEALTH.RATE_LIMITED);
  const timeout = await fetchEonetIncidents({ fetchImpl: async (_u, { signal }) => new Promise((_r, rej) => signal.addEventListener('abort', () => rej(Object.assign(new Error('x'), { name: 'AbortError' })))), now: NOW }).catch(() => null);
  assert.ok(timeout === null || timeout.ok === false);
});

test('backoff grows with consecutive failures and stays capped', () => {
  const state = createProviderState('usgs', { refreshMs: 60_000, now: () => NOW });
  const first = nextAttemptDelay(state, () => 0.5);
  state.failures = 3;
  const later = nextAttemptDelay(state, () => 0.5);
  state.failures = 40;
  assert.ok(later > first);
  assert.ok(nextAttemptDelay(state, () => 0.5) <= 30 * 60_000);
});

test('registry keeps last-known-good data and marks it stale when a refresh fails', async () => {
  let fail = false;
  const fetchImpl = async () => (fail ? json({}, 500) : json({ type: 'FeatureCollection', features: [quake()] }));
  const registry = createIncidentRegistry({ fetchImpl, now: () => NOW });
  const first = await registry.refresh('usgs', { force: true });
  assert.equal(first.stale, false);
  fail = true;
  const second = await registry.refresh('usgs', { force: true });
  assert.equal(second.ok, true);
  assert.equal(second.stale, true);
  assert.equal(second.data.length, 1);
});

test('optional providers report not-configured without any request when keys are absent', () => {
  let calls = 0;
  const registry = createIncidentRegistry({ fetchImpl: async () => { calls += 1; return json({}); }, env: {}, now: () => NOW });
  const caps = registry.capabilities();
  const tfnsw = caps.find((c) => c.id === 'tfnsw-live-traffic');
  const youtube = caps.find((c) => c.id === 'youtube-media');
  assert.equal(tfnsw.health, 'not-configured');
  assert.equal(tfnsw.reason, 'credential_not_configured');
  assert.equal(youtube.configured, false);
  assert.equal(calls, 0);
});

test('optional providers activate when a key is present, and never expose it', () => {
  const env = { TFNSW_API_KEY: 'example-value', YOUTUBE_API_KEY: '  ' };
  const tfnsw = tfnswCapability({ env });
  assert.equal(tfnsw.configured, true);
  assert.equal(JSON.stringify(tfnsw).includes('example-value'), false);
  assert.equal(youtubeCapability({ env }).configured, false, 'blank key counts as absent');
});

test('the keyless core keeps working when every optional provider is absent', async () => {
  const fetchImpl = async (url) => (url.includes('usgs') ? json({ type: 'FeatureCollection', features: [quake()] }) : json({ events: [eonetEvent()] }));
  const registry = createIncidentRegistry({ fetchImpl, env: {}, now: () => NOW });
  const usgs = await registry.refresh('usgs', { force: true });
  const eonet = await registry.refresh('eonet', { force: true });
  const merged = rankIncidents(deduplicateIncidents([...usgs.data, ...eonet.data]));
  assert.equal(merged.length, 2);
  assert.ok(registry.capabilities().filter((c) => c.mode === 'keyless').every((c) => c.available));
});
