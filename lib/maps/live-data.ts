type JsonCache = { expiresAt: number; value: unknown };
const cache = new Map<string, JsonCache>();

async function cachedJson(key: string, url: string, ttlMs: number, signal?: AbortSignal): Promise<unknown> {
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const response = await fetch(url, { signal, headers: { Accept: "application/json", "User-Agent": "ClyraMaps/2.0 public-data layer" } });
  if (!response.ok) throw new Error(`Public data source responded ${response.status}`);
  const value = await response.json();
  cache.set(key, { value, expiresAt: Date.now() + ttlMs });
  return value;
}

/** USGS's documented GeoJSON public feed, cached to avoid unnecessary calls. */
export async function getEarthquakes(signal?: AbortSignal): Promise<unknown> {
  return cachedJson("usgs:all_day", "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson", 5 * 60_000, signal);
}

/** adsb.lol viewport query; only approximate, public aircraft data is returned. */
export async function getAircraft(lat: number, lon: number, radiusNm: number, signal?: AbortSignal): Promise<unknown> {
  const safeLat = Math.max(-90, Math.min(90, lat));
  const safeLon = Math.max(-180, Math.min(180, lon));
  const safeRadius = Math.max(2, Math.min(150, radiusNm));
  const key = `adsb:${safeLat.toFixed(1)}:${safeLon.toFixed(1)}:${Math.round(safeRadius)}`;
  return cachedJson(key, `https://api.adsb.lol/v2/point/${safeLat}/${safeLon}/${safeRadius}`, 25_000, signal);
}
