/**
 * Deterministic randomness (spec §191).
 *
 * Every generator takes an explicit seed and uses this. `Math.random()` is
 * never called inside a generator, so "regenerate that house with a
 * different roof" reproduces everything else exactly.
 */

/** mulberry32 — small, fast, good enough distribution for content. */
export class Rng {
  private state: number;

  constructor(seed: number) {
    this.state = (seed >>> 0) || 0x9e3779b9;
  }

  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  int(min: number, max: number): number {
    return Math.floor(this.range(min, max + 1));
  }

  bool(probability = 0.5): boolean {
    return this.next() < probability;
  }

  pick<T>(items: readonly T[]): T {
    if (!items.length) throw new Error("Rng.pick called with an empty list.");
    return items[Math.min(items.length - 1, Math.floor(this.next() * items.length))]!;
  }

  shuffle<T>(items: T[]): T[] {
    const out = [...items];
    for (let index = out.length - 1; index > 0; index -= 1) {
      const swap = Math.floor(this.next() * (index + 1));
      [out[index], out[swap]] = [out[swap]!, out[index]!];
    }
    return out;
  }

  /** A derived, independent stream — so sub-generators do not desync siblings. */
  fork(salt: number): Rng {
    return new Rng((this.state ^ Math.imul(salt + 1, 0x85ebca6b)) >>> 0);
  }
}

/** Stable 32-bit hash, used to derive seeds from names. */
export function hashString(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/* ---------------- value noise ---------------- */

function hash2(x: number, y: number, seed: number): number {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const smooth = (t: number) => t * t * (3 - 2 * t);

export function valueNoise2D(x: number, y: number, seed: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = smooth(x - x0);
  const fy = smooth(y - y0);
  const n00 = hash2(x0, y0, seed);
  const n10 = hash2(x0 + 1, y0, seed);
  const n01 = hash2(x0, y0 + 1, seed);
  const n11 = hash2(x0 + 1, y0 + 1, seed);
  return (n00 * (1 - fx) + n10 * fx) * (1 - fy) + (n01 * (1 - fx) + n11 * fx) * fy;
}

export interface FbmOptions {
  octaves?: number;
  frequency?: number;
  lacunarity?: number;
  gain?: number;
}

/** Fractal brownian motion in [0, 1]. The base of every terrain generator. */
export function fbm2D(x: number, y: number, seed: number, options: FbmOptions = {}): number {
  const octaves = options.octaves ?? 5;
  let frequency = options.frequency ?? 1;
  const lacunarity = options.lacunarity ?? 2.03;
  const gain = options.gain ?? 0.5;
  let amplitude = 1;
  let sum = 0;
  let normalisation = 0;
  for (let octave = 0; octave < octaves; octave += 1) {
    sum += valueNoise2D(x * frequency, y * frequency, seed + octave * 7919) * amplitude;
    normalisation += amplitude;
    amplitude *= gain;
    frequency *= lacunarity;
  }
  return sum / (normalisation || 1);
}

/** Ridged noise — mountain spines rather than rolling hills. */
export function ridgeNoise2D(x: number, y: number, seed: number, options: FbmOptions = {}): number {
  const raw = fbm2D(x, y, seed, options);
  return 1 - Math.abs(raw * 2 - 1);
}
