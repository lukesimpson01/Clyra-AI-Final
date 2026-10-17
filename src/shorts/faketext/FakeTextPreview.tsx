// Live preview for Fake Text Story: the exact ShortsCanvas used for export,
// plus real-time playback of each message's synthesized voice. Audio for the
// currently-speaking message streams from the project's on-disk speech cache
// (built by the timeline-build job) — a message with no cached audio yet
// simply plays silently until the next rebuild finishes.

import { useEffect, useMemo, useRef, useState } from "react";
import { Maximize2, Pause, Play, Volume2, VolumeX } from "lucide-react";
import { ShortsCanvas, designSizeFor } from "../engine/ShortsCanvas";
import { projectDurationMs, type MessageItem, type ShortsProject } from "../../../lib/shorts/schema";
import { BUBBLE_ENTER_MS } from "../../../lib/shorts/faketext-timeline";
import { shortsApi } from "../api";

const PREVIEW_WIDTH = 240;

export function FakeTextPreview({ project, timeMs, playing, onTimeChange, onPlayingChange }: {
  project: ShortsProject;
  timeMs: number;
  playing: boolean;
  /** Accepts a React functional updater so the rAF loop can accumulate off the latest state instead of a value closed over when the loop started. */
  onTimeChange: (updater: number | ((prev: number) => number)) => void;
  onPlayingChange: (value: boolean) => void;
}) {
  const [muted, setMuted] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const activeIdRef = useRef<string | null>(null);
  const frameRef = useRef<HTMLDivElement | null>(null);

  const duration = projectDurationMs(project);
  const design = designSizeFor(project);
  const previewHeight = (design.height / design.width) * PREVIEW_WIDTH;

  const messages = useMemo(() => project.items.filter((item): item is MessageItem => item.type === "message"), [project]);
  const active = useMemo(() => {
    for (const item of messages) {
      const start = item.startMs + BUBBLE_ENTER_MS;
      const end = start + item.speechMs;
      if (item.speechMs > 0 && timeMs >= start && timeMs < end) return item;
    }
    return null;
  }, [messages, timeMs]);

  // Playback clock.
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

  // Background gameplay video sync (same drift-correction pattern as the unified editor).
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

  // Voice audio sync: swap source when the speaking message changes, keep the offset aligned, play/pause with the clock.
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (!active) {
      if (activeIdRef.current !== null) {
        audio.pause();
        activeIdRef.current = null;
      }
      return;
    }
    const offsetSec = Math.max(0, (timeMs - (active.startMs + BUBBLE_ENTER_MS)) / 1000);
    if (activeIdRef.current !== active.id) {
      activeIdRef.current = active.id;
      audio.src = shortsApi.faketextSpeechUrl(project.id, active.id);
      audio.currentTime = offsetSec;
      if (playing && !muted) void audio.play().catch(() => undefined);
    } else {
      const drift = Math.abs(audio.currentTime - offsetSec);
      if (!playing && drift > 0.03) audio.currentTime = offsetSec;
      if (playing && drift > 0.3) audio.currentTime = offsetSec;
    }
    if (playing && !muted && audio.paused) void audio.play().catch(() => undefined);
    if ((!playing || muted) && !audio.paused) audio.pause();
  }, [active, timeMs, playing, muted, project.id]);

  const onScrub = (value: number) => {
    onPlayingChange(false);
    onTimeChange(Math.max(0, Math.min(duration, value)));
  };

  return (
    <>
      <div className="ft-panel-header">
        <span className="ft-panel-title">Video Preview</span>
      </div>
      <div className="ft-preview-stage">
        <div ref={frameRef} className="ft-preview-frame" style={{ width: PREVIEW_WIDTH, height: previewHeight }} onClick={() => onPlayingChange(!playing)}>
          <ShortsCanvas project={project} timeMs={timeMs} mode="preview" pixelWidth={PREVIEW_WIDTH} videoRef={videoRef} />
          <audio ref={audioRef} muted={muted} style={{ display: "none" }} />
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
        <button type="button" className="ft-icon-btn" onClick={() => setMuted((value) => !value)} aria-label={muted ? "Unmute" : "Mute"}>
          {muted ? <VolumeX size={16} strokeWidth={2} /> : <Volume2 size={16} strokeWidth={2} />}
        </button>
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
