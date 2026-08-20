/**
 * Tool execution, browser side (spec §64, §66, §80).
 *
 * The orchestrator plans; this executes. Every call is validated, wrapped in
 * the project's transaction, timed, and returned as a ToolResult with a
 * structured error and a hint — never "Unknown error" (spec §220).
 */
import { z } from "zod";
import type {
  AssetRecord,
  ContextFrame,
  GameProjectIR,
  PatchOperation,
  SceneIR,
  ToolResult,
  Vec3,
} from "../ir/types";
import { activeScene, createId, replaceScene, validateProject, licenseIssues } from "../ir/project";
import { evaluateGameCompletionGate, validateProjectSubstance } from "../ir/substance";
import { applyScenePatch, PatchError } from "../ir/patch";
import { runSceneQuery, SceneQuerySchema } from "../scene/query";
import { buildSceneSummary, formatSceneSummary } from "../scene/summary";
import { findFreePositions, GroundingError, resolveAnchor, resolvePlacement, type Anchor } from "../scene/grounding";
import { getSpatialIndex } from "../scene/spatial";
import { getGenerator, generatorSchema, discoverGenerators, runGenerator, GeneratorError, listGenerators } from "../procedural/registry";
import type { GeneratorContext } from "../procedural/generator";
import { makeHeightSampler, terrainHeightAt, type TerrainParams } from "../procedural/terrain";
import { materialAsset, type MaterialFamily } from "../procedural/materials";
import { characterGenerator } from "../procedural/characters";
import { componentSchema, listComponents, validateComponent } from "../gameplay/components";
import { QuestSchema, validateQuests, type Quest } from "../gameplay/quests";
import { buildNavGrid, cellSizeForBounds, navGeometryFromScene, navigationIRFrom, DEFAULT_NAV_CONFIG } from "../nav/navmesh";
import { getTool } from "./tools";
import type { RuntimeHost } from "../runtime/host";
import { PlaytestRunner, classifyFailure } from "../playtest/runner";
import type { HistoryStack } from "../history/history";

export interface ToolContext {
  getProject: () => GameProjectIR;
  setProject: (project: GameProjectIR, options: { label: string; changed?: string[]; created?: string[]; deleted?: string[] }) => void;
  getContextFrame: () => ContextFrame | null;
  history: HistoryStack;
  runtime: () => RuntimeHost | null;
  ensureRuntime: () => Promise<RuntimeHost>;
  /** Editor-side side effects the tools may request. */
  onSelect?: (entityIds: string[]) => void;
  onActivity?: (message: string) => void;
}

function ok<T>(data: T, meta: Partial<ToolResult["meta"]> = {}, started = Date.now()): ToolResult<T> {
  return { ok: true, data, meta: { durationMs: Date.now() - started, ...meta } };
}

function fail(code: string, message: string, options: { retryable?: boolean; hint?: string } = {}, started = Date.now()): ToolResult<never> {
  return {
    ok: false,
    error: { code, message, retryable: options.retryable ?? false, hint: options.hint },
    meta: { durationMs: Date.now() - started },
  };
}

function heightSampler(scene: SceneIR) {
  return makeHeightSampler(scene.terrain);
}

function generatorContext(scene: SceneIR, prefix: string): GeneratorContext {
  let counter = 0;
  const stamp = createId(prefix).slice(-8);
  return {
    scene,
    sampleHeight: heightSampler(scene),
    nextId: (hint: string) => {
      counter += 1;
      return `${hint.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 24) || "entity"}-${stamp}-${counter.toString(36)}`;
    },
  };
}

function mergeAssets(project: GameProjectIR, assets: AssetRecord[]): AssetRecord[] {
  if (!assets.length) return project.assets;
  const byId = new Map(project.assets.map((asset) => [asset.id, asset]));
  for (const asset of assets) if (!byId.has(asset.id)) byId.set(asset.id, asset);
  return [...byId.values()];
}

/** Apply operations + assets as one transaction, then commit to the project. */
function commit(
  context: ToolContext,
  operations: PatchOperation[],
  assets: AssetRecord[],
  label: string,
): { revision: number; changed: string[]; warnings: string[] } {
  const project = context.getProject();
  const scene = activeScene(project);
  const { scene: nextScene, result } = applyScenePatch(scene, {
    sceneId: scene.id,
    baseRevision: scene.revision,
    operations,
    label,
  });
  const created = operations.filter((operation) => operation.op === "create").map((operation) => (operation as Extract<PatchOperation, { op: "create" }>).entity.id);
  const deleted = operations.filter((operation) => operation.op === "delete").map((operation) => (operation as Extract<PatchOperation, { op: "delete" }>).entityId);
  const next: GameProjectIR = { ...replaceScene(project, nextScene), assets: mergeAssets(project, assets) };
  context.setProject(next, { label, changed: result.changedEntities, created, deleted });
  return { revision: result.revision, changed: result.changedEntities, warnings: result.warnings };
}

