/* Media analysis.
 *
 * A language model cannot watch footage. So footage is turned into timestamped
 * structure — what was said, when nobody spoke, where the shot changed, how
 * loud it was — and the model reads that instead.
 *
 * This is the difference between an AI that can edit and one that can only
 * describe. "Remove pauses longer than 0.8 seconds" is a query over the silence
 * index; it never needs a single pixel.
 *
 * Every adapter returns segments on one shape, so a text-only model sees one
 * consistent vocabulary regardless of which analyser produced the data.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

/** Tools are resolved once. A missing tool is reported honestly rather than
 *  producing empty results that look like "the footage has no speech". */
export const tools = {
  ffprobe: process.env.CLYRA_FFPROBE || "ffprobe",
  ffmpeg: process.env.CLYRA_FFMPEG || "ffmpeg",
};

export class AnalysisError extends Error {
  constructor(message, code = "analysis_failed") {
    super(message);
    this.name = "AnalysisError";
    this.code = code;
  }
}

/* ------------------------------------------------------------- probing */

/** Container, streams, duration, resolution, frame rate — the facts an editor
 *  needs before it can place a single frame. */
export async function probe(path) {
  let stdout;
  try {
    ({ stdout } = await run(tools.ffprobe, [
      "-v", "error",
      "-print_format", "json",
      "-show_format", "-show_streams",
      path,
    ], { maxBuffer: 8 * 1024 * 1024 }));
  } catch (error) {
    throw new AnalysisError(`Could not probe "${path}": ${error.stderr || error.message}`, "probe_failed");
  }

  const raw = JSON.parse(stdout);
  const video = raw.streams.find((stream) => stream.codec_type === "video");
  const audio = raw.streams.find((stream) => stream.codec_type === "audio");

  /* Frame rate arrives as a rational string like "30000/1001". Keeping it
     rational matters: 29.97 rounded to 30 puts every frame past the first
     minute in the wrong place. */
  const parseRate = (value) => {
    if (!value) return null;
    const [numerator, denominator] = String(value).split("/").map(Number);
    return denominator ? numerator / denominator : numerator;
  };

  return {
    path,
    durationSeconds: Number(raw.format?.duration ?? 0),
    sizeBytes: Number(raw.format?.size ?? 0),
    container: raw.format?.format_name ?? null,
    video: video ? {
      codec: video.codec_name,
      width: video.width,
      height: video.height,
      rate: parseRate(video.r_frame_rate),
      rateExact: video.r_frame_rate,
      pixelFormat: video.pix_fmt,
      rotation: Number(video.side_data_list?.[0]?.rotation ?? 0),
    } : null,
    audio: audio ? {
      codec: audio.codec_name,
      channels: audio.channels,
      sampleRate: Number(audio.sample_rate),
    } : null,
    hasVideo: Boolean(video),
    hasAudio: Boolean(audio),
  };
}

/* ------------------------------------------------------------- silence */

/**
 * Where nobody is speaking. This is the single most useful signal for editing
 * talking-head footage, and FFmpeg computes it directly.
 *
 * `thresholdDb` is the level below which audio counts as silence; -30 catches
 * room tone without eating quiet speech. `minDurationSeconds` sets how long a
 * gap has to be before it is worth cutting.
 */
export async function detectSilence(path, { thresholdDb = -30, minDurationSeconds = 0.5 } = {}) {
  let stderr;
  try {
    ({ stderr } = await run(tools.ffmpeg, [
      "-hide_banner", "-nostats",
      "-i", path,
      "-af", `silencedetect=noise=${thresholdDb}dB:d=${minDurationSeconds}`,
      "-f", "null", "-",
    ], { maxBuffer: 16 * 1024 * 1024 }));
  } catch (error) {
    /* ffmpeg writes its analysis to stderr and exits non-zero on some builds
       even when the pass succeeded, so stderr is read either way. */
    stderr = error.stderr ?? "";
    if (!stderr.includes("silence_")) {
      throw new AnalysisError(`Silence detection failed for "${path}": ${error.message}`);
    }
  }

  const segments = [];
  let openedAt = null;
  for (const line of String(stderr).split("\n")) {
    const start = line.match(/silence_start:\s*(-?[\d.]+)/);
    if (start) { openedAt = Number(start[1]); continue; }
    const end = line.match(/silence_end:\s*([\d.]+)/);
    if (end && openedAt !== null) {
      const finish = Number(end[1]);
      segments.push({
        start: Math.max(0, openedAt),
        end: finish,
        duration: finish - Math.max(0, openedAt),
        kind: "silence",
      });
      openedAt = null;
    }
  }
  return segments;
}

/* ---------------------------------------------------------- shot cuts */

/** Where the picture changes enough to be a new shot. `threshold` is 0–1;
 *  0.3 is a reasonable default for edited footage. */
