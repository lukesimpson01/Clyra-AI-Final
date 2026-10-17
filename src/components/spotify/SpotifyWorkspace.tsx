/**
 * Clyra Music — a full Spotify-layout client (Home, Search & Browse, Your
 * Library, playlists, albums, artists, lyrics, queue, full-screen player)
 * living inside Clyra. It runs on the same `useSpotifyPlayback` hook, and
 * therefore the same Spotify connection, as the ambient notch.
 *
 * Layout, spacing and behaviour follow Spotify's desktop app; the palette is
 * the requested inversion (green → blue, black → white). All styling lives in
 * spotify.css; the views are in views.tsx, shared pieces in lists.tsx / ui.tsx
 * and the menu/toast/liked-cache plumbing in ctx.tsx.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { SpotifyPlaybackHook } from "../chat/SpotifyNotch";
import type { SpotifyAlbum, SpotifyArtist, SpotifyPlaylist, SpotifyTrack } from "../../lib/electron-runtime";
import { NewPlaylistDialog, SpProvider, useLikedCache, useMenuHost, useSp, useToastHost, viewKey, type MenuItem, type SpContext, type ViewEntry } from "./ctx";
import { AlbumPage, ArtistPage, HomeView, LibraryView, LikedPage, LyricsView, PageWash, PlaylistPage, SearchView, activeLyricIndexFor, centerLyric, copyLink, useArtworkTint, useTrackLyrics, type HomeFilter, type SearchTab } from "./views";
import { mergeContextRecency, playlistIdFromUri, readPlaylistRecency, sortPlaylistsByRecency, writePlaylistRecency } from "./music-state";
import { Artwork, Icon, IconBtn, LikedArt, MusicMark, PlayBtn, activateOnKey, bigImage, fmt, initials, midImage, type IconName } from "./ui";
import "./spotify.css";

/* ── Persistent UI prefs ─────────────────────────────────────────────────── */

const PREFS_KEY = "clyra-music-ui-v2";
type Prefs = { libCollapsed: boolean; libWidth: number; libView: "list" | "compact" | "grid"; libSort: "recents" | "alpha" | "creator"; right: "now" | "queue" | null };
const DEFAULT_PREFS: Prefs = { libCollapsed: false, libWidth: 320, libView: "list", libSort: "recents", right: null };

function readPrefs(): Prefs {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(PREFS_KEY) || "{}") as Partial<Prefs>;
    return {
      libCollapsed: Boolean(parsed.libCollapsed),
      libWidth: Math.min(480, Math.max(260, Number(parsed.libWidth) || DEFAULT_PREFS.libWidth)),
      libView: parsed.libView === "compact" || parsed.libView === "grid" ? parsed.libView : "list",
      libSort: parsed.libSort === "alpha" || parsed.libSort === "creator" ? parsed.libSort : "recents",
      right: parsed.right === "now" || parsed.right === "queue" ? parsed.right : null,
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

/* ── Slider (progress + volume) ──────────────────────────────────────────── */

function Slider({ value, max, label, disabled, onPreview, onCommit, step = 1, className = "" }: { value: number; max: number; label: string; disabled?: boolean; onPreview?: (value: number) => void; onCommit: (value: number) => void; step?: number; className?: string }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [drag, setDrag] = useState<number | null>(null);
  const shown = drag ?? value;
  const pct = max > 0 ? Math.max(0, Math.min(100, (shown / max) * 100)) : 0;
  const read = (event: { clientX: number }) => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0) return 0;
    return Math.round(Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)) * max);
  };
  const down = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (disabled || max <= 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const next = read(event);
    setDrag(next);
    onPreview?.(next);
  };
  const move = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (drag === null) return;
    const next = read(event);
    setDrag(next);
    onPreview?.(next);
  };
  const up = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (drag === null) return;
    const next = read(event);
    setDrag(null);
    onCommit(next);
  };
  return (
    <div
      ref={ref}
      className={`sp-slider ${drag !== null ? "is-drag" : ""} ${disabled ? "is-off" : ""} ${className}`}
      style={{ ["--pct" as string]: `${pct}%` }}
      role="slider"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={Math.round(shown)}
      aria-disabled={disabled}
      tabIndex={disabled ? -1 : 0}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={() => setDrag(null)}
      onKeyDown={(event) => {
        if (disabled) return;
        const delta = event.key === "ArrowRight" || event.key === "ArrowUp" ? step : event.key === "ArrowLeft" || event.key === "ArrowDown" ? -step : 0;
        if (!delta) return;
        event.preventDefault();
        event.stopPropagation();
        onCommit(Math.max(0, Math.min(max, value + delta)));
      }}
    >
      <div className="sp-slider__track"><div className="sp-slider__fill" /></div>
      <div className="sp-slider__thumb" />
    </div>
  );
}

/* ── Player bar ──────────────────────────────────────────────────────────── */

function ArtistLinks({ track }: { track: SpotifyTrack }) {
  const { openArtist } = useSp();
  return (
    <>
      {track.artists.map((artist, index) => (
        <span key={`${artist.name}-${index}`}>{index > 0 ? ", " : ""}<span className="sp-link" onClick={() => openArtist(artist)}>{artist.name}</span></span>
      ))}
    </>
  );
}

