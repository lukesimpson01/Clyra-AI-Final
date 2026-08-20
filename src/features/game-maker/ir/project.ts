/**
 * Project construction, migration and validation (spec §36, §193, §252).
 */
import { GAME_IR_VERSION } from "./types";
import type {
  AssetRecord,
  GameProjectIR,
  QualityProfile,
  RuntimeMode,
  SceneIR,
} from "./types";

let idSequence = 0;

/** Stable in Electron, localhost, tests and non-secure LAN preview contexts. */
export function createId(prefix = "gm"): string {
  const native = globalThis.crypto?.randomUUID?.();
  if (native) return `${prefix}-${native.slice(0, 18)}`;
  idSequence += 1;
  const bytes = new Uint32Array(2);
  globalThis.crypto?.getRandomValues?.(bytes);
  return `${prefix}-${Date.now().toString(36)}-${(bytes[0] ?? idSequence).toString(36)}-${idSequence.toString(36)}`;
}

export const PERFORMANCE_PROFILES: Record<QualityProfile, GameProjectIR["performanceProfile"]> = {
  // Spec §149: an 8 GB laptop is the design target, not an afterthought.
  "8GB_SAFE": { targetFPS: 60, minimumFPS: 40, profile: "8GB_SAFE", maxDrawCalls: 700, maxTriangles: 900_000, maxTextureMegabytes: 256 },
  BALANCED: { targetFPS: 60, minimumFPS: 45, profile: "BALANCED", maxDrawCalls: 1400, maxTriangles: 2_200_000, maxTextureMegabytes: 512 },
  HIGH: { targetFPS: 60, minimumFPS: 50, profile: "HIGH", maxDrawCalls: 2600, maxTriangles: 5_000_000, maxTextureMegabytes: 1024 },
};

export function createScene(id: string, name: string, dimensions: RuntimeMode): SceneIR {
  return {
    id,
    name,
    dimensions,
    rootEntities: [],
    entities: {},
    environment: {
      skyColor: "#8fb7de",
      groundColor: "#6f7d5c",
      ambientColor: "#3a4256",
      sun: { color: "#fff4e0", intensity: 1.1, direction: [-0.45, -0.8, -0.4] },
      timeOfDay: 11,
    },
    regions: {},
    revision: 0,
    metadata: {},
  };
}

export const DEFAULT_INPUT_MAP = {
  moveForward: ["KeyW", "ArrowUp"],
  moveBackward: ["KeyS", "ArrowDown"],
  moveLeft: ["KeyA", "ArrowLeft"],
  moveRight: ["KeyD", "ArrowRight"],
  jump: ["Space"],
  sprint: ["ShiftLeft"],
  crouch: ["KeyC"],
  interact: ["KeyE"],
  attack: ["Mouse0"],
  block: ["Mouse1"],
  inventory: ["KeyI"],
  pause: ["Escape"],
  restart: ["KeyR"],
};

export function createProject(options: {
  projectId?: string;
  name: string;
  concept: string;
  mode: RuntimeMode;
  genre?: string;
  camera?: string;
  coreLoop?: string;
  palette?: string[];
  profile?: QualityProfile;
}): GameProjectIR {
  const now = Date.now();
  const scene = createScene("scene-main", options.mode === "2d" ? "Level_01" : "World", options.mode);
  return {
    projectId: options.projectId ?? createId("project"),
    version: GAME_IR_VERSION,
    metadata: {
      name: options.name,
      concept: options.concept,
      genre: options.genre ?? "adventure",
      camera: options.camera ?? (options.mode === "2d" ? "side-scrolling" : "third-person"),
      coreLoop: options.coreLoop ?? "explore, interact, progress",
      artStyle: {
        name: "stylised",
        palette: options.palette ?? ["#2f3a4a", "#6f8fae", "#c8b18a", "#8fae6f", "#e8dfcd"],
        geometry: "medium low-poly",
        materialDetail: "medium",
      },
      createdAt: now,
      updatedAt: now,
    },
    runtime: { mode: options.mode, adapter: options.mode === "2d" ? "phaser-2d" : options.mode === "voxel" ? "voxel" : "playcanvas-3d" },
    scenes: [scene],
    activeSceneId: scene.id,
    assets: [],
    systems: [],
    input: { ...DEFAULT_INPUT_MAP },
    ui: { screens: {} },
    audio: { buses: { master: { volume: 1 }, music: { volume: 0.6 }, sfx: { volume: 0.9 } }, cues: {} },
    scripts: {},
    tests: [],
    performanceProfile: PERFORMANCE_PROFILES[options.profile ?? "8GB_SAFE"],
    memory: { entries: [] },
  };
}

export function activeScene(project: GameProjectIR): SceneIR {
  return project.scenes.find((scene) => scene.id === project.activeSceneId) ?? project.scenes[0]!;
}

export function replaceScene(project: GameProjectIR, scene: SceneIR): GameProjectIR {
  return {
    ...project,
    scenes: project.scenes.map((existing) => (existing.id === scene.id ? scene : existing)),
    metadata: { ...project.metadata, updatedAt: Date.now() },
  };
}

/* ------------------------------------------------------------------ */
/* Migration (spec §193): old projects must keep opening.              */
/* ------------------------------------------------------------------ */

type Migration = (project: Record<string, unknown>) => Record<string, unknown>;

