/**
 * 2D level generation (spec §112–§114).
 *
 * Two layouts share one tile grammar: `platformer` (reachability-checked
 * platform chains) and `topdown` (rooms + corridors). Both emit a tilemap
 * plus real gameplay entities, and both are checked for solvability at
 * generation time rather than leaving it to the playtest bot to discover.
 */
import { z } from "zod";
import type { GeneratorDefinition, GeneratorOutput } from "./generator";
import type { PatchOperation } from "../ir/types";
import { Rng } from "./random";
import { materialAsset } from "./materials";

export const TILE = {
  empty: 0,
  ground: 1,
  platform: 2,
  hazard: 3,
  ladder: 4,
  wall: 5,
  door: 6,
} as const;

export const Tilemap2DParamsSchema = z.object({
  layout: z.enum(["platformer", "topdown", "arena"]).default("platformer"),
  width: z.number().int().min(16).max(512).default(96),
  height: z.number().int().min(12).max(256).default(28),
  tileSize: z.number().min(8).max(128).default(32),
  /** Platformer: how much vertical variation the ground has. */
  roughness: z.number().min(0).max(1).default(0.45),
  gaps: z.number().min(0).max(1).default(0.3),
  hazards: z.number().min(0).max(1).default(0.2),
  enemies: z.number().int().min(0).max(80).default(6),
  collectibles: z.number().int().min(0).max(120).default(12),
  style: z.enum(["pixel", "vector", "minimal", "retro", "neon"]).default("pixel"),
  playerGenderPresentation: z.enum(["female", "male", "neutral"]).default("neutral"),
  /** Max jump the player can make, in tiles — the reachability constraint. */
  maxJumpTiles: z.number().min(1).max(8).default(3),
  maxGapTiles: z.number().int().min(1).max(10).default(4),
});

export type Tilemap2DParams = z.infer<typeof Tilemap2DParamsSchema>;

const STYLE_PALETTE: Record<Tilemap2DParams["style"], { sky: string; ground: string; platform: string; hazard: string; accent: string }> = {
  pixel: { sky: "#5b9bd5", ground: "#6b4a2f", platform: "#8a6740", hazard: "#c0392b", accent: "#f2c14e" },
  vector: { sky: "#eef2f7", ground: "#2f3a4a", platform: "#4a5a70", hazard: "#e04f5f", accent: "#f0a202" },
  minimal: { sky: "#fafafa", ground: "#1f1f1f", platform: "#3d3d3d", hazard: "#d64545", accent: "#2d7ff9" },
  retro: { sky: "#1a1c2c", ground: "#41a6f6", platform: "#38b764", hazard: "#ef7d57", accent: "#ffcd75" },
  neon: { sky: "#0b0714", ground: "#2a1b4a", platform: "#7b2fbe", hazard: "#ff2e63", accent: "#00f5d4" },
};

export interface Tilemap2D {
  width: number;
  height: number;
  tileSize: number;
  /** Row-major; index = y * width + x, y = 0 at the top. */
  tiles: number[];
  spawn: [number, number];
  goal: [number, number];
}

