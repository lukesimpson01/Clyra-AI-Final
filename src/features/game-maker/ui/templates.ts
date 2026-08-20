/**
 * Starting templates (spec §184).
 *
 * A template is *starting architecture* — a controller, a camera, ground,
 * lighting, input — not a canned finished game. Everything a template does
 * is a normal generator call, so the AI can extend it with the same tools.
 */
import type { GameProjectIR, PatchOperation, QualityProfile, RuntimeMode } from "../ir/types";
import { activeScene, createProject, replaceScene } from "../ir/project";
import { applyScenePatch } from "../ir/patch";
import { runGenerator } from "../procedural/registry";
import type { GeneratorContext } from "../procedural/generator";
import { makeHeightSampler } from "../procedural/terrain";
import { defaultScreens } from "../gameplay/quests";
import { materialAsset } from "../procedural/materials";
import { part } from "../procedural/mesh";
import { meshEntityOps } from "../procedural/generator";

export interface GameTemplate {
  id: string;
  name: string;
  description: string;
  mode: RuntimeMode;
  genre: string;
  camera: string;
  coreLoop: string;
  build: (project: GameProjectIR, seed: number) => GameProjectIR;
}

function context(project: GameProjectIR, prefix: string): GeneratorContext {
  const scene = activeScene(project);
  let counter = 0;
  return {
    scene,
    sampleHeight: makeHeightSampler(scene.terrain),
    nextId: (hint: string) => `${hint}-${prefix}-${(counter += 1).toString(36)}`,
  };
}

function apply(project: GameProjectIR, operations: PatchOperation[], assets: Parameters<typeof mergeAssets>[1] = []): GameProjectIR {
  if (!operations.length) return project;
  const scene = activeScene(project);
  const { scene: next } = applyScenePatch(scene, { sceneId: scene.id, operations });
  return { ...replaceScene(project, next), assets: mergeAssets(project, assets) };
}

function mergeAssets(project: GameProjectIR, assets: GameProjectIR["assets"]) {
  const byId = new Map(project.assets.map((asset) => [asset.id, asset]));
  for (const asset of assets) if (!byId.has(asset.id)) byId.set(asset.id, asset);
  return [...byId.values()];
}

function withUi(project: GameProjectIR): GameProjectIR {
  const screens = defaultScreens(project.runtime.mode);
  return {
    ...project,
    ui: {
      screens: Object.fromEntries(
        Object.entries(screens).map(([key, nodes]) => [key, { id: key, type: "Screen", props: {}, children: nodes }]),
      ),
      activeScreen: "hud",
    },
  };
}

/** Flat ground + a sun + a player, the minimum for anything playable. */
function baseWorld(project: GameProjectIR, seed: number, options: { groundSize?: number; playerMode?: "thirdPerson" | "firstPerson" } = {}) {
  const size = options.groundSize ?? 120;
  const groundAsset = materialAsset("Ground", { family: "grass", seed });
  let next = apply(
    project,
    meshEntityOps({
      id: "ground",
      name: "Ground",
      type: "ground",
      position: [0, 0, 0],
      spec: { parts: [part("box", [0, -0.5, 0], [size, 1, size], groundAsset.id)] },
      tags: ["ground", "environment"],
      collision: "static",
    }),
    [groundAsset],
  );

  const player = runGenerator("character", context(next, "player"), { archetype: "player", position: [0, 0, 0] }, seed + 1);
  next = apply(next, player.operations, player.assets);

  if (options.playerMode === "firstPerson") {
    const playerId = player.rootIds[0]!;
    next = apply(next, [{ op: "setComponent", entityId: playerId, component: "PlayerController", data: { mode: "firstPerson", moveSpeed: 5, sprintSpeed: 8, jumpSpeed: 6.5, eyeHeight: 1.65 } }]);
  }
  return next;
}

