// Durable, on-disk per-message speech cache for Fake Text Story. The in-memory
// cache in backend/creator-tts/service.ts is a small LRU meant for interactive
// narration preview; a 20+ message story re-fetches the same lines every time
// the editor reopens, so this keeps synthesized audio next to the project
// (project/tts-cache/<hash>.wav + .json) keyed by exactly the inputs that
// affect the recording (voice, speed, text), and only ever regenerates a line
// whose text, voice or speed actually changed.

import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { ensureProjectDirs } from "./store";

export type CachedMessageSpeech = {
  file: string;
  durationMs: number;
  engine: string;
  placeholder: boolean;
  warning?: string;
};

// Speed is a render-time playback-rate adjustment (FFmpeg atempo), not a
// synthesis input, so it is intentionally excluded from the cache key —
// changing a voice's speed slider must not force every line to re-fetch.
function cacheKey(voice: string, text: string) {
  return createHash("sha1").update(`${voice}\u0000${text}`).digest("hex").slice(0, 24);
}

function cacheDir(projectId: string) {
  return path.join(ensureProjectDirs(projectId), "tts-cache");
}

function readSidecar(jsonFile: string): Omit<CachedMessageSpeech, "file"> | null {
  if (!existsSync(jsonFile)) return null;
  try {
    const parsed = JSON.parse(readFileSync(jsonFile, "utf8")) as Omit<CachedMessageSpeech, "file">;
    if (typeof parsed.durationMs === "number" && typeof parsed.engine === "string") return parsed;
  } catch {
    // A corrupt sidecar just forces a re-synthesis.
  }
  return null;
}

/** Returns the cached recording for (voice, text) if one already exists on disk, without calling the TTS service. */
export function readCachedMessageSpeech(projectId: string, voice: string, text: string): CachedMessageSpeech | null {
  const key = cacheKey(voice, text);
  const dir = cacheDir(projectId);
  const wav = path.join(dir, `${key}.wav`);
  const json = path.join(dir, `${key}.json`);
  if (!existsSync(wav)) return null;
  const meta = readSidecar(json);
  if (!meta) return null;
  return { file: wav, ...meta };
}

/**
 * Synthesizes (or reuses) speech for one message. `fetchSpeech` is injected
 * so this module stays fetch-free and testable; render.ts and the timeline
 * route both pass the same `/api/creator/tts` caller.
 */
export async function synthesizeMessageSpeech(
  projectId: string,
  voice: string,
  text: string,
  fetchSpeech: (text: string, voice: string) => Promise<{ bytes: Buffer; durationMs: number; engine: string; warning?: string }>,
): Promise<CachedMessageSpeech> {
  const cached = readCachedMessageSpeech(projectId, voice, text);
  if (cached) return cached;
  const speech = await fetchSpeech(text, voice);
  const key = cacheKey(voice, text);
  const dir = cacheDir(projectId);
  const wav = path.join(dir, `${key}.wav`);
  const json = path.join(dir, `${key}.json`);
  const placeholder = speech.engine.startsWith("local-placeholder");
  writeFileSync(wav, speech.bytes);
  const meta: Omit<CachedMessageSpeech, "file"> = { durationMs: speech.durationMs, engine: speech.engine, placeholder, warning: speech.warning };
  writeFileSync(json, JSON.stringify(meta));
  return { file: wav, ...meta };
}
