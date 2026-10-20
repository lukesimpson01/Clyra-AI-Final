/** Public-transport trip planning via Transitous (MOTIS, api.transitous.org):
 * a free community service built on open GTFS feeds. Every field is validated
 * and anything malformed is dropped, so coverage gaps yield "no transit
 * options" rather than invented trips. */
import type { Coordinate } from "./types";

export interface TransitLeg {
  mode: string; // WALK, BUS, SUBWAY, RAIL, TRAM, FERRY, ...
  from: { name: string; coordinates: Coordinate };
  to: { name: string; coordinates: Coordinate };
  geometry: Coordinate[];
  startTime: string;
  endTime: string;
  durationSeconds: number;
  distanceMeters?: number;
  routeName?: string;
  headsign?: string;
  agency?: string;
  color?: string;
  stops?: number;
}

export interface TransitItinerary {
  id: string;
  startTime: string;
  endTime: string;
  durationSeconds: number;
  transfers: number;
  walkSeconds: number;
  legs: TransitLeg[];
}

const TIMEOUT_MS = 20000;
const CACHE_TTL_MS = 60 * 1000;
const cache = new Map<string, { at: number; value: TransitItinerary[] }>();

/** Standard encoded-polyline decoder; `precision` comes from the response (6 or 7). */
export function decodePolyline(encoded: string, precision: number): Coordinate[] {
  const factor = 10 ** precision;
  const out: Coordinate[] = [];
  let index = 0;
  let lat = 0;
  let lon = 0;
  while (index < encoded.length) {
    for (const axis of ["lat", "lon"] as const) {
      // Plain arithmetic, not bit ops: precision-7 longitudes exceed 32 bits.
      let result = 0;
      let mul = 1;
      let byte: number;
      do {
        byte = encoded.charCodeAt(index++) - 63;
        result += (byte & 0x1f) * mul;
        mul *= 32;
      } while (byte >= 0x20 && index < encoded.length);
      const delta = result % 2 === 1 ? -(result + 1) / 2 : result / 2;
      if (axis === "lat") lat += delta;
      else lon += delta;
    }
    out.push([lon / factor, lat / factor]);
  }
  return out;
}

const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);

function toColor(c: unknown): string | undefined {
  return typeof c === "string" && /^[0-9a-fA-F]{6}$/.test(c) ? `#${c}` : undefined;
}

function parseLeg(raw: Record<string, any>): TransitLeg | null {
  const f = raw?.from;
  const t = raw?.to;
  if (!f || !t || !finite(f.lat) || !finite(f.lon) || !finite(t.lat) || !finite(t.lon)) return null;
  const g = raw.legGeometry;
  const geometry = typeof g?.points === "string" && finite(g.precision) ? decodePolyline(g.points, g.precision) : [[f.lon, f.lat] as Coordinate, [t.lon, t.lat] as Coordinate];
  if (geometry.length < 2) return null;
  const mode = typeof raw.mode === "string" ? raw.mode : "WALK";
  return {
    mode,
    from: { name: String(f.name ?? ""), coordinates: [f.lon, f.lat] },
    to: { name: String(t.name ?? ""), coordinates: [t.lon, t.lat] },
    geometry,
    startTime: String(raw.startTime ?? ""),
    endTime: String(raw.endTime ?? ""),
    durationSeconds: finite(raw.duration) ? raw.duration : 0,
    distanceMeters: finite(raw.distance) ? raw.distance : undefined,
    routeName: typeof raw.routeShortName === "string" ? raw.routeShortName : typeof raw.displayName === "string" ? raw.displayName : undefined,
    headsign: typeof raw.headsign === "string" ? raw.headsign : undefined,
    agency: typeof raw.agencyName === "string" ? raw.agencyName : undefined,
    color: toColor(raw.routeColor),
    stops: Array.isArray(raw.intermediateStops) ? raw.intermediateStops.length + 1 : undefined,
  };
}

export async function planTransit(origin: Coordinate, destination: Coordinate, when?: string, arriveBy = false): Promise<TransitItinerary[]> {
  const key = [origin, destination].map((c) => c.map((n) => n.toFixed(4)).join(",")).join("|") + (when ?? "") + (arriveBy ? "A" : "");
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;

  const url = new URL("https://api.transitous.org/api/v1/plan");
  url.searchParams.set("fromPlace", `${origin[1]},${origin[0]}`);
  url.searchParams.set("toPlace", `${destination[1]},${destination[0]}`);
  url.searchParams.set("time", when && !Number.isNaN(Date.parse(when)) ? new Date(when).toISOString() : new Date().toISOString());
  url.searchParams.set("numItineraries", "4");
  if (arriveBy) url.searchParams.set("arriveBy", "true");
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(url, { signal: controller.signal, headers: { "User-Agent": "ClyraMaps/1.0 (transit planner)" } });
      if (!res.ok) {
        console.warn(`[maps.transit] Transitous responded ${res.status}`);
        continue;
      }
      const data = (await res.json()) as { itineraries?: Array<Record<string, any>> };
      const out: TransitItinerary[] = [];
      for (const [i, it] of (data.itineraries ?? []).entries()) {
        const legs = (Array.isArray(it.legs) ? it.legs : []).map(parseLeg).filter((l): l is TransitLeg => l !== null);
        if (!legs.length || !finite(it.duration)) continue;
        out.push({
          id: `transit-${i}-${String(it.startTime)}`,
          startTime: String(it.startTime),
          endTime: String(it.endTime),
          durationSeconds: it.duration,
          transfers: finite(it.transfers) ? it.transfers : 0,
          walkSeconds: legs.filter((l) => l.mode === "WALK").reduce((s, l) => s + l.durationSeconds, 0),
          legs,
        });
      }
      cache.set(key, { at: Date.now(), value: out });
      return out;
    } catch (err) {
      console.warn("[maps.transit] request failed:", err instanceof Error ? err.message : err);
    } finally {
      clearTimeout(timer);
    }
  }
  return [];
}
