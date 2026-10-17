// Operations that turn external media into Shorts projects: attaching uploads,
// importing AI Clipper results, Cut & Crop exports and word-level transcription.
// Inputs are validated here; nothing from the client is used as a path until it
// has matched an allow-list.

import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { clyraDataPath, resolveClipperMediaPath } from "../runtime-paths";
import { cancel, complete, createJob, enterStage, fail, reportProgress, warn, type ShortsJob } from "./jobs";
import { probeLocalMedia, resolvePython, resolveTool, runProcess } from "./media";
import { ensureProjectDirs, newProjectId, projectDir, readProjectFile, writeProjectFile } from "./store";
import { defaultCaptionStyle, emptyProject, outputSize, type CaptionWord, type ShortsFps, type ShortsProject, type ShortsResolution, type SourceRef } from "./schema";
import { buildCutArgs, type CutPlan } from "./cut";

const UPLOAD_NAME = /^[a-f0-9-]+\.(?:mp4|mov|m4v|webm|mkv)$/i;

export function uploadPath(uploadId: string) {
  if (!UPLOAD_NAME.test(uploadId)) throw new Error("Invalid upload identifier");
  const candidate = clyraDataPath(".clyra", "clipper-uploads", uploadId);
  if (!existsSync(candidate)) throw new Error("The uploaded video is no longer available. Upload it again.");
  return candidate;
}

/** Copies an upload into the project as assets/source.<ext>. The original upload is left untouched. `muted` defaults false (AI Clipper / Cut & Crop keep source audio); Fake Text's Gameplay Video tab passes true so dialogue stays clear. */
export async function attachUpload(projectId: string, uploadId: string, title: string, muted = false): Promise<ShortsProject> {
  const project = readProjectFile(projectId);
  if (!project) throw new Error("This project no longer exists.");
  const source = uploadPath(uploadId);
  const extension = path.extname(uploadId).toLowerCase();
  const assetName = `source${extension}`;
  const dir = ensureProjectDirs(projectId);
  copyFileSync(source, path.join(dir, "assets", assetName));
  const probe = await probeLocalMedia(path.join(dir, "assets", assetName));
  if (!probe.hasVideo) throw new Error("This file has no video track, so it can't be used as a source.");
  const ref: SourceRef = {
    origin: "upload",
    title: title.slice(0, 200) || "Uploaded video",
    durationMs: probe.durationMs,
    width: probe.width,
    height: probe.height,
    fps: probe.fps,
    file: `assets/${assetName}`,
  };
  const next: ShortsProject = {
    ...project,
    source: ref,
    updatedAt: new Date().toISOString(),
    background: project.background.type === "video"
      ? { ...project.background, file: `assets/${assetName}` }
      : { type: "video", file: `assets/${assetName}`, trimStartMs: 0, speed: 1, dim: 0.2, zoom: 1, offsetX: 0, offsetY: 0, blurPx: 0, muted },
  };
  writeProjectFile(next);
  return next;
}

export type ClipImportPayload = {
  output: string;
  title: string;
  reason?: string;
  caption?: string;
  hashtags?: string;
  rank?: number;
  score?: number | null;
  scoreBreakdown?: Record<string, { score?: number; max?: number }> | Record<string, number>;
  sourceUrl?: string;
  sourceTitle?: string;
  sourceStart?: string;
  sourceEnd?: string;
  moment?: string;
  words?: Array<{ word?: string; text?: string; start: number; end: number }>;
  subtitlesBurned?: boolean;
  aspect?: ShortsProject["aspect"];
};

/** Creates an ai-clip project from one engine clip. The rendered MP4 is copied in; captions come from the engine's word timings. */
export async function importClipResult(payload: ClipImportPayload): Promise<ShortsProject> {
  const source = resolveClipperMediaPath(payload.output);
  if (!source) throw new Error("That clip file is no longer on disk. Run the AI Clipper again.");
  const id = newProjectId();
  const dir = ensureProjectDirs(id);
  copyFileSync(source, path.join(dir, "assets", "clip.mp4"));
  const probe = await probeLocalMedia(path.join(dir, "assets", "clip.mp4"));
  const now = new Date().toISOString();
  // A burned-caption clip must not receive the same words as a second editor
  // overlay. Clean clipper renders retain editable words; finished captioned
  // MP4s arrive with their pixels already composed.
  const words = payload.subtitlesBurned ? [] : normaliseEngineWords(payload.words || []);
  const breakdown: Record<string, number> = {};
  for (const [key, value] of Object.entries(payload.scoreBreakdown || {})) {
    const number = typeof value === "number" ? value : Number((value as { score?: number }).score);
    if (Number.isFinite(number)) breakdown[key.slice(0, 40)] = number;
  }
  const project = emptyProject({ id, kind: "ai-clip", title: payload.title.slice(0, 160) || "AI clip", now, aspect: payload.aspect ?? "9:16" });
  const next: ShortsProject = {
    ...project,
    settings: { resolution: 1080, fps: sourceFps(probe.fps) },
    background: { type: "video", file: "assets/clip.mp4", trimStartMs: 0, speed: 1, dim: 0, zoom: 1, offsetX: 0, offsetY: 0, blurPx: 0, muted: false },
    captions: { enabled: words.length > 0, style: defaultCaptionStyle("clean"), words },
    source: {
      origin: "youtube",
      url: payload.sourceUrl,
      title: (payload.sourceTitle || "Source video").slice(0, 200),
      durationMs: probe.durationMs,
      width: probe.width,
      height: probe.height,
      fps: probe.fps,
      file: "assets/clip.mp4",
      sourceStartMs: parseClock(payload.sourceStart),
      sourceEndMs: parseClock(payload.sourceEnd),
    },
    clip: {
      rank: payload.rank ?? 0,
      score: typeof payload.score === "number" ? payload.score : null,
      scoreBreakdown: breakdown,
      reason: payload.reason || "",
      caption: payload.caption || "",
      hashtags: parseHashtags(payload.hashtags),
      sourceStart: payload.sourceStart || "",
      sourceEnd: payload.sourceEnd || "",
      moment: payload.moment || "",
    },
  };
  writeProjectFile(next);
  return next;
}

