/** End-of-speech policy for Clyra's low-CPU live voice session.
 * Audio activity comes from the local VAD; words are only used to adapt the
 * length of the pause, NOT to infer that the microphone has gone silent.
 * All values are milliseconds and deterministic for offline regression tests.
 */
export type VoiceEndpointEvidence = {
  now: number;
  speechStartedAt: number;
  lastSpeechAt: number;
  partialTranscript: string;
  loud: boolean;
};

const CONTINUATION = /\b(?:and|but|because|if|so|to|with|about|for|or|then|when|while|although|unless|that|which|as|like|also|plus|uh|um)\s*[,;:]?\s*$/i;
export function voiceEndpointSilenceMs(partialTranscript: string, speechDurationMs: number): number {
  const text = partialTranscript.trim();
  // When local STT is catching up, never treat a momentary pause after a
  // soft/mumbled start as a completed turn.
  if (!text) return speechDurationMs < 750 ? 1_050 : 930;
  if (CONTINUATION.test(text) || /[,;:—-]\s*$/.test(text)) return 1_300;
  const words = text.split(/\s+/).length;
  if (words <= 3) return 860;
  // A recogniser-generated full stop is a *hint*, not a hard end. The
  // microphone must still actually have fallen quiet for this long.
  if (/[.!?…]\s*$/.test(text)) return 630;
  return 790;
}

export function shouldEndVoiceUtterance(evidence: VoiceEndpointEvidence): boolean {
  const { now, speechStartedAt, lastSpeechAt, partialTranscript, loud } = evidence;
  if (loud || !Number.isFinite(now) || !Number.isFinite(lastSpeechAt) || !Number.isFinite(speechStartedAt)) return false;
  const duration = now - speechStartedAt;
  if (duration < 240 || lastSpeechAt < speechStartedAt) return false;
  return now - lastSpeechAt >= voiceEndpointSilenceMs(partialTranscript, duration);
}
