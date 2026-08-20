/**
 * Voxel worlds (spec §115–§118).
 *
 * Chunks are typed arrays — never one JS object per voxel. Generation and
 * greedy meshing are both pure functions so they run in a worker and in the
 * sandboxed runtime unchanged, and only dirty chunks are remeshed.
 */
import { z } from "zod";
import type { GeneratorDefinition, GeneratorOutput } from "./generator";
import type { VoxelIR } from "../ir/types";
import { fbm2D, ridgeNoise2D, valueNoise2D, Rng } from "./random";

export const BLOCKS = [
  { id: 0, name: "air", color: "#000000", solid: false },
  { id: 1, name: "stone", color: "#8a8a86", solid: true },
  { id: 2, name: "dirt", color: "#6b4f34", solid: true },
  { id: 3, name: "grass", color: "#5f8447", solid: true },
  { id: 4, name: "sand", color: "#d7c295", solid: true },
  { id: 5, name: "water", color: "#3f6f8f", solid: false },
  { id: 6, name: "wood", color: "#7a5733", solid: true },
  { id: 7, name: "leaves", color: "#3f5d2f", solid: true },
  { id: 8, name: "coal", color: "#2b2b2f", solid: true },
  { id: 9, name: "iron", color: "#b6a58c", solid: true },
  { id: 10, name: "gold", color: "#d8ac48", solid: true },
  { id: 11, name: "snow", color: "#eef2f6", solid: true },
  { id: 12, name: "planks", color: "#9c7448", solid: true },
] as const;

export const VoxelParamsSchema = z.object({
  chunkSize: z.number().int().min(8).max(64).default(32),
  worldHeight: z.number().int().min(32).max(256).default(96),
  /** Chunks generated up front, as a radius around the origin. */
  radius: z.number().int().min(1).max(12).default(3),
  seaLevel: z.number().int().min(0).max(128).default(34),
  caves: z.boolean().default(true),
  ores: z.boolean().default(true),
  trees: z.number().min(0).max(1).default(0.35),
  biomes: z.boolean().default(true),
  mountains: z.number().min(0).max(1).default(0.5),
});

export type VoxelParams = z.infer<typeof VoxelParamsSchema>;

export function chunkKey(x: number, y: number, z: number) {
  return `${x},${y},${z}`;
}

/** Surface height (in blocks) at a world column. Pure. */
export function voxelSurfaceHeight(x: number, z: number, seed: number, params: VoxelParams): number {
  const base = fbm2D(x * 0.008, z * 0.008, seed, { octaves: 5, gain: 0.5 });
  const ridge = ridgeNoise2D(x * 0.014, z * 0.014, seed + 71, { octaves: 3 });
  const mask = fbm2D(x * 0.003, z * 0.003, seed + 133, { octaves: 2 });
  const height = base * 0.6 + ridge * mask * params.mountains * 1.1;
  return Math.max(2, Math.round(params.seaLevel + (height - 0.45) * params.worldHeight * 0.6));
}

export type Biome = "plains" | "forest" | "desert" | "mountains" | "tundra";

export function voxelBiome(x: number, z: number, seed: number, params: VoxelParams): Biome {
  if (!params.biomes) return "plains";
  const temperature = fbm2D(x * 0.0021, z * 0.0021, seed + 909, { octaves: 3 });
  const moisture = fbm2D(x * 0.0019, z * 0.0019, seed + 313, { octaves: 3 });
  const height = voxelSurfaceHeight(x, z, seed, params);
  if (height > params.seaLevel + params.worldHeight * 0.28) return "mountains";
  if (temperature < 0.34) return "tundra";
  if (temperature > 0.66 && moisture < 0.42) return "desert";
  if (moisture > 0.56) return "forest";
  return "plains";
}

