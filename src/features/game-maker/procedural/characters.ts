/**
 * Character generation (spec §101–§103).
 *
 * Works with no AI mesh generation at all: a canonical humanoid rig built
 * from modular parametric parts, plus archetype templates that configure
 * gameplay components. GPU mesh generation, if ever available, replaces the
 * mesh and keeps everything else.
 */
import { z } from "zod";
import type { GeneratorDefinition, GeneratorOutput } from "./generator";
import { dedupeAssets, meshEntityOps } from "./generator";
import type { MeshPart } from "./mesh";
import { part } from "./mesh";
import { Rng } from "./random";
import { materialAsset, type MaterialFamily } from "./materials";

export const ARCHETYPES = [
  "player",
  "villager",
  "merchant",
  "guard",
  "bandit",
  "soldier",
  "mage",
  "zombie",
  "monster",
  "boss",
] as const;

export type CharacterArchetype = (typeof ARCHETYPES)[number];

export const CharacterParamsSchema = z.object({
  archetype: z.enum(ARCHETYPES).default("villager"),
  genderPresentation: z.enum(["female", "male", "neutral"]).default("neutral"),
  name: z.string().max(80).optional(),
  position: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  yaw: z.number().default(0),
  height: z.number().min(0.6).max(6).optional(),
  /** 0 = slight, 1 = heavy. */
  build: z.number().min(0).max(1).default(0.5),
  skinTint: z.string().optional(),
  clothTint: z.string().optional(),
  equipment: z.array(z.string()).max(8).default([]),
  patrolRadius: z.number().min(0).max(200).default(0),
  /** Multiplies the archetype's base health/damage. */
  difficulty: z.number().min(0.1).max(10).default(1),
  dialogueId: z.string().optional(),
  questId: z.string().optional(),
});

export type CharacterParams = z.infer<typeof CharacterParamsSchema>;

interface ArchetypeProfile {
  height: number;
  health: number;
  damage: number;
  speed: number;
  cloth: MaterialFamily;
  clothTint: string;
  skin: string;
  behavior: string;
  hostile: boolean;
  tags: string[];
  equipment: string[];
}

const PROFILES: Record<CharacterArchetype, ArchetypeProfile> = {
  player: { height: 1.8, health: 100, damage: 18, speed: 4.6, cloth: "leather", clothTint: "#4a5a6d", skin: "#c99b78", behavior: "player", hostile: false, tags: ["player"], equipment: [] },
  villager: { height: 1.74, health: 40, damage: 3, speed: 2.2, cloth: "fabric", clothTint: "#8a7a5e", skin: "#c99b78", behavior: "wander", hostile: false, tags: ["npc", "friendly"], equipment: [] },
  merchant: { height: 1.72, health: 45, damage: 3, speed: 1.8, cloth: "fabric", clothTint: "#6d5a8a", skin: "#c08a63", behavior: "stationary", hostile: false, tags: ["npc", "friendly", "merchant"], equipment: ["pouch"] },
  guard: { height: 1.84, health: 90, damage: 14, speed: 2.6, cloth: "iron", clothTint: "#6b737d", skin: "#c99b78", behavior: "guard", hostile: false, tags: ["npc", "guard"], equipment: ["sword", "shield"] },
  bandit: { height: 1.78, health: 70, damage: 16, speed: 3.4, cloth: "leather", clothTint: "#5b4632", skin: "#b98a63", behavior: "aggressive", hostile: true, tags: ["enemy", "bandit"], equipment: ["dagger"] },
  soldier: { height: 1.86, health: 110, damage: 20, speed: 3, cloth: "iron", clothTint: "#5a6470", skin: "#c99b78", behavior: "patrol", hostile: true, tags: ["enemy", "soldier"], equipment: ["sword", "shield"] },
  mage: { height: 1.76, health: 60, damage: 26, speed: 2.4, cloth: "fabric", clothTint: "#3f3a6b", skin: "#d3a884", behavior: "ranged", hostile: true, tags: ["enemy", "caster"], equipment: ["staff"] },
  zombie: { height: 1.72, health: 55, damage: 12, speed: 1.5, cloth: "fabric", clothTint: "#5d6350", skin: "#8fa387", behavior: "shambler", hostile: true, tags: ["enemy", "undead"], equipment: [] },
  monster: { height: 2.4, health: 180, damage: 30, speed: 3.6, cloth: "leather", clothTint: "#4a3b3b", skin: "#6f5a4a", behavior: "aggressive", hostile: true, tags: ["enemy", "monster"], equipment: [] },
  boss: { height: 3.1, health: 600, damage: 45, speed: 3.2, cloth: "iron", clothTint: "#3a2c3a", skin: "#5f4a52", behavior: "boss", hostile: true, tags: ["enemy", "boss"], equipment: ["greatsword"] },
};

