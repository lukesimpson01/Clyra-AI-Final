/** Universal map-click identification. Given any coordinate, works out what is
 * there using real public OSM services:
 *   - Overpass: named OSM features near the click, ranked by a relevance score
 *   - Nominatim: reverse geocoding for the street address
 * Results are cached and Nominatim is rate-limited to its usage policy (one
 * request per second). Every field is taken from a provider response; missing
 * data stays missing. */
import type { ClyraPlace, Coordinate } from "./types";
import { haversineMeters } from "./providers";
import { overpassQuery } from "./overpass";

export interface ClickAddress {
  formatted?: string;
  houseNumber?: string;
  road?: string;
  suburb?: string;
  city?: string;
  state?: string;
  postcode?: string;
  country?: string;
}

export interface IdentifyResult {
  kind: "place" | "address" | "pin";
  coordinates: Coordinate;
  place?: ClyraPlace;
  address?: ClickAddress;
  nearby: ClyraPlace[];
  /** Which providers answered, for source attribution and debugging. */
  sources: string[];
}

const UA = "ClyraMaps/1.0 (Clyra desktop maps; OSM usage policy)";
const TIMEOUT_MS = 8000;
const CACHE_TTL_MS = 10 * 60 * 1000;

const cache = new Map<string, { at: number; value: IdentifyResult }>();

function cacheKey(c: Coordinate) {
  // ~1 m precision: nearby clicks share results instead of re-querying.
  return `${c[1].toFixed(5)},${c[0].toFixed(5)}`;
}

