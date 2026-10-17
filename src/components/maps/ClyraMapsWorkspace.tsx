import { AnimatePresence } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { MapView, type MapViewHandle } from "../../maps/MapView";
import { MapsComposer } from "./MapsComposer";
import { PlaceResultsList } from "./PlaceResultsList";
import { PlaceDetailSheet } from "./PlaceDetailSheet";
import { RouteOverviewPanel, type TransitState, type TransitWhen } from "./RouteOverviewPanel";
import { LookAroundViewer } from "./LookAroundViewer";
import { VoiceGuide } from "../../navigation/VoiceGuide";
import { downloadArea, saveArea } from "../../maps/offline";
import type { TransitItinerary } from "../../../lib/maps/transit";
import { NavigationHud } from "./NavigationHud";
import { MapsAgentPanel, type ComparisonRow, type MapsAgentTurn } from "./MapsAgentPanel";
import { MapControls } from "./MapControls";
import { MapsHome, pushRecent } from "./MapsHome";
import type { Basemap } from "../../maps/MapController";
import { CATEGORY_CHIPS } from "./mapsIcons";
import { prefetchPlaceDetail } from "./placeDetailCache";
import { NavigationSimulationEngine, type SimulationState } from "../../navigation/NavigationSimulationEngine";
import { NavigationCameraController, overviewBoundsOf } from "../../navigation/NavigationCameraController";
import { bearingBetween } from "../../navigation/RouteInterpolator";
import type { ClyraPlace, Coordinate, Route, TravelMode } from "../../../lib/maps/types";

