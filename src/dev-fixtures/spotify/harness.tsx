/**
 * Visual QA harness for Clyra Music. Renders the real SpotifyWorkspace against
 * an in-memory mock of `useSpotifyPlayback` (no Electron, no Spotify account)
 * so layout, theming and interactions can be checked in a plain browser.
 *
 * Open /spotify-harness.html?state=connected|disconnected. Dev-only.
 */
import { StrictMode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { MORPH_EASE, MORPH_SHELL_MS, SpotifyNotchPanel, SpotifyNotchPill } from "../../components/chat/SpotifyNotch";
import type { SpotifyPlaybackHook } from "../../components/chat/SpotifyNotch";
import { SpotifyWorkspace } from "../../components/spotify/SpotifyWorkspace";
import type { SpotifyAlbum, SpotifyArtist, SpotifyBrowseKind, SpotifyBrowseResult, SpotifyPlaylist, SpotifyPlaylistItem, SpotifyTrack } from "../../lib/electron-runtime";
import "../../index.css";

function cover(seed: number, label = ""): string {
  const hue = (seed * 47) % 360;
  const hue2 = (hue + 50) % 360;
  const shape = seed % 3 === 0
    ? `<circle cx="150" cy="130" r="90" fill="hsl(${hue2} 80% 70% / .55)"/>`
    : seed % 3 === 1
      ? `<rect x="40" y="60" width="150" height="150" rx="24" fill="hsl(${hue2} 80% 72% / .5)" transform="rotate(14 120 140)"/>`
      : `<path d="M0 220 Q90 120 180 200 T300 150 V300 H0Z" fill="hsl(${hue2} 75% 68% / .55)"/>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hue} 78% 52%)"/><stop offset="1" stop-color="hsl(${hue2} 70% 34%)"/></linearGradient></defs><rect width="300" height="300" fill="url(#g)"/>${shape}<text x="20" y="278" font-family="Helvetica,Arial" font-weight="800" font-size="22" fill="rgba(255,255,255,.85)">${label}</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

const ARTIST_NAMES = ["Lumen Vale", "The Paper Kites Club", "Nova Rae", "Kaito Mori", "Sable & Stone", "Mira Okonkwo", "Harbor Lights", "Delta Coast"];
const ARTISTS: SpotifyArtist[] = ARTIST_NAMES.map((name, index) => ({
  id: `artist${String(index).padStart(10, "0")}`, name, uri: `spotify:artist:artist${String(index).padStart(10, "0")}`,
  images: [{ url: cover(index + 3, "") }], followers: { total: 1_200_000 + index * 311_222 }, genres: ["indie pop", "dream pop", "alt"],
}));
const ALBUM_NAMES = ["Midnight Radio", "Glass Gardens", "Golden Hour Static", "Slow Tide", "Neon Postcards", "Quiet Machines", "Paper Planes", "Afterglow Club", "Blue Hours", "Open Water", "Satellites", "Long Way Home"];
const ALBUMS: SpotifyAlbum[] = ALBUM_NAMES.map((name, index) => ({
  id: `album${String(index).padStart(11, "0")}`, name, uri: `spotify:album:album${String(index).padStart(11, "0")}`, images: [{ url: cover(index + 11, name.split(" ")[0]) }],
  artists: [{ name: ARTISTS[index % ARTISTS.length].name, id: ARTISTS[index % ARTISTS.length].id }], release_date: `${2016 + (index % 9)}-0${(index % 9) + 1}-12`, total_tracks: 9 + index, album_type: index % 4 === 3 ? "single" : "album",
}));
const TRACK_NAMES = ["Blue Hour", "Static Bloom", "Paper Moons", "Slow Burn Summer", "Glasshouse", "Echo Park Drive", "Halo Light", "Tidal", "Skyline Radio", "Wildflower Season", "Little Fires", "Afterimage", "Northern Lights", "Cherry Soda", "Daydream Logic", "Kingfisher", "Lanterns", "Harvest Moon", "Velvet Rain", "Orbit"];
const TRACKS: SpotifyTrack[] = TRACK_NAMES.map((name, index) => {
  const album = ALBUMS[index % ALBUMS.length];
  const artist = ARTISTS[index % ARTISTS.length];
  return {
    id: `track${String(index).padStart(11, "0")}`, name, uri: `spotify:track:track${String(index).padStart(11, "0")}`, duration_ms: 165_000 + index * 9_300,
    artists: index % 5 === 4 ? [{ name: artist.name, id: artist.id }, { name: ARTISTS[(index + 2) % 8].name, id: ARTISTS[(index + 2) % 8].id }] : [{ name: artist.name, id: artist.id }],
    album: { name: album.name, id: album.id, images: album.images }, explicit: index % 6 === 2,
  };
});
const PLAYLIST_NAMES = ["Daily Mix 1", "Chill Vibes", "Focus Flow", "Road Trip", "Morning Coffee", "Indie Mix", "Throwback Jams", "Deep Work", "Late Night Drive", "Sunday Reset", "Workout Fuel", "Rainy Day"];
const PLAYLISTS: SpotifyPlaylist[] = PLAYLIST_NAMES.map((name, index) => ({
  id: `playlist${String(index).padStart(9, "0")}`, name, uri: `spotify:playlist:playlist${String(index).padStart(9, "0")}`, images: [{ url: cover(index + 21, "") }],
  tracks: { total: 12 + index }, owner: { display_name: index % 3 === 0 ? "Spotify" : "Luke", id: index % 3 === 0 ? "spotify" : "me" },
}));

function useMockPlayback(): SpotifyPlaybackHook {
  const connected = new URLSearchParams(window.location.search).get("state") !== "disconnected";
  const [track, setTrack] = useState<SpotifyTrack | null>(new URLSearchParams(window.location.search).get("idle") ? null : TRACKS[0]);
  const [isPlaying, setIsPlaying] = useState(Boolean(track));
  const [progressMs, setProgress] = useState(48_000);
  const [volume, setVolume] = useState(62);
  const [shuffleOn, setShuffle] = useState(false);
  const [repeatMode, setRepeat] = useState<"off" | "track" | "context">("off");
  const [contextUri, setContextUri] = useState<string | null>(PLAYLISTS[1].uri);
  const [liked, setLikedMap] = useState<Record<string, boolean>>({ [TRACKS[0].id]: true, [TRACKS[2].id]: true, [TRACKS[5].id]: true });
  const [playlists, setPlaylists] = useState(PLAYLISTS);
  const [queue, setQueue] = useState(TRACKS.slice(1, 8));
  const likedRef = useRef(liked);
  likedRef.current = liked;

  useEffect(() => {
    if (!isPlaying || !track) return;
    const id = window.setInterval(() => setProgress((value) => (value + 1000 >= track.duration_ms ? 0 : value + 1000)), 1000);
    return () => window.clearInterval(id);
  }, [isPlaying, track]);

  const savedTracks = useMemo(() => TRACKS.filter((item) => liked[item.id]), [liked]);
  const play = useCallback(async (uri: string, from?: { contextUri?: string; uris?: string[] }) => {
    const next = TRACKS.find((item) => item.uri === uri) ?? TRACKS[1];
    setTrack(next); setIsPlaying(true); setProgress(0); setContextUri(from?.contextUri ?? null);
    return { ok: true };
  }, []);

  const browse = useCallback(async (kind: SpotifyBrowseKind, args: Record<string, unknown> = {}): Promise<SpotifyBrowseResult> => {
    await new Promise((resolve) => window.setTimeout(resolve, 120));
    const q = String(args.query ?? "").toLowerCase();
    switch (kind) {
      case "top-artists": return { ok: true, artists: ARTISTS.slice(0, 7) };
      case "top-tracks": return { ok: true, tracks: TRACKS.slice(3, 11) };
      case "saved-albums": return { ok: true, albums: ALBUMS.slice(0, 5) };
      case "followed-artists": return { ok: true, artists: ARTISTS.slice(1, 5) };
      case "artist": return { ok: true, artist: ARTISTS.find((item) => item.id === args.id) ?? ARTISTS[0] };
      case "artist-top-tracks": return { ok: true, tracks: TRACKS.filter((item) => item.artists.some((artist) => artist.id === args.id)).concat(TRACKS.slice(0, 6)).slice(0, 8) };
      case "artist-albums": return { ok: true, albums: ALBUMS.slice(0, 9) };
      case "album": { const album = ALBUMS.find((item) => item.id === args.id) ?? ALBUMS[0]; return { ok: true, album, tracks: TRACKS.slice(0, 9).map((item) => ({ ...item, album: { name: album.name, images: album.images } })) }; }
      case "is-following": return { ok: true, following: [false] };
      case "search-all": {
        const hit = (text: string) => !q || text.toLowerCase().includes(q) || q.length < 3;
        return { ok: true, tracks: TRACKS.filter((item) => hit(item.name) || hit(item.artists[0].name)).slice(0, 10), artists: ARTISTS.filter((item) => hit(item.name)).slice(0, 6), albums: ALBUMS.filter((item) => hit(item.name)).slice(0, 8), playlists: PLAYLISTS.filter((item) => hit(item.name)).slice(0, 6) };
      }
      case "create-playlist": { const created: SpotifyPlaylist = { id: `newplaylist${Date.now()}`.slice(0, 22).padEnd(12, "x"), name: String(args.name), uri: "spotify:playlist:new", images: [], tracks: { total: 0 }, owner: { display_name: "Luke", id: "me" } }; setPlaylists((current) => [created, ...current]); return { ok: true, playlist: created }; }
      default: return { ok: true };
    }
  }, []);

  return {
    available: true, connected, connecting: false, profile: { id: "me", displayName: "Luke Simpson", product: "premium" }, track, isPlaying, progressMs, device: { id: "d1", name: "Luke's MacBook", type: "Computer", is_active: true, volume_percent: volume }, volume, pct: track ? (progressMs / track.duration_ms) * 100 : 0, error: null,
    connect: () => undefined, disconnect: () => undefined,
    onToggle: () => setIsPlaying((value) => !value), onPrev: () => setProgress(0), onNext: () => { const i = TRACKS.findIndex((item) => item.id === track?.id); setTrack(TRACKS[(i + 1) % TRACKS.length]); setProgress(0); },
    onSeek: () => undefined, onVolumeDown: () => undefined, onVolumeWheel: () => undefined,
    seekTo: (ms: number) => setProgress(ms), setVolumePercent: setVolume,
    pause: async () => { setIsPlaying(false); return { ok: true }; }, resume: async () => { setIsPlaying(true); return { ok: true }; }, next: async () => ({ ok: true }), previous: async () => ({ ok: true }),
    playQuery: async () => ({ ok: true }), playTrending: async () => ({ ok: true }), verifyPlayback: async () => ({ ok: true }),
    playlists, refreshPlaylists: () => undefined, recentTracks: TRACKS.slice(2, 12), refreshRecentTracks: () => undefined, savedTracks, refreshSavedTracks: () => undefined,
    getPlaylistTracks: async (id: string) => ({ ok: true, items: TRACKS.slice(0, id.endsWith("0") || id.startsWith("newplaylist") ? 0 : 14).map((item, index): SpotifyPlaylistItem => ({ addedAt: new Date(Date.now() - index * 86_400_000 * 9).toISOString(), track: item })) }),
    devices: [{ id: "d1", name: "Luke's MacBook", type: "Computer", is_active: true }, { id: "d2", name: "iPhone", type: "Smartphone", is_active: false }], refreshDevices: () => undefined, transferToDevice: async () => ({ ok: true }),
    playTrackUri: play, playLikedSongs: async () => play(savedTracks[0]?.uri ?? TRACKS[0].uri), contextUri, recentContexts: [], startingDevice: false, needsReconnect: false,
    playPlaylistUri: async (uri: string) => { setContextUri(uri); setIsPlaying(true); setTrack(TRACKS[4]); setProgress(0); return { ok: true }; },
    lyricsForTrack: async () => ({ ok: true, lyrics: { synced: true, instrumental: false, source: "LRCLIB" as const, lines: Array.from({ length: 24 }, (_, index) => ({ timeMs: index * 6000, text: ["Streetlights hum a quiet tune", "Paint the window blue", "I keep counting every mile", "Back to you"][index % 4] })) } }),
    search: async (query: string) => ({ ok: true, tracks: TRACKS.filter((item) => item.name.toLowerCase().includes(query.toLowerCase())).slice(0, 10), playlists: [] }),
    shuffleOn, repeatMode, toggleShuffle: () => setShuffle((value) => !value), cycleRepeat: () => setRepeat((value) => (value === "off" ? "context" : value === "context" ? "track" : "off")),
    queue, refreshQueue: () => undefined, liked: Boolean(track && liked[track.id]),
    toggleSaveTrack: async () => { if (track) setLikedMap((current) => ({ ...current, [track.id]: !current[track.id] })); return { ok: true }; },
    addToQueue: async (uri: string) => { const item = TRACKS.find((entry) => entry.uri === uri); if (item) setQueue((current) => [...current, item]); return { ok: true }; },
    browse,
    likeUris: async (uris: string[], like: boolean) => { setLikedMap((current) => { const next = { ...current }; uris.forEach((uri) => { const item = TRACKS.find((entry) => entry.uri === uri); if (item) next[item.id] = like; }); return next; }); return { ok: true }; },
    checkLiked: async (uris: string[]) => uris.map((uri) => { const item = TRACKS.find((entry) => entry.uri === uri); return Boolean(item && likedRef.current[item.id]); }),
    playlistsChanged: () => undefined,
  } as SpotifyPlaybackHook;
}

/** ?notch=1 — the expanding notch shell exactly as App.tsx sizes it. Click it to toggle. */
function NotchHarness({ playback }: { playback: SpotifyPlaybackHook }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ position: "fixed", inset: 0, background: "#fff", display: "flex", justifyContent: "center", paddingTop: 60 }}>
      <div
        onClick={() => setOpen((v) => !v)}
        style={{
          position: "relative", overflow: "hidden", boxSizing: "border-box", background: "oklch(0.997 0.001 258)", border: "1px solid oklch(0.93 0.008 258)",
          width: open ? 424 : 176, height: open ? 196 : 40, borderRadius: open ? 38 : 20,
          boxShadow: open ? "0 30px 64px -22px oklch(0.42 0.06 260 / 0.34), 0 4px 12px -4px oklch(0.42 0.04 260 / 0.12)" : "0 10px 24px -14px oklch(0.42 0.04 260 / 0.45), 0 1px 3px oklch(0.42 0.04 260 / 0.07)",
          transition: `width ${MORPH_SHELL_MS}ms ${MORPH_EASE}, height ${MORPH_SHELL_MS}ms ${MORPH_EASE}, border-radius ${MORPH_SHELL_MS}ms ${MORPH_EASE}, box-shadow 0.32s ease`,
        }}
      >
        <SpotifyNotchPill visible={!open} playback={playback} />
        <SpotifyNotchPanel visible={open} playback={playback} onExpand={() => undefined} onDismiss={() => undefined} />
      </div>
    </div>
  );
}

function Harness() {
  const playback = useMockPlayback();
  if (new URLSearchParams(window.location.search).get("notch")) return <NotchHarness playback={playback} />;
  return (
    <div style={{ position: "fixed", inset: 0, background: "#fff" }}>
      <SpotifyWorkspace playback={playback} />
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<StrictMode><Harness /></StrictMode>);
