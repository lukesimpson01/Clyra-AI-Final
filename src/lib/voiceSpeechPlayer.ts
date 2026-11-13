/**
 * Small, interruptible native speech queue for live Clyra calls.
 * Uses installed system voices; no model is loaded on the UI thread, no
 * credentials are required, and generation IDs isolate cancelled utterances.
 */
export class VoiceSpeechPlayer {
  private readonly synth: SpeechSynthesis | null;
  private pending = "";
  private queue: string[] = [];
  private current = false;
  private finished = false;
  private generation = 0;
  private voice: SpeechSynthesisVoice | null = null;
  private onDrained: () => void;
  private onSpeechEvent: ((event: "start" | "word" | "stop") => void) | null;
  constructor(onDrained: () => void, onSpeechEvent?: (event: "start" | "word" | "stop") => void) {
    this.synth = typeof window === "undefined" || !("speechSynthesis" in window) ? null : window.speechSynthesis;
    this.onDrained = onDrained;
    this.onSpeechEvent = onSpeechEvent || null;
  }
  get available() { return Boolean(this.synth && typeof SpeechSynthesisUtterance !== "undefined"); }
  get speaking() { return this.current; }
  /** Stops playback synchronously, including queued text from a previous turn. */
  interrupt() {
    this.generation += 1;
    this.pending = "";
    this.queue = [];
    this.current = false;
    this.finished = false;
    this.onSpeechEvent?.("stop");
    try { this.synth?.cancel(); } catch { /* speech backend already stopped */ }
  }
  append(text: string) {
    if (!text) return;
    this.pending += text;
    // Sentence-first chunks sound natural; after about twelve words we start
    // anyway so a long first sentence cannot delay audible speech.
    while (this.pending.length) {
      const sentence = this.pending.match(/^[\s\S]*?[.!?](?=\s|$)/);
      const limit = this.pending.length >= 82 ? this.pending.lastIndexOf(" ", 78) : -1;
      const count = sentence?.[0]?.length && sentence[0].length <= 115
        ? sentence[0].length
        : limit >= 45 ? limit + 1 : 0;
      if (!count) break;
      const chunk = this.pending.slice(0, count).trim();
      this.pending = this.pending.slice(count);
      if (chunk) this.queue.push(chunk);
    }
    this.pump();
  }
  complete() {
    if (this.pending.trim()) this.queue.push(this.pending.trim());
    this.pending = "";
    this.finished = true;
    this.pump();
  }
  private selectVoice() {
    if (!this.synth) return null;
    const voices = this.synth.getVoices();
    const english = voices.filter((voice) => /^en(?:-|$)/i.test(voice.lang));
    return english.find((voice) => /natural|enhanced|premium|neural/i.test(voice.name))
      || english.find((voice) => /^en-AU/i.test(voice.lang))
      || english.find((voice) => voice.localService && voice.default)
      || english.find((voice) => voice.localService)
      || english[0] || null;
  }
  private pump() {
    if (this.current) return;
    const next = this.queue.shift();
    if (!next) {
      if (this.finished) { this.finished = false; this.onSpeechEvent?.("stop"); this.onDrained(); }
      return;
    }
    if (!this.available) { this.pump(); return; }
    const generation = this.generation;
    const utterance = new SpeechSynthesisUtterance(next);
    this.voice ||= this.selectVoice();
    if (this.voice) utterance.voice = this.voice;
    utterance.rate = 1.08;
    utterance.pitch = 1;
    this.current = true;
    const done = () => {
      if (generation !== this.generation) return;
      this.current = false;
      this.pump();
    };
    utterance.onstart = () => { if (generation === this.generation) this.onSpeechEvent?.("start"); };
    utterance.onboundary = (event) => { if (generation === this.generation && event.name === "word") this.onSpeechEvent?.("word"); };
    utterance.onend = done;
    utterance.onerror = done;
    try {
      // Some desktop speech backends remain paused after a previous utterance
      // was cancelled; resume on the same user-authorised voice session.
      if (this.synth!.paused) this.synth!.resume();
      this.synth!.speak(utterance);
    } catch { done(); }
  }
}
