/**
 * Procedural mesh specification (spec §84).
 *
 * A MeshSpec is *data*, not geometry: it says "a 3×2×4 box in oak, offset up
 * by 1.2m". Both the editor viewport and the sandboxed runtime compile the
 * same spec into engine geometry, so a generated building looks identical in
 * both without shipping a mesh over the wire.
 */
import type { Vec3 } from "../ir/types";

export type PrimitiveKind =
  | "box"
  | "cylinder"
  | "cone"
  | "sphere"
  | "capsule"
  | "plane"
  | "torus"
  /** Triangular prism laid on its side — gable roofs, ramps, wedges. */
  | "prism"
  /** A closed 2D polygon extruded along +Y — irregular footprints, towers. */
  | "extrude";

export interface MeshPart {
  kind: PrimitiveKind;
  /** Local offset from the compound origin. */
  offset: Vec3;
  size: Vec3;
  /** Euler degrees; authored geometry is easier to reason about in degrees. */
  rotation?: Vec3;
  material: string;
  /** For `extrude`: the footprint polygon as [x, z] pairs. */
  polygon?: [number, number][];
  /** Marks a part as non-colliding (banners, glass, foliage cards). */
  noCollision?: boolean;
}

export interface MeshSpec {
  parts: MeshPart[];
}

export function part(
  kind: PrimitiveKind,
  offset: Vec3,
  size: Vec3,
  material: string,
  extra: Partial<MeshPart> = {},
): MeshPart {
  return { kind, offset, size, material, ...extra };
}

export function meshBounds(spec: MeshSpec): { center: Vec3; size: Vec3 } {
  if (!spec.parts.length) return { center: [0, 0, 0], size: [1, 1, 1] };
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const item of spec.parts) {
    // Rotated parts are bounded conservatively by their largest extent, which
    // keeps picking and the spatial index correct without a full OBB.
    const radius = item.rotation && item.rotation.some((value) => Math.abs(value) > 0.01)
      ? Math.hypot(item.size[0], item.size[1], item.size[2]) / 2
      : 0;
    for (let axis = 0; axis < 3; axis += 1) {
      const half = Math.max(item.size[axis]! / 2, radius);
      min[axis] = Math.min(min[axis]!, item.offset[axis]! - half);
      max[axis] = Math.max(max[axis]!, item.offset[axis]! + half);
    }
  }
  return {
    center: [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2],
    size: [max[0] - min[0], max[1] - min[1], max[2] - min[2]],
  };
}

/** A regular n-gon footprint, the base of towers and round buildings. */
export function polygonRing(sides: number, radius: number, phase = 0): [number, number][] {
  const points: [number, number][] = [];
  for (let index = 0; index < sides; index += 1) {
    const angle = phase + (index / sides) * Math.PI * 2;
    points.push([Math.cos(angle) * radius, Math.sin(angle) * radius]);
  }
  return points;
}

/** Rectangle footprint, optionally with one corner cut (an L-shaped house). */
export function rectangleFootprint(width: number, depth: number, notch?: { width: number; depth: number }): [number, number][] {
  const hw = width / 2;
  const hd = depth / 2;
  if (!notch) return [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]];
  const nw = Math.min(notch.width, width * 0.8);
  const nd = Math.min(notch.depth, depth * 0.8);
  return [
    [-hw, -hd],
    [hw, -hd],
    [hw, hd - nd],
    [hw - nw, hd - nd],
    [hw - nw, hd],
    [-hw, hd],
  ];
}

/** Signed area — used to keep generated footprints counter-clockwise. */
export function polygonArea(points: [number, number][]): number {
  let area = 0;
  for (let index = 0; index < points.length; index += 1) {
    const [x1, z1] = points[index]!;
    const [x2, z2] = points[(index + 1) % points.length]!;
    area += x1 * z2 - x2 * z1;
  }
  return area / 2;
}

export function ensureCounterClockwise(points: [number, number][]): [number, number][] {
  return polygonArea(points) < 0 ? [...points].reverse() : points;
}

