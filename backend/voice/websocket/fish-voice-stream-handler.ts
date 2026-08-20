import type { Server as HttpServer } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import { buildVoiceSystemPrompt } from "../../../lib/clyraVoicePrompt";
import { prepareDeepseekChatBody } from "../../../lib/deepseek-models";
import { recordApiUsage, usageFromOpenAi } from "../../../lib/api-usage-ledger.mjs";
import { nextSemanticPhrase, normalizeSpokenText } from "../../../src/lib/voiceSpeech";
import { encodeVoicePcmPacket } from "../../../src/lib/voicePcmPacket";
import { loadVoiceConfig } from "../config";
import { voiceMetrics } from "../metrics/voice-metrics";
import { AsyncSttSession } from "../async/async-stt-session";
import {
  FishSpeechRecognizer,
  FishStreamingSpeechSynthesizer,
  loadFishSpeechConfig,
} from "../providers/fish-speech";
import { voiceSessions } from "../session/voice-session-manager";
import {
  encodeVoiceServerMessage,
  parseVoiceClientMessage,
  type VoiceServerMessage,
} from "./voice-stream-protocol";

type ActiveCall = {
  ws: WebSocket;
  sessionId: string;
  generation: number;
  responseId: string;
  abort: AbortController;
  recognizer: FishSpeechRecognizer;
  streamingRecognizer: AsyncSttSession | null;
  streamingSttQueue: Promise<void>;
  streamingSttFailed: boolean;
  streamingTranscript: string;
  synthesizer: FishStreamingSpeechSynthesizer | null;
  audio: Buffer[];
  audioBytes: number;
  vadSpeechMs: number;
  vadSilenceMs: number;
  vadHeardSpeech: boolean;
  endpointing: boolean;
  busy: boolean;
  playbackHold: boolean;
  muted: boolean;
  ttsSequence: number;
  ttsFormatSent: boolean;
  spokenCharacters: number;
  selectedVoiceId: string;
};

const calls = new Map<string, ActiveCall>();
const MAX_UTTERANCE_BYTES = 16_000 * 2 * 45;
const SERVER_VAD_SPEECH_LEVEL = 0.018;
const SERVER_VAD_MIN_SPEECH_MS = 180;
const SERVER_VAD_TRAILING_MS = 480;

function pcm16Rms(chunk: Buffer) {
  if (chunk.length < 2) return 0;
  let sum = 0;
  const samples = Math.floor(chunk.length / 2);
  for (let offset = 0; offset + 1 < chunk.length; offset += 2) {
    const value = chunk.readInt16LE(offset) / 32768;
    sum += value * value;
  }
  return Math.sqrt(sum / Math.max(1, samples));
}

function resetServerVad(active: ActiveCall) {
  active.vadSpeechMs = 0;
  active.vadSilenceMs = 0;
  active.vadHeardSpeech = false;
  active.endpointing = false;
}

/**
 * The renderer still sends an explicit flush for the fastest endpoint, but a
 * call must not depend on animation/meter cadence to finish a spoken turn.
 * This server-side safety VAD makes real microphone speech self-finalising in
 * throttled Chromium windows and on machines with unusual input gain.
 */
function observeServerVad(active: ActiveCall, chunk: Buffer, sampleRate: number) {
  if (active.endpointing || active.busy || active.playbackHold || active.muted) return;
  const durationMs = (chunk.length / 2 / Math.max(1, sampleRate)) * 1_000;
  if (pcm16Rms(chunk) >= SERVER_VAD_SPEECH_LEVEL) {
    active.vadSpeechMs += durationMs;
    active.vadSilenceMs = 0;
    if (active.vadSpeechMs >= SERVER_VAD_MIN_SPEECH_MS) active.vadHeardSpeech = true;
    return;
  }
  if (!active.vadHeardSpeech) {
    active.vadSpeechMs = Math.max(0, active.vadSpeechMs - durationMs * 1.5);
    return;
  }
  active.vadSilenceMs += durationMs;
  if (active.vadSilenceMs < SERVER_VAD_TRAILING_MS) return;
  active.endpointing = true;
  queueMicrotask(() => void transcribeBufferedTurn(active));
}

