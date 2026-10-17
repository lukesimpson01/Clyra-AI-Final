// Shared Shorts project schema. Pure TypeScript with no runtime dependencies so
// the React editor, the Express routes and the unit tests all import the same
// definitions. Every saved project carries `schemaVersion`; `migrateProject`
// upgrades older files on load so the store never has to guess at a shape.

export const SHORTS_SCHEMA_VERSION = 1;

/** Timing presets. Pace scales every generated timing, so a user can switch pace without regenerating. */
export type Pace = "slow" | "natural" | "fast" | "custom";
const PACES: readonly Pace[] = ["slow", "natural", "fast", "custom"];

export const SHORTS_KINDS = [
  "ai-clip",
  "fake-text",
  "would-rather",
  "reddit-story",
  "narrated-story",
  "quiz",
  "list",
  "gameplay-story",
  "caption-video",
  "cut-crop",
] as const;
export type ShortsKind = (typeof SHORTS_KINDS)[number];

export const SHORTS_ASPECTS = ["9:16", "4:5", "1:1", "16:9"] as const;
export type ShortsAspect = (typeof SHORTS_ASPECTS)[number];

export const SHORTS_RESOLUTIONS = [720, 1080] as const;
export type ShortsResolution = (typeof SHORTS_RESOLUTIONS)[number];

export const SHORTS_FPS_OPTIONS = [24, 25, 30, 50, 60] as const;
export type ShortsFps = (typeof SHORTS_FPS_OPTIONS)[number];

export const SHORTS_MAX_DURATION_MS = 10 * 60 * 1000;
export const SHORTS_TAIL_MS = 900;

export type ItemBase = {
  id: string;
  startMs: number;
  durationMs: number;
};

export type MessageItem = ItemBase & {
  type: "message";
  side: "left" | "right";
  sender: string;
  text: string;
  reaction?: string;
  receipt?: "none" | "delivered" | "read";
  /** Typing-indicator duration immediately before this bubble appears. */
  typingMs: number;
  /** Real synthesized-speech duration inside this item's slot, starting MESSAGE_ENTER_MS after startMs. 0 when this message has no voiced audio (e.g. TTS unavailable). */
  speechMs: number;
  /** Per-message voice override. Empty string means "use the side's default voice". */
  voice?: string;
  /** Project-relative attached image, e.g. "assets/sticker.png". */
  mediaAsset?: string;
};

export type ChoiceItem = ItemBase & {
  type: "choice";
  question: string;
  left: string;
  right: string;
  leftPercent: number;
  /** Always true for generated numbers: they are simulated, never poll data. */
  simulatedPercent: boolean;
  countdownSeconds: number;
};

export type QuizItem = ItemBase & {
  type: "quiz";
  question: string;
  answers: string[];
  correctIndex: number;
  explanation: string;
  countdownSeconds: number;
};

export type ListItem = ItemBase & {
  type: "list-item";
  rank: number;
  total: number;
  title: string;
  body: string;
};

export type StoryItem = ItemBase & {
  type: "story";
  title: string;
  body: string;
  author: string;
  upvotes: number;
  comments: number;
  /** Project-relative attached image, e.g. "assets/author.png". */
  avatar?: string;
  /** Card theme. Defaults to dark (the common Reddit-story-video look). */
  isDark?: boolean;
};

export type TitleItem = ItemBase & {
  type: "title";
  text: string;
  subtitle?: string;
};

export type NarrationItem = ItemBase & {
  type: "narration";
  text: string;
};

export type TimelineItem =
  | MessageItem
  | ChoiceItem
  | QuizItem
  | ListItem
  | StoryItem
  | TitleItem
  | NarrationItem;

export type TimelineItemType = TimelineItem["type"];

export type ShortsBackground =
  | { type: "solid"; color: string }
  | { type: "gradient"; from: string; to: string; angle: number }
  | {
      type: "video";
      /** Project-relative asset path, e.g. "assets/source.mp4". */
      file: string;
      trimStartMs: number;
      /** Source time that maps to the start of the project timeline. */
      speed: number;
      dim: number;
      zoom: number;
      offsetX: number;
      offsetY: number;
      blurPx: number;
      /** Excludes the source video's own audio track from export entirely (gameplay backgrounds default this on so voiced dialogue stays clear). */
      muted: boolean;
    };