function PlayerBar({ rightPanel, onRight, onExpand, lyricsOpen, onLyrics }: { rightPanel: Prefs["right"]; onRight: (mode: "now" | "queue") => void; onExpand: () => void; lyricsOpen: boolean; onLyrics: () => void }) {
  const { playback, openAlbum, isLiked, toggleLike, toast } = useSp();
  const { track, isPlaying, progressMs, volume, device, devices, onPrev, onNext, seekTo, setVolumePercent, refreshDevices, transferToDevice, shuffleOn, toggleShuffle, repeatMode, cycleRepeat, error, startingDevice } = playback;
  const [devicesOpen, setDevicesOpen] = useState(false);
  const [restore, setRestore] = useState<number | null>(null);
  const [scrub, setScrub] = useState<number | null>(null);
  const liked = track ? isLiked(track) : false;

  useEffect(() => {
    if (!devicesOpen) return;
    const close = (event: MouseEvent) => { if (!(event.target as HTMLElement | null)?.closest(".sp-device-pop, .sp-device-toggle")) setDevicesOpen(false); };
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [devicesOpen]);

  const volumeIcon: IconName = volume === 0 ? "volume0" : volume < 40 ? "volume1" : "volume2";
  return (
    <footer className="sp-player" aria-label="Player">
      <div className="sp-player__left">
        {track ? (
          <>
            <div className="sp-player__art">
              <button type="button" aria-label="Open full screen player" onClick={onExpand} style={{ width: "100%", height: "100%", display: "block" }}>
                <Artwork src={midImage(track.album?.images)} eager />
              </button>
              <span className="sp-player__expand" aria-hidden><Icon name="expand" size={12} /></span>
            </div>
            <div className="sp-player__text">
              <div className="sp-player__name sp-ellipsis"><span className="sp-link" onClick={() => openAlbum(track.album, track)}>{track.name}</span></div>
              <div className="sp-player__artist sp-ellipsis"><ArtistLinks track={track} /></div>
            </div>
            <button
              type="button"
              className={`sp-ctl ${liked ? "" : ""}`}
              style={liked ? { color: "var(--sp-accent)" } : undefined}
              aria-label={liked ? "Remove from Liked Songs" : "Save to Liked Songs"}
              aria-pressed={liked}
              onClick={() => { toggleLike(track); toast(liked ? "Removed from Liked Songs" : "Added to Liked Songs"); }}
            >
              <Icon name={liked ? "checkCircle" : "plusCircle"} size={18} />
            </button>
          </>
        ) : (
          <div style={{ fontSize: 13, color: "var(--sp-sub)" }}>{startingDevice ? "Opening Spotify…" : "Pick something to play"}</div>
        )}
      </div>

      <div className="sp-player__mid">
        <div className="sp-player__btns">
          <button type="button" className={`sp-ctl ${shuffleOn ? "is-on" : ""}`} aria-label="Shuffle" aria-pressed={shuffleOn} onClick={toggleShuffle}><Icon name="shuffle" size={18} /></button>
          <button type="button" className="sp-ctl" aria-label="Previous" onClick={onPrev}><Icon name="prev" size={20} /></button>
          <button type="button" className="sp-playpause" aria-label={isPlaying ? "Pause" : "Play"} onClick={playback.onToggle}>
            {startingDevice ? <span className="sp-spin" /> : <Icon name={isPlaying ? "pause" : "play"} size={16} />}
          </button>
          <button type="button" className="sp-ctl" aria-label="Next" onClick={onNext}><Icon name="next" size={20} /></button>
          <button type="button" className={`sp-ctl ${repeatMode !== "off" ? "is-on" : ""}`} aria-label={repeatMode === "track" ? "Repeat one" : repeatMode === "context" ? "Repeat all" : "Repeat"} aria-pressed={repeatMode !== "off"} onClick={cycleRepeat}><Icon name={repeatMode === "track" ? "repeat1" : "repeat"} size={18} /></button>
        </div>
        <div className="sp-player__bar">
          <span className="sp-time sp-time--l">{track ? fmt(scrub ?? progressMs) : "0:00"}</span>
          <Slider label="Playback position" value={track ? Math.min(progressMs, track.duration_ms) : 0} max={track?.duration_ms ?? 0} disabled={!track} step={5000} onPreview={setScrub} onCommit={(next) => { setScrub(null); seekTo(next); }} />
          <span className="sp-time">{track ? fmt(track.duration_ms) : "0:00"}</span>
        </div>
      </div>

      <div className="sp-player__right">
        <button type="button" className={`sp-ctl ${rightPanel === "now" ? "is-on" : ""}`} aria-label="Now playing view" aria-pressed={rightPanel === "now"} onClick={() => onRight("now")}><Icon name="nowPlaying" size={16} /></button>
        <button type="button" className={`sp-ctl ${lyricsOpen ? "is-on" : ""}`} aria-label="Lyrics" aria-pressed={lyricsOpen} onClick={onLyrics}><Icon name="lyrics" size={16} /></button>
        <button type="button" className={`sp-ctl ${rightPanel === "queue" ? "is-on" : ""}`} aria-label="Queue" aria-pressed={rightPanel === "queue"} onClick={() => onRight("queue")}><Icon name="queue" size={16} /></button>
        <button type="button" className={`sp-ctl sp-device-toggle ${device ? "is-on" : ""}`} aria-label="Connect to a device" aria-expanded={devicesOpen} onClick={() => { setDevicesOpen((value) => !value); refreshDevices(); }}><Icon name="device" size={16} /></button>
        <button
          type="button"
          className="sp-ctl"
          aria-label={volume > 0 ? "Mute" : "Unmute"}
          onClick={() => {
            if (volume > 0) { setRestore(volume); setVolumePercent(0); } else { setVolumePercent(restore || 50); setRestore(null); }
          }}
        >
          <Icon name={volumeIcon} size={16} />
        </button>
        <Slider className="sp-player__vol" label="Volume" value={volume} max={100} step={5} onPreview={setVolumePercent} onCommit={setVolumePercent} />
        <button type="button" className="sp-ctl" aria-label="Full screen" onClick={onExpand} disabled={!track}><Icon name="expand" size={16} /></button>
        {devicesOpen ? (
          <div className="sp-device-pop" role="dialog" aria-label="Connect to a device">
            <h3>Connect to a device</h3>
            {devices.length === 0 ? <div style={{ padding: 8, color: "var(--sp-sub)" }}>No devices found. Open Spotify on a phone or computer.</div> : devices.map((item) => (
              <button key={item.id} type="button" className={`sp-device ${item.is_active ? "is-active" : ""}`} onClick={() => { void transferToDevice(item.id); setDevicesOpen(false); }}>
                <Icon name={/phone|smartphone/i.test(item.type) ? "user" : "device"} size={20} />
                <span><span style={{ fontWeight: 600 }}>{item.name}</span><small>{item.is_active ? "Listening on this device" : item.type}</small></span>
              </button>
            ))}
          </div>
        ) : null}
      </div>
      {error ? <div role="alert" className="sp-error">{error}</div> : null}
    </footer>
  );
}

/* ── Right panel: Now playing / Queue ────────────────────────────────────── */

const artistCache = new Map<string, SpotifyArtist>();

function NowPlayingPanel({ mode, onMode, onClose, onExpand, onLyrics }: { mode: "now" | "queue"; onMode: (mode: "now" | "queue") => void; onClose: () => void; onExpand: () => void; onLyrics: () => void }) {
  const { playback, openAlbum, openArtist, isLiked, toggleLike, toast, trackMenu, openMenu } = useSp();
  const { track, queue, recentTracks, playTrackUri, lyricsForTrack, progressMs, browse } = playback;
  const [queueTab, setQueueTab] = useState<"queue" | "recent">("queue");
  const [about, setAbout] = useState<SpotifyArtist | null>(null);
  const [following, setFollowing] = useState(false);
  const artistId = track?.artists[0]?.id;
  const { lyrics } = useTrackLyrics(mode === "now" ? track : null, lyricsForTrack);
  const tint = useArtworkTint(bigImage(track?.album?.images));
  const active = activeLyricIndexFor(lyrics, progressMs);
  const liked = track ? isLiked(track) : false;

  useEffect(() => {
    if (mode !== "now" || !artistId) { setAbout(null); return; }
    const cached = artistCache.get(artistId);
    if (cached) setAbout(cached); else setAbout(null);
    let alive = true;
    if (!cached) void browse("artist", { id: artistId }).then((res) => { if (alive && res.ok && res.artist) { artistCache.set(artistId, res.artist); setAbout(res.artist); } });
    void browse("is-following", { id: artistId }).then((res) => { if (alive && res.ok) setFollowing(Boolean(res.following?.[0])); });
    return () => { alive = false; };
  }, [mode, artistId, browse]);

  const lines = lyrics?.lines ?? [];
  const start = Math.max(0, active < 0 ? 0 : active - 1);
  const queueRow = (item: SpotifyTrack, key: string, playing = false) => (
    <div key={key} className={`sp-qrow ${playing ? "is-playing" : ""}`} onDoubleClick={() => void playTrackUri(item.uri)} onContextMenu={(event) => openMenu(event, trackMenu(item))}>
      <div className="sp-qrow__art">
        <Artwork src={midImage(item.album?.images)} />
        <button type="button" className="sp-lrow__play" aria-label={`Play ${item.name}`} onClick={() => void playTrackUri(item.uri)}><Icon name="play" size={16} /></button>
      </div>
      <div className="sp-qrow__text"><div className="sp-qrow__name sp-ellipsis">{item.name}</div><div className="sp-qrow__sub sp-ellipsis">{item.artists.map((artist) => artist.name).join(", ")}</div></div>
    </div>
  );

  return (
    <aside className="sp-panel sp-right" aria-label={mode === "queue" ? "Queue" : "Now playing"}>
      <div className="sp-right__head">
        <h2 className="sp-ellipsis">{mode === "queue" ? "Queue" : track?.album?.name || "Now playing"}</h2>
        <IconBtn icon="close" label="Close panel" onClick={onClose} />
      </div>
      <div className="sp-right__body sp-scroll">
        {mode === "queue" ? (
          <>
            <div className="sp-chips" style={{ padding: 0 }}>
              <button type="button" className={`sp-chip ${queueTab === "queue" ? "is-on" : ""}`} onClick={() => setQueueTab("queue")}>Queue</button>
              <button type="button" className={`sp-chip ${queueTab === "recent" ? "is-on" : ""}`} onClick={() => setQueueTab("recent")}>Recently played</button>
            </div>
            {queueTab === "queue" ? (
              <div>
                {track ? <><div className="sp-qlabel">Now playing</div>{queueRow(track, "now", true)}</> : null}
                <div className="sp-qlabel">Next in queue</div>
                {queue.length === 0 ? <div style={{ color: "var(--sp-sub)", padding: "8px 0" }}>Your queue is empty. Add songs from the “…” menu on any track.</div> : queue.slice(0, 40).map((item, index) => queueRow(item, `${item.id}-${index}`))}
              </div>
            ) : (
              <div>{recentTracks.length === 0 ? <div style={{ color: "var(--sp-sub)", padding: "8px 0" }}>Nothing played yet.</div> : recentTracks.slice(0, 40).map((item, index) => queueRow(item, `${item.id}-${index}`))}</div>
            )}
          </>
        ) : track ? (
          <>
            <div className="sp-np__art" role="button" tabIndex={0} aria-label={`Open full screen player for ${track.name}`} onClick={onExpand} onKeyDown={(event) => activateOnKey(event, onExpand)}><Artwork src={bigImage(track.album?.images)} eager /></div>
            <div className="sp-np__row">
              <div style={{ minWidth: 0, flex: 1 }}>
                <div className="sp-np__title sp-clamp2"><span className="sp-link" onClick={() => openAlbum(track.album, track)}>{track.name}</span></div>
                <div className="sp-np__artist sp-ellipsis"><ArtistLinks track={track} /></div>
              </div>
              <button type="button" className="sp-ctl" style={liked ? { color: "var(--sp-accent)" } : undefined} aria-label={liked ? "Remove from Liked Songs" : "Save to Liked Songs"} aria-pressed={liked} onClick={() => { toggleLike(track); toast(liked ? "Removed from Liked Songs" : "Added to Liked Songs"); }}><Icon name={liked ? "checkCircle" : "plusCircle"} size={22} /></button>
            </div>
            {lines.length > 0 ? (
              <button type="button" className="sp-lyr-prev" style={{ background: tint || "#3a56a8" }} onClick={onLyrics} aria-label="Open lyrics">
                <h3>Lyrics</h3>
                {lines.slice(start, start + 4).map((line, index) => <p key={start + index} className={start + index === active || !lyrics?.synced ? "is-active" : ""}>{line.text}</p>)}
              </button>
            ) : null}
            {about ? (
              <div className="sp-card-box sp-about">
                {bigImage(about.images) ? <img className="sp-about__img" src={bigImage(about.images)} alt="" /> : null}
                <div className="sp-card-box__head" style={{ position: bigImage(about.images) ? "absolute" : "relative", top: 0, left: 0, right: 0, color: bigImage(about.images) ? "#fff" : undefined, textShadow: bigImage(about.images) ? "0 1px 8px rgba(0,0,0,.45)" : undefined }}>About the artist</div>
                <div className="sp-card-box__body">
                  <div className="sp-about__name"><span className="sp-link" onClick={() => openArtist(about)}>{about.name}</span></div>
                  <div className="sp-about__meta">
                    <span>{about.followers?.total ? `${new Intl.NumberFormat().format(about.followers.total)} followers` : "Artist"}</span>
                    <button
                      type="button"
                      className="sp-pill sp-pill--ghost"
                      style={{ height: 28, padding: "0 14px" }}
                      onClick={() => {
                        const next = !following;
                        setFollowing(next);
                        void browse(next ? "follow-artist" : "unfollow-artist", { id: about.id }).then((res) => { if (!res.ok) { setFollowing(!next); toast(res.error || "Couldn't update follow."); } });
                      }}
                    >{following ? "Following" : "Follow"}</button>
                  </div>
                  {about.genres?.length ? <div style={{ color: "var(--sp-sub)", fontSize: 14 }}>{about.genres.slice(0, 3).join(" • ")}</div> : null}
                </div>
              </div>
            ) : null}
            <div className="sp-card-box">
              <div className="sp-card-box__head">Credits</div>
              <div className="sp-card-box__body">
                {track.artists.map((artist, index) => <div key={`${artist.name}-${index}`} className="sp-credit"><b className="sp-link" onClick={() => openArtist(artist)}>{artist.name}</b><span>{index === 0 ? "Main artist" : "Featured artist"}</span></div>)}
              </div>
            </div>
            <div className="sp-card-box">
              <div className="sp-card-box__head">Next in queue<button type="button" className="sp-shelf__more" onClick={() => onMode("queue")}>Open queue</button></div>
              <div className="sp-card-box__body">
                {queue.length === 0 ? <div style={{ color: "var(--sp-sub)" }}>Your queue is empty.</div> : queue.slice(0, 3).map((item, index) => queueRow(item, `${item.id}-${index}`))}
              </div>
            </div>
          </>
        ) : (
          <div className="sp-empty" style={{ padding: "48px 8px" }}><h3 style={{ fontSize: 20 }}>Nothing playing</h3><p>Play a song to see its details here.</p></div>
        )}
      </div>
    </aside>
  );
}

/* ── Your Library sidebar ────────────────────────────────────────────────── */

type LibItem = { key: string; kind: "liked" | "playlist" | "artist" | "album"; title: string; sub: string; art?: ReactNode; round?: boolean; active: boolean; playing: boolean; open: () => void; play: () => void; menu: () => MenuItem[]; pinned?: boolean; creator: string };

function LibrarySidebar({ prefs, setPrefs, items, onCreate }: { prefs: Prefs; setPrefs: (patch: Partial<Prefs>) => void; items: LibItem[]; onCreate: () => void }) {
  const { openMenu, isPlaying, goTo } = useSp();
  const [chip, setChip] = useState<"all" | "playlist" | "artist" | "album">("all");
  const [findOpen, setFindOpen] = useState(false);
  const [needle, setNeedle] = useState("");
  const [dragging, setDragging] = useState(false);
  const collapsed = prefs.libCollapsed;

  const visible = useMemo(() => {
    const text = needle.trim().toLowerCase();
    let list = items.filter((item) => (chip === "all" || item.kind === chip || (chip === "playlist" && item.kind === "liked")) && (!text || item.title.toLowerCase().includes(text)));
    if (prefs.libSort === "alpha") list = [...list].sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) || a.title.localeCompare(b.title));
    else if (prefs.libSort === "creator") list = [...list].sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) || a.creator.localeCompare(b.creator));
    return list;
  }, [items, chip, needle, prefs.libSort]);

  const startResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(true);
    const origin = event.clientX;
    const base = prefs.libWidth;
    const move = (ev: PointerEvent) => setPrefs({ libWidth: Math.min(480, Math.max(260, base + ev.clientX - origin)), libCollapsed: false });
    const up = () => { setDragging(false); window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const sortLabel = prefs.libSort === "recents" ? "Recents" : prefs.libSort === "alpha" ? "Alphabetical" : "Creator";
  const viewIcon: IconName = prefs.libView === "grid" ? "grid" : prefs.libView === "compact" ? "compact" : "list";

  const row = (item: LibItem) => {
    const art = item.art ?? <Artwork src={undefined} round={item.round} />;
    if (prefs.libView === "grid" && !collapsed) {
      return (
        <div key={item.key} className={`sp-lcard ${item.active ? "is-active" : ""}`} role="button" tabIndex={0} aria-label={`Open ${item.title}`} onClick={item.open} onKeyDown={(event) => activateOnKey(event, item.open)} onContextMenu={(event) => openMenu(event, item.menu())}>
          <div className={`sp-lrow__art ${item.round ? "is-round" : ""}`}>{art}<button type="button" className="sp-lrow__play" aria-label={`Play ${item.title}`} onClick={(event) => { event.stopPropagation(); item.play(); }}><Icon name="play" size={20} /></button></div>
          <div><div className="sp-lrow__title sp-ellipsis">{item.title}</div><div className="sp-lrow__sub"><span className="sp-ellipsis">{item.sub}</span></div></div>
        </div>
      );
    }
    return (
      <div
        key={item.key}
        className={`sp-lrow ${item.active ? "is-active" : ""} ${item.playing ? "is-playing" : ""} ${prefs.libView === "compact" && !collapsed ? "is-compact" : ""}`}
        role="button"
        tabIndex={0}
        aria-label={`Open ${item.title}`}
        title={collapsed ? item.title : undefined}
        onClick={item.open}
        onDoubleClick={item.play}
        onKeyDown={(event) => { if (event.target === event.currentTarget) activateOnKey(event, item.open); }}
        onContextMenu={(event) => openMenu(event, item.menu())}
      >
        <div className={`sp-lrow__art ${item.round ? "is-round" : ""}`}>
          {art}
          <button type="button" className="sp-lrow__play" aria-label={`Play ${item.title}`} onClick={(event) => { event.stopPropagation(); item.play(); }}><Icon name={item.playing && isPlaying ? "pause" : "play"} size={prefs.libView === "compact" ? 12 : 18} /></button>
        </div>
        {!collapsed ? (
          <>
            <div className="sp-lrow__text">
              <div className="sp-lrow__title sp-ellipsis">{item.title}</div>
              <div className="sp-lrow__sub">{item.pinned ? <Icon name="pin" size={14} /> : null}<span className="sp-ellipsis">{item.sub}</span></div>
            </div>
            {item.playing ? <span className="sp-lrow__eq"><Icon name="speaker" size={16} /></span> : null}
          </>
        ) : null}
      </div>
    );
  };

  return (
    <nav className={`sp-panel sp-lib ${collapsed ? "is-collapsed" : ""} ${dragging ? "is-dragging" : ""}`} style={{ ["--sp-lib-w" as string]: `${prefs.libWidth}px`, position: "relative" }} aria-label="Your Library">
      <div className="sp-lib__head">
        <button type="button" className="sp-lib__title" aria-label={collapsed ? "Expand Your Library" : "Collapse Your Library"} title={collapsed ? "Expand Your Library" : "Collapse Your Library"} onClick={() => setPrefs({ libCollapsed: !collapsed })}>
          <Icon name="library" size={24} />
          {!collapsed ? <span>Your Library</span> : null}
        </button>
        {!collapsed ? (
          <>
            <IconBtn icon="plus" label="Create" size={18} onClick={(event) => { const rect = event.currentTarget.getBoundingClientRect(); openMenu({ clientX: rect.left, clientY: rect.bottom + 4 }, [{ label: "Create a new playlist", icon: "note", onClick: onCreate }]); }} />
            <IconBtn icon="arrowRight" label="Open your library" size={18} onClick={() => goTo({ type: "library" })} />
          </>
        ) : null}
      </div>
      {!collapsed ? (
        <>
          <div className="sp-chips" role="group" aria-label="Library filters">
            {([["playlist", "Playlists"], ["artist", "Artists"], ["album", "Albums"]] as const).map(([id, label]) => (
              <button key={id} type="button" className={`sp-chip ${chip === id ? "is-on" : ""}`} aria-pressed={chip === id} onClick={() => setChip((current) => (current === id ? "all" : id))}>{label}</button>
            ))}
          </div>
          <div className="sp-lib__tools">
            <div className={`sp-lib__find ${findOpen ? "is-open" : ""}`}>
              <IconBtn icon="search" label="Search in Your Library" size={16} onClick={() => setFindOpen((value) => !value)} />
              <input value={needle} onChange={(event) => setNeedle(event.target.value)} placeholder="Search in Your Library" aria-label="Search in Your Library" tabIndex={findOpen ? 0 : -1} onBlur={() => { if (!needle) setFindOpen(false); }} />
            </div>
            <button
              type="button"
              className="sp-lib__sort"
              aria-label="Sort and view options"
              onClick={(event) => {
                const rect = event.currentTarget.getBoundingClientRect();
                const mark = (on: boolean): IconName | undefined => (on ? "check" : undefined);
                openMenu({ clientX: Math.min(rect.left, window.innerWidth - 240), clientY: rect.bottom + 4 }, [
                  { kind: "label", label: "Sort by" },
                  { label: "Recents", icon: mark(prefs.libSort === "recents"), onClick: () => setPrefs({ libSort: "recents" }) },
                  { label: "Alphabetical", icon: mark(prefs.libSort === "alpha"), onClick: () => setPrefs({ libSort: "alpha" }) },
                  { label: "Creator", icon: mark(prefs.libSort === "creator"), onClick: () => setPrefs({ libSort: "creator" }) },
                  { kind: "sep" },
                  { kind: "label", label: "View as" },
                  { label: "Compact", icon: mark(prefs.libView === "compact"), onClick: () => setPrefs({ libView: "compact" }) },
                  { label: "List", icon: mark(prefs.libView === "list"), onClick: () => setPrefs({ libView: "list" }) },
                  { label: "Grid", icon: mark(prefs.libView === "grid"), onClick: () => setPrefs({ libView: "grid" }) },
                ]);
              }}
            >
              {sortLabel}
              <Icon name={viewIcon} size={16} />
            </button>
          </div>
        </>
      ) : null}
      <div className={`sp-lib__list sp-scroll ${prefs.libView === "grid" && !collapsed ? "sp-lib__grid" : ""}`} style={prefs.libView === "grid" && !collapsed ? { alignContent: "start" } : undefined}>
        {visible.map(row)}
        {visible.length === 0 && !collapsed ? (
          items.length === 0 ? (
            <div className="sp-lib__empty">
              <h3>Create your first playlist</h3>
              <p>It's easy, we'll help you</p>
              <button type="button" className="sp-pill" onClick={onCreate}>Create playlist</button>
            </div>
          ) : <div style={{ padding: "12px 8px", color: "var(--sp-sub)" }}>Nothing matches “{needle || chip}”.</div>
        ) : null}
      </div>
      <div className={`sp-resize ${dragging ? "is-active" : ""}`} style={{ right: -8, margin: 0 }} onPointerDown={startResize} onDoubleClick={() => setPrefs({ libWidth: 320 })} role="separator" aria-orientation="vertical" aria-label="Resize Your Library" />
    </nav>
  );
}

