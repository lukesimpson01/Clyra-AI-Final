// One shared queue for every public Nominatim request in Clyra Eye. Nominatim's
// usage policy allows at most one request per second, so requests are serialized
// here, identical in-flight queries share one request, and results are cached.
// Only explicit submitted searches and occasional reverse lookups should use it:
// never search-as-you-type.

export const NOMINATIM_MIN_INTERVAL_MS = 1000;
export const NOMINATIM_CACHE_LIMIT = 500;
export const NOMINATIM_CACHE_TTL_MS = 24 * 3_600_000;

export function createNominatimLimiter({
  fetchImpl = globalThis.fetch,
  now = Date.now,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  minIntervalMs = NOMINATIM_MIN_INTERVAL_MS,
  cacheLimit = NOMINATIM_CACHE_LIMIT,
  cacheTtlMs = NOMINATIM_CACHE_TTL_MS,
  userAgent = 'ClyraEye/1.0 (Clyra desktop; contact via project repository)',
} = {}) {
  const cache = new Map(); // insertion-ordered: the first key is least recently used
  const inFlight = new Map();
  let chain = Promise.resolve();
  let lastStartedAt = -Infinity;

  function remember(key, value) {
    cache.delete(key);
    cache.set(key, { value, storedAt: now() });
    while (cache.size > cacheLimit) cache.delete(cache.keys().next().value);
  }

  function cached(key) {
    const entry = cache.get(key);
    if (!entry) return null;
    if (now() - entry.storedAt > cacheTtlMs) {
      cache.delete(key);
      return null;
    }
    cache.delete(key);
    cache.set(key, entry); // refresh recency
    return entry.value;
  }

  /** Serialize one request behind the shared queue and the minimum interval. */
  function enqueue(task) {
    const run = chain.then(async () => {
      const wait = lastStartedAt + minIntervalMs - now();
      if (wait > 0) await sleep(wait);
      lastStartedAt = now();
      return task();
    });
    chain = run.catch(() => {});
    return run;
  }

  return {
    /**
     * Run a Nominatim search or reverse lookup. `key` identifies the query for
     * caching and de-duplication. Returns the cached value when one is fresh,
     * the in-flight promise when the same query is already running, or queues a
     * new request.
     */
    request(key, url, { stale = false } = {}) {
      const hit = cached(key);
      if (hit) return Promise.resolve({ ok: true, data: hit, cached: true });
      if (inFlight.has(key)) return inFlight.get(key);
      const promise = enqueue(async () => {
        const response = await fetchImpl(url, { headers: { Accept: 'application/json', 'User-Agent': userAgent } });
        if (response.status === 429) return { ok: false, rateLimited: true, error: 'rate limited' };
        if (!response.ok) return { ok: false, error: `HTTP ${response.status}` };
        const data = await response.json();
        remember(key, data);
        return { ok: true, data, cached: false };
      })
        .catch(() => ({ ok: false, error: 'network unavailable' }))
        .finally(() => inFlight.delete(key));
      inFlight.set(key, promise);
      // A stale fallback is only offered when the caller asks for it and the request fails.
      return stale ? promise.then((result) => (result.ok ? result : { ...result, cachedFallback: cache.get(key)?.value ?? null })) : promise;
    },
    /** Test seam and diagnostics: the queue's current length is not exposed, only counts. */
    stats() {
      return { cached: cache.size, inFlight: inFlight.size };
    },
  };
}
