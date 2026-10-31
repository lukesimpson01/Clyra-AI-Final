// Incident provider registry. Each provider declares whether it needs a
// credential. Keyless providers always run; optional providers report
// "not-configured" until their credential is present, and nothing else
// depends on them.
import { normalizeEonetEvent, normalizeUsgsFeature } from './normalize.js';

export const PROVIDER_HEALTH = Object.freeze({
  ONLINE: 'online',
  SLOW: 'slow',
  RATE_LIMITED: 'rate-limited',
  STALE: 'stale',
  OFFLINE: 'offline',
  NOT_CONFIGURED: 'not-configured',
});

const USGS_FEEDS = Object.freeze({
  hour: 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_hour.geojson',
  day: 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson',
  week: 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_week.geojson',
  significantMonth: 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/significant_month.geojson',
});

const EONET_URL = 'https://eonet.gsfc.nasa.gov/api/v3/events?status=open&limit=200';

/** Minimum refresh period per provider, in ms. Callers add jitter on top. */
export const REFRESH_MS = Object.freeze({
  usgs: 60_000,
  eonet: 15 * 60_000,
  tfnsw: 120_000,
  youtube: 15 * 60_000,
});

/**
 * Create a provider state object: cache, health, backoff. `fetchJson` is injected
 * so the adapters are testable without the network.
 */
export function createProviderState(id, { refreshMs, now = Date.now } = {}) {
  return {
    id,
    refreshMs,
    health: PROVIDER_HEALTH.ONLINE,
    lastSuccess: null,
    lastFailure: null,
    failures: 0,
    data: null,
    error: null,
    now,
  };
}

/** Exponential backoff: 2^failures × refresh, capped at 30 min, with ±10% jitter. */
export function nextAttemptDelay(state, random = Math.random) {
  const base = Math.min(state.refreshMs * 2 ** state.failures, 30 * 60_000);
  return Math.round(base * (0.9 + random() * 0.2));
}

/** Records the outcome of one request against a provider state. */
export function recordOutcome(state, outcome) {
  const at = state.now();
  if (outcome.ok) {
    state.failures = 0;
    state.error = null;
    state.lastSuccess = at;
    state.health = PROVIDER_HEALTH.ONLINE;
    state.data = outcome.data;
  } else {
    state.failures += 1;
    state.lastFailure = at;
    state.error = outcome.error ?? 'request failed';
    state.health = outcome.rateLimited ? PROVIDER_HEALTH.RATE_LIMITED : PROVIDER_HEALTH.OFFLINE;
  }
  return state;
}

/** Stale-while-revalidate: data younger than the refresh period is served as is. */
export function isFresh(state) {
  return state.lastSuccess != null && state.now() - state.lastSuccess < state.refreshMs;
}

/** Provider capability record, as the AI and Provider Settings read it. */
export function capabilityOf(state, { mode, attribution }) {
  return {
    id: state.id,
    configured: state.health !== PROVIDER_HEALTH.NOT_CONFIGURED,
    available: state.health === PROVIDER_HEALTH.ONLINE || state.health === PROVIDER_HEALTH.SLOW,
    mode,
    health: state.health,
    lastSuccessfulRequest: state.lastSuccess,
    lastFailure: state.lastFailure,
    attribution,
  };
}

/** Fetch JSON with a timeout and a size cap. Returns {ok, data} or {ok:false, error, rateLimited}. */
export async function fetchJsonGuarded(fetchImpl, url, { timeoutMs = 15_000, maxBytes = 5_000_000, headers = {} } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { signal: controller.signal, headers: { Accept: 'application/json', ...headers } });
    if (response.status === 429) return { ok: false, rateLimited: true, error: 'rate limited' };
    if (!response.ok) return { ok: false, error: `HTTP ${response.status}` };
    const text = await response.text();
    if (text.length > maxBytes) return { ok: false, error: 'response too large' };
    return { ok: true, data: JSON.parse(text) };
  } catch (error) {
    return { ok: false, error: error?.name === 'AbortError' ? 'timed out' : 'network unavailable' };
  } finally {
    clearTimeout(timer);
  }
}