/* ── Full-screen player (light, artwork-tinted) ──────────────────────────── */

function FullscreenPlayer({ onClose }: { onClose: () => void }) {
  const { playback, isLiked, toggleLike, toast } = useSp();
  const { track, isPlaying, progressMs, volume, seekTo, setVolumePercent, onToggle, onPrev, onNext, lyricsForTrack, shuffleOn, toggleShuffle, repeatMode, cycleRepeat } = playback;
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const { lyrics, loading, error } = useTrackLyrics(track, lyricsForTrack);
  const active = useMemo(() => activeLyricIndexFor(lyrics, progressMs), [lyrics, progressMs]);
  const reduce = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    closeRef.current?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  useEffect(() => { centerLyric(viewportRef.current, active, !reduce); }, [active, reduce]);
  if (!track) return null;
  const art = bigImage(track.album?.images);
  const liked = isLiked(track);

  return createPortal(
    <div className="sp-full clyra-music-fullscreen" role="dialog" aria-modal="true" aria-label={`Now playing ${track.name}`}>
      {art ? <img src={art} className="sp-full__ambient clyra-music-fullscreen__ambient-art" alt="" aria-hidden /> : null}
      <div className="sp-full__wash" />
      <div className="sp-full__inner">
        <div className="sp-full__top">
          <span>Now playing</span>
          <button ref={closeRef} type="button" className="sp-full__close" aria-label="Close full screen player" onClick={onClose}><Icon name="chevD" size={20} /></button>
        </div>
        <div className="sp-full__hero">
          <div className="sp-full__art"><Artwork src={art} eager /></div>
          <section style={{ minWidth: 0 }}>
            <div className="sp-full__album">{track.album?.name || "Single"}</div>
            <h1 className="sp-full__title">{track.name}</h1>
            <div className="sp-full__artist">{track.artists.map((a) => a.name).join(", ")}</div>
            <div className="sp-full__controls">
              <div className="sp-full__row">
                <span style={{ width: 40, textAlign: "right" }}>{fmt(progressMs)}</span>
                <Slider label="Playback position" value={Math.min(progressMs, track.duration_ms)} max={track.duration_ms} step={5000} onCommit={seekTo} />
                <span style={{ width: 40 }}>{fmt(track.duration_ms)}</span>
              </div>
              <div className="sp-full__btns">
                <button type="button" className={`sp-ctl ${shuffleOn ? "is-on" : ""}`} aria-label="Shuffle" onClick={toggleShuffle}><Icon name="shuffle" size={22} /></button>
                <button type="button" className="sp-ctl" aria-label="Previous track" onClick={onPrev}><Icon name="prev" size={28} /></button>
                <button type="button" className="sp-playpause" aria-label={isPlaying ? "Pause" : "Play"} onClick={onToggle}><Icon name={isPlaying ? "pause" : "play"} size={26} /></button>
                <button type="button" className="sp-ctl" aria-label="Next track" onClick={onNext}><Icon name="next" size={28} /></button>
                <button type="button" className={`sp-ctl ${repeatMode !== "off" ? "is-on" : ""}`} aria-label="Repeat" onClick={cycleRepeat}><Icon name={repeatMode === "track" ? "repeat1" : "repeat"} size={22} /></button>
              </div>
              <div className="sp-full__vol">
                <Icon name={volume === 0 ? "volume0" : "volume2"} size={18} />
                <Slider label="Volume" value={volume} max={100} step={5} onPreview={setVolumePercent} onCommit={setVolumePercent} />
                <span style={{ width: 36, fontSize: 12 }}>{volume}%</span>
                <button type="button" className="sp-ctl" style={liked ? { color: "var(--sp-accent)" } : undefined} aria-label={liked ? "Remove from Liked Songs" : "Save to Liked Songs"} onClick={() => { toggleLike(track); toast(liked ? "Removed from Liked Songs" : "Added to Liked Songs"); }}><Icon name={liked ? "checkCircle" : "plusCircle"} size={22} /></button>
              </div>
            </div>
          </section>
        </div>
        <section className="sp-full__lyrics" aria-label="Lyrics">
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 16 }}><h2>Lyrics</h2><span style={{ color: "#566074", fontSize: 12 }}>{lyrics?.source === "LRCLIB" ? "Synced by LRCLIB" : "Clyra Music"}</span></div>
          {loading ? <p style={{ margin: "16px 0 0", color: "#566074" }}>Loading lyrics…</p> : null}
          {!loading && lyrics?.instrumental ? <p style={{ margin: "16px 0 0", color: "#566074" }}>This track is instrumental.</p> : null}
          {!loading && lyrics && lyrics.lines.length > 0 ? (
            <div ref={viewportRef} className="sp-full__lyrics-body" tabIndex={0} aria-label="Song lyrics">
              {lyrics.lines.map((line, index) => {
                const on = index === active;
                return <p key={`${line.timeMs ?? "plain"}-${index}`} data-lyric-index={index} style={{ color: on || !lyrics.synced ? "#0b1020" : "#8993a6", fontSize: lyrics.synced ? 22 : 17, transform: on && !reduce ? "translateX(4px)" : "none" }}>{line.text}</p>;
              })}
            </div>
          ) : null}
          {!loading && !error && lyrics && !lyrics.instrumental && lyrics.lines.length === 0 ? <p style={{ margin: "16px 0 0", color: "#566074" }}>No lyrics were found for this version of the track.</p> : null}
          {error ? <p role="status" style={{ margin: "16px 0 0", color: "#566074" }}>{error}</p> : null}
        </section>
      </div>
    </div>,
    document.body,
  );
}

