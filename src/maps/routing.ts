import { bbox as turfBbox } from "@turf/turf";
import type { LngLat, Route, RouteStep, TravelMode } from "./core/types";

export type { Route, RouteStep, TravelMode } from "./core/types";

export interface RouteRequest {
  origin: { lon: number; lat: number };
  destination: { lon: number; lat: number };
  waypoints?: Array<{ lon: number; lat: number }>;
  mode: TravelMode;
  alternatives?: boolean;
  avoid?: { tolls?: boolean; motorways?: boolean; ferries?: boolean };
}

export interface RoutingProvider {
  id: string;
  label: string;
  supports(mode: TravelMode): boolean;
  route(request: RouteRequest, signal?: AbortSignal): Promise<Route>;
  alternatives(request: RouteRequest, signal?: AbortSignal): Promise<Route[]>;
  matrix?(points: LngLat[], mode: TravelMode, signal?: AbortSignal): Promise<number[][]>;
  isochrone?(origin: LngLat, minutes: number, mode: TravelMode, signal?: AbortSignal): Promise<GeoJSON.Feature<GeoJSON.Polygon> | null>;
  mapMatch?(coordinates: LngLat[], signal?: AbortSignal): Promise<GeoJSON.LineString | null>;
  nearest?(coordinate: LngLat, signal?: AbortSignal): Promise<LngLat | null>;
  healthCheck(signal?: AbortSignal): Promise<boolean>;
}

const OSRM_BASE = "https://router.project-osrm.org";
const cache = new Map<string, { expiresAt: number; value: Route }>();
const inFlight = new Map<string, Promise<Route>>();

function configuredRoutingEndpoint(): string | null {
  const global = typeof window !== "undefined" ? (window as unknown as { CLYRA_ROUTING_ENDPOINT?: string }).CLYRA_ROUTING_ENDPOINT : undefined;
  const env = (import.meta as unknown as { env?: Record<string, string> }).env?.VITE_CLYRA_ROUTING_ENDPOINT;
  return global ?? env ?? null;
}

function maneuverFromOsrm(modifier?: string, type?: string): string {
  const value = (modifier ?? type ?? "").toLowerCase();
  if (value.includes("uturn")) return "uturn";
  if (value === "sharp right") return "sharp-right";
  if (value === "slight right") return "slight-right";
  if (value === "right") return "right";
  if (value === "sharp left") return "sharp-left";
  if (value === "slight left") return "slight-left";
  if (value === "left") return "left";
  if (["merge", "fork", "exit", "roundabout", "rotary", "arrive", "depart"].includes(value)) return value === "rotary" ? "roundabout" : value;
  return "straight";
}

function instructionForStep(maneuver: string, modifier?: string, name?: string): string {
  const road = name?.trim() ? ` onto ${name.trim()}` : "";
  const copy: Record<string, string> = {
    uturn: "Make a U-turn", "sharp-right": "Turn sharp right", "slight-right": "Turn slight right", right: "Turn right",
    "sharp-left": "Turn sharp left", "slight-left": "Turn slight left", left: "Turn left", merge: "Merge", fork: `Keep ${modifier === "right" ? "right" : "left"}`,
    exit: "Take the exit", roundabout: "Enter the roundabout", arrive: "Arrive at your destination", depart: "Head forward", straight: "Continue straight",
  };
  return `${copy[maneuver] ?? copy.straight}${maneuver === "arrive" ? "" : road}`;
}

function idFor(request: RouteRequest): string {
  const points = [request.origin, ...(request.waypoints ?? []), request.destination].map((p) => `${p.lon.toFixed(4)},${p.lat.toFixed(4)}`).join(";");
  return `${request.mode}:${points}:${JSON.stringify(request.avoid ?? {})}`;
}

function routeFromOsrm(raw: unknown, request: RouteRequest, provider: string): Route | null {
  const route = raw as {
    geometry?: { coordinates?: unknown[] };
    distance?: unknown;
    duration?: unknown;
    legs?: Array<{ steps?: Array<{ maneuver?: { modifier?: string; type?: string }; name?: string; distance?: unknown; duration?: unknown }> }>;
  };
  const coordinates = (route.geometry?.coordinates ?? [])
    .filter((point): point is [unknown, unknown] => Array.isArray(point) && point.length >= 2)
    .map(([lon, lat]) => [Number(lon), Number(lat)] as LngLat)
    .filter(([lon, lat]) => Number.isFinite(lon) && Number.isFinite(lat));
  if (coordinates.length < 2) return null;
  const geometry: GeoJSON.LineString = { type: "LineString", coordinates };
  const box = turfBbox(geometry) as [number, number, number, number];
  const steps: RouteStep[] = (route.legs?.flatMap((leg) => leg.steps ?? []) ?? []).map((step) => {
    const maneuver = maneuverFromOsrm(step.maneuver?.modifier, step.maneuver?.type);
    return {
      instruction: instructionForStep(maneuver, step.maneuver?.modifier, step.name), maneuverType: maneuver, modifier: step.maneuver?.modifier,
      distanceM: Number(step.distance) || 0, durationS: Number(step.duration) || 0, name: step.name,
    };
  });
  return {
    id: `${provider}:${idFor(request)}`, mode: request.mode, distanceM: Number(route.distance) || 0, durationS: Number(route.duration) || 0,
    geometry, bbox: [[box[0], box[1]], [box[2], box[3]]], steps,
    waypoints: [request.origin, ...(request.waypoints ?? []), request.destination].map((point) => [point.lon, point.lat]),
    provider, alternatives: [], warnings: request.mode === "accessible" ? ["Accessibility is estimated from walking data; check local conditions."] : [], fetchedAt: Date.now(),
  };
}

