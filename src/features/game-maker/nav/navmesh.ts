/**
 * Navigation (spec §22, §124, §125, §129).
 *
 * A tiled walkability grid plus A*. Tiles are rebuilt individually when
 * geometry in them changes, so adding one house does not rebuild a 4 km
 * world's navigation.
 *
 * Deliberate substitution: the specification names Recast/Detour. This
 * implementation is a voxel-column grid navmesh instead, because it needs no
 * WASM asset pipeline, runs identically in a worker, the runtime and Node
 * (so playtests are testable headlessly), and answers exactly the questions
 * the system asks of it — "is this walkable", "is there a path", "how long".
 * The IR field is engine-neutral, so swapping in Recast later is a change of
 * builder only. Recorded in STATUS.md.
 */
import type { NavigationIR, SceneIR, Vec3 } from "../ir/types";
import { getSpatialIndex, type AABB } from "../scene/spatial";
import { worldTransform } from "../ir/patch";
import type { MeshPart, MeshSpec } from "../procedural/mesh";

export interface NavConfig {
  cellSize: number;
  agentRadius: number;
  agentHeight: number;
  maxSlopeDegrees: number;
  maxStepHeight: number;
  bounds: { min: Vec3; max: Vec3 };
  tileCells: number;
}

/**
 * Choose a cell size for a world of this span.
 *
 * A 0.6m cell is right for a single room and catastrophic for a 500m world:
 * the grid reaches a million cells, and A* exhausts its search budget before
 * it can cross the map, so every long walk silently reports "no route" and
 * the bot walks straight into a building instead. Scaling the cell keeps the
 * grid inside a fixed budget at any world size.
 */
export function cellSizeForBounds(bounds: { min: Vec3; max: Vec3 }, targetCells = 360_000, minCell = 0.5, maxCell = 2.5): number {
  const spanX = Math.max(1, bounds.max[0] - bounds.min[0]);
  const spanZ = Math.max(1, bounds.max[2] - bounds.min[2]);
  const ideal = Math.sqrt((spanX * spanZ) / targetCells);
  return Math.min(maxCell, Math.max(minCell, Number(ideal.toFixed(2))));
}

export const DEFAULT_NAV_CONFIG: Omit<NavConfig, "bounds"> = {
  cellSize: 0.6,
  agentRadius: 0.4,
  agentHeight: 1.8,
  maxSlopeDegrees: 45,
  maxStepHeight: 0.45,
  tileCells: 64,
};

export interface NavTile {
  key: string;
  tileX: number;
  tileZ: number;
  cells: number;
  /** 1 = walkable. Row-major, z-major. */
  walkable: Uint8Array;
  /** Surface height per cell; NaN where unwalkable. */
  heights: Float32Array;
}

export function navTileKey(tileX: number, tileZ: number) {
  return `${tileX},${tileZ}`;
}

export interface NavGeometry {
  /** Solid boxes that block or support movement. */
  boxes: (AABB & { walkableTop: boolean })[];
  /** Optional terrain sampler for open ground. */
  sampleHeight?: (x: number, z: number) => number | undefined;
}

function rotateVec(q: [number, number, number, number], v: Vec3): Vec3 {
  const [x, y, z, w] = q;
  const ix = w * v[0] + y * v[2] - z * v[1];
  const iy = w * v[1] + z * v[0] - x * v[2];
  const iz = w * v[2] + x * v[1] - y * v[0];
  const iw = -x * v[0] - y * v[1] - z * v[2];
  return [
    ix * w + iw * -x + iy * -z - iz * -y,
    iy * w + iw * -y + iz * -x - ix * -z,
    iz * w + iw * -z + ix * -y - iy * -x,
  ];
}

/** World-space AABB of one mesh part under an entity's world transform. */
function partWorldBox(part: MeshPart, transform: { position: Vec3; rotation: [number, number, number, number]; scale: Vec3 }): AABB {
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const sx of [-0.5, 0.5]) {
    for (const sy of [-0.5, 0.5]) {
      for (const sz of [-0.5, 0.5]) {
        const local: Vec3 = [
          (part.offset[0] + part.size[0] * sx) * transform.scale[0],
          (part.offset[1] + part.size[1] * sy) * transform.scale[1],
          (part.offset[2] + part.size[2] * sz) * transform.scale[2],
        ];
        const rotated = rotateVec(transform.rotation, local);
        for (let axis = 0; axis < 3; axis += 1) {
          const value = transform.position[axis]! + rotated[axis]!;
          min[axis] = Math.min(min[axis]!, value);
          max[axis] = Math.max(max[axis]!, value);
        }
      }
    }
  }
  return { min, max };
}