/** Space the left place/route panel takes, so fitted routes stay fully visible. */
const ROUTE_PADDING = { top: 96, bottom: 40, left: 440, right: 40 };
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
  | { type: "set_route"; route: Route; destinationName: string }
  | { type: "fit_results" }
  | { type: "clear_results" }
  | { type: "zoom"; delta: 1 | -1 }
  | { type: "show_comparison"; rows: ComparisonRow[] }
  | { type: "save_preference"; key: "travel_mode" | "avoid_tolls"; value: string | boolean };

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
  const [alternatives, setAlternatives] = useState<Route[]>([]);
  const [destinationName, setDestinationName] = useState("");
  const [mode, setMode] = useState<TravelMode>(() => readPrefs().mode ?? "drive");

  const [thinking, setThinking] = useState(false);
  const [thinkingLabel, setThinkingLabel] = useState(THINKING_LABELS[0]);

  const [navActive, setNavActive] = useState(false);
  const navActiveRef = useRef(false);
  const [simState, setSimState] = useState<SimulationState | null>(null);
  const engineRef = useRef<NavigationSimulationEngine | null>(null);
  const cameraRef = useRef<NavigationCameraController | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [transit, setTransit] = useState<TransitState | null>(null);
  const [transitWhen, setTransitWhen] = useState<TransitWhen>({ kind: "now" });
  const transitWhenRef = useRef<TransitWhen>({ kind: "now" });
  const [stops, setStops] = useState<ClyraPlace[]>([]);
  const stopsRef = useRef<ClyraPlace[]>([]);
  const destRef = useRef<{ name: string; coordinates: Coordinate } | null>(null);
  const voiceRef = useRef<VoiceGuide | null>(null);
  const [muted, setMuted] = useState(false);
  const [flying, setFlying] = useState(false);
  const [lookAround, setLookAround] = useState<{ coordinates: Coordinate; title?: string } | null>(null);
  const [downloadLabel, setDownloadLabel] = useState<string | null>(null);
  const activeCategoryRef = useRef<{ id: string; label: string } | null>(null);
  const [userMoved, setUserMoved] = useState(false);
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
    const onFix = (coord: Coordinate, source: "precise" | "approximate") => {
      if (cancelled || !validCoordinate(coord)) return;
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

  const handleLocate = useCallback(() => {
    const m = map();
    const go = (c: Coordinate) => {
      realPositionRef.current = c;
      controller()?.setDotPosition(c);
      m?.flyTo({ center: c, zoom: Math.max(m.getZoom(), 15.5), bearing: 0, duration: 900, essential: true });
    };
    if (realPositionRef.current) go(realPositionRef.current);
    setLocating(true);
    navigator.geolocation?.getCurrentPosition(
      (pos) => {
        setLocating(false);
        go([pos.coords.longitude, pos.coords.latitude]);
      },
      () => setLocating(false),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 15_000 },
    );
  }, [controller, map]);

  /* -------------------------------- data fetchers -------------------------------- */
  const fetchSuggestions = useCallback(async (query: string): Promise<ClyraPlace[]> => {
    try {
      const data = await postJson<{ places: ClyraPlace[] }>("/api/maps/search", {
        query,
        near: centerRef.current,
      });
      return data.places || [];
    } catch {
      return [];
    }
  }, []);

  const showPlacesOnMap = useCallback(
    (list: ClyraPlace[], title?: string) => {
      setPlaces(list);
      setResultsTitle(title);
      controller()?.setPois(list);
      if (list.length) {
        const lons = list.map((p) => p.coordinates[0]);
        const lats = list.map((p) => p.coordinates[1]);
        controller()?.fitToBounds([
          [Math.min(...lons), Math.min(...lats)],
          [Math.max(...lons), Math.max(...lats)],
        ]);
      }
    },
    [controller],
  );

  const handleCategoryClick = useCallback(
    async (categoryId: string, label: string) => {
      setThinking(true);
      setThinkingLabel(`Finding ${label.toLowerCase()}…`);
      try {
        const data = await postJson<{ places: ClyraPlace[] }>("/api/maps/nearby", {
          center: centerRef.current,
          category: categoryId,
        });
        showPlacesOnMap(data.places || [], label);
        activeCategoryRef.current = { id: categoryId, label };
        setUserMoved(false);
      } catch {
        showPlacesOnMap([], label);
      } finally {
        setThinking(false);
      }
    },
    [showPlacesOnMap],
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

  /** Any click on the map identifies what is there. The pin appears at once;
   * the card fills in when the identify service answers. */
  const handleMapClick = useCallback(
    async (coord: Coordinate) => {
      if (navActiveRef.current) return;
      const id = ++selectionRef.current;
      const pin: ClyraPlace = {
        id: `pin-${coord[1].toFixed(6)}-${coord[0].toFixed(6)}`,
        name: "Dropped pin",
        coordinates: coord,
        categories: [],
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
          setRoute(action.route);
          setAlternatives([action.route]);
          setDestinationName(action.destinationName ?? "");
          setSelectedPlace(null);
          setPlaces([]);
          controller()?.setPois([]);
          controller()?.setRoute(action.route);
          controller()?.setAlternativeRoutes([]);
          controller()?.fitToBounds(overviewBoundsOf(action.route.geometry), ROUTE_PADDING);
          step(`Drew route to ${action.destinationName || "destination"} · ${Math.round(action.route.durationSeconds / 60)} min · ${(action.route.distanceMeters / 1000).toFixed(1)} km`);
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

  /** Top search bar: whatever is typed opens Ask Clyra and runs the agent. */
  const submitFromSearch = (text: string) => {
    setAgentOpen(true);
    void runAgent(text);
  };

  /* ------------------------------- navigation/GO ------------------------------- */
  const stopPolling = () => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = null;
  };

  const handleGo = useCallback(() => {
    const activeRoute = route;
    const m = map();
    const ctrl = controller();
    if (!activeRoute || !m || !ctrl) return;

    const initialBearing = bearingBetween(activeRoute.geometry[0], activeRoute.geometry[1] || activeRoute.geometry[0]);
    navActiveRef.current = true;
    setNavActive(true);

    // Cinematic fly-in: overview -> approach start -> rotate to heading -> pitch in.
    m.flyTo({
      center: activeRoute.geometry[0],
      zoom: 17,
      pitch: 60,
      bearing: initialBearing,
      duration: 1600,
      curve: 1.35,
      essential: true,
    });

    controller()?.stopFlyover();
    controller()?.setRouteLabels(null, []);
    setFlying(false);
    voiceRef.current = new VoiceGuide();
    voiceRef.current.muted = muted;
    voiceRef.current.say("Starting route.");
    window.setTimeout(() => {
      const engine = new NavigationSimulationEngine(activeRoute);
      const camera = new NavigationCameraController(initialBearing);
      engineRef.current = engine;
      cameraRef.current = camera;

      // Raw, per-frame updates — mutate map sources directly, never React state.
      engine.subscribe((state) => {
        ctrl.setDotPosition(state.currentCoordinate, state.bearing);
        ctrl.setProgress(activeRoute, state.progressMeters);
        const next = engine.nextManeuver();
        voiceRef.current?.update(next?.step, next?.distanceMeters);
        const avgSpeed = (activeRoute.distanceMeters / Math.max(activeRoute.durationSeconds, 1)) * state.simulationSpeed;
        const frame = camera.frame({
          position: state.currentCoordinate,
          heading: state.bearing,
          progressMeters: state.progressMeters,
          interpolator: engine.getInterpolator(),
          metersPerSecond: avgSpeed,
          distanceToNextManeuver: next?.distanceMeters,
        });
        ctrl.applyCameraFrame(frame);
        if (state.status === "arrived") {
          stopPolling();
          setSimState(engine.getSnapshot());
          m.easeTo({ pitch: 0, zoom: 16, duration: 900 });
        }
      });

      pollRef.current = setInterval(() => {
        if (!engineRef.current) return;
        setSimState(engineRef.current.getSnapshot());
      }, 300);

      engine.start();
    }, 1650);
  }, [route, map, controller, muted]);

  const handleTogglePause = useCallback(() => {
    const engine = engineRef.current;
    if (!engine) return;
    const state = engine.getSnapshot();
    if (state.status === "driving") engine.pause();
    else if (state.status === "paused") engine.resume();
    setSimState(engine.getSnapshot());
  }, []);

  const handleStop = useCallback(() => {
    stopPolling();
    voiceRef.current?.stop();
    voiceRef.current = null;
    engineRef.current?.dispose();
    engineRef.current = null;
    cameraRef.current = null;
    navActiveRef.current = false;
    setNavActive(false);
    setSimState(null);
    const ctrl = controller();
    // Back to the idle "you are here" dot at the real position, not a blank map.
    if (realPositionRef.current) ctrl?.setDotPosition(realPositionRef.current);
    else ctrl?.clearDot();
    if (route) {
      ctrl?.setProgress(null, 0);
      ctrl?.fitToBounds(overviewBoundsOf(route.geometry), 90);
    }
  }, [controller, route]);

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
      const bounds: [Coordinate, Coordinate] = [[b.getWest(), b.getSouth()], [b.getEast(), b.getNorth()]];
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
    const c = map()?.getCenter();
    const here: Coordinate = c ? [c.lng, c.lat] : centerRef.current;
    ctrl.startFlyover(selectedPlace?.coordinates ?? here, () => setFlying(false));
    setFlying(true);
  }, [controller, map, selectedPlace]);

  const handleLookAround = useCallback(() => {
    const c = map()?.getCenter();
    const here: Coordinate = c ? [c.lng, c.lat] : centerRef.current;
    setLookAround({ coordinates: selectedPlace?.coordinates ?? here, title: selectedPlace?.name });
  }, [map, selectedPlace]);

  // Re-derived on every render, which the 300ms simulation poll keeps fresh.
  const upcoming = navActive ? engineRef.current?.nextManeuver() : undefined;
  // The left column hosts one card at a time: a place, or a route overview.
  const leftPanelOpen = !navActive && (Boolean(selectedPlace) || Boolean((route || transit) && !selectedPlace));

  return (
    <div className="relative h-full w-full overflow-hidden bg-slate-100">
      {initialCenter ? (
        <MapView
          ref={mapViewRef}
          initialCenter={initialCenter}
          initialZoom={13.2}
          onReady={() => setMapReady(true)}
          onUserMove={() => setUserMoved(true)}
          onClick={(c) => {
            void handleMapClick(c);
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
          <div className="flex items-center gap-2 rounded-full border border-slate-200/80 bg-white/85 px-3 py-2 text-[12px] font-medium text-slate-500 shadow-sm backdrop-blur-md" aria-live="polite">
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
          onFlyover={toggleFlyover}
        />
      ) : null}

      {!navActive && !selectedPlace && !route && places.length === 0 ? <MapsHome onSelect={focusPlace} /> : null}

      {!navActive ? (
        <>
          <MapsComposer
            onSubmit={submitFromSearch}
            onSuggestionPick={focusPlace}
            fetchSuggestions={fetchSuggestions}
            thinking={thinking}
            thinkingLabel={thinkingLabel}
          />

          <div
            className={
              "pointer-events-auto absolute left-1/2 top-[76px] z-20 flex w-[min(560px,92vw)] -translate-x-1/2 gap-1.5 overflow-x-auto pb-1 [scrollbar-width:none] " +
              (leftPanelOpen ? "invisible" : "")
            }
          >
            {CATEGORY_CHIPS.map((chip) => (
              <button
                key={chip.id}
                type="button"
                onClick={() => handleCategoryClick(chip.id, chip.label)}
                className="shrink-0 rounded-full border border-slate-200/90 bg-white/90 px-3 py-1.5 text-[12px] font-semibold text-slate-600 shadow-sm backdrop-blur-md transition-colors hover:bg-white hover:text-slate-900"
              >
                {chip.label}
              </button>
            ))}
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
          className="pointer-events-auto absolute left-1/2 top-[118px] z-30 -translate-x-1/2 rounded-full border border-slate-200 bg-white px-4 py-2 text-[13px] font-semibold text-[#2563eb] shadow-[0_6px_20px_rgba(15,23,42,.18)] hover:bg-slate-50"
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
            onAskClyra={(p) => {
              setAgentOpen(true);
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
            onClose={clearRoute}
          />
        ) : null}
      </AnimatePresence>

      {lookAround ? <LookAroundViewer coordinates={lookAround.coordinates} title={lookAround.title} onClose={() => setLookAround(null)} /> : null}

      {navActive ? (
        <NavigationHud
          upcomingStep={upcoming?.step}
          upcomingDistanceMeters={upcoming?.distanceMeters}
          remainingDistanceMeters={simState?.remainingDistanceMeters ?? route?.distanceMeters ?? 0}
          remainingDurationSeconds={simState?.remainingDurationSeconds ?? route?.durationSeconds ?? 0}
          paused={simState?.status === "paused"}
          speed={simState?.simulationSpeed ?? 1}
          onTogglePause={handleTogglePause}
          onStop={handleStop}
          onSpeedChange={(s) => engineRef.current?.setSpeed(s)}
          muted={muted}
          onToggleMute={() => {
            const next = !muted;
            setMuted(next);
            if (voiceRef.current) voiceRef.current.muted = next;
            if (next) window.speechSynthesis?.cancel();
          }}
        />
      ) : null}
    </div>
  );
}