function armStreamingRecognizer(active: ActiveCall) {
  active.streamingRecognizer?.close();
  active.streamingRecognizer = null;
  active.streamingSttQueue = Promise.resolve();
  active.streamingSttFailed = false;
  active.streamingTranscript = "";
  const config = loadVoiceConfig();
  if (!config.asyncSttEnabled) return;
  const recognizer = new AsyncSttSession({
    apiKey: config.asyncApiKey,
    modelId: config.asyncSttModel,
    sampleRate: config.sampleRate,
    onPartial: (text) => {
      if (calls.get(active.sessionId) !== active || active.streamingRecognizer !== recognizer) return;
      active.streamingTranscript = text;
      send(active.ws, { type: "transcript_partial", sessionId: active.sessionId, text, confidence: 0.9 });
    },
    onFinal: (text) => { active.streamingTranscript = text; },
    onError: () => {
      if (calls.get(active.sessionId) === active && active.streamingRecognizer === recognizer) {
        active.streamingSttFailed = true;
      }
    },
  });
  active.streamingRecognizer = recognizer;
  // Warm the ASR socket while the caller is listening. Failure is deliberately
  // silent here because Fish batch ASR remains the automatic fallback.
  void recognizer.start().catch(() => {
    if (calls.get(active.sessionId) === active && active.streamingRecognizer === recognizer) {
      active.streamingSttFailed = true;
    }
  });
}

function send(ws: WebSocket, message: VoiceServerMessage) {
  if (ws.readyState === ws.OPEN) ws.send(encodeVoiceServerMessage(message));
}

function friendlyProviderError(error: unknown) {
  const raw = error instanceof Error ? error.message : String(error);
  if (/401|unauthor|api key|authentication/i.test(raw)) return "Voice isn't configured correctly on this Clyra server.";
  if (/402|credit|balance/i.test(raw)) return "Voice is temporarily unavailable for this account.";
  if (/429|rate limit/i.test(raw)) return "Voice is busy right now. Try again in a moment.";
  if (/network|fetch|socket|connect|timeout/i.test(raw)) return "I couldn't connect to Voice. Check your connection and try again.";
  return "Voice hit a problem. Try again.";
}

async function streamClyraReply(
  sessionId: string,
  prompt: string,
  history: Array<{ role: "user" | "assistant"; content: string }>,
  onToken: (token: string) => void,
  signal: AbortSignal,
) {
  const config = loadVoiceConfig();
  const session = voiceSessions.get(sessionId);
  if (!config.llmApiKey) throw new Error("Clyra's language model is not configured.");
  const body = prepareDeepseekChatBody({
    model: config.llmModel,
    temperature: session?.temperature ?? config.temperature,
    max_tokens: Math.min(Math.max(config.maxTokens, 96), 220),
    stream: true,
    messages: [
      { role: "system", content: session?.systemPrompt?.trim() || buildVoiceSystemPrompt() },
      ...history.slice(-8).map((message) => ({
        ...message,
        content: message.content.slice(0, 1_500),
      })),
      { role: "user", content: prompt },
    ],
  });
  Object.assign(body, { stream_options: { include_usage: true } });
  const startedAt = Date.now();
  const response = await fetch(`${config.llmBaseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.llmApiKey}` },
    body: JSON.stringify(body),
    signal,
  });
  if (!response.ok) throw new Error(`Clyra response failed (${response.status}).`);
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Clyra response stream is unavailable.");
  const decoder = new TextDecoder();
  let buffer = "";
  let sawToken = false;
  let usageRecorded = false;
  while (!signal.aborted) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (const line of lines) {
      const payload = line.trim().replace(/^data:\s*/, "");
      if (!payload || payload === "[DONE]" || !line.trim().startsWith("data:")) continue;
      try {
        const json = JSON.parse(payload) as {
          model?: string;
          usage?: Record<string, unknown>;
          choices?: Array<{ delta?: { content?: string } }>;
        };
        if (json.usage && !usageRecorded) {
          usageRecorded = true;
          void recordApiUsage({
            provider: /api\.openai\.com/i.test(config.llmBaseUrl) ? "openai" : "deepseek",
            model: json.model || config.llmModel,
            feature: "voice-assistant",
            usage: usageFromOpenAi(json),
          }).catch(() => undefined);
        }
        const token = json.choices?.[0]?.delta?.content;
        if (token) {
          if (!sawToken) voiceMetrics.record(sessionId, "llm_token", Date.now() - startedAt);
          sawToken = true;
          onToken(token);
        }
      } catch { /* ignore malformed SSE records */ }
    }
  }
}

