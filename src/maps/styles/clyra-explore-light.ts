import type { SourceSpecification, StyleSpecification } from "maplibre-gl";
import { MAP_COLORS, MAP_ZOOM } from "../mapTokens";

/**
 * Clyra Explore — light-mode vector cartography for MapLibre.
 *
 * Built against the Shortbread vector-tile schema (the schema served by
 * OpenFreeMap's `planet` tileset and by Protomaps PMTiles builds): layers
 * `transportation` / `transportation_name`, `place`, `poi`, `building`,
 * `water`, `waterway`, `landcover`, `landuse`, `park`, `boundary`,
 * `aerodrome_label`, `water_name`.
 *
 * The palette reproduces the calm, low-saturation Apple-Maps light language
 * (warm near-white land, clean cyan water, restrained greens, strong road
 * casing hierarchy) without copying any proprietary tiles or artwork.
 */

const SRC = "clyra-vector";

export const CLYRA_GLYPHS = "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf";

const FONT_REGULAR = ["Noto Sans Regular"];
// OpenFreeMap's glyph endpoint ships Regular/Bold/Italic but not Medium — use
// Bold for the semi-bold tier so every fontstack resolves to real glyphs.
const FONT_MEDIUM = ["Noto Sans Bold"];
const FONT_BOLD = ["Noto Sans Bold"];
const FONT_ITALIC = ["Noto Sans Italic"];

type Paint = Record<string, unknown>;
type Layout = Record<string, unknown>;

const roundLayout = { "line-join": "round", "line-cap": "round" } as const;

/** `interpolate` line width across zoom. */
function width(stops: [number, number][], base = 1.5): unknown {
  return ["interpolate", ["exponential", base], ["zoom"], ...stops.flat()];
}

const nameExpr = ["coalesce", ["get", "name"], ["get", "name:en"]] as const;

interface RoadClass {
  kind: string;
  minzoom: number;
  fill: string;
  casing: string;
  fillStops: [number, number][];
  casingStops: [number, number][];
}

const ROADS: RoadClass[] = [
  { kind: "motorway", minzoom: MAP_ZOOM.motorway, fill: MAP_COLORS.motorwayFill, casing: MAP_COLORS.motorwayCasing,
    fillStops: [[4, 1.1], [7, 1.6], [10, 3.4], [13, 8], [16, 13], [19, 18]],
    casingStops: [[4, 2.1], [7, 2.8], [10, 4.8], [13, 10], [16, 15.5], [19, 21]] },
  { kind: "trunk", minzoom: MAP_ZOOM.trunk, fill: MAP_COLORS.trunkFill, casing: MAP_COLORS.trunkCasing,
    fillStops: [[6, 0.8], [9, 1.7], [11, 3.2], [14, 6.5], [16, 11], [19, 16]],
    casingStops: [[6, 1.7], [9, 2.8], [11, 4.6], [14, 8.5], [16, 13.5], [19, 19]] },
  { kind: "primary", minzoom: MAP_ZOOM.primary, fill: MAP_COLORS.roadPrimaryFill, casing: MAP_COLORS.roadPrimaryCasing,
    fillStops: [[7, 0.7], [9, 1.5], [11, 2.7], [14, 5], [16, 8.5], [19, 13]],
    casingStops: [[7, 1.5], [9, 2.5], [11, 4], [14, 7], [16, 11], [19, 16]] },
  { kind: "secondary", minzoom: MAP_ZOOM.secondary, fill: MAP_COLORS.roadSecondaryFill, casing: MAP_COLORS.roadSecondaryCasing,
    fillStops: [[9, 0.6], [11, 1.4], [13, 2.6], [15, 4.4], [17, 7], [19, 10]],
    casingStops: [[9, 1.4], [11, 2.4], [13, 3.9], [15, 6], [17, 9], [19, 12.5]] },
  { kind: "tertiary", minzoom: MAP_ZOOM.tertiary, fill: MAP_COLORS.roadLocalFill, casing: MAP_COLORS.roadLocalCasing,
    fillStops: [[11, 0.5], [13, 1.2], [15, 2.2], [17, 3.6], [19, 6]],
    casingStops: [[11, 1.3], [13, 2.2], [15, 3.4], [17, 5.2], [19, 8]] },
  { kind: "minor", minzoom: MAP_ZOOM.minor, fill: MAP_COLORS.roadLocalFill, casing: MAP_COLORS.roadLocalCasing,
    fillStops: [[13, 0.4], [14, 1], [16, 1.9], [18, 3.4], [20, 5]],
    casingStops: [[13, 1.2], [14, 1.9], [16, 3], [18, 4.8], [20, 6.5]] },
  { kind: "service", minzoom: MAP_ZOOM.service, fill: MAP_COLORS.serviceFill, casing: MAP_COLORS.roadLocalCasing,
    fillStops: [[15, 0.3], [16, 0.9], [18, 1.9], [20, 3]],
    casingStops: [[15, 1.1], [16, 1.8], [18, 3], [20, 4.2]] },
];

