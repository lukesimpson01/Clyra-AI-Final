import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { MapView, type MapViewHandle } from "../../maps/MapView";
import { MapsComposer } from "./MapsComposer";
import { PlaceResultsList } from "./PlaceResultsList";
import { PlaceDetailSheet } from "./PlaceDetailSheet";
import { RouteOverviewPanel, type TransitState, type TransitWhen } from "./RouteOverviewPanel";
import { LookAroundViewer } from "./LookAroundViewer";
import { addToGuide, createGuide, readLibrary } from "../../maps/library";
import { fetchTilePois } from "../../maps/tilePois";
import { downloadArea, saveArea } from "../../maps/offline";
import type { TransitItinerary } from "../../../lib/maps/transit";
import { NavigationHud } from "./NavigationHud";
import { MapsAgentPanel, type ComparisonRow, type MapsAgentTurn } from "./MapsAgentPanel";
import { MapControls } from "./MapControls";
import { MapsHome, pushRecent } from "./MapsHome";
import type { Basemap } from "../../maps/MapController";
import { CATEGORY_CHIPS, CATEGORY_ICONS } from "./mapsIcons";
import { prefetchPlaceDetail } from "./placeDetailCache";
import type { SimulationState } from "../../navigation/NavigationSimulationEngine";
import { NavigationCameraController, overviewBoundsOf } from "../../navigation/NavigationCameraController";
import { RouteInterpolator } from "../../navigation/RouteInterpolator";
import type { ClyraPlace, Coordinate, Route, TravelMode } from "../../../lib/maps/types";
import { getElectronDesktop } from "../../lib/electron-runtime";
import "./maps-ui.css";

/** Space the left place/route panel takes, so fitted routes stay fully visible. */
const ROUTE_PADDING = { top: 96, bottom: 40, left: 440, right: 90 };
const PREFS_KEY = "clyra.mapsPrefs";

interface MapsPrefs {
  mode?: TravelMode;
  avoidTolls?: boolean;
}

function readPrefs(): MapsPrefs {
  try {
    return JSON.parse(localStorage.getItem(PREFS_KEY) || "{}") as MapsPrefs;
  } catch {
    return {};
  }
}

function writePrefs(next: MapsPrefs) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(next));
  } catch {
    // Storage unavailable: the preference applies for this session only.
  }
}

const DEFAULT_CENTER: Coordinate = [151.2093, -33.8688]; // Sydney — last-resort default only
const LAST_CENTER_KEY = "clyra.mapsLastCenter";

/** The last place the user looked at. Lets the map paint on first frame instead
 * of waiting for a location fix; the live fix still refines it afterwards. */
function readLastCenter(): Coordinate | null {
  try {
    const v = JSON.parse(localStorage.getItem(LAST_CENTER_KEY) || "null");
    return Array.isArray(v) && v.length === 2 && v.every(Number.isFinite) ? (v as Coordinate) : null;
  } catch {
    return null;
  }
}

const THINKING_LABELS = [
  "Finding places…",
  "Checking the route…",
  "Comparing options…",
  "Looking along your route…",
  "Checking today's opening hours…",
];

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok || data?.ok === false) throw new Error(data?.error || `${url} failed`);
  return data;
}

interface IdentifyResponse {
  kind: "place" | "address" | "pin";
  place?: ClyraPlace;
  address?: { formatted?: string; houseNumber?: string; road?: string; suburb?: string; city?: string; state?: string };
  nearby: ClyraPlace[];
}

/** Mirrors the server's AgentEvent / MapAction union. Every action is validated
 * before it touches the map, so the model can only request these fixed operations. */
type AgentAction =
  | { type: "show_places"; places: ClyraPlace[]; title?: string }
  | { type: "select_place"; place: ClyraPlace }
  | { type: "set_route"; route: Route; destinationName: string; destination?: ClyraPlace; stops?: ClyraPlace[] }
  | { type: "fit_results" }
  | { type: "clear_results" }
  | { type: "zoom"; delta: 1 | -1 }
  | { type: "show_comparison"; rows: ComparisonRow[] }
  | { type: "save_preference"; key: "travel_mode" | "avoid_tolls"; value: string | boolean }
  | { type: "show_transit"; itineraries: TransitItinerary[]; destinationName: string; destination: Coordinate }
  | { type: "map_command"; command: "satellite" | "default_map" | "driving_map" | "tilt_3d" | "flat_2d" | "flyover" | "stop_flyover" | "start_navigation" | "look_around" | "locate_me" | "offline_download" }
  | { type: "add_to_guide"; place: ClyraPlace; guide: string };

type AgentEvent =
  | { type: "status"; label: string }
  | { type: "tool"; name: string; ok: boolean; summary: string }
  | { type: "actions"; actions: AgentAction[] }
  | { type: "final"; reply: string }
  | { type: "error"; message: string };

const isPlace = (p: unknown): p is ClyraPlace => {
  const c = p as ClyraPlace;
  return Boolean(c) && typeof c.id === "string" && Array.isArray(c.coordinates) && c.coordinates.length === 2 && c.coordinates.every(Number.isFinite);
};

const isRoute = (r: unknown): r is Route => {
  const c = r as Route;
  return Boolean(c) && Array.isArray(c.geometry) && c.geometry.length > 1 && Number.isFinite(c.durationSeconds) && Number.isFinite(c.distanceMeters);
};

