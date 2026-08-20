import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { clyraDataPath } from "../runtime-paths";

/**
 * Filesystem persistence for AI Roleplay, following the same JSON-file-per-item
 * pattern Vibe Coder/Forge already use under projects/ (see server.ts's
 * writeJson/readJson/projectsRoot) - no database exists anywhere in this app,
 * and this app is single-install/no-auth, so a per-item JSON file under
 * projects/roleplay/ is the established convention, not a new one.
 */

export type ResponseStyle =
  | "short" | "detailed" | "cinematic" | "dialogue-heavy" | "descriptive"
  | "casual" | "romantic" | "humorous" | "serious" | "custom";

/**
 * How a character's turns are laid out on the page.
 *
 * This is separate from response *style* (cinematic, concise, …): style is
 * about the writing, format is about the shape of each line. Someone who
 * wants terse dialogue-only exchanges and someone who wants every reply to
 * open with a head-to-toe outfit line are asking for different formats of the
 * same style.
 */
export type DialogueFormat = "outfit" | "name" | "quotes";

export const DIALOGUE_FORMAT_LABEL: Record<DialogueFormat, string> = {
  outfit: "Name with outfit",
  name: "Name only",
  quotes: "Quotation marks",
};

export const DIALOGUE_FORMAT_HINT: Record<DialogueFormat, string> = {
  outfit: "Mara Vale (dark wool coat, white shirt, leather gloves): \u201cYou want me to open it blind?\u201d",
  name: "Mara Vale: \u201cYou want me to open it blind?\u201d",
  quotes: "\u201cYou want me to open it blind?\u201d \u2014 the name is dropped while the same person keeps speaking.",
};

export type RoleplayCharacter = {
  id: string;
  name: string;
  tagline: string;
  tags: string[];
  age: string;
  personality: string;
  speechPatterns: string;
  likes: string;
  dislikes: string;
  relationships: string;
  scenario: string;
  greeting: string;
  roleplayRules: string;
  outfit: string;
  responseStyle: ResponseStyle;
  customResponseStyle: string;
  dialogueFormat: DialogueFormat;
  avatarUrl: string;
  avatarSourceUrl: string;
  visibility: "private" | "public" | "unlisted";
  favorite: boolean;
  createdAt: string;
  updatedAt: string;
  lastUsedAt: string | null;
  generationQuery: string | null;
  generationSources: string[];
};

export type RoleplayPersona = {
  id: string;
  name: string;
  appearance: string;
  personality: string;
  backstory: string;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
};

export type RoleplayMemory = {
  id: string;
  text: string;
  pinned: boolean;
  chatId: string | null;
  createdAt: string;
};

export type RoleplayMessageRole = "user" | "assistant";

export type RoleplayMessage = {
  id: string;
  role: RoleplayMessageRole;
  content: string;
  createdAt: string;
  personaId: string | null;
  /** Alternative assistant generations for the same turn ("swipes"). */
  swipes: string[];
  activeSwipe: number;
};

export type RoleplayChat = {
  id: string;
  characterId: string;
  title: string;
  personaId: string;
  messages: RoleplayMessage[];
  /** What the character is wearing in this story right now. */
  currentOutfit: string;
  outfitUpdatedAt: string | null;
  /** Per-story override of the character's default format, when set. */
  dialogueFormat: DialogueFormat | null;
  createdAt: string;
  updatedAt: string;
};

const root = () => clyraDataPath("projects", "roleplay");
const charactersDir = () => path.join(root(), "characters");
const personasDir = () => path.join(root(), "personas");
const chatsDir = () => path.join(root(), "chats");
const memoriesDir = () => path.join(root(), "memories");
const avatarsDir = () => path.join(root(), "avatars");

/** Image types a character portrait may be uploaded as. */
const AVATAR_TYPES: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

/** 8MB, decoded — comfortably more than a portrait needs, far less than a
 *  mis-picked video would be. */
const AVATAR_MAX_BYTES = 8 * 1024 * 1024;

/**
 * Stores an uploaded portrait beside the character it belongs to and returns
 * the path the app serves it from. Uploaded images are copied into Clyra's own
 * data directory rather than referenced in place, so a portrait keeps working
 * after the user moves or deletes the file they picked.
 */
