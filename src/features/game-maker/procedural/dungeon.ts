/**
 * Dungeons and fortresses.
 *
 * Rooms-and-corridors layout with guaranteed connectivity: the generator
 * builds a spanning tree over the room graph before adding loops, so every
 * room is reachable from the entrance. A dungeon that cannot be walked is a
 * bug the playtest bot would find — this makes it not happen.
 */
import { z } from "zod";
import type { GeneratorDefinition, GeneratorOutput } from "./generator";
import { dedupeAssets, groupOps, meshEntityOps, mergeOutputs } from "./generator";
import type { RegionIR, Vec3 } from "../ir/types";
import { Rng } from "./random";
import { materialAsset } from "./materials";
import { part } from "./mesh";
import { characterGenerator } from "./characters";
import { buildingGenerator, BuildingParamsSchema } from "./building";

export const DungeonParamsSchema = z.object({
  origin: z.tuple([z.number(), z.number(), z.number()]).default([0, -12, 0]),
  rooms: z.number().int().min(2).max(60).default(8),
  roomSize: z.number().min(4).max(40).default(11),
  corridorWidth: z.number().min(1.5).max(10).default(3),
  height: z.number().min(2.5).max(20).default(4),
  /** Extra connections beyond the spanning tree: 0 = pure tree, 1 = dense. */
  loops: z.number().min(0).max(1).default(0.25),
  enemies: z.number().int().min(0).max(120).default(6),
  boss: z.boolean().default(true),
  treasure: z.number().int().min(0).max(40).default(3),
  theme: z.enum(["crypt", "cave", "keep", "mine", "lab"]).default("crypt"),
});

export type DungeonParams = z.infer<typeof DungeonParamsSchema>;

interface Room {
  index: number;
  center: Vec3;
  width: number;
  depth: number;
}

const THEME_MATERIAL: Record<DungeonParams["theme"], Parameters<typeof materialAsset>[1]["family"]> = {
  crypt: "weathered_stone",
  cave: "rock",
  keep: "stone",
  mine: "dark_wood",
  lab: "metal",
};

