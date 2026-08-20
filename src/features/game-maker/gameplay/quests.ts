/**
 * Quests, dialogue and UI as data (spec §108–§110, §123).
 *
 * None of these are hard-coded inside generated scripts: they are documents
 * the runtime interprets, so the AI edits a quest by editing data, the
 * validator can check a quest is completable, and every player-facing string
 * carries a localisation key.
 */
import { z } from "zod";

export const QuestStepSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("talk"), target: z.string(), text: z.string().optional() }),
  z.object({ type: z.literal("collect"), item: z.string(), count: z.number().int().positive().default(1) }),
  z.object({ type: z.literal("kill"), target: z.string(), count: z.number().int().positive().default(1) }),
  z.object({ type: z.literal("reach"), region: z.string() }),
  z.object({ type: z.literal("interact"), target: z.string() }),
  z.object({ type: z.literal("return"), target: z.string() }),
  z.object({ type: z.literal("escort"), target: z.string(), region: z.string() }),
]);

export const QuestSchema = z.object({
  id: z.string().min(1),
  titleKey: z.string(),
  title: z.string(),
  descriptionKey: z.string().optional(),
  description: z.string().default(""),
  giver: z.string().optional(),
  steps: z.array(QuestStepSchema).min(1).max(24),
  rewards: z.array(z.object({ item: z.string(), count: z.number().int().positive().default(1) })).default([]),
  xp: z.number().int().min(0).default(0),
  prerequisites: z.array(z.string()).default([]),
  repeatable: z.boolean().default(false),
});

export type Quest = z.infer<typeof QuestSchema>;
export type QuestStep = z.infer<typeof QuestStepSchema>;

export const DialogueNodeSchema = z.object({
  id: z.string().min(1),
  textKey: z.string(),
  text: z.string(),
  speaker: z.string().optional(),
  choices: z
    .array(
      z.object({
        textKey: z.string(),
        text: z.string(),
        next: z.string().nullable().default(null),
        condition: z.object({ variable: z.string(), equals: z.union([z.string(), z.number(), z.boolean()]) }).optional(),
        effects: z
          .array(
            z.union([
              z.object({ kind: z.literal("setVariable"), variable: z.string(), value: z.union([z.string(), z.number(), z.boolean()]) }),
              z.object({ kind: z.literal("startQuest"), questId: z.string() }),
              z.object({ kind: z.literal("completeQuest"), questId: z.string() }),
              z.object({ kind: z.literal("giveItem"), item: z.string(), count: z.number().int().positive().default(1) }),
              z.object({ kind: z.literal("emit"), event: z.string() }),
            ]),
          )
          .default([]),
      }),
    )
    .default([]),
});

export const DialogueSchema = z.object({
  id: z.string().min(1),
  start: z.string(),
  nodes: z.array(DialogueNodeSchema).min(1),
});

export type Dialogue = z.infer<typeof DialogueSchema>;

export interface QuestIssue {
  questId: string;
  message: string;
}

/**
 * Structural check that a quest is completable: every referenced entity/
 * region exists and no prerequisite loop can deadlock it. This is the
 * "system dependencies" check from spec §183.
 */
