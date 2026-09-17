import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Bookmark, Clock3, Command, Crosshair, Layers3, LocateFixed, Map, MapPin, Navigation, Plane, Route, Search, Settings2, Sparkles, X } from "lucide-react";
import {
  EARTH_BRIDGE_ORIGIN_MARK,
  earthBridgeOrigin,
  readEarthEvent,
  type EarthBridgeMessage,
} from "./bridge";

/**
 * Clyra Earth — the vendored God's Eye View application running as Clyra's
 * geospatial workspace.
 *
 * The globe itself is the upstream document, framed from its own loopback host
 * (see tools/earth-server.mjs). That keeps God's Eye View's HUD, panels, camera
 * behaviour, sensor modes and entity interactions exactly as its author built
 * them — the brief's "visual source of truth" rule — while Clyra owns only the
 * surfaces around it: Clyra's existing command bar, which remains the single
 * natural-language entry point for the Earth workspace.
 */

interface EarthStartResponse {
  ok: boolean;
  url: string | null;
  mode: "dev" | "static" | null;
  reason?: string;
}

type ParentLocation = {
  lat: number;
  lon: number;
  accuracyM?: number;
  /** Browser heading is optional and only forwarded when the device supplied it. */
  heading?: number;
  timestamp: number;
  label?: string;
  source?: "device" | "saved";
};

type EarthDirections = {
  originLabel: string;
  destinationLabel: string;
  distanceM: number;
  durationS: number;
  mode: string;
  steps: Array<{ instruction: string; distanceM?: number }>;
  navigation?: {
    state: "flying" | "arrived";
    remainingM: number;
    distanceToManeuverM: number;
    stepIndex: number;
    instruction?: string;
  };
};

type EarthSuggestion = {
  query: string;
  places: Array<{ label: string; detail?: string }>;
  pending?: boolean;
};

// Desktop browsers can return a coarse IP/Wi-Fi fix while a precise fix is
// still being acquired. A road route from a kilometre-wide estimate is worse
// than an actionable request to enable Precise Location, so only hand Earth a
// sample that is useful for driving directions.
const PREFERRED_LOCATION_ACCURACY_M = 60;
const MAX_ROUTE_LOCATION_ACCURACY_M = 250;
const LOCATION_SAMPLE_WINDOW_MS = 5_500;
const LOCATION_TIMEOUT_MS = 12_000;
const EARTH_LOCATION_PREFERENCE_KEY = "clyra-earth-current-location-v1";
const EARTH_PREWARM_COMPLETE_EVENT = "clyra-earth-visible";

// This is the account holder's explicitly supplied current-location pin. It
// is stored locally on first use and can later be replaced through the Earth
// command bar; it is never presented as a GPS measurement.
const INITIAL_LOCATION_PREFERENCE = Object.freeze({
  lat: -33.6630602,
  lon: 151.1021935,
  label: "Hornsby Heights, NSW",
});

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function formatLocationAccuracy(accuracyM: number | undefined) {
  if (!Number.isFinite(accuracyM) || !accuracyM || accuracyM < 0) return "unknown accuracy";
  return accuracyM >= 1_000 ? `±${(accuracyM / 1_000).toFixed(1)} km` : `±${Math.round(accuracyM)} m`;
}

function validLocationCoordinates(lat: unknown, lon: unknown) {
  return Number.isFinite(Number(lat))
    && Number.isFinite(Number(lon))
    && Math.abs(Number(lat)) <= 90
    && Math.abs(Number(lon)) <= 180;
}

function readLocationPreference(): ParentLocation | null {
  try {
    const stored = asRecord(JSON.parse(localStorage.getItem(EARTH_LOCATION_PREFERENCE_KEY) || "null"));
    // A device-mode preference is intentionally not a coordinate. It exists
    // so Clyra can fall back to the browser permission flow when a person opts
    // out of their saved pin later.
    if (stored?.mode === "device") return null;
    const candidate = stored && validLocationCoordinates(stored.lat, stored.lon) && typeof stored.label === "string"
      ? { lat: Number(stored.lat), lon: Number(stored.lon), label: stored.label.trim() }
      : INITIAL_LOCATION_PREFERENCE;
    if (!candidate.label) return null;
    if (!stored) localStorage.setItem(EARTH_LOCATION_PREFERENCE_KEY, JSON.stringify(candidate));
    return { ...candidate, timestamp: Date.now(), source: "saved" };
  } catch {
    return { ...INITIAL_LOCATION_PREFERENCE, timestamp: Date.now(), source: "saved" };
  }
}

function saveLocationPreference(location: ParentLocation) {
  if (!validLocationCoordinates(location.lat, location.lon) || !location.label?.trim()) return;
  try {
    localStorage.setItem(EARTH_LOCATION_PREFERENCE_KEY, JSON.stringify({
      lat: location.lat,
      lon: location.lon,
      label: location.label.trim(),
    }));
  } catch {
    // Storage can be unavailable in a private browser. The active session
    // still has the resolved location, so do not turn that into an error.
  }
}

function readLocationPreferenceUpdate(data: unknown): ParentLocation | null {
  const value = asRecord(asRecord(data)?.currentLocation);
  if (!value || !validLocationCoordinates(value.lat, value.lon) || typeof value.label !== "string" || !value.label.trim()) return null;
  return {
    lat: Number(value.lat),
    lon: Number(value.lon),
    label: value.label.trim(),
    timestamp: Date.now(),
    source: "saved",
  };
}