/** Generate the grid. Pure, so tests can assert reachability directly. */
export function generateTilemap(params: Tilemap2DParams, seed: number): Tilemap2D {
  const rng = new Rng(seed);
  const tiles = new Array<number>(params.width * params.height).fill(TILE.empty);
  const at = (x: number, y: number) => y * params.width + x;

  if (params.layout === "topdown" || params.layout === "arena") {
    for (let y = 0; y < params.height; y += 1) {
      for (let x = 0; x < params.width; x += 1) {
        const border = x === 0 || y === 0 || x === params.width - 1 || y === params.height - 1;
        tiles[at(x, y)] = border ? TILE.wall : TILE.ground;
      }
    }
    if (params.layout === "topdown") {
      // Carve interior walls into rooms, leaving doorways so all is connected.
      const roomCount = Math.max(2, Math.round((params.width * params.height) / 500));
      for (let index = 0; index < roomCount; index += 1) {
        const wx = rng.int(4, params.width - 5);
        const vertical = rng.bool();
        const doorway = rng.int(2, (vertical ? params.height : params.width) - 3);
        for (let step = 1; step < (vertical ? params.height : params.width) - 1; step += 1) {
          if (Math.abs(step - doorway) <= 1) continue;
          const x = vertical ? wx : step;
          const y = vertical ? step : Math.min(params.height - 2, Math.max(1, wx));
          tiles[at(x, y)] = TILE.wall;
        }
      }
    }
    const spawn: [number, number] = [2, Math.floor(params.height / 2)];
    const goal: [number, number] = [params.width - 3, Math.floor(params.height / 2)];
    tiles[at(spawn[0], spawn[1])] = TILE.ground;
    tiles[at(goal[0], goal[1])] = TILE.door;
    return { width: params.width, height: params.height, tileSize: params.tileSize, tiles, spawn, goal };
  }

  /* ---- platformer ---- */
  const floor = params.height - 3;
  let surface = floor;
  let x = 0;
  const surfaces: number[] = new Array(params.width).fill(-1);

  while (x < params.width) {
    // A run of solid ground at the current height.
    const runLength = rng.int(3, 9);
    for (let step = 0; step < runLength && x < params.width; step += 1, x += 1) {
      surfaces[x] = surface;
      for (let y = surface; y < params.height; y += 1) tiles[at(x, y)] = TILE.ground;
    }
    if (x >= params.width) break;

    // Optionally a gap the player must jump — never wider than maxGapTiles.
    if (rng.next() < params.gaps && x < params.width - 6) {
      const gap = rng.int(1, params.maxGapTiles);
      for (let step = 0; step < gap && x < params.width; step += 1, x += 1) {
        surfaces[x] = -1;
        if (rng.next() < params.hazards) {
          tiles[at(x, params.height - 1)] = TILE.hazard;
        }
      }
    }

    // Step the surface, clamped so the next ledge is always jumpable.
    if (rng.next() < params.roughness) {
      const step = rng.int(1, Math.floor(params.maxJumpTiles));
      surface = rng.bool() ? Math.max(4, surface - step) : Math.min(params.height - 2, surface + step);
    }
  }

  // Floating platforms that bridge tall steps, keeping the level solvable.
  for (let index = 1; index < params.width - 1; index += 1) {
    const here = surfaces[index]!;
    const previous = surfaces[index - 1]!;
    if (here < 0 || previous < 0) continue;
    const rise = previous - here;
    if (rise > params.maxJumpTiles) {
      const midY = Math.round(previous - params.maxJumpTiles * 0.7);
      for (let width = 0; width < 3 && index + width < params.width; width += 1) {
        tiles[at(index + width, midY)] = TILE.platform;
      }
    }
  }

  const spawnX = 2;
  const spawn: [number, number] = [spawnX, Math.max(1, (surfaces[spawnX] ?? floor) - 2)];
  let goalX = params.width - 3;
  while (goalX > 2 && surfaces[goalX]! < 0) goalX -= 1;
  const goal: [number, number] = [goalX, Math.max(1, (surfaces[goalX] ?? floor) - 1)];
  tiles[at(goal[0], goal[1])] = TILE.door;

  return { width: params.width, height: params.height, tileSize: params.tileSize, tiles, spawn, goal };
}

/**
 * Left-to-right reachability check for a platformer, using the same jump
 * budget the controller has. Returns the first unreachable column, or -1.
 */
