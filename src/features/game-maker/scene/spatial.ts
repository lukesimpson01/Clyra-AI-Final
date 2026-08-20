/**
 * World spatial index (spec §60).
 *
 * A uniform hash grid over world-space AABBs. Rebuilt lazily per scene
 * revision, so a scene with 100k entities is never scanned linearly for a
 * radius or ray query. Grid (rather than BVH) is the right trade here: the
 * index is rebuilt often as the AI edits, and grid rebuild is O(n) with a
 * tiny constant, while queries stay local.
 */
import type { EntityIR, SceneIR, Vec3 } from "../ir/types";
import { worldPosition, worldSize } from "../ir/patch";

export interface AABB {
  min: Vec3;
  max: Vec3;
}

export interface IndexedEntity {
  id: string;
  name: string;
  type: string;
  tags: string[];
  regionId?: string;
  center: Vec3;
  size: Vec3;
  aabb: AABB;
}

const CELL_SIZE = 16;

function cellKey(x: number, z: number) {
  return `${Math.floor(x / CELL_SIZE)},${Math.floor(z / CELL_SIZE)}`;
}

export class SpatialIndex {
  readonly revision: number;
  readonly sceneId: string;
  private readonly cells = new Map<string, string[]>();
  private readonly entries = new Map<string, IndexedEntity>();
  readonly bounds: AABB = { min: [0, 0, 0], max: [0, 0, 0] };

  constructor(scene: SceneIR) {
    this.revision = scene.revision;
    this.sceneId = scene.id;
    let first = true;
    for (const entity of Object.values(scene.entities)) {
      const center = worldPosition(scene, entity.id);
      const size = worldSize(scene, entity.id);
      const half: Vec3 = [size[0] / 2, size[1] / 2, size[2] / 2];
      const aabb: AABB = {
        min: [center[0] - half[0], center[1] - half[1], center[2] - half[2]],
        max: [center[0] + half[0], center[1] + half[1], center[2] + half[2]],
      };
      const indexed: IndexedEntity = {
        id: entity.id,
        name: entity.name,
        type: entity.type,
        tags: entity.tags,
        regionId: entity.regionId,
        center,
        size,
        aabb,
      };
      this.entries.set(entity.id, indexed);

      for (let x = aabb.min[0]; x <= aabb.max[0] + CELL_SIZE; x += CELL_SIZE) {
        for (let z = aabb.min[2]; z <= aabb.max[2] + CELL_SIZE; z += CELL_SIZE) {
          const key = cellKey(x, z);
          const bucket = this.cells.get(key);
          if (bucket) {
            if (bucket[bucket.length - 1] !== entity.id) bucket.push(entity.id);
          } else {
            this.cells.set(key, [entity.id]);
          }
        }
      }

      if (first) {
        this.bounds.min = [...aabb.min] as Vec3;
        this.bounds.max = [...aabb.max] as Vec3;
        first = false;
      } else {
        for (let axis = 0; axis < 3; axis += 1) {
          this.bounds.min[axis] = Math.min(this.bounds.min[axis]!, aabb.min[axis]!);
          this.bounds.max[axis] = Math.max(this.bounds.max[axis]!, aabb.max[axis]!);
        }
      }
    }
  }

  get size() {
    return this.entries.size;
  }

  get(id: string) {
    return this.entries.get(id);
  }

  all(): IndexedEntity[] {
    return [...this.entries.values()];
  }

  private candidates(min: Vec3, max: Vec3): Set<string> {
    const out = new Set<string>();
    for (let x = min[0]; x <= max[0] + CELL_SIZE; x += CELL_SIZE) {
      for (let z = min[2]; z <= max[2] + CELL_SIZE; z += CELL_SIZE) {
        for (const id of this.cells.get(cellKey(x, z)) ?? []) out.add(id);
      }
    }
    return out;
  }

  withinRadius(center: Vec3, radius: number): IndexedEntity[] {
    const min: Vec3 = [center[0] - radius, center[1] - radius, center[2] - radius];
    const max: Vec3 = [center[0] + radius, center[1] + radius, center[2] + radius];
    const out: IndexedEntity[] = [];
    for (const id of this.candidates(min, max)) {
      const entry = this.entries.get(id)!;
      if (distance(entry.center, center) <= radius) out.push(entry);
    }
    return out.sort((a, b) => distance(a.center, center) - distance(b.center, center));
  }

  withinBounds(min: Vec3, max: Vec3): IndexedEntity[] {
    const out: IndexedEntity[] = [];
    for (const id of this.candidates(min, max)) {
      const entry = this.entries.get(id)!;
      if (
        entry.center[0] >= min[0] && entry.center[0] <= max[0] &&
        entry.center[1] >= min[1] && entry.center[1] <= max[1] &&
        entry.center[2] >= min[2] && entry.center[2] <= max[2]
      ) out.push(entry);
    }
    return out;
  }

  overlapping(box: AABB): IndexedEntity[] {
    const out: IndexedEntity[] = [];
    for (const id of this.candidates(box.min, box.max)) {
      const entry = this.entries.get(id)!;
      if (aabbOverlap(entry.aabb, box)) out.push(entry);
    }
    return out;
  }

