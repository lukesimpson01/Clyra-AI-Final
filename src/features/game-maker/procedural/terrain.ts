/**
 * Tiled terrain (spec §89–§91).
 *
 * Terrain is a heightfield split into fixed-size tiles. Nothing ever builds
 * one giant mesh: a 4 km world is 1024 tiles, only the visible ones are
 * meshed, and an edit dirties a handful of tiles rather than the world.
 *
 * `generateTile` is pure and dependency-free so it runs unchanged on the
 * main thread, inside the terrain worker, and inside the sandboxed runtime.
 */
import { z } from "zod";
import type { GeneratorDefinition, GeneratorOutput } from "./generator";
import type { TerrainIR } from "../ir/types";
import { fbm2D, ridgeNoise2D, valueNoise2D } from "./random";
import { materialAsset } from "./materials";

export const TerrainParamsSchema = z.object({
  size: z.number().min(64).max(8192).default(1024),
  tileSize: z.number().min(16).max(256).default(128),
  maxHeight: z.number().min(1).max(600).default(90),
  /** 0 = plains, 1 = alpine. */
  mountains: z.number().min(0).max(1).default(0.5),
  /** Smooths valleys and carves drainage. */
  erosion: z.number().min(0).max(1).default(0.35),
  rivers: z.number().int().min(0).max(8).default(0),
  waterLevel: z.number().min(-100).max(200).default(0),
  /** Flat ring around the origin — somewhere for a settlement to sit. */
  plateauRadius: z.number().min(0).max(2000).default(0),
  biome: z.enum(["temperate", "desert", "arctic", "volcanic", "alien"]).default("temperate"),
});

export type TerrainParams = z.infer<typeof TerrainParamsSchema>;

export const TERRAIN_RESOLUTION = 33; // 32 quads + 1 shared edge vertex.

/** Height at a world position. Pure function of (x, z, seed, params). */
export function terrainHeightAt(x: number, z: number, seed: number, params: TerrainParams): number {
  const scale = 1 / Math.max(64, params.size / 8);
  const base = fbm2D(x * scale, z * scale, seed, { octaves: 5, gain: 0.52 });
  const ridged = ridgeNoise2D(x * scale * 1.7, z * scale * 1.7, seed + 101, { octaves: 4 });
  const mountainMask = Math.pow(fbm2D(x * scale * 0.35, z * scale * 0.35, seed + 55, { octaves: 3 }), 1.6);

  let height = base * (1 - params.mountains * 0.55) + ridged * mountainMask * params.mountains * 1.5;

  // Erosion pulls low ground lower and flattens the valley floors.
  if (params.erosion > 0) {
    const valley = Math.pow(height, 1 + params.erosion * 1.6);
    height = height * (1 - params.erosion) + valley * params.erosion;
  }

  height *= params.maxHeight;

  // River channels: each river is a noise-warped line carved into the field.
  for (let river = 0; river < params.rivers; river += 1) {
    const angle = (river / Math.max(1, params.rivers)) * Math.PI * 2 + seed * 0.001;
    const nx = Math.cos(angle);
    const nz = Math.sin(angle);
    const wander = (valueNoise2D(x * scale * 2.4 + river * 13, z * scale * 2.4, seed + river * 977) - 0.5) * params.size * 0.08;
    const along = Math.abs(x * nz - z * nx + wander);
    const width = params.size * 0.012 + 8;
    if (along < width) {
      const depth = (1 - along / width) ** 2;
      height -= depth * (params.maxHeight * 0.18 + 6);
    }
  }

  // Plateau: blend towards a flat build pad near the origin.
  if (params.plateauRadius > 0) {
    const distance = Math.hypot(x, z);
    const inner = params.plateauRadius;
    const outer = params.plateauRadius * 1.8;
    if (distance < outer) {
      const blend = distance <= inner ? 1 : 1 - (distance - inner) / (outer - inner);
      const smoothBlend = blend * blend * (3 - 2 * blend);
      height = height * (1 - smoothBlend) + params.waterLevel + 2 * smoothBlend;
    }
  }

  return height;
}

export interface TerrainTile {
  key: string;
  tileX: number;
  tileZ: number;
  resolution: number;
  heights: Float32Array;
  min: number;
  max: number;
}

export function tileKey(tileX: number, tileZ: number) {
  return `${tileX},${tileZ}`;
}

