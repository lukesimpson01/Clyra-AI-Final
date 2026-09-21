export type MapQuality = "high" | "medium" | "low";

export interface QualityProfile {
  quality: MapQuality;
  buildingExtrusions: boolean;
  entityLimit: number;
  routeAnimation: boolean;
}

const PROFILES: Record<MapQuality, QualityProfile> = {
  high: { quality: "high", buildingExtrusions: true, entityLimit: 1200, routeAnimation: true },
  medium: { quality: "medium", buildingExtrusions: true, entityLimit: 550, routeAnimation: true },
  low: { quality: "low", buildingExtrusions: false, entityLimit: 180, routeAnimation: false },
};

/** Drops optional visual cost after sustained frame pressure, never map clarity. */
export class PerformanceGovernor {
  private quality: MapQuality;
  private lowFrames = 0;
  private lastFrame = 0;
  private raf = 0;
  private listeners = new Set<(profile: QualityProfile) => void>();

  constructor() {
    const memory = Number((navigator as Navigator & { deviceMemory?: number }).deviceMemory);
    this.quality = Number.isFinite(memory) && memory <= 4 ? "medium" : "high";
  }

  get profile(): QualityProfile { return PROFILES[this.quality]; }
  subscribe(listener: (profile: QualityProfile) => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }

  start(): void {
    if (!this.raf) this.raf = requestAnimationFrame(this.sample);
  }
  stop(): void { if (this.raf) cancelAnimationFrame(this.raf); this.raf = 0; this.lastFrame = 0; }

  private sample = (now: number) => {
    this.raf = 0;
    if (document.hidden) return;
    if (this.lastFrame) {
      const frameMs = now - this.lastFrame;
      this.lowFrames = frameMs > 34 ? this.lowFrames + 1 : Math.max(0, this.lowFrames - 2);
      if (this.lowFrames > 90) this.lowerQuality();
    }
    this.lastFrame = now;
    this.raf = requestAnimationFrame(this.sample);
  };

  private lowerQuality(): void {
    const next: MapQuality = this.quality === "high" ? "medium" : "low";
    if (next === this.quality) return;
    this.quality = next;
    this.lowFrames = 0;
    for (const listener of this.listeners) listener(this.profile);
  }
}
