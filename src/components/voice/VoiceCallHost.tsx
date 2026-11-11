import { useCallback, useEffect, useRef, useState } from "react";
import type { VoiceCallScreenCall, VoiceCallScreenProps } from "./VoiceCallScreen";
import { VOICE_CALL_TRIGGER_EVENT, type VoiceCallTriggerDetail } from "./voiceCallTrigger";
import type { VoiceVisionFrame } from "../../voice/multimodal";
import { VoiceMultimodalLayer } from "./VoiceMultimodalLayer";

/** The session controller adds lifecycle actions to the pasted UI's view contract. */
export type VoiceCallHostCall = VoiceCallScreenCall & {
  startCall: () => void | Promise<void>;
  answerWithVision: (question: string, frames: VoiceVisionFrame[]) => Promise<{ ok: boolean; text: string; point?: { x: number; y: number; width: number; height: number; confidence: number } }>;
  respondVisual: (text: string) => void;
  startVoiceMission: (text: string) => Promise<boolean>;
};

export type VoiceCallHostProps = Omit<VoiceCallScreenProps, "call"> & {
  call: VoiceCallHostCall;
};

const PASTED_VOICE_CALL_UI = "/voice-call-ui.html";
const VOICE_CALL_BACKGROUND_STYLE_ID = "clyra-voice-call-background";

/**
 * A deliberately thin lifecycle bridge around public/voice-call-ui.html.
 *
 * That file is the user's complete, paste-ready UI and animation source. This
 * component never edits the pasted source. It only supplies the lifecycle
 * bridge, a white host surface matching chat, and the session controls.
 */
export function VoiceCallHost({ call }: VoiceCallHostProps) {
  const callRef = useRef(call);
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const unbindFrameRef = useRef<(() => void) | null>(null);
  const [presented, setPresented] = useState(false);
  callRef.current = call;

  useEffect(() => {
    if (!call.active) {
      setPresented(false);
      return;
    }

    const frame = requestAnimationFrame(() => setPresented(true));
    return () => cancelAnimationFrame(frame);
  }, [call.active]);

  useEffect(() => {
    const handleTrigger = (event: Event) => {
      const detail = (event as CustomEvent<VoiceCallTriggerDetail>).detail;
      const action = detail?.action || "start";
      const controller = callRef.current;

      if (action === "end") {
        void controller.endCall();
        return;
      }
      if (action === "toggle" && controller.active) {
        void controller.endCall();
        return;
      }
      void controller.startCall();
    };

    window.addEventListener(VOICE_CALL_TRIGGER_EVENT, handleTrigger);
    return () => window.removeEventListener(VOICE_CALL_TRIGGER_EVENT, handleTrigger);
  }, []);

  const bindPastedUi = useCallback(() => {
    unbindFrameRef.current?.();
    const document = frameRef.current?.contentDocument;
    if (!document) return;

    // The supplied file stays byte-for-byte intact. This runtime-only rule
    // makes its canvas use the same white surface as the surrounding chats.
    let backgroundStyle = document.getElementById(VOICE_CALL_BACKGROUND_STYLE_ID) as HTMLStyleElement | null;
    if (!backgroundStyle) {
      backgroundStyle = document.createElement("style");
      backgroundStyle.id = VOICE_CALL_BACKGROUND_STYLE_ID;
      document.head.append(backgroundStyle);
    }
    backgroundStyle.textContent = `
      html, body, #__bundler_thumbnail { background: #ffffff !important; }
      x-dc > div[style*="background:radial-gradient"] { background: #ffffff !important; }
    `;

    const onControlClick = (event: MouseEvent) => {
      // Capture the value before the untouched pasted page runs its own button
      // handler. Programmatic End clicks below are animation-only and must not
      // issue a second session request.
      if (!event.isTrusted) return;
      const button = (event.target as Element | null)?.closest("button");
      const label = button?.getAttribute("aria-label");
      const controller = callRef.current;

      if (label === "End") {
        void controller.endCall();
      } else if (label === "Mute microphone" || label === "Unmute microphone") {
        controller.toggleMute();
      } else if (label === "Send") {
        const input = document.querySelector<HTMLInputElement>('input[aria-label="Message Clyra"]');
        const text = input?.value.trim();
        if (text) {
          // Prevent the supplied standalone demo's scripted placeholder reply.
          // Its real controller now owns the entire turn and transcript.
          event.preventDefault();
          event.stopPropagation();
          event.stopImmediatePropagation();
          void controller.sendText(text);
          document.querySelector<HTMLButtonElement>('button[aria-label="Close composer"]')?.click();
        }
      }
    };

    const preventDemoKeys = (event: KeyboardEvent) => {
      const target = event.target as Element | null;
      if (!target?.closest("input,textarea,[contenteditable]") && /^[1-7]$/.test(event.key)) {
        event.stopImmediatePropagation();
      }
    };
    document.addEventListener("click", onControlClick, true);
    document.addEventListener("keydown", preventDemoKeys, true);
    unbindFrameRef.current = () => {
      document.removeEventListener("click", onControlClick, true);
      document.removeEventListener("keydown", preventDemoKeys, true);
    };
  }, []);

  useEffect(() => () => unbindFrameRef.current?.(), []);

  useEffect(() => {
    if (call.state !== "ending") return;
    // Ask the pasted page to run its existing End handler. Its own animation
    // fades at 420ms and completes at 720ms; the voice controller unmounts the
    // frame after that same finish window.
    frameRef.current?.contentDocument?.querySelector<HTMLButtonElement>('button[aria-label="End"]')?.click();
  }, [call.state]);

  if (!call.active) return null;

  return (
    <div
      className="clyra-voice-call-host"
      data-presented={presented}
      data-ending={call.state === "ending"}
      aria-hidden={call.state === "ending" ? true : undefined}
    >
      <iframe
        ref={frameRef}
        className="clyra-voice-call-host__frame"
        src={PASTED_VOICE_CALL_UI}
        title="Clyra voice call"
        onLoad={bindPastedUi}
      />
      <VoiceMultimodalLayer call={call} />
    </div>
  );
}