export const dungeonGenerator: GeneratorDefinition<typeof DungeonParamsSchema> = {
  name: "dungeon",
  version: 2,
  summary: "An underground dungeon of connected rooms and corridors with an entrance, enemies, treasure and an optional boss chamber. Every room is guaranteed reachable.",
  modes: ["3d"],
  schema: DungeonParamsSchema,
  run(context, params, seed) {
    const rng = new Rng(seed);
    const origin = params.origin as Vec3;
    const wallAsset = materialAsset("Dungeon wall", { family: THEME_MATERIAL[params.theme], seed, weathering: 0.6 });
    const floorAsset = materialAsset("Dungeon floor", { family: params.theme === "cave" ? "rock" : "stone", seed: seed + 1, weathering: 0.5 });
    const goldAsset = materialAsset("Treasure", { family: "gold", seed: seed + 2 });

    const output: GeneratorOutput = { operations: [], assets: [wallAsset, floorAsset, goldAsset], rootIds: [], description: "", warnings: [] };

    const regionId = context.nextId("region");
    const spread = Math.max(30, params.rooms * params.roomSize * 0.55);
    const region: RegionIR = {
      id: regionId,
      name: `${params.theme[0]!.toUpperCase()}${params.theme.slice(1)} dungeon`,
      kind: "dungeon",
      center: origin,
      size: [spread * 2, params.height * 3, spread * 2],
      tags: ["dungeon", params.theme],
    };
    output.operations.push({ op: "upsertRegion", region });

    const rootId = context.nextId("dungeon");
    output.operations.push(
      ...groupOps({
        id: rootId,
        name: region.name,
        type: "dungeon",
        position: origin,
        tags: ["dungeon", params.theme],
        regionId,
        generator: { generator: "dungeon", seed, parameters: params as unknown as Record<string, unknown>, version: 2 },
      }),
    );
    output.rootIds.push(rootId);

    /* ---- room placement (rejection-sampled, non-overlapping) ---- */
    const rooms: Room[] = [];
    for (let index = 0; index < params.rooms; index += 1) {
      let placed = false;
      for (let attempt = 0; attempt < 60 && !placed; attempt += 1) {
        const angle = rng.next() * Math.PI * 2;
        const distance = index === 0 ? 0 : Math.sqrt(rng.next()) * spread;
        const width = params.roomSize * rng.range(0.75, 1.45);
        const depth = params.roomSize * rng.range(0.75, 1.45);
        const center: Vec3 = [origin[0] + Math.cos(angle) * distance, origin[1], origin[2] + Math.sin(angle) * distance];
        const clash = rooms.some((room) =>
          Math.abs(room.center[0] - center[0]) < (room.width + width) / 2 + params.corridorWidth * 1.6 &&
          Math.abs(room.center[2] - center[2]) < (room.depth + depth) / 2 + params.corridorWidth * 1.6);
        if (clash) continue;
        rooms.push({ index, center, width, depth });
        placed = true;
      }
    }
    if (rooms.length < params.rooms) {
      output.warnings.push(`Only ${rooms.length} of ${params.rooms} rooms fitted without overlapping; reduce roomSize or raise the room count gradually.`);
    }

    /* ---- connectivity: spanning tree first, then optional loops ---- */
    const connected = new Set<number>([0]);
    const edges: [number, number][] = [];
    while (connected.size < rooms.length) {
      let best: { from: number; to: number; distance: number } | null = null;
      for (const from of connected) {
        for (let to = 0; to < rooms.length; to += 1) {
          if (connected.has(to)) continue;
          const distance = Math.hypot(rooms[from]!.center[0] - rooms[to]!.center[0], rooms[from]!.center[2] - rooms[to]!.center[2]);
          if (!best || distance < best.distance) best = { from, to, distance };
        }
      }
      if (!best) break;
      edges.push([best.from, best.to]);
      connected.add(best.to);
    }
    const extraLoops = Math.round(params.loops * rooms.length);
    for (let index = 0; index < extraLoops; index += 1) {
      const a = rng.int(0, rooms.length - 1);
      const b = rng.int(0, rooms.length - 1);
      if (a !== b && !edges.some(([from, to]) => (from === a && to === b) || (from === b && to === a))) edges.push([a, b]);
    }

    /* ---- geometry ---- */
    const wallThickness = 0.6;
    for (const room of rooms) {
      const roomId = context.nextId("room");
      const parts = [
        part("box", [0, -0.15, 0], [room.width, 0.3, room.depth], floorAsset.id),
        part("box", [0, params.height + 0.15, 0], [room.width, 0.3, room.depth], wallAsset.id),
        part("box", [0, params.height / 2, -room.depth / 2], [room.width, params.height, wallThickness], wallAsset.id),
        part("box", [0, params.height / 2, room.depth / 2], [room.width, params.height, wallThickness], wallAsset.id),
        part("box", [-room.width / 2, params.height / 2, 0], [wallThickness, params.height, room.depth], wallAsset.id),
        part("box", [room.width / 2, params.height / 2, 0], [wallThickness, params.height, room.depth], wallAsset.id),
      ];
      output.operations.push(
        ...meshEntityOps({
          id: roomId,
          name: room.index === 0 ? "Entrance chamber" : `Room ${room.index}`,
          type: "dungeonRoom",
          parentId: rootId,
          regionId,
          position: room.center,
          tags: ["dungeon", "room", ...(room.index === 0 ? ["entrance"] : [])],
          spec: { parts },
          collision: "static",
        }),
        { op: "setComponent", entityId: roomId, component: "NavigationHint", data: { walkable: true, interior: true } },
      );
      // A torch per room keeps interiors readable without a lighting pass.
      const lightId = context.nextId("torch");
      output.operations.push(
        {
          op: "create",
          parentId: roomId,
          entity: {
            id: lightId,
            name: "Torch",
            type: "light",
            tags: ["light"],
            transform: { position: [0, params.height * 0.7, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
            bounds: { center: [0, 0, 0], size: [0.4, 0.4, 0.4] },
            visible: true,
            components: [],
            assetRefs: [],
            children: [],
          },
        },
        { op: "setComponent", entityId: lightId, component: "Light", data: { type: "omni", color: "#ffb066", intensity: 1.6, range: Math.max(room.width, room.depth) * 0.9, castShadows: false } },
      );
    }

    // Corridors: L-shaped, two axis-aligned legs so they always connect.
    for (const [from, to] of edges) {
      const a = rooms[from]!;
      const b = rooms[to]!;
      const legs: { center: Vec3; size: Vec3 }[] = [
        {
          center: [(a.center[0] + b.center[0]) / 2, origin[1], a.center[2]],
          size: [Math.abs(b.center[0] - a.center[0]) + params.corridorWidth, params.height, params.corridorWidth],
        },
        {
          center: [b.center[0], origin[1], (a.center[2] + b.center[2]) / 2],
          size: [params.corridorWidth, params.height, Math.abs(b.center[2] - a.center[2]) + params.corridorWidth],
        },
      ];
      for (const leg of legs) {
        if (leg.size[0] < 0.5 || leg.size[2] < 0.5) continue;
        const corridorId = context.nextId("corridor");
        output.operations.push(
          ...meshEntityOps({
            id: corridorId,
            name: "Corridor",
            type: "corridor",
            parentId: rootId,
            regionId,
            position: leg.center,
            tags: ["dungeon", "corridor"],
            spec: {
              parts: [
                part("box", [0, -0.15, 0], [leg.size[0], 0.3, leg.size[2]], floorAsset.id),
                part("box", [0, params.height + 0.15, 0], [leg.size[0], 0.3, leg.size[2]], wallAsset.id),
              ],
            },
            collision: "static",
          }),
          { op: "setComponent", entityId: corridorId, component: "NavigationHint", data: { walkable: true, interior: true } },
        );
      }
    }

    /* ---- population ---- */
    const enemyIds: string[] = [];
    for (let index = 0; index < params.enemies && rooms.length > 1; index += 1) {
      const room = rooms[rng.int(1, rooms.length - 1)]!;
      const spawn: Vec3 = [
        room.center[0] + rng.range(-room.width * 0.3, room.width * 0.3),
        room.center[1],
        room.center[2] + rng.range(-room.depth * 0.3, room.depth * 0.3),
      ];
      const enemy = characterGenerator.run(
        context,
        characterGenerator.schema.parse({ archetype: params.theme === "crypt" ? "zombie" : params.theme === "lab" ? "monster" : "bandit", position: spawn, patrolRadius: 6 }),
        seed + 3000 + index * 41,
      );
      for (const operation of enemy.operations) {
        if (operation.op === "create" && enemy.rootIds.includes(operation.entity.id)) {
          operation.parentId = rootId;
          operation.entity.regionId = regionId;
        }
      }
      mergeOutputs(output, enemy);
      enemyIds.push(...enemy.rootIds);
    }

    for (let index = 0; index < params.treasure && rooms.length > 1; index += 1) {
      const room = rooms[rng.int(1, rooms.length - 1)]!;
      const chestId = context.nextId("chest");
      output.operations.push(
        ...meshEntityOps({
          id: chestId,
          name: "Treasure chest",
          type: "container",
          parentId: rootId,
          regionId,
          position: [room.center[0] + rng.range(-2, 2), room.center[1], room.center[2] + rng.range(-2, 2)],
          yaw: rng.next() * Math.PI * 2,
          tags: ["treasure", "interactable", "collectible"],
          navigation: "obstacle",
          spec: {
            parts: [
              part("box", [0, 0.3, 0], [1.1, 0.6, 0.7], wallAsset.id),
              part("prism", [0, 0.72, 0], [1.1, 0.35, 0.7], goldAsset.id, { rotation: [0, 90, 0] }),
            ],
          },
          collision: "static",
        }),
        { op: "setComponent", entityId: chestId, component: "Interactable", data: { prompt: "Open chest", action: "interact", range: 2.2 } },
        { op: "setComponent", entityId: chestId, component: "Container", data: { opened: false, loot: [{ item: "gold", count: rng.int(15, 90) }] } },
      );
    }

    if (params.boss && rooms.length > 1) {
      const bossRoom = rooms[rooms.length - 1]!;
      const boss = characterGenerator.run(
        context,
        characterGenerator.schema.parse({ archetype: "boss", position: bossRoom.center, name: "Dungeon Boss", difficulty: 1.4 }),
        seed + 991,
      );
      for (const operation of boss.operations) {
        if (operation.op === "create" && boss.rootIds.includes(operation.entity.id)) {
          operation.parentId = rootId;
          operation.entity.regionId = regionId;
        }
      }
      mergeOutputs(output, boss);
      output.operations.push({ op: "setRelationship", entityId: rootId, relation: "bossRoom", targets: boss.rootIds });
    }

    /* ---- surface entrance so the dungeon is actually reachable ---- */
    const entranceRoom = rooms[0];
    if (entranceRoom) {
      const surfaceY = context.sampleHeight?.(entranceRoom.center[0], entranceRoom.center[2]) ?? 0;
      const entrance = buildingGenerator.run(
        context,
        BuildingParamsSchema.parse({ kind: "tower", round: true, radius: 3.2, floors: 1, floorHeight: 4, roof: "conical", condition: 0.55, interior: false }),
        seed + 4242,
      );
      for (const operation of entrance.operations) {
        if (operation.op === "create" && entrance.rootIds.includes(operation.entity.id)) {
          operation.parentId = rootId;
          operation.entity.name = "Dungeon entrance";
          operation.entity.tags = ["dungeon-entrance", "landmark", "interactable"];
          operation.entity.regionId = regionId;
          operation.entity.transform = { position: [entranceRoom.center[0], surfaceY, entranceRoom.center[2]], rotation: [0, 0, 0, 1], scale: [1, 1, 1] };
        }
      }
      mergeOutputs(output, entrance);
      const stairId = context.nextId("stairs");
      const drop = surfaceY - origin[1];
      const steps = Math.max(6, Math.round(drop / 0.28));
      output.operations.push(
        ...meshEntityOps({
          id: stairId,
          name: "Descent",
          type: "stairs",
          parentId: rootId,
          regionId,
          position: [entranceRoom.center[0], origin[1], entranceRoom.center[2]],
          tags: ["stairs", "navigation"],
          spec: {
            parts: Array.from({ length: steps }, (_, step) =>
              part("box", [0, (step / steps) * drop, -(step + 1) * 0.42], [3, Math.max(0.2, drop / steps + 0.1), 0.44], floorAsset.id)),
          },
          collision: "static",
        }),
        { op: "setComponent", entityId: stairId, component: "NavigationHint", data: { walkable: true, cost: 1.2 } },
      );
    }

    output.assets = dedupeAssets(output.assets);
    output.description = `${rooms.length}-room ${params.theme} dungeon with ${enemyIds.length} enemies${params.boss ? " and a boss chamber" : ""}`;
    return output;
  },
};
