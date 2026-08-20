/**
 * Settlement generation (spec §87).
 *
 * Pipeline: bounds → districts → road graph → plots → buildings → props →
 * vegetation exclusion → NPC population → region + relationship graph.
 *
 * This is the generator that makes "create a medieval village beside a
 * river" one tool call instead of four hundred, and it records a region and
 * semantic relationships so the model can later say "the guards at the
 * castle" and have that resolve to real entities.
 */
import { z } from "zod";
import type { GeneratorDefinition, GeneratorOutput } from "./generator";
import { dedupeAssets, groupOps, meshEntityOps, mergeOutputs } from "./generator";
import type { PatchOperation, RegionIR, Vec3 } from "../ir/types";
import { Rng } from "./random";
import { buildingGenerator, BuildingParamsSchema, type BuildingKind } from "./building";
import { roadGenerator } from "./roads";
import { materialAsset } from "./materials";
import { characterGenerator, type CharacterArchetype } from "./characters";
import { part } from "./mesh";

export const SettlementParamsSchema = z.object({
  center: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  radius: z.number().min(15).max(600).default(70),
  style: z.enum(["village", "medieval_town", "western_town", "modern_district", "scifi_settlement"]).default("village"),
  houses: z.number().int().min(0).max(200).default(8),
  /** Named special buildings; each is placed on the best plot near the centre. */
  landmarks: z.array(z.enum(["inn", "blacksmith", "shop", "temple", "barn", "warehouse", "tower", "keep"])).max(12).default(["inn", "blacksmith"]),
  npcs: z.number().int().min(0).max(200).default(6),
  walls: z.boolean().default(false),
  plaza: z.boolean().default(true),
  /** 0 = pristine, 1 = ruined settlement. */
  condition: z.number().min(0).max(1).default(1),
  waterLevel: z.number().default(0),
});

export type SettlementParams = z.infer<typeof SettlementParamsSchema>;

const STYLE_PROFILE: Record<SettlementParams["style"], { kinds: BuildingKind[]; roadMaterial: "mud" | "stone" | "sand" | "wood"; npc: CharacterArchetype[] }> = {
  village: { kinds: ["house", "hut", "barn"], roadMaterial: "mud", npc: ["villager", "merchant", "guard"] },
  medieval_town: { kinds: ["house", "shop", "inn"], roadMaterial: "stone", npc: ["villager", "merchant", "guard", "soldier"] },
  western_town: { kinds: ["house", "shop", "warehouse"], roadMaterial: "sand", npc: ["villager", "merchant", "bandit"] },
  modern_district: { kinds: ["warehouse", "shop", "house"], roadMaterial: "stone", npc: ["villager", "merchant"] },
  scifi_settlement: { kinds: ["warehouse", "tower", "shop"], roadMaterial: "stone", npc: ["villager", "soldier"] },
};

interface Plot {
  position: Vec3;
  yaw: number;
  width: number;
  depth: number;
  /** Distance from the settlement centre; landmarks take the closest plots. */
  rank: number;
}

/**
 * Lay out plots along road-facing frontages. Buildings sit back from the
 * road and face it, which is what makes a generated village read as a place
 * rather than a scatter of boxes.
 */
function layoutPlots(params: SettlementParams, rng: Rng, roadRings: number): Plot[] {
  const plots: Plot[] = [];
  const center = params.center as Vec3;
  const wanted = params.houses + params.landmarks.length;
  const innerClear = params.plaza ? Math.max(10, params.radius * 0.18) : 6;

  for (let ring = 0; ring < roadRings && plots.length < wanted * 2; ring += 1) {
    const ringRadius = innerClear + ((ring + 1) / roadRings) * (params.radius - innerClear);
    const circumference = 2 * Math.PI * ringRadius;
    const slots = Math.max(3, Math.floor(circumference / 16));
    for (let slot = 0; slot < slots; slot += 1) {
      const angle = (slot / slots) * Math.PI * 2 + rng.range(-0.05, 0.05) + ring * 0.31;
      // Alternate sides of the ring road so both frontages get used.
      const side = slot % 2 === 0 ? 1 : -1;
      const offset = side * rng.range(7.5, 10.5);
      const distance = ringRadius + offset;
      if (distance < innerClear) continue;
      plots.push({
        position: [center[0] + Math.cos(angle) * distance, center[1], center[2] + Math.sin(angle) * distance],
        // Face the road: +Z of a building is its door side.
        yaw: Math.atan2(-Math.cos(angle) * side, -Math.sin(angle) * side) + Math.PI / 2,
        width: rng.range(6.5, 11),
        depth: rng.range(8, 13),
        rank: distance,
      });
    }
  }
  return rng.shuffle(plots).sort((a, b) => a.rank - b.rank);
}

