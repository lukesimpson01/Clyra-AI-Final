/**
 * The generator contract (spec §70).
 *
 * A generator turns parameters + a seed into scene operations. It never
 * talks to the model, never calls Math.random, and always records its own
 * GeneratorMetadata on the root entity it creates, so "make that house two
 * storeys with a balcony" is a re-run with changed parameters rather than a
 * blind edit of 400 wall entities.
 */
import { z } from "zod";
import type { AssetRecord, GeneratorMetadata, PatchOperation, SceneIR, Vec3 } from "../ir/types";
import type { MeshSpec } from "./mesh";
import { meshBounds } from "./mesh";
import { quaternionFromYaw } from "../scene/grounding";

export interface GeneratorContext {
  scene: SceneIR;
  /** Terrain sampler when the scene has terrain; used to sit things on ground. */
  sampleHeight?: (x: number, z: number) => number | undefined;
  /** Namespaced id factory — ids stay stable across a single generator run. */
  nextId: (hint: string) => string;
}

export interface GeneratorOutput {
  operations: PatchOperation[];
  assets: AssetRecord[];
  /** Root entities created, so the caller can select/frame them. */
  rootIds: string[];
  /** Plain-language description of what was produced, for the activity feed. */
  description: string;
  warnings: string[];
}

export interface GeneratorDefinition<S extends z.ZodTypeAny = z.ZodTypeAny> {
  name: string;
  version: number;
  /** One line the tool-discovery surface shows to the model. */
  summary: string;
  /** 3d-only, 2d-only, or both. */
  modes: ("3d" | "2d" | "voxel")[];
  schema: S;
  run(context: GeneratorContext, parameters: z.infer<S>, seed: number): GeneratorOutput;
}

/** Build the create-operation for a mesh entity from a MeshSpec. */
export function meshEntityOps(options: {
  id: string;
  name: string;
  type: string;
  position: Vec3;
  yaw?: number;
  scale?: Vec3;
  spec: MeshSpec;
  tags?: string[];
  parentId?: string;
  regionId?: string;
  generator?: GeneratorMetadata;
  components?: { type: string; data: Record<string, unknown> }[];
  collision?: "static" | "none" | "dynamic";
  /**
   * How navigation should treat this object. "obstacle" is the right answer
   * for anything solid you walk AROUND — a house, a wall, a barrel. Without
   * it the navmesh builder sees a solid box and offers its top as walkable
   * ground, so paths climb over buildings and the character controller
   * stalls against the wall it was told to walk through.
   */
  navigation?: "obstacle" | "walkable" | "ignore";
}): PatchOperation[] {
  const bounds = meshBounds(options.spec);
  const ops: PatchOperation[] = [
    {
      op: "create",
      parentId: options.parentId,
      entity: {
        id: options.id,
        name: options.name,
        type: options.type,
        tags: options.tags ?? [],
        transform: {
          position: options.position,
          rotation: quaternionFromYaw(options.yaw ?? 0),
          scale: options.scale ?? [1, 1, 1],
        },
        bounds,
        visible: true,
        components: [],
        assetRefs: [],
        children: [],
        regionId: options.regionId,
        generator: options.generator,
      },
    },
    { op: "setComponent", entityId: options.id, component: "ProceduralMesh", data: { spec: options.spec as unknown as Record<string, unknown> } },
  ];
  if (options.collision !== "none") {
    ops.push({
      op: "setComponent",
      entityId: options.id,
      component: "Collider",
      data: { shape: "meshParts", body: options.collision ?? "static" },
    });
  }
  if (options.navigation && options.navigation !== "ignore") {
    ops.push({
      op: "setComponent",
      entityId: options.id,
      component: "NavigationHint",
      data: { walkable: options.navigation === "walkable" },
    });
  }
  for (const component of options.components ?? []) {
    ops.push({ op: "setComponent", entityId: options.id, component: component.type, data: component.data });
  }
  return ops;
}

/** Group entity — the parent every multi-part generator hangs its work off. */
export function groupOps(options: {
  id: string;
  name: string;
  type: string;
  position: Vec3;
  yaw?: number;
  tags?: string[];
  parentId?: string;
  regionId?: string;
  generator?: GeneratorMetadata;
}): PatchOperation[] {
  return [
    {
      op: "create",
      parentId: options.parentId,
      entity: {
        id: options.id,
        name: options.name,
        type: options.type,
        tags: options.tags ?? [],
        transform: { position: options.position, rotation: quaternionFromYaw(options.yaw ?? 0), scale: [1, 1, 1] },
        visible: true,
        components: [],
        assetRefs: [],
        children: [],
        regionId: options.regionId,
        generator: options.generator,
      },
    },
  ];
}

export function emptyOutput(description = ""): GeneratorOutput {
  return { operations: [], assets: [], rootIds: [], description, warnings: [] };
}

export function mergeOutputs(target: GeneratorOutput, source: GeneratorOutput) {
  target.operations.push(...source.operations);
  target.assets.push(...source.assets);
  target.rootIds.push(...source.rootIds);
  target.warnings.push(...source.warnings);
}

/** Deduplicate assets by id — generators freely re-request shared materials. */
export function dedupeAssets(assets: AssetRecord[]): AssetRecord[] {
  const seen = new Map<string, AssetRecord>();
  for (const asset of assets) if (!seen.has(asset.id)) seen.set(asset.id, asset);
  return [...seen.values()];
}
