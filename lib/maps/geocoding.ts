/** Clyra Maps geocoding gateway. Photon is the only type-ahead source. */
export interface NormalizedGeocodeResult {
  id: string;
  source: "photon";
  label: string;
  formattedAddress: string;
  latitude: number;
  longitude: number;
  placeClass: string;
  type: string;
  country?: string;
  region?: string;
  locality?: string;
  postcode?: string;
  importance?: number;
  metadata: Record<string, string | number | boolean | null | undefined>;
}

export interface GeocoderProvider {
  id: string;
  search(query: string, options?: GeocoderSearchOptions): Promise<NormalizedGeocodeResult[]>;
  autocomplete(query: string, options?: GeocoderSearchOptions): Promise<NormalizedGeocodeResult[]>;
  reverse(latitude: number, longitude: number, signal?: AbortSignal): Promise<NormalizedGeocodeResult | null>;
  details(id: string, signal?: AbortSignal): Promise<NormalizedGeocodeResult | null>;
  nearby(latitude: number, longitude: number, query?: string, signal?: AbortSignal): Promise<NormalizedGeocodeResult[]>;
  healthCheck(signal?: AbortSignal): Promise<boolean>;
}

export interface GeocoderSearchOptions {
  latitude?: number;
  longitude?: number;
  language?: string;
  signal?: AbortSignal;
}

const PHOTON_URL = "https://photon.komoot.io/api/";
const PHOTON_REVERSE_URL = "https://photon.komoot.io/reverse";
const USER_AGENT = "ClyraMaps/2.0 (desktop map application; contact: maps@clyra.ai)";
const CACHE_TTL_MS = 90_000;
const cache = new Map<string, { expiresAt: number; value: NormalizedGeocodeResult[] }>();
const inFlight = new Map<string, Promise<NormalizedGeocodeResult[]>>();

function classify(raw: string): { placeClass: string; type: string } {
  const value = raw.toLowerCase();
  if (value === "country") return { placeClass: "country", type: "country" };
  if (["state", "county", "region", "province", "administrative"].includes(value)) return { placeClass: "region", type: value };
  if (["city", "town", "village", "hamlet", "municipality"].includes(value)) return { placeClass: "city", type: value };
  if (["district", "suburb", "quarter", "neighbourhood", "neighborhood", "locality", "borough"].includes(value)) return { placeClass: "suburb", type: value };
  if (["street", "road", "residential", "pedestrian", "highway"].includes(value)) return { placeClass: "street", type: value };
  if (["house", "building", "address", "housenumber"].includes(value)) return { placeClass: "address", type: value };
  return { placeClass: "poi", type: value || "place" };
}

