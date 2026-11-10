import { EndpointDetector, SAMPLE_RATE, requiredSilenceMs, utteranceHint } from "./flow-endpoint.mjs";

/**
 * One dictation, from the first audio chunk to the final transcript.
 *
 * Pure (no Electron, no timers): audio goes in through feed(), decisions come out as callbacks, and time is the
 * audio's own clock. The dictation manager wires it to the microphone, the speech engine and the pill.
 *
 * How the text is produced:
 *  - Audio is decoded in long *blocks* that are only ever cut at a real pause, so the model always has the whole
 *    sentence as context. (Decoding 1-second phrases on their own was the main source of misheard words.)
 *  - While you talk, the open block is re-decoded for the live words.
 *  - The moment you pause, the block is decoded *speculatively*. If you then stay quiet, that result IS the final
 *    transcript, already finished when the session ends: stopping costs no extra decode.
 *  - The pause that ends the session adapts to how you speak and to whether the text reads as finished.
 */
const BYTES_PER_MS = (SAMPLE_RATE * 2) / 1000;
const ms2bytes = (ms) => { const bytes = Math.round(ms * BYTES_PER_MS); return bytes - (bytes % 2); };

const PRE_ROLL_MS = 320;                 // audio kept before the detected start of speech (soft first consonants)
const TAIL_MS = 220;                     // audio kept after the last speech frame
const SPECULATE_AFTER_MS = 320;          // pause length that triggers the speculative decode
const BLOCK_SOFT_MS = 11_000;            // freeze the block at the next pause once it is this long
const BLOCK_HARD_MS = 22_000;            // freeze regardless (someone who never pauses)
const PARTIAL_MIN_MS = 750;              // speech needed before the first live words (less is mostly a guess)
const PARTIAL_STEP_MS = 280;             // new audio needed before the next live update
const NO_SPEECH_MS = 7_000;              // nothing said at all: give the microphone back

// A cut can land mid-sentence; the model then closes the piece with a full stop ("...lunch with. Priya...").
const OPEN_ENDINGS = new Set("a an the and or but so to of in on at for with from by as that which who whom whose if than then because while when where into onto over under about between through during before after is are was were be been am will would can could should may might do does did have has had my your his her its our their this these those not no".split(" "));
export function joinPhrases(pieces) {
  const out = [];
  pieces.filter(Boolean).forEach((piece, index, all) => {
    let text = String(piece).trim();
    if (index < all.length - 1) {
      const last = text.replace(/[.,?!;:]+$/, "").split(/\s+/).pop()?.toLowerCase() || "";
      if (OPEN_ENDINGS.has(last)) text = text.replace(/[.,?!;:]+$/, "");
    }
    out.push(text);
  });
  return out.join(" ").replace(/\s+/g, " ").trim();
}

export class FlowSession {
  /**
   * @param {{
   *   audio: (start: number, end?: number) => Buffer,   // captured PCM by byte range
   *   transcribe: (pcm: Buffer) => Promise<string>,
   *   autoStop?: boolean,
   *   pace?: "fast" | "balanced" | "patient",
   *   onLive?: (text: string) => void,
   *   onMeter?: (meter: { level: number, ending: number, speaking: boolean }) => void,
   *   onEnd?: (reason: "silence" | "no-speech") => void,
   * }} options
   */
  constructor({ audio, transcribe, autoStop = true, pace = "balanced", onLive = () => {}, onMeter = () => {}, onEnd = () => {} }) {
    this.audio = audio;
    this.transcribe = transcribe;
    this.autoStop = autoStop;
    this.pace = pace;
    this.onLive = onLive;
    this.onMeter = onMeter;
    this.onEnd = onEnd;
    this.detector = new EndpointDetector();
    this.bytes = 0;
    this.closed = false;
    this.ended = false;
    this.blocks = [];                    // frozen: { promise, text }
    this.blockStart = 0;                 // byte offset where the open block begins
    this.blockHasSpeech = false;
    this.blockSpeechStart = 0;
    this.partial = { text: "", busy: false, bytes: 0, gen: 0, lastMs: 0, at: 0 };
    this.spec = null;                    // { end, promise, text } speculative decode of the open block
    this.lastLive = "";
    this.stats = { decodes: 0, speculativeHits: 0, endedAtMs: 0, requiredMs: 0 };
  }