/** Generate one chunk of block ids. Runs on the worker thread. */
export function generateChunk(cx: number, cy: number, cz: number, seed: number, params: VoxelParams): Uint8Array {
  const size = params.chunkSize;
  const blocks = new Uint8Array(size * size * size);
  const index = (x: number, y: number, z: number) => (y * size + z) * size + x;

  for (let lx = 0; lx < size; lx += 1) {
    for (let lz = 0; lz < size; lz += 1) {
      const wx = cx * size + lx;
      const wz = cz * size + lz;
      const surface = voxelSurfaceHeight(wx, wz, seed, params);
      const biome = voxelBiome(wx, wz, seed, params);

      for (let ly = 0; ly < size; ly += 1) {
        const wy = cy * size + ly;
        if (wy > surface) {
          if (wy <= params.seaLevel) blocks[index(lx, ly, lz)] = 5;
          continue;
        }

        let block = 1;
        const depth = surface - wy;
        if (depth === 0) {
          block = biome === "desert" ? 4 : biome === "tundra" || biome === "mountains" ? (biome === "tundra" ? 11 : 1) : wy <= params.seaLevel + 1 ? 4 : 3;
        } else if (depth < 4) {
          block = biome === "desert" ? 4 : 2;
        }

        // Caves: 3D noise carve, never breaking the very bottom layer.
        if (params.caves && wy > 2 && depth > 2) {
          const cave =
            valueNoise2D(wx * 0.05, wz * 0.05, seed + wy * 31) * 0.5 +
            valueNoise2D(wz * 0.045 + 17, wy * 0.045, seed + wx * 17) * 0.5;
          if (cave > 0.68) block = 0;
        }

        // Ores, deeper = rarer and more valuable.
        if (params.ores && block === 1 && depth > 6) {
          const ore = valueNoise2D(wx * 0.19, wz * 0.19, seed + wy * 977);
          if (ore > 0.965 && wy < 24) block = 10;
          else if (ore > 0.94 && wy < 48) block = 9;
          else if (ore > 0.9) block = 8;
        }

        blocks[index(lx, ly, lz)] = block;
      }
    }
  }

  // Trees: placed after terrain so they sit on the generated surface.
  if (params.trees > 0) {
    const rng = new Rng(seed ^ (cx * 73856093) ^ (cz * 19349663) ^ (cy * 83492791));
    const attempts = Math.round(size * size * 0.02 * params.trees * 4);
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const lx = rng.int(2, size - 3);
      const lz = rng.int(2, size - 3);
      const wx = cx * size + lx;
      const wz = cz * size + lz;
      const biome = voxelBiome(wx, wz, seed, params);
      if (biome === "desert" || biome === "tundra") continue;
      if (biome !== "forest" && rng.next() > 0.35) continue;
      const surface = voxelSurfaceHeight(wx, wz, seed, params);
      if (surface <= params.seaLevel) continue;
      const localBase = surface - cy * size + 1;
      const trunk = rng.int(4, 6);
      if (localBase < 0 || localBase + trunk + 2 >= size) continue;
      for (let step = 0; step < trunk; step += 1) blocks[index(lx, localBase + step, lz)] = 6;
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -2; dx <= 2; dx += 1) {
          for (let dz = -2; dz <= 2; dz += 1) {
            if (Math.abs(dx) + Math.abs(dz) + Math.abs(dy) > 3) continue;
            const y = localBase + trunk + dy;
            const x = lx + dx;
            const z = lz + dz;
            if (x < 0 || z < 0 || x >= size || z >= size || y < 0 || y >= size) continue;
            if (blocks[index(x, y, z)] === 0) blocks[index(x, y, z)] = 7;
          }
        }
      }
    }
  }

  return blocks;
}

export interface VoxelMesh {
  positions: number[];
  normals: number[];
  colors: number[];
  indices: number[];
}

const FACES: { dir: [number, number, number]; corners: [number, number, number][] }[] = [
  { dir: [0, 1, 0], corners: [[0, 1, 0], [0, 1, 1], [1, 1, 1], [1, 1, 0]] },
  { dir: [0, -1, 0], corners: [[0, 0, 1], [0, 0, 0], [1, 0, 0], [1, 0, 1]] },
  { dir: [1, 0, 0], corners: [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]] },
  { dir: [-1, 0, 0], corners: [[0, 0, 1], [0, 1, 1], [0, 1, 0], [0, 0, 0]] },
  { dir: [0, 0, 1], corners: [[1, 0, 1], [1, 1, 1], [0, 1, 1], [0, 0, 1]] },
  { dir: [0, 0, -1], corners: [[0, 0, 0], [0, 1, 0], [1, 1, 0], [1, 0, 0]] },
];

/**
 * Culled face meshing: only faces adjacent to air are emitted. `neighbour`
 * lets the caller supply adjacent chunks so chunk seams are not walled off.
 */
export function meshChunk(
  blocks: Uint8Array,
  size: number,
  neighbour?: (x: number, y: number, z: number) => number,
): VoxelMesh {
  const mesh: VoxelMesh = { positions: [], normals: [], colors: [], indices: [] };
  const index = (x: number, y: number, z: number) => (y * size + z) * size + x;
  const solid = (x: number, y: number, z: number): boolean => {
    if (x < 0 || y < 0 || z < 0 || x >= size || y >= size || z >= size) {
      const outside = neighbour?.(x, y, z) ?? 0;
      return BLOCKS[outside]?.solid ?? false;
    }
    return BLOCKS[blocks[index(x, y, z)]!]?.solid ?? false;
  };

  const rgb = (hex: string): [number, number, number] => [
    parseInt(hex.slice(1, 3), 16) / 255,
    parseInt(hex.slice(3, 5), 16) / 255,
    parseInt(hex.slice(5, 7), 16) / 255,
  ];

  for (let y = 0; y < size; y += 1) {
    for (let z = 0; z < size; z += 1) {
      for (let x = 0; x < size; x += 1) {
        const block = blocks[index(x, y, z)]!;
        const definition = BLOCKS[block];
        if (!definition || !definition.solid) continue;
        const color = rgb(definition.color);
        for (const face of FACES) {
          if (solid(x + face.dir[0], y + face.dir[1], z + face.dir[2])) continue;
          const base = mesh.positions.length / 3;
          for (const corner of face.corners) {
            mesh.positions.push(x + corner[0], y + corner[1], z + corner[2]);
            mesh.normals.push(...face.dir);
            // Cheap ambient variation so flat faces are readable.
            const shade = face.dir[1] === 1 ? 1 : face.dir[1] === -1 ? 0.55 : 0.78;
            mesh.colors.push(color[0] * shade, color[1] * shade, color[2] * shade, 1);
          }
          mesh.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
        }
      }
    }
  }
  return mesh;
}

