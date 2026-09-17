/**
 * Full Spotify workspace — a real, Spotify-styled Home / Search / Library
 * client living inside Clyra, backed by the same `useSpotifyPlayback` hook
 * (and therefore the same connection/tokens) as the ambient notch. Opened
 * from the app launcher, or via the "expand" affordance on the notch.
 *
 * Visually this mirrors Spotify's own desktop layout (persistent top search
 * bar with back/forward history, a collapsed icon-only playlist rail, a
 * "Now Playing" dock, and a full transport bar) but in a light theme with
 * Clyra's own accent, type, radius and shadow tokens (see the constants
 * below — lifted from ClyraComposerShell/index.css, not re-invented) and
 * the house motion language (AppLauncher's springs/easing) instead of flat
 * CSS transitions, so it reads as part of the same app as chat.
 */
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactElement, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import type { SpotifyPlaybackHook } from "../chat/SpotifyNotch";
import type { SpotifyPlaylist, SpotifyPlaylistItem, SpotifyTrack } from "../../lib/electron-runtime";

// Clyra's own tokens (ClyraComposerShell.tsx / index.css), not re-picked hexes.
const ACCENT = "#1E6FFF";
const ACCENT_HOVER = "#3D82FF";
const ACCENT_TINT = "#EEF3FF";
const ACCENT_GLOW = "rgba(30,111,255,.5)";
const FOCUS_RING = "rgba(0,82,251,.22)";
const BG = "#FFFFFF";
const SIDEBAR_BG = "#F7F7F6";
const PANEL_BG = "#F4F4F3";
const CARD_BG = "#FFFFFF";
const CARD_BORDER = "rgba(0,0,0,0.07)";
const CARD_BORDER_STRONG = "rgba(0,0,0,0.1)";
const CARD_HOVER = "#F7F9FF";
const TEXT = "#15171C";
const TEXT_MUTED = "#63676F";
const TEXT_FAINT = "#9CA0AA";
const DANGER = "#B3261E";
const FONT = "'Instrument Sans', -apple-system, BlinkMacSystemFont, 'SF Pro Text', system-ui, sans-serif";

// Radius scale: sm/md/lg/xl (index.css --clyra-radius-*), pill for anything button-shaped.
const R_SM = 6;
const R_MD = 8;
const R_LG = 12;
const R_XL = 14;
const R_PILL = 999;

// Shadow tokens (index.css --clyra-shadow-*).
const SHADOW_POPOVER = "0 8px 24px rgba(15,23,42,.08)";
const SHADOW_ELEVATED = "0 1px 2px rgba(15,23,42,.03), 0 5px 18px rgba(15,23,42,.05)";
const SHADOW_FLOATING = "0 20px 48px rgba(15,23,42,.16)";

// House easing (AppLauncher's LAUNCHER_OPEN curve, reused app-wide for "arrive" motion).
const EASE_ARRIVE = [0.22, 1, 0.36, 1] as const;
// House springs (AppLauncher.tsx) — tight, near-critically-damped, used for anything
// that should feel like it's being tracked/pressed rather than eased.
const SPRING_TIGHT = { type: "spring", stiffness: 780, damping: 44, mass: 0.1 } as const;
// Softer settle, used for panels/cards arriving rather than tracking a pointer.
const SPRING_SOFT = { type: "spring", stiffness: 320, damping: 28, mass: 0.4 } as const;

const MUSIC_ICON = "/icons/clyra-music.svg";

function fmt(ms: number) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function fmtDate(iso: string) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

function fmtDuration(ms: number) {
  const totalMinutes = Math.round(ms / 60000);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return h > 0 ? `${h} hr ${m} min` : `${m} min`;
}

function greeting() {
  const h = new Date().getHours();
  if (h < 5) return "Good night";
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

function initials(name: string) {
  return name.trim().split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? "").join("") || "?";
}

function activateFromKeyboard(event: KeyboardEvent<HTMLElement>, action: () => void) {
  if (event.key !== "Enter" && event.key !== " ") return;
  event.preventDefault();
  action();
}

type ViewEntry =
  | { type: "home" }
  | { type: "search" }
  | { type: "library" }
  | { type: "playlist"; playlist: SpotifyPlaylist };

function viewKey(v: ViewEntry) {
  return v.type === "playlist" ? `playlist:${v.playlist.id}` : v.type;
}