  get timeMs() { return this.bytes / BYTES_PER_MS; }
  get heardSpeech() { return this.detector.heardSpeech; }
  get lastSpeechByte() { return this.detector.lastSpeechSample * 2; }

  /** @param {Buffer} chunk PCM16 mono 16 kHz, appended to the capture store *before* this call. */
  feed(chunk) {
    if (this.closed || !chunk?.length) return;
    this.bytes += chunk.length - (chunk.length % 2);
    this.detector.feed(new Int16Array(chunk.buffer, chunk.byteOffset, Math.floor(chunk.length / 2)));
    for (const change of this.detector.drain()) {
      if (change.type === "start") {
        if (!this.blockHasSpeech) {
          this.blockHasSpeech = true;
          this.blockSpeechStart = change.sample * 2;
          this.blockStart = Math.max(this.blockStart, change.sample * 2 - ms2bytes(PRE_ROLL_MS));
        }
        this.spec = null;                // you kept talking: the speculative result is stale
      }
    }
    this.#tick();
  }

  #tick() {
    const detector = this.detector;
    const silence = detector.silenceMs;
    const speaking = detector.inSpeech && detector.heardSpeech;
    const quiet = detector.heardSpeech && !detector.inSpeech;

    if (this.blockHasSpeech && detector.heardSpeech) {
      const blockMs = (this.bytes - this.blockStart) / BYTES_PER_MS;
      if (quiet && silence >= SPECULATE_AFTER_MS) {
        if (blockMs >= BLOCK_SOFT_MS) this.#freeze();
        else this.#speculate();
      } else if (blockMs >= BLOCK_HARD_MS) {
        this.#freeze(this.bytes);
      } else if (speaking) {
        this.#livePartial();
      }
    }

    let ending = 0;
    if (this.autoStop && !this.ended) {
      if (quiet) {
        const required = requiredSilenceMs({ speechMs: detector.totalSpeechMs, pauses: detector.pauses, hint: this.#hint(), pace: this.pace });
        // The countdown only becomes visible once the pause is clearly more than a breath.
        ending = Math.max(0, Math.min(1, (silence - 380) / Math.max(1, required - 380)));
        if (silence >= required) {
          this.ended = true;
          this.stats.endedAtMs = Math.round(this.timeMs);
          this.stats.requiredMs = required;
          this.onEnd("silence");
        }
      } else if (!detector.heardSpeech && !detector.inSpeech && this.timeMs >= NO_SPEECH_MS) {
        this.ended = true;
        this.onEnd("no-speech");
      }
    }
    this.onMeter({ level: detector.level, ending, speaking });
  }

  #hint() {
    const spec = this.spec;
    if (spec && spec.text !== null && spec.end >= this.lastSpeechByte) return utteranceHint(spec.text);
    return "unknown";
  }

