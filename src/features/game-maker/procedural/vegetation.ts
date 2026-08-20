/**
 * Vegetation regions (spec §92).
 *
 * A forest is ONE entity carrying a scatter description — seed, density,
 * species, slope/height rules, exclusion masks — which the runtime turns
 * into GPU instances. It is never 18,000 entities: that is the exact case
 * the performance repair pass exists to catch, so the generator refuses to
 * create it in the first place.
 */
import { z } from "zod";
import type { GeneratorDefinition, GeneratorOutput } from "./generator";
import type { Vec3 } from "../ir/types";
import { fbm2D, Rng } from "./random";
import { materialAsset } from "./materials";

export const SPECIES = ["pine", "oak", "birch", "palm", "cactus", "bush", "grass", "fern", "rock"] as const;
export type Species = (typeof SPECIES)[number];

export const VegetationParamsSchema = z.object({
  center: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  radius: z.number().min(2).max(4000).default(60),
  /** Instances per 100 m². Capped by the performance profile at apply time. */
  density: z.number().min(0.01).max(40).default(4),
  species: z.array(z.enum(SPECIES)).min(1).default(["pine", "bush"]),
  minSlope: z.number().min(0).max(1).default(0),
  maxSlope: z.number().min(0).max(1).default(0.55),
  minHeight: z.number().default(-1000),
  maxHeight: z.number().default(10000),
  /** Circles kept clear — roads, plazas, building plots. */
  exclusions: z.array(z.object({ center: z.tuple([z.number(), z.number(), z.number()]), radius: z.number().positive() })).max(256).default([]),
  /** Clumpiness: 0 = even, 1 = tight groves with clearings. */
  clustering: z.number().min(0).max(1).default(0.45),
  scaleVariance: z.number().min(0).max(1).default(0.35),
});

export type VegetationParams = z.infer<typeof VegetationParamsSchema>;

export interface VegetationInstance {
  position: Vec3;
  yaw: number;
  scale: number;
  species: Species;
}

/**
 * Resolve the scatter to concrete instances. Deterministic and pure, so the
 * editor preview, the runtime and the navmesh builder all agree on where
 * the trees are without storing them.
 */
export function resolveScatter(
  params: VegetationParams,
  seed: number,
  sampleHeight?: (x: number, z: number) => number | undefined,
  limit = 20000,
): VegetationInstance[] {
  const rng = new Rng(seed);
  const area = Math.PI * params.radius * params.radius;
  const target = Math.min(limit, Math.round((area / 100) * params.density));
  const instances: VegetationInstance[] = [];
  const center = params.center as Vec3;
  const attempts = target * 3;

  for (let attempt = 0; attempt < attempts && instances.length < target; attempt += 1) {
    const angle = rng.next() * Math.PI * 2;
    const distance = Math.sqrt(rng.next()) * params.radius;
    const x = center[0] + Math.cos(angle) * distance;
    const z = center[2] + Math.sin(angle) * distance;

    // Clustering: a noise field gates placement so groves and clearings form.
    if (params.clustering > 0) {
      const cluster = fbm2D(x * 0.03, z * 0.03, seed + 4243, { octaves: 3 });
      if (cluster < params.clustering * 0.55) continue;
    }

    if (params.exclusions.some((zone) => Math.hypot(x - zone.center[0], z - zone.center[2]) < zone.radius)) continue;

    const height = sampleHeight?.(x, z) ?? center[1];
    if (height < params.minHeight || height > params.maxHeight) continue;

    if (sampleHeight && (params.minSlope > 0 || params.maxSlope < 1)) {
      const delta = 1.5;
      const hx = (sampleHeight(x + delta, z) ?? height) - (sampleHeight(x - delta, z) ?? height);
      const hz = (sampleHeight(x, z + delta) ?? height) - (sampleHeight(x, z - delta) ?? height);
      const slope = Math.hypot(hx, hz) / (delta * 2);
      if (slope < params.minSlope || slope > params.maxSlope) continue;
    }

    instances.push({
      position: [x, height, z],
      yaw: rng.next() * Math.PI * 2,
      scale: 1 + rng.range(-params.scaleVariance, params.scaleVariance),
      species: rng.pick(params.species) as Species,
    });
  }
  return instances;
}

export const vegetationGenerator: GeneratorDefinition<typeof VegetationParamsSchema> = {
  name: "vegetation",
  version: 2,
  summary: "A GPU-instanced vegetation region — trees, bushes, grass, rocks — with slope/height rules and exclusion zones for roads and plots.",
  modes: ["3d"],
  schema: VegetationParamsSchema,
  run(context, params, seed) {
    const barkAsset = materialAsset("Bark", { family: "wood", seed, tint: "#5a4530", tintStrength: 0.5 });
    const leafAsset = materialAsset("Foliage", { family: "foliage", seed: seed + 1 });
    const rockAsset = materialAsset("Scatter rock", { family: "rock", seed: seed + 2 });

    const instances = resolveScatter(params, seed, context.sampleHeight);
    const rootId = context.nextId("vegetation");
    const warnings: string[] = [];
    if (!instances.length) {
      warnings.push("No vegetation could be placed — the slope, height or exclusion rules rejected every candidate position.");
    }

    return {
      operations: [
        {
          op: "create",
          entity: {
            id: rootId,
            name: `${params.species[0]!} region`,
            type: "vegetation",
            tags: ["vegetation", "instanced", ...params.species],
            transform: { position: params.center as Vec3, rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
            bounds: { center: [0, 6, 0], size: [params.radius * 2, 14, params.radius * 2] },
            visible: true,
            components: [],
            assetRefs: [barkAsset.id, leafAsset.id, rockAsset.id],
            children: [],
            generator: { generator: "vegetation", seed, parameters: params as unknown as Record<string, unknown>, version: 2 },
          },
        },
        {
          op: "setComponent",
          entityId: rootId,
          component: "VegetationRegion",
          data: {
            seed,
            params: params as unknown as Record<string, unknown>,
            instanceCount: instances.length,
            materials: { bark: barkAsset.id, leaf: leafAsset.id, rock: rockAsset.id },
            // Instances are regenerated from the seed at load; storing them
            // would put megabytes of transforms into the scene document.
            lodDistances: [40, 120, 300],
          },
        },
        // Vegetation is not walkable geometry but trunks do block movement.
        { op: "setComponent", entityId: rootId, component: "NavigationHint", data: { walkable: true, obstacles: "trunks", cost: 1.4 } },
      ],
      assets: [barkAsset, leafAsset, rockAsset],
      rootIds: [rootId],
      description: `${instances.length} instanced ${params.species.join("/")} across a ${Math.round(params.radius)}m region`,
      warnings,
    };
  },
};
