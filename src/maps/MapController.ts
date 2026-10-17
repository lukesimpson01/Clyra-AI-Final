import maplibregl from "maplibre-gl";
import type { Coordinate, ClyraPlace, Route } from "../../lib/maps/types";
import type { TransitLeg } from "../../lib/maps/transit";
import type { CameraFrame } from "../navigation/NavigationCameraController";

const ROUTE_SOURCE = "clyra-route";
const ROUTE_CASING_LAYER = "clyra-route-casing";
const ROUTE_LINE_LAYER = "clyra-route-line";
const ROUTE_PROGRESS_SOURCE = "clyra-route-progress";
const ROUTE_PROGRESS_LAYER = "clyra-route-progress-line";
const ALT_ROUTE_SOURCE = "clyra-route-alt";
const ALT_ROUTE_LAYER = "clyra-route-alt-line";
const TRANSIT_SOURCE = "clyra-transit";
const TRANSIT_STOPS_SOURCE = "clyra-transit-stops";
const STOPS_SOURCE = "clyra-stops";
const ROUTE_LABEL_SOURCE = "clyra-route-labels";
const POI_SOURCE = "clyra-pois";
const POI_LAYER = "clyra-poi-circle";
const POI_LABEL_LAYER = "clyra-poi-label";
const SELECTION_SOURCE = "clyra-selection";
const SELECTION_LAYER = "clyra-selection-pin";
const DOT_SOURCE = "clyra-blue-dot";
const DOT_HALO_LAYER = "clyra-blue-dot-halo";
const DOT_CONE_LAYER = "clyra-blue-dot-cone";
const DOT_CORE_LAYER = "clyra-blue-dot-core";

export type Basemap = "explore" | "driving" | "satellite";

const EXPLORE_STYLE = "https://tiles.openfreemap.org/styles/liberty";
const DRIVING_STYLE = "https://tiles.openfreemap.org/styles/bright";
const SATELLITE_STYLE: maplibregl.StyleSpecification = {
  version: 8,
  glyphs: "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf",
  sources: {
    imagery: {
      type: "raster",
      tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"],
      tileSize: 256,
      maxzoom: 19,
      attribution: "Imagery © Esri, Maxar, Earthstar Geographics",
    },
  },
  layers: [{ id: "imagery", type: "raster", source: "imagery" }],
};

function emptyFC(): GeoJSON.FeatureCollection {
  return { type: "FeatureCollection", features: [] };
}

function lineFeature(coords: Coordinate[]): GeoJSON.Feature {
  return { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: coords } };
}

/** Thin imperative layer over a MapLibre GL map instance: owns Clyra's
 * sources/layers (route, alt routes, progress overlay, POIs, blue dot) so
 * React components never touch maplibre internals directly and high-frequency
 * updates (the blue dot moving every animation frame) never trigger a React
 * re-render — they call `setDotPosition` which mutates a GeoJSON source. */
export class MapController {
  private lastDot: { coordinate: Coordinate; bearing?: number } | null = null;
  private lastProgress: { routeId: string; meters: number } | null = null;
  private pendingCamera: CameraFrame | null = null;
  private cameraFrameRequest: number | null = null;
  private cache: { route: Route | null; alts: Route[]; pois: ClyraPlace[]; pin: Coordinate | null; labels: Route | null; transit: TransitLeg[] | null; stops: Coordinate[] } = { route: null, alts: [], pois: [], pin: null, labels: null, transit: null, stops: [] };
  private basemap: Basemap = "explore";
  private flyoverFrame: number | null = null;
  private flyoverStop: (() => void) | null = null;

  constructor(private map: maplibregl.Map) {}

