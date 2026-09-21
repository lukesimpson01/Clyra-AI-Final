import type { LngLat, Place } from "../core/types";

export interface SearchRankContext {
  query: string;
  center?: LngLat | null;
  viewport?: [LngLat, LngLat] | null;
  recents?: Place[];
  favourites?: Place[];
}

const FAMOUS_MINIMUM = 0.58;

function folded(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase().trim();
}

function distanceM(a: LngLat, b: LngLat): number {
  const r = 6_371_000;
  const dLat = (b[1] - a[1]) * Math.PI / 180;
  const dLon = (b[0] - a[0]) * Math.PI / 180;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * Math.PI / 180) * Math.cos(b[1] * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return r * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

function categoryBoost(place: Place, query: string): number {
  const category = folded(place.category);
  if (query.includes("airport") && category === "airport") return 0.18;
  if ((query.includes("cafe") || query.includes("coffee")) && category === "cafe") return 0.18;
  if (query.includes("restaurant") && category === "restaurant") return 0.18;
  if (query.includes("hospital") && category === "hospital") return 0.18;
  if (query.includes("parking") && category === "parking") return 0.18;
  if (/^\d/.test(query) && place.category === "address") return 0.25;
  return 0;
}

function isWithin(point: LngLat, bounds: [LngLat, LngLat]): boolean {
  const [[west, south], [east, north]] = bounds;
  return point[0] >= west && point[0] <= east && point[1] >= south && point[1] <= north;
}

/**
 * Ranks provider results without ever making nearby noise beat a strong global
 * name match. This is intentionally deterministic so UI order remains stable
 * across delayed and cached search responses.
 */
export function rankPlaces(places: Place[], context: SearchRankContext): Place[] {
  const query = folded(context.query);
  const recentIds = new Set(context.recents?.map((place) => place.id));
  const favouriteIds = new Set(context.favourites?.map((place) => place.id));
  const scored = places.map((place, index) => {
    const name = folded(place.name);
    const display = folded(place.displayName);
    const exact = name === query ? 1 : 0;
    const prefix = name.startsWith(query) ? 1 : 0;
    const contained = name.includes(query) || display.includes(query) ? 1 : 0;
    const textual = exact ? 0.64 : prefix ? 0.52 : contained ? 0.33 : 0.08;
    const importance = Math.min(0.22, Math.max(0, place.importance ?? 0) * 0.22);
    const proximity = context.center
      ? Math.max(0, 0.2 - Math.min(0.2, distanceM(context.center, place.coordinates) / 150_000 * 0.2))
      : 0;
    const viewport = context.viewport && isWithin(place.coordinates, context.viewport) ? 0.09 : 0;
    const history = recentIds.has(place.id) ? 0.07 : favouriteIds.has(place.id) ? 0.1 : 0;
    // A famous exact result must not be displaced by a nearby business with a
    // loose name match; it keeps at least a high textual / prominence floor.
    const globalFloor = (exact || prefix) && (place.importance ?? 0) > 0.45 ? FAMOUS_MINIMUM : 0;
    const score = Math.max(globalFloor, textual + importance + proximity + viewport + history + categoryBoost(place, query));
    return { place: { ...place, distanceM: context.center ? distanceM(context.center, place.coordinates) : undefined }, score, index };
  });
  return scored.sort((a, b) => b.score - a.score || a.index - b.index).map(({ place }) => place);
}

export function highlightMatch(value: string, query: string): Array<{ text: string; match: boolean }> {
  const clean = query.trim();
  if (!clean) return [{ text: value, match: false }];
  const start = folded(value).indexOf(folded(clean));
  if (start < 0) return [{ text: value, match: false }];
  return [
    { text: value.slice(0, start), match: false },
    { text: value.slice(start, start + clean.length), match: true },
    { text: value.slice(start + clean.length), match: false },
  ].filter((part) => part.text);
}
