/**
 * Castles and fortresses — the "put a ruined fortress on this mountain"
 * generator from spec §70 and §273.
 */
import { z } from "zod";
import type { GeneratorDefinition, GeneratorOutput } from "./generator";
import { dedupeAssets, groupOps, meshEntityOps, mergeOutputs } from "./generator";
import type { RegionIR, Vec3 } from "../ir/types";
import { Rng } from "./random";
import { materialAsset } from "./materials";
import { part, polygonRing } from "./mesh";
import { buildingGenerator, BuildingParamsSchema } from "./building";
import { characterGenerator } from "./characters";

export const FortressParamsSchema = z.object({
  center: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  radius: z.number().min(12).max(200).default(42),
  towerCount: z.number().int().min(0).max(16).default(6),
  wallHeight: z.number().min(4).max(30).default(9),
  /** 0 = intact, 1 = collapsed ruin. */
  ruinAmount: z.number().min(0).max(1).default(0.2),
  keep: z.boolean().default(true),
  courtyardBuildings: z.number().int().min(0).max(20).default(3),
  guards: z.number().int().min(0).max(60).default(6),
  gateFacing: z.number().default(0),
});

export type FortressParams = z.infer<typeof FortressParamsSchema>;

export const fortressGenerator: GeneratorDefinition<typeof FortressParamsSchema> = {
  name: "fortress",
  version: 2,
  summary: "A castle or fortress — curtain walls, corner towers, a gatehouse, a keep, courtyard buildings and garrison, with an adjustable ruin level.",
  modes: ["3d"],
  schema: FortressParamsSchema,
  run(context, params, seed) {
    const rng = new Rng(seed);
    const center = params.center as Vec3;
    const groundHeight = context.sampleHeight?.(center[0], center[2]) ?? center[1];
    const weathering = params.ruinAmount;

    const stoneAsset = materialAsset("Fortress stone", { family: "weathered_stone", seed, weathering });
    const trimAsset = materialAsset("Fortress iron", { family: "iron", seed: seed + 1, weathering });
    const bannerAsset = materialAsset("Banner", { family: "fabric", seed: seed + 2, weathering });

    const output: GeneratorOutput = { operations: [], assets: [stoneAsset, trimAsset, bannerAsset], rootIds: [], description: "", warnings: [] };

    const regionId = context.nextId("region");
    const region: RegionIR = {
      id: regionId,
      name: params.ruinAmount > 0.5 ? "Ruined fortress" : "Fortress",
      kind: "fortress",
      center: [center[0], groundHeight, center[2]],
      size: [params.radius * 2.4, 60, params.radius * 2.4],
      tags: ["fortress", ...(params.ruinAmount > 0.5 ? ["ruin"] : [])],
    };
    output.operations.push({ op: "upsertRegion", region });

    const rootId = context.nextId("fortress");
    output.operations.push(
      ...groupOps({
        id: rootId,
        name: region.name,
        type: "fortress",
        position: [center[0], groundHeight, center[2]],
        tags: ["fortress", "landmark"],
        regionId,
        generator: { generator: "fortress", seed, parameters: params as unknown as Record<string, unknown>, version: 2 },
      }),
    );
    output.rootIds.push(rootId);

    /* ---- curtain wall ---- */
    const sides = Math.max(4, params.towerCount || 6);
    const corners = polygonRing(sides, params.radius, params.gateFacing);
    const wallIds: string[] = [];
    let gateIndex = 0;

    for (let index = 0; index < corners.length; index += 1) {
      const [x1, z1] = corners[index]!;
      const [x2, z2] = corners[(index + 1) % corners.length]!;
      const midX = center[0] + (x1 + x2) / 2;
      const midZ = center[2] + (z1 + z2) / 2;
      const length = Math.hypot(x2 - x1, z2 - z1);
      const yaw = Math.atan2(x2 - x1, z2 - z1);
      const y = context.sampleHeight?.(midX, midZ) ?? groundHeight;

      if (index === gateIndex) continue; // Gate goes here.

      // Ruined stretches drop to a stub instead of vanishing.
      const collapsed = rng.next() < params.ruinAmount * 0.7;
      const height = collapsed ? params.wallHeight * rng.range(0.2, 0.5) : params.wallHeight;
      const wallId = context.nextId("curtain");
      const parts = [part("box", [0, height / 2, 0], [1.6, height, length + 0.4], stoneAsset.id)];
      if (!collapsed) {
        // Wall walk + crenellations.
        parts.push(part("box", [0, height + 0.2, 0], [3.2, 0.4, length + 0.4], stoneAsset.id));
        const merlons = Math.max(2, Math.round(length / 1.6));
        for (let merlon = 0; merlon < merlons; merlon += 1) {
          const offset = -length / 2 + ((merlon + 0.5) / merlons) * length;
          parts.push(part("box", [1.4, height + 0.9, offset], [0.5, 1, 0.8], stoneAsset.id, { noCollision: true }));
        }
      }
      output.operations.push(
        ...meshEntityOps({
          id: wallId,
          name: collapsed ? "Collapsed wall" : "Curtain wall",
          type: "wall",
          parentId: rootId,
          regionId,
          position: [midX, y, midZ],
          yaw,
          tags: ["wall", "fortress", ...(collapsed ? ["ruin"] : [])],
          spec: { parts },
          collision: "static",
          navigation: "obstacle",
        }),
      );
      wallIds.push(wallId);
    }

    /* ---- towers ---- */
    const towerIds: string[] = [];
    for (let index = 0; index < params.towerCount; index += 1) {
      const [cx, cz] = corners[index % corners.length]!;
      const x = center[0] + cx;
      const z = center[2] + cz;
      const y = context.sampleHeight?.(x, z) ?? groundHeight;
      const ruined = rng.next() < params.ruinAmount * 0.6;
      const tower = buildingGenerator.run(
        context,
        BuildingParamsSchema.parse({
          kind: "tower",
          round: true,
          radius: 3.4,
          floors: ruined ? 2 : 4,
          floorHeight: params.wallHeight / 2.2,
          roof: ruined ? "flat" : "conical",
          condition: ruined ? 0.35 : 1 - params.ruinAmount * 0.4,
          interior: true,
        }),
        seed + 200 + index * 29,
      );
      for (const operation of tower.operations) {
        if (operation.op === "create" && tower.rootIds.includes(operation.entity.id)) {
          operation.parentId = rootId;
          operation.entity.name = ruined ? "Ruined tower" : `Tower ${index + 1}`;
          operation.entity.tags = ["tower", "fortress", ...(ruined ? ["ruin"] : [])];
          operation.entity.regionId = regionId;
          operation.entity.transform = { position: [x, y, z], rotation: [0, 0, 0, 1], scale: [1, 1, 1] };
        }
      }
      mergeOutputs(output, tower);
      towerIds.push(...tower.rootIds);
    }

    /* ---- gatehouse ---- */
    const [gx, gz] = corners[gateIndex]!;
    const [gx2, gz2] = corners[(gateIndex + 1) % corners.length]!;
    const gateX = center[0] + (gx + gx2) / 2;
    const gateZ = center[2] + (gz + gz2) / 2;
    const gateY = context.sampleHeight?.(gateX, gateZ) ?? groundHeight;
    const gateYaw = Math.atan2(gx2 - gx, gz2 - gz);
    const gatehouse = buildingGenerator.run(
      context,
      BuildingParamsSchema.parse({ kind: "gatehouse", width: Math.hypot(gx2 - gx, gz2 - gz) * 0.8, depth: 6, floors: 2, floorHeight: params.wallHeight / 2, condition: 1 - params.ruinAmount * 0.3 }),
      seed + 88,
    );
    let gateId = "";
    for (const operation of gatehouse.operations) {
      if (operation.op === "create" && gatehouse.rootIds.includes(operation.entity.id)) {
        gateId = operation.entity.id;
        operation.parentId = rootId;
        operation.entity.name = "Main gate";
        operation.entity.tags = ["gate", "fortress", "landmark", "entrance"];
        operation.entity.regionId = regionId;
        operation.entity.transform = { position: [gateX, gateY, gateZ], rotation: [0, Math.sin(gateYaw / 2), 0, Math.cos(gateYaw / 2)], scale: [1, 1, 1] };
      }
    }
    mergeOutputs(output, gatehouse);

    /* ---- keep + courtyard ---- */
    if (params.keep) {
      const keep = buildingGenerator.run(
        context,
        BuildingParamsSchema.parse({ kind: "keep", width: params.radius * 0.42, depth: params.radius * 0.42, floors: 3, floorHeight: 4.2, roof: "flat", condition: 1 - params.ruinAmount * 0.5 }),
        seed + 555,
      );
      for (const operation of keep.operations) {
        if (operation.op === "create" && keep.rootIds.includes(operation.entity.id)) {
          operation.parentId = rootId;
          operation.entity.name = "Keep";
          operation.entity.tags = ["keep", "fortress", "landmark"];
          operation.entity.regionId = regionId;
          operation.entity.transform = { position: [center[0], groundHeight, center[2]], rotation: [0, 0, 0, 1], scale: [1, 1, 1] };
        }
      }
      mergeOutputs(output, keep);
    }

    for (let index = 0; index < params.courtyardBuildings; index += 1) {
      const angle = (index / Math.max(1, params.courtyardBuildings)) * Math.PI * 2 + 0.4;
      const distance = params.radius * 0.62;
      const x = center[0] + Math.cos(angle) * distance;
      const z = center[2] + Math.sin(angle) * distance;
      const building = buildingGenerator.run(
        context,
        BuildingParamsSchema.parse({ kind: rng.pick(["barn", "warehouse", "blacksmith", "house"] as const), condition: 1 - params.ruinAmount * 0.6 }),
        seed + 700 + index * 13,
      );
      for (const operation of building.operations) {
        if (operation.op === "create" && building.rootIds.includes(operation.entity.id)) {
          operation.parentId = rootId;
          operation.entity.regionId = regionId;
          operation.entity.transform = {
            position: [x, context.sampleHeight?.(x, z) ?? groundHeight, z],
            rotation: [0, Math.sin((angle + Math.PI) / 2), 0, Math.cos((angle + Math.PI) / 2)],
            scale: [1, 1, 1],
          };
        }
      }
      mergeOutputs(output, building);
    }

    /* ---- garrison, posted on the walls facing outward ---- */
    const guardIds: string[] = [];
    for (let index = 0; index < params.guards; index += 1) {
      const angle = (index / Math.max(1, params.guards)) * Math.PI * 2;
      const onWall = index % 2 === 0 && params.ruinAmount < 0.6;
      const distance = onWall ? params.radius * 0.97 : params.radius * 0.5;
      const x = center[0] + Math.cos(angle) * distance;
      const z = center[2] + Math.sin(angle) * distance;
      const y = (context.sampleHeight?.(x, z) ?? groundHeight) + (onWall ? params.wallHeight + 0.4 : 0);
      const guard = characterGenerator.run(
        context,
        characterGenerator.schema.parse({
          archetype: "guard",
          position: [x, y, z],
          // Face outward from the fortress — the spec's "archers on the walls".
          yaw: angle + Math.PI / 2,
          patrolRadius: onWall ? 0 : 10,
        }),
        seed + 3300 + index * 61,
      );
      for (const operation of guard.operations) {
        if (operation.op === "create" && guard.rootIds.includes(operation.entity.id)) {
          operation.parentId = rootId;
          operation.entity.regionId = regionId;
        }
      }
      mergeOutputs(output, guard);
      guardIds.push(...guard.rootIds);
    }

    if (guardIds.length) {
      output.operations.push({ op: "setRelationship", entityId: rootId, relation: "garrison", targets: guardIds });
      for (const guardId of guardIds) {
        output.operations.push({ op: "setRelationship", entityId: guardId, relation: "patrols", targets: [rootId] });
      }
    }
    if (gateId) output.operations.push({ op: "setRelationship", entityId: rootId, relation: "entrance", targets: [gateId] });

    output.assets = dedupeAssets(output.assets);
    output.description = `${region.name}: ${params.towerCount} towers, ${wallIds.length} wall sections, ${guardIds.length} guards${params.keep ? ", keep" : ""}`;
    return output;
  },
};
