/* Audio in, a finished note out.

   An uploaded recording is decoded with ffmpeg to 16 kHz mono, cut into phrases at the quietest moment near each 25 second mark
   (so no word is split), and transcribed one phrase at a time by the same local speech engine the dictation key and the AI
   clipper's transcription use (backend/speech/whisper-engine: Parakeet, with Whisper as the fallback). The transcript is then
   read for what it is (a lecture, a meeting, a voice memo, instructions to carry out) and written up in a layout that suits it. */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { transcribePcm } from "../../backend/speech/whisper-engine";

const RATE = 16_000;
const BYTES_PER_SECOND = RATE * 2;
const TARGET_SECONDS = 25;
const MAX_SECONDS = 29;

export type Segment = { start: number; end: number; text: string };
export type Job = {
  id: string;
  status: "working" | "done" | "failed";
  stage: "converting" | "transcribing" | "analysing" | "writing" | "done";
  progress: number;
  message?: string;
  error?: string;
  segments: Segment[];
  result?: Record<string, unknown>;
  created: number;
};

const jobs = new Map<string, Job>();
export const getJob = (id: string) => jobs.get(id) || null;
export function startJob(): Job {
  /* old jobs are dropped so a long-running server does not hold every transcript it ever made */
  for (const [key, job] of jobs) if (Date.now() - job.created > 6 * 3600_000) jobs.delete(key);
  const job: Job = { id: `job${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`, status: "working", stage: "converting", progress: 0, segments: [], created: Date.now() };
  jobs.set(job.id, job);
  return job;
}

function ffmpegPath() {
  const candidates = [process.env.FFMPEG_PATH, path.join(homedir(), ".local", "bin", "ffmpeg"), "/opt/homebrew/bin/ffmpeg", "/usr/local/bin/ffmpeg", "/usr/bin/ffmpeg"].filter(Boolean) as string[];
  return candidates.find((candidate) => existsSync(candidate)) || "ffmpeg";
}

/* Any audio (or the sound of any video) to raw 16 kHz mono signed 16-bit samples. */
async function decode(input: Buffer, name: string): Promise<Buffer> {
  const directory = await mkdtemp(path.join(tmpdir(), "clyra-rec-"));
  const file = path.join(directory, `in${path.extname(name).slice(0, 8) || ".bin"}`);
  try {
    await writeFile(file, input);
    return await new Promise<Buffer>((resolve, reject) => {
      const child = spawn(ffmpegPath(), ["-v", "error", "-i", file, "-vn", "-ac", "1", "-ar", String(RATE), "-f", "s16le", "-"], { stdio: ["ignore", "pipe", "pipe"] });
      const out: Buffer[] = []; let err = "";
      child.stdout.on("data", (chunk: Buffer) => out.push(chunk));
      child.stderr.on("data", (chunk: Buffer) => { err += String(chunk).slice(0, 400); });
      child.on("error", () => reject(new Error("ffmpeg is not installed, so this audio could not be read.")));
      child.on("close", (code) => {
        const pcm = Buffer.concat(out);
        if (code === 0 && pcm.length > BYTES_PER_SECOND / 4) resolve(pcm);
        else reject(new Error(err.trim() ? `That file could not be read as audio (${err.trim().slice(0, 120)}).` : "That file has no audio in it."));
      });
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

/* Cut points: near each 25 s mark, the quietest 100 ms stretch in the following few seconds. */
function cutPoints(pcm: Buffer): number[] {
  const samples = new Int16Array(pcm.buffer, pcm.byteOffset, Math.floor(pcm.length / 2));
  const window = RATE / 10;
  const cuts: number[] = [];
  let from = 0;
  while ((samples.length - from) / RATE > MAX_SECONDS) {
    const lo = from + TARGET_SECONDS * RATE - 4 * RATE, hi = from + MAX_SECONDS * RATE - window;
    let best = lo + 4 * RATE, bestEnergy = Infinity;
    for (let at = Math.max(lo, from + RATE); at < hi; at += window / 2) {
      let energy = 0;
      for (let i = at; i < at + window; i += 4) energy += Math.abs(samples[i] ?? 0);
      if (energy < bestEnergy) { bestEnergy = energy; best = at; }
    }
    cuts.push(best);
    from = best;
  }
  return cuts;
}

const hasSpeech = (pcm: Buffer) => {
  const samples = new Int16Array(pcm.buffer, pcm.byteOffset, Math.floor(pcm.length / 2));
  let energy = 0;
  for (let i = 0; i < samples.length; i += 8) energy += Math.abs(samples[i] ?? 0);
  return energy / Math.max(1, samples.length / 8) > 60;
};

export async function transcribeRecording(input: Buffer, name: string, job: Job) {
  job.stage = "converting"; job.progress = 0.03;
  const pcm = await decode(input, name);
  const cuts = [0, ...cutPoints(pcm), Math.floor(pcm.length / 2)];
  job.stage = "transcribing";
  const segments: Segment[] = [];
  for (let i = 0; i < cuts.length - 1; i += 1) {
    const slice = Buffer.from(pcm.subarray(cuts[i]! * 2, cuts[i + 1]! * 2));
    if (slice.length > BYTES_PER_SECOND / 3 && hasSpeech(slice)) {
      const { text } = await transcribePcm(slice, RATE, { language: "en" });
      if (text.trim()) segments.push({ start: cuts[i]! / RATE, end: cuts[i + 1]! / RATE, text: text.trim() });
    }
    job.segments = segments;
    job.progress = 0.05 + 0.75 * ((i + 1) / (cuts.length - 1));
  }
  return { segments, seconds: pcm.length / BYTES_PER_SECOND };
}
