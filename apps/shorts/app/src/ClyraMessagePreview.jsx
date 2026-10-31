import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Maximize2, Pause, Play, Volume2, VolumeX } from 'lucide-react';
import { FakeTextScene } from './clyra-source/FakeTextScene.tsx';
import { buildFakeTextTimeline, geometryForFakeText } from './clyra-source/faketext-timeline.ts';
import './clyra-message-preview.css';

const format = ms => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;

// Clyra's own timeline builder and scene renderer are used here. Only speech
// durations are locally estimated because Shorts has no speech-render backend.
export function messageTimeline(messages, theme) {
  const safeTheme = theme || { chatWidthPercent: 94, chatHeightPercent: 46, fontScale: 1, bubbleScale: 1 };
  const { geometry, viewportHeightPx, bottomPaddingPx } = geometryForFakeText('9:16', safeTheme);
  const sourceMessages = messages.map(item => ({ ...item, sender: item.side === 'right' ? 'sender' : 'receiver' }));
  const speechDurations = new Map(sourceMessages.map(item => [item.id, { ms: Math.max(1350, 850 + item.text.length * 43), placeholder: true }]));
  const items = buildFakeTextTimeline(sourceMessages, speechDurations, { typingEnabled: true, typingDuration: 'auto', typingDurationCustomMs: 1000, paceMultiplier: 1, geometry, viewportHeightPx, bottomPaddingPx });
  const cues = items.map(item => ({ ...item, appearAt: item.startMs, end: item.startMs + item.durationMs }));
  return { items, cues, duration: Math.max(1800, (items.at(-1)?.startMs || 0) + (items.at(-1)?.durationMs || 0) + 600) };
}

export default function ClyraMessagePreview({ name, avatar, messages, theme, videoUrl, posterUrl, background, time, setTime, playing, setPlaying }) {
  const frame = useRef(null);
  const videoRef = useRef(null);
  const [videoReady, setVideoReady] = useState(false);
  const [muted, setMuted] = useState(background.muted);
  const timeline = useMemo(() => messageTimeline(messages, theme), [messages, theme]);
  const duration = timeline.duration;
  const project = useMemo(() => ({ id: 'frame-local-preview', aspect: '9:16', items: timeline.items, fakeText: { theme, contact: { name, avatar } } }), [timeline.items, theme, name, avatar]);

  useEffect(() => setMuted(background.muted), [background.muted]);
  useEffect(() => setVideoReady(false), [videoUrl]);

  useEffect(() => {
    if (!playing) return;
    let frameId = 0;
    let last = performance.now();
    let ended = false;
    const tick = now => {
      const delta = now - last;
      last = now;
      setTime(previous => {
        const next = previous + delta;
        if (next >= duration) { ended = true; return duration; }
        return next;
      });
      if (ended) { setPlaying(false); return; }
      frameId = requestAnimationFrame(tick);
    };
    frameId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameId);
  }, [playing, duration, setTime, setPlaying]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || video.readyState < 2) return;
    video.playbackRate = background.speed / 100;
    video.muted = muted;
    const target = background.trim + time / 1000 * background.speed / 100;
    if (Math.abs(video.currentTime - target) > (playing ? 0.25 : 0.02)) video.currentTime = target;
    if (playing && video.paused) void video.play().catch(() => undefined);
    if (!playing && !video.paused) video.pause();
  }, [time, playing, videoUrl, background.speed, background.trim, muted]);

  const toggle = () => setPlaying(!playing);
  const gameplayStyle = { transform: `translate(${background.offsetX}%, ${background.offsetY}%) scale(${background.zoom / 100})`, filter: `brightness(${1 - background.dim / 100}) blur(${background.blur}px)` };

  return <div className="cmp-root"><div className="cmp-heading"><strong>Video Preview</strong></div><div className="cmp-stage"><div className="cmp-frame" ref={frame} onClick={toggle}><div className="cmp-source-stage">
    {posterUrl && <img className="cmp-gameplay cmp-poster" src={posterUrl} alt="Selected gameplay background" style={gameplayStyle}/>}
    {videoUrl ? <video ref={videoRef} className="cmp-gameplay" src={videoUrl} muted={muted} playsInline preload="auto" onLoadedData={() => setVideoReady(true)} style={{ ...gameplayStyle, opacity: videoReady ? 1 : 0 }}/> : <div className="cmp-no-video">Choose a gameplay video</div>}
    {messages.length > 0 && <div className="cmp-clyra-source-canvas" style={{ transform: 'scale(0.2222222222)' }}><FakeTextScene project={project} timeMs={time} design={{ width: 1080, height: 1920 }}/></div>}
    </div>
    {!playing && time < duration && <div className="cmp-play-overlay"><span><Play size={18} fill="currentColor"/></span></div>}
  </div></div><div className="cmp-controls"><button aria-label={playing ? 'Pause text story preview' : 'Play text story preview'} onClick={toggle}>{playing ? <Pause size={16}/> : <Play size={16}/>}</button><span>{format(time)} / {format(duration)}</span><input aria-label="Scrub text story timeline" type="range" min="0" max={duration} value={Math.min(time, duration)} step="1" onChange={event => { setPlaying(false); setTime(Number(event.target.value)); }}/><button aria-label={muted ? 'Unmute preview' : 'Mute preview'} onClick={() => setMuted(value => !value)}>{muted ? <VolumeX size={16}/> : <Volume2 size={16}/>}</button><button aria-label="Fullscreen preview" onClick={() => frame.current?.requestFullscreen?.()}><Maximize2 size={15}/></button></div></div>;
}
