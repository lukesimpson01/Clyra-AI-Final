import type { NavigationStep } from "../../lib/maps/types";

/** Spoken turn-by-turn using the browser's built-in speech synthesis (no
 * network, no keys). Each manoeuvre is announced once per distance band, so the
 * driver hears "In 400 metres…", "In 150 metres…" and then the turn itself. */
const BANDS = [400, 150, 30];

function phrase(distance: number, instruction: string): string {
  if (distance <= 40) return instruction;
  const rounded = distance >= 1000 ? `${(distance / 1000).toFixed(1)} kilometres` : `${Math.round(distance / 50) * 50} metres`;
  return `In ${rounded}, ${instruction.charAt(0).toLowerCase()}${instruction.slice(1)}`;
}

export class VoiceGuide {
  muted = false;
  private spoken = new Set<string>();
  private lastStep: NavigationStep | null = null;

  static supported() {
    return typeof window !== "undefined" && "speechSynthesis" in window;
  }

  /** Call with the upcoming manoeuvre on every position update. */
  update(step: NavigationStep | undefined, distanceMeters: number | undefined) {
    if (!step || distanceMeters == null || !VoiceGuide.supported()) return;
    if (this.lastStep !== step) {
      this.lastStep = step;
      // First call for a new manoeuvre: announce at the nearest band not yet passed.
      for (const b of BANDS) if (distanceMeters < b) this.spoken.add(`${step.geometryStartIndex}:${b}`);
    }
    for (const band of BANDS) {
      const key = `${step.geometryStartIndex}:${band}`;
      if (distanceMeters <= band && !this.spoken.has(key)) {
        this.spoken.add(key);
        this.say(phrase(distanceMeters, step.instruction));
        return;
      }
    }
  }

  say(text: string) {
    if (this.muted || !VoiceGuide.supported()) return;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(new SpeechSynthesisUtterance(text));
  }

  stop() {
    if (VoiceGuide.supported()) window.speechSynthesis.cancel();
    this.spoken.clear();
    this.lastStep = null;
  }
}
