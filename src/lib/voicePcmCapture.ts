/** Browser PCM16 mic capture for the streaming voice pipeline. */

export type PcmChunkHandler = (base64Pcm16: string, seq: number) => void;
export type PcmLevelHandler = (level: number) => void;

/** Disable and stop every browser capture track so the OS privacy indicator clears. */
export function stopMediaStreamTracks(stream: Pick<MediaStream, "getTracks"> | null | undefined) {
  for (const track of stream?.getTracks() ?? []) {
    track.enabled = false;
    track.stop();
  }
}

function floatTo16BitPCM(input: Float32Array) {
  const out = new Int16Array(input.length);
  for (let i = 0; i < input.length; i += 1) {
    const s = Math.max(-1, Math.min(1, input[i]!));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}

function int16ToBase64(pcm: Int16Array) {
  const bytes = new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function rmsLevel(samples: Float32Array) {
  if (!samples.length) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i += 1) {
    const s = samples[i]!;
    sum += s * s;
  }
  const rms = Math.sqrt(sum / samples.length);
  // Typical speech RMS sits ~0.02–0.2 after browser AGC; map to a readable 0–1.
  const normalized = (rms - 0.006) / 0.1;
  return Math.max(0, Math.min(1, normalized));
}

/** Averages each window of input samples into one output sample. Picking every Nth sample (the old approach) aliases:
 * consonants blur and the speech model mishears words. Averaging is a simple low-pass that avoids that. */
function downsample(input: Float32Array, ratio: number) {
  const length = Math.floor(input.length / ratio);
  const out = new Float32Array(length);
  for (let i = 0; i < length; i += 1) {
    const from = Math.floor(i * ratio);
    const to = Math.max(from + 1, Math.min(input.length, Math.floor((i + 1) * ratio)));
    let sum = 0;
    for (let k = from; k < to; k += 1) sum += input[k]!;
    out[i] = sum / (to - from);
  }
  return out;
}

/** Runs on the audio thread, so capture never drops audio even when the page is busy (a heavy workspace, a slow
 * machine). It hands the page 2048-sample chunks of audio and a loudness reading every ~32 ms. */
const WORKLET_SOURCE = `
class ClyraPcm extends AudioWorkletProcessor {
  constructor() { super(); this.buf = new Float32Array(2048); this.n = 0; this.sum = 0; this.count = 0; this.every = Math.round(sampleRate * 0.032); }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    for (let i = 0; i < ch.length; i++) {
      const v = ch[i];
      this.buf[this.n++] = v; this.sum += v * v; this.count++;
      if (this.count >= this.every) { this.port.postMessage({ level: Math.sqrt(this.sum / this.count) }); this.sum = 0; this.count = 0; }
      if (this.n === 2048) { const copy = this.buf.slice(0); this.port.postMessage({ audio: copy }, [copy.buffer]); this.n = 0; }
    }
    return true;
  }
}
registerProcessor("clyra-pcm", ClyraPcm);`;

export class VoicePcmCapturer {
  private worklet: AudioWorkletNode | null = null;
  private workletUrl: string | null = null;
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private processor: ScriptProcessorNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private silentGain: GainNode | null = null;
  private seq = 0;
  private muted = false;
  private ownsStream = true;
  private ownsContext = true;
  private stopped = false;
  private onChunk: PcmChunkHandler;
  private onLevel: PcmLevelHandler | null;
  private targetRate: number;

  private options: { echoCancellation?: boolean };

  constructor(
    onChunk: PcmChunkHandler,
    targetRate = 16000,
    onLevel: PcmLevelHandler | null = null,
    options: { echoCancellation?: boolean } = {},
  ) {
    this.options = options;
    this.onChunk = onChunk;
    this.onLevel = onLevel;
    this.targetRate = targetRate;
  }

  setMuted(muted: boolean) {
    this.muted = muted;
  }

  setLevelHandler(onLevel: PcmLevelHandler | null) {
    this.onLevel = onLevel;
  }

  async start(existingStream?: MediaStream | null, existingContext?: AudioContext | null) {
    if (this.stopped) throw new Error("Audio capture was already stopped");
    if (existingStream && existingStream.active) {
      this.stream = existingStream;
      this.ownsStream = false;
    } else {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: this.options.echoCancellation ?? true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
        },
        video: false,
      });
      this.ownsStream = true;
    }
    // Permission prompts can resolve after the user has ended the call.
    // Never keep that late microphone stream alive.
    if (this.stopped) {
      if (this.ownsStream) stopMediaStreamTracks(this.stream);
      this.stream = null;
      return;
    }
    // Reuse the context created directly from the call-button gesture. A
    // second context created after WebSocket.onopen can remain suspended.
    // A context that already runs at the speech model's rate needs no resampling at all (Chromium's own resampler is high quality).
    this.ctx = existingContext && existingContext.state !== "closed"
      ? existingContext
      : (() => { try { return new AudioContext({ sampleRate: this.targetRate }); } catch { return new AudioContext(); } })();
    this.ownsContext = this.ctx !== existingContext;
    if (this.ctx.state === "suspended") await this.ctx.resume();
    if (this.stopped) return;
    this.source = this.ctx.createMediaStreamSource(this.stream);
    this.silentGain = this.ctx.createGain();
    this.silentGain.gain.value = 0;
    const handleAudio = (input: Float32Array) => {
      const context = this.ctx;
      if (!context || this.muted) return;
      const samples = Math.abs(context.sampleRate - this.targetRate) > 1 ? downsample(input, context.sampleRate / this.targetRate) : input;
      this.seq += 1;
      this.onChunk(int16ToBase64(floatTo16BitPCM(samples)), this.seq);
    };
    const toLevel = (rms: number) => Math.max(0, Math.min(1, (rms - 0.006) / 0.1));
    // Preferred: an AudioWorklet (audio thread). Falls back to the main-thread ScriptProcessor where it is unavailable.
    let usedWorklet = false;
    if (this.ctx.audioWorklet && typeof AudioWorkletNode !== "undefined") {
      try {
        this.workletUrl = URL.createObjectURL(new Blob([WORKLET_SOURCE], { type: "application/javascript" }));
        await this.ctx.audioWorklet.addModule(this.workletUrl);
        this.worklet = new AudioWorkletNode(this.ctx, "clyra-pcm", { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
        this.worklet.port.onmessage = (event: MessageEvent) => {
          const data = event.data as { level?: number; audio?: Float32Array };
          if (typeof data.level === "number") this.onLevel?.(this.muted ? 0 : toLevel(data.level));
          if (data.audio) handleAudio(data.audio);
        };
        this.source.connect(this.worklet);
        this.worklet.connect(this.silentGain);
        usedWorklet = true;
      } catch {
        this.worklet = null;
      }
    }
    if (!usedWorklet) {
      this.processor = this.ctx.createScriptProcessor(2048, 1, 1);
      this.processor.onaudioprocess = (event) => {
        const input = event.inputBuffer.getChannelData(0);
        this.onLevel?.(this.muted ? 0 : rmsLevel(input));
        handleAudio(input);
      };
      this.source.connect(this.processor);
      this.processor.connect(this.silentGain);
    }
    // CRITICAL: never route mic into speakers — that caused feedback/clicks/pops.
    this.silentGain.connect(this.ctx.destination);
  }

  get mediaStream() {
    return this.stream;
  }

  get audioContext() {
    return this.ctx;
  }

  stop() {
    this.stopped = true;
    try {
      if (this.processor) this.processor.onaudioprocess = null;
      if (this.worklet) this.worklet.port.onmessage = null;
      this.worklet?.disconnect();
      this.processor?.disconnect();
      this.source?.disconnect();
      this.silentGain?.disconnect();
    } catch {
      // ignore
    }
    this.processor = null;
    this.worklet = null;
    if (this.workletUrl) { URL.revokeObjectURL(this.workletUrl); this.workletUrl = null; }
    this.source = null;
    this.silentGain = null;
    if (this.ownsStream) {
      this.stream?.getTracks().forEach((t) => t.stop());
    }
    this.stream = null;
    if (this.ownsContext && this.ctx && this.ctx.state !== "closed") {
      void this.ctx.close();
    }
    this.ctx = null;
  }
}
