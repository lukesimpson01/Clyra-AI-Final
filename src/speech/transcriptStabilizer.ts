/** Locks stable words so partial STT updates only alter the live tail. */
export class TranscriptStabilizer {
  private locked: string[] = [];
  private previous: string[] = [];
  update(partial: string) {
    const next = partial.trim().split(/\s+/).filter(Boolean);
    let common = 0;
    while (common < next.length && common < this.previous.length && next[common]?.toLowerCase() === this.previous[common]?.toLowerCase()) common += 1;
    // A word must survive two partials before being locked; retain a 3-word tail for corrections.
    const safe = Math.max(0, common - 3);
    this.locked = next.slice(0, safe);
    this.previous = next;
    return [...this.locked, ...next.slice(safe)].join(" ");
  }
  finalize(text: string) { this.locked = []; this.previous = []; return text.trim(); }
  reset() { this.locked = []; this.previous = []; }
}