const NAV_ITEMS: { id: "home" | "search" | "library"; label: string; icon: (active: boolean) => ReactElement }[] = [
  {
    id: "home",
    label: "Home",
    icon: (active) => (
      <svg width="22" height="22" viewBox="0 0 24 24" fill={active ? TEXT : "none"} stroke="currentColor" strokeWidth="2">
        <path d="M3 11.5 12 4l9 7.5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M5 10v9a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1v-9" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    id: "search",
    label: "Search",
    icon: (active) => (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2.6 : 2}>
        <circle cx="11" cy="11" r="7" />
        <path d="m21 21-4.3-4.3" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    id: "library",
    label: "Your Library",
    icon: (active) => (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2.6 : 2}>
        <path d="M3 5v14M9 3v18M15 6l3 15" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
];

function ChevronIcon({ dir }: { dir: "back" | "forward" }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6">
      <path d={dir === "back" ? "m15 6-6 6 6 6" : "m9 6 6 6-6 6"} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function PlayGlyph({ size = 17, color = "#fff" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
      <path d="M8 5v14l11-7z" />
    </svg>
  );
}

function AlbumFallback({ size = 36 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={TEXT_FAINT} strokeWidth="1.5">
      <path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" />
    </svg>
  );
}

/** Image with a graceful fallback glyph on missing/broken art — used for every
 *  piece of Spotify artwork so a bad URL never shows a browser broken-image icon. */
function Artwork({ src, size, radius = R_MD, iconSize }: { src?: string; size: number | string; radius?: number; iconSize?: number }) {
  const [broken, setBroken] = useState(false);
  const dim = typeof size === "number" ? `${size}px` : size;
  return (
    <div
      style={{
        width: dim,
        height: dim,
        flexShrink: 0,
        borderRadius: radius,
        overflow: "hidden",
        background: "#EDEEF1",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {src && !broken ? (
        <img src={src} alt="" onError={() => setBroken(true)} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
      ) : (
        <AlbumFallback size={iconSize ?? (typeof size === "number" ? Math.max(14, size * 0.4) : 24)} />
      )}
    </div>
  );
}

/** Hover-reveal circular play button used on cards/tiles/rows — clicking it
 *  (not the card body) is one of the only two ways to actually start playback. */
function HoverPlayButton({ visible, onPlay, size = 42 }: { visible: boolean; onPlay: () => void; size?: number }) {
  return (
    <motion.button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onPlay();
      }}
      aria-label="Play"
      initial={false}
      animate={{ opacity: visible ? 1 : 0, y: visible ? 0 : 6, scale: visible ? 1 : 0.88 }}
      transition={SPRING_TIGHT}
      whileHover={visible ? { scale: 1.06 } : undefined}
      whileTap={visible ? { scale: 0.92 } : undefined}
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        background: ACCENT,
        border: "none",
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        boxShadow: `0 8px 16px ${ACCENT_GLOW}`,
        pointerEvents: visible ? "auto" : "none",
        flexShrink: 0,
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = ACCENT_HOVER)}
      onMouseLeave={(e) => (e.currentTarget.style.background = ACCENT)}
    >
      <PlayGlyph size={size < 40 ? 14 : 17} />
    </motion.button>
  );
}

function PlaylistCard({ playlist, onOpen, onPlay }: { playlist: SpotifyPlaylist; onOpen: () => void; onPlay: () => void }) {
  const [hover, setHover] = useState(false);
  return (
    <motion.div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={onOpen}
      onDoubleClick={onPlay}
      onKeyDown={(event) => activateFromKeyboard(event, onOpen)}
      role="button"
      tabIndex={0}
      aria-label={`Open playlist ${playlist.name}`}
      whileTap={{ scale: 0.985 }}
      animate={{ y: hover ? -3 : 0 }}
      transition={SPRING_TIGHT}
      style={{
        position: "relative",
        display: "flex",
        flexDirection: "column",
        gap: 12,
        padding: 14,
        borderRadius: R_LG,
        background: hover ? CARD_HOVER : CARD_BG,
        border: `1px solid ${hover ? CARD_BORDER_STRONG : CARD_BORDER}`,
        cursor: "pointer",
        boxShadow: hover ? SHADOW_POPOVER : SHADOW_ELEVATED,
      }}
    >
      <div style={{ position: "relative", width: "100%", aspectRatio: "1" }}>
        <Artwork src={playlist.images?.[0]?.url} size="100%" radius={R_MD} iconSize={36} />
        <div style={{ position: "absolute", right: 8, bottom: 8 }}>
          <HoverPlayButton visible={hover} onPlay={onPlay} />
        </div>
      </div>
      <div style={{ fontSize: 14, fontWeight: 600, color: TEXT, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{playlist.name}</div>
      <div style={{ fontSize: 12, color: TEXT_MUTED, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>By {playlist.owner?.display_name || "Clyra Music"}</div>
    </motion.div>
  );
}

function QuickTile({ playlist, onOpen, onPlay }: { playlist: SpotifyPlaylist; onOpen: () => void; onPlay: () => void }) {
  const [hover, setHover] = useState(false);
  return (
    <motion.div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={onOpen}
      onDoubleClick={onPlay}
      onKeyDown={(event) => activateFromKeyboard(event, onOpen)}
      role="button"
      tabIndex={0}
      aria-label={`Open playlist ${playlist.name}`}
      whileTap={{ scale: 0.985 }}
      style={{
        position: "relative",
        display: "flex",
        alignItems: "center",
        gap: 14,
        borderRadius: R_LG,
        overflow: "hidden",
        background: hover ? CARD_HOVER : CARD_BG,
        border: `1px solid ${hover ? CARD_BORDER_STRONG : CARD_BORDER}`,
        cursor: "pointer",
        transition: `background .18s ${EASE_STR}, border-color .18s ${EASE_STR}`,
        minWidth: 0,
      }}
    >
      <Artwork src={playlist.images?.[0]?.url} size={56} radius={0} iconSize={20} />
      <div style={{ fontSize: 14, fontWeight: 700, color: TEXT, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", minWidth: 0, flex: 1 }}>
        {playlist.name}
      </div>
      <div style={{ marginRight: 10 }}>
        <HoverPlayButton visible={hover} onPlay={onPlay} />
      </div>
    </motion.div>
  );
}

function TrackRow({ track, index, playing, onPlay, onQueue }: { track: SpotifyTrack; index: number; playing: boolean; onPlay: () => void; onQueue?: () => void }) {
  const [hover, setHover] = useState(false);
  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onDoubleClick={onPlay}
      style={{
        display: "grid",
        gridTemplateColumns: "24px 1fr auto auto",
        alignItems: "center",
        gap: 14,
        padding: "8px 12px",
        borderRadius: R_SM,
        background: hover ? CARD_HOVER : "transparent",
        transition: `background .15s ${EASE_STR}`,
        cursor: "default",
      }}
    >
      <button
        type="button"
        onClick={onPlay}
        aria-label="Play"
        style={{ background: "none", border: "none", padding: 0, cursor: "pointer", fontSize: 13, color: playing ? ACCENT : TEXT_MUTED, textAlign: "center" }}
      >
        {hover && !playing ? (
          <svg width="12" height="12" viewBox="0 0 24 24" fill={TEXT}><path d="M8 5v14l11-7z" /></svg>
        ) : playing ? (
          <PlayingGlyph />
        ) : (
          index + 1
        )}
      </button>
      <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
        <Artwork src={track.album?.images?.[track.album.images.length - 1]?.url || track.album?.images?.[0]?.url} size={40} iconSize={16} />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 500, color: playing ? ACCENT : TEXT, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{track.name}</div>
          <div style={{ fontSize: 12.5, color: TEXT_MUTED, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{track.artists.map((a) => a.name).join(", ")}</div>
        </div>
      </div>
      <div style={{ fontSize: 12.5, color: TEXT_MUTED }}>{fmt(track.duration_ms)}</div>
      {onQueue ? (
        <button type="button" onClick={onQueue} title="Add to queue" aria-label={`Add ${track.name} to queue`} style={{ opacity: hover ? 1 : 0, border: "none", background: "transparent", color: TEXT_MUTED, cursor: "pointer", padding: 4, transition: "opacity .15s ease" }}>
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 6h10M4 12h10M4 18h6M18 15v6M15 18h6" strokeLinecap="round" /></svg>
        </button>
      ) : <span />}
    </div>
  );
}

function PlayingGlyph() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill={ACCENT}>
      <rect x="5" y="4" width="4" height="16" /><rect x="15" y="4" width="4" height="16" />
    </svg>
  );
}

function PlaylistTrackRow({ item, index, playing, onPlay, onQueue }: { item: SpotifyPlaylistItem; index: number; playing: boolean; onPlay: () => void; onQueue?: () => void }) {
  const [hover, setHover] = useState(false);
  const { track } = item;
  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onDoubleClick={onPlay}
      style={{
        display: "grid",
        gridTemplateColumns: "28px 1fr 1fr 110px 44px 44px",
        alignItems: "center",
        gap: 14,
        padding: "6px 10px",
        borderRadius: R_SM,
        background: hover ? CARD_HOVER : "transparent",
        transition: `background .15s ${EASE_STR}`,
      }}
    >
      <button
        type="button"
        onClick={onPlay}
        aria-label="Play"
        style={{ background: "none", border: "none", padding: 0, cursor: "pointer", fontSize: 13, color: playing ? ACCENT : TEXT_MUTED, textAlign: "center" }}
      >
        {hover && !playing ? (
          <svg width="12" height="12" viewBox="0 0 24 24" fill={TEXT}><path d="M8 5v14l11-7z" /></svg>
        ) : playing ? (
          <PlayingGlyph />
        ) : (
          index + 1
        )}
      </button>
      <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
        <Artwork src={track.album?.images?.[track.album.images.length - 1]?.url || track.album?.images?.[0]?.url} size={40} iconSize={16} />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 500, color: playing ? ACCENT : TEXT, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{track.name}</div>
          <div style={{ fontSize: 12.5, color: TEXT_MUTED, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{track.artists.map((a) => a.name).join(", ")}</div>
        </div>
      </div>
      <div style={{ fontSize: 13, color: TEXT_MUTED, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{track.album?.name || ""}</div>
      <div style={{ fontSize: 13, color: TEXT_MUTED, whiteSpace: "nowrap" }}>{fmtDate(item.addedAt)}</div>
      <div style={{ fontSize: 13, color: TEXT_MUTED, textAlign: "right" }}>{fmt(track.duration_ms)}</div>
      {onQueue ? <button type="button" onClick={onQueue} title="Add to queue" aria-label={`Add ${track.name} to queue`} style={{ opacity: hover ? 1 : 0, border: "none", background: "transparent", color: TEXT_MUTED, cursor: "pointer", padding: 4, transition: "opacity .15s ease" }}><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 6h10M4 12h10M4 18h6M18 15v6M15 18h6" strokeLinecap="round" /></svg></button> : <span />}
    </div>
  );
}

function PlaylistRow({ playlist, onOpen, onPlay }: { playlist: SpotifyPlaylist; onOpen: () => void; onPlay: () => void }) {
  const [hover, setHover] = useState(false);
  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={onOpen}
      onDoubleClick={onPlay}
      onKeyDown={(event) => activateFromKeyboard(event, onOpen)}
      role="button"
      tabIndex={0}
      aria-label={`Open playlist ${playlist.name}`}
      style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 12px", borderRadius: R_MD, background: hover ? CARD_HOVER : "transparent", cursor: "pointer", transition: `background .15s ${EASE_STR}` }}
    >
      <Artwork src={playlist.images?.[0]?.url} size={48} iconSize={20} />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 14, fontWeight: 500, color: TEXT, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{playlist.name}</div>
        <div style={{ fontSize: 12.5, color: TEXT_MUTED }}>Playlist · {playlist.owner?.display_name || "Clyra Music"} · {playlist.tracks?.total ?? 0} songs</div>
      </div>
      <HoverPlayButton visible={hover} onPlay={onPlay} size={36} />
    </div>
  );
}

/** Collapsed icon-only playlist rail (matches Spotify's own collapsed
 *  sidebar) — the name only appears in a floating tooltip on hover. */
function SidebarPlaylistIcon({ playlist, active, onOpen }: { playlist: SpotifyPlaylist; active: boolean; onOpen: () => void }) {
  const [hover, setHover] = useState(false);
  const [tooltipPos, setTooltipPos] = useState<{ top: number; left: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement | null>(null);

  const handleEnter = () => {
    const r = btnRef.current?.getBoundingClientRect();
    if (r) setTooltipPos({ top: r.top + r.height / 2, left: r.right + 8 });
    setHover(true);
  };

  return (
    <div style={{ position: "relative" }} onMouseEnter={handleEnter} onMouseLeave={() => setHover(false)}>
      <motion.button
        ref={btnRef}
        type="button"
        onClick={onOpen}
        aria-label={playlist.name}
        whileHover={{ scale: 1.06 }}
        whileTap={{ scale: 0.92 }}
        transition={SPRING_TIGHT}
        style={{
          width: 40,
          height: 40,
          padding: 0,
          border: active ? `2px solid ${ACCENT}` : `1px solid ${CARD_BORDER}`,
          borderRadius: R_MD,
          overflow: "hidden",
          cursor: "pointer",
          background: "#EDEEF1",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {playlist.images?.[0]?.url ? (
          <img src={playlist.images[0].url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        ) : (
          <AlbumFallback size={18} />
        )}
      </motion.button>
      {createPortal(
        <AnimatePresence>
          {hover && tooltipPos ? (
            <motion.div
              initial={{ opacity: 0, scale: 0.92, x: -4 }}
              animate={{ opacity: 1, scale: 1, x: 0 }}
              exit={{ opacity: 0, scale: 0.96 }}
              transition={SPRING_TIGHT}
              style={{
                position: "fixed",
                top: tooltipPos.top,
                left: tooltipPos.left,
                transform: "translateY(-50%)",
                background: TEXT,
                color: "#fff",
                fontSize: 12,
                fontWeight: 600,
                padding: "5px 10px",
                borderRadius: R_MD,
                whiteSpace: "nowrap",
                zIndex: 1000,
                boxShadow: SHADOW_FLOATING,
                pointerEvents: "none",
              }}
            >
              {playlist.name}
            </motion.div>
          ) : null}
        </AnimatePresence>,
        document.body,
      )}
    </div>
  );
}

function QueueRow({ track, onPlay }: { track: SpotifyTrack; onPlay: () => void }) {
  const [hover, setHover] = useState(false);
  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={onPlay}
      onDoubleClick={onPlay}
      onKeyDown={(event) => activateFromKeyboard(event, onPlay)}
      role="button"
      tabIndex={0}
      aria-label={`Play ${track.name}`}
      style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 8px", borderRadius: R_MD, background: hover ? CARD_HOVER : "transparent", transition: `background .15s ${EASE_STR}`, cursor: "pointer" }}
    >
      <Artwork src={track.album?.images?.[track.album.images.length - 1]?.url || track.album?.images?.[0]?.url} size={40} iconSize={16} />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: TEXT, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{track.name}</div>
        <div style={{ fontSize: 11.5, color: TEXT_MUTED, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{track.artists.map((a) => a.name).join(", ")}</div>
      </div>
      <motion.button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onPlay();
        }}
        aria-label="Play"
        animate={{ opacity: hover ? 1 : 0 }}
        whileTap={{ scale: 0.85 }}
        transition={{ duration: 0.15 }}
        style={{ background: "none", border: "none", padding: 4, cursor: "pointer", color: TEXT }}
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
      </motion.button>
    </div>
  );
}

function NowPlayingDock({ playback, onClose }: { playback: SpotifyPlaybackHook; onClose: () => void }) {
  const { track, queue, playTrackUri, liked, toggleSaveTrack } = playback;

  return (
    <motion.aside
      className="clyra-music-now-playing"
      initial={{ width: 0, opacity: 0 }}
      animate={{ width: 300, opacity: 1 }}
      exit={{ width: 0, opacity: 0 }}
      transition={{ duration: 0.28, ease: EASE_ARRIVE }}
      style={{
        flexShrink: 0,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        borderLeft: `1px solid ${CARD_BORDER}`,
      }}
    >
      <div
        style={{
          width: 300,
          height: "100%",
          display: "flex",
          flexDirection: "column",
          gap: 16,
          padding: 16,
          background: SIDEBAR_BG,
          overflowY: "auto",
        }}
        className="clyra-composer-scroll"
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: TEXT }}>Now Playing</span>
          <motion.button
            type="button"
            onClick={onClose}
            aria-label="Hide now playing"
            whileHover={{ scale: 1.08 }}
            whileTap={{ scale: 0.9 }}
            style={{ background: "none", border: "none", cursor: "pointer", color: TEXT_MUTED, padding: 4, display: "flex" }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 6l12 12M18 6 6 18" strokeLinecap="round" /></svg>
          </motion.button>
        </div>

        <AnimatePresence mode="wait">
          {track ? (
            <motion.div
              key={track.id}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2, ease: EASE_ARRIVE }}
              style={{ display: "flex", flexDirection: "column", gap: 16 }}
            >
              <div style={{ width: "100%", aspectRatio: "1", borderRadius: R_LG, boxShadow: SHADOW_ELEVATED, overflow: "hidden" }}>
                <Artwork src={track.album?.images?.[0]?.url} size="100%" radius={0} iconSize={48} />
              </div>
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
                <div>
                <div style={{ fontSize: 16, fontWeight: 700, color: TEXT }}>{track.name}</div>
                <div style={{ fontSize: 13, color: TEXT_MUTED, marginTop: 2 }}>{track.artists.map((a) => a.name).join(", ")}</div>
                </div>
                <IconButton onClick={() => { void toggleSaveTrack(); }} title={liked ? "Remove from Your Library" : "Save to Your Library"} active={liked}>
                  <HeartIcon filled={liked} />
                </IconButton>
              </div>
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: TEXT_MUTED, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>Credits</div>
                {track.artists.map((a) => (
                  <div key={a.name} style={{ fontSize: 13, color: TEXT, padding: "4px 0" }}>{a.name}</div>
                ))}
              </div>
            </motion.div>
          ) : (
            <motion.div
              key="empty"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              style={{ fontSize: 13, color: TEXT_MUTED, padding: "24px 4px", textAlign: "center" }}
            >
              Nothing playing right now.
            </motion.div>
          )}
        </AnimatePresence>

        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: TEXT_MUTED, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>Next in queue</div>
          {queue.length === 0 ? (
            <div style={{ fontSize: 12.5, color: TEXT_FAINT, padding: "4px 0" }}>Your queue is empty.</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column" }}>
              {queue.slice(0, 8).map((t, i) => (
                <QueueRow key={`${t.id}-${i}`} track={t} onPlay={() => void playTrackUri(t.uri)} />
              ))}
            </div>
          )}
        </div>
      </div>
    </motion.aside>
  );
}

function ShuffleIcon({ active }: { active: boolean }) {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke={active ? ACCENT : "currentColor"} strokeWidth="2">
      <path d="m18 4 3 3-3 3M18 20l3-3-3-3" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M3 6h3.5c1.6 0 3 .9 3.8 2.3l3.4 5.9c.7 1.3 2.2 2.2 3.8 2.2H21M3 18h3.5c1.6 0 3-.9 3.8-2.3l.4-.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function RepeatIcon({ mode }: { mode: "off" | "track" | "context" }) {
  const active = mode !== "off";
  return (
    <div style={{ position: "relative", display: "flex" }}>
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke={active ? ACCENT : "currentColor"} strokeWidth="2">
        <path d="M17 2l4 4-4 4" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M3 11V9a4 4 0 0 1 4-4h14" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M7 22l-4-4 4-4" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M21 13v2a4 4 0 0 1-4 4H3" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      {mode === "track" ? (
        <span style={{ position: "absolute", right: -4, bottom: -4, fontSize: 8, fontWeight: 800, color: ACCENT, background: BG, borderRadius: "50%", width: 10, height: 10, display: "flex", alignItems: "center", justifyContent: "center", lineHeight: 1 }}>1</span>
      ) : null}
    </div>
  );
}

function HeartIcon({ filled = false }: { filled?: boolean }) {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2"><path d="M20.8 4.7a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.5 1-1a5.5 5.5 0 0 0 0-7.8Z" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

/** Small icon buttons on the transport bar all share this tight tap/hover feel. */
function IconButton({ children, onClick, title, active, style }: { children: ReactNode; onClick: (event: MouseEvent<HTMLButtonElement>) => void; title?: string; active?: boolean; style?: React.CSSProperties }) {
  return (
    <motion.button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      whileHover={{ scale: 1.1 }}
      whileTap={{ scale: 0.88 }}
      transition={SPRING_TIGHT}
      style={{ background: "none", border: "none", cursor: "pointer", color: active ? ACCENT : TEXT_MUTED, padding: 4, display: "flex", alignItems: "center", ...style }}
    >
      {children}
    </motion.button>
  );
}

function PlayerBar({ playback, queueOpen, onToggleQueue }: { playback: SpotifyPlaybackHook; queueOpen: boolean; onToggleQueue: () => void }) {
  const { track, isPlaying, progressMs, volume, pct, device, devices, onToggle, onPrev, onNext, seekTo, setVolumePercent, refreshDevices, transferToDevice, shuffleOn, toggleShuffle, repeatMode, cycleRepeat, liked, toggleSaveTrack, error } = playback;
  const [devicesOpen, setDevicesOpen] = useState(false);
  const [barHover, setBarHover] = useState(false);
  return (
    <div
      className="clyra-music-playerbar"
      style={{
        height: 90,
        flexShrink: 0,
        display: "grid",
        gridTemplateColumns: "1fr minmax(0,2fr) 1fr",
        alignItems: "center",
        gap: 16,
        padding: "0 16px",
        position: "relative",
        background: PANEL_BG,
        borderTop: `1px solid ${CARD_BORDER}`,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
        <AnimatePresence mode="wait">
          {track ? (
            <motion.div
              key={track.id}
              initial={{ opacity: 0, x: -6 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18, ease: EASE_ARRIVE }}
              style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}
            >
              <Artwork src={track.album?.images?.[track.album.images.length - 1]?.url || track.album?.images?.[0]?.url} size={56} iconSize={22} />
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13.5, fontWeight: 600, color: TEXT, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{track.name}</div>
                <div style={{ fontSize: 11.5, color: TEXT_MUTED, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{track.artists.map((a) => a.name).join(", ")}</div>
              </div>
              <IconButton onClick={() => { void toggleSaveTrack(); }} title={liked ? "Remove from Your Library" : "Save to Your Library"} active={liked}>
                <HeartIcon filled={liked} />
              </IconButton>
            </motion.div>
          ) : (
            <motion.div key="none" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} style={{ fontSize: 12.5, color: TEXT_MUTED }}>
              Nothing playing
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, width: "100%" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <IconButton onClick={toggleShuffle} title="Shuffle" active={shuffleOn}>
            <ShuffleIcon active={shuffleOn} />
          </IconButton>
          <IconButton onClick={onPrev} title="Previous track">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M6 6h2v12H6zM20 6 9 12l11 6z" /></svg>
          </IconButton>
          <motion.button
            type="button"
            onClick={onToggle}
            aria-label={isPlaying ? "Pause" : "Play"}
            whileHover={{ scale: 1.06 }}
            whileTap={{ scale: 0.88 }}
            transition={SPRING_TIGHT}
            style={{ width: 32, height: 32, borderRadius: "50%", background: TEXT, border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: SHADOW_ELEVATED }}
          >
            <AnimatePresence mode="wait" initial={false}>
              {isPlaying ? (
                <motion.svg key="pause" initial={{ opacity: 0, scale: 0.6 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.6 }} transition={{ duration: 0.12 }} width="14" height="14" viewBox="0 0 24 24" fill="#fff">
                  <rect x="6" y="5" width="4" height="14" /><rect x="14" y="5" width="4" height="14" />
                </motion.svg>
              ) : (
                <motion.svg key="play" initial={{ opacity: 0, scale: 0.6 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.6 }} transition={{ duration: 0.12 }} width="14" height="14" viewBox="0 0 24 24" fill="#fff" style={{ marginLeft: 2 }}>
                  <path d="M8 5v14l11-7z" />
                </motion.svg>
              )}
            </AnimatePresence>
          </motion.button>
          <IconButton onClick={onNext} title="Next track">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M16 6h2v12h-2zM4 6l11 6-11 6z" /></svg>
          </IconButton>
          <IconButton onClick={cycleRepeat} title="Repeat" active={repeatMode !== "off"}>
            <RepeatIcon mode={repeatMode} />
          </IconButton>
        </div>
        <div
          onMouseEnter={() => setBarHover(true)}
          onMouseLeave={() => setBarHover(false)}
          onFocus={() => setBarHover(true)}
          onBlur={() => setBarHover(false)}
          style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", maxWidth: 500 }}
        >
          <span style={{ fontSize: 11, color: TEXT_MUTED, minWidth: 32, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{track ? fmt(progressMs) : "0:00"}</span>
          <div style={{ position: "relative", flex: 1, height: 4, borderRadius: R_PILL, background: "#E4E4E2", cursor: track ? "pointer" : "default" }}>
            <div style={{ position: "absolute", left: 0, top: 0, height: "100%", borderRadius: R_PILL, background: barHover ? ACCENT : TEXT, width: `${track ? pct : 0}%`, transition: `width .2s linear, background .15s ${EASE_STR}` }} />
            <input
              type="range"
              min={0}
              max={track?.duration_ms || 0}
              value={track ? Math.min(progressMs, track.duration_ms) : 0}
              disabled={!track}
              onChange={(event) => seekTo(Number(event.target.value))}
              aria-label="Playback position"
              style={{ position: "absolute", inset: "-8px 0", width: "100%", height: 20, margin: 0, opacity: 0, cursor: track ? "pointer" : "default" }}
            />
            <div
              style={{
                position: "absolute",
                top: "50%",
                left: `${track ? pct : 0}%`,
                width: 12,
                height: 12,
                borderRadius: "50%",
                background: ACCENT,
                boxShadow: "0 1px 4px rgba(0,0,0,.3)",
                transform: `translate(-50%, -50%) scale(${barHover ? 1 : 0})`,
                transition: `transform .15s ${EASE_STR}, left .2s linear`,
              }}
            />
          </div>
          <span style={{ fontSize: 11, color: TEXT_MUTED, minWidth: 32, fontVariantNumeric: "tabular-nums" }}>{track ? fmt(track.duration_ms) : "0:00"}</span>
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 10, position: "relative" }}>
        <IconButton onClick={onToggleQueue} title="Now Playing" active={queueOpen}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 6h13M3 12h13M3 18h9" strokeLinecap="round" /><path d="M18 15v6M15 18h6" strokeLinecap="round" /></svg>
        </IconButton>
        <IconButton
          onClick={() => {
            setDevicesOpen((v) => !v);
            refreshDevices();
          }}
          title={device?.name || "Devices"}
          active={Boolean(device)}
          style={{ gap: 6 }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="4" y="4" width="16" height="12" rx="2" /><path d="M8 20h8M12 16v4" /></svg>
          <span style={{ fontSize: 11.5, maxWidth: 90, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{device?.name || "Devices"}</span>
        </IconButton>
        <AnimatePresence>
          {devicesOpen ? (
            <motion.div
              initial={{ opacity: 0, scale: 0.94, y: 6 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 4 }}
              transition={SPRING_TIGHT}
              style={{ transformOrigin: "bottom right", position: "absolute", bottom: 44, right: 0, width: 240, background: CARD_BG, border: `1px solid ${CARD_BORDER}`, borderRadius: R_XL, boxShadow: SHADOW_FLOATING, padding: 8, zIndex: 10 }}
            >
              <div style={{ fontSize: 11, fontWeight: 600, color: TEXT_MUTED, textTransform: "uppercase", letterSpacing: "0.05em", padding: "4px 8px" }}>Connect to a device</div>
              {devices.length === 0 ? (
                <div style={{ fontSize: 12.5, color: TEXT_MUTED, padding: "8px" }}>No devices found</div>
              ) : (
                devices.map((d) => (
                  <button
                    key={d.id}
                    type="button"
                    onClick={() => {
                      void transferToDevice(d.id);
                      setDevicesOpen(false);
                    }}
                    style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "8px", borderRadius: R_MD, border: "none", background: "transparent", color: d.is_active ? ACCENT : TEXT, cursor: "pointer", fontSize: 13, textAlign: "left", transition: `background .15s ${EASE_STR}` }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = ACCENT_TINT)}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                  >
                    {d.name} {d.is_active ? " (active)" : ""}
                  </button>
                ))
              )}
            </motion.div>
          ) : null}
        </AnimatePresence>
        <div title={`Volume ${volume}%`} style={{ position: "relative", width: 108, height: 4, borderRadius: R_PILL, background: "#E4E4E2", cursor: "pointer" }}>
          <div style={{ position: "absolute", left: 0, top: 0, height: "100%", borderRadius: R_PILL, background: TEXT, width: `${volume}%` }} />
          <input
            type="range"
            min={0}
            max={100}
            value={volume}
            onInput={(event) => setVolumePercent(Number((event.target as HTMLInputElement).value))}
            onChange={(event) => setVolumePercent(Number(event.target.value))}
            aria-label="Volume"
            style={{ position: "absolute", zIndex: 2, inset: "-8px 0", width: "100%", height: 20, margin: 0, opacity: 0, cursor: "pointer" }}
          />
          <span aria-hidden style={{ position: "absolute", zIndex: 1, top: "50%", left: `${volume}%`, width: 10, height: 10, borderRadius: "50%", background: TEXT, transform: "translate(-50%, -50%)", boxShadow: "0 1px 3px rgba(0,0,0,.22)", pointerEvents: "none" }} />
        </div>
      </div>
      {error ? <div role="alert" style={{ position: "absolute", right: 16, bottom: 94, maxWidth: 340, padding: "8px 10px", borderRadius: R_MD, background: "#FFF4F3", border: "1px solid rgba(179,38,30,.18)", color: DANGER, fontSize: 12, boxShadow: SHADOW_POPOVER }}>{error}</div> : null}
    </div>
  );
}

function ConnectScreen({ playback }: { playback: SpotifyPlaybackHook }) {
  const { available, connecting, connect, error } = playback;
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: EASE_ARRIVE }}
      style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16, background: BG, color: TEXT }}
    >
      <img src={MUSIC_ICON} alt="" style={{ width: 64, height: 64, borderRadius: R_XL, boxShadow: SHADOW_ELEVATED }} />
      {!available ? (
        <>
          <div style={{ fontSize: 20, fontWeight: 700 }}>Clyra Music is a desktop feature</div>
          <div style={{ fontSize: 13.5, color: TEXT_MUTED, maxWidth: 360, textAlign: "center" }}>Open Clyra's desktop app to browse and control music from here.</div>
        </>
      ) : (
        <>
          <div style={{ fontSize: 20, fontWeight: 700 }}>Welcome to Clyra Music</div>
          <div style={{ fontSize: 13.5, color: TEXT_MUTED, maxWidth: 360, textAlign: "center" }}>
            Sign in to browse your playlists, search, and control playback right here.
          </div>
          {error ? <div style={{ fontSize: 12.5, color: DANGER }}>{error}</div> : null}
          <motion.button
            type="button"
            onClick={connect}
            disabled={connecting}
            whileHover={connecting ? undefined : { scale: 1.03 }}
            whileTap={connecting ? undefined : { scale: 0.97 }}
            transition={SPRING_TIGHT}
            style={{ height: 44, padding: "0 28px", borderRadius: R_PILL, border: "none", background: ACCENT, color: "#fff", fontWeight: 700, fontSize: 14, cursor: connecting ? "default" : "pointer", opacity: connecting ? 0.7 : 1, boxShadow: `0 10px 24px -6px ${ACCENT_GLOW}` }}
          >
            {connecting ? "Connecting…" : "Connect Spotify"}
          </motion.button>
        </>
      )}
    </motion.div>
  );
}

function PlaylistDetailView({ playlist, playback }: { playlist: SpotifyPlaylist; playback: SpotifyPlaybackHook }) {
  const { getPlaylistTracks, playPlaylistUri, playTrackUri, addToQueue, track: nowPlaying } = playback;
  const [items, setItems] = useState<SpotifyPlaylistItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setItems(null);
    setError(null);
    void getPlaylistTracks(playlist.id).then((res) => {
      if (cancelled) return;
      if (res.ok) setItems(res.items ?? []);
      else setError(res.error || "Couldn't load this playlist.");
    });
    return () => {
      cancelled = true;
    };
  }, [playlist.id, getPlaylistTracks]);

  const totalMs = useMemo(() => (items ?? []).reduce((sum, it) => sum + (it.track?.duration_ms || 0), 0), [items]);

  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 24, padding: "8px 0 24px" }}>
        <div style={{ width: 200, height: 200, flexShrink: 0, borderRadius: R_LG, boxShadow: SHADOW_FLOATING, overflow: "hidden" }}>
          <Artwork src={playlist.images?.[0]?.url} size="100%" radius={0} iconSize={56} />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: TEXT_MUTED }}>Playlist</span>
          <h1 style={{ fontSize: 40, fontWeight: 800, color: TEXT, margin: 0, lineHeight: 1.1, wordBreak: "break-word" }}>{playlist.name}</h1>
          <div style={{ fontSize: 13.5, color: TEXT_MUTED }}>
            <span style={{ fontWeight: 700, color: TEXT }}>{playlist.owner?.display_name || "Clyra Music"}</span>
            {items ? <> · {items.length} songs{totalMs > 0 ? <>, {fmtDuration(totalMs)}</> : null}</> : null}
          </div>
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 20, padding: "8px 0 20px" }}>
        <motion.button
          type="button"
          onClick={() => void playPlaylistUri(playlist.uri)}
          aria-label="Play"
          whileHover={{ scale: 1.06 }}
          whileTap={{ scale: 0.92 }}
          transition={SPRING_TIGHT}
          style={{ width: 56, height: 56, borderRadius: "50%", border: "none", background: ACCENT, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: `0 10px 24px -4px ${ACCENT_GLOW}` }}
          onMouseEnter={(e) => (e.currentTarget.style.background = ACCENT_HOVER)}
          onMouseLeave={(e) => (e.currentTarget.style.background = ACCENT)}
        >
          <PlayGlyph size={22} />
        </motion.button>
      </div>

      {error ? (
        <div style={{ color: DANGER, fontSize: 13.5, padding: "12px 0" }}>{error}</div>
      ) : items === null ? (
        <div style={{ color: TEXT_MUTED, fontSize: 13.5, padding: "12px 0" }}>Loading songs…</div>
      ) : items.length === 0 ? (
        <div style={{ color: TEXT_MUTED, fontSize: 13.5, padding: "12px 0" }}>This playlist has no songs yet.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ display: "grid", gridTemplateColumns: "28px 1fr 1fr 110px 56px", gap: 14, padding: "0 10px 8px", borderBottom: `1px solid ${CARD_BORDER}`, marginBottom: 6 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: TEXT_MUTED }}>#</span>
            <span style={{ fontSize: 11, fontWeight: 700, color: TEXT_MUTED, textTransform: "uppercase", letterSpacing: "0.05em" }}>Title</span>
            <span style={{ fontSize: 11, fontWeight: 700, color: TEXT_MUTED, textTransform: "uppercase", letterSpacing: "0.05em" }}>Album</span>
            <span style={{ fontSize: 11, fontWeight: 700, color: TEXT_MUTED, textTransform: "uppercase", letterSpacing: "0.05em" }}>Date added</span>
            <span />
          </div>
          {items.map((item, i) => (
            <PlaylistTrackRow
              key={`${item.track.id}-${i}`}
              item={item}
              index={i}
              playing={nowPlaying?.id === item.track.id}
              onPlay={() => void playTrackUri(item.track.uri)}
              onQueue={() => void addToQueue(item.track.uri)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

const EASE_STR = "cubic-bezier(.22,1,.36,1)";

export function SpotifyWorkspace({ playback }: { playback: SpotifyPlaybackHook }) {
  const [history, setHistory] = useState<ViewEntry[]>([{ type: "home" }]);
  const [historyIndex, setHistoryIndex] = useState(0);
  const view = history[historyIndex];
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<{ tracks: SpotifyTrack[]; playlists: SpotifyPlaylist[] }>({ tracks: [], playlists: [] });
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [queueOpen, setQueueOpen] = useState(true);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [searchFocused, setSearchFocused] = useState(false);
  const [libraryCollapsed, setLibraryCollapsed] = useState(false);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const searchRequestRef = useRef(0);

  const { connected, profile, playlists, refreshPlaylists, recentTracks, savedTracks, playPlaylistUri, playTrackUri, addToQueue, search, track, disconnect, isPlaying, pause, resume } = playback;

  const canGoBack = historyIndex > 0;
  const canGoForward = historyIndex < history.length - 1;
  const goTo = (next: ViewEntry) => {
    if (viewKey(next) === viewKey(view)) return;
    setHistory((h) => [...h.slice(0, historyIndex + 1), next]);
    setHistoryIndex((i) => i + 1);
  };
  const openPlaylist = (playlist: SpotifyPlaylist) => goTo({ type: "playlist", playlist });
  const goBack = () => setHistoryIndex((i) => Math.max(0, i - 1));
  const goForward = () => setHistoryIndex((i) => Math.min(history.length - 1, i + 1));

  useEffect(() => {
    if (connected) refreshPlaylists();
  }, [connected, refreshPlaylists]);

  useEffect(() => {
    if (view.type !== "search" || !query.trim()) {
      searchRequestRef.current += 1;
      setResults({ tracks: [], playlists: [] });
      setSearching(false);
      setSearchError(null);
      return;
    }
    const request = ++searchRequestRef.current;
    let cancelled = false;
    setSearching(true);
    setSearchError(null);
    const id = window.setTimeout(async () => {
      try {
        const res = await search(query.trim());
        if (cancelled || request !== searchRequestRef.current) return;
        if (!res.ok) {
          setResults({ tracks: [], playlists: [] });
          setSearchError(res.error || "Search is temporarily unavailable.");
        } else {
          setResults({ tracks: res.tracks ?? [], playlists: res.playlists ?? [] });
        }
      } catch {
        if (cancelled || request !== searchRequestRef.current) return;
        setResults({ tracks: [], playlists: [] });
        setSearchError("Search is temporarily unavailable.");
      } finally {
        if (!cancelled && request === searchRequestRef.current) setSearching(false);
      }
    }, 350);
    return () => {
      cancelled = true;
      window.clearTimeout(id);
    };
  }, [query, view.type, search]);

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const editing = Boolean(target?.closest("input, textarea, [contenteditable='true']"));
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        goTo({ type: "search" });
        window.setTimeout(() => searchInputRef.current?.focus(), 0);
        return;
      }
      if (event.key === "Escape" && document.activeElement === searchInputRef.current && query) {
        event.preventDefault();
        setQuery("");
        return;
      }
      if (event.key === " " && !editing) {
        event.preventDefault();
        void (isPlaying ? pause() : resume());
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isPlaying, pause, query, resume]);

  const quickPicks = useMemo(() => playlists.slice(0, 6), [playlists]);

  if (!playback.available || !playback.connected) {
    return (
      <div className="clyra-music-workspace" style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0, background: BG, fontFamily: FONT }}>
        <ConnectScreen playback={playback} />
      </div>
    );
  }

  return (
    <div className="clyra-music-workspace" style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0, background: BG, fontFamily: FONT }}>
      {/* Top bar — back/forward history + persistent search, like Spotify's own chrome */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, height: 64, flexShrink: 0, padding: "0 16px", background: SIDEBAR_BG, borderBottom: `1px solid ${CARD_BORDER}` }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <motion.button
            type="button"
            onClick={goBack}
            disabled={!canGoBack}
            whileHover={canGoBack ? { scale: 1.08 } : undefined}
            whileTap={canGoBack ? { scale: 0.9 } : undefined}
            transition={SPRING_TIGHT}
            style={{ width: 30, height: 30, borderRadius: "50%", border: "none", background: CARD_BG, color: canGoBack ? TEXT : TEXT_FAINT, cursor: canGoBack ? "pointer" : "default", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: SHADOW_ELEVATED }}
          >
            <ChevronIcon dir="back" />
          </motion.button>
          <motion.button
            type="button"
            onClick={goForward}
            disabled={!canGoForward}
            whileHover={canGoForward ? { scale: 1.08 } : undefined}
            whileTap={canGoForward ? { scale: 0.9 } : undefined}
            transition={SPRING_TIGHT}
            style={{ width: 30, height: 30, borderRadius: "50%", border: "none", background: CARD_BG, color: canGoForward ? TEXT : TEXT_FAINT, cursor: canGoForward ? "pointer" : "default", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: SHADOW_ELEVATED }}
          >
            <ChevronIcon dir="forward" />
          </motion.button>
        </div>

        <div style={{ position: "relative", width: "100%", maxWidth: 420 }}>
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke={TEXT_MUTED} strokeWidth="2" style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)" }}>
            <circle cx="11" cy="11" r="7" />
            <path d="m21 21-4.3-4.3" strokeLinecap="round" />
          </svg>
          <input
            ref={searchInputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              if (e.target.value.trim()) goTo({ type: "search" });
            }}
            onFocus={() => {
              goTo({ type: "search" });
              setSearchFocused(true);
            }}
            onBlur={() => setSearchFocused(false)}
            placeholder="What do you want to play?"
            style={{
              width: "100%",
              height: 42,
              padding: "0 36px 0 40px",
              borderRadius: R_PILL,
              border: `1px solid ${searchFocused ? ACCENT : CARD_BORDER}`,
              background: CARD_BG,
              color: TEXT,
              fontSize: 14,
              outline: "none",
              boxSizing: "border-box",
              boxShadow: searchFocused ? `0 0 0 4px ${FOCUS_RING}` : "none",
              transition: `box-shadow .18s ${EASE_STR}, border-color .18s ${EASE_STR}`,
            }}
          />
          {query ? (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label="Clear search"
              style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", background: "#E4E4E2", border: "none", borderRadius: "50%", width: 20, height: 20, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: TEXT }}
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M6 6l12 12M18 6 6 18" strokeLinecap="round" /></svg>
            </button>
          ) : null}
        </div>

        <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
          <motion.button
            type="button"
            onClick={() => setProfileMenuOpen((v) => !v)}
            whileHover={{ scale: 1.06 }}
            whileTap={{ scale: 0.94 }}
            transition={SPRING_TIGHT}
            style={{ width: 32, height: 32, borderRadius: "50%", border: "none", cursor: "pointer", background: ACCENT, color: "#fff", fontSize: 12, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }}
          >
            {profile?.image ? <img src={profile.image} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : initials(profile?.displayName || "Music")}
          </motion.button>
          <AnimatePresence>
            {profileMenuOpen ? (
              <motion.div
                initial={{ opacity: 0, scale: 0.94, y: -4 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.96, y: -2 }}
                transition={SPRING_TIGHT}
                style={{ transformOrigin: "top right", position: "absolute", top: 40, right: 0, minWidth: 200, background: CARD_BG, border: `1px solid ${CARD_BORDER}`, borderRadius: R_XL, boxShadow: SHADOW_FLOATING, padding: 8, zIndex: 20 }}
              >
                <div style={{ padding: "6px 10px", fontSize: 13, fontWeight: 700, color: TEXT, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{profile?.displayName || "Music account"}</div>
                <button
                  type="button"
                  onClick={() => {
                    setProfileMenuOpen(false);
                    disconnect();
                  }}
                  style={{ display: "block", width: "100%", textAlign: "left", padding: "8px 10px", borderRadius: R_MD, border: "none", background: "transparent", color: TEXT, fontSize: 13, cursor: "pointer", transition: `background .15s ${EASE_STR}` }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = ACCENT_TINT)}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                >
                  Log out of Spotify
                </button>
              </motion.div>
            ) : null}
          </AnimatePresence>
        </div>
      </div>

      <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
        {/* Sidebar */}
        <nav className="clyra-music-sidebar" style={{ width: libraryCollapsed ? 68 : 232, flexShrink: 0, display: "flex", flexDirection: "column", gap: 8, padding: 12, background: SIDEBAR_BG, borderRight: `1px solid ${CARD_BORDER}`, transition: `width .22s ${EASE_STR}` }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: libraryCollapsed ? "center" : "space-between", gap: 10, padding: "4px 6px 8px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
            <img src={MUSIC_ICON} alt="" style={{ width: 28, height: 28, borderRadius: R_SM }} />
            {!libraryCollapsed ? <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 750, color: TEXT, letterSpacing: "-0.015em" }}>Clyra Music</div>
              <div style={{ fontSize: 11.5, color: TEXT_MUTED }}>Your listening space</div>
            </div> : null}
            </div>
            <button type="button" onClick={() => setLibraryCollapsed((value) => !value)} title={libraryCollapsed ? "Expand Your Library" : "Collapse Your Library"} aria-label={libraryCollapsed ? "Expand Your Library" : "Collapse Your Library"} style={{ border: "none", background: "transparent", color: TEXT_MUTED, cursor: "pointer", padding: 4, display: "flex" }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d={libraryCollapsed ? "m9 18 6-6-6-6" : "m15 18-6-6 6-6"} strokeLinecap="round" strokeLinejoin="round" /></svg>
            </button>
          </div>
          <div style={{ background: CARD_BG, border: `1px solid ${CARD_BORDER}`, borderRadius: R_LG, padding: 6, display: "flex", flexDirection: "column", gap: 2 }}>
            {NAV_ITEMS.map((item) => {
              const active = view.type === item.id;
              return (
                <motion.button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    goTo({ type: item.id } as ViewEntry);
                    if (item.id === "search") window.setTimeout(() => searchInputRef.current?.focus(), 50);
                  }}
                  whileTap={{ scale: 0.97 }}
                  transition={SPRING_TIGHT}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: libraryCollapsed ? "center" : undefined,
                    gap: libraryCollapsed ? 0 : 14,
                    padding: libraryCollapsed ? "10px" : "10px 12px",
                    borderRadius: R_MD,
                    border: "none",
                    background: active ? ACCENT_TINT : "transparent",
                    color: active ? TEXT : TEXT_MUTED,
                    fontSize: 14,
                    fontWeight: 700,
                    cursor: "pointer",
                    textAlign: libraryCollapsed ? "center" : "left",
                    transition: `background .15s ${EASE_STR}, color .15s ${EASE_STR}`,
                  }}
                >
                  <span title={libraryCollapsed ? item.label : undefined} style={{ display: "flex" }}>{item.icon(active)}</span>
                  {!libraryCollapsed ? item.label : null}
                </motion.button>
              );
            })}
          </div>
          {!libraryCollapsed ? <div style={{ fontSize: 11, fontWeight: 700, color: TEXT_MUTED, textTransform: "uppercase", letterSpacing: "0.05em", padding: "6px 10px 2px" }}>Playlists</div> : null}
          <div style={{ flex: 1, minHeight: 0, overflowY: "auto", overflowX: "visible", background: CARD_BG, border: `1px solid ${CARD_BORDER}`, borderRadius: R_LG, padding: 8, display: "flex", flexDirection: "column", gap: 8 }} className="clyra-composer-scroll">
            {playlists.map((p) => (
              <SidebarPlaylistIcon
                key={p.id}
                playlist={p}
                active={view.type === "playlist" && view.playlist.id === p.id}
                onOpen={() => openPlaylist(p)}
              />
            ))}
            {playlists.length === 0 ? <div style={{ fontSize: 12, color: TEXT_FAINT, padding: "4px 2px" }}>No playlists</div> : null}
          </div>
        </nav>

        {/* Main content */}
        <main className="clyra-composer-scroll clyra-music-content" style={{ flex: 1, minWidth: 0, overflowY: "auto", overflowX: "hidden", padding: "20px 28px 32px", background: BG }}>
          <AnimatePresence mode="wait">
            <motion.div
              key={view.type === "playlist" ? viewKey(view) : view.type}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.22, ease: EASE_ARRIVE }}
            >
              {view.type === "home" ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
                  <h1 style={{ fontSize: 26, fontWeight: 800, color: TEXT, margin: 0 }}>{greeting()}</h1>
                  {recentTracks.length > 0 ? (
                    <div>
                      <h2 style={{ fontSize: 18, fontWeight: 700, color: TEXT, margin: "0 0 10px" }}>Recently played</h2>
                      <div style={{ display: "flex", flexDirection: "column", maxWidth: 720 }}>
                        {recentTracks.slice(0, 6).map((item, index) => <TrackRow key={`${item.id}-${index}`} track={item} index={index} playing={track?.id === item.id} onPlay={() => void playTrackUri(item.uri)} onQueue={() => void addToQueue(item.uri)} />)}
                      </div>
                    </div>
                  ) : null}
                  {quickPicks.length > 0 ? (
                    <div>
                      <h2 style={{ fontSize: 18, fontWeight: 700, color: TEXT, margin: "0 0 14px" }}>Quick picks</h2>
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 12 }}>
                        {quickPicks.map((p) => (
                          <QuickTile key={p.id} playlist={p} onOpen={() => openPlaylist(p)} onPlay={() => void playPlaylistUri(p.uri)} />
                        ))}
                      </div>
                    </div>
                  ) : null}
                  <div>
                    <h2 style={{ fontSize: 20, fontWeight: 700, color: TEXT, margin: "0 0 14px" }}>Your playlists</h2>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 16 }}>
                      {playlists.map((p) => (
                        <PlaylistCard key={p.id} playlist={p} onOpen={() => openPlaylist(p)} onPlay={() => void playPlaylistUri(p.uri)} />
                      ))}
                      {playlists.length === 0 ? <div style={{ color: TEXT_MUTED, fontSize: 13.5 }}>No playlists found.</div> : null}
                    </div>
                  </div>
                </div>
              ) : view.type === "search" ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
                  {!query.trim() ? (
                    <div style={{ color: TEXT_MUTED, fontSize: 13.5 }}>Search for songs, artists, or playlists.</div>
                  ) : searching ? (
                    <div style={{ color: TEXT_MUTED, fontSize: 13 }}>Searching…</div>
                  ) : null}
                  {searchError ? <div role="alert" style={{ color: DANGER, fontSize: 13.5 }}>{searchError}</div> : null}
                  {results.tracks.length > 0 ? (
                    <div>
                      <h2 style={{ fontSize: 18, fontWeight: 700, color: TEXT, margin: "0 0 10px" }}>Songs</h2>
                      <div style={{ display: "flex", flexDirection: "column" }}>
                        {results.tracks.map((t, i) => (
                          <TrackRow key={t.id} track={t} index={i} playing={track?.id === t.id} onPlay={() => void playTrackUri(t.uri)} onQueue={() => void addToQueue(t.uri)} />
                        ))}
                      </div>
                    </div>
                  ) : null}
                  {results.playlists.length > 0 ? (
                    <div>
                      <h2 style={{ fontSize: 18, fontWeight: 700, color: TEXT, margin: "0 0 10px" }}>Playlists</h2>
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 16 }}>
                        {results.playlists.map((p) => (
                          <PlaylistCard key={p.id} playlist={p} onOpen={() => openPlaylist(p)} onPlay={() => void playPlaylistUri(p.uri)} />
                        ))}
                      </div>
                    </div>
                  ) : null}
                  {!searching && !searchError && query.trim() && results.tracks.length === 0 && results.playlists.length === 0 ? (
                    <div style={{ color: TEXT_MUTED, fontSize: 13.5 }}>No results for "{query.trim()}".</div>
                  ) : null}
                </div>
              ) : view.type === "library" ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
                  <h1 style={{ fontSize: 26, fontWeight: 800, color: TEXT, margin: "0 0 16px" }}>Your Library</h1>
                  {savedTracks.length > 0 ? <div><h2 style={{ fontSize: 18, fontWeight: 700, color: TEXT, margin: "0 0 10px" }}>Liked Songs</h2>{savedTracks.map((item, index) => <TrackRow key={item.id} track={item} index={index} playing={track?.id === item.id} onPlay={() => void playTrackUri(item.uri)} onQueue={() => void addToQueue(item.uri)} />)}</div> : null}
                  <div>
                    <h2 style={{ fontSize: 18, fontWeight: 700, color: TEXT, margin: "0 0 10px" }}>Playlists</h2>
                    {playlists.map((p) => <PlaylistRow key={p.id} playlist={p} onOpen={() => openPlaylist(p)} onPlay={() => void playPlaylistUri(p.uri)} />)}
                    {playlists.length === 0 && savedTracks.length === 0 ? <div style={{ color: TEXT_MUTED, fontSize: 13.5 }}>No saved music or playlists yet.</div> : null}
                  </div>
                </div>
              ) : (
                <PlaylistDetailView playlist={view.playlist} playback={playback} />
              )}
            </motion.div>
          </AnimatePresence>
        </main>

        <AnimatePresence>{queueOpen ? <NowPlayingDock playback={playback} onClose={() => setQueueOpen(false)} /> : null}</AnimatePresence>
      </div>

      <PlayerBar playback={playback} queueOpen={queueOpen} onToggleQueue={() => setQueueOpen((v) => !v)} />
    </div>
  );
}
