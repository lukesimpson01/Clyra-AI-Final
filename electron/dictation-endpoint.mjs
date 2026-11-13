/**
 * Pure, cheap end-of-speech timing for Clyra Anywhere dictation.
 * No mic, Electron or model dependencies, so we can regression-test natural
 * pauses and model latency without starting a desktop capture session.
 */
const CONNECTOR_ENDINGS = new Set(
  "a an the and or but so to of in on at for with from by as that which who whom whose if than then because while when where into onto over under about between through during before after is are was were be been am will would can could should may might do does did have has had my your his her its our their this these those not no".split(" "),
);
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

/** A punctuation/pacing hint, never an unconditional transcription stop. */
export function computeEndSilenceMs({ heard = "", speechDurationMs = 0, longestPauseMs = 0 } = {}) {
  const transcript = String(heard).trim();
  const lastWord = transcript.replace(/[.,?!;:"')\]]+$/, "").split(/\s+/).pop()?.toLowerCase() || "";
  let minimum = 1_250;
  if (!transcript) minimum = 1_500; // partial STT can lag a fast speaker: do not cut off an unheard final word
  else if (/[.!?]["')\]]?$/.test(transcript)) minimum = 900;
  else if (/,$/.test(transcript) || CONNECTOR_ENDINGS.has(lastWord)) minimum = 2_000;
  else if (transcript.split(/\s+/).length >= 22) minimum = 1_400;

  // Short voice commands should feel responsive without clipping slow, quiet speakers.
  if (speechDurationMs > 0 && speechDurationMs < 1_400 && transcript && !CONNECTOR_ENDINGS.has(lastWord)) {
    minimum = Math.max(900, minimum - 160);
  }
  const habitualPause = clamp(Number(longestPauseMs) || 0, 0, 3_000) * 1.4;
  return Math.round(clamp(Math.max(minimum, habitualPause), 900, 3_000));
}
