import { useCallback, useEffect, useRef } from "react";
import { getElectronDesktop } from "../lib/electron-runtime";
import { formatApiError } from "../lib/utils";
import { inferContext, routeSpeechIntent } from "../speech";
import { VoicePcmCapturer } from "../lib/voicePcmCapture";
import {
  remainingVoiceSilenceMs,
  VOICE_MIN_UTTERANCE_MS,
  VOICE_SPEECH_LEVEL,
  VOICE_TRAILING_SILENCE_MS,
} from "../lib/voiceTurnDetection";

type DictationTarget = { application?: string; selectedText?: string };
type DictationMode = "normal" | "replace" | "optimise";

type ActiveDictation = {
  target: DictationTarget;
  mode: DictationMode;
  sessionId: string;
  socket: WebSocket;
  capture: VoicePcmCapturer | null;
  rawTranscript: string;
  startedAt: number;
};

const CLEANUP_KEY = "clyra-dictation-cleanup";
const DICTIONARY_KEY = "clyra-dictation-dictionary";
const HISTORY_KEY = "clyra-dictation-history";
const SOUND_KEY = "clyra-dictation-sound";
const MAX_MANUAL_MS = 5 * 60_000;

/** Sound effects default on; set localStorage "clyra-dictation-sound" to "off" to mute. */
function soundEnabled() {
  try { return localStorage.getItem(SOUND_KEY) !== "off"; } catch { return true; }
}

function readCleanupLevel() {
  const stored = localStorage.getItem(CLEANUP_KEY);
  return stored === "raw" || stored === "polished" ? stored : "light";
}

function readDictionary() {
  try {
    const values = JSON.parse(localStorage.getItem(DICTIONARY_KEY) || "[]");
    return Array.isArray(values) ? values.map(String).filter(Boolean).slice(0, 80) : [];
  } catch {
    return [];
  }
}

function saveHistory(entry: Record<string, unknown>) {
  try {
    const current = JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
    const history = Array.isArray(current) ? current : [];
    localStorage.setItem(HISTORY_KEY, JSON.stringify([entry, ...history].slice(0, 80)));
  } catch {
    // Dictation must still complete when local history is unavailable.
  }
}

const wait = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

function micSettingsAppLabel() {
  // TCC lists the binary name: Electron during desktop:dev, Clyra when packaged.
  return "Electron / Clyra";
}

function openOsMicrophoneSettings() {
  void getElectronDesktop()?.dictation.openMicrophoneSettings?.().catch(() => undefined);
}

function userFacingDictationError(error: unknown) {
  // Electron prefixes IPC failures with "Error invoking remote method '…': Error:".
  const message = (error instanceof Error ? error.message : String(error || "")).replace(/^Error invoking remote method '[^']+': (Error: )?/, "");
  if (/failed to fetch|networkerror|load failed/i.test(message)) {
    return "Clyra's local voice service is still starting. Try again in a moment.";
  }
  if (/notallowederror|permission denied|microphone|not-allowed/i.test(message)) {
    openOsMicrophoneSettings();
    return `Microphone access is blocked. Opening settings so you can enable ${micSettingsAppLabel()}.`;
  }
  if (/accessibility/i.test(message)) {
    return message;
  }
  return message || "Clyra dictation could not start.";
}

function microphoneDeniedMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || "");
  openOsMicrophoneSettings();
  if (/notallowederror|permission|denied|dismissed|not-allowed/i.test(message) || !message) {
    return `Microphone access is blocked. Opening settings so you can enable ${micSettingsAppLabel()}.`;
  }
  return message;
}

