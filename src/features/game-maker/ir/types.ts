/**
 * GameIR — the Intermediate Representation.
 *
 * This is the semantic description of a game that the AI reasons about and
 * that the editor edits. It is deliberately NOT a PlayCanvas/Phaser scene:
 * runtime adapters compile IR into engine objects (see runtime/compiler.ts),
 * and nothing outside `engine/` is allowed to hold an engine object.
 *
 * Everything here must be JSON-serialisable — it is persisted, diffed,
 * patched, checkpointed and sent over the wire.
 */

export const GAME_IR_VERSION = 3;

export type Vec3 = [number, number, number];
export type Quat = [number, number, number, number];
export type RuntimeMode = "3d" | "2d" | "voxel";
export type QualityProfile = "8GB_SAFE" | "BALANCED" | "HIGH";

/* ------------------------------------------------------------------ */
/* Entities                                                            */
/* ------------------------------------------------------------------ */

/** A reusable behaviour or data block attached to an entity (spec §105). */
export interface ComponentIR {
  type: string;
  enabled?: boolean;
  data: Record<string, unknown>;
}

/**
 * How a procedural object was created, so it can be regenerated or varied
 * later without the model having to remember (spec §39).
 */
export interface GeneratorMetadata {
  generator: string;
  seed: number;
  parameters: Record<string, unknown>;
  /** Version of the generator that produced this, for reproducibility. */
  version?: number;
}

export interface EntityIR {
  id: string;
  name: string;
  /** Semantic type: "group" | "mesh" | "light" | "camera" | "character" | ... */
  type: string;
  tags: string[];
  parentId?: string;
  children: string[];

  transform: {
    position: Vec3;
    /** Quaternion (x, y, z, w). Euler is never stored — it is lossy. */
    rotation: Quat;
    scale: Vec3;
  };

  /** Local-space axis-aligned bounds. Recomputed on geometry change. */
  bounds?: { center: Vec3; size: Vec3 };

  components: ComponentIR[];
  assetRefs: string[];

  visible: boolean;
  locked?: boolean;

  generator?: GeneratorMetadata;

  /** Region membership + graph edges: "patrols", "connects", "contains". */
  regionId?: string;
  semanticRelationships?: Record<string, string[]>;
}

/* ------------------------------------------------------------------ */
/* Scenes                                                              */
/* ------------------------------------------------------------------ */

export interface EnvironmentIR {
  skyColor: string;
  groundColor: string;
  ambientColor: string;
  fog?: { color: string; start: number; end: number };
  sun?: { color: string; intensity: number; direction: Vec3 };
  /** 0..24 hours; drives a day/night cycle when `dayNightCycle` is set. */
  timeOfDay?: number;
  dayNightCycle?: { enabled: boolean; secondsPerDay: number };
}

export interface RegionIR {
  id: string;
  name: string;
  kind: string;
  center: Vec3;
  /** Axis-aligned extents; regions are boxes, which is enough for queries. */
  size: Vec3;
  tags: string[];
}

export interface NavigationIR {
  /** Built by nav/navmesh.ts in a worker; tiles are rebuilt individually. */
  cellSize: number;
  agentRadius: number;
  agentHeight: number;
  maxSlopeDegrees: number;
  maxStepHeight: number;
  bounds: { min: Vec3; max: Vec3 };
  /** Tile key -> base64 walkability bitmap. Absent until built. */
  tiles?: Record<string, string>;
  builtAt?: number;
  dirtyTiles?: string[];
}

export interface TerrainIR {
  seed: number;
  size: number;
  tileSize: number;
  maxHeight: number;
  generator: string;
  parameters: Record<string, unknown>;
  /** Tile key -> base64 Float32 heights. Generated in a worker on demand. */
  tiles?: Record<string, string>;
}

export interface VoxelIR {
  seed: number;
  chunkSize: number;
  worldHeight: number;
  /** Chunk key "x,y,z" -> base64 Uint8 block ids. Typed arrays, never objects. */
  chunks: Record<string, string>;
  palette: { id: number; name: string; color: string; solid: boolean }[];
}