export function ClyraMapsWorkspace() {
  const mapViewRef = useRef<MapViewHandle>(null);
  const [mapReady, setMapReady] = useState(false);
  // Do not construct MapLibre around Sydney and then hope a later GPS callback
  // corrects it. Waiting briefly for the first real fix means Maps always
  // opens in the user's area; a deliberately bounded fallback still keeps an
  // unavailable/denied location permission from blocking the workspace.
  const [initialCenter, setInitialCenter] = useState<Coordinate | null>(() => readLastCenter());
  const [locationStatus, setLocationStatus] = useState<"locating" | "approximate" | "precise" | "unavailable">("locating");
  const initialLocationRef = useRef<Coordinate | null>(readLastCenter());
  const centerRef = useRef<Coordinate>(readLastCenter() ?? DEFAULT_CENTER);
  const realPositionRef = useRef<Coordinate | null>(null);
  const didFocusPreciseLocationRef = useRef(false);
  const didFocusApproximateLocationRef = useRef(false);

  const [places, setPlaces] = useState<ClyraPlace[]>([]);
  const [resultsTitle, setResultsTitle] = useState<string | undefined>();
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [selectedPlace, setSelectedPlace] = useState<ClyraPlace | null>(null);

  const [route, setRoute] = useState<Route | null>(null);
  /** Which kind of guidance is running: a live, GPS-following drive, or the cinematic flight. */
  const [navKind, setNavKind] = useState<"live" | "fly">("fly");
  const [alternatives, setAlternatives] = useState<Route[]>([]);
  const [destinationName, setDestinationName] = useState("");
  const [mode, setMode] = useState<TravelMode>(() => readPrefs().mode ?? "drive");

  const [thinking, setThinking] = useState(false);
  const [thinkingLabel, setThinkingLabel] = useState(THINKING_LABELS[0]);

  const [navActive, setNavActive] = useState(false);
  const navActiveRef = useRef(false);
  const [simState, setSimState] = useState<SimulationState | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [transit, setTransit] = useState<TransitState | null>(null);
  const [transitWhen, setTransitWhen] = useState<TransitWhen>({ kind: "now" });
  const transitWhenRef = useRef<TransitWhen>({ kind: "now" });
  const [stops, setStops] = useState<ClyraPlace[]>([]);
  const stopsRef = useRef<ClyraPlace[]>([]);
  const destRef = useRef<{ name: string; coordinates: Coordinate } | null>(null);
  /** Live data from the cinematic flight, for the HUD. */
  const watchRef = useRef<number | null>(null);
  const routeRef = useRef<Route | null>(null);
  const handleStopRef = useRef<() => void>(() => undefined);
  const liveCleanupRef = useRef<() => void>(() => undefined);
  routeRef.current = route;
  const [liveFix, setLiveFix] = useState<{ accuracy: number; waiting: boolean } | null>(null);
  const flightRef = useRef<{ progress: number; speed: number; phase: "cruise" | "hold" | "turn"; paused: boolean; scale: number } | null>(null);
  const [flying, setFlying] = useState(false);
  /** The search dropdown is open: the panel beneath it steps aside so only one menu shows. */
  const [searchOpen, setSearchOpen] = useState(false);
  const [lookAround, setLookAround] = useState<{ coordinates: Coordinate; title?: string } | null>(null);
  const [downloadLabel, setDownloadLabel] = useState<string | null>(null);
  const activeCategoryRef = useRef<{ id: string; label: string } | null>(null);
  const [userMoved, setUserMoved] = useState(false);
  const categoryReqRef = useRef(0);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [basemap, setBasemapState] = useState<Basemap>("explore");
  const [locating, setLocating] = useState(false);

  const controller = useCallback(() => mapViewRef.current?.getController() ?? null, []);
  const map = useCallback(() => mapViewRef.current?.getMap() ?? null, []);

  /* --------------------------- live location + intro --------------------------- */
  useEffect(() => {
    let cancelled = false;
    let fallbackStarted = false;
    let watchId: number | null = null;

    const validCoordinate = (coord: Coordinate) =>
      Number.isFinite(coord[0]) && Number.isFinite(coord[1]) && Math.abs(coord[0]) <= 180 && Math.abs(coord[1]) <= 90;

    // The first useful fix becomes the map's construction point. Later GPS
    // fixes update the blue dot but never steal the camera after the user has
    // begun exploring. If an approximate IP location won the startup race,
    // the first precise fix gets one calm, interruptible fly-in.
    let hadPrecise = false;
    const onFix = (coord: Coordinate, source: "precise" | "approximate") => {
      if (cancelled || !validCoordinate(coord)) return;
      // A late network (IP) answer must never replace a real fix.
      if (source === "approximate" && hadPrecise) return;
      if (source === "precise") hadPrecise = true;
      realPositionRef.current = coord;
      if (!initialLocationRef.current) {
        initialLocationRef.current = coord;
        centerRef.current = coord;
        setInitialCenter(coord);
      }
      setLocationStatus(source);
      if (!navActiveRef.current) controller()?.setDotPosition(coord);

      const m = map();
      if (source === "precise" && m && !didFocusPreciseLocationRef.current) {
        didFocusPreciseLocationRef.current = true;
        m.stop();
        m.flyTo({
          center: coord,
          zoom: 15.6,
          pitch: 26,
          bearing: 0,
          duration: 1250,
          curve: 1.32,
          essential: true,
        });
      } else if (source === "approximate" && m && !didFocusApproximateLocationRef.current) {
        didFocusApproximateLocationRef.current = true;
        m.stop();
        m.flyTo({ center: coord, zoom: 13.8, duration: 850, curve: 1.18, essential: true });
      }
    };

    const fallbackToIp = () => {
      if (fallbackStarted) return;
      fallbackStarted = true;
      fetch("/api/research/geo-ip", { method: "POST" })
        .then((r) => r.json())
        .then((d) => {
          if (d?.ok && typeof d.lon === "number" && typeof d.lat === "number") onFix([d.lon, d.lat], "approximate");
          else if (!initialLocationRef.current) setLocationStatus("unavailable");
        })
        .catch(() => {
          if (!initialLocationRef.current) setLocationStatus("unavailable");
        });
    };

    if (!("geolocation" in navigator)) {
      fallbackToIp();
      return () => {
        cancelled = true;
      };
    }

    // Kick the permission prompt and a cached Wi-Fi/GPS fix off immediately,
    // before the vector map is built. This is materially faster than waiting
    // for MapLibre's load event first.
    navigator.geolocation.getCurrentPosition(
      (pos) => onFix([pos.coords.longitude, pos.coords.latitude], "precise"),
      fallbackToIp,
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 60_000 },
    );
    watchId = navigator.geolocation.watchPosition(
      (pos) => onFix([pos.coords.longitude, pos.coords.latitude], "precise"),
      () => fallbackToIp(),
      { enableHighAccuracy: true, timeout: 12_000, maximumAge: 30_000 },
    );
    // In the desktop app, also ask macOS Location Services directly (Wi-Fi/GPS grade). Whichever precise source
    // answers first wins; the browser API in a dev Electron build often never receives a system fix.
    const nativeLocation = getElectronDesktop()?.location;
    if (nativeLocation) {
      void nativeLocation.get({ timeoutSeconds: 12 }).then((result) => {
        if (result?.ok && typeof result.lat === "number" && typeof result.lon === "number") onFix([result.lon, result.lat], "precise");
        else if (!cancelled && result?.error === "denied") setLocationHint("Location is off for Clyra. Turn it on in System Settings → Privacy & Security → Location Services.");
      }).catch(() => {});
    }

    // Never strand the interface while an OS location service is warming up.
    // This is only a last resort: IP lookup continues in the background and
    // a precise fix will still refine the view once it arrives.
    const launchFallback = window.setTimeout(() => {
      if (!cancelled && !initialLocationRef.current) {
        initialLocationRef.current = DEFAULT_CENTER;
        setInitialCenter(DEFAULT_CENTER);
        fallbackToIp();
      }
    }, 1800);

    return () => {
      cancelled = true;
      window.clearTimeout(launchFallback);
      if (watchId != null) navigator.geolocation.clearWatch(watchId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Once MapLibre is ready, use a small settling move to establish the
  // current-location framing. It is skipped when the precise callback already
  // performed the same move, so map startup remains quiet and interruption-safe.
  useEffect(() => {
    const coord = realPositionRef.current;
    const m = map();
    if (!mapReady || !coord || !m) return;
    controller()?.setDotPosition(coord);
    if (locationStatus === "precise" && !didFocusPreciseLocationRef.current) {
      didFocusPreciseLocationRef.current = true;
      m.flyTo({ center: coord, zoom: 15.6, pitch: 26, duration: 1050, curve: 1.25, essential: true });
    } else if (locationStatus === "approximate" && !didFocusApproximateLocationRef.current) {
      didFocusApproximateLocationRef.current = true;
      m.flyTo({ center: coord, zoom: 13.8, duration: 850, curve: 1.18, essential: true });
    }
  }, [controller, locationStatus, map, mapReady]);

  const [locationHint, setLocationHint] = useState<string | null>(null);

  const handleLocate = useCallback(() => {
    const m = map();
    const go = (c: Coordinate) => {
      realPositionRef.current = c;
      controller()?.setDotPosition(c);
      m?.flyTo({ center: c, zoom: Math.max(m.getZoom(), 15.5), bearing: 0, duration: 900, essential: true });
    };
    if (realPositionRef.current) go(realPositionRef.current);
    setLocating(true);
    const nativeLocation = getElectronDesktop()?.location;
    if (nativeLocation) {
      void nativeLocation.get({ timeoutSeconds: 10 }).then((result) => {
        if (result?.ok && typeof result.lat === "number" && typeof result.lon === "number") {
          setLocating(false);
          setLocationStatus("precise");
          setLocationHint(null);
          go([result.lon, result.lat]);
        } else if (result?.error === "denied") {
          setLocating(false);
          setLocationHint("Location is off for Clyra. Turn it on in System Settings → Privacy & Security → Location Services.");
          window.setTimeout(() => setLocationHint(null), 7000);
        }
      }).catch(() => {});
    }
    navigator.geolocation?.getCurrentPosition(
      (pos) => {
        setLocating(false);
        go([pos.coords.longitude, pos.coords.latitude]);
      },
      (err) => {
        setLocating(false);
        setLocationHint(
          err.code === 1
            ? "Location is blocked. Allow Clyra in System Settings → Privacy & Security → Location Services."
            : "Couldn't get a precise fix. Check that Location Services is on, then try again.",
        );
        window.setTimeout(() => setLocationHint(null), 6000);
      },
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 15_000 },
    );
  }, [controller, map]);

  /* -------------------------------- data fetchers -------------------------------- */
  // Autocomplete and Enter share results, so submitting a query you just saw
  // suggestions for is instant instead of a second round-trip.
  const searchCacheRef = useRef(new Map<string, { at: number; places: ClyraPlace[] }>());
  const fetchSuggestions = useCallback(async (query: string): Promise<ClyraPlace[]> => {
    const key = query.trim().toLowerCase();
    const hit = searchCacheRef.current.get(key);
    if (hit && Date.now() - hit.at < 5 * 60_000) return hit.places;
    try {
      const data = await postJson<{ places: ClyraPlace[] }>("/api/maps/search", {
        query,
        near: centerRef.current,
        limit: 12,
      });
      const places = data.places || [];
      if (places.length) searchCacheRef.current.set(key, { at: Date.now(), places });
      return places;
    } catch {
      return [];
    }
  }, []);

  const showPlacesOnMap = useCallback(
    (list: ClyraPlace[], title?: string, fit = true) => {
      setPlaces(list);
      setResultsTitle(title);
      controller()?.setPois(list);
      if (fit && list.length) {
        const lons = list.map((p) => p.coordinates[0]);
        const lats = list.map((p) => p.coordinates[1]);
        controller()?.fitToBounds(
          [
            [Math.min(...lons), Math.min(...lats)],
            [Math.max(...lons), Math.max(...lats)],
          ],
          ROUTE_PADDING,
        );
      }
    },
    [controller],
  );

  const handleCategoryClick = useCallback(
    async (categoryId: string, label: string) => {
      const token = ++categoryReqRef.current;
      activeCategoryRef.current = { id: categoryId, label };
      setActiveCategory(categoryId);
      setUserMoved(false);
      setSelectedPlace(null);
      // Instant answer from tiles already on screen, then from the z14 tiles around the view.
      let instant = controller()?.queryTilePois(categoryId, centerRef.current) ?? [];
      if (instant.length) showPlacesOnMap(instant, label);
      else setThinking(true);
      const tileList = await fetchTilePois(categoryId, centerRef.current);
      if (token !== categoryReqRef.current) return;
      if (tileList.length) {
        instant = tileList;
        showPlacesOnMap(tileList, label);
        setThinking(false);
      }
      setThinkingLabel(`Finding ${label.toLowerCase()}…`);
      try {
        const data = await postJson<{ places: ClyraPlace[] }>("/api/maps/nearby", { center: centerRef.current, category: categoryId });
        if (token !== categoryReqRef.current) return;
        const rich = data.places || [];
        // Richer Overpass results (hours, phone…) replace the quick ones; tile-only
        // places the service missed are kept after them.
        const names = new Set(rich.map((p) => p.name.toLowerCase()));
        const merged = [...rich, ...instant.filter((p) => !names.has(p.name.toLowerCase()))].slice(0, 25);
        if (merged.length || !instant.length) showPlacesOnMap(merged, label, !instant.length);
      } catch {
        if (token === categoryReqRef.current && !instant.length) showPlacesOnMap([], label);
      } finally {
        if (token === categoryReqRef.current) setThinking(false);
      }
    },
    [controller, showPlacesOnMap],
  );

  /* ----------------------- selection, routing & map clicks ----------------------- */
  // Every selection gets a generation id. Late responses from an earlier click
  // compare against the current id and are dropped, so A can never overwrite C.
  const selectionRef = useRef(0);
  const routeReqRef = useRef(0);
  const [nearby, setNearby] = useState<ClyraPlace[]>([]);
  const [identifying, setIdentifying] = useState(false);
  const [routeLoading, setRouteLoading] = useState(false);

  /** Glide the selected point into the visible area beside the left panel. */
  const frameOnMap = useCallback(
    (coord: Coordinate) => {
      const m = map();
      if (!m) return;
      m.easeTo({
        center: coord,
        zoom: Math.max(m.getZoom(), 15.5),
        // An offset, not padding: MapLibre keeps camera padding on the map, which
        // would be counted a second time by every later fitBounds().
        offset: [208, 36],
        duration: 900,
        easing: (t) => 1 - Math.pow(1 - t, 3),
        essential: true,
      });
    },
    [map],
  );

  /** Fetches and draws a route to `dest` without changing what the left panel
   * shows. Used automatically on selection, so the user never has to press
   * Directions. A failed route simply means no route card, never a made-up one. */
  const resetStops = useCallback(() => {
    stopsRef.current = [];
    setStops([]);
    controller()?.setStops([]);
  }, [controller]);

  const loadRouteFor = useCallback(
    async (dest: ClyraPlace | { name: string; coordinates: Coordinate }, override?: { stops?: ClyraPlace[]; mode?: TravelMode }) => {
      const reqId = ++routeReqRef.current;
      const m = override?.mode ?? mode;
      const stopList = override?.stops ?? stopsRef.current;
      destRef.current = { name: dest.name ?? "", coordinates: dest.coordinates };
      setRouteLoading(true);
      setDestinationName(dest.name ?? "");
      const origin = realPositionRef.current || centerRef.current;
      try {
        if (m === "transit") {
          setRoute(null);
          setAlternatives([]);
          controller()?.setRoute(null);
          controller()?.setAlternativeRoutes([]);
          setTransit({ itineraries: [], selectedId: null, loading: true });
          let itineraries: TransitItinerary[] = [];
          try {
            const w = transitWhenRef.current;
            const time = w.kind !== "now" && w.time ? new Date(w.time).toISOString() : undefined;
            itineraries = (await postJson<{ itineraries: TransitItinerary[] }>("/api/maps/transit", { origin, destination: dest.coordinates, time, arriveBy: w.kind === "arrive" && Boolean(time) })).itineraries;
          } catch {
            // No transit data: the panel explains it rather than inventing a trip.
          }
          if (reqId !== routeReqRef.current) return;
          const first = itineraries[0];
          setTransit({ itineraries, selectedId: first?.id ?? null, loading: false });
          controller()?.setTransit(first?.legs ?? null);
          if (first) controller()?.fitToBounds(overviewBoundsOf(first.legs.flatMap((l) => l.geometry)), ROUTE_PADDING);
          return;
        }
        setTransit(null);
        controller()?.setTransit(null);
        const data = await postJson<{ routes: Route[] }>("/api/maps/route", {
          origin,
          destination: dest.coordinates,
          mode: m,
          alternatives: true,
          waypoints: stopList.length ? stopList.map((s) => s.coordinates) : undefined,
        });
        if (reqId !== routeReqRef.current) return;
        const [primary, ...rest] = data.routes;
        setRoute(primary);
        setAlternatives(data.routes);
        controller()?.setRoute(primary);
        controller()?.setAlternativeRoutes(rest);
        controller()?.setRouteLabels(primary, rest);
        controller()?.setStops(stopList.map((s) => s.coordinates));
        // Zoom out to show the whole route, clear of the left panel.
        controller()?.fitToBounds(overviewBoundsOf(primary.geometry), ROUTE_PADDING);
      } catch {
        if (reqId !== routeReqRef.current) return;
        setRoute(null);
        setAlternatives([]);
        controller()?.setRoute(null);
        controller()?.setAlternativeRoutes([]);
      } finally {
        if (reqId === routeReqRef.current) setRouteLoading(false);
      }
    },
    [controller, mode],
  );

  const selectPlace = useCallback(
    (place: ClyraPlace) => {
      selectionRef.current += 1;
      setSelectedPlace(place);
      pushRecent(place);
      resetStops();
      activeCategoryRef.current = null;
      setActiveCategory(null);
      setNearby([]);
      setIdentifying(false);
      setPlaces([]);
        controller()?.setPois([]);
      controller()?.setSelectionPin(place.coordinates);
      frameOnMap(place.coordinates);
      // Real places get their route straight away; dropped pins wait for the user.
      if (!place.id.startsWith("pin-")) void loadRouteFor(place);
    },
    [controller, frameOnMap, loadRouteFor, resetStops],
  );

  const focusPlace = useCallback((place: ClyraPlace) => selectPlace(place), [selectPlace]);

  /** Opens the directions panel for a destination (Apple-style): the place card
   * closes and the route/transit overview takes the left column. */
  const computeRoute = useCallback(
    async (destination: ClyraPlace | { name: string; coordinates: Coordinate }, nextMode?: TravelMode, keepStops = false) => {
      setSelectedPlace(null);
      controller()?.setSelectionPin(null);
      setPlaces([]);
      controller()?.setPois([]);
      if (!keepStops) resetStops();
      await loadRouteFor({ name: destination.name, coordinates: destination.coordinates }, { mode: nextMode });
    },
    [controller, loadRouteFor, resetStops],
  );

  /** A place handed over from chat ("Get directions" on a map card): Maps opens already on it. Directions open the
   * route overview for that destination, ready for Start; "place" opens its card. Read once, then cleared. */
  useEffect(() => {
    if (!mapReady) return;
    const consume = () => {
      let pending: { mode?: "directions" | "place"; name: string; coordinates: Coordinate; address?: string } | null = null;
      try {
        pending = JSON.parse(sessionStorage.getItem("clyra.maps.pending") || "null");
        sessionStorage.removeItem("clyra.maps.pending");
      } catch { pending = null; }
      if (!pending || !Array.isArray(pending.coordinates)) return;
      const place: ClyraPlace = { id: `chat-${pending.coordinates[1].toFixed(5)}-${pending.coordinates[0].toFixed(5)}`, name: pending.name, coordinates: pending.coordinates, address: pending.address, categories: [], sourceLinks: [] };
      if (pending.mode === "place") selectPlace(place);
      else { controller()?.setSelectionPin(place.coordinates); frameOnMap(place.coordinates); void computeRoute(place); }
    };
    consume();
    window.addEventListener("clyra:maps-pending", consume);
    return () => window.removeEventListener("clyra:maps-pending", consume);
  }, [mapReady, controller, computeRoute, selectPlace, frameOnMap]);

  /** Any click on the map identifies what is there. The pin appears at once;
   * the card fills in when the identify service answers. */
  const handleMapClick = useCallback(
    async (coord: Coordinate, hint?: { name: string; kind?: string }) => {
      if (navActiveRef.current) return;
      const id = ++selectionRef.current;
      const pin: ClyraPlace = {
        id: `pin-${coord[1].toFixed(6)}-${coord[0].toFixed(6)}`,
        name: hint?.name ?? "Dropped pin",
        coordinates: coord,
        categories: hint?.kind ? [hint.kind] : [],
        sourceLinks: [],
      };
      setSelectedPlace(pin);
      setNearby([]);
      setPlaces([]);
      resetStops();
      setTransit(null);
      controller()?.setTransit(null);
      setRoute(null);
      setAlternatives([]);
      controller()?.setRoute(null);
      controller()?.setAlternativeRoutes([]);
      controller()?.setPois([]);
      controller()?.setSelectionPin(coord);
      frameOnMap(coord);
      setIdentifying(true);
      try {
        const data = await postJson<IdentifyResponse>("/api/maps/identify", { coordinates: coord });
        if (id !== selectionRef.current) return;
        const addr = data.address;
        const resolved: ClyraPlace = data.place ?? {
          ...pin,
          name: data.kind === "address" && addr?.road ? [addr.houseNumber, addr.road].filter(Boolean).join(" ") : "Dropped pin",
          address: addr?.formatted,
          locality: addr?.suburb || addr?.city,
          region: addr?.state,
        };
        setSelectedPlace(resolved);
        setNearby(data.nearby ?? []);
        controller()?.setSelectionPin(resolved.coordinates);
        if (!resolved.id.startsWith("pin-")) void loadRouteFor(resolved);
      } catch {
        // Identify unavailable: keep the dropped pin card. Nothing is invented.
      } finally {
        if (id === selectionRef.current) setIdentifying(false);
      }
    },
    [controller, frameOnMap, loadRouteFor, resetStops],
  );

  const closeSelection = useCallback(() => {
    selectionRef.current += 1;
    setSelectedPlace(null);
    setNearby([]);
    setIdentifying(false);
    controller()?.setSelectionPin(null);
  }, [controller]);

  /* ------------------------------ Ask Clyra agent ------------------------------ */
  // Latest selection/route/results for the agent request, without re-creating handlers.
  const liveRef = useRef({ selectedPlace, route, places, nearby, mode });
  liveRef.current = { selectedPlace, route, places, nearby, mode };

  const [agentOpen, setAgentOpen] = useState(false);
  const [agentTurns, setAgentTurns] = useState<MapsAgentTurn[]>([]);
  const [agentBusy, setAgentBusy] = useState(false);
  const [agentStatus, setAgentStatus] = useState("");
  const agentAbortRef = useRef<AbortController | null>(null);

  const fitPlaces = (list: ClyraPlace[]) => {
    if (!list.length) return;
    const lons = list.map((p) => p.coordinates[0]);
    const lats = list.map((p) => p.coordinates[1]);
    controller()?.fitToBounds([
      [Math.min(...lons), Math.min(...lats)],
      [Math.max(...lons), Math.max(...lats)],
    ]);
  };

  /** Applies one validated map action. Anything malformed is ignored. */
  const applyAgentAction = (action: AgentAction, patch: (fn: (t: MapsAgentTurn) => MapsAgentTurn) => void) => {
    const step = (label: string) => patch((t) => ({ ...t, steps: [...(t.steps ?? []), { kind: "map" as const, label }] }));
    switch (action.type) {
      case "show_places": {
        const list = (action.places ?? []).filter(isPlace);
        setPlaces(list);
        activeCategoryRef.current = null;
        setResultsTitle(action.title);
        setSelectedPlace(null);
        controller()?.setPois(list);
        fitPlaces(list);
        patch((t) => ({ ...t, places: list }));
        step(`Showed ${list.length} place${list.length === 1 ? "" : "s"} on the map`);
        return;
      }
      case "select_place":
        if (isPlace(action.place)) {
          selectPlace(action.place);
          step(`Selected ${action.place.name ?? "a place"}`);
        }
        return;
      case "set_route":
        if (isRoute(action.route)) {
          const tripStops = (action.stops ?? []).filter(isPlace);
          stopsRef.current = tripStops;
          setStops(tripStops);
          controller()?.setStops(tripStops.map((p) => p.coordinates));
          const finalDest = action.destination && isPlace(action.destination) ? action.destination : null;
          if (finalDest) destRef.current = { name: finalDest.name ?? "", coordinates: finalDest.coordinates };
          if (action.route.mode !== "transit") setMode(action.route.mode);
          setTransit(null);
          setRoute(action.route);
          setAlternatives([action.route]);
          setDestinationName(action.destinationName ?? "");
          setSelectedPlace(null);
          setPlaces([]);
          controller()?.setPois([]);
          controller()?.setRoute(action.route);
          controller()?.setAlternativeRoutes([]);
          controller()?.fitToBounds(overviewBoundsOf(action.route.geometry), ROUTE_PADDING);
          step(`${tripStops.length ? `Planned a ${tripStops.length + 1}-stop trip` : "Drew route"} to ${action.destinationName || "destination"} · ${Math.round(action.route.durationSeconds / 60)} min · ${(action.route.distanceMeters / 1000).toFixed(1)} km`);
        }
        return;
      case "fit_results":
        fitPlaces(liveRef.current.places);
        step("Zoomed to fit the results");
        return;
      case "clear_results":
        setPlaces([]);
        controller()?.setPois([]);
        patch((t) => ({ ...t, places: [] }));
        step("Cleared the results from the map");
        return;
      case "zoom": {
        const m = map();
        if (m) m.easeTo({ zoom: m.getZoom() + action.delta, duration: 400 });
        step(action.delta > 0 ? "Zoomed in" : "Zoomed out");
        return;
      }
      case "show_comparison":
        patch((t) => ({ ...t, comparison: action.rows, steps: [...(t.steps ?? []), { kind: "map" as const, label: `Compared ${action.rows.length} places` }] }));
        return;
      case "save_preference": {
        const next = { ...readPrefs(), ...(action.key === "travel_mode" ? { mode: action.value as TravelMode } : { avoidTolls: Boolean(action.value) }) };
        writePrefs(next);
        if (action.key === "travel_mode" && ["drive", "walk", "bike"].includes(String(action.value))) setMode(action.value as TravelMode);
        step(action.key === "travel_mode" ? `Saved travel preference: ${action.value}` : `Saved preference: ${action.value ? "avoid tolls" : "tolls allowed"}`);
        return;
      }
      case "show_transit": {
        if (!Array.isArray(action.itineraries) || !action.itineraries.length) return;
        const first = action.itineraries[0];
        setMode("transit");
        setSelectedPlace(null);
        setPlaces([]);
        controller()?.setPois([]);
        controller()?.setSelectionPin(null);
        setRoute(null);
        setAlternatives([]);
        controller()?.setRoute(null);
        controller()?.setAlternativeRoutes([]);
        destRef.current = { name: action.destinationName, coordinates: action.destination };
        setDestinationName(action.destinationName);
        setTransit({ itineraries: action.itineraries, selectedId: first.id, loading: false });
        controller()?.setTransit(first.legs);
        controller()?.fitToBounds(overviewBoundsOf(first.legs.flatMap((l) => l.geometry)), ROUTE_PADDING);
        step(`Planned transit to ${action.destinationName} · ${Math.round(first.durationSeconds / 60)} min`);
        return;
      }
      case "map_command": {
        const m = map();
        const ctrl = controller();
        const basemaps = { satellite: "satellite", default_map: "explore", driving_map: "driving" } as const;
        const c = action.command;
        if (c in basemaps) {
          const b = basemaps[c as keyof typeof basemaps] as Basemap;
          setBasemapState(b);
          ctrl?.setBasemap(b);
        } else if (c === "tilt_3d") m?.easeTo({ pitch: 60, duration: 600 });
        else if (c === "flat_2d") m?.easeTo({ pitch: 0, bearing: 0, duration: 600 });
        else if (c === "flyover") {
          if (ctrl && !ctrl.flying) toggleFlyover();
        } else if (c === "stop_flyover") {
          if (ctrl?.flying) toggleFlyover();
        } else if (c === "start_navigation") handleGo();
        else if (c === "look_around") handleLookAround();
        else if (c === "locate_me") handleLocate();
        else if (c === "offline_download") void handleDownload();
        else return;
        step(`Map: ${c.replace(/_/g, " ")}`);
        return;
      }
      case "add_to_guide": {
        if (!isPlace(action.place)) return;
        const existing = readLibrary().guides.find((g) => g.name.toLowerCase() === String(action.guide).toLowerCase());
        if (existing) addToGuide(existing.id, action.place);
        else createGuide(String(action.guide), action.place);
        step(`Added ${action.place.name} to “${action.guide}”`);
        return;
      }
      default:
        return;
    }
  };

  /** Sends one message to the map agent and streams its progress. Real steps
   * (tool calls, actions) appear as they happen; Stop aborts the request. */
  const runAgent = async (text: string) => {
    const message = text.trim();
    if (!message || agentAbortRef.current) return;
    const stamp = Date.now();
    const assistantId = `a-${stamp}`;
    setAgentTurns((ts) => [...ts, { id: `u-${stamp}`, role: "user", text: message }, { id: assistantId, role: "assistant", pending: true, steps: [] }]);
    const patch = (fn: (t: MapsAgentTurn) => MapsAgentTurn) => setAgentTurns((ts) => ts.map((t) => (t.id === assistantId ? fn(t) : t)));

    const ac = new AbortController();
    agentAbortRef.current = ac;
    setAgentBusy(true);
    setAgentStatus("Thinking…");
    const live = liveRef.current;
    const b = map()?.getBounds();
    const context = {
      center: centerRef.current,
      userLocation: realPositionRef.current ?? undefined,
      visibleBounds: b ? [[b.getWest(), b.getSouth()], [b.getEast(), b.getNorth()]] : undefined,
      selectedPlace: live.selectedPlace ?? undefined,
      selectedPoint: live.selectedPlace?.coordinates,
      activeRoute: live.route ?? undefined,
      shownPlaces: live.places.length ? live.places : live.nearby,
      mode: live.mode,
    };

    try {
      const res = await fetch("/api/maps/agent-stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, context }),
        signal: ac.signal,
      });
      if (!res.ok || !res.body) throw new Error("Ask Clyra isn't available right now.");
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let nl = buffer.indexOf("\n");
        while (nl >= 0) {
          const line = buffer.slice(0, nl).trim();
          buffer = buffer.slice(nl + 1);
          nl = buffer.indexOf("\n");
          if (!line) continue;
          const event = JSON.parse(line) as AgentEvent;
          if (event.type === "status") setAgentStatus(event.label);
          else if (event.type === "tool") patch((t) => ({ ...t, steps: [...(t.steps ?? []), { kind: "tool" as const, name: event.name, ok: event.ok, summary: event.summary }] }));
          else if (event.type === "actions") for (const action of event.actions) applyAgentAction(action, patch);
          else if (event.type === "final") patch((t) => ({ ...t, text: event.reply }));
          else if (event.type === "error") patch((t) => ({ ...t, error: event.message }));
        }
      }
    } catch (err) {
      if (ac.signal.aborted) patch((t) => ({ ...t, stopped: true }));
      else patch((t) => ({ ...t, error: err instanceof Error ? err.message : "Something went wrong." }));
    } finally {
      agentAbortRef.current = null;
      setAgentBusy(false);
      setAgentStatus("");
      patch((t) => ({ ...t, pending: false }));
    }
  };

  /** Plain place search (Enter on a place name): a ranked results list on the map. */
  const submitSearch = useCallback(
    async (text: string) => {
      setThinking(true);
      setThinkingLabel(`Searching for “${text}”…`);
      try {
        const list = await fetchSuggestions(text);
        if (list.length === 1) {
          selectPlace(list[0]);
        } else if (list.length > 1) {
          setSelectedPlace(null);
          activeCategoryRef.current = null;
          showPlacesOnMap(list, `Results for “${text}”`);
        } else {
          void runAgent(text);
        }
      } catch {
        void runAgent(text);
      } finally {
        setThinking(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selectPlace, showPlacesOnMap, fetchSuggestions],
  );

  /** Top search bar: whatever is typed opens Ask Clyra and runs the agent. */
  const submitFromSearch = (text: string) => {
    void runAgent(text);
  };

  /* ------------------------------- navigation/GO ------------------------------- */
  const stopPolling = () => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = null;
  };

  const handleStop = useCallback(() => {
    stopPolling();
    if (watchRef.current != null) { navigator.geolocation?.clearWatch(watchRef.current); watchRef.current = null; }
    liveCleanupRef.current();
    liveCleanupRef.current = () => undefined;
    setLiveFix(null);
    controller()?.stopFlyover();
    flightRef.current = null;
    navActiveRef.current = false;
    setNavActive(false);
    setSimState(null);
    const ctrl = controller();
    // Back to the idle "you are here" dot at the real position, not a blank map.
    if (realPositionRef.current) ctrl?.setDotPosition(realPositionRef.current);
    else ctrl?.clearDot();
    ctrl?.setProgress(null, 0);
    if (route) ctrl?.fitToBounds(overviewBoundsOf(route.geometry), ROUTE_PADDING);
  }, [controller, route]);

  handleStopRef.current = handleStop;

  /** Fly route: a cinematic flight along the route, no voice. See maps/routeFlyover.ts for how the camera behaves. */
  const startFlight = useCallback(() => {
    setNavKind("fly");
    const activeRoute = route;
    const ctrl = controller();
    if (!activeRoute || !ctrl) return;
    navActiveRef.current = true;
    setNavActive(true);
    ctrl.stopFlyover();
    ctrl.setRouteLabels(null, []);
    setFlying(false);
    flightRef.current = { progress: 0, speed: 0, phase: "cruise", paused: false, scale: 1 };
    let lastPush = 0;
    const push = (info: { progress: number; speed: number; phase: "cruise" | "hold" | "turn" }) => {
      const f = flightRef.current;
      if (!f) return;
      f.progress = info.progress;
      f.speed = info.speed;
      f.phase = info.phase;
      const now = performance.now();
      if (now - lastPush < 250) return;
      lastPush = now;
      const remaining = Math.max(0, activeRoute.distanceMeters - info.progress);
      setSimState({
        routeId: activeRoute.id,
        status: f.paused ? "paused" : "driving",
        progressMeters: info.progress,
        progressRatio: info.progress / Math.max(1, activeRoute.distanceMeters),
        currentCoordinate: activeRoute.geometry[0],
        bearing: 0,
        currentStepIndex: 0,
        nextStepIndex: 0,
        remainingDistanceMeters: remaining,
        remainingDurationSeconds: (remaining / Math.max(1, activeRoute.distanceMeters)) * activeRoute.durationSeconds,
        simulationSpeed: f.scale,
      } as SimulationState);
    };
    ctrl.startRouteFlyover(activeRoute, () => {
      // arrived: settle the camera high above the destination, then hand the map back
      map()?.easeTo({ pitch: 0, zoom: 16, duration: 1400, essential: true });
      window.setTimeout(handleStop, 1500);
    }, push);
  }, [route, map, controller, handleStop]);

  /** Go: real navigation. The blue dot is your position from the device's GPS, snapped to the route; the camera
   * follows your heading; leaving the route for more than a few seconds finds a new one from where you are. */
  const handleGo = useCallback(() => {
    const activeRoute = route;
    const ctrl = controller();
    if (!activeRoute || !ctrl) return;
    if (!navigator.geolocation) { setLocationHint("This device can't share its location, so live navigation isn't available. Try Fly route."); return; }
    setNavKind("live");
    navActiveRef.current = true;
    setNavActive(true);
    ctrl.stopFlyover();
    ctrl.setRouteLabels(null, []);
    setFlying(false);
    setLiveFix({ accuracy: 0, waiting: true });

    let current = activeRoute;
    let path = new RouteInterpolator(current);
    const camera = new NavigationCameraController(path.at(0).bearing);
    let progress = 0;
    let lastFix: { at: number; coord: [number, number] } | null = null;
    let offCount = 0;
    let rerouting = false;
    let lastPush = 0;

    let gotFix = false;
    const onFix = (fix: { lon: number; lat: number; accuracy: number; heading: number | null; speed: number | null; timestamp: number }) => {
      gotFix = true;
      if (routeRef.current && routeRef.current.id !== current.id) {
        // a new route arrived (we rerouted, or the user switched): follow that one
        current = routeRef.current;
        path = new RouteInterpolator(current);
        progress = 0;
        rerouting = false;
        offCount = 0;
      }
      if (fix.accuracy > 120) { setLiveFix({ accuracy: Math.round(fix.accuracy), waiting: true }); return; }
      const here: [number, number] = [fix.lon, fix.lat];
      realPositionRef.current = here;
      const snap = path.nearestProgress(here);
      const onRoute = snap.offsetMeters < Math.max(45, fix.accuracy * 1.5);
      // never jump backwards by more than a GPS wobble, so the line behind you stays drawn
      if (onRoute) { offCount = 0; if (snap.distanceMeters > progress - 25) progress = Math.max(progress, snap.distanceMeters); }
      else offCount += 1;

      const at = path.at(progress);
      const shown = onRoute ? at.coordinate : here;
      const heading = Number.isFinite(fix.heading) && (fix.speed ?? 0) > 1 ? (fix.heading as number) : at.bearing;
      ctrl.setDotPosition(shown, heading);
      ctrl.setProgress(current, progress);

      const speed = Math.max(0, fix.speed ?? (lastFix ? 0 : 0));
      const step = current.steps.find((st) => (current.cumulativeDistances[st.geometryStartIndex] ?? 0) > progress + 1);
      ctrl.applyCameraFrame(camera.frame({
        position: shown,
        heading,
        progressMeters: progress,
        interpolator: path,
        metersPerSecond: Math.max(speed, 6),
        distanceToNextManeuver: step ? (current.cumulativeDistances[step.geometryStartIndex] ?? 0) - progress : undefined,
      }));
      lastFix = { at: fix.timestamp, coord: here };

      const remaining = Math.max(0, current.distanceMeters - progress);
      const now = performance.now();
      if (now - lastPush > 400) {
        lastPush = now;
        setLiveFix({ accuracy: Math.round(fix.accuracy), waiting: false });
        setSimState({
          routeId: current.id, status: "driving", progressMeters: progress, progressRatio: progress / Math.max(1, current.distanceMeters),
          currentCoordinate: shown, bearing: heading, currentStepIndex: 0, nextStepIndex: 0,
          remainingDistanceMeters: remaining,
          remainingDurationSeconds: (remaining / Math.max(1, current.distanceMeters)) * current.durationSeconds,
          simulationSpeed: 1,
        } as SimulationState);
        flightRef.current = { progress, speed, phase: "cruise", paused: false, scale: 1 };
      }
      if (remaining < 25) {
        setLocationHint("You've arrived");
        window.setTimeout(() => { handleStopRef.current(); window.setTimeout(() => setLocationHint(null), 4000); }, 1200);
        return;
      }
      if (!onRoute && offCount >= 3 && !rerouting && destRef.current) {
        rerouting = true;
        setLocationHint("Off route — finding a new one…");
        void loadRouteFor(destRef.current, {});
      }
    };
    const giveUp = (why: string) => {
      console.warn("[maps] live navigation has no location", why);
      handleStopRef.current();
      setLocationHint(why);
      window.setTimeout(() => setLocationHint(null), 9000);
    };
    // the camera comes down to the road while the first fix arrives
    map()?.easeTo({ pitch: 55, zoom: 16.5, duration: 900, essential: true });
    // Two sources, whichever answers: the browser's own GPS/Wi-Fi fixes, and in the desktop app macOS Location
    // Services directly (the browser API often receives nothing in a desktop build). A source failing is not fatal.
    let denied = false;
    watchRef.current = navigator.geolocation.watchPosition(
      (pos) => onFix({ lon: pos.coords.longitude, lat: pos.coords.latitude, accuracy: pos.coords.accuracy, heading: pos.coords.heading, speed: pos.coords.speed, timestamp: pos.timestamp }),
      (err) => { if (err.code === err.PERMISSION_DENIED) denied = true; },
      { enableHighAccuracy: true, maximumAge: 1000, timeout: 20000 },
    );
    const nativeLocation = getElectronDesktop()?.location;
    const nativePoll = nativeLocation
      ? window.setInterval(() => {
          void nativeLocation.get({ timeoutSeconds: 3 }).then((r) => {
            if (r?.ok && typeof r.lat === "number" && typeof r.lon === "number") onFix({ lon: r.lon, lat: r.lat, accuracy: typeof (r as { accuracy?: number }).accuracy === "number" ? (r as { accuracy?: number }).accuracy! : 20, heading: null, speed: null, timestamp: Date.now() });
            else if (r?.error === "denied") denied = true;
          }).catch(() => undefined);
        }, 3000)
      : null;
    const noFixTimer = window.setTimeout(() => {
      if (!gotFix && navActiveRef.current) giveUp(denied ? "Location is turned off for Clyra. Allow it in your system settings to navigate, or use Fly route." : "Couldn't get a location fix. Check Location Services, or use Fly route.");
    }, 20_000);
    const clearLive = () => { if (nativePoll != null) window.clearInterval(nativePoll); window.clearTimeout(noFixTimer); };
    liveCleanupRef.current = clearLive;
  }, [route, map, controller, loadRouteFor]);

  const handleTogglePause = useCallback(() => {
    const f = flightRef.current;
    if (!f) return;
    f.paused = !f.paused;
    controller()?.pauseRouteFlyover(f.paused);
    setSimState((prev) => (prev ? { ...prev, status: f.paused ? "paused" : "driving" } : prev));
  }, [controller]);

  const clearRoute = useCallback(() => {
    setRoute(null);
    setAlternatives([]);
    setDestinationName("");
    setTransit(null);
    resetStops();
    controller()?.setTransit(null);
    controller()?.setRoute(null);
    controller()?.setAlternativeRoutes([]);
  }, [controller, resetStops]);

  useEffect(() => () => stopPolling(), []);

  const fetchAlongRoute = useCallback(async (category: string): Promise<ClyraPlace[]> => {
    if (!route) return [];
    try {
      return (await postJson<{ places: ClyraPlace[] }>("/api/maps/along-route", { route, category, limit: 6 })).places ?? [];
    } catch {
      return [];
    }
  }, [route]);

  const changeStops = useCallback(
    (next: ClyraPlace[]) => {
      stopsRef.current = next;
      setStops(next);
      const dest = destRef.current;
      if (dest) void loadRouteFor(dest, { stops: next });
    },
    [loadRouteFor],
  );

  const handleDownload = useCallback(async () => {
    const m = map();
    if (!m || downloadLabel) return;
    const b = m.getBounds();
    setDownloadLabel("0%");
    try {
      // Like a city download: at least ~20 km square around the view, not just what is on screen.
      const c0 = m.getCenter();
      const half = 0.09;
      const bounds: [Coordinate, Coordinate] = [
        [Math.min(b.getWest(), c0.lng - half), Math.min(b.getSouth(), c0.lat - half)],
        [Math.max(b.getEast(), c0.lng + half), Math.max(b.getNorth(), c0.lat + half)],
      ];
      const result = await downloadArea(bounds, (done, total) => setDownloadLabel(`${Math.round((done / total) * 100)}%`));
      const c = m.getCenter();
      saveArea({ id: `area-${Date.now().toString(36)}`, name: `Area near ${c.lat.toFixed(2)}, ${c.lng.toFixed(2)}`, bounds, tiles: result.total, savedAt: Date.now() });
      setDownloadLabel("Saved");
    } catch {
      setDownloadLabel("Failed");
    }
    window.setTimeout(() => setDownloadLabel(null), 2200);
  }, [downloadLabel, map]);

  const toggleFlyover = useCallback(() => {
    const ctrl = controller();
    if (!ctrl) return;
    if (ctrl.flying) {
      ctrl.stopFlyover();
      setFlying(false);
      return;
    }
    // With a route on the map the flight follows it; otherwise it slowly circles the place or view.
    if (route && route.geometry.length > 1) {
      ctrl.startRouteFlyover(route, () => setFlying(false));
      setFlying(true);
      return;
    }
    const c = map()?.getCenter();
    const here: Coordinate = c ? [c.lng, c.lat] : centerRef.current;
    ctrl.startFlyover(selectedPlace?.coordinates ?? here, () => setFlying(false));
    setFlying(true);
  }, [controller, map, selectedPlace, route]);

  const handleLookAround = useCallback(() => {
    const c = map()?.getCenter();
    const here: Coordinate = c ? [c.lng, c.lat] : centerRef.current;
    setLookAround({ coordinates: selectedPlace?.coordinates ?? here, title: selectedPlace?.name });
  }, [map, selectedPlace]);

  // Re-derived on every render, which the 300ms simulation poll keeps fresh.
  const upcoming = (() => {
    if (!navActive || !route) return undefined;
    const progress = flightRef.current?.progress ?? 0;
    const step = route.steps.find((st) => (route.cumulativeDistances[st.geometryStartIndex] ?? 0) > progress + 1);
    return step ? { step, distanceMeters: Math.max(0, (route.cumulativeDistances[step.geometryStartIndex] ?? 0) - progress) } : undefined;
  })();
  // The left column hosts one card at a time: a place, or a route overview.
  const sidebarOpen = !navActive && (Boolean(selectedPlace) || Boolean(route || transit) || places.length > 0);
  const leftPanelOpen = !navActive && (Boolean(selectedPlace) || Boolean((route || transit) && !selectedPlace));

  return (
    <div className="mx-root relative h-full w-full overflow-hidden bg-[#eef0f3]" data-flying={flying} data-search={searchOpen}>
      {initialCenter ? (
        <MapView
          ref={mapViewRef}
          initialCenter={initialCenter}
          initialZoom={13.2}
          onReady={() => setMapReady(true)}
          onUserMove={() => setUserMoved(true)}
          onClick={(c, hint) => {
            void handleMapClick(c, hint);
          }}
          onMoveEnd={(c) => {
            centerRef.current = c;
            try {
              localStorage.setItem(LAST_CENTER_KEY, JSON.stringify(c));
            } catch {
              // Storage unavailable: next launch waits for a location fix instead.
            }
          }}
        />
      ) : (
        <div className="absolute inset-0 grid place-items-center bg-[radial-gradient(circle_at_50%_30%,#ffffff_0%,#f1f5f9_62%,#e7edf5_100%)]">
          <div className="flex items-center gap-2 rounded-full border border-slate-200/80 bg-white/85 px-3 py-2 text-[12px] font-medium text-slate-500 shadow-sm" aria-live="polite">
            <span className="h-2 w-2 animate-pulse rounded-full bg-[#3b82f6]" />
            Finding your location…
          </div>
        </div>
      )}

      {!navActive && mapReady ? (
        <MapControls
          getMap={map}
          basemap={basemap}
          onBasemap={(b) => {
            setBasemapState(b);
            controller()?.setBasemap(b);
          }}
          onLocate={handleLocate}
          locating={locating}
          onLookAround={handleLookAround}
          onDownload={() => void handleDownload()}
          downloadLabel={downloadLabel}
          flying={flying}
          rightInset={agentOpen ? 428 : 16}
          leftInset={sidebarOpen ? 396 : 0}
          onFlyover={toggleFlyover}
        />
      ) : null}

      {!navActive && !selectedPlace && !route && places.length === 0 ? <MapsHome onSelect={focusPlace} /> : null}

      {!navActive ? (
        <>
          <MapsComposer
            onOpenChange={setSearchOpen}
            onSubmit={submitFromSearch}
            onSearch={(t) => void submitSearch(t)}
            onSuggestionPick={focusPlace}
            fetchSuggestions={fetchSuggestions}
            thinking={thinking}
            thinkingLabel={thinkingLabel}
          />

          <div className="clyra-maps-chips pointer-events-auto absolute left-[412px] right-[72px] top-[19px] z-20 flex gap-2 overflow-x-auto px-1 py-1 [scrollbar-width:none] max-md:hidden">
            {CATEGORY_CHIPS.map((chip) => {
              const Icon = CATEGORY_ICONS[chip.id];
              return (
                <button key={chip.id} type="button" onClick={() => handleCategoryClick(chip.id, chip.label)} data-on={activeCategory === chip.id} className="mx-chip">
                  {Icon ? <Icon /> : null}
                  {chip.label}
                </button>
              );
            })}
          </div>
        </>
      ) : null}

      {!navActive && !selectedPlace && userMoved && activeCategoryRef.current && places.length > 0 ? (
        <button
          type="button"
          onClick={() => {
            const c = activeCategoryRef.current;
            if (c) void handleCategoryClick(c.id, c.label);
          }}
          className="mx-chip absolute left-[calc(50%+204px)] top-[72px] z-30 -translate-x-1/2 !text-[#0052cc]"
        >
          Search this area
        </button>
      ) : null}

      <AnimatePresence>
        {!navActive && !selectedPlace && places.length > 0 ? (
          <PlaceResultsList
            key="results"
            places={places}
            hoveredId={hoveredId}
            onHover={setHoveredId}
            onHoverPrefetch={prefetchPlaceDetail}
            onSelect={focusPlace}
            title={resultsTitle}
          />
        ) : null}
      </AnimatePresence>

      <AnimatePresence>
        {!navActive && selectedPlace ? (
          <PlaceDetailSheet
            key="place-detail"
            place={selectedPlace}
            identifying={identifying}
            nearby={nearby}
            route={route && !routeLoading ? route : null}
            routeLoading={routeLoading}
            onClose={closeSelection}
            onStart={handleGo}
            onDirections={(p) => void computeRoute(p)}
            onSelectNearby={focusPlace}
            onNearby={(p) => {
              void runAgent(`What's worth visiting or eating within a short walk of ${p.name}?`);
            }}
            onAskClyra={(p) => {
              void runAgent(`Tell me about ${p.name}: what it is, whether it's open now and its hours, what people say about it, and whether it's worth going.`);
            }}
          />
        ) : null}
      </AnimatePresence>

      {!navActive ? (
        <MapsAgentPanel
          open={agentOpen}
          onOpen={() => setAgentOpen(true)}
          onClose={() => setAgentOpen(false)}
          turns={agentTurns}
          busy={agentBusy}
          status={agentStatus}
          onSend={(t) => void runAgent(t)}
          onStop={() => agentAbortRef.current?.abort()}
          onSelectPlace={focusPlace}
          onHoverPlace={prefetchPlaceDetail}
          selectedName={selectedPlace?.name}
          hasRoute={Boolean(route)}
        />
      ) : null}

      <AnimatePresence>
        {!navActive && (route || transit) && !selectedPlace ? (
          <RouteOverviewPanel
            key="route-overview"
            destinationName={destinationName}
            route={route}
            alternatives={alternatives}
            activeMode={mode}
            transit={transit}
            transitWhen={transitWhen}
            onTransitWhen={(w) => {
              transitWhenRef.current = w;
              setTransitWhen(w);
              const dest = destRef.current;
              if (dest && (w.kind === "now" || w.time)) void loadRouteFor(dest, { mode: "transit" });
            }}
            stops={stops}
            originCoordinates={realPositionRef.current ?? centerRef.current}
            destinationCoordinates={destRef.current?.coordinates}
            fetchSuggestions={fetchSuggestions}
            fetchAlongRoute={fetchAlongRoute}
            onAddStop={(p) => changeStops([...stopsRef.current, p])}
            onRemoveStop={(i) => changeStops(stopsRef.current.filter((_, idx) => idx !== i))}
            onPlanWithClyra={() => {
              void runAgent(`Plan a great trip to ${destinationName || "this destination"}: suggest worthwhile stops on the way, add them with plan_trip in a sensible order, and tell me opening hours that could clash.`);
            }}
            onMoveStop={(i, delta) => {
              const next = [...stopsRef.current];
              const to = i + delta;
              if (to < 0 || to >= next.length) return;
              [next[i], next[to]] = [next[to], next[i]];
              changeStops(next);
            }}
            onSelectItinerary={(id) => {
              setTransit((t) => (t ? { ...t, selectedId: id } : t));
              const it = transit?.itineraries.find((x) => x.id === id);
              if (it) {
                controller()?.setTransit(it.legs);
                controller()?.fitToBounds(overviewBoundsOf(it.legs.flatMap((l) => l.geometry)), ROUTE_PADDING);
              }
            }}
            onModeChange={(m2) => {
              setMode(m2);
              writePrefs({ ...readPrefs(), mode: m2 });
              const dest = destRef.current;
              if (dest) void computeRoute(dest, m2, true);
            }}
            onSelectAlternative={(alt) => {
              setRoute(alt);
              controller()?.setRoute(alt);
              const others = alternatives.filter((r) => r.id !== alt.id);
              controller()?.setAlternativeRoutes(others);
              controller()?.setRouteLabels(alt, others);
            }}
            onGo={handleGo}
            onFly={startFlight}
            onClose={clearRoute}
          />
        ) : null}
      </AnimatePresence>

      {!navActive && (locationStatus === "approximate" || locationHint) ? (
        <motion.button
          type="button"
          onClick={handleLocate}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
          className="pointer-events-auto absolute bottom-[92px] right-[64px] z-30 flex max-w-[300px] items-center gap-2 rounded-full bg-white/92 py-1.5 pl-2.5 pr-3.5 text-left text-[12px] font-medium text-[#3c4043] shadow-[0_2px_10px_rgba(15,23,42,.16)] ring-1 ring-black/[0.06] backdrop-blur-xl transition-transform active:scale-[0.98]"
        >
          <span className={locating ? "h-2 w-2 shrink-0 animate-pulse rounded-full bg-[#1a73e8]" : "h-2 w-2 shrink-0 rounded-full bg-[#f9ab00]"} aria-hidden />
          <span className="truncate">{locationHint ?? (locating ? "Finding your precise location…" : "Approximate location · Use precise")}</span>
        </motion.button>
      ) : null}

      {lookAround ? <LookAroundViewer coordinates={lookAround.coordinates} title={lookAround.title} onClose={() => setLookAround(null)} /> : null}

      {navActive ? (
        <NavigationHud
          upcomingStep={upcoming?.step}
          upcomingDistanceMeters={upcoming?.distanceMeters}
          remainingDistanceMeters={simState?.remainingDistanceMeters ?? route?.distanceMeters ?? 0}
          remainingDurationSeconds={simState?.remainingDurationSeconds ?? route?.durationSeconds ?? 0}
          paused={simState?.status === "paused"}
          speed={simState?.simulationSpeed ?? 1}
          live={navKind === "live"}
          liveStatus={navKind === "live" ? (liveFix?.waiting ? (liveFix.accuracy ? `Improving accuracy · ±${liveFix.accuracy} m` : "Finding your location…") : liveFix ? `GPS · ±${liveFix.accuracy} m` : undefined) : undefined}
          onTogglePause={handleTogglePause}
          onStop={handleStop}
          onSpeedChange={(sp) => { if (flightRef.current) flightRef.current.scale = sp; controller()?.setRouteFlyoverSpeed(sp); }}
/>
      ) : null}
    </div>
  );
}