/**
 * Extract navigation geometry from a scene. Pure over the IR.
 *
 * Collision is taken PER MESH PART, not from the entity's overall bounding
 * box. A building's bounding box includes its roof, porch and balcony
 * overhangs, and treating that as one solid obstacle walls off the ground
 * underneath — so the front door of an inn with a porch becomes unreachable
 * and the bot reports "no route" for a perfectly walkable doorway. Per-part
 * boxes also let characters walk under bridges and through gate arches.
 */
export function navGeometryFromScene(scene: SceneIR, sampleHeight?: (x: number, z: number) => number | undefined): NavGeometry {
  const index = getSpatialIndex(scene);
  const boxes: NavGeometry["boxes"] = [];

  for (const entry of index.all()) {
    const entity = scene.entities[entry.id];
    if (!entity || !entity.visible) continue;
    const hasCollider = entity.components.some((component) => component.type === "Collider");
    const hint = entity.components.find((component) => component.type === "NavigationHint");
    if (!hasCollider && !hint) continue;

    const walkableTop = hint ? hint.data.walkable !== false : true;
    const mesh = entity.components.find((component) => component.type === "ProceduralMesh");
    const spec = mesh?.data.spec as MeshSpec | undefined;

    if (spec?.parts?.length) {
      const transform = worldTransform(scene, entry.id);
      for (const part of spec.parts) {
        if (part.noCollision) continue;
        const box = partWorldBox(part, transform);
        if (box.max[0] - box.min[0] < 0.02 && box.max[2] - box.min[2] < 0.02) continue;
        boxes.push({ ...box, walkableTop });
      }
      continue;
    }

    if (entry.size[0] < 0.05 && entry.size[2] < 0.05) continue;
    boxes.push({ ...entry.aabb, walkableTop });
  }

  return { boxes, sampleHeight };
}

/**
 * Build one navmesh tile. The column test is: find the highest supporting
 * surface under `agentHeight` of clearance, then reject it if the slope to a
 * neighbour exceeds the limit.
 */
export function buildNavTile(tileX: number, tileZ: number, config: NavConfig, geometry: NavGeometry): NavTile {
  const cells = config.tileCells;
  const walkable = new Uint8Array(cells * cells);
  const heights = new Float32Array(cells * cells).fill(Number.NaN);
  const originX = config.bounds.min[0] + tileX * cells * config.cellSize;
  const originZ = config.bounds.min[2] + tileZ * cells * config.cellSize;

  for (let cz = 0; cz < cells; cz += 1) {
    for (let cx = 0; cx < cells; cx += 1) {
      const x = originX + (cx + 0.5) * config.cellSize;
      const z = originZ + (cz + 0.5) * config.cellSize;

      // Pass 1 — the highest surface you could stand on at this column.
      // Obstacles are evaluated afterwards, against the FINAL surface: doing
      // both in one pass makes the result depend on the order the geometry
      // happens to be listed in.
      let surface = geometry.sampleHeight?.(x, z);
      for (const box of geometry.boxes) {
        if (!box.walkableTop) continue;
        if (x < box.min[0] || x > box.max[0] || z < box.min[2] || z > box.max[2]) continue;
        if (surface === undefined || box.max[1] > surface) {
          const clear = !geometry.boxes.some((other) =>
            other !== box &&
            x >= other.min[0] && x <= other.max[0] &&
            z >= other.min[2] && z <= other.max[2] &&
            other.min[1] > box.max[1] + 0.05 &&
            other.min[1] < box.max[1] + config.agentHeight);
          if (clear) surface = box.max[1];
        }
      }

      // Pass 2 — anything solid standing in the agent's own volume blocks
      // the cell. Obstacles are inflated by the agent radius so a character
      // is never routed into a wall it would immediately collide with.
      let blocked = false;
      if (surface !== undefined) {
        for (const box of geometry.boxes) {
          if (box.walkableTop) continue;
          if (x < box.min[0] - config.agentRadius || x > box.max[0] + config.agentRadius) continue;
          if (z < box.min[2] - config.agentRadius || z > box.max[2] + config.agentRadius) continue;
          if (box.max[1] <= surface + config.maxStepHeight) continue;
          if (box.min[1] >= surface + config.agentHeight) continue;
          blocked = true;
          break;
        }
      }

      if (surface !== undefined && Number.isFinite(surface) && !blocked) {
        heights[cz * cells + cx] = surface;
        walkable[cz * cells + cx] = 1;
      }
    }
  }

  // Slope pass: a cell whose step to any 4-neighbour is too big is not walkable.
  const maxStep = Math.max(config.maxStepHeight, Math.tan((config.maxSlopeDegrees * Math.PI) / 180) * config.cellSize);
  const original = Uint8Array.from(walkable);
  for (let cz = 0; cz < cells; cz += 1) {
    for (let cx = 0; cx < cells; cx += 1) {
      const at = cz * cells + cx;
      if (!original[at]) continue;
      const here = heights[at]!;
      let steep = 0;
      let neighbours = 0;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const nx = cx + dx;
        const nz = cz + dz;
        if (nx < 0 || nz < 0 || nx >= cells || nz >= cells) continue;
        const neighbour = nz * cells + nx;
        if (!original[neighbour]) continue;
        neighbours += 1;
        if (Math.abs(heights[neighbour]! - here) > maxStep) steep += 1;
      }
      // Fully surrounded by unreachable steps = an isolated ledge.
      if (neighbours > 0 && steep === neighbours) walkable[at] = 0;
    }
  }

  return { key: navTileKey(tileX, tileZ), tileX, tileZ, cells, walkable, heights };
}