export type CaptionAnimation = "none" | "fade" | "pop" | "scale" | "bounce" | "slide" | "highlight" | "karaoke" | "type-on" | "pulse";

export type CaptionStyle = {
  presetId: string;
  font: string;
  weight: number;
  size: number;
  lineHeight: number;
  letterSpacing: number;
  caseMode: "none" | "upper" | "lower" | "title";
  align: "left" | "center" | "right";
  position: "top" | "center" | "bottom";
  offsetPercent: number;
  maxWidthPercent: number;
  wordsPerPage: number;
  color: string;
  activeColor: string;
  emphasisColor: string;
  strokeWidth: number;
  strokeColor: string;
  shadow: boolean;
  box: { enabled: boolean; color: string; opacity: number; radius: number; padding: number; blurPx: number };
  animation: CaptionAnimation;
  animationMs: number;
  intensity: number;
};

export type CaptionWord = {
  text: string;
  startMs: number;
  endMs: number;
  /** Set by the caption intelligence pass, never by guessing at render time. */
  emphasis?: boolean;
};

export type SourceRef = {
  origin: "youtube" | "upload" | "generated";
  url?: string;
  title: string;
  durationMs: number;
  width: number;
  height: number;
  fps: number;
  file?: string;
  sourceStartMs?: number;
  sourceEndMs?: number;
  thumbnail?: string;
};

/** Explainable selection data for AI Clipper results. Score parts are real engine outputs, never a fabricated probability. */
export type ClipMeta = {
  rank: number;
  score: number | null;
  scoreBreakdown: Record<string, number>;
  reason: string;
  caption: string;
  hashtags: string[];
  sourceStart: string;
  sourceEnd: string;
  moment: string;
};

export type ExportRecord = {
  id: string;
  createdAt: string;
  file: string;
  resolution: ShortsResolution;
  fps: ShortsFps;
  aspect: ShortsAspect;
  durationMs: number;
  bytes: number;
};

export type ShortsProject = {
  schemaVersion: typeof SHORTS_SCHEMA_VERSION;
  id: string;
  kind: ShortsKind;
  title: string;
  createdAt: string;
  updatedAt: string;
  aspect: ShortsAspect;
  settings: { resolution: ShortsResolution; fps: ShortsFps };
  background: ShortsBackground;
  items: TimelineItem[];
  captions: { enabled: boolean; style: CaptionStyle; words: CaptionWord[] };
  narration: { enabled: boolean; voice: string; speed: number; volume: number };
  /**
   * Music and SFX reference files by name in the user's local library folders
   * (see lib/shorts/library.ts) — never copied into the project. Removing a
   * file from the folder removes it from every project that referenced it.
   */
  audio: {
    music: { file: string; volume: number; startOffsetMs: number; duckUnderSpeech: boolean; duckAmount: number } | null;
    sfx: Array<{ id: string; file: string; atMs: number; volume: number }>;
  };
  source: SourceRef | null;
  /** Explicit project length. Derived from the timeline when null. */
  durationMs: number | null;
  template: { style: string; accent: string; theme: "light" | "dark"; pace: Pace; paceCustom: number };
  clip: ClipMeta | null;
  /** Normalised crop rectangle for cut-crop projects. Null means the full frame. */
  crop: { x: number; y: number; w: number; h: number } | null;
  /** Fake Text Story's contact/theme/voice config. Present on every project for a stable shape; only read when kind === "fake-text". */
  fakeText: FakeTextConfig;
  exports: ExportRecord[];
};

export type CaptionPreset = { id: string; name: string; style: CaptionStyle; builtin: boolean; isDefault?: boolean };

/** Fake Text Story's own contact/theme/voice configuration. Kept separate from the generic `template`/`narration` fields because this tool's needs (two independent voices, chat geometry) don't apply to any other kind. */
export type FakeTextContact = {
  name: string;
  /** Project-relative avatar image, e.g. "assets/avatar.png". Empty means "use the initial fallback". */
  avatar: string;
};

