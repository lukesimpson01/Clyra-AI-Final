/**
 * Small world props — the everyday objects a scene needs that do not warrant
 * their own generator. Cheap, deterministic, and cataloguable so "put three
 * barrels around this" resolves to a real mesh rather than a grey cube.
 */
import { z } from "zod";
import type { GeneratorDefinition, GeneratorOutput } from "./generator";
import { dedupeAssets, meshEntityOps } from "./generator";
import type { MeshPart } from "./mesh";
import { part } from "./mesh";
import { Rng } from "./random";
import { materialAsset } from "./materials";

export const PROP_KINDS = [
  "barrel",
  "crate",
  "cart",
  "well",
  "fence",
  "signpost",
  "campfire",
  "tent",
  "table",
  "bench",
  "lamppost",
  "statue",
  "chest",
  "anvil",
  "haystack",
] as const;

export type PropKind = (typeof PROP_KINDS)[number];

export const PropParamsSchema = z.object({
  kind: z.enum(PROP_KINDS).default("barrel"),
  position: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  yaw: z.number().default(0),
  scale: z.number().min(0.2).max(6).default(1),
  count: z.number().int().min(1).max(64).default(1),
  /** With count > 1, spread the copies over this radius. */
  spread: z.number().min(0).max(120).default(3),
  interactable: z.boolean().default(false),
});

export type PropParams = z.infer<typeof PropParamsSchema>;

function propParts(kind: PropKind, materials: { wood: string; metal: string; stone: string; cloth: string }): MeshPart[] {
  switch (kind) {
    case "crate":
      return [part("box", [0, 0.35, 0], [0.7, 0.7, 0.7], materials.wood), part("box", [0, 0.35, 0], [0.74, 0.12, 0.74], materials.metal, { noCollision: true })];
    case "cart":
      return [
        part("box", [0, 0.7, 0], [1.4, 0.5, 2.4], materials.wood),
        part("box", [0, 1.05, -1.1], [1.4, 0.6, 0.12], materials.wood, { noCollision: true }),
        part("cylinder", [-0.75, 0.45, 0.6], [0.9, 0.16, 0.9], materials.wood, { rotation: [0, 0, 90] }),
        part("cylinder", [0.75, 0.45, 0.6], [0.9, 0.16, 0.9], materials.wood, { rotation: [0, 0, 90] }),
        part("box", [0, 0.9, 1.6], [0.14, 0.14, 1.4], materials.wood, { noCollision: true }),
      ];
    case "well":
      return [
        part("cylinder", [0, 0.5, 0], [2.2, 1, 2.2], materials.stone),
        part("cylinder", [0, 0.5, 0], [1.6, 1.05, 1.6], materials.stone, { noCollision: true }),
        part("box", [-0.9, 1.8, 0], [0.14, 1.8, 0.14], materials.wood),
        part("box", [0.9, 1.8, 0], [0.14, 1.8, 0.14], materials.wood),
        part("prism", [0, 2.9, 0], [2.4, 0.7, 2.4], materials.wood, { noCollision: true }),
      ];
    case "fence":
      return [
        part("box", [-1.1, 0.6, 0], [0.12, 1.2, 0.12], materials.wood),
        part("box", [1.1, 0.6, 0], [0.12, 1.2, 0.12], materials.wood),
        part("box", [0, 0.85, 0], [2.3, 0.1, 0.08], materials.wood, { noCollision: true }),
        part("box", [0, 0.5, 0], [2.3, 0.1, 0.08], materials.wood, { noCollision: true }),
      ];
    case "signpost":
      return [part("box", [0, 1.1, 0], [0.12, 2.2, 0.12], materials.wood), part("box", [0.35, 1.9, 0], [0.9, 0.45, 0.06], materials.wood, { noCollision: true })];
    case "campfire":
      return [
        part("cylinder", [0, 0.08, 0], [1.5, 0.16, 1.5], materials.stone),
        part("box", [0, 0.28, 0], [0.9, 0.16, 0.16], materials.wood, { rotation: [0, 30, 0] }),
        part("box", [0, 0.28, 0], [0.9, 0.16, 0.16], materials.wood, { rotation: [0, -35, 0] }),
      ];
    case "tent":
      return [part("prism", [0, 0.9, 0], [2.6, 1.8, 3.2], materials.cloth), part("box", [0, 0.05, 0], [2.6, 0.1, 3.2], materials.cloth, { noCollision: true })];
    case "table":
      return [
        part("box", [0, 0.78, 0], [1.6, 0.1, 0.9], materials.wood),
        ...[[-0.7, -0.35], [0.7, -0.35], [-0.7, 0.35], [0.7, 0.35]].map(([x, z]) => part("box", [x!, 0.39, z!], [0.1, 0.78, 0.1], materials.wood)),
      ];
    case "bench":
      return [part("box", [0, 0.45, 0], [1.8, 0.09, 0.42], materials.wood), part("box", [-0.75, 0.22, 0], [0.1, 0.45, 0.4], materials.wood), part("box", [0.75, 0.22, 0], [0.1, 0.45, 0.4], materials.wood)];
    case "lamppost":
      return [part("cylinder", [0, 1.6, 0], [0.14, 3.2, 0.14], materials.metal), part("sphere", [0, 3.3, 0], [0.45, 0.45, 0.45], materials.metal, { noCollision: true })];
    case "statue":
      return [
        part("box", [0, 0.4, 0], [1.6, 0.8, 1.6], materials.stone),
        part("capsule", [0, 1.7, 0], [0.7, 1.8, 0.5], materials.stone),
        part("sphere", [0, 2.8, 0], [0.5, 0.55, 0.5], materials.stone),
      ];
    case "chest":
      return [part("box", [0, 0.3, 0], [1.1, 0.6, 0.7], materials.wood), part("prism", [0, 0.72, 0], [1.1, 0.35, 0.7], materials.metal, { rotation: [0, 90, 0], noCollision: true })];
    case "anvil":
      return [part("box", [0, 0.3, 0], [0.5, 0.6, 0.4], materials.wood), part("box", [0, 0.75, 0], [1.1, 0.3, 0.4], materials.metal)];
    case "haystack":
      return [part("cylinder", [0, 0.8, 0], [2, 1.6, 2], materials.cloth), part("cone", [0, 1.9, 0], [2.1, 0.9, 2.1], materials.cloth, { noCollision: true })];
    case "barrel":
    default:
      return [
        part("cylinder", [0, 0.45, 0], [0.8, 0.9, 0.8], materials.wood),
        part("cylinder", [0, 0.7, 0], [0.86, 0.09, 0.86], materials.metal, { noCollision: true }),
        part("cylinder", [0, 0.2, 0], [0.86, 0.09, 0.86], materials.metal, { noCollision: true }),
      ];
  }
}

