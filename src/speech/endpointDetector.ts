export type EndpointSample = { level: number; partial: string; now?: number };
/** Adaptive local endpointing: short complete replies end quickly, clauses wait longer. */
export class EndpointDetector {
  private speechStartedAt = 0;
  private lastSpeechAt = 0;
  private heard = false;
  reset() { this.speechStartedAt = 0; this.lastSpeechAt = 0; this.heard = false; }
  push({ level, partial, now = performance.now() }: EndpointSample) {
    if (level >= 0.045) {
      if (!this.heard) this.speechStartedAt = now;
      this.heard = true; this.lastSpeechAt = now;
      return false;
    }
    if (!this.heard || now - this.speechStartedAt < 280) return false;
    const unfinished = /(?:,|\b(and|but|because|if|so|that|to|with))$/i.test(partial.trim());
    const duration = now - this.speechStartedAt;
    const silence = unfinished || duration > 3500 ? 680 : partial.trim().split(/\s+/).length <= 3 ? 340 : 520;
    return now - this.lastSpeechAt >= silence;
  }
}