export function validateQuests(
  quests: Quest[],
  world: { entityIds: Set<string>; entityTags: Set<string>; regionIds: Set<string>; itemIds: Set<string> },
): QuestIssue[] {
  const issues: QuestIssue[] = [];
  const known = new Set(quests.map((quest) => quest.id));
  const resolvesTarget = (target: string) => world.entityIds.has(target) || world.entityTags.has(target);

  for (const quest of quests) {
    for (const prerequisite of quest.prerequisites) {
      if (!known.has(prerequisite)) issues.push({ questId: quest.id, message: `Prerequisite quest "${prerequisite}" does not exist.` });
    }
    if (quest.giver && !resolvesTarget(quest.giver)) {
      issues.push({ questId: quest.id, message: `Quest giver "${quest.giver}" is not an entity or tag in the scene.` });
    }
    for (const [index, step] of quest.steps.entries()) {
      if ((step.type === "talk" || step.type === "kill" || step.type === "interact" || step.type === "return" || step.type === "escort") && !resolvesTarget(step.target)) {
        issues.push({ questId: quest.id, message: `Step ${index + 1} (${step.type}) targets "${step.target}", which is not in the scene.` });
      }
      if ((step.type === "reach" || step.type === "escort") && "region" in step && !world.regionIds.has(step.region)) {
        issues.push({ questId: quest.id, message: `Step ${index + 1} sends the player to region "${step.region}", which does not exist.` });
      }
      if (step.type === "collect" && world.itemIds.size && !world.itemIds.has(step.item)) {
        issues.push({ questId: quest.id, message: `Step ${index + 1} asks for item "${step.item}", which nothing in the world provides.` });
      }
    }
  }

  // Prerequisite cycles.
  const state = new Map<string, 0 | 1 | 2>();
  const byId = new Map(quests.map((quest) => [quest.id, quest]));
  const visit = (id: string, trail: string[]): void => {
    if (state.get(id) === 2) return;
    if (state.get(id) === 1) {
      issues.push({ questId: id, message: `Quest prerequisites form a loop: ${[...trail, id].join(" → ")}. None of these can ever start.` });
      return;
    }
    state.set(id, 1);
    for (const prerequisite of byId.get(id)?.prerequisites ?? []) {
      if (byId.has(prerequisite)) visit(prerequisite, [...trail, id]);
    }
    state.set(id, 2);
  };
  for (const quest of quests) visit(quest.id, []);

  return issues;
}

/* ---------------- UI (spec §110) ---------------- */

export const UI_PRIMITIVES = [
  "MainMenu",
  "PauseMenu",
  "HUD",
  "HealthBar",
  "StaminaBar",
  "Crosshair",
  "QuestTracker",
  "Inventory",
  "Dialogue",
  "Shop",
  "Settings",
  "Minimap",
  "Hotbar",
  "BossBar",
  "Subtitle",
  "InteractPrompt",
] as const;

export type UIPrimitive = (typeof UI_PRIMITIVES)[number];

export const UINodeSchema: z.ZodType<{ id: string; type: string; props: Record<string, unknown>; children: unknown[] }> = z.lazy(() =>
  z.object({
    id: z.string().min(1),
    type: z.enum(UI_PRIMITIVES),
    props: z.record(z.string(), z.unknown()).default({}),
    children: z.array(UINodeSchema).default([]),
  }),
) as never;

/** Which UI a mode needs by default, so generated games are never bare. */
export function defaultScreens(mode: "3d" | "2d" | "voxel"): Record<string, { id: string; type: UIPrimitive; props: Record<string, unknown>; children: never[] }[]> {
  const hud: UIPrimitive[] = mode === "voxel" ? ["HealthBar", "Hotbar", "Crosshair", "InteractPrompt"] : mode === "2d" ? ["HealthBar", "QuestTracker"] : ["HealthBar", "Crosshair", "QuestTracker", "InteractPrompt"];
  return {
    hud: hud.map((type, index) => ({ id: `hud-${index}`, type, props: {}, children: [] as never[] })),
    pause: [{ id: "pause-0", type: "PauseMenu" as UIPrimitive, props: { resumable: true }, children: [] as never[] }],
    main: [{ id: "main-0", type: "MainMenu" as UIPrimitive, props: {}, children: [] as never[] }],
  };
}

/** Localisation keys for every player-facing string (spec §123). */
export function localisationKeys(quests: Quest[], dialogues: Dialogue[]): Record<string, string> {
  const table: Record<string, string> = {};
  for (const quest of quests) {
    table[quest.titleKey] = quest.title;
    if (quest.descriptionKey) table[quest.descriptionKey] = quest.description;
  }
  for (const dialogue of dialogues) {
    for (const node of dialogue.nodes) {
      table[node.textKey] = node.text;
      for (const choice of node.choices) table[choice.textKey] = choice.text;
    }
  }
  return table;
}
