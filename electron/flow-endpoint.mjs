/**
 * Clyra Flow voice-activity + end-of-speech detection.
 *
 * Pure and deterministic: it is fed 16 kHz mono PCM16 and measures everything in *audio time* (samples), never
 * wall-clock time, so a busy main process can never make it stop early or late, and the same recording always
 * produces the same decision (see tools/flow-endpoint-tests.mjs).
 *
 * Three things make it hold up for fast, quiet or mumbled speech:
 *  - the noise floor is learned continuously, so the speech threshold is relative to the room, not a constant;
 *  - quiet frames that are *voiced* (periodic, like a hummed or mumbled vowel) count as speech even when they are
 *    only a few dB above the floor, while clicks and key taps (loud but not sustained) do not;
 *  - how long a silence has to be before the session ends adapts to the speaker: someone who talks fast with
 *    150 ms gaps is finished after about a second, someone who pauses to think is given more room, and a phrase
 *    that ends mid-thought ("...and then the") is given longer than one that ends a sentence.
 */
export const SAMPLE_RATE = 16_000;
const FRAME = 320;                       // 20 ms
const FRAME_MS = (FRAME / SAMPLE_RATE) * 1000;

const FLOOR_MIN_DB = -78;
const FLOOR_MAX_DB = -32;
const ABS_MIN_DB = -64;                  // below this nothing is speech, however quiet the room is
const ENTER_SNR_DB = 9;                  // start of speech: clearly above the room
const STAY_SNR_DB = 4.5;                 // while speaking: trailing syllables and soft consonants still count
const VOICED_SNR_DB = 3;                 // a quiet frame counts when it is also periodic (mumbling)
const VOICED_MIN = 0.5;
const ONSET_FRAMES = 3;                  // 60 ms of speech within the last 100 ms starts a phrase (rejects clicks)
const HANGOVER_MS = 180;                 // a phrase ends this long after its last speech frame
const CONFIRM_SPEECH_MS = 140;           // total speech before we believe someone is really talking

const clamp = (value, lo, hi) => Math.max(lo, Math.min(hi, value));

/** Normalised autocorrelation peak in the pitch range (80-400 Hz): ~1 for a vowel, ~0 for hiss or a click. */
function voicing(frame) {
  let energy = 0;
  for (let i = 0; i < FRAME; i += 2) energy += frame[i] * frame[i];
  if (energy <= 0) return 0;
  let best = 0;
  // Every other sample and every other lag: a quarter of the work, and pitch does not need more resolution.
  for (let lag = 40; lag <= 200; lag += 2) {
    let sum = 0;
    let a = 0;
    let b = 0;
    for (let i = 0; i + lag < FRAME; i += 2) {
      const x = frame[i];
      const y = frame[i + lag];
      sum += x * y;
      a += x * x;
      b += y * y;
    }
    const norm = Math.sqrt(a * b);
    if (norm > 0) { const r = sum / norm; if (r > best) best = r; }
  }
  return best;
}

export class EndpointDetector {
  constructor() {
    this.frame = new Float32Array(FRAME);
    this.fill = 0;
    this.samples = 0;                    // samples analysed so far
    this.prevIn = 0;
    this.prevOut = 0;
    this.floorDb = -60;
    this.floorFrames = 0;
    this.inSpeech = false;
    this.recent = [];                    // last five frame decisions
    this.speechMs = 0;                   // confirmed speech heard in total
    this.runMs = 0;                      // speech in the current phrase
    this.heardSpeech = false;
    this.lastSpeechSample = 0;           // end of the most recent speech frame
    this.phraseStartSample = 0;
    this.firstSpeechSample = -1;
    this.pauses = [];                    // gaps (ms) the speaker resumed after: their own pausing habit
    this.level = 0;                      // 0..1 loudness for the UI
    this.transitions = [];               // drained by the caller: { type: "start" | "end", sample }
  }

  get timeMs() { return (this.samples / SAMPLE_RATE) * 1000; }
  /** Silence since the last speech frame, in audio time. */
  get silenceMs() { return this.heardSpeech ? ((this.samples - this.lastSpeechSample) / SAMPLE_RATE) * 1000 : this.timeMs; }