function toToolError(error: unknown, started: number): ToolResult<never> {
  if (error instanceof PatchError) return fail(error.code, error.message, { hint: error.hint }, started);
  if (error instanceof GroundingError) return fail(error.code, error.message, { hint: error.hint }, started);
  if (error instanceof GeneratorError) return fail(error.code, error.message, { hint: error.hint }, started);
  if (error instanceof z.ZodError) {
    return fail("INVALID_ARGUMENTS", error.issues.slice(0, 8).map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`).join("; "), { hint: "Fix the listed fields and call the tool again." }, started);
  }
  const message = error instanceof Error ? error.message : String(error);
  return fail("TOOL_FAILED", message, { retryable: true }, started);
}

/* ------------------------------------------------------------------ */

export async function executeTool(context: ToolContext, name: string, rawArguments: unknown): Promise<ToolResult> {
  const started = Date.now();
  const definition = getTool(name);
  if (!definition) {
    return fail("UNKNOWN_TOOL", `There is no tool called "${name}".`, { hint: "Call tool.discover to find the right tool for what you need." }, started);
  }

  const parsed = definition.schema.safeParse(rawArguments ?? {});
  if (!parsed.success) {
    return fail(
      "INVALID_ARGUMENTS",
      `Arguments for ${name} failed validation — ${parsed.error.issues.slice(0, 8).map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`).join("; ")}`,
      { hint: "Correct the listed fields and call the tool again with the whole argument object." },
      started,
    );
  }
  const args = parsed.data as Record<string, unknown>;

  try {
    switch (name) {
      case "editor.getContext":
        return handleGetContext(context, args, started);
      case "scene.query":
        return handleQuery(context, args, started);
      case "scene.applyPatch":
        return handleApplyPatch(context, args, started);
      case "scene.place":
        return handlePlace(context, args, started);
      case "scene.generate":
        return handleGenerate(context, args, started);
      case "scene.regenerate":
        return handleRegenerate(context, args, started);
      case "terrain.modify":
        return handleTerrain(context, args, started);
      case "asset.search":
        return handleAssetSearch(context, args, started);
      case "material.generate":
        return handleMaterial(context, args, started);
      case "character.generate":
        return handleCharacter(context, args, started);
      case "gameplay.configure":
        return handleGameplay(context, args, started);
      case "quest.configure":
        return handleQuest(context, args, started);
      case "ui.generate":
        return handleUI(context, args, started);
      case "code.edit":
        return handleCode(context, args, started);
      case "navigation.build":
        return handleNavigation(context, args, started);
      case "runtime.start":
        return await handleRuntimeStart(context, args, started);
      case "runtime.query":
        return await handleRuntimeQuery(context, args, started);
      case "runtime.input":
        return await handleRuntimeInput(context, args, started);
      case "test.run":
        return await handleTestRun(context, args, started);
      case "performance.profile":
        return await handleProfile(context, args, started);
      case "project.validate":
        return handleValidate(context, args, started);
      case "history.checkpoint":
        return handleCheckpoint(context, args, started);
      case "tool.discover":
        return handleDiscover(context, args, started);
      default:
        return fail("UNIMPLEMENTED_TOOL", `${name} is declared but has no implementation.`, {}, started);
    }
  } catch (error) {
    return toToolError(error, started);
  }
}

/* ---------------- individual tools ---------------- */

function handleGetContext(context: ToolContext, args: Record<string, unknown>, started: number): ToolResult {
  const project = context.getProject();
  const scene = activeScene(project);
  const frame = context.getContextFrame();
  const summary = buildSceneSummary(scene);
  const maxEntities = Number(args.maxEntities ?? 24);

  return ok(
    {
      sceneId: scene.id,
      sceneName: scene.name,
      revision: scene.revision,
      mode: project.runtime.mode,
      summaryText: formatSceneSummary(summary),
      summary,
      camera: frame?.camera,
      cursor: frame?.cursor,
      selected: frame?.selected ?? [],
      hovered: frame?.hovered,
      visible: args.includeVisible === false ? [] : (frame?.visible ?? []).slice(0, maxEntities),
      nearby: (frame?.nearby ?? []).slice(0, maxEntities),
      regions: Object.values(scene.regions).map((region) => ({ id: region.id, name: region.name, kind: region.kind, center: region.center, size: region.size })),
      performanceProfile: project.performanceProfile,
      hasNavigation: Boolean(scene.navigation?.builtAt),
      note: frame ? undefined : "No editor context was captured with this request; 'here' and 'this' cannot be resolved. Ask the user to select or point at something.",
    },
    {},
    started,
  );
}

function handleQuery(context: ToolContext, args: Record<string, unknown>, started: number): ToolResult {
  const scene = activeScene(context.getProject());
  const query = SceneQuerySchema.parse(args);
  return ok(runSceneQuery(scene, query), {}, started);
}

function handleApplyPatch(context: ToolContext, args: Record<string, unknown>, started: number): ToolResult {
  const project = context.getProject();
  const scene = activeScene(project);
  const { scene: nextScene, result } = applyScenePatch(scene, { ...args, sceneId: (args.sceneId as string) || scene.id });
  if (!result.applied) return ok(result, { warnings: result.warnings }, started);

  const operations = (args.operations as PatchOperation[]) ?? [];
  context.setProject(replaceScene(project, nextScene), {
    label: String(args.label ?? "AI scene edit"),
    changed: result.changedEntities,
    created: operations.filter((operation) => operation.op === "create").map((operation) => (operation as Extract<PatchOperation, { op: "create" }>).entity.id),
    deleted: operations.filter((operation) => operation.op === "delete").map((operation) => (operation as Extract<PatchOperation, { op: "delete" }>).entityId),
  });
  return ok(result, { changedEntities: result.changedEntities, warnings: result.warnings }, started);
}

function handlePlace(context: ToolContext, args: Record<string, unknown>, started: number): ToolResult {
  const project = context.getProject();
  const scene = activeScene(project);
  const frame = context.getContextFrame() ?? undefined;
  const sampler = heightSampler(scene);
  const position = resolvePlacement(scene, frame, args.placement as never, sampler);
  const entityIds = (args.entityIds as string[]) ?? [];
  const ring = args.ring as { count: number; radius: number; clearance: number } | undefined;

  if (!entityIds.length) {
    return ok({ position, resolvedFrom: (args.placement as { anchor: Anchor }).anchor.kind }, {}, started);
  }

  const positions = ring
    ? findFreePositions(scene, position, { count: Math.max(ring.count, entityIds.length), radius: ring.radius, clearance: ring.clearance, snapToGround: true }, sampler)
    : entityIds.map(() => position);

  const operations: PatchOperation[] = entityIds.map((entityId, index) => ({
    op: "transform",
    entityId,
    position: (positions[index] ?? position) as Vec3,
  }));

  const result = commit(context, operations, [], "Place entities");
  return ok({ position, positions: positions.slice(0, entityIds.length), moved: entityIds }, { changedEntities: result.changed, warnings: result.warnings }, started);
}

function handleGenerate(context: ToolContext, args: Record<string, unknown>, started: number): ToolResult {
  const project = context.getProject();
  const scene = activeScene(project);
  const generatorName = String(args.generator);
  const definition = getGenerator(generatorName);
  if (!definition) {
    return fail(
      "UNKNOWN_GENERATOR",
      `There is no generator called "${generatorName}".`,
      { hint: `Available: ${listGenerators(project.runtime.mode).map((entry) => entry.name).join(", ")}. Call tool.discover for what each one does.` },
      started,
    );
  }
  if (!definition.modes.includes(project.runtime.mode)) {
    return fail(
      "WRONG_RUNTIME_MODE",
      `The "${generatorName}" generator only works in ${definition.modes.join("/")} projects; this project is ${project.runtime.mode}.`,
      { hint: `Use a generator that supports ${project.runtime.mode}: ${listGenerators(project.runtime.mode).map((entry) => entry.name).join(", ")}.` },
      started,
    );
  }

  const parameters = { ...((args.parameters as Record<string, unknown>) ?? {}) };
  if (args.at) {
    const frame = context.getContextFrame() ?? undefined;
    const anchor = resolveAnchor(scene, frame, args.at as Anchor);
    // Generators use `center`, `position` or `origin` for their placement.
    if ("center" in (definition.schema as never as { shape?: Record<string, unknown> }).shape!) parameters.center = anchor;
    else if ("origin" in (definition.schema as never as { shape?: Record<string, unknown> }).shape!) parameters.origin = anchor;
    else parameters.position = anchor;
  }

  const seed = Number(args.seed ?? Math.floor(Math.random() * 2 ** 30));
  const output = runGenerator(generatorName, generatorContext(scene, generatorName), parameters, seed);
  const label = String(args.label ?? `Generate ${generatorName}`);
  const result = commit(context, output.operations, output.assets, label);
  context.onActivity?.(output.description);
  if (output.rootIds.length) context.onSelect?.(output.rootIds);

  return ok(
    {
      generator: generatorName,
      seed,
      description: output.description,
      rootIds: output.rootIds,
      entitiesCreated: output.operations.filter((operation) => operation.op === "create").length,
      assetsCreated: output.assets.length,
      revision: result.revision,
    },
    { changedEntities: result.changed, warnings: [...output.warnings, ...result.warnings] },
    started,
  );
}

function handleRegenerate(context: ToolContext, args: Record<string, unknown>, started: number): ToolResult {
  const project = context.getProject();
  const scene = activeScene(project);
  const entityId = String(args.entityId);
  const entity = scene.entities[entityId];
  if (!entity) return fail("ENTITY_NOT_FOUND", `No entity "${entityId}" in this scene.`, { hint: "Use scene.query to find real ids." }, started);
  if (!entity.generator) {
    return fail(
      "NOT_GENERATED",
      `"${entity.name}" was not made by a generator, so there is nothing to re-run.`,
      { hint: "Edit it directly with scene.applyPatch." },
      started,
    );
  }

  const generatorName = entity.generator.generator;
  const seed = Number(args.seed ?? entity.generator.seed);
  const parameters = { ...entity.generator.parameters, ...((args.parameters as Record<string, unknown>) ?? {}) };
  // The user may have moved it since; the editor scene is authoritative (§270).
  const keptTransform = { ...entity.transform };
  const keptName = entity.name;
  const keptParent = entity.parentId;
  const keptRegion = entity.regionId;
  const keptRelationships = entity.semanticRelationships;

  const output = runGenerator(generatorName, generatorContext(scene, generatorName), parameters, seed);
  const newRootId = output.rootIds[0];
  if (!newRootId) return fail("GENERATOR_PRODUCED_NOTHING", `Re-running "${generatorName}" produced no entities.`, { retryable: true }, started);

  const operations: PatchOperation[] = [{ op: "delete", entityId }, ...output.operations];
  for (const operation of operations) {
    if (operation.op === "create" && operation.entity.id === newRootId) {
      operation.entity.transform = keptTransform;
      operation.entity.name = keptName;
      operation.entity.regionId = keptRegion;
      operation.entity.semanticRelationships = keptRelationships;
      operation.parentId = keptParent;
    }
  }

  const result = commit(context, operations, output.assets, `Regenerate ${keptName}`);
  context.onSelect?.([newRootId]);
  return ok(
    { previousId: entityId, entityId: newRootId, generator: generatorName, seed, parameters, description: output.description },
    { changedEntities: result.changed, warnings: [...output.warnings, ...result.warnings] },
    started,
  );
}

function handleTerrain(context: ToolContext, args: Record<string, unknown>, started: number): ToolResult {
  const project = context.getProject();
  const scene = activeScene(project);
  if (!scene.terrain) {
    return fail("NO_TERRAIN", "This scene has no terrain.", { hint: 'Create it first with scene.generate({ generator: "terrain" }).' }, started);
  }
  const params = { ...(scene.terrain.parameters as unknown as TerrainParams), size: scene.terrain.size, tileSize: scene.terrain.tileSize, maxHeight: scene.terrain.maxHeight };

  if (args.action === "sample") {
    const points = args.points as [number, number][];
    const samples = points.map(([x, z]) => {
      const height = terrainHeightAt(x, z, scene.terrain!.seed, params);
      const delta = 1.5;
      const slope = Math.hypot(
        terrainHeightAt(x + delta, z, scene.terrain!.seed, params) - terrainHeightAt(x - delta, z, scene.terrain!.seed, params),
        terrainHeightAt(x, z + delta, scene.terrain!.seed, params) - terrainHeightAt(x, z - delta, scene.terrain!.seed, params),
      ) / (delta * 2);
      return { x, z, height: Number(height.toFixed(2)), slope: Number(slope.toFixed(3)) };
    });
    return ok({ samples }, {}, started);
  }

  // Flatten: recorded as a plateau in the terrain parameters, which keeps
  // terrain a pure function of (seed, params) rather than a stored heightmap.
  const center = args.center as Vec3;
  const radius = Number(args.radius);
  const pads = [...(((scene.terrain.parameters as Record<string, unknown>).pads as { center: Vec3; radius: number; falloff: number }[] | undefined) ?? [])];
  pads.push({ center, radius, falloff: Number(args.falloff ?? 0.4) });

  const result = commit(
    context,
    [{ op: "setTerrain", terrain: { ...scene.terrain, parameters: { ...scene.terrain.parameters, pads, plateauRadius: radius } } }],
    [],
    "Flatten terrain pad",
  );
  return ok({ flattened: { center, radius }, pads: pads.length }, { warnings: result.warnings }, started);
}

function handleAssetSearch(context: ToolContext, args: Record<string, unknown>, started: number): ToolResult {
  const project = context.getProject();
  const query = String(args.query ?? "").toLowerCase();
  const type = args.type as string | undefined;
  const limit = Number(args.limit ?? 15);

  const scored = project.assets
    .filter((asset) => !type || asset.type === type)
    .map((asset) => {
      const haystack = `${asset.name} ${asset.type} ${JSON.stringify(asset.metadata)}`.toLowerCase();
      const terms = query.split(/\s+/).filter(Boolean);
      const score = terms.length ? terms.reduce((total, term) => total + (haystack.includes(term) ? 1 : 0), 0) : 1;
      return { asset, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  return ok(
    {
      total: scored.length,
      assets: scored.map(({ asset }) => ({
        id: asset.id,
        name: asset.name,
        type: asset.type,
        source: asset.source,
        license: asset.provenance.license,
        metadata: asset.metadata,
      })),
    },
    {},
    started,
  );
}

function handleMaterial(context: ToolContext, args: Record<string, unknown>, started: number): ToolResult {
  const asset = materialAsset(String(args.name), {
    family: String(args.family) as MaterialFamily,
    seed: args.seed as number | undefined,
    weathering: Number(args.weathering ?? 0),
    tint: args.tint as string | undefined,
    tintStrength: args.tintStrength as number | undefined,
  });
  const applyTo = (args.applyTo as string[]) ?? [];
  const project = context.getProject();
  const scene = activeScene(project);

  const operations: PatchOperation[] = [];
  for (const entityId of applyTo) {
    const entity = scene.entities[entityId];
    if (!entity) continue;
    const mesh = entity.components.find((component) => component.type === "ProceduralMesh");
    if (!mesh) continue;
    const spec = structuredClone(mesh.data.spec as { parts: { material: string }[] });
    for (const part of spec.parts) part.material = asset.id;
    operations.push({ op: "setComponent", entityId, component: "ProceduralMesh", data: { spec } });
  }

  const result = operations.length
    ? commit(context, operations, [asset], `Apply ${asset.name}`)
    : (() => {
        context.setProject({ ...project, assets: mergeAssets(project, [asset]) }, { label: `Create ${asset.name}` });
        return { revision: scene.revision, changed: [], warnings: [] };
      })();

  return ok({ assetId: asset.id, name: asset.name, definition: asset.definition, appliedTo: operations.length }, { changedEntities: result.changed }, started);
}

function handleCharacter(context: ToolContext, args: Record<string, unknown>, started: number): ToolResult {
  const project = context.getProject();
  const scene = activeScene(project);
  const frame = context.getContextFrame() ?? undefined;
  const sampler = heightSampler(scene);

  let base: Vec3 = (args.position as Vec3) ?? [0, 0, 0];
  if (args.at) base = resolveAnchor(scene, frame, args.at as Anchor);

  const count = Number(args.count ?? 1);
  const spread = Number(args.spread ?? 6);
  const positions = count === 1 ? [base] : findFreePositions(scene, base, { count, radius: spread, clearance: 1.4, snapToGround: true }, sampler);

  const operations: PatchOperation[] = [];
  const assets: AssetRecord[] = [];
  const created: string[] = [];
  const seedBase = Math.floor(Math.random() * 2 ** 28);

  for (let index = 0; index < count; index += 1) {
    const output = characterGenerator.run(
      generatorContext(scene, "character"),
      characterGenerator.schema.parse({
        archetype: String(args.archetype),
        genderPresentation: args.genderPresentation ?? "neutral",
        position: positions[index] ?? base,
        difficulty: Number(args.difficulty ?? 1),
        name: count === 1 ? (args.name as string | undefined) : undefined,
        patrolRadius: args.patrolRadius as number | undefined,
      }),
      seedBase + index * 37,
    );
    operations.push(...output.operations);
    assets.push(...output.assets);
    created.push(...output.rootIds);
  }

  const result = commit(context, operations, assets, `Add ${count} ${String(args.archetype)}`);
  context.onSelect?.(created);
  return ok({ created, archetype: args.archetype, genderPresentation: args.genderPresentation ?? "neutral", positions: positions.slice(0, count) }, { changedEntities: result.changed, warnings: result.warnings }, started);
}

function handleGameplay(context: ToolContext, args: Record<string, unknown>, started: number): ToolResult {
  const project = context.getProject();
  const scene = activeScene(project);
  const entityIds = args.entityIds as string[];
  const components = args.components as { type: string; data: Record<string, unknown>; remove: boolean }[];

  const missing = entityIds.filter((entityId) => !scene.entities[entityId]);
  if (missing.length) {
    return fail("ENTITY_NOT_FOUND", `These entities do not exist: ${missing.join(", ")}.`, { hint: "Use scene.query to get real ids." }, started);
  }

  const operations: PatchOperation[] = [];
  const warnings: string[] = [];

  for (const entityId of entityIds) {
    const entity = scene.entities[entityId]!;
    const present = entity.components.map((component) => component.type);
    for (const component of components) {
      if (component.remove) {
        operations.push({ op: "removeComponent", entityId, component: component.type });
        continue;
      }
      const validation = validateComponent(component.type, component.data, [...present, ...components.filter((other) => !other.remove).map((other) => other.type)]);
      if (!validation.ok) {
        return fail(
          "INVALID_COMPONENT",
          `${component.type} on "${entity.name}": ${validation.issues.join("; ")}`,
          { hint: `Call tool.discover({ kind: "component", name: "${component.type}" }) for the exact schema.` },
          started,
        );
      }
      if (validation.missingRequirements.length) {
        warnings.push(`${component.type} on "${entity.name}" needs ${validation.missingRequirements.join(", ")} to work; add them too.`);
      }
      operations.push({ op: "setComponent", entityId, component: component.type, data: validation.data! });
    }
  }

  const result = commit(context, operations, [], "Configure gameplay");
  return ok({ entities: entityIds.length, components: components.length, revision: result.revision }, { changedEntities: result.changed, warnings: [...warnings, ...result.warnings] }, started);
}

function handleQuest(context: ToolContext, args: Record<string, unknown>, started: number): ToolResult {
  const project = context.getProject();
  const scene = activeScene(project);
  const raw = args.quest as Record<string, unknown>;
  const parsed = QuestSchema.safeParse({
    ...raw,
    titleKey: raw.titleKey ?? `quest.${String(raw.id)}.title`,
    descriptionKey: raw.descriptionKey ?? `quest.${String(raw.id)}.description`,
  });
  if (!parsed.success) {
    return fail("INVALID_QUEST", parsed.error.issues.slice(0, 8).map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; "), { hint: "Steps must be one of talk/collect/kill/reach/interact/return/escort with their required fields." }, started);
  }
  const quest = parsed.data as Quest;

  const index = getSpatialIndex(scene);
  const world = {
    entityIds: new Set(index.all().map((entry) => entry.id)),
    entityTags: new Set(index.all().flatMap((entry) => entry.tags)),
    regionIds: new Set(Object.keys(scene.regions)),
    itemIds: new Set<string>(),
  };
  for (const entity of Object.values(scene.entities)) {
    for (const component of entity.components) {
      if (component.type === "Collectible" && typeof component.data.item === "string") world.itemIds.add(component.data.item);
      if (component.type === "Container") {
        for (const loot of (component.data.loot as { item: string }[] | undefined) ?? []) world.itemIds.add(loot.item);
      }
    }
  }

  const existing = ((project.systems.find((system) => system.type === "quests")?.config.quests as Quest[] | undefined) ?? []).filter((entry) => entry.id !== quest.id);
  const quests = [...existing, quest];
  const issues = validateQuests(quests, world);

  const systems = project.systems.some((system) => system.type === "quests")
    ? project.systems.map((system) => (system.type === "quests" ? { ...system, config: { quests } } : system))
    : [...project.systems, { id: createId("system"), type: "quests", enabled: true, config: { quests } }];

  context.setProject({ ...project, systems }, { label: `Quest: ${quest.title}` });
  return ok(
    { questId: quest.id, steps: quest.steps.length, issues: issues.map((issue) => issue.message) },
    { warnings: issues.map((issue) => issue.message) },
    started,
  );
}

function handleUI(context: ToolContext, args: Record<string, unknown>, started: number): ToolResult {
  const project = context.getProject();
  const screen = String(args.screen);
  const elements = args.elements as { type: string; props: Record<string, unknown> }[];
  const nodes = elements.map((element, index) => ({ id: `${screen}-${index}`, type: element.type, props: element.props, children: [] }));
  const existing = project.ui.screens[screen];
  const merged = args.replace === false && existing ? { ...existing, children: [...existing.children, ...nodes] } : { id: screen, type: "Screen", props: {}, children: nodes };

  context.setProject({ ...project, ui: { ...project.ui, screens: { ...project.ui.screens, [screen]: merged } } }, { label: `UI: ${screen}` });
  return ok({ screen, elements: nodes.length }, {}, started);
}

function handleCode(context: ToolContext, args: Record<string, unknown>, started: number): ToolResult {
  const project = context.getProject();
  const path = String(args.path);
  const current = project.scripts[path] ?? "";
  const replace = args.replace as { find: string; with: string } | undefined;

  let next: string;
  if (replace) {
    if (!current.includes(replace.find)) {
      return fail("PATCH_TARGET_NOT_FOUND", `"${path}" does not contain the text you asked to replace.`, { hint: "Read the file first, or pass `contents` to write it whole." }, started);
    }
    next = current.replace(replace.find, replace.with);
  } else if (typeof args.contents === "string") {
    next = args.contents;
  } else {
    return fail("NOTHING_TO_WRITE", "Pass either `contents` or `replace`.", {}, started);
  }

  // Cheap structural check — a script that cannot parse never reaches the
  // sandbox, and the model gets the parse error back immediately.
  try {
    // eslint-disable-next-line no-new-func
    new Function(`"use strict";return (async()=>{${next.replace(/\bexport\s+(default\s+)?/g, "")}})`);
  } catch (error) {
    return fail("SCRIPT_SYNTAX_ERROR", `"${path}" does not parse: ${error instanceof Error ? error.message : String(error)}`, { hint: "Fix the syntax and resend." }, started);
  }

  context.setProject({ ...project, scripts: { ...project.scripts, [path]: next } }, { label: `Edit ${path}` });
  return ok({ path, bytes: next.length, reason: args.reason }, {}, started);
}

function handleNavigation(context: ToolContext, args: Record<string, unknown>, started: number): ToolResult {
  const project = context.getProject();
  const scene = activeScene(project);
  const bounds = (scene.metadata.terrainBounds as { min: Vec3; max: Vec3 } | undefined) ?? sceneBoundsFor(scene);
  const config = {
    ...DEFAULT_NAV_CONFIG,
    // Scale the grid to the world so a large map stays pathable.
    cellSize: cellSizeForBounds(bounds),
    bounds,
    agentRadius: Number(args.agentRadius ?? DEFAULT_NAV_CONFIG.agentRadius),
    agentHeight: Number(args.agentHeight ?? DEFAULT_NAV_CONFIG.agentHeight),
    maxSlopeDegrees: Number(args.maxSlopeDegrees ?? DEFAULT_NAV_CONFIG.maxSlopeDegrees),
  };
  const geometry = navGeometryFromScene(scene, heightSampler(scene));
  if (!geometry.boxes.length && !geometry.sampleHeight) {
    return fail(
      "NO_WALKABLE_GEOMETRY",
      "Navigation could not be built because the scene has no terrain and no colliders to walk on.",
      { hint: "Generate terrain or add ground geometry with a Collider first." },
      started,
    );
  }

  const grid = buildNavGrid(config, geometry, args.tiles as string[] | undefined);
  const navigation = navigationIRFrom(grid);
  let walkableCells = 0;
  for (const tile of grid.tiles.values()) walkableCells += tile.walkable.reduce((total, value) => total + value, 0);

  const result = commit(context, [{ op: "setNavigation", navigation }], [], "Build navigation");
  return ok(
    { tiles: grid.tiles.size, walkableCells, cellSize: config.cellSize, bounds, revision: result.revision },
    { warnings: walkableCells === 0 ? ["The navmesh has no walkable cells — nothing in this scene can be walked on."] : result.warnings },
    started,
  );
}

function sceneBoundsFor(scene: SceneIR): { min: Vec3; max: Vec3 } {
  const index = getSpatialIndex(scene);
  if (!index.size) return { min: [-64, -32, -64], max: [64, 32, 64] };
  return {
    min: [index.bounds.min[0] - 16, index.bounds.min[1] - 16, index.bounds.min[2] - 16] as Vec3,
    max: [index.bounds.max[0] + 16, index.bounds.max[1] + 16, index.bounds.max[2] + 16] as Vec3,
  };
}

async function handleRuntimeStart(context: ToolContext, args: Record<string, unknown>, started: number): Promise<ToolResult> {
  const host = await context.ensureRuntime();
  const project = context.getProject();
  const loaded = new Promise<{ sceneId: string; entityCount: number; warnings: string[] }>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("The runtime did not report a loaded scene within 30 seconds.")), 30_000);
    const previous = (host as unknown as { handlers: { onLoaded?: (info: never) => void } }).handlers.onLoaded;
    (host as unknown as { handlers: { onLoaded?: (info: { sceneId: string; entityCount: number; warnings: string[] }) => void } }).handlers.onLoaded = (info) => {
      clearTimeout(timer);
      previous?.(info as never);
      resolve(info);
    };
  });

  await host.load(project, args.sceneId as string | undefined);
  const info = await loaded;
  if (args.autoPlay !== false) host.play();
  return ok({ ...info, capabilities: host.capabilities, state: host.state }, { warnings: info.warnings }, started);
}

async function handleRuntimeQuery(context: ToolContext, args: Record<string, unknown>, started: number): Promise<ToolResult> {
  const host = context.runtime();
  if (!host || host.state === "idle") return fail("RUNTIME_NOT_RUNNING", "The game is not running.", { hint: "Call runtime.start first." }, started);
  const data = await host.query(args.query as never);
  return ok(data, {}, started);
}

async function handleRuntimeInput(context: ToolContext, args: Record<string, unknown>, started: number): Promise<ToolResult> {
  const host = context.runtime();
  if (!host) return fail("RUNTIME_NOT_RUNNING", "The game is not running.", { hint: "Call runtime.start first." }, started);

  switch (args.action) {
    case "press":
      return ok(await host.input(String(args.input), { phase: "press" }), {}, started);
    case "hold": {
      await host.input(String(args.input), { phase: "down" });
      await host.step(Math.max(1, Math.round(Number(args.seconds) * 60)));
      await host.input(String(args.input), { phase: "up" });
      return ok({ held: args.input, seconds: args.seconds }, {}, started);
    }
    case "moveTo":
      return ok(await host.moveTo(args.position as Vec3), {}, started);
    case "step":
      return ok(await host.step(Number(args.frames)), {}, started);
    default:
      return fail("UNKNOWN_INPUT_ACTION", `Unsupported runtime input action.`, {}, started);
  }
}

async function handleTestRun(context: ToolContext, args: Record<string, unknown>, started: number): Promise<ToolResult> {
  const host = context.runtime();
  if (!host || host.state === "idle") {
    return fail("RUNTIME_NOT_RUNNING", "The game is not running, so nothing can be tested.", { hint: "Call runtime.start first." }, started);
  }
  const project = context.getProject();
  const scene = activeScene(project);
  const runner = new PlaytestRunner(host, scene);
  const result = await runner.run(String(args.script), { timeoutMs: Number(args.timeoutMs ?? 120000) });

  if (args.save) {
    const test = {
      id: createId("test"),
      name: String(args.name ?? "playtest"),
      sceneId: scene.id,
      script: String(args.script),
      timeoutMs: Number(args.timeoutMs ?? 120000),
    };
    context.setProject({ ...project, tests: [...project.tests.filter((entry) => entry.name !== test.name), test] }, { label: `Save test ${test.name}` });
  }

  return ok(
    {
      passed: result.passed,
      steps: result.steps,
      failure: result.failure,
      failureCategory: result.failure ? classifyFailure(result.failure.detail) : undefined,
      runtimeErrors: result.runtimeErrors,
      eventCounts: countEvents(result.events),
      durationMs: result.durationMs,
    },
    {},
    started,
  );
}

function countEvents(events: { name: string }[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const event of events) counts[event.name] = (counts[event.name] ?? 0) + 1;
  return counts;
}

async function handleProfile(context: ToolContext, args: Record<string, unknown>, started: number): Promise<ToolResult> {
  const host = context.runtime();
  if (!host) return fail("RUNTIME_NOT_RUNNING", "The game is not running.", { hint: "Call runtime.start first." }, started);
  const project = context.getProject();
  const contract = project.performanceProfile;

  await host.step(Number(args.frames ?? 180));
  const metrics = await host.metrics();
  const render = await host.renderReport();

  const violations: { budget: string; limit: number; actual: number; repair: string }[] = [];
  if (metrics.drawCalls > contract.maxDrawCalls) {
    violations.push({ budget: "drawCalls", limit: contract.maxDrawCalls, actual: metrics.drawCalls, repair: "Merge repeated props into instanced regions, or reduce distinct materials." });
  }
  if (metrics.triangles > contract.maxTriangles) {
    violations.push({ budget: "triangles", limit: contract.maxTriangles, actual: metrics.triangles, repair: "Lower vegetation density or terrain tile count, or reduce building detail." });
  }
  if (metrics.textureMegabytes > contract.maxTextureMegabytes) {
    violations.push({ budget: "textureMegabytes", limit: contract.maxTextureMegabytes, actual: metrics.textureMegabytes, repair: "Share materials between entities instead of generating a new one per object." });
  }
  if (metrics.fps > 0 && metrics.fps < contract.minimumFPS) {
    violations.push({ budget: "fps", limit: contract.minimumFPS, actual: metrics.fps, repair: "Reduce dynamic shadow-casting lights and instance repeated geometry." });
  }

  const renderProblems: string[] = [];
  if (!render.cameraPresent) renderProblems.push("There is no active camera — the screen will be blank.");
  if (render.visibleMeshInstances === 0) renderProblems.push("Nothing visible is being rendered.");
  if (render.nonFiniteTransforms > 0) renderProblems.push(`${render.nonFiniteTransforms} entities have NaN/Infinity transforms.`);
  if (render.distinctColorBuckets <= 1 && render.visibleMeshInstances > 0) renderProblems.push("The frame is a single flat colour — geometry may be behind the camera or unlit.");

  return ok({ metrics, contract, violations, render, renderProblems, passed: violations.length === 0 && renderProblems.length === 0 }, { warnings: renderProblems }, started);
}

function handleValidate(context: ToolContext, args: Record<string, unknown>, started: number): ToolResult {
  const project = context.getProject();
  const issues = validateProject(project);
  if (args.includeLicenses) issues.push(...licenseIssues(project));

  const quests = (project.systems.find((system) => system.type === "quests")?.config.quests as Quest[] | undefined) ?? [];
  if (quests.length) {
    const scene = activeScene(project);
    const index = getSpatialIndex(scene);
    const questIssues = validateQuests(quests, {
      entityIds: new Set(index.all().map((entry) => entry.id)),
      entityTags: new Set(index.all().flatMap((entry) => entry.tags)),
      regionIds: new Set(Object.keys(scene.regions)),
      itemIds: new Set(),
    });
    issues.push(...questIssues.map((issue) => ({ severity: "error" as const, code: "QUEST_BROKEN", message: `${issue.questId}: ${issue.message}` })));
  }

  const errors = issues.filter((issue) => issue.severity === "error");
  const substance = validateProjectSubstance(project);
  if (args.requireSubstance !== false) errors.push(...substance.issues.filter((issue) => issue.severity === "error"));
  const projectValid = errors.length === 0;
  const evidence = args.completionEvidence as { runtimeBooted?: boolean; smokeTestPassed?: boolean; noCriticalRuntimeErrors?: boolean } | undefined;
  const completionGate = evidence ? evaluateGameCompletionGate(project, projectValid, evidence) : undefined;
  return ok({
    valid: projectValid,
    errors,
    warnings: [...issues.filter((issue) => issue.severity === "warning"), ...substance.issues.filter((issue) => issue.severity === "warning")],
    substance,
    completionGate,
  }, {}, started);
}

function handleCheckpoint(context: ToolContext, args: Record<string, unknown>, started: number): ToolResult {
  if (args.action === "create") {
    const checkpoint = context.history.checkpoint(String(args.label), context.getProject());
    return ok({ checkpointId: checkpoint.id, label: checkpoint.label }, {}, started);
  }
  if (args.action === "list") {
    return ok({ checkpoints: context.history.listCheckpoints() }, {}, started);
  }
  const restored = context.history.rollback(String(args.checkpointId));
  if (!restored) return fail("CHECKPOINT_NOT_FOUND", `No checkpoint "${String(args.checkpointId)}".`, { hint: 'Call history.checkpoint({ action: "list" }) to see what exists.' }, started);
  context.setProject(restored, { label: "Roll back to checkpoint" });
  return ok({ rolledBackTo: args.checkpointId }, {}, started);
}

function handleDiscover(context: ToolContext, args: Record<string, unknown>, started: number): ToolResult {
  const project = context.getProject();
  const kind = String(args.kind ?? "both");
  const named = args.name as string | undefined;

  if (named) {
    const generator = generatorSchema(named);
    const component = componentSchema(named);
    if (!generator && !component) {
      return fail("NOT_FOUND", `Nothing called "${named}" is a generator or a component.`, { hint: "Call tool.discover with just `need` to search." }, started);
    }
    return ok({ name: named, generatorSchema: generator, componentSchema: component }, {}, started);
  }

  const need = String(args.need);
  const terms = need.toLowerCase().split(/[^a-z0-9]+/).filter((term) => term.length > 2);
  const generators = kind === "component" ? [] : discoverGenerators(need, project.runtime.mode);
  const components =
    kind === "generator"
      ? []
      : listComponents()
          .map((component) => ({
            ...component,
            score: terms.reduce((total, term) => total + (`${component.type} ${component.summary}`.toLowerCase().includes(term) ? 1 : 0), 0),
          }))
          .filter((component) => component.score > 0)
          .sort((a, b) => b.score - a.score)
          .slice(0, 6)
          .map(({ score: _score, ...rest }) => rest);

  return ok(
    {
      need,
      generators,
      components,
      next: "Call tool.discover again with `name` set to one of these to get its exact JSON schema before using it.",
    },
    {},
    started,
  );
}