/** Keyless USGS adapter. `window` picks the feed: hour, day, week, significantMonth. */
export async function fetchUsgsIncidents({ fetchImpl, window = 'day', now = Date.now() }) {
  const url = USGS_FEEDS[window];
  if (!url) return { ok: false, error: `unknown USGS window ${window}` };
  const result = await fetchJsonGuarded(fetchImpl, url);
  if (!result.ok) return result;
  const features = Array.isArray(result.data?.features) ? result.data.features : null;
  if (!features) return { ok: false, error: 'USGS feed is not a GeoJSON collection' };
  const incidents = features.map((f) => normalizeUsgsFeature(f, { now })).filter(Boolean);
  return { ok: true, data: incidents, rejected: features.length - incidents.length };
}

/** Keyless NASA EONET v3 adapter. */
export async function fetchEonetIncidents({ fetchImpl, now = Date.now() }) {
  const result = await fetchJsonGuarded(fetchImpl, EONET_URL);
  if (!result.ok) return result;
  const events = Array.isArray(result.data?.events) ? result.data.events : null;
  if (!events) return { ok: false, error: 'EONET response has no events list' };
  const incidents = events.map((e) => normalizeEonetEvent(e, { now })).filter(Boolean);
  return { ok: true, data: incidents, rejected: events.length - incidents.length };
}

/**
 * Optional TfNSW Live Traffic adapter. Without TFNSW_API_KEY it reports
 * not-configured and makes no request. With it, the server sends the key in
 * an Authorization header; the key never reaches the renderer.
 */
export function tfnswCapability({ env = {} } = {}) {
  const configured = typeof env.TFNSW_API_KEY === 'string' && env.TFNSW_API_KEY.trim().length > 0;
  return {
    id: 'tfnsw-live-traffic',
    configured,
    available: configured,
    mode: 'optional-key',
    health: configured ? PROVIDER_HEALTH.ONLINE : PROVIDER_HEALTH.NOT_CONFIGURED,
    reason: configured ? undefined : 'credential_not_configured',
    attribution: 'Live Traffic NSW · Transport for NSW',
  };
}

/** Optional YouTube Data API capability. Never scrapes search HTML. */
export function youtubeCapability({ env = {} } = {}) {
  const configured = typeof env.YOUTUBE_API_KEY === 'string' && env.YOUTUBE_API_KEY.trim().length > 0;
  return {
    id: 'youtube-media',
    configured,
    available: configured,
    mode: 'optional-key',
    health: configured ? PROVIDER_HEALTH.ONLINE : PROVIDER_HEALTH.NOT_CONFIGURED,
    reason: configured ? undefined : 'credential_not_configured',
    attribution: 'YouTube Data API',
  };
}

/** Registry of keyless and optional incident providers. */
export function createIncidentRegistry({ fetchImpl = globalThis.fetch, env = {}, now = Date.now } = {}) {
  const states = {
    usgs: createProviderState('usgs', { refreshMs: REFRESH_MS.usgs, now }),
    eonet: createProviderState('nasa-eonet', { refreshMs: REFRESH_MS.eonet, now }),
  };
  return {
    states,
    async refresh(name, options = {}) {
      const state = states[name];
      if (!state) throw new Error(`unknown incident provider ${name}`);
      if (isFresh(state) && !options.force) return { ok: true, data: state.data, stale: false };
      const outcome = name === 'usgs'
        ? await fetchUsgsIncidents({ fetchImpl, window: options.window ?? 'day', now: now() })
        : await fetchEonetIncidents({ fetchImpl, now: now() });
      recordOutcome(state, outcome);
      if (outcome.ok) return { ok: true, data: outcome.data, stale: false };
      // Last-known-good data is kept and marked stale when a refresh fails.
      return state.data ? { ok: true, data: state.data, stale: true, error: state.error } : { ok: false, error: state.error };
    },
    capabilities() {
      return [
        capabilityOf(states.usgs, { mode: 'keyless', attribution: 'Earthquake data courtesy U.S. Geological Survey' }),
        capabilityOf(states.eonet, { mode: 'keyless', attribution: 'Natural events courtesy NASA Earth Observatory (EONET)' }),
        tfnswCapability({ env }),
        youtubeCapability({ env }),
      ];
    },
  };
}
