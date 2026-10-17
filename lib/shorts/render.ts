// Export pipeline for Shorts projects.
//
// Preview and export share one component (src/shorts/engine). For export the
// server opens that component in a headless Chromium page, seeks it to each
// frame time, captures the frame, and pipes it into FFmpeg. Video backgrounds
// stay in FFmpeg (decoded once, never held in memory) and the Chromium frames
// are transparent overlays composited on top, so the same timeline always
// produces the same pixels in preview and export.
//
// Stage weights (share of the overall bar):
//   prepare 5 · narration audio 10 · frames+encode 80 · finalize 5

import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { projectDurationMs, outputSize, type MessageItem, type ShortsAspect, type ShortsFps, type ShortsProject, type ShortsResolution } from "./schema";
import { cancel, complete, createJob, enterStage, fail, getJob, reportProgress, warn, type ShortsJob } from "./jobs";
import { ensureProjectDirs, projectDir, readProjectFile, resolveAssetFile, writeProjectFile } from "./store";
import { probeLocalMedia, resolveTool, runProcess } from "./media";
import { resolveLibraryFile } from "./library";
import { synthesizeMessageSpeech } from "./faketext-tts";
import { fetchSpeech } from "./tts-client";
import { BUBBLE_ENTER_MS } from "./faketext-timeline";
import { spawn } from "node:child_process";

export type RenderQuality = "fast" | "balanced" | "high";

export type RenderOptions = {
  resolution: ShortsResolution;
  fps: ShortsFps;
  quality: RenderQuality;
  origin: string;
};

export type RenderPlan = {
  width: number;
  height: number;
  fps: ShortsFps;
  durationMs: number;
  frames: number;
  /** "dom" draws the whole frame in the page; "video" keeps the source in FFmpeg and overlays transparent frames. */
  mode: "dom" | "video";
  baseFile: string | null;
  trimStartMs: number;
  speed: number;
  dim: number;
  zoom: number;
  offsetX: number;
  offsetY: number;
  blurPx: number;
  hasSourceAudio: boolean;
  /** True when the source is shorter than the timeline, so FFmpeg loops it. */
  loop: boolean;
  narration: Array<{ file: string; startMs: number; speed: number }>;
  sourceVolume: number;
  music: { file: string; startOffsetMs: number; volume: number; duckUnderSpeech: boolean; duckAmount: number } | null;
  sfx: Array<{ file: string; atMs: number; volume: number }>;
};

export function planRender(project: ShortsProject, resolution: ShortsResolution, fps: ShortsFps): Omit<RenderPlan, "baseFile" | "narration" | "hasSourceAudio" | "loop" | "music" | "sfx"> {
  const size = outputSize(project.aspect, resolution);
  const durationMs = projectDurationMs(project);
  const frames = Math.max(1, Math.round((durationMs * fps) / 1000));
  const background = project.background;
  const video = background.type === "video" ? background : null;
  return {
    width: size.width,
    height: size.height,
    fps,
    durationMs,
    frames,
    mode: video ? "video" : "dom",
    trimStartMs: video?.trimStartMs ?? 0,
    speed: video?.speed ?? 1,
    dim: video?.dim ?? 0,
    zoom: video?.zoom ?? 1,
    offsetX: video?.offsetX ?? 0,
    offsetY: video?.offsetY ?? 0,
    blurPx: video?.blurPx ?? 0,
    sourceVolume: project.kind === "fake-text" ? project.fakeText.voices.gameplayAudioVolume : project.narration.enabled ? 0.22 : 1,
  };
}

const QUALITY: Record<RenderQuality, { preset: string; crf: number; audio: string }> = {
  fast: { preset: "veryfast", crf: 23, audio: "160k" },
  balanced: { preset: "medium", crf: 20, audio: "192k" },
  high: { preset: "slow", crf: 17, audio: "256k" },
};