const osrmProvider: RoutingProvider = {
  id: "osrm", label: "OSRM public demo", supports: (mode) => mode !== "transit",
  async route(request, signal) {
    const mode = request.mode === "accessible" ? "walking" : request.mode;
    const points = [request.origin, ...(request.waypoints ?? []), request.destination].map((point) => `${point.lon},${point.lat}`).join(";");
    const url = new URL(`${OSRM_BASE}/route/v1/${mode}/${points}`);
    url.searchParams.set("overview", "full"); url.searchParams.set("geometries", "geojson"); url.searchParams.set("steps", "true"); url.searchParams.set("alternatives", request.alternatives ? "true" : "false");
    const response = await fetch(url, { signal, headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error(`Directions unavailable (${response.status})`);
    const body = await response.json() as { code?: string; routes?: unknown[] };
    if (body.code !== "Ok" || !body.routes?.length) throw new Error("No route was found for those places.");
    const primary = routeFromOsrm(body.routes[0], request, "osrm");
    if (!primary) throw new Error("The routing service returned an incomplete route.");
    primary.alternatives = body.routes.slice(1).map((value) => routeFromOsrm(value, request, "osrm")).filter((route): route is Route => Boolean(route));
    return primary;
  },
  async alternatives(request, signal) { return (await this.route({ ...request, alternatives: true }, signal)).alternatives; },
  async matrix(points, mode, signal) {
    if (mode === "transit") throw new Error("Transit matrix is unavailable for this region.");
    const encoded = points.map(([lon, lat]) => `${lon},${lat}`).join(";");
    const response = await fetch(`${OSRM_BASE}/table/v1/${mode === "accessible" ? "walking" : mode}/${encoded}`, { signal });
    if (!response.ok) throw new Error("Route matrix is unavailable.");
    const body = await response.json() as { durations?: number[][] };
    return body.durations ?? [];
  },
  async healthCheck(signal) { try { const response = await fetch(`${OSRM_BASE}/route/v1/driving/151.2,-33.87;151.21,-33.86?overview=false`, { signal }); return response.ok; } catch { return false; } },
};

const valhallaProvider: RoutingProvider = {
  id: "valhalla", label: "Configured Valhalla", supports: () => true,
  async route(request, signal) {
    const endpoint = configuredRoutingEndpoint();
    if (!endpoint) throw new Error("A Valhalla routing endpoint is not configured.");
    const mode: Record<TravelMode, string> = { driving: "auto", walking: "pedestrian", cycling: "bicycle", transit: "multimodal", accessible: "pedestrian" };
    const response = await fetch(`${endpoint.replace(/\/$/, "")}/route`, {
      method: "POST", signal, headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ costing: mode[request.mode], locations: [request.origin, ...(request.waypoints ?? []), request.destination].map((point) => ({ lon: point.lon, lat: point.lat })), directions_options: { units: "kilometers" } }),
    });
    if (!response.ok) throw new Error(`Directions unavailable (${response.status})`);
    // Hosted Valhalla variants differ in response encoding. Keeping this
    // failure explicit is safer than inventing a geometry from a polyline.
    throw new Error("This Valhalla endpoint needs the Clyra response adapter configured.");
  },
  async alternatives() { return []; },
  async healthCheck() { return Boolean(configuredRoutingEndpoint()); },
};

export function getRoutingProvider(): RoutingProvider { return configuredRoutingEndpoint() ? valhallaProvider : osrmProvider; }
export async function requestRoute(request: RouteRequest, signal?: AbortSignal): Promise<Route> {
  const key = idFor(request);
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const existing = inFlight.get(key);
  if (existing) return existing;
  const provider = getRoutingProvider();
  if (!provider.supports(request.mode)) throw new Error(`${request.mode === "transit" ? "Transit" : "This travel mode"} is unavailable for this area.`);
  const work = provider.route(request, signal).then((route) => { cache.set(key, { value: route, expiresAt: Date.now() + 120_000 }); return route; }).finally(() => inFlight.delete(key));
  inFlight.set(key, work);
  return work;
}