const MAJOR_KINDS = ["motorway", "trunk", "primary", "secondary"];

/** Ground-level casing + fill for one road class (no tunnel/bridge). */
function roadPair(road: RoadClass): { casing: Paint; fill: Paint } {
  return {
    casing: {
      "line-color": road.casing,
      "line-width": width(road.casingStops),
    },
    fill: {
      "line-color": road.fill,
      "line-width": width(road.fillStops),
    },
  };
}

function roadFilter(kind: string, brunnel?: string): unknown[] {
  const filter: unknown[] = ["all", ["==", ["get", "class"], kind]];
  if (brunnel === "ground") filter.push(["!=", ["get", "brunnel"], "tunnel"], ["!=", ["get", "brunnel"], "bridge"]);
  else if (brunnel) filter.push(["==", ["get", "brunnel"], brunnel]);
  return filter;
}

function lineLayer(id: string, filter: unknown[], paint: Paint, opts: { minzoom?: number; layout?: Layout } = {}): Record<string, unknown> {
  return {
    id, type: "line", source: SRC, "source-layer": "transportation",
    filter, paint,
    layout: { ...roundLayout, ...(opts.layout ?? {}) },
    ...(opts.minzoom != null ? { minzoom: opts.minzoom } : {}),
  };
}

const layers: Record<string, unknown>[] = [];

// ── Base ────────────────────────────────────────────────────────────────
layers.push({
  id: "background", type: "background",
  paint: { "background-color": MAP_COLORS.land },
});

// ── Land cover / land use ───────────────────────────────────────────────
layers.push({
  id: "landcover", type: "fill", source: SRC, "source-layer": "landcover",
  paint: {
    "fill-color": ["match", ["get", "class"],
      "wood", MAP_COLORS.forest,
      "grass", MAP_COLORS.grassland,
      "grassland", MAP_COLORS.grassland,
      "scrub", MAP_COLORS.scrub,
      "sand", "#F2E9D8",
      "beach", "#F6EBD3",
      "glacier", "#EAF2F5",
      "wetland", MAP_COLORS.scrub,
      MAP_COLORS.land],
    "fill-opacity": ["interpolate", ["linear"], ["zoom"], 4, 1, 6, 0.9],
  },
});

layers.push({
  id: "landuse", type: "fill", source: SRC, "source-layer": "landuse",
  paint: {
    "fill-color": ["match", ["get", "class"],
      "residential", "#F0EFEB",
      "commercial", "#EFEEEA",
      "industrial", "#EAEAE6",
      "retail", "#F0EFEB",
      "cemetery", MAP_COLORS.reserve,
      "education", "#F0F0EC",
      "school", "#F0F0EC",
      "college", "#F0F0EC",
      "university", "#F0F0EC",
      "hospital", "#F0EEEC",
      "military", "#EEEDE9",
      "stadium", "#EFEEE9",
      MAP_COLORS.land],
    "fill-opacity": 0.7,
  },
});

