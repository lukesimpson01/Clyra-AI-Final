import type { SpeechMetrics } from "./types";
export class SpeechPerformanceManager {
  readonly startedAt = performance.now();
  readonly metrics: SpeechMetrics = { captureStart: 0 };
  mark(name: keyof SpeechMetrics) { this.metrics[name] = Math.round(performance.now() - this.startedAt); }
  report(scope: string) { if ((import.meta as { env?: { DEV?: boolean } }).env?.DEV) console.debug(`[speech:${scope}]`, this.metrics); }
}
