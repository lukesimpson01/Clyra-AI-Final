import { useEffect, useRef } from "react";
import { Maximize2, Pause, Play } from "lucide-react";
import { ShortsCanvas, designSizeFor } from "../engine/ShortsCanvas";
import { projectDurationMs, type ShortsProject } from "../../../lib/shorts/schema";

const PREVIEW_WIDTH = 240;

export function WyrPreview({ project, timeMs, playing, onTimeChange, onPlayingChange }: {
  project: ShortsProject;
  timeMs: number;
  playing: boolean;
  onTimeChange: (updater: number | ((prev: number) => number)) => void;
  onPlayingChange: (value: boolean) => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const frameRef = useRef<HTMLDivElement | null>(null);

  const duration = projectDurationMs(project) || 7000;
  const design = designSizeFor(project);
  const previewHeight = (design.height / design.width) * PREVIEW_WIDTH;

  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    let last = performance.now();
    let ended = false;
    const tick = (now: number) => {
      const delta = now - last;
      last = now;
      onTimeChange((prev) => {
        const next = prev + delta;
        if (next >= duration) {
          ended = true;
          return duration;
        }
        return next;
      });
      if (ended) {
        onPlayingChange(false);
        return;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, duration, onTimeChange, onPlayingChange]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || project.background.type !== "video") return;
    const background = project.background;
    const target = (background.trimStartMs + timeMs * background.speed) / 1000;
    const drift = Math.abs(video.currentTime - target);
    if (!playing && drift > 0.02) video.currentTime = target;
    if (playing && drift > 0.25) video.currentTime = target;
    if (playing && video.paused) void video.play().catch(() => undefined);
    if (!playing && !video.paused) video.pause();
  }, [playing, timeMs, project]);

  const onScrub = (value: number) => {
    onPlayingChange(false);
    onTimeChange(Math.max(0, Math.min(duration, value)));
  };

  return (
    <>
      <div className="ft-panel-header"><span className="ft-panel-title">Video Preview</span></div>
      <div className="ft-preview-stage">
        <div ref={frameRef} className="ft-preview-frame" style={{ width: PREVIEW_WIDTH, height: previewHeight }} onClick={() => onPlayingChange(!playing)}>
          <ShortsCanvas project={project} timeMs={timeMs} mode="preview" pixelWidth={PREVIEW_WIDTH} videoRef={videoRef} />
          {!playing ? (
            <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", background: "rgba(0,0,0,0.18)" }}>
              <div style={{ width: 46, height: 46, borderRadius: "50%", background: "rgba(255,255,255,0.92)", display: "grid", placeItems: "center" }}>
                <Play size={18} fill="#101317" color="#101317" style={{ marginLeft: 2 }} />
              </div>
            </div>
          ) : null}
        </div>
      </div>
      <div className="ft-preview-controls">
        <button type="button" className="ft-icon-btn" onClick={() => onPlayingChange(!playing)} aria-label={playing ? "Pause" : "Play"}>
          {playing ? <Pause size={16} strokeWidth={2} /> : <Play size={16} strokeWidth={2} />}
        </button>
        <span className="ft-preview-time">{formatTime(timeMs)} / {formatTime(duration)}</span>
        <input className="ft-preview-scrub" type="range" min={0} max={duration} value={Math.round(timeMs)} onChange={(event) => onScrub(Number(event.target.value))} aria-label="Scrub" />
        <button type="button" className="ft-icon-btn" aria-label="Fullscreen" onClick={() => void frameRef.current?.requestFullscreen().catch(() => undefined)}>
          <Maximize2 size={14} strokeWidth={2} />
        </button>
      </div>
    </>
  );
}

function formatTime(ms: number) {
  const total = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}
