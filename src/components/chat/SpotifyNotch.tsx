/**
 * Spotify ambient notch — layout ported from the Claude Design Canvas
 * artboard `Notch Player.html` (song pill that expands into a full mini
 * player on hover/click), now backed by a real Spotify connection instead of
 * placeholder data.
 *
 * Auth: Clyra's Electron main process owns the whole OAuth 2.0 Authorization
 * Code + PKCE exchange (electron/spotify-manager.mjs) — this hook only calls
 * the `window.clyraDesktop.spotify` bridge (see src/lib/electron-runtime.ts)
 * and never sees a token, a Client Secret, or any credential. Running in a
 * plain browser tab (no Electron bridge) shows a "desktop app" notice
 * instead of a broken connect button.
 *
 * This notch shares its outer pill shell with the app's workspace tab
 * switcher (see App.tsx) — the shell itself (background/size/radius/shadow)
 * lives there, so this file only exports the headless playback state and the
 * absolutely-positioned content layers that get dropped into that shell.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { getElectronDesktop } from "../../lib/electron-runtime";
import type { SpotifyDevice, SpotifyPlaylist, SpotifyPlaylistItem, SpotifyProfile, SpotifyTrack } from "../../lib/electron-runtime";

type RepeatMode = "off" | "track" | "context";

const EASE = "cubic-bezier(0.22,0.92,0.26,1.01)";
const POLL_MS = 4000;

// Shared timing for the morph between the workspace-tab pill and the notch
// (used by both this file's own pill/panel reveal and App.tsx's tabs layer +
// shell, so the "hide elements -> resize the shell -> reveal new content"
// sequence stays in lockstep everywhere it happens).
export const MORPH_EASE = "cubic-bezier(.22,.9,.24,1)";
export const MORPH_HIDE_MS = 180;
export const MORPH_REVEAL_MS = 360;
export const MORPH_REVEAL_DELAY_MS = 460;
export const MORPH_SHELL_MS = 600;
export const MORPH_SHELL_DELAY_MS = 140;

function fmt(ms: number) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export type SpotifyPlaybackHook = {
  /** The Electron desktop bridge (and therefore Spotify) is present. */
  available: boolean;
  connected: boolean;
  connecting: boolean;
  profile: SpotifyProfile | null;
  track: SpotifyTrack | null;
  isPlaying: boolean;
  progressMs: number;
  device: SpotifyDevice | null;
  volume: number;
  pct: number;
  error: string | null;
  connect: () => void;
  disconnect: () => void;
  onToggle: (e: React.MouseEvent) => void;
  onPrev: (e: React.MouseEvent) => void;
  onNext: (e: React.MouseEvent) => void;
  onSeek: (e: React.MouseEvent<HTMLDivElement>) => void;
  onVolumeDown: (e: React.MouseEvent<HTMLDivElement>) => void;
  onVolumeWheel: (e: React.WheelEvent<HTMLDivElement>) => void;
  /** Value-based controls let the full player support keyboard sliders too. */
  seekTo: (positionMs: number) => void;
  setVolumePercent: (percent: number) => void;
  // Chat-driven controls ("pause the music", "skip", "play X") — distinct
  // from the onX handlers above, which are wired to player-button clicks.
  pause: () => Promise<{ ok: boolean; error?: string; code?: string }>;
  resume: () => Promise<{ ok: boolean; error?: string; code?: string }>;
  next: () => Promise<{ ok: boolean; error?: string; code?: string }>;
  previous: () => Promise<{ ok: boolean; error?: string; code?: string }>;
  playQuery: (query: string) => Promise<{ ok: boolean; error?: string; trackName?: string; artistName?: string }>;
  playTrending: () => Promise<{ ok: boolean; error?: string; playlistName?: string }>;
  verifyPlayback: (expected: "playing" | "paused" | "available") => Promise<{ ok: boolean; error?: string }>;
  // Full-app (Home/Search/Library) support.
  playlists: SpotifyPlaylist[];
  refreshPlaylists: () => void;
  recentTracks: SpotifyTrack[];
  refreshRecentTracks: () => void;
  savedTracks: SpotifyTrack[];
  refreshSavedTracks: () => void;
  getPlaylistTracks: (playlistId: string) => Promise<{ ok: boolean; items?: SpotifyPlaylistItem[]; error?: string }>;
  devices: SpotifyDevice[];
  refreshDevices: () => void;
  transferToDevice: (deviceId: string) => Promise<{ ok: boolean; error?: string }>;
  playTrackUri: (uri: string) => Promise<{ ok: boolean; error?: string }>;
  playPlaylistUri: (uri: string) => Promise<{ ok: boolean; error?: string }>;
  search: (query: string, types?: string, limit?: number) => Promise<{ ok: boolean; tracks?: SpotifyTrack[]; playlists?: SpotifyPlaylist[]; error?: string }>;
  // Shuffle/repeat + the real up-next queue (Spotify Web API's `/me/player/queue`).
  shuffleOn: boolean;
  repeatMode: RepeatMode;
  toggleShuffle: () => void;
  cycleRepeat: () => void;
  queue: SpotifyTrack[];
  refreshQueue: () => void;
  liked: boolean;
  toggleSaveTrack: () => Promise<{ ok: boolean; error?: string }>;
  addToQueue: (uri: string) => Promise<{ ok: boolean; error?: string }>;
};

