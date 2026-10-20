/** Instant category search straight from the map's own vector tiles. Fetches the
 * z14 tiles around a point (cached by the tile service worker), decodes their
 * `poi` layer and filters by category: no third-party search service involved,
 * so it keeps working when public Overpass servers are slow. */
import Pbf from "pbf";
import { VectorTile } from "@mapbox/vector-tile";
import type { ClyraPlace, Coordinate } from "../../lib/maps/types";
import { TILE_CATEGORIES } from "./categories";
import { lonLatToTile } from "./offline";

const TILEJSON_URL = "https://tiles.openfreemap.org/planet";
const Z = 14;
let templatePromise: Promise<string | null> | null = null;

function tileTemplate(): Promise<string | null> {
  templatePromise ??= fetch(TILEJSON_URL)
    .then((r) => r.json() as Promise<{ tiles?: string[] }>)
    .then((j) => j.tiles?.[0] ?? null)
    .catch(() => {
      templatePromise = null;
      return null;
    });
  return templatePromise;
}

function distanceMeters(a: Coordinate, b: Coordinate) {
  const dy = (b[1] - a[1]) * 111_320;
  const dx = (b[0] - a[0]) * 111_320 * Math.cos((((a[1] + b[1]) / 2) * Math.PI) / 180);
  return Math.hypot(dx, dy);
}

export async function fetchTilePois(category: string, near: Coordinate, limit = 25, signal?: AbortSignal): Promise<ClyraPlace[]> {
  const rule = TILE_CATEGORIES[category];
  const template = await tileTemplate();
  if (!rule || !template) return [];
  const [cx, cy] = lonLatToTile(near[0], near[1], Z);
  const coords: Array<[number, number]> = [];
  for (let dx = -1; dx <= 1; dx += 1) for (let dy = -1; dy <= 1; dy += 1) coords.push([cx + dx, cy + dy]);
  const seen = new Set<string>();
  const out: ClyraPlace[] = [];
  await Promise.all(
    coords.map(async ([x, y]) => {
      try {
        const res = await fetch(template.replace("{z}", String(Z)).replace("{x}", String(x)).replace("{y}", String(y)), { signal });
        if (!res.ok) return;
        const tile = new VectorTile(new Pbf(new Uint8Array(await res.arrayBuffer())));
        const layer = tile.layers.poi;
        if (!layer) return;
        for (let i = 0; i < layer.length; i += 1) {
          const f = layer.feature(i);
          const p = f.properties as Record<string, unknown>;
          if (!rule.classes.includes(String(p.class)) || (rule.subclasses && !rule.subclasses.includes(String(p.subclass)))) continue;
          const name = String(p.name ?? "").trim() || rule.fallbackName;
          if (!name) continue;
          const g = f.toGeoJSON(x, y, Z).geometry as { type: string; coordinates: Coordinate };
          if (g.type !== "Point") continue;
          const c: Coordinate = [g.coordinates[0], g.coordinates[1]];
          const key = `${name}|${c[0].toFixed(5)},${c[1].toFixed(5)}`;
          if (seen.has(key)) continue;
          seen.add(key);
          out.push({
            id: `tile-${String(p.class)}-${c[0].toFixed(5)}-${c[1].toFixed(5)}`,
            name,
            coordinates: c,
            categories: [String(p.subclass || p.class)],
            distanceMeters: distanceMeters(near, c),
            sourceLinks: [{ provider: "OpenStreetMap" }],
          });
        }
      } catch {
        // One tile failing just means fewer results.
      }
    }),
  );
  return out.sort((a, b) => (a.distanceMeters ?? 0) - (b.distanceMeters ?? 0)).slice(0, limit);
}