export type FakeTextChatPosition = "top" | "upper-middle" | "middle" | "custom";

export type FakeTextTheme = {
  style: "imessage-dark" | "imessage-light";
  chatPosition: FakeTextChatPosition;
  /** Vertical position as a percent of canvas height from the top, used only when chatPosition === "custom". */
  chatPositionCustomPercent: number;
  chatWidthPercent: number;
  /** Chat viewport height as a percent of canvas height — how much of the screen the conversation window occupies. */
  chatHeightPercent: number;
  cornerRadius: number;
  bubbleScale: number;
  fontScale: number;
  headerVisible: boolean;
  showAvatar: boolean;
  showContactName: boolean;
  backgroundBlur: boolean;
  chatOpacity: number;
  /** Decorative unread-count badge on the header's back chevron, like a real phone showing other unread threads. 0 hides it — this is video prop chrome, not a real notification, so it defaults off rather than showing a made-up number unasked. */
  headerBadgeCount: number;
};

export type FakeTextTypingDuration = "auto" | "0.5" | "1" | "2" | "custom";

export type FakeTextVoices = {
  contactVoice: string;
  contactSpeed: number;
  contactVolume: number;
  userVoice: string;
  userSpeed: number;
  userVolume: number;
  typingIndicatorEnabled: boolean;
  typingDuration: FakeTextTypingDuration;
  typingDurationCustomMs: number;
  /** Background music ducks under speech same as other tools; gameplay audio is a separate, muted-by-default track controlled on the background itself. */
  gameplayAudioVolume: number;
};

export type FakeTextConfig = {
  contact: FakeTextContact;
  theme: FakeTextTheme;
  voices: FakeTextVoices;
};

export function defaultFakeTextConfig(): FakeTextConfig {
  return {
    contact: { name: "Unknown", avatar: "" },
    theme: {
      style: "imessage-dark",
      chatPosition: "top",
      chatPositionCustomPercent: 8,
      chatWidthPercent: 94,
      chatHeightPercent: 46,
      cornerRadius: 20,
      bubbleScale: 1,
      fontScale: 1,
      headerVisible: true,
      showAvatar: true,
      showContactName: true,
      backgroundBlur: false,
      chatOpacity: 1,
      headerBadgeCount: 0,
    },
    voices: {
      contactVoice: "Aiden",
      contactSpeed: 1,
      contactVolume: 1,
      userVoice: "Max",
      userSpeed: 1,
      userVolume: 1,
      typingIndicatorEnabled: true,
      typingDuration: "auto",
      typingDurationCustomMs: 1000,
      gameplayAudioVolume: 0,
    },
  };
}

export function outputSize(aspect: ShortsAspect, resolution: ShortsResolution) {
  const [w, h] = aspect.split(":").map(Number);
  const even = (value: number) => Math.round(value / 2) * 2;
  if (w < h) return { width: resolution, height: even((resolution * h) / w) };
  if (w > h) return { width: even((resolution * w) / h), height: resolution };
  return { width: resolution, height: resolution };
}

export function defaultCaptionStyle(presetId = "clean"): CaptionStyle {
  return {
    presetId,
    font: "Inter",
    weight: 700,
    size: 54,
    lineHeight: 1.12,
    letterSpacing: 0,
    caseMode: "none",
    align: "center",
    position: "bottom",
    offsetPercent: 14,
    maxWidthPercent: 84,
    wordsPerPage: 4,
    color: "#ffffff",
    activeColor: "#ffd54a",
    emphasisColor: "#ffd54a",
    strokeWidth: 0,
    strokeColor: "#000000",
    shadow: true,
    box: { enabled: false, color: "#000000", opacity: 0.6, radius: 14, padding: 14, blurPx: 0 },
    animation: "none",
    animationMs: 180,
    intensity: 0.5,
  };
}