/** `active` gates background polling — pass `showSpotifyNotch` so Clyra only
 *  talks to Spotify while the notch is actually visible. */
export function useSpotifyPlayback(active: boolean): SpotifyPlaybackHook {
  const desktop = getElectronDesktop();
  const spotify = desktop?.spotify;
  const available = Boolean(spotify);

  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [profile, setProfile] = useState<SpotifyProfile | null>(null);
  const [track, setTrack] = useState<SpotifyTrack | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [progressMs, setProgressMs] = useState(0);
  const [device, setDevice] = useState<SpotifyDevice | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [playlists, setPlaylists] = useState<SpotifyPlaylist[]>([]);
  const [recentTracks, setRecentTracks] = useState<SpotifyTrack[]>([]);
  const [savedTracks, setSavedTracks] = useState<SpotifyTrack[]>([]);
  const [devices, setDevices] = useState<SpotifyDevice[]>([]);
  const [shuffleOn, setShuffleOn] = useState(false);
  const [repeatMode, setRepeatMode] = useState<RepeatMode>("off");
  const [queue, setQueue] = useState<SpotifyTrack[]>([]);
  const [liked, setLiked] = useState(false);

  // Volume: `volume` is the immediate drag/wheel target; `displayVolume`
  // eases toward it every frame so both the fader and the printed
  // percentage glide smoothly instead of snapping straight to the cursor.
  const [volume, setVolume] = useState(50);
  const [displayVolume, setDisplayVolume] = useState(50);
  const volumeRef = useRef(50);
  const dragRectRef = useRef<DOMRect | null>(null);
  const volumeCommitTimer = useRef<number | null>(null);

  // Initial status + live auth-state updates from the main process.
  useEffect(() => {
    if (!spotify) return;
    let cancelled = false;
    spotify.status().then((res) => {
      if (cancelled) return;
      setConnected(res.connected);
      setProfile(res.profile ?? null);
    }).catch(() => undefined);
    const unsubscribe = spotify.onAuthState((payload) => {
      setConnecting(Boolean(payload.pending));
      setConnected(payload.connected);
      if (payload.profile !== undefined) setProfile(payload.profile ?? null);
      setError(payload.error ?? null);
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [spotify]);

  const refreshPlayback = useCallback(async () => {
    if (!spotify || !connected) return;
    const res = await spotify.playbackState().catch(() => null);
    if (!res?.ok) {
      if (res?.code === "SPOTIFY_SIGN_IN_REQUIRED") {
        // Tokens were revoked or refresh failed — the manager already
        // cleared them on its side, so reflect that back as disconnected.
        setConnected(false);
        setTrack(null);
        setDevice(null);
      } else if (res?.error) {
        // A real Spotify account/plan restriction (e.g. Web API access
        // needs an active Premium subscription on the app owner's
        // account) — surface it instead of quietly showing "Not playing".
        setError(res.error);
      }
      return;
    }
    setError(null);
    const state = res.state;
    if (!state) {
      setTrack(null);
      setIsPlaying(false);
      setDevice(null);
      return;
    }
    setTrack(state.item ?? null);
    setIsPlaying(Boolean(state.is_playing));
    setProgressMs(Number(state.progress_ms || 0));
    setDevice(state.device ?? null);
    setShuffleOn(Boolean(state.shuffle_state));
    if (state.repeat_state === "track" || state.repeat_state === "context" || state.repeat_state === "off") {
      setRepeatMode(state.repeat_state);
    }
    if (typeof state.device?.volume_percent === "number") {
      volumeRef.current = state.device.volume_percent;
      setVolume(state.device.volume_percent);
    }
  }, [spotify, connected]);

  const refreshLiked = useCallback(async (currentTrack: SpotifyTrack | null) => {
    if (!spotify || !currentTrack?.uri) {
      setLiked(false);
      return;
    }
    const res = await spotify.libraryContains([currentTrack.uri]).catch(() => null);
    if (res?.ok) setLiked(Boolean(res.contains?.[0]));
  }, [spotify]);

  useEffect(() => {
    void refreshLiked(track);
  }, [track?.uri, refreshLiked]);

  // Poll only while the notch is actually visible.
  useEffect(() => {
    if (!active || !connected) return;
    void refreshPlayback();
    const id = window.setInterval(() => void refreshPlayback(), POLL_MS);
    return () => window.clearInterval(id);
  }, [active, connected, refreshPlayback]);

  // Smoothly advance progress between polls so it doesn't sit frozen for 4s.
  useEffect(() => {
    if (!active || !isPlaying || !track) return;
    const id = window.setInterval(() => {
      setProgressMs((p) => Math.min(track.duration_ms, p + 1000));
    }, 1000);
    return () => window.clearInterval(id);
  }, [active, isPlaying, track]);

  useEffect(() => {
    let raf: number;
    const tick = () => {
      setDisplayVolume((d) => {
        const target = volumeRef.current;
        const diff = target - d;
        if (Math.abs(diff) < 0.05) return target;
        return d + diff * 0.22;
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const connect = useCallback(() => {
    if (!spotify) return;
    setConnecting(true);
    setError(null);
    void spotify.signIn().then((res) => {
      if (!res.ok) {
        setConnecting(false);
        setError(res.error ?? "Spotify sign-in could not start.");
      }
    });
  }, [spotify]);

  const disconnect = useCallback(() => {
    if (!spotify) return;
    void spotify.disconnect().then(() => {
      setConnected(false);
      setProfile(null);
      setTrack(null);
    });
  }, [spotify]);

  const commitVolume = useCallback(
    (percent: number) => {
      if (!spotify) return;
      void spotify.control({ action: "volume", volumePercent: Math.round(percent) }).catch(() => undefined);
    },
    [spotify],
  );

  const setFromX = (clientX: number, rect: DOMRect) => {
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const percent = Math.round(ratio * 100);
    volumeRef.current = percent;
    setVolume(percent);
    return percent;
  };

  const onVolumeDown = (e: React.MouseEvent<HTMLDivElement>) => {
    e.stopPropagation();
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    dragRectRef.current = rect;
    let latest = setFromX(e.clientX, rect);
    const move = (ev: MouseEvent) => {
      if (dragRectRef.current) latest = setFromX(ev.clientX, dragRectRef.current);
    };
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      commitVolume(latest);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  const onVolumeWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    e.stopPropagation();
    const d = (e.deltaY || e.deltaX) > 0 ? -4 : 4;
    const next = Math.max(0, Math.min(100, volumeRef.current + d));
    volumeRef.current = next;
    setVolume(next);
    if (volumeCommitTimer.current) window.clearTimeout(volumeCommitTimer.current);
    volumeCommitTimer.current = window.setTimeout(() => commitVolume(next), 260);
  };

  const setVolumePercent = useCallback((percent: number) => {
    const next = Math.max(0, Math.min(100, Math.round(percent)));
    volumeRef.current = next;
    setVolume(next);
    // Native range inputs emit continuously during a drag.  Keep the UI
    // immediate but coalesce the remote writes, then the next player poll
    // confirms Spotify Connect's actual device volume.
    if (volumeCommitTimer.current) window.clearTimeout(volumeCommitTimer.current);
    volumeCommitTimer.current = window.setTimeout(() => commitVolume(next), 180);
  }, [commitVolume]);

  const seekTo = useCallback((positionMs: number) => {
    if (!spotify || !track) return;
    const next = Math.max(0, Math.min(track.duration_ms, positionMs));
    setProgressMs(next);
    void spotify.control({ action: "seek", positionMs: next }).catch(() => undefined);
  }, [spotify, track]);

  const onSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    e.stopPropagation();
    if (!track) return;
    const r = e.currentTarget.getBoundingClientRect();
    seekTo(((e.clientX - r.left) / r.width) * track.duration_ms);
  };

  const onPrev = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!spotify) return;
    void spotify.control({ action: "previous" }).then(() => window.setTimeout(refreshPlayback, 400)).catch(() => undefined);
  };
  const onNext = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!spotify) return;
    void spotify.control({ action: "next" }).then(() => window.setTimeout(refreshPlayback, 400)).catch(() => undefined);
  };
  const onToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!spotify) return;
    const next = !isPlaying;
    setIsPlaying(next);
    void spotify.control({ action: next ? "play" : "pause" }).then(() => window.setTimeout(refreshPlayback, 400)).catch(() => undefined);
  };

  // Explicit pause/resume/next/previous — used by chat-driven commands
  // ("pause the music", "skip"), distinct from onToggle's flip-current-state
  // used by the player button itself.
  const pause = useCallback(async () => {
    if (!spotify) return { ok: false, error: "Spotify is only available in the Clyra desktop app." };
    setIsPlaying(false);
    const res = await spotify.control({ action: "pause" });
    window.setTimeout(refreshPlayback, 400);
    return res;
  }, [spotify, refreshPlayback]);

  const resume = useCallback(async () => {
    if (!spotify) return { ok: false, error: "Spotify is only available in the Clyra desktop app." };
    setIsPlaying(true);
    const res = await spotify.control({ action: "play" });
    window.setTimeout(refreshPlayback, 400);
    return res;
  }, [spotify, refreshPlayback]);

  const next = useCallback(async () => {
    if (!spotify) return { ok: false, error: "Spotify is only available in the Clyra desktop app." };
    const res = await spotify.control({ action: "next" });
    window.setTimeout(refreshPlayback, 400);
    return res;
  }, [spotify, refreshPlayback]);

  const previous = useCallback(async () => {
    if (!spotify) return { ok: false, error: "Spotify is only available in the Clyra desktop app." };
    const res = await spotify.control({ action: "previous" });
    window.setTimeout(refreshPlayback, 400);
    return res;
  }, [spotify, refreshPlayback]);

  /** Read Spotify Connect back after a command. A successful mutation response
   * alone is not proof that the selected device actually changed state. */
  const verifyPlayback = useCallback(async (expected: "playing" | "paused" | "available") => {
    if (!spotify) return { ok: false, error: "Spotify is only available in the Clyra desktop app." };
    // Spotify Connect is eventually consistent; a short bounded delay avoids
    // accepting a stale state while never turning a playback request into an
    // unbounded wait loop.
    await new Promise((resolve) => window.setTimeout(resolve, 650));
    const result = await spotify.playbackState();
    if (!result.ok) return { ok: false, error: result.error || "Spotify playback could not be verified." };
    const state = result.state;
    const ok = expected === "available"
      ? Boolean(state?.item)
      : expected === "playing"
        ? Boolean(state?.is_playing && state.item)
        : Boolean(state && !state.is_playing);
    if (ok) {
      void refreshPlayback();
      return { ok: true };
    }
    return { ok: false, error: expected === "playing" ? "Spotify did not report active playback." : expected === "paused" ? "Spotify did not report paused playback." : "Spotify did not report an active track." };
  }, [spotify, refreshPlayback]);

  /** Search Spotify for `query` and start playing the first matching track. */
  const playQuery = useCallback(
    async (query: string): Promise<{ ok: boolean; error?: string; trackName?: string; artistName?: string }> => {
      if (!spotify) return { ok: false, error: "Spotify is only available in the Clyra desktop app." };
      const res = await spotify.search(query, "track", 1);
      if (!res.ok) return { ok: false, error: res.error || "Spotify search failed." };
      const found = res.tracks?.[0];
      if (!found) return { ok: false, error: `No Spotify track matched "${query}".` };
      const playRes = await spotify.control({ action: "play", uris: [found.uri] });
      if (!playRes.ok) return { ok: false, error: playRes.error || "Couldn't start playback — is a Spotify device active?" };
      window.setTimeout(refreshPlayback, 600);
      return { ok: true, trackName: found.name, artistName: found.artists.map((a) => a.name).join(", ") };
    },
    [spotify, refreshPlayback],
  );

  /** Play a well-known trending/top-hits playlist — Spotify's Web API has no
   *  direct "trending" endpoint, so this resolves it via search. */
  const playTrending = useCallback(async (): Promise<{ ok: boolean; error?: string; playlistName?: string }> => {
    if (!spotify) return { ok: false, error: "Spotify is only available in the Clyra desktop app." };
    const res = await spotify.search("Today's Top Hits", "playlist", 1);
    if (!res.ok) return { ok: false, error: res.error || "Spotify search failed." };
    const playlist = res.playlists?.[0];
    if (!playlist) return { ok: false, error: "Couldn't find a trending playlist." };
    const playRes = await spotify.control({ action: "play", contextUri: playlist.uri });
    if (!playRes.ok) return { ok: false, error: playRes.error || "Couldn't start playback — is a Spotify device active?" };
    window.setTimeout(refreshPlayback, 600);
    return { ok: true, playlistName: playlist.name };
  }, [spotify, refreshPlayback]);

  const refreshPlaylists = useCallback(() => {
    if (!spotify) return;
    void spotify.playlists().then((res) => {
      if (res.ok) setPlaylists(res.playlists ?? []);
    });
  }, [spotify]);

  const refreshRecentTracks = useCallback(() => {
    if (!spotify) return;
    void spotify.recentlyPlayed().then((res) => {
      if (res.ok) setRecentTracks(res.tracks ?? []);
    });
  }, [spotify]);

  const refreshSavedTracks = useCallback(() => {
    if (!spotify) return;
    void spotify.savedTracks().then((res) => {
      if (res.ok) setSavedTracks(res.tracks ?? []);
    });
  }, [spotify]);

  // Load the library once on connect, for the full Home/Library views.
  useEffect(() => {
    if (!connected) return;
    refreshPlaylists();
    refreshRecentTracks();
    refreshSavedTracks();
  }, [connected, refreshPlaylists, refreshRecentTracks, refreshSavedTracks]);

  const playTrackUri = useCallback(
    async (uri: string) => {
      if (!spotify) return { ok: false, error: "Spotify is only available in the Clyra desktop app." };
      const res = await spotify.control({ action: "play", uris: [uri] });
      window.setTimeout(refreshPlayback, 500);
      return res;
    },
    [spotify, refreshPlayback],
  );

  const playPlaylistUri = useCallback(
    async (uri: string) => {
      if (!spotify) return { ok: false, error: "Spotify is only available in the Clyra desktop app." };
      const res = await spotify.control({ action: "play", contextUri: uri });
      window.setTimeout(refreshPlayback, 500);
      return res;
    },
    [spotify, refreshPlayback],
  );

  const search = useCallback(
    async (query: string, types = "track,playlist", limit = 10) => {
      if (!spotify) return { ok: false, error: "Spotify is only available in the Clyra desktop app." };
      return spotify.search(query, types, limit);
    },
    [spotify],
  );

  const refreshDevices = useCallback(() => {
    if (!spotify) return;
    void spotify.devices().then((res) => {
      if (res.ok) setDevices(res.devices ?? []);
    });
  }, [spotify]);

  const transferToDevice = useCallback(
    async (deviceId: string) => {
      if (!spotify) return { ok: false, error: "Spotify is only available in the Clyra desktop app." };
      const res = await spotify.control({ action: "transfer", deviceId, play: true });
      window.setTimeout(refreshPlayback, 500);
      return res;
    },
    [spotify, refreshPlayback],
  );

  const getPlaylistTracks = useCallback(
    async (playlistId: string) => {
      if (!spotify) return { ok: false, error: "Spotify is only available in the Clyra desktop app." };
      return spotify.playlistTracks(playlistId);
    },
    [spotify],
  );

  const refreshQueue = useCallback(() => {
    if (!spotify) return;
    void spotify.queue().then((res) => {
      if (res.ok) setQueue(res.queue?.queue ?? []);
    });
  }, [spotify]);

  const addToQueue = useCallback(async (uri: string) => {
    if (!spotify) return { ok: false, error: "Spotify is only available in the Clyra desktop app." };
    const result = await spotify.control({ action: "queue", uri });
    if (result.ok) window.setTimeout(refreshQueue, 350);
    return result;
  }, [spotify, refreshQueue]);

  const toggleSaveTrack = useCallback(async () => {
    if (!spotify || !track?.uri) return { ok: false, error: "Choose a track before changing your Library." };
    const shouldSave = !liked;
    // This is an optimistic update backed by the current generic 2026 Library
    // API. Revert immediately if Spotify rejects the change (scope, account,
    // or network errors are never presented as a fake liked state).
    setLiked(shouldSave);
    const result = shouldSave ? await spotify.saveLibrary([track.uri]) : await spotify.removeLibrary([track.uri]);
    if (!result.ok) {
      setLiked(!shouldSave);
      setError(result.error || "Spotify couldn't update your Library.");
    } else {
      setSavedTracks((items) => shouldSave
        ? (items.some((item) => item.id === track.id) ? items : [track, ...items])
        : items.filter((item) => item.id !== track.id));
      setError(null);
    }
    return result;
  }, [spotify, track?.uri, liked]);

  // Keep the up-next list current while the full workspace/notch is open.
  useEffect(() => {
    if (!active || !connected) return;
    void refreshQueue();
    const id = window.setInterval(() => void refreshQueue(), POLL_MS * 2);
    return () => window.clearInterval(id);
  }, [active, connected, refreshQueue]);

  const toggleShuffle = useCallback(() => {
    if (!spotify) return;
    const next = !shuffleOn;
    setShuffleOn(next);
    void spotify.control({ action: "shuffle", state: next }).catch(() => undefined);
  }, [spotify, shuffleOn]);

  const cycleRepeat = useCallback(() => {
    if (!spotify) return;
    const order: RepeatMode[] = ["off", "context", "track"];
    const next = order[(order.indexOf(repeatMode) + 1) % order.length];
    setRepeatMode(next);
    void spotify.control({ action: "repeat", state: next }).catch(() => undefined);
  }, [spotify, repeatMode]);

  const pct = track ? (progressMs / track.duration_ms) * 100 : 0;

  return {
    available,
    connected,
    connecting,
    profile,
    track,
    isPlaying,
    progressMs,
    device,
    volume: Math.round(displayVolume),
    pct,
    error,
    connect,
    disconnect,
    onToggle,
    onPrev,
    onNext,
    onSeek,
    onVolumeDown,
    onVolumeWheel,
    seekTo,
    setVolumePercent,
    pause,
    resume,
    next,
    previous,
    playQuery,
    playTrending,
    verifyPlayback,
    playlists,
    refreshPlaylists,
    recentTracks,
    refreshRecentTracks,
    savedTracks,
    refreshSavedTracks,
    getPlaylistTracks,
    playTrackUri,
    playPlaylistUri,
    search,
    devices,
    refreshDevices,
    transferToDevice,
    shuffleOn,
    repeatMode,
    toggleShuffle,
    cycleRepeat,
    queue,
    refreshQueue,
    liked,
    toggleSaveTrack,
    addToQueue,
  };
}

const PILL_BARS = [
  { anim: "clyraNotchV1", delay: "0s", dur: "1.05s" },
  { anim: "clyraNotchV3", delay: "0.1s", dur: "1.35s" },
  { anim: "clyraNotchV2", delay: "0.22s", dur: "1.2s" },
  { anim: "clyraNotchV5", delay: "0.05s", dur: "1.5s" },
];

const PANEL_BARS = [
  { anim: "clyraNotchV2", delay: "0s", dur: "1.2s" },
  { anim: "clyraNotchV4", delay: "0.12s", dur: "0.95s" },
  { anim: "clyraNotchV1", delay: "0.05s", dur: "1.45s" },
  { anim: "clyraNotchV5", delay: "0.2s", dur: "1.15s" },
  { anim: "clyraNotchV3", delay: "0.08s", dur: "1.6s" },
];

function Waveform({ bars, playing, size }: { bars: typeof PILL_BARS; playing: boolean; size: { w: number; h: number; gap: number } }) {
  return (
    <>
      {bars.map((b, i) => (
        <div
          key={i}
          style={{
            width: size.w,
            height: size.h,
            borderRadius: 2,
            transformOrigin: size.h > 20 ? "bottom" : "center",
            background: "linear-gradient(180deg,oklch(0.7 0.14 250),oklch(0.58 0.18 258))",
            animation: playing ? `${b.anim} ${b.dur} ease-in-out infinite ${b.delay}` : "none",
            transform: playing ? undefined : "scaleY(0.3)",
            transition: "transform 0.3s ease",
          }}
        />
      ))}
    </>
  );
}

export function SpotifyNotchPill({ visible, playback }: { visible: boolean; playback: SpotifyPlaybackHook }) {
  const { connected, track, isPlaying } = playback;
  const label = !connected ? "Connect Clyra Music" : track ? track.name : "Not playing";
  return (
    <div
      style={{
        position: "absolute",
        left: "50%",
        top: 0,
        transform: "translateX(-50%)",
        width: 176,
        height: 40,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "0 7px 0 8px",
        boxSizing: "border-box",
        pointerEvents: "none",
        transition: visible
          ? `opacity ${MORPH_REVEAL_MS}ms ease ${MORPH_REVEAL_DELAY_MS}ms`
          : `opacity ${MORPH_HIDE_MS}ms ease`,
        opacity: visible ? 1 : 0,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
        {track?.album?.images?.[track.album.images.length - 1]?.url || track?.album?.images?.[0]?.url ? (
          <img src={track.album.images[track.album.images.length - 1]?.url || track.album.images[0]?.url} alt="" style={{ width: 22, height: 22, borderRadius: 6, display: "block", flexShrink: 0, objectFit: "cover" }} />
        ) : (
          <img src="/icons/clyra-music.svg" alt="" style={{ width: 22, height: 22, borderRadius: 6, display: "block", flexShrink: 0 }} />
        )}
        <div style={{ fontSize: 11.5, fontWeight: 500, letterSpacing: "0.01em", color: "oklch(0.42 0.02 260)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {label}
        </div>
      </div>
      {connected && track ? (
        <div style={{ display: "flex", alignItems: "center", gap: 2.5, height: 16, paddingRight: 4, flexShrink: 0 }}>
          <Waveform bars={PILL_BARS} playing={isPlaying} size={{ w: 2.5, h: 16, gap: 2.5 }} />
        </div>
      ) : null}
    </div>
  );
}

/** Spotify's Web API 403s different developer-app account restrictions with
 *  different plain-text messages. Both are account-level Spotify rules —
 *  nothing Clyra's code can change — but they need different fixes, so this
 *  maps the raw error text to the right explanation + guidance. */
function spotifyAccessBlockInfo(error: string | null): { title: string; body: ReactNode; hint: string } | null {
  if (!error) return null;
  if (/premium/i.test(error)) {
    return {
      title: "This Spotify account needs Premium",
      body: (
        <>
          Spotify only allows API access — even basic things like seeing what's playing — when the connected account
          has an active <strong>Spotify Premium</strong> subscription.
        </>
      ),
      hint: "Upgrade this account to Premium, or connect with a different Spotify account that already has it.",
    };
  }
  if (/not be registered|may not be registered|user.*not.*registered/i.test(error)) {
    return {
      title: "This Spotify account isn't allowed yet",
      body: (
        <>
          While this app is in <strong>Development Mode</strong> on Spotify, only accounts explicitly added under{" "}
          <strong>Users and Access</strong> in the Spotify Developer Dashboard can use it — even the app owner's own
          account has to be listed there.
        </>
      ),
      hint: "Open developer.spotify.com/dashboard → your app → Settings → User Management, and add this Spotify account's email.",
    };
  }
  return {
    title: "Spotify blocked this request",
    body: <>Spotify's API rejected the request. This is coming from Spotify's account/app settings, not Clyra.</>,
    hint: "Check your app's settings at developer.spotify.com/dashboard for what's restricted.",
  };
}

function ConnectPrompt({ playback }: { playback: SpotifyPlaybackHook }) {
  const { available, connected, connecting, error, connect, disconnect } = playback;
  const blockInfo = connected ? spotifyAccessBlockInfo(error) : null;
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", gap: 10, padding: "8px 4px" }}>
      <img src="/icons/clyra-music.svg" alt="" style={{ width: 40, height: 40, borderRadius: 10 }} />
      {!available ? (
        <>
          <div style={{ fontSize: 13.5, fontWeight: 600, color: "#15171C" }}>Clyra Music is a desktop feature</div>
          <div style={{ fontSize: 12, color: "oklch(0.55 0.02 260)", maxWidth: 260 }}>Open Clyra's desktop app to connect Spotify and control your music from here.</div>
        </>
      ) : blockInfo ? (
        <>
          <div style={{ fontSize: 13.5, fontWeight: 600, color: "#15171C" }}>{blockInfo.title}</div>
          <div style={{ fontSize: 12, lineHeight: 1.5, color: "oklch(0.55 0.02 260)", maxWidth: 290 }}>{blockInfo.body}</div>
          <div style={{ fontSize: 11.5, lineHeight: 1.5, color: "oklch(0.6 0.02 260)", maxWidth: 290 }}>{blockInfo.hint}</div>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              disconnect();
              window.setTimeout(connect, 250);
            }}
            style={{
              marginTop: 2,
              display: "flex",
              alignItems: "center",
              gap: 8,
              height: 36,
              padding: "0 18px",
              borderRadius: 999,
              border: "none",
              cursor: "pointer",
              background: "#3B82F6",
              color: "#fff",
              fontSize: 13,
              fontWeight: 600,
            }}
          >
            Try a different Spotify account
          </button>
          <div style={{ fontSize: 10.5, color: "oklch(0.65 0.015 260)", maxWidth: 290 }}>
            If Spotify signs you straight back into the same account, log out of Spotify in your browser first.
          </div>
        </>
      ) : connected ? (
        <>
          <div style={{ fontSize: 13.5, fontWeight: 600, color: "#15171C" }}>Clyra Music is connected</div>
          <div style={{ fontSize: 12, color: "oklch(0.55 0.02 260)", maxWidth: 280 }}>
            {error || "Nothing is playing right now — start something on Spotify and it'll show up here."}
          </div>
        </>
      ) : (
        <>
          <div style={{ fontSize: 13.5, fontWeight: 600, color: "#15171C" }}>Connect Clyra Music</div>
          <div style={{ fontSize: 12, color: "oklch(0.55 0.02 260)", maxWidth: 260 }}>
            {connecting ? "Waiting for you to approve access in the browser…" : "Sign in with Spotify to see what's playing and control it here."}
          </div>
          {error ? <div style={{ fontSize: 11.5, color: "#B3261E" }}>{error}</div> : null}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              connect();
            }}
            disabled={connecting}
            style={{
              marginTop: 2,
              display: "flex",
              alignItems: "center",
              gap: 8,
              height: 36,
              padding: "0 18px",
              borderRadius: 999,
              border: "none",
              cursor: connecting ? "default" : "pointer",
              background: "#3B82F6",
              color: "#fff",
              fontSize: 13,
              fontWeight: 600,
              opacity: connecting ? 0.7 : 1,
            }}
          >
            {connecting ? "Connecting…" : "Connect Spotify"}
          </button>
        </>
      )}
    </div>
  );
}