/* ── Connect screen ──────────────────────────────────────────────────────── */

function ConnectScreen({ playback }: { playback: SpotifyPlaybackHook }) {
  const { available, connecting, connect, error } = playback;
  return (
    <div className="sp-connect">
      <MusicMark size={72} />
      {!available ? (
        <>
          <h1>Clyra Music is a desktop feature</h1>
          <p>Open Clyra's desktop app to browse and control music from here.</p>
        </>
      ) : (
        <>
          <h1>Welcome to Clyra Music</h1>
          <p>Sign in with Spotify to browse your library, search, and control playback right here.</p>
          {error ? <p style={{ color: "var(--sp-danger)", fontSize: 13 }}>{error}</p> : null}
          <button type="button" className="sp-pill sp-pill--accent sp-pill--lg" onClick={connect} disabled={connecting} style={connecting ? { opacity: 0.7 } : undefined}>{connecting ? "Connecting…" : "Connect Spotify"}</button>
        </>
      )}
    </div>
  );
}

/* ── Workspace ───────────────────────────────────────────────────────────── */

export function SpotifyWorkspace({ playback }: { playback: SpotifyPlaybackHook }) {
  const { available, connected } = playback;
  if (!available || !connected) {
    return <div className="sp clyra-music-workspace"><ConnectScreen playback={playback} /></div>;
  }
  return <ConnectedWorkspace playback={playback} />;
}

