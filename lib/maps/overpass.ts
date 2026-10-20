/** Overpass queries raced across public mirrors. Any single Overpass instance is
 * regularly overloaded (tens of seconds, or 5xx), so the same query goes to
 * several at once and the first valid JSON answer wins; the rest are aborted. */
const MIRRORS = [
  "https://overpass-api.de/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];

export async function overpassQuery<T = { elements?: unknown[] }>(query: string, timeoutMs = 12000): Promise<T | null> {
  const controllers = MIRRORS.map(() => new AbortController());
  const timer = setTimeout(() => controllers.forEach((c) => c.abort()), timeoutMs);
  try {
    const winner = await Promise.any(
      MIRRORS.map(async (url, i) => {
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "text/plain", Accept: "application/json", "User-Agent": "ClyraMaps/1.0" },
          body: query,
          signal: controllers[i].signal,
        });
        if (!res.ok) throw new Error(`${url} ${res.status}`);
        const data = (await res.json()) as T & { elements?: unknown[] };
        if (!Array.isArray(data?.elements)) throw new Error(`${url} malformed`);
        controllers.forEach((c, j) => j !== i && c.abort());
        return data as T;
      }),
    );
    return winner;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
