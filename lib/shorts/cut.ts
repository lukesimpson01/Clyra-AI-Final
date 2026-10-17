// FFmpeg argument builder for Cut & Crop. Pure so the tests can assert the
// exact command: stream copy is used only when no crop or re-scale is requested,
// and encoding always produces the requested size with a centred cover-crop.

export type CutPlan = {
  source: string;
  inMs: number;
  outMs: number;
  crop: { x: number; y: number; w: number; h: number } | null;
  copyStreams: boolean;
  width: number;
  height: number;
  fps: number;
  quality: "fast" | "balanced" | "high";
};

const QUALITY = {
  fast: { preset: "veryfast", crf: 23, audio: "160k" },
  balanced: { preset: "medium", crf: 20, audio: "192k" },
  high: { preset: "slow", crf: 17, audio: "256k" },
} as const;

export function buildCutArgs(plan: CutPlan, output: string): string[] {
  const start = (plan.inMs / 1000).toFixed(3);
  const duration = ((plan.outMs - plan.inMs) / 1000).toFixed(3);
  const common = ["-y", "-hide_banner", "-loglevel", "error", "-progress", "pipe:1", "-nostats"];
  if (plan.copyStreams) {
    return [...common, "-ss", start, "-i", plan.source, "-t", duration, "-map", "0:v:0", "-map", "0:a?", "-c", "copy", "-avoid_negative_ts", "make_zero", "-movflags", "+faststart", output];
  }
  const q = QUALITY[plan.quality];
  const crop = plan.crop
    ? `crop=iw*${round(plan.crop.w)}:ih*${round(plan.crop.h)}:iw*${round(plan.crop.x)}:ih*${round(plan.crop.y)},`
    : "";
  const filter = `${crop}scale=${plan.width}:${plan.height}:force_original_aspect_ratio=increase,crop=${plan.width}:${plan.height},fps=${plan.fps},setsar=1`;
  return [
    ...common,
    "-ss", start,
    "-i", plan.source,
    "-t", duration,
    "-vf", filter,
    "-map", "0:v:0",
    "-map", "0:a?",
    "-c:v", "libx264",
    "-preset", q.preset,
    "-crf", String(q.crf),
    "-pix_fmt", "yuv420p",
    "-c:a", "aac",
    "-b:a", q.audio,
    "-movflags", "+faststart",
    output,
  ];
}

function round(value: number) {
  return Math.max(0, Math.min(1, value)).toFixed(4);
}
