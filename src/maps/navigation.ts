/**
 * Clyra Maps — navigation smoothing.
 *
 * GPS / geolocation samples are noisy. This interpolates between raw samples so
 * the location dot and the navigation camera glide instead of teleporting on
 * every update. Position, heading and speed are all eased, with a gentle
 * bearing wrap so the camera never spins the long way around.
 */

export interface LocationSample {
  lon: number;
  lat: number;
  accuracyM: number;
  heading: number | null;
  speedMps: number | null;
  timestamp: number;
}

export interface SmoothedSample extends LocationSample {}

type Listener = (sample: SmoothedSample) => void;

const SMOOTH_WINDOW_MS = 450;

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function wrapDegrees(angle: number): number {
  return ((angle % 360) + 360) % 360;
}

function lerpHeading(from: number, to: number, t: number): number {
  let delta = wrapDegrees(to - from);
  if (delta > 180) delta -= 360;
  return wrapDegrees(from + delta * t);
}

/**
 * Eases between raw geolocation samples. Feed samples via `push`; listeners
 * receive interpolated values every animation frame until the target settles.
 */
export class NavigationSmoother {
  private current: SmoothedSample | null = null;
  private target: LocationSample | null = null;
  private startedAt = 0;
  private raf = 0;
  private listeners = new Set<Listener>();

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  push(sample: LocationSample): void {
    this.target = sample;
    this.startedAt = performance.now();
    if (!this.current) {
      this.current = { ...sample };
      this.emit();
    }
    if (!this.raf) this.raf = requestAnimationFrame(this.step);
  }

  private step = (now: number) => {
    this.raf = 0;
    const target = this.target;
    const current = this.current;
    if (!target || !current) return;

    const elapsed = now - this.startedAt;
    const t = Math.min(1, elapsed / SMOOTH_WINDOW_MS);
    const eased = 1 - Math.pow(1 - t, 3); // easeOutCubic

    const next: SmoothedSample = {
      lon: lerp(current.lon, target.lon, eased),
      lat: lerp(current.lat, target.lat, eased),
      accuracyM: lerp(current.accuracyM, target.accuracyM, eased),
      heading: current.heading != null && target.heading != null
        ? lerpHeading(current.heading, target.heading, eased)
        : target.heading,
      speedMps: current.speedMps != null && target.speedMps != null
        ? lerp(current.speedMps, target.speedMps, eased)
        : target.speedMps,
      timestamp: target.timestamp,
    };
    this.current = next;
    this.emit();

    if (t < 1) {
      this.raf = requestAnimationFrame(this.step);
    } else {
      this.current = { ...target };
    }
  };

  private emit(): void {
    if (!this.current) return;
    for (const listener of this.listeners) listener(this.current);
  }

  reset(): void {
    this.current = null;
    this.target = null;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  dispose(): void {
    this.reset();
    this.listeners.clear();
  }
}