/** Keep a small, validated route summary in Clyra chrome; geometry stays in Cesium. */
function readDirectionsResult(data: unknown): EarthDirections | null {
  const result = asRecord(data);
  const origin = asRecord(result?.origin);
  const destination = asRecord(result?.destination);
  const route = asRecord(result?.route);
  if (!origin || !destination || !route) return null;
  const originLabel = typeof origin.label === "string" && origin.label.trim() ? origin.label.trim() : "Current Location";
  const destinationLabel = typeof destination.label === "string" && destination.label.trim() ? destination.label.trim() : "Destination";
  const distanceM = Number(route.distanceM);
  const durationS = Number(route.durationS);
  if (!Number.isFinite(distanceM) || distanceM < 0 || !Number.isFinite(durationS) || durationS < 0) return null;
  const steps = (Array.isArray(route.steps) ? route.steps : [])
    .map((step) => asRecord(step))
    .filter((step): step is Record<string, unknown> => Boolean(step && typeof step.instruction === "string" && step.instruction.trim()))
    // Keep the real step sequence locally: the panel only paints a compact
    // window, but an in-flight route can advance beyond its first few turns.
    .slice(0, 200)
    .map((step) => ({
      instruction: String(step.instruction).trim(),
      distanceM: Number.isFinite(Number(step.distanceM)) ? Number(step.distanceM) : undefined,
    }));
  return {
    originLabel,
    destinationLabel,
    distanceM,
    durationS,
    mode: typeof route.mode === "string" ? route.mode : "car",
    steps,
  };
}

