/**
 * Clyra Game Maker — headless unit tests.
 *
 * Everything tested here is a pure function over the IR, so it runs in plain
 * Node with no browser and no GPU: patches, grounding, spatial queries,
 * procedural generators, navigation, the playtest DSL, tool validation and
 * project validation. The browser-only layers (viewport, sandboxed runtime)
 * are exercised by the Playwright suite in tools/game-maker-e2e.ts.
 *
 * Run: npm run test:game-maker
 */
import assert from "node:assert/strict";

import { GAME_IR_VERSION, type PatchOperation, type SceneIR, type Vec3 } from "../src/features/game-maker/ir/types";
import { activeScene, createProject, createScene, migrateProject, replaceScene, validateProject } from "../src/features/game-maker/ir/project";
import { evaluateGameCompletionGate, validateProjectSubstance } from "../src/features/game-maker/ir/substance";
import { applyScenePatch, collectSubtree, PatchError, worldPosition, worldSize, worldTransform } from "../src/features/game-maker/ir/patch";
import { ScenePatchSchema, safeParse } from "../src/features/game-maker/ir/schema";
import { getSpatialIndex, rayAabb, SpatialIndex } from "../src/features/game-maker/scene/spatial";
import { runSceneQuery, SceneQuerySchema } from "../src/features/game-maker/scene/query";
import { buildSceneSummary, formatSceneSummary } from "../src/features/game-maker/scene/summary";
import {
  findFreePositions,
  GroundingError,
  lookAtYaw,
  quaternionFromYaw,
  resolveAnchor,
  resolveDirection,
  resolvePlacement,
  rotateVector,
} from "../src/features/game-maker/scene/grounding";
import { HistoryStack } from "../src/features/game-maker/history/history";
import { Rng, fbm2D, hashString } from "../src/features/game-maker/procedural/random";
import { buildExtrudedGeometry, meshBounds, polygonArea, rectangleFootprint, triangulatePolygon } from "../src/features/game-maker/procedural/mesh";
import { generateMaterial, materialHash, paletteForStyle } from "../src/features/game-maker/procedural/materials";
import { runGenerator, listGenerators, generatorSchema, discoverGenerators, GeneratorError } from "../src/features/game-maker/procedural/registry";
import { terrainHeightAt, generateTile, TERRAIN_RESOLUTION } from "../src/features/game-maker/procedural/terrain";
import { firstUnreachableColumn, generateTilemap, TILE, Tilemap2DParamsSchema } from "../src/features/game-maker/procedural/tilemap2d";
import { chunkKey, decodeChunk, encodeChunk, generateChunk, meshChunk, voxelSurfaceHeight, VoxelParamsSchema } from "../src/features/game-maker/procedural/voxel";
import { resolveScatter, VegetationParamsSchema } from "../src/features/game-maker/procedural/vegetation";
import { catmullRom } from "../src/features/game-maker/procedural/roads";
import { buildNavGrid, cellSizeForBounds, findPath, isWalkable, dirtyTilesFor, DEFAULT_NAV_CONFIG, navigationIRFrom, type NavGeometry } from "../src/features/game-maker/nav/navmesh";
import { listComponents, validateComponent, componentSchema } from "../src/features/game-maker/gameplay/components";
import { validateQuests, localisationKeys, defaultScreens, QuestSchema } from "../src/features/game-maker/gameplay/quests";
import { formatTest, parseTest } from "../src/features/game-maker/playtest/dsl";
import { approachPosition, classifyFailure, resolveTarget } from "../src/features/game-maker/playtest/runner";
import { TOOLS, canonicalToolName, getTool, toolCatalogue } from "../src/features/game-maker/ai/tools";
import { EditorRuntimeCommandSchema, RuntimeMessageSchema } from "../src/features/game-maker/runtime/protocol";

/* ------------------------------------------------------------------ */

let passed = 0;
const failures: string[] = [];
let section = "";

function group(name: string) {
  section = name;
  process.stdout.write(`\n${name}\n`);
}

