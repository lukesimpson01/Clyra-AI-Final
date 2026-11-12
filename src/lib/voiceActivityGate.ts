/** Adaptive, low-cost amplitude gate. Noise is learned only from quiet
 * frames, so a fast or soft voice doesn't train itself into silence.
 * Speech recognition remains authoritative for the words and punctuation.
 */
export class VoiceActivityGate {
  private floor = 0.012;
  private speech = false;

  reset() {
    this.floor = 0.012;
    this.speech = false;
  }

  setSpeaking(value: boolean) { this.speech = value; }

  test(input: number, speaking = this.speech, playback = false): boolean {
    const level = Number.isFinite(input) ? Math.max(0, Math.min(1, input)) : 0;
    // Keep the estimated background from chasing a loud syllable.
    if (!speaking && !playback && level <= this.floor * 1.65 + 0.024) {
      const rate = level < this.floor ? 0.055 : 0.012;
      this.floor = Math.max(0.006, Math.min(0.20, this.floor * (1 - rate) + level * rate));
    }
    // Hysteresis keeps rapid syllables together; TTS playback requires a
    // stronger microphone signal to avoid interrupting itself from echo.
    const threshold = playback
      ? Math.max(0.125, this.floor * 2.6 + 0.06)
      : speaking
        ? Math.max(0.024, this.floor * 1.12 + 0.012)
        : Math.max(0.035, this.floor * 1.55 + 0.014);
    return level >= threshold;
  }
}
