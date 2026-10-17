/** Offline map areas. The tile service worker (public/maps-sw.js) caches every
 * tile the map or this module requests, so "downloading" an area is simply
 * fetching its tiles once through the worker. Capped so one tap can't pull an
 * unbounded amount of data. */
import type { Coordinate } from "../../lib/maps/types";

const TILEJSON_URL = "https://tiles.openfreemap.org/planet";
const MAX_TILES = 700;

export function registerTileCache() {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  navigator.serviceWorker.register("/maps-sw.js").catch(() => {
    // Unsupported origin (e.g. file://): the map works, just without caching.
  });
}

export function lonLatToTile(lon: number, lat: number, z: number): [number, number] {
  const n = 2 ** z;
  const x = Math.floor(((lon + 180) / 360) * n);
  const latRad = (lat * Math.PI) / 180;
  const y = Math.floor(((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n);
  return [Math.min(n - 1, Math.max(0, x)), Math.min(n - 1, Math.max(0, y))];
}

/** Tiles covering `bounds` from zoom 9 up to 15 (never beyond MAX_TILES). */
export function tilesForBounds(bounds: [Coordinate, Coordinate]): Array<[number, number, number]> {
  const out: Array<[number, number, number]> = [];
  for (let z = 9; z <= 15; z += 1) {
    const [x0, y1] = lonLatToTile(bounds[0][0], bounds[0][1], z);
    const [x1, y0] = lonLatToTile(bounds[1][0], bounds[1][1], z);
    for (let x = x0; x <= x1; x += 1) for (let y = y0; y <= y1; y += 1) out.push([z, x, y]);
    if (out.length > MAX_TILES) return out.slice(0, MAX_TILES);
  }
  return out;
}

export async function downloadArea(bounds: [Coordinate, Coordinate], onProgress: (done: number, total: number) => void): Promise<{ done: number; total: number }> {
  const meta = (await (await fetch(TILEJSON_URL)).json()) as { tiles?: string[] };
  const template = meta.tiles?.[0];
  if (!template) throw new Error("Tile source unavailable");
  const tiles = tilesForBounds(bounds);
  let done = 0;
  const queue = [...tiles];
  const worker = async () => {
    for (let t = queue.pop(); t; t = queue.pop()) {
      const [z, x, y] = t;
      try {
        await (await fetch(template.replace("{z}", String(z)).replace("{x}", String(x)).replace("{y}", String(y)))).arrayBuffer();
      } catch {
        // A missing tile just leaves a gap offline; keep going.
      }
      done += 1;
      onProgress(done, tiles.length);
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  return { done, total: tiles.length };
}

/* ---------------------------- saved areas list ---------------------------- */
const AREAS_KEY = "clyra.mapsOfflineAreas";
export const OFFLINE_EVENT = "clyra-maps-offline";
const CACHE_NAME = "clyra-maps-tiles-v2";

export interface OfflineArea {
  id: string;
  name: string;
  bounds: [Coordinate, Coordinate];
  tiles: number;
  savedAt: number;
}

export function readAreas(): OfflineArea[] {
  try {
    const v = JSON.parse(localStorage.getItem(AREAS_KEY) || "[]");
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

export function saveArea(area: OfflineArea) {
  try {
    localStorage.setItem(AREAS_KEY, JSON.stringify([area, ...readAreas()].slice(0, 20)));
  } catch {
    // Storage unavailable: the tiles are still cached, the list just isn't kept.
  }
  window.dispatchEvent(new Event(OFFLINE_EVENT));
}

/** Forgets an area and evicts its tiles, except any that another saved area still covers. */
export async function removeArea(id: string) {
  const all = readAreas();
  const target = all.find((a) => a.id === id);
  const rest = all.filter((a) => a.id !== id);
  try {
    localStorage.setItem(AREAS_KEY, JSON.stringify(rest));
  } catch {
    // ignore
  }
  window.dispatchEvent(new Event(OFFLINE_EVENT));
  if (!target || !("caches" in window)) return;
  try {
    const template = ((await (await fetch(TILEJSON_URL)).json()) as { tiles?: string[] }).tiles?.[0];
    if (!template) return;
    const keep = new Set(rest.flatMap((a) => tilesForBounds(a.bounds).map((t) => t.join("/"))));
    const cache = await caches.open(CACHE_NAME);
    await Promise.all(
      tilesForBounds(target.bounds)
        .filter((t) => !keep.has(t.join("/")))
        .map(([z, x, y]) => cache.delete(template.replace("{z}", String(z)).replace("{x}", String(x)).replace("{y}", String(y)))),
    );
  } catch {
    // Offline or cache unavailable: the entry is removed; stale tiles age out of the cache cap.
  }
}
