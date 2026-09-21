/**
 * Clyra Maps — camera controller.
 *
 * The single place every camera operation goes through. No React component
 * calls `map.flyTo` directly; they call this controller, which applies the
 * premium easing, context-appropriate durations, and the "load before arrival"
 * readiness gate so a long flight never lands on a half-loaded map.
 */
import type { Map as MapLibreMap, LngLatLike, LngLatBoundsLike, PaddingOptions } from "maplibre-gl";

/** Buttery ease-in/ease-out curve (no bounce, no overshoot). */
export const MAP_EASE: [number, number, number, number] = [0.16, 1, 0.3, 1];

/** Recommended flight durations (ms) for each movement class. */
export const FLY_PRESETS = {
  /** Tiny nudges — clicking a nearby result. */
  SHORT_FLY: 380,
  /** Local movement — same suburb / cross-suburb. */
  LOCAL_FLY: 700,
  /** City movement — cross-city. */
  CITY_FLY: 1100,
  /** Long cinematic — cross-state / cross-country. */
  LONG_FLY: 1800,
  /** Focusing the user's current location. */
  LOCATION_FOCUS: 900,
  /** Fitting a whole route into view. */
  ROUTE_OVERVIEW: 1200,
  /** Easing into follow-cam navigation. */
  NAVIGATION_START: 800,
  /** Return bearing to north. */
  RESET_NORTH: 300,
} as const;

export type FlyKind = keyof typeof FLY_PRESETS;

export interface FlyTarget {
  center: LngLatLike;
  zoom?: number;
  bearing?: number;
  pitch?: number;
}

export interface CameraControllerLike {
  flyTo(target: FlyTarget, kind?: FlyKind | number): void;
  flyToLocation(lon: number, lat: number, zoom: number, kind?: FlyKind | number): void;
  fitRoute(bounds: LngLatBoundsLike, opts?: { padding?: PaddingOptions; bearing?: number; pitch?: number }): void;
  enterNavigation(center: LngLatLike, bearing: number): void;
  exitNavigation(center: LngLatLike): void;
  resetNorth(): void;
  setPitch(pitch: number): void;
  setBearing(bearing: number): void;
  focusPlace(lon: number, lat: number, zoom: number): void;
}

/** How far a jump must be (zoom delta) to be treated as a "long" flight. */
const LONG_FLIGHT_ZOOM_DELTA = 3;

/**
 * The single camera controller. Construct once per map instance.
 */
export class ClyraMapCameraController implements CameraControllerLike {
  constructor(private readonly map: MapLibreMap) {}

  private duration(kind?: FlyKind | number): number {
    if (typeof kind === "number") return kind;
    return FLY_PRESETS[kind ?? "CITY_FLY"];
  }

  private flightKindFor(target: FlyTarget): FlyKind {
    const current = this.map.getZoom();
    const zoomDelta = target.zoom != null ? Math.abs(target.zoom - current) : 0;
    if (zoomDelta >= LONG_FLIGHT_ZOOM_DELTA) return "LONG_FLY";
    if (zoomDelta >= 1.5) return "CITY_FLY";
    return "LOCAL_FLY";
  }

  flyTo(target: FlyTarget, kind?: FlyKind | number): void {
    const resolvedKind = kind ?? this.flightKindFor(target);
    this.map.flyTo({
      center: target.center,
      zoom: target.zoom ?? this.map.getZoom(),
      bearing: target.bearing ?? this.map.getBearing(),
      pitch: target.pitch ?? this.map.getPitch(),
      duration: this.duration(resolvedKind),
      easing: this.ease,
      essential: true,
    });
  }

  flyToLocation(lon: number, lat: number, zoom: number, kind?: FlyKind | number): void {
    this.flyTo({ center: [lon, lat], zoom }, kind);
  }

  focusPlace(lon: number, lat: number, zoom: number): void {
    this.flyTo({ center: [lon, lat], zoom }, this.flightKindFor({ center: [lon, lat], zoom }));
  }

  fitRoute(bounds: LngLatBoundsLike, opts?: { padding?: PaddingOptions; bearing?: number; pitch?: number }): void {
    this.map.fitBounds(bounds, {
      padding: opts?.padding ?? { top: 120, bottom: 180, left: 120, right: 120 },
      bearing: opts?.bearing ?? 0,
      pitch: opts?.pitch ?? 0,
      duration: FLY_PRESETS.ROUTE_OVERVIEW,
      easing: this.ease,
      essential: true,
    });
  }

  enterNavigation(center: LngLatLike, bearing: number): void {
    this.map.easeTo({
      center,
      bearing,
      pitch: 52,
      zoom: 16.5,
      duration: FLY_PRESETS.NAVIGATION_START,
      easing: this.ease,
      essential: true,
    });
  }

  exitNavigation(center: LngLatLike): void {
    this.map.easeTo({
      center,
      bearing: 0,
      pitch: 0,
      zoom: Math.max(this.map.getZoom(), 14),
      duration: FLY_PRESETS.LOCAL_FLY,
      easing: this.ease,
      essential: true,
    });
  }

  resetNorth(): void {
    this.map.easeTo({
      bearing: 0,
      pitch: this.map.getPitch() ? 0 : this.map.getPitch(),
      duration: FLY_PRESETS.RESET_NORTH,
      easing: this.ease,
      essential: true,
    });
  }

  setPitch(pitch: number): void {
    this.map.easeTo({ pitch, duration: FLY_PRESETS.SHORT_FLY, easing: this.ease, essential: true });
  }

  setBearing(bearing: number): void {
    this.map.easeTo({ bearing, duration: FLY_PRESETS.SHORT_FLY, easing: this.ease, essential: true });
  }

  private ease(t: number): number {
    return MAP_EASING_FN(t);
  }
}

// A single shared cubic-bezier(0.16, 1, 0.3, 1) solver — buttery, decelerating,
// no bounce or overshoot. Mirrors the premium motion used across the Clyra UI.
const [BX1, BY1, BX2, BY2] = MAP_EASE;
const PRECISION = 1e-5;

function bezierX(t: number): number {
  const u = 1 - t;
  return 3 * u * u * t * BX1 + 3 * u * t * t * BX2 + t * t * t;
}
function bezierY(t: number): number {
  const u = 1 - t;
  return 3 * u * u * t * BY1 + 3 * u * t * t * BY2 + t * t * t;
}
function bezierDerivativeX(t: number): number {
  const u = 1 - t;
  return 3 * u * u * BX1 + 6 * u * t * (BX2 - BX1) + 3 * t * t * (1 - BX2);
}
function MAP_EASING_FN(x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  let t = x;
  for (let i = 0; i < 12; i++) {
    const error = bezierX(t) - x;
    if (Math.abs(error) < PRECISION) break;
    t -= error / bezierDerivativeX(t);
  }
  return bezierY(t);
}

/** True once the style + initial tiles are usable enough to fly into. */
export function isMapUsable(map: MapLibreMap): boolean {
  return map.isStyleLoaded() && map.loaded();
}

/** Resolve when the map reaches a usable frame at (or near) the target view. */
export function waitForMapReady(map: MapLibreMap, timeoutMs = 8000): Promise<boolean> {
  if (isMapUsable(map)) return Promise.resolve(true);
  return new Promise((resolve) => {
    let done = false;
    const finish = (ok: boolean) => {
      if (done) return;
      done = true;
      map.off("idle", onIdle);
      window.clearTimeout(timer);
      resolve(ok);
    };
    const onIdle = () => finish(true);
    const timer = window.setTimeout(() => finish(isMapUsable(map)), timeoutMs);
    map.on("idle", onIdle);
  });
}