const MIGRATIONS: Record<number, Migration> = {
  // v1 had no regions and no per-scene revision counter.
  1: (project) => {
    const scenes = (project.scenes as Record<string, unknown>[] | undefined) ?? [];
    for (const scene of scenes) {
      scene.regions ??= {};
      scene.revision ??= 0;
      scene.metadata ??= {};
    }
    project.version = 2;
    return project;
  },
  // v2 kept design notes only in the chat transcript.
  2: (project) => {
    project.memory ??= { entries: [] };
    project.scripts ??= {};
    project.version = 3;
    return project;
  },
};

export function migrateProject(raw: unknown): GameProjectIR {
  if (!raw || typeof raw !== "object") throw new Error("Not a game project.");
  let project = { ...(raw as Record<string, unknown>) };
  let version = Number(project.version ?? 1);
  if (!Number.isFinite(version) || version < 1) version = 1;
  let guard = 0;
  while (version < GAME_IR_VERSION && guard < 16) {
    const migration = MIGRATIONS[version];
    if (!migration) break;
    project = migration(project);
    version = Number(project.version ?? version + 1);
    guard += 1;
  }
  project.version = GAME_IR_VERSION;
  return project as unknown as GameProjectIR;
}

/* ------------------------------------------------------------------ */
/* Validation (spec §252)                                              */
/* ------------------------------------------------------------------ */

export interface ProjectIssue {
  severity: "error" | "warning";
  code: string;
  message: string;
  entityId?: string;
}

export function validateProject(project: GameProjectIR): ProjectIssue[] {
  const issues: ProjectIssue[] = [];
  const assetIds = new Set(project.assets.map((asset: AssetRecord) => asset.id));

  if (!project.scenes.length) {
    issues.push({ severity: "error", code: "NO_SCENE", message: "The project has no scenes." });
    return issues;
  }
  if (!project.scenes.some((scene) => scene.id === project.activeSceneId)) {
    issues.push({ severity: "error", code: "NO_ACTIVE_SCENE", message: "activeSceneId does not name a scene in this project." });
  }

  for (const scene of project.scenes) {
    const seen = new Set<string>();
    let hasCamera = false;
    let hasSpawn = false;

    for (const [id, entity] of Object.entries(scene.entities)) {
      if (id !== entity.id) {
        issues.push({ severity: "error", code: "ID_MISMATCH", message: `Entity keyed "${id}" reports id "${entity.id}".`, entityId: id });
      }
      if (seen.has(entity.id)) {
        issues.push({ severity: "error", code: "DUPLICATE_ID", message: `Duplicate entity id "${entity.id}".`, entityId: entity.id });
      }
      seen.add(entity.id);

      if (entity.parentId && !scene.entities[entity.parentId]) {
        issues.push({ severity: "error", code: "BROKEN_PARENT", message: `"${entity.name}" points at missing parent "${entity.parentId}".`, entityId: entity.id });
      }
      for (const child of entity.children) {
        if (!scene.entities[child]) {
          issues.push({ severity: "error", code: "BROKEN_CHILD", message: `"${entity.name}" lists missing child "${child}".`, entityId: entity.id });
        }
      }
      for (const ref of entity.assetRefs) {
        if (!assetIds.has(ref)) {
          issues.push({ severity: "error", code: "MISSING_ASSET", message: `"${entity.name}" references missing asset "${ref}".`, entityId: entity.id });
        }
      }
      if (entity.regionId && !scene.regions[entity.regionId]) {
        issues.push({ severity: "warning", code: "MISSING_REGION", message: `"${entity.name}" is in unknown region "${entity.regionId}".`, entityId: entity.id });
      }
      for (const value of [...entity.transform.position, ...entity.transform.scale, ...entity.transform.rotation]) {
        if (!Number.isFinite(value)) {
          issues.push({ severity: "error", code: "INVALID_TRANSFORM", message: `"${entity.name}" has a non-finite transform value.`, entityId: entity.id });
          break;
        }
      }
      if (entity.type === "camera") hasCamera = true;
      if (entity.tags.includes("player-spawn") || entity.type === "playerSpawn") hasSpawn = true;
    }

    for (const rootId of scene.rootEntities) {
      if (!scene.entities[rootId]) {
        issues.push({ severity: "error", code: "BROKEN_ROOT", message: `Scene "${scene.name}" lists missing root entity "${rootId}".` });
      }
    }
    if (!hasCamera) issues.push({ severity: "warning", code: "NO_CAMERA", message: `Scene "${scene.name}" has no camera entity; the runtime will insert a default one.` });
    if (!hasSpawn) issues.push({ severity: "warning", code: "NO_PLAYER_SPAWN", message: `Scene "${scene.name}" has no player spawn; play mode will start at the origin.` });
  }

  for (const [action, keys] of Object.entries(project.input)) {
    if (!keys.length) issues.push({ severity: "warning", code: "UNBOUND_ACTION", message: `Input action "${action}" has no bindings.` });
  }

  return issues;
}

/** Pre-publish gate (spec §254): provenance that forbids commercial use blocks. */
export function licenseIssues(project: GameProjectIR): ProjectIssue[] {
  return project.assets
    .filter((asset) => asset.provenance.commercialUseAllowed === false)
    .map((asset) => ({
      severity: "error" as const,
      code: "LICENSE_BLOCKED",
      message: `Asset "${asset.name}" (${asset.provenance.origin}, ${asset.provenance.license}) is not cleared for publishing.`,
    }));
}
