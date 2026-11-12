import type { Server as HttpServer } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import { loadVoiceConfig } from "../config";
import { voiceSessions } from "../session/voice-session-manager";
import { transcribePcm, warmSpeechEngine } from "../../speech/whisper-engine";

/**
 * Dictation (Cmd+Shift+K global dictation + the in-composer mic button) only
 * ever needs speech-to-text -- no LLM, no TTS, no turn management -- so it
 * gets its own small WS bridge to the local whisper.cpp worker instead of
 * going through the call transport. The worker runs only while an utterance
 * is being finalised; raw audio never leaves this machine. The wire
 * protocol here matches what `DictationController.tsx` and the composer's
 * `useComposerVoiceCapture` already speak.
 */

type DictationSocket = {
  ws: WebSocket;
  sessionId: string;
  chunks: Buffer[];
  busy?: boolean;
  partialBusy?: boolean;
  epoch: number;
};

const sockets = new Map<string, DictationSocket>();

function send(ws: WebSocket, message: Record<string, unknown>) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(message));
}

function pcmToWav(pcm: Buffer, sampleRate: number): Buffer {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

function attachSocketHandlers(sessionId: string, ws: WebSocket) {
  const config = loadVoiceConfig();
  const active: DictationSocket = { ws, sessionId, chunks: [], epoch: 0 };
  // Load the model while the user is still talking, so stopping feels instant.
  void warmSpeechEngine();
  sockets.set(sessionId, active);

  send(ws, {
    type: "pipeline_mode",
    sessionId,
    mode: "pipeline",
    sampleRate: config.sampleRate,
  });

  ws.on("message", async (raw) => {
    let message: Record<string, unknown>;
    try {
      message = JSON.parse(String(raw));
    } catch {
      return;
    }
    if (message.sessionId !== sessionId) return;

    if (message.type === "audio" && typeof message.data === "string") {
      active.chunks.push(Buffer.from(message.data, "base64"));
      return;
    }

    // Live captions for the voice call: decode what has been heard so far
    // without consuming it. Skipped while a final decode or an earlier partial
    // is still running so partials can never queue up behind real work.
    if (message.type === "partial") {
      // Always acknowledge so the client only asks for the next caption once
      // this one is done; partials can then never queue ahead of a final decode.
      const ack = () => send(ws, { type: "partial_done", sessionId });
      if (active.busy || active.partialBusy || !active.chunks.length) { ack(); return; }
      // Limit copying and decoding to the recent audio, not the whole turn.
      const generation = active.epoch;
      const maxBytes = config.sampleRate * 2 * 8;
      const tail: Buffer[] = [];
      let remaining = maxBytes;
      for (let i = active.chunks.length - 1; i >= 0 && remaining > 0; i -= 1) {
        const chunk = active.chunks[i]!;
        const end = chunk.length > remaining ? chunk.subarray(chunk.length - remaining) : chunk;
        tail.unshift(end);
        remaining -= end.length;
      }
      const pcm = Buffer.concat(tail);
      if (pcm.length < config.sampleRate * 2 * 0.55) { ack(); return; }
      active.partialBusy = true;
      try {
        const result = await transcribePcm(pcm, config.sampleRate, {});
        // A completed decode from the previous utterance must never replace
        // captions belonging to a newer reset/flush cycle.
        if (result.text && !active.busy && active.epoch === generation) send(ws, { type: "transcript_partial", sessionId, text: result.text });
      } catch {
        // Partials are best-effort; the final decode reports real errors.
      } finally {
        active.partialBusy = false;
        ack();
      }
      return;
    }

    if (message.type === "reset") {
      active.epoch += 1;
      active.chunks.length = 0;
      return;
    }

    if (message.type === "flush") {
      // A second flush while one is decoding would spawn a duplicate decoder
      // process on the same audio.
      if (active.busy) {
        send(ws, { type: "error", sessionId, message: "Speech recognition is still finishing the previous utterance. Please try again." });
        return;
      }
      active.epoch += 1;
      const pcm = Buffer.concat(active.chunks.splice(0));
      if (!pcm.length) {
        send(ws, { type: "dictation_final", sessionId, text: "" });
        return;
      }
      active.busy = true;
      try {
        console.log(`[dictation] transcribing ${(pcm.length / 2 / config.sampleRate).toFixed(1)}s of audio`);
        const result = await transcribePcm(pcm, config.sampleRate, {
          // Prefer accurate local base when installed, fall back to the
          // resource-adaptive/installed model without an extra cloud request.
          profile: message.profile === "tiny" || message.profile === "base" || message.profile === "small" ? message.profile : "base",
          prompt: Array.isArray(message.dictionary)
            ? message.dictionary.filter((value): value is string => typeof value === "string" && value.length <= 80).slice(0, 40)
            : [],
        });
        console.log(`[dictation] ${result.engine} ${result.elapsedMs}ms -> ${JSON.stringify(result.text.slice(0, 80))}`);
        const text = result.text;
        voiceSessions.appendMessage(sessionId, "user", text);
        send(ws, { type: "dictation_final", sessionId, text, elapsedMs: result.elapsedMs, engine: result.engine });
      } catch (error) {
        send(ws, {
          type: "error",
          sessionId,
          message: error instanceof Error ? error.message : "Dictation transcription failed.",
        });
      } finally {
        active.busy = false;
      }
      return;
    }

    if (message.type === "ping") {
      send(ws, { type: "pong", sessionId });
    }
  });

  ws.on("close", () => {
    sockets.delete(sessionId);
    voiceSessions.end(sessionId);
  });
}

export function attachDictationWebSocket(server: HttpServer) {
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (request, socket, head) => {
    const url = new URL(request.url || "/", "http://localhost");
    if (url.pathname !== "/voice/stream") return;
    const sessionId = url.searchParams.get("sessionId");
    const session = sessionId ? voiceSessions.get(sessionId) : null;
    if (!sessionId || !session || session.mode !== "dictation") {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(request, socket, head, (upgraded) => {
      attachSocketHandlers(sessionId, upgraded);
    });
  });
}
