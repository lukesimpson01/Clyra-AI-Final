/**
 * Assemble lightweight live speech captions from overlapping local STT windows.
 * A partial may begin at the start of the utterance or at the beginning of
 * a sliding ~8-second window. Keep confirmed earlier words when windows roll,
 * while allowing new model hypotheses to correct the uncommitted tail.
 * The final full-utterance transcript always overrides this display estimate.
 */
function tokens(text: string) {
  return text.trim().split(/\s+/).filter(Boolean);
}
function matchWord(a: string, b: string) {
  const normalise = (word: string) => word.normalize("NFKC").replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "").toLocaleLowerCase();
  return normalise(a) === normalise(b);
}
export class TranscriptStabilizer {
  private visible: string[] = [];
  update(partial: string) {
    const next = tokens(partial);
    if (!next.length) return this.visible.join(" ");
    if (!this.visible.length) { this.visible = next; return next.join(" "); }
    // Partial hypotheses normally repeat the beginning of the recording.
    let prefix = 0;
    while (prefix < Math.min(next.length, this.visible.length) && matchWord(next[prefix]!, this.visible[prefix]!)) prefix += 1;
    if (prefix >= Math.min(2, next.length, this.visible.length)) {
      this.visible = next;
      return this.visible.join(" ");
    }
    // When the recogniser only sees the latest window, splice the longest
    // matching suffix into our previously displayed transcript.
    let overlap = 0;
    const limit = Math.min(28, this.visible.length, next.length);
    for (let size = limit; size >= 1; size -= 1) {
      if (size === 1 && (next.length < 3 || next[0]!.length < 6)) continue;
      let same = true;
      for (let i = 0; i < size; i += 1) {
        if (!matchWord(this.visible[this.visible.length - size + i]!, next[i]!)) { same = false; break; }
      }
      if (same) { overlap = size; break; }
    }
    this.visible = overlap ? [...this.visible.slice(0, -overlap), ...next] : next;
    return this.visible.join(" ");
  }
  finalize(text: string) {
    this.reset();
    return text.trim();
  }
  reset() { this.visible = []; }
}
