/**
 * Development-only typing diagnostics: input-to-next-frame latency, long main-thread tasks and dropped frames while typing.
 * Read the summary in the console with `window.__clyraTyping.summary()`. It measures; it never changes how typing works.
 */
type Sample = { latency: number };

export class InputPerformanceMonitor {
  private samples: Sample[] = [];
  private longTasks: number[] = [];
  private starts = new Map<EventTarget, number>();
  private observer: PerformanceObserver | null = null;
  private onBefore = (event: Event) => { if (event.target) this.starts.set(event.target, performance.now()); };
  private onInput = (event: Event) => {
    const target = event.target;
    const start = target ? this.starts.get(target) : undefined;
    if (start === undefined) return;
    this.starts.delete(target as EventTarget);
    requestAnimationFrame(() => { this.samples.push({ latency: performance.now() - start }); if (this.samples.length > 600) this.samples.shift(); });
  };

  start() {
    document.addEventListener("beforeinput", this.onBefore, true);
    document.addEventListener("input", this.onInput, true);
    try {
      this.observer = new PerformanceObserver((list) => { for (const entry of list.getEntries()) this.longTasks.push(entry.duration); });
      this.observer.observe({ entryTypes: ["longtask"] });
    } catch { /* long-task entries are not available everywhere */ }
    (window as unknown as { __clyraTyping?: unknown }).__clyraTyping = { summary: () => this.summary(), reset: () => { this.samples = []; this.longTasks = []; } };
    return () => this.stop();
  }

  stop() {
    document.removeEventListener("beforeinput", this.onBefore, true);
    document.removeEventListener("input", this.onInput, true);
    this.observer?.disconnect();
  }

  summary() {
    const sorted = this.samples.map((s) => s.latency).sort((a, b) => a - b);
    const pick = (p: number) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] : 0);
    return { keystrokes: sorted.length, p50: +pick(0.5).toFixed(1), p95: +pick(0.95).toFixed(1), max: +(sorted[sorted.length - 1] ?? 0).toFixed(1), longTasks: this.longTasks.length, worstLongTask: +Math.max(0, ...this.longTasks).toFixed(1) };
  }
}
