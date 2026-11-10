import { useCallback, useEffect, useRef, useState } from "react";
import { VoicePcmCapturer } from "./voicePcmCapture";
import { canStartDictation, type ComposerDictationPhase } from "./composerDictation";
import { getElectronDesktop } from "./electron-runtime";

/** The chat composer's microphone: one capture session that streams audio to Clyra's local speech engine (or the
 * browser's recognizer when that is what the engine asks for), then returns the cleaned transcript. Shared by
 * Chat and Maps so the mic behaves identically in both. */
export function useComposerVoiceCapture(onComplete: (text: string) => void) {
  const [phase, setPhase] = useState<ComposerDictationPhase>("idle");
  const [level, setLevel] = useState(0);
  const [detail, setDetail] = useState("");
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
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
  }, [release]);

  /** Ends capture and asks the local engine for the final transcript (stop keeps the audio). */
  const flush = useCallback(() => {
    if (phaseRef.current !== "listening") return;
    phaseRef.current = "transcribing";
    setPhase("transcribing");
    setDetail("Transcribing");
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
  }, [release]);

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
            const now = performance.now();
            if (nextLevel >= 0.07) {
              heardSpeechRef.current = true;
              lastSpeechAtRef.current = now;
              if (silenceTimerRef.current != null) window.clearTimeout(silenceTimerRef.current);
              silenceTimerRef.current = null;
              return;
            }
            if (!heardSpeechRef.current || silenceTimerRef.current != null || now - lastSpeechAtRef.current < 1_100) return;
            // Recording is ended by the user (tap or release). This is only a
            // safety net for a forgotten mic, so it waits for a long silence.
            silenceTimerRef.current = window.setTimeout(() => {
              silenceTimerRef.current = null;
              if (performance.now() - lastSpeechAtRef.current >= 4_000) flush();
            }, 4_000);
          });
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
          if (!transcript) {
            setPhase("error");
            setDetail("No speech was detected.");
            window.setTimeout(cancel, 1_600);
            return;
          }
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
              onComplete(String(payload.text || transcript));
              setPhase("idle");
              setDetail("");
            })
            .catch(() => {
              onComplete(transcript);
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
  }, [cancel, flush, onComplete, release]);

  useEffect(() => () => release(), [release]);
  return { phase, level, detail, elapsedSeconds, start, stop: flush, cancel };
}