function resetForListening(active: ActiveCall) {
  active.audio = [];
  active.audioBytes = 0;
  resetServerVad(active);
  active.busy = false;
  active.playbackHold = false;
  armStreamingRecognizer(active);
  voiceSessions.update(active.sessionId, { status: "listening" });
  send(active.ws, { type: "status", sessionId: active.sessionId, status: "listening" });
}

function cancelGeneration(active: ActiveCall) {
  active.abort.abort();
  active.synthesizer?.cancel();
  active.synthesizer = null;
  active.generation += 1;
  active.ttsSequence = 0;
  active.ttsFormatSent = false;
  active.spokenCharacters = 0;
}

async function answerTurn(active: ActiveCall, text: string) {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean || active.busy || active.playbackHold) return;
  const session = voiceSessions.get(active.sessionId);
  if (!session) return;
  if (session.mode === "dictation") {
    voiceSessions.appendMessage(active.sessionId, "user", clean);
    send(active.ws, { type: "dictation_final", sessionId: active.sessionId, text: clean, confidence: 0.92 });
    resetForListening(active);
    return;
  }

  active.busy = true;
  active.playbackHold = true;
  active.abort = new AbortController();
  active.generation += 1;
  const generation = active.generation;
  active.responseId = `${active.sessionId}-${generation}-${Date.now()}`;
  active.ttsSequence = 0;
  active.ttsFormatSent = false;
  active.spokenCharacters = 0;
  const history = [...session.messages];
  voiceSessions.appendMessage(active.sessionId, "user", clean);
  voiceSessions.update(active.sessionId, { status: "thinking" });
  send(active.ws, { type: "transcript_final", sessionId: active.sessionId, text: clean, confidence: 0.92 });
  send(active.ws, { type: "status", sessionId: active.sessionId, status: "thinking" });

  const fish = loadFishSpeechConfig();
  const synthesizer = new FishStreamingSpeechSynthesizer(fish, {
    onAudio: (chunk) => {
      const current = calls.get(active.sessionId);
      if (current !== active || current.generation !== generation || current.abort.signal.aborted) return;
      if (!current.ttsFormatSent) {
        current.ttsFormatSent = true;
        send(current.ws, {
          type: "tts_format",
          sessionId: current.sessionId,
          responseId: current.responseId,
          generation,
          codec: "pcm16",
          sampleRate: fish.sampleRate,
        });
      }
      const packet = encodeVoicePcmPacket(Buffer.from(chunk), {
        sessionId: current.sessionId,
        responseId: current.responseId,
        generation,
        sampleRate: fish.sampleRate,
        sequence: current.ttsSequence++,
        phraseSequence: 0,
      });
      current.ws.send(packet, { binary: true });
      if (current.ttsSequence === 1) {
        voiceMetrics.record(current.sessionId, "tts_chunk", 0);
        voiceSessions.update(current.sessionId, { status: "speaking" });
        send(current.ws, { type: "status", sessionId: current.sessionId, status: "speaking" });
      }
    },
    onError: (message) => {
      const current = calls.get(active.sessionId);
      if (current === active && current.generation === generation && !current.abort.signal.aborted) {
        send(current.ws, { type: "error", sessionId: current.sessionId, message: friendlyProviderError(message), recoverable: true });
      }
    },
  });
  active.synthesizer = synthesizer;

  let assistant = "";
  try {
    // Opening the realtime TTS socket and starting the model request are
    // independent network operations. The synthesizer's text queue is created
    // synchronously, so early model tokens can safely wait there while Fish
    // finishes connecting instead of holding generation behind that handshake.
    const ttsReady = synthesizer.open(active.selectedVoiceId);
    const replyReady = streamClyraReply(
      active.sessionId,
      clean,
      history,
      (token) => {
        if (active.abort.signal.aborted || active.generation !== generation) return;
        assistant += token;
        send(active.ws, { type: "llm_token", sessionId: active.sessionId, token });
        while (true) {
          const phrase = nextSemanticPhrase(assistant, active.spokenCharacters, {
            minWords: active.spokenCharacters === 0 ? 2 : 5,
            preferredWords: active.spokenCharacters === 0 ? 3 : 9,
            maxWords: 20,
          });
          if (!phrase) break;
          const spoken = normalizeSpokenText(phrase.text);
          if (spoken) {
            synthesizer.pushText(`${spoken} `);
            synthesizer.flush();
          }
          active.spokenCharacters = phrase.nextIndex;
        }
      },
      active.abort.signal,
    );
    await Promise.all([ttsReady, replyReady]);
    if (active.abort.signal.aborted || active.generation !== generation) return;
    const tail = normalizeSpokenText(assistant.slice(active.spokenCharacters));
    if (tail) synthesizer.pushText(tail);
    synthesizer.flush();
    const reply = assistant.trim() || "I didn't catch that. Could you say it again?";
    voiceSessions.appendMessage(active.sessionId, "assistant", reply);
    send(active.ws, { type: "llm_done", sessionId: active.sessionId, text: reply });
    await synthesizer.finish();
    if (active.abort.signal.aborted || active.generation !== generation) return;
    send(active.ws, { type: "tts_done", sessionId: active.sessionId, responseId: active.responseId, generation });
  } catch (error) {
    if (!active.abort.signal.aborted && active.generation === generation) {
      send(active.ws, { type: "error", sessionId: active.sessionId, message: friendlyProviderError(error), recoverable: true });
      resetForListening(active);
    }
  } finally {
    if (active.generation === generation) active.busy = false;
  }
}