/** Canonical humanoid: head, torso, arms, legs — proportional to `height`. */
function humanoidParts(
  height: number,
  build: number,
  materials: { skin: string; cloth: string; metal: string },
  equipment: string[],
  genderPresentation: CharacterParams["genderPresentation"],
): MeshPart[] {
  const unit = height / 1.8;
  const girth = (0.9 + build * 0.5) * unit;
  const legHeight = 0.86 * unit;
  const torsoHeight = 0.62 * unit;
  const headSize = 0.24 * unit;
  const parts: MeshPart[] = [];

  for (const side of [-1, 1]) {
    parts.push(part("capsule", [side * 0.13 * girth, legHeight / 2, 0], [0.19 * girth, legHeight, 0.19 * girth], materials.cloth));
  }
  parts.push(part("capsule", [0, legHeight + torsoHeight / 2, 0], [0.46 * girth, torsoHeight, 0.28 * girth], materials.cloth));
  for (const side of [-1, 1]) {
    parts.push(
      part("capsule", [side * 0.3 * girth, legHeight + torsoHeight * 0.62, 0], [0.15 * girth, 0.62 * unit, 0.15 * girth], materials.skin, {
        rotation: [0, 0, side * 6],
      }),
    );
  }
  parts.push(part("sphere", [0, legHeight + torsoHeight + headSize, 0], [headSize * 2, headSize * 2.15, headSize * 1.95], materials.skin));

  // Visible modular geometry, not a renamed default body. The fallback uses
  // a long-hair/cowl and cloak silhouette for female presentation while
  // retaining the same playable rig and animations.
  if (genderPresentation === "female") {
    parts.push(part("sphere", [0, legHeight + torsoHeight + headSize * 1.02, 0.07 * unit], [headSize * 2.16, headSize * 2.26, headSize * 2.08], materials.cloth, { noCollision: true }));
    parts.push(part("box", [0, legHeight + torsoHeight * 0.45, 0.13 * unit], [0.54 * girth, torsoHeight * 1.16, 0.12 * unit], materials.cloth, { noCollision: true }));
    parts.push(part("capsule", [0, legHeight * 0.76, 0], [0.62 * girth, legHeight * 0.92, 0.3 * girth], materials.cloth, { noCollision: true }));
  }

  // Equipment is modular and additive, never a different character mesh.
  const handY = legHeight + torsoHeight * 0.4;
  if (equipment.includes("sword")) {
    parts.push(part("box", [0.4 * girth, handY + 0.35, 0.08], [0.07, 0.85 * unit, 0.14], materials.metal, { rotation: [0, 0, 10] }));
  }
  if (equipment.includes("greatsword")) {
    parts.push(part("box", [0.45 * girth, handY + 0.6, 0.08], [0.11, 1.5 * unit, 0.2], materials.metal, { rotation: [0, 0, 14] }));
  }
  if (equipment.includes("dagger")) {
    parts.push(part("box", [0.36 * girth, handY, 0.08], [0.05, 0.36 * unit, 0.1], materials.metal));
  }
  if (equipment.includes("staff")) {
    parts.push(part("cylinder", [0.4 * girth, handY + 0.5, 0], [0.07, 1.7 * unit, 0.07], materials.cloth));
    parts.push(part("sphere", [0.4 * girth, handY + 1.35 * unit, 0], [0.2, 0.2, 0.2], materials.metal, { noCollision: true }));
  }
  if (equipment.includes("shield")) {
    parts.push(part("box", [-0.4 * girth, handY + 0.2, 0.05], [0.09, 0.7 * unit, 0.5 * unit], materials.metal));
  }
  if (equipment.includes("pouch")) {
    parts.push(part("box", [0.24 * girth, legHeight + 0.1, 0.18], [0.22, 0.24, 0.16], materials.cloth));
  }
  return parts;
}

