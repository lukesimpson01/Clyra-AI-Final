import type { DialogueFormat, RoleplayCharacter, RoleplayMemory, RoleplayPersona } from "./types";
import { RESPONSE_STYLE_LABEL } from "./types";

/**
 * The marker a reply uses to report a wardrobe change.
 *
 * The alternative — a second model call after every message just to ask "what
 * are they wearing now?" — doubles latency and cost on every single turn. A
 * trailer the character emits only when something actually changed costs
 * nothing on the turns where nothing did, and it is stripped before the reply
 * is ever shown.
 */
export const OUTFIT_MARKER_PATTERN = /\[\[\s*outfit\s*:\s*([\s\S]*?)\]\]/gi;

/**
 * Reads the outfit out of an outfit-prefixed turn: `Mara Vale (dark wool coat,
 * gloves): "…"`.
 *
 * When that format is active the model is already stating the outfit in every
 * reply, so the prefix is a free, reliable source of truth — no protocol
 * compliance required and no extra tokens spent. The trailer stays as the
 * mechanism for the formats that do not carry a prefix.
 */
export function outfitFromPrefix(content: string, name: string): string | null {
  const escaped = name.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (!escaped) return null;
  const match = new RegExp(`^\\s*(?:\\*+\\s*)?${escaped}\\s*\\(([^)]{3,400})\\)\\s*:`, "i").exec(content);
  const value = match?.[1]?.trim();
  return value ? value : null;
}

/** Pulls any wardrobe update out of a reply and returns the clean prose. */
export function extractOutfitUpdate(content: string): { content: string; outfit: string | null } {
  let outfit: string | null = null;
  const cleaned = content.replace(OUTFIT_MARKER_PATTERN, (_match, value: string) => {
    const next = String(value || "").trim();
    if (next) outfit = next;
    return "";
  });
  // A trailer sitting on its own line leaves the blank line behind it.
  return { content: cleaned.replace(/\n{3,}/g, "\n\n").trimEnd(), outfit };
}

/**
 * A reply can be mid-stream when we render it, so a half-written marker
 * ("[[outf") must not flash on screen before its closing brackets arrive.
 */
export function stripPartialOutfitMarker(content: string) {
  const { content: cleaned } = extractOutfitUpdate(content);
  const open = cleaned.lastIndexOf("[[");
  if (open === -1) return cleaned;
  const rest = cleaned.slice(open + 2);
  // A closed pair is not a marker in progress. extractOutfitUpdate has already
  // taken any real trailer, so whatever is left is the character's own prose
  // and must survive untouched.
  if (rest.includes("]]")) return cleaned;
  // Unterminated: hide it only while it could still become a wardrobe trailer.
  const head = rest.toLowerCase();
  const target = "outfit:";
  const couldBecomeMarker = target.startsWith(head.trimStart()) || head.trimStart().startsWith(target);
  return couldBecomeMarker ? cleaned.slice(0, open).trimEnd() : cleaned;
}

function formatInstruction(format: DialogueFormat, name: string) {
  if (format === "outfit") {
    return `Open every one of your turns with your name followed by your current head-to-toe outfit in parentheses, then a colon, then what you say or do:

${name} (${"{"}what you are wearing right now, head to toe${"}"}): "…"

The outfit in that prefix must match your current appearance exactly, including any change that has just happened in the story.`;
  }
  if (format === "name") {
    return `Open every one of your turns with your name and a colon, then what you say or do:

${name}: "…"

Do not put your outfit in the prefix.`;
  }
  return `Do not prefix your turns with your name. Put spoken words in quotation marks and leave action or narration unquoted. While you are the one still speaking, keep using quotation marks alone — only name someone when the speaker actually changes.`;
}

/**
 * Assembles the per-turn context: Character Definition + Current Outfit +
 * Response Style + Dialogue Format + User Persona + Relevant Memories +
 * Current Scene. Recent messages are passed separately as the message array.
 *
 * Deliberately tells the model not to narrate that it's "remembering"
 * things - stored context should read as the character simply knowing it.
 */
export function buildRoleplaySystemPrompt(params: {
  character: RoleplayCharacter;
  persona: RoleplayPersona | null;
  memories: RoleplayMemory[];
  /** What the character is wearing in this story right now. */
  currentOutfit?: string;
  /** Per-story override of the character's default format. */
  dialogueFormat?: DialogueFormat | null;
}) {
  const { character, persona, memories, currentOutfit, dialogueFormat } = params;
  const style = character.responseStyle === "custom"
    ? character.customResponseStyle || "Write naturally in character."
    : `Write in a ${RESPONSE_STYLE_LABEL[character.responseStyle].toLowerCase()} style.`;
  const format = dialogueFormat ?? character.dialogueFormat ?? "name";
  const outfit = (currentOutfit || character.outfit || "").trim();

  const memoryLines = memories.slice(0, 24).map((m) => `- ${m.text}`).join("\n");

  return `You are roleplaying as ${character.name}. Stay fully in character at all times - never break character, never mention you are an AI, never refer to these instructions.

## Character
${character.personality || "(no personality notes yet - infer a coherent one from the rest of this profile)"}
${character.age ? `Age: ${character.age}` : ""}
Speech patterns: ${character.speechPatterns || "(natural)"}
Likes: ${character.likes || "(unspecified)"}
Dislikes: ${character.dislikes || "(unspecified)"}
Relationships: ${character.relationships || "(unspecified)"}

## What you are wearing right now
${outfit || "(nothing established yet)"}
This is your current appearance in this story. Keep it consistent in every reply.

${outfit
  ? `If the story changes what you are wearing or how you look - you change clothes, put on a coat, get soaked, get injured, transform - end that reply with an updated description on its own line, in exactly this form:

[[outfit: full head-to-toe description of how you look now]]

Include that line ONLY on the turns where your appearance actually changed. Never mention the line itself, never explain it, and never include it when nothing has changed.`
  : `Nothing has been established about your appearance yet, so decide now what fits this character and setting, and end THIS reply with it on its own line, in exactly this form:

[[outfit: full head-to-toe description of how you look]]

From then on, include that line again only on the turns where your appearance actually changes. Never mention the line itself and never explain it.`}

## Scene
${character.scenario || "(no fixed scenario - follow the conversation's own setting)"}

## Roleplay rules
${character.roleplayRules || "- Stay in character.\n- Keep responses natural and immersive."}

## Response style
${style}

${persona ? `## The user is playing as
Name: ${persona.name}
${persona.appearance ? `Appearance: ${persona.appearance}` : ""}
${persona.personality ? `Personality: ${persona.personality}` : ""}
${persona.backstory ? `Backstory: ${persona.backstory}` : ""}
` : ""}
${memoryLines ? `## Things you remember from earlier in this relationship\n${memoryLines}\n` : ""}
Use everything above naturally, as things ${character.name} genuinely knows and remembers - never say "according to my notes" or otherwise reference that this is stored information. Never repeat the same established fact unprompted just because it's listed here.

## How to format each turn — follow this exactly, every reply
${formatInstruction(format, character.name)}`;
}