/** Build the FFmpeg command for a plan. Pure: no I/O, so it can be unit tested. */
export function buildFfmpegArgs(plan: RenderPlan, output: string, quality: RenderQuality): string[] {
  const args: string[] = ["-y", "-hide_banner", "-loglevel", "error", "-progress", "pipe:1", "-nostats"];
  const durationS = (plan.durationMs / 1000).toFixed(3);
  const q = QUALITY[quality];
  const { width: w, height: h, fps } = plan;
  const filters: string[] = [];
  let inputIndex = 0;
  let videoLabel = "";

  if (plan.mode === "video" && plan.baseFile) {
    const sourceSpan = (plan.durationMs * plan.speed) / 1000;
    if (plan.loop) args.push("-stream_loop", "-1");
    args.push("-ss", (plan.trimStartMs / 1000).toFixed(3), "-t", sourceSpan.toFixed(3), "-i", plan.baseFile);
    const base = inputIndex++;
    const zoomW = Math.round(w * plan.zoom);
    const zoomH = Math.round(h * plan.zoom);
    const cropX = `max(0,min(iw-${w},(iw-${w})/2+${Math.round((plan.offsetX / 100) * w)}))`;
    const cropY = `max(0,min(ih-${h},(ih-${h})/2+${Math.round((plan.offsetY / 100) * h)}))`;
    const chain = [
      `[${base}:v]setpts=(PTS-STARTPTS)/${plan.speed.toFixed(4)}`,
      `fps=${fps}`,
      `scale=${zoomW}:${zoomH}:force_original_aspect_ratio=increase`,
      `crop=${w}:${h}:x='${cropX}':y='${cropY}'`,
    ];
    if (plan.blurPx > 0) chain.push(`boxblur=luma_radius=${Math.min(40, plan.blurPx)}:luma_power=1`);
    if (plan.dim > 0) chain.push(`eq=brightness=${(-plan.dim * 0.6).toFixed(3)}`);
    chain.push("setsar=1[base]");
    filters.push(chain.join(","));
    args.push("-f", "image2pipe", "-framerate", String(fps), "-c:v", "png", "-i", "pipe:0");
    const overlay = inputIndex++;
    filters.push(`[base][${overlay}:v]overlay=format=auto:shortest=1,format=yuv420p[vout]`);
    videoLabel = "[vout]";
  } else {
    args.push("-f", "image2pipe", "-framerate", String(fps), "-c:v", "png", "-i", "pipe:0");
    inputIndex++;
    filters.push(`[0:v]format=yuv420p[vout]`);
    videoLabel = "[vout]";
  }

  // "Voice" = source dialogue and narration — the signal music ducks under,
  // and never the other way round. Everything is resampled to a common format
  // before mixing so amix/sidechaincompress never reject a mismatched stream.
  const voiceLabels: string[] = [];
  if (plan.mode === "video" && plan.baseFile && plan.hasSourceAudio) {
    const tempo = atempoChain(plan.speed);
    const sourceAudio = `[${0}:a]${tempo ? `${tempo},` : ""}volume=${plan.sourceVolume.toFixed(3)},atrim=0:${durationS},asetpts=PTS-STARTPTS,aformat=sample_rates=48000:channel_layouts=stereo[srcaudio]`;
    filters.push(sourceAudio);
    voiceLabels.push("[srcaudio]");
  }

  for (const clip of plan.narration) {
    args.push("-i", clip.file);
    const delay = Math.max(0, Math.round(clip.startMs));
    const tempo = atempoChain(clip.speed);
    filters.push(`[${inputIndex}:a]${tempo ? `${tempo},` : ""}adelay=${delay}|${delay},aresample=48000,aformat=channel_layouts=stereo[n${inputIndex}]`);
    voiceLabels.push(`[n${inputIndex}]`);
    inputIndex++;
  }

  let voiceLabel: string | null = null;
  if (voiceLabels.length > 1) {
    filters.push(`${voiceLabels.join("")}amix=inputs=${voiceLabels.length}:normalize=0:duration=longest[voice]`);
    voiceLabel = "[voice]";
  } else if (voiceLabels.length === 1) {
    filters.push(`${voiceLabels[0]}asetpts=PTS-STARTPTS[voice]`);
    voiceLabel = "[voice]";
  }

  const finalLabels: string[] = voiceLabel ? [voiceLabel] : [];

  if (plan.music) {
    args.push("-ss", (plan.music.startOffsetMs / 1000).toFixed(3), "-i", plan.music.file);
    const musicIndex = inputIndex++;
    filters.push(`[${musicIndex}:a]atrim=0:${durationS},asetpts=PTS-STARTPTS,volume=${plan.music.volume.toFixed(3)},aformat=sample_rates=48000:channel_layouts=stereo[musicraw]`);
    if (plan.music.duckUnderSpeech && voiceLabel) {
      // Real sidechain compression, not a volume toggle: music level follows a
      // smoothed envelope of the voice signal (attack 35ms, release 500ms),
      // so it only dips while speech is actually present and recovers gently
      // rather than pumping on every short pause.
      const ratio = (2 + plan.music.duckAmount * 10).toFixed(2);
      filters.push(`[musicraw]${voiceLabel}sidechaincompress=threshold=0.08:ratio=${ratio}:attack=35:release=500:makeup=1[musicducked]`);
      finalLabels.push("[musicducked]");
    } else {
      finalLabels.push("[musicraw]");
    }
  }

  for (const cue of plan.sfx) {
    args.push("-i", cue.file);
    const cueIndex = inputIndex++;
    const delay = Math.max(0, Math.round(cue.atMs));
    filters.push(`[${cueIndex}:a]adelay=${delay}|${delay},volume=${cue.volume.toFixed(3)},aresample=48000,aformat=channel_layouts=stereo[sfx${cueIndex}]`);
    finalLabels.push(`[sfx${cueIndex}]`);
  }

  if (finalLabels.length > 1) {
    filters.push(`${finalLabels.join("")}amix=inputs=${finalLabels.length}:normalize=0:duration=longest[aout]`);
  } else if (finalLabels.length === 1) {
    filters.push(`${finalLabels[0]}anull[aout]`);
  }

  args.push("-filter_complex", filters.join(";"));
  args.push("-map", videoLabel);
  if (finalLabels.length) args.push("-map", "[aout]", "-c:a", "aac", "-b:a", q.audio, "-ar", "48000");
  args.push(
    "-c:v", "libx264",
    "-preset", q.preset,
    "-crf", String(q.crf),
    "-profile:v", "high",
    "-pix_fmt", "yuv420p",
    "-r", String(fps),
    "-t", durationS,
    "-movflags", "+faststart",
    output,
  );
  return args;
}