// ── Parks / green space (clean flat colour — no tree glyphs) ───────────
layers.push({
  id: "park", type: "fill", source: SRC, "source-layer": "park",
  paint: {
    "fill-color": ["match", ["get", "class"],
      "national_park", MAP_COLORS.forest,
      "nature_reserve", MAP_COLORS.reserve,
      "Nature Reserve", MAP_COLORS.reserve,
      "forest", MAP_COLORS.forest,
      "wood", MAP_COLORS.reserve,
      "golf_course", MAP_COLORS.grassland,
      "park", MAP_COLORS.park,
      "garden", MAP_COLORS.park,
      "cemetery", MAP_COLORS.reserve,
      "protected_area", MAP_COLORS.reserve,
      "conservation", MAP_COLORS.reserve,
      "wildlife_refuge", MAP_COLORS.reserve,
      "historic", MAP_COLORS.grassland,
      MAP_COLORS.park],
    "fill-opacity": ["interpolate", ["linear"], ["zoom"], 6, 0.85, 9, 1],
  },
});

// ── Water ───────────────────────────────────────────────────────────────
layers.push({
  id: "water", type: "fill", source: SRC, "source-layer": "water",
  paint: { "fill-color": MAP_COLORS.water },
});
layers.push({
  id: "waterway", type: "line", source: SRC, "source-layer": "waterway",
  minzoom: 8,
  paint: { "line-color": MAP_COLORS.water, "line-width": width([[8, 0.6], [12, 1.4], [16, 4]], 1.5) },
});

// ── Tunnels (subdued, dashed) for major roads ───────────────────────────
for (const road of ROADS.filter((r) => MAJOR_KINDS.includes(r.kind))) {
  const pair = roadPair(road);
  layers.push(lineLayer(`tunnel-${road.kind}-casing`, roadFilter(road.kind, "tunnel"), {
    "line-color": "#D6D5D0", "line-width": width(road.casingStops), "line-dasharray": [2.4, 1.6]
  }));
  layers.push(lineLayer(`tunnel-${road.kind}`, roadFilter(road.kind, "tunnel"), {
    "line-color": road.fill, "line-width": width(road.fillStops)
  }));
}

// ── Ground roads: casing (lower) + fill (upper) ─────────────────────────
for (const road of ROADS) {
  const pair = roadPair(road);
  layers.push(lineLayer(`road-${road.kind}-casing`, roadFilter(road.kind, "ground"), pair.casing, { minzoom: road.minzoom }));
}
for (const road of ROADS) {
  const pair = roadPair(road);
  layers.push(lineLayer(`road-${road.kind}`, roadFilter(road.kind, "ground"), pair.fill, { minzoom: road.minzoom }));
}

// ── Paths (subtle, never loud dotted red/brown) ────────────────────────
layers.push(lineLayer("road-path", roadFilter("path"), {
  "line-color": MAP_COLORS.pathFill,
  "line-width": width([[13, 0.4], [15, 1], [18, 2]]),
}, { minzoom: MAP_ZOOM.path }));

// ── Rail ────────────────────────────────────────────────────────────────
layers.push(lineLayer("railway", ["==", ["get", "class"], "rail"], {
  "line-color": MAP_COLORS.rail,
  "line-width": width([[6, 0.4], [12, 1], [16, 2.4]]),
  "line-dasharray": [2, 1.4],
 
}));