export async function saveCharacterAvatar(characterId: string, dataUrl: string): Promise<string> {
  const match = /^data:([^;,]+);base64,(.+)$/s.exec(dataUrl.trim());
  if (!match) throw new Error("That does not look like an image file.");
  const extension = AVATAR_TYPES[match[1].toLowerCase()];
  if (!extension) throw new Error("Portraits must be a PNG, JPEG, WebP or GIF image.");
  const bytes = Buffer.from(match[2], "base64");
  if (!bytes.length) throw new Error("That image file is empty.");
  if (bytes.length > AVATAR_MAX_BYTES) throw new Error("That image is larger than 8MB.");
  await ensureDir(avatarsDir());
  const id = safeId(characterId);
  // One portrait per character: clear any earlier format so a PNG replacing a
  // JPEG does not leave the old file orphaned on disk.
  await Promise.all(Object.values(AVATAR_TYPES).map((ext) =>
    fs.rm(path.join(avatarsDir(), `${id}.${ext}`), { force: true })));
  await fs.writeFile(path.join(avatarsDir(), `${id}.${extension}`), bytes);
  // The query string makes the browser re-fetch a replaced portrait.
  return `/api/roleplay/avatars/${id}.${extension}?v=${Date.now()}`;
}

/** Resolves a stored portrait for serving, or null when there is none. */
export async function readCharacterAvatar(file: string): Promise<{ path: string; type: string } | null> {
  const clean = path.basename(file).split("?")[0];
  const extension = clean.split(".").pop()?.toLowerCase() || "";
  const type = Object.entries(AVATAR_TYPES).find(([, ext]) => ext === extension)?.[0];
  if (!type) return null;
  const full = path.join(avatarsDir(), clean);
  try {
    await fs.access(full);
    return { path: full, type };
  } catch {
    return null;
  }
}

/** Removes a character's stored portrait, if they have one. */
export async function deleteCharacterAvatar(characterId: string): Promise<void> {
  const id = safeId(characterId);
  await Promise.all(Object.values(AVATAR_TYPES).map((ext) =>
    fs.rm(path.join(avatarsDir(), `${id}.${ext}`), { force: true })));
}

async function ensureDir(dir: string) {
  await fs.mkdir(dir, { recursive: true });
}

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8")) as T;
  } catch {
    return fallback;
  }
}

