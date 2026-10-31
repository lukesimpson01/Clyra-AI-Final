/* Clyra Maps tile cache. Cache-first for map tiles, glyphs, sprites and the
 * style so repeat visits paint instantly and downloaded areas work offline.
 * Only GETs to the known public map hosts are touched; everything else passes
 * straight through. */
const CACHE = "clyra-maps-tiles-v2";
const HOSTS = ["tiles.openfreemap.org", "server.arcgisonline.com"];
const MAX_ENTRIES = 4000;

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

async function trim(cache) {
  const keys = await cache.keys();
  if (keys.length > MAX_ENTRIES) await Promise.all(keys.slice(0, keys.length - MAX_ENTRIES).map((k) => cache.delete(k)));
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (!HOSTS.includes(url.hostname)) return;
  // Style and tilejson name a data version that changes, so those go network-first
  // (cache only as an offline fallback). Tiles, glyphs and sprites are immutable.
  // The style and the tile index (/planet) name a data version that changes now and then: both are served from
  // the cache at once and refreshed behind it (stale-while-revalidate), so opening Maps never waits on them.
  const volatile = false;
  const isStyle = url.pathname.startsWith("/styles/") || url.pathname === "/planet";
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      if (isStyle) {
        // Stale-while-revalidate: paint from the cached style at once, refresh behind it.
        const cached = await cache.match(req);
        const refresh = fetch(req).then((res) => {
          if (res.ok) cache.put(req, res.clone()).catch(() => {});
          return res;
        });
        if (cached) {
          refresh.catch(() => {});
          return cached;
        }
        return refresh;
      }
      if (volatile) {
        try {
          const res = await fetch(req);
          if (res.ok) cache.put(req, res.clone()).catch(() => {});
          return res;
        } catch (err) {
          const old = await cache.match(req);
          if (old) return old;
          throw err;
        }
      }
      const hit = await cache.match(req);
      if (hit) return hit;
      try {
        const res = await fetch(req);
        if (res.ok) {
          cache.put(req, res.clone()).then(() => trim(cache)).catch(() => {});
        }
        return res;
      } catch (err) {
        const fallback = await cache.match(req, { ignoreVary: true });
        if (fallback) return fallback;
        throw err;
      }
    })(),
  );
});
