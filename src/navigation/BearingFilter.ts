/** Shortest-angle smoothing so the blue-dot heading cone (and the camera
 * bearing) never spins the "long way round" through 350°→10°, and never
 * snaps instantly on noisy geometry. */
export class BearingFilter {
  private current: number;
  private readonly smoothing: number;

  constructor(initial: number, smoothing = 0.18) {
    this.current = normalize(initial);
    this.smoothing = smoothing;
  }

  update(target: number): number {
    const delta = shortestDelta(this.current, normalize(target));
    this.current = normalize(this.current + delta * this.smoothing);
    return this.current;
  }

  /** Snap immediately — used on navigation start/reroute, not during normal travel. */
  set(value: number) {
    this.current = normalize(value);
  }

  get value() {
    return this.current;
  }
}

function normalize(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

function shortestDelta(from: number, to: number): number {
  let delta = to - from;
  if (delta > 180) delta -= 360;
  if (delta < -180) delta += 360;
  return delta;
}