/** Generate one tile's heightfield. Safe to call in a worker. */
export function generateTile(tileX: number, tileZ: number, seed: number, params: TerrainParams): TerrainTile {
  const resolution = TERRAIN_RESOLUTION;
  const heights = new Float32Array(resolution * resolution);
  const step = params.tileSize / (resolution - 1);
  const originX = tileX * params.tileSize;
  const originZ = tileZ * params.tileSize;
  let min = Infinity;
  let max = -Infinity;

  for (let row = 0; row < resolution; row += 1) {
    for (let column = 0; column < resolution; column += 1) {
      const height = terrainHeightAt(originX + column * step, originZ + row * step, seed, params);
      heights[row * resolution + column] = height;
      if (height < min) min = height;
      if (height > max) max = height;
    }
  }
  return { key: tileKey(tileX, tileZ), tileX, tileZ, resolution, heights, min, max };
}

/** Bilinear sample of a generated tile set, for "sit this on the ground". */
export function makeHeightSampler(terrain: TerrainIR | undefined): ((x: number, z: number) => number | undefined) | undefined {
  if (!terrain) return undefined;
  const params = { ...(terrain.parameters as unknown as TerrainParams), size: terrain.size, tileSize: terrain.tileSize, maxHeight: terrain.maxHeight };
  return (x: number, z: number) => terrainHeightAt(x, z, terrain.seed, params);
}

export function encodeTile(tile: TerrainTile): string {
  const bytes = new Uint8Array(tile.heights.buffer, tile.heights.byteOffset, tile.heights.byteLength);
  let binary = "";
  for (let index = 0; index < bytes.length; index += 1) binary += String.fromCharCode(bytes[index]!);
  return btoa(binary);
}

export function decodeTile(encoded: string, resolution = TERRAIN_RESOLUTION): Float32Array {
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new Float32Array(bytes.buffer, 0, resolution * resolution);
}

const BIOME_GROUND: Record<TerrainParams["biome"], Parameters<typeof materialAsset>[1]["family"]> = {
  temperate: "grass",
  desert: "sand",
  arctic: "snow",
  volcanic: "rock",
  alien: "mud",
};

export const terrainGenerator: GeneratorDefinition<typeof TerrainParamsSchema> = {
  name: "terrain",
  version: 2,
  summary: "A tiled heightfield world with mountains, erosion, rivers, a water plane and an optional flat build plateau.",
  modes: ["3d"],
  schema: TerrainParamsSchema,
  run(context, params, seed) {
    const groundAsset = materialAsset("Terrain ground", { family: BIOME_GROUND[params.biome], seed });
    const rockAsset = materialAsset("Terrain rock", { family: "rock", seed: seed + 1 });
    const waterAsset = materialAsset("Water", { family: "water", seed: seed + 2 });

    const terrain: TerrainIR = {
      seed,
      size: params.size,
      tileSize: params.tileSize,
      maxHeight: params.maxHeight,
      generator: "terrain/v2",
      parameters: { ...params, groundMaterial: groundAsset.id, rockMaterial: rockAsset.id },
    };

    const output: GeneratorOutput = {
      operations: [{ op: "setTerrain", terrain }],
      assets: [groundAsset, rockAsset, waterAsset],
      rootIds: [],
      description: `${params.size}×${params.size}m ${params.biome} terrain (${Math.round(params.mountains * 100)}% mountainous, ${params.rivers} rivers)`,
      warnings: [],
    };

    // Water plane as a real entity, so it shows in the hierarchy and can be
    // selected, moved or removed like anything else.
    if (params.rivers > 0 || params.waterLevel > 0) {
      const waterId = context.nextId("water");
      output.operations.push(
        {
          op: "create",
          entity: {
            id: waterId,
            name: "Water",
            type: "water",
            tags: ["water", "environment"],
            transform: { position: [0, params.waterLevel, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
            bounds: { center: [0, 0, 0], size: [params.size, 0.2, params.size] },
            visible: true,
            components: [],
            assetRefs: [waterAsset.id],
            children: [],
          },
        },
        {
          op: "setComponent",
          entityId: waterId,
          component: "WaterPlane",
          data: { size: params.size, material: waterAsset.id, level: params.waterLevel },
        },
      );
      output.rootIds.push(waterId);
    }

    // Terrain bounds double as the default navigation bounds.
    output.operations.push({
      op: "setSceneMetadata",
      metadata: { terrainBounds: { min: [-params.size / 2, -params.maxHeight, -params.size / 2], max: [params.size / 2, params.maxHeight, params.size / 2] } },
    });

    if (params.size > 4096 && params.tileSize < 128) {
      output.warnings.push("A world this large with small tiles produces thousands of tiles; raise tileSize to keep tile counts manageable.");
    }
    return output;
  },
};