function photonToNormalized(feature: unknown): NormalizedGeocodeResult | null {
  const f = feature as { geometry?: { coordinates?: unknown[] }; properties?: Record<string, unknown> };
  const lon = Number(f.geometry?.coordinates?.[0]);
  const lat = Number(f.geometry?.coordinates?.[1]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const p = f.properties ?? {};
  const name = typeof p.name === "string" && p.name.trim() ? p.name.trim() : "";
  const address = [p.housenumber, p.street, p.district, p.city, p.state, p.postcode, p.country]
    .filter((part): part is string => typeof part === "string" && part.trim().length > 0)
    .join(", ");
  const rawType = typeof p.type === "string" ? p.type : "place";
  const { placeClass, type } = classify(rawType);
  const label = name || address || `${lat.toFixed(4)}, ${lon.toFixed(4)}`;
  const osmId = typeof p.osm_id === "number" || typeof p.osm_id === "string" ? String(p.osm_id) : `${lon.toFixed(5)},${lat.toFixed(5)},${label}`;
  return {
    id: `photon:${osmId}`,
    source: "photon",
    label,
    formattedAddress: address || label,
    latitude: lat,
    longitude: lon,
    placeClass,
    type,
    country: typeof p.country === "string" ? p.country : undefined,
    region: typeof p.state === "string" ? p.state : undefined,
    locality: typeof p.city === "string" ? p.city : typeof p.district === "string" ? p.district : undefined,
    postcode: typeof p.postcode === "string" ? p.postcode : undefined,
    importance: Number.isFinite(Number(p.importance)) ? Number(p.importance) : undefined,
    metadata: {
      osmType: typeof p.osm_type === "string" ? p.osm_type : undefined,
      osmKey: typeof p.osm_key === "string" ? p.osm_key : undefined,
      osmValue: typeof p.osm_value === "string" ? p.osm_value : undefined,
      phone: typeof p.phone === "string" ? p.phone : undefined,
      website: typeof p.website === "string" ? p.website : undefined,
    },
  };
}

async function fetchPhoton(url: URL, signal?: AbortSignal): Promise<NormalizedGeocodeResult[]> {
  const response = await fetch(url, { signal, headers: { Accept: "application/json", "User-Agent": USER_AGENT } });
  if (!response.ok) throw new Error(`Photon ${response.status}`);
  const body = await response.json() as { features?: unknown[] };
  return (body.features ?? []).map(photonToNormalized).filter((place): place is NormalizedGeocodeResult => place !== null);
}

function keyFor(query: string, options?: GeocoderSearchOptions): string {
  const location = Number.isFinite(options?.latitude) && Number.isFinite(options?.longitude)
    ? `${Math.round(Number(options!.latitude) * 10) / 10},${Math.round(Number(options!.longitude) * 10) / 10}`
    : "global";
  return `${query.toLocaleLowerCase()}|${location}|${options?.language ?? ""}`;
}

const photonProvider: GeocoderProvider = {
  id: "photon",
  async search(query, options) {
    const cleaned = query.trim().slice(0, 200);
    if (cleaned.length < 2) return [];
    const key = keyFor(cleaned, options);
    const cached = cache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.value;
    const existing = inFlight.get(key);
    if (existing) return existing;
    const work = (async () => {
      const url = new URL(PHOTON_URL);
      url.searchParams.set("q", cleaned);
      url.searchParams.set("limit", "12");
      if (Number.isFinite(options?.latitude) && Number.isFinite(options?.longitude)) {
        url.searchParams.set("lat", String(options!.latitude));
        url.searchParams.set("lon", String(options!.longitude));
      }
      if (options?.language) url.searchParams.set("lang", options.language);
      const value = await fetchPhoton(url, options?.signal);
      cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
      return value;
    })().finally(() => inFlight.delete(key));
    inFlight.set(key, work);
    return work;
  },
  async autocomplete(query, options) { return this.search(query, options); },
  async reverse(latitude, longitude, signal) {
    const url = new URL(PHOTON_REVERSE_URL);
    url.searchParams.set("lat", String(latitude));
    url.searchParams.set("lon", String(longitude));
    url.searchParams.set("limit", "1");
    return (await fetchPhoton(url, signal))[0] ?? null;
  },
  async details(_id, _signal) { return null; },
  async nearby(latitude, longitude, query = "", signal) {
    return this.search(query || "amenity", { latitude, longitude, signal });
  },
  async healthCheck(signal) {
    const url = new URL(PHOTON_URL);
    url.searchParams.set("q", "Sydney");
    url.searchParams.set("limit", "1");
    try { await fetchPhoton(url, signal); return true; } catch { return false; }
  },
};

export function getGeocoderProvider(): GeocoderProvider { return photonProvider; }
export async function searchPlaces(query: string, signal?: AbortSignal): Promise<NormalizedGeocodeResult[]> {
  return photonProvider.autocomplete(query, { signal });
}

/** Backwards-compatible adapter retained for Clyra's existing tool clients. */
export function toGoogleShape(results: NormalizedGeocodeResult[]) {
  return {
    places: results.map((r) => ({
      id: r.id, source: r.source, name: r.label, displayName: r.formattedAddress,
      category: r.placeClass, coordinates: [r.longitude, r.latitude], country: r.country,
      region: r.region, locality: r.locality, postcode: r.postcode, importance: r.importance,
      metadata: r.metadata,
    })),
    results: results.map((r) => ({
      formatted_address: r.formattedAddress,
      geometry: { location: { lat: r.latitude, lng: r.longitude } },
      address_components: [{ long_name: r.label, short_name: r.label }],
      types: [r.type, r.placeClass],
    })),
  };
}
