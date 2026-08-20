/**
 * Parametric building system (spec §85, §86).
 *
 * Buildings are generated through a fixed pipeline — footprint → frame →
 * walls → openings → roof → trim → materials → collision — so the same
 * parameters always produce the same building, and changing one parameter
 * (floors, roof, width) regenerates it coherently instead of patching
 * hundreds of wall entities.
 */
import { z } from "zod";
import type { GeneratorDefinition, GeneratorOutput } from "./generator";
import { dedupeAssets, meshEntityOps } from "./generator";
import type { MeshPart, MeshSpec } from "./mesh";
import { part, polygonRing, rectangleFootprint } from "./mesh";
import { Rng } from "./random";
import { materialAsset, type MaterialFamily } from "./materials";

export const BuildingKindSchema = z.enum([
  "house",
  "shop",
  "inn",
  "blacksmith",
  "barn",
  "warehouse",
  "temple",
  "tower",
  "gatehouse",
  "keep",
  "hut",
]);

export type BuildingKind = z.infer<typeof BuildingKindSchema>;

export const RoofSchema = z.enum(["gable", "hip", "flat", "conical", "domed"]);

export const BuildingParamsSchema = z.object({
  kind: BuildingKindSchema.default("house"),
  width: z.number().min(2).max(60).default(8),
  depth: z.number().min(2).max(60).default(11),
  floors: z.number().int().min(1).max(8).default(1),
  floorHeight: z.number().min(1.8).max(8).default(3),
  roof: RoofSchema.default("gable"),
  /** 0 = pristine, 1 = ruin: removes walls, tilts the roof, weathers materials. */
  condition: z.number().min(0).max(1).default(1),
  balcony: z.boolean().default(false),
  chimney: z.boolean().default(false),
  porch: z.boolean().default(false),
  /** Round buildings ignore width/depth and use `radius`. */
  round: z.boolean().default(false),
  radius: z.number().min(1.5).max(30).default(4),
  materials: z
    .object({
      walls: z.string().optional(),
      roof: z.string().optional(),
      trim: z.string().optional(),
      floor: z.string().optional(),
    })
    .default({}),
  /** Generate walkable interior floors and a doorway you can enter. */
  interior: z.boolean().default(true),
});

export type BuildingParams = z.infer<typeof BuildingParamsSchema>;

interface KindDefault {
  walls: MaterialFamily;
  roofMaterial: MaterialFamily;
  trim: MaterialFamily;
  width?: number;
  depth?: number;
  floors?: number;
  floorHeight?: number;
  roof?: BuildingParams["roof"];
  round?: boolean;
  chimney?: boolean;
}

/**
 * Per-kind defaults. These fill in only the fields the caller left at the
 * schema default, so `{ kind: "tower", floors: 7 }` still gets a round stone
 * tower — with seven floors.
 */
const KIND_DEFAULTS: Record<BuildingKind, KindDefault> = {
  house: { walls: "plaster", roofMaterial: "clay_tiles", trim: "dark_wood" },
  shop: { walls: "plaster", roofMaterial: "clay_tiles", trim: "wood", floors: 2 },
  inn: { walls: "plaster", roofMaterial: "thatch", trim: "dark_wood", floors: 2, width: 12, depth: 14 },
  blacksmith: { walls: "stone", roofMaterial: "clay_tiles", trim: "iron", width: 9, depth: 10, chimney: true },
  barn: { walls: "wood", roofMaterial: "thatch", trim: "dark_wood", width: 12, depth: 18, roof: "gable" },
  warehouse: { walls: "stone", roofMaterial: "clay_tiles", trim: "iron", width: 16, depth: 22, roof: "flat" },
  temple: { walls: "stone", roofMaterial: "clay_tiles", trim: "gold", width: 14, depth: 20, floorHeight: 5, roof: "domed" },
  tower: { walls: "stone", roofMaterial: "clay_tiles", trim: "iron", round: true, floors: 4, roof: "conical" },
  gatehouse: { walls: "stone", roofMaterial: "clay_tiles", trim: "iron", width: 10, depth: 6, floors: 2, roof: "flat" },
  keep: { walls: "weathered_stone", roofMaterial: "clay_tiles", trim: "iron", width: 18, depth: 18, floors: 3, floorHeight: 4, roof: "flat" },
  hut: { walls: "mud", roofMaterial: "thatch", trim: "wood", width: 5, depth: 5, floors: 1 },
};

const WALL_THICKNESS = 0.35;