export function ClyraEarthWorkspace({ initialCommand }: { initialCommand?: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [commandStatus, setCommandStatus] = useState<{ tone: "success" | "error" | "working"; text: string } | null>(null);
  const [directions, setDirections] = useState<EarthDirections | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [ready, setReady] = useState(false);
  const [suggestion, setSuggestion] = useState<EarthSuggestion | null>(null);
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const queuedCommandRef = useRef<string | null>(null);
  const locationRequestRef = useRef<Promise<ParentLocation> | null>(null);
  const startupSequenceStartedRef = useRef(false);
  const suggestionRequestRef = useRef<AbortController | null>(null);
  // The framed map publishes progress on a calm interval. A final queued
  // progress event is allowed to arrive after Stop/Overview, so keep an
  // explicit owner-side guard: stopping a cinematic must never be rendered as
  // a fake arrival or leave the sheet in a disabled “Flying” state.
  const routeFlightStoppedRef = useRef(false);
  const handledInitialCommandRef = useRef<string | null>(null);

  const boot = useCallback(async () => {
    setError(null);
    setUrl(null);
    setReady(false);
    startupSequenceStartedRef.current = false;
    setAttempt((current) => current + 1);
    try {
      const response = await fetch("/api/earth/start", { method: "POST" });
      const payload = (await response.json()) as EarthStartResponse;
      if (!payload.ok || !payload.url) {
        setError(payload.reason ?? "Clyra Earth could not start.");
        return;
      }
      setUrl(payload.url);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Clyra Earth could not start.");
    }
  }, []);

  useEffect(() => {
    void boot();
  }, [boot]);

  /** Send a structured command into the Earth document. */
  const send = useCallback((message: EarthBridgeMessage) => {
    const frame = frameRef.current;
    if (!frame?.contentWindow || !url) return;
    const origin = earthBridgeOrigin(url);
    if (!origin) return;
    frame.contentWindow.postMessage({ [EARTH_BRIDGE_ORIGIN_MARK]: true, ...message }, origin);
  }, [url]);

  // Route transport is deterministic rather than a language command.
  const sendFlightControl = useCallback((action: "pause" | "resume" | "stop" | "overview") => {
    if (action === "stop") {
      // A deliberately stopped cinematic is not an arrival. Clear the compact
      // navigation readout immediately while the map retains its real route.
      setDirections((current) => current ? { ...current, navigation: undefined } : current);
    }
    if (action === "stop" || action === "overview") routeFlightStoppedRef.current = true;
    setCommandStatus({ tone: "working", text: action === "overview" ? "Returning to route overview…" : "Updating Fly Route…" });
    send({ kind: "route-flight-control", action });
  }, [send]);

  const requestSuggestions = useCallback((rawQuery: string) => {
    const query = rawQuery.trim();
    suggestionRequestRef.current?.abort();
    if (query.length < 3) {
      setSuggestion(null);
      return;
    }
    const controller = new AbortController();
    suggestionRequestRef.current = controller;
    setSuggestion({ query, places: [], pending: true });
    void fetch(`/api/earth/geocode?q=${encodeURIComponent(query)}`, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("Place search is unavailable");
        return (await response.json()) as unknown;
      })
      .then((payload) => {
        if (controller.signal.aborted || suggestionRequestRef.current !== controller) return;
        const data = asRecord(payload);
        const places = (Array.isArray(data?.results) ? data.results : [])
          .map((item) => asRecord(item))
          .map((item) => {
            const geometry = asRecord(item?.geometry);
            const location = asRecord(geometry?.location);
            const lat = Number(location?.lat);
            const lon = Number(location?.lng);
            if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
            const components = Array.isArray(item?.address_components) ? asRecord(item.address_components[0]) : null;
            const label = typeof components?.long_name === "string" && components.long_name.trim()
              ? components.long_name.trim()
              : typeof item?.formatted_address === "string" && item.formatted_address.trim()
                ? item.formatted_address.trim()
                : null;
            if (!label) return null;
            const type = Array.isArray(item?.types) && typeof item.types[0] === "string"
              ? item.types[0].replace(/_/g, " ")
              : "Place";
            return { label, detail: type.charAt(0).toUpperCase() + type.slice(1) };
          })
          .filter((place): place is { label: string; detail: string } => Boolean(place))
          .slice(0, 5);
        setSuggestion({ query, places, pending: false });
      })
      .catch(() => {
        if (controller.signal.aborted || suggestionRequestRef.current !== controller) return;
        // The Earth document keeps the original provider-backed search as a
        // fallback if the local host is being restarted.
        setSuggestion({ query, places: [], pending: false });
        send({ kind: "suggest", query });
      });
  }, [send]);

  /**
   * Location permission belongs to Clyra's trusted top-level document, not the
   * separately hosted Earth iframe. This avoids an opaque second-origin
   * permission prompt and keeps precise coordinates inside the local product.
   */
  const resolveCurrentLocation = useCallback((): Promise<ParentLocation> => {
    if (locationRequestRef.current) return locationRequestRef.current;
    const savedLocation = readLocationPreference();
    if (savedLocation) return Promise.resolve(savedLocation);
    const request = new Promise<ParentLocation>((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error("Current location is unavailable on this device. Enter an origin instead."));
        return;
      }
      let best: ParentLocation | null = null;
      let watchId: number | null = null;
      let finished = false;
      const finish = (location: ParentLocation | null, locationError?: Error) => {
        if (finished) return;
        finished = true;
        if (watchId !== null) navigator.geolocation.clearWatch(watchId);
        window.clearTimeout(sampleWindow);
        window.clearTimeout(timeout);
        if (location) resolve(location);
        else reject(locationError ?? new Error("Current location is unavailable right now. Check Location Services and try again."));
      };
      const acceptBestOrExplain = () => {
        if (best && (best.accuracyM ?? Number.POSITIVE_INFINITY) <= MAX_ROUTE_LOCATION_ACCURACY_M) {
          finish(best);
          return;
        }
        const quality = best ? formatLocationAccuracy(best.accuracyM) : "no usable position";
        finish(null, new Error(
          `Clyra only found an approximate location (${quality}). Turn on Precise Location in Location Services, then try again or enter an origin manually.`,
        ));
      };
      const sampleWindow = window.setTimeout(acceptBestOrExplain, LOCATION_SAMPLE_WINDOW_MS);
      const timeout = window.setTimeout(() => {
        acceptBestOrExplain();
      }, LOCATION_TIMEOUT_MS);
      watchId = navigator.geolocation.watchPosition(
        (position) => {
          const { latitude: lat, longitude: lon, accuracy } = position.coords;
          const accuracyM = Number(accuracy);
          if (!Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isFinite(accuracyM) || accuracyM < 0) return;
          const heading = Number(position.coords.heading);
          const sample = {
            lat,
            lon,
            accuracyM,
            ...(Number.isFinite(heading) && heading >= 0 && heading < 360 ? { heading } : {}),
            timestamp: Number.isFinite(position.timestamp) ? position.timestamp : Date.now(),
            source: "device" as const,
          };
          if (!best || accuracyM < (best.accuracyM ?? Number.POSITIVE_INFINITY)) best = sample;
          if (accuracyM <= PREFERRED_LOCATION_ACCURACY_M) finish(sample);
        },
        (positionError) => {
          if (best && (best.accuracyM ?? Number.POSITIVE_INFINITY) <= MAX_ROUTE_LOCATION_ACCURACY_M) {
            finish(best);
            return;
          }
          finish(null, new Error(
            positionError.code === positionError.PERMISSION_DENIED
              ? "Location permission is required to use Current Location."
              : "Current location is unavailable right now. Check Location Services and try again.",
          ));
        },
        { enableHighAccuracy: true, timeout: LOCATION_TIMEOUT_MS, maximumAge: 0 },
      );
    });
    locationRequestRef.current = request;
    void request.finally(() => {
      if (locationRequestRef.current === request) locationRequestRef.current = null;
    }).catch(() => undefined);
    return request;
  }, []);

  useEffect(() => {
    if (!url) return;
    const onMessage = (event: MessageEvent) => {
      if (event.source !== frameRef.current?.contentWindow) return;
      const message = readEarthEvent(event, url);
      if (!message) return;
      if (message.kind === "ready") {
        setReady(true);
        const queued = queuedCommandRef.current;
        queuedCommandRef.current = null;
        if (queued) {
          setCommandStatus({ tone: "working", text: "Clyra is preparing your map…" });
          send({ kind: "command", text: queued });
        }
      } else if (message.kind === "result") {
        const locationPreference = readLocationPreferenceUpdate(message.data);
        if (locationPreference) saveLocationPreference(locationPreference);
        const route = readDirectionsResult(message.data);
        if (route) {
          routeFlightStoppedRef.current = false;
          setDirections(route);
        }
        if (/cinematic route flight started/i.test(message.text)) routeFlightStoppedRef.current = false;
        setCommandStatus({ tone: "success", text: message.text });
      } else if (message.kind === "error") {
        setCommandStatus({ tone: "error", text: message.text });
      } else if (message.kind === "suggestion") {
        setSuggestion({ query: message.query, places: message.places, pending: false });
      } else if (message.kind === "route-progress") {
        if (routeFlightStoppedRef.current) return;
        setDirections((current) => current ? {
          ...current,
          navigation: {
            state: message.progress.state,
            remainingM: message.progress.remainingM,
            distanceToManeuverM: message.progress.distanceToManeuverM,
            stepIndex: message.progress.stepIndex,
            instruction: message.progress.instruction,
          },
        } : current);
        if (message.progress.state === "arrived") setCommandStatus({ tone: "success", text: "You’ve arrived at your destination." });
      } else if (message.kind === "location-request") {
        void resolveCurrentLocation()
          .then((location) => send({ kind: "location", location }))
          .catch((locationError) => send({
            kind: "location-error",
            text: locationError instanceof Error ? locationError.message : "Current location is unavailable.",
          }));
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [resolveCurrentLocation, send, url]);

  useEffect(() => {
    if (!url) return;
    const ping = () => send({ kind: "ping" });
    ping();
    const timer = window.setInterval(ping, 250);
    return () => window.clearInterval(timer);
  }, [send, url]);

  // Chat can hand a verified place directly to Earth. Queue it before the
  // iframe is ready, then use the same command bridge as the Earth composer.
  useEffect(() => {
    const command = initialCommand?.trim();
    if (!command || handledInitialCommandRef.current === command) return;
    handledInitialCommandRef.current = command;
    setCommandStatus({ tone: "working", text: "Clyra is preparing your map…" });
    if (!ready) {
      queuedCommandRef.current = command;
      return;
    }
    send({ kind: "command", text: command });
  }, [initialCommand, ready, send]);

  // The opening motion keeps the globe calm and responsive: three seconds of
  // centered idle rotation, then a cancellable descent to the real location.
  // Earth abandons it immediately if the user starts manipulating the camera.
  useEffect(() => {
    if (!ready || !url || startupSequenceStartedRef.current) return;
    startupSequenceStartedRef.current = true;
    const timer = window.setTimeout(() => send({ kind: "startup-location" }), 3_000);
    return () => window.clearTimeout(timer);
  }, [ready, send, url]);

  // The prewarm iframe does useful network/cache work during launch, but a
  // second Cesium renderer is wasteful once the visible globe is alive. Drop
  // it at that hand-off to release its GPU memory and render work.
  useEffect(() => {
    if (ready) window.dispatchEvent(new Event(EARTH_PREWARM_COMPLETE_EVENT));
  }, [ready]);

  return (
    <div className="clyra-earth" data-live={url ? true : undefined} data-ready={ready ? true : undefined}>
      {url ? (
        <iframe
          key={attempt}
          ref={frameRef}
          className="clyra-earth__frame"
        // Clyra owns the entry point, so Earth opens straight into its ready
        // workspace rather than placing a second first-run chooser over the
        // command bar. The upstream screen remains available in a direct tab.
        src={`${url}?welcome=0&clyra=1`}
          title="Clyra Earth"
          // The globe needs geolocation for "take me to…" from the user's real
          // position, and fullscreen for its own cinematic mode. Nothing else.
          allow="geolocation; fullscreen"
          onLoad={() => send({ kind: "ping" })}
        />
      ) : null}
      {ready ? (
        <EarthWorkspaceChrome
          status={commandStatus}
          suggestion={suggestion}
          directions={directions}
          onDismissDirections={() => setDirections(null)}
          onFlightControl={sendFlightControl}
          onSuggest={requestSuggestions}
          onSubmit={(text) => {
            setCommandStatus({ tone: "working", text: "Clyra is preparing your map…" });
            if (!ready) {
              // Do not drop an early command while Cesium is attaching the
              // deterministic action runner. It is sent as soon as the globe
              // announces readiness, so the bar always feels responsive.
              queuedCommandRef.current = text;
              return;
            }
            send({ kind: "command", text });
          }}
        />
      ) : null}
      <EarthBootCover ready={ready} starting={Boolean(url)} failed={Boolean(error)} />
      {error ? <div className="clyra-earth__error" role="status">{error}</div> : null}
    </div>
  );
}

/** A ready-gated launch cover; the globe never leaks through half-initialized. */
function EarthBootCover({ ready, starting, failed }: { ready: boolean; starting: boolean; failed: boolean }) {
  // These are lifecycle facts, not a fabricated percentage. The Earth iframe is
  // mounted, its app announces ready, then this cover steps aside.
  const label = failed
    ? "Earth couldn’t start"
    : ready
      ? "Ready"
      : starting
        ? "Preparing Earth…"
        : "Starting your workspace…";

  return (
    <div className="clyra-earth__boot" data-ready={ready || undefined} data-failed={failed || undefined} aria-live="polite">
      <div className="clyra-earth__boot-composition">
        <div className="clyra-earth__boot-copy-wrap">
          <h2 className="clyra-earth__boot-title">Clyra Earth</h2>
        </div>
        {/* A Cobe-inspired vector Earth emblem: calm, non-interactive and
            intentionally not a second WebGL canvas during Cesium startup. */}
        <div className="clyra-earth__boot-globe" aria-hidden="true">
          <svg viewBox="0 0 112 112" focusable="false">
            <defs>
              <radialGradient id="clyra-earth-loader-ocean" cx="35%" cy="28%" r="75%">
                <stop offset="0%" stopColor="#eff5f8" />
                <stop offset="58%" stopColor="#bdd0dd" />
                <stop offset="100%" stopColor="#7899b3" />
              </radialGradient>
              <clipPath id="clyra-earth-loader-clip"><circle cx="56" cy="56" r="36" /></clipPath>
            </defs>
            <ellipse className="clyra-earth__boot-orbit clyra-earth__boot-orbit--rear" cx="56" cy="56" rx="49" ry="18" />
            <g clipPath="url(#clyra-earth-loader-clip)">
              <circle cx="56" cy="56" r="36" fill="url(#clyra-earth-loader-ocean)" />
              <path className="clyra-earth__boot-land" d="M27 47c7-11 15-12 20-7l5 8-4 8-9 1-5 9-8-5zm36-17c13 3 22 13 23 27l-10 3-7-7 2-8-7-6zm3 30 13 2-1 10-10 9-7-5 2-9z" />
              <path className="clyra-earth__boot-shade" d="M56 18c22 5 36 20 36 38S78 89 56 94c13-11 19-24 19-38S69 29 56 18z" />
            </g>
            <circle className="clyra-earth__boot-globe-rim" cx="56" cy="56" r="36" />
            <ellipse className="clyra-earth__boot-orbit clyra-earth__boot-orbit--front" cx="56" cy="56" rx="49" ry="18" />
          </svg>
        </div>
        <div className="clyra-earth__boot-copy-wrap">
          <p className="clyra-earth__boot-copy">Preparing your world</p>
        </div>
        <div className="clyra-earth__boot-progress" aria-live="polite"><span /></div>
        <span className="clyra-earth__boot-status">{label}</span>
      </div>
    </div>
  );
}

/**
 * Starts one off-screen, non-interactive Earth document while Clyra launches.
 * The visible workspace gets the same locally cached static assets and warm
 * service worker path, without the user ever seeing a separate loading page.
 */
export function ClyraEarthPrewarm() {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    const release = () => setUrl(null);
    window.addEventListener(EARTH_PREWARM_COMPLETE_EVENT, release);
    return () => window.removeEventListener(EARTH_PREWARM_COMPLETE_EVENT, release);
  }, []);

  useEffect(() => {
    // Two concurrent Cesium documents compete for texture memory on a 4 GB
    // laptop. In that environment, prefer one predictable first launch over
    // a "warm" background renderer that causes the visible Earth to stutter.
    const deviceMemory = Number((navigator as Navigator & { deviceMemory?: number }).deviceMemory);
    if (Number.isFinite(deviceMemory) && deviceMemory <= 4) return;
    const controller = new AbortController();
    let cancelled = false;
    const warm = () => {
      void fetch("/api/earth/start", { method: "POST", signal: controller.signal })
        .then(async (response) => (await response.json()) as EarthStartResponse)
        .then((payload) => {
          if (!cancelled && payload.ok && payload.url) setUrl(payload.url);
        })
        .catch(() => {
          // The visible Earth workspace gives a useful error and retry action if
          // a local host genuinely cannot start. Warm-up must stay silent.
        });
    };
    const idleId = typeof window.requestIdleCallback === "function"
      ? window.requestIdleCallback(warm, { timeout: 4_000 })
      : window.setTimeout(warm, 1_500);
    return () => {
      cancelled = true;
      controller.abort();
      if (typeof window.cancelIdleCallback === "function" && typeof idleId === "number") window.cancelIdleCallback(idleId);
      else window.clearTimeout(idleId as number);
    };
  }, []);

  if (!url) return null;
  return (
    <iframe
      className="clyra-earth__prewarm"
      src={`${url}?welcome=0&clyra=1&prewarm=1`}
      title=""
      aria-hidden="true"
      tabIndex={-1}
      allow="fullscreen"
    />
  );
}

