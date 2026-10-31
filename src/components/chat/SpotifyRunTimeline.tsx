import React, { useEffect, useState } from "react";
import type { SpotifyTrack } from "../../lib/electron-runtime";

/** Official Spotify glyph (single-colour mark). */
export function SpotifyLogo({ size = 14, color = "#1DB954" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={color} aria-hidden focusable="false">
      <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z" />
    </svg>
  );
}

export type SpotifyStepIcon = "search" | "play" | "pause" | "skip" | "back" | "queue" | "heart" | "volume" | "shuffle" | "verify" | "open" | "info";
export type SpotifyStepStatus = "running" | "done" | "failed";

export interface SpotifyRunStep {
  id: string;
  icon: SpotifyStepIcon;
  title: string;
  /** Plain description of the operation, or the confirmed outcome once settled. */
  detail?: string;
  status: SpotifyStepStatus;
  startedAt: number;
  endedAt?: number;
  /** Real Spotify results for this step — drives the expandable list. */
  tracks?: SpotifyTrack[];
  /** Short monospace technical detail (query, uri). */
  mono?: string;
  error?: string;
}

export interface SpotifyRunResult {
  track?: SpotifyTrack;
  /** Only true when Spotify's playback state confirmed it. */
  confirmedPlaying?: boolean;
}

export interface SpotifyRun {
  startedAt: number;
  endedAt?: number;
  status: "running" | "done" | "failed";
  steps: SpotifyRunStep[];
  finalText?: string;
  result?: SpotifyRunResult;
}

const ICONS: Record<SpotifyStepIcon, React.ReactNode> = {
  search: <><circle cx="11" cy="11" r="6.5" /><path d="m20 20-4.2-4.2" /></>,
  play: <path d="M8 5.5v13l10-6.5z" fill="currentColor" stroke="none" />,
  pause: <><rect x="7" y="5.5" width="3.4" height="13" rx="1" fill="currentColor" stroke="none" /><rect x="13.6" y="5.5" width="3.4" height="13" rx="1" fill="currentColor" stroke="none" /></>,
  skip: <><path d="M6 6v12l8-6z" fill="currentColor" stroke="none" /><path d="M18 6v12" /></>,
  back: <><path d="M18 6v12l-8-6z" fill="currentColor" stroke="none" /><path d="M6 6v12" /></>,
  queue: <path d="M4 7h12M4 12h12M4 17h7M18 14v6M15 17h6" />,
  heart: <path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.4A4 4 0 0 1 19 10c0 5.6-7 10-7 10z" />,
  volume: <><path d="M5 10v4h3l4 3.5v-11L8 10z" fill="currentColor" stroke="none" /><path d="M16 9.5a4 4 0 0 1 0 5" /></>,
  shuffle: <path d="M4 7h3c5 0 5 10 10 10h3m0 0-2.5-2.5M20 17l-2.5 2.5M4 17h3c1.5 0 2.6-.8 3.5-2M13.5 9C14.4 7.800 15.500 7 17 7h3m0 0-2.500-2.500M20 7l-2.500 2.500" />,
  verify: <><path d="M12 3.500 5 6.500v5c0 4.200 2.800 7.500 7 9 4.200-1.500 7-4.800 7-9v-5z" /><path d="m9 12 2.200 2.200L15.500 10" /></>,
  open: <path d="M14 5h5v5M19 5l-8 8M18 14v4a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h4" />,
  info: <><circle cx="12" cy="12" r="8" /><path d="M12 11v5M12 8h.01" /></>,
};

function StepGlyph({ icon }: { icon: SpotifyStepIcon }) {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {ICONS[icon]}
    </svg>
  );
}

function StatusMark({ status }: { status: SpotifyStepStatus }) {
  return (
    <span className={`clyra-sp-mark clyra-sp-mark--${status}`} aria-hidden>
      {status === "running" ? (
        <span className="clyra-sp-spin" />
      ) : status === "done" ? (
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12.500 4.500 4.500L19 7.500" /></svg>
      ) : (
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round"><path d="M6 6l12 12M18 6 6 18" /></svg>
      )}
    </span>
  );
}

const STATUS_LABEL: Record<SpotifyStepStatus, string> = { running: "Running", done: "Completed", failed: "Failed" };

