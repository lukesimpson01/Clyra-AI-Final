// Conservative enough for built-in laptop microphones while remaining above
// the browser noise floor. The server also has an independent safety VAD, so
// a throttled renderer can no longer strand an otherwise valid utterance.
export const VOICE_SPEECH_LEVEL = 0.035;
/** Shorter floor so short replies still commit. */
export const VOICE_MIN_UTTERANCE_MS = 240;
/** Faster end-of-turn for snappier STT without cutting mid-thought. */
export const VOICE_TRAILING_SILENCE_MS = 380;
export const VOICE_SILENCE_ARM_MS = 420;

export function remainingVoiceSilenceMs(lastSpeechAt: number, now = performance.now()) {
  return Math.max(80, VOICE_SILENCE_ARM_MS - (now - lastSpeechAt));
}
