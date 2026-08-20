/**
 * Runtime validation for everything that crosses a trust boundary.
 *
 * Spec §65: never trust AI tool arguments. Every tool input and every scene
 * patch is parsed through these before it can touch project state, so a
 * malformed model response fails with a structured error instead of writing
 * NaN into a transform.
 */
import { z } from "zod";

export const finite = z.number().finite();

export const Vec3Schema = z.tuple([finite, finite, finite]);
export const QuatSchema = z.tuple([finite, finite, finite, finite]);
export const ColorSchema = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, "Colours must be #rrggbb hex.");

export const EntityIdSchema = z
  .string()
  .min(1)
  .max(96)
  .regex(/^[A-Za-z0-9_.:-]+$/, "Entity ids may only contain letters, digits and _ . : -");

export const TagsSchema = z.array(z.string().min(1).max(48)).max(32);

export const ComponentIRSchema = z.object({
  type: z.string().min(1).max(64),
  enabled: z.boolean().optional(),
  data: z.record(z.string(), z.unknown()),
});

export const GeneratorMetadataSchema = z.object({
  generator: z.string().min(1).max(96),
  seed: z.number().int(),
  parameters: z.record(z.string(), z.unknown()),
  version: z.number().int().optional(),
});

export const BoundsSchema = z.object({ center: Vec3Schema, size: Vec3Schema });

export const EntityIRSchema = z.object({
  id: EntityIdSchema,
  name: z.string().min(1).max(120),
  type: z.string().min(1).max(48),
  tags: TagsSchema,
  parentId: EntityIdSchema.optional(),
  children: z.array(EntityIdSchema),
  transform: z.object({
    position: Vec3Schema,
    rotation: QuatSchema,
    scale: Vec3Schema,
  }),
  bounds: BoundsSchema.optional(),
  components: z.array(ComponentIRSchema).max(64),
  assetRefs: z.array(z.string()).max(64),
  visible: z.boolean(),
  locked: z.boolean().optional(),
  generator: GeneratorMetadataSchema.optional(),
  regionId: z.string().optional(),
  semanticRelationships: z.record(z.string(), z.array(EntityIdSchema)).optional(),
});

export const RegionIRSchema = z.object({
  id: z.string().min(1).max(96),
  name: z.string().min(1).max(120),
  kind: z.string().min(1).max(48),
  center: Vec3Schema,
  size: Vec3Schema,
  tags: TagsSchema,
});

export const EnvironmentIRSchema = z.object({
  skyColor: ColorSchema,
  groundColor: ColorSchema,
  ambientColor: ColorSchema,
  fog: z.object({ color: ColorSchema, start: finite, end: finite }).optional(),
  sun: z.object({ color: ColorSchema, intensity: finite, direction: Vec3Schema }).optional(),
  timeOfDay: finite.min(0).max(24).optional(),
  dayNightCycle: z.object({ enabled: z.boolean(), secondsPerDay: finite.positive() }).optional(),
});

export const NavigationIRSchema = z.object({
  cellSize: finite.positive(),
  agentRadius: finite.positive(),
  agentHeight: finite.positive(),
  maxSlopeDegrees: finite.min(0).max(90),
  maxStepHeight: finite.min(0),
  bounds: z.object({ min: Vec3Schema, max: Vec3Schema }),
  tiles: z.record(z.string(), z.string()).optional(),
  builtAt: finite.optional(),
  dirtyTiles: z.array(z.string()).optional(),
});

export const TerrainIRSchema = z.object({
  seed: z.number().int(),
  size: finite.positive(),
  tileSize: finite.positive(),
  maxHeight: finite.positive(),
  generator: z.string().min(1),
  parameters: z.record(z.string(), z.unknown()),
  tiles: z.record(z.string(), z.string()).optional(),
});

export const VoxelIRSchema = z.object({
  seed: z.number().int(),
  chunkSize: z.number().int().positive().max(64),
  worldHeight: z.number().int().positive().max(512),
  chunks: z.record(z.string(), z.string()),
  palette: z.array(
    z.object({ id: z.number().int().min(0).max(255), name: z.string(), color: ColorSchema, solid: z.boolean() }),
  ),
});

