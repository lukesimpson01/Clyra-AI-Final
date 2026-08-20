/**
 * The semantic tool surface (spec §67, §68, §172).
 *
 * Deliberately small — 22 primary tools — because a modest model shown 300
 * tools becomes unreliable. Specialised operations are reached through
 * `tool.discover`, which returns only the two or three schemas that matter
 * for the job at hand.
 *
 * Every description follows the pattern the PlayCanvas editor MCP server
 * settled on: what it does, what it returns, and explicitly *when not to use
 * it* — the last part is what stops a weak model reaching for applyPatch
 * when it should have called a generator.
 */
import { z } from "zod";
import { ScenePatchSchema } from "../ir/schema";
import { SceneQuerySchema } from "../scene/query";
import { AnchorSchema, PlacementSchema } from "../scene/grounding";
import { RuntimeQuerySchema } from "../runtime/protocol";

export type ToolPermission = "scene.read" | "scene.write" | "asset.write" | "code.write" | "runtime.control" | "project.write" | "publish";

export interface ToolDefinition {
  name: string;
  description: string;
  schema: z.ZodTypeAny;
  permissions: ToolPermission[];
  /** Sensitive tools ask the user before running (spec §173). */
  requiresApproval?: boolean;
  readOnly?: boolean;
}

const tool = (definition: ToolDefinition) => definition;