  #decode(start, end) {
    const pcm = this.audio(start, end);
    if (pcm.length < ms2bytes(200)) return Promise.resolve("");
    this.stats.decodes += 1;
    return Promise.resolve(this.transcribe(pcm)).then((text) => String(text || "").trim(), () => "");
  }

  /** End of the audio worth decoding for the open block: just past the last speech frame. */
  #speechEnd() {
    return Math.min(this.bytes, this.lastSpeechByte + ms2bytes(TAIL_MS));
  }

  #speculate() {
    const end = this.#speechEnd();
    if (this.spec && this.spec.end >= this.lastSpeechByte) return;
    const spec = { end, text: null, promise: null };
    spec.promise = this.#decode(this.blockStart, end).then((text) => {
      spec.text = text;
      if (this.spec === spec) this.#pushLive();
      return text;
    });
    this.spec = spec;
  }

  /** Close the open block at a pause (or at `cut`) and keep its text for good. */
  #freeze(cut = 0) {
    const end = cut || this.#speechEnd();
    const reuse = !cut && this.spec && this.spec.end >= this.lastSpeechByte ? this.spec : null;
    const block = { text: null, promise: null };
    block.promise = (reuse ? reuse.promise : this.#decode(this.blockStart, end)).then((text) => { block.text = text; this.#pushLive(); return text; });
    this.blocks.push(block);
    this.blockStart = end;
    this.blockHasSpeech = Boolean(cut) && this.detector.inSpeech;
    this.blockSpeechStart = end;
    this.spec = null;
    this.partial.text = "";
    this.partial.bytes = 0;
    this.partial.gen += 1;
  }

  #livePartial() {
    const partial = this.partial;
    if (partial.busy) return;
    const span = this.bytes - this.blockStart;
    if (this.bytes - this.blockSpeechStart < ms2bytes(PARTIAL_MIN_MS)) return;
    // Adaptive cadence: never queue live decodes faster than the machine finishes them, so a slow computer
    // (or a long block) lowers the update rate instead of piling up work behind the final transcript.
    const step = Math.max(PARTIAL_STEP_MS, Math.min(1_500, partial.lastMs * 2.2));
    if (span - partial.bytes < ms2bytes(step)) return;
    partial.busy = true;
    partial.bytes = span;
    const gen = partial.gen;
    const started = Date.now();
    this.#decode(this.blockStart, this.bytes).then((text) => {
      partial.busy = false;
      partial.lastMs = Date.now() - started;
      if (gen !== partial.gen || this.closed) return;
      if (text) { partial.text = text; this.#pushLive(); }
    });
  }

  /** Everything understood so far, as shown in the pill while you talk. */
  liveText() {
    const parts = [];
    for (const block of this.blocks) { if (block.text === null) return joinPhrases(parts); if (block.text) parts.push(block.text); }
    const spec = this.spec;
    if (spec && spec.text !== null && spec.end >= this.lastSpeechByte) parts.push(spec.text);
    else if (this.partial.text) {
      // The word being spoken right now is cut off mid-sound and usually decodes wrongly: show only settled words.
      const words = this.partial.text.split(" ");
      if (this.detector.inSpeech) words.pop();
      parts.push(words.join(" "));
    }
    return joinPhrases(parts);
  }

  #pushLive() {
    if (this.closed) return;
    const text = this.liveText();
    // Never take words back: when you resume after a pause the in-progress decode briefly knows fewer words
    // than the pill already shows, and the line must not flicker shorter.
    if (!text || text === this.lastLive || this.lastLive.startsWith(text)) return;
    this.lastLive = text;
    this.onLive(text);
  }

  /**
   * The session is over (auto-stop, hotkey or the stop button): return the final transcript.
   * @param {number} totalBytes size of the finished recording
   */
  async finish(totalBytes = this.bytes) {
    this.closed = true;
    const detector = this.detector;
    const pieces = this.blocks.map((block) => block.promise);
    let tail = Promise.resolve("");
    if (this.blockHasSpeech && detector.heardSpeech) {
      const spec = this.spec;
      // Nothing was said after the speculative decode started: it already is the answer.
      if (spec && !detector.inSpeech && spec.end >= this.lastSpeechByte) { this.stats.speculativeHits += 1; tail = spec.promise; }
      else tail = this.#decode(this.blockStart, detector.inSpeech ? totalBytes : Math.min(totalBytes, this.#speechEnd()));
    }
    let text = joinPhrases([...(await Promise.all(pieces)), await tail]);
    // Nothing recognised as speech (very quiet voice, unusual microphone): decode everything rather than give up.
    if (!text && totalBytes >= ms2bytes(350) && (!detector.heardSpeech || !this.blocks.length)) text = await this.#decode(0, totalBytes);
    return text;
  }

  /** Abandon the session (cancel): results of decodes still in flight are ignored. */
  close() {
    this.closed = true;
    this.partial.gen += 1;
  }
}
