/**
 * Finds where the speech is in a recording, so Clyra only transcribes speech.
 *
 * A small energy detector with an adaptive noise floor: it measures the room from the quietest part of the clip, so a
 * noisy kitchen and a silent office both work, and keeps only the stretches that rise clearly above it. It costs a few
 * milliseconds and no model, which is why it runs on every clip. Trimming does three things at once:
 *   - faster: the speech model decodes seconds of speech, not seconds of silence;
 *   - more accurate: silence and room noise are what speech models invent words from;
 *   - honest: a clip with no speech in it returns "no speech" instead of a made-up sentence.
 *
 * Plain JavaScript so both the server (TypeScript) and the Electron main process (Flow) share one implementation.
 */
const FRAME_MS = 20;
const PAD_MS = 160;
const HANGOVER_MS = 320;
const MIN_SPEECH_MS = 200;
const MAX_GAP_KEPT_MS = 380;

/** @param {Buffer} pcm 16-bit mono PCM  @param {number} [sampleRate] */
export function analyzeSpeech(pcm, sampleRate = 16_000) {
  const frameSamples = Math.round((sampleRate * FRAME_MS) / 1000);
  const frames = Math.floor(pcm.length / 2 / frameSamples);
  const durationMs = Math.round((pcm.length / 2 / sampleRate) * 1000);
  if (frames < 5) return { durationMs, speechMs: 0, segments: [], noiseFloorDb: -90, noSpeech: true, trimmed: Buffer.alloc(0) };

  const db = new Float32Array(frames);
  for (let f = 0; f < frames; f += 1) {
    let sum = 0;
    const base = f * frameSamples * 2;
    for (let i = 0; i < frameSamples; i += 1) {
      const v = pcm.readInt16LE(base + i * 2) / 32768;
      sum += v * v;
    }
    db[f] = 10 * Math.log10(sum / frameSamples + 1e-10);
  }
  // Room level: the 15th percentile of frame energy, floored so digital silence doesn't set an absurd threshold.
  const sorted = Array.from(db).sort((a, b) => a - b);
  const floor = Math.max(-75, sorted[Math.floor(sorted.length * 0.15)]);
  // Speech must sit clearly above the room, and above an absolute whisper-level minimum.
  const threshold = Math.max(floor + 9, -52);
  // A frame is "speech" only inside a run of 3+ loud frames, so a click or a cough isn't a sentence.
  const loud = Array.from(db, (v) => v >= threshold);
  const voiced = new Array(frames).fill(false);
  for (let f = 0; f < frames; ) {
    if (!loud[f]) { f += 1; continue; }
    let g = f;
    while (g < frames && loud[g]) g += 1;
    if ((g - f) * FRAME_MS >= 60) for (let k = f; k < g; k += 1) voiced[k] = true;
    f = g;
  }
  // Hangover: speech continues briefly through the soft end of a word.
  const hang = Math.round(HANGOVER_MS / FRAME_MS);
  const speech = voiced.slice();
  let since = Infinity;
  for (let f = 0; f < frames; f += 1) {
    if (voiced[f]) since = 0; else since += 1;
    if (!voiced[f] && since <= hang) speech[f] = true;
  }
  const raw = [];
  for (let f = 0; f < frames; ) {
    if (!speech[f]) { f += 1; continue; }
    let g = f;
    while (g < frames && speech[g]) g += 1;
    raw.push([f, g]);
    f = g;
  }
  const speechMs = raw.reduce((sum, [a, b]) => sum + (b - a) * FRAME_MS, 0) - raw.length * HANGOVER_MS;
  if (!raw.length || speechMs < MIN_SPEECH_MS) {
    return { durationMs, speechMs: Math.max(0, speechMs), segments: [], noiseFloorDb: Math.round(floor), noSpeech: true, trimmed: Buffer.alloc(0) };
  }
  const padFrames = Math.round(PAD_MS / FRAME_MS);
  const segments = [];
  for (const [a, b] of raw) {
    const start = Math.max(0, a - padFrames);
    const end = Math.min(frames, b + padFrames);
    const last = segments[segments.length - 1];
    if (last && start <= last[1]) last[1] = Math.max(last[1], end);
    else segments.push([start, end]);
  }
  // Rebuild: speech kept whole, silence between segments shortened to at most MAX_GAP_KEPT_MS.
  const parts = [];
  const gapFrames = Math.round(MAX_GAP_KEPT_MS / FRAME_MS);
  segments.forEach(([a, b], i) => {
    if (i > 0) {
      const gap = a - segments[i - 1][1];
      const keep = Math.min(gap, gapFrames);
      const from = segments[i - 1][1] * frameSamples * 2;
      parts.push(pcm.subarray(from, from + keep * frameSamples * 2));
    }
    parts.push(pcm.subarray(a * frameSamples * 2, b * frameSamples * 2));
  });
  return {
    durationMs,
    speechMs,
    segments: segments.map(([a, b]) => [a * FRAME_MS, b * FRAME_MS]),
    noiseFloorDb: Math.round(floor),
    noSpeech: false,
    trimmed: Buffer.concat(parts),
  };
}

