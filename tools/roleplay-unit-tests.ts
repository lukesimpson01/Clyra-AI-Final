import assert from "node:assert/strict";
import {
  buildRoleplaySystemPrompt,
  extractOutfitUpdate,
  outfitFromPrefix,
  stripPartialOutfitMarker,
} from "../src/lib/roleplay/systemPrompt";
import type { RoleplayCharacter, RoleplayPersona } from "../src/lib/roleplay/types";

let assertions = 0;
const check = (condition: unknown, message: string) => {
  assert(condition, message);
  assertions += 1;
};

const character: RoleplayCharacter = {
  id: "mara", name: "Mara Vale", tagline: "", tags: [], age: "34",
  personality: "Guarded, dry.", speechPatterns: "Clipped.", likes: "", dislikes: "",
  relationships: "", scenario: "A rainy office at midnight.", greeting: "",
  roleplayRules: "", outfit: "Dark wool coat, white shirt, leather gloves.",
  responseStyle: "cinematic", customResponseStyle: "", dialogueFormat: "name",
  avatarUrl: "", avatarSourceUrl: "", visibility: "private", favorite: false,
  createdAt: "", updatedAt: "", lastUsedAt: null, generationQuery: null, generationSources: [],
};

const persona: RoleplayPersona = {
  id: "luke", name: "Luke", appearance: "", personality: "", backstory: "",
  isDefault: true, createdAt: "", updatedAt: "",
};

/* ---------------- outfit trailer ---------------- */

const withUpdate = extractOutfitUpdate(
  `She pulls the coat off and drapes it over the chair.\n\n[[outfit: white shirt, sleeves rolled, no coat]]`,
);
check(withUpdate.outfit === "white shirt, sleeves rolled, no coat", "trailer yields the new outfit");
check(!/\[\[/.test(withUpdate.content), "trailer is removed from the prose");
check(withUpdate.content.endsWith("over the chair."), "prose keeps its own ending");

const withoutUpdate = extractOutfitUpdate("She says nothing and lights a cigarette.");
check(withoutUpdate.outfit === null, "a turn with no wardrobe change reports none");
check(withoutUpdate.content === "She says nothing and lights a cigarette.", "prose is untouched");

const caseInsensitive = extractOutfitUpdate("Text.\n[[OUTFIT: soaked through]]");
check(caseInsensitive.outfit === "soaked through", "the marker is case-insensitive");

const multiline = extractOutfitUpdate("Text.\n[[outfit: long coat,\nboots]]");
check(multiline.outfit === "long coat,\nboots", "a wrapped trailer is still captured");

/* A marker still arriving must never flash on screen mid-stream. */
check(stripPartialOutfitMarker("She turns away.\n\n[[outf") === "She turns away.", "a half-written marker is hidden");
check(stripPartialOutfitMarker("She turns away.\n\n[[outfit: dark c") === "She turns away.", "a partially-typed outfit is hidden");
check(stripPartialOutfitMarker("She turns away.") === "She turns away.", "ordinary prose is left alone");
check(
  stripPartialOutfitMarker("He said [[not a marker]] loudly.") === "He said [[not a marker]] loudly.",
  "unrelated double brackets survive",
);

/* ---------------- dialogue formats ---------------- */

const named = buildRoleplaySystemPrompt({ character, persona, memories: [] });
check(named.includes("Mara Vale: "), "name format instructs a name prefix");
check(!named.includes("head-to-toe outfit in parentheses"), "name format does not ask for an outfit prefix");

const outfitFormat = buildRoleplaySystemPrompt({
  character: { ...character, dialogueFormat: "outfit" }, persona, memories: [],
});
check(outfitFormat.includes("head to toe"), "outfit format asks for a head-to-toe prefix");

const quoted = buildRoleplaySystemPrompt({
  character: { ...character, dialogueFormat: "quotes" }, persona, memories: [],
});
check(quoted.includes("Do not prefix your turns with your name"), "quotes format drops the name prefix");
check(quoted.includes("only name someone when the speaker actually changes"), "quotes format explains speaker changes");

/* A story's own choice overrides the character default. */
const overridden = buildRoleplaySystemPrompt({ character, persona, memories: [], dialogueFormat: "quotes" });
check(overridden.includes("Do not prefix your turns with your name"), "per-story format wins over the character default");

/* ---------------- outfit in context ---------------- */

const defaultOutfit = buildRoleplaySystemPrompt({ character, persona, memories: [] });
check(defaultOutfit.includes("Dark wool coat"), "the character's outfit seeds the prompt");

const storyOutfit = buildRoleplaySystemPrompt({
  character, persona, memories: [], currentOutfit: "white shirt, sleeves rolled, no coat",
});
check(storyOutfit.includes("white shirt, sleeves rolled"), "the story's current outfit is used when set");
check(!storyOutfit.includes("Dark wool coat"), "the story's outfit replaces the character default");
check(storyOutfit.includes("[[outfit:"), "the prompt teaches the trailer protocol");
check(storyOutfit.includes("ONLY on the turns where your appearance actually changed"), "the trailer is opt-in per turn");

/* With nothing established, the very first turn has to decide and report an
   appearance — otherwise the "Name with outfit" format has nothing to print. */
const noOutfitYet = buildRoleplaySystemPrompt({
  character: { ...character, outfit: "" }, persona, memories: [],
});
check(noOutfitYet.includes("end THIS reply with it"), "an unestablished outfit is captured on the first turn");
check(noOutfitYet.includes("[[outfit:"), "the first-turn branch still teaches the trailer");

const alreadyDressed = buildRoleplaySystemPrompt({ character, persona, memories: [] });
check(!alreadyDressed.includes("end THIS reply with it"), "an established outfit is not re-reported every turn");
check(alreadyDressed.includes("ONLY on the turns where your appearance actually changed"), "established outfits report only on change");

/* ---------------- outfit read from the prefix ---------------- */

check(
  outfitFromPrefix('Mara Vale (dark wool coat, white shirt, gloves): "Evening."', "Mara Vale")
    === "dark wool coat, white shirt, gloves",
  "an outfit-prefixed turn yields its outfit",
);
check(
  outfitFromPrefix('*Mara Vale (soaked coat, bare head):* "You are late."', "Mara Vale")
    === "soaked coat, bare head",
  "a prefix wrapped in emphasis still parses",
);
check(outfitFromPrefix('Mara Vale: "No outfit here."', "Mara Vale") === null, "a name-only turn yields nothing");
check(outfitFromPrefix('"Just speech."', "Mara Vale") === null, "a quoted turn yields nothing");
check(
  outfitFromPrefix('She said (quietly): "hello"', "Mara Vale") === null,
  "a parenthetical that is not the character's prefix is ignored",
);
check(
  outfitFromPrefix('Mara Vale (dark coat): "Hi"', "Mara O'Vale") === null,
  "a different character's name does not match",
);

/* Formatting is the instruction a model is most likely to drop, so it sits
   last where recency helps rather than buried mid-prompt. */
const ordering = buildRoleplaySystemPrompt({ character, persona, memories: [] });
check(
  ordering.lastIndexOf("How to format each turn") > ordering.lastIndexOf("## Scene"),
  "the format instruction comes after the character context",
);
check(
  ordering.trimEnd().endsWith(`Do not put your outfit in the prefix.`),
  "the format instruction is the last thing the model reads",
);

console.log(`roleplay-unit-tests: ${assertions} assertions passed`);
