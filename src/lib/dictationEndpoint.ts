/**
 * Knowing when you have finished speaking.
 *
 * Reads the microphone level a few times a second and decides, on its own, when to stop. It learns the room first (a
 * quiet office and a noisy kitchen need different thresholds), waits for real speech, and then ends after a pause
 * that is longer than the pauses you took while talking, so it neither cuts you off mid-thought nor sits there
 * listening to silence. If nothing is said it says so instead of waiting forever.
 */
export type EndpointEvent =
  | { kind: "none" }
  | { kind: "speech-start" }
  | { kind: "end"; silenceMs: number }
  | { kind: "no-speech" }
  | { kind: "max-length" };

export interface EndpointOptions {
  /** Silence after speech that ends the recording, before adapting to how you pause. */
  baseSilenceMs?: number;
  maxSilenceMs?: number;
  /** Give up if no speech is heard in this long. */
  noSpeechMs?: number;
  maxLengthMs?: number;
}

export class SpeechEndpointer {
  private readonly o: Required<EndpointOptions>;
  private startedAt = 0;
  private floor = 0.02;
  private calibrating = true;
  private sampled = false;
  private speaking = false;
  private speechMs = 0;
  private aboveSince = 0;
  private lastAboveAt = 0;
  private lastTick = 0;
  private pauseStart = 0;
  private longestPause = 0;
  private ended = false;

  constructor(options: EndpointOptions = {}) {
    this.o = { baseSilenceMs: 1100, maxSilenceMs: 1900, noSpeechMs: 9000, maxLengthMs: 180_000, ...options };
  }

  reset(now = performance.now()) {
    this.startedAt = now;
    this.floor = 0.02;
    this.calibrating = true;
    this.sampled = false;
    this.speaking = false;
    this.speechMs = 0;
    this.aboveSince = 0;
    this.lastAboveAt = 0;
    this.lastTick = now;
    this.pauseStart = 0;
    this.longestPause = 0;
    this.ended = false;
  }

  /** Feed one level reading (0..1). Returns what, if anything, just happened. */
  push(level: number, now = performance.now()): EndpointEvent {
    if (this.ended) return { kind: "none" };
    if (!this.startedAt) this.reset(now);
    const dt = Math.min(250, now - this.lastTick);
    this.lastTick = now;
    const elapsed = now - this.startedAt;

    // The first moments are the room: take the quietest level seen as its floor.
    if (this.calibrating) {
      // Loud right away means the speaker started before the room could be measured: keep the default floor.
      if (level < 0.12) this.floor = this.sampled ? this.floor * 0.6 + level * 0.4 : level;
      if (level < 0.12) this.sampled = true;
      if (elapsed > 450) this.calibrating = false;
    }
    const on = Math.max(0.05, this.floor * 3.2);
    const off = Math.max(0.032, this.floor * 2.3);
    const loud = level >= (this.speaking ? off : on);

    if (loud) {
      if (!this.aboveSince) this.aboveSince = now;
      this.lastAboveAt = now;
      if (!this.speaking && now - this.aboveSince >= 90) {
        this.speaking = true;
        this.speechMs = 0;
        this.longestPause = this.pauseStart ? Math.max(this.longestPause, now - this.pauseStart) : this.longestPause;
        this.pauseStart = 0;
        return { kind: "speech-start" };
      }
      if (this.speaking) {
        if (this.pauseStart) { this.longestPause = Math.max(this.longestPause, now - this.pauseStart); this.pauseStart = 0; }
        this.speechMs += dt;
      }
    } else {
      this.aboveSince = 0;
      if (!this.speaking) {
        // learn a drifting room slowly while nobody is speaking
        this.floor = this.floor * 0.97 + level * 0.03;
      } else if (!this.pauseStart) {
        this.pauseStart = now;
      }
    }

    if (!this.speaking && elapsed >= this.o.noSpeechMs) { this.ended = true; return { kind: "no-speech" }; }
    if (elapsed >= this.o.maxLengthMs) { this.ended = true; return { kind: "max-length" }; }

    if (this.speaking && this.speechMs >= 350 && this.lastAboveAt) {
      const silence = now - this.lastAboveAt;
      // Wait longer than the longest breath you took mid-sentence; a short command ends sooner than a long thought.
      const habit = this.longestPause > 0 ? this.longestPause * 1.5 : 0;
      const shortUtterance = this.speechMs < 1800 ? 0.85 : 1;
      const need = Math.min(this.o.maxSilenceMs, Math.max(this.o.baseSilenceMs * shortUtterance, habit));
      if (silence >= need) { this.ended = true; return { kind: "end", silenceMs: Math.round(silence) }; }
    }
    return { kind: "none" };
  }
}