/**
 * How fast the person is talking, in syllable-like beats per second of speech: the energy of speech rises and falls
 * with each syllable, so counting those peaks (spaced at least 110 ms apart) gives a rate with no model at all.
 */
export function estimateSpeechRate(pcm, sampleRate = 16_000) {
  const frameSamples = Math.round((sampleRate * 10) / 1000); // 10 ms
  const frames = Math.floor(pcm.length / 2 / frameSamples);
  if (frames < 30) return 0;
  const e = new Float32Array(frames);
  for (let f = 0; f < frames; f += 1) {
    let sum = 0;
    for (let i = 0; i < frameSamples; i += 1) { const v = pcm.readInt16LE((f * frameSamples + i) * 2) / 32768; sum += v * v; }
    e[f] = 10 * Math.log10(sum / frameSamples + 1e-10);
  }
  const sm = new Float32Array(frames);
  for (let f = 0; f < frames; f += 1) { let a = 0, n = 0; for (let k = -2; k <= 2; k += 1) { const j = f + k; if (j >= 0 && j < frames) { a += e[j]; n += 1; } } sm[f] = a / n; }
  const sorted = Array.from(sm).sort((a, b) => a - b);
  const floor = sorted[Math.floor(sorted.length * 0.15)];
  const gate = Math.max(floor + 12, -50);
  let peaks = 0, last = -100, speechFrames = 0;
  for (let f = 2; f < frames - 2; f += 1) {
    if (sm[f] >= gate) speechFrames += 1;
    const isPeak = sm[f] >= gate && sm[f] > sm[f - 1] && sm[f] >= sm[f + 1] && sm[f] - Math.min(sm[Math.max(0, f - 8)], sm[Math.min(frames - 1, f + 8)]) >= 4;
    if (isPeak && f - last >= 11) { peaks += 1; last = f; }
  }
  const seconds = speechFrames / 100;
  return seconds < 0.8 ? 0 : peaks / seconds;
}

/** Pitch-preserving time stretch (WSOLA). tempo < 1 slows the speech down without making it deeper. */
export function timeStretch(pcm, tempo) {
  if (!(tempo > 0 && tempo < 0.999)) return pcm;
  const n = Math.floor(pcm.length / 2);
  const x = new Float32Array(n);
  for (let i = 0; i < n; i += 1) x[i] = pcm.readInt16LE(i * 2);
  const N = 480, H = 240, TOL = 120;
  const outLen = Math.ceil(n / tempo) + N;
  const out = new Float32Array(outLen);
  const win = new Float32Array(N);
  for (let i = 0; i < N; i += 1) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N);
  let prev = 0;
  for (let k = 0, o = 0; o + N < outLen; k += 1, o += H) {
    const nominal = Math.round(k * H * tempo);
    let best = nominal;
    if (k > 0) {
      // the frame whose start best continues the previous one (the sound that would have followed it naturally)
      const ref = prev + H;
      let bestScore = -Infinity;
      for (let off = -TOL; off <= TOL; off += 4) {
        const cand = nominal + off;
        if (cand < 0 || cand + H >= n || ref + H >= n) continue;
        let dot = 0;
        for (let i = 0; i < H; i += 4) dot += x[ref + i] * x[cand + i];
        if (dot > bestScore) { bestScore = dot; best = cand; }
      }
    }
    if (best + N > n) break;
    for (let i = 0; i < N; i += 1) out[o + i] += x[best + i] * win[i];
    prev = best;
  }
  const outBuf = Buffer.alloc(Math.min(outLen, Math.ceil(n / tempo)) * 2);
  for (let i = 0; i < outBuf.length / 2; i += 1) outBuf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(out[i]))), i * 2);
  return outBuf;
}

/** Fast talkers are slowed a little before decoding (a measured gain in accuracy); normal and slow speech is untouched. */
export function pickTempo(rate) {
  if (rate < 6.4) return 1;
  return Math.max(0.78, Math.min(1, 5.4 / rate));
}
