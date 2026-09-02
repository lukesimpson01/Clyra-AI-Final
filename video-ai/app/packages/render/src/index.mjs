/* Rendering.
 *
 *   OTIO timeline → internal render graph → backend
 *
 * The canonical format is deliberately not coupled to a renderer. The graph in
 * the middle is a flat, backend-agnostic description of what to draw; each
 * backend compiles it into its own language. Adding MLT or HyperFrames later
 * means writing a compiler, not touching the timeline.
 *
 * FFmpeg ships first because it is enough for the vertical slice and, being
 * invoked as a subprocess, carries no linking obligations (see LICENSE_AUDIT).
 */
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import {
  tracksOf, isClip, isGap, projectRate, framesToSeconds, timelineDuration,
} from "../../timeline/src/index.mjs";

const run = promisify(execFile);

export const tools = {
  ffmpeg: process.env.CLYRA_FFMPEG || "ffmpeg",
};

export class RenderError extends Error {
  constructor(message, code = "render_failed", detail = null) {
    super(message);
    this.name = "RenderError";
    this.code = code;
    this.detail = detail;
  }
}

/* -------------------------------------------------------- render graph */

/**
 * Flatten an OTIO document into an ordered list of things to draw.
 *
 * OTIO stores a track as consecutive runs, where position is implied by what
 * came before. A renderer needs absolute times. This walk is the translation,
 * and it is the only place that conversion happens.
 */
export function buildGraph(doc) {
  const rate = projectRate(doc);
  const layers = [];

  for (const [trackIndex, entry] of tracksOf(doc).entries()) {
    const meta = entry.metadata?.clyra ?? {};
    const items = [];
    let playhead = 0;

    for (const child of entry.children) {
      const frames = child.source_range?.duration?.value ?? 0;
      if (isClip(child)) {
        const clyra = child.metadata?.clyra ?? {};
        items.push({
          kind: clyra.kind === "caption" ? "caption" : "clip",
          id: clyra.id,
          name: child.name,
          text: clyra.text ?? null,
          source: child.media_reference?.target_url ?? null,
          sourceInSeconds: framesToSeconds(child.source_range.start_time.value, rate),
          startSeconds: framesToSeconds(playhead, rate),
          durationSeconds: framesToSeconds(frames, rate),
          speed: clyra.speed ?? 1,
          gain: clyra.gain ?? 1,
          fade: clyra.fade ?? null,
          transform: clyra.transform ?? null,
          effects: (child.effects ?? []).map((fx) => ({
            name: fx.effect_name ?? fx.name,
            amount: fx.metadata?.clyra?.amount ?? 1,
          })),
        });
      }
      if (!isGap(child) && !isClip(child)) {
        /* Transitions carry no duration of their own on the track. */
        items.push({ kind: "transition", name: child.name, atSeconds: framesToSeconds(playhead, rate) });
      }
      playhead += frames;
    }

    layers.push({
      trackId: meta.id ?? `track_${trackIndex}`,
      name: entry.name,
      kind: entry.kind,
      role: meta.role ?? null,
      muted: Boolean(meta.muted),
      gain: meta.gain ?? 1,
      duck: meta.duck ?? null,
      captionStyle: meta.captionStyle ?? null,
      items,
    });
  }

  return {
    rate,
    width: doc.metadata?.clyra?.width ?? 1920,
    height: doc.metadata?.clyra?.height ?? 1080,
    durationSeconds: framesToSeconds(timelineDuration(doc), rate),
    layers,
  };
}

/* ------------------------------------------------------ ffmpeg backend */

/**
 * Compile a graph into an FFmpeg invocation.
 *
 * Kept honest about its limits: this handles the vertical slice — cuts, order,
 * scale/crop to the output frame, speed, gain, fades and burned-in captions.
 * Compositing, blend modes and complex effects belong to a real compositor,
 * which is what the MLT backend is for. It reports what it could not do rather
 * than silently dropping it.
 */