/**
 * Clyra's persistent command bar, restyled only enough to sit over the globe.
 * It stays open so Earth opens ready for a task rather than behind a second
 * click, while preserving the familiar Clyra hover and burst acknowledgement.
 */
function EarthWorkspaceChrome({
  onSubmit,
  onSuggest,
  status,
  suggestion,
  directions,
  onDismissDirections,
  onFlightControl,
}: {
  onSubmit: (text: string) => void;
  onSuggest: (query: string) => void;
  status: { tone: "success" | "error" | "working"; text: string } | null;
  suggestion: EarthSuggestion | null;
  directions: EarthDirections | null;
  onDismissDirections: () => void;
  onFlightControl: (action: "pause" | "resume" | "stop" | "overview") => void;
}) {
  const [popover, setPopover] = useState<"aircraft" | "layers" | "saved" | "map" | "settings" | null>(null);
  const run = (command: string) => {
    setPopover(null);
    onSubmit(command);
  };
  const changeRouteMode = (nextMode: "car" | "foot" | "bike", directions: EarthDirections) => {
    const wording = nextMode === "foot" ? "on foot" : nextMode === "bike" ? "by bike" : "by car";
    run(`directions from ${directions.originLabel} to ${directions.destinationLabel} ${wording}`);
  };
  return (
    <>
      <header className="clyra-earth__topbar" aria-label="Clyra Earth tools">
        <div className="clyra-earth__search-card">
          <div className="clyra-earth__product"><strong>Clyra Earth</strong><span>Explore · Navigate · Understand</span></div>
          <EarthLocationSearch
            suggestion={suggestion}
            onSuggest={onSuggest}
            onSubmit={(place) => run(`fly to ${place}`)}
            onRoute={(place) => run(`directions to ${place}`)}
            onCurrentLocation={() => run("show my location")}
          />
        </div>
        <nav className="clyra-earth__top-actions" aria-label="Earth actions">
          <div className="clyra-earth__control-group" aria-label="Aviation and layers">
            <EarthToolButton label="Aircraft tools" text="Aircraft" icon={<Plane />} active={popover === "aircraft"} onClick={() => setPopover(popover === "aircraft" ? null : "aircraft")} />
            <EarthToolButton label="Layers" icon={<Layers3 />} active={popover === "layers"} onClick={() => setPopover(popover === "layers" ? null : "layers")} />
          </div>
          <div className="clyra-earth__control-group" aria-label="Map controls">
            <EarthToolButton label="Saved places" icon={<Bookmark />} active={popover === "saved"} onClick={() => setPopover(popover === "saved" ? null : "saved")} />
            <EarthToolButton label="Map controls" icon={<Map />} active={popover === "map"} onClick={() => setPopover(popover === "map" ? null : "map")} />
            <EarthToolButton label="Current location" icon={<LocateFixed />} onClick={() => run("show my location")} />
            <EarthToolButton label="Settings" icon={<Settings2 />} active={popover === "settings"} onClick={() => setPopover(popover === "settings" ? null : "settings")} />
          </div>
        </nav>
        {popover ? <EarthPopover kind={popover} onRun={run} /> : null}
      </header>
      {directions ? <EarthDirectionsPanel directions={directions} onFly={() => run("fly the route")} onModeChange={changeRouteMode} onFlightControl={onFlightControl} onClose={onDismissDirections} /> : null}
      <EarthCommandPuck status={status} suggestion={suggestion} onSuggest={onSuggest} onSubmit={onSubmit} />
    </>
  );
}

