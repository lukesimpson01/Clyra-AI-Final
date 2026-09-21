import type { LngLat, Place, PlaceCategory } from "./core/types";
import { SearchController } from "./search/searchController";

function category(value: unknown): PlaceCategory {
  const allowed = new Set<PlaceCategory>([
    "country", "region", "city", "suburb", "neighbourhood", "postcode", "street", "address", "building", "business", "attraction", "airport", "station", "transit", "hospital", "school", "university", "park", "beach", "restaurant", "cafe", "hotel", "fuel", "charger", "shopping", "parking", "place",
  ]);
  return typeof value === "string" && allowed.has(value as PlaceCategory) ? value as PlaceCategory : "place";
}

function parsePlace(value: unknown): Place | null {
  const item = value as Partial<Place>;
  const coords = item.coordinates;
  if (!Array.isArray(coords) || !Number.isFinite(Number(coords[0])) || !Number.isFinite(Number(coords[1]))) return null;
  const name = typeof item.name === "string" ? item.name.trim() : "";
  if (!name) return null;
  return {
    id: typeof item.id === "string" ? item.id : `place:${coords[0]},${coords[1]},${name}`,
    source: typeof item.source === "string" ? item.source : "unknown",
    name,
    displayName: typeof item.displayName === "string" ? item.displayName : name,
    category: category(item.category),
    coordinates: [Number(coords[0]), Number(coords[1])],
    country: typeof item.country === "string" ? item.country : undefined,
    region: typeof item.region === "string" ? item.region : undefined,
    locality: typeof item.locality === "string" ? item.locality : undefined,
    postcode: typeof item.postcode === "string" ? item.postcode : undefined,
    importance: Number.isFinite(Number(item.importance)) ? Number(item.importance) : undefined,
    metadata: typeof item.metadata === "object" && item.metadata ? item.metadata as Place["metadata"] : {},
  };
}

export async function requestPlaces(query: string, options: { signal: AbortSignal; bias?: LngLat | null }): Promise<{ places: Place[]; cached?: boolean }> {
  const params = new URLSearchParams({ q: query, lang: navigator.language });
  if (options.bias) { params.set("lat", String(options.bias[1])); params.set("lon", String(options.bias[0])); }
  const response = await fetch(`/api/maps/geocode?${params}`, { signal: options.signal, headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error("Place search is temporarily unavailable");
  const payload = await response.json() as { places?: unknown[]; cached?: boolean };
  return { places: (payload.places ?? []).map(parsePlace).filter((place): place is Place => place !== null), cached: payload.cached };
}

export const placeSearch = new SearchController(requestPlaces);
