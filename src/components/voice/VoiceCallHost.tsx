import { useEffect, useRef, useState } from "react";
import { VoiceCallScreen, type VoiceCallScreenCall, type VoiceCallScreenProps } from "./VoiceCallScreen";
import { VOICE_CALL_TRIGGER_EVENT, type VoiceCallTriggerDetail } from "./voiceCallTrigger";

/** The controller remains the single owner of the microphone, speech and agent session. */
export type VoiceCallHostCall = VoiceCallScreenCall & { startCall: () => void | Promise<void> };
export type VoiceCallHostProps = Omit<VoiceCallScreenProps, "call" | "mediaMode" | "onMediaModeChange"> & {
  call: VoiceCallHostCall;
};

/**
 * Use the existing live React call surface instead of the disconnected
 * iframe mockup. The latter could handle End/Mute clicks but could not
 * receive the real listening/thinking/agent/transcript state at all.
 */
export function VoiceCallHost({ call, ...screenProps }: VoiceCallHostProps) {
  const callRef = useRef(call);
  const [mediaMode, setMediaMode] = useState<"camera" | "screen" | null>(null);
  callRef.current = call;

  useEffect(() => {
    const onTrigger = (event: Event) => {
      const detail = (event as CustomEvent<VoiceCallTriggerDetail>).detail;
      const action = detail?.action || "start";
      const controller = callRef.current;
      if (action === "end" || (action === "toggle" && controller.active)) {
        void controller.endCall();
      } else if (!controller.active) {
        void controller.startCall();
      }
    };
    // Readiness is independent of which workspace tab happens to be visible.
    // It lets integration checks wait for the actual call listener, not a button.
    document.documentElement.dataset.clyraVoiceController = "ready";
    window.addEventListener(VOICE_CALL_TRIGGER_EVENT, onTrigger);
    return () => {
      window.removeEventListener(VOICE_CALL_TRIGGER_EVENT, onTrigger);
      delete document.documentElement.dataset.clyraVoiceController;
    };
  }, []);

  useEffect(() => {
    if (!call.active || call.state === "ending") setMediaMode(null);
  }, [call.active, call.state]);

  if (!call.active) return null;

  return (
    <div className="clyra-voice-call-host" data-presented="true" data-ending={call.state === "ending"}>
      <VoiceCallScreen
        {...screenProps}
        call={call}
        mediaMode={mediaMode}
        onMediaModeChange={setMediaMode}
      />
    </div>
  );
}