function formatRouteDistance(distanceM: number) {
  if (distanceM >= 1_000) return `${(distanceM / 1_000).toFixed(distanceM >= 10_000 ? 0 : 1)} km`;
  return `${Math.round(distanceM)} m`;
}

function formatRouteDuration(durationS: number) {
  const minutes = Math.max(1, Math.round(durationS / 60));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder ? `${hours} hr ${remainder} min` : `${hours} hr`;
}

/**
 * The routing service supplies a real duration. During Fly Route we scale it
 * by the remaining route geometry so the arrival label progresses with the
 * same position that moves the blue dot—rather than presenting a made-up
 * clock or a frozen original ETA.
 */
function formatRouteArrival(durationS: number, remainingM?: number, totalM?: number) {
  const fraction = Number.isFinite(remainingM) && Number.isFinite(totalM) && (totalM ?? 0) > 0
    ? Math.max(0, Math.min(1, (remainingM ?? 0) / (totalM ?? 1)))
    : 1;
  const arrival = new Date(Date.now() + Math.max(0, durationS) * fraction * 1_000);
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(arrival);
}

/** A compact, map-first companion to the blue Cesium road route—not a modal. */
function EarthDirectionsPanel({
  directions,
  onFly,
  onModeChange,
  onFlightControl,
  onClose,
}: {
  directions: EarthDirections;
  onFly: () => void;
  onModeChange: (mode: "car" | "foot" | "bike", directions: EarthDirections) => void;
  onFlightControl: (action: "pause" | "resume" | "stop" | "overview") => void;
  onClose: () => void;
}) {
  const [flightMode, setFlightMode] = useState<"idle" | "flying" | "paused">("idle");
  const routeIdentityRef = useRef(`${directions.originLabel}\u0000${directions.destinationLabel}\u0000${directions.distanceM}`);
  const mode = directions.mode === "foot" ? "Walking" : directions.mode === "bike" ? "Cycling" : "Driving";
  const navigation = directions.navigation;
  const currentStep = navigation ? directions.steps[navigation.stepIndex] : null;
  const visibleSteps = navigation ? directions.steps.slice(navigation.stepIndex, navigation.stepIndex + 3) : directions.steps.slice(0, 3);
  const remainingDurationS = navigation && directions.distanceM > 0
    ? directions.durationS * Math.max(0, Math.min(1, navigation.remainingM / directions.distanceM))
    : directions.durationS;
  // A replacement route always owns a new camera lifecycle. Never carry an
  // old paused/manual transport state into it: that would offer Resume even
  // though the underlying motion correctly no longer exists.
  useEffect(() => {
    const nextIdentity = `${directions.originLabel}\u0000${directions.destinationLabel}\u0000${directions.distanceM}`;
    if (routeIdentityRef.current === nextIdentity) return;
    routeIdentityRef.current = nextIdentity;
    setFlightMode("idle");
  }, [directions.destinationLabel, directions.distanceM, directions.originLabel]);
  useEffect(() => {
    if (navigation?.state !== "arrived") return;
    setFlightMode("idle");
  }, [navigation?.state]);
  const control = (action: "pause" | "resume" | "stop" | "overview") => {
    if (action === "stop" || action === "overview") setFlightMode("idle");
    else setFlightMode(action === "pause" ? "paused" : "flying");
    onFlightControl(action);
  };
  return (
    <aside className="clyra-earth__directions" aria-label="Directions">
      <div className="clyra-earth__directions-heading">
        <span><Route size={16} aria-hidden="true" />Directions</span>
        <button type="button" aria-label="Close directions" onClick={onClose}><X size={16} /></button>
      </div>
      <div className="clyra-earth__route-endpoints">
        <div><span className="clyra-earth__route-dot clyra-earth__route-dot--origin" aria-hidden="true" /><p><small>From</small><strong>{directions.originLabel}</strong></p></div>
        <span className="clyra-earth__route-line" aria-hidden="true" />
        <div><span className="clyra-earth__route-dot clyra-earth__route-dot--destination" aria-hidden="true" /><p><small>To</small><strong>{directions.destinationLabel}</strong></p></div>
      </div>
      <div className="clyra-earth__route-summary" data-navigating={navigation?.state === "flying" || undefined}>
        <span><Navigation size={13} aria-hidden="true" />{navigation?.state === "flying" ? "Navigating" : mode}</span>
        <strong>{navigation?.state === "flying"
          ? <>{formatRouteDistance(navigation.remainingM)} <i>·</i> {formatRouteDuration(remainingDurationS)} <i>·</i> Arrive {formatRouteArrival(directions.durationS, navigation.remainingM, directions.distanceM)}</>
          : <>{formatRouteDuration(directions.durationS)} <i>·</i> {formatRouteDistance(directions.distanceM)} <i>·</i> Arrive {formatRouteArrival(directions.durationS)}</>}</strong>
      </div>
      <div className="clyra-earth__route-modes" aria-label="Travel mode">
        <button type="button" aria-pressed={directions.mode === "car"} onClick={() => onModeChange("car", directions)}>Drive</button>
        <button type="button" aria-pressed={directions.mode === "foot"} onClick={() => onModeChange("foot", directions)}>Walk</button>
        <button type="button" aria-pressed={directions.mode === "bike"} onClick={() => onModeChange("bike", directions)}>Cycle</button>
      </div>
      {navigation ? <div className="clyra-earth__next-maneuver" data-arrived={navigation.state === "arrived" || undefined}>
        <span>{navigation.state === "arrived" ? "Arrived" : `${formatRouteDistance(navigation.distanceToManeuverM)} to next maneuver`}</span>
        <strong>{navigation.state === "arrived" ? directions.destinationLabel : navigation.instruction ?? currentStep?.instruction ?? "Continue on route"}</strong>
      </div> : null}
      {visibleSteps.length ? <ol className="clyra-earth__route-steps" aria-label="Route steps">
        {visibleSteps.map((step, offset) => <li key={`${navigation?.stepIndex ?? 0}-${offset}-${step.instruction}`} data-current={navigation?.state === "flying" && offset === 0 ? true : undefined}>
          <MapPin size={14} aria-hidden="true" />
          <span><strong>{step.instruction}</strong>{step.distanceM ? <small>In {formatRouteDistance(step.distanceM)}</small> : null}</span>
        </li>)}
      </ol> : null}
      {flightMode === "idle" ? <button type="button" className="clyra-earth__fly-route" onClick={() => { setFlightMode("flying"); onFly(); }} disabled={navigation?.state === "flying"}>{navigation?.state === "flying" ? <><Navigation size={15} />Flying</> : <><Navigation size={15} />Fly route</>}</button> : <div className="clyra-earth__flight-transport" data-mode={flightMode} aria-live="polite">
        <div className="clyra-earth__flight-state"><span className="clyra-earth__flight-state-dot" aria-hidden="true" />{flightMode === "paused" ? "Paused" : "Flying"}</div>
        <div className="clyra-earth__flight-actions">
          {flightMode === "flying" ? <button type="button" onClick={() => control("pause")}>Pause</button> : null}
          {flightMode === "paused" ? <button type="button" className="clyra-earth__resume-route" onClick={() => control("resume")}>Resume route</button> : null}
          <button type="button" onClick={() => control("overview")}>Overview</button>
          <button type="button" className="clyra-earth__stop-route" onClick={() => control("stop")}>Stop</button>
        </div>
      </div>}
    </aside>
  );
}