// ── Bridges (draw over ground roads) ────────────────────────────────────
for (const road of ROADS.filter((r) => MAJOR_KINDS.includes(r.kind))) {
  const pair = roadPair(road);
  layers.push(lineLayer(`bridge-${road.kind}-casing`, roadFilter(road.kind, "bridge"), {
    "line-color": road.casing, "line-width": width(road.casingStops)
  }, { minzoom: road.minzoom + 1 }));
  layers.push(lineLayer(`bridge-${road.kind}`, roadFilter(road.kind, "bridge"), {
    "line-color": road.fill, "line-width": width(road.fillStops)
  }, { minzoom: road.minzoom + 1 }));
}

// ── Boundaries (near-invisible, solid + low opacity) ────────────────────
layers.push({
  id: "boundary", type: "line", source: SRC, "source-layer": "boundary",
  paint: {
    "line-color": "#D8D6D0",
    "line-width": ["interpolate", ["linear"], ["zoom"], 3, 0.4, 8, 0.7],
    "line-opacity": 0.45,
  },
});

// ── Buildings (flat fill, then 3D extrusion at close zoom) ──────────────
layers.push({
  id: "building-fill", type: "fill", source: SRC, "source-layer": "building",
  minzoom: MAP_ZOOM.building,
  paint: { "fill-color": MAP_COLORS.building, "fill-opacity": 0.9 },
});
layers.push({
  id: "building-3d", type: "fill-extrusion", source: SRC, "source-layer": "building",
  minzoom: MAP_ZOOM.building3d,
  paint: {
    "fill-extrusion-color": MAP_COLORS.building,
    "fill-extrusion-height": ["coalesce", ["to-number", ["get", "render_height"]], 12],
    "fill-extrusion-base": ["coalesce", ["to-number", ["get", "render_min_height"]], 0],
    "fill-extrusion-opacity": 0.94,
  },
});

// ── Water labels ────────────────────────────────────────────────────────
layers.push({
  id: "water-name", type: "symbol", source: SRC, "source-layer": "water_name",
  layout: {
    "text-field": nameExpr,
    "text-font": FONT_ITALIC,
    "text-size": ["interpolate", ["linear"], ["zoom"], 8, 11, 14, 14],
    "text-max-width": 8,
    "symbol-placement": "line",
  },
  paint: { "text-color": MAP_COLORS.labelWater, "text-halo-color": MAP_COLORS.halo, "text-halo-width": 1.2 },
});

// ── Road labels ─────────────────────────────────────────────────────────
layers.push({
  id: "road-label-major", type: "symbol", source: SRC, "source-layer": "transportation_name",
  minzoom: 10,
  filter: ["in", ["get", "class"], ["literal", MAJOR_KINDS]],
  layout: {
    "text-field": nameExpr,
    "text-font": FONT_MEDIUM,
    "text-size": 11.5,
    "symbol-placement": "line",
    "text-letter-spacing": 0.04,
    "text-rotation-alignment": "map",
  },
  paint: { "text-color": MAP_COLORS.labelSecondary, "text-halo-color": MAP_COLORS.halo, "text-halo-width": 1.4 },
});
layers.push({
  id: "road-label-minor", type: "symbol", source: SRC, "source-layer": "transportation_name",
  minzoom: 14,
  filter: ["in", ["get", "class"], ["literal", ["tertiary", "minor", "service"]]],
  layout: {
    "text-field": nameExpr,
    "text-font": FONT_REGULAR,
    "text-size": 10.5,
    "symbol-placement": "line",
  },
  paint: { "text-color": MAP_COLORS.labelTertiary, "text-halo-color": MAP_COLORS.halo, "text-halo-width": 1.2 },
});