export interface NavGrid {
  config: NavConfig;
  tiles: Map<string, NavTile>;
  tilesX: number;
  tilesZ: number;
}

export function buildNavGrid(config: NavConfig, geometry: NavGeometry, onlyTiles?: string[]): NavGrid {
  const span = config.tileCells * config.cellSize;
  const tilesX = Math.max(1, Math.ceil((config.bounds.max[0] - config.bounds.min[0]) / span));
  const tilesZ = Math.max(1, Math.ceil((config.bounds.max[2] - config.bounds.min[2]) / span));
  const tiles = new Map<string, NavTile>();
  const wanted = onlyTiles ? new Set(onlyTiles) : null;

  /*
   * Broad phase. Collision is taken per mesh part, so a village is hundreds
   * of boxes; testing every box against every cell of every tile is millions
   * of comparisons and seconds of frozen UI. Each tile therefore only sees
   * the boxes that actually overlap it, which is usually a handful.
   */
  const margin = config.agentRadius + config.cellSize;
  const bucket = (tx: number, tz: number): NavGeometry => {
    const minX = config.bounds.min[0] + tx * span - margin;
    const maxX = minX + span + margin * 2;
    const minZ = config.bounds.min[2] + tz * span - margin;
    const maxZ = minZ + span + margin * 2;
    return {
      sampleHeight: geometry.sampleHeight,
      boxes: geometry.boxes.filter((box) => box.min[0] <= maxX && box.max[0] >= minX && box.min[2] <= maxZ && box.max[2] >= minZ),
    };
  };

  for (let tz = 0; tz < tilesZ; tz += 1) {
    for (let tx = 0; tx < tilesX; tx += 1) {
      const key = navTileKey(tx, tz);
      if (wanted && !wanted.has(key)) continue;
      tiles.set(key, buildNavTile(tx, tz, config, bucket(tx, tz)));
    }
  }
  return { config, tiles, tilesX, tilesZ };
}

function worldToCell(grid: NavGrid, position: Vec3): { tx: number; tz: number; cx: number; cz: number } | null {
  const { config } = grid;
  const span = config.tileCells * config.cellSize;
  const localX = position[0] - config.bounds.min[0];
  const localZ = position[2] - config.bounds.min[2];
  if (localX < 0 || localZ < 0) return null;
  const tx = Math.floor(localX / span);
  const tz = Math.floor(localZ / span);
  if (tx >= grid.tilesX || tz >= grid.tilesZ) return null;
  return {
    tx,
    tz,
    cx: Math.floor((localX - tx * span) / config.cellSize),
    cz: Math.floor((localZ - tz * span) / config.cellSize),
  };
}

function globalCell(grid: NavGrid, position: Vec3): { gx: number; gz: number } | null {
  const cell = worldToCell(grid, position);
  if (!cell) return null;
  return { gx: cell.tx * grid.config.tileCells + cell.cx, gz: cell.tz * grid.config.tileCells + cell.cz };
}

function cellState(grid: NavGrid, gx: number, gz: number): { walkable: boolean; height: number } {
  const cells = grid.config.tileCells;
  const tx = Math.floor(gx / cells);
  const tz = Math.floor(gz / cells);
  const tile = grid.tiles.get(navTileKey(tx, tz));
  if (!tile) return { walkable: false, height: Number.NaN };
  const index = (gz - tz * cells) * cells + (gx - tx * cells);
  return { walkable: tile.walkable[index] === 1, height: tile.heights[index]! };
}