export function compileFfmpeg(graph, output, options = {}) {
  const { width, height } = options.resolution ?? graph;
  const fps = options.fps ?? graph.rate;
  const unsupported = [];

  const video = graph.layers.filter((layer) => layer.kind === "Video" && layer.role !== "captions");
  const captions = graph.layers.filter((layer) => layer.role === "captions");
  const audio = graph.layers.filter((layer) => layer.kind === "Audio");

  const clips = video.flatMap((layer) => layer.items.filter((item) => item.kind === "clip" && item.source));
  if (!clips.length) throw new RenderError("There is nothing on the timeline to render", "empty_timeline");

  if (video.length > 1) unsupported.push("multiple video tracks are flattened; use the MLT backend to composite");
  for (const layer of graph.layers) {
    for (const item of layer.items) {
      if (item.kind === "transition") unsupported.push("transitions are not rendered by the FFmpeg backend");
      if (item.effects?.length) unsupported.push(`effects on "${item.name}" are not rendered by the FFmpeg backend`);
    }
  }

  const args = ["-hide_banner", "-y"];
  const filters = [];
  const segments = [];

  clips.forEach((item, index) => {
    args.push("-ss", item.sourceInSeconds.toFixed(3), "-t", item.durationSeconds.toFixed(3), "-i", item.source);
    const label = `v${index}`;

    /* Scale to fit the output frame and pad rather than stretch: changing a
       subject's proportions to fit a target aspect is never what was meant. */
    let chain = `[${index}:v]scale=${width}:${height}:force_original_aspect_ratio=decrease,`
      + `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps=${fps}`;

    if (item.speed !== 1) chain += `,setpts=${(1 / item.speed).toFixed(6)}*PTS`;

    const scale = item.transform?.scale;
    if (scale && scale !== 1) {
      /* A punch-in: scale up, then crop back to frame so the output size is
         unchanged and the subject grows. */
      chain += `,scale=iw*${scale}:ih*${scale},crop=${width}:${height}`;
    }
    filters.push(`${chain}[${label}]`);
    segments.push(`[${label}]`);
  });

  let videoOut = "vout";
  filters.push(`${segments.join("")}concat=n=${segments.length}:v=1:a=0[${videoOut}]`);

  /* Captions are burned in. A sidecar subtitle file is better where the target
     supports it, but burned-in is what social platforms actually need. */
  const captionItems = captions.flatMap((layer) =>
    layer.items.filter((item) => item.kind === "caption" && item.text)
      .map((item) => ({ ...item, style: layer.captionStyle ?? {} })));

  for (const [index, caption] of captionItems.entries()) {
    const next = `cap${index}`;
    const style = caption.style;
    const size = style.sizePx ?? Math.round(height * 0.045);
    const y = style.position === "top" ? `${Math.round(height * 0.08)}`
      : style.position === "middle" ? "(h-text_h)/2"
      : `h-text_h-${Math.round(height * 0.09)}`;
    const text = String(caption.text)
      .replace(/\\/g, "\\\\").replace(/'/g, "\u2019").replace(/:/g, "\\:").replace(/%/g, "\\%");
    filters.push(
      `[${videoOut}]drawtext=text='${text}'`
      + `:fontsize=${size}:fontcolor=${style.colour ?? "white"}`
      + `:box=1:boxcolor=${style.background ?? "black@0.5"}:boxborderw=${Math.round(size * 0.35)}`
      + `:x=(w-text_w)/2:y=${y}`
      + `:enable='between(t,${caption.startSeconds.toFixed(3)},${(caption.startSeconds + caption.durationSeconds).toFixed(3)})'`
      + `[${next}]`,
    );
    videoOut = next;
  }

  /* Audio comes from the same inputs; a clip muted or on a muted track is
     dropped rather than mixed at zero, which is cheaper and identical. */
  const audible = clips
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => item.gain !== 0);
  let audioOut = null;
  if (audible.length) {
    audible.forEach(({ item, index }) => {
      let chain = `[${index}:a]atrim=0:${item.durationSeconds.toFixed(3)},asetpts=PTS-STARTPTS`;
      if (item.speed !== 1) chain += `,atempo=${Math.min(2, Math.max(0.5, item.speed)).toFixed(4)}`;
      if (item.gain !== 1) chain += `,volume=${item.gain.toFixed(4)}`;
      if (item.fade?.inSeconds) chain += `,afade=t=in:st=0:d=${item.fade.inSeconds}`;
      if (item.fade?.outSeconds) {
        chain += `,afade=t=out:st=${Math.max(0, item.durationSeconds - item.fade.outSeconds).toFixed(3)}:d=${item.fade.outSeconds}`;
      }
      filters.push(`${chain}[a${index}]`);
    });
    audioOut = "aout";
    filters.push(`${audible.map(({ index }) => `[a${index}]`).join("")}concat=n=${audible.length}:v=0:a=1[${audioOut}]`);
  }

  if (audio.some((layer) => layer.duck)) {
    unsupported.push("audio ducking is not rendered by the FFmpeg backend");
  }

  args.push("-filter_complex", filters.join(";"));
  args.push("-map", `[${videoOut}]`);
  if (audioOut) args.push("-map", `[${audioOut}]`);
  args.push(
    "-c:v", options.videoCodec ?? "libx264",
    "-preset", options.preset ?? "medium",
    "-crf", String(options.crf ?? 20),
    "-pix_fmt", "yuv420p",
  );
  if (audioOut) args.push("-c:a", "aac", "-b:a", options.audioBitrate ?? "192k");
  args.push(output);

  return { args, unsupported: [...new Set(unsupported)] };
}

