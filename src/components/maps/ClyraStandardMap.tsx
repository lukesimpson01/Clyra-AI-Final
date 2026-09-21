import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import type { GeoJSONSource, Map as MapLibreMap } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import {
  ArrowDownUp, Bookmark, Box, Car, Check, ChevronLeft, ChevronRight, Compass, Crosshair,
  Diamond, Download, Fuel, Layers3, LocateFixed, Map as MapIcon, MapPin, Menu, Minus,
  MoreHorizontal, MousePointer2, Navigation, ParkingCircle, Plane, Plus, Route as RouteIcon,
  Search, Send, Sparkles, TrainFront, Utensils, X, Zap,
} from "lucide-react";
import { createStandardMap } from "./mapRenderer";
import { ClyraMapCameraController, waitForMapReady } from "../../maps/camera";
import { MapHealthMonitor, type MapHealthState } from "../../maps/health";
import { MAP_COLORS, targetZoomForClass } from "../../maps/mapTokens";
import { NavigationSmoother, type LocationSample } from "../../maps/navigation";
import { placeSearch } from "../../maps/geocoding";
import { requestRoute } from "../../maps/routing";
import type { Bounds, LayerMeta, LiveLayerId, LngLat, MapSceneContext, Place, Route, TravelMode } from "../../maps/core/types";
import { PerformanceGovernor } from "../../maps/core/performanceGovernor";
import { mapProviders } from "../../maps/core/providerManager";
import { LiveLayerManager } from "../../maps/layers/liveLayerManager";
import { parseMapCommand } from "../../maps/ai/mapCommand";
import { highlightMatch } from "../../maps/search/placeRanker";
import { measureArea, measureDistance, type Measurement } from "../../maps/spatial/tools";

const DEFAULT_CENTER: LngLat = [151.2093, -33.8688];
const DEFAULT_ZOOM = 11.6;
const RECENTS_KEY = "clyra-maps-recents-v2";
const FAVOURITES_KEY = "clyra-maps-favourites-v2";
const EMPTY: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };

export interface MapContextSnapshot extends MapSceneContext {}
export interface ClyraStandardMapProps {
  initialCommand?: string;
  onContextChange?: (context: MapContextSnapshot) => void;
  onAskClyra?: (text: string) => void;
}

type Panel = "none" | "directions" | "layers" | "place" | "measure";
type LocationState = "unknown" | "requesting" | "available" | "denied" | "unavailable";
type MapMode = "map" | "3d" | "transit" | "driving" | "cycling" | "walking" | "terrain" | "satellite" | "public" | "clean";

const travelModes: Array<{ id: TravelMode; label: string; icon: typeof Car }> = [
  { id: "driving", label: "Drive", icon: Car }, { id: "walking", label: "Walk", icon: Navigation }, { id: "cycling", label: "Cycle", icon: Diamond }, { id: "transit", label: "Transit", icon: TrainFront },
];
const quickSearches = [
  { label: "Food", query: "restaurants", icon: Utensils }, { label: "Coffee", query: "cafe", icon: Sparkles }, { label: "Fuel", query: "fuel", icon: Fuel }, { label: "Parking", query: "parking", icon: ParkingCircle },
];
const mapModes: Array<{ id: MapMode; label: string; available?: boolean }> = [
  { id: "map", label: "Map" }, { id: "3d", label: "3D" }, { id: "transit", label: "Transit" }, { id: "driving", label: "Driving" }, { id: "cycling", label: "Cycling" }, { id: "walking", label: "Walking" }, { id: "terrain", label: "Terrain", available: false }, { id: "satellite", label: "Satellite", available: false }, { id: "public", label: "Public Data" }, { id: "clean", label: "Clean" },
];
const liveLayers: LiveLayerId[] = ["aircraft", "earthquakes", "satellites", "fires", "weather", "cameras"];