export const settlementGenerator: GeneratorDefinition<typeof SettlementParamsSchema> = {
  name: "settlement",
  version: 3,
  summary: "A whole settlement — ring roads, plots, houses, named landmark buildings, a plaza, props, optional walls, and populated NPCs — as one coherent region.",
  modes: ["3d"],
  schema: SettlementParamsSchema,
  run(context, params, seed) {
    const rng = new Rng(seed);
    const profile = STYLE_PROFILE[params.style];
    const center = params.center as Vec3;
    const groundHeight = context.sampleHeight?.(center[0], center[2]) ?? center[1];

    const output: GeneratorOutput = { operations: [], assets: [], rootIds: [], description: "", warnings: [] };

    /* ---- region + root group ---- */
    const regionId = context.nextId("region");
    const region: RegionIR = {
      id: regionId,
      name: params.style === "village" ? "Village" : params.style.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
      kind: "settlement",
      center: [center[0], groundHeight, center[2]],
      size: [params.radius * 2.2, 60, params.radius * 2.2],
      tags: [params.style],
    };
    output.operations.push({ op: "upsertRegion", region });

    const rootId = context.nextId("settlement");
    output.operations.push(
      ...groupOps({
        id: rootId,
        name: region.name,
        type: "settlement",
        position: [center[0], groundHeight, center[2]],
        tags: ["settlement", params.style],
        regionId,
        generator: { generator: "settlement", seed, parameters: params as unknown as Record<string, unknown>, version: 3 },
      }),
    );
    output.rootIds.push(rootId);

    /* ---- road graph ---- */
    const roadRings = params.radius > 120 ? 3 : params.radius > 55 ? 2 : 1;
    const roadExclusions: { center: Vec3; radius: number }[] = [];

    // Two crossing high streets plus one ring per band.
    const spokes = params.radius > 90 ? 4 : 2;
    for (let spoke = 0; spoke < spokes; spoke += 1) {
      const angle = (spoke / spokes) * Math.PI;
      const points: Vec3[] = [];
      for (let step = -1; step <= 1; step += 0.5) {
        const distance = step * params.radius * 1.15;
        const x = center[0] + Math.cos(angle) * distance;
        const z = center[2] + Math.sin(angle) * distance;
        points.push([x, context.sampleHeight?.(x, z) ?? groundHeight, z]);
        roadExclusions.push({ center: [x, 0, z], radius: 7 });
      }
      const road = roadGenerator.run(
        context,
        roadGenerator.schema.parse({ points, width: params.style === "village" ? 4.5 : 6, material: profile.roadMaterial, waterLevel: params.waterLevel }),
        seed + 900 + spoke,
      );
      // Re-parent the road under the settlement so the hierarchy stays tidy.
      for (const operation of road.operations) {
        if (operation.op === "create" && road.rootIds.includes(operation.entity.id)) operation.parentId = rootId;
      }
      mergeOutputs(output, road);
    }

    for (let ring = 0; ring < roadRings; ring += 1) {
      const ringRadius = Math.max(12, ((ring + 1) / roadRings) * params.radius * 0.85);
      const points: Vec3[] = [];
      const segments = Math.max(8, Math.round(ringRadius / 4));
      for (let index = 0; index <= segments; index += 1) {
        const angle = (index / segments) * Math.PI * 2;
        const x = center[0] + Math.cos(angle) * ringRadius;
        const z = center[2] + Math.sin(angle) * ringRadius;
        points.push([x, context.sampleHeight?.(x, z) ?? groundHeight, z]);
        roadExclusions.push({ center: [x, 0, z], radius: 6 });
      }
      const road = roadGenerator.run(
        context,
        roadGenerator.schema.parse({ points, width: 4, material: profile.roadMaterial, subdivisions: 3, waterLevel: params.waterLevel }),
        seed + 1300 + ring,
      );
      for (const operation of road.operations) {
        if (operation.op === "create" && road.rootIds.includes(operation.entity.id)) operation.parentId = rootId;
      }
      mergeOutputs(output, road);
    }

    /* ---- plots → buildings ---- */
    const plots = layoutPlots(params, rng, roadRings);
    const buildingIds: string[] = [];
    const buildingExclusions: { center: Vec3; radius: number }[] = [];
    let plotIndex = 0;

    const placeBuilding = (kind: BuildingKind, plot: Plot, index: number) => {
      const buildingSeed = seed + 5000 + index * 37;
      const buildingParams = BuildingParamsSchema.parse({
        kind,
        width: Math.round(plot.width * 10) / 10,
        depth: Math.round(plot.depth * 10) / 10,
        floors: kind === "inn" || kind === "keep" ? 2 : rng.bool(0.28) ? 2 : 1,
        condition: Math.max(0, Math.min(1, params.condition + rng.range(-0.12, 0.08))),
        chimney: rng.bool(0.45),
        porch: kind === "shop" || kind === "inn",
        balcony: kind === "inn" && rng.bool(0.6),
      });
      const built = buildingGenerator.run(context, buildingParams, buildingSeed);
      const height = context.sampleHeight?.(plot.position[0], plot.position[2]) ?? groundHeight;
      for (const operation of built.operations) {
        if (operation.op === "create" && built.rootIds.includes(operation.entity.id)) {
          operation.parentId = rootId;
          operation.entity.transform = {
            position: [plot.position[0], height, plot.position[2]],
            rotation: [0, Math.sin(plot.yaw / 2), 0, Math.cos(plot.yaw / 2)],
            scale: [1, 1, 1],
          };
          operation.entity.regionId = regionId;
        }
      }
      mergeOutputs(output, built);
      buildingIds.push(...built.rootIds);
      buildingExclusions.push({ center: [plot.position[0], 0, plot.position[2]], radius: Math.max(plot.width, plot.depth) * 0.8 });
    };

    for (const landmark of params.landmarks) {
      const plot = plots[plotIndex];
      if (!plot) break;
      plotIndex += 1;
      placeBuilding(landmark as BuildingKind, plot, plotIndex);
    }
    for (let house = 0; house < params.houses; house += 1) {
      const plot = plots[plotIndex];
      if (!plot) {
        output.warnings.push(`Only ${house} of ${params.houses} houses fitted inside a ${params.radius}m radius; increase the radius for more.`);
        break;
      }
      plotIndex += 1;
      placeBuilding(rng.pick(profile.kinds), plot, plotIndex);
    }

    /* ---- plaza + props ---- */
    const stoneAsset = materialAsset("Plaza stone", { family: "stone", seed: seed + 21 });
    const woodAsset = materialAsset("Prop timber", { family: "wood", seed: seed + 22 });
    output.assets.push(stoneAsset, woodAsset);

    if (params.plaza) {
      const plazaId = context.nextId("plaza");
      const plazaRadius = Math.max(8, params.radius * 0.16);
      output.operations.push(
        ...meshEntityOps({
          id: plazaId,
          name: "Plaza",
          type: "plaza",
          parentId: rootId,
          regionId,
          position: [center[0], groundHeight + 0.05, center[2]],
          tags: ["plaza", "landmark"],
          navigation: "walkable",
          spec: {
            parts: [
              part("cylinder", [0, 0, 0], [plazaRadius * 2, 0.16, plazaRadius * 2], stoneAsset.id),
              part("cylinder", [0, 0.7, 0], [1.6, 1.4, 1.6], stoneAsset.id),
              part("cylinder", [0, 1.5, 0], [2.6, 0.3, 2.6], stoneAsset.id),
            ],
          },
          collision: "static",
        }),
      );
      buildingExclusions.push({ center: [center[0], 0, center[2]], radius: plazaRadius + 2 });
    }

    // Props: crates, barrels and carts scattered against building frontages.
    const propCount = Math.min(40, Math.round(buildingIds.length * 1.6));
    for (let index = 0; index < propCount; index += 1) {
      const plot = plots[rng.int(0, Math.max(0, plotIndex - 1))];
      if (!plot) break;
      const angle = rng.next() * Math.PI * 2;
      const distance = rng.range(4.5, 7.5);
      const x = plot.position[0] + Math.cos(angle) * distance;
      const z = plot.position[2] + Math.sin(angle) * distance;
      const y = context.sampleHeight?.(x, z) ?? groundHeight;
      const propId = context.nextId("prop");
      const barrel = rng.bool(0.5);
      output.operations.push(
        ...meshEntityOps({
          id: propId,
          name: barrel ? "Barrel" : "Crate",
          type: "prop",
          parentId: rootId,
          regionId,
          position: [x, y, z],
          yaw: rng.next() * Math.PI * 2,
          tags: ["prop", barrel ? "barrel" : "crate"],
          navigation: "obstacle",
          spec: {
            parts: barrel
              ? [part("cylinder", [0, 0.45, 0], [0.8, 0.9, 0.8], woodAsset.id)]
              : [part("box", [0, 0.35, 0], [0.7, 0.7, 0.7], woodAsset.id)],
          },
          collision: "static",
        }),
      );
    }

    /* ---- optional walls + gate ---- */
    if (params.walls) {
      const wallAsset = materialAsset("Town wall", { family: "stone", seed: seed + 31, weathering: 1 - params.condition });
      output.assets.push(wallAsset);
      const wallRadius = params.radius * 1.05;
      const segments = Math.max(12, Math.round(wallRadius / 3));
      const gateSlot = 0;
      for (let index = 0; index < segments; index += 1) {
        if (index === gateSlot) continue;
        const angle = (index / segments) * Math.PI * 2;
        const x = center[0] + Math.cos(angle) * wallRadius;
        const z = center[2] + Math.sin(angle) * wallRadius;
        const y = context.sampleHeight?.(x, z) ?? groundHeight;
        const span = (2 * Math.PI * wallRadius) / segments + 0.6;
        output.operations.push(
          ...meshEntityOps({
            id: context.nextId("wall"),
            name: "Wall section",
            type: "wall",
            parentId: rootId,
            regionId,
            position: [x, y, z],
            yaw: -angle,
            tags: ["wall", "defence"],
            navigation: "obstacle",
            spec: { parts: [part("box", [0, 3, 0], [span, 6, 1.2], wallAsset.id), part("box", [0, 6.3, 0], [span, 0.6, 1.8], wallAsset.id)] },
            collision: "static",
          }),
        );
      }
      const gateAngle = (gateSlot / segments) * Math.PI * 2;
      const gx = center[0] + Math.cos(gateAngle) * wallRadius;
      const gz = center[2] + Math.sin(gateAngle) * wallRadius;
      const gateBuild = buildingGenerator.run(context, BuildingParamsSchema.parse({ kind: "gatehouse", condition: params.condition }), seed + 77);
      for (const operation of gateBuild.operations) {
        if (operation.op === "create" && gateBuild.rootIds.includes(operation.entity.id)) {
          operation.parentId = rootId;
          operation.entity.name = "Gatehouse";
          operation.entity.tags = [...(operation.entity.tags ?? []), "gate", "landmark"];
          operation.entity.regionId = regionId;
          operation.entity.transform = {
            position: [gx, context.sampleHeight?.(gx, gz) ?? groundHeight, gz],
            rotation: [0, Math.sin(-gateAngle / 2), 0, Math.cos(-gateAngle / 2)],
            scale: [1, 1, 1],
          };
        }
      }
      mergeOutputs(output, gateBuild);
    }

    /* ---- NPC population ---- */
    const npcIds: string[] = [];
    for (let index = 0; index < params.npcs; index += 1) {
      const archetype = rng.pick(profile.npc);
      const angle = rng.next() * Math.PI * 2;
      const distance = rng.range(params.radius * 0.12, params.radius * 0.85);
      const x = center[0] + Math.cos(angle) * distance;
      const z = center[2] + Math.sin(angle) * distance;
      const character = characterGenerator.run(
        context,
        characterGenerator.schema.parse({ archetype, position: [x, context.sampleHeight?.(x, z) ?? groundHeight, z], patrolRadius: 12 }),
        seed + 7000 + index * 53,
      );
      for (const operation of character.operations) {
        if (operation.op === "create" && character.rootIds.includes(operation.entity.id)) {
          operation.parentId = rootId;
          operation.entity.regionId = regionId;
        }
      }
      mergeOutputs(output, character);
      npcIds.push(...character.rootIds);
    }

    /* ---- semantic relationships (spec §212) ---- */
    output.operations.push(
      { op: "setRelationship", entityId: rootId, relation: "contains", targets: [...buildingIds, ...npcIds] },
    );
    for (const npcId of npcIds) {
      output.operations.push({ op: "setRelationship", entityId: npcId, relation: "livesIn", targets: [rootId] });
    }

    output.assets = dedupeAssets(output.assets);
    output.description = `${region.name}: ${buildingIds.length} buildings, ${npcIds.length} NPCs, ${roadRings} ring road${roadRings === 1 ? "" : "s"}${params.walls ? ", walled" : ""}`;
    (output as GeneratorOutput & { exclusions?: unknown }).exclusions = [...roadExclusions, ...buildingExclusions];
    return output;
  },
};

/** Exclusion circles a settlement produced, for the vegetation pass. */
export function settlementExclusions(output: GeneratorOutput): { center: Vec3; radius: number }[] {
  const value = (output as GeneratorOutput & { exclusions?: { center: Vec3; radius: number }[] }).exclusions;
  return value ?? [];
}

/** Convenience: every create op in a generator output, for counting/testing. */
export function createdEntities(operations: PatchOperation[]): string[] {
  return operations.filter((operation): operation is Extract<PatchOperation, { op: "create" }> => operation.op === "create").map((operation) => operation.entity.id);
}