export interface SceneIR {
  id: string;
  name: string;
  dimensions: RuntimeMode;
  rootEntities: string[];
  entities: Record<string, EntityIR>;
  environment: EnvironmentIR;
  regions: Record<string, RegionIR>;
  navigation?: NavigationIR;
  terrain?: TerrainIR;
  voxel?: VoxelIR;
  /** Bumped on every applied patch; used for optimistic concurrency (§206). */
  revision: number;
  metadata: Record<string, unknown>;
}

/* ------------------------------------------------------------------ */
/* Assets                                                              */
/* ------------------------------------------------------------------ */

export type AssetType =
  | "mesh"
  | "texture"
  | "material"
  | "animation"
  | "audio"
  | "sprite"
  | "tileset"
  | "prefab"
  | "script";

export type AssetSource = "procedural" | "generated" | "uploaded" | "library";

export interface AssetProvenance {
  origin: AssetSource;
  license: string;
  author?: string;
  generator?: string;
  model?: string;
  modelVersion?: string;
  seed?: number;
  prompt?: string;
  generatedAt: number;
  modifications?: string[];
  /** Set when provenance forbids publishing (spec §254). */
  commercialUseAllowed: boolean;
}

export interface AssetRecord {
  id: string;
  name: string;
  type: AssetType;
  source: AssetSource;
  /** Content hash. Identical content is reused rather than duplicated (§96). */
  hash: string;
  /** Inline definition for procedural assets; `url` for stored blobs. */
  definition?: Record<string, unknown>;
  url?: string;
  bytes?: number;
  metadata: Record<string, unknown>;
  provenance: AssetProvenance;
}

/* ------------------------------------------------------------------ */
/* Systems, input, UI, audio                                           */
/* ------------------------------------------------------------------ */

export interface GameplaySystemRecord {
  id: string;
  type: string;
  enabled: boolean;
  config: Record<string, unknown>;
}

/** Semantic actions, never raw keys, in gameplay code (spec §120). */
export type InputMap = Record<string, string[]>;

export interface UINode {
  id: string;
  type: string;
  props: Record<string, unknown>;
  children: UINode[];
}

export interface UIGraph {
  screens: Record<string, UINode>;
  activeScreen?: string;
}

export interface AudioGraph {
  buses: Record<string, { volume: number }>;
  cues: Record<string, { generator: string; seed: number; parameters: Record<string, unknown> }>;
}

/* ------------------------------------------------------------------ */
/* Tests + performance                                                 */
/* ------------------------------------------------------------------ */

export interface GameTestDefinition {
  id: string;
  name: string;
  sceneId: string;
  /** Source text in the playtest DSL (playtest/dsl.ts). */
  script: string;
  timeoutMs: number;
}

export interface PerformanceProfile {
  targetFPS: number;
  minimumFPS: number;
  profile: QualityProfile;
  maxDrawCalls: number;
  maxTriangles: number;
  maxTextureMegabytes: number;
}

export interface GameMetadata {
  name: string;
  concept: string;
  genre: string;
  camera: string;
  coreLoop: string;
  artStyle: {
    name: string;
    palette: string[];
    geometry: string;
    materialDetail: string;
  };
  createdAt: number;
  updatedAt: number;
}

/* ------------------------------------------------------------------ */
/* Project                                                             */
/* ------------------------------------------------------------------ */

export interface GameProjectIR {
  projectId: string;
  /** GAME_IR_VERSION at write time; older projects are migrated on load. */
  version: number;

  metadata: GameMetadata;

  runtime: { mode: RuntimeMode; adapter: string };

  scenes: SceneIR[];
  activeSceneId: string;

  assets: AssetRecord[];
  systems: GameplaySystemRecord[];

  input: InputMap;
  ui: UIGraph;
  audio: AudioGraph;

  scripts: Record<string, string>;

  tests: GameTestDefinition[];
  performanceProfile: PerformanceProfile;

  /** Durable design + preference memory the AI retrieves from (spec §77). */
  memory: ProjectMemory;
}

export interface ProjectMemoryEntry {
  id: string;
  kind: "fact" | "decision" | "preference" | "bug" | "runbook";
  text: string;
  tags: string[];
  createdAt: number;
}

export interface ProjectMemory {
  entries: ProjectMemoryEntry[];
}

/* ------------------------------------------------------------------ */
/* Patches                                                             */
/* ------------------------------------------------------------------ */

