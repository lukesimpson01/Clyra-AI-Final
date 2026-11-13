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
  const [screenRequest, setScreenRequest] = useState<Promise<MediaStream> | null>(null);
  const mediaGenerationRef = useRef(0);
  callRef.current = call;
  const changeMediaMode = (mode: "camera" | "screen" | null) => {
    const generation = ++mediaGenerationRef.current;
    if (mode === "screen") {
      // getDisplayMedia REQUIRES transient user activation. Call it directly
      // inside the screen button's click handler, never in a delayed effect.
      let request: Promise<MediaStream>;
      try {
        request = navigator.mediaDevices.getDisplayMedia({
          video: { frameRate: { ideal: 15, max: 20 } },
          audio: false,
        });
      } catch (error) {
        request = Promise.reject(error);
      }
      // A canceled picker might resolve after the user has changed modes.
      // Such an orphan stream must never remain running.
      void request.then((stream) => {
        if (generation !== mediaGenerationRef.current) stream.getTracks().forEach((track) => track.stop());
      }).catch(() => undefined);
      setScreenRequest(request);
    } else {
      setScreenRequest(null);
    }
    setMediaMode(mode);
  };

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
    if (!call.active || call.state === "ending") {
      ++mediaGenerationRef.current;
      setScreenRequest(null);
      setMediaMode(null);
    }
  }, [call.active, call.state]);

  if (!call.active) return null;

  return (
    <div className="clyra-voice-call-host" data-presented="true" data-ending={call.state === "ending"}>
      <VoiceCallScreen
        {...screenProps}
        call={call}
        mediaMode={mediaMode}
        onMediaModeChange={changeMediaMode}
        screenRequest={screenRequest}
      />
    </div>
  );
}
