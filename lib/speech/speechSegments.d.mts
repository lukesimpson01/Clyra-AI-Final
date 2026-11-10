export interface SpeechAnalysis {
  durationMs: number;
  /** Milliseconds of actual speech found. */
  speechMs: number;
  /** [startMs, endMs] of each stretch of speech, padded slightly. */
  segments: Array<[number, number]>;
  noiseFloorDb: number;
  noSpeech: boolean;
  /** Leading and trailing silence removed, long pauses shortened (16-bit mono PCM). */
  trimmed: Buffer;
}
export function analyzeSpeech(pcm: Buffer, sampleRate?: number): SpeechAnalysis;
export function estimateSpeechRate(pcm: Buffer, sampleRate?: number): number;
export function timeStretch(pcm: Buffer, tempo: number): Buffer;
export function pickTempo(rate: number): number;