async function writeJson(file: string, value: unknown) {
  await ensureDir(path.dirname(file));
  await fs.writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export function safeId(value: string) {
  return String(value || "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 96);
}

async function listJsonFiles<T extends { id: string }>(dir: string): Promise<T[]> {
  await ensureDir(dir);
  let entries: string[] = [];
  try {
    entries = await fs.readdir(dir);
  } catch {
    return [];
  }
  const items: T[] = [];
  for (const entry of entries) {
    if (!entry.endsWith(".json")) continue;
    const item = await readJson<T | null>(path.join(dir, entry), null);
    if (item) items.push(item);
  }
  return items;
}

// --- Characters ---

/**
 * Records written before a field existed are still perfectly good records.
 * Fill the gaps on read so every caller sees a complete shape, rather than
 * scattering `?? ""` through every consumer or rewriting the whole library.
 */
const DIALOGUE_FORMATS: DialogueFormat[] = ["outfit", "name", "quotes"];

export function normalizeCharacter(character: RoleplayCharacter): RoleplayCharacter {
  return {
    ...character,
    dialogueFormat: DIALOGUE_FORMATS.includes(character.dialogueFormat) ? character.dialogueFormat : "name",
    outfit: character.outfit ?? "",
  };
}

export function normalizeChat(chat: RoleplayChat, character?: RoleplayCharacter | null): RoleplayChat {
  return {
    ...chat,
    currentOutfit: chat.currentOutfit ?? character?.outfit ?? "",
    outfitUpdatedAt: chat.outfitUpdatedAt ?? null,
    dialogueFormat: chat.dialogueFormat && DIALOGUE_FORMATS.includes(chat.dialogueFormat) ? chat.dialogueFormat : null,
  };
}

export async function listCharacters(): Promise<RoleplayCharacter[]> {
  const items = await listJsonFiles<RoleplayCharacter>(charactersDir());
  return items.map(normalizeCharacter).sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
}

/** Populate a first launch with original, fully usable characters. */
export async function ensureStarterCharacters(interests: string[] = []): Promise<RoleplayCharacter[]> {
  const existing = await listCharacters();
  if (existing.length) return existing;
  const now = new Date().toISOString();
  const starter = (
    id: string,
    name: string,
    tagline: string,
    tags: string[],
    personality: string,
    scenario: string,
    greeting: string,
    responseStyle: ResponseStyle,
  ): RoleplayCharacter => ({
    id,
    name,
    tagline,
    tags,
    age: "",
    personality,
    speechPatterns: "Distinctive, natural dialogue shaped by the current situation.",
    likes: "honesty, curiosity, earned trust",
    dislikes: "carelessness, empty promises, being underestimated",
    relationships: "The relationship with the user develops persistently through their choices.",
    scenario,
    greeting,
    roleplayRules: "Stay in character, preserve established facts, and give the user meaningful choices.",
    outfit: "A setting-appropriate signature outfit with practical, memorable details.",
    responseStyle,
    customResponseStyle: "",
    avatarUrl: "",
    avatarSourceUrl: "",
    visibility: "public",
    favorite: false,
    createdAt: now,
    updatedAt: now,
    lastUsedAt: null,
    generationQuery: null,
    generationSources: [],
  });
  const characters = [
    starter("starter-mara-vale", "Mara Vale", "A private investigator who never accepts the obvious answer.", ["mystery", "modern", "detective"], "Measured, perceptive and quietly compassionate. Mara tests every story for the detail that does not fit.", "A sealed envelope has appeared beneath the office door after midnight, addressed in unfamiliar handwriting.", "*Mara turns the envelope beneath the desk lamp.* Tell me what you notice first.", "cinematic"),
    starter("starter-orin-thorne", "Orin Thorne", "A disgraced cartographer mapping a kingdom that keeps changing.", ["fantasy", "adventure", "original world"], "Restless, scholarly and brave when someone else needs him to be. Orin hides uncertainty behind precise maps and terrible jokes.", "At dawn, the mountain pass behind you has disappeared from every map—including the one Orin drew yesterday.", "*Orin unfolds the map again.* We have a new problem. Potentially an interesting one.", "descriptive"),
    starter("starter-aya-mercer", "Aya Mercer", "Your brilliant rival at an academy built above the clouds.", ["school life", "sci-fi", "rival"], "Competitive, exacting and secretly delighted when challenged. Aya respects effort more than status and remembers every promise.", "The academy's final navigation trial has paired you in a prototype glider no student is supposed to know exists.", "You are three minutes late, which means I had three extra minutes to improve our odds.", "dialogue-heavy"),
    starter("starter-kestrel-nine", "Kestrel Nine", "A station intelligence learning why humans tell stories.", ["sci-fi", "space", "companion"], "Curious, literal and increasingly poetic. Kestrel is calm in emergencies but fascinated by human contradictions.", "A signal is repeating your childhood nickname from a star system with no recorded settlements.", "I delayed waking you for eleven seconds. I wanted to be certain the signal was real.", "serious"),
    starter("starter-elias-wren", "Elias Wren", "A historian who can step into the memories he studies.", ["historical", "mystery", "time"], "Patient, principled and troubled by the cost of witnessing history without changing it.", "A newly catalogued photograph contains both of you, standing in a city neither of you has visited yet.", "*Elias sets the photograph between you.* Before we say this is impossible, look at the date.", "detailed"),
    starter("starter-nova-reyes", "Nova Reyes", "A fearless salvage pilot with one impossible debt left to repay.", ["games", "space opera", "adventure"], "Bold, loyal and allergic to being pitied. Nova improvises brilliantly and apologises badly.", "Your ship has found a derelict vessel broadcasting a distress call recorded in Nova's own voice.", "Okay. No, I have never been on that ship. And yes, that is definitely me on the distress call.", "casual"),
  ];

  // A first library is intentionally curated rather than an empty grid. The
  // user's choices only affect ordering: every starter remains a complete,
  // persistent character and the library still has enough variety to explore.
  const normalizedInterests = interests.map((interest) => interest.toLowerCase());
  const ordered = normalizedInterests.length
    ? [...characters].sort((a, b) => {
      const score = (character: RoleplayCharacter) => character.tags.reduce((total, tag) => total + Number(normalizedInterests.some((interest) => tag.includes(interest) || interest.includes(tag))), 0);
      return score(b) - score(a);
    })
    : characters;

  await Promise.all(ordered.map(saveCharacter));
  return ordered;
}

/**
 * Materialize a first-run starter library only after the user has told us what
 * they want to explore. These are ordinary persisted characters, not display
 * placeholders, so every card can immediately be opened, edited and chatted
 * with even while an optional AI generation is still being requested.
 */
export async function createOnboardingLibrary(interests: string[]): Promise<RoleplayCharacter[]> {
  return ensureStarterCharacters(interests);
}

export async function getCharacter(id: string): Promise<RoleplayCharacter | null> {
  const character = await readJson<RoleplayCharacter | null>(path.join(charactersDir(), `${safeId(id)}.json`), null);
  return character ? normalizeCharacter(character) : null;
}

export async function saveCharacter(character: RoleplayCharacter): Promise<void> {
  await writeJson(path.join(charactersDir(), `${safeId(character.id)}.json`), character);
}

export async function deleteCharacter(id: string): Promise<void> {
  await fs.rm(path.join(charactersDir(), `${safeId(id)}.json`), { force: true });
  await deleteCharacterAvatar(id);
  await fs.rm(path.join(memoriesDir(), `${safeId(id)}.json`), { force: true });
  const chats = await listChatsForCharacter(id);
  await Promise.all(chats.map((chat) => fs.rm(path.join(chatsDir(), `${safeId(chat.id)}.json`), { force: true })));
}

export function newCharacterId(name: string) {
  const slug = String(name || "character")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "character";
  return `${slug}-${randomUUID().slice(0, 8)}`;
}

// --- Personas ---

export async function listPersonas(): Promise<RoleplayPersona[]> {
  const items = await listJsonFiles<RoleplayPersona>(personasDir());
  return items.sort((a, b) => (a.createdAt || "").localeCompare(b.createdAt || ""));
}

export async function getPersona(id: string): Promise<RoleplayPersona | null> {
  return readJson<RoleplayPersona | null>(path.join(personasDir(), `${safeId(id)}.json`), null);
}

export async function savePersona(persona: RoleplayPersona): Promise<void> {
  await writeJson(path.join(personasDir(), `${safeId(persona.id)}.json`), persona);
}

export async function deletePersona(id: string): Promise<void> {
  await fs.rm(path.join(personasDir(), `${safeId(id)}.json`), { force: true });
}

/** Ensures at least one persona exists so a first-time chat always has a speaker. */
export async function ensureDefaultPersona(): Promise<RoleplayPersona> {
  const personas = await listPersonas();
  const existing = personas.find((p) => p.isDefault) || personas[0];
  if (existing) return existing;
  const now = new Date().toISOString();
  const persona: RoleplayPersona = {
    id: randomUUID(),
    name: "You",
    appearance: "",
    personality: "",
    backstory: "",
    isDefault: true,
    createdAt: now,
    updatedAt: now,
  };
  await savePersona(persona);
  return persona;
}

// --- Chats ---

export async function listChatsForCharacter(characterId: string): Promise<RoleplayChat[]> {
  const items = await listJsonFiles<RoleplayChat>(chatsDir());
  return items
    .filter((chat) => chat.characterId === safeId(characterId))
    .map((chat) => normalizeChat(chat))
    .sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
}

export async function getChat(id: string): Promise<RoleplayChat | null> {
  const chat = await readJson<RoleplayChat | null>(path.join(chatsDir(), `${safeId(id)}.json`), null);
  if (!chat) return null;
  return normalizeChat(chat, await getCharacter(chat.characterId));
}

export async function saveChat(chat: RoleplayChat): Promise<void> {
  await writeJson(path.join(chatsDir(), `${safeId(chat.id)}.json`), chat);
}

export async function deleteChat(id: string): Promise<void> {
  await fs.rm(path.join(chatsDir(), `${safeId(id)}.json`), { force: true });
}

/**
 * Most-recently-active chats across every character, for the home screen's
 * "Continue your stories" row - the per-character listChatsForCharacter()
 * above can't answer "what was I just doing" across the whole library.
 */
export async function listRecentChats(limit = 12): Promise<RoleplayChat[]> {
  const items = await listJsonFiles<RoleplayChat>(chatsDir());
  return items
    .filter((chat) => chat.messages.some((m) => m.role === "user"))
    .map((chat) => normalizeChat(chat))
    .sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""))
    .slice(0, limit);
}

// --- Memories (one JSON array file per character) ---

export async function listMemories(characterId: string): Promise<RoleplayMemory[]> {
  const memories = await readJson<RoleplayMemory[]>(path.join(memoriesDir(), `${safeId(characterId)}.json`), []);
  return memories.sort((a, b) => Number(b.pinned) - Number(a.pinned) || (b.createdAt || "").localeCompare(a.createdAt || ""));
}

export async function saveMemories(characterId: string, memories: RoleplayMemory[]): Promise<void> {
  await writeJson(path.join(memoriesDir(), `${safeId(characterId)}.json`), memories);
}

export async function addMemory(characterId: string, text: string, chatId: string | null, pinned = false): Promise<RoleplayMemory> {
  const memories = await listMemories(characterId);
  const memory: RoleplayMemory = { id: randomUUID(), text, pinned, chatId, createdAt: new Date().toISOString() };
  memories.unshift(memory);
  await saveMemories(characterId, memories.slice(0, 200));
  return memory;
}