function isAbort(error: unknown): boolean { return error instanceof DOMException && error.name === "AbortError"; }
function formatDistance(value: number): string { return value >= 1000 ? `${(value / 1000).toFixed(value >= 10_000 ? 0 : 1)} km` : `${Math.round(value)} m`; }
function formatDuration(value: number): string { const minutes = Math.max(1, Math.round(value / 60)); return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} hr${minutes % 60 ? ` ${minutes % 60} min` : ""}`; }
function boundsOf(map: MapLibreMap): Bounds { const bounds = map.getBounds(); return [[bounds.getWest(), bounds.getSouth()], [bounds.getEast(), bounds.getNorth()]]; }
function localPlaces(key: string): Place[] { try { const raw = JSON.parse(localStorage.getItem(key) ?? "[]"); return Array.isArray(raw) ? raw.filter((place): place is Place => Boolean(place?.id && Array.isArray(place?.coordinates))) : []; } catch { return []; } }
function persistPlaces(key: string, places: Place[]): void { try { localStorage.setItem(key, JSON.stringify(places.slice(0, 30))); } catch { /* private mode / quota: maps remains usable */ } }
function placeIcon(category: Place["category"]) { return category === "restaurant" || category === "cafe" ? Utensils : category === "airport" ? Plane : category === "station" || category === "transit" ? TrainFront : category === "fuel" ? Fuel : category === "parking" ? ParkingCircle : MapPin; }

function source(map: MapLibreMap, id: string, data: GeoJSON.FeatureCollection | GeoJSON.LineString, options: Record<string, unknown> = {}) {
  if (!map.getSource(id)) map.addSource(id, { type: "geojson", data, ...options });
}
function setSource(map: MapLibreMap, id: string, data: GeoJSON.FeatureCollection | GeoJSON.LineString) { (map.getSource(id) as GeoJSONSource | undefined)?.setData(data); }

function addOverlays(map: MapLibreMap): void {
  source(map, "clyra-route-shadow", { type: "LineString", coordinates: [] }, { lineMetrics: true });
  source(map, "clyra-route-active", { type: "LineString", coordinates: [] }, { lineMetrics: true });
  source(map, "clyra-route-alternatives", EMPTY);
  source(map, "clyra-place", EMPTY);
  source(map, "clyra-location", EMPTY);
  source(map, "clyra-heading", EMPTY);
  source(map, "clyra-measure", EMPTY);
  const add = (layer: Parameters<MapLibreMap["addLayer"]>[0]) => { if (!map.getLayer(layer.id)) map.addLayer(layer); };
  add({ id: "clyra-route-alt", type: "line", source: "clyra-route-alternatives", paint: { "line-color": MAP_COLORS.routeAlternative, "line-width": ["interpolate", ["linear"], ["zoom"], 8, 4, 15, 7], "line-opacity": 0.72 }, layout: { "line-cap": "round", "line-join": "round" } });
  add({ id: "clyra-route-shadow-line", type: "line", source: "clyra-route-shadow", paint: { "line-color": "#1249b8", "line-width": ["interpolate", ["linear"], ["zoom"], 8, 7, 15, 13], "line-opacity": 0.35 }, layout: { "line-cap": "round", "line-join": "round" } });
  add({ id: "clyra-route-active-line", type: "line", source: "clyra-route-active", paint: { "line-color": MAP_COLORS.route, "line-width": ["interpolate", ["linear"], ["zoom"], 8, 4.8, 15, 9], "line-opacity": 1 }, layout: { "line-cap": "round", "line-join": "round" } });
  add({ id: "clyra-place-halo", type: "circle", source: "clyra-place", paint: { "circle-radius": 12, "circle-color": "#ffffff", "circle-opacity": 0.96 } });
  add({ id: "clyra-place-dot", type: "circle", source: "clyra-place", paint: { "circle-radius": 7, "circle-color": MAP_COLORS.route, "circle-stroke-color": "#183e8e", "circle-stroke-width": 1.5 } });
  add({ id: "clyra-location-accuracy", type: "circle", source: "clyra-location", paint: { "circle-radius": ["coalesce", ["get", "accuracyPx"], 20], "circle-color": "#1e6fff", "circle-opacity": 0.13 } });
  add({ id: "clyra-location-dot", type: "circle", source: "clyra-location", paint: { "circle-radius": 7, "circle-color": "#1e6fff", "circle-stroke-color": "#ffffff", "circle-stroke-width": 3 } });
  add({ id: "clyra-location-wedge", type: "fill", source: "clyra-heading", paint: { "fill-color": "#1e6fff", "fill-opacity": 0.24 } });
  add({ id: "clyra-measure-lines", type: "line", source: "clyra-measure", paint: { "line-color": "#3c5fca", "line-width": 3, "line-dasharray": [1.2, 1.2] }, layout: { "line-cap": "round", "line-join": "round" } });
  add({ id: "clyra-measure-area", type: "fill", source: "clyra-measure", paint: { "fill-color": "#3c5fca", "fill-opacity": 0.12 } });
}

function routeFeatures(routes: Route[]): GeoJSON.FeatureCollection {
  return { type: "FeatureCollection", features: routes.map((route) => ({ type: "Feature", properties: { id: route.id }, geometry: route.geometry })) };
}

function placeFeature(place: Place | null): GeoJSON.FeatureCollection {
  return { type: "FeatureCollection", features: place ? [{ type: "Feature", properties: { id: place.id }, geometry: { type: "Point", coordinates: place.coordinates } }] : [] };
}

function currentFeature(sample: LocationSample | null, map: MapLibreMap): GeoJSON.FeatureCollection {
  if (!sample) return EMPTY;
  const metresPerPixel = 156543.03392 * Math.cos(sample.lat * Math.PI / 180) / Math.pow(2, map.getZoom());
  return { type: "FeatureCollection", features: [{ type: "Feature", properties: { accuracyPx: Math.max(12, Math.min(80, sample.accuracyM / Math.max(1, metresPerPixel))) }, geometry: { type: "Point", coordinates: [sample.lon, sample.lat] } }] };
}

function headingFeature(sample: LocationSample | null): GeoJSON.FeatureCollection {
  if (!sample || sample.heading == null) return EMPTY;
  const radius = Math.max(0.00014, Math.min(0.0016, (sample.accuracyM || 15) / 70_000));
  const center: LngLat = [sample.lon, sample.lat];
  const degrees = [sample.heading - 24, sample.heading, sample.heading + 24].map((heading) => heading * Math.PI / 180);
  const points = [center, ...degrees.map((angle) => [sample.lon + Math.sin(angle) * radius, sample.lat + Math.cos(angle) * radius] as LngLat), center];
  return { type: "FeatureCollection", features: [{ type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [points] } }] };
}

export function ClyraStandardMap({ initialCommand, onContextChange, onAskClyra }: ClyraStandardMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const cameraRef = useRef<ClyraMapCameraController | null>(null);
  const liveRef = useRef<LiveLayerManager | null>(null);
  const smootherRef = useRef<NavigationSmoother | null>(null);
  const governorRef = useRef<PerformanceGovernor | null>(null);
  const healthRef = useRef<MapHealthMonitor | null>(null);
  const searchTimerRef = useRef<number | null>(null);
  const mapRefreshRef = useRef<number | null>(null);
  const routeAbortRef = useRef<AbortController | null>(null);
  const watchIdRef = useRef<number | null>(null);
  const lastSearchCenterRef = useRef<LngLat | null>(null);
  const [health, setHealth] = useState<MapHealthState>("INITIALIZING");
  const [ready, setReady] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Place[]>([]);
  const [searching, setSearching] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [panel, setPanel] = useState<Panel>("none");
  const [selected, setSelected] = useState<Place | null>(null);
  const [recents, setRecents] = useState<Place[]>(() => localPlaces(RECENTS_KEY));
  const [favourites, setFavourites] = useState<Place[]>(() => localPlaces(FAVOURITES_KEY));
  const [origin, setOrigin] = useState<Place | null>(null);
  const [destination, setDestination] = useState<Place | null>(null);
  const [waypoints, setWaypoints] = useState<Place[]>([]);
  const [route, setRoute] = useState<Route | null>(null);
  const [alternatives, setAlternatives] = useState<Route[]>([]);
  const [travelMode, setTravelMode] = useState<TravelMode>("driving");
  const [avoid, setAvoid] = useState({ tolls: false, motorways: false, ferries: false });
  const [isRouting, setIsRouting] = useState(false);
  const [location, setLocation] = useState<LocationSample | null>(null);
  const [locationState, setLocationState] = useState<LocationState>("unknown");
  const [is3D, setIs3D] = useState(false);
  const [mapMode, setMapMode] = useState<MapMode>("map");
  const [layers, setLayers] = useState<LayerMeta[]>([]);
  const [liveWorld, setLiveWorld] = useState(false);
  const [showSearchArea, setShowSearchArea] = useState(false);
  const [navigating, setNavigating] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [measurements, setMeasurements] = useState<Measurement[]>([]);
  const [measurePoints, setMeasurePoints] = useState<LngLat[]>([]);
  const [measureMode, setMeasureMode] = useState<"distance" | "area" | null>(null);
  const [mapState, setMapState] = useState({ center: DEFAULT_CENTER, zoom: DEFAULT_ZOOM, bearing: 0, pitch: 0, bounds: [[0, 0], [0, 0]] as Bounds });

  const visiblePanel = panel !== "none";
  const canRoute = Boolean(destination);
  const activeRoute = route;
  const activeLayerMeta = useMemo(() => layers.filter((layer) => layer.status !== "idle"), [layers]);

  const showToast = useCallback((message: string) => { setToast(message); window.setTimeout(() => setToast((current) => current === message ? null : current), 3400); }, []);

  const sceneContext = useCallback((): MapSceneContext => ({
    viewport: mapState.bounds, center: mapState.center, zoom: mapState.zoom, bearing: mapState.bearing, pitch: mapState.pitch,
    visiblePlaces: results.slice(0, 12).map((place) => ({ id: place.id, name: place.name, category: place.category, coordinates: place.coordinates })),
    selectedPlace: selected, currentRoute: route ? { id: route.id, mode: route.mode, distanceM: route.distanceM, durationS: route.durationS, waypoints: route.waypoints } : null,
    activeLayers: activeLayerMeta, trackedEntities: liveLayers.flatMap((id) => liveRef.current?.entitiesFor(id).slice(0, 8).map((entity) => ({ id: entity.id, type: entity.type, coordinates: entity.coordinates, timestamp: entity.timestamp })) ?? []),
    currentLocation: location ? [location.lon, location.lat] : null, searchResults: results.slice(0, 12).map((place) => ({ id: place.id, name: place.name, category: place.category, coordinates: place.coordinates })), navigationState: navigating ? "navigating" : route ? "directions" : "exploring",
  }), [activeLayerMeta, location, mapState, navigating, results, route, selected]);

  const publishMapState = useCallback(() => {
    const map = mapRef.current; if (!map) return;
    const center = map.getCenter();
    const next = { center: [center.lng, center.lat] as LngLat, zoom: map.getZoom(), bearing: map.getBearing(), pitch: map.getPitch(), bounds: boundsOf(map) };
    setMapState(next); onContextChange?.({ ...sceneContext(), ...next });
  }, [onContextChange, sceneContext]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = createStandardMap({ container: containerRef.current, center: DEFAULT_CENTER, zoom: DEFAULT_ZOOM });
    mapRef.current = map;
    (window as unknown as { __CLYRA_MAP__?: MapLibreMap }).__CLYRA_MAP__ = map;
    (window as unknown as { __CLYRA_MAP_MOUNT_COUNT__?: number }).__CLYRA_MAP_MOUNT_COUNT__ = ((window as unknown as { __CLYRA_MAP_MOUNT_COUNT__?: number }).__CLYRA_MAP_MOUNT_COUNT__ ?? 0) + 1;
    cameraRef.current = new ClyraMapCameraController(map);
    healthRef.current = new MapHealthMonitor(map, setHealth);
    smootherRef.current = new NavigationSmoother();
    const governor = new PerformanceGovernor(); governorRef.current = governor;
    governor.subscribe((profile) => {
      liveRef.current?.setQualityLimit(profile.entityLimit);
      if (!profile.buildingExtrusions && map.getLayer("building-3d")) map.setLayoutProperty("building-3d", "visibility", "none");
    });
    governor.start();
    map.on("load", () => {
      addOverlays(map);
      map.setLayoutProperty("building-3d", "visibility", "none");
      liveRef.current = new LiveLayerManager(map);
      setLayers(liveRef.current.snapshot());
      setReady(true); publishMapState();
      mapProviders.register({ id: "openfreemap", label: "OpenFreeMap", priority: 1, capabilities: ["vector tiles", "glyphs"], limits: "Hosted public tiles" });
      mapProviders.register({ id: "photon", label: "Photon", priority: 2, capabilities: ["autocomplete", "reverse"], limits: "Rate-limited through Clyra cache" });
      mapProviders.register({ id: "osrm", label: "OSRM", priority: 3, capabilities: ["drive", "walk", "cycle", "matrix"], limits: "Public demo / fair use" });
    });
    const onMoveEnd = () => {
      publishMapState();
      const center = map.getCenter();
      const last = lastSearchCenterRef.current;
      if (last && results.length && Math.hypot(center.lng - last[0], center.lat - last[1]) > 0.045) setShowSearchArea(true);
      if (mapRefreshRef.current) window.clearTimeout(mapRefreshRef.current);
      mapRefreshRef.current = window.setTimeout(() => {
        const manager = liveRef.current;
        if (manager && document.visibilityState === "visible") void manager.refreshViewport(boundsOf(map), map.getZoom()).finally(() => setLayers(manager.snapshot()));
      }, 420);
    };
    map.on("moveend", onMoveEnd);
    map.on("click", (event) => {
      if (!measureMode) return;
      const next = [...measurePoints, [event.lngLat.lng, event.lngLat.lat] as LngLat];
      setMeasurePoints(next);
      if (measureMode === "distance" && next.length === 2) {
        const measurement = measureDistance(next[0], next[1]); setMeasurements((items) => [...items, measurement]); setMeasurePoints([]); setMeasureMode(null); showToast(measurement.label);
      }
      if (measureMode === "area" && next.length >= 3 && event.originalEvent.detail === 2) {
        const measurement = measureArea(next); if (measurement) { setMeasurements((items) => [...items, measurement]); showToast(measurement.label); }
        setMeasurePoints([]); setMeasureMode(null);
      }
    });
    const resize = new ResizeObserver(() => map.resize()); resize.observe(containerRef.current);
    const onVisibility = () => { if (!document.hidden) map.resize(); };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      resize.disconnect(); document.removeEventListener("visibilitychange", onVisibility); map.off("moveend", onMoveEnd); governor.stop(); liveRef.current?.dispose(); smootherRef.current?.dispose(); healthRef.current?.dispose();
      if (mapRefreshRef.current) window.clearTimeout(mapRefreshRef.current); if (watchIdRef.current != null) navigator.geolocation?.clearWatch(watchIdRef.current);
      map.remove(); mapRef.current = null; cameraRef.current = null; liveRef.current = null; if ((window as unknown as { __CLYRA_MAP__?: MapLibreMap }).__CLYRA_MAP__ === map) delete (window as unknown as { __CLYRA_MAP__?: MapLibreMap }).__CLYRA_MAP__;
    };
    // create just once; callbacks read refs/state updates safely
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const smoother = smootherRef.current; const map = mapRef.current;
    if (!smoother || !map) return;
    return smoother.subscribe((sample) => {
      setLocation(sample); setLocationState("available");
      setSource(map, "clyra-location", currentFeature(sample, map)); setSource(map, "clyra-heading", headingFeature(sample));
      if (navigating) cameraRef.current?.flyTo({ center: [sample.lon, sample.lat], zoom: Math.max(15.4, Math.min(17.2, 15.5 + Math.min(1.7, (sample.speedMps ?? 0) / 13))), bearing: sample.heading ?? map.getBearing(), pitch: 52 }, 450);
    });
  }, [navigating]);

  useEffect(() => {
    const features: GeoJSON.Feature[] = measurements.map((measurement) => ({ type: "Feature", properties: { id: measurement.id, label: measurement.label }, geometry: measurement.geometry }));
    if (measurePoints.length > 1) features.push({ type: "Feature", properties: {}, geometry: measureMode === "area" && measurePoints.length >= 3 ? { type: "Polygon", coordinates: [[...measurePoints, measurePoints[0]]] } : { type: "LineString", coordinates: measurePoints } });
    const map = mapRef.current; if (map) setSource(map, "clyra-measure", { type: "FeatureCollection", features });
  }, [measureMode, measurePoints, measurements]);

  const remember = useCallback((place: Place) => {
    setRecents((current) => { const next = [place, ...current.filter((item) => item.id !== place.id)].slice(0, 12); persistPlaces(RECENTS_KEY, next); return next; });
  }, []);
  const toggleFavourite = useCallback((place: Place) => {
    setFavourites((current) => { const exists = current.some((item) => item.id === place.id); const next = exists ? current.filter((item) => item.id !== place.id) : [place, ...current].slice(0, 30); persistPlaces(FAVOURITES_KEY, next); showToast(exists ? "Removed from saved places" : "Saved place"); return next; });
  }, [showToast]);

  const runSearch = useCallback(async (value: string, chooseFirst = false) => {
    const map = mapRef.current; const cleaned = value.trim(); if (!map || cleaned.length < 2) { setResults([]); return []; }
    setSearching(true); setActiveIndex(-1);
    try {
      const found = await placeSearch.search(cleaned, { bias: location ? [location.lon, location.lat] : [map.getCenter().lng, map.getCenter().lat], recents, favourites, viewport: boundsOf(map) });
      setResults(found.places); setPanel("none"); lastSearchCenterRef.current = [map.getCenter().lng, map.getCenter().lat]; setShowSearchArea(false);
      if (chooseFirst && found.places[0]) return found.places;
      return found.places;
    } catch (error) { if (!isAbort(error)) showToast("Search is unavailable. Saved places are still available."); return []; }
    finally { setSearching(false); }
  }, [favourites, location, recents, showToast]);

  const choosePlace = useCallback((place: Place, options: { fly?: boolean } = {}) => {
    const map = mapRef.current; if (!map) return;
    setSelected(place); setDestination((current) => current ?? place); setQuery(place.name); setResults([]); setActiveIndex(-1); setPanel("place"); remember(place);
    setSource(map, "clyra-place", placeFeature(place));
    if (options.fly !== false) cameraRef.current?.flyToLocation(place.coordinates[0], place.coordinates[1], targetZoomForClass(place.category), "CITY_FLY");
  }, [remember]);

  const findAndChoose = useCallback(async (search: string, mode: "place" | "route" | "fly") => {
    setQuery(search); const found = await runSearch(search, true); const first = found[0];
    if (!first) { showToast("No verified place matched that request."); return; }
    if (mode === "route") { setDestination(first); setSelected(first); setPanel("directions"); }
    else choosePlace(first, { fly: true });
  }, [choosePlace, runSearch, showToast]);

  const requestDirections = useCallback(async () => {
    const map = mapRef.current; if (!map || !destination) return;
    const from = origin ?? (location ? { ...destination, id: "current-location", name: "Current Location", displayName: "Current Location", category: "address" as const, coordinates: [location.lon, location.lat] as LngLat } : { ...destination, id: "sydney-start", name: "Map center", displayName: "Map center", category: "address" as const, coordinates: [map.getCenter().lng, map.getCenter().lat] as LngLat });
    if (travelMode === "transit") { showToast("Transit directions are unavailable for this area. Choose driving, walking, or cycling."); return; }
    routeAbortRef.current?.abort(); const controller = new AbortController(); routeAbortRef.current = controller;
    setIsRouting(true);
    try {
      const next = await requestRoute({ origin: { lon: from.coordinates[0], lat: from.coordinates[1] }, destination: { lon: destination.coordinates[0], lat: destination.coordinates[1] }, waypoints: waypoints.map((place) => ({ lon: place.coordinates[0], lat: place.coordinates[1] })), mode: travelMode, alternatives: true, avoid }, controller.signal);
      if (controller.signal.aborted) return;
      setOrigin(from); setRoute(next); setAlternatives(next.alternatives); setPanel("directions");
      setSource(map, "clyra-route-alternatives", routeFeatures(next.alternatives));
      const coordinates = next.geometry.coordinates as LngLat[]; let raf = 0; const started = performance.now();
      const animate = (now: number) => { const progress = Math.min(1, (now - started) / 420); const count = Math.max(2, Math.ceil(coordinates.length * progress)); const geometry = { type: "LineString" as const, coordinates: coordinates.slice(0, count) }; setSource(map, "clyra-route-active", geometry); setSource(map, "clyra-route-shadow", geometry); if (progress < 1) raf = requestAnimationFrame(animate); };
      raf = requestAnimationFrame(animate);
      const bounds = new maplibregl.LngLatBounds(); coordinates.forEach((coordinate) => bounds.extend(coordinate)); cameraRef.current?.fitRoute(bounds, { padding: { top: 140, right: 80, bottom: 220, left: 430 } });
      return () => cancelAnimationFrame(raf);
    } catch (error) { if (!isAbort(error)) showToast(error instanceof Error ? error.message : "Directions failed. Search remains available."); }
    finally { if (!controller.signal.aborted) setIsRouting(false); }
  }, [avoid, destination, location, origin, showToast, travelMode, waypoints]);

  const selectRoute = useCallback((next: Route) => {
    const map = mapRef.current; if (!map) return; setRoute(next); setAlternatives([...(route ? [route] : []), ...alternatives].filter((item) => item.id !== next.id)); setSource(map, "clyra-route-active", next.geometry); setSource(map, "clyra-route-shadow", next.geometry); setSource(map, "clyra-route-alternatives", routeFeatures([...(route ? [route] : []), ...alternatives].filter((item) => item.id !== next.id)));
  }, [alternatives, route]);

  const requestLocation = useCallback(() => {
    if (!navigator.geolocation) { setLocationState("unavailable"); showToast("Location is unavailable on this device."); return; }
    setLocationState("requesting"); navigator.geolocation.getCurrentPosition((position) => {
      const sample: LocationSample = { lon: position.coords.longitude, lat: position.coords.latitude, accuracyM: position.coords.accuracy, heading: Number.isFinite(position.coords.heading) ? position.coords.heading : null, speedMps: Number.isFinite(position.coords.speed) ? position.coords.speed : null, timestamp: position.timestamp };
      smootherRef.current?.push(sample); cameraRef.current?.flyToLocation(sample.lon, sample.lat, 15.8, "LOCATION_FOCUS");
    }, (error) => { setLocationState(error.code === error.PERMISSION_DENIED ? "denied" : "unavailable"); showToast(error.code === error.PERMISSION_DENIED ? "Location permission was not granted." : "Location is temporarily unavailable."); }, { enableHighAccuracy: true, timeout: 12_000, maximumAge: 15_000 });
  }, [showToast]);

  const startNavigation = useCallback(() => {
    if (!route) return;
    if (!navigator.geolocation) { showToast("Live navigation requires location access."); return; }
    setNavigating(true); requestLocation();
    if (watchIdRef.current != null) navigator.geolocation.clearWatch(watchIdRef.current);
    watchIdRef.current = navigator.geolocation.watchPosition((position) => smootherRef.current?.push({ lon: position.coords.longitude, lat: position.coords.latitude, accuracyM: position.coords.accuracy, heading: Number.isFinite(position.coords.heading) ? position.coords.heading : null, speedMps: Number.isFinite(position.coords.speed) ? position.coords.speed : null, timestamp: position.timestamp }), () => { setNavigating(false); showToast("Live navigation stopped because location is unavailable."); }, { enableHighAccuracy: true, maximumAge: 1_000 });
  }, [requestLocation, route, showToast]);
  const stopNavigation = useCallback(() => { if (watchIdRef.current != null) navigator.geolocation.clearWatch(watchIdRef.current); watchIdRef.current = null; setNavigating(false); cameraRef.current?.setPitch(0); }, []);

  const toggle3d = useCallback((next = !is3D) => {
    const map = mapRef.current; if (!map) return; setIs3D(next); setMapMode(next ? "3d" : "map"); map.setLayoutProperty("building-3d", "visibility", next && governorRef.current?.profile.buildingExtrusions !== false ? "visible" : "none"); map.setLayoutProperty("building-fill", "visibility", next ? "none" : "visible"); cameraRef.current?.setPitch(next ? 50 : 0);
  }, [is3D]);
  const setMode = useCallback((mode: MapMode) => {
    const map = mapRef.current; if (!map) return; const descriptor = mapModes.find((item) => item.id === mode); if (descriptor?.available === false) { showToast(`${descriptor.label} is unavailable until Clyra has a licensed hosted provider.`); return; }
    setMapMode(mode); if (mode === "3d") { toggle3d(true); return; } if (is3D) toggle3d(false);
    if (mode === "transit" && map.getLayer("railway")) map.setPaintProperty("railway", "line-opacity", 1); else if (map.getLayer("railway")) map.setPaintProperty("railway", "line-opacity", 0.6);
    if (mode === "clean") ["poi-label", "aerodrome"].forEach((id) => map.getLayer(id) && map.setLayoutProperty(id, "visibility", "none")); else ["poi-label", "aerodrome"].forEach((id) => map.getLayer(id) && map.setLayoutProperty(id, "visibility", "visible"));
    if (mode === "public") { setLiveWorld(true); setPanel("layers"); } else if (mode !== "transit") setLiveWorld(false);
  }, [is3D, showToast, toggle3d]);

  const toggleLayer = useCallback(async (id: LiveLayerId) => { const map = mapRef.current; const manager = liveRef.current; if (!map || !manager) return; await manager.toggle(id, boundsOf(map), map.getZoom()); setLayers(manager.snapshot()); }, []);

  const execute = useCallback(async () => {
    const command = parseMapCommand(query); const map = mapRef.current; if (!map) return;
    if (command.type === "search") { await runSearch(command.query); return; }
    if (command.type === "fly") { await findAndChoose(command.destination, "fly"); return; }
    if (command.type === "route") { setTravelMode(command.mode ?? "driving"); setAvoid(command.avoid ?? { tolls: false, motorways: false, ferries: false }); await findAndChoose(command.destination, "route"); return; }
    if (command.type === "toggle-layer") { await toggleLayer(command.layer); setLiveWorld(true); return; }
    if (command.type === "toggle-3d") { toggle3d(command.value); return; }
    if (command.type === "overview") { if (route) { const bounds = new maplibregl.LngLatBounds(); route.geometry.coordinates.forEach((point) => bounds.extend(point as LngLat)); cameraRef.current?.fitRoute(bounds); } return; }
    if (command.type === "measure") { setPanel("measure"); return; }
    if (onAskClyra) onAskClyra(`[Map scene: ${JSON.stringify(sceneContext())}] ${command.prompt}`);
    else showToast("Clyra chat is unavailable in this surface.");
  }, [findAndChoose, onAskClyra, query, route, runSearch, sceneContext, showToast, toggle3d, toggleLayer]);

  useEffect(() => {
    const timer = window.setTimeout(() => { const command = initialCommand?.trim(); if (command && ready) { setQuery(command); void execute(); } }, 0);
    return () => window.clearTimeout(timer);
  }, [execute, initialCommand, ready]);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") { event.preventDefault(); document.querySelector<HTMLInputElement>(".clyra-map__command-input")?.focus(); }
      if (event.key === "Escape") { setResults([]); setPanel("none"); setMeasureMode(null); }
      if (event.key === "+") mapRef.current?.zoomIn(); if (event.key === "-") mapRef.current?.zoomOut(); if (event.key === "3") toggle3d(); if (event.key.toLowerCase() === "l") setPanel("layers");
    };
    window.addEventListener("keydown", onKeyDown); return () => window.removeEventListener("keydown", onKeyDown);
  }, [toggle3d]);

  const activePlace = selected ?? destination;
  const isFavourite = activePlace ? favourites.some((place) => place.id === activePlace.id) : false;
  const pending = health === "INITIALIZING" || health === "STYLE_LOADING" || health === "TILES_LOADING";

  return (
    <section className="clyra-map" data-ready={ready || undefined} data-panel={visiblePanel || undefined} data-live-world={liveWorld || undefined} data-testid="clyra-maps">
      <div ref={containerRef} className="clyra-map__canvas" aria-label="Interactive Clyra map" />
      {!ready ? <div className="clyra-map__loading" aria-live="polite"><span className="clyra-map__loading-mark" /><span>{pending ? "Preparing your map…" : "Reconnecting map…"}</span></div> : null}

      <div className="clyra-map__topbar">
        <form className="clyra-map__command" onSubmit={(event) => { event.preventDefault(); void execute(); }}>
          <Search size={18} aria-hidden="true" />
          <input className="clyra-map__command-input" value={query} placeholder="Search places or ask Clyra…" aria-label="Search places or ask Clyra" onFocus={() => { if (!query && !results.length) setResults(recents.slice(0, 6)); }} onChange={(event) => { const value = event.target.value; setQuery(value); if (searchTimerRef.current) window.clearTimeout(searchTimerRef.current); if (value.trim().length >= 2) searchTimerRef.current = window.setTimeout(() => void runSearch(value), 170); else { placeSearch.cancel(); setResults(value ? [] : recents.slice(0, 6)); } }} onKeyDown={(event) => { if (event.key === "ArrowDown") { event.preventDefault(); setActiveIndex((index) => Math.min(results.length - 1, index + 1)); } else if (event.key === "ArrowUp") { event.preventDefault(); setActiveIndex((index) => Math.max(0, index - 1)); } else if (event.key === "Enter" && activeIndex >= 0 && results[activeIndex]) { event.preventDefault(); choosePlace(results[activeIndex]); } }} />
          {searching ? <span className="clyra-map__searching">Finding places…</span> : null}
          {query ? <button type="button" className="clyra-map__icon-button" aria-label="Clear search" onClick={() => { setQuery(""); setResults(recents.slice(0, 6)); }}><X size={16} /></button> : <kbd>⌘K</kbd>}
          <button type="submit" className="clyra-map__send" aria-label="Search or ask Clyra"><Send size={16} /></button>
        </form>
        {results.length ? <div className="clyra-map__suggestions" role="listbox" aria-label={query ? "Search results" : "Recent places"}>
          {!query ? <span className="clyra-map__section-label">Recent places</span> : null}
          {results.map((place, index) => { const Icon = placeIcon(place.category); return <button key={place.id} type="button" role="option" aria-selected={activeIndex === index} className={activeIndex === index ? "is-active" : ""} onMouseDown={(event) => event.preventDefault()} onClick={() => choosePlace(place)}>
            <span className="clyra-map__result-icon"><Icon size={17} /></span><span className="clyra-map__result-copy"><strong>{highlightMatch(place.name, query).map((part, partIndex) => part.match ? <mark key={partIndex}>{part.text}</mark> : <span key={partIndex}>{part.text}</span>)}</strong><small>{place.displayName}</small></span>{place.distanceM != null && place.distanceM < 100_000 ? <em>{formatDistance(place.distanceM)}</em> : null}<Navigation size={15} />
          </button>; })}
        </div> : null}
        <div className="clyra-map__examples" aria-hidden="true"><span>Try</span><button type="button" onClick={() => { setQuery("Take me to Bondi Beach"); }}>Take me to Bondi Beach</button><button type="button" onClick={() => { setQuery("Coffee nearby"); }}>Coffee nearby</button></div>
      </div>

      <div className="clyra-map__control-stack" aria-label="Map controls">
        <button type="button" aria-label="My location" title="My location" onClick={requestLocation} data-active={locationState === "requesting" || undefined}><LocateFixed size={18} /></button>
        <button type="button" aria-label={is3D ? "Switch to 2D" : "Switch to 3D"} title={is3D ? "2D" : "3D"} aria-pressed={is3D} onClick={() => toggle3d()}>{is3D ? "2D" : "3D"}</button>
        <button type="button" aria-label="Map layers" title="Layers" aria-pressed={panel === "layers"} onClick={() => setPanel(panel === "layers" ? "none" : "layers")}><Layers3 size={18} /></button>
        {Math.abs(mapState.bearing) > 2 ? <button type="button" aria-label="Reset north" title="Reset north" onClick={() => cameraRef.current?.resetNorth()}><Compass size={18} style={{ transform: `rotate(${-mapState.bearing}deg)` }} /></button> : null}
      </div>
      <div className="clyra-map__zoom"><button type="button" aria-label="Zoom in" onClick={() => mapRef.current?.zoomIn()}><Plus size={18} /></button><button type="button" aria-label="Zoom out" onClick={() => mapRef.current?.zoomOut()}><Minus size={18} /></button></div>

      {!visiblePanel && !results.length && !route ? <div className="clyra-map__discover"><span>Explore nearby</span>{quickSearches.map(({ label, query: categoryQuery, icon: Icon }) => <button key={label} type="button" onClick={() => { setQuery(categoryQuery); void runSearch(categoryQuery); }}><Icon size={15} />{label}</button>)}</div> : null}
      {showSearchArea ? <button type="button" className="clyra-map__search-area" onClick={() => void runSearch(query)}><Search size={15} />Search this area</button> : null}

      {panel === "place" && activePlace ? <aside className="clyra-map__panel clyra-map__place-card" aria-label="Place details"><PanelHeader title="Place" onClose={() => setPanel("none")} /><div className="clyra-map__place-heading"><span className="clyra-map__place-pin"><MapPin size={19} /></span><div><h2>{activePlace.name}</h2><p>{activePlace.category} · {activePlace.displayName}</p></div></div><div className="clyra-map__place-actions"><button type="button" className="is-primary" onClick={() => { setDestination(activePlace); setPanel("directions"); }}> <RouteIcon size={16} />Directions</button><button type="button" aria-label="Save place" title="Save" onClick={() => toggleFavourite(activePlace)}><Bookmark size={16} fill={isFavourite ? "currentColor" : "none"} /></button><button type="button" aria-label="Ask Clyra about this place" title="Ask Clyra" onClick={() => onAskClyra?.(`[Map scene: ${JSON.stringify(sceneContext())}] Tell me about ${activePlace.name}`)}><Sparkles size={16} /></button></div><dl className="clyra-map__facts"><div><dt>Address</dt><dd>{activePlace.displayName}</dd></div><div><dt>Coordinates</dt><dd>{activePlace.coordinates[1].toFixed(5)}, {activePlace.coordinates[0].toFixed(5)}</dd></div>{activePlace.distanceM != null ? <div><dt>Distance</dt><dd>{formatDistance(activePlace.distanceM)}</dd></div> : null}{typeof activePlace.metadata.website === "string" ? <div><dt>Website</dt><dd><a href={activePlace.metadata.website} target="_blank" rel="noreferrer">Open website</a></dd></div> : null}</dl><p className="clyra-map__honesty">Only provider-supplied details are shown.</p></aside> : null}

      {panel === "directions" ? <aside className="clyra-map__panel clyra-map__directions" aria-label="Directions"><PanelHeader title="Directions" onClose={() => setPanel("none")} /><div className="clyra-map__route-fields"><div><span className="clyra-map__route-origin" /><button type="button" onClick={() => { setOrigin(null); showToast("The current map location is now the start."); }}>{origin?.name ?? (location ? "Current Location" : "Map center")}</button></div><button className="clyra-map__swap" type="button" aria-label="Reverse route" onClick={() => { if (destination && origin) { setOrigin(destination); setDestination(origin); } }}><ArrowDownUp size={15} /></button><div><span className="clyra-map__route-destination" /><button type="button" onClick={() => { setPanel("none"); document.querySelector<HTMLInputElement>(".clyra-map__command-input")?.focus(); }}>{destination?.name ?? "Choose destination"}</button></div></div><div className="clyra-map__mode-tabs" role="tablist">{travelModes.map(({ id, label, icon: Icon }) => <button key={id} type="button" role="tab" aria-selected={travelMode === id} data-active={travelMode === id || undefined} onClick={() => setTravelMode(id)}><Icon size={16} />{label}</button>)}</div>{travelMode === "driving" ? <div className="clyra-map__route-options"><label><input type="checkbox" checked={avoid.tolls} onChange={(event) => setAvoid((value) => ({ ...value, tolls: event.target.checked }))} />Avoid tolls</label><label><input type="checkbox" checked={avoid.motorways} onChange={(event) => setAvoid((value) => ({ ...value, motorways: event.target.checked }))} />Avoid motorways</label><label><input type="checkbox" checked={avoid.ferries} onChange={(event) => setAvoid((value) => ({ ...value, ferries: event.target.checked }))} />Avoid ferries</label></div> : null}<div className="clyra-map__stops">{waypoints.map((place, index) => <div key={place.id}><span>{index + 1}</span><button type="button" onClick={() => choosePlace(place, { fly: true })}>{place.name}</button><button type="button" aria-label={`Remove ${place.name}`} onClick={() => setWaypoints((items) => items.filter((item) => item.id !== place.id))}><X size={14} /></button></div>)}{selected && selected.id !== destination?.id && !waypoints.some((place) => place.id === selected.id) ? <button type="button" className="clyra-map__add-stop" onClick={() => setWaypoints((items) => [...items, selected])}><Plus size={15} />Add {selected.name} as a stop</button> : null}</div><button type="button" className="clyra-map__build-route" disabled={!canRoute || isRouting} onClick={() => void requestDirections()}>{isRouting ? "Finding routes…" : route ? "Refresh route" : "Find route"}</button>{route ? <RouteCards route={route} alternatives={alternatives} onSelect={selectRoute} /> : <p className="clyra-map__route-disclaimer">Times are estimated by {travelMode === "transit" ? "regional providers when available" : "the routing provider"}; live traffic is unavailable.</p>}{route ? <ol className="clyra-map__steps">{route.steps.slice(0, 6).map((step, index) => <li key={`${step.instruction}-${index}`}><span>{formatDistance(step.distanceM)}</span>{step.instruction}</li>)}</ol> : null}{route ? <button type="button" className="clyra-map__start-nav" onClick={startNavigation}><Navigation size={16} />Start navigation</button> : null}</aside> : null}

      {panel === "layers" ? <aside className="clyra-map__panel clyra-map__layers-sheet" aria-label="Map layers"><PanelHeader title="Layers" onClose={() => setPanel("none")} /><section><h3>Map type</h3><div className="clyra-map__map-modes">{mapModes.map((mode) => <button key={mode.id} type="button" data-active={mapMode === mode.id || undefined} disabled={mode.available === false} onClick={() => setMode(mode.id)}>{mode.label}{mode.available === false ? <small>Unavailable</small> : null}</button>)}</div></section><section><h3>Live World</h3><p className="clyra-map__layer-intro">Public data is off until you choose a layer. Every layer reports its source and freshness.</p>{liveLayers.map((id) => { const layer = layers.find((entry) => entry.id === id); const enabled = liveRef.current?.isEnabled(id); return <button key={id} type="button" className="clyra-map__layer-row" data-active={enabled || undefined} onClick={() => void toggleLayer(id)}><span>{id === "aircraft" ? <Plane size={17} /> : id === "earthquakes" ? <Zap size={17} /> : <Box size={17} />}</span><span><strong>{layer?.label ?? id}</strong><small>{layer?.source ?? "Loading source…"}</small></span><em data-status={layer?.status}>{layer?.status === "live" ? "LIVE" : layer?.status === "loading" ? "Loading" : layer?.status === "error" || layer?.status === "unavailable" ? "Unavailable" : "Off"}</em></button>; })}</section><button type="button" className="clyra-map__diagnostics" onClick={() => showToast(mapProviders.snapshot().map((provider) => `${provider.label}: ${provider.status}`).join(" · ") || "Checking providers…")}>Provider status</button></aside> : null}

      {panel === "measure" ? <aside className="clyra-map__panel clyra-map__measure-panel" aria-label="Measure map"><PanelHeader title="Measure" onClose={() => { setPanel("none"); setMeasureMode(null); }} /><p>Measurements remain local to this view.</p><button type="button" data-active={measureMode === "distance" || undefined} onClick={() => { setMeasureMode("distance"); setMeasurePoints([]); }}> <MousePointer2 size={16} />Measure distance</button><button type="button" data-active={measureMode === "area" || undefined} onClick={() => { setMeasureMode("area"); setMeasurePoints([]); }}> <MapIcon size={16} />Measure area</button>{measureMode === "area" ? <small>Click three or more points, then double-click to finish.</small> : measureMode === "distance" ? <small>Click two points on the map.</small> : null}{measurements.length ? <button type="button" className="clyra-map__clear-measure" onClick={() => setMeasurements([])}>Clear measurements</button> : null}</aside> : null}

      {navigating && route ? <div className="clyra-map__navigation-hud" role="status"><span className="clyra-map__next-turn"><Navigation size={22} /></span><div><strong>{route.steps[0]?.instruction ?? "Continue on route"}</strong><small>{route.steps[0] ? formatDistance(route.steps[0].distanceM) : "On route"}</small></div><button type="button" aria-label="Route overview" onClick={() => { const bounds = new maplibregl.LngLatBounds(); route.geometry.coordinates.forEach((point) => bounds.extend(point as LngLat)); cameraRef.current?.fitRoute(bounds); }}><MoreHorizontal size={18} /></button><button type="button" aria-label="Stop navigation" onClick={stopNavigation}><X size={18} /></button><footer><span>{formatDuration(route.durationS)} remaining</span><span>{formatDistance(route.distanceM)}</span><span>ETA {new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date(Date.now() + route.durationS * 1000))}</span></footer></div> : null}
      {toast ? <div className="clyra-map__toast" role="status">{toast}</div> : null}
      <div className="clyra-map__attribution">© <a href="https://openfreemap.org/" target="_blank" rel="noreferrer">OpenFreeMap</a> © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap contributors</a></div>
    </section>
  );
}

function PanelHeader({ title, onClose }: { title: string; onClose: () => void }) { return <header className="clyra-map__panel-header"><h2>{title}</h2><button type="button" aria-label={`Close ${title}`} onClick={onClose}><X size={17} /></button></header>; }
function RouteCards({ route, alternatives, onSelect }: { route: Route; alternatives: Route[]; onSelect: (route: Route) => void }) { return <div className="clyra-map__route-cards"><button type="button" className="is-selected" onClick={() => onSelect(route)}><strong>{formatDuration(route.durationS)}</strong><span>{formatDistance(route.distanceM)} · Fastest</span></button>{alternatives.slice(0, 2).map((alternative) => <button type="button" key={alternative.id} onClick={() => onSelect(alternative)}><strong>{formatDuration(alternative.durationS)}</strong><span>{formatDistance(alternative.distanceM)} · Alternative</span></button>)}</div>; }

export default ClyraStandardMap;