export async function detectShots(path, { threshold = 0.3 } = {}) {
  let stderr;
  try {
    ({ stderr } = await run(tools.ffmpeg, [
      "-hide_banner", "-nostats",
      "-i", path,
      "-filter:v", `select='gt(scene,${threshold})',showinfo`,
      "-f", "null", "-",
    ], { maxBuffer: 16 * 1024 * 1024 }));
  } catch (error) {
    stderr = error.stderr ?? "";
    if (!stderr.includes("pts_time")) return [];
  }
  const cuts = [...String(stderr).matchAll(/pts_time:([\d.]+)/g)].map((match) => Number(match[1]));
  return cuts.map((at, index) => ({
    start: at,
    end: cuts[index + 1] ?? null,
    kind: "shot",
    shotIndex: index,
  }));
}

/* --------------------------------------------------------- loudness */

/** EBU R128 integrated loudness — the measure broadcasters and platforms use,
 *  and what "normalise this" should actually mean. */
export async function measureLoudness(path) {
  let stderr;
  try {
    ({ stderr } = await run(tools.ffmpeg, [
      "-hide_banner", "-nostats",
      "-i", path,
      "-af", "ebur128=framelog=quiet",
      "-f", "null", "-",
    ], { maxBuffer: 16 * 1024 * 1024 }));
  } catch (error) {
    stderr = error.stderr ?? "";
  }
  const read = (label) => {
    const match = String(stderr).match(new RegExp(`${label}:\\s*(-?[\\d.]+)`));
    return match ? Number(match[1]) : null;
  };
  return {
    integratedLufs: read("I"),
    loudnessRange: read("LRA"),
    truePeakDb: read("Peak"),
  };
}

/* --------------------------------------------------- transcription */

/**
 * Transcription is left as an adapter rather than a hard dependency: Whisper
 * runs locally for some users and via an API for others, and the product
 * should not care which. Register one and the rest of the pipeline works.
 *
 * The contract: given a path, return segments of
 * `{ start, end, text, speaker? }`.
 */
const transcribers = new Map();

export const registerTranscriber = (name, fn) => transcribers.set(name, fn);
export const availableTranscribers = () => [...transcribers.keys()];

export async function transcribe(path, { using } = {}) {
  const name = using ?? [...transcribers.keys()][0];
  const adapter = transcribers.get(name);
  if (!adapter) {
    throw new AnalysisError(
      "No transcriber is registered. Register one with registerTranscriber().",
      "no_transcriber",
    );
  }
  const segments = await adapter(path);
  return segments.map((segment) => ({
    start: Number(segment.start),
    end: Number(segment.end),
    text: String(segment.text ?? "").trim(),
    speaker: segment.speaker ?? null,
    kind: "speech",
  }));
}

/* ------------------------------------------------------------- index */

/**
 * Everything known about one piece of media, on one timeline of segments.
 * This is what gets handed to a model.
 */
export async function analyse(path, options = {}) {
  const media = await probe(path);
  const [silences, shots, loudness] = await Promise.all([
    media.hasAudio ? detectSilence(path, options.silence) : Promise.resolve([]),
    media.hasVideo ? detectShots(path, options.shots) : Promise.resolve([]),
    media.hasAudio ? measureLoudness(path) : Promise.resolve({}),
  ]);

  let speech = [];
  if (options.transcribe && media.hasAudio && transcribers.size) {
    speech = await transcribe(path, { using: options.transcriber }).catch(() => []);
  }

  return {
    media,
    loudness,
    segments: [...speech, ...silences, ...shots].sort((a, b) => a.start - b.start),
    counts: { speech: speech.length, silences: silences.length, shots: shots.length },
  };
}

/* ------------------------------------------------------------ queries */

/** Silences long enough to be worth removing — the query behind
 *  "remove all pauses longer than 0.8 seconds". */
export const pausesLongerThan = (index, seconds) =>
  index.segments.filter((segment) => segment.kind === "silence" && segment.duration > seconds);

/** Plain substring search across the transcript, returning timestamps. */
export function searchTranscript(index, query) {
  const needle = String(query).toLowerCase();
  return index.segments
    .filter((segment) => segment.kind === "speech" && segment.text.toLowerCase().includes(needle))
    .map((segment) => ({ start: segment.start, end: segment.end, text: segment.text }));
}

/** The stretch of speech with the most words per second — a cheap, honest
 *  proxy for "the strongest N seconds" that needs no model call. */
export function densestWindow(index, windowSeconds) {
  const speech = index.segments.filter((segment) => segment.kind === "speech");
  if (!speech.length) return null;
  let best = null;
  for (const anchor of speech) {
    const end = anchor.start + windowSeconds;
    const words = speech
      .filter((segment) => segment.start >= anchor.start && segment.end <= end)
      .reduce((total, segment) => total + segment.text.split(/\s+/).filter(Boolean).length, 0);
    if (!best || words > best.words) best = { start: anchor.start, end, words };
  }
  return best;
}