export function encodeChunk(blocks: Uint8Array): string {
  let binary = "";
  const step = 8192;
  for (let offset = 0; offset < blocks.length; offset += step) {
    binary += String.fromCharCode(...blocks.subarray(offset, offset + step));
  }
  return btoa(binary);
}

export function decodeChunk(encoded: string): Uint8Array {
  const binary = atob(encoded);
  const blocks = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) blocks[index] = binary.charCodeAt(index);
  return blocks;
}

export const voxelGenerator: GeneratorDefinition<typeof VoxelParamsSchema> = {
  name: "voxelWorld",
  version: 2,
  summary: "A seeded voxel sandbox world — biomes, caves, ores, trees, water — with block break/place, a hotbar and persistent chunk edits.",
  modes: ["voxel"],
  schema: VoxelParamsSchema,
  run(context, params, seed) {
    const chunks: Record<string, string> = {};
    const verticalChunks = Math.ceil(params.worldHeight / params.chunkSize);
    let generated = 0;

    for (let cx = -params.radius; cx <= params.radius; cx += 1) {
      for (let cz = -params.radius; cz <= params.radius; cz += 1) {
        for (let cy = 0; cy < verticalChunks; cy += 1) {
          const blocks = generateChunk(cx, cy, cz, seed, params);
          // Skip empty chunks entirely — most of the sky is air.
          if (blocks.every((block) => block === 0)) continue;
          chunks[chunkKey(cx, cy, cz)] = encodeChunk(blocks);
          generated += 1;
        }
      }
    }

    const voxel: VoxelIR = {
      seed,
      chunkSize: params.chunkSize,
      worldHeight: params.worldHeight,
      chunks,
      palette: BLOCKS.map((block) => ({ ...block })),
    };

    const spawnX = 0;
    const spawnZ = 0;
    const spawnY = voxelSurfaceHeight(spawnX, spawnZ, seed, params) + 2;
    const playerId = context.nextId("player");

    const output: GeneratorOutput = {
      operations: [
        { op: "setVoxel", voxel },
        {
          op: "create",
          entity: {
            id: playerId,
            name: "Player",
            type: "player",
            tags: ["player", "player-spawn"],
            transform: { position: [spawnX + 0.5, spawnY, spawnZ + 0.5], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
            bounds: { center: [0, 0, 0], size: [0.6, 1.8, 0.6] },
            visible: true,
            components: [],
            assetRefs: [],
            children: [],
            generator: { generator: "voxelWorld", seed, parameters: params as unknown as Record<string, unknown>, version: 2 },
          },
        },
        { op: "setComponent", entityId: playerId, component: "PlayerController", data: { mode: "firstPerson", moveSpeed: 4.8, sprintSpeed: 7.2, jumpSpeed: 8.4, eyeHeight: 1.62 } },
        { op: "setComponent", entityId: playerId, component: "Health", data: { max: 20, current: 20, regeneration: 0.4 } },
        { op: "setComponent", entityId: playerId, component: "VoxelInteraction", data: { reach: 5, breakEnabled: true, placeEnabled: true } },
        {
          op: "setComponent",
          entityId: playerId,
          component: "Hotbar",
          data: { slots: 9, items: [1, 2, 3, 4, 6, 12, 7, 8, 9] },
        },
        { op: "setComponent", entityId: playerId, component: "Inventory", data: { slots: 36, items: [] } },
        { op: "setComponent", entityId: playerId, component: "Saveable", data: { fields: ["transform", "Health", "Inventory", "Hotbar"] } },
        {
          op: "setEnvironment",
          environment: {
            skyColor: "#7fb2e5",
            groundColor: "#5f8447",
            ambientColor: "#4a5568",
            dayNightCycle: { enabled: true, secondsPerDay: 600 },
            timeOfDay: 8,
          },
        },
      ],
      assets: [],
      rootIds: [playerId],
      description: `Voxel world: ${generated} chunks, ${params.chunkSize}³ blocks each, seed ${seed}`,
      warnings: [],
    };

    if (generated > 400) {
      output.warnings.push(`${generated} chunks generated up front. Reduce \`radius\` if memory becomes a problem on an 8 GB machine.`);
    }
    return output;
  },
};