export const propGenerator: GeneratorDefinition<typeof PropParamsSchema> = {
  name: "prop",
  version: 2,
  summary: "World props — barrels, crates, carts, wells, fences, campfires, tents, statues, chests and more — placed singly or scattered in a small cluster.",
  modes: ["3d"],
  schema: PropParamsSchema,
  run(context, params, seed) {
    const rng = new Rng(seed);
    const wood = materialAsset("Prop wood", { family: "wood", seed });
    const metal = materialAsset("Prop metal", { family: "iron", seed: seed + 1 });
    const stone = materialAsset("Prop stone", { family: "stone", seed: seed + 2 });
    const cloth = materialAsset("Prop cloth", { family: "fabric", seed: seed + 3 });
    const materials = { wood: wood.id, metal: metal.id, stone: stone.id, cloth: cloth.id };

    const output: GeneratorOutput = { operations: [], assets: dedupeAssets([wood, metal, stone, cloth]), rootIds: [], description: "", warnings: [] };
    const base = params.position as [number, number, number];

    for (let index = 0; index < params.count; index += 1) {
      const angle = params.count === 1 ? 0 : (index / params.count) * Math.PI * 2 + rng.range(-0.2, 0.2);
      const distance = params.count === 1 ? 0 : params.spread * Math.sqrt(rng.next());
      const x = base[0] + Math.cos(angle) * distance;
      const z = base[2] + Math.sin(angle) * distance;
      const y = context.sampleHeight?.(x, z) ?? base[1];
      const id = context.nextId(params.kind);
      output.operations.push(
        ...meshEntityOps({
          id,
          name: params.kind[0]!.toUpperCase() + params.kind.slice(1),
          type: "prop",
          position: [x, y, z],
          yaw: params.yaw + (params.count === 1 ? 0 : rng.range(-Math.PI, Math.PI)),
          scale: [params.scale, params.scale, params.scale],
          tags: ["prop", params.kind, ...(params.interactable ? ["interactable"] : [])],
          spec: { parts: propParts(params.kind, materials) },
          generator: { generator: "prop", seed, parameters: params as unknown as Record<string, unknown>, version: 2 },
          collision: "static",
          navigation: "obstacle",
        }),
      );
      if (params.interactable || params.kind === "chest") {
        output.operations.push(
          { op: "setComponent", entityId: id, component: "Interactable", data: { prompt: `Use ${params.kind}`, action: "interact", range: 2.2 } },
        );
      }
      if (params.kind === "campfire") {
        output.operations.push({ op: "setComponent", entityId: id, component: "Light", data: { type: "omni", color: "#ff9d4a", intensity: 2.2, range: 9, castShadows: false } });
      }
      if (params.kind === "lamppost") {
        output.operations.push({ op: "setComponent", entityId: id, component: "Light", data: { type: "omni", color: "#ffe1a8", intensity: 1.6, range: 12, castShadows: false, offset: [0, 3.3, 0] } });
      }
      output.rootIds.push(id);
    }

    output.description = `${params.count} ${params.kind}${params.count === 1 ? "" : "s"}`;
    return output;
  },
};
