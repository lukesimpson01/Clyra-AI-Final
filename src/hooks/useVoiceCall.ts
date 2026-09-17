import { useCallback, useEffect, useRef, useState } from "react";
import {
  PipecatClient,
  RTVIEvent,
  type BotLLMTextData,
  type BotTTSTextData,
  type TranscriptData,
} from "@pipecat-ai/client-js";
import { SmallWebRTCTransport } from "@pipecat-ai/small-webrtc-transport";

export type VoiceCallStatus =
  | "idle"
  | "connecting"
  | "reconnecting"
  | "listening"
  | "thinking"
  | "speaking"
  | "paused"
  | "error";

export type VoiceTurn = { role: "user" | "assistant"; content: string };

export type UseVoiceCallOptions = {
  conversationId: string | null;
  enabled: boolean;
  chatHistory: VoiceTurn[];
  systemPrompt: string;
  temperature?: number;
  /** Test Mode: Fish STT -> Fish TTS echo, DeepSeek never called. */
  testMode: boolean;
  onTurn?: (turn: { userText: string; assistantText: string }) => void;
};

const MAX_CAPTION_LINES = 3;

export function useVoiceCall(options: UseVoiceCallOptions) {
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const [active, setActive] = useState(false);
  const [status, setStatus] = useState<VoiceCallStatus>("idle");
  const [muted, setMuted] = useState(false);
  const [micLevel, setMicLevel] = useState(0);
  const [botLevel, setBotLevel] = useState(0);
  const [partialTranscript, setPartialTranscript] = useState("");
  const [captionLines, setCaptionLines] = useState<string[]>([]);
  const [turns, setTurns] = useState<VoiceTurn[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  const clientRef = useRef<PipecatClient | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const bargeInsRef = useRef(0);
  const reconnectsRef = useRef(0);
  const pendingUserTextRef = useRef("");
  const pendingAssistantTextRef = useRef("");
  const pendingLlmTextRef = useRef("");
  const receivedTtsTextRef = useRef(false);
  const statusRef = useRef<VoiceCallStatus>("idle");
  const everConnectedRef = useRef(false);
  const turnsRef = useRef<VoiceTurn[]>([]);

  const appendCaption = useCallback((chunk: string) => {
    if (!chunk) return;
    setCaptionLines((prev) => {
      const merged = [...prev];
      // Providers are not required to emit onBotLlmStarted before their first
      // text token. Do not write to array[-1] in that case: it silently loses
      // the first caption and makes a healthy call look mute.
      const index = Math.max(0, merged.length - 1);
      merged[index] = `${merged[index] ?? ""}${chunk}`;
      return merged.slice(-MAX_CAPTION_LINES);
    });
  }, []);

  const commitTurn = useCallback(() => {
    const userText = pendingUserTextRef.current.trim();
    const assistantText = pendingAssistantTextRef.current.trim();
    if (userText && assistantText) {
      const next = [...turnsRef.current, { role: "user" as const, content: userText }, { role: "assistant" as const, content: assistantText }];
      // Keep the telemetry source synchronous with UI state. endCall() can
      // run in the same React turn as this commit, before a state setter has
      // been flushed.
      turnsRef.current = next;
      setTurns(next);
      optionsRef.current.onTurn?.({ userText, assistantText });
    }
    pendingUserTextRef.current = "";
    pendingAssistantTextRef.current = "";
  }, []);

  const teardownClient = useCallback(async () => {
    const client = clientRef.current;
    clientRef.current = null;
    if (client) {
      try {
        await client.disconnect();
      } catch {
        // Already gone; nothing to clean up.
      }
    }
  }, []);

  const endCall = useCallback(async () => {
    commitTurn();
    await teardownClient();
    const sessionId = sessionIdRef.current;
    sessionIdRef.current = null;
    setActive(false);
    setStatus("idle");
    setElapsedSeconds(0);
    setPartialTranscript("");
    setCaptionLines([]);
    if (sessionId) {
      // Telemetry must never hold the user hostage on the call screen. A
      // network outage is exactly when End needs to be immediate; the server
      // also cleans abandoned sessions on its own timeout.
      void fetch("/voice/end", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sessionId,
            history: turnsRef.current,
            bargeIns: bargeInsRef.current,
            reconnects: reconnectsRef.current,
          }),
          signal: AbortSignal.timeout(5_000),
        }).catch(() => undefined);
    }
  }, [commitTurn, teardownClient, turns]);

  const startCall = useCallback(async () => {
    if (!optionsRef.current.enabled || clientRef.current) return;
    setError(null);
    setStatus("connecting");
    setActive(true);
    pendingUserTextRef.current = "";
    pendingAssistantTextRef.current = "";
    setCaptionLines([]);
    setTurns([]);
    turnsRef.current = [];
    setElapsedSeconds(0);
    bargeInsRef.current = 0;
    reconnectsRef.current = 0;

    try {
      // Avoid asking for microphone access and then opening a call surface
      // that can only fail because its required STT/TTS provider is absent.
      // Test mode still uses Fish STT/TTS, so it has the same prerequisite.
      const configResponse = await fetch("/api/voice/config", { signal: AbortSignal.timeout(5_000) });
      const config = await configResponse.json().catch(() => null) as { enabled?: boolean; fishConfigured?: boolean } | null;
      if (!configResponse.ok || !config?.enabled) {
        throw new Error("Voice calling is unavailable on this Clyra installation.");
      }
      if (!config.fishConfigured) {
        throw new Error("Voice needs Fish Audio STT and TTS to be configured before a call can start.");
      }
      const sessionResponse = await fetch("/voice/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationId: optionsRef.current.conversationId,
          history: optionsRef.current.chatHistory,
          systemPrompt: optionsRef.current.systemPrompt,
          temperature: optionsRef.current.temperature,
        }),
      });
      const session = await sessionResponse.json();
      if (!session?.ok) throw new Error(session?.error || "Could not start voice session.");
      sessionIdRef.current = session.sessionId;

      const client = new PipecatClient({
        transport: new SmallWebRTCTransport(),
        enableMic: true,
        enableCam: false,
        callbacks: {
          onBotReady: () => setStatus("listening"),
          onUserStartedSpeaking: () => {
            if (statusRef.current === "speaking") bargeInsRef.current += 1;
            setStatus("listening");
            setPartialTranscript("");
          },
          onUserStoppedSpeaking: () => setStatus("thinking"),
          onBotLlmStarted: () => {
            setStatus("thinking");
            pendingAssistantTextRef.current = "";
            pendingLlmTextRef.current = "";
            receivedTtsTextRef.current = false;
            setCaptionLines((prev) => [...prev, ""]);
          },
          onBotStartedSpeaking: () => setStatus("speaking"),
          onBotStoppedSpeaking: () => {
            // TTS is the canonical spoken text. Some providers do not emit
            // it, however, so use the completed LLM text only after speech
            // finishes rather than committing a half-built assistant turn.
            if (!receivedTtsTextRef.current && pendingLlmTextRef.current.trim()) {
              pendingAssistantTextRef.current = pendingLlmTextRef.current;
              appendCaption(pendingLlmTextRef.current);
            }
            commitTurn();
            setStatus("listening");
          },
          onUserTranscript: (data: TranscriptData) => {
            if (data.final) {
              // Repeated final events are common during WebRTC reconnects;
              // replace the in-progress utterance instead of duplicating it.
              pendingUserTextRef.current = data.text.trim();
              setPartialTranscript("");
            } else {
              setPartialTranscript(data.text);
            }
          },
          onBotTtsText: (data: BotTTSTextData) => {
            receivedTtsTextRef.current = true;
            pendingAssistantTextRef.current += data.text;
            appendCaption(data.text);
          },
          onBotLlmText: (data: BotLLMTextData) => {
            // Keep a fallback transcript but do not render it beside TTS: a
            // provider can emit both streams and displaying both doubles the
            // caption. onBotStoppedSpeaking selects this only when no TTS
            // text arrived.
            pendingLlmTextRef.current += data.text;
          },
          onBotLlmStopped: () => {
            // The LLM can finish before TTS playback. Finalisation belongs to
            // onBotStoppedSpeaking so the saved Chat turn is the full answer.
          },
          onError: (message) => {
            const data = message?.data as { message?: string } | undefined;
            setError(data?.message || "Voice call error.");
          },
          onDisconnected: () => {
            // teardownClient() nulls clientRef *before* calling disconnect(),
            // so an intentional End Call has already cleared the ref by the
            // time this fires — clientRef.current === client here means the
            // transport dropped on its own (exhausted its retries) while the
            // user still expected to be on the call. Previously this just set
            // status to "idle", leaving the full-screen call UI open forever
            // with no explanation of what happened. Surface it as a clear
            // error and leave "End call" as the way to dismiss, rather than
            // yanking the overlay closed out from under the user.
            if (clientRef.current === client) {
              clientRef.current = null;
              setError("Voice call disconnected. Tap End Call to close, or start a new call.");
              setStatus("error");
              const sessionId = sessionIdRef.current;
              sessionIdRef.current = null;
              if (sessionId) {
                void fetch("/voice/end", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    sessionId,
                    history: turnsRef.current,
                    bargeIns: bargeInsRef.current,
                    reconnects: reconnectsRef.current,
                    endedReason: "connection-lost",
                  }),
                }).catch(() => undefined);
              }
            } else {
              setStatus("idle");
            }
          },
          onTransportStateChanged: (state) => {
            if (state === "connected" || state === "ready") everConnectedRef.current = true;
            if ((state === "connecting" || state === "authenticating") && everConnectedRef.current) {
              reconnectsRef.current += 1;
              setStatus("reconnecting");
            } else if (state === "connecting" || state === "authenticating") {
              setStatus("connecting");
            }
          },
        },
      });

      client.on(RTVIEvent.LocalAudioLevel, (level: number) => setMicLevel(level));
      client.on(RTVIEvent.RemoteAudioLevel, (level: number) => setBotLevel(level));

      clientRef.current = client;
      await client.connect({
        webrtcRequestParams: {
          endpoint: "/voice/offer",
          requestData: {
            sessionId: session.sessionId,
            testMode: optionsRef.current.testMode,
          },
        },
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Voice call failed to start.");
      setStatus("error");
      await teardownClient();
    }
  }, [appendCaption, commitTurn, teardownClient]);

  const toggleMute = useCallback(() => {
    const client = clientRef.current;
    if (!client) return;
    const next = !muted;
    client.enableMic(!next);
    setMuted(next);
  }, [muted]);

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  useEffect(() => {
    turnsRef.current = turns;
  }, [turns]);

  useEffect(() => {
    if (!active) return;
    const startedAt = Date.now();
    const tick = () => setElapsedSeconds(Math.floor((Date.now() - startedAt) / 1000));
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [active]);

  useEffect(() => {
    return () => {
      void teardownClient();
    };
  }, [teardownClient]);

  return {
    active,
    status,
    muted,
    micLevel,
    botLevel,
    partialTranscript,
    captionLines,
    turns,
    elapsedSeconds,
    error,
    startCall,
    endCall,
    toggleMute,
  };
}