function EarthToolButton({ label, text, icon, onClick, active = false }: { label: string; text?: string; icon: ReactNode; onClick: () => void; active?: boolean }) {
  return <button type="button" className="clyra-earth__tool" aria-label={label} aria-pressed={active} onClick={onClick}>{icon}{text ? <span>{text}</span> : null}</button>;
}

/** A direct, deterministic place-search surface—not an AI prompt. */
function EarthLocationSearch({
  suggestion,
  onSuggest,
  onSubmit,
  onRoute,
  onCurrentLocation,
}: {
  suggestion: EarthSuggestion | null;
  onSuggest: (query: string) => void;
  onSubmit: (place: string) => void;
  onRoute: (place: string) => void;
  onCurrentLocation: () => void;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [recents, setRecents] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem("clyra-earth-recents") || "[]") as string[]; } catch { return []; }
  });
  const timerRef = useRef<number | null>(null);
  const choose = (place: string) => {
    setQuery(place);
    setOpen(false);
    setRecents((current) => {
      const next = [place, ...current.filter((item) => item !== place)].slice(0, 4);
      localStorage.setItem("clyra-earth-recents", JSON.stringify(next));
      return next;
    });
    onSubmit(place);
  };
  const route = () => { if (query.trim()) { setOpen(false); onRoute(query.trim()); } };
  const matches = suggestion?.query === query.trim() ? suggestion.places : [];
  const showingRecents = open && query.trim().length < 3 && recents.length > 0;
  return (
    <form className="clyra-earth__place-search" role="search" onSubmit={(event) => { event.preventDefault(); if (query.trim()) choose(query.trim()); }}>
      <Search size={17} aria-hidden="true" />
      <input
        value={query}
        placeholder="Search places or coordinates"
        aria-label="Search places or coordinates"
        onFocus={() => setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 140)}
        onChange={(event) => {
          const value = event.target.value;
          setQuery(value);
          setOpen(true);
          if (timerRef.current) window.clearTimeout(timerRef.current);
          if (value.trim().length >= 3) timerRef.current = window.setTimeout(() => onSuggest(value), 220);
        }}
        onKeyDown={(event) => { if (event.key === "Escape") { setOpen(false); event.currentTarget.blur(); } }}
      />
      <button type="button" aria-label="Use current location as search context" title="Current location" onClick={() => { setOpen(false); onCurrentLocation(); }}><Crosshair size={16} /></button>
      <button type="button" className="clyra-earth__place-route" aria-label="Get directions to this place" title="Directions" disabled={!query.trim()} onClick={route}><Navigation size={16} /></button>
      {open && query.trim().length >= 3 ? (
        <div className="clyra-earth__place-results" role="listbox" aria-label="Place suggestions">
          {matches.length ? matches.map((place) => <button key={place.label} type="button" role="option" onMouseDown={(event) => event.preventDefault()} onClick={() => choose(place.label)}><LocateFixed size={16} /><span><strong>{place.label}</strong><small>{place.detail ?? "Place"}</small></span></button>) : suggestion?.pending ? <div className="clyra-earth__place-loading"><span />Finding places…</div> : <div className="clyra-earth__place-empty">No matching places</div>}
          <button type="button" className="clyra-earth__place-search-anyway" onMouseDown={(event) => event.preventDefault()} onClick={() => choose(query.trim())}><Search size={15} /><span>Search for “{query.trim()}”</span></button>
        </div>
      ) : showingRecents ? <div className="clyra-earth__place-results clyra-earth__place-results--recents" role="listbox" aria-label="Recent places">
        <span className="clyra-earth__results-label">Recent places</span>
        {recents.map((place) => <button key={place} type="button" role="option" onMouseDown={(event) => event.preventDefault()} onClick={() => choose(place)}><Clock3 size={16} /><span><strong>{place}</strong><small>Recent search</small></span></button>)}
      </div> : null}
    </form>
  );
}