/* --------------------------------------------------------------- exec */

/** Render to a file. Progress is reported from FFmpeg's own output rather than
 *  estimated, so a long export shows real movement. */
export function render(doc, output, options = {}) {
  const graph = buildGraph(doc);
  const { args, unsupported } = compileFfmpeg(graph, output, options);

  return new Promise((resolve, reject) => {
    const child = spawn(tools.ffmpeg, args);
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      const text = String(chunk);
      stderr += text;
      if (stderr.length > 200_000) stderr = stderr.slice(-100_000);
      const match = text.match(/time=(\d+):(\d+):([\d.]+)/);
      if (match && options.onProgress) {
        const seconds = Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
        options.onProgress({
          seconds,
          totalSeconds: graph.durationSeconds,
          ratio: graph.durationSeconds ? Math.min(1, seconds / graph.durationSeconds) : 0,
        });
      }
    });
    child.on("error", (error) => reject(new RenderError(`Could not start ffmpeg: ${error.message}`, "spawn_failed")));
    child.on("close", (code) => {
      if (code === 0) return resolve({ output, unsupported, durationSeconds: graph.durationSeconds });
      /* The tail of ffmpeg's stderr is where the actual reason is; surfacing
         it beats "render failed". */
      reject(new RenderError(
        `Render failed (exit ${code}). ${stderr.trim().split("\n").slice(-3).join(" ")}`,
        "ffmpeg_failed",
        stderr.slice(-4000),
      ));
    });
  });
}

/** A single frame, for the preview canvas. */
export async function renderFrame(doc, atSeconds, output, options = {}) {
  const graph = buildGraph(doc);
  const clip = graph.layers
    .flatMap((layer) => layer.items)
    .find((item) => item.kind === "clip" && item.source
      && atSeconds >= item.startSeconds && atSeconds < item.startSeconds + item.durationSeconds);
  if (!clip) throw new RenderError(`Nothing is on the timeline at ${atSeconds}s`, "empty_at_time");

  const within = clip.sourceInSeconds + (atSeconds - clip.startSeconds);
  const { width, height } = options.resolution ?? graph;
  await run(tools.ffmpeg, [
    "-hide_banner", "-y",
    "-ss", within.toFixed(3), "-i", clip.source,
    "-frames:v", "1",
    "-vf", `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2`,
    output,
  ]);
  return { output, atSeconds, from: clip.id };
}
