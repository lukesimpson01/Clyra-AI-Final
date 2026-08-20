import type { EntityIR, GameProjectIR } from "./types";
import { activeScene } from "./project";

export interface SubstanceIssue {
  severity: "error" | "warning";
  code: string;
  message: string;
  entityId?: string;
}

export interface ProjectSubstanceReport {
  valid: boolean;
  mode: GameProjectIR["runtime"]["mode"];
  counts: Record<string, number>;
  issues: SubstanceIssue[];
}

export interface RuntimeCompletionEvidence {
  runtimeBooted: boolean;
  smokeTestPassed: boolean;
  noCriticalRuntimeErrors: boolean;
}

export interface GameCompletionGate {
  projectValid: boolean;
  hasPlayableRuntime: boolean;
  hasPlayer: boolean;
  hasGameplay: boolean;
  hasMeaningfulScene: boolean;
  hasObjective: boolean;
  runtimeBooted: boolean;
  noCriticalRuntimeErrors: boolean;
  smokeTestPassed: boolean;
  complete: boolean;
  missing: string[];
}

function component(entity: EntityIR, type: string) {
  return entity.components.find((entry) => entry.type === type && entry.enabled !== false);
}

function uiTypes(project: GameProjectIR) {
  const types = new Set<string>();
  const walk = (node: { type: string; children?: unknown[] }) => {
    types.add(node.type);
    for (const child of node.children ?? []) walk(child as { type: string; children?: unknown[] });
  };
  for (const screen of Object.values(project.ui.screens)) walk(screen);
  return types;
}

/**
 * Rejects scenes that are structurally valid but not meaningfully playable.
 * This intentionally does not claim that behavior works; runtime evidence is
 * required separately by evaluateGameCompletionGate().
 */
export function validateProjectSubstance(project: GameProjectIR): ProjectSubstanceReport {
  const scene = activeScene(project);
  const entities = Object.values(scene.entities);
  const players = entities.filter((entity) => entity.tags.includes("player") && Boolean(component(entity, "PlayerController")));
  const enemies = entities.filter((entity) => entity.tags.includes("enemy") && Boolean(component(entity, "Enemy")) && Boolean(component(entity, "Behavior")));
  const friendlies = entities.filter((entity) => entity.tags.includes("friendly") && Boolean(component(entity, "NPC")) && Boolean(component(entity, "Interactable")));
  const interactables = entities.filter((entity) => Boolean(component(entity, "Interactable") || component(entity, "Door") || component(entity, "Container")));
  const collectibles = entities.filter((entity) => Boolean(component(entity, "Collectible")));
  const objectives = entities.filter((entity) => entity.tags.includes("goal") || Boolean(component(entity, "Trigger")));
  const quests = ((project.systems.find((system) => system.type === "quests")?.config.quests as unknown[] | undefined) ?? []).length;
  const colliders = entities.filter((entity) => entity.tags.includes("ground") || Boolean(component(entity, "Collider") || component(entity, "Tilemap") || component(entity, "ProceduralMesh")));
  const worldObjects = entities.filter((entity) => !["player", "camera", "light", "playerSpawn"].includes(entity.type));
  const ui = uiTypes(project);
  const issues: SubstanceIssue[] = [];
  const require = (condition: boolean, code: string, message: string) => {
    if (!condition) issues.push({ severity: "error", code, message });
  };

  require(players.length >= 1, "PROJECT_NOT_PLAYABLE", "Missing a player with a PlayerController.");
  require(ui.has("HealthBar") || ui.has("HUD"), "MISSING_HUD", "Missing a gameplay HUD/health display.");
  require(ui.has("PauseMenu"), "MISSING_PAUSE_UI", "Missing a pause screen.");

  if (project.runtime.mode === "2d") {
    const tilemaps = entities.filter((entity) => Boolean(component(entity, "Tilemap")));
    const tilemapData = tilemaps.flatMap((entity) => component(entity, "Tilemap")?.data.tiles as number[] | undefined ?? []);
    // Tile 3 is the canonical hazard value. Entity-based hazards are allowed too.
    const hazards = entities.filter((entity) => entity.tags.includes("hazard") || Boolean(component(entity, "Hazard"))).length + tilemapData.filter((tile) => tile === 3).length;
    require(tilemaps.length >= 1, "MISSING_LEVEL", "Missing traversable 2D level geometry.");
    require(colliders.length >= 1, "MISSING_COLLISION", "Missing 2D collision surfaces.");
    require(enemies.length >= 2, "MISSING_ENEMIES", `Need at least 2 functioning enemies; found ${enemies.length}.`);
    require(collectibles.length >= 1, "MISSING_COLLECTIBLE", "Missing a collectible with collectible state.");
    require(hazards >= 1, "MISSING_HAZARD", "Missing a damaging hazard.");
    require(objectives.length >= 1 || quests >= 1, "MISSING_OBJECTIVE", "Missing a finish trigger or objective.");
  } else if (project.runtime.mode === "3d") {
    const structures = entities.filter((entity) => entity.tags.some((tag) => ["building", "structure", "landmark", "ruin"].includes(tag)));
    require(Boolean(scene.terrain) || worldObjects.length >= 8, "MISSING_3D_WORLD", "The 3D scene is only infrastructure; add meaningful environment geometry.");
    require(worldObjects.length >= 8, "INSUFFICIENT_WORLD_CONTENT", `Need a meaningful 3D world; found ${worldObjects.length} world objects.`);
    require(structures.length >= 2, "MISSING_STRUCTURES", `Need at least 2 structures/landmarks; found ${structures.length}.`);
    require(enemies.length >= 2, "MISSING_ENEMIES", `Need at least 2 functioning enemies; found ${enemies.length}.`);
    require(friendlies.length >= 1, "MISSING_FRIENDLY_NPC", "Missing a friendly interactive NPC.");
    require(interactables.length >= 1, "MISSING_INTERACTION", "Missing an interactable door, chest, or object.");
    require(objectives.length >= 1 || quests >= 1, "MISSING_OBJECTIVE", "Missing a structured objective or quest.");
    require(Boolean(scene.navigation?.builtAt), "MISSING_NAVIGATION", "Navigation has not been built.");
  }

  return {
    valid: !issues.some((issue) => issue.severity === "error"),
    mode: project.runtime.mode,
    counts: {
      entities: entities.length,
      players: players.length,
      enemies: enemies.length,
      friendlies: friendlies.length,
      interactables: interactables.length,
      collectibles: collectibles.length,
      objectives: objectives.length + quests,
      worldObjects: worldObjects.length,
    },
    issues,
  };
}