export function SpotifyNotchPanel({
  visible,
  playback,
  onExpand,
}: {
  visible: boolean;
  playback: SpotifyPlaybackHook;
  /** Opens the full Home/Search/Library Clyra Music workspace. */
  onExpand?: () => void;
}) {
  const { connected, track, isPlaying, progressMs, volume, pct, onSeek, onPrev, onNext, onToggle, onVolumeDown, onVolumeWheel } = playback;
  const showPlayer = connected && track;
  return (
    <div
      style={{
        position: "absolute",
        left: "50%",
        top: 0,
        width: 424,
        padding: "20px 22px 18px",
        boxSizing: "border-box",
        display: "flex",
        flexDirection: "column",
        gap: 15,
        justifyContent: showPlayer ? "flex-start" : "center",
        minHeight: showPlayer ? undefined : 196,
        transition: visible
          ? `opacity ${MORPH_REVEAL_MS}ms ease ${MORPH_REVEAL_DELAY_MS}ms, transform ${MORPH_REVEAL_MS}ms ${MORPH_EASE} ${MORPH_REVEAL_DELAY_MS}ms`
          : `opacity ${MORPH_HIDE_MS}ms ease, transform ${MORPH_HIDE_MS}ms ${MORPH_EASE}`,
        opacity: visible ? 1 : 0,
        transform: visible
          ? "translateX(-50%) translateY(0) scale(1)"
          : "translateX(-50%) translateY(-10px) scale(0.93)",
        pointerEvents: visible ? "auto" : "none",
      }}
    >
      {onExpand && connected ? (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onExpand();
          }}
          title="Open Clyra Music"
          style={{
            position: "absolute",
            top: 14,
            right: 16,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 26,
            height: 26,
            borderRadius: "50%",
            border: "none",
            background: "oklch(0.95 0.008 258)",
            color: "oklch(0.42 0.02 260)",
            cursor: "pointer",
          }}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 3H3v6M15 21h6v-6M21 3l-7 7M3 21l7-7" />
          </svg>
        </button>
      ) : null}
      {!showPlayer ? (
        <ConnectPrompt playback={playback} />
      ) : (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 15 }}>
            <div
              style={{
                position: "relative",
                width: 66,
                height: 66,
                borderRadius: 16,
                flex: "0 0 auto",
                overflow: "hidden",
                background: "linear-gradient(145deg,oklch(0.91 0.05 250),oklch(0.8 0.1 260))",
                boxShadow: "0 10px 22px -12px oklch(0.45 0.1 258 / 0.7),inset 0 0 0 1px oklch(1 0 0 / 0.35)",
              }}
            >
              {track.album?.images?.[0]?.url ? (
                <img src={track.album.images[0].url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              ) : null}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 5, minWidth: 0, flex: "1 1 auto" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                <img src="/icons/clyra-music.svg" alt="" style={{ width: 15, height: 15, borderRadius: 4, display: "block", flexShrink: 0 }} />
                <div
                  style={{
                    fontFamily: "ui-monospace,'SF Mono',Menlo,monospace",
                    fontSize: 9,
                    letterSpacing: "0.14em",
                    textTransform: "uppercase",
                    color: "oklch(0.62 0.02 260)",
                  }}
                >
                  Clyra Music
                </div>
              </div>
              <div
                style={{
                  fontSize: 17,
                  fontWeight: 600,
                  letterSpacing: "-0.015em",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {track.name}
              </div>
              <div
                style={{
                  fontSize: 13,
                  color: "oklch(0.55 0.02 260)",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {track.artists.map((a) => a.name).join(", ")}
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "flex-end", gap: 3, height: 34, flex: "0 0 auto", paddingBottom: 2 }}>
              <Waveform bars={PANEL_BARS} playing={isPlaying} size={{ w: 3, h: 34, gap: 3 }} />
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
            <div
              onClick={onSeek}
              style={{ position: "relative", height: 6, borderRadius: 4, background: "oklch(0.935 0.008 258)", cursor: "pointer" }}
            >
              <div
                style={{
                  position: "absolute",
                  left: 0,
                  top: 0,
                  height: "100%",
                  borderRadius: 4,
                  background: "linear-gradient(90deg,oklch(0.68 0.14 248),oklch(0.58 0.18 258))",
                  transition: "width 0.9s linear",
                  width: `${pct.toFixed(2)}%`,
                }}
              />
              <div
                style={{
                  position: "absolute",
                  top: "50%",
                  width: 11,
                  height: 11,
                  marginLeft: -5.5,
                  marginTop: -5.5,
                  borderRadius: "50%",
                  background: "#fff",
                  boxShadow: "0 2px 6px oklch(0.45 0.05 258 / 0.35),inset 0 0 0 1px oklch(0.9 0.02 258)",
                  transition: "left 0.9s linear",
                  left: `${pct.toFixed(2)}%`,
                }}
              />
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11.5, letterSpacing: "0.01em", color: "oklch(0.55 0.02 260)" }}>
              <div>{fmt(progressMs)}</div>
              <div>-{fmt(Math.max(0, track.duration_ms - progressMs))}</div>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", alignItems: "center" }}>
            <div />
            <div style={{ display: "flex", alignItems: "center", gap: 22 }}>
              <div onClick={onPrev} style={{ display: "flex", alignItems: "center", gap: 2, cursor: "pointer", padding: 6 }}>
                <div style={{ width: 2, height: 13, borderRadius: 1, background: "oklch(0.4 0.02 260)" }} />
                <div style={{ width: 0, height: 0, borderStyle: "solid", borderWidth: "6.5px 10px 6.5px 0", borderColor: "transparent oklch(0.4 0.02 260) transparent transparent" }} />
              </div>
              <div
                onClick={onToggle}
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: "50%",
                  background: "linear-gradient(160deg,oklch(0.65 0.16 250),oklch(0.56 0.19 260))",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  cursor: "pointer",
                  position: "relative",
                  boxShadow: "0 10px 20px -8px oklch(0.58 0.18 258 / 0.9)",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 4.5, opacity: isPlaying ? 1 : 0, transition: "opacity 0.18s ease" }}>
                  <div style={{ width: 4, height: 15, borderRadius: 2, background: "#fff" }} />
                  <div style={{ width: 4, height: 15, borderRadius: 2, background: "#fff" }} />
                </div>
                <div
                  style={{
                    position: "absolute",
                    left: 17,
                    top: 14,
                    width: 0,
                    height: 0,
                    borderStyle: "solid",
                    borderWidth: "8px 0 8px 13px",
                    borderColor: "transparent transparent transparent #fff",
                    opacity: isPlaying ? 0 : 1,
                    transition: "opacity 0.18s ease",
                  }}
                />
              </div>
              <div onClick={onNext} style={{ display: "flex", alignItems: "center", gap: 2, cursor: "pointer", padding: 6 }}>
                <div style={{ width: 0, height: 0, borderStyle: "solid", borderWidth: "6.5px 0 6.5px 10px", borderColor: "transparent transparent transparent oklch(0.4 0.02 260)" }} />
                <div style={{ width: 2, height: 13, borderRadius: 1, background: "oklch(0.4 0.02 260)" }} />
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 5 }}>
                <div style={{ fontSize: 9, letterSpacing: "0.1em", textTransform: "uppercase", color: "oklch(0.68 0.015 260)" }}>Volume</div>
                <div style={{ fontSize: 11, fontWeight: 600, color: "oklch(0.45 0.02 260)", minWidth: 26, textAlign: "right" }}>{volume}%</div>
              </div>
              <div
                onMouseDown={onVolumeDown}
                onWheel={onVolumeWheel}
                style={{ position: "relative", width: 78, height: 5, borderRadius: 4, background: "oklch(0.925 0.01 258)", cursor: "pointer" }}
              >
                <div
                  style={{
                    position: "absolute",
                    left: 0,
                    top: 0,
                    height: "100%",
                    borderRadius: 4,
                    background: "linear-gradient(90deg,oklch(0.7 0.13 248),oklch(0.59 0.18 258))",
                    width: `${volume}%`,
                  }}
                />
                <div
                  style={{
                    position: "absolute",
                    top: "50%",
                    width: 10,
                    height: 10,
                    marginLeft: -5,
                    marginTop: -5,
                    borderRadius: "50%",
                    background: "#fff",
                    boxShadow: "0 2px 5px oklch(0.45 0.05 258 / 0.35),inset 0 0 0 1px oklch(0.9 0.02 258)",
                    left: `${volume}%`,
                  }}
                />
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