function atempoChain(speed: number) {
  if (Math.abs(speed - 1) < 0.001) return "";
  const parts: number[] = [];
  let remaining = speed;
  while (remaining > 2) {
    parts.push(2);
    remaining /= 2;
  }
  while (remaining < 0.5) {
    parts.push(0.5);
    remaining /= 0.5;
  }
  parts.push(remaining);
  return parts.map((value) => `atempo=${value.toFixed(4)}`).join(",");
}

export function safeFileStem(title: string) {
  return (title || "short").replace(/[^A-Za-z0-9 _-]+/g, "").trim().replace(/\s+/g, "-").slice(0, 60) || "short";
}

type RenderSpec = { project: ShortsProject; width: number; height: number; fps: ShortsFps; durationMs: number; opaque: boolean };
const renderSpecs = new Map<string, RenderSpec>();

export function getRenderSpec(jobId: string) {
  return renderSpecs.get(jobId) ?? null;
}

const RENDER_STAGES = [
  { id: "prepare", label: "Preparing source", weight: 5 },
  { id: "narration", label: "Generating narration", weight: 10 },
  { id: "frames", label: "Rendering frames", weight: 80 },
  { id: "finalize", label: "Finalizing file", weight: 5 },
];

export function startRender(projectId: string, options: RenderOptions) {
  const project = readProjectFile(projectId);
  if (!project) throw new Error("This project no longer exists.");
  const job = createJob({ kind: "render", projectId, stages: RENDER_STAGES });
  void runRender(job, project, options).catch((error) => {
    if (job.status === "cancelled") return;
    fail(job, error instanceof Error ? error.message : "Render failed");
  });
  return job;
}