  ensureLayers() {
    const map = this.map;

    if (!map.getSource(ROUTE_SOURCE)) {
      map.addSource(ROUTE_SOURCE, { type: "geojson", data: emptyFC() });
      map.addLayer({
        id: ROUTE_CASING_LAYER,
        type: "line",
        source: ROUTE_SOURCE,
        layout: { "line-join": "round", "line-cap": "round" },
        paint: { "line-color": "#0b2f6b", "line-width": 11, "line-opacity": 0.35 },
      });
      map.addLayer({
        id: ROUTE_LINE_LAYER,
        type: "line",
        source: ROUTE_SOURCE,
        layout: { "line-join": "round", "line-cap": "round" },
        paint: { "line-color": "#3b82f6", "line-width": 6.5 },
      });
    }

    if (!map.getSource(ALT_ROUTE_SOURCE)) {
      map.addSource(ALT_ROUTE_SOURCE, { type: "geojson", data: emptyFC() });
      map.addLayer(
        {
          id: ALT_ROUTE_LAYER,
          type: "line",
          source: ALT_ROUTE_SOURCE,
          layout: { "line-join": "round", "line-cap": "round" },
          paint: { "line-color": "#94a3b8", "line-width": 4.5, "line-opacity": 0.85 },
        },
        ROUTE_CASING_LAYER,
      );
    }

    if (!map.getSource(ROUTE_LABEL_SOURCE)) {
      map.addSource(ROUTE_LABEL_SOURCE, { type: "geojson", data: emptyFC() });
      map.addLayer({
        id: "clyra-route-labels",
        type: "symbol",
        source: ROUTE_LABEL_SOURCE,
        layout: { "text-field": ["get", "label"], "text-size": 12, "text-font": ["Noto Sans Bold"], "text-allow-overlap": false, "text-padding": 6 },
        paint: { "text-color": ["case", ["get", "primary"], "#ffffff", "#334155"], "text-halo-color": ["case", ["get", "primary"], "#2563eb", "#ffffff"], "text-halo-width": 7 },
      });
    }

    if (!map.getSource(ROUTE_PROGRESS_SOURCE)) {
      map.addSource(ROUTE_PROGRESS_SOURCE, { type: "geojson", data: emptyFC() });
      map.addLayer({
        id: ROUTE_PROGRESS_LAYER,
        type: "line",
        source: ROUTE_PROGRESS_SOURCE,
        layout: { "line-join": "round", "line-cap": "round" },
        paint: { "line-color": "#7c93b8", "line-width": 6.5, "line-opacity": 0.55 },
      });
    }

    if (!map.getSource(TRANSIT_SOURCE)) {
      map.addSource(TRANSIT_SOURCE, { type: "geojson", data: emptyFC() });
      map.addSource(TRANSIT_STOPS_SOURCE, { type: "geojson", data: emptyFC() });
      map.addLayer({
        id: "clyra-transit-casing",
        type: "line",
        source: TRANSIT_SOURCE,
        filter: ["==", ["get", "walk"], false],
        layout: { "line-join": "round", "line-cap": "round" },
        paint: { "line-color": "#ffffff", "line-width": 9 },
      });
      map.addLayer({
        id: "clyra-transit-line",
        type: "line",
        source: TRANSIT_SOURCE,
        filter: ["==", ["get", "walk"], false],
        layout: { "line-join": "round", "line-cap": "round" },
        paint: { "line-color": ["get", "color"], "line-width": 6 },
      });
      map.addLayer({
        id: "clyra-transit-walk",
        type: "line",
        source: TRANSIT_SOURCE,
        filter: ["==", ["get", "walk"], true],
        layout: { "line-join": "round" },
        paint: { "line-color": "#334155", "line-width": 4, "line-dasharray": [0.1, 1.6] },
      });
      map.addLayer({
        id: "clyra-transit-stops",
        type: "circle",
        source: TRANSIT_STOPS_SOURCE,
        paint: { "circle-radius": 5, "circle-color": "#ffffff", "circle-stroke-width": 2.5, "circle-stroke-color": ["get", "color"] },
      });
    }

    if (!map.getSource(STOPS_SOURCE)) {
      map.addSource(STOPS_SOURCE, { type: "geojson", data: emptyFC() });
      map.addLayer({
        id: "clyra-stops-circle",
        type: "circle",
        source: STOPS_SOURCE,
        paint: { "circle-radius": 10, "circle-color": "#0f172a", "circle-stroke-width": 2.5, "circle-stroke-color": "#ffffff" },
      });
      map.addLayer({
        id: "clyra-stops-label",
        type: "symbol",
        source: STOPS_SOURCE,
        layout: { "text-field": ["get", "label"], "text-size": 11, "text-font": ["Noto Sans Bold"], "text-allow-overlap": true },
        paint: { "text-color": "#ffffff" },
      });
    }

    if (!map.getSource(POI_SOURCE)) {
      map.addSource(POI_SOURCE, { type: "geojson", data: emptyFC() });
      map.addLayer({
        id: POI_LAYER,
        type: "circle",
        source: POI_SOURCE,
        paint: {
          "circle-radius": 7,
          "circle-color": "#ffffff",
          "circle-stroke-width": 2.5,
          "circle-stroke-color": ["get", "accent"],
        },
      });
      map.addLayer({
        id: POI_LABEL_LAYER,
        type: "symbol",
        source: POI_SOURCE,
        layout: {
          "text-field": ["get", "index"],
          "text-size": 11,
          "text-font": ["Noto Sans Bold"],
        },
        paint: { "text-color": "#0f172a" },
      });
    }

    if (!map.getSource(SELECTION_SOURCE)) {
      map.addSource(SELECTION_SOURCE, { type: "geojson", data: emptyFC() });
      map.addLayer({
        id: SELECTION_LAYER,
        type: "circle",
        source: SELECTION_SOURCE,
        paint: {
          "circle-radius": 9,
          "circle-color": "#0f172a",
          "circle-stroke-width": 3,
          "circle-stroke-color": "#ffffff",
        },
      });
    }

    if (!map.getSource(DOT_SOURCE)) {
      map.addSource(DOT_SOURCE, { type: "geojson", data: emptyFC() });
      map.addLayer({
        id: DOT_HALO_LAYER,
        type: "circle",
        source: DOT_SOURCE,
        paint: {
          "circle-radius": 16,
          "circle-color": "#3b82f6",
          "circle-opacity": 0.22,
        },
      });
      map.addLayer({
        id: DOT_CONE_LAYER,
        type: "symbol",
        source: DOT_SOURCE,
        layout: {
          "icon-image": "clyra-nav-cone",
          "icon-size": 0.9,
          "icon-rotate": ["get", "bearing"],
          "icon-rotation-alignment": "map",
          "icon-allow-overlap": true,
        },
        // The heading cone only means something while moving; the idle
        // "you are here" dot is drawn without it, like Google Maps.
        paint: {
          "icon-opacity": ["case", ["get", "hasHeading"], 1, 0],
        },
      });
      map.addLayer({
        id: DOT_CORE_LAYER,
        type: "circle",
        source: DOT_SOURCE,
        paint: {
          "circle-radius": 8,
          "circle-color": "#3b82f6",
          "circle-stroke-width": 3,
          "circle-stroke-color": "#ffffff",
        },
      });
    }
  }