function ConnectedWorkspace({ playback }: { playback: SpotifyPlaybackHook }) {
  const [nav, setNav] = useState<{ stack: ViewEntry[]; index: number }>({ stack: [{ type: "home" }], index: 0 });
  const view = nav.stack[nav.index];
  const [query, setQuery] = useState("");
  const [searchTab, setSearchTab] = useState<SearchTab>("all");
  const [homeFilter, setHomeFilter] = useState<HomeFilter>("all");
  const [prefs, setPrefsState] = useState<Prefs>(readPrefs);
  const [fullscreen, setFullscreen] = useState(false);
  const [profileMenu, setProfileMenu] = useState(false);
  const [wash, setWash] = useState<string | null>(null);
  const [scrolled, setScrolled] = useState(false);
  const [showTitle, setShowTitle] = useState(false);
  const [dialog, setDialog] = useState<{ seed: SpotifyTrack[] } | null>(null);
  const [creating, setCreating] = useState(false);
  const [recency, setRecency] = useState(readPlaylistRecency);
  const [libArtists, setLibArtists] = useState<SpotifyArtist[]>([]);
  const [libAlbums, setLibAlbums] = useState<SpotifyAlbum[]>([]);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const { connected, profile, playlists, refreshPlaylists, refreshRecentTracks, refreshSavedTracks, savedTracks, playLikedSongs, playPlaylistUri, track, isPlaying, pause, resume, contextUri, recentContexts, needsReconnect, connect, disconnect, browse, addToQueue, playlistsChanged } = playback;

  const menuHost = useMenuHost();
  const toastHost = useToastHost();
  const liked = useLikedCache(playback);
  const { toast } = toastHost;

  const setPrefs = useCallback((patch: Partial<Prefs>) => {
    setPrefsState((current) => {
      const next = { ...current, ...patch };
      try { window.localStorage.setItem(PREFS_KEY, JSON.stringify(next)); } catch { /* preference only */ }
      return next;
    });
  }, []);

  const goTo = useCallback((next: ViewEntry) => {
    setNav((current) => (viewKey(current.stack[current.index]) === viewKey(next) ? current : { stack: [...current.stack.slice(0, current.index + 1), next], index: current.index + 1 }));
  }, []);
  const goBack = useCallback(() => setNav((current) => ({ ...current, index: Math.max(0, current.index - 1) })), []);
  const goForward = useCallback(() => setNav((current) => ({ ...current, index: Math.min(current.stack.length - 1, current.index + 1) })), []);
  const canBack = nav.index > 0;
  const canForward = nav.index < nav.stack.length - 1;

  const markUsed = useCallback((id: string) => {
    setRecency((current) => {
      const next = { ...current, [id]: Date.now() };
      writePlaylistRecency(next);
      return next;
    });
  }, []);
  const openPlaylist = useCallback((playlist: SpotifyPlaylist) => { markUsed(playlist.id); goTo({ type: "playlist", playlist }); }, [goTo, markUsed]);

  const openArtist = useCallback((artist: { id?: string; name: string }) => {
    if (artist.id) { goTo({ type: "artist", artist: { ...artist, id: artist.id } }); return; }
    void browse("search-all", { query: artist.name }).then((res) => {
      const found = res.artists?.find((item) => item.name.toLowerCase() === artist.name.toLowerCase()) ?? res.artists?.[0];
      if (found) goTo({ type: "artist", artist: found });
      else toast(res.error || `Couldn't find ${artist.name}.`);
    });
  }, [goTo, browse, toast]);

  const openAlbum = useCallback((album: { id?: string; name: string; images?: Array<{ url: string }> } | undefined, source?: SpotifyTrack) => {
    if (!album) return;
    if (album.id) { goTo({ type: "album", album: { id: album.id, name: album.name, uri: `spotify:album:${album.id}`, images: album.images, ...(album as Partial<SpotifyAlbum>) } }); return; }
    const artist = source?.artists[0]?.name ?? "";
    void browse("search-all", { query: `${album.name} ${artist}`.trim() }).then((res) => {
      const found = res.albums?.find((item) => item.name.toLowerCase() === album.name.toLowerCase()) ?? res.albums?.[0];
      if (found) goTo({ type: "album", album: found });
      else toast(res.error || `Couldn't find ${album.name}.`);
    });
  }, [goTo, browse, toast]);

  const editablePlaylists = useMemo(() => playlists.filter((item) => item.owner?.id === profile?.id || item.collaborative), [playlists, profile?.id]);

  const addToPlaylist = useCallback(async (playlist: SpotifyPlaylist, tracks: SpotifyTrack[]) => {
    const res = await browse("add-to-playlist", { playlistId: playlist.id, uris: tracks.map((item) => item.uri) });
    if (res.ok) { toast(`Added to ${playlist.name}`); markUsed(playlist.id); playlistsChanged(); }
    else toast(res.error || "Couldn't add to that playlist.");
    return Boolean(res.ok);
  }, [browse, toast, markUsed, playlistsChanged]);

  const newPlaylist = useCallback((seed: SpotifyTrack[] = []) => setDialog({ seed }), []);

  const trackMenu = useCallback((item: SpotifyTrack, extra?: { playlist?: SpotifyPlaylist; onRemove?: () => void }): MenuItem[] => {
    const likedNow = liked.isLiked(item);
    const artists: MenuItem[] = item.artists.length > 1
      ? [{ label: "Go to artist", icon: "artist", submenu: item.artists.map((artist) => ({ label: artist.name, onClick: () => openArtist(artist) })) }]
      : item.artists[0] ? [{ label: "Go to artist", icon: "artist", onClick: () => openArtist(item.artists[0]) }] : [];
    const targets: MenuItem[] = [
      { label: "New playlist", icon: "plus", onClick: () => newPlaylist([item]) },
      ...(editablePlaylists.length ? [{ kind: "sep" } as MenuItem] : []),
      ...editablePlaylists.filter((playlist) => playlist.id !== extra?.playlist?.id).slice(0, 30).map((playlist): MenuItem => ({ label: playlist.name, onClick: () => void addToPlaylist(playlist, [item]) })),
    ];
    return [
      { label: "Add to queue", icon: "queue", onClick: () => void addToQueue(item.uri).then((res) => toast(res.ok ? "Added to queue" : res.error || "Couldn't add to queue")) },
      { kind: "sep" },
      ...artists,
      { label: "Go to album", icon: "album", onClick: () => openAlbum(item.album, item) },
      { kind: "sep" },
      { label: likedNow ? "Remove from your Liked Songs" : "Save to your Liked Songs", icon: likedNow ? "checkCircle" : "plusCircle", onClick: () => { liked.toggleLike(item); toast(likedNow ? "Removed from Liked Songs" : "Added to Liked Songs"); } },
      { label: "Add to playlist", icon: "folder", submenu: targets },
      { kind: "sep" },
      { label: "Copy song link", icon: "link", onClick: () => copyLink(`https://open.spotify.com/track/${item.id}`, toast) },
      { label: "Open in Spotify", icon: "external", onClick: () => window.open(`https://open.spotify.com/track/${item.id}`, "_blank", "noopener") },
    ];
  }, [liked, editablePlaylists, openArtist, openAlbum, newPlaylist, addToPlaylist, addToQueue, toast]);

  const createPlaylist = useCallback(async (name: string) => {
    if (!dialog) return;
    setCreating(true);
    const res = await browse("create-playlist", { name });
    setCreating(false);
    if (!res.ok || !res.playlist) { toast(res.error || "Couldn't create the playlist."); return; }
    const created: SpotifyPlaylist = { ...res.playlist, owner: res.playlist.owner ?? { display_name: profile?.displayName, id: profile?.id }, tracks: { total: 0 } };
    if (dialog.seed.length) await browse("add-to-playlist", { playlistId: created.id, uris: dialog.seed.map((item) => item.uri) });
    setDialog(null);
    playlistsChanged();
    toast(`Created ${name}`);
    openPlaylist(created);
  }, [dialog, browse, toast, profile?.displayName, profile?.id, playlistsChanged, openPlaylist]);

  /* Library data beyond playlists. */
  useEffect(() => {
    let alive = true;
    void browse("followed-artists").then((res) => { if (alive && res.ok) setLibArtists(res.artists ?? []); });
    void browse("saved-albums").then((res) => { if (alive && res.ok) setLibAlbums(res.albums ?? []); });
    return () => { alive = false; };
  }, [browse, view.type === "artist" ? view.artist.id : null]);

  useEffect(() => { if (connected) { refreshPlaylists(); refreshRecentTracks(); refreshSavedTracks(); } }, [connected, refreshPlaylists, refreshRecentTracks, refreshSavedTracks]);
  useEffect(() => {
    if (!recentContexts.length) return;
    setRecency((current) => { const next = mergeContextRecency(current, recentContexts); if (next !== current) writePlaylistRecency(next); return next; });
  }, [recentContexts]);
  useEffect(() => { const id = playlistIdFromUri(contextUri); if (id) markUsed(id); }, [contextUri, markUsed]);

  /* Scroll position drives the sticky header. */
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
    setScrolled(false);
    setShowTitle(false);
    setWash(null);
  }, [viewKey(view)]);
  const onScroll = () => {
    const top = scrollRef.current?.scrollTop ?? 0;
    setScrolled(top > 12);
    setShowTitle(top > (view.type === "playlist" || view.type === "album" || view.type === "liked" || view.type === "artist" ? 250 : 99999));
  };

  /* Keyboard shortcuts. */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const editing = Boolean(target?.closest("input, textarea, [contenteditable='true']"));
      const mod = event.metaKey || event.ctrlKey;
      if (mod && (event.key.toLowerCase() === "k" || event.key.toLowerCase() === "l")) { event.preventDefault(); goTo({ type: "search" }); window.setTimeout(() => searchRef.current?.focus(), 0); return; }
      if ((event.altKey && event.key === "ArrowLeft") || (mod && event.key === "[")) { event.preventDefault(); goBack(); return; }
      if ((event.altKey && event.key === "ArrowRight") || (mod && event.key === "]")) { event.preventDefault(); goForward(); return; }
      if (event.key === "Escape" && document.activeElement === searchRef.current && query) { event.preventDefault(); setQuery(""); return; }
      if (event.key === " " && !editing && !(target?.closest("button, [role='button'], [role='slider']"))) { event.preventDefault(); void (isPlaying ? pause() : resume()); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [goTo, goBack, goForward, isPlaying, pause, resume, query]);

  const orderedPlaylists = useMemo(() => sortPlaylistsByRecency(playlists, recency), [playlists, recency]);
  const likedPlaying = Boolean(track && !contextUri && savedTracks.some((item) => item.id === track.id) && isPlaying);

  /* Sidebar items. */
  const libItems = useMemo<LibItem[]>(() => {
    const list: LibItem[] = [];
    const urlFor = (kind: string, id: string) => `https://open.spotify.com/${kind}/${id}`;
    if (savedTracks.length) {
      list.push({ key: "liked", kind: "liked", title: "Liked Songs", sub: `Playlist • ${savedTracks.length} songs`, art: <LikedArt />, active: view.type === "liked", playing: likedPlaying, pinned: true, creator: profile?.displayName || "", open: () => goTo({ type: "liked" }), play: () => void playLikedSongs(), menu: () => [{ label: "Play", icon: "play", onClick: () => void playLikedSongs() }] });
    }
    for (const playlist of orderedPlaylists) {
      list.push({
        key: `p-${playlist.id}`, kind: "playlist", title: playlist.name, sub: `Playlist • ${playlist.owner?.display_name || "Spotify"}`, art: <Artwork src={midImage(playlist.images)} />,
        active: view.type === "playlist" && view.playlist.id === playlist.id, playing: contextUri === playlist.uri && isPlaying, creator: playlist.owner?.display_name || "",
        open: () => openPlaylist(playlist), play: () => { markUsed(playlist.id); void playPlaylistUri(playlist.uri); },
        menu: () => [
          { label: "Play", icon: "play", onClick: () => void playPlaylistUri(playlist.uri) },
          { kind: "sep" },
          { label: "Copy playlist link", icon: "link", onClick: () => copyLink(urlFor("playlist", playlist.id), toast) },
          { label: "Open in Spotify", icon: "external", onClick: () => window.open(urlFor("playlist", playlist.id), "_blank", "noopener") },
        ],
      });
    }
    for (const artist of libArtists) {
      list.push({ key: `a-${artist.id}`, kind: "artist", title: artist.name, sub: "Artist", round: true, art: <Artwork src={midImage(artist.images)} round />, active: view.type === "artist" && view.artist.id === artist.id, playing: contextUri === artist.uri && isPlaying, creator: artist.name, open: () => goTo({ type: "artist", artist }), play: () => void playPlaylistUri(artist.uri), menu: () => [{ label: "Play", icon: "play", onClick: () => void playPlaylistUri(artist.uri) }, { label: "Copy artist link", icon: "link", onClick: () => copyLink(urlFor("artist", artist.id), toast) }] });
    }
    for (const album of libAlbums) {
      list.push({ key: `b-${album.id}`, kind: "album", title: album.name, sub: `Album • ${album.artists?.[0]?.name ?? ""}`, art: <Artwork src={midImage(album.images)} />, active: view.type === "album" && view.album.id === album.id, playing: contextUri === album.uri && isPlaying, creator: album.artists?.[0]?.name || "", open: () => goTo({ type: "album", album }), play: () => void playPlaylistUri(album.uri), menu: () => [{ label: "Play", icon: "play", onClick: () => void playPlaylistUri(album.uri) }, { label: "Copy album link", icon: "link", onClick: () => copyLink(urlFor("album", album.id), toast) }] });
    }
    return list;
  }, [savedTracks.length, orderedPlaylists, libArtists, libAlbums, view, likedPlaying, contextUri, isPlaying, profile?.displayName, goTo, openPlaylist, markUsed, playLikedSongs, playPlaylistUri, toast]);

  const ctx: SpContext = {
    playback, view, goTo, openArtist, openAlbum, openPlaylist, openMenu: menuHost.open, toast, editablePlaylists,
    isLiked: liked.isLiked, primeLiked: liked.primeLiked, toggleLike: liked.toggleLike, addToPlaylist, newPlaylist, trackMenu,
    playingTrackId: track?.id ?? null, isPlaying,
  };

  const toggleRight = (mode: "now" | "queue") => setPrefs({ right: prefs.right === mode ? null : mode });
  const toggleLyrics = () => { if (view.type === "lyrics") { if (canBack) goBack(); else goTo({ type: "home" }); } else goTo({ type: "lyrics" }); };

  const headerTitle = view.type === "playlist" ? view.playlist.name : view.type === "album" ? view.album.name : view.type === "artist" ? view.artist.name : view.type === "liked" ? "Liked Songs" : "";
  const headerPlaying = view.type === "playlist" ? contextUri === view.playlist.uri && isPlaying : view.type === "album" ? contextUri === view.album.uri && isPlaying : view.type === "liked" ? likedPlaying : false;
  const headerPlay = () => {
    if (headerPlaying) { void pause(); return; }
    if (view.type === "playlist") void playPlaylistUri(view.playlist.uri);
    else if (view.type === "album") void playPlaylistUri(view.album.uri);
    else if (view.type === "liked") void playLikedSongs();
  };
  const washed = view.type === "home" || view.type === "playlist" || view.type === "album" || view.type === "liked" || view.type === "library";
  const homeWash = view.type === "home" || view.type === "library" ? wash ?? "#7fa2e8" : wash;
  const initial = initials(profile?.displayName || "Music");

  return (
    <SpProvider value={ctx}>
      <div className="sp clyra-music-workspace">
        <header className="sp-top">
          <div className="sp-top__logo"><MusicMark size={32} /><span>Clyra Music</span></div>
          <div className="sp-top__mid">
            <button type="button" className="sp-home-btn" aria-label="Home" aria-current={view.type === "home" ? "page" : undefined} onClick={() => { goTo({ type: "home" }); setQuery(""); }}>
              <Icon name={view.type === "home" ? "homeFill" : "home"} size={24} />
            </button>
            <div className="sp-search" role="search">
              <span className="sp-search__icon"><Icon name="search" size={22} /></span>
              <input
                ref={searchRef}
                value={query}
                placeholder="What do you want to play?"
                aria-label="Search songs, artists, albums and playlists"
                onChange={(event) => { setQuery(event.target.value); setSearchTab("all"); goTo({ type: "search" }); }}
                onFocus={() => goTo({ type: "search" })}
              />
              {query ? <button type="button" className="sp-search__clear" aria-label="Clear search" onClick={() => { setQuery(""); searchRef.current?.focus(); }}><Icon name="close" size={16} /></button> : null}
              <span className="sp-search__browse">
                <button type="button" aria-label="Browse" aria-current={view.type === "search" && !query ? "page" : undefined} onClick={() => { setQuery(""); goTo({ type: "search" }); }}><Icon name="browse" size={22} /></button>
              </span>
            </div>
          </div>
          <div className="sp-top__end">
            <div style={{ position: "relative" }}>
              <button type="button" className="sp-avatar" aria-label="Account" aria-expanded={profileMenu} onClick={() => setProfileMenu((value) => !value)}>
                <span className="sp-avatar__img">{profile?.image ? <img src={profile.image} alt="" /> : initial}</span>
              </button>
              {profileMenu ? (
                <div className="sp-menu" role="menu" style={{ position: "absolute", top: 54, right: 0, left: "auto" }} onMouseLeave={() => setProfileMenu(false)}>
                  <div className="sp-menu__label" style={{ fontSize: 14, color: "var(--sp-text)" }}>{profile?.displayName || "Music account"}</div>
                  {profile?.product ? <div className="sp-menu__label" style={{ paddingTop: 0, fontWeight: 500 }}>Spotify {profile.product}</div> : null}
                  <div className="sp-menu__sep" />
                  <button type="button" role="menuitem" className="sp-menu__item" onClick={() => { setProfileMenu(false); window.open("https://open.spotify.com", "_blank", "noopener"); }}><Icon name="external" size={16} />Open Spotify</button>
                  <button type="button" role="menuitem" className="sp-menu__item" onClick={() => { setProfileMenu(false); disconnect(); }}>Log out</button>
                </div>
              ) : null}
            </div>
          </div>
        </header>

        <div className="sp-body">
          <LibrarySidebar prefs={prefs} setPrefs={setPrefs} items={libItems} onCreate={() => newPlaylist()} />

          <main className="sp-panel sp-main" aria-label={view.type}>
            <div className={`sp-header ${scrolled ? "is-solid" : ""}`}>
              <div className="sp-header__nav">
                <button type="button" className="sp-nav-btn" aria-label="Go back" disabled={!canBack} onClick={goBack}><Icon name="chevL" size={18} /></button>
                <button type="button" className="sp-nav-btn" aria-label="Go forward" disabled={!canForward} onClick={goForward}><Icon name="chevR" size={18} /></button>
              </div>
              {view.type === "home" ? (
                <div className="sp-header__chips" role="group" aria-label="Home filters">
                  {([["all", "All"], ["music", "Music"], ["playlists", "Playlists"], ["artists", "Artists"]] as const).map(([id, label]) => (
                    <button key={id} type="button" className={`sp-chip ${homeFilter === id ? "is-on" : ""}`} aria-pressed={homeFilter === id} onClick={() => setHomeFilter(id)}>{label}</button>
                  ))}
                </div>
              ) : null}
              {headerTitle ? (
                <div className="sp-header__title" style={showTitle ? undefined : { visibility: "hidden" }}>
                  {view.type !== "artist" ? <PlayBtn size="xs" playing={headerPlaying} onClick={headerPlay} /> : null}
                  <h2 className="sp-ellipsis">{headerTitle}</h2>
                </div>
              ) : null}
            </div>

            <div ref={scrollRef} className="sp-main__scroll sp-scroll" onScroll={onScroll}>
              {washed ? <PageWash color={homeWash} /> : null}
              {view.type === "lyrics" ? (
                <div style={{ position: "absolute", inset: 0 }}><LyricsView /></div>
              ) : (
                <div className="sp-content">
                  {needsReconnect ? (
                    <div role="status" className="sp-notice">
                      <span>Reconnect Spotify once to sync your listening history and recently played playlists.</span>
                      <button type="button" className="sp-pill sp-pill--accent" onClick={connect}>Reconnect</button>
                    </div>
                  ) : null}
                  {view.type === "home" ? <HomeView filter={homeFilter} onWash={setWash} />
                    : view.type === "search" ? <SearchView query={query} setQuery={(value) => { setQuery(value); setSearchTab("all"); }} tab={searchTab} onTab={setSearchTab} />
                    : view.type === "library" ? <LibraryView />
                    : view.type === "liked" ? <LikedPage onWash={setWash} />
                    : view.type === "playlist" ? <PlaylistPage key={view.playlist.id} playlist={view.playlist} onWash={setWash} />
                    : view.type === "album" ? <AlbumPage key={view.album.id} album={view.album} onWash={setWash} />
                    : view.type === "artist" ? <ArtistPage key={view.artist.id} artist={view.artist} onWash={setWash} />
                    : null}
                </div>
              )}
            </div>
          </main>

          {prefs.right ? <NowPlayingPanel mode={prefs.right} onMode={(mode) => setPrefs({ right: mode })} onClose={() => setPrefs({ right: null })} onExpand={() => setFullscreen(true)} onLyrics={() => goTo({ type: "lyrics" })} /> : null}
        </div>

        <PlayerBar rightPanel={prefs.right} onRight={toggleRight} onExpand={() => setFullscreen(true)} lyricsOpen={view.type === "lyrics"} onLyrics={toggleLyrics} />
        {fullscreen ? <FullscreenPlayer onClose={() => setFullscreen(false)} /> : null}
        {menuHost.node}
        {toastHost.node}
        <NewPlaylistDialog open={Boolean(dialog)} busy={creating} onClose={() => setDialog(null)} onCreate={(name) => void createPlaylist(name)} />
      </div>
    </SpProvider>
  );
}