export function emptyProject(input: {
  id: string;
  kind: ShortsKind;
  title: string;
  now: string;
  aspect?: ShortsAspect;
}): ShortsProject {
  return {
    schemaVersion: SHORTS_SCHEMA_VERSION,
    id: input.id,
    kind: input.kind,
    title: input.title,
    createdAt: input.now,
    updatedAt: input.now,
    aspect: input.aspect ?? "9:16",
    settings: { resolution: 1080, fps: 30 },
    background: { type: "gradient", from: "#0f1116", to: "#1b2030", angle: 160 },
    items: [],
    captions: { enabled: false, style: defaultCaptionStyle(), words: [] },
    narration: { enabled: false, voice: "", speed: 1, volume: 1 },
    audio: { music: null, sfx: [] },
    source: null,
    durationMs: null,
    template: { style: "imessage", accent: "#1e6fff", theme: "light", pace: "natural", paceCustom: 1 },
    clip: null,
    crop: null,
    fakeText: defaultFakeTextConfig(),
    exports: [],
  };
}

export function projectDurationMs(project: Pick<ShortsProject, "items" | "captions" | "durationMs" | "source">): number {
  if (project.durationMs && project.durationMs > 0) return project.durationMs;
  let end = 0;
  for (const item of project.items) end = Math.max(end, item.startMs + item.durationMs);
  for (const word of project.captions.words) end = Math.max(end, word.endMs);
  if (end === 0 && project.source) end = project.source.durationMs;
  return end + SHORTS_TAIL_MS;
}

export function clampProjectDuration(ms: number) {
  return Math.max(1000, Math.min(SHORTS_MAX_DURATION_MS, Math.round(ms)));
}

/**
 * Upgrade any stored project to the current schema. Unknown fields are dropped
 * rather than trusted, so a file from a newer or hand-edited build cannot inject
 * unvalidated values into the renderer or the FFmpeg command line.
 */
export function migrateProject(raw: unknown): ShortsProject {
  if (!raw || typeof raw !== "object") throw new Error("Project file is not an object");
  const record = raw as Record<string, unknown>;
  const version = typeof record.schemaVersion === "number" ? record.schemaVersion : 0;
  if (version > SHORTS_SCHEMA_VERSION) {
    throw new Error(`Project was saved by a newer Shorts version (schema ${version}).`);
  }
  const id = safeId(record.id);
  const kind = (SHORTS_KINDS as readonly string[]).includes(String(record.kind)) ? (record.kind as ShortsKind) : "fake-text";
  const base = emptyProject({ id, kind, title: String(record.title || "Untitled").slice(0, 160), now: String(record.createdAt || new Date().toISOString()) });
  const project: ShortsProject = {
    ...base,
    createdAt: String(record.createdAt || base.createdAt),
    updatedAt: String(record.updatedAt || base.updatedAt),
    aspect: (SHORTS_ASPECTS as readonly string[]).includes(String(record.aspect)) ? (record.aspect as ShortsAspect) : base.aspect,
    settings: normaliseSettings(record.settings),
    background: normaliseBackground(record.background) ?? base.background,
    items: Array.isArray(record.items) ? record.items.filter(isTimelineItem).map(cloneItem) : [],
    captions: normaliseCaptions(record.captions),
    narration: isRecord(record.narration)
      ? { enabled: Boolean(record.narration.enabled), voice: String(record.narration.voice || ""), speed: clampNumber(record.narration.speed, 0.6, 1.6, 1), volume: clampNumber(record.narration.volume, 0, 1.5, 1) }
      : base.narration,
    audio: normaliseAudio(record.audio),
    source: normaliseSource(record.source),
    durationMs: typeof record.durationMs === "number" && record.durationMs > 0 ? clampProjectDuration(record.durationMs) : null,
    template: isRecord(record.template)
      ? {
          style: String(record.template.style || base.template.style),
          accent: /^#[0-9a-f]{6}$/i.test(String(record.template.accent)) ? String(record.template.accent) : base.template.accent,
          theme: record.template.theme === "dark" ? "dark" : "light",
          pace: PACES.includes(record.template.pace) ? (record.template.pace as Pace) : "natural",
          paceCustom: clampNumber(record.template.paceCustom, 0.4, 2.5, 1),
        }
      : base.template,
    clip: normaliseClip(record.clip),
    crop: normaliseCrop(record.crop),
    fakeText: normaliseFakeText(record.fakeText),
    exports: Array.isArray(record.exports) ? record.exports.filter(isRecord).slice(-40).map(normaliseExport) : [],
  };
  return project;
}

