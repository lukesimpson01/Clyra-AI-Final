/** Public, keyless data providers for Clyra Maps: Photon (search/autocomplete),
 * Overpass (nearby OSM POIs), OSRM (routing). Each function degrades to an
 * empty/failed result rather than throwing, so one dead provider never takes
 * down the whole map — callers decide the fallback. */
import { overpassQuery } from "./overpass";
import type { ClyraPlace, Coordinate, NavigationStep, Route, RouteRequest, TravelMode } from "./types";

const FETCH_TIMEOUT_MS = 9000;

async function fetchWithTimeout(url: string, init?: RequestInit, retries = 1): Promise<Response | null> {
  for (let attempt = 0; ; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      return await fetch(url, { ...init, signal: controller.signal });
    } catch (err) {
      // A cold Node process pays TLS/DNS setup cost on its very first outbound
      // request, which can spuriously exceed the timeout — one retry keeps
      // that from surfacing as "no results" for a provider that's actually up.
      if (attempt >= retries) return null;
    } finally {
      clearTimeout(timer);
    }
  }
}

function haversineMeters(a: Coordinate, b: Coordinate): number {
  const R = 6371000;
  const [lon1, lat1] = a;
  const [lon2, lat2] = b;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

let placeCounter = 0;
function nextId(prefix: string) {
  placeCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${placeCounter}`;
}

/* ---------------------------------- Photon ---------------------------------- */

interface PhotonFeature {
  geometry?: { coordinates?: [number, number] };
  properties?: Record<string, unknown>;
}

function photonToPlace(feature: PhotonFeature, near?: Coordinate): ClyraPlace | null {
  const coords = feature.geometry?.coordinates;
  if (!coords || coords.length < 2) return null;
  const p = feature.properties || {};
  const name = String(p.name || p.street || p.city || "Unnamed place");
  const categories = [p.osm_value, p.osm_key].filter(Boolean).map(String);
  const addressParts = [p.housenumber, p.street].filter(Boolean).join(" ");
  const coordinate: Coordinate = [coords[0], coords[1]];
  return {
    id: nextId("photon"),
    name,
    coordinates: coordinate,
    address: addressParts || undefined,
    locality: (p.city || p.district) as string | undefined,
    region: p.state as string | undefined,
    country: p.country as string | undefined,
    categories,
    distanceMeters: near ? haversineMeters(near, coordinate) : undefined,
    sourceLinks: [{ provider: "OpenStreetMap (Photon)" }],
  };
}

export async function searchPlaces(
  query: string,
  opts: { near?: Coordinate; limit?: number } = {},
): Promise<ClyraPlace[]> {
  const q = query.trim();
  if (!q) return [];
  const url = new URL("https://photon.komoot.io/api/");
  url.searchParams.set("q", q);
  url.searchParams.set("limit", String(Math.min(opts.limit ?? 8, 20)));
  if (opts.near) {
    url.searchParams.set("lon", String(opts.near[0]));
    url.searchParams.set("lat", String(opts.near[1]));
  }
  const res = await fetchWithTimeout(url.toString());
  if (!res || !res.ok) return [];
  try {
    const data = (await res.json()) as { features?: PhotonFeature[] };
    return (data.features || [])
      .map((f) => photonToPlace(f, opts.near))
      .filter((p): p is ClyraPlace => p !== null);
  } catch {
    return [];
  }
}

/* --------------------------------- Overpass --------------------------------- */

const CATEGORY_TAGS: Record<string, string[]> = {
  food: ["amenity=restaurant", "amenity=fast_food"],
  coffee: ["amenity=cafe"],
  petrol: ["amenity=fuel"],
  parking: ["amenity=parking"],
  groceries: ["shop=supermarket", "shop=convenience"],
  hotels: ["tourism=hotel", "tourism=motel"],
  attractions: ["tourism=attraction", "tourism=museum", "tourism=viewpoint"],
  pharmacy: ["amenity=pharmacy"],
  hospitals: ["amenity=hospital"],
  "ev-charging": ["amenity=charging_station"],
  transport: ["highway=bus_stop", "railway=station"],
  atm: ["amenity=atm"],
  bank: ["amenity=bank"],
  park: ["leisure=park"],
  toilets: ["amenity=toilets"],
  school: ["amenity=school"],
};

function overpassElementToPlace(el: {
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}, near?: Coordinate): ClyraPlace | null {
  const lat = el.lat ?? el.center?.lat;
  const lon = el.lon ?? el.center?.lon;
  if (lat == null || lon == null) return null;
  const tags = el.tags || {};
  const name = tags.name || tags["addr:housename"] || "Unnamed place";
  const coordinate: Coordinate = [lon, lat];
  const categories = [tags.amenity, tags.shop, tags.tourism, tags.leisure, tags.highway, tags.railway].filter(
    Boolean,
  ) as string[];
  const address = [tags["addr:housenumber"], tags["addr:street"]].filter(Boolean).join(" ") || undefined;
  return {
    id: `osm-${el.id}`,
    name,
    coordinates: coordinate,
    address,
    locality: tags["addr:city"],
    categories,
    phone: tags.phone || tags["contact:phone"],
    website: tags.website || tags["contact:website"],
    openingHours: tags.opening_hours ? { raw: tags.opening_hours } : undefined,
    amenities: tags.wheelchair ? [`wheelchair:${tags.wheelchair}`] : undefined,
    distanceMeters: near ? haversineMeters(near, coordinate) : undefined,
    sourceLinks: [{ provider: "OpenStreetMap" }],
  };
}

/** Nearby POIs within a viewport/radius, filtered by category. Uses the public
 * Overpass API — bounded by radius + result limit so we never query the world. */
const nearbyCache = new Map<string, { at: number; places: ClyraPlace[] }>();

export async function searchNearby(
  center: Coordinate,
  category: string,
  opts: { radiusMeters?: number; limit?: number } = {},
): Promise<ClyraPlace[]> {
  const radius = Math.min(Math.max(opts.radiusMeters ?? 1500, 100), 8000);
  const limit = Math.min(opts.limit ?? 20, 40);
  const tags = CATEGORY_TAGS[category] || [`amenity=${category}`];
  const [lon, lat] = center;
  const clauses = tags
    .map((tag) => {
      const [k, v] = tag.split("=");
      return `node[${k}=${v}](around:${radius},${lat},${lon});way[${k}=${v}](around:${radius},${lat},${lon});`;
    })
    .join("\n");
  const cacheKey = `${category}|${lat.toFixed(3)},${lon.toFixed(3)}|${radius}|${limit}`;
  const hit = nearbyCache.get(cacheKey);
  if (hit && Date.now() - hit.at < 5 * 60_000) return hit.places;
  const query = `[out:json][timeout:15];(${clauses});out center ${limit};`;
  const data = await overpassQuery<{ elements?: Array<Parameters<typeof overpassElementToPlace>[0]> }>(query, 14000);
  const places = (data?.elements || [])
    .map((el) => overpassElementToPlace(el, center))
    .filter((p): p is ClyraPlace => p !== null)
    .sort((a, b) => (a.distanceMeters ?? 0) - (b.distanceMeters ?? 0))
    .slice(0, limit);
  // Only remember real answers; an empty list may just be an overloaded mirror.
  if (places.length) nearbyCache.set(cacheKey, { at: Date.now(), places });
  return places;
}

/* ----------------------------------- OSRM ------------------------------------ */

/** The OSRM demo server only ever routes by car, whatever profile is requested,
 * so walking and cycling would get driving speeds. FOSSGIS runs dedicated
 * foot and bike instances; those are used for the matching modes. */
const OSRM_BASE: Record<TravelMode, string> = {
  drive: "https://router.project-osrm.org/route/v1/driving",
  walk: "https://routing.openstreetmap.de/routed-foot/route/v1/driving",
  bike: "https://routing.openstreetmap.de/routed-bike/route/v1/driving",
  transit: "https://router.project-osrm.org/route/v1/driving",
};

const MANEUVER_TYPE_MAP: Record<string, NavigationStep["type"]> = {
  depart: "depart",
  arrive: "arrive",
  merge: "merge",
  "on ramp": "merge",
  "off ramp": "exit",
  fork: "fork",
  roundabout: "roundabout",
  "roundabout turn": "roundabout",
  continue: "continue",
  new_name: "continue",
};

function maneuverToStepType(maneuver: { type?: string; modifier?: string }): NavigationStep["type"] {
  const mapped = maneuver.type ? MANEUVER_TYPE_MAP[maneuver.type] : undefined;
  if (mapped) return mapped;
  switch (maneuver.modifier) {
    case "left":
      return "turn-left";
    case "right":
      return "turn-right";
    case "slight left":
      return "slight-left";
    case "slight right":
      return "slight-right";
    case "sharp left":
      return "sharp-left";
    case "sharp right":
      return "sharp-right";
    default:
      return "continue";
  }
}

function bearingBetween(a: Coordinate, b: Coordinate): number {
  const [lon1, lat1] = a.map((n) => (n * Math.PI) / 180) as Coordinate;
  const [lon2, lat2] = b.map((n) => (n * Math.PI) / 180) as Coordinate;
  const y = Math.sin(lon2 - lon1) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(lon2 - lon1);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

function humanizeInstruction(step: {
  maneuver: { type?: string; modifier?: string };
  name?: string;
}): string {
  const road = step.name?.trim();
  const type = step.maneuver.type;
  const modifier = step.maneuver.modifier;
  if (type === "depart") return road ? `Head out on ${road}` : "Head out";
  if (type === "arrive") return "You have arrived at your destination";
  if (type === "roundabout" || type === "rotary") return road ? `At the roundabout, continue onto ${road}` : "Take the roundabout";
  const dir =
    modifier === "left"
      ? "Turn left"
      : modifier === "right"
        ? "Turn right"
        : modifier === "slight left"
          ? "Bear left"
          : modifier === "slight right"
            ? "Bear right"
            : modifier === "sharp left"
              ? "Make a sharp left"
              : modifier === "sharp right"
                ? "Make a sharp right"
                : modifier === "uturn"
                  ? "Make a U-turn"
                  : "Continue";
  return road ? `${dir} onto ${road}` : dir;
}

function cumulativeDistances(geometry: Coordinate[]): number[] {
  const out = [0];
  for (let i = 1; i < geometry.length; i += 1) {
    out.push(out[i - 1] + haversineMeters(geometry[i - 1], geometry[i]));
  }
  return out;
}

/** Densify a route's geometry so simulation/interpolation never visibly cuts
 * corners on sparse OSRM polylines. */
function densify(geometry: Coordinate[], maxSegmentMeters = 25): Coordinate[] {
  const out: Coordinate[] = [];
  for (let i = 0; i < geometry.length - 1; i += 1) {
    const a = geometry[i];
    const b = geometry[i + 1];
    out.push(a);
    const dist = haversineMeters(a, b);
    const steps = Math.floor(dist / maxSegmentMeters);
    for (let s = 1; s <= steps; s += 1) {
      const t = s / (steps + 1);
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
  }
  out.push(geometry[geometry.length - 1]);
  return out;
}

export class OSRMProvider {
  name = "osrm";

  async route(request: RouteRequest): Promise<Route | null> {
    const points = [request.origin, ...(request.options.waypoints || []), request.destination];
    const coordString = points.map(([lon, lat]) => `${lon},${lat}`).join(";");
    const url = new URL(`${OSRM_BASE[request.options.mode] ?? OSRM_BASE.drive}/${coordString}`);
    url.searchParams.set("overview", "full");
    url.searchParams.set("geometries", "geojson");
    url.searchParams.set("steps", "true");
    url.searchParams.set("alternatives", request.options.waypoints?.length ? "false" : "true");
    const res = await fetchWithTimeout(url.toString());
    if (!res || !res.ok) return null;
    try {
      const data = (await res.json()) as {
        code?: string;
        routes?: Array<{
          geometry: { coordinates: Coordinate[] };
          distance: number;
          duration: number;
          legs: Array<{
            steps: Array<{
              geometry: { coordinates: Coordinate[] };
              maneuver: { type?: string; modifier?: string; location: Coordinate; bearing_before: number; bearing_after: number };
              name?: string;
              distance: number;
              duration: number;
            }>;
          }>;
        }>;
      };
      if (data.code !== "Ok" || !data.routes?.length) return null;
      return this.toRoute(data.routes[0], request.options.mode);
    } catch {
      return null;
    }
  }

  async alternatives(request: RouteRequest): Promise<Route[]> {
    const coordString = `${request.origin.join(",")};${request.destination.join(",")}`;
    const url = new URL(`${OSRM_BASE[request.options.mode] ?? OSRM_BASE.drive}/${coordString}`);
    url.searchParams.set("overview", "full");
    url.searchParams.set("geometries", "geojson");
    url.searchParams.set("steps", "true");
    url.searchParams.set("alternatives", "true");
    const res = await fetchWithTimeout(url.toString());
    if (!res || !res.ok) return [];
    try {
      const data = (await res.json()) as { code?: string; routes?: any[] };
      if (data.code !== "Ok") return [];
      return (data.routes || []).map((r) => this.toRoute(r, request.options.mode));
    } catch {
      return [];
    }
  }

  private toRoute(
    raw: {
      geometry: { coordinates: Coordinate[] };
      distance: number;
      duration: number;
      legs: Array<{
        steps: Array<{
          geometry: { coordinates: Coordinate[] };
          maneuver: { type?: string; modifier?: string; location: Coordinate; bearing_before: number; bearing_after: number };
          name?: string;
          distance: number;
          duration: number;
        }>;
      }>;
    },
    mode: TravelMode,
  ): Route {
    const geometry = densify(raw.geometry.coordinates);
    const cumDist = cumulativeDistances(geometry);
    const steps: NavigationStep[] = [];
    let vertexCursor = 0;
    for (const leg of raw.legs) {
      for (const step of leg.steps) {
        const stepGeom = step.geometry.coordinates;
        const startIdx = vertexCursor;
        // Advance the cursor by the (undensified) step length approximated
        // against the densified geometry via nearest-distance matching.
        const stepStartDist = cumDist[Math.min(startIdx, cumDist.length - 1)] ?? 0;
        const targetDist = stepStartDist + step.distance;
        let endIdx = startIdx;
        while (endIdx < cumDist.length - 1 && cumDist[endIdx] < targetDist) endIdx += 1;
        steps.push({
          instruction: humanizeInstruction(step),
          type: maneuverToStepType(step.maneuver),
          roadName: step.name || undefined,
          distanceMeters: step.distance,
          durationSeconds: step.duration,
          coordinate: step.maneuver.location,
          headingBefore: step.maneuver.bearing_before ?? bearingBetween(stepGeom[0], stepGeom[1] || stepGeom[0]),
          headingAfter: step.maneuver.bearing_after ?? step.maneuver.bearing_before ?? 0,
          geometryStartIndex: startIdx,
          geometryEndIndex: endIdx,
        });
        vertexCursor = endIdx;
      }
    }
    return {
      id: nextId("route"),
      provider: this.name,
      mode,
      geometry,
      distanceMeters: raw.distance,
      durationSeconds: raw.duration,
      steps,
      cumulativeDistances: cumDist,
    };
  }
}

export const routingProvider = new OSRMProvider();

/* ------------------------------ Along-route search ---------------------------- */

/** Find POIs of a category inside a corridor around the route, ranked by how
 * little detour they add. Detour is estimated from straight-line distance
 * pairs (2x the perpendicular offset) — good enough for ranking without a
 * second routing round-trip per candidate. */
export async function findAlongRoute(
  route: Route,
  category: string,
  opts: { corridorMeters?: number; limit?: number } = {},
): Promise<ClyraPlace[]> {
  const corridor = opts.corridorMeters ?? 1200;
  const limit = opts.limit ?? 6;
  // Sample the route every ~3km to bound the number of Overpass calls.
  const sampleEvery = 3000;
  const samples: Coordinate[] = [];
  let nextSample = 0;
  for (let i = 0; i < route.geometry.length; i += 1) {
    if (route.cumulativeDistances[i] >= nextSample) {
      samples.push(route.geometry[i]);
      nextSample += sampleEvery;
    }
  }
  const results = await Promise.all(
    samples.slice(0, 12).map((c) => searchNearby(c, category, { radiusMeters: corridor, limit: 5 })),
  );
  const seen = new Map<string, ClyraPlace>();
  for (const list of results) {
    for (const place of list) {
      if (!seen.has(place.id)) seen.set(place.id, place);
    }
  }
  const candidates = [...seen.values()];
  for (const place of candidates) {
    let nearestDist = Infinity;
    let nearestCum = 0;
    for (let i = 0; i < route.geometry.length; i += 1) {
      const d = haversineMeters(place.coordinates, route.geometry[i]);
      if (d < nearestDist) {
        nearestDist = d;
        nearestCum = route.cumulativeDistances[i];
      }
    }
    const detourMeters = nearestDist * 2;
    const avgSpeedMps = route.distanceMeters / Math.max(route.durationSeconds, 1);
    place.detourSeconds = Math.round(detourMeters / Math.max(avgSpeedMps, 1));
    place.distanceMeters = Math.round(nearestCum);
  }
  return candidates.sort((a, b) => (a.detourSeconds ?? 0) - (b.detourSeconds ?? 0)).slice(0, limit);
}

export { haversineMeters };