export function findJob(jobId: string) {
  return getJob(jobId);
}

async function runRender(job: ShortsJob, project: ShortsProject, options: RenderOptions) {
  const signal = job.controller.signal;
  const tempDir = path.join(ensureProjectDirs(project.id), "temp", job.id);
  mkdirSync(tempDir, { recursive: true });
  let browser: import("playwright").Browser | null = null;
  try {
    enterStage(job, "prepare", "Checking the project and its media");
    const planBase = planRender(project, options.resolution, options.fps);
    const plan: RenderPlan = { ...planBase, baseFile: null, narration: [], hasSourceAudio: false, loop: false, music: null, sfx: [] };
    if (project.audio.music) {
      const musicFile = resolveLibraryFile("music", project.audio.music.file);
      if (musicFile) {
        plan.music = { file: musicFile, startOffsetMs: project.audio.music.startOffsetMs, volume: project.audio.music.volume, duckUnderSpeech: project.audio.music.duckUnderSpeech, duckAmount: project.audio.music.duckAmount };
      } else {
        warn(job, `Music track "${project.audio.music.file}" is no longer in the Music library folder, so this export has no music.`);
      }
    }
    for (const cue of project.audio.sfx) {
      const sfxFile = resolveLibraryFile("sfx", cue.file);
      if (sfxFile) plan.sfx.push({ file: sfxFile, atMs: cue.atMs, volume: cue.volume });
      else warn(job, `SFX "${cue.file}" is no longer in the SFX library folder; it was skipped.`);
    }
    if (plan.mode === "video") {
      const background = project.background;
      if (background.type !== "video") throw new Error("Background mismatch");
      const file = resolveAssetFile(project.id, background.file);
      if (!file) throw new Error("The background video is missing from this project. Re-import the source.");
      plan.baseFile = file;
      const probe = await probeLocalMedia(file);
      plan.hasSourceAudio = probe.hasAudio && !background.muted;
      // Gameplay and other short footage loops to fill the timeline. Seams are not hidden.
      plan.loop = probe.durationMs > 0 && probe.durationMs - plan.trimStartMs < plan.durationMs * plan.speed;
    }
    renderSpecs.set(job.id, { project, width: plan.width, height: plan.height, fps: plan.fps, durationMs: plan.durationMs, opaque: plan.mode === "dom" });
    reportProgress(job, 1, 1, "Source ready");

    if (project.kind === "fake-text") {
      enterStage(job, "narration", "Synthesizing message voices");
      const messages = project.items.filter((item): item is MessageItem => item.type === "message");
      const voices = project.fakeText.voices;
      let index = 0;
      let placeholderWarned = false;
      for (const item of messages) {
        if (signal.aborted) throw new Error("Cancelled");
        index += 1;
        reportProgress(job, index - 1, messages.length, `Voice ${index} of ${messages.length}`);
        if (item.speechMs <= 0) continue;
        const side = item.side === "right" ? "user" : "contact";
        const voice = item.voice || (side === "user" ? voices.userVoice : voices.contactVoice);
        const speed = side === "user" ? voices.userSpeed : voices.contactSpeed;
        const speech = await synthesizeMessageSpeech(project.id, voice, item.text, (text, voiceName) => fetchSpeech(options.origin, text, voiceName, signal));
        if (speech.placeholder && !placeholderWarned) {
          placeholderWarned = true;
          warn(job, "Some lines used a local timing placeholder instead of real speech because no hosted or system voice is configured; export continues with those lines silent.");
        }
        if (speech.placeholder) continue;
        plan.narration.push({ file: speech.file, startMs: item.startMs + BUBBLE_ENTER_MS, speed });
      }
      reportProgress(job, messages.length, messages.length, "Voices ready");
    } else {
      enterStage(job, "narration", project.narration.enabled ? "Synthesizing narration" : "No narration requested");
      if (project.narration.enabled) {
        const narrationItems = project.items.filter((item) => item.type === "narration");
        const voice = project.narration.voice || "Max";
        let index = 0;
        for (const item of narrationItems) {
          if (signal.aborted) throw new Error("Cancelled");
          index += 1;
          reportProgress(job, index - 1, narrationItems.length, `Narration ${index} of ${narrationItems.length}`);
          const speech = await fetchSpeech(options.origin, item.type === "narration" ? item.text : "", voice, signal);
          if (speech.engine.startsWith("local-placeholder")) {
            warn(job, "Narration skipped: no hosted or system voice is available, so only a placeholder tone could be produced. Export continues without narration.");
            break;
          }
          const file = path.join(tempDir, `narration-${index}.${speech.extension}`);
          writeFileSync(file, speech.bytes);
          plan.narration.push({ file, startMs: item.startMs, speed: 1 });
        }
        reportProgress(job, narrationItems.length, narrationItems.length, "Narration ready");
      } else {
        reportProgress(job, 1, 1, "Narration not requested");
      }
    }

    enterStage(job, "frames", "Starting the frame renderer");
    const output = path.join(ensureProjectDirs(project.id), "exports", `${safeFileStem(project.title)}-${options.resolution}p-${options.fps}fps-${job.id}.mp4`);
    const args = buildFfmpegArgs(plan, output, options.quality);
    const { chromium } = await import("playwright");
    const spec = renderSpecs.get(job.id)!;
    browser = await chromium
      .launch({
        headless: true,
        args: [
          "--hide-scrollbars",
          "--force-color-profile=srgb",
          // A headless page is never "activated", so Chromium treats it as a
          // backgrounded/occluded tab and throttles or skips compositing —
          // the DOM updates correctly but the frame actually painted to the
          // screenshot buffer can stay stale. These disable that throttling
          // so every captured frame reflects the real, current paint.
          "--disable-backgrounding-occluded-windows",
          "--disable-renderer-backgrounding",
          "--disable-background-timer-throttling",
        ],
      })
      .catch((error: Error) => {
        throw new Error(`The frame renderer could not start Chromium. Run "npx playwright install chromium" once. (${error.message.split("\n")[0]})`);
      });
    const page = await browser.newPage({ viewport: { width: plan.width, height: plan.height }, deviceScaleFactor: 1 });
    await page.goto(`${options.origin}/?shortsRender=${encodeURIComponent(job.id)}`, { waitUntil: "load", timeout: 60_000 });
    await page.waitForFunction(() => (window as any).__shortsReady === true, undefined, { timeout: 60_000 });

    const ffmpeg = spawn(resolveTool("ffmpeg"), args, { stdio: ["pipe", "pipe", "pipe"] });
    let ffmpegStderr = "";
    let encodedMs = 0;
    ffmpeg.stderr.on("data", (chunk) => {
      ffmpegStderr = `${ffmpegStderr}${String(chunk)}`.slice(-6_000);
    });
    ffmpeg.stdout.on("data", (chunk) => {
      for (const line of String(chunk).split(/\r?\n/)) {
        const match = line.match(/^out_time_(?:us|ms)=(\d+)/);
        if (match) encodedMs = Math.round(Number(match[1]) / 1000);
      }
    });
    const ffmpegDone = new Promise<number | null>((resolve, reject) => {
      ffmpeg.once("error", reject);
      ffmpeg.once("close", (code) => resolve(code));
    });
    // Observed later, once frames are written. Without this, an early FFmpeg
    // failure would be an unhandled rejection and take the whole server down.
    ffmpegDone.catch(() => undefined);
    const ffmpegWrite = (buffer: Buffer) =>
      new Promise<void>((resolve, reject) => {
        const ok = ffmpeg.stdin.write(buffer, (error) => (error ? reject(error) : undefined));
        if (ok) resolve();
        else ffmpeg.stdin.once("drain", () => resolve());
      });

    const abortFrames = () => ffmpeg.kill("SIGTERM");
    signal.addEventListener("abort", abortFrames, { once: true });
    try {
      for (let frame = 0; frame < plan.frames; frame += 1) {
        if (signal.aborted) throw new Error("Cancelled");
        const timeMs = Math.round((frame * 1000) / plan.fps);
        await page.evaluate((t) => (window as any).__shortsSetTime(t), timeMs);
        const png = await page.screenshot({ type: "png", omitBackground: plan.mode === "video", animations: "allow", caret: "hide" });
        await ffmpegWrite(png);
        reportProgress(job, frame + 1, plan.frames, `Frame ${frame + 1} of ${plan.frames} · encoded ${Math.round(encodedMs / 1000)}s`);
      }
      ffmpeg.stdin.end();
    } catch (error) {
      // A failed frame or a cancel must not leave an encoder process running.
      if (ffmpeg.exitCode === null) ffmpeg.kill("SIGTERM");
      throw error;
    } finally {
      signal.removeEventListener("abort", abortFrames);
    }
    const code = await ffmpegDone;
    if (signal.aborted) throw new Error("Cancelled");
    if (code !== 0) throw new Error(`FFmpeg could not finish the export: ${ffmpegStderr.trim().split("\n").at(-1) || `exit ${code}`}`);

    enterStage(job, "finalize", "Verifying the exported file");
    const probe = await probeLocalMedia(output);
    const expected = plan.durationMs / 1000;
    if (!probe.hasVideo || probe.width !== plan.width || probe.height !== plan.height) {
      throw new Error(`The export came out as ${probe.width}x${probe.height}, expected ${plan.width}x${plan.height}.`);
    }
    if (Math.abs(probe.durationMs / 1000 - expected) > 0.6) {
      throw new Error(`The export is ${(probe.durationMs / 1000).toFixed(2)}s, expected ${expected.toFixed(2)}s.`);
    }
    const bytes = readFileSync(output).length;
    const record = {
      id: job.id,
      createdAt: new Date().toISOString(),
      file: path.basename(output),
      resolution: options.resolution,
      fps: options.fps,
      aspect: project.aspect as ShortsAspect,
      durationMs: Math.round(probe.durationMs),
      bytes,
    };
    const latest = readProjectFile(project.id);
    if (latest) {
      latest.exports = [...latest.exports, record].slice(-40);
      writeProjectFile(latest);
    }
    rmSync(tempDir, { recursive: true, force: true });
    complete(job, {
      exportId: record.id,
      file: record.file,
      url: `/api/shorts/projects/${project.id}/exports/${encodeURIComponent(record.file)}`,
      bytes,
      durationMs: record.durationMs,
      width: plan.width,
      height: plan.height,
      fps: plan.fps,
      resolution: options.resolution,
      narrationClips: plan.narration.length,
      musicApplied: Boolean(plan.music),
      sfxApplied: plan.sfx.length,
    });
  } catch (error) {
    if (signal.aborted) {
      cancel(job);
      rmSync(tempDir, { recursive: true, force: true });
      return;
    }
    rmSync(tempDir, { recursive: true, force: true });
    throw error;
  } finally {
    renderSpecs.delete(job.id);
    if (browser) await browser.close().catch(() => undefined);
  }
}

export function exportFileFor(projectId: string, file: string) {
  const safe = path.basename(file);
  const candidate = path.join(projectDir(projectId), "exports", safe);
  return existsSync(candidate) ? candidate : null;
}

export function newRenderId() {
  return `r-${Date.now().toString(36)}-${randomBytes(3).toString("hex")}`;
}