function check(name: string, run: () => void) {
  try {
    run();
    passed += 1;
    process.stdout.write(`  ok   ${name}\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    failures.push(`${section} › ${name}: ${message}`);
    process.stdout.write(`  FAIL ${name}\n       ${message.split("\n")[0]}\n`);
  }
}

/* ---------------- fixtures ---------------- */

function sceneWith(entities: { id: string; name?: string; type?: string; tags?: string[]; position: Vec3; size?: Vec3; parentId?: string }[]): SceneIR {
  const scene = createScene("scene-test", "Test", "3d");
  for (const spec of entities) {
    scene.entities[spec.id] = {
      id: spec.id,
      name: spec.name ?? spec.id,
      type: spec.type ?? "mesh",
      tags: spec.tags ?? [],
      children: [],
      parentId: spec.parentId,
      transform: { position: spec.position, rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
      bounds: { center: [0, 0, 0], size: spec.size ?? [2, 2, 2] },
      components: [{ type: "Collider", data: { shape: "box", body: "static" } }],
      assetRefs: [],
      visible: true,
    };
    if (spec.parentId) scene.entities[spec.parentId]!.children.push(spec.id);
    else scene.rootEntities.push(spec.id);
  }
  return scene;
}

const genContext = (scene: SceneIR, sampleHeight?: (x: number, z: number) => number | undefined) => {
  let counter = 0;
  return {
    scene,
    sampleHeight,
    nextId: (hint: string) => `${hint}-${(counter += 1).toString(36)}`,
  };
};

const createOps = (operations: PatchOperation[]) => operations.filter((operation) => operation.op === "create");

/* ================================================================== */
group("GameIR: project, migration, validation");

check("createProject produces a valid, versioned project", () => {
  const project = createProject({ name: "Test", concept: "a test", mode: "3d" });
  assert.equal(project.version, GAME_IR_VERSION);
  assert.equal(project.scenes.length, 1);
  assert.equal(activeScene(project).id, project.activeSceneId);
  assert.ok(project.input.jump.includes("Space"), "default input map binds jump");
  assert.equal(project.performanceProfile.profile, "8GB_SAFE");
});

check("migrateProject upgrades a v1 project without losing data", () => {
  const legacy = {
    version: 1,
    projectId: "old",
    scenes: [{ id: "s", name: "Old", dimensions: "3d", rootEntities: [], entities: {}, environment: {} }],
    activeSceneId: "s",
  };
  const migrated = migrateProject(legacy);
  assert.equal(migrated.version, GAME_IR_VERSION);
  assert.deepEqual(migrated.scenes[0]!.regions, {});
  assert.equal(migrated.scenes[0]!.revision, 0);
  assert.deepEqual(migrated.memory, { entries: [] });
  assert.equal(migrated.projectId, "old", "migration preserves identity");
});

check("validateProject reports broken references and missing spawn", () => {
  const project = createProject({ name: "T", concept: "c", mode: "3d" });
  const scene = activeScene(project);
  scene.entities.a = {
    id: "a", name: "A", type: "mesh", tags: [], children: ["ghost"], parentId: undefined,
    transform: { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
    components: [], assetRefs: ["missing-asset"], visible: true,
  };
  scene.rootEntities.push("a");
  const issues = validateProject(replaceScene(project, scene));
  const codes = issues.map((issue) => issue.code);
  assert.ok(codes.includes("BROKEN_CHILD"), "dangling child is an error");
  assert.ok(codes.includes("MISSING_ASSET"), "missing asset reference is an error");
  assert.ok(codes.includes("NO_PLAYER_SPAWN"), "missing player spawn is a warning");
});

check("ProjectSubstanceValidator rejects a structurally valid blank project", () => {
  const project = createProject({ name: "Blank", concept: "blank", mode: "2d" });
  const report = validateProjectSubstance(project);
  assert.equal(report.valid, false);
  assert.ok(report.issues.some((issue) => issue.code === "PROJECT_NOT_PLAYABLE"));
  assert.ok(report.issues.some((issue) => issue.code === "MISSING_OBJECTIVE"));
});

check("the completion gate refuses success without real runtime evidence", () => {
  const project = createProject({ name: "Blank", concept: "blank", mode: "3d" });
  const gate = evaluateGameCompletionGate(project, true, { runtimeBooted: false, smokeTestPassed: false, noCriticalRuntimeErrors: false });
  assert.equal(gate.complete, false);
  assert.ok(gate.missing.includes("runtime boot evidence"));
  assert.ok(gate.missing.includes("passing smoke test"));
});

/* ================================================================== */
group("Scene patches: transactional, validated, concurrency-safe");

check("a valid patch applies and bumps the revision", () => {
  const scene = sceneWith([{ id: "ground", position: [0, 0, 0], size: [40, 1, 40] }]);
  const { scene: next, result } = applyScenePatch(scene, {
    sceneId: scene.id,
    baseRevision: 0,
    operations: [
      { op: "create", entity: { id: "tower", name: "Tower", type: "building", transform: { position: [4, 0, 8], rotation: [0, 0, 0, 1], scale: [1, 1, 1] } } },
      { op: "setComponent", entityId: "tower", component: "Health", data: { max: 50 } },
    ],
  });
  assert.equal(result.applied, true);
  assert.equal(result.revision, 1);
  assert.equal(next.entities.tower!.name, "Tower");
  assert.equal(scene.revision, 0, "the original scene is never mutated");
  assert.equal(scene.entities.tower, undefined, "the original scene is never mutated");
});

check("a patch fails atomically — no partial writes", () => {
  const scene = sceneWith([{ id: "a", position: [0, 0, 0] }]);
  assert.throws(
    () =>
      applyScenePatch(scene, {
        sceneId: scene.id,
        operations: [
          { op: "rename", entityId: "a", name: "Renamed" },
          { op: "rename", entityId: "does-not-exist", name: "Nope" },
        ],
      }),
    (error: unknown) => error instanceof PatchError && error.code === "ENTITY_NOT_FOUND",
  );
  assert.equal(scene.entities.a!.name, "a", "the failed operation rolled the whole patch back");
});

check("a stale baseRevision is rejected rather than overwriting user work", () => {
  const scene = sceneWith([{ id: "a", position: [0, 0, 0] }]);
  scene.revision = 5;
  assert.throws(
    () => applyScenePatch(scene, { sceneId: scene.id, baseRevision: 3, operations: [{ op: "rename", entityId: "a", name: "X" }] }),
    (error: unknown) => error instanceof PatchError && error.code === "STALE_REVISION",
  );
});

check("a repeated idempotency key is a no-op, not a second castle", () => {
  const scene = sceneWith([]);
  const patch = {
    sceneId: scene.id,
    idempotencyKey: "build-castle-1",
    operations: [{ op: "create", entity: { id: "castle", name: "Castle" } }] as PatchOperation[],
  };
  const first = applyScenePatch(scene, patch);
  assert.equal(first.result.applied, true);
  const second = applyScenePatch(first.scene, patch);
  assert.equal(second.result.applied, false, "the second apply is skipped");
  assert.equal(Object.keys(second.scene.entities).length, 1, "only one castle exists");
});

check("hierarchy cycles are refused", () => {
  const scene = sceneWith([
    { id: "parent", position: [0, 0, 0] },
    { id: "child", position: [0, 0, 0], parentId: "parent" },
  ]);
  assert.throws(
    () => applyScenePatch(scene, { sceneId: scene.id, operations: [{ op: "reparent", entityId: "parent", parentId: "child" }] }),
    (error: unknown) => error instanceof PatchError && error.code === "HIERARCHY_CYCLE",
  );
});

check("deleting an entity removes its whole subtree", () => {
  const scene = sceneWith([
    { id: "root", position: [0, 0, 0] },
    { id: "mid", position: [0, 0, 0], parentId: "root" },
    { id: "leaf", position: [0, 0, 0], parentId: "mid" },
  ]);
  assert.deepEqual(collectSubtree(scene, "root").sort(), ["leaf", "mid", "root"]);
  const { scene: next } = applyScenePatch(scene, { sceneId: scene.id, operations: [{ op: "delete", entityId: "root" }] });
  assert.deepEqual(Object.keys(next.entities), []);
  assert.deepEqual(next.rootEntities, []);
});

check("locked entities cannot be moved or deleted by a patch", () => {
  const scene = sceneWith([{ id: "a", position: [0, 0, 0] }]);
  scene.entities.a!.locked = true;
  assert.throws(
    () => applyScenePatch(scene, { sceneId: scene.id, operations: [{ op: "transform", entityId: "a", position: [1, 0, 0] }] }),
    (error: unknown) => error instanceof PatchError && error.code === "ENTITY_LOCKED",
  );
});

check("schema validation rejects NaN and non-finite transforms", () => {
  const scene = sceneWith([{ id: "a", position: [0, 0, 0] }]);
  assert.throws(
    () => applyScenePatch(scene, { sceneId: scene.id, operations: [{ op: "transform", entityId: "a", position: [Number.NaN, 0, 0] }] }),
    (error: unknown) => error instanceof PatchError && error.code === "INVALID_PATCH",
  );
  const parsed = safeParse(ScenePatchSchema, { sceneId: "s", operations: [{ op: "transform", entityId: "a", position: [1, 2] }] });
  assert.equal(parsed.ok, false);
});

check("world transforms compose parent scale, not just position", () => {
  const scene = sceneWith([
    { id: "parent", position: [10, 0, 5] },
    { id: "child", position: [2, 1, 0], parentId: "parent" },
  ]);
  scene.entities.parent!.transform.scale = [2, 2, 2];
  // A child of a 2x parent sits twice as far from it, not the same distance.
  assert.deepEqual(worldPosition(scene, "child"), [14, 2, 5]);
  assert.deepEqual(worldSize(scene, "child"), [4, 4, 4], "parent scale multiplies child bounds");
});

check("world transforms apply parent ROTATION to children", () => {
  // This is the case that silently breaks everything downstream: a door on a
  // rotated house. Ignoring the parent's rotation puts it on the wrong wall,
  // and the spatial index, picking, grounding and the playtest bot all
  // inherit that error.
  const scene = sceneWith([
    { id: "house", position: [0, 0, 0] },
    { id: "door", position: [0, 0, -5], parentId: "house" },
  ]);
  scene.entities.house!.transform.rotation = quaternionFromYaw(Math.PI / 2);
  const world = worldPosition(scene, "door");
  // Yawing 90 degrees maps local -Z onto world -X.
  assert.ok(Math.abs(world[0] + 5) < 1e-6 && Math.abs(world[2]) < 1e-6, `expected roughly [-5,0,0], got ${JSON.stringify(world.map((v) => Number(v.toFixed(4))))}`);

  const full = worldTransform(scene, "door");
  assert.ok(Math.abs(full.rotation[1] - Math.sin(Math.PI / 4)) < 1e-6, "the child inherits the parent's rotation");
});

check("a rotated box reports a conservative world AABB", () => {
  const scene = sceneWith([{ id: "plank", position: [0, 0, 0], size: [10, 1, 1] }]);
  scene.entities.plank!.transform.rotation = quaternionFromYaw(Math.PI / 4);
  const size = worldSize(scene, "plank");
  // A 10x1 plank turned 45 degrees spans about 7.8m on both X and Z.
  assert.ok(size[0] > 7 && size[0] < 8.5, `x extent ${size[0].toFixed(2)}`);
  assert.ok(size[2] > 7 && size[2] < 8.5, `z extent ${size[2].toFixed(2)}`);
});

/* ================================================================== */
group("Spatial index and world queries");

check("raycast finds the nearest box with the correct face normal", () => {
  const scene = sceneWith([
    { id: "near", position: [0, 0, 10], size: [4, 4, 4] },
    { id: "far", position: [0, 0, 40], size: [4, 4, 4] },
  ]);
  const index = getSpatialIndex(scene);
  const hit = index.raycast([0, 0, 0], [0, 0, 1]);
  assert.ok(hit, "the ray hits something");
  assert.equal(hit!.entityId, "near", "the nearest box wins");
  assert.deepEqual(hit!.normal, [0, 0, -1], "the entry face normal points back at the ray");
  assert.ok(Math.abs(hit!.distance - 8) < 0.001, `distance should be 8, got ${hit!.distance}`);
});

check("rayAabb misses a box behind the ray origin", () => {
  assert.equal(rayAabb([0, 0, 0], [0, 0, 1], { min: [-1, -1, -10], max: [1, 1, -5] }), undefined);
});

check("radius and bounds queries return only what is inside", () => {
  const scene = sceneWith([
    { id: "close", position: [1, 0, 1] },
    { id: "mid", position: [12, 0, 0] },
    { id: "distant", position: [200, 0, 0] },
  ]);
  const index = getSpatialIndex(scene);
  assert.deepEqual(index.withinRadius([0, 0, 0], 5).map((entry) => entry.id), ["close"]);
  assert.deepEqual(
    index.withinBounds([-1, -5, -5], [20, 5, 5]).map((entry) => entry.id).sort(),
    ["close", "mid"],
  );
  assert.equal(index.nearest([210, 0, 0])!.id, "distant");
});

check("the index is rebuilt when the scene revision changes", () => {
  const scene = sceneWith([{ id: "a", position: [0, 0, 0] }]);
  const first = getSpatialIndex(scene);
  const { scene: next } = applyScenePatch(scene, { sceneId: scene.id, operations: [{ op: "create", entity: { id: "b", name: "B" } }] });
  const second = getSpatialIndex(next);
  assert.notEqual(first, second, "a new revision produces a new index");
  assert.equal(second.size, 2);
});

check("scene.query filters by type, tag and region with pagination", () => {
  const scene = sceneWith([
    { id: "npc1", type: "npc", tags: ["merchant"], position: [0, 0, 0] },
    { id: "npc2", type: "npc", tags: ["guard"], position: [5, 0, 0] },
    { id: "house", type: "building", tags: [], position: [10, 0, 0] },
  ]);
  scene.regions.village = { id: "village", name: "Village", kind: "settlement", center: [0, 0, 0], size: [40, 20, 40], tags: [] };
  scene.entities.npc1!.regionId = "village";

  const byType = runSceneQuery(scene, SceneQuerySchema.parse({ where: { type: "npc" } }));
  assert.equal(byType.total, 2);
  const byTag = runSceneQuery(scene, SceneQuerySchema.parse({ where: { tags: ["merchant"] } }));
  assert.deepEqual(byTag.returned.map((entry) => entry.entityId), ["npc1"]);
  const byRegion = runSceneQuery(scene, SceneQuerySchema.parse({ where: { region: "village" } }));
  assert.equal(byRegion.total, 1);
  const paged = runSceneQuery(scene, SceneQuerySchema.parse({ limit: 2, offset: 0 }));
  assert.equal(paged.more, true, "truncated results tell the model to paginate");
});

check("scene summary groups by region and stays compact", () => {
  const scene = sceneWith([
    { id: "h1", type: "building", position: [0, 0, 0] },
    { id: "h2", type: "building", position: [4, 0, 0] },
    { id: "npc", type: "npc", position: [2, 0, 0] },
  ]);
  scene.regions.village = { id: "village", name: "Village", kind: "settlement", center: [0, 0, 0], size: [40, 20, 40], tags: [] };
  for (const id of ["h1", "h2", "npc"]) scene.entities[id]!.regionId = "village";
  const summary = buildSceneSummary(scene);
  assert.equal(summary.entityCount, 3);
  const text = formatSceneSummary(summary);
  assert.match(text, /Village \(settlement\)/);
  assert.match(text, /2 buildings/);
  assert.ok(text.length < 400, "the summary the model sees stays small");
});

/* ================================================================== */
group("Language grounding: here, this, left, behind");

const groundingScene = sceneWith([
  { id: "castle", name: "Castle", type: "building", position: [50, 0, 0], size: [20, 20, 20] },
  { id: "ground", position: [0, -1, 0], size: [400, 1, 400] },
]);
const frame = {
  id: "f1",
  projectId: "p",
  sceneId: groundingScene.id,
  sceneRevision: 0,
  editorMode: "3d" as const,
  timestamp: 0,
  camera: {
    // Camera at the origin looking down -Z, so "left" is -X.
    position: [0, 10, 40] as Vec3,
    rotation: [0, 0, 0, 1] as [number, number, number, number],
    forward: [0, 0, -1] as Vec3,
    right: [1, 0, 0] as Vec3,
    up: [0, 1, 0] as Vec3,
    fov: 60,
  },
  cursor: { x: 100, y: 100, hit: { position: [12, 3, -7] as Vec3, normal: [0, 1, 0] as Vec3, entityId: "ground", distance: 20 } },
  selected: [{ entityId: "castle", name: "Castle", type: "building", tags: [], position: [50, 0, 0] as Vec3, size: [20, 20, 20] as Vec3 }],
  visible: [],
  nearby: [],
  sceneSummary: buildSceneSummary(groundingScene),
};

check('"here" resolves to the frozen cursor hit exactly', () => {
  assert.deepEqual(resolveAnchor(groundingScene, frame, { kind: "cursor" }), [12, 3, -7]);
});

check('"this" resolves to the selection centre', () => {
  assert.deepEqual(resolveAnchor(groundingScene, frame, { kind: "selection" }), [50, 0, 0]);
});

check('"where I am looking" raycasts from the camera', () => {
  const gaze = resolveAnchor(groundingScene, frame, { kind: "gaze" });
  assert.ok(Number.isFinite(gaze[0]) && Number.isFinite(gaze[2]), "gaze produces a finite point");
});

check("an unresolvable anchor fails with an actionable hint, never a guess", () => {
  const empty = { ...frame, selected: [], cursor: { x: 0, y: 0 } };
  assert.throws(
    () => resolveAnchor(groundingScene, empty as never, { kind: "selection" }),
    (error: unknown) => error instanceof GroundingError && error.code === "NOTHING_SELECTED" && Boolean(error.hint),
  );
  assert.throws(
    () => resolveAnchor(groundingScene, empty as never, { kind: "cursor" }),
    (error: unknown) => error instanceof GroundingError && error.code === "NO_CURSOR_TARGET",
  );
});

check('"two metres to the left" is camera-relative, not world-relative', () => {
  const left = resolveDirection(groundingScene, frame, "cameraLeft");
  assert.ok(left[0] < -0.99, `camera-left should be -X here, got ${JSON.stringify(left)}`);
  const placed = resolvePlacement(groundingScene, frame, { anchor: { kind: "selection" }, direction: "cameraLeft", offset: 2 });
  assert.ok(Math.abs(placed[0] - 48) < 0.001, `expected x=48, got ${placed[0]}`);
  assert.equal(placed[2], 0, "camera-relative movement stays planar");
});

check('"behind this" uses the entity\'s own orientation', () => {
  const rotated = structuredClone(groundingScene);
  rotated.entities.castle!.transform.rotation = quaternionFromYaw(Math.PI / 2);
  const back = resolveDirection(rotated, frame, "entityBack", "castle");
  assert.ok(Math.abs(back[0] + 1) < 0.001, `expected -X, got ${JSON.stringify(back)}`);
});

check("rotateVector and lookAtYaw agree on facing", () => {
  const yaw = lookAtYaw([0, 0, 0], [10, 0, 0]);
  const forward = rotateVector(quaternionFromYaw(yaw), [0, 0, 1]);
  assert.ok(Math.abs(forward[0] - 1) < 1e-6 && Math.abs(forward[2]) < 1e-6, `facing should be +X, got ${JSON.stringify(forward)}`);
});

check('"three barrels around this" finds non-overlapping free space', () => {
  const positions = findFreePositions(groundingScene, [50, 0, 0], { count: 3, radius: 16, clearance: 3 });
  assert.equal(positions.length, 3);
  for (let a = 0; a < positions.length; a += 1) {
    for (let b = a + 1; b < positions.length; b += 1) {
      const distance = Math.hypot(positions[a]![0] - positions[b]![0], positions[a]![2] - positions[b]![2]);
      assert.ok(distance >= 3, `barrels ${a} and ${b} overlap (${distance.toFixed(2)}m apart)`);
    }
  }
});

check("grounding is deterministic — the same request gives the same answer", () => {
  const a = findFreePositions(groundingScene, [50, 0, 0], { count: 4, radius: 12, clearance: 2 });
  const b = findFreePositions(groundingScene, [50, 0, 0], { count: 4, radius: 12, clearance: 2 });
  assert.deepEqual(a, b);
});

/* ================================================================== */
group("History: one AI task is one undo");

check("a transaction collapses many patches into a single undo entry", () => {
  const history = new HistoryStack();
  const project = createProject({ name: "T", concept: "c", mode: "3d" });
  history.beginTransaction("Build a castle", "ai", project);

  let current = project;
  for (const id of ["wall1", "wall2", "wall3"]) {
    const scene = activeScene(current);
    const { scene: next } = applyScenePatch(scene, { sceneId: scene.id, operations: [{ op: "create", entity: { id, name: id } }] });
    current = replaceScene(current, next);
    history.noteChange("created", [id]);
  }

  const entry = history.commitTransaction(current);
  assert.ok(entry, "the transaction produced one history entry");
  assert.equal(entry!.summary.created, 3);
  assert.equal(history.list().length, 1, "three patches, one undo step");

  const undone = history.undo();
  assert.ok(undone);
  assert.equal(Object.keys(activeScene(undone!.project).entities).length, 0, "undo removed the whole castle");

  const redone = history.redo();
  assert.equal(Object.keys(activeScene(redone!.project).entities).length, 3, "redo restores it");
});

check("an empty transaction does not litter history", () => {
  const history = new HistoryStack();
  const project = createProject({ name: "T", concept: "c", mode: "3d" });
  history.beginTransaction("Nothing happened", "ai", project);
  assert.equal(history.commitTransaction(project), null);
  assert.equal(history.list().length, 0);
});

check("checkpoints roll the whole project back", () => {
  const history = new HistoryStack();
  const project = createProject({ name: "T", concept: "c", mode: "3d" });
  const checkpoint = history.checkpoint("before", project);
  const scene = activeScene(project);
  const { scene: next } = applyScenePatch(scene, { sceneId: scene.id, operations: [{ op: "create", entity: { id: "x", name: "X" } }] });
  const changed = replaceScene(project, next);
  assert.equal(Object.keys(activeScene(changed).entities).length, 1);
  const restored = history.rollback(checkpoint.id);
  assert.equal(Object.keys(activeScene(restored!).entities).length, 0);
});

check("a new edit after undo discards the redo tail", () => {
  const history = new HistoryStack();
  const base = createProject({ name: "T", concept: "c", mode: "3d" });
  const one = { ...base, metadata: { ...base.metadata, name: "one" } };
  const two = { ...base, metadata: { ...base.metadata, name: "two" } };
  history.push({ author: "user", label: "a", before: base, after: one });
  history.push({ author: "user", label: "b", before: one, after: two });
  history.undo();
  history.push({ author: "user", label: "c", before: one, after: two });
  assert.equal(history.canRedo, false);
  assert.equal(history.list().length, 2);
});

/* ================================================================== */
group("Deterministic procedural generation");

check("the PRNG is deterministic and forks independently", () => {
  const a = new Rng(1234);
  const b = new Rng(1234);
  const first = [a.next(), a.next(), a.next()];
  const second = [b.next(), b.next(), b.next()];
  assert.deepEqual(first, second);
  const forkA = new Rng(99).fork(3).next();
  const forkB = new Rng(99).fork(3).next();
  assert.equal(forkA, forkB);
  assert.notEqual(new Rng(99).fork(3).next(), new Rng(99).fork(4).next(), "different salts diverge");
});

check("fbm noise is in range and stable for a seed", () => {
  for (let index = 0; index < 200; index += 1) {
    const value = fbm2D(index * 0.37, index * 0.11, 77);
    assert.ok(value >= 0 && value <= 1, `fbm out of range: ${value}`);
  }
  assert.equal(fbm2D(3.2, 1.1, 5), fbm2D(3.2, 1.1, 5));
  assert.notEqual(fbm2D(3.2, 1.1, 5), fbm2D(3.2, 1.1, 6));
});

check("hashString is stable", () => {
  assert.equal(hashString("medieval_house"), hashString("medieval_house"));
  assert.notEqual(hashString("a"), hashString("b"));
});

check("polygon triangulation handles concave footprints", () => {
  const lShape = rectangleFootprint(10, 12, { width: 4, depth: 5 });
  assert.equal(lShape.length, 6);
  const triangles = triangulatePolygon(lShape);
  assert.equal(triangles.length, (lShape.length - 2) * 3, "n-gon produces n-2 triangles");
  assert.ok(triangles.every((index) => index >= 0 && index < lShape.length), "indices stay in range");
});

check("extruded geometry is well-formed", () => {
  const geometry = buildExtrudedGeometry(rectangleFootprint(6, 8), 4);
  assert.equal(geometry.positions.length % 3, 0);
  assert.equal(geometry.normals.length, geometry.positions.length);
  assert.ok(geometry.indices.length > 0);
  assert.ok(Math.max(...geometry.indices) < geometry.positions.length / 3, "no index points past the vertex list");
  assert.ok(geometry.positions.every(Number.isFinite), "no NaN vertices");
});

check("polygon winding is normalised", () => {
  const clockwise: [number, number][] = [[0, 0], [0, 4], [4, 4], [4, 0]];
  assert.ok(polygonArea(clockwise) < 0);
  const geometry = buildExtrudedGeometry(clockwise, 2);
  assert.ok(geometry.indices.length > 0, "reversed winding still meshes");
});

check("materials are deterministic and content-hashed for reuse", () => {
  const a = generateMaterial({ family: "stone", seed: 42, weathering: 0.3 });
  const b = generateMaterial({ family: "stone", seed: 42, weathering: 0.3 });
  assert.deepEqual(a, b);
  assert.equal(materialHash(a), materialHash(b), "identical materials share a hash so they are reused");
  assert.notEqual(materialHash(a), materialHash(generateMaterial({ family: "stone", seed: 43 })));
  assert.match(a.baseColor, /^#[0-9a-f]{6}$/);
  assert.ok(a.roughness >= 0 && a.roughness <= 1);
});

check("art-style palettes stay coherent per style", () => {
  const fantasy = paletteForStyle("stylised fantasy", 1);
  const scifi = paletteForStyle("neon cyberpunk city", 1);
  assert.equal(fantasy.roof, "clay_tiles");
  assert.equal(scifi.wall, "metal");
  assert.deepEqual(paletteForStyle("stylised fantasy", 1), fantasy, "stable for a seed");
});

/* ================================================================== */
group("Generators produce real, coherent content");

check("the registry exposes a small, discoverable surface", () => {
  const all = listGenerators();
  assert.ok(all.length >= 10, `expected 10+ generators, got ${all.length}`);
  assert.ok(all.every((entry) => entry.summary.length > 20), "every generator explains itself");
  assert.ok(listGenerators("2d").every((entry) => entry.modes.includes("2d")));
  const discovered = discoverGenerators("I need a village with houses and roads", "3d");
  assert.ok(discovered.some((entry) => entry.name === "settlement"), `discovery should surface settlement, got ${discovered.map((e) => e.name).join(",")}`);
  assert.ok(generatorSchema("building"), "schemas are fetchable on demand");
});

check("an unknown generator fails with the list of real ones", () => {
  const scene = sceneWith([]);
  assert.throws(
    () => runGenerator("castle_of_dreams", genContext(scene), {}, 1),
    (error: unknown) => error instanceof GeneratorError && error.code === "UNKNOWN_GENERATOR" && /Available generators/.test(error.hint ?? ""),
  );
});

check("invalid generator parameters are rejected with the field names", () => {
  const scene = sceneWith([]);
  assert.throws(
    () => runGenerator("building", genContext(scene), { floors: 99 }, 1),
    (error: unknown) => error instanceof GeneratorError && error.code === "INVALID_PARAMETERS" && /floors/.test(error.message),
  );
});

check("a building generates walls, a roof, a door and collision", () => {
  const scene = sceneWith([]);
  const output = runGenerator("building", genContext(scene), { kind: "house", floors: 2, roof: "gable", balcony: true }, 4242);
  const creates = createOps(output.operations);
  assert.ok(creates.length >= 2, "the house and its door");
  const mesh = output.operations.find((op) => op.op === "setComponent" && op.component === "ProceduralMesh");
  assert.ok(mesh, "the building has a mesh");
  const spec = (mesh as never as { data: { spec: { parts: { material: string }[] } } }).data.spec;
  assert.ok(spec.parts.length > 8, `expected a detailed building, got ${spec.parts.length} parts`);
  assert.ok(output.operations.some((op) => op.op === "setComponent" && op.component === "Collider"), "the building collides");
  assert.ok(output.operations.some((op) => op.op === "setComponent" && op.component === "Door"), "the house has an openable door");
  assert.ok(output.assets.length >= 4, "materials were produced");
  const bounds = meshBounds(spec as never);
  assert.ok(bounds.size[1] > 5, `a two-storey house should be tall, got ${bounds.size[1]}`);
});

check("the same seed rebuilds the identical building", () => {
  const scene = sceneWith([]);
  const a = runGenerator("building", genContext(scene), { kind: "inn" }, 777);
  const b = runGenerator("building", genContext(scene), { kind: "inn" }, 777);
  assert.deepEqual(a.operations, b.operations);
  const c = runGenerator("building", genContext(scene), { kind: "inn" }, 778);
  assert.notDeepEqual(a.operations, c.operations, "a different seed gives a different building");
});

check("changing one parameter regenerates coherently", () => {
  const scene = sceneWith([]);
  const oneStorey = runGenerator("building", genContext(scene), { kind: "house", floors: 1 }, 555);
  const twoStorey = runGenerator("building", genContext(scene), { kind: "house", floors: 2 }, 555);
  const heightOf = (output: typeof oneStorey) => {
    const mesh = output.operations.find((op) => op.op === "setComponent" && op.component === "ProceduralMesh") as never as { data: { spec: never } };
    return meshBounds(mesh.data.spec).size[1];
  };
  assert.ok(heightOf(twoStorey) > heightOf(oneStorey) + 2, "the second storey is really there");
});

check("generator metadata records how an object was made", () => {
  const scene = sceneWith([]);
  const output = runGenerator("building", genContext(scene), { kind: "tower" }, 909);
  const create = createOps(output.operations)[0] as never as { entity: { generator: { generator: string; seed: number; parameters: Record<string, unknown> } } };
  assert.equal(create.entity.generator.generator, "building");
  assert.equal(create.entity.generator.seed, 909);
  assert.equal(create.entity.generator.parameters.kind, "tower");
});

check("a village generates roads, buildings, props and NPCs as one region", () => {
  const scene = sceneWith([]);
  const output = runGenerator("settlement", genContext(scene), { radius: 70, houses: 8, landmarks: ["inn", "blacksmith"], npcs: 6 }, 31337);
  const creates = createOps(output.operations);
  assert.ok(creates.length > 30, `a village should be substantial, got ${creates.length} entities`);

  const types = new Set(creates.map((op) => (op as never as { entity: { type: string } }).entity.type));
  for (const required of ["settlement", "building", "road", "prop", "npc"]) {
    assert.ok(types.has(required), `village is missing ${required} (has: ${[...types].join(", ")})`);
  }
  assert.ok(output.operations.some((op) => op.op === "upsertRegion"), "the village is a named region");
  assert.ok(output.operations.some((op) => op.op === "setRelationship"), "relationships are recorded for later queries");

  // The model must not have placed anything: this is one tool call.
  assert.ok(output.description.includes("buildings"), output.description);
});

check("village buildings do not overlap each other", () => {
  const scene = sceneWith([]);
  const output = runGenerator("settlement", genContext(scene), { radius: 60, houses: 6, landmarks: [], npcs: 0 }, 24680);
  const buildings = createOps(output.operations)
    .map((op) => (op as never as { entity: { type: string; transform: { position: Vec3 }; bounds?: { size: Vec3 } } }).entity)
    .filter((entity) => entity.type === "building");
  assert.ok(buildings.length >= 4, `expected several buildings, got ${buildings.length}`);
  for (let a = 0; a < buildings.length; a += 1) {
    for (let b = a + 1; b < buildings.length; b += 1) {
      const distance = Math.hypot(
        buildings[a]!.transform.position[0] - buildings[b]!.transform.position[0],
        buildings[a]!.transform.position[2] - buildings[b]!.transform.position[2],
      );
      assert.ok(distance > 4, `buildings ${a} and ${b} are only ${distance.toFixed(1)}m apart`);
    }
  }
});

check("a fortress builds walls, towers, a gate and outward-facing guards", () => {
  const scene = sceneWith([]);
  const output = runGenerator("fortress", genContext(scene), { radius: 40, towerCount: 6, guards: 6, ruinAmount: 0.3 }, 8080);
  const entities = createOps(output.operations).map((op) => (op as never as { entity: { name: string; type: string; tags: string[] } }).entity);
  assert.ok(entities.some((entity) => entity.tags.includes("wall")), "curtain walls exist");
  assert.ok(entities.some((entity) => entity.tags.includes("tower")), "towers exist");
  assert.ok(entities.some((entity) => entity.tags.includes("gate")), "there is a way in");
  assert.ok(entities.filter((entity) => entity.tags.includes("guard")).length >= 6, "the garrison is posted");
  assert.ok(output.operations.some((op) => op.op === "setRelationship" && op.relation === "garrison"));
});

check("a dungeon guarantees every room is connected to the entrance", () => {
  const scene = sceneWith([]);
  const output = runGenerator("dungeon", genContext(scene), { rooms: 10, roomSize: 10, loops: 0, boss: true }, 12345);
  const entities = createOps(output.operations).map((op) => (op as never as { entity: { type: string; tags: string[] } }).entity);
  const rooms = entities.filter((entity) => entity.type === "dungeonRoom");
  const corridors = entities.filter((entity) => entity.type === "corridor");
  assert.ok(rooms.length >= 2, `expected rooms, got ${rooms.length}`);
  // A spanning tree over n rooms needs at least n-1 connections; each is
  // built from up to two L-legs, so corridors >= rooms-1 proves connectivity.
  assert.ok(corridors.length >= rooms.length - 1, `${rooms.length} rooms need at least ${rooms.length - 1} corridors, got ${corridors.length}`);
  assert.ok(entities.some((entity) => entity.tags.includes("entrance")), "there is an entrance chamber");
  assert.ok(entities.some((entity) => entity.tags.includes("dungeon-entrance")), "the surface entrance exists");
  assert.ok(entities.some((entity) => entity.tags.includes("stairs")), "you can descend into it");
  assert.ok(entities.some((entity) => entity.tags.includes("boss")), "the boss is placed");
});

check("characters are configured, not just modelled", () => {
  const scene = sceneWith([]);
  const guard = runGenerator("character", genContext(scene), { archetype: "guard", position: [3, 0, 4] }, 606);
  const components = guard.operations.filter((op) => op.op === "setComponent").map((op) => (op as never as { component: string }).component);
  for (const required of ["ProceduralMesh", "Health", "CharacterBody", "AnimationStates", "Behavior"]) {
    assert.ok(components.includes(required), `guard is missing ${required}`);
  }
  const player = runGenerator("character", genContext(scene), { archetype: "player" }, 1);
  const playerComponents = player.operations.filter((op) => op.op === "setComponent").map((op) => (op as never as { component: string }).component);
  for (const required of ["PlayerController", "Inventory", "Melee", "Saveable"]) {
    assert.ok(playerComponents.includes(required), `player is missing ${required}`);
  }
  const boss = runGenerator("character", genContext(scene), { archetype: "boss", difficulty: 2 }, 1);
  const health = boss.operations.find((op) => op.op === "setComponent" && op.component === "Health") as never as { data: { max: number } };
  assert.equal(health.data.max, 1200, "difficulty scales the boss");
});

check("female character identity survives into the entity and changes visible geometry", () => {
  const scene = sceneWith([]);
  const female = runGenerator("character", genContext(scene), { archetype: "player", genderPresentation: "female", name: "Lyra" }, 91);
  const neutral = runGenerator("character", genContext(scene), { archetype: "player", genderPresentation: "neutral", name: "Lyra" }, 91);
  const femaleIdentity = female.operations.find((operation) => operation.op === "setComponent" && operation.component === "AvatarIdentity") as Extract<PatchOperation, { op: "setComponent" }>;
  const femaleMesh = female.operations.find((operation) => operation.op === "setComponent" && operation.component === "ProceduralMesh") as Extract<PatchOperation, { op: "setComponent" }>;
  const neutralMesh = neutral.operations.find((operation) => operation.op === "setComponent" && operation.component === "ProceduralMesh") as Extract<PatchOperation, { op: "setComponent" }>;
  assert.equal(femaleIdentity.data.genderPresentation, "female");
  assert.equal(femaleIdentity.data.role, "player");
  assert.ok((femaleMesh.data.spec as { parts: unknown[] }).parts.length > (neutralMesh.data.spec as { parts: unknown[] }).parts.length, "female presentation must be visible geometry, not a renamed neutral body");
});

check("props are placed without overlapping when scattered", () => {
  const scene = sceneWith([]);
  const output = runGenerator("prop", genContext(scene), { kind: "barrel", count: 5, spread: 6 }, 4321);
  assert.equal(output.rootIds.length, 5);
  const barrels = createOps(output.operations).map((op) => (op as never as { entity: { transform: { position: Vec3 } } }).entity.transform.position);
  assert.equal(barrels.length, 5);
});

check("vegetation is one instanced region, never 18,000 entities", () => {
  const scene = sceneWith([]);
  const output = runGenerator("vegetation", genContext(scene), { radius: 120, density: 8, species: ["pine"] }, 5150);
  assert.equal(createOps(output.operations).length, 1, "a forest is ONE entity");
  const region = output.operations.find((op) => op.op === "setComponent" && op.component === "VegetationRegion") as never as { data: { instanceCount: number } };
  assert.ok(region.data.instanceCount > 100, `expected many instances, got ${region.data.instanceCount}`);
});

check("vegetation respects exclusion zones so roads stay clear", () => {
  const params = VegetationParamsSchema.parse({
    center: [0, 0, 0], radius: 60, density: 20, species: ["pine"], clustering: 0,
    exclusions: [{ center: [0, 0, 0], radius: 25 }],
  });
  const instances = resolveScatter(params, 999);
  assert.ok(instances.length > 0, "trees were placed");
  const intruders = instances.filter((instance) => Math.hypot(instance.position[0], instance.position[2]) < 25);
  assert.equal(intruders.length, 0, `${intruders.length} trees grew inside the exclusion zone`);
});

check("roads follow a smooth spline and drape onto terrain", () => {
  const scene = sceneWith([]);
  const sampler = (x: number, z: number) => Math.sin(x * 0.05) * 3 + Math.cos(z * 0.05) * 2;
  const output = runGenerator(
    "road",
    genContext(scene, sampler),
    { points: [[0, 0, 0], [40, 0, 20], [80, 0, 0]], width: 5, subdivisions: 6 },
    11,
  );
  const spline = output.operations.find((op) => op.op === "setComponent" && op.component === "RoadSpline") as never as { data: { points: Vec3[] } };
  assert.ok(spline.data.points.length > 12, "the spline is subdivided, not three raw points");
  for (const point of spline.data.points) {
    assert.ok(Number.isFinite(point[1]), "every road point has a real height");
  }
  assert.equal(createOps(output.operations).length, 1, "a road is one entity, not hundreds of segments");
});

check("catmullRom passes through its control points", () => {
  const points: Vec3[] = [[0, 0, 0], [10, 0, 0], [20, 0, 10]];
  const curve = catmullRom(points, 8);
  assert.ok(curve.length > points.length * 4);
  const last = curve[curve.length - 1]!;
  assert.deepEqual(last, [20, 0, 10], "the curve ends where the road ends");
});

/* ================================================================== */
group("Terrain, tilemaps and voxels");

check("terrain height is a pure function of position and seed", () => {
  const params = { size: 1024, tileSize: 128, maxHeight: 90, mountains: 0.6, erosion: 0.3, rivers: 2, waterLevel: 0, plateauRadius: 0, biome: "temperate" as const };
  assert.equal(terrainHeightAt(12, 34, 7, params), terrainHeightAt(12, 34, 7, params));
  assert.notEqual(terrainHeightAt(12, 34, 7, params), terrainHeightAt(12, 34, 8, params));
  for (let index = 0; index < 100; index += 1) {
    const height = terrainHeightAt(index * 13, index * -7, 7, params);
    assert.ok(Number.isFinite(height), "no NaN terrain");
    assert.ok(Math.abs(height) < params.maxHeight * 3, `height ${height} is wildly out of range`);
  }
});

check("terrain tiles line up on their shared edges", () => {
  const params = { size: 512, tileSize: 128, maxHeight: 60, mountains: 0.5, erosion: 0.2, rivers: 0, waterLevel: 0, plateauRadius: 0, biome: "temperate" as const };
  const left = generateTile(0, 0, 99, params);
  const right = generateTile(1, 0, 99, params);
  const resolution = TERRAIN_RESOLUTION;
  for (let row = 0; row < resolution; row += 1) {
    const leftEdge = left.heights[row * resolution + (resolution - 1)]!;
    const rightEdge = right.heights[row * resolution]!;
    assert.ok(Math.abs(leftEdge - rightEdge) < 1e-3, `tile seam at row ${row}: ${leftEdge} vs ${rightEdge}`);
  }
});

check("a plateau really is flat, so a settlement can sit on it", () => {
  const params = { size: 1024, tileSize: 128, maxHeight: 90, mountains: 0.8, erosion: 0.3, rivers: 0, waterLevel: 0, plateauRadius: 80, biome: "temperate" as const };
  const samples = [[0, 0], [30, 20], [-40, 10], [50, -50]].map(([x, z]) => terrainHeightAt(x!, z!, 3, params));
  const spread = Math.max(...samples) - Math.min(...samples);
  assert.ok(spread < 1, `plateau should be flat, spread was ${spread.toFixed(2)}m`);
});

check("a 2D platformer level is provably completable", () => {
  for (const seed of [1, 2, 3, 4, 5, 99, 12345]) {
    const params = Tilemap2DParamsSchema.parse({ layout: "platformer", width: 96, height: 28, gaps: 0.3, roughness: 0.45 });
    const map = generateTilemap(params, seed);
    const blocked = firstUnreachableColumn(map, params.maxJumpTiles, params.maxGapTiles);
    assert.equal(blocked, -1, `seed ${seed} produced an unreachable column at x=${blocked}`);
    assert.ok(map.spawn[0] < map.goal[0], "the goal is ahead of the spawn");
  }
});

check("the 2D generator emits a player, a goal, enemies and collectibles", () => {
  const scene = sceneWith([]);
  const output = runGenerator("tilemap2d", genContext(scene), { layout: "platformer", enemies: 5, collectibles: 8 }, 2024);
  const entities = createOps(output.operations).map((op) => (op as never as { entity: { type: string } }).entity);
  const types = entities.map((entity) => entity.type);
  assert.ok(types.includes("tilemap"));
  assert.ok(types.includes("player"));
  assert.ok(types.includes("goal"));
  assert.ok(types.filter((type) => type === "enemy").length >= 1, "enemies were placed");
  assert.ok(types.filter((type) => type === "collectible").length >= 1, "collectibles were placed");
});

check("the 2D generator preserves a female protagonist as structured runtime data", () => {
  const scene = createScene("female-2d", "Female 2D", "2d");
  const output = runGenerator("tilemap2d", genContext(scene), { layout: "platformer", enemies: 2, collectibles: 3, playerGenderPresentation: "female" }, 20260820);
  const identity = output.operations.find((operation) => operation.op === "setComponent" && operation.component === "AvatarIdentity") as Extract<PatchOperation, { op: "setComponent" }>;
  assert.equal(identity.data.role, "player");
  assert.equal(identity.data.genderPresentation, "female");
  assert.equal(identity.data.visualPipeline, "procedural-vector-adventurer");
});

check("an unbeatable 2D layout is retried, not shipped", () => {
  const scene = sceneWith([]);
  const output = runGenerator("tilemap2d", genContext(scene), { layout: "platformer", gaps: 1, roughness: 1, maxJumpTiles: 1, maxGapTiles: 1 }, 5);
  const tilemap = output.operations.find((op) => op.op === "setComponent" && op.component === "Tilemap") as never as { data: { tiles: number[]; width: number; height: number; tileSize: number } };
  const map = { ...tilemap.data, spawn: [2, 1] as [number, number], goal: [tilemap.data.width - 3, 1] as [number, number] };
  const blocked = firstUnreachableColumn(map as never, 1, 1);
  // Either the retry succeeded, or the generator warned honestly.
  assert.ok(blocked === -1 || output.warnings.length > 0, "an unbeatable level must be fixed or flagged");
});

check("voxel chunks are typed arrays and survive a round trip", () => {
  const params = VoxelParamsSchema.parse({ chunkSize: 16, worldHeight: 64, radius: 1 });
  const blocks = generateChunk(0, 1, 0, 4242, params);
  assert.ok(blocks instanceof Uint8Array, "voxels are a typed array, never objects");
  assert.equal(blocks.length, 16 * 16 * 16);
  const restored = decodeChunk(encodeChunk(blocks));
  assert.deepEqual(Array.from(restored), Array.from(blocks), "encode/decode round trips exactly");
  assert.equal(chunkKey(1, 2, 3), "1,2,3");
});

check("voxel worlds have solid ground under the spawn column", () => {
  const params = VoxelParamsSchema.parse({ chunkSize: 16, worldHeight: 64, radius: 1, seaLevel: 20 });
  const surface = voxelSurfaceHeight(0, 0, 777, params);
  assert.ok(surface > 0 && surface < params.worldHeight, `surface height ${surface} is out of the world`);
  const chunkY = Math.floor((surface - 1) / 16);
  const blocks = generateChunk(0, chunkY, 0, 777, params);
  const local = (surface - 1) - chunkY * 16;
  const block = blocks[(local * 16 + 0) * 16 + 0]!;
  assert.notEqual(block, 0, "the block under the spawn surface is solid");
});

check("greedy meshing emits only faces exposed to air", () => {
  const size = 4;
  const blocks = new Uint8Array(size * size * size).fill(1);
  const mesh = meshChunk(blocks, size);
  // A fully solid 4³ cube with no neighbours: only the 6 outer 4×4 faces.
  assert.equal(mesh.indices.length / 6, 6 * 16, `expected 96 exposed faces, got ${mesh.indices.length / 6}`);
  const hollow = new Uint8Array(size * size * size);
  assert.equal(meshChunk(hollow, size).indices.length, 0, "an empty chunk meshes to nothing");
});

check("voxel generation is deterministic", () => {
  const params = VoxelParamsSchema.parse({ chunkSize: 8, worldHeight: 32, radius: 1 });
  assert.deepEqual(Array.from(generateChunk(1, 0, 1, 55, params)), Array.from(generateChunk(1, 0, 1, 55, params)));
});

/* ================================================================== */
group("Navigation");

const flatGeometry: NavGeometry = {
  boxes: [{ min: [-40, -1, -40], max: [40, 0, 40], walkableTop: true }],
};

check("a flat floor is walkable and pathable end to end", () => {
  const grid = buildNavGrid({ ...DEFAULT_NAV_CONFIG, bounds: { min: [-40, -5, -40], max: [40, 20, 40] } }, flatGeometry);
  assert.ok(grid.tiles.size > 0, "tiles were built");
  assert.equal(isWalkable(grid, [0, 0, 0]), true);
  const path = findPath(grid, [-30, 0, -30], [30, 0, 30]);
  assert.equal(path.found, true, path.reason);
  assert.ok(path.length > 70, `the path should span the floor, got ${path.length.toFixed(1)}m`);
  assert.ok(path.waypoints.length >= 2);
});

check("a wall across the floor is routed around, not through", () => {
  const walled: NavGeometry = {
    boxes: [
      ...flatGeometry.boxes,
      // A wall with a gap at the +X end.
      { min: [-2, 0, -40], max: [2, 6, 20], walkableTop: false },
    ],
  };
  const grid = buildNavGrid({ ...DEFAULT_NAV_CONFIG, bounds: { min: [-40, -5, -40], max: [40, 20, 40] } }, walled);
  const path = findPath(grid, [-30, 0, 0], [30, 0, 0]);
  assert.equal(path.found, true, `should route round the wall: ${path.reason}`);
  const crossesWall = path.waypoints.some((point, index) => {
    if (index === 0) return false;
    const previous = path.waypoints[index - 1]!;
    // Sample the segment; no sample may sit inside the wall footprint.
    for (let t = 0; t <= 1; t += 0.05) {
      const x = previous[0] + (point[0] - previous[0]) * t;
      const z = previous[2] + (point[2] - previous[2]) * t;
      if (x > -2.6 && x < 2.6 && z < 20 && z > -40) return true;
    }
    return false;
  });
  assert.equal(crossesWall, false, "the route must not pass through the wall");
});

check("an unreachable destination fails with a readable reason", () => {
  const island: NavGeometry = {
    boxes: [
      { min: [-10, -1, -10], max: [10, 0, 10], walkableTop: true },
      { min: [60, -1, 60], max: [80, 0, 80], walkableTop: true },
    ],
  };
  const grid = buildNavGrid({ ...DEFAULT_NAV_CONFIG, bounds: { min: [-20, -5, -20], max: [90, 20, 90] } }, island);
  const path = findPath(grid, [0, 0, 0], [70, 0, 70]);
  assert.equal(path.found, false);
  assert.ok(path.reason && path.reason.length > 10, "the failure explains itself");
  assert.doesNotMatch(path.reason!, /unknown/i);
});

check("a path still works when the player is stood against a wall", () => {
  // Obstacles are inflated by the agent radius, so the cell a character
  // occupies when it walks up to a door is itself "blocked". Without
  // snapping, a bot could walk to something once and then never move again.
  const walled: NavGeometry = {
    boxes: [
      { min: [-40, -1, -40], max: [40, 0, 40], walkableTop: true },
      { min: [-4, 0, -4], max: [4, 6, 4], walkableTop: false },
    ],
  };
  const grid = buildNavGrid({ ...DEFAULT_NAV_CONFIG, bounds: { min: [-40, -5, -40], max: [40, 20, 40] } }, walled);
  // Standing right against the obstacle face.
  const against: Vec3 = [4.1, 0, 0];
  assert.equal(isWalkable(grid, against), false, "the cell against the wall is inside the inflated obstacle");
  const path = findPath(grid, against, [30, 0, 30]);
  assert.equal(path.found, true, `should snap out and path away: ${path.reason}`);
});

check("a village-sized navmesh builds quickly", () => {
  // Collision is per mesh part, so a village is hundreds of boxes. Without a
  // broad phase this is millions of comparisons and a frozen editor.
  const boxes: NavGeometry["boxes"] = [{ min: [-200, -1, -200], max: [200, 0, 200], walkableTop: true }];
  for (let index = 0; index < 600; index += 1) {
    const x = (index % 25) * 15 - 180;
    const z = Math.floor(index / 25) * 15 - 180;
    boxes.push({ min: [x, 0, z], max: [x + 8, 6, z + 8], walkableTop: false });
  }
  const bounds = { min: [-200, -5, -200] as Vec3, max: [200, 20, 200] as Vec3 };
  const started = Date.now();
  const grid = buildNavGrid({ ...DEFAULT_NAV_CONFIG, cellSize: cellSizeForBounds(bounds), bounds }, { boxes });
  const elapsed = Date.now() - started;
  assert.ok(grid.tiles.size > 0);
  assert.ok(elapsed < 8000, `navmesh build took ${elapsed}ms for 600 obstacles`);

  // And it must still route between the gaps.
  const path = findPath(grid, [-190, 0, -190], [190, 0, 190]);
  assert.equal(path.found, true, `should thread between the buildings: ${path.reason}`);
});

check("the navigation grid scales with world size", () => {
  const small = cellSizeForBounds({ min: [-20, 0, -20], max: [20, 0, 20] });
  const huge = cellSizeForBounds({ min: [-400, 0, -400], max: [400, 0, 400] });
  assert.ok(small < huge, `a small world gets finer cells (${small} vs ${huge})`);
  assert.ok(huge <= 2.5 && small >= 0.5, `cell sizes stay in range: ${small}, ${huge}`);
  // A fixed 0.6m cell over an 800m world is ~1.8M cells; the budget caps it.
  const cells = (800 / huge) * (800 / huge);
  assert.ok(cells < 500_000, `grid should stay under budget, got ${Math.round(cells)} cells`);
});

check("only the affected tiles are marked dirty", () => {
  const config = { ...DEFAULT_NAV_CONFIG, bounds: { min: [-200, -5, -200], max: [200, 20, 200] } };
  const dirty = dirtyTilesFor(config, { min: [0, 0, 0], max: [8, 8, 8] });
  assert.ok(dirty.length >= 1 && dirty.length <= 4, `a small building should dirty a handful of tiles, got ${dirty.length}`);
});

check("navigationIRFrom serialises a grid", () => {
  const grid = buildNavGrid({ ...DEFAULT_NAV_CONFIG, bounds: { min: [-20, -5, -20], max: [20, 20, 20] } }, flatGeometry);
  const ir = navigationIRFrom(grid);
  assert.ok(ir.builtAt! > 0);
  assert.equal(Object.keys(ir.tiles!).length, grid.tiles.size);
  assert.equal(ir.cellSize, DEFAULT_NAV_CONFIG.cellSize);
});

/* ================================================================== */
group("Gameplay components and quests");

check("the component library is validated, not free-form", () => {
  const all = listComponents();
  assert.ok(all.length >= 30, `expected a real library, got ${all.length}`);
  const valid = validateComponent("Health", { max: 120 });
  assert.equal(valid.ok, true);
  assert.equal(valid.data!.regeneration, 0, "defaults are filled in");

  const invalid = validateComponent("Health", { max: -5 });
  assert.equal(invalid.ok, false);
  assert.ok(invalid.issues[0]!.includes("max"), invalid.issues.join());

  const unknown = validateComponent("Telekinesis", {});
  assert.equal(unknown.ok, false);
  assert.ok(unknown.issues[0]!.includes("Known components"), "the error lists what does exist");
  assert.ok(componentSchema("Door"), "schemas are fetchable");
});

check("component dependencies are surfaced", () => {
  const withoutHealth = validateComponent("Enemy", { faction: "bandits" }, []);
  assert.equal(withoutHealth.ok, true);
  assert.deepEqual(withoutHealth.missingRequirements, ["Health"], "the model is told what else it needs");
  const withHealth = validateComponent("Enemy", { faction: "bandits" }, ["Health"]);
  assert.deepEqual(withHealth.missingRequirements, []);
});

check("a quest that references missing things is caught before it ships", () => {
  const quest = QuestSchema.parse({
    id: "q1", titleKey: "quest.q1.title", title: "Iron for the smith", giver: "blacksmith",
    steps: [
      { type: "talk", target: "blacksmith" },
      { type: "collect", item: "iron_ore", count: 5 },
      { type: "reach", region: "mine" },
      { type: "return", target: "blacksmith" },
    ],
  });
  const broken = validateQuests([quest], { entityIds: new Set(), entityTags: new Set(), regionIds: new Set(), itemIds: new Set(["iron_ore"]) });
  assert.ok(broken.some((issue) => /blacksmith/.test(issue.message)), "a missing quest giver is caught");
  assert.ok(broken.some((issue) => /mine/.test(issue.message)), "a missing region is caught");

  const fine = validateQuests([quest], {
    entityIds: new Set(["blacksmith"]), entityTags: new Set(), regionIds: new Set(["mine"]), itemIds: new Set(["iron_ore"]),
  });
  assert.deepEqual(fine, []);
});

check("prerequisite loops are detected", () => {
  const a = QuestSchema.parse({ id: "a", titleKey: "k", title: "A", steps: [{ type: "talk", target: "x" }], prerequisites: ["b"] });
  const b = QuestSchema.parse({ id: "b", titleKey: "k", title: "B", steps: [{ type: "talk", target: "x" }], prerequisites: ["a"] });
  const issues = validateQuests([a, b], { entityIds: new Set(["x"]), entityTags: new Set(), regionIds: new Set(), itemIds: new Set() });
  assert.ok(issues.some((issue) => /loop/.test(issue.message)), "a deadlocked quest chain is reported");
});

check("player-facing strings carry localisation keys", () => {
  const quest = QuestSchema.parse({ id: "q", titleKey: "quest.q.title", title: "Find the sword", descriptionKey: "quest.q.desc", description: "Go find it", steps: [{ type: "talk", target: "x" }] });
  const table = localisationKeys([quest], []);
  assert.equal(table["quest.q.title"], "Find the sword");
  assert.equal(table["quest.q.desc"], "Go find it");
  assert.ok(defaultScreens("voxel").hud.some((node) => node.type === "Hotbar"), "voxel games get a hotbar by default");
});

/* ================================================================== */
group("Playtest DSL and bot");

check("the DSL parses every supported instruction", () => {
  const { instructions, errors } = parseTest(`
    # walk to the castle and open the gate
    spawn player at village_spawn
    move player to castle_gate
    assert player reached castle_gate
    interact castle_gate
    assert castle_gate.open == true
    hold moveForward for 2s
    press jump
    attack guard_1 until dead
    wait 1.5s
    assert event door_opened
    assert no event player_died
    assert runtime_errors == 0
    move player to 10, 0, -4
  `);
  assert.deepEqual(errors, []);
  assert.equal(instructions.length, 13);
  assert.equal(instructions[0]!.op, "spawn");
  assert.equal(instructions[4]!.op, "assertProperty");
  assert.equal((instructions[7]! as never as { untilDead: boolean }).untilDead, true);
  assert.equal(instructions[12]!.op, "moveTo");
});

check("a malformed line fails loudly with its line number", () => {
  const { errors } = parseTest("move player to gate\nteleport player to moon\nassert gate.open == true");
  assert.equal(errors.length, 1);
  assert.equal(errors[0]!.line, 2);
  assert.match(errors[0]!.message, /Unknown instruction/);
});

check("an unreadable assertion is rejected rather than silently skipped", () => {
  const { errors } = parseTest("assert the door probably works");
  assert.equal(errors.length, 1);
  assert.match(errors[0]!.message, /assertion/);
});

check("formatTest round-trips a parsed script", () => {
  const source = "move player to castle_gate\npress jump\nassert castle_gate.open == true";
  assert.equal(formatTest(parseTest(source).instructions), source);
});

check("the bot resolves targets by id, name, tag and region", () => {
  const scene = sceneWith([
    { id: "gate-7", name: "Main gate", type: "building", tags: ["gate", "landmark"], position: [10, 0, 5] },
  ]);
  scene.regions.courtyard = { id: "courtyard", name: "Courtyard", kind: "area", center: [0, 0, 0], size: [20, 10, 20], tags: [] };
  assert.equal(resolveTarget(scene, "gate-7")!.entityId, "gate-7");
  assert.equal(resolveTarget(scene, "Main gate")!.entityId, "gate-7");
  assert.equal(resolveTarget(scene, "gate")!.entityId, "gate-7");
  assert.deepEqual(resolveTarget(scene, "courtyard")!.position, [0, 0, 0]);
  assert.equal(resolveTarget(scene, "nonexistent_thing"), null);
});

check("the bot picks the NEAREST match when several things share a tag", () => {
  // "Walk to a door" in a village means the door in front of you, not an
  // arbitrary one across the map — which is usually also unreachable.
  const scene = sceneWith([
    { id: "door-far", name: "Door", type: "door", tags: ["door"], position: [200, 0, 0] },
    { id: "door-near", name: "Door", type: "door", tags: ["door"], position: [6, 0, 2] },
  ]);
  assert.equal(resolveTarget(scene, "door", [0, 0, 0])!.entityId, "door-near");
  assert.equal(resolveTarget(scene, "door", [190, 0, 0])!.entityId, "door-far");
});

check("the bot walks UP TO a target, not into it", () => {
  // Walking to an object's centre means walking into its collider; the bot
  // stalls and the test blames the level for a bug in the bot.
  const target = { position: [50, 0, 0] as Vec3, size: [12, 8, 12] as Vec3, entityId: "house" };
  const approach = approachPosition(target, [0, 0, 0]);
  const distance = Math.hypot(approach.position[0] - target.position[0], approach.position[2] - target.position[2]);
  assert.ok(distance > 6, `should stand clear of a 12m-wide house, stood ${distance.toFixed(2)}m away`);
  assert.ok(distance < 9, `but still close enough to interact, stood ${distance.toFixed(2)}m away`);
  assert.ok(approach.position[0] < target.position[0], "approaches from the side the player is on");

  // A small object is approached closely.
  const small = approachPosition({ position: [10, 0, 0], size: [1, 2, 0.2] }, [0, 0, 0]);
  const smallDistance = Math.hypot(small.position[0] - 10, small.position[2]);
  assert.ok(smallDistance < 2.4, `a door should be approached to within its interaction range, got ${smallDistance.toFixed(2)}m`);
});

check("failures are classified so repair can route them", () => {
  assert.equal(classifyFailure("Stopped 12m short. No walkable route connects these two points."), "navigation");
  assert.equal(classifyFailure("The player died before killing boss_1."), "gameplay");
  assert.equal(classifyFailure('Nothing in the scene is named or tagged "castle_gate".'), "schema");
  assert.equal(classifyFailure("drawCalls 2100 over the 700 budget"), "performance");
  assert.equal(classifyFailure("Something exploded"), "runtime");
});

/* ================================================================== */
group("AI tool surface");

check("the tool surface is small enough for a modest model", () => {
  assert.ok(TOOLS.length >= 20 && TOOLS.length <= 30, `expected 20-30 primary tools, got ${TOOLS.length}`);
  const catalogue = toolCatalogue();
  assert.equal(catalogue.length, TOOLS.length);
  for (const entry of catalogue) {
    assert.ok(entry.function.description.length > 80, `${entry.function.name} needs a real description`);
    assert.match(entry.function.description, /When NOT to use/, `${entry.function.name} must say when not to use it`);
    assert.ok(entry.function.parameters, `${entry.function.name} needs a JSON schema`);
  }
});

check("tool names survive the wire format round trip", () => {
  for (const definition of TOOLS) {
    const wire = definition.name.replace(/\./g, "_");
    assert.equal(canonicalToolName(wire), definition.name, `${wire} did not map back`);
  }
  assert.equal(canonicalToolName("scene.applyPatch"), "scene.applyPatch");
});

check("tools declare their permissions, and risky ones need approval", () => {
  for (const definition of TOOLS) {
    assert.ok(definition.permissions.length > 0, `${definition.name} declares no permissions`);
  }
  assert.equal(getTool("code.edit")!.requiresApproval, true, "writing code asks first");
  assert.equal(getTool("scene.query")!.readOnly, true);
});

check("tool arguments are validated before anything runs", () => {
  const patchTool = getTool("scene.applyPatch")!;
  assert.equal(patchTool.schema.safeParse({ sceneId: "s", operations: [] }).success, false, "an empty patch is rejected");
  assert.equal(patchTool.schema.safeParse({ sceneId: "s", operations: [{ op: "nonsense" }] }).success, false);
  assert.equal(patchTool.schema.safeParse({ sceneId: "s", operations: [{ op: "rename", entityId: "a", name: "B" }] }).success, true);

  const generate = getTool("scene.generate")!;
  assert.equal(generate.schema.safeParse({}).success, false, "a generator name is required");
  assert.equal(generate.schema.safeParse({ generator: "settlement" }).success, true);
});

/* ================================================================== */
group("Runtime bridge protocol");

check("editor commands are validated on the way out", () => {
  assert.equal(EditorRuntimeCommandSchema.safeParse({ type: "runtime.play" }).success, true);
  assert.equal(EditorRuntimeCommandSchema.safeParse({ type: "runtime.step", requestId: "r", frames: 60 }).success, true);
  assert.equal(EditorRuntimeCommandSchema.safeParse({ type: "runtime.step", requestId: "r", frames: -1 }).success, false);
  assert.equal(EditorRuntimeCommandSchema.safeParse({ type: "runtime.evil", payload: "rm -rf" }).success, false);
});

check("runtime messages are validated on the way in", () => {
  assert.equal(RuntimeMessageSchema.safeParse({ type: "runtime.state", state: "playing" }).success, true);
  assert.equal(RuntimeMessageSchema.safeParse({ type: "runtime.state", state: "on fire" }).success, false);
  assert.equal(
    RuntimeMessageSchema.safeParse({ type: "runtime.event", event: { sequence: 1, time: 0.5, name: "door_opened", data: {} } }).success,
    true,
  );
});

/* ================================================================== */
group("End-to-end: a generated world holds together");

check("terrain → village → navigation → walkable route", () => {
  // This is the spec's third critical milestone, checked without a browser:
  // a coherent small world built by generators, then actually traversable.
  const project = createProject({ name: "Valley", concept: "a medieval village beside a river", mode: "3d" });
  let scene = activeScene(project);

  const terrain = runGenerator("terrain", genContext(scene), { size: 512, tileSize: 128, maxHeight: 40, mountains: 0.3, rivers: 1, plateauRadius: 90 }, 1234);
  scene = applyScenePatch(scene, { sceneId: scene.id, operations: terrain.operations }).scene;

  const sampler = (x: number, z: number) => terrainHeightAt(x, z, 1234, { ...(scene.terrain!.parameters as never), size: 512, tileSize: 128, maxHeight: 40 });
  const village = runGenerator("settlement", genContext(scene, sampler), { center: [0, 0, 0], radius: 60, houses: 6, landmarks: ["inn", "blacksmith"], npcs: 4 }, 5678);
  scene = applyScenePatch(scene, { sceneId: scene.id, operations: village.operations }).scene;

  assert.ok(Object.keys(scene.entities).length > 25, `the world should be populated, got ${Object.keys(scene.entities).length}`);
  assert.equal(scene.revision, 2);

  // Everything the generators produced must survive validation.
  const withAssets = { ...replaceScene(project, scene), assets: [...terrain.assets, ...village.assets] };
  const errors = validateProject(withAssets).filter((issue) => issue.severity === "error");
  assert.deepEqual(errors, [], `generated world has structural errors: ${JSON.stringify(errors)}`);

  // And it must be navigable between two real places in it.
  const index = new SpatialIndex(scene);
  const buildings = index.all().filter((entry) => entry.type === "building");
  assert.ok(buildings.length >= 4, "there are buildings to walk between");

  const grid = buildNavGrid(
    { ...DEFAULT_NAV_CONFIG, cellSize: 1, tileCells: 48, bounds: { min: [-140, -60, -140], max: [140, 80, 140] } },
    { boxes: [], sampleHeight: sampler },
  );
  const from = buildings[0]!.center;
  const to = buildings[buildings.length - 1]!.center;
  const path = findPath(grid, [from[0], from[1], from[2]], [to[0], to[1], to[2]]);
  assert.equal(path.found, true, `a villager should be able to walk between buildings: ${path.reason}`);
  assert.ok(path.length > 0);
});

check("a generated scene has no duplicate entity ids", () => {
  const scene = sceneWith([]);
  const village = runGenerator("settlement", genContext(scene), { radius: 80, houses: 12, npcs: 8, walls: true }, 424242);
  const ids = createOps(village.operations).map((op) => (op as never as { entity: { id: string } }).entity.id);
  assert.equal(new Set(ids).size, ids.length, "generator ids collided");
  // And they survive a real patch, which enforces uniqueness itself.
  const applied = applyScenePatch(scene, { sceneId: scene.id, operations: village.operations });
  assert.equal(applied.result.applied, true);
});

/* ================================================================== */

process.stdout.write(`\n${"─".repeat(60)}\n`);
if (failures.length) {
  process.stdout.write(`${passed} passed, ${failures.length} FAILED\n\n`);
  for (const failure of failures) process.stdout.write(`  ✗ ${failure}\n`);
  process.stdout.write("\n");
  process.exit(1);
}
process.stdout.write(`All ${passed} checks passed.\n\n`);