function wallParts(params: BuildingParams, height: number, materials: { walls: string; trim: string }, rng: Rng): MeshPart[] {
  const parts: MeshPart[] = [];
  const ruined = params.condition < 0.75;

  if (params.round) {
    const sides = Math.max(6, Math.round(params.radius * 2));
    parts.push(
      part("extrude", [0, height / 2, 0], [params.radius * 2, height, params.radius * 2], materials.walls, {
        polygon: polygonRing(sides, params.radius),
      }),
    );
    return parts;
  }

  const hw = params.width / 2;
  const hd = params.depth / 2;
  // Four walls as slabs, so a ruined building can drop individual ones.
  const walls: { offset: [number, number, number]; size: [number, number, number] }[] = [
    { offset: [0, height / 2, -hd], size: [params.width, height, WALL_THICKNESS] },
    { offset: [0, height / 2, hd], size: [params.width, height, WALL_THICKNESS] },
    { offset: [-hw, height / 2, 0], size: [WALL_THICKNESS, height, params.depth] },
    { offset: [hw, height / 2, 0], size: [WALL_THICKNESS, height, params.depth] },
  ];
  for (let index = 0; index < walls.length; index += 1) {
    const wall = walls[index]!;
    if (ruined && rng.next() > params.condition + 0.25) {
      // A collapsed wall: keep a stub so the ruin still reads as a building.
      const stub = height * rng.range(0.2, 0.55);
      parts.push(part("box", [wall.offset[0], stub / 2, wall.offset[2]], [wall.size[0], stub, wall.size[2]], materials.walls));
      continue;
    }
    parts.push(part("box", wall.offset, wall.size, materials.walls));
  }

  // Corner posts read as timber framing and hide the wall seams.
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      parts.push(part("box", [sx * hw, height / 2, sz * hd], [0.32, height, 0.32], materials.trim));
    }
  }
  return parts;
}

function openingParts(params: BuildingParams, materials: { trim: string; glass: string }, rng: Rng): MeshPart[] {
  const parts: MeshPart[] = [];
  if (params.round) return parts;
  const hd = params.depth / 2;
  const hw = params.width / 2;

  // Door on the -Z face, centred; the runtime looks for the Door component.
  parts.push(part("box", [0, 1.05, -hd - 0.06], [1.2, 2.1, 0.14], materials.trim));

  // Windows: one per 3m of façade per floor, skipping the door slot.
  const perSide = Math.max(1, Math.floor(params.width / 3.2));
  for (let floor = 0; floor < params.floors; floor += 1) {
    const y = floor * params.floorHeight + params.floorHeight * 0.58;
    for (let index = 0; index < perSide; index += 1) {
      const x = -hw + ((index + 0.5) / perSide) * params.width;
      if (floor === 0 && Math.abs(x) < 1.1) continue;
      if (rng.next() > params.condition * 0.9 + 0.1) continue;
      for (const [z, depth] of [[-hd - 0.05, 0.12] as const, [hd + 0.05, 0.12] as const]) {
        parts.push(part("box", [x, y, z], [0.95, 1.15, depth], materials.glass, { noCollision: true }));
        parts.push(part("box", [x, y, z], [1.15, 1.35, depth * 0.6], materials.trim, { noCollision: true }));
      }
    }
    // Side windows.
    for (const sx of [-1, 1]) {
      if (rng.next() > 0.6) continue;
      parts.push(part("box", [sx * (hw + 0.05), y, 0], [0.12, 1.15, 0.95], materials.glass, { noCollision: true }));
    }
  }
  return parts;
}

function roofParts(params: BuildingParams, wallTop: number, materials: { roof: string; trim: string }, rng: Rng): MeshPart[] {
  const parts: MeshPart[] = [];
  const overhang = 0.45;
  const tilt = params.condition < 0.6 ? rng.range(-6, 6) : 0;

  switch (params.roof) {
    case "flat":
      parts.push(part("box", [0, wallTop + 0.16, 0], [params.width + overhang, 0.32, params.depth + overhang], materials.roof));
      // Crenellations make a flat roof read as a keep rather than a crate.
      if (params.kind === "keep" || params.kind === "gatehouse") {
        const merlons = Math.max(3, Math.floor(params.width / 1.4));
        for (let index = 0; index < merlons; index += 1) {
          const x = -params.width / 2 + ((index + 0.5) / merlons) * params.width;
          for (const sz of [-1, 1]) {
            parts.push(part("box", [x, wallTop + 0.75, (sz * (params.depth + overhang)) / 2], [0.7, 0.9, 0.4], materials.roof));
          }
        }
      }
      break;
    case "conical":
      parts.push(
        part("cone", [0, wallTop + params.radius * 0.65, 0], [params.radius * 2.3, params.radius * 1.3, params.radius * 2.3], materials.roof, {
          rotation: [tilt, 0, 0],
        }),
      );
      break;
    case "domed":
      parts.push(
        part("sphere", [0, wallTop, 0], [Math.min(params.width, params.depth) * 0.95, Math.min(params.width, params.depth) * 0.95, Math.min(params.width, params.depth) * 0.95], materials.roof),
      );
      break;
    case "hip":
      parts.push(
        part("prism", [0, wallTop + params.width * 0.2, 0], [params.width + overhang, params.width * 0.4, params.depth * 0.75], materials.roof, {
          rotation: [tilt, 0, 0],
        }),
      );
      parts.push(part("box", [0, wallTop + 0.1, 0], [params.width + overhang, 0.2, params.depth + overhang], materials.trim));
      break;
    case "gable":
    default:
      parts.push(
        part("prism", [0, wallTop + params.width * 0.22, 0], [params.width + overhang, params.width * 0.44, params.depth + overhang], materials.roof, {
          rotation: [tilt, 0, 0],
        }),
      );
      break;
  }
  return parts;
}