const CHAT_POSITIONS: readonly FakeTextChatPosition[] = ["top", "upper-middle", "middle", "custom"];
const TYPING_DURATIONS: readonly FakeTextTypingDuration[] = ["auto", "0.5", "1", "2", "custom"];

function normaliseFakeText(value: unknown): FakeTextConfig {
  const base = defaultFakeTextConfig();
  if (!isRecord(value)) return base;
  const contact = isRecord(value.contact) ? value.contact : {};
  const theme = isRecord(value.theme) ? value.theme : {};
  const voices = isRecord(value.voices) ? value.voices : {};
  return {
    contact: {
      name: String(contact.name || base.contact.name).slice(0, 60),
      avatar: isAssetPath(contact.avatar) ? contact.avatar : "",
    },
    theme: {
      style: theme.style === "imessage-light" ? "imessage-light" : "imessage-dark",
      chatPosition: (CHAT_POSITIONS as readonly string[]).includes(String(theme.chatPosition)) ? (theme.chatPosition as FakeTextChatPosition) : base.theme.chatPosition,
      chatPositionCustomPercent: clampNumber(theme.chatPositionCustomPercent, 0, 70, base.theme.chatPositionCustomPercent),
      chatWidthPercent: clampNumber(theme.chatWidthPercent, 70, 100, base.theme.chatWidthPercent),
      chatHeightPercent: clampNumber(theme.chatHeightPercent, 20, 80, base.theme.chatHeightPercent),
      cornerRadius: clampNumber(theme.cornerRadius, 0, 48, base.theme.cornerRadius),
      bubbleScale: clampNumber(theme.bubbleScale, 0.7, 1.4, base.theme.bubbleScale),
      fontScale: clampNumber(theme.fontScale, 0.7, 1.4, base.theme.fontScale),
      headerVisible: typeof theme.headerVisible === "boolean" ? theme.headerVisible : base.theme.headerVisible,
      showAvatar: typeof theme.showAvatar === "boolean" ? theme.showAvatar : base.theme.showAvatar,
      showContactName: typeof theme.showContactName === "boolean" ? theme.showContactName : base.theme.showContactName,
      backgroundBlur: typeof theme.backgroundBlur === "boolean" ? theme.backgroundBlur : base.theme.backgroundBlur,
      chatOpacity: clampNumber(theme.chatOpacity, 0.4, 1, base.theme.chatOpacity),
      headerBadgeCount: Math.round(clampNumber(theme.headerBadgeCount, 0, 999, base.theme.headerBadgeCount)),
    },
    voices: {
      contactVoice: String(voices.contactVoice || base.voices.contactVoice).slice(0, 40),
      contactSpeed: clampNumber(voices.contactSpeed, 0.6, 1.6, base.voices.contactSpeed),
      contactVolume: clampNumber(voices.contactVolume, 0, 1.5, base.voices.contactVolume),
      userVoice: String(voices.userVoice || base.voices.userVoice).slice(0, 40),
      userSpeed: clampNumber(voices.userSpeed, 0.6, 1.6, base.voices.userSpeed),
      userVolume: clampNumber(voices.userVolume, 0, 1.5, base.voices.userVolume),
      typingIndicatorEnabled: typeof voices.typingIndicatorEnabled === "boolean" ? voices.typingIndicatorEnabled : base.voices.typingIndicatorEnabled,
      typingDuration: (TYPING_DURATIONS as readonly string[]).includes(String(voices.typingDuration)) ? (voices.typingDuration as FakeTextTypingDuration) : base.voices.typingDuration,
      typingDurationCustomMs: clampNumber(voices.typingDurationCustomMs, 200, 4000, base.voices.typingDurationCustomMs),
      gameplayAudioVolume: clampNumber(voices.gameplayAudioVolume, 0, 1.5, base.voices.gameplayAudioVolume),
    },
  };
}

