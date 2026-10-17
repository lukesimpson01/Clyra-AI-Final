import type { SpeechPhase } from "./types";

/** Provider-neutral contract. The current WebRTC transport implements this
 * lifecycle; no UI imports a TTS/STT provider directly. */
export type VoiceConversationState = "CONNECTING" | "READY" | "LISTENING" | "USER_SPEAKING" | "ENDPOINTING" | "THINKING" | "SPEAKING" | "INTERRUPTED" | "PAUSED" | "ERROR" | "ENDING" | "ENDED";
export interface VoiceEngine {
  transcribe(audio: ArrayBuffer): Promise<string>;
  streamResponse(input: string, signal?: AbortSignal): AsyncIterable<string>;
  synthesize(phrase: string, signal?: AbortSignal): Promise<ArrayBuffer>;
  interrupt(): void;
  pause(): void;
  resume(): void;
}
export function voicePhase(state: VoiceConversationState): SpeechPhase {
  const phases: Record<VoiceConversationState, SpeechPhase> = { CONNECTING: "loading", READY: "listening", LISTENING: "listening", USER_SPEAKING: "listening", ENDPOINTING: "endpointing", THINKING: "thinking", SPEAKING: "speaking", INTERRUPTED: "listening", PAUSED: "paused", ERROR: "error", ENDING: "ended", ENDED: "ended" };
  return phases[state];
}
