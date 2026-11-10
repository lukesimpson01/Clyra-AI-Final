import { useEffect, useRef, useState } from "react";
import { useComposerVoiceCapture } from "./useComposerVoiceCapture";
import { appendDictatedText, type ComposerDictationPhase } from "./composerDictation";
import { getElectronDesktop } from "./electron-runtime";
import { playFlowSound } from "./flowSounds";
import type { FlowSession } from "../components/chat/FlowComposerOverlay";
import type { DictationStep } from "./dictationSteps";

export interface DictationControls {
  phase: ComposerDictationPhase;
  level: number;
  elapsedSeconds: number;
  detail?: string;
  /** Live words and edits, when the desktop Flow engine is driving this dictation. */
  flow: FlowSession | null;
  /** The stages of this dictation as tool-call rows: listening, end of speech, transcribing, fixing. */
  steps: DictationStep[];
  onStart: () => void;
  onStop: () => void;
  onCancel: () => void;
}

const flowPhase = (phase: string): ComposerDictationPhase =>
  phase === "arming" ? "starting" : phase === "listening" ? "listening" : phase === "error" ? "error" : phase === "closing" ? "idle" : "transcribing";

/**
 * The Chat composer's microphone, for any other text field: in the desktop app the button drives the same Flow
 * engine as the global hotkey; elsewhere it records with the same local speech engine Chat uses. The transcript is
 * handed to `onText`, which should append it to the draft — dictation fills the field and never sends.
 */
export function useDictationController(onText: (text: string) => void): DictationControls {
  const capture = useComposerVoiceCapture(onText);
  const [flowSession, setFlowSession] = useState<FlowSession | null>(null);
  const inlineRef = useRef(false); // this field started the Flow session; Chat's own listener ignores it
  const deliveredRef = useRef(false);
  const prevPhaseRef = useRef("idle");
  const onTextRef = useRef(onText);
  onTextRef.current = onText;

  useEffect(() => {
    const flow = getElectronDesktop()?.dictation;
    if (!flow?.onState) return undefined;
    const deliver = (text: string) => {
      const clean = String(text || "");
      if (!clean.trim() || deliveredRef.current) return;
      deliveredRef.current = true;
      onTextRef.current(clean);
    };
    const offState = flow.onState((state: FlowSession) => {
      if (!inlineRef.current) return;
      const previous = prevPhaseRef.current;
      const next = state.phase || "idle";
      if (next !== previous) {
        if (next === "listening" && previous !== "listening") playFlowSound("start");
        else if ((next === "processing" || next === "optimising") && previous === "listening") playFlowSound("stop");
        else if (next === "done") playFlowSound("done");
        else if (next === "error") playFlowSound("error");
        else if (next === "idle" && previous !== "done" && previous !== "idle") playFlowSound("cancel");
      }
      prevPhaseRef.current = next;
      if (next === "done" && (state as { resultText?: string }).resultText) deliver((state as { resultText?: string }).resultText!);
      if (next === "idle") {
        inlineRef.current = false;
        setFlowSession(null);
        return;
      }
      setFlowSession({ ...state });
    });
    const offResult = flow.onInlineResult?.(({ text }: { text: string }) => { if (inlineRef.current) deliver(text); });
    return () => { offState?.(); offResult?.(); };
  }, []);

  return {
    phase: flowSession ? flowPhase(flowSession.phase) : capture.phase,
    level: flowSession ? flowSession.level || 0 : capture.level,
    elapsedSeconds: capture.elapsedSeconds,
    detail: flowSession ? flowSession.detail : capture.detail,
    flow: flowSession,
    steps: capture.steps,
    onStart: () => {
      const flow = getElectronDesktop()?.dictation;
      if (flow?.toggle) {
        inlineRef.current = true; deliveredRef.current = false; prevPhaseRef.current = "idle";
        void flow.toggle({ inline: true, selection: "" });
        return;
      }
      void capture.start();
    },
    onStop: () => {
      const flow = getElectronDesktop()?.dictation;
      if (flowSession && flow?.toggle) { void flow.toggle(); return; }
      capture.stop();
    },
    onCancel: () => {
      const flow = getElectronDesktop()?.dictation;
      if (flowSession && flow?.cancel) { void flow.cancel(); return; }
      capture.cancel();
    },
  };
}

export { appendDictatedText };