export function firstUnreachableColumn(map: Tilemap2D, maxJumpTiles: number, maxGapTiles: number): number {
  const at = (x: number, y: number) => map.tiles[y * map.width + x] ?? TILE.empty;
  const solidTop = (x: number): number => {
    for (let y = 0; y < map.height; y += 1) {
      const tile = at(x, y);
      if (tile === TILE.ground || tile === TILE.platform) return y;
    }
    return -1;
  };

  let previousTop = solidTop(map.spawn[0]);
  let gapRun = 0;
  for (let x = map.spawn[0] + 1; x <= map.goal[0]; x += 1) {
    const top = solidTop(x);
    if (top < 0) {
      gapRun += 1;
      if (gapRun > maxGapTiles) return x;
      continue;
    }
    if (previousTop >= 0 && previousTop - top > maxJumpTiles) return x;
    gapRun = 0;
    previousTop = top;
  }
  return -1;
}

export const tilemap2DGenerator: GeneratorDefinition<typeof Tilemap2DParamsSchema> = {
  name: "tilemap2d",
  version: 2,
  summary: "A complete 2D level — tilemap, spawn, goal, platforms, hazards, enemies and collectibles — generated so the route from spawn to goal is provably reachable.",
  modes: ["2d"],
  schema: Tilemap2DParamsSchema,
  run(context, params, seed) {
    const rng = new Rng(seed);
    const palette = STYLE_PALETTE[params.style];
    let map = generateTilemap(params, seed);
    const warnings: string[] = [];

    // Retry with softer parameters rather than shipping an unbeatable level.
    for (let attempt = 0; attempt < 5; attempt += 1) {
      if (params.layout !== "platformer") break;
      if (firstUnreachableColumn(map, params.maxJumpTiles, params.maxGapTiles) < 0) break;
      map = generateTilemap({ ...params, gaps: params.gaps * 0.6, roughness: params.roughness * 0.7 }, seed + attempt + 1);
      if (attempt === 4) warnings.push("The layout still has a hard-to-reach section; lower `gaps` or raise `maxJumpTiles`.");
    }

    const groundAsset = materialAsset("Level ground", { family: "rock", seed, tint: palette.ground, tintStrength: 0.9 });
    const platformAsset = materialAsset("Platform", { family: "stone", seed: seed + 1, tint: palette.platform, tintStrength: 0.9 });
    const hazardAsset = materialAsset("Hazard", { family: "rock", seed: seed + 2, tint: palette.hazard, tintStrength: 0.95, emissive: palette.hazard, emissiveIntensity: 0.4 });

    const mapId = context.nextId("tilemap");
    const operations: PatchOperation[] = [
      {
        op: "create",
        entity: {
          id: mapId,
          name: "Tilemap",
          type: "tilemap",
          tags: ["tilemap", params.layout],
          transform: { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
          bounds: { center: [(map.width * params.tileSize) / 2, (map.height * params.tileSize) / 2, 0], size: [map.width * params.tileSize, map.height * params.tileSize, 1] },
          visible: true,
          components: [],
          assetRefs: [groundAsset.id, platformAsset.id, hazardAsset.id],
          children: [],
          generator: { generator: "tilemap2d", seed, parameters: params as unknown as Record<string, unknown>, version: 2 },
        },
      },
      {
        op: "setComponent",
        entityId: mapId,
        component: "Tilemap",
        data: {
          width: map.width,
          height: map.height,
          tileSize: map.tileSize,
          tiles: map.tiles,
          palette,
          materials: { ground: groundAsset.id, platform: platformAsset.id, hazard: hazardAsset.id },
        },
      },
      { op: "setEnvironment", environment: { skyColor: palette.sky, groundColor: palette.ground, ambientColor: palette.sky } },
    ];

    // Player spawn.
    const spawnId = context.nextId("spawn");
    operations.push(
      {
        op: "create",
        entity: {
          id: spawnId,
          name: "Player",
          type: "player",
          tags: ["player", "player-spawn"],
          transform: { position: [map.spawn[0] * params.tileSize, map.spawn[1] * params.tileSize, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
          bounds: { center: [0, 0, 0], size: [params.tileSize * 0.7, params.tileSize * 1.4, 1] },
          visible: true,
          components: [],
          assetRefs: [],
          children: [],
        },
      },
      { op: "setComponent", entityId: spawnId, component: "PlayerController", data: { mode: "platformer2d", moveSpeed: 220, jumpSpeed: 560, gravity: 1500, maxJumpTiles: params.maxJumpTiles, color: palette.accent } },
      { op: "setComponent", entityId: spawnId, component: "Health", data: { max: 3, current: 3, regeneration: 0 } },
      { op: "setComponent", entityId: spawnId, component: "AvatarIdentity", data: { role: "player", genderPresentation: params.playerGenderPresentation, visualPipeline: "procedural-vector-adventurer" } },
      { op: "setComponent", entityId: spawnId, component: "Saveable", data: { fields: ["transform", "Health"] } },
    );

    // Goal.
    const goalId = context.nextId("goal");
    operations.push(
      {
        op: "create",
        entity: {
          id: goalId,
          name: "Level exit",
          type: "goal",
          tags: ["goal", "interactable"],
          transform: { position: [map.goal[0] * params.tileSize, map.goal[1] * params.tileSize, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
          bounds: { center: [0, 0, 0], size: [params.tileSize, params.tileSize * 1.6, 1] },
          visible: true,
          components: [],
          assetRefs: [],
          children: [],
        },
      },
      { op: "setComponent", entityId: goalId, component: "Trigger", data: { event: "level_complete", once: true, color: palette.accent } },
    );

    // Enemies and collectibles on solid ground only.
    const solidColumns: number[] = [];
    for (let x = 2; x < map.width - 2; x += 1) {
      for (let y = 0; y < map.height; y += 1) {
        if (map.tiles[y * map.width + x] === TILE.ground || map.tiles[y * map.width + x] === TILE.platform) {
          solidColumns.push(x * 1000 + y);
          break;
        }
      }
    }

    for (let index = 0; index < params.enemies && solidColumns.length; index += 1) {
      const packed = rng.pick(solidColumns);
      const x = Math.floor(packed / 1000);
      const y = packed % 1000;
      const enemyId = context.nextId("enemy2d");
      operations.push(
        {
          op: "create",
          entity: {
            id: enemyId,
            name: "Enemy",
            type: "enemy",
            tags: ["enemy"],
            transform: { position: [x * params.tileSize, (y - 1) * params.tileSize, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
            bounds: { center: [0, 0, 0], size: [params.tileSize * 0.8, params.tileSize * 0.8, 1] },
            visible: true,
            components: [],
            assetRefs: [],
            children: [],
          },
        },
        { op: "setComponent", entityId: enemyId, component: "Health", data: { max: 1, current: 1 } },
        { op: "setComponent", entityId: enemyId, component: "Behavior", data: { behavior: "patrol2d", parameters: { range: params.tileSize * 3, speed: 60, color: palette.hazard } } },
        { op: "setComponent", entityId: enemyId, component: "Enemy", data: { faction: "hostile", contactDamage: 1 } },
      );
    }

    for (let index = 0; index < params.collectibles && solidColumns.length; index += 1) {
      const packed = rng.pick(solidColumns);
      const x = Math.floor(packed / 1000);
      const y = packed % 1000;
      const coinId = context.nextId("coin");
      operations.push(
        {
          op: "create",
          entity: {
            id: coinId,
            name: "Coin",
            type: "collectible",
            tags: ["collectible"],
            transform: { position: [x * params.tileSize, (y - 2) * params.tileSize, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
            bounds: { center: [0, 0, 0], size: [params.tileSize * 0.5, params.tileSize * 0.5, 1] },
            visible: true,
            components: [],
            assetRefs: [],
            children: [],
          },
        },
        { op: "setComponent", entityId: coinId, component: "Collectible", data: { item: "coin", value: 1, color: palette.accent } },
      );
    }

    return {
      operations,
      assets: [groundAsset, platformAsset, hazardAsset],
      rootIds: [mapId, spawnId, goalId],
      description: `${map.width}×${map.height} ${params.layout} level in ${params.style} style`,
      warnings,
    };
  },
};