function EarthPopover({ kind, onRun }: { kind: "aircraft" | "layers" | "saved" | "map" | "settings"; onRun: (command: string) => void }) {
  const entries = kind === "aircraft"
    ? [["Show live aircraft", "show flights"], ["Select nearest aircraft", "nearest aircraft"], ["Inspect selected flight", "what is this aircraft"], ["Follow selected aircraft", "follow that aircraft"], ["Enter Cockpit", "open cockpit"], ["Exit Cockpit", "exit cockpit"]]
    : kind === "layers"
    ? [["Flights", "show flights"], ["Ships", "show ships"], ["Cameras", "show cctv"], ["Fire activity", "show fires"]]
    : kind === "saved"
      ? [["Home", "take me home"], ["Work", "take me to work"], ["Save this view", "/earth save_place {}"]]
      : kind === "map"
        ? [["Street map", "/earth set_map_stack {\"stack\":\"osm\"}"], ["Satellite", "/earth set_map_stack {\"stack\":\"esri-imagery\"}"], ["Whole Earth", "zoom to globe"], ["Zoom in", "zoom in"], ["Zoom out", "zoom out"]]
        : [["Display settings", "open settings"], ["Hide HUD", "hide hud"], ["Open cockpit", "open cockpit"]];
  return <section className="clyra-earth__popover" data-kind={kind} aria-label={`${kind} options`}>
    <span className="clyra-earth__popover-title">{kind === "map" ? "Map" : kind[0].toUpperCase() + kind.slice(1)}</span>
    {entries.map(([label, command]) => <button key={label} type="button" onClick={() => onRun(command)}>{label}<span>›</span></button>)}
  </section>;
}