export function formatElapsed(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

/** Smallest album image that is still sharp at 36px — keeps downloads tiny. */
export function trackArt(track?: SpotifyTrack | null) {
  const images = track?.album?.images;
  if (!images?.length) return undefined;
  return (images.length > 1 ? images[images.length - 2] : images[0]).url;
}

const artistLine = (track: SpotifyTrack) => track.artists.map((a) => a.name).join(", ");
const trackUrl = (track: SpotifyTrack) => (track.id ? `https://open.spotify.com/track/${track.id}` : undefined);

function Art({ track, size }: { track?: SpotifyTrack | null; size: number }) {
  const src = trackArt(track);
  // Fixed box so late-loading artwork never shifts surrounding content.
  return (
    <span className="clyra-sp-art" style={{ width: size, height: size }} aria-hidden>
      {src ? <img src={src} alt="" loading="lazy" decoding="async" width={size} height={size} /> : <SpotifyLogo size={Math.round(size * 0.45)} color="currentColor" />}
    </span>
  );
}

function TrackList({ tracks }: { tracks: SpotifyTrack[] }) {
  return (
    <ul className="clyra-sp-tracks">
      {tracks.map((track) => (
        <li key={track.id || track.uri}>
          <Art track={track} size={30} />
          <span className="clyra-sp-tracks__text">
            <span className="clyra-sp-tracks__title">{track.name}</span>
            <span className="clyra-sp-tracks__sub">{artistLine(track)}{track.album?.name ? ` · ${track.album.name}` : ""}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

const StepRow = React.memo(function StepRow({ step }: { step: SpotifyRunStep }) {
  const [open, setOpen] = useState(false);
  const expandable = Boolean(step.tracks?.length) || Boolean(step.error);
  const body = step.error || step.detail;
  return (
    <li className={`clyra-sp-step clyra-sp-step--${step.status}`}>
      <span className="clyra-sp-step__rail" aria-hidden />
      <StatusMark status={step.status} />
      <div className="clyra-sp-step__main">
        <button
          type="button"
          className="clyra-sp-step__head"
          disabled={!expandable}
          aria-expanded={expandable ? open : undefined}
          onClick={() => setOpen((v) => !v)}
        >
          <span className="clyra-sp-step__icon"><StepGlyph icon={step.icon} /></span>
          <span className={`clyra-sp-step__title${step.status === "running" ? " clyra-sp-shimmer" : ""}`}>{step.title}</span>
          <span className="clyra-sp-step__status">{STATUS_LABEL[step.status]}</span>
          {expandable ? (
            <svg className="clyra-sp-step__chev" data-open={open} width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="m9 6 6 6-6 6" /></svg>
          ) : null}
        </button>
        {body && !step.error ? <p className="clyra-sp-step__detail">{body}</p> : null}
        {step.error ? <p className="clyra-sp-step__detail clyra-sp-step__detail--error">{step.error}</p> : null}
        {step.mono ? <code className="clyra-sp-step__mono">{step.mono}</code> : null}
        {step.tracks?.length ? (
          <div className="clyra-sp-collapse" data-open={open}>
            <div className="clyra-sp-collapse__inner"><TrackList tracks={step.tracks} /></div>
          </div>
        ) : null}
      </div>
    </li>
  );
});

function renderInline(text: string) {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith("**") && part.endsWith("**") ? <strong key={i}>{part.slice(2, -2)}</strong> : <React.Fragment key={i}>{part}</React.Fragment>,
  );
}

function ResultCard({ track, confirmedPlaying }: { track: SpotifyTrack; confirmedPlaying?: boolean }) {
  const url = trackUrl(track);
  return (
    <div className="clyra-sp-result">
      <Art track={track} size={48} />
      <div className="clyra-sp-result__text">
        <span className="clyra-sp-result__title">{track.name}</span>
        <span className="clyra-sp-result__sub">
          {artistLine(track)}
          {confirmedPlaying ? <span className="clyra-sp-result__live"> · Playing</span> : null}
        </span>
      </div>
      {url ? (
        <a className="clyra-sp-result__open" href={url} target="_blank" rel="noopener noreferrer">
          <SpotifyLogo size={12} />
          Open in Spotify
        </a>
      ) : null}
    </div>
  );
}

/** The timer is isolated so a one-second tick re-renders only the header text. */
function Elapsed({ startedAt, endedAt }: { startedAt: number; endedAt?: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (endedAt) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [endedAt]);
  return <code className="clyra-sp-head__time">{formatElapsed((endedAt ?? now) - startedAt)}</code>;
}

export const SpotifyRunTimeline = React.memo(function SpotifyRunTimeline({ run }: { run: SpotifyRun }) {
  const running = run.status === "running";
  const failed = run.status === "failed";
  return (
    <section className="clyra-sp" aria-label="Spotify task" data-status={run.status}>
      <header className="clyra-sp-head" aria-live="polite">
        <span className="clyra-sp-head__state" aria-hidden>
          {running ? <span className="clyra-sp-spin" /> : failed ? (
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><path d="M6 6l12 12M18 6 6 18" /></svg>
          ) : (
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12.500 4.500 4.500L19 7.500" /></svg>
          )}
        </span>
        <span className={running ? "clyra-sp-shimmer" : undefined}>{running ? "Working" : failed ? "Stopped" : "Done"}</span>
        <span className="clyra-sp-head__sep">·</span>
        <Elapsed startedAt={run.startedAt} endedAt={run.endedAt} />
        <span className="clyra-sp-head__sep">·</span>
        <span className="clyra-sp-head__app"><SpotifyLogo size={12} />Spotify</span>
      </header>
      <div className="clyra-sp-line" data-active={running} aria-hidden><span /></div>
      <ol className="clyra-sp-steps">
        {run.steps.map((step) => <StepRow key={step.id} step={step} />)}
      </ol>
      {run.finalText ? (
        <div className="clyra-sp-final">
          <p>{renderInline(run.finalText)}</p>
          {run.result?.track ? <ResultCard track={run.result.track} confirmedPlaying={run.result.confirmedPlaying} /> : null}
        </div>
      ) : null}
    </section>
  );
});
