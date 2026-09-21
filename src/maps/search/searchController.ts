import type { LngLat, Place } from "../core/types";
import { rankPlaces } from "./placeRanker";

export interface SearchResponse { places: Place[]; cached?: boolean; }
export type RemoteSearch = (query: string, options: { signal: AbortSignal; bias?: LngLat | null }) => Promise<SearchResponse>;

interface CachedQuery { value: SearchResponse; expiresAt: number; }

/**
 * Coalesces duplicate calls, aborts stale type-ahead requests, and produces a
 * cache hit synchronously before starting a background refresh. It stores only
 * a coarse geographic bias (rounded to 0.1°), never a movement trail.
 */
export class SearchController {
  private active: AbortController | null = null;
  private generation = 0;
  private readonly cache = new Map<string, CachedQuery>();
  private readonly inflight = new Map<string, Promise<SearchResponse>>();

  constructor(private readonly remoteSearch: RemoteSearch) {}

  cancel(): void { this.active?.abort(); this.active = null; }

  async search(query: string, options: {
    bias?: LngLat | null;
    recents?: Place[];
    favourites?: Place[];
    viewport?: [LngLat, LngLat] | null;
  }): Promise<{ places: Place[]; stale: boolean }> {
    const cleaned = query.trim().replace(/\s+/g, " ");
    if (cleaned.length < 2) return { places: [], stale: false };
    this.cancel();
    const controller = new AbortController();
    this.active = controller;
    const requestGeneration = ++this.generation;
    const key = this.cacheKey(cleaned, options.bias);
    const cached = this.cache.get(key);
    const local = rankPlaces([...(options.recents ?? []), ...(options.favourites ?? [])], { query: cleaned, center: options.bias, viewport: options.viewport, recents: options.recents, favourites: options.favourites });
    if (cached && cached.expiresAt > Date.now()) {
      void this.refresh(key, cleaned, options.bias, controller.signal);
      return { places: this.merge(local, cached.value.places, cleaned, options), stale: true };
    }
    const response = await this.refresh(key, cleaned, options.bias, controller.signal);
    if (requestGeneration !== this.generation || controller.signal.aborted) throw new DOMException("Search superseded", "AbortError");
    return { places: this.merge(local, response.places, cleaned, options), stale: false };
  }

  private merge(local: Place[], remote: Place[], query: string, options: { bias?: LngLat | null; recents?: Place[]; favourites?: Place[]; viewport?: [LngLat, LngLat] | null }): Place[] {
    const unique = new Map<string, Place>();
    for (const place of [...local, ...remote]) {
      const key = `${place.name.toLocaleLowerCase()}|${place.coordinates[0].toFixed(4)}|${place.coordinates[1].toFixed(4)}`;
      if (!unique.has(key)) unique.set(key, place);
    }
    return rankPlaces([...unique.values()], { query, center: options.bias, viewport: options.viewport, recents: options.recents, favourites: options.favourites });
  }

  private refresh(key: string, query: string, bias: LngLat | null | undefined, signal: AbortSignal): Promise<SearchResponse> {
    const existing = this.inflight.get(key);
    if (existing) return existing;
    const work = this.remoteSearch(query, { signal, bias })
      .then((value) => {
        this.cache.set(key, { value, expiresAt: Date.now() + 90_000 });
        return value;
      })
      .finally(() => this.inflight.delete(key));
    this.inflight.set(key, work);
    return work;
  }

  private cacheKey(query: string, bias?: LngLat | null): string {
    const coarse = bias ? `${Math.round(bias[0] * 10) / 10},${Math.round(bias[1] * 10) / 10}` : "global";
    return `${query.toLocaleLowerCase()}|${coarse}|${navigator.language}`;
  }
}
