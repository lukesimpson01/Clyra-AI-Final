import type { Coordinate, Route } from "../../lib/maps/types";

/** Binary-searches a route's precomputed cumulative distances to interpolate
 * a coordinate + bearing at any progress along the route, without ever
 * scanning from the start. Route geometry is already densified server-side
 * (~25m max segment) so linear interpolation between vertices never visibly
 * cuts a corner. */
export class RouteInterpolator {
  private readonly geometry: Coordinate[];
  private readonly cumulative: number[];
  readonly totalDistance: number;

  constructor(route: Route) {
    this.geometry = route.geometry;
    this.cumulative = route.cumulativeDistances;
    this.totalDistance = this.cumulative[this.cumulative.length - 1] ?? 0;
  }

  private segmentIndexFor(distanceMeters: number): number {
    const clamped = Math.max(0, Math.min(distanceMeters, this.totalDistance));
    let lo = 0;
    let hi = this.cumulative.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.cumulative[mid] < clamped) lo = mid + 1;
      else hi = mid;
    }
    return Math.max(1, lo);
  }

  at(distanceMeters: number): { coordinate: Coordinate; bearing: number; segmentIndex: number } {
    const idx = this.segmentIndexFor(distanceMeters);
    const a = this.geometry[idx - 1];
    const b = this.geometry[idx];
    const distA = this.cumulative[idx - 1];
    const distB = this.cumulative[idx];
    const span = distB - distA;
    const t = span > 0 ? Math.max(0, Math.min(1, (distanceMeters - distA) / span)) : 0;
    const coordinate: Coordinate = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    return { coordinate, bearing: bearingBetween(a, b), segmentIndex: idx };
  }

  /** Nearest on-route progress (metres) to an arbitrary coordinate — used to
   * verify the simulated dot never drifts off the route line. */
  nearestProgress(point: Coordinate): { distanceMeters: number; offsetMeters: number } {
    let best = { distanceMeters: 0, offsetMeters: Infinity };
    for (let i = 0; i < this.geometry.length; i += 1) {
      const offset = haversine(point, this.geometry[i]);
      if (offset < best.offsetMeters) {
        best = { distanceMeters: this.cumulative[i], offsetMeters: offset };
      }
    }
    return best;
  }
}

export function bearingBetween(a: Coordinate, b: Coordinate): number {
  const lat1 = (a[1] * Math.PI) / 180;
  const lat2 = (b[1] * Math.PI) / 180;
  const dLon = ((b[0] - a[0]) * Math.PI) / 180;
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

export function haversine(a: Coordinate, b: Coordinate): number {
  const R = 6371000;
  const [lon1, lat1] = a;
  const [lon2, lat2] = b;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}