/**
 * The nearest walkable cell to a global cell, searched outwards in rings.
 *
 * Obstacles are inflated by the agent radius, so a character standing right
 * against a wall occupies a cell that the grid calls blocked. Refusing to
 * path from there would mean a bot can walk up to a door once and then never
 * walk anywhere again. The same applies to a destination that sits inside an
 * object's footprint.
 */
export function nearestWalkableCell(grid: NavGrid, gx: number, gz: number, maxRings = 8): { gx: number; gz: number } | null {
  if (cellState(grid, gx, gz).walkable) return { gx, gz };
  for (let ring = 1; ring <= maxRings; ring += 1) {
    let best: { gx: number; gz: number; distance: number } | null = null;
    for (let dz = -ring; dz <= ring; dz += 1) {
      for (let dx = -ring; dx <= ring; dx += 1) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== ring) continue;
        const nx = gx + dx;
        const nz = gz + dz;
        if (nx < 0 || nz < 0) continue;
        if (!cellState(grid, nx, nz).walkable) continue;
        const distance = dx * dx + dz * dz;
        if (!best || distance < best.distance) best = { gx: nx, gz: nz, distance };
      }
    }
    if (best) return { gx: best.gx, gz: best.gz };
  }
  return null;
}

export function isWalkable(grid: NavGrid, position: Vec3): boolean {
  const cell = globalCell(grid, position);
  if (!cell) return false;
  return cellState(grid, cell.gx, cell.gz).walkable;
}

export interface PathResult {
  found: boolean;
  waypoints: Vec3[];
  length: number;
  /** Cells explored — the honest cost signal for "why is this slow". */
  explored: number;
  reason?: string;
}

/** A* over the walkability grid with 8-way movement and a string-pull pass. */
export function findPath(grid: NavGrid, from: Vec3, to: Vec3, maxExplored = 400_000): PathResult {
  const start = globalCell(grid, from);
  const goal = globalCell(grid, to);
  if (!start) return { found: false, waypoints: [], length: 0, explored: 0, reason: "The start position is outside the navigation bounds." };
  if (!goal) return { found: false, waypoints: [], length: 0, explored: 0, reason: "The destination is outside the navigation bounds." };

  // Snap both ends onto walkable ground before searching: standing against
  // a wall, or aiming at a doorway, otherwise fails before A* even starts.
  const startCell = nearestWalkableCell(grid, start.gx, start.gz);
  const goalCell = nearestWalkableCell(grid, goal.gx, goal.gz);
  if (!startCell) {
    return { found: false, waypoints: [], length: 0, explored: 0, reason: "The player is not standing on anything walkable, and there is no walkable ground nearby." };
  }
  if (!goalCell) {
    return { found: false, waypoints: [], length: 0, explored: 0, reason: "There is no walkable ground at or near the destination." };
  }

  const width = grid.tilesX * grid.config.tileCells;
  const key = (gx: number, gz: number) => gz * width + gx;
  const startKey = key(startCell.gx, startCell.gz);
  const goalKey = key(goalCell.gx, goalCell.gz);

  const gScore = new Map<number, number>([[startKey, 0]]);
  const cameFrom = new Map<number, number>();
  const open: { key: number; gx: number; gz: number; f: number }[] = [
    { key: startKey, gx: startCell.gx, gz: startCell.gz, f: Math.hypot(goalCell.gx - startCell.gx, goalCell.gz - startCell.gz) },
  ];
  const closed = new Set<number>();
  let explored = 0;

  const NEIGHBOURS: [number, number, number][] = [
    [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
    [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2],
  ];

  while (open.length && explored < maxExplored) {
    // Linear min-scan: open sets stay small on grid navmeshes of this size.
    let bestIndex = 0;
    for (let index = 1; index < open.length; index += 1) if (open[index]!.f < open[bestIndex]!.f) bestIndex = index;
    const current = open.splice(bestIndex, 1)[0]!;
    if (closed.has(current.key)) continue;
    closed.add(current.key);
    explored += 1;

    if (current.key === goalKey) {
      const cells: [number, number][] = [];
      let cursor: number | undefined = goalKey;
      while (cursor !== undefined) {
        cells.push([cursor % width, Math.floor(cursor / width)]);
        cursor = cameFrom.get(cursor);
      }
      cells.reverse();
      const waypoints = simplify(grid, cells);
      let length = 0;
      for (let index = 1; index < waypoints.length; index += 1) {
        length += Math.hypot(waypoints[index]![0] - waypoints[index - 1]![0], waypoints[index]![2] - waypoints[index - 1]![2]);
      }
      return { found: true, waypoints, length, explored };
    }

    const currentHeight = cellState(grid, current.gx, current.gz).height;
    for (const [dx, dz, cost] of NEIGHBOURS) {
      const nx = current.gx + dx;
      const nz = current.gz + dz;
      if (nx < 0 || nz < 0) continue;
      const neighbourKey = key(nx, nz);
      if (closed.has(neighbourKey)) continue;
      const state = cellState(grid, nx, nz);
      if (!state.walkable) continue;
      if (Math.abs(state.height - currentHeight) > grid.config.maxStepHeight * 1.5) continue;
      // Diagonals may not cut corners through blocked cells.
      if (dx !== 0 && dz !== 0) {
        if (!cellState(grid, current.gx + dx, current.gz).walkable) continue;
        if (!cellState(grid, current.gx, current.gz + dz).walkable) continue;
      }
      const tentative = (gScore.get(current.key) ?? Infinity) + cost;
      if (tentative >= (gScore.get(neighbourKey) ?? Infinity)) continue;
      gScore.set(neighbourKey, tentative);
      cameFrom.set(neighbourKey, current.key);
      open.push({ key: neighbourKey, gx: nx, gz: nz, f: tentative + Math.hypot(goalCell.gx - nx, goalCell.gz - nz) });
    }
  }

  return {
    found: false,
    waypoints: [],
    length: 0,
    explored,
    reason:
      explored >= maxExplored
        ? `The route search gave up after exploring ${explored} cells. The navigation grid may be too fine for a world this size.`
        : "No walkable route connects these two points — they are on separate patches of walkable ground.",
  };
}

/** Drop collinear/unobstructed intermediate cells so bots walk straight lines. */
function simplify(grid: NavGrid, cells: [number, number][]): Vec3[] {
  const toWorld = ([gx, gz]: [number, number]): Vec3 => [
    grid.config.bounds.min[0] + (gx + 0.5) * grid.config.cellSize,
    cellState(grid, gx, gz).height,
    grid.config.bounds.min[2] + (gz + 0.5) * grid.config.cellSize,
  ];
  if (cells.length <= 2) return cells.map(toWorld);

  const clear = (a: [number, number], b: [number, number]) => {
    const steps = Math.max(Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]));
    for (let step = 1; step < steps; step += 1) {
      const gx = Math.round(a[0] + ((b[0] - a[0]) * step) / steps);
      const gz = Math.round(a[1] + ((b[1] - a[1]) * step) / steps);
      if (!cellState(grid, gx, gz).walkable) return false;
    }
    return true;
  };

  const out: [number, number][] = [cells[0]!];
  let anchor = 0;
  for (let index = 2; index < cells.length; index += 1) {
    if (!clear(cells[anchor]!, cells[index]!)) {
      out.push(cells[index - 1]!);
      anchor = index - 1;
    }
  }
  out.push(cells[cells.length - 1]!);
  return out.map(toWorld);
}