async function transcribeBufferedTurn(active: ActiveCall) {
  if (active.busy || active.playbackHold || active.muted) return;
  active.endpointing = false;
  const chunks = active.audio;
  active.audio = [];
  active.audioBytes = 0;
  active.vadSpeechMs = 0;
  active.vadSilenceMs = 0;
  active.vadHeardSpeech = false;
  if (!chunks.length) return;
  active.busy = true;
  const startedAt = Date.now();
  send(active.ws, { type: "status", sessionId: active.sessionId, status: "thinking" });
  try {
    const streamingRecognizer = active.streamingRecognizer;
    const streamingFailed = active.streamingSttFailed;
    active.streamingRecognizer = null;
    await active.streamingSttQueue.catch(() => undefined);
    let text = "";
    if (streamingRecognizer && !streamingFailed) {
      try { text = await streamingRecognizer.flush(); } catch { /* Fish fallback below */ }
      // Hosted streaming ASR can deliver a complete interim transcript before
      // its final marker. Reusing that stable text avoids uploading and
      // transcribing the whole turn again merely because the marker was late.
      if (!text) text = active.streamingTranscript.trim();
    }
    streamingRecognizer?.close();
    if (!text) {
      text = await active.recognizer.transcribe(chunks, loadVoiceConfig().sampleRate, active.abort.signal);
    }
    voiceMetrics.record(active.sessionId, "stt_final", Date.now() - startedAt);
    active.busy = false;
    if (!text) {
      send(active.ws, { type: "error", sessionId: active.sessionId, message: "I didn't catch that.", recoverable: true });
      resetForListening(active);
      return;
    }
    await answerTurn(active, text);
  } catch (error) {
    active.busy = false;
    send(active.ws, { type: "error", sessionId: active.sessionId, message: friendlyProviderError(error), recoverable: true });
    resetForListening(active);
  }
}