export const TOOLS: ToolDefinition[] = [
  tool({
    name: "editor.getContext",
    description:
      "Read the frozen editor context for this request: camera, cursor ray and what it hit, current selection, visible and nearby entities, and a hierarchical scene summary. Call this FIRST for any request that says 'here', 'this', 'there' or 'where I'm looking'. When NOT to use: to list entities by type or tag (use scene.query) — this returns what the user is looking at, not the whole scene.",
    schema: z.object({ includeVisible: z.boolean().default(true), maxEntities: z.number().int().min(1).max(80).default(24) }),
    permissions: ["scene.read"],
    readOnly: true,
  }),
  tool({
    name: "scene.query",
    description:
      "Find entities by type, tag, name, region, radius, bounding box, component or generator, with sorting and pagination. Returns ids, names, world positions and sizes. This is how you get REAL entity ids — never invent one. When NOT to use: to read one known entity in full (pass its id in `where.ids`), or to understand the shape of the whole world (editor.getContext returns a summary).",
    schema: SceneQuerySchema,
    permissions: ["scene.read"],
    readOnly: true,
  }),
  tool({
    name: "scene.applyPatch",
    description:
      "Apply a transactional set of scene edits: create/delete/reparent/rename entities, set transforms, components, tags, bounds, regions and relationships. The whole patch validates before anything is written, and a stale `baseRevision` is rejected rather than overwriting the user's work. When NOT to use: to create large amounts of content (use scene.generate — a patch of 400 wall entities is the wrong tool), or to change project-wide settings (use project.configure).",
    schema: ScenePatchSchema,
    permissions: ["scene.write"],
  }),
  tool({
    name: "scene.place",
    description:
      "Resolve an anchor ('cursor', 'selection', 'gaze', an entity, a region) plus an optional direction and offset into an exact world position, then optionally move entities there. This is how 'put it here', 'two metres to the left' and 'behind this' become coordinates. The engine computes the position — you must not guess one. When NOT to use: when you already have exact world coordinates.",
    schema: z.object({
      placement: PlacementSchema,
      /** Entities to move to the resolved position; omit to only resolve it. */
      entityIds: z.array(z.string()).max(200).default([]),
      /** Spread several entities in a ring around the resolved point. */
      ring: z.object({ count: z.number().int().min(1).max(64), radius: z.number().positive(), clearance: z.number().positive().default(1.5) }).optional(),
    }),
    permissions: ["scene.read", "scene.write"],
  }),
  tool({
    name: "scene.generate",
    description:
      "Run a procedural generator — terrain, settlement, fortress, dungeon, building, road, vegetation, character, prop, tilemap2d, voxelWorld — and apply its output as one transaction. This is the primary way to create content: one call produces a coherent village with roads, plots, buildings and NPCs. Call tool.discover first if you are unsure which generator or what parameters it takes. When NOT to use: to move or tweak something that already exists (scene.applyPatch), or to re-run a generator with changed parameters on an existing object (scene.regenerate).",
    schema: z.object({
      generator: z.string().min(1),
      parameters: z.record(z.string(), z.unknown()).default({}),
      seed: z.number().int().optional(),
      /** Resolve the generator's position from an anchor instead of raw XYZ. */
      at: AnchorSchema.optional(),
      label: z.string().max(120).optional(),
    }),
    permissions: ["scene.write", "asset.write"],
  }),
  tool({
    name: "scene.regenerate",
    description:
      "Re-run the generator that created an existing entity with changed parameters, preserving its id, transform and relationships. This is how 'make this house two storeys with a balcony' works — it rebuilds the house rather than patching its walls. When NOT to use: on an entity with no `generator` metadata (it was hand-made; edit it with scene.applyPatch).",
    schema: z.object({
      entityId: z.string().min(1),
      parameters: z.record(z.string(), z.unknown()).default({}),
      /** Omit to keep the original seed, which keeps the object recognisable. */
      seed: z.number().int().optional(),
    }),
    permissions: ["scene.write", "asset.write"],
  }),
  tool({
    name: "terrain.modify",
    description:
      "Sample or reshape terrain: read elevation and slope at points, or flatten a circular pad so a structure can sit on uneven ground. When NOT to use: to create terrain in the first place (scene.generate with the `terrain` generator).",
    // Object-rooted, not a union: the model API requires every function's
    // parameter schema to be `type: "object"`, and a discriminated union
    // serialises to a root-level anyOf that it rejects outright. The
    // combination rules are still enforced, just in superRefine.
    schema: z
      .object({
        action: z.enum(["sample", "flatten"]),
        points: z.array(z.tuple([z.number(), z.number()])).min(1).max(200).optional().describe("Required for sample: [x, z] pairs to read elevation and slope at."),
        center: z.tuple([z.number(), z.number(), z.number()]).optional().describe("Required for flatten: the centre of the pad."),
        radius: z.number().positive().max(1000).optional().describe("Required for flatten: the pad radius in metres."),
        falloff: z.number().min(0).max(1).default(0.4),
      })
      .superRefine((value, context) => {
        if (value.action === "sample" && !value.points?.length) {
          context.addIssue({ code: "custom", message: "sample needs `points`.", path: ["points"] });
        }
        if (value.action === "flatten" && (!value.center || value.radius === undefined)) {
          context.addIssue({ code: "custom", message: "flatten needs `center` and `radius`.", path: ["center"] });
        }
      }),
    permissions: ["scene.write"],
  }),
  tool({
    name: "asset.search",
    description:
      "Search the project's assets — materials, meshes, prefabs, audio — by name, type and tag, ranked for reuse. Always search before generating: reusing an existing material keeps the project visually coherent and costs nothing. When NOT to use: to create a new material (material.generate).",
    schema: z.object({ query: z.string().max(120).default(""), type: z.string().optional(), limit: z.number().int().min(1).max(50).default(15) }),
    permissions: ["scene.read"],
    readOnly: true,
  }),
  tool({
    name: "material.generate",
    description:
      "Create a procedural PBR material from a family (stone, wood, metal, brick, plaster, grass, snow, sand, rock, fabric, thatch, clay_tiles, glass, water, foliage, leather...) with weathering and an optional tint. Deterministic, no textures to download. When NOT to use: when a suitable material already exists (asset.search first).",
    schema: z.object({
      name: z.string().max(80),
      family: z.string().min(1),
      seed: z.number().int().optional(),
      weathering: z.number().min(0).max(1).default(0),
      tint: z.string().optional(),
      tintStrength: z.number().min(0).max(1).optional(),
      applyTo: z.array(z.string()).max(200).default([]),
    }),
    permissions: ["asset.write", "scene.write"],
  }),
  tool({
    name: "character.generate",
    description:
      "Create one or more characters from an archetype (player, villager, merchant, guard, bandit, soldier, mage, zombie, monster, boss) with a modular mesh, equipment, health, combat and behaviour already configured. When NOT to use: to change an existing character's stats (scene.applyPatch on its Health/Behavior components).",
    schema: z.object({
      archetype: z.string().min(1),
      genderPresentation: z.enum(["female", "male", "neutral"]).default("neutral"),
      count: z.number().int().min(1).max(60).default(1),
      at: AnchorSchema.optional(),
      position: z.tuple([z.number(), z.number(), z.number()]).optional(),
      spread: z.number().min(0).max(200).default(6),
      difficulty: z.number().min(0.1).max(10).default(1),
      name: z.string().max(80).optional(),
      patrolRadius: z.number().min(0).max(200).optional(),
    }),
    permissions: ["scene.write", "asset.write"],
  }),
  tool({
    name: "gameplay.configure",
    description:
      "Add or update gameplay components on entities from the built-in library (Health, Melee, Inventory, Interactable, Door, Trigger, Spawner, Behavior, Quest, Checkpoint, PlayerController, ...), validated against each component's schema and reporting any components they depend on. This is how mechanics get wired — do NOT write code for behaviour a component already provides. When NOT to use: to create the entities themselves (scene.generate / scene.applyPatch).",
    schema: z.object({
      entityIds: z.array(z.string()).min(1).max(200),
      components: z.array(z.object({ type: z.string().min(1), data: z.record(z.string(), z.unknown()).default({}), remove: z.boolean().default(false) })).min(1).max(24),
    }),
    permissions: ["scene.write"],
  }),
  tool({
    name: "quest.configure",
    description:
      "Create or update a quest as data — steps (talk, collect, kill, reach, interact, return, escort), rewards, prerequisites — and validate that every target and region it references actually exists so the quest is completable. When NOT to use: for one-off dialogue with no objectives (ui.generate / gameplay.configure with NPC).",
    schema: z.object({
      quest: z.object({
        id: z.string().min(1),
        title: z.string().min(1),
        description: z.string().default(""),
        giver: z.string().optional(),
        steps: z.array(z.record(z.string(), z.unknown())).min(1).max(24),
        rewards: z.array(z.object({ item: z.string(), count: z.number().int().positive().default(1) })).default([]),
        xp: z.number().int().min(0).default(0),
        prerequisites: z.array(z.string()).default([]),
      }),
    }),
    permissions: ["project.write"],
  }),
  tool({
    name: "ui.generate",
    description:
      "Compose the game's UI from semantic primitives (MainMenu, PauseMenu, HUD, HealthBar, Crosshair, QuestTracker, Inventory, Dialogue, Shop, Settings, Minimap, Hotbar, BossBar). When NOT to use: to build editor UI — this is the game's UI only.",
    schema: z.object({
      screen: z.enum(["hud", "pause", "main", "inventory", "dialogue", "shop", "settings"]),
      elements: z.array(z.object({ type: z.string().min(1), props: z.record(z.string(), z.unknown()).default({}) })).min(1).max(24),
      replace: z.boolean().default(true),
    }),
    permissions: ["project.write"],
  }),
  tool({
    name: "code.edit",
    description:
      "Write or patch a project script when — and only when — no component, template or generator can express the behaviour. Scripts are validated and run only inside the sandboxed runtime, never in the editor. When NOT to use: for anything the component library already covers (check gameplay.configure first); reaching for code early is the most common way to produce a broken game.",
    schema: z.object({
      path: z.string().min(1).max(200),
      contents: z.string().max(60000).optional(),
      /** Targeted replacement; preferred over rewriting a whole file. */
      replace: z.object({ find: z.string().min(1), with: z.string() }).optional(),
      reason: z.string().max(400),
    }),
    permissions: ["code.write"],
    requiresApproval: true,
  }),
  tool({
    name: "navigation.build",
    description:
      "Build or rebuild the navigation mesh so characters and the playtest bot can path through the world. Only the tiles you name are rebuilt; omit `tiles` after large world changes. Call this after adding buildings, roads or terrain, and before any test that walks somewhere. When NOT to use: after moving a single prop that blocks nothing.",
    schema: z.object({
      tiles: z.array(z.string()).max(512).optional(),
      agentRadius: z.number().min(0.1).max(3).optional(),
      agentHeight: z.number().min(0.5).max(5).optional(),
      maxSlopeDegrees: z.number().min(5).max(80).optional(),
    }),
    permissions: ["scene.write"],
  }),
  tool({
    name: "runtime.start",
    description:
      "Start the game in the sandboxed play runtime and wait until it has loaded. Required before runtime.query, runtime.input or test.run. Returns the loaded scene, entity count and any load warnings. When NOT to use: to edit the scene — the runtime is a read/drive surface, edits go through the editor.",
    schema: z.object({ sceneId: z.string().optional(), autoPlay: z.boolean().default(true) }),
    permissions: ["runtime.control"],
  }),
  tool({
    name: "runtime.query",
    description:
      "Read live state out of the running game: the player (position, velocity, grounded, health, inventory), any entity's components, lists of entities, emitted events, performance metrics, a navigation path, or a numeric render report. This is your only way to know what is actually happening — you have no vision, so verify here instead of assuming. When NOT to use: before runtime.start.",
    schema: z.object({ query: RuntimeQuerySchema }),
    permissions: ["runtime.control"],
    readOnly: true,
  }),
  tool({
    name: "runtime.input",
    description:
      "Send a semantic action to the running game (moveForward, jump, interact, attack, ...) or walk the player to a world position using the navmesh, then advance a fixed number of frames deterministically. When NOT to use: to run a whole scripted scenario (test.run executes a DSL script and asserts on results).",
    schema: z
      .object({
        action: z.enum(["press", "hold", "moveTo", "step"]),
        input: z.string().min(1).optional().describe("Required for press and hold: the action name, e.g. jump or interact."),
        seconds: z.number().min(0.05).max(60).optional().describe("Required for hold."),
        position: z.tuple([z.number(), z.number(), z.number()]).optional().describe("Required for moveTo."),
        frames: z.number().int().min(1).max(6000).optional().describe("Required for step."),
      })
      .superRefine((value, context) => {
        if ((value.action === "press" || value.action === "hold") && !value.input) {
          context.addIssue({ code: "custom", message: `${value.action} needs \`input\`.`, path: ["input"] });
        }
        if (value.action === "hold" && value.seconds === undefined) {
          context.addIssue({ code: "custom", message: "hold needs `seconds`.", path: ["seconds"] });
        }
        if (value.action === "moveTo" && !value.position) {
          context.addIssue({ code: "custom", message: "moveTo needs `position`.", path: ["position"] });
        }
        if (value.action === "step" && value.frames === undefined) {
          context.addIssue({ code: "custom", message: "step needs `frames`.", path: ["frames"] });
        }
      }),
    permissions: ["runtime.control"],
  }),
  tool({
    name: "test.run",
    description:
      "Run a playtest script against the running game and get a per-step pass/fail report with the exact failing step and a failure category. Script lines: `spawn player at X`, `move player to X`, `press ACTION`, `hold ACTION for Ns`, `interact X`, `attack X until dead`, `wait Ns`, `assert player reached X`, `assert X.prop == value`, `assert event NAME`, `assert no event NAME`. This is how you prove a change works. When NOT to use: to check static scene structure (scene.query is cheaper).",
    schema: z.object({ script: z.string().min(1).max(8000), name: z.string().max(120).default("playtest"), save: z.boolean().default(false), timeoutMs: z.number().int().min(1000).max(300000).default(120000) }),
    permissions: ["runtime.control"],
  }),
  tool({
    name: "performance.profile",
    description:
      "Measure the running game against the project's performance contract (draw calls, triangles, texture memory, entity count, FPS) and report every budget it exceeds with the specific cause. When NOT to use: before runtime.start.",
    schema: z.object({ frames: z.number().int().min(10).max(2000).default(180) }),
    permissions: ["runtime.control"],
    readOnly: true,
  }),
  tool({
    name: "project.validate",
    description:
      "Check the whole project for missing assets, broken entity or region references, duplicate ids, invalid components, missing camera or player spawn, unbound input actions, uncompletable quests, and asset licences that block publishing. Run this before declaring work finished. When NOT to use: as a substitute for actually playing the game (test.run).",
    schema: z.object({
      includeLicenses: z.boolean().default(false),
      requireSubstance: z.boolean().default(true),
      completionEvidence: z.object({
        runtimeBooted: z.boolean().default(false),
        smokeTestPassed: z.boolean().default(false),
        noCriticalRuntimeErrors: z.boolean().default(false),
      }).optional(),
    }),
    permissions: ["scene.read"],
    readOnly: true,
  }),
  tool({
    name: "history.checkpoint",
    description:
      "Take a named, restorable snapshot of the whole project before risky work, or roll back to one. An AI task is already one undo step; use this for multi-stage work you may need to abandon mid-way. When NOT to use: for ordinary single edits — they are undoable already.",
    schema: z
      .object({
        action: z.enum(["create", "rollback", "list"]),
        label: z.string().max(120).optional().describe("Required for create."),
        checkpointId: z.string().min(1).optional().describe("Required for rollback."),
      })
      .superRefine((value, context) => {
        if (value.action === "create" && !value.label) {
          context.addIssue({ code: "custom", message: "create needs `label`.", path: ["label"] });
        }
        if (value.action === "rollback" && !value.checkpointId) {
          context.addIssue({ code: "custom", message: "rollback needs `checkpointId`.", path: ["checkpointId"] });
        }
      }),
    permissions: ["project.write"],
  }),
  tool({
    name: "tool.discover",
    description:
      "Describe what you are trying to do in plain language and get back the specific generators, components and their exact JSON schemas that can do it. Use this instead of guessing parameter names. When NOT to use: for the tools listed here — you already have their schemas.",
    schema: z.object({
      need: z.string().min(2).max(300).optional(),
      kind: z.enum(["generator", "component", "both"]).default("both"),
      /** Fetch the full schema for one named generator or component. */
      name: z.string().optional(),
    }).superRefine((value, context) => {
      if (!value.need && !value.name) context.addIssue({ code: "custom", message: "Pass either `need` or `name`.", path: ["need"] });
    }),
    permissions: ["scene.read"],
    readOnly: true,
  }),
];

