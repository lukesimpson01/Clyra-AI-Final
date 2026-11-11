/**
 * The existing voice call's real visual mode routing and ephemeral frame memory.
 * No camera/screen frames are captured by this module. Capture only begins after
 * the user and OS grant access in VoiceMultimodalLayer.
 */
export type VoiceVisualSource = "camera" | "screen";
export type VoiceVisualMode = "voice" | VoiceVisualSource;
export type VoiceVisualAction = "enable-camera" | "enable-screen" | "voice-only" | "inspect" | "point" | "control";
export type VoiceVisualIntent = { action: VoiceVisualAction; source?: VoiceVisualSource; question: string };
export type VoiceVisionFrame = {
  image: string;
  time: number;
  source: VoiceVisualSource;
  width: number;
  height: number;
};

let liveVisualMode: VoiceVisualMode = "voice";
export const getVoiceVisualMode = () => liveVisualMode;
export const setVoiceVisualMode = (mode: VoiceVisualMode) => { liveVisualMode = mode; };

/**
 * Deliberately narrow local fast path. General tools remain owned by the
 * existing /api/agent/route -> mission harness, not by regex macros.
 */
export function routeVoiceVisualIntent(input: string, activeMode = getVoiceVisualMode()): VoiceVisualIntent | null {
  const question = input.trim();
  const text = question.toLowerCase().replace(/[.!?]+$/g, "").trim();
  if (!text) return null;
  if (/\b(?:stop (?:looking|watching|sharing)|turn (?:off|back off) (?:the |my )?(?:camera|screen share|screen sharing)|back to (?:voice|audio)|voice only|just (?:talk|listen))\b/.test(text)) {
    return { action: "voice-only", question };
  }
  if (/\b(?:turn on|enable|open|start|switch to|use|show)\b.{0,38}\b(?:camera|webcam)\b|\b(?:what am i holding|what's in my hand|what am i showing you|look through my camera|can you see me)\b/.test(text)) {
    return { action: "enable-camera", source: "camera", question };
  }
  if (/\b(?:share (?:my |the )?screen|screen shar(?:e|ing)|turn on screen|show (?:you )?my (?:desktop|screen)|look at my screen|see my screen|what's on my screen|what is on my screen|watch my screen)\b/.test(text)) {
    return { action: "enable-screen", source: "screen", question };
  }
  if (/\b(?:point (?:to|at|out)|show me where|highlight (?:the|that)|circle (?:the|that))\b/.test(text)) {
    return { action: "point", source: activeMode === "voice" ? "screen" : activeMode, question };
  }
  if (activeMode === "screen" && /\b(?:do it for me|take control|click (?:the|that|this)|type (?:that|this)|scroll (?:down|up)|do this on my computer)\b/.test(text)) {
    return { action: "control", source: "screen", question };
  }
  if (activeMode !== "voice" && /\b(?:what (?:is|was) (?:that|this)|what (?:do|did) you see|look at (?:that|this|what i was)|what happened|read (?:this|that)|can you see (?:it|this)|what am i (?:doing|showing))\b/.test(text)) {
    return { action: "inspect", source: activeMode, question };
  }
  return null;
}

/** Strictly in-memory: lifetime 45s, bounded frame count and bytes. */
export class RollingVoiceFrames {
  private readonly entries: VoiceVisionFrame[] = [];
  private readonly lifetimeMs: number;
  private readonly maxFrames: number;
  private readonly maxBytes: number;
  constructor({ lifetimeMs = 45_000, maxFrames = 65, maxBytes = 14_000_000 }: {
    lifetimeMs?: number; maxFrames?: number; maxBytes?: number;
  } = {}) {
    this.lifetimeMs = Math.max(1000, lifetimeMs);
    this.maxFrames = Math.max(1, maxFrames);
    this.maxBytes = Math.max(1, maxBytes);
  }
  add(frame: VoiceVisionFrame) {
    if (!Number.isFinite(frame.time) || frame.width <= 0 || frame.height <= 0 || !/^data:image\/jpeg;base64,/.test(frame.image)) return;
    this.prune(frame.time);
    this.entries.push(frame);
    let bytes = this.entries.reduce((total, entry) => total + entry.image.length, 0);
    while (this.entries.length > this.maxFrames || bytes > this.maxBytes) {
      const removed = this.entries.shift();
      if (!removed) break;
      bytes -= removed.image.length;
    }
  }
  prune(now = Date.now()) {
    while (this.entries.length && (now - this.entries[0].time > this.lifetimeMs)) this.entries.shift();
  }
  /** Includes older context and the newest frame, rather than just the last still. */
  select(now = Date.now(), max = 4): VoiceVisionFrame[] {
    this.prune(now);
    const frames = this.entries.filter(frame => frame.time <= now).sort((a, b) => a.time - b.time);
    const limit = Math.min(4, Math.max(1, Math.floor(max)));
    if (frames.length <= limit) return frames;
    if (limit === 1) return [frames[frames.length - 1]];
    const picked = new Set<number>();
    for (let i = 0; i < limit; i++) picked.add(Math.round((i / (limit - 1)) * (frames.length - 1)));
    return [...picked].sort((a, b) => a - b).map(i => frames[i]);
  }
  clear() { this.entries.length = 0; }
  get size() { return this.entries.length; }
}
