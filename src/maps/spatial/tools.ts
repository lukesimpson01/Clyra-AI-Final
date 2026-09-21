import { area, bearing, bbox, distance, featureCollection, lineString, midpoint, point, polygon } from "@turf/turf";
import type { LngLat } from "../core/types";

export interface Measurement {
  id: string;
  kind: "distance" | "area" | "radius";
  geometry: GeoJSON.Geometry;
  label: string;
}

export function measureDistance(start: LngLat, end: LngLat): Measurement {
  const kilometres = distance(point(start), point(end), { units: "kilometers" });
  const heading = Math.round(bearing(point(start), point(end)) + 360) % 360;
  return { id: `distance:${Date.now()}`, kind: "distance", geometry: lineString([start, end]).geometry, label: kilometres >= 1 ? `${kilometres.toFixed(2)} km · ${heading}°` : `${Math.round(kilometres * 1000)} m · ${heading}°` };
}

export function measureArea(points: LngLat[]): Measurement | null {
  if (points.length < 3) return null;
  const shape = polygon([[...points, points[0]]]);
  const squareMetres = area(shape);
  return { id: `area:${Date.now()}`, kind: "area", geometry: shape.geometry, label: squareMetres > 1_000_000 ? `${(squareMetres / 1_000_000).toFixed(2)} km²` : `${Math.round(squareMetres).toLocaleString()} m²` };
}

export function routeBounds(coordinates: LngLat[]): [[number, number], [number, number]] | null {
  if (coordinates.length < 2) return null;
  const [west, south, east, north] = bbox(featureCollection([lineString(coordinates)]));
  return [[west, south], [east, north]];
}

export function routeMidpoint(coordinates: LngLat[]): LngLat | null {
  if (coordinates.length < 2) return null;
  const result = midpoint(point(coordinates[0]), point(coordinates[coordinates.length - 1]));
  return result.geometry.coordinates as LngLat;
}