function attachSocket(sessionId: string, ws: WebSocket) {
  const fish = loadFishSpeechConfig();
  const config = loadVoiceConfig();
  const active: ActiveCall = {
    ws,
    sessionId,
    generation: 0,
    responseId: "",
    abort: new AbortController(),
    recognizer: new FishSpeechRecognizer(fish),
    streamingRecognizer: null,
    streamingSttQueue: Promise.resolve(),
    streamingSttFailed: false,
    streamingTranscript: "",
    synthesizer: null,
    audio: [],
    audioBytes: 0,
    vadSpeechMs: 0,
    vadSilenceMs: 0,
    vadHeardSpeech: false,
    endpointing: false,
    busy: false,
    playbackHold: false,
    muted: false,
    ttsSequence: 0,
    ttsFormatSent: false,
    spokenCharacters: 0,
    selectedVoiceId: fish.defaultVoiceId,
  };
  calls.set(sessionId, active);
  armStreamingRecognizer(active);
  if (!fish.apiKey) {
    send(ws, { type: "error", sessionId, message: "Voice is not configured on this Clyra server." });
  }
  send(ws, { type: "ready", sessionId, sampleRate: config.sampleRate });
  send(ws, { type: "status", sessionId, status: "listening" });
  ws.send(JSON.stringify({ type: "pipeline_mode", sessionId, mode: "pipeline", sampleRate: config.sampleRate }));

  ws.on("message", async (raw) => {
    const message = parseVoiceClientMessage(String(raw));
    if (!message || message.sessionId !== sessionId || calls.get(sessionId) !== active) return;
    if (message.type === "ping") return send(ws, { type: "pong", sessionId });
    if (message.type === "mute") {
      active.muted = message.muted;
      voiceSessions.update(sessionId, { muted: message.muted });
      if (message.muted) { active.audio = []; active.audioBytes = 0; resetServerVad(active); }
      return;
    }
    if (message.type === "barge_in") {
      cancelGeneration(active);
      resetForListening(active);
      send(ws, { type: "barge_in", sessionId });
      voiceMetrics.record(sessionId, "barge_in", 0);
      return;
    }
    if (message.type === "playback_done") {
      active.synthesizer?.cancel();
      active.synthesizer = null;
      resetForListening(active);
      return;
    }
    if (message.type === "utterance") return void answerTurn(active, message.text);
    if (message.type === "audio") {
      if (active.muted || active.busy || active.playbackHold) return;
      const chunk = Buffer.from(message.data, "base64");
      if (!chunk.length) return;
      active.audio.push(chunk);
      active.audioBytes += chunk.length;
      while (active.audioBytes > MAX_UTTERANCE_BYTES && active.audio.length > 1) {
        active.audioBytes -= active.audio.shift()?.length || 0;
      }
      observeServerVad(active, chunk, config.sampleRate);
      const streamingRecognizer = active.streamingRecognizer;
      if (streamingRecognizer && !active.streamingSttFailed) {
        active.streamingSttQueue = active.streamingSttQueue
          .then(() => streamingRecognizer.sendPcm(message.data))
          .catch(() => { active.streamingSttFailed = true; });
      }
      return;
    }
    if (message.type === "flush") {
      active.endpointing = false;
      return void transcribeBufferedTurn(active);
    }
    if (message.type === "set_voice") {
      if (fish.voices.some((voice) => voice.id === message.voiceId)) active.selectedVoiceId = message.voiceId;
    }
  });

  ws.on("close", () => {
    active.streamingRecognizer?.close();
    cancelGeneration(active);
    calls.delete(sessionId);
    voiceSessions.end(sessionId);
    voiceMetrics.clear(sessionId);
  });
}

export function attachFishVoiceWebSocket(server: HttpServer) {
  const wss = new WebSocketServer({ noServer: true });
  server.on("upgrade", (request, socket, head) => {
    const url = new URL(request.url || "/", "http://localhost");
    if (url.pathname !== "/voice/stream") return;
    const sessionId = url.searchParams.get("sessionId");
    if (!sessionId || !voiceSessions.get(sessionId)) return socket.destroy();
    wss.handleUpgrade(request, socket, head, (upgraded) => attachSocket(sessionId, upgraded));
  });
}

export function closeFishVoiceSocket(sessionId: string) {
  const active = calls.get(sessionId);
  if (!active) return;
  cancelGeneration(active);
  active.ws.close();
  calls.delete(sessionId);
}