function normaliseCrop(value: unknown): ShortsProject["crop"] {
  if (!isRecord(value)) return null;
  const x = clampNumber(value.x, 0, 1, 0);
  const y = clampNumber(value.y, 0, 1, 0);
  const w = clampNumber(value.w, 0.05, 1, 1);
  const h = clampNumber(value.h, 0.05, 1, 1);
  return { x: Math.min(x, 1 - w), y: Math.min(y, 1 - h), w, h };
}

function normaliseClip(value: unknown): ClipMeta | null {
  if (!isRecord(value)) return null;
  const breakdown: Record<string, number> = {};
  if (isRecord(value.scoreBreakdown)) {
    for (const [key, raw] of Object.entries(value.scoreBreakdown)) {
      const number = Number(raw);
      if (Number.isFinite(number)) breakdown[key.slice(0, 40)] = Math.max(0, Math.min(100, number));
    }
  }
  const score = Number(value.score);
  return {
    rank: Math.max(0, Math.round(Number(value.rank) || 0)),
    score: Number.isFinite(score) ? Math.max(0, Math.min(100, Math.round(score))) : null,
    scoreBreakdown: breakdown,
    reason: String(value.reason || "").slice(0, 1200),
    caption: String(value.caption || "").slice(0, 400),
    hashtags: Array.isArray(value.hashtags) ? value.hashtags.map((tag) => String(tag).slice(0, 40)).slice(0, 12) : [],
    sourceStart: String(value.sourceStart || "").slice(0, 16),
    sourceEnd: String(value.sourceEnd || "").slice(0, 16),
    moment: String(value.moment || "").slice(0, 40),
  };
}

function normaliseExport(record: Record<string, unknown>): ExportRecord {
  return {
    id: safeId(record.id),
    createdAt: String(record.createdAt || ""),
    file: String(record.file || ""),
    resolution: record.resolution === 720 ? 720 : 1080,
    fps: (SHORTS_FPS_OPTIONS as readonly number[]).includes(Number(record.fps)) ? (Number(record.fps) as ShortsFps) : 30,
    aspect: (SHORTS_ASPECTS as readonly string[]).includes(String(record.aspect)) ? (record.aspect as ShortsAspect) : "9:16",
    durationMs: Number(record.durationMs) || 0,
    bytes: Number(record.bytes) || 0,
  };
}

function normaliseSettings(value: unknown): ShortsProject["settings"] {
  if (!isRecord(value)) return { resolution: 1080, fps: 30 };
  return {
    resolution: value.resolution === 720 ? 720 : 1080,
    fps: (SHORTS_FPS_OPTIONS as readonly number[]).includes(Number(value.fps)) ? (Number(value.fps) as ShortsFps) : 30,
  };
}

function normaliseBackground(value: unknown): ShortsBackground | null {
  if (!isRecord(value)) return null;
  if (value.type === "solid" && isColor(value.color)) return { type: "solid", color: value.color };
  if (value.type === "gradient" && isColor(value.from) && isColor(value.to)) {
    return { type: "gradient", from: value.from, to: value.to, angle: clampNumber(value.angle, 0, 360, 160) };
  }
  if (value.type === "video" && isAssetPath(value.file)) {
    return {
      type: "video",
      file: value.file,
      trimStartMs: clampNumber(value.trimStartMs, 0, 24 * 3600 * 1000, 0),
      speed: clampNumber(value.speed, 0.25, 4, 1),
      dim: clampNumber(value.dim, 0, 0.9, 0.25),
      zoom: clampNumber(value.zoom, 1, 3, 1),
      offsetX: clampNumber(value.offsetX, -50, 50, 0),
      offsetY: clampNumber(value.offsetY, -50, 50, 0),
      blurPx: clampNumber(value.blurPx, 0, 40, 0),
      muted: Boolean(value.muted),
    };
  }
  return null;
}

const CAPTION_ANIMATIONS: readonly CaptionAnimation[] = ["none", "fade", "pop", "scale", "bounce", "slide", "highlight", "karaoke", "type-on", "pulse"];
const CASE_MODES = ["none", "upper", "lower", "title"] as const;
const ALIGNS = ["left", "center", "right"] as const;
const POSITIONS = ["top", "center", "bottom"] as const;