/* ---------------- serialisation ---------------- */

export function encodeNavTile(tile: NavTile): string {
  let binary = "";
  const step = 8192;
  for (let offset = 0; offset < tile.walkable.length; offset += step) {
    binary += String.fromCharCode(...tile.walkable.subarray(offset, offset + step));
  }
  return btoa(binary);
}

export function navigationIRFrom(grid: NavGrid): NavigationIR {
  const tiles: Record<string, string> = {};
  for (const [key, tile] of grid.tiles) tiles[key] = encodeNavTile(tile);
  return {
    cellSize: grid.config.cellSize,
    agentRadius: grid.config.agentRadius,
    agentHeight: grid.config.agentHeight,
    maxSlopeDegrees: grid.config.maxSlopeDegrees,
    maxStepHeight: grid.config.maxStepHeight,
    bounds: grid.config.bounds,
    tiles,
    builtAt: Date.now(),
    dirtyTiles: [],
  };
}

/** Which tiles a changed world-space box invalidates (spec §124). */
export function dirtyTilesFor(config: NavConfig, box: AABB): string[] {
  const span = config.tileCells * config.cellSize;
  const keys: string[] = [];
  const minX = Math.floor((box.min[0] - config.bounds.min[0]) / span);
  const maxX = Math.floor((box.max[0] - config.bounds.min[0]) / span);
  const minZ = Math.floor((box.min[2] - config.bounds.min[2]) / span);
  const maxZ = Math.floor((box.max[2] - config.bounds.min[2]) / span);
  for (let tz = minZ; tz <= maxZ; tz += 1) {
    for (let tx = minX; tx <= maxX; tx += 1) {
      if (tx < 0 || tz < 0) continue;
      keys.push(navTileKey(tx, tz));
    }
  }
  return keys;
}
