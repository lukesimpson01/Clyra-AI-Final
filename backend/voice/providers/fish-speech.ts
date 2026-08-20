import { File } from "node:buffer";
import { FishAudioClient, FlushEvent, RealtimeEvents, type RealtimeConnection } from "fish-audio";

export type FishVoiceOption = {
  id: string;
  label: string;
  description: string;
};

export type FishSpeechConfig = {
  apiKey: string;
  model: "s2-pro";
  sampleRate: number;
  language: string;
  voices: FishVoiceOption[];
  defaultVoiceId: string;
  ttsChunkLength: number;
};

export function loadFishSpeechConfig(): FishSpeechConfig {
  const configured = [
    ["Clyra", process.env.FISH_VOICE_ID_CLYRA, "Balanced and natural"],
    ["Warm", process.env.FISH_VOICE_ID_WARM, "Softer conversational delivery"],
    ["Bright", process.env.FISH_VOICE_ID_BRIGHT, "Clear and energetic"],
    ["Calm", process.env.FISH_VOICE_ID_CALM, "Relaxed and measured"],
  ] as const;
  const voices = configured.flatMap(([label, id, description]) => {
    const voiceId = id?.trim();
    return voiceId ? [{ label, id: voiceId, description }] : [];
  });
  if (!voices.length) voices.push({ id: "", label: "Clyra", description: "Balanced and natural" });
  const defaultVoiceId = process.env.FISH_VOICE_ID?.trim() || voices[0]?.id || "";
  if (defaultVoiceId && !voices.some((voice) => voice.id === defaultVoiceId)) {
    voices.unshift({ id: defaultVoiceId, label: "Clyra", description: "Balanced and natural" });
  }
  return {
    apiKey: process.env.FISH_API_KEY?.trim() || "",
    model: "s2-pro",
    sampleRate: 24_000,
    language: process.env.FISH_ASR_LANGUAGE?.trim() || "en",
    voices,
    defaultVoiceId,
    ttsChunkLength: Math.max(100, Math.min(200, Number(process.env.FISH_TTS_CHUNK_LENGTH ?? 100))),
  };
}

function pcm16ToWav(chunks: Buffer[], sampleRate: number) {
  const pcm = Buffer.concat(chunks);
  const wav = Buffer.allocUnsafe(44 + pcm.length);
  wav.write("RIFF", 0);
  wav.writeUInt32LE(36 + pcm.length, 4);
  wav.write("WAVE", 8);
  wav.write("fmt ", 12);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(sampleRate * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(pcm.length, 40);
  pcm.copy(wav, 44);
  return wav;
}

export class FishSpeechRecognizer {
  private client: FishAudioClient;

  constructor(private config: FishSpeechConfig) {
    this.client = new FishAudioClient({ apiKey: config.apiKey });
  }

  get configured() {
    return Boolean(this.config.apiKey);
  }

  async transcribe(chunks: Buffer[], sampleRate: number, signal?: AbortSignal) {
    if (!this.config.apiKey) throw new Error("Voice is not configured on this Clyra server.");
    if (!chunks.length) return "";
    const wav = pcm16ToWav(chunks, sampleRate);
    const audio = new File([wav], "clyra-utterance.wav", { type: "audio/wav" });
    const response = await this.client.speechToText.convert(
      { audio, language: this.config.language, ignore_timestamps: true },
      { abortSignal: signal, timeoutInSeconds: 30, maxRetries: 1 },
    );
    return response.text?.trim() || "";
  }
}

class TextQueue implements AsyncIterable<string> {
  private values: string[] = [];
  private waiters: Array<(value: IteratorResult<string>) => void> = [];
  private ended = false;

  push(value: string) {
    if (this.ended || !value) return;
    const waiter = this.waiters.shift();
    if (waiter) waiter({ value, done: false });
    else this.values.push(value);
  }

  end() {
    this.ended = true;
    for (const waiter of this.waiters.splice(0)) waiter({ value: undefined, done: true });
  }

  [Symbol.asyncIterator](): AsyncIterator<string> {
    return {
      next: () => {
        const value = this.values.shift();
        if (value != null) return Promise.resolve({ value, done: false });
        if (this.ended) return Promise.resolve({ value: undefined, done: true });
        return new Promise((resolve) => this.waiters.push(resolve));
      },
    };
  }
}

export class FishStreamingSpeechSynthesizer {
  private client: FishAudioClient;
  private connection: RealtimeConnection | null = null;
  private queue: TextQueue | null = null;
  private closed: Promise<void> | null = null;
  private resolveClosed: (() => void) | null = null;
  private isOpen = false;
  private pendingFlush = false;

  constructor(
    private config: FishSpeechConfig,
    private callbacks: { onAudio: (chunk: Uint8Array) => void; onError: (message: string) => void },
  ) {
    this.client = new FishAudioClient({ apiKey: config.apiKey });
  }

  async open(voiceId: string, speed = 1) {
    if (!this.config.apiKey) throw new Error("Voice is not configured on this Clyra server.");
    this.cancel();
    this.isOpen = false;
    this.pendingFlush = false;
    this.queue = new TextQueue();
    this.closed = new Promise((resolve) => { this.resolveClosed = resolve; });
    const connection = await this.client.textToSpeech.convertRealtime(
      {
        text: "",
        ...(voiceId ? { reference_id: voiceId } : {}),
        format: "pcm",
        sample_rate: this.config.sampleRate,
        latency: "balanced",
        // Smaller chunks trade a little batching efficiency for substantially
        // faster first audio, which is the right trade-off for conversation.
        chunk_length: this.config.ttsChunkLength,
        normalize: true,
        prosody: { speed, volume: 0 },
      },
      this.queue,
      this.config.model,
    );
    this.connection = connection;
    connection.on(RealtimeEvents.OPEN, () => {
      this.isOpen = true;
      if (this.pendingFlush) {
        this.pendingFlush = false;
        // The SDK emits OPEN just before its own listener sends StartEvent and
        // drains the queued TextEvents. Defer the flush one task so the wire
        // order is always Start → Text → Flush, even when the LLM finishes
        // before the TTS handshake.
        setTimeout(() => {
          if (this.connection !== connection || !this.isOpen) return;
          try { connection.send(new FlushEvent()); } catch { /* socket closed during startup */ }
        }, 0);
      }
    });
    connection.on(RealtimeEvents.AUDIO_CHUNK, (value) => {
      if (value instanceof Uint8Array || Buffer.isBuffer(value)) {
        this.callbacks.onAudio(new Uint8Array(value as Uint8Array));
      }
    });
    connection.on(RealtimeEvents.ERROR, (error) => {
      this.callbacks.onError(error instanceof Error ? error.message : "Fish Audio synthesis failed.");
    });
    connection.on(RealtimeEvents.CLOSE, () => {
      this.resolveClosed?.();
      this.resolveClosed = null;
    });
  }

  pushText(text: string) {
    this.queue?.push(text);
  }

  flush() {
    if (!this.isOpen) { this.pendingFlush = true; return; }
    try { this.connection?.send(new FlushEvent()); } catch { /* connection may have just closed */ }
  }

  async finish() {
    this.queue?.end();
    await Promise.race([
      this.closed ?? Promise.resolve(),
      new Promise<void>((resolve) => setTimeout(resolve, 15_000)),
    ]);
  }

  cancel() {
    this.queue?.end();
    this.queue = null;
    this.connection?.close();
    this.connection = null;
    this.isOpen = false;
    this.pendingFlush = false;
    this.resolveClosed?.();
    this.resolveClosed = null;
  }
}