export function evaluateGameCompletionGate(
  project: GameProjectIR,
  projectValid: boolean,
  evidence: Partial<RuntimeCompletionEvidence> = {},
): GameCompletionGate {
  const report = validateProjectSubstance(project);
  const scene = activeScene(project);
  const entities = Object.values(scene.entities);
  const hasPlayer = report.counts.players > 0;
  const hasObjective = report.counts.objectives > 0;
  const hasGameplay = entities.some((entity) => entity.components.some((entry) => ["Enemy", "Collectible", "Interactable", "Quest", "Trigger"].includes(entry.type)));
  const hasMeaningfulScene = report.valid;
  const runtimeBooted = evidence.runtimeBooted === true;
  const smokeTestPassed = evidence.smokeTestPassed === true;
  const noCriticalRuntimeErrors = evidence.noCriticalRuntimeErrors === true;
  const hasPlayableRuntime = runtimeBooted && smokeTestPassed && noCriticalRuntimeErrors;
  const missing: string[] = [];
  if (!projectValid) missing.push("project validation");
  if (!hasPlayer) missing.push("player");
  if (!hasGameplay) missing.push("gameplay");
  if (!hasMeaningfulScene) missing.push(...report.issues.map((issue) => issue.message));
  if (!hasObjective) missing.push("objective");
  if (!runtimeBooted) missing.push("runtime boot evidence");
  if (!smokeTestPassed) missing.push("passing smoke test");
  if (!noCriticalRuntimeErrors) missing.push("zero critical runtime errors");
  return {
    projectValid,
    hasPlayableRuntime,
    hasPlayer,
    hasGameplay,
    hasMeaningfulScene,
    hasObjective,
    runtimeBooted,
    noCriticalRuntimeErrors,
    smokeTestPassed,
    complete: missing.length === 0,
    missing: [...new Set(missing)],
  };
}