function interiorParts(params: BuildingParams, materials: { floor: string; trim: string }): MeshPart[] {
  const parts: MeshPart[] = [];
  if (!params.interior) return parts;
  const inner = params.round
    ? { width: params.radius * 1.8, depth: params.radius * 1.8 }
    : { width: params.width - WALL_THICKNESS * 2, depth: params.depth - WALL_THICKNESS * 2 };

  for (let floor = 0; floor < params.floors; floor += 1) {
    const y = floor * params.floorHeight;
    parts.push(part("box", [0, y + 0.06, 0], [inner.width, 0.12, inner.depth], materials.floor));
    if (floor > 0) {
      // A simple straight stair up to this floor, so the interior is reachable.
      const steps = Math.max(4, Math.round(params.floorHeight / 0.24));
      for (let step = 0; step < steps; step += 1) {
        const height = ((step + 1) / steps) * params.floorHeight;
        parts.push(
          part(
            "box",
            [inner.width / 2 - 0.9, y - params.floorHeight + height / 2, -inner.depth / 2 + 0.5 + step * 0.28],
            [1.4, height, 0.28],
            materials.trim,
          ),
        );
      }
    }
  }
  return parts;
}

export const buildingGenerator: GeneratorDefinition<typeof BuildingParamsSchema> = {
  name: "building",
  version: 3,
  summary: "One parametric building — house, shop, inn, tower, keep, temple — with walls, openings, roof, interior floors and collision.",
  modes: ["3d"],
  schema: BuildingParamsSchema,
  run(context, rawParams, seed) {
    const rng = new Rng(seed);
    const defaults = KIND_DEFAULTS[rawParams.kind] ?? KIND_DEFAULTS.house;
    const params: BuildingParams = {
      ...rawParams,
      // Kind defaults only fill in what the caller left at the schema default.
      width: rawParams.width === 8 ? (defaults.width ?? 8) : rawParams.width,
      depth: rawParams.depth === 11 ? (defaults.depth ?? 11) : rawParams.depth,
      floors: rawParams.floors === 1 ? (defaults.floors ?? 1) : rawParams.floors,
      floorHeight: rawParams.floorHeight === 3 ? (defaults.floorHeight ?? 3) : rawParams.floorHeight,
      roof: rawParams.roof === "gable" && defaults.roof ? defaults.roof : rawParams.roof,
      round: rawParams.round || Boolean(defaults.round),
      chimney: rawParams.chimney || Boolean(defaults.chimney),
    };

    const weathering = 1 - params.condition;
    const wallAsset = materialAsset(`${params.kind} walls`, { family: (params.materials.walls as MaterialFamily) ?? defaults.walls, seed: seed + 1, weathering });
    const roofAsset = materialAsset(`${params.kind} roof`, { family: (params.materials.roof as MaterialFamily) ?? defaults.roofMaterial, seed: seed + 2, weathering });
    const trimAsset = materialAsset(`${params.kind} trim`, { family: (params.materials.trim as MaterialFamily) ?? defaults.trim, seed: seed + 3, weathering });
    const floorAsset = materialAsset(`${params.kind} floor`, { family: (params.materials.floor as MaterialFamily) ?? "wood", seed: seed + 4, weathering });
    const glassAsset = materialAsset("window glass", { family: "glass", seed: seed + 5 });

    const materials = {
      walls: wallAsset.id,
      roof: roofAsset.id,
      trim: trimAsset.id,
      floor: floorAsset.id,
      glass: glassAsset.id,
    };

    const wallTop = params.floors * params.floorHeight;
    const parts: MeshPart[] = [
      // Foundation plinth: stops buildings floating on uneven ground.
      part("box", [0, -0.25, 0], [(params.round ? params.radius * 2 : params.width) + 0.5, 0.5, (params.round ? params.radius * 2 : params.depth) + 0.5], materials.trim),
      ...interiorParts(params, { floor: materials.floor, trim: materials.trim }),
      ...wallParts(params, wallTop, { walls: materials.walls, trim: materials.trim }, rng),
      ...openingParts(params, { trim: materials.trim, glass: materials.glass }, rng),
      ...roofParts(params, wallTop, { roof: materials.roof, trim: materials.trim }, rng),
    ];

    if (params.chimney) {
      parts.push(part("box", [params.width / 2 - 0.9, wallTop + params.width * 0.3, 0], [0.8, params.width * 0.6, 0.8], materials.walls));
    }
    if (params.balcony) {
      const y = (params.floors - 1) * params.floorHeight + 0.2;
      parts.push(part("box", [0, y, params.depth / 2 + 0.9], [params.width * 0.6, 0.18, 1.8], materials.trim));
      parts.push(part("box", [0, y + 0.55, params.depth / 2 + 1.75], [params.width * 0.6, 1.1, 0.12], materials.trim, { noCollision: true }));
      for (const sx of [-1, 1]) {
        parts.push(part("box", [(sx * params.width * 0.6) / 2, y + 0.55, params.depth / 2 + 0.9], [0.12, 1.1, 1.8], materials.trim, { noCollision: true }));
      }
    }
    if (params.porch) {
      parts.push(part("box", [0, 2.5, -params.depth / 2 - 1.2], [params.width * 0.7, 0.16, 2.4], materials.trim));
      for (const sx of [-1, 1]) {
        parts.push(part("box", [(sx * params.width * 0.7) / 2 - sx * 0.2, 1.25, -params.depth / 2 - 2.2], [0.22, 2.5, 0.22], materials.trim));
      }
    }

    const spec: MeshSpec = { parts };
    const rootId = context.nextId(params.kind);
    const groundY = context.sampleHeight?.(0, 0);
    const generator = { generator: "building", seed, parameters: params as unknown as Record<string, unknown>, version: 3 };

    const operations = meshEntityOps({
      id: rootId,
      name: `${params.kind[0]!.toUpperCase()}${params.kind.slice(1)}`,
      type: "building",
      position: [0, groundY ?? 0, 0],
      spec,
      tags: ["building", params.kind, ...(params.condition < 0.6 ? ["ruin"] : [])],
      generator,
      collision: "static",
      navigation: "obstacle",
    });

    // A door the player can actually open: a child entity with the interaction
    // components the runtime binds to the `interact` action.
    if (params.interior && !params.round) {
      const doorId = context.nextId(`${params.kind}-door`);
      operations.push(
        {
          op: "create",
          parentId: rootId,
          entity: {
            id: doorId,
            name: "Door",
            type: "door",
            tags: ["door", "interactable"],
            transform: { position: [0, 1.05, -params.depth / 2], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
            bounds: { center: [0, 0, 0], size: [1.2, 2.1, 0.2] },
            visible: true,
            components: [],
            assetRefs: [],
            children: [],
          },
        },
        { op: "setComponent", entityId: doorId, component: "ProceduralMesh", data: { spec: { parts: [part("box", [0, 0, 0], [1.15, 2.05, 0.12], materials.trim)] } as unknown as Record<string, unknown> } },
        { op: "setComponent", entityId: doorId, component: "Door", data: { open: false, swingDegrees: 95, speed: 3.2 } },
        { op: "setComponent", entityId: doorId, component: "Interactable", data: { prompt: "Open door", action: "interact", range: 3.2 } },
        { op: "setComponent", entityId: doorId, component: "Collider", data: { shape: "box", body: "static" } },
        // A door is something you stand in front of, never on top of.
        { op: "setComponent", entityId: doorId, component: "NavigationHint", data: { walkable: false } },
      );
    }

    const output: GeneratorOutput = {
      operations,
      assets: dedupeAssets([wallAsset, roofAsset, trimAsset, floorAsset, glassAsset]),
      rootIds: [rootId],
      description: `${params.floors}-storey ${params.kind} (${params.width.toFixed(1)}×${params.depth.toFixed(1)}m, ${params.roof} roof)`,
      warnings: [],
    };
    if (params.floors > 4 && params.roof === "gable") {
      output.warnings.push("A gable roof on a tall building looks odd; consider roof:\"flat\" for towers and keeps.");
    }
    return output;
  },
};