/** Validated caption style: unknown keys dropped, every value clamped to a sane range. */
export function normaliseCaptionStyle(value: unknown): CaptionStyle {
  const base = defaultCaptionStyle();
  if (!isRecord(value)) return base;
  const num = (key: keyof CaptionStyle, min: number, max: number) => clampNumber(value[key], min, max, base[key] as number);
  const color = (key: "color" | "activeColor" | "emphasisColor" | "strokeColor") => (isColor(value[key]) ? (value[key] as string) : base[key]);
  const box = isRecord(value.box) ? value.box : {};
  return {
    presetId: String(value.presetId || base.presetId).slice(0, 40),
    font: String(value.font || base.font).replace(/[^A-Za-z0-9 ._-]/g, "").slice(0, 60) || base.font,
    weight: num("weight", 100, 900),
    size: num("size", 20, 120),
    lineHeight: num("lineHeight", 0.8, 2),
    letterSpacing: num("letterSpacing", -4, 20),
    caseMode: (CASE_MODES as readonly string[]).includes(String(value.caseMode)) ? (value.caseMode as CaptionStyle["caseMode"]) : base.caseMode,
    align: (ALIGNS as readonly string[]).includes(String(value.align)) ? (value.align as CaptionStyle["align"]) : base.align,
    position: (POSITIONS as readonly string[]).includes(String(value.position)) ? (value.position as CaptionStyle["position"]) : base.position,
    offsetPercent: num("offsetPercent", 0, 60),
    maxWidthPercent: num("maxWidthPercent", 40, 100),
    wordsPerPage: num("wordsPerPage", 1, 12),
    color: color("color"),
    activeColor: color("activeColor"),
    emphasisColor: color("emphasisColor"),
    strokeWidth: num("strokeWidth", 0, 12),
    strokeColor: color("strokeColor"),
    shadow: typeof value.shadow === "boolean" ? value.shadow : base.shadow,
    box: {
      enabled: Boolean(box.enabled),
      color: isColor(box.color) ? box.color : base.box.color,
      opacity: clampNumber(box.opacity, 0, 1, base.box.opacity),
      radius: clampNumber(box.radius, 0, 80, base.box.radius),
      padding: clampNumber(box.padding, 0, 60, base.box.padding),
      blurPx: clampNumber(box.blurPx, 0, 30, base.box.blurPx),
    },
    animation: (CAPTION_ANIMATIONS as readonly string[]).includes(String(value.animation)) ? (value.animation as CaptionAnimation) : base.animation,
    animationMs: clampNumber(value.animationMs, 40, 800, base.animationMs),
    intensity: clampNumber(value.intensity, 0, 1, base.intensity),
  };
}

function normaliseCaptions(value: unknown): ShortsProject["captions"] {
  const fallback = { enabled: false, style: defaultCaptionStyle(), words: [] as CaptionWord[] };
  if (!isRecord(value)) return fallback;
  const style = normaliseCaptionStyle(value.style);
  const words = Array.isArray(value.words)
    ? value.words
        .filter(isRecord)
        .map((word) => ({
          text: String(word.text ?? "").slice(0, 60),
          startMs: Math.max(0, Math.round(Number(word.startMs) || 0)),
          endMs: Math.max(0, Math.round(Number(word.endMs) || 0)),
          ...(word.emphasis ? { emphasis: true } : {}),
        }))
        .filter((word) => word.text && word.endMs > word.startMs)
        .sort((a, b) => a.startMs - b.startMs)
        .slice(0, 20_000)
    : [];
  return { enabled: Boolean(value.enabled), style, words };
}

