export type ResponseStyle =
  | "short" | "detailed" | "cinematic" | "dialogue-heavy" | "descriptive"
  | "casual" | "romantic" | "humorous" | "serious" | "custom";

export const RESPONSE_STYLE_LABEL: Record<ResponseStyle, string> = {
  short: "Short", detailed: "Detailed", cinematic: "Cinematic",
  "dialogue-heavy": "Dialogue-heavy", descriptive: "Descriptive", casual: "Casual",
  romantic: "Romantic", humorous: "Humorous", serious: "Serious", custom: "Custom",
};

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

export type RoleplayMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  personaId: string | null;
  swipes: string[];
  activeSwipe: number;
};

export type RoleplayChat = {
  id: string;
  characterId: string;
  title: string;
  personaId: string;
  messages: RoleplayMessage[];
  /**
   * What the character is wearing *in this story right now*.
   *
   * Seeded from the character's default outfit, then kept current as the story
   * changes it. It lives on the chat rather than the character because the
   * same character can be mid-costume-change in one story and in their default
   * clothes in another.
   */
  currentOutfit: string;
  outfitUpdatedAt: string | null;
  /** Per-story override of the character's default format, when set. */
  dialogueFormat: DialogueFormat | null;
  createdAt: string;
  updatedAt: string;
};
