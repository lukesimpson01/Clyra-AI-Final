/**
 * The gameplay component library (spec §105, §137).
 *
 * Every entry is a real, runtime-implemented behaviour with a validated
 * schema and defaults. The AI *configures* these; it does not write code for
 * them. Priority order when satisfying a request is: existing component →
 * template → procedural generator → semantic tool → custom code, and this
 * registry is the first rung.
 */
import { z } from "zod";

export interface ComponentDefinition {
  type: string;
  category: "stats" | "combat" | "items" | "interaction" | "world" | "ai" | "movement" | "progression" | "render" | "audio";
  summary: string;
  schema: z.ZodTypeAny;
  /** Components this one needs to work; the validator surfaces gaps. */
  requires?: string[];
}

const define = (definition: ComponentDefinition) => definition;

export const COMPONENTS: ComponentDefinition[] = [
  define({
    type: "Health",
    category: "stats",
    summary: "Hit points with optional regeneration; emits damaged/died events.",
    schema: z.object({ max: z.number().positive().default(100), current: z.number().min(0).optional(), regeneration: z.number().min(0).default(0), invulnerable: z.boolean().default(false) }),
  }),
  define({
    type: "Damage",
    category: "combat",
    summary: "Deals damage on contact or on a triggered hit.",
    schema: z.object({ amount: z.number().positive().default(10), type: z.enum(["physical", "fire", "ice", "poison", "arcane"]).default("physical"), onContact: z.boolean().default(false) }),
  }),
  define({
    type: "Melee",
    category: "combat",
    summary: "A close-range attack with damage, reach and cooldown.",
    schema: z.object({ damage: z.number().positive().default(15), range: z.number().positive().default(2.2), cooldown: z.number().positive().default(0.6), arcDegrees: z.number().min(10).max(360).default(110) }),
  }),
  define({
    type: "Weapon",
    category: "combat",
    summary: "An equippable weapon definition.",
    schema: z.object({ name: z.string().default("Sword"), damage: z.number().positive().default(15), speed: z.number().positive().default(1), twoHanded: z.boolean().default(false), projectile: z.string().optional() }),
  }),
  define({
    type: "Projectile",
    category: "combat",
    summary: "A travelling projectile with speed, gravity and lifetime.",
    schema: z.object({ speed: z.number().positive().default(24), gravity: z.number().default(9.8), lifetime: z.number().positive().default(6), damage: z.number().positive().default(10) }),
  }),
  define({
    type: "Inventory",
    category: "items",
    summary: "Slot-based item storage.",
    schema: z.object({ slots: z.number().int().min(1).max(120).default(20), items: z.array(z.object({ item: z.string(), count: z.number().int().positive() })).default([]) }),
  }),
  define({
    type: "Hotbar",
    category: "items",
    summary: "Quick-select bar bound to the number keys.",
    schema: z.object({ slots: z.number().int().min(1).max(12).default(9), items: z.array(z.union([z.string(), z.number()])).default([]) }),
  }),
  define({
    type: "Item",
    category: "items",
    summary: "Marks an entity as a pickup-able item stack.",
    schema: z.object({ item: z.string(), count: z.number().int().positive().default(1), stackable: z.boolean().default(true) }),
  }),
  define({
    type: "Equipment",
    category: "items",
    summary: "Equipped slots (head, body, mainHand, offHand).",
    schema: z.object({ slots: z.record(z.string(), z.string().nullable()).default({}) }),
    requires: ["Inventory"],
  }),
  define({
    type: "Currency",
    category: "items",
    summary: "A named currency balance.",
    schema: z.object({ name: z.string().default("gold"), amount: z.number().int().min(0).default(0) }),
  }),
  define({
    type: "Shop",
    category: "items",
    summary: "Buy/sell interface with stock and markup.",
    schema: z.object({ currency: z.string().default("gold"), markup: z.number().positive().default(1.3), stock: z.array(z.object({ item: z.string(), price: z.number().min(0), count: z.number().int().min(0) })).default([]) }),
    requires: ["Interactable"],
  }),
  define({
    type: "Collectible",
    category: "items",
    summary: "Picked up on contact; emits item_collected.",
    schema: z.object({ item: z.string().default("coin"), value: z.number().default(1), respawnSeconds: z.number().min(0).default(0), color: z.string().optional() }),
  }),
  define({
    type: "Container",
    category: "items",
    summary: "An openable container holding loot.",
    schema: z.object({ opened: z.boolean().default(false), loot: z.array(z.object({ item: z.string(), count: z.number().int().positive() })).default([]), locked: z.boolean().default(false), keyItem: z.string().optional() }),
    requires: ["Interactable"],
  }),
  define({
    type: "Interactable",
    category: "interaction",
    summary: "Responds to the `interact` action within range; shows a prompt.",
    schema: z.object({ prompt: z.string().default("Interact"), action: z.string().default("interact"), range: z.number().positive().default(2.5), once: z.boolean().default(false) }),
  }),
  define({
    type: "Door",
    category: "interaction",
    summary: "A door that swings open, optionally locked behind a key item.",
    schema: z.object({ open: z.boolean().default(false), swingDegrees: z.number().default(95), speed: z.number().positive().default(3), locked: z.boolean().default(false), keyItem: z.string().optional() }),
    requires: ["Interactable"],
  }),
  define({
    type: "Lock",
    category: "interaction",
    summary: "Requires a key item before the attached interaction runs.",
    schema: z.object({ keyItem: z.string(), consumeKey: z.boolean().default(false) }),
  }),
  define({
    type: "Switch",
    category: "interaction",
    summary: "A toggle that emits an event other entities listen for.",
    schema: z.object({ on: z.boolean().default(false), event: z.string().default("switch_toggled"), targets: z.array(z.string()).default([]) }),
    requires: ["Interactable"],
  }),
  define({
    type: "Trigger",
    category: "world",
    summary: "Volume that emits an event when the player enters it.",
    schema: z.object({ event: z.string().default("region_entered"), once: z.boolean().default(false), filterTag: z.string().optional(), color: z.string().optional() }),
  }),
  define({
    type: "Checkpoint",
    category: "progression",
    summary: "Sets the respawn point when reached.",
    schema: z.object({ id: z.string().optional(), autoSave: z.boolean().default(true) }),
  }),
  define({
    type: "Respawn",
    category: "progression",
    summary: "Where an entity returns to on death.",
    schema: z.object({ position: z.tuple([z.number(), z.number(), z.number()]).optional(), delaySeconds: z.number().min(0).default(2) }),
  }),
  define({
    type: "Spawner",
    category: "ai",
    summary: "Spawns entities on a timer or trigger, with a live cap.",
    schema: z.object({ prefab: z.string(), maxAlive: z.number().int().min(1).default(3), intervalSeconds: z.number().positive().default(10), radius: z.number().positive().default(8), startOnLoad: z.boolean().default(true) }),
  }),
  define({
    type: "Behavior",
    category: "ai",
    summary: "Runtime NPC behaviour: wander, guard, patrol, aggressive, ranged, shambler, boss, stationary, patrol2d.",
    schema: z.object({
      behavior: z.enum(["wander", "guard", "patrol", "aggressive", "ranged", "shambler", "boss", "stationary", "player", "patrol2d"]).default("wander"),
      parameters: z.record(z.string(), z.unknown()).default({}),
    }),
  }),
  define({
    type: "Enemy",
    category: "ai",
    summary: "Marks an entity hostile and assigns a faction and XP value.",
    schema: z.object({ faction: z.string().default("hostile"), xp: z.number().int().min(0).default(10), contactDamage: z.number().min(0).default(0) }),
    requires: ["Health"],
  }),
  define({
    type: "NPC",
    category: "ai",
    summary: "A friendly character that can carry dialogue and quests.",
    schema: z.object({ dialogueId: z.string().nullable().default(null), questId: z.string().nullable().default(null), faction: z.string().default("neutral") }),
  }),
  define({
    type: "Quest",
    category: "progression",
    summary: "Attaches a quest definition to a giver.",
    schema: z.object({ questId: z.string(), autoStart: z.boolean().default(false) }),
  }),
  define({
    type: "Dialogue",
    category: "progression",
    summary: "Attaches a dialogue graph to an entity.",
    schema: z.object({ dialogueId: z.string() }),
  }),
  define({
    type: "PlayerController",
    category: "movement",
    summary: "Reusable controller: firstPerson, thirdPerson, topDown, platformer2d, twinStick, vehicle.",
    schema: z.object({
      mode: z.enum(["firstPerson", "thirdPerson", "topDown", "platformer2d", "twinStick", "vehicle"]).default("thirdPerson"),
      moveSpeed: z.number().positive().default(4.5),
      sprintSpeed: z.number().positive().optional(),
      jumpSpeed: z.number().min(0).default(6.2),
      gravity: z.number().default(18),
      turnSpeed: z.number().positive().default(9),
      eyeHeight: z.number().positive().optional(),
      maxJumpTiles: z.number().optional(),
      color: z.string().optional(),
    }),
  }),
  define({
    type: "CharacterBody",
    category: "movement",
    summary: "Capsule body used for movement and collision resolution.",
    schema: z.object({ height: z.number().positive().default(1.8), radius: z.number().positive().default(0.35), mass: z.number().positive().default(75), stepHeight: z.number().min(0).default(0.45) }),
  }),
  define({
    type: "Vehicle",
    category: "movement",
    summary: "Drivable vehicle with acceleration, braking and steering.",
    schema: z.object({ maxSpeed: z.number().positive().default(28), acceleration: z.number().positive().default(9), steering: z.number().positive().default(1.8), seats: z.number().int().min(1).default(1) }),
  }),
  define({
    type: "Collider",
    category: "world",
    summary: "Physics shape; `meshParts` derives it from the procedural mesh.",
    schema: z.object({ shape: z.enum(["box", "sphere", "capsule", "meshParts"]).default("box"), body: z.enum(["static", "dynamic", "kinematic"]).default("static"), size: z.tuple([z.number(), z.number(), z.number()]).optional() }),
  }),
  define({
    type: "ProceduralMesh",
    category: "render",
    summary: "The mesh specification a procedural generator produced.",
    schema: z.object({ spec: z.object({ parts: z.array(z.record(z.string(), z.unknown())) }) }),
  }),
  define({
    type: "Light",
    category: "render",
    summary: "A directional, omni or spot light.",
    schema: z.object({
      type: z.enum(["directional", "omni", "spot"]).default("omni"),
      color: z.string().default("#ffffff"),
      intensity: z.number().min(0).default(1),
      range: z.number().positive().default(10),
      castShadows: z.boolean().default(false),
      offset: z.tuple([z.number(), z.number(), z.number()]).optional(),
    }),
  }),
  define({
    type: "Camera",
    category: "render",
    summary: "A scene camera.",
    schema: z.object({ fov: z.number().min(10).max(140).default(60), near: z.number().positive().default(0.1), far: z.number().positive().default(2000), projection: z.enum(["perspective", "orthographic"]).default("perspective"), follow: z.string().optional() }),
  }),
  define({
    type: "VegetationRegion",
    category: "world",
    summary: "GPU-instanced vegetation scatter; regenerated from its seed.",
    schema: z.object({ seed: z.number().int(), params: z.record(z.string(), z.unknown()), instanceCount: z.number().int().min(0), materials: z.record(z.string(), z.string()), lodDistances: z.array(z.number()).default([40, 120, 300]) }),
  }),
  define({
    type: "RoadSpline",
    category: "world",
    summary: "A road polyline with a width, meshed as a ribbon.",
    schema: z.object({ points: z.array(z.tuple([z.number(), z.number(), z.number()])).min(2), width: z.number().positive(), material: z.string() }),
  }),
  define({
    type: "WaterPlane",
    category: "world",
    summary: "A water surface with a level and material.",
    schema: z.object({ size: z.number().positive(), material: z.string(), level: z.number().default(0) }),
  }),
  define({
    type: "Tilemap",
    category: "world",
    summary: "The 2D tile grid a level is built from.",
    schema: z.object({ width: z.number().int().positive(), height: z.number().int().positive(), tileSize: z.number().positive(), tiles: z.array(z.number().int()), palette: z.record(z.string(), z.string()), materials: z.record(z.string(), z.string()).optional() }),
  }),
  define({
    type: "VoxelInteraction",
    category: "world",
    summary: "Lets the player break and place blocks within reach.",
    schema: z.object({ reach: z.number().positive().default(5), breakEnabled: z.boolean().default(true), placeEnabled: z.boolean().default(true) }),
  }),
  define({
    type: "NavigationHint",
    category: "world",
    summary: "Tells the navmesh builder how to treat this geometry.",
    schema: z.object({ walkable: z.boolean().default(true), cost: z.number().positive().default(1), interior: z.boolean().default(false), obstacles: z.string().optional() }),
  }),
  define({
    type: "AnimationStates",
    category: "render",
    summary: "The animation state set and blend time for a character.",
    schema: z.object({ states: z.array(z.string()).default([]), blendSeconds: z.number().min(0).default(0.2) }),
  }),
  define({
    type: "Saveable",
    category: "progression",
    summary: "Which fields of this entity are written into a save file.",
    schema: z.object({ fields: z.array(z.string()).default(["transform"]) }),
  }),
  define({
    type: "BossBar",
    category: "progression",
    summary: "Shows a boss health bar while this entity is alive.",
    schema: z.object({ title: z.string().default("Boss") }),
    requires: ["Health"],
  }),
  define({
    type: "SoundEmitter",
    category: "audio",
    summary: "Plays a generated or loaded audio cue.",
    schema: z.object({ cue: z.string(), loop: z.boolean().default(false), volume: z.number().min(0).max(1).default(1), range: z.number().positive().default(20) }),
  }),
];

