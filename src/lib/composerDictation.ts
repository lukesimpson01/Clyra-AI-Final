/**
 * Pure helpers for the Chat composer microphone. The capture/socket work lives
 * in App.tsx (useComposerVoiceCapture); these functions decide intent and text
 * handling so they can be unit-tested without a microphone or Electron.
 */

/**
 * "starting" covers permission, the speech session and the first capture
 * frames. "listening" is entered only once capture has actually started, so
 * the UI never claims to hear the user before the microphone is live.
 */
export type ComposerDictationPhase = "idle" | "starting" | "listening" | "transcribing" | "error";

/** Phases where a microphone session is open and Cancel discards it. */
export function isDictationSessionOpen(phase: ComposerDictationPhase) {
  return phase === "starting" || phase === "listening";
}

/** A press shorter than this is a tap (toggle); longer is press-and-hold. */
export const DICTATION_HOLD_THRESHOLD_MS = 350;

export function isDictationHold(downAt: number, upAt: number) {
  return upAt - downAt >= DICTATION_HOLD_THRESHOLD_MS;
}

/** Recording can begin only when no capture or transcription is in flight. */
export function canStartDictation(phase: ComposerDictationPhase) {
  return phase === "idle" || phase === "error";
}

/**
 * Dictation fills the composer and never sends. Appends to any draft the user
 * already typed, with one separating space, instead of replacing it.
 */
export function appendDictatedText(draft: string, dictated: string) {
  const clean = dictated.trim();
  if (!clean) return draft;
  if (!draft.trim()) return clean;
  return /\s$/.test(draft) ? `${draft}${clean}` : `${draft} ${clean}`;
}

/** m:ss for the recording clock. Negative or non-finite input shows 0:00. */
export function formatDictationElapsed(seconds: number) {
  const safe = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, "0")}`;
}
