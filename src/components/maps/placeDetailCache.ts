import type { ClyraPlace } from "../../../lib/maps/types";

export interface PlacePhotoInfo {
  url: string;
  attribution?: string;
}

export interface PlaceInfoResult {
  ok: boolean;
  summary?: string;
  summaryUrl?: string;
  photos?: PlacePhotoInfo[];
}

export interface PlaceReviewItem {
  id: string;
  rating: number;
  text?: string;
  createdAt?: string;
  sourceUrl: string;
}

export interface PlaceReviewsResult {
  rating?: number;
  count: number;
  items: PlaceReviewItem[];
}

export interface StreetImage {
  id: string;
  provider: "Panoramax" | "KartaView";
  url: string;
  takenAt?: string;
  license?: string;
  sourcePage?: string;
}

export interface PlaceDetailBundle {
  info: PlaceInfoResult | null;
  reviews: PlaceReviewsResult | null;
  reviewsChecked: boolean;
  streetImages: StreetImage[];
}

const CACHE_TTL_MS = 10 * 60 * 1000;
const EMPTY_BUNDLE: PlaceDetailBundle = { info: null, reviews: null, reviewsChecked: true, streetImages: [] };

interface Entry {
  at: number;
  promise: Promise<PlaceDetailBundle>;
  resolved?: PlaceDetailBundle;
}

const cache = new Map<string, Entry>();

function warmImages(bundle: PlaceDetailBundle) {
  // Fires the actual byte fetch for the photos we're about to show, ahead of
  // the <img> mounting — so by the time the sheet opens, the browser's own
  // HTTP cache already has them and the first paint is instant, not a spinner.
  if (typeof window === "undefined") return;
  const urls = [...(bundle.info?.photos?.slice(0, 3).map((p) => p.url) ?? []), bundle.streetImages[0]?.url].filter(
    (u): u is string => Boolean(u),
  );
  for (const url of urls) {
    const img = new window.Image();
    img.src = url;
  }
}

function fetchBundle(place: ClyraPlace): Promise<PlaceDetailBundle> {
  const isPin = place.id.startsWith("pin-") || place.id === "parked-car";
  const [lng, lat] = place.coordinates;

  const info: Promise<PlaceInfoResult | null> = fetch("/api/maps/place-info", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: isPin ? "" : place.name, coordinates: place.coordinates }),
  })
    .then((r) => r.json())
    .then((data: PlaceInfoResult) => (data.ok ? data : null))
    .catch(() => null);

  const osm = place.id.match(/^osm-((?:node|way|relation)-\d+)/);
  const reviews: Promise<{ checked: boolean; reviews: PlaceReviewsResult | null }> = osm
    ? fetch("/api/maps/reviews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ osmId: osm[1].replace("-", "/") }),
      })
        .then((r) => r.json())
        .then((d: { ok: boolean; reviews: PlaceReviewsResult | null }) => ({ checked: true, reviews: d.ok ? d.reviews : null }))
        .catch(() => ({ checked: true, reviews: null }))
    : Promise.resolve({ checked: true, reviews: null });

  const streetImages: Promise<StreetImage[]> = fetch("/api/maps/street-imagery", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ coordinates: [lng, lat] }),
  })
    .then((r) => r.json())
    .then((d: { ok: boolean; images?: StreetImage[] }) => (d.ok ? d.images ?? [] : []))
    .catch(() => []);

  return Promise.all([info, reviews, streetImages]).then(([infoRes, reviewsRes, streetRes]) => {
    const bundle: PlaceDetailBundle = {
      info: infoRes,
      reviews: reviewsRes.reviews,
      reviewsChecked: reviewsRes.checked,
      streetImages: streetRes,
    };
    warmImages(bundle);
    return bundle;
  });
}

/** Cache-first fetch, deduped by place id. Concurrent callers (a hover
 * prefetch followed by the actual click) share the same in-flight request. */
export function getPlaceDetail(place: ClyraPlace): Promise<PlaceDetailBundle> {
  if (place.id.startsWith("pin-")) return Promise.resolve(EMPTY_BUNDLE);
  const hit = cache.get(place.id);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.promise;
  const promise = fetchBundle(place);
  const entry: Entry = { at: Date.now(), promise };
  cache.set(place.id, entry);
  void promise.then((resolved) => {
    entry.resolved = resolved;
  });
  return promise;
}

/** Synchronous peek at an already-resolved bundle, so a selection can render
 * fully loaded on the very first frame instead of flashing a skeleton. */
export function peekPlaceDetail(place: ClyraPlace): PlaceDetailBundle | null {
  const hit = cache.get(place.id);
  if (!hit || Date.now() - hit.at >= CACHE_TTL_MS) return null;
  return hit.resolved ?? null;
}

/** Warms the cache ahead of a click — call from hover on a result row or chip. */
export function prefetchPlaceDetail(place: ClyraPlace) {
  void getPlaceDetail(place);
}
