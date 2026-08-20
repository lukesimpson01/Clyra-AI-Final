/**
 * Roads as splines (spec §88).
 *
 * A road is one entity holding a polyline plus a width, not four hundred
 * hand-placed segments. It samples terrain height, refuses slopes it cannot
 * climb, and emits a bridge where it crosses water.
 */
import { z } from "zod";
import type { GeneratorDefinition, GeneratorOutput } from "./generator";
import type { Vec3 } from "../ir/types";
import { materialAsset } from "./materials";
import { Rng } from "./random";

export const RoadParamsSchema = z.object({
  points: z.array(z.tuple([z.number(), z.number(), z.number()])).min(2).max(64),
  width: z.number().min(1).max(24).default(5),
  material: z.enum(["mud", "stone", "sand", "wood"]).default("mud"),
  /** Extra interpolated samples per segment; higher = smoother curve. */
  subdivisions: z.number().int().min(1).max(24).default(6),
  maxSlope: z.number().min(0.02).max(1).default(0.35),
  bridgeOverWater: z.boolean().default(true),
  waterLevel: z.number().default(0),
});

export type RoadParams = z.infer<typeof RoadParamsSchema>;

/** Centripetal Catmull-Rom, so the spline never overshoots on tight corners. */
export function catmullRom(points: Vec3[], subdivisions: number): Vec3[] {
  if (points.length < 2) return [...points];
  const padded = [points[0]!, ...points, points[points.length - 1]!];
  const out: Vec3[] = [];
  for (let index = 0; index < padded.length - 3; index += 1) {
    const p0 = padded[index]!;
    const p1 = padded[index + 1]!;
    const p2 = padded[index + 2]!;
    const p3 = padded[index + 3]!;
    for (let step = 0; step < subdivisions; step += 1) {
      const t = step / subdivisions;
      const t2 = t * t;
      const t3 = t2 * t;
      out.push([0, 1, 2].map((axis) =>
        0.5 *
        ((2 * p1[axis]!) +
          (-p0[axis]! + p2[axis]!) * t +
          (2 * p0[axis]! - 5 * p1[axis]! + 4 * p2[axis]! - p3[axis]!) * t2 +
          (-p0[axis]! + 3 * p1[axis]! - 3 * p2[axis]! + p3[axis]!) * t3),
      ) as Vec3);
    }
  }
  out.push(points[points.length - 1]!);
  return out;
}