  ensureConeImage() {
    const map = this.map;
    if (map.hasImage("clyra-nav-cone")) return;
    const size = 64;
    const data = new Uint8Array(size * size * 4);
    const cx = size / 2;
    const cy = size / 2;
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const dx = x - cx;
        const dy = y - cy;
        const angle = Math.atan2(dx, -dy); // 0 = up
        const dist = Math.hypot(dx, dy);
        const i = (y * size + x) * 4;
        const inCone = dist < 30 && Math.abs(angle) < 0.5;
        if (inCone) {
          const alpha = Math.max(0, 1 - dist / 30) * 200;
          data[i] = 59;
          data[i + 1] = 130;
          data[i + 2] = 246;
          data[i + 3] = alpha;
        }
      }
    }
    map.addImage("clyra-nav-cone", { width: size, height: size, data });
  }

  /** Swaps the base style and replays Clyra's overlays on top of it. */
  setBasemap(kind: Basemap) {
    if (kind === this.basemap) return;
    this.basemap = kind;
    const map = this.map;
    map.once("style.load", () => {
      this.ensureLayers();
      this.ensureConeImage();
      const { route, alts, pois, pin, transit, stops } = this.cache;
      this.setTransit(transit);
      this.setStops(stops);
      this.setRoute(route);
      this.setAlternativeRoutes(alts);
      if (route) this.setRouteLabels(route, alts);
      this.setPois(pois);
      this.setSelectionPin(pin);
      if (this.lastDot) {
        const d = this.lastDot;
        this.lastDot = null;
        this.setDotPosition(d.coordinate, d.bearing);
      }
    });
    map.setStyle(kind === "satellite" ? SATELLITE_STYLE : kind === "driving" ? DRIVING_STYLE : EXPLORE_STYLE, { diff: false });
  }

  /** Draws a transit itinerary: coloured lines for vehicles, dotted for walking. */
  setTransit(legs: TransitLeg[] | null) {
    this.cache.transit = legs;
    const lines = this.map.getSource(TRANSIT_SOURCE) as maplibregl.GeoJSONSource | undefined;
    const stops = this.map.getSource(TRANSIT_STOPS_SOURCE) as maplibregl.GeoJSONSource | undefined;
    if (!legs) {
      lines?.setData(emptyFC());
      stops?.setData(emptyFC());
      return;
    }
    const colorFor = (l: TransitLeg) => l.color ?? (l.mode === "SUBWAY" ? "#7c3aed" : l.mode.includes("RAIL") ? "#ea580c" : l.mode === "FERRY" ? "#0891b2" : l.mode === "TRAM" ? "#16a34a" : "#2563eb");
    lines?.setData({
      type: "FeatureCollection",
      features: legs.map((l) => ({ ...lineFeature(l.geometry), properties: { walk: l.mode === "WALK", color: colorFor(l) } })),
    });
    stops?.setData({
      type: "FeatureCollection",
      features: legs
        .filter((l) => l.mode !== "WALK")
        .flatMap((l) => [l.from, l.to].map((p) => ({ type: "Feature" as const, properties: { color: colorFor(l) }, geometry: { type: "Point" as const, coordinates: p.coordinates } }))),
    });
  }

  /** Numbered markers for intermediate stops on a multi-stop route. */
  setStops(stops: Coordinate[]) {
    this.cache.stops = stops;
    const source = this.map.getSource(STOPS_SOURCE) as maplibregl.GeoJSONSource | undefined;
    source?.setData({
      type: "FeatureCollection",
      features: stops.map((c, i) => ({ type: "Feature", properties: { label: String(i + 1) }, geometry: { type: "Point", coordinates: c } })),
    });
  }

  get flying() {
    return this.flyoverFrame != null;
  }

  /** Slow orbit around a point over 3D buildings. Any user gesture ends it. */
  startFlyover(center: Coordinate, onEnd?: () => void) {
    this.stopFlyover();
    const map = this.map;
    map.easeTo({ center, zoom: Math.max(map.getZoom(), 16.3), pitch: 62, duration: 1400, essential: true });
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(64, now - last);
      last = now;
      // Orbit only once the entry ease has finished.
      if (!map.isEasing()) map.jumpTo({ bearing: map.getBearing() + dt * 0.0075 });
      this.flyoverFrame = requestAnimationFrame(tick);
    };
    this.flyoverFrame = requestAnimationFrame(tick);
    const stop = () => {
      this.stopFlyover();
      onEnd?.();
    };
    this.flyoverStop = () => {
      const c = map.getCanvasContainer();
      for (const ev of ["mousedown", "wheel", "touchstart"]) c.removeEventListener(ev, stop);
    };
    const c = map.getCanvasContainer();
    for (const ev of ["mousedown", "wheel", "touchstart"]) c.addEventListener(ev, stop, { once: true, passive: true });
  }

  stopFlyover() {
    if (this.flyoverFrame != null) cancelAnimationFrame(this.flyoverFrame);
    this.flyoverFrame = null;
    this.flyoverStop?.();
    this.flyoverStop = null;
  }

  getBasemap() {
    return this.basemap;
  }

  setRoute(route: Route | null) {
    this.cache.route = route;
    if (!route) this.setRouteLabels(null, []);
    const source = this.map.getSource(ROUTE_SOURCE) as maplibregl.GeoJSONSource | undefined;
    source?.setData(route ? { type: "FeatureCollection", features: [lineFeature(route.geometry)] } : emptyFC());
    if (!route) this.setProgress(null, 0);
  }

  /** Callouts on each route: the active one shows its time, the others show the difference. */
  setRouteLabels(active: Route | null, others: Route[]) {
    this.cache.labels = active;
    const source = this.map.getSource(ROUTE_LABEL_SOURCE) as maplibregl.GeoJSONSource | undefined;
    if (!active) {
      source?.setData(emptyFC());
      return;
    }
    const mid = (r: Route): Coordinate => r.geometry[Math.floor(r.geometry.length * 0.45)];
    const mins = (s: number) => Math.round(s / 60);
    const features: GeoJSON.Feature[] = [
      { type: "Feature", properties: { label: `${mins(active.durationSeconds)} min`, primary: true }, geometry: { type: "Point", coordinates: mid(active) } },
      ...others.map((r) => {
        const d = mins(r.durationSeconds) - mins(active.durationSeconds);
        const label = d === 0 ? "Same time" : d > 0 ? `${d} min slower` : `${-d} min faster`;
        return { type: "Feature" as const, properties: { label, primary: false }, geometry: { type: "Point" as const, coordinates: mid(r) } };
      }),
    ];
    source?.setData({ type: "FeatureCollection", features });
  }

  setAlternativeRoutes(routes: Route[]) {
    this.cache.alts = routes;
    const source = this.map.getSource(ALT_ROUTE_SOURCE) as maplibregl.GeoJSONSource | undefined;
    source?.setData({
      type: "FeatureCollection",
      features: routes.map((r) => ({ ...lineFeature(r.geometry), properties: { routeId: r.id } })),
    });
  }

  /** Split the active route at `progressMeters` so the travelled portion can
   * render muted while the remaining portion stays strong blue, without
   * recreating the whole layer every frame — only the two source datas
   * update. */
  setProgress(route: Route | null, progressMeters: number) {
    const source = this.map.getSource(ROUTE_PROGRESS_SOURCE) as maplibregl.GeoJSONSource | undefined;
    if (!route) {
      source?.setData(emptyFC());
      this.lastProgress = null;
      return;
    }
    // Source updates are substantially more expensive than the interpolation
    // itself. Updating after every sub-metre simulation tick produces no
    // visible benefit, but does force MapLibre to rebuild line buffers. Keep
    // the route line smooth at normal driving speed while skipping redundant
    // work between meaningful progress changes.
    if (this.lastProgress?.routeId === route.id && Math.abs(progressMeters - this.lastProgress.meters) < 0.8) return;
    this.lastProgress = { routeId: route.id, meters: progressMeters };

    // Cumulative distances are sorted. Binary search avoids walking every
    // route vertex on each update, which is especially important for long
    // urban routes with dense geometry.
    let low = 0;
    let high = route.cumulativeDistances.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (route.cumulativeDistances[mid] < progressMeters) low = mid + 1;
      else high = mid;
    }
    const cutoff = low >= route.geometry.length ? route.geometry.length : Math.max(1, low);
    const travelled = route.geometry.slice(0, cutoff);
    source?.setData(travelled.length > 1 ? { type: "FeatureCollection", features: [lineFeature(travelled)] } : emptyFC());
  }

  setPois(places: ClyraPlace[]) {
    this.cache.pois = places;
    const source = this.map.getSource(POI_SOURCE) as maplibregl.GeoJSONSource | undefined;
    source?.setData({
      type: "FeatureCollection",
      features: places.map((p, i) => ({
        type: "Feature",
        properties: { id: p.id, index: String(i + 1), accent: "#3b82f6", name: p.name },
        geometry: { type: "Point", coordinates: p.coordinates },
      })),
    });
  }

  /** Pass `bearing` while navigating to show the heading cone; omit it for a
   * stationary "you are here" dot. */
  setDotPosition(coordinate: Coordinate, bearing?: number) {
    const last = this.lastDot;
    const bearingDelta = bearing == null || last?.bearing == null
      ? 180
      : Math.abs((((bearing - last.bearing) % 360) + 540) % 360 - 180);
    // MapLibre source writes have a fixed cost. At the scale of the blue dot,
    // sub-metre position changes are imperceptible; coalescing them makes the
    // map much lighter without making location updates feel stepped.
    if (last && this.distanceMeters(last.coordinate, coordinate) < 0.6 && bearingDelta < 1.5) return;
    this.lastDot = { coordinate, bearing };
    const source = this.map.getSource(DOT_SOURCE) as maplibregl.GeoJSONSource | undefined;
    source?.setData({
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: { bearing: bearing ?? 0, hasHeading: bearing != null },
          geometry: { type: "Point", coordinates: coordinate },
        },
      ],
    });
  }

  clearDot() {
    this.lastDot = null;
    const source = this.map.getSource(DOT_SOURCE) as maplibregl.GeoJSONSource | undefined;
    source?.setData(emptyFC());
  }

  /** Temporary marker for whatever the user last selected on the map. */
  setSelectionPin(coordinate: Coordinate | null) {
    this.cache.pin = coordinate;
    const source = this.map.getSource(SELECTION_SOURCE) as maplibregl.GeoJSONSource | undefined;
    source?.setData(
      coordinate
        ? { type: "FeatureCollection", features: [{ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: coordinate } }] }
        : emptyFC(),
    );
  }

  applyCameraFrame(frame: CameraFrame) {
    // The navigation engine can emit more than one update during a browser
    // frame. Coalescing to one rAF makes camera motion feel continuous while
    // preventing repeated layout/render work on slower GPUs.
    this.pendingCamera = frame;
    if (this.cameraFrameRequest != null) return;
    this.cameraFrameRequest = requestAnimationFrame(() => {
      this.cameraFrameRequest = null;
      const next = this.pendingCamera;
      this.pendingCamera = null;
      if (!next || !this.map.isStyleLoaded()) return;
      this.map.jumpTo({ center: next.center, zoom: next.zoom, pitch: next.pitch, bearing: next.bearing });
    });
  }

  /** `padding` may be a number, or per-side values so the route fits beside the left panel. */
  fitToBounds(bounds: [Coordinate, Coordinate], padding: number | { top: number; bottom: number; left: number; right: number } = 72) {
    const held = this.map.getPadding();
    if (held.top || held.bottom || held.left || held.right) this.map.setPadding({ top: 0, bottom: 0, left: 0, right: 0 });
    this.map.fitBounds(bounds, { padding, duration: 900, pitch: 0, bearing: 0, maxZoom: 16 });
  }

  flyTo(coordinate: Coordinate, zoom = 15) {
    this.map.flyTo({ center: coordinate, zoom, duration: 900, essential: true });
  }

  dispose() {
    this.stopFlyover();
    if (this.cameraFrameRequest != null) cancelAnimationFrame(this.cameraFrameRequest);
    this.cameraFrameRequest = null;
    this.pendingCamera = null;
  }

  private distanceMeters(a: Coordinate, b: Coordinate) {
    const latScale = 111_320;
    const dy = (b[1] - a[1]) * latScale;
    const dx = (b[0] - a[0]) * latScale * Math.cos(((a[1] + b[1]) / 2) * (Math.PI / 180));
    return Math.hypot(dx, dy);
  }
}