  nearest(center: Vec3, filter?: (entity: IndexedEntity) => boolean): IndexedEntity | undefined {
    for (const radius of [8, 24, 64, 200, 800, 4000]) {
      const hits = this.withinRadius(center, radius).filter((entity) => !filter || filter(entity));
      if (hits.length) return hits[0];
    }
    const all = this.all().filter((entity) => !filter || filter(entity));
    if (!all.length) return undefined;
    return all.sort((a, b) => distance(a.center, center) - distance(b.center, center))[0];
  }

  /**
   * Ray/AABB traversal. Returns the closest hit with a surface normal, which
   * is what "put a tower here" needs — a world point and the face it sits on.
   */
  raycast(origin: Vec3, direction: Vec3, maxDistance = 5000, ignore?: Set<string>):
    | { entityId: string; position: Vec3; normal: Vec3; distance: number }
    | undefined {
    const dir = normalize(direction);
    let best: { entityId: string; position: Vec3; normal: Vec3; distance: number } | undefined;

    // Walk the grid along the ray rather than testing every entity.
    const stepped = new Set<string>();
    const steps = Math.ceil(maxDistance / CELL_SIZE) + 1;
    for (let step = 0; step <= steps; step += 1) {
      const t = step * CELL_SIZE;
      if (best && t > best.distance + CELL_SIZE * 2) break;
      const px = origin[0] + dir[0] * t;
      const pz = origin[2] + dir[2] * t;
      for (let ox = -1; ox <= 1; ox += 1) {
        for (let oz = -1; oz <= 1; oz += 1) {
          const key = cellKey(px + ox * CELL_SIZE, pz + oz * CELL_SIZE);
          for (const id of this.cells.get(key) ?? []) {
            if (stepped.has(id)) continue;
            stepped.add(id);
            if (ignore?.has(id)) continue;
            const entry = this.entries.get(id)!;
            const hit = rayAabb(origin, dir, entry.aabb);
            if (hit && hit.distance <= maxDistance && (!best || hit.distance < best.distance)) {
              best = { entityId: id, position: hit.position, normal: hit.normal, distance: hit.distance };
            }
          }
        }
      }
    }
    return best;
  }
}

/* ---------------- geometry helpers ---------------- */

export function distance(a: Vec3, b: Vec3): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

export function normalize(v: Vec3): Vec3 {
  const length = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / length, v[1] / length, v[2] / length];
}

export function aabbOverlap(a: AABB, b: AABB): boolean {
  return (
    a.min[0] <= b.max[0] && a.max[0] >= b.min[0] &&
    a.min[1] <= b.max[1] && a.max[1] >= b.min[1] &&
    a.min[2] <= b.max[2] && a.max[2] >= b.min[2]
  );
}

/** Slab-method ray/AABB intersection with the entry face normal. */
export function rayAabb(origin: Vec3, dir: Vec3, box: AABB):
  | { position: Vec3; normal: Vec3; distance: number }
  | undefined {
  let tmin = -Infinity;
  let tmax = Infinity;
  let axisHit = 0;
  let sign = 1;

  for (let axis = 0; axis < 3; axis += 1) {
    const d = dir[axis]!;
    const o = origin[axis]!;
    const lo = box.min[axis]!;
    const hi = box.max[axis]!;
    if (Math.abs(d) < 1e-9) {
      if (o < lo || o > hi) return undefined;
      continue;
    }
    let t1 = (lo - o) / d;
    let t2 = (hi - o) / d;
    let localSign = -1;
    if (t1 > t2) {
      const swap = t1;
      t1 = t2;
      t2 = swap;
      localSign = 1;
    }
    if (t1 > tmin) {
      tmin = t1;
      axisHit = axis;
      sign = localSign;
    }
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return undefined;
  }

  const t = tmin >= 0 ? tmin : tmax;
  if (t < 0) return undefined;
  const normal: Vec3 = [0, 0, 0];
  normal[axisHit] = sign;
  return {
    position: [origin[0] + dir[0] * t, origin[1] + dir[1] * t, origin[2] + dir[2] * t],
    normal,
    distance: t,
  };
}

/** Ray against the infinite Y=height plane; the fallback when nothing is hit. */
export function rayGroundPlane(origin: Vec3, dir: Vec3, height = 0): Vec3 | undefined {
  if (Math.abs(dir[1]) < 1e-6) return undefined;
  const t = (height - origin[1]) / dir[1];
  if (t < 0) return undefined;
  return [origin[0] + dir[0] * t, height, origin[2] + dir[2] * t];
}

/* ---------------- index cache ---------------- */

/**
 * Keyed on the scene OBJECT, not its id: `applyScenePatch` always returns a
 * fresh scene, so identity is exactly the right cache key and there is no
 * way to serve an index built from different content. Keying on `scene.id`
 * would collide whenever two scenes share an id at the same revision — which
 * happens in tests, in undo/redo, and any time two projects are open.
 */
const cache = new WeakMap<SceneIR, SpatialIndex>();

export function getSpatialIndex(scene: SceneIR): SpatialIndex {
  const existing = cache.get(scene);
  if (existing && existing.revision === scene.revision) return existing;
  const index = new SpatialIndex(scene);
  cache.set(scene, index);
  return index;
}

export function entityCenter(scene: SceneIR, entity: EntityIR): Vec3 {
  return worldPosition(scene, entity.id);
}