export const roadGenerator: GeneratorDefinition<typeof RoadParamsSchema> = {
  name: "road",
  version: 2,
  summary: "A road or path following a spline through given waypoints, draped over terrain, with bridges where it crosses water.",
  modes: ["3d"],
  schema: RoadParamsSchema,
  run(context, params, seed) {
    const rng = new Rng(seed);
    const surfaceAsset = materialAsset("Road surface", { family: params.material === "stone" ? "stone" : params.material === "sand" ? "sand" : params.material === "wood" ? "wood" : "mud", seed });
    const bridgeAsset = materialAsset("Bridge timber", { family: "dark_wood", seed: seed + 1 });

    const raw = params.points as Vec3[];
    const smoothed = catmullRom(raw, params.subdivisions);

    // Drape onto the ground and clamp slope so the road stays walkable.
    const draped: Vec3[] = [];
    const warnings: string[] = [];
    let previousHeight: number | undefined;
    let clamped = 0;
    for (const point of smoothed) {
      const groundHeight = context.sampleHeight?.(point[0], point[2]) ?? point[1];
      let height = groundHeight;
      if (previousHeight !== undefined) {
        const run = Math.hypot(point[0] - draped[draped.length - 1]![0], point[2] - draped[draped.length - 1]![2]) || 0.001;
        const slope = (height - previousHeight) / run;
        if (Math.abs(slope) > params.maxSlope) {
          height = previousHeight + Math.sign(slope) * params.maxSlope * run;
          clamped += 1;
        }
      }
      draped.push([point[0], height + 0.06, point[2]]);
      previousHeight = height;
    }
    if (clamped > draped.length * 0.4) {
      warnings.push("Most of this road had to be cut into the hillside to stay walkable; consider a gentler route or a higher maxSlope.");
    }

    const rootId = context.nextId("road");
    const totalLength = draped.reduce((sum, point, index) => (index === 0 ? 0 : sum + Math.hypot(point[0] - draped[index - 1]![0], point[2] - draped[index - 1]![2])), 0);

    const operations: GeneratorOutput["operations"] = [
      {
        op: "create",
        entity: {
          id: rootId,
          name: "Road",
          type: "road",
          tags: ["road", "navigation"],
          transform: { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
          bounds: {
            center: [0, 0, 0],
            size: [
              Math.max(...draped.map((p) => Math.abs(p[0]))) * 2 + params.width,
              4,
              Math.max(...draped.map((p) => Math.abs(p[2]))) * 2 + params.width,
            ],
          },
          visible: true,
          components: [],
          assetRefs: [surfaceAsset.id],
          children: [],
          generator: { generator: "road", seed, parameters: params as unknown as Record<string, unknown>, version: 2 },
        },
      },
      {
        op: "setComponent",
        entityId: rootId,
        component: "RoadSpline",
        data: { points: draped, width: params.width, material: surfaceAsset.id },
      },
      { op: "setComponent", entityId: rootId, component: "NavigationHint", data: { walkable: true, cost: 0.6 } },
    ];

    // Bridge spans: contiguous stretches where the ground is under water.
    const assets = [surfaceAsset];
    if (params.bridgeOverWater) {
      let spanStart: number | null = null;
      const spans: [number, number][] = [];
      for (let index = 0; index < draped.length; index += 1) {
        const underwater = (context.sampleHeight?.(draped[index]![0], draped[index]![2]) ?? 1) < params.waterLevel;
        if (underwater && spanStart === null) spanStart = index;
        if (!underwater && spanStart !== null) {
          if (index - spanStart >= 2) spans.push([spanStart, index - 1]);
          spanStart = null;
        }
      }
      if (spanStart !== null && draped.length - spanStart >= 2) spans.push([spanStart, draped.length - 1]);

      for (const [start, end] of spans) {
        const bridgeId = context.nextId("bridge");
        const from = draped[Math.max(0, start - 1)]!;
        const to = draped[Math.min(draped.length - 1, end + 1)]!;
        const center: Vec3 = [(from[0] + to[0]) / 2, params.waterLevel + 1.4, (from[2] + to[2]) / 2];
        const length = Math.hypot(to[0] - from[0], to[2] - from[2]) + 2;
        const yaw = Math.atan2(to[0] - from[0], to[2] - from[2]);
        operations.push(
          {
            op: "create",
            entity: {
              id: bridgeId,
              name: "Bridge",
              type: "bridge",
              tags: ["bridge", "structure"],
              transform: { position: center, rotation: [0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)], scale: [1, 1, 1] },
              bounds: { center: [0, 0, 0], size: [params.width + 1, 1.6, length] },
              visible: true,
              components: [],
              assetRefs: [bridgeAsset.id],
              children: [],
            },
          },
          {
            op: "setComponent",
            entityId: bridgeId,
            component: "ProceduralMesh",
            data: {
              spec: {
                parts: [
                  { kind: "box", offset: [0, 0, 0], size: [params.width, 0.3, length], material: bridgeAsset.id },
                  { kind: "box", offset: [-params.width / 2, 0.7, 0], size: [0.18, 1.1, length], material: bridgeAsset.id, noCollision: true },
                  { kind: "box", offset: [params.width / 2, 0.7, 0], size: [0.18, 1.1, length], material: bridgeAsset.id, noCollision: true },
                  { kind: "box", offset: [0, -1, -length / 2 + 1], size: [0.4, 2.4, 0.4], material: bridgeAsset.id },
                  { kind: "box", offset: [0, -1, length / 2 - 1], size: [0.4, 2.4, 0.4], material: bridgeAsset.id },
                ],
              } as unknown as Record<string, unknown>,
            },
          },
          { op: "setComponent", entityId: bridgeId, component: "Collider", data: { shape: "meshParts", body: "static" } },
        );
        assets.push(bridgeAsset);
      }
      if (spans.length) rng.next();
    }

    return {
      operations,
      assets,
      rootIds: [rootId],
      description: `${Math.round(totalLength)}m ${params.material} road, ${params.width}m wide`,
      warnings,
    };
  },
};