export const TEMPLATES: GameTemplate[] = [
  {
    id: "empty3d",
    name: "Empty 3D",
    description: "Ground, lighting and a camera. Nothing else — start from a clean world.",
    mode: "3d",
    genre: "sandbox",
    camera: "orbit",
    coreLoop: "build and explore",
    build: (project, seed) => {
      const groundAsset = materialAsset("Ground", { family: "grass", seed });
      return withUi(
        apply(
          project,
          meshEntityOps({ id: "ground", name: "Ground", type: "ground", position: [0, 0, 0], spec: { parts: [part("box", [0, -0.5, 0], [80, 1, 80], groundAsset.id)] }, tags: ["ground"], collision: "static" }),
          [groundAsset],
        ),
      );
    },
  },
  {
    id: "thirdPerson",
    name: "Third person",
    description: "A third-person character with movement, jumping, combat and an inventory on open ground.",
    mode: "3d",
    genre: "adventure",
    camera: "third-person",
    coreLoop: "explore, fight, collect",
    build: (project, seed) => withUi(baseWorld(project, seed)),
  },
  {
    id: "firstPerson",
    name: "First person",
    description: "A first-person controller with mouse look, ready for a shooter or an exploration game.",
    mode: "3d",
    genre: "shooter",
    camera: "first-person",
    coreLoop: "explore, engage, advance",
    build: (project, seed) => withUi(baseWorld(project, seed, { playerMode: "firstPerson" })),
  },
  {
    id: "rpg",
    name: "RPG world",
    description: "Terrain, a village with an inn and a blacksmith, roads, forest, NPCs and a player.",
    mode: "3d",
    genre: "rpg",
    camera: "third-person",
    coreLoop: "explore, talk, quest, fight, upgrade",
    build: (project, seed) => {
      let next = project;
      const terrain = runGenerator("terrain", context(next, "t"), { size: 768, tileSize: 128, maxHeight: 55, mountains: 0.4, rivers: 1, plateauRadius: 100 }, seed);
      next = apply(next, terrain.operations, terrain.assets);

      const village = runGenerator("settlement", context(next, "v"), { center: [0, 0, 0], radius: 70, houses: 8, landmarks: ["inn", "blacksmith", "shop"], npcs: 6 }, seed + 11);
      next = apply(next, village.operations, village.assets);

      const forest = runGenerator("vegetation", context(next, "f"), { center: [0, 0, -180], radius: 120, density: 3, species: ["pine", "bush"], exclusions: [{ center: [0, 0, 0], radius: 95 }] }, seed + 22);
      next = apply(next, forest.operations, forest.assets);

      const player = runGenerator("character", context(next, "p"), { archetype: "player", position: [0, 0, 24] }, seed + 33);
      next = apply(next, player.operations, player.assets);
      return withUi(next);
    },
  },
  {
    id: "survival",
    name: "Survival",
    description: "Wilderness terrain, forest, scattered camps and hostile wildlife with a first-person controller.",
    mode: "3d",
    genre: "survival",
    camera: "first-person",
    coreLoop: "gather, craft, survive",
    build: (project, seed) => {
      let next = project;
      const terrain = runGenerator("terrain", context(next, "t"), { size: 768, tileSize: 128, maxHeight: 70, mountains: 0.55, erosion: 0.4, rivers: 2 }, seed);
      next = apply(next, terrain.operations, terrain.assets);
      const forest = runGenerator("vegetation", context(next, "f"), { center: [0, 0, 0], radius: 260, density: 4, species: ["pine", "oak", "bush", "rock"] }, seed + 5);
      next = apply(next, forest.operations, forest.assets);
      const camp = runGenerator("prop", context(next, "c"), { kind: "campfire", position: [0, 0, 0], count: 1 }, seed + 6);
      next = apply(next, camp.operations, camp.assets);
      const bandits = runGenerator("character", context(next, "b"), { archetype: "bandit", position: [40, 0, 40] }, seed + 7);
      next = apply(next, bandits.operations, bandits.assets);
      const player = runGenerator("character", context(next, "p"), { archetype: "player", position: [0, 0, 6] }, seed + 8);
      next = apply(next, player.operations, player.assets);
      return withUi(apply(next, [{ op: "setComponent", entityId: player.rootIds[0]!, component: "PlayerController", data: { mode: "firstPerson", moveSpeed: 4.6, sprintSpeed: 7.4, jumpSpeed: 6, eyeHeight: 1.65 } }]));
    },
  },
  {
    id: "dungeonCrawler",
    name: "Dungeon crawler",
    description: "A connected dungeon of rooms and corridors with enemies, treasure and a boss chamber.",
    mode: "3d",
    genre: "dungeon crawler",
    camera: "third-person",
    coreLoop: "delve, fight, loot",
    build: (project, seed) => {
      let next = baseWorld(project, seed, { groundSize: 200 });
      const dungeon = runGenerator("dungeon", context(next, "d"), { origin: [0, -14, 40], rooms: 9, enemies: 8, treasure: 4, boss: true }, seed + 3);
      next = apply(next, dungeon.operations, dungeon.assets);
      return withUi(next);
    },
  },
  {
    id: "voxel",
    name: "Voxel sandbox",
    description: "A seeded block world with biomes, caves, ores and trees — break and place blocks with a hotbar.",
    mode: "voxel",
    genre: "sandbox",
    camera: "first-person",
    coreLoop: "mine, build, survive",
    build: (project, seed) => {
      const voxel = runGenerator("voxelWorld", context(project, "vx"), { chunkSize: 32, worldHeight: 96, radius: 2, caves: true, ores: true, trees: 0.4 }, seed);
      return withUi(apply(project, voxel.operations, voxel.assets));
    },
  },
  {
    id: "platformer2d",
    name: "2D platformer",
    description: "A side-scrolling level with platforms, gaps, hazards, enemies, coins and an exit.",
    mode: "2d",
    genre: "platformer",
    camera: "side-scrolling",
    coreLoop: "run, jump, collect, reach the exit",
    build: (project, seed) => {
      const level = runGenerator("tilemap2d", context(project, "lv"), { layout: "platformer", width: 110, height: 30, enemies: 6, collectibles: 14, style: "pixel" }, seed);
      return withUi(apply(project, level.operations, level.assets));
    },
  },
  {
    id: "topdown2d",
    name: "2D top-down",
    description: "A room-based top-down level with walls, enemies, pickups and an exit door.",
    mode: "2d",
    genre: "top-down action",
    camera: "top-down",
    coreLoop: "clear rooms, collect, exit",
    build: (project, seed) => {
      const level = runGenerator("tilemap2d", context(project, "td"), { layout: "topdown", width: 70, height: 48, enemies: 8, collectibles: 10, style: "vector" }, seed);
      return withUi(apply(project, level.operations, level.assets));
    },
  },
  {
    id: "empty2d",
    name: "Empty 2D",
    description: "A bare 2D arena with a player and a floor. Start from nothing.",
    mode: "2d",
    genre: "sandbox",
    camera: "side-scrolling",
    coreLoop: "build and play",
    build: (project, seed) => {
      const level = runGenerator("tilemap2d", context(project, "a"), { layout: "arena", width: 48, height: 28, enemies: 0, collectibles: 0, style: "minimal" }, seed);
      return withUi(apply(project, level.operations, level.assets));
    },
  },
];

