/**
 * Public entry point for the voice-call overlay.
 *
 * Call this from any UI surface instead of importing the chat or voice-session
 * hook. VoiceCallHost is the one place that receives the request and connects
 * it to the live call controller.
 */
export const VOICE_CALL_TRIGGER_EVENT = "clyra:voice-call";

export type VoiceCallTriggerAction = "start" | "end" | "toggle";

export type VoiceCallTriggerDetail = {
  action?: VoiceCallTriggerAction;
  source?: string;
};

/** Open, end, or toggle Clyra's voice-call UI from any client-side feature. */
export function requestVoiceCall(action: VoiceCallTriggerAction = "start", source?: string) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<VoiceCallTriggerDetail>(VOICE_CALL_TRIGGER_EVENT, {
    detail: { action, source },
  }));
}