async function fetchJson<T>(url: string, init?: RequestInit, timeoutMs = TIMEOUT_MS): Promise<T | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, headers: { "User-Agent": UA, ...(init?.headers as Record<string, string>) }, signal: controller.signal });
    if (!res.ok) {
      console.warn(`[maps.identify] ${new URL(url).host} responded ${res.status}`);
      return null;
    }
    return (await res.json()) as T;
  } catch (err) {
    console.warn(`[maps.identify] ${new URL(url).host} failed:`, err instanceof Error ? err.message : err);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/* Nominatim allows one request per second from a given client. Calls are
 * chained so bursts from rapid clicks queue up instead of being rejected. */
let nominatimChain: Promise<unknown> = Promise.resolve();
let lastNominatim = 0;
function nominatimReverse(c: Coordinate) {
  const run = async () => {
    const wait = lastNominatim + 1100 - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastNominatim = Date.now();
    const url = new URL("https://nominatim.openstreetmap.org/reverse");
    url.search = new URLSearchParams({
      format: "jsonv2",
      lat: String(c[1]),
      lon: String(c[0]),
      zoom: "18",
      addressdetails: "1",
      namedetails: "1",
    }).toString();
    return fetchJson<NominatimReverse>(url.toString(), { headers: { Accept: "application/json" } });
  };
  const next = nominatimChain.then(run, run);
  nominatimChain = next.catch(() => null);
  return next;
}

interface NominatimReverse {
  name?: string;
  display_name?: string;
  category?: string;
  type?: string;
  osm_type?: "node" | "way" | "relation";
  osm_id?: number;
  lat?: string;
  lon?: string;
  address?: Record<string, string>;
}

function addressFrom(n: NominatimReverse): ClickAddress | undefined {
  const a = n.address;
  if (!a) return undefined;
  const city = a.city || a.town || a.village || a.municipality || a.city_district;
  const parts = [
    [a.house_number, a.road].filter(Boolean).join(" "),
    a.suburb || a.neighbourhood,
    city,
    a.state,
    a.postcode,
  ].filter(Boolean) as string[];
  // Suburb and city are often the same name ("Sydney, Sydney"); show it once.
  const formatted = parts.filter((p, i) => parts.indexOf(p) === i).join(", ");
  return {
    formatted: formatted || n.display_name,
    houseNumber: a.house_number,
    road: a.road,
    suburb: a.suburb || a.neighbourhood,
    city,
    state: a.state,
    postcode: a.postcode,
    country: a.country,
  };
}

/* ------------------------------- Overpass ------------------------------- */

interface OverpassEl {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

const POI_KEYS = ["amenity", "shop", "tourism", "leisure", "historic", "office", "craft", "healthcare", "public_transport", "railway", "natural", "man_made", "place"];
const CATEGORY_IMPORTANCE: Record<string, number> = {
  amenity: 25,
  shop: 25,
  tourism: 25,
  historic: 22,
  leisure: 20,
  public_transport: 18,
  railway: 18,
  healthcare: 20,
  office: 15,
  craft: 15,
  natural: 12,
  place: 10,
  man_made: 8,
};

/** Score a candidate. Distance from the click matters, but a named, tagged
 * feature that contains or sits right on the click beats a closer unnamed one. */
function scoreElement(el: OverpassEl, click: Coordinate): { score: number; distance: number } | null {
  const tags = el.tags || {};
  if (!tags.name) return null;
  const lat = el.lat ?? el.center?.lat;
  const lon = el.lon ?? el.center?.lon;
  if (lat == null || lon == null) return null;
  const distance = haversineMeters(click, [lon, lat]);
  const key = POI_KEYS.find((k) => tags[k]);
  const importance = key ? CATEGORY_IMPORTANCE[key] : 0;
  const isBuilding = Boolean(tags.building);
  const score =
    Math.max(0, 60 - distance) * 0.9 + // closer is better, within ~60 m
    importance +
    (isBuilding ? 12 : 0) +
    (tags.wikidata || tags.wikipedia ? 6 : 0) +
    8; // has a name
  return { score, distance };
}

async function overpassNearby(c: Coordinate): Promise<OverpassEl[]> {
  const [lon, lat] = c;
  const query = `[out:json][timeout:10];(nwr(around:60,${lat},${lon})[name];);out center tags 40;`;
  const data = await overpassQuery<{ elements?: OverpassEl[] }>(query, 3500);
  return data?.elements ?? [];
}

function elementToPlace(el: OverpassEl, click: Coordinate): ClyraPlace | null {
  const lat = el.lat ?? el.center?.lat;
  const lon = el.lon ?? el.center?.lon;
  if (lat == null || lon == null || !el.tags?.name) return null;
  const t = el.tags;
  const categories = POI_KEYS.map((k) => (t[k] ? `${k}=${t[k]}` : null)).filter(Boolean) as string[];
  const address = [t["addr:housenumber"], t["addr:street"]].filter(Boolean).join(" ") || undefined;
  return {
    id: `osm-${el.type}-${el.id}`,
    name: t.name,
    coordinates: [lon, lat],
    address,
    locality: t["addr:suburb"] || t["addr:city"],
    categories: categories.map((c) => c.split("=")[1]),
    phone: t.phone || t["contact:phone"],
    website: t.website || t["contact:website"],
    openingHours: t.opening_hours ? { raw: t.opening_hours } : undefined,
    cuisine: t.cuisine ? t.cuisine.split(";").map((s) => s.trim()).filter(Boolean) : undefined,
    distanceMeters: haversineMeters(click, [lon, lat]),
    sourceLinks: [{ provider: "OpenStreetMap" }],
  } as ClyraPlace;
}

/* -------------------------------- Identify ------------------------------- */

export async function identifyPoint(c: Coordinate): Promise<IdentifyResult> {
  const key = cacheKey(c);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;

  const [elements, reverse] = await Promise.all([overpassNearby(c), nominatimReverse(c)]);
  const sources: string[] = [];
  if (elements.length) sources.push("OpenStreetMap (Overpass)");
  if (reverse) sources.push("OpenStreetMap (Nominatim)");

  const ranked = elements
    .map((el) => ({ el, s: scoreElement(el, c) }))
    .filter((x): x is { el: OverpassEl; s: { score: number; distance: number } } => x.s !== null)
    .sort((a, b) => b.s.score - a.s.score);

  const best = ranked[0];
  const address = reverse ? addressFrom(reverse) : undefined;
  let place: ClyraPlace | undefined;
  let kind: IdentifyResult["kind"] = "pin";

  if (best && best.s.distance <= 45) {
    place = elementToPlace(best.el, c) ?? undefined;
    if (place) kind = "place";
  }
  // Nominatim can name a building or landmark the Overpass search missed.
  // A bare house number ("1 Heath Street") is an address, not a named place.
  const nameIsJustAddress =
    Boolean(reverse?.name && address?.houseNumber) && reverse!.name!.startsWith(address!.houseNumber!);
  if (
    !place &&
    reverse?.name &&
    reverse.osm_type &&
    reverse.osm_id &&
    reverse.category !== "highway" &&
    reverse.category !== "boundary" &&
    !nameIsJustAddress
  ) {
    const lon = Number(reverse.lon);
    const lat = Number(reverse.lat);
    place = {
      id: `osm-${reverse.osm_type}-${reverse.osm_id}`,
      name: reverse.name,
      coordinates: [lon, lat],
      address: address?.formatted,
      categories: [reverse.type || reverse.category || "place"].filter(Boolean) as string[],
      distanceMeters: haversineMeters(c, [lon, lat]),
      sourceLinks: [{ provider: "OpenStreetMap (Nominatim)" }],
    } as ClyraPlace;
    kind = "place";
  }
  if (!place && address?.road) kind = "address";

  const nearby = ranked
    .filter((x) => x.el !== best?.el)
    .slice(0, 10)
    .map((x) => elementToPlace(x.el, c))
    .filter((p): p is ClyraPlace => p !== null);

  const value: IdentifyResult = { kind, coordinates: c, place, address, nearby, sources };
  // An empty Overpass answer may just be an overloaded mirror: keep it only briefly.
  cache.set(key, { at: elements.length ? Date.now() : Date.now() - CACHE_TTL_MS + 30_000, value });
  return value;
}