/** Ear-clipping triangulation for extruded footprints. Handles concave shapes. */
export function triangulatePolygon(points: [number, number][]): number[] {
  const ring = ensureCounterClockwise(points);
  const indices = ring.map((_, index) => index);
  const triangles: number[] = [];
  let guard = 0;

  const cross = (a: [number, number], b: [number, number], c: [number, number]) =>
    (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);

  const insideTriangle = (p: [number, number], a: [number, number], b: [number, number], c: [number, number]) => {
    const d1 = cross(p, a, b);
    const d2 = cross(p, b, c);
    const d3 = cross(p, c, a);
    const hasNegative = d1 < 0 || d2 < 0 || d3 < 0;
    const hasPositive = d1 > 0 || d2 > 0 || d3 > 0;
    return !(hasNegative && hasPositive);
  };

  while (indices.length > 3 && guard < 4096) {
    guard += 1;
    let clipped = false;
    for (let index = 0; index < indices.length; index += 1) {
      const prev = indices[(index - 1 + indices.length) % indices.length]!;
      const current = indices[index]!;
      const next = indices[(index + 1) % indices.length]!;
      const a = ring[prev]!;
      const b = ring[current]!;
      const c = ring[next]!;
      if (cross(a, b, c) <= 0) continue;
      const blocked = indices.some((other) => {
        if (other === prev || other === current || other === next) return false;
        return insideTriangle(ring[other]!, a, b, c);
      });
      if (blocked) continue;
      triangles.push(prev, current, next);
      indices.splice(index, 1);
      clipped = true;
      break;
    }
    if (!clipped) break;
  }
  if (indices.length === 3) triangles.push(indices[0]!, indices[1]!, indices[2]!);
  return triangles;
}

/**
 * Build interleaved geometry for an extruded polygon.
 * Returned as plain arrays so this can run in a worker and be transferred.
 */
export function buildExtrudedGeometry(polygon: [number, number][], height: number): {
  positions: number[];
  normals: number[];
  uvs: number[];
  indices: number[];
} {
  const ring = ensureCounterClockwise(polygon);
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const half = height / 2;

  // Side walls: one quad per edge, with its own normal so edges stay crisp.
  for (let index = 0; index < ring.length; index += 1) {
    const [x1, z1] = ring[index]!;
    const [x2, z2] = ring[(index + 1) % ring.length]!;
    const dx = x2 - x1;
    const dz = z2 - z1;
    const length = Math.hypot(dx, dz) || 1;
    const nx = dz / length;
    const nz = -dx / length;
    const base = positions.length / 3;
    positions.push(x1, -half, z1, x2, -half, z2, x2, half, z2, x1, half, z1);
    for (let corner = 0; corner < 4; corner += 1) normals.push(nx, 0, nz);
    uvs.push(0, 0, length, 0, length, height, 0, height);
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  // Caps.
  const capTriangles = triangulatePolygon(ring);
  for (const [sign, normal] of [[half, 1] as const, [-half, -1] as const]) {
    const base = positions.length / 3;
    for (const [x, z] of ring) {
      positions.push(x, sign, z);
      normals.push(0, normal, 0);
      uvs.push(x, z);
    }
    for (let index = 0; index < capTriangles.length; index += 3) {
      const [a, b, c] = [capTriangles[index]!, capTriangles[index + 1]!, capTriangles[index + 2]!];
      if (normal > 0) indices.push(base + a, base + b, base + c);
      else indices.push(base + c, base + b, base + a);
    }
  }

  return { positions, normals, uvs, indices };
}

/** Triangular prism (gable roof / ramp), aligned so the ridge runs along Z. */
export function buildPrismGeometry(width: number, height: number, depth: number): {
  positions: number[];
  normals: number[];
  uvs: number[];
  indices: number[];
} {
  const hw = width / 2;
  const hh = height / 2;
  const hd = depth / 2;
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  const quad = (a: Vec3, b: Vec3, c: Vec3, d: Vec3, n: Vec3) => {
    const base = positions.length / 3;
    positions.push(...a, ...b, ...c, ...d);
    for (let corner = 0; corner < 4; corner += 1) normals.push(...n);
    uvs.push(0, 0, 1, 0, 1, 1, 0, 1);
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };
  const tri = (a: Vec3, b: Vec3, c: Vec3, n: Vec3) => {
    const base = positions.length / 3;
    positions.push(...a, ...b, ...c);
    for (let corner = 0; corner < 3; corner += 1) normals.push(...n);
    uvs.push(0, 0, 1, 0, 0.5, 1);
    indices.push(base, base + 1, base + 2);
  };

  const slope = Math.hypot(hw, height) || 1;
  quad([-hw, -hh, -hd], [-hw, -hh, hd], [0, hh, hd], [0, hh, -hd], [-height / slope, hw / slope, 0]);
  quad([0, hh, -hd], [0, hh, hd], [hw, -hh, hd], [hw, -hh, -hd], [height / slope, hw / slope, 0]);
  quad([-hw, -hh, hd], [-hw, -hh, -hd], [hw, -hh, -hd], [hw, -hh, hd], [0, -1, 0]);
  tri([-hw, -hh, hd], [hw, -hh, hd], [0, hh, hd], [0, 0, 1]);
  tri([hw, -hh, -hd], [-hw, -hh, -hd], [0, hh, -hd], [0, 0, -1]);

  return { positions, normals, uvs, indices };
}
