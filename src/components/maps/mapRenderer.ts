import * as maplibregl from "maplibre-gl";
import type { Map as MapLibreMap, StyleSpecification } from "maplibre-gl";
import { clyraExploreLightStyle, withVectorSource } from "../../maps/styles/clyra-explore-light";
import { resolveTileProvider } from "../../maps/providers";

/**
 * MapLibre renders tiles in a Web Worker. In a bundler the worker script is
 * resolved from `import.meta.url`, which Vite does not emit — the worker 404s
 * and the map silently stays blank. The worker + shared chunk are copied to
 * public/vendor/maplibre and wired here explicitly so tile parsing always runs.
 */
const MAPLIBRE_WORKER_URL = "/vendor/maplibre/maplibre-gl-worker.mjs";

let workerUrlConfigured = false;
function ensureWorkerUrl() {
  if (workerUrlConfigured || typeof window === "undefined") return;
  try {
    maplibregl.setWorkerUrl(MAPLIBRE_WORKER_URL);
    workerUrlConfigured = true;
  } catch (error) {
    console.warn("[maps] worker URL setup failed:", error instanceof Error ? error.message : error);
  }
}

export interface CreateStandardMapOptions {
  container: HTMLElement;
  center?: [number, number];
  zoom?: number;
  bearing?: number;
  pitch?: number;
  attributionControl?: false | Record<string, unknown>;
}

/** Create the MapLibre Explore map with the Clyra style and resolved source. */
export function createStandardMap(options: CreateStandardMapOptions): MapLibreMap {
  ensureWorkerUrl();
  const provider = resolveTileProvider();
  const style: StyleSpecification = withVectorSource(clyraExploreLightStyle, {
    type: "vector",
    url: provider.vectorSourceUrl,
  });
  // Keep label glyphs on the same hosted infrastructure as the tiles.
  style.glyphs = provider.glyphsUrl;

  const map = new maplibregl.Map({
    container: options.container,
    style,
    center: options.center ?? [151.1022, -33.6631],
    zoom: options.zoom ?? 13,
    bearing: options.bearing ?? 0,
    pitch: options.pitch ?? 0,
    attributionControl: options.attributionControl ?? { compact: true },
    // MapLibre renders at the device's native pixel ratio by default, which
    // keeps roads, labels and casings razor sharp on Retina / HiDPI displays.
    canvasContextAttributes: { antialias: true },
  });

  // More responsive, smoother wheel/trackpad zoom than the MapLibre defaults.
  map.scrollZoom.setZoomRate(1 / 35);
  map.scrollZoom.setWheelZoomRate(1 / 260);

  map.once("load", () => {
    // Warm the worker pool now that the style + first tiles are in.
    void maplibregl.prewarm();
  });
  return map;
}

/** Prewarm the MapLibre worker pool before the Maps workspace is opened. */
export function prewarmMapLibre(): void {
  try {
    ensureWorkerUrl();
    void maplibregl.prewarm();
  } catch {
    // Prewarming is opportunistic; the map still boots without it.
  }
}