/* ---------------- Patch operations (spec §69) ---------------- */

export const PatchOperationSchema = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("create"),
    entity: EntityIRSchema.partial().extend({ id: EntityIdSchema, name: z.string().min(1).max(120) }),
    parentId: EntityIdSchema.optional(),
  }),
  z.object({ op: z.literal("delete"), entityId: EntityIdSchema }),
  z.object({
    op: z.literal("reparent"),
    entityId: EntityIdSchema,
    parentId: EntityIdSchema.optional(),
    index: z.number().int().min(0).optional(),
  }),
  z.object({ op: z.literal("rename"), entityId: EntityIdSchema, name: z.string().min(1).max(120) }),
  z.object({
    op: z.literal("transform"),
    entityId: EntityIdSchema,
    position: Vec3Schema.optional(),
    rotation: QuatSchema.optional(),
    scale: Vec3Schema.optional(),
  }),
  z.object({ op: z.literal("setVisible"), entityId: EntityIdSchema, visible: z.boolean() }),
  z.object({ op: z.literal("setLocked"), entityId: EntityIdSchema, locked: z.boolean() }),
  z.object({ op: z.literal("setTags"), entityId: EntityIdSchema, tags: TagsSchema }),
  z.object({
    op: z.literal("setComponent"),
    entityId: EntityIdSchema,
    component: z.string().min(1).max(64),
    data: z.record(z.string(), z.unknown()),
    enabled: z.boolean().optional(),
  }),
  z.object({ op: z.literal("removeComponent"), entityId: EntityIdSchema, component: z.string().min(1) }),
  z.object({ op: z.literal("setBounds"), entityId: EntityIdSchema, center: Vec3Schema, size: Vec3Schema }),
  z.object({ op: z.literal("setRegion"), entityId: EntityIdSchema, regionId: z.string().optional() }),
  z.object({
    op: z.literal("setRelationship"),
    entityId: EntityIdSchema,
    relation: z.string().min(1).max(48),
    targets: z.array(EntityIdSchema).max(512),
  }),
  z.object({ op: z.literal("setGenerator"), entityId: EntityIdSchema, generator: GeneratorMetadataSchema.optional() }),
  z.object({ op: z.literal("upsertRegion"), region: RegionIRSchema }),
  z.object({ op: z.literal("deleteRegion"), regionId: z.string().min(1) }),
  z.object({ op: z.literal("setEnvironment"), environment: EnvironmentIRSchema.partial() }),
  z.object({ op: z.literal("setNavigation"), navigation: NavigationIRSchema }),
  z.object({ op: z.literal("setTerrain"), terrain: TerrainIRSchema }),
  z.object({ op: z.literal("setVoxel"), voxel: VoxelIRSchema }),
  z.object({ op: z.literal("setVoxelChunk"), key: z.string().min(1), data: z.string() }),
  z.object({ op: z.literal("setSceneMetadata"), metadata: z.record(z.string(), z.unknown()) }),
]);

export const ScenePatchSchema = z.object({
  sceneId: z.string().min(1),
  baseRevision: z.number().int().min(0).optional(),
  /** Capped: a single patch that creates 20k entities is a generator's job. */
  operations: z.array(PatchOperationSchema).min(1).max(20000),
  idempotencyKey: z.string().max(128).optional(),
  label: z.string().max(160).optional(),
});

export type ValidationIssue = { path: string; message: string };

export function collectIssues(error: z.ZodError): ValidationIssue[] {
  return error.issues.slice(0, 25).map((issue) => ({
    path: issue.path.join("."),
    message: issue.message,
  }));
}

export type ParseSuccess<T> = { ok: true; value: T; issues?: undefined };
export type ParseFailure = { ok: false; value?: undefined; issues: ValidationIssue[] };
export type ParseOutcome<T> = ParseSuccess<T> | ParseFailure;

/** Parse helper that returns a structured failure rather than throwing. */
export function safeParse<T>(schema: z.ZodType<T>, value: unknown): ParseOutcome<T> {
  const result = schema.safeParse(value);
  if (result.success) return { ok: true, value: result.data };
  return { ok: false, issues: collectIssues(result.error) };
}
