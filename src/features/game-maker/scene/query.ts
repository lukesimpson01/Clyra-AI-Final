/**
 * The structured world query the AI uses instead of receiving the whole
 * scene (spec §214). Every filter is answered by the spatial index or an
 * O(1) map lookup — never by shipping 100k entities to a model.
 */
import { z } from "zod";
import type { EntityContext, SceneIR, Vec3 } from "../ir/types";
import { getSpatialIndex, distance, type IndexedEntity } from "./spatial";

export const SceneQuerySchema = z.object({
  where: z
    .object({
      ids: z.array(z.string()).max(512).optional(),
      type: z.string().optional(),
      types: z.array(z.string()).max(32).optional(),
      tags: z.array(z.string()).max(16).optional(),
      /** All listed tags must be present; default is "any of". */
      allTags: z.boolean().optional(),
      namePattern: z.string().max(120).optional(),
      region: z.string().optional(),
      near: z.object({ position: z.tuple([z.number(), z.number(), z.number()]), radius: z.number().positive().max(100000) }).optional(),
      within: z
        .object({
          min: z.tuple([z.number(), z.number(), z.number()]),
          max: z.tuple([z.number(), z.number(), z.number()]),
        })
        .optional(),
      above: z.number().optional(),
      below: z.number().optional(),
      hasComponent: z.string().optional(),
      generator: z.string().optional(),
    })
    .default({}),
  sort: z.enum(["distance", "name", "size"]).optional(),
  /** Required with sort:"distance". */
  from: z.tuple([z.number(), z.number(), z.number()]).optional(),
  limit: z.number().int().min(1).max(500).default(50),
  offset: z.number().int().min(0).default(0),
});

export type SceneQuery = z.infer<typeof SceneQuerySchema>;

export interface SceneQueryResult {
  total: number;
  offset: number;
  returned: EntityContext[];
  /** Set when results were truncated, so the model knows to paginate. */
  more: boolean;
}

function toContext(scene: SceneIR, entry: IndexedEntity, from?: Vec3): EntityContext {
  return {
    entityId: entry.id,
    name: entry.name,
    type: entry.type,
    tags: entry.tags,
    position: entry.center,
    size: entry.size,
    regionId: entry.regionId,
    distance: from ? Number(distance(entry.center, from).toFixed(2)) : undefined,
  };
}

export function runSceneQuery(scene: SceneIR, query: SceneQuery): SceneQueryResult {
  const index = getSpatialIndex(scene);
  const where = query.where ?? {};

  let candidates: IndexedEntity[];
  if (where.ids?.length) {
    candidates = where.ids.map((id) => index.get(id)).filter((entry): entry is IndexedEntity => Boolean(entry));
  } else if (where.near) {
    candidates = index.withinRadius(where.near.position as Vec3, where.near.radius);
  } else if (where.within) {
    candidates = index.withinBounds(where.within.min as Vec3, where.within.max as Vec3);
  } else {
    candidates = index.all();
  }

  const pattern = where.namePattern ? new RegExp(where.namePattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i") : undefined;
  const types = new Set([...(where.types ?? []), ...(where.type ? [where.type] : [])]);

  const filtered = candidates.filter((entry) => {
    if (types.size && !types.has(entry.type)) return false;
    if (pattern && !pattern.test(entry.name)) return false;
    if (where.region && entry.regionId !== where.region) return false;
    if (where.above !== undefined && entry.center[1] <= where.above) return false;
    if (where.below !== undefined && entry.center[1] >= where.below) return false;
    if (where.tags?.length) {
      const has = where.allTags
        ? where.tags.every((tag) => entry.tags.includes(tag))
        : where.tags.some((tag) => entry.tags.includes(tag));
      if (!has) return false;
    }
    if (where.hasComponent) {
      const entity = scene.entities[entry.id];
      if (!entity?.components.some((component) => component.type === where.hasComponent)) return false;
    }
    if (where.generator) {
      const entity = scene.entities[entry.id];
      if (entity?.generator?.generator !== where.generator) return false;
    }
    return true;
  });

  const from = (query.from as Vec3 | undefined) ?? (where.near?.position as Vec3 | undefined);
  if (query.sort === "name") filtered.sort((a, b) => a.name.localeCompare(b.name));
  else if (query.sort === "size") filtered.sort((a, b) => b.size[0] * b.size[1] * b.size[2] - a.size[0] * a.size[1] * a.size[2]);
  else if (from) filtered.sort((a, b) => distance(a.center, from) - distance(b.center, from));

  const page = filtered.slice(query.offset, query.offset + query.limit);
  return {
    total: filtered.length,
    offset: query.offset,
    returned: page.map((entry) => toContext(scene, entry, from)),
    more: query.offset + page.length < filtered.length,
  };
}
