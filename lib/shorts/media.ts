// Media tooling for Shorts: binary resolution, ffprobe, yt-dlp source metadata
// and a generic process runner. Every subprocess is started with an argument
// array (never a shell string), so filenames and URLs cannot inject commands.

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

export function resolveTool(name: "ffmpeg" | "ffprobe"): string {
  const override = process.env[name === "ffmpeg" ? "FFMPEG_PATH" : "FFPROBE_PATH"];
  if (override) return override;
  const candidates = [
    path.join(homedir(), ".local", "bin", name),
    `/opt/homebrew/bin/${name}`,
    `/usr/local/bin/${name}`,
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? name;
}

export function resolvePython(): string {
  return process.env.CLYRA_PYTHON || "python3";
}

export type RunResult = { code: number | null; stdout: string; stderr: string };

export function runProcess(
  command: string,
  args: string[],
  options: { timeoutMs?: number; signal?: AbortSignal; onStderrLine?: (line: string) => void; onStdoutLine?: (line: string) => void; stdin?: "ignore" | "pipe" } = {},
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: [options.stdin ?? "ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let stderrBuffer = "";
    let stdoutBuffer = "";
    let settled = false;
    const timer = options.timeoutMs
      ? setTimeout(() => {
          child.kill("SIGTERM");
        }, options.timeoutMs)
      : null;
    const onAbort = () => child.kill("SIGTERM");
    options.signal?.addEventListener("abort", onAbort, { once: true });
    child.stdout.on("data", (chunk) => {
      const text = String(chunk);
      stdout += text;
      if (options.onStdoutLine) {
        stdoutBuffer += text;
        const lines = stdoutBuffer.split(/\r?\n/);
        stdoutBuffer = lines.pop() || "";
        for (const line of lines) options.onStdoutLine(line);
      }
    });
    child.stderr.on("data", (chunk) => {
      const text = String(chunk);
      stderr = `${stderr}${text}`.slice(-16_000);
      if (options.onStderrLine) {
        stderrBuffer += text;
        const lines = stderrBuffer.split(/\r?\n/);
        stderrBuffer = lines.pop() || "";
        for (const line of lines) options.onStderrLine(line);
      }
    });
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
      fn();
    };
    child.on("error", (error) => finish(() => reject(error)));
    child.on("close", (code) => finish(() => resolve({ code, stdout, stderr })));
  });
}

export type ProbedMedia = {
  durationMs: number;
  width: number;
  height: number;
  fps: number;
  rotation: number;
  videoCodec: string;
  audioChannels: number;
  audioSampleRate: number;
  bitrate: number;
  hasVideo: boolean;
  hasAudio: boolean;
};

export async function probeLocalMedia(file: string): Promise<ProbedMedia> {
  const result = await runProcess(resolveTool("ffprobe"), [
    "-v", "error",
    "-print_format", "json",
    "-show_format",
    "-show_streams",
    file,
  ], { timeoutMs: 30_000 });
  if (result.code !== 0) throw new Error(`ffprobe could not read this file: ${result.stderr.trim().split("\n").at(-1) || "unknown error"}`);
  const data = JSON.parse(result.stdout) as {
    format?: { duration?: string; bit_rate?: string };
    streams?: Array<Record<string, any>>;
  };
  const video = data.streams?.find((stream) => stream.codec_type === "video");
  const audio = data.streams?.find((stream) => stream.codec_type === "audio");
  const rotation = Number(video?.tags?.rotate ?? video?.side_data_list?.find((entry: any) => entry.rotation)?.rotation ?? 0);
  const [num, den] = String(video?.avg_frame_rate || video?.r_frame_rate || "0/1").split("/").map(Number);
  const rawWidth = Number(video?.width) || 0;
  const rawHeight = Number(video?.height) || 0;
  const swapped = Math.abs(rotation) === 90 || Math.abs(rotation) === 270;
  return {
    durationMs: Math.round((Number(data.format?.duration) || 0) * 1000),
    width: swapped ? rawHeight : rawWidth,
    height: swapped ? rawWidth : rawHeight,
    fps: den ? Math.round((num / den) * 100) / 100 : 0,
    rotation,
    videoCodec: String(video?.codec_name || ""),
    audioChannels: Number(audio?.channels) || 0,
    audioSampleRate: Number(audio?.sample_rate) || 0,
    bitrate: Number(data.format?.bit_rate) || 0,
    hasVideo: Boolean(video),
    hasAudio: Boolean(audio),
  };
}

export type YoutubeInspection = {
  url: string;
  videoId: string;
  title: string;
  channel: string;
  durationMs: number;
  width: number;
  height: number;
  fps: number;
  thumbnail: string;
  isLive: boolean;
  uploadDate: string;
  viewCount: number;
};