const BY_NAME = new Map(TOOLS.map((definition) => [definition.name, definition]));

export function getTool(name: string) {
  return BY_NAME.get(name);
}

/**
 * The tool list sent to the model, as OpenAI-compatible function schemas.
 *
 * Every `parameters` value is guaranteed to be an object-rooted JSON Schema:
 * providers reject a function whose root is an anyOf/union, and the failure
 * arrives as an opaque 400 on the first turn rather than at authoring time.
 */
export function toolCatalogue() {
  return TOOLS.map((definition) => {
    const parameters = z.toJSONSchema(definition.schema, { io: "input" }) as Record<string, unknown>;
    if (parameters.type !== "object") {
      throw new Error(
        `Tool "${definition.name}" produces a ${String(parameters.type ?? "union")}-rooted JSON Schema. ` +
          "Tool parameters must be a single object — express variants with an `action` enum plus superRefine.",
      );
    }
    return {
      type: "function" as const,
      function: { name: definition.name.replace(/\./g, "_"), description: definition.description, parameters },
    };
  });
}

export function canonicalToolName(wireName: string): string {
  if (BY_NAME.has(wireName)) return wireName;
  const dotted = wireName.replace(/_/g, ".");
  if (BY_NAME.has(dotted)) return dotted;
  // "scene_applyPatch" → "scene.applyPatch": only the first underscore is a dot.
  const firstUnderscore = wireName.indexOf("_");
  if (firstUnderscore > 0) {
    const candidate = `${wireName.slice(0, firstUnderscore)}.${wireName.slice(firstUnderscore + 1)}`;
    if (BY_NAME.has(candidate)) return candidate;
  }
  return wireName;
}