function normaliseSource(value: unknown): SourceRef | null {
  if (!isRecord(value)) return null;
  const origin = value.origin === "youtube" || value.origin === "upload" ? value.origin : "generated";
  return {
    origin,
    url: typeof value.url === "string" && /^https?:\/\//.test(value.url) ? value.url.slice(0, 500) : undefined,
    title: String(value.title || "Source").slice(0, 200),
    durationMs: Math.max(0, Number(value.durationMs) || 0),
    width: Math.max(0, Number(value.width) || 0),
    height: Math.max(0, Number(value.height) || 0),
    fps: Math.max(0, Number(value.fps) || 0),
    file: isAssetPath(value.file) ? value.file : undefined,
    sourceStartMs: typeof value.sourceStartMs === "number" ? Math.max(0, value.sourceStartMs) : undefined,
    sourceEndMs: typeof value.sourceEndMs === "number" ? Math.max(0, value.sourceEndMs) : undefined,
    thumbnail: isAssetPath(value.thumbnail) ? value.thumbnail : undefined,
  };
}

function isTimelineItem(value: unknown): value is TimelineItem {
  if (!isRecord(value)) return false;
  return ["message", "choice", "quiz", "list-item", "story", "title", "narration"].includes(String(value.type)) &&
    typeof value.startMs === "number" && typeof value.durationMs === "number";
}

function cloneItem(item: TimelineItem): TimelineItem {
  const cloned = {
    ...item,
    id: safeId(item.id),
    startMs: Math.max(0, Math.round(item.startMs)),
    durationMs: clampNumber(item.durationMs, 100, SHORTS_MAX_DURATION_MS, 1000),
  } as TimelineItem;
  if (cloned.type === "message") {
    cloned.speechMs = clampNumber((cloned as MessageItem).speechMs, 0, SHORTS_MAX_DURATION_MS, 0);
    cloned.typingMs = clampNumber((cloned as MessageItem).typingMs, 0, 6000, 0);
    const voice = (cloned as MessageItem).voice;
    if (typeof voice !== "string" || !voice) delete (cloned as MessageItem).voice;
    const mediaAsset = (cloned as MessageItem).mediaAsset;
    if (!isAssetPath(mediaAsset)) delete (cloned as MessageItem).mediaAsset;
  }
  return cloned;
}

export function safeId(value: unknown): string {
  const text = String(value ?? "").trim();
  return /^[A-Za-z0-9_-]{1,80}$/.test(text) ? text : `id-${Math.random().toString(36).slice(2, 10)}`;
}

export function isAssetPath(value: unknown): value is string {
  return typeof value === "string" && /^assets\/[A-Za-z0-9._-]{1,120}$/.test(value);
}

/** A bare filename inside the shared music/SFX library folder — no path separators, audio extension only. */
export function isLibraryAudioFile(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9 ._()[\]'&+-]{1,180}\.(mp3|wav|m4a|aac|ogg|flac)$/i.test(value) && !value.includes("..") && !value.includes("/") && !value.includes("\\");
}

function normaliseAudio(value: unknown): ShortsProject["audio"] {
  const fallback: ShortsProject["audio"] = { music: null, sfx: [] };
  if (!isRecord(value)) return fallback;
  const musicRaw = value.music;
  const music = isRecord(musicRaw) && isLibraryAudioFile(musicRaw.file)
    ? {
        file: musicRaw.file,
        volume: clampNumber(musicRaw.volume, 0, 1.5, 0.7),
        startOffsetMs: clampNumber(musicRaw.startOffsetMs, 0, 24 * 3600 * 1000, 0),
        duckUnderSpeech: Boolean(musicRaw.duckUnderSpeech ?? true),
        duckAmount: clampNumber(musicRaw.duckAmount, 0, 1, 0.65),
      }
    : null;
  const sfx = Array.isArray(value.sfx)
    ? value.sfx
        .filter(isRecord)
        .filter((cue) => isLibraryAudioFile(cue.file))
        .map((cue) => ({
          id: safeId(cue.id),
          file: cue.file as string,
          atMs: Math.max(0, Math.round(Number(cue.atMs) || 0)),
          volume: clampNumber(cue.volume, 0, 1.5, 0.9),
        }))
        .slice(0, 200)
    : [];
  return { music, sfx };
}

function isColor(value: unknown): value is string {
  return typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value);
}

function clampNumber(value: unknown, min: number, max: number, fallback: number) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