export function templateById(id: string) {
  return TEMPLATES.find((template) => template.id === id);
}

/** Pick the template a plain-language prompt is asking for (spec §185). */
export function templateForPrompt(prompt: string, requestedMode?: RuntimeMode): GameTemplate {
  const text = prompt.toLowerCase();
  const wants2d = requestedMode === "2d" || /\b2d|platformer|side.?scroll|pixel art|top.?down\b/.test(text);
  const wantsVoxel = requestedMode === "voxel" || /\bvoxel|minecraft|block.?world|sandbox survival\b/.test(text);

  if (wantsVoxel) return templateById("voxel")!;
  if (wants2d) return /top.?down/.test(text) ? templateById("topdown2d")! : templateById("platformer2d")!;
  if (/\bdungeon|crypt|catacomb|crawler\b/.test(text)) return templateById("dungeonCrawler")!;
  if (/\bsurviv|wilderness|forage|craft\b/.test(text)) return templateById("survival")!;
  if (/\brpg|village|town|quest|npc|fantasy|medieval|kingdom\b/.test(text)) return templateById("rpg")!;
  if (/\bfirst.?person|fps|shooter|horror\b/.test(text)) return templateById("firstPerson")!;
  if (/\bthird.?person|adventure|explore\b/.test(text)) return templateById("thirdPerson")!;
  return templateById("thirdPerson")!;
}

export function projectFromTemplate(template: GameTemplate, options: { name: string; concept: string; seed?: number; profile?: QualityProfile }): GameProjectIR {
  const seed = options.seed ?? Math.floor(Math.random() * 2 ** 28);
  const project = createProject({
    name: options.name,
    concept: options.concept,
    mode: template.mode,
    genre: template.genre,
    camera: template.camera,
    coreLoop: template.coreLoop,
    profile: options.profile,
  });
  const built = template.build(project, seed);
  return {
    ...built,
    memory: {
      entries: [
        {
          id: "seed-decision",
          kind: "decision",
          text: `Started from the "${template.name}" template with seed ${seed}. Genre ${template.genre}, ${template.camera} camera.`,
          tags: ["template", template.id],
          createdAt: Date.now(),
        },
      ],
    },
  };
}