const YOUTUBE_HOST = /(^|\.)(youtube\.com|youtu\.be)$/i;
const inspectionCache = new Map<string, { at: number; value: YoutubeInspection }>();
const INSPECTION_TTL_MS = 30 * 60 * 1000;

export function parseYoutubeUrl(raw: string): { url: string; videoId: string } {
  let parsed: URL;
  try {
    parsed = new URL(raw.trim());
  } catch {
    throw new Error("Enter a full video link, starting with https://");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw new Error("Only http and https links are supported");
  if (!YOUTUBE_HOST.test(parsed.hostname)) throw new Error("This link is not a YouTube link. Use a YouTube link or upload a file.");
  let videoId = "";
  if (parsed.hostname.endsWith("youtu.be")) videoId = parsed.pathname.slice(1).split("/")[0];
  else if (parsed.pathname.startsWith("/watch")) videoId = parsed.searchParams.get("v") || "";
  else {
    const match = parsed.pathname.match(/^\/(shorts|live|embed)\/([A-Za-z0-9_-]{6,})/);
    videoId = match?.[2] || "";
  }
  if (!/^[A-Za-z0-9_-]{6,20}$/.test(videoId)) throw new Error("Could not find a video ID in that link");
  return { url: `https://www.youtube.com/watch?v=${videoId}`, videoId };
}

/**
 * Metadata only (yt-dlp --skip-download). Failures are translated into
 * plain-language reasons rather than raw yt-dlp output.
 */
export async function inspectYoutube(raw: string): Promise<YoutubeInspection> {
  const { url, videoId } = parseYoutubeUrl(raw);
  const cached = inspectionCache.get(videoId);
  if (cached && Date.now() - cached.at < INSPECTION_TTL_MS) return cached.value;
  const result = await runProcess(resolvePython(), [
    "-m", "yt_dlp",
    "--no-playlist",
    "--skip-download",
    "--dump-single-json",
    "--no-warnings",
    "--no-check-certificates",
    // YouTube's default "web" client intermittently fails extraction with a
    // generic "page needs to be reloaded" error; the android client is not
    // affected and is yt-dlp's own documented workaround for it.
    "--extractor-args", "youtube:player_client=android,web",
    url,
  ], { timeoutMs: 60_000 }).catch((error: Error) => {
    throw new Error(`The metadata helper could not start: ${error.message}`);
  });
  if (result.code !== 0) throw new Error(translateYtDlpError(result.stderr));
  const data = JSON.parse(result.stdout) as Record<string, any>;
  if (data.is_live) throw new Error("Live streams can't be clipped yet. Try a recorded video.");
  const formats = Array.isArray(data.formats) ? data.formats : [];
  const best = formats
    .filter((format: any) => format.vcodec && format.vcodec !== "none" && format.height)
    .sort((a: any, b: any) => (b.height || 0) - (a.height || 0))[0];
  const value: YoutubeInspection = {
    url,
    videoId,
    title: String(data.title || "YouTube video").slice(0, 300),
    channel: String(data.channel || data.uploader || ""),
    durationMs: Math.round((Number(data.duration) || 0) * 1000),
    width: Number(best?.width || data.width) || 0,
    height: Number(best?.height || data.height) || 0,
    fps: Number(best?.fps || data.fps) || 0,
    thumbnail: String(data.thumbnail || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`),
    isLive: false,
    uploadDate: String(data.upload_date || ""),
    viewCount: Number(data.view_count) || 0,
  };
  if (!value.durationMs) throw new Error("YouTube did not report a duration for this video.");
  inspectionCache.set(videoId, { at: Date.now(), value });
  return value;
}

export function translateYtDlpError(stderr: string) {
  const lower = stderr.toLowerCase();
  if (lower.includes("private video")) return "This video is private, so Clyra can't access it.";
  if (lower.includes("sign in to confirm your age") || lower.includes("age-restricted")) return "This video is age-restricted and needs a signed-in account, which Clyra doesn't use.";
  if (lower.includes("members-only") || lower.includes("join this channel")) return "This video is members-only, so it can't be accessed.";
  if (lower.includes("drm")) return "This video uses DRM protection, so Clyra can't process it.";
  if (lower.includes("video unavailable") || lower.includes("not available")) return "YouTube reports this video as unavailable.";
  if (lower.includes("unable to download webpage") || lower.includes("network") || lower.includes("timed out")) return "Clyra couldn't reach YouTube. Check your connection and try again.";
  if (lower.includes("no module named yt_dlp")) return "yt-dlp is not installed for Python. Install it with: python3 -m pip install yt-dlp";
  const last = stderr.trim().split("\n").filter(Boolean).at(-1) || "unknown error";
  return `YouTube metadata failed: ${last.replace(/^ERROR:\s*/, "").slice(0, 240)}`;
}