  /** @param {Int16Array} pcm */
  feed(pcm) {
    for (let i = 0; i < pcm.length; i += 1) {
      // One-pole DC blocker (~75 Hz): desk rumble and mic offset must not look like energy.
      const x = pcm[i] / 32768;
      const y = x - this.prevIn + 0.97 * this.prevOut;
      this.prevIn = x;
      this.prevOut = y;
      this.frame[this.fill++] = y;
      if (this.fill === FRAME) { this.fill = 0; this.samples += FRAME; this.#analyse(); }
    }
  }

  #analyse() {
    const frame = this.frame;
    let sum = 0;
    for (let i = 0; i < FRAME; i += 1) sum += frame[i] * frame[i];
    const db = 10 * Math.log10(sum / FRAME + 1e-10);

    // The first 60 ms define the starting floor; afterwards it falls quickly and rises slowly.
    if (this.floorFrames < 3) {
      this.floorDb = this.floorFrames === 0 ? db : Math.min(this.floorDb, db);
      this.floorFrames += 1;
    } else if (db < this.floorDb) {
      this.floorDb += (db - this.floorDb) * 0.25;
    } else if (!this.inSpeech) {
      this.floorDb += (db - this.floorDb) * 0.03;
    } else {
      // Even "speech" lifts the floor a little, so a fan that switches on mid-sentence cannot hold a session open.
      this.floorDb += (db - this.floorDb) * 0.0015;
    }
    this.floorDb = clamp(this.floorDb, FLOOR_MIN_DB, FLOOR_MAX_DB);

    const snr = db - this.floorDb;
    let speech = false;
    if (db > ABS_MIN_DB) {
      if (snr >= (this.inSpeech ? STAY_SNR_DB : ENTER_SNR_DB)) speech = true;
      // Only the ambiguous band pays for the pitch check.
      else if (snr >= VOICED_SNR_DB && voicing(frame) >= VOICED_MIN) speech = true;
    }
    this.recent.push(speech);
    if (this.recent.length > 5) this.recent.shift();

    const target = clamp((snr - 4) / 30, 0, 1);
    this.level += (target - this.level) * (target > this.level ? 0.6 : 0.25);

    if (speech) {
      if (!this.inSpeech) {
        let count = 0;
        for (const flag of this.recent) if (flag) count += 1;
        if (count >= ONSET_FRAMES) {
          const start = Math.max(0, this.samples - this.recent.length * FRAME);
          if (this.heardSpeech) {
            const gap = ((start - this.lastSpeechSample) / SAMPLE_RATE) * 1000;
            if (gap >= 120 && gap <= 4_000) { this.pauses.push(gap); if (this.pauses.length > 24) this.pauses.shift(); }
          }
          this.inSpeech = true;
          this.runMs = count * FRAME_MS;
          this.phraseStartSample = start;
          this.transitions.push({ type: "start", sample: start });
          if (this.heardSpeech) this.lastSpeechSample = this.samples;
        }
      } else {
        this.runMs += FRAME_MS;
        this.lastSpeechSample = this.samples;
      }
      if (this.inSpeech && !this.heardSpeech && this.runMs >= CONFIRM_SPEECH_MS) {
        this.heardSpeech = true;
        this.firstSpeechSample = this.phraseStartSample;
        this.lastSpeechSample = this.samples;
      }
    } else if (this.inSpeech) {
      const reference = this.heardSpeech ? this.lastSpeechSample : this.phraseStartSample + (this.runMs / 1000) * SAMPLE_RATE;
      if (((this.samples - reference) / SAMPLE_RATE) * 1000 >= HANGOVER_MS) {
        this.inSpeech = false;
        // A burst too short to be a word (a key tap, a cough of the desk) is forgotten entirely.
        if (this.runMs >= CONFIRM_SPEECH_MS) this.speechMs += this.runMs;
        this.transitions.push({ type: "end", sample: Math.round(reference), speech: this.runMs >= CONFIRM_SPEECH_MS });
        this.runMs = 0;
      }
    }
  }

  /** Confirmed speech so far, including the phrase in progress. */
  get totalSpeechMs() { return this.speechMs + (this.inSpeech && this.heardSpeech ? this.runMs : 0); }

  drain() {
    if (!this.transitions.length) return [];
    const out = this.transitions;
    this.transitions = [];
    return out;
  }
}

const OPEN_WORDS = new Set("a an the and or but so to of in on at for with from by as that which who whom whose if than then because while when where into onto over under about between through during before after is are was were be been am will would can could should may might do does did have has had my your his her its our their this these those not no um uh er hmm".split(" "));

/**
 * Does the text heard so far read as a finished thought?
 *  "complete" -> ends a sentence; "open" -> clearly mid-thought (ends on a connecting word, a comma or a filler);
 *  "unknown"  -> no text yet, or nothing to tell either way.
 */
export function utteranceHint(text) {
  const trimmed = String(text || "").trim();
  if (!trimmed) return "unknown";
  const last = trimmed.replace(/[^\p{L}\p{N}']+$/u, "").split(/\s+/).pop()?.toLowerCase() || "";
  if (/[,;:—-]$/.test(trimmed) || /(\.\.\.|…)$/.test(trimmed)) return "open";
  if (OPEN_WORDS.has(last)) return "open";
  if (/[.?!]["')\]]?$/.test(trimmed)) return "complete";
  return "unknown";
}

export const PACE = { fast: 0.8, balanced: 1, patient: 1.45 };

/**
 * How long a silence must last before the session ends on its own.
 * @param {{ speechMs: number, pauses: number[], hint?: "complete" | "open" | "unknown", pace?: keyof typeof PACE }} input
 */
export function requiredSilenceMs({ speechMs = 0, pauses = [], hint = "unknown", pace = "balanced" } = {}) {
  let ms = 1_350;
  if (pauses.length >= 2) {
    // The speaker's own rhythm: comfortably longer than the pauses they have already resumed from.
    const sorted = [...pauses].sort((a, b) => a - b);
    const typical = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.85))];
    ms = clamp(typical * 1.9 + 380, 950, 2_400);
  } else if (speechMs < 1_600) {
    ms = 1_200;                          // a short command or a couple of words: no reason to linger
  }
  if (speechMs > 20_000) ms += 300;      // long-form dictation: thinking pauses get longer
  if (hint === "complete") ms *= 0.9;
  else if (hint === "open") ms = Math.max(ms * 1.6, 1_900);
  ms *= PACE[pace] ?? 1;
  return Math.round(clamp(ms, 800, 3_600));
}