function sourceFps(value: number): ShortsFps {
  const options = [24, 25, 30, 50, 60] as const;
  return options.reduce((best, option) => (Math.abs(option - value) < Math.abs(best - value) ? option : best), 30 as ShortsFps);
}

function parseClock(value?: string) {
  if (!value) return undefined;
  const parts = value.split(":").map(Number);
  if (parts.some((part) => !Number.isFinite(part))) return undefined;
  const seconds = parts.reduce((total, part) => total * 60 + part, 0);
  return Math.round(seconds * 1000);
}

function parseHashtags(value?: string) {
  return (value || "").split(/\s+/).map((tag) => tag.replace(/^#/, "")).filter(Boolean).slice(0, 12);
}

/**
 * Engine word timings are seconds relative to the clip. They are clamped to the
 * clip, sorted, and emptied of zero-length entries so the caption renderer never
 * receives an impossible timeline.
 */
export function normaliseEngineWords(words: Array<{ word?: string; text?: string; start: number; end: number }>): CaptionWord[] {
  const out: CaptionWord[] = [];
  for (const raw of words) {
    const text = String(raw.word ?? raw.text ?? "").trim();
    const start = Math.round(Number(raw.start) * 1000);
    const end = Math.round(Number(raw.end) * 1000);
    if (!text || !Number.isFinite(start) || !Number.isFinite(end) || end <= start || start < 0) continue;
    out.push({ text: text.slice(0, 60), startMs: start, endMs: end });
  }
  return out.sort((a, b) => a.startMs - b.startMs).slice(0, 20_000);
}

export function startCut(projectId: string, input: {
  inMs: number;
  outMs: number;
  crop: { x: number; y: number; w: number; h: number } | null;
  copyStreams: boolean;
  resolution: ShortsResolution;
  fps: ShortsFps;
  quality: "fast" | "balanced" | "high";
  aspect: ShortsProject["aspect"];
}): ShortsJob {
  const project = readProjectFile(projectId);
  if (!project) throw new Error("This project no longer exists.");
  const sourceFile = project.source?.file ? path.join(projectDir(projectId), project.source.file) : null;
  if (!sourceFile || !existsSync(sourceFile)) throw new Error("Add a source video before cutting.");
  const sourceDuration = project.source?.durationMs ?? 0;
  const inMs = Math.max(0, Math.min(input.inMs, sourceDuration));
  const outMs = Math.max(inMs + 500, Math.min(input.outMs, sourceDuration));
  const job = createJob({
    kind: "cut",
    projectId,
    stages: [
      { id: "prepare", label: "Preparing source", weight: 5 },
      { id: "encode", label: input.copyStreams ? "Copying streams" : "Encoding", weight: 85 },
      { id: "finalize", label: "Finalizing file", weight: 10 },
    ],
  });
  const plan: CutPlan = {
    source: sourceFile,
    inMs,
    outMs,
    crop: input.crop,
    copyStreams: input.copyStreams,
    ...outputSize(input.aspect, input.resolution),
    fps: input.fps,
    quality: input.quality,
  };
  void runCut(job, projectId, plan, input).catch((error) => {
    if (job.status === "cancelled") return;
    fail(job, error instanceof Error ? error.message : "Cut failed");
  });
  return job;
}

async function runCut(job: ShortsJob, projectId: string, plan: CutPlan, input: { resolution: ShortsResolution; fps: ShortsFps; aspect: ShortsProject["aspect"] }) {
  const signal = job.controller.signal;
  enterStage(job, "prepare", "Reading the source range");
  const durationMs = plan.outMs - plan.inMs;
  const output = path.join(ensureProjectDirs(projectId), "exports", `cut-${input.resolution}p-${Date.now().toString(36)}.mp4`);
  enterStage(job, "encode", plan.copyStreams ? "Copying streams (no re-encode)" : "Encoding the cut");
  const args = buildCutArgs(plan, output);
  const ffmpeg = resolveTool("ffmpeg");
  const result = await runProcess(ffmpeg, args, {
    signal,
    timeoutMs: 60 * 60 * 1000,
    onStdoutLine: (line) => {
      const match = line.match(/^out_time_(?:us|ms)=(\d+)/);
      if (match) {
        const doneMs = Math.round(Number(match[1]) / 1000);
        reportProgress(job, Math.min(durationMs, doneMs), durationMs, `Encoded ${Math.round(doneMs / 1000)}s of ${Math.round(durationMs / 1000)}s`);
      }
    },
  });
  if (signal.aborted) {
    cancel(job);
    return;
  }
  if (result.code !== 0) throw new Error(`FFmpeg could not cut this range: ${result.stderr.trim().split("\n").at(-1) || `exit ${result.code}`}`);
  enterStage(job, "finalize", "Verifying the file");
  const probe = await probeLocalMedia(output);
  if (!probe.hasVideo) throw new Error("The cut has no video track.");
  if (plan.copyStreams) warn(job, "Stream copy cuts on keyframes, so the start may be a fraction of a second early or late.");
  const record = {
    id: `c-${Date.now().toString(36)}`,
    createdAt: new Date().toISOString(),
    file: path.basename(output),
    resolution: input.resolution,
    fps: input.fps,
    aspect: input.aspect,
    durationMs: Math.round(probe.durationMs),
    bytes: statSync(output).size,
  };
  const latest = readProjectFile(projectId);
  if (latest) {
    latest.exports = [...latest.exports, record].slice(-40);
    writeProjectFile(latest);
  }
  complete(job, {
    exportId: record.id,
    file: record.file,
    url: `/api/shorts/projects/${projectId}/exports/${encodeURIComponent(record.file)}`,
    bytes: record.bytes,
    durationMs: record.durationMs,
    copied: plan.copyStreams,
  });
}

export function startTranscribe(projectId: string, model: "tiny" | "base" | "small"): ShortsJob {
  const project = readProjectFile(projectId);
  if (!project) throw new Error("This project no longer exists.");
  const source = project.source?.file ? path.join(projectDir(projectId), project.source.file) : null;
  if (!source || !existsSync(source)) throw new Error("Add a source video before generating captions.");
  const job = createJob({
    kind: "transcribe",
    projectId,
    stages: [
      { id: "prepare", label: "Preparing audio", weight: 10 },
      { id: "transcribe", label: "Transcribing words", weight: 85 },
      { id: "finalize", label: "Saving captions", weight: 5 },
    ],
  });
  void runTranscribe(job, projectId, source, model).catch((error) => {
    if (job.status === "cancelled") return;
    fail(job, error instanceof Error ? error.message : "Transcription failed");
  });
  return job;
}

async function runTranscribe(job: ShortsJob, projectId: string, source: string, model: "tiny" | "base" | "small") {
  const signal = job.controller.signal;
  enterStage(job, "prepare", "Reading the audio track");
  const helper = path.join(process.cwd(), "lib", "shorts", "transcribe_words.py");
  if (!existsSync(helper)) throw new Error("The transcription helper is missing from this build.");
  const outDir = path.join(ensureProjectDirs(projectId), "temp", job.id);
  mkdirSync(outDir, { recursive: true });
  const out = path.join(outDir, "words.json");
  enterStage(job, "transcribe", `Transcribing with the ${model} model`);
  const result = await runProcess(resolvePython(), [helper, source, out, model], {
    signal,
    timeoutMs: 45 * 60 * 1000,
    onStderrLine: (line) => {
      if (line.startsWith("STAGE ")) reportProgress(job, 0, 1, line.slice(6));
    },
  });
  if (signal.aborted) {
    cancel(job);
    return;
  }
  if (result.code !== 0) {
    const detail = result.stderr.trim().split("\n").filter(Boolean).at(-1) || `exit ${result.code}`;
    throw new Error(`Transcription failed: ${detail.slice(0, 300)}. Check that the Python "whisper" package is installed.`);
  }
  enterStage(job, "finalize", "Saving word timings");
  const parsed = JSON.parse(readFileSync(out, "utf8")) as { language?: string; words: Array<{ text: string; startMs: number; endMs: number }> };
  const words = parsed.words
    .filter((word) => word.text && word.endMs > word.startMs)
    .map((word) => ({ text: String(word.text).slice(0, 60), startMs: Math.round(word.startMs), endMs: Math.round(word.endMs) }));
  const latest = readProjectFile(projectId);
  if (!latest) throw new Error("This project no longer exists.");
  latest.captions = { ...latest.captions, enabled: true, words };
  writeProjectFile(latest);
  complete(job, { wordCount: words.length, language: parsed.language || "unknown", model });
}
