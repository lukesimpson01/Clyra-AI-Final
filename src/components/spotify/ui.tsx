/**
 * Shared presentation primitives for the Clyra Music (Spotify-layout) client:
 * formatters, the icon set, artwork and the round "play" disc. All styling
 * lives in spotify.css; nothing here hard-codes a colour.
 */
import { useState, type KeyboardEvent, type ReactNode } from "react";

export function fmt(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
}

export function fmtDate(iso: string | undefined) {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const days = Math.floor((Date.now() - date.getTime()) / 86_400_000);
  if (days < 1) return "Today";
  if (days < 2) return "Yesterday";
  if (days < 30) return `${days} days ago`;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

/** "2 hr 14 min" / "3 min 20 sec" like Spotify's collection headers. */
export function fmtDuration(ms: number) {
  const totalMinutes = Math.floor(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0) return `${hours} hr ${minutes} min`;
  if (minutes > 0) return `${minutes} min ${Math.floor((ms % 60000) / 1000)} sec`;
  return `${Math.floor(ms / 1000)} sec`;
}

export function fmtCount(value: number | undefined) {
  if (!Number.isFinite(value)) return "";
  return new Intl.NumberFormat(undefined).format(value as number);
}

export function greeting() {
  const hour = new Date().getHours();
  if (hour < 5) return "Good night";
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

export function initials(name: string) {
  return name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? "").join("") || "?";
}

type Img = { url: string };
/** Spotify returns images largest-first. */
export const bigImage = (images?: Img[]) => images?.[0]?.url;
export const smallImage = (images?: Img[]) => (images && images.length > 0 ? images[images.length - 1].url : undefined);
/** Mid-size art for 40-64px thumbnails (the smallest is often 64px and soft). */
export const midImage = (images?: Img[]) => (images && images.length > 1 ? images[Math.min(1, images.length - 1)].url : images?.[0]?.url);

export function activateOnKey(event: KeyboardEvent<HTMLElement>, action: () => void) {
  if (event.key !== "Enter" && event.key !== " ") return;
  event.preventDefault();
  action();
}

export type IconName =
  | "home" | "homeFill" | "search" | "library" | "plus" | "arrowRight" | "chevL" | "chevR" | "chevD" | "play" | "pause" | "prev" | "next"
  | "shuffle" | "repeat" | "repeat1" | "heart" | "heartFill" | "plusCircle" | "checkCircle" | "queue" | "nowPlaying" | "lyrics" | "device"
  | "volume0" | "volume1" | "volume2" | "expand" | "more" | "pin" | "clock" | "list" | "compact" | "grid" | "browse" | "note" | "user" | "close"
  | "external" | "link" | "check" | "sortDown" | "speaker" | "minimize" | "album" | "artist" | "folder";

export function Icon({ name, size = 24 }: { name: IconName; size?: number }) {
  const common = { width: size, height: size, viewBox: "0 0 24 24", "aria-hidden": true as const };
  const stroke = { fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  switch (name) {
    case "home":
      return <svg {...common} {...stroke}><path d="M3.5 10.8 12 3.5l8.5 7.3V20a.8.8 0 0 1-.8.8H15v-6h-6v6H4.3a.8.8 0 0 1-.8-.8Z" /></svg>;
    case "homeFill":
      return <svg {...common} fill="currentColor"><path d="M12 2.6 2.4 10.8V21c0 .6.4 1 1 1H9.5v-7h5v7h6.1c.6 0 1-.4 1-1V10.8Z" /></svg>;
    case "search":
      return <svg {...common} {...stroke}><circle cx="10.5" cy="10.5" r="6.6" /><path d="m20.5 20.5-5.3-5.3" /></svg>;
    case "library":
      return <svg {...common} fill="currentColor"><path d="M3.5 4h2.2v16H3.5zM8.6 4h2.2v16H8.6z" /><path d="m13.9 4.9 2.1-.6 4.2 15.2-2.1.6z" /></svg>;
    case "plus":
      return <svg {...common} {...stroke}><path d="M12 4.5v15M4.5 12h15" /></svg>;
    case "arrowRight":
      return <svg {...common} {...stroke}><path d="M4.5 12h15M13.5 6l6 6-6 6" /></svg>;
    case "chevL":
      return <svg {...common} {...stroke} strokeWidth={2.4}><path d="m15 5.5-6.5 6.5 6.5 6.5" /></svg>;
    case "chevR":
      return <svg {...common} {...stroke} strokeWidth={2.4}><path d="m9 5.5 6.5 6.5L9 18.5" /></svg>;
    case "chevD":
      return <svg {...common} {...stroke} strokeWidth={2.4}><path d="m5.5 9 6.5 6.5L18.5 9" /></svg>;
    case "play":
      return <svg {...common} fill="currentColor"><path d="M7.2 4.4a1 1 0 0 1 1.5-.86l11.1 7.1a1 1 0 0 1 0 1.72l-11.1 7.1a1 1 0 0 1-1.5-.86Z" /></svg>;
    case "pause":
      return <svg {...common} fill="currentColor"><rect x="5.5" y="4" width="4.6" height="16" rx="1.2" /><rect x="13.9" y="4" width="4.6" height="16" rx="1.2" /></svg>;
    case "prev":
      return <svg {...common} fill="currentColor"><path d="M5.5 5h2.2v14H5.5zM20 5.7v12.6a.8.8 0 0 1-1.2.7L9 12.7a.8.8 0 0 1 0-1.4L18.8 5a.8.8 0 0 1 1.2.7Z" /></svg>;
    case "next":
      return <svg {...common} fill="currentColor"><path d="M16.3 5h2.2v14h-2.2zM4 5.7v12.6a.8.8 0 0 0 1.2.7L15 12.7a.8.8 0 0 0 0-1.4L5.2 5A.8.8 0 0 0 4 5.7Z" /></svg>;
    case "shuffle":
      return <svg {...common} {...stroke}><path d="m17.5 3.5 3 3-3 3M17.5 14.5l3 3-3 3" /><path d="M3 6.5h3.4c1.6 0 3 .8 3.8 2.2l3.6 6.3c.8 1.4 2.200 2.200 3.800 2.200h3.900M3 17.500h3.400c1.600 0 3-.8 3.800-2.200l.5-.8M13.300 9l.5-.8c.8-1.400 2.200-2.200 3.800-2.200h3.900" /></svg>;
    case "repeat":
    case "repeat1":
      return (
        <svg {...common} {...stroke}>
          <path d="m17 2.500 4 4-4 4" /><path d="M3 11V9.500a3 3 0 0 1 3-3h15" /><path d="m7 21.500-4-4 4-4" /><path d="M21 12.500V14a3 3 0 0 1-3 3H3" />
          {name === "repeat1" ? <path d="M11 9.800 12.400 9v6" strokeWidth={1.800} /> : null}
        </svg>
      );
    case "heart":
      return <svg {...common} {...stroke}><path d="M20.600 5a5.400 5.400 0 0 0-7.600 0l-1 1-1-1A5.400 5.400 0 0 0 3.400 12.600l1 1L12 21l7.600-7.400 1-1A5.400 5.400 0 0 0 20.600 5Z" /></svg>;
    case "heartFill":
      return <svg {...common} fill="currentColor"><path d="M20.600 5a5.400 5.400 0 0 0-7.600 0l-1 1-1-1A5.400 5.400 0 0 0 3.400 12.600l1 1L12 21l7.600-7.400 1-1A5.400 5.400 0 0 0 20.600 5Z" /></svg>;
    case "plusCircle":
      return <svg {...common} {...stroke} strokeWidth={1.8}><circle cx="12" cy="12" r="9.500" /><path d="M12 7.500v9M7.500 12h9" /></svg>;
    case "checkCircle":
      return <svg {...common}><circle cx="12" cy="12" r="10" fill="currentColor" /><path d="m7.600 12.300 3 3 5.800-6.600" fill="none" stroke="var(--sp-on-accent, #fff)" strokeWidth={2.100} strokeLinecap="round" strokeLinejoin="round" /></svg>;
    case "queue":
      return <svg {...common} {...stroke}><path d="M3 6h12M3 11.500h12M3 17h6.500" /><path d="M15.500 14.200v6.300l5-3.150Z" fill="currentColor" /></svg>;
    case "nowPlaying":
      return <svg {...common} {...stroke} strokeWidth={1.800}><rect x="3" y="4" width="18" height="14" rx="2.200" /><path d="M10.200 8.200v5.600l4.600-2.800Z" fill="currentColor" stroke="none" /><path d="M7 21h10" /></svg>;
    case "lyrics":
      return <svg {...common} {...stroke} strokeWidth={1.800}><path d="M14.500 4.500a4 4 0 1 1 5 5l-9.600 9.600a2 2 0 0 1-2.800 0l-.2-.2a2 2 0 0 1 0-2.800Z" /><path d="m12 7 5 5M4.500 19.500 3 21" /></svg>;
    case "device":
      return <svg {...common} {...stroke} strokeWidth={1.800}><rect x="3" y="4" width="18" height="12" rx="2" /><path d="M8 20h8M12 16v4" /></svg>;
    case "volume0":
      return <svg {...common} {...stroke} strokeWidth={1.800}><path d="M4 14v-4h4l5-4v12l-5-4Z" fill="currentColor" /><path d="m17 9.500 4.500 5M21.500 9.500l-4.500 5" /></svg>;
    case "volume1":
      return <svg {...common} {...stroke} strokeWidth={1.800}><path d="M4 14v-4h4l5-4v12l-5-4Z" fill="currentColor" /><path d="M16.800 9.400a3.700 3.700 0 0 1 0 5.200" /></svg>;
    case "volume2":
    case "speaker":
      return <svg {...common} {...stroke} strokeWidth={1.800}><path d="M4 14v-4h4l5-4v12l-5-4Z" fill="currentColor" /><path d="M16.800 9.400a3.700 3.700 0 0 1 0 5.200M19.400 6.600a7.600 7.600 0 0 1 0 10.800" /></svg>;
    case "expand":
      return <svg {...common} {...stroke} strokeWidth={1.800}><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" /></svg>;
    case "minimize":
      return <svg {...common} {...stroke} strokeWidth={1.800}><path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" /></svg>;
    case "more":
      return <svg {...common} fill="currentColor"><circle cx="5" cy="12" r="1.900" /><circle cx="12" cy="12" r="1.900" /><circle cx="19" cy="12" r="1.900" /></svg>;
    case "pin":
      return <svg {...common} fill="currentColor"><path d="M14.800 3.200 21 9.400l-2.300.9-3.600 3.600.4 4-1.400 1.400-3.700-3.700L5 20.700l-.7-.7 5.100-5.100-3.700-3.700 1.400-1.400 4 .4 3.600-3.600Z" /></svg>;
    case "clock":
      return <svg {...common} {...stroke} strokeWidth={1.800}><circle cx="12" cy="12" r="9" /><path d="M12 7v5.200l3.400 2" /></svg>;
    case "list":
      return <svg {...common} {...stroke}><path d="M4 6.500h16M4 12h16M4 17.500h16" /></svg>;
    case "compact":
      return <svg {...common} {...stroke}><path d="M4 5.500h16M4 9.800h16M4 14.200h16M4 18.500h16" /></svg>;
    case "grid":
      return <svg {...common} fill="currentColor"><rect x="3.500" y="3.500" width="7" height="7" rx="1.500" /><rect x="13.500" y="3.500" width="7" height="7" rx="1.500" /><rect x="3.500" y="13.500" width="7" height="7" rx="1.500" /><rect x="13.500" y="13.500" width="7" height="7" rx="1.500" /></svg>;
    case "browse":
      return <svg {...common} {...stroke} strokeWidth={1.800}><rect x="3.500" y="3.500" width="7" height="7" rx="1.500" /><rect x="13.500" y="3.500" width="7" height="7" rx="1.500" /><rect x="3.500" y="13.500" width="7" height="7" rx="1.500" /><rect x="13.500" y="13.500" width="7" height="7" rx="1.500" /></svg>;
    case "note":
      return <svg {...common} {...stroke} strokeWidth={1.600}><path d="M9 18V5l11-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="17" cy="16" r="3" /></svg>;
    case "user":
      return <svg {...common} {...stroke} strokeWidth={1.700}><circle cx="12" cy="8.500" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></svg>;
    case "close":
      return <svg {...common} {...stroke}><path d="M6 6l12 12M18 6 6 18" /></svg>;
    case "external":
      return <svg {...common} {...stroke}><path d="M8 16 16 8M9 8h7v7" /></svg>;
    case "link":
      return <svg {...common} {...stroke} strokeWidth={1.800}><path d="M10 14a4 4 0 0 0 5.700 0l3-3a4 4 0 0 0-5.700-5.700l-1 1" /><path d="M14 10a4 4 0 0 0-5.700 0l-3 3a4 4 0 0 0 5.700 5.700l1-1" /></svg>;
    case "check":
      return <svg {...common} {...stroke} strokeWidth={2.200}><path d="m5 12.500 4.500 4.500L19 7.500" /></svg>;
    case "sortDown":
      return <svg {...common} {...stroke} strokeWidth={1.800}><path d="M4 7h16M7 12h10M10 17h4" /></svg>;
    case "album":
      return <svg {...common} {...stroke} strokeWidth={1.800}><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="2.600" /></svg>;
    case "artist":
      return <svg {...common} {...stroke} strokeWidth={1.800}><circle cx="12" cy="8" r="3.800" /><path d="M5 20.500c.8-3.600 3.400-5.500 7-5.500s6.200 1.900 7 5.500" /></svg>;
    case "folder":
      return <svg {...common} {...stroke} strokeWidth={1.800}><path d="M3.500 6.500a1.500 1.500 0 0 1 1.500-1.500h4.400l2 2.200H19a1.500 1.500 0 0 1 1.500 1.500v9.300a1.500 1.500 0 0 1-1.500 1.500H5a1.500 1.500 0 0 1-1.500-1.500Z" /></svg>;
    default:
      return null;
  }
}

/** Remote art with a quiet glyph fallback so a bad URL never shows a broken-image icon. */
export function Artwork({ src, round = false, glyph = "note", eager = false }: { src?: string; round?: boolean; glyph?: IconName; eager?: boolean }) {
  const [broken, setBroken] = useState<string | null>(null);
  const failed = broken === src;
  return (
    <div style={{ width: "100%", height: "100%", display: "grid", placeItems: "center", color: "var(--sp-faint)", background: "var(--sp-hover)", borderRadius: round ? "50%" : undefined }}>
      {src && !failed ? (
        <img src={src} alt="" loading={eager ? "eager" : "lazy"} decoding="async" draggable={false} onError={() => setBroken(src ?? null)} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
      ) : (
        <Icon name={round ? "user" : glyph} size={40} />
      )}
    </div>
  );
}

export function LikedArt({ size }: { size?: number }) {
  return (
    <div style={{ width: size ?? "100%", height: size ?? "100%", background: "linear-gradient(135deg, #2f45e6 0%, #5b8dff 55%, #a9c8ff 100%)", display: "grid", placeItems: "center", color: "#fff", flexShrink: 0 }}>
      <Icon name="heartFill" size={size ? Math.round(size * 0.46) : 56} />
    </div>
  );
}

/** Spotify's round "play" disc (blue). Clicks never bubble to the card under it. */
export function PlayBtn({ onClick, playing = false, size = "md", label, disabled, className = "" }: { onClick: () => void; playing?: boolean; size?: "xs" | "sm" | "md" | "lg"; label?: string; disabled?: boolean; className?: string }) {
  const glyph = size === "lg" ? 26 : size === "sm" ? 16 : size === "xs" ? 20 : 24;
  return (
    <button
      type="button"
      className={`sp-play ${size === "lg" ? "sp-play--lg" : size === "sm" ? "sp-play--sm" : size === "xs" ? "sp-play--xs" : ""} ${className}`}
      aria-label={label ?? (playing ? "Pause" : "Play")}
      disabled={disabled}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      onDoubleClick={(event) => event.stopPropagation()}
    >
      <Icon name={playing ? "pause" : "play"} size={glyph} />
    </button>
  );
}

export function Eq({ paused = false }: { paused?: boolean }) {
  return (
    <span className={`sp-eq ${paused ? "is-paused" : ""}`} aria-label={paused ? "Paused" : "Playing"} role="img">
      <i /><i /><i />
    </span>
  );
}

export function IconBtn({ icon, label, onClick, on = false, size = 16, className = "", children }: { icon: IconName; label: string; onClick: (event: React.MouseEvent<HTMLButtonElement>) => void; on?: boolean; size?: number; className?: string; children?: ReactNode }) {
  return (
    <button type="button" className={`sp-icon-btn ${on ? "is-on" : ""} ${className}`} aria-label={label} title={label} aria-pressed={on || undefined} onClick={onClick}>
      <Icon name={icon} size={size} />
      {children}
    </button>
  );
}

/** The Clyra Music mark: a round blue disc carrying the Clyra waveform. */
export function MusicMark({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden>
      <defs>
        <linearGradient id="sp-mark" x1="8" y1="4" x2="40" y2="44" gradientUnits="userSpaceOnUse">
          <stop stopColor="#5b9bff" />
          <stop offset="1" stopColor="#1e6fff" />
        </linearGradient>
      </defs>
      <circle cx="24" cy="24" r="24" fill="url(#sp-mark)" />
      <path d="M10.500 28c3.300 0 3.300-8.500 6.600-8.500S20.400 30 23.700 30s3.300-15 6.600-15 3.300 10.200 7.200 10.200" fill="none" stroke="#fff" strokeWidth="3.600" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
