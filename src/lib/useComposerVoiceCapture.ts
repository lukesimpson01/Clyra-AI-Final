import { useCallback, useEffect, useRef, useState } from "react";
import { VoicePcmCapturer } from "./voicePcmCapture";
import { canStartDictation, type ComposerDictationPhase } from "./composerDictation";
import { getElectronDesktop } from "./electron-runtime";
import { SpeechEndpointer } from "./dictationEndpoint";
import { summarizeFix, type DictationStep, type DictationStepId, type DictationStepState } from "./dictationSteps";

/** The chat composer's microphone: one capture session that streams audio to Clyra's local speech engine (or the
 * browser's recognizer when that is what the engine asks for), then returns the cleaned transcript. Shared by
 * Chat and Maps so the mic behaves identically in both. */
export function useComposerVoiceCapture(onComplete: (text: string) => void) {
  const [phase, setPhase] = useState<ComposerDictationPhase>("idle");
  const [level, setLevel] = useState(0);
  const [detail, setDetail] = useState("");
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [steps, setSteps] = useState<DictationStep[]>([]);
  const endpointerRef = useRef(new SpeechEndpointer());
  const endedByRef = useRef<"auto" | "manual">("manual");
  const stepsClearRef = useRef<number | null>(null);
  /** Adds or updates one row of the visible timeline. */
  const setStep = useCallback((id: DictationStepId, label: string, state: DictationStepState, detail?: string) => {
    setSteps((list) => {
      const next = list.some((x) => x.id === id) ? list.map((x) => (x.id === id ? { id, label, state, detail } : x)) : [...list, { id, label, state, detail }];
      return next;
    });
  }, []);
  const clearStepsSoon = useCallback((ms = 2800) => {
    if (stepsClearRef.current != null) window.clearTimeout(stepsClearRef.current);
    stepsClearRef.current = window.setTimeout(() => { stepsClearRef.current = null; setSteps([]); }, ms);
  }, []);
  const captureRef = useRef<VoicePcmCapturer | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const sessionIdRef = useRef("");
  const silenceTimerRef = useRef<number | null>(null);
  const transcribeTimeoutRef = useRef<number | null>(null);
  const heardSpeechRef = useRef(false);
  const lastSpeechAtRef = useRef(0);
  const startedAtRef = useRef(0);
  const phaseRef = useRef<ComposerDictationPhase>("idle");
  const recognitionRef = useRef<any>(null);

  useEffect(() => { phaseRef.current = phase; }, [phase]);

  // Recording clock is derived from the moment capture began, not a placeholder.
  useEffect(() => {
    if (phase !== "listening") return;
    const tick = () => setElapsedSeconds(Math.floor((Date.now() - startedAtRef.current) / 1000));
    tick();
    const timer = window.setInterval(tick, 500);
    return () => window.clearInterval(timer);
  }, [phase]);

  const release = useCallback(() => {
    if (silenceTimerRef.current != null) window.clearTimeout(silenceTimerRef.current);
    silenceTimerRef.current = null;
    if (transcribeTimeoutRef.current != null) window.clearTimeout(transcribeTimeoutRef.current);
    transcribeTimeoutRef.current = null;
    captureRef.current?.stop();
    captureRef.current = null;
    try { socketRef.current?.close(); } catch { /* already closed */ }
    socketRef.current = null;
    sessionIdRef.current = "";
    try { recognitionRef.current?.abort?.(); } catch { /* already stopped */ }
    recognitionRef.current = null;
    setLevel(0);
  }, []);

  const cancel = useCallback(() => {
    release();
    setPhase("idle");
    setDetail("");
    setSteps([]);
  }, [release]);

  /** Ends capture and asks the local engine for the final transcript (stop keeps the audio). */
  const flush = useCallback(() => {
    if (phaseRef.current !== "listening") return;
    phaseRef.current = "transcribing";
    setPhase("transcribing");
    setDetail("Transcribing");
    const heard = Math.max(0, (Date.now() - startedAtRef.current) / 1000);
    setStep("listen", "Listened", "done", `${heard.toFixed(1)}s`);
    setStep("endpoint", endedByRef.current === "auto" ? "Heard you stop" : "Stopped by you", "done");
    setStep("transcribe", "Transcribing", "active", "on this device");
    captureRef.current?.stop();
    captureRef.current = null;
    if (socketRef.current?.readyState !== WebSocket.OPEN) {
      release();
      setPhase("error");
      setDetail("The voice service disconnected. Try again.");
      return;
    }
    socketRef.current.send(JSON.stringify({ type: "flush", sessionId: sessionIdRef.current }));
    // Watchdog: a stalled engine must not leave the mic stuck on "Transcribing".
    transcribeTimeoutRef.current = window.setTimeout(() => {
      transcribeTimeoutRef.current = null;
      if (phaseRef.current !== "transcribing") return;
      release();
      setPhase("error");
      setDetail("Transcription timed out. Try again.");
    }, 25_000);
  }, [release, setStep]);

  /** Enters "listening" only when capture has really started for this socket. */
  const markListening = useCallback((socket: WebSocket) => {
    if (phaseRef.current !== "starting" || socketRef.current !== socket) return;
    if (transcribeTimeoutRef.current != null) window.clearTimeout(transcribeTimeoutRef.current);
    transcribeTimeoutRef.current = null;
    startedAtRef.current = Date.now();
    setElapsedSeconds(0);
    phaseRef.current = "listening";
    setPhase("listening");
    setDetail("Listening");
    endpointerRef.current.reset();
    endedByRef.current = "manual";
    if (stepsClearRef.current != null) { window.clearTimeout(stepsClearRef.current); stepsClearRef.current = null; }
    setSteps([{ id: "listen", label: "Listening", state: "active" }]);
  }, []);

  const start = useCallback(async () => {
    // Error is a recoverable state: a failed attempt must not block the next tap.
    if (!canStartDictation(phaseRef.current)) return;
    heardSpeechRef.current = false;
    lastSpeechAtRef.current = 0;
    phaseRef.current = "starting";
    setPhase("starting");
    setDetail("Starting microphone");
    try {
      const desktop = getElectronDesktop();
      const permissions = await desktop?.dictation.ensurePermissions?.().catch(() => null);
      if (permissions && permissions.ok === false) throw new Error(String(permissions.error || "Microphone permission is blocked."));
      const origin = await desktop?.dictation.serviceUrl().catch(() => "") || window.location.origin;
      const response = await fetch(new URL("/voice/session", origin), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "dictation", history: [] }),
      });
      const session = await response.json();
      if (!response.ok || !session.websocketUrl) throw new Error(session.error || "Voice service is unavailable.");
      const socket = new WebSocket(String(session.websocketUrl));
      socketRef.current = socket;
      sessionIdRef.current = String(session.sessionId || "");
      // If the engine never confirms capture, fail visibly instead of sitting on "Starting".
      transcribeTimeoutRef.current = window.setTimeout(() => {
        transcribeTimeoutRef.current = null;
        if (phaseRef.current !== "starting") return;
        release();
        setPhase("error");
        setDetail("Clyra's voice service didn't respond. Try again.");
      }, 12_000);
      socket.onmessage = (event) => {
        let message: Record<string, unknown>;
        try { message = JSON.parse(String(event.data)); } catch { return; }
        if (message.type === "pipeline_mode" && (message.mode === "pipeline" || message.mode === "local") && !captureRef.current) {
          const capture = new VoicePcmCapturer((data, seq) => {
            if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "audio", sessionId: session.sessionId, codec: "pcm16", data, seq }));
          }, Number(message.sampleRate) || 16_000, (nextLevel) => {
            setLevel(nextLevel);
            if (phaseRef.current !== "listening") return;
            // Clyra decides when you are done: it learns the room, waits for speech, then ends after a pause longer
            // than the ones you took while talking. Tapping the mic still ends it at once.
            const verdict = endpointerRef.current.push(nextLevel);
            if (verdict.kind === "end" || verdict.kind === "max-length") {
              endedByRef.current = "auto";
              flush();
            } else if (verdict.kind === "no-speech") {
              setStep("listen", "Listening", "failed", "heard nothing");
              release();
              setPhase("error");
              setDetail("I didn't hear anything. Tap the mic and try again.");
              clearStepsSoon(3500);
            }
          }, { echoCancellation: false });
          captureRef.current = capture;
          void capture.start().then(() => markListening(socket)).catch((error) => {
            release();
            setPhase("error");
            setDetail(error instanceof Error ? error.message : "Microphone access was denied.");
          });
        } else if (message.type === "pipeline_mode" && message.mode === "browser" && !recognitionRef.current) {
          const Recognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
          if (!Recognition) {
            release();
            setPhase("error");
            setDetail("Clyra's local speech engine is warming up. Try again in a moment.");
            return;
          }
          const recognition = new Recognition();
          recognition.continuous = false;
          recognition.interimResults = true;
          recognition.lang = navigator.language || "en-AU";
          recognitionRef.current = recognition;
          recognition.onresult = (recognitionEvent: any) => {
            let finalText = "";
            for (let i = recognitionEvent.resultIndex; i < recognitionEvent.results.length; i += 1) {
              if (recognitionEvent.results[i].isFinal) finalText += recognitionEvent.results[i][0].transcript;
            }
            if (finalText.trim() && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "utterance", sessionId: session.sessionId, text: finalText.trim() }));
          };
          recognition.onerror = () => { if (phaseRef.current === "listening") { release(); setPhase("error"); setDetail("Speech recognition could not hear the microphone."); } };
          recognition.onstart = () => markListening(socket);
          try { recognition.start(); } catch { /* Chromium can reject a duplicate start; current session remains live. */ }
        } else if (message.type === "dictation_final") {
          const transcript = String(message.text || "").trim();
          release();
          const engine = message.engine === "parakeet" ? "Parakeet" : message.engine === "whisper" ? "Whisper" : "speech engine";
          const ms = typeof message.elapsedMs === "number" ? `${(message.elapsedMs / 1000).toFixed(1)}s` : "";
          if (!transcript || message.noSpeech) {
            setStep("transcribe", "Transcribing", "failed", message.noSpeech ? "no speech in the recording" : "nothing recognised");
            setPhase("error");
            setDetail(message.noSpeech ? "I didn't hear any speech. Check your microphone and try again." : "No speech was detected.");
            clearStepsSoon(3500);
            window.setTimeout(cancel, 3_600);
            return;
          }
          setStep("transcribe", "Transcribed", "done", [engine, ms].filter(Boolean).join(" · "));
          setStep("fix", "Fixing", "active", "fillers, corrections, punctuation");
          setPhase("transcribing");
          setDetail("Refining your prompt");
          void fetch("/api/dictation/cleanup", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ transcript, level: "light", dictionary: [] }),
          })
            .then(async (cleanup) => {
              const payload = await cleanup.json().catch(() => ({}));
              if (!cleanup.ok || !payload?.ok) throw new Error(payload?.error || "Prompt cleanup failed.");
              const cleaned = String(payload.text || transcript);
              setStep("fix", "Fixed", "done", summarizeFix(transcript, cleaned));
              if (payload.source === "clyra-llm") setStep("polish", "Polished with AI", "done", "corrections resolved");
              onComplete(cleaned);
              clearStepsSoon();
              setPhase("idle");
              setDetail("");
            })
            .catch(() => {
              setStep("fix", "Fixing", "skipped", "used the raw transcript");
              onComplete(transcript);
              clearStepsSoon();
              setPhase("idle");
              setDetail("");
            });
        } else if (message.type === "error") {
          release();
          setPhase("error");
          setDetail(String(message.message || "Voice transcription failed."));
        }
      };
      socket.onerror = () => {
        release();
        setPhase("error");
        setDetail("Voice service connection failed.");
      };
    } catch (error) {
      release();
      setPhase("error");
      setDetail(error instanceof Error ? error.message : "Voice service is unavailable.");
    }
  }, [cancel, clearStepsSoon, flush, onComplete, release, setStep]);

  useEffect(() => () => release(), [release]);
  const manualStop = useCallback(() => { endedByRef.current = "manual"; flush(); }, [flush]);
  return { phase, level, detail, elapsedSeconds, steps, start, stop: manualStop, cancel };
}
