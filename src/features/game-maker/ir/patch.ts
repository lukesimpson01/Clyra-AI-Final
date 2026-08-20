/**
 * Transactional scene patching (spec §69, §80, §206).
 *
 * Rules enforced here, not by callers:
 *  - the whole patch is validated and dry-run before anything is written;
 *  - a stale `baseRevision` is rejected so an AI turn cannot silently
 *    overwrite edits the user made while it was thinking;
 *  - a repeated `idempotencyKey` is a no-op, so a retried request does not
 *    build the castle twice;
 *  - the hierarchy stays consistent (no cycles, no dangling children).
 */
import type {
  EntityIR,
  PatchOperation,
  PatchResult,
  SceneIR,
  ScenePatch,
  Vec3,
} from "./types";
import { ScenePatchSchema, safeParse } from "./schema";

export class PatchError extends Error {
  code: string;
  hint?: string;
  constructor(code: string, message: string, hint?: string) {
    super(message);
    this.code = code;
    this.hint = hint;
    this.name = "PatchError";
  }
}

const IDEMPOTENCY_KEY_FIELD = "__appliedPatchKeys";
const MAX_REMEMBERED_KEYS = 256;

export function defaultEntity(id: string, name: string): EntityIR {
  return {
    id,
    name,
    type: "group",
    tags: [],
    children: [],
    transform: { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
    components: [],
    assetRefs: [],
    visible: true,
  };
}

function cloneScene(scene: SceneIR): SceneIR {
  return structuredClone(scene);
}

function requireEntity(scene: SceneIR, id: string): EntityIR {
  const entity = scene.entities[id];
  if (!entity) {
    throw new PatchError(
      "ENTITY_NOT_FOUND",
      `No entity "${id}" in scene "${scene.name}".`,
      "Call scene.query first to get real entity ids; do not invent them.",
    );
  }
  return entity;
}

function detach(scene: SceneIR, entity: EntityIR) {
  if (entity.parentId) {
    const parent = scene.entities[entity.parentId];
    if (parent) parent.children = parent.children.filter((child) => child !== entity.id);
  } else {
    scene.rootEntities = scene.rootEntities.filter((child) => child !== entity.id);
  }
}

function attach(scene: SceneIR, entity: EntityIR, parentId: string | undefined, index?: number) {
  entity.parentId = parentId;
  const list = parentId ? requireEntity(scene, parentId).children : scene.rootEntities;
  const at = index === undefined ? list.length : Math.min(index, list.length);
  list.splice(at, 0, entity.id);
}

function isDescendant(scene: SceneIR, ancestorId: string, candidateId: string): boolean {
  let cursor: string | undefined = candidateId;
  const guard = new Set<string>();
  while (cursor) {
    if (cursor === ancestorId) return true;
    if (guard.has(cursor)) return false;
    guard.add(cursor);
    cursor = scene.entities[cursor]?.parentId;
  }
  return false;
}

/** Collect an entity and every descendant, deepest last. */
export function collectSubtree(scene: SceneIR, id: string): string[] {
  const out: string[] = [];
  const stack = [id];
  const seen = new Set<string>();
  while (stack.length) {
    const current = stack.pop()!;
    if (seen.has(current)) continue;
    seen.add(current);
    out.push(current);
    const entity = scene.entities[current];
    if (entity) stack.push(...entity.children);
  }
  return out;
}

function applyOperation(scene: SceneIR, op: PatchOperation, changed: Set<string>, warnings: string[]) {
  switch (op.op) {
    case "create": {
      if (scene.entities[op.entity.id]) {
        throw new PatchError(
          "DUPLICATE_ENTITY_ID",
          `Entity id "${op.entity.id}" already exists.`,
          "Entity ids must be unique across the scene. Generate a fresh id.",
        );
      }
      const entity: EntityIR = { ...defaultEntity(op.entity.id, op.entity.name), ...op.entity, children: [] };
      entity.parentId = undefined;
      scene.entities[entity.id] = entity;
      if (op.parentId && !scene.entities[op.parentId]) {
        throw new PatchError("PARENT_NOT_FOUND", `Parent "${op.parentId}" does not exist.`);
      }
      attach(scene, entity, op.parentId);
      changed.add(entity.id);
      break;
    }
    case "delete": {
      const entity = requireEntity(scene, op.entityId);
      if (entity.locked) throw new PatchError("ENTITY_LOCKED", `"${entity.name}" is locked.`, "Unlock it in the inspector, or ask the user first.");
      const subtree = collectSubtree(scene, op.entityId);
      detach(scene, entity);
      for (const id of subtree) {
        delete scene.entities[id];
        changed.add(id);
      }
      break;
    }
    case "reparent": {
      const entity = requireEntity(scene, op.entityId);
      if (op.parentId) {
        requireEntity(scene, op.parentId);
        if (isDescendant(scene, op.entityId, op.parentId)) {
          throw new PatchError("HIERARCHY_CYCLE", `Cannot parent "${entity.name}" to its own descendant.`);
        }
      }
      detach(scene, entity);
      attach(scene, entity, op.parentId, op.index);
      changed.add(entity.id);
      break;
    }
    case "rename":
      requireEntity(scene, op.entityId).name = op.name;
      changed.add(op.entityId);
      break;
    case "transform": {
      const entity = requireEntity(scene, op.entityId);
      if (entity.locked) throw new PatchError("ENTITY_LOCKED", `"${entity.name}" is locked.`);
      if (op.position) entity.transform.position = op.position;
      if (op.rotation) entity.transform.rotation = op.rotation;
      if (op.scale) {
        if (op.scale.some((value) => value === 0)) warnings.push(`Scale of "${entity.name}" has a zero axis; it will be invisible.`);
        entity.transform.scale = op.scale;
      }
      changed.add(op.entityId);
      break;
    }
    case "setVisible":
      requireEntity(scene, op.entityId).visible = op.visible;
      changed.add(op.entityId);
      break;
    case "setLocked":
      requireEntity(scene, op.entityId).locked = op.locked;
      changed.add(op.entityId);
      break;
    case "setTags":
      requireEntity(scene, op.entityId).tags = op.tags;
      changed.add(op.entityId);
      break;
    case "setComponent": {
      const entity = requireEntity(scene, op.entityId);
      const existing = entity.components.find((component) => component.type === op.component);
      if (existing) {
        existing.data = { ...existing.data, ...op.data };
        if (op.enabled !== undefined) existing.enabled = op.enabled;
      } else {
        entity.components.push({ type: op.component, data: op.data, enabled: op.enabled ?? true });
      }
      changed.add(op.entityId);
      break;
    }
    case "removeComponent": {
      const entity = requireEntity(scene, op.entityId);
      const before = entity.components.length;
      entity.components = entity.components.filter((component) => component.type !== op.component);
      if (entity.components.length === before) warnings.push(`"${entity.name}" had no ${op.component} component to remove.`);
      changed.add(op.entityId);
      break;
    }
    case "setBounds": {
      const entity = requireEntity(scene, op.entityId);
      entity.bounds = { center: op.center, size: op.size };
      changed.add(op.entityId);
      break;
    }
    case "setRegion": {
      const entity = requireEntity(scene, op.entityId);
      if (op.regionId && !scene.regions[op.regionId]) {
        throw new PatchError("REGION_NOT_FOUND", `No region "${op.regionId}".`, "Create it with an upsertRegion operation in the same patch.");
      }
      entity.regionId = op.regionId;
      changed.add(op.entityId);
      break;
    }
    case "setRelationship": {
      const entity = requireEntity(scene, op.entityId);
      entity.semanticRelationships = { ...(entity.semanticRelationships ?? {}), [op.relation]: op.targets };
      changed.add(op.entityId);
      break;
    }
    case "setGenerator":
      requireEntity(scene, op.entityId).generator = op.generator;
      changed.add(op.entityId);
      break;
    case "upsertRegion":
      scene.regions[op.region.id] = op.region;
      break;
    case "deleteRegion": {
      delete scene.regions[op.regionId];
      for (const entity of Object.values(scene.entities)) {
        if (entity.regionId === op.regionId) {
          entity.regionId = undefined;
          changed.add(entity.id);
        }
      }
      break;
    }
    case "setEnvironment":
      scene.environment = { ...scene.environment, ...op.environment };
      break;
    case "setNavigation":
      scene.navigation = op.navigation;
      break;
    case "setTerrain":
      scene.terrain = op.terrain;
      break;
    case "setVoxel":
      scene.voxel = op.voxel;
      break;
    case "setVoxelChunk": {
      if (!scene.voxel) throw new PatchError("NO_VOXEL_WORLD", "This scene has no voxel world.", "Run generate.voxelWorld first.");
      scene.voxel.chunks[op.key] = op.data;
      break;
    }
    case "setSceneMetadata":
      scene.metadata = { ...scene.metadata, ...op.metadata };
      break;
    default: {
      const exhaustive: never = op;
      throw new PatchError("UNKNOWN_OPERATION", `Unsupported operation: ${JSON.stringify(exhaustive)}`);
    }
  }
}

function appliedKeys(scene: SceneIR): string[] {
  const raw = scene.metadata[IDEMPOTENCY_KEY_FIELD];
  return Array.isArray(raw) ? (raw as string[]) : [];
}

/**
 * Apply a patch to a copy of the scene. The caller receives a brand-new
 * scene object on success and the original is never mutated, which is what
 * makes checkpoint/rollback cheap and makes React state updates safe.
 */
export function applyScenePatch(
  scene: SceneIR,
  rawPatch: unknown,
): { scene: SceneIR; result: PatchResult } {
  const parsed = safeParse(ScenePatchSchema, rawPatch);
  if (!parsed.ok) {
    const detail = parsed.issues.map((issue) => `${issue.path || "(root)"}: ${issue.message}`).join("; ");
    throw new PatchError("INVALID_PATCH", `The patch failed validation — ${detail}`, "Fix the listed fields and resend the whole patch.");
  }
  const patch: ScenePatch = parsed.value as ScenePatch;

  if (patch.sceneId !== scene.id) {
    throw new PatchError("WRONG_SCENE", `Patch targets scene "${patch.sceneId}" but the active scene is "${scene.id}".`);
  }
  if (patch.baseRevision !== undefined && patch.baseRevision !== scene.revision) {
    throw new PatchError(
      "STALE_REVISION",
      `This patch was planned against revision ${patch.baseRevision}, but the scene is now at ${scene.revision}.`,
      "Re-read the scene with editor.getContext or scene.query and re-plan against the current state.",
    );
  }
  if (patch.idempotencyKey && appliedKeys(scene).includes(patch.idempotencyKey)) {
    return {
      scene,
      result: { applied: false, revision: scene.revision, changedEntities: [], warnings: ["This patch was already applied; skipped."] },
    };
  }

  // Dry-run on a copy: nothing is committed unless every operation succeeds.
  const draft = cloneScene(scene);
  const changed = new Set<string>();
  const warnings: string[] = [];
  for (let index = 0; index < patch.operations.length; index += 1) {
    try {
      applyOperation(draft, patch.operations[index]!, changed, warnings);
    } catch (error) {
      if (error instanceof PatchError) {
        throw new PatchError(error.code, `Operation ${index} (${patch.operations[index]!.op}) failed: ${error.message}`, error.hint);
      }
      throw error;
    }
  }

  draft.revision = scene.revision + 1;
  if (patch.idempotencyKey) {
    draft.metadata[IDEMPOTENCY_KEY_FIELD] = [...appliedKeys(draft), patch.idempotencyKey].slice(-MAX_REMEMBERED_KEYS);
  }

  return {
    scene: draft,
    result: { applied: true, revision: draft.revision, changedEntities: [...changed], warnings },
  };
}

/* ---------------- world transforms ---------------- */

type Quat4 = [number, number, number, number];

function quatMultiply(a: Quat4, b: Quat4): Quat4 {
  return [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ];
}

function quatRotate(q: Quat4, v: Vec3): Vec3 {
  const [x, y, z, w] = q;
  const ix = w * v[0] + y * v[2] - z * v[1];
  const iy = w * v[1] + z * v[0] - x * v[2];
  const iz = w * v[2] + x * v[1] - y * v[0];
  const iw = -x * v[0] - y * v[1] - z * v[2];
  return [
    ix * w + iw * -x + iy * -z - iz * -y,
    iy * w + iw * -y + iz * -x - ix * -z,
    iz * w + iw * -z + ix * -y - iy * -x,
  ];
}

/** The ancestor chain, outermost first. */
function ancestry(scene: SceneIR, entityId: string): EntityIR[] {
  const chain: EntityIR[] = [];
  let cursor: string | undefined = entityId;
  const guard = new Set<string>();
  while (cursor && !guard.has(cursor)) {
    guard.add(cursor);
    const entity: EntityIR | undefined = scene.entities[cursor];
    if (!entity) break;
    chain.unshift(entity);
    cursor = entity.parentId;
  }
  return chain;
}

/**
 * Full world transform of an entity.
 *
 * Parent rotation and scale are applied, not just added: a door on a rotated
 * house sits where the house actually put it. Getting this wrong silently
 * corrupts the spatial index, picking, "put it here" grounding and the
 * playtest bot's pathing all at once, because every one of them asks this
 * function where things are.
 */
export function worldTransform(scene: SceneIR, entityId: string): { position: Vec3; rotation: Quat4; scale: Vec3 } {
  let position: Vec3 = [0, 0, 0];
  let rotation: Quat4 = [0, 0, 0, 1];
  let scale: Vec3 = [1, 1, 1];

  for (const entity of ancestry(scene, entityId)) {
    const local = entity.transform;
    const scaled: Vec3 = [local.position[0] * scale[0], local.position[1] * scale[1], local.position[2] * scale[2]];
    const rotated = quatRotate(rotation, scaled);
    position = [position[0] + rotated[0], position[1] + rotated[1], position[2] + rotated[2]];
    rotation = quatMultiply(rotation, local.rotation as Quat4);
    scale = [scale[0] * local.scale[0], scale[1] * local.scale[1], scale[2] * local.scale[2]];
  }
  return { position, rotation, scale };
}

/** World-space position of an entity. */
export function worldPosition(scene: SceneIR, entityId: string): Vec3 {
  return worldTransform(scene, entityId).position;
}

/**
 * World-space AABB size of an entity. A rotated box is bounded by the AABB
 * of its rotated extents, so picking and queries stay conservative rather
 * than reporting a box that is too small to hit.
 */
export function worldSize(scene: SceneIR, entityId: string): Vec3 {
  const entity = scene.entities[entityId];
  if (!entity) return [0, 0, 0];
  const { rotation, scale } = worldTransform(scene, entityId);
  const size = entity.bounds?.size ?? [1, 1, 1];
  const half: Vec3 = [Math.abs(size[0] * scale[0]) / 2, Math.abs(size[1] * scale[1]) / 2, Math.abs(size[2] * scale[2]) / 2];

  const isIdentity = Math.abs(rotation[0]) < 1e-6 && Math.abs(rotation[1]) < 1e-6 && Math.abs(rotation[2]) < 1e-6;
  if (isIdentity) return [half[0] * 2, half[1] * 2, half[2] * 2];

  // Rotate the three axis vectors and take the extent along each world axis.
  const x = quatRotate(rotation, [half[0], 0, 0]);
  const y = quatRotate(rotation, [0, half[1], 0]);
  const z = quatRotate(rotation, [0, 0, half[2]]);
  return [
    2 * (Math.abs(x[0]) + Math.abs(y[0]) + Math.abs(z[0])),
    2 * (Math.abs(x[1]) + Math.abs(y[1]) + Math.abs(z[1])),
    2 * (Math.abs(x[2]) + Math.abs(y[2]) + Math.abs(z[2])),
  ];
}