export type PatchOperation =
  | { op: "create"; entity: Partial<EntityIR> & { id: string; name: string }; parentId?: string }
  | { op: "delete"; entityId: string }
  | { op: "reparent"; entityId: string; parentId?: string; index?: number }
  | { op: "rename"; entityId: string; name: string }
  | { op: "transform"; entityId: string; position?: Vec3; rotation?: Quat; scale?: Vec3 }
  | { op: "setVisible"; entityId: string; visible: boolean }
  | { op: "setLocked"; entityId: string; locked: boolean }
  | { op: "setTags"; entityId: string; tags: string[] }
  | { op: "setComponent"; entityId: string; component: string; data: Record<string, unknown>; enabled?: boolean }
  | { op: "removeComponent"; entityId: string; component: string }
  | { op: "setBounds"; entityId: string; center: Vec3; size: Vec3 }
  | { op: "setRegion"; entityId: string; regionId?: string }
  | { op: "setRelationship"; entityId: string; relation: string; targets: string[] }
  | { op: "setGenerator"; entityId: string; generator?: GeneratorMetadata }
  | { op: "upsertRegion"; region: RegionIR }
  | { op: "deleteRegion"; regionId: string }
  | { op: "setEnvironment"; environment: Partial<EnvironmentIR> }
  | { op: "setNavigation"; navigation: NavigationIR }
  | { op: "setTerrain"; terrain: TerrainIR }
  | { op: "setVoxel"; voxel: VoxelIR }
  | { op: "setVoxelChunk"; key: string; data: string }
  | { op: "setSceneMetadata"; metadata: Record<string, unknown> };

export interface ScenePatch {
  sceneId: string;
  /** Optimistic concurrency: reject if the scene has moved on (spec §206). */
  baseRevision?: number;
  operations: PatchOperation[];
  /** Retry-safe: an already-applied key is a no-op, not a second castle (§216). */
  idempotencyKey?: string;
  label?: string;
}

export interface PatchResult {
  applied: boolean;
  revision: number;
  changedEntities: string[];
  warnings: string[];
}

/* ------------------------------------------------------------------ */
/* Tool protocol                                                       */
/* ------------------------------------------------------------------ */

export interface ToolError {
  code: string;
  message: string;
  retryable: boolean;
  hint?: string;
}

export interface ToolResult<T = unknown> {
  ok: boolean;
  data?: T;
  error?: ToolError;
  meta: {
    durationMs: number;
    changedEntities?: string[];
    createdEntities?: string[];
    deletedEntities?: string[];
    createdAssets?: string[];
    sceneRevisionBefore?: number;
    sceneRevisionAfter?: number;
    warnings?: string[];
  };
}

/* ------------------------------------------------------------------ */
/* Context grounding                                                   */
/* ------------------------------------------------------------------ */

export interface EntityContext {
  entityId: string;
  name: string;
  type: string;
  tags: string[];
  position: Vec3;
  size: Vec3;
  distance?: number;
  /** Normalised [x0, y0, x1, y1] in viewport space, when on screen. */
  screenBounds?: [number, number, number, number];
  screenCoverage?: number;
  regionId?: string;
}

export interface SceneSummaryNode {
  label: string;
  count: number;
  children?: SceneSummaryNode[];
}

export interface SceneSummary {
  sceneId: string;
  name: string;
  entityCount: number;
  regionCount: number;
  tree: SceneSummaryNode;
  systems: string[];
  bounds: { min: Vec3; max: Vec3 };
}

export interface ContextFrame {
  id: string;
  projectId: string;
  sceneId: string;
  sceneRevision: number;
  editorMode: RuntimeMode;
  timestamp: number;

  camera?: {
    position: Vec3;
    rotation: Quat;
    forward: Vec3;
    right: Vec3;
    up: Vec3;
    fov: number;
  };

  cursor: {
    x: number;
    y: number;
    ray?: { origin: Vec3; direction: Vec3 };
    hit?: { position: Vec3; normal: Vec3; entityId?: string; distance: number };
  };

  selected: EntityContext[];
  hovered?: EntityContext;
  visible: EntityContext[];
  nearby: EntityContext[];
  sceneSummary: SceneSummary;
}