const BY_TYPE = new Map(COMPONENTS.map((component) => [component.type, component]));

export function getComponent(type: string) {
  return BY_TYPE.get(type);
}

export function listComponents(category?: ComponentDefinition["category"]) {
  return COMPONENTS.filter((component) => !category || component.category === category).map(({ type, category: componentCategory, summary, requires }) => ({
    type,
    category: componentCategory,
    summary,
    requires,
  }));
}

export function componentSchema(type: string): unknown {
  const definition = BY_TYPE.get(type);
  return definition ? z.toJSONSchema(definition.schema, { io: "input" }) : undefined;
}

export interface ComponentValidation {
  ok: boolean;
  data?: Record<string, unknown>;
  issues: string[];
  missingRequirements: string[];
}

/** Validate component data, and report requirements the entity lacks. */
export function validateComponent(type: string, data: unknown, presentTypes: string[] = []): ComponentValidation {
  const definition = BY_TYPE.get(type);
  if (!definition) {
    return {
      ok: false,
      issues: [`Unknown component "${type}". Known components: ${COMPONENTS.map((component) => component.type).join(", ")}.`],
      missingRequirements: [],
    };
  }
  const parsed = definition.schema.safeParse(data ?? {});
  const missing = (definition.requires ?? []).filter((requirement) => !presentTypes.includes(requirement));
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.slice(0, 10).map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`),
      missingRequirements: missing,
    };
  }
  return { ok: true, data: parsed.data as Record<string, unknown>, issues: [], missingRequirements: missing };
}
