import type { Coordinate } from "../../lib/maps/types";
import type { RouteInterpolator } from "./RouteInterpolator";
import { BearingFilter } from "./BearingFilter";

export interface CameraFrame {
  center: Coordinate;
  zoom: number;
  pitch: number;
  bearing: number;
}

const BASE_PITCH = 60;
const BASE_ZOOM = 17.2;
const OVERVIEW_ZOOM_PULLBACK = 1.1; // zoom out slightly when a turn is imminent
const TURN_WARNING_METERS = 220;

/** Computes the cinematic navigation camera each frame: bearing follows the
 * road heading (smoothed), zoom/pitch stay in a driving range, the look-ahead
 * point (not the raw dot) is the framing target so more road is visible
 * ahead, and the camera anticipates upcoming turns by easing out slightly
 * rather than snapping into the new heading at the last metre. */
export class NavigationCameraController {
  private bearingFilter: BearingFilter;

  constructor(initialBearing: number) {
    this.bearingFilter = new BearingFilter(initialBearing, 0.12);
  }

  frame(params: {
    position: Coordinate;
    heading: number;
    progressMeters: number;
    interpolator: RouteInterpolator;
    metersPerSecond: number;
    distanceToNextManeuver?: number;
  }): CameraFrame {
    const smoothedBearing = this.bearingFilter.update(params.heading);

    // Look-ahead scales with speed: crawling gives a small look-ahead,
    // highway speed pushes the framing target further down the road.
    const lookAheadMeters = Math.max(20, Math.min(140, params.metersPerSecond * 6));
    const ahead = params.interpolator.at(params.progressMeters + lookAheadMeters);

    const turnImminent =
      params.distanceToNextManeuver != null && params.distanceToNextManeuver < TURN_WARNING_METERS;
    const zoom = turnImminent ? BASE_ZOOM - OVERVIEW_ZOOM_PULLBACK : BASE_ZOOM;
    const pitch = turnImminent ? BASE_PITCH - 8 : BASE_PITCH;

    return {
      center: ahead.coordinate,
      zoom,
      pitch,
      bearing: smoothedBearing,
    };
  }

  reset(bearing: number) {
    this.bearingFilter.set(bearing);
  }
}

/** Overview framing (bounding box fit) used before "GO" is pressed and for
 * the initial cinematic fly-in's first phase. */
export function overviewBoundsOf(geometry: Coordinate[]): [Coordinate, Coordinate] {
  let minLon = Infinity;
  let minLat = Infinity;
  let maxLon = -Infinity;
  let maxLat = -Infinity;
  for (const [lon, lat] of geometry) {
    if (lon < minLon) minLon = lon;
    if (lat < minLat) minLat = lat;
    if (lon > maxLon) maxLon = lon;
    if (lat > maxLat) maxLat = lat;
  }
  return [
    [minLon, minLat],
    [maxLon, maxLat],
  ];
}