export const characterGenerator: GeneratorDefinition<typeof CharacterParamsSchema> = {
  name: "character",
  version: 3,
  summary: "One character from an archetype template — modular humanoid mesh, equipment, health/combat components, behaviour and animation states.",
  modes: ["3d"],
  schema: CharacterParamsSchema,
  run(context, params, seed) {
    const rng = new Rng(seed);
    const profile = PROFILES[params.archetype];
    const height = params.height ?? profile.height * rng.range(0.94, 1.06);
    const equipment = params.equipment.length ? params.equipment : profile.equipment;

    const skinAsset = materialAsset("Skin", { family: "skin", seed, tint: params.skinTint ?? profile.skin, tintStrength: 0.85 });
    const clothAsset = materialAsset("Clothing", { family: profile.cloth, seed: seed + 1, tint: params.clothTint ?? profile.clothTint, tintStrength: 0.7 });
    const metalAsset = materialAsset("Equipment metal", { family: "iron", seed: seed + 2 });

    const spec = { parts: humanoidParts(height, params.build, { skin: skinAsset.id, cloth: clothAsset.id, metal: metalAsset.id }, equipment, params.genderPresentation) };
    const id = context.nextId(params.archetype);
    const name = params.name ?? `${params.archetype[0]!.toUpperCase()}${params.archetype.slice(1)}`;

    const operations = meshEntityOps({
      id,
      name,
      type: params.archetype === "player" ? "player" : profile.hostile ? "enemy" : "npc",
      position: params.position as [number, number, number],
      yaw: params.yaw,
      spec,
      tags: [...profile.tags, params.archetype],
      generator: { generator: "character", seed, parameters: params as unknown as Record<string, unknown>, version: 3 },
      collision: "none",
    });

    operations.push(
      { op: "setComponent", entityId: id, component: "Health", data: { max: Math.round(profile.health * params.difficulty), current: Math.round(profile.health * params.difficulty), regeneration: params.archetype === "player" ? 1 : 0 } },
      { op: "setComponent", entityId: id, component: "CharacterBody", data: { height, radius: 0.32 + params.build * 0.12, mass: 60 + params.build * 35 } },
      {
        op: "setComponent",
        entityId: id,
        component: "AnimationStates",
        data: { states: ["idle", "walk", "run", "jump", "fall", "land", "attack", "hit", "death", "interact"], blendSeconds: 0.18 },
      },
      {
        op: "setComponent",
        entityId: id,
        component: "AvatarIdentity",
        data: { role: params.archetype === "player" ? "player" : "character", genderPresentation: params.genderPresentation, visualPipeline: "modular-procedural-humanoid" },
      },
    );

    if (params.archetype === "player") {
      operations.push(
        { op: "setComponent", entityId: id, component: "PlayerController", data: { mode: "thirdPerson", moveSpeed: profile.speed, sprintSpeed: profile.speed * 1.7, jumpSpeed: 6.4, turnSpeed: 9 } },
        { op: "setComponent", entityId: id, component: "Inventory", data: { slots: 20, items: [] } },
        { op: "setComponent", entityId: id, component: "Melee", data: { damage: Math.round(profile.damage * params.difficulty), range: 2.2, cooldown: 0.55 } },
        { op: "setComponent", entityId: id, component: "Saveable", data: { fields: ["transform", "Health", "Inventory"] } },
        { op: "setTags", entityId: id, tags: ["player", "player-spawn"] },
      );
    } else {
      operations.push({
        op: "setComponent",
        entityId: id,
        component: "Behavior",
        data: {
          behavior: profile.behavior,
          parameters: {
            patrolRadius: params.patrolRadius || (profile.behavior === "guard" ? 14 : profile.behavior === "patrol" ? 20 : 0),
            detectionRadius: profile.hostile ? 18 + params.difficulty * 4 : 8,
            attackRange: equipment.includes("staff") ? 12 : 2.2,
            movementSpeed: profile.speed,
            aggression: profile.hostile ? 0.7 : 0.1,
          },
        },
      });
      if (profile.hostile) {
        operations.push(
          { op: "setComponent", entityId: id, component: "Enemy", data: { faction: params.archetype === "bandit" ? "bandits" : "hostile", xp: Math.round(10 * params.difficulty * (profile.health / 50)) } },
          { op: "setComponent", entityId: id, component: "Melee", data: { damage: Math.round(profile.damage * params.difficulty), range: equipment.includes("staff") ? 12 : 2.2, cooldown: 1.1 } },
        );
      } else {
        operations.push({ op: "setComponent", entityId: id, component: "NPC", data: { dialogueId: params.dialogueId ?? null, questId: params.questId ?? null } });
        operations.push({ op: "setComponent", entityId: id, component: "Interactable", data: { prompt: `Talk to ${name}`, action: "interact", range: 2.8 } });
      }
      if (params.archetype === "merchant") {
        operations.push({ op: "setComponent", entityId: id, component: "Shop", data: { currency: "gold", markup: 1.35, stock: [] } });
      }
      if (params.archetype === "boss") {
        operations.push({ op: "setComponent", entityId: id, component: "BossBar", data: { title: name } });
      }
    }

    const output: GeneratorOutput = {
      operations,
      assets: dedupeAssets([skinAsset, clothAsset, metalAsset]),
      rootIds: [id],
      description: `${name} (${params.archetype}, ${Math.round(profile.health * params.difficulty)} HP)`,
      warnings: [],
    };
    return output;
  },
};
