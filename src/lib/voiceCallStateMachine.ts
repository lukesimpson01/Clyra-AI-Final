export type VoiceCallState =
  | "idle"
  | "starting"
  | "connecting"
  | "ready"
  | "listening"
  | "user_speaking"
  | "endpointing"
  | "transcribing"
  | "thinking"
  | "assistant_starting"
  | "assistant_speaking"
  | "interrupting"
  | "muted"
  | "recovering"
  | "ending"
  | "ended"
  | "error";

const allowed: Record<VoiceCallState, ReadonlySet<VoiceCallState>> = {
  idle: new Set(["starting"]),
  starting: new Set(["connecting", "error", "ending"]),
  connecting: new Set(["ready", "listening", "recovering", "error", "ending"]),
  ready: new Set(["listening", "muted", "ending", "error"]),
  listening: new Set(["user_speaking", "transcribing", "thinking", "muted", "recovering", "ending", "error"]),
  user_speaking: new Set(["endpointing", "listening", "muted", "interrupting", "ending", "error"]),
  endpointing: new Set(["user_speaking", "transcribing", "listening", "ending", "error"]),
  transcribing: new Set(["thinking", "listening", "recovering", "ending", "error"]),
  thinking: new Set(["assistant_starting", "assistant_speaking", "interrupting", "listening", "recovering", "ending", "error"]),
  assistant_starting: new Set(["assistant_speaking", "interrupting", "listening", "recovering", "ending", "error"]),
  assistant_speaking: new Set(["interrupting", "listening", "muted", "recovering", "ending", "error"]),
  interrupting: new Set(["user_speaking", "listening", "transcribing", "ending", "error"]),
  muted: new Set(["listening", "thinking", "assistant_starting", "assistant_speaking", "ending", "error"]),
  recovering: new Set(["connecting", "listening", "assistant_starting", "error", "ending"]),
  ending: new Set(["ended"]),
  ended: new Set(["starting", "idle"]),
  error: new Set(["recovering", "starting", "ending", "ended"]),
};

export function transitionVoiceCall(current: VoiceCallState, next: VoiceCallState) {
  if (current === next) return current;
  return allowed[current].has(next) ? next : current;
}

export function voiceStatusLabel(state: VoiceCallState, muted: boolean) {
  if (state === "starting" || state === "connecting" || state === "ready") return "Connecting…";
  if (state === "user_speaking") return "Listening";
  if (state === "endpointing" || state === "transcribing") return "Understanding…";
  if (state === "thinking") return "Thinking";
  if (state === "assistant_starting" || state === "assistant_speaking") return "Speaking";
  if (state === "interrupting") return "Listening";
  if (state === "recovering") return "Reconnecting…";
  if (state === "ending" || state === "ended") return "Call ended";
  if (state === "error") return "Voice unavailable";
  if (muted || state === "muted") return "Muted";
  return "Listening";
}
