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
  const active: DictationSocket = { ws, sessionId, chunks: [] };
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
      const snapshot = Buffer.concat(active.chunks);
      // Keep partials cheap and bounded: the most recent ~12s is enough context.
      const maxBytes = config.sampleRate * 2 * 12;
      const pcm = snapshot.length > maxBytes ? snapshot.subarray(snapshot.length - maxBytes) : snapshot;
      if (pcm.length < config.sampleRate * 2 * 0.8) { ack(); return; }
      active.partialBusy = true;
      try {
        const result = await transcribePcm(pcm, config.sampleRate, {});
        if (result.text && !active.busy) send(ws, { type: "transcript_partial", sessionId, text: result.text });
      } catch {
        // Partials are best-effort; the final decode reports real errors.
      } finally {
        active.partialBusy = false;
        ack();
      }
      return;
    }

    if (message.type === "reset") {
      active.chunks.length = 0;
      return;
    }

    if (message.type === "flush") {
      // A second flush while one is decoding would spawn a duplicate decoder
      // process on the same audio.
      if (active.busy) return;
      const pcm = Buffer.concat(active.chunks.splice(0));
      if (!pcm.length) {
        send(ws, { type: "dictation_final", sessionId, text: "" });
        return;
      }
      active.busy = true;
      try {
        console.log(`[dictation] transcribing ${(pcm.length / 2 / config.sampleRate).toFixed(1)}s of audio`);
        const result = await transcribePcm(pcm, config.sampleRate, {
          profile: typeof message.profile === "string" ? message.profile : undefined,
        });
        console.log(`[dictation] ${result.engine} ${result.elapsedMs}ms -> ${JSON.stringify(result.text.slice(0, 80))}`);
        const text = result.text;
        voiceSessions.appendMessage(sessionId, "user", text);
        send(ws, { type: "dictation_final", sessionId, text, elapsedMs: result.elapsedMs, engine: result.engine, speechMs: (result as { speechMs?: number }).speechMs, audioMs: (result as { audioMs?: number }).audioMs, noSpeech: Boolean((result as { noSpeech?: boolean }).noSpeech) });
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
