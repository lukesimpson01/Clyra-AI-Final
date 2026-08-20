import type { RoleplayCharacter } from "../../lib/roleplay/types";

/**
 * The "Enter a world" shelf groups the library into recognisable universes.
 * Membership is derived from a character's own tags/tagline rather than a
 * separate stored field, so worlds populate themselves as the library grows
 * and no migration or extra backend state is needed.
 */
export type RoleplayWorld = {
  id: string;
  label: string;
  /** Lowercase substrings matched against tags + tagline + scenario. */
  match: string[];
  /** Two muted stops for the tile's abstract art - never neon, never a full-bleed gradient behind a portrait. */
  tone: [string, string];
  /** Seeded blob positions keep each tile visually distinct without any imagery. */
  seed: number;
};

export const ROLEPLAY_WORLDS: RoleplayWorld[] = [
  { id: "anime", label: "Anime", match: ["anime", "manga", "shonen", "shoujo", "isekai"], tone: ["#efe7ee", "#e3e6f2"], seed: 1 },
  { id: "games", label: "Games", match: ["game", "gaming", "rpg", "videogame", "video game", "fps", "mmo"], tone: ["#e6e9ef", "#e9e5e0"], seed: 2 },
  { id: "screen", label: "Movies & TV", match: ["movie", "film", "tv", "series", "show", "cinema", "sitcom"], tone: ["#eae8e4", "#e4e7ea"], seed: 3 },
  { id: "fantasy", label: "Fantasy", match: ["fantasy", "magic", "elf", "dragon", "wizard", "medieval", "kingdom"], tone: ["#e7ebe6", "#eae7ef"], seed: 4 },
  { id: "school", label: "School Life", match: ["school", "academy", "student", "college", "university", "classmate"], tone: ["#eceae4", "#e5eaee"], seed: 5 },
  { id: "historical", label: "Historical", match: ["historical", "history", "ancient", "victorian", "roman", "samurai", "western"], tone: ["#ece8e1", "#e6e3dc"], seed: 6 },
  { id: "scifi", label: "Sci-Fi", match: ["sci-fi", "scifi", "science fiction", "space", "cyberpunk", "futuristic", "robot", "alien"], tone: ["#e4e8ee", "#e8e6ee"], seed: 7 },
  { id: "original", label: "Original Worlds", match: ["original", "oc", "custom"], tone: ["#eae9e6", "#e6e8e9"], seed: 8 },
];

function haystack(character: RoleplayCharacter): string {
  return [...character.tags, character.tagline, character.scenario].join(" ").toLowerCase();
}

export function charactersInWorld(characters: RoleplayCharacter[], world: RoleplayWorld): RoleplayCharacter[] {
  const matched = characters.filter((c) => {
    const text = haystack(c);
    return world.match.some((needle) => text.includes(needle));
  });
  // "Original Worlds" is the catch-all for anything that isn't recognisably
  // from an existing universe, not only characters literally tagged "original".
  if (world.id === "original") {
    const claimed = new Set(
      characters
        .filter((c) => ROLEPLAY_WORLDS.some((w) => w.id !== "original" && w.match.some((needle) => haystack(c).includes(needle))))
        .map((c) => c.id),
    );
    const unclaimed = characters.filter((c) => !claimed.has(c.id));
    return Array.from(new Map([...matched, ...unclaimed].map((c) => [c.id, c])).values());
  }
  return matched;
}