function EarthCommandPuck({
  onSubmit,
  onSuggest,
  status,
  suggestion,
}: {
  onSubmit: (text: string) => void;
  onSuggest: (query: string) => void;
  status: { tone: "success" | "error" | "working"; text: string } | null;
  suggestion: EarthSuggestion | null;
}) {
  const [text, setText] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);
  const suggestTimer = useRef<number | null>(null);

  const submit = () => {
    const value = text.trim();
    if (!value) return;
    onSubmit(value);
    setText("");
  };

  return (
    <form
      className="clyra-earth__puck"
      data-open
      data-working={status?.tone === "working" || undefined}
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <button
        type="button"
        className="clyra-earth__puck-command"
        aria-label="Ask Clyra Earth"
        onClick={() => inputRef.current?.focus()}
      >
        <Command size={18} strokeWidth={1.8} aria-hidden="true" />
      </button>
      <input
        ref={inputRef}
        className="clyra-earth__puck-input"
        value={text}
        placeholder="Ask Clyra anything about this map…"
        onChange={(event) => {
          const value = event.target.value;
          setText(value);
          if (suggestTimer.current) window.clearTimeout(suggestTimer.current);
          if (value.trim().length >= 3) suggestTimer.current = window.setTimeout(() => onSuggest(value), 260);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            setText("");
            inputRef.current?.blur();
          }
        }}
        tabIndex={0}
      />
      <button type="submit" className="clyra-earth__puck-submit" aria-label="Send command">
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="M12 17V5m0 0L7.5 9.5M12 5l4.5 4.5" />
        </svg>
      </button>
      {!text && !status ? <span className="clyra-earth__puck-hint" aria-hidden="true"><Sparkles size={13} /> Explore, navigate, command <kbd><Command size={10} />↵</kbd></span> : null}
      {suggestion?.places[0] && suggestion.query === text.trim() ? (
        <button type="button" className="clyra-earth__suggestion" onClick={() => { setText(suggestion.places[0].label); inputRef.current?.focus(); }}>
          <LocateFixed size={15} /><span><strong>{suggestion.places[0].label}</strong><small>{suggestion.places[0].detail ?? "Place"}</small></span>
        </button>
      ) : null}
      {status ? <output className="clyra-earth__puck-status" data-tone={status.tone}>{status.text}</output> : null}
    </form>
  );
}

export default ClyraEarthWorkspace;