// ── Places: country → state → city → suburb ────────────────────────────
layers.push({
  id: "place-country", type: "symbol", source: SRC, "source-layer": "place",
  filter: ["==", ["get", "class"], "country"],
  layout: {
    "text-field": nameExpr, "text-font": FONT_BOLD,
    "text-size": ["interpolate", ["linear"], ["zoom"], 2, 10, 7, 18],
    "text-transform": "uppercase", "text-letter-spacing": 0.1,
  },
  paint: { "text-color": MAP_COLORS.labelSecondary, "text-halo-color": MAP_COLORS.halo, "text-halo-width": 1.4 },
});
layers.push({
  id: "place-state", type: "symbol", source: SRC, "source-layer": "place",
  filter: ["in", ["get", "class"], ["literal", ["state", "region", "province"]]],
  layout: {
    "text-field": nameExpr, "text-font": FONT_MEDIUM,
    "text-size": ["interpolate", ["linear"], ["zoom"], 4, 10, 8, 14],
    "text-transform": "uppercase", "text-letter-spacing": 0.08,
  },
  paint: { "text-color": MAP_COLORS.labelTertiary, "text-halo-color": MAP_COLORS.halo, "text-halo-width": 1.3 },
});
layers.push({
  id: "place-city", type: "symbol", source: SRC, "source-layer": "place",
  filter: ["in", ["get", "class"], ["literal", ["city", "town"]]],
  layout: {
    "text-field": nameExpr, "text-font": FONT_MEDIUM,
    "text-size": ["interpolate", ["linear"], ["zoom"], 6, 11, 10, 14, 14, 20],
    "text-anchor": "center", "symbol-sort-key": ["get", "rank"],
  },
  paint: { "text-color": MAP_COLORS.labelPrimary, "text-halo-color": MAP_COLORS.halo, "text-halo-width": 1.6 },
});
layers.push({
  id: "place-suburb", type: "symbol", source: SRC, "source-layer": "place",
  minzoom: 11,
  filter: ["in", ["get", "class"], ["literal", ["suburb", "quarter", "neighbourhood", "village", "hamlet"]]],
  layout: {
    "text-field": nameExpr, "text-font": FONT_REGULAR,
    "text-size": ["interpolate", ["linear"], ["zoom"], 11, 10, 14, 13, 16, 15],
    "text-anchor": "center", "symbol-sort-key": ["get", "rank"],
  },
  paint: { "text-color": MAP_COLORS.labelSecondary, "text-halo-color": MAP_COLORS.halo, "text-halo-width": 1.4 },
});

// ── POIs (text-first, ranked, sparse) ───────────────────────────────────
layers.push({
  id: "poi-label", type: "symbol", source: SRC, "source-layer": "poi",
  minzoom: MAP_ZOOM.poi,
  filter: [">=", ["get", "rank"], 1],
  layout: {
    "text-field": nameExpr,
    "text-font": FONT_REGULAR,
    "text-size": ["interpolate", ["linear"], ["zoom"], 14, 10, 16, 12, 18, 14],
    "text-anchor": "center",
    "text-max-width": 8,
    "symbol-sort-key": ["get", "rank"],
  },
  paint: { "text-color": "#4A4E54", "text-halo-color": MAP_COLORS.halo, "text-halo-width": 1.3 },
});

// ── Airports ────────────────────────────────────────────────────────────
layers.push({
  id: "aerodrome", type: "symbol", source: SRC, "source-layer": "aerodrome_label",
  minzoom: 8,
  layout: {
    "text-field": nameExpr, "text-font": FONT_REGULAR, "text-size": 11,
    "text-anchor": "center",
  },
  paint: { "text-color": "#4A4E54", "text-halo-color": MAP_COLORS.halo, "text-halo-width": 1.3 },
});

export const clyraExploreLightStyle: StyleSpecification = {
  version: 8,
  name: "Clyra Explore Light",
  glyphs: CLYRA_GLYPHS,
  sources: {
    [SRC]: {
      type: "vector",
      url: "https://tiles.openfreemap.org/planet",
    },
  },
  layers: layers as StyleSpecification["layers"],
};

/** Swap the vector source at runtime (PMTiles, self-hosted, custom). */
export function withVectorSource(style: StyleSpecification, source: SourceSpecification): StyleSpecification {
  const sources: Record<string, SourceSpecification> = { [SRC]: source };
  return { ...style, sources };
}