export function DictationController() {
  const activeRef = useRef<ActiveDictation | null>(null);
  const previewRef = useRef<{ text: string; target: DictationTarget; raw: string; startedAt: number } | null>(null);
  const lastLevelAtRef = useRef(0);
  const silenceTimerRef = useRef<number | null>(null);
  const heardSpeechRef = useRef(false);
  const lastSpeechAtRef = useRef(0);
  const speechStartedAtRef = useRef(0);
  const pipelineRetryRef = useRef(0);
  const manualRef = useRef(false);
  const startingRef = useRef(false);
  const socketReadyRef = useRef(false);
  const flushWhenReadyRef = useRef(false);
  const bufferRef = useRef<{ data: string; seq: number }[]>([]);
  const pendingStopRef = useRef(false);
  const maxTimerRef = useRef<number | null>(null);
  const stopRef = useRef<() => void>(() => undefined);
  const startRef = useRef<(mode: DictationMode, target: DictationTarget, manual?: boolean) => Promise<void>>(async () => undefined);

  const clearSilenceTimer = useCallback(() => {
    if (maxTimerRef.current != null) { window.clearTimeout(maxTimerRef.current); maxTimerRef.current = null; }
    if (silenceTimerRef.current != null) {
      window.clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
  }, []);

  const updateNative = useCallback((payload: Record<string, unknown>) => {
    void getElectronDesktop()?.dictation.setState({ ...payload, sound: soundEnabled() }).catch(() => undefined);
  }, []);

  const serviceUrl = useCallback(async (pathname: string) => {
    const desktop = getElectronDesktop();
    const origin = await desktop?.dictation.serviceUrl().catch(() => "") || window.location.origin;
    return new URL(pathname, origin).toString();
  }, []);

  const postJson = useCallback(async (pathname: string, body: Record<string, unknown>) => {
    let lastError: unknown;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const response = await fetch(await serviceUrl(pathname), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || !payload?.ok) {
          throw new Error(formatApiError(payload?.error, `Clyra request failed (${response.status}).`));
        }
        return payload;
      } catch (error) {
        lastError = error;
        if (attempt === 0) await wait(650);
      }
    }
    throw lastError;
  }, [serviceUrl]);

  const release = useCallback(() => {
    clearSilenceTimer();
    startingRef.current = false;
    socketReadyRef.current = false;
    flushWhenReadyRef.current = false;
    bufferRef.current = [];
    const active = activeRef.current;
    if (!active) return;
    active.capture?.stop();
    try { active.socket.close(); } catch { /* already closed */ }
    activeRef.current = null;
  }, [clearSilenceTimer]);

  const cancel = useCallback(() => {
    release();
    previewRef.current = null;
    pipelineRetryRef.current = 0;
    updateNative({ phase: "idle", detail: "" });
  }, [release, updateNative]);

  const insert = useCallback(async (text: string, target: DictationTarget, raw: string, startedAt: number) => {
    const desktop = getElectronDesktop();
    if (!desktop) return;
    try {
      const result = await desktop.dictation.insert({ text, target });
      saveHistory({ original: target.selectedText || "", raw, inserted: text, application: target.application || "", at: Date.now(), durationMs: Date.now() - startedAt });
      const copiedOnly = result?.method === "clipboard-only";
      updateNative({ phase: "done", detail: copiedOnly ? String(result?.note || "Copied — press ⌘V to paste") : "Inserted" });
      window.setTimeout(() => updateNative({ phase: "idle", detail: "" }), copiedOnly ? 3200 : 850);
    } catch (error) {
      updateNative({ phase: "error", detail: userFacingDictationError(error) });
    }
  }, [updateNative]);

  const finishTranscript = useCallback(async (active: ActiveDictation, transcript: string) => {
    const raw = transcript.trim();
    if (!raw) {
      updateNative({ phase: "error", detail: "No speech was detected. Click the mic area and try again." });
      return;
    }
    // Spoken commands: "cancel" aborts, and with text selected, "make this
    // shorter" / "turn this into bullets" becomes a rewrite without a mode switch.
    const routed = routeSpeechIntent(raw, inferContext({ application: active.target.application, selectedText: active.target.selectedText }));
    if (routed.intent === "CANCEL") { cancel(); return; }
    const spokenRewrite = active.mode === "normal" && Boolean(active.target.selectedText?.trim()) && ["REWRITE_SELECTION", "FORMAT_TEXT", "REPLACE_TEXT", "DELETE_TEXT"].includes(routed.intent);
    if (active.mode === "optimise" || spokenRewrite) {
      updateNative({ phase: "optimising", detail: "Preparing rewrite" });
      try {
        const payload = await postJson("/api/dictation/optimise", { selectedText: active.target.selectedText, instruction: spokenRewrite ? routed.instruction : raw });
        previewRef.current = { text: String(payload.text), target: active.target, raw, startedAt: active.startedAt };
        updateNative({ phase: "preview", preview: String(payload.text).slice(0, 240), detail: "Review before replacing" });
      } catch (error) {
        updateNative({ phase: "error", detail: userFacingDictationError(error) });
      }
      return;
    }
    updateNative({ phase: "processing", detail: "Cleaning up" });
    try {
      const payload = await postJson("/api/dictation/cleanup", { transcript: raw, level: readCleanupLevel(), dictionary: readDictionary(), application: active.target.application || "" });
      await insert(String(payload.text || raw), active.target, raw, active.startedAt);
    } catch (error) {
      updateNative({ phase: "error", detail: userFacingDictationError(error) });
    }
  }, [cancel, insert, postJson, updateNative]);

  const start = useCallback(async (mode: DictationMode, target: DictationTarget, manual = false) => {
    release();
    manualRef.current = manual;
    startingRef.current = true;
    pendingStopRef.current = false;
    previewRef.current = null;
    heardSpeechRef.current = false;
    lastSpeechAtRef.current = 0;
    speechStartedAtRef.current = 0;
    // "arming" until the microphone is genuinely capturing: the pill, the start
    // sound and the user's first word all line up with the mic going live.
    updateNative({ phase: "arming", detail: "", application: target.application || "" });
    try {
      const desktop = getElectronDesktop();
      const permissions = await desktop?.dictation.ensurePermissions?.().catch(() => null);
      if (permissions && permissions.ok === false) {
        // Main process already opens OS settings; call again as a safety net
        // when IPC returned before the Settings pane finished launching.
        openOsMicrophoneSettings();
        updateNative({
          phase: "error",
          detail: String(permissions.error || `Microphone access is blocked. Enable ${micSettingsAppLabel()} in system settings.`),
        });
        return;
      }

      // Capture FIRST and buffer locally while the session/socket connect, so
      // no opening words are lost to setup latency (previously ~1-2s).
      socketReadyRef.current = false;
      flushWhenReadyRef.current = false;
      bufferRef.current = [];
      const pendingSocket = { readyState: WebSocket.CONNECTING, send() {}, close() {} } as unknown as WebSocket;
      const active: ActiveDictation = { target, mode, sessionId: "", socket: pendingSocket, capture: null, rawTranscript: "", startedAt: Date.now() };
      activeRef.current = active;
      const capture = new VoicePcmCapturer((data, seq) => {
        if (activeRef.current === active && socketReadyRef.current && active.socket.readyState === WebSocket.OPEN) {
          active.socket.send(JSON.stringify({ type: "audio", sessionId: active.sessionId, codec: "pcm16", data, seq }));
        } else {
          bufferRef.current.push({ data, seq });
        }
      }, 16_000, (level) => {
        const now = performance.now();
        if (now - lastLevelAtRef.current < 100) return;
        lastLevelAtRef.current = now;
        if (!startingRef.current) updateNative({ phase: "listening", level: Math.max(0, Math.min(1, level)) });
        if (level >= VOICE_SPEECH_LEVEL) {
          if (!heardSpeechRef.current) speechStartedAtRef.current = now;
          heardSpeechRef.current = true;
          lastSpeechAtRef.current = now;
          clearSilenceTimer();
          return;
        }
        // Hotkey sessions end only when the user says so (release / tap /
        // stop button), like Wispr Flow, so a thinking pause never cuts them off.
        if (manualRef.current) return;
        if (!heardSpeechRef.current || silenceTimerRef.current != null) return;
        // Require a short real utterance, then use a slightly longer
        // trailing pause. This avoids cutting off the first word while
        // still handing a finished sentence to transcription promptly.
        if (now - speechStartedAtRef.current < VOICE_MIN_UTTERANCE_MS) return;
        const remaining = remainingVoiceSilenceMs(lastSpeechAtRef.current, now);
        silenceTimerRef.current = window.setTimeout(() => {
          silenceTimerRef.current = null;
          const current = activeRef.current;
          if (!current || !heardSpeechRef.current) return;
          if (performance.now() - lastSpeechAtRef.current < VOICE_TRAILING_SILENCE_MS) return;
          heardSpeechRef.current = false;
          stopRef.current();
        }, remaining);
      });
      active.capture = capture;
      if (manualRef.current && maxTimerRef.current == null) maxTimerRef.current = window.setTimeout(() => { maxTimerRef.current = null; stopRef.current(); }, MAX_MANUAL_MS);
      void capture.start().then(() => {
        if (activeRef.current !== active) return;
        startingRef.current = false;
        updateNative({ phase: mode === "optimise" ? "optimising" : "listening", detail: mode === "optimise" ? "Tell Clyra how to rewrite this" : "Listening", application: target.application || "", level: 0 });
        if (pendingStopRef.current) { pendingStopRef.current = false; stopRef.current(); }
      }).catch((error) => {
        startingRef.current = false;
        updateNative({ phase: "error", detail: microphoneDeniedMessage(error) });
        release();
      });

      const session = await postJson("/voice/session", { mode: "dictation", history: [] });
      if (activeRef.current !== active) return; // cancelled while connecting
      active.sessionId = session.sessionId;
      const socket = new WebSocket(session.websocketUrl);
      active.socket = socket;
      socket.onmessage = (event) => {
        try {
          const message = JSON.parse(String(event.data));
          if (activeRef.current !== active) return;
          if (message.type === "pipeline_mode" && message.mode === "pipeline") {
            pipelineRetryRef.current = 0;
            socketReadyRef.current = true;
            for (const chunk of bufferRef.current.splice(0)) {
              socket.send(JSON.stringify({ type: "audio", sessionId: active.sessionId, codec: "pcm16", data: chunk.data, seq: chunk.seq }));
            }
            if (flushWhenReadyRef.current) {
              flushWhenReadyRef.current = false;
              socket.send(JSON.stringify({ type: "flush", sessionId: active.sessionId }));
            }
          } else if (message.type === "pipeline_mode" && message.mode !== "pipeline") {
            // Local Faster-Whisper often needs a short warmup after launch.
            // One automatic retry avoids a false "needs attention" flash.
            if (pipelineRetryRef.current < 1) {
              pipelineRetryRef.current += 1;
              release();
              updateNative({ phase: "processing", detail: "Starting speech engine" });
              void wait(900).then(() => {
                void startRef.current(mode, target, manual);
              });
              return;
            }
            pipelineRetryRef.current = 0;
            updateNative({
              phase: "error",
              detail: "Clyra's speech engine isn't ready yet. Keep the app open for a moment, then try the dictation hotkey again.",
            });
            release();
          } else if (message.type === "transcript_partial") {
            updateNative({ phase: "listening", detail: String(message.text || "Listening").slice(0, 120) });
          } else if (message.type === "dictation_final") {
            active.rawTranscript = String(message.text || "");
            active.capture?.stop();
            try { active.socket.close(); } catch { /* ignore */ }
            activeRef.current = null;
            void finishTranscript(active, active.rawTranscript);
          } else if (message.type === "error") {
            updateNative({ phase: "error", detail: String(message.message || "Clyra dictation failed.") });
            release();
          }
        } catch {
          // Ignore malformed status frames; the active session remains usable.
        }
      };
      socket.onerror = () => {
        if (activeRef.current === active) updateNative({ phase: "error", detail: "Clyra dictation connection failed." });
      };
    } catch (error) {
      updateNative({ phase: "error", detail: userFacingDictationError(error) });
    }
  }, [clearSilenceTimer, finishTranscript, postJson, release, updateNative]);

  startRef.current = start;

  const stop = useCallback(() => {
    const active = activeRef.current;
    if (!active || startingRef.current) {
      if (startingRef.current) pendingStopRef.current = true;
      return;
    }
    clearSilenceTimer();
    heardSpeechRef.current = false;
    updateNative({ phase: "processing", detail: "Transcribing" });
    active.capture?.stop();
    active.capture = null;
    if (socketReadyRef.current && active.socket.readyState === WebSocket.OPEN) active.socket.send(JSON.stringify({ type: "flush", sessionId: active.sessionId }));
    else flushWhenReadyRef.current = true; // socket still connecting: flush right after buffered audio is sent
  }, [clearSilenceTimer, updateNative]);

  stopRef.current = stop;

  useEffect(() => {
    const desktop = getElectronDesktop();
    if (!desktop) return;
    const removeTrigger = desktop.dictation.onTrigger((event) => {
      if (event?.type === "start") void start("normal", event.target || {}, Boolean(event.manual));
      else if (event?.type === "target") { if (activeRef.current) Object.assign(activeRef.current.target, event.target || {}); }
      else if (event?.type === "stop") stop();
      else if (event?.type === "cancel") cancel();
    });
    const removeAction = desktop.dictation.onAction((event) => {
      const target = event?.target || {};
      if (event?.action === "replace") void start("replace", target);
      else if (event?.action === "optimise" || event?.action === "enhance") void start("optimise", target);
      else if (event?.action === "try-again") void start("optimise", previewRef.current?.target || target);
      else if (event?.action === "replace-preview" && previewRef.current) {
        const preview = previewRef.current;
        void insert(preview.text, preview.target, preview.raw, preview.startedAt);
      } else if (event?.action === "copy" && previewRef.current) {
        void navigator.clipboard.writeText(previewRef.current.text).then(() => updateNative({ phase: "preview", preview: previewRef.current?.text.slice(0, 240), detail: "Copied" }));
      } else if (event?.action === "stop") stop();
      else if (event?.action === "cancel") cancel();
    });
    return () => { removeTrigger(); removeAction(); release(); };
  }, [cancel, insert, release, start, stop, updateNative]);

  // Tell the desktop shell this renderer can run dictation (so the hotkey uses the
  // full Clyra experience) and keep its standalone fallback in sync with the user's
  // cleanup level and dictionary. When this component is not mounted, the shell's
  // own always-on pipeline handles the hotkey instead.
  useEffect(() => {
    const desktop = getElectronDesktop();
    if (!desktop?.dictation) return;
    void desktop.dictation.syncSettings?.({ level: readCleanupLevel(), dictionary: readDictionary() }).catch(() => undefined);
    void desktop.dictation.setRendererReady?.(true).catch(() => undefined);
    return () => { void desktop.dictation.setRendererReady?.(false).catch(() => undefined); };
  }, []);

  // Electron's global shortcut remains the system-wide path. This focused-app
  // fallback covers the rare macOS case where another accessibility utility
  // temporarily owns the dictation shortcut, so Clyra's own composer never feels dead.
  useEffect(() => {
    const desktop = getElectronDesktop();
    if (!desktop?.dictation.toggle) return;
    let useFocusedFallback = false;
    void desktop.dictation.shortcutStatus?.().then((status) => { useFocusedFallback = !status.registered; }).catch(() => { useFocusedFallback = true; });
    const onKeyDown = (event: KeyboardEvent) => {
      if (!useFocusedFallback) return;
      if (!(event.metaKey || event.ctrlKey) || !event.shiftKey || event.key.toLowerCase() !== "k") return;
      event.preventDefault();
      void desktop.dictation.toggle?.();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, []);

  return null;
}
