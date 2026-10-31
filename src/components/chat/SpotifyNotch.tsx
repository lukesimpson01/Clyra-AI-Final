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
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { getElectronDesktop } from "../../lib/electron-runtime";
import type { SpotifyBrowseKind, SpotifyBrowseResult, SpotifyDevice, SpotifyLyrics, SpotifyPlayContext, SpotifyPlaylist, SpotifyPlaylistItem, SpotifyProfile, SpotifyTrack } from "../../lib/electron-runtime";
import { mergeHistory, readLocalHistory, writeLocalHistory } from "../spotify/music-state";

type RepeatMode = "off" | "track" | "context";

const EASE = "cubic-bezier(0.22,0.92,0.26,1.01)";
const POLL_MS = 4000;

// Shared timing for the morph between the workspace-tab pill and the notch
// (used by both this file's own pill/panel reveal and App.tsx's tabs layer +
// shell, so the "hide elements -> resize the shell -> reveal new content"
// sequence stays in lockstep everywhere it happens).
export const MORPH_EASE = "cubic-bezier(.32,.72,0,1)";
export const MORPH_HIDE_MS = 120;
export const MORPH_REVEAL_MS = 260;
export const MORPH_REVEAL_DELAY_MS = 150;
export const MORPH_SHELL_MS = 520;
export const MORPH_SHELL_DELAY_MS = 0;

function fmt(ms: number) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** Live playback position, ticking between polls without re-rendering whoever owns the playback hook. */
export type SpotifyProgressStore = { get: () => number; subscribe: (listener: () => void) => () => void };

const noProgressSubscription = () => () => {};
/** The live position for components that show it (time labels, the scrubber, synced lyrics). Only they re-render. */
export function useSpotifyProgress(playback: Pick<SpotifyPlaybackHook, "progressMs"> & { progress?: SpotifyProgressStore }) {
  const store = playback.progress;
  return useSyncExternalStore(store ? store.subscribe : noProgressSubscription, store ? store.get : () => playback.progressMs);
}

/**
 * Keeps a hook's returned object identical between renders unless one of its data fields changed. Functions are
 * replaced by stable wrappers that always call the latest version, so consumers memoised on the object (the
 * Clyra Music workspace) skip the re-renders their owner goes through.
 */
function useStableObject<T extends Record<string, unknown>>(raw: T, volatile: readonly string[] = []): T {
  const latest = useRef(raw);
  latest.current = raw;
  const wrappers = useRef(new Map<string, (...args: unknown[]) => unknown>());
  const previous = useRef<{ raw: T; out: T } | null>(null);
  const prev = previous.current;
  if (prev) {
    let same = true;
    for (const key of Object.keys(raw)) {
      const value = raw[key];
      if (typeof value === "function" || volatile.includes(key)) continue;
      if (!Object.is(value, prev.raw[key])) { same = false; break; }
    }
    if (same) return prev.out;
  }
  const out = {} as Record<string, unknown>;
  for (const key of Object.keys(raw)) {
    const value = raw[key];
    if (typeof value === "function") {
      let wrapper = wrappers.current.get(key);
      if (!wrapper) {
        wrapper = (...args: unknown[]) => (latest.current[key] as (...a: unknown[]) => unknown)(...args);
        wrappers.current.set(key, wrapper);
      }
      out[key] = wrapper;
    } else out[key] = value;
  }
  previous.current = { raw, out: out as T };
  return out as T;
}

export type SpotifyPlaybackHook = {
  /** Subscribe with useSpotifyProgress for a live position; progressMs/pct only change when playback is polled. */
  progress?: SpotifyProgressStore;
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
  /** Plays a track. With `contextUri` (playlist/album/Liked Songs) or a
   *  `uris` list, playback starts at that track and continues through the rest. */
  playTrackUri: (uri: string, from?: { contextUri?: string; uris?: string[] }) => Promise<{ ok: boolean; error?: string }>;
  /** Liked Songs, in order, starting at an optional track. */
  playLikedSongs: (startUri?: string) => Promise<{ ok: boolean; error?: string }>;
  /** URI of the playlist/album the current track is playing from. */
  contextUri: string | null;
  /** Where recent plays came from, newest first (playlist recency source). */
  recentContexts: SpotifyPlayContext[];
  /** Spotify is being opened in the background to act as a playback device. */
  startingDevice: boolean;
  /** The saved connection predates a permission newer features need. */
  needsReconnect: boolean;
  playPlaylistUri: (uri: string) => Promise<{ ok: boolean; error?: string }>;
  lyricsForTrack: (track: SpotifyTrack) => Promise<{ ok: boolean; lyrics?: SpotifyLyrics; error?: string }>;
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
  /** Artist/album/browse/playlist-edit requests (see SpotifyManager.browse). */
  browse: (kind: SpotifyBrowseKind, args?: Record<string, unknown>) => Promise<SpotifyBrowseResult>;
  /** Saves/removes any songs in Your Library (not just the current one). */
  likeUris: (uris: string[], like: boolean) => Promise<{ ok: boolean; error?: string }>;
  /** Which of these songs are already in Your Library, in order. */
  checkLiked: (uris: string[]) => Promise<boolean[]>;
  /** Re-reads the playlist list (after creating or editing one). */
  playlistsChanged: () => void;
};

/** `active` gates lightweight playback polling; `loadLibrary` separately
 * gates playlists, history, and queue reads for a visible music surface. */
export function useSpotifyPlayback(active: boolean, loadLibrary = active): SpotifyPlaybackHook {
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
  const [contextUri, setContextUri] = useState<string | null>(null);
  const [recentContexts, setRecentContexts] = useState<SpotifyPlayContext[]>([]);
  const [startingDevice, setStartingDevice] = useState(false);
  const [needsReconnect, setNeedsReconnect] = useState(false);
  // Progress is extrapolated from the last authoritative reading so the bar
  // and synced lyrics move smoothly between the 4 s Spotify polls.
  const progressAnchorRef = useRef({ ms: 0, at: 0 });
  // After Next/Previous, Spotify can keep answering with the old song for a moment. Polls that still describe it
  // (same song, far ahead of where we know we are) are dropped so the clock never snaps back to the old position.
  const skipGuardRef = useRef<{ uri: string; at: number } | null>(null);

  // Keep the fader's value as the user's immediate target.  In particular,
  // don't feed a smoothed display value back into a native range input: it
  // makes the thumb lag behind the pointer and lets the next playback poll
  // appear to undo a volume change.
  const [volume, setVolume] = useState(50);
  const volumeRef = useRef(50);
  const dragRectRef = useRef<DOMRect | null>(null);
  const volumeCommitTimer = useRef<number | null>(null);
  const volumeWriteUntilRef = useRef(0);

  // Initial status + live auth-state updates from the main process.
  useEffect(() => {
    if (!spotify) return;
    let cancelled = false;
    spotify.status().then((res) => {
      if (cancelled) return;
      setConnected(res.connected);
      setProfile(res.profile ?? null);
      setNeedsReconnect(Boolean(res.connected && res.missingScopes?.length));
    }).catch(() => undefined);
    const unsubscribe = spotify.onAuthState((payload) => {
      setConnecting(Boolean(payload.pending));
      setConnected(payload.connected);
      if (payload.profile !== undefined) setProfile(payload.profile ?? null);
      if (payload.connected && !payload.pending) setNeedsReconnect(false);
      setError(payload.error ?? null);
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [spotify]);

  const refreshPlayback = useCallback(async () => {
    if (!spotify || !connected) return;
    const requestedAt = Date.now();
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
    const guard = skipGuardRef.current;
    if (guard) {
      const sinceSkip = Date.now() - guard.at;
      if (sinceSkip > 3000) skipGuardRef.current = null;
      else if (state?.item?.uri === guard.uri && Number(state.progress_ms || 0) > sinceSkip + 1500) return;
      else if (state?.item?.uri !== guard.uri) skipGuardRef.current = null;
    }
    if (!state) {
      setTrack(null);
      setIsPlaying(false);
      setDevice(null);
      return;
    }
    // Polls return fresh objects; keep the previous ones when nothing changed so consumers don't re-render.
    setTrack((previous) => {
      const item = state.item ?? null;
      return previous && item && previous.uri === item.uri && previous.duration_ms === item.duration_ms ? previous : item;
    });
    setIsPlaying(Boolean(state.is_playing));
    // The reading is about half a round trip old by the time it arrives.
    progressAnchorRef.current = { ms: Number(state.progress_ms || 0), at: Math.round((requestedAt + Date.now()) / 2) };
    setProgressMs(Number(state.progress_ms || 0));
    setContextUri(state.context?.uri ?? null);
    setDevice((previous) => {
      const next = state.device ?? null;
      return previous && next && previous.id === next.id && previous.volume_percent === next.volume_percent && previous.is_active === next.is_active && previous.name === next.name ? previous : next;
    });
    setShuffleOn(Boolean(state.shuffle_state));
    if (state.repeat_state === "track" || state.repeat_state === "context" || state.repeat_state === "off") {
      setRepeatMode(state.repeat_state);
    }
    // Spotify Connect can return the previous device volume for a moment
    // after a write. Preserve the local control position until that small
    // consistency window has passed.
    if (typeof state.device?.volume_percent === "number" && Date.now() >= volumeWriteUntilRef.current) {
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

  // Smoothly advance progress between polls so it doesn't sit frozen for 4s. The tick goes to a tiny external store
  // (read with useSpotifyProgress), never to React state here: this hook lives in App, and a 250 ms state tick
  // re-rendered the entire app four times a second while music played.
  const progressValueRef = useRef(0);
  const progressListenersRef = useRef(new Set<() => void>());
  const progressStore = useMemo<SpotifyProgressStore>(() => ({
    get: () => progressValueRef.current,
    subscribe: (listener) => {
      progressListenersRef.current.add(listener);
      return () => { progressListenersRef.current.delete(listener); };
    },
  }), []);
  const publishProgress = useCallback((ms: number) => {
    if (ms === progressValueRef.current) return;
    progressValueRef.current = ms;
    progressListenersRef.current.forEach((listener) => listener());
  }, []);
  useEffect(() => { publishProgress(progressMs); }, [progressMs, publishProgress]);
  useEffect(() => {
    if (!active || !isPlaying || !track) return;
    progressAnchorRef.current = { ms: progressAnchorRef.current.ms, at: progressAnchorRef.current.at || Date.now() };
    const id = window.setInterval(() => {
      if (!progressListenersRef.current.size) return;
      const anchor = progressAnchorRef.current;
      publishProgress(Math.min(track.duration_ms, anchor.ms + (Date.now() - anchor.at)));
    }, 120);
    return () => window.clearInterval(id);
  }, [active, isPlaying, track, publishProgress]);

  // Pausing freezes the extrapolation at the position shown right now.
  useEffect(() => {
    if (!isPlaying) progressAnchorRef.current = { ms: progressMs, at: Date.now() };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlaying]);

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
      volumeWriteUntilRef.current = Date.now() + 900;
      void spotify.control({ action: "volume", volumePercent: Math.round(percent), ...(device?.id ? { deviceId: device.id } : {}) })
        .then((result) => {
          if (result.ok) setError(null);
          else setError(result.error || "Spotify couldn't change the volume. Select an active device and try again.");
        })
        .catch(() => setError("Spotify couldn't change the volume. Select an active device and try again."));
    },
    [spotify, device?.id],
  );

  const setFromX = (clientX: number, rect: DOMRect) => {
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const percent = Math.round(ratio * 100);
    volumeWriteUntilRef.current = Date.now() + 900;
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
    volumeWriteUntilRef.current = Date.now() + 900;
    volumeRef.current = next;
    setVolume(next);
    if (volumeCommitTimer.current) window.clearTimeout(volumeCommitTimer.current);
    volumeCommitTimer.current = window.setTimeout(() => commitVolume(next), 260);
  };

  const setVolumePercent = useCallback((percent: number) => {
    const next = Math.max(0, Math.min(100, Math.round(percent)));
    volumeWriteUntilRef.current = Date.now() + 900;
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
    progressAnchorRef.current = { ms: next, at: Date.now() };
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
    progressAnchorRef.current = { ms: 0, at: Date.now() };
    if (track?.uri) skipGuardRef.current = { uri: track.uri, at: Date.now() };
    setProgressMs(0);
    publishProgress(0);
    void spotify.control({ action: "previous" }).then(() => { window.setTimeout(refreshPlayback, 400); window.setTimeout(refreshPlayback, 1100); }).catch(() => undefined);
  };
  const onNext = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!spotify) return;
    progressAnchorRef.current = { ms: 0, at: Date.now() };
    if (track?.uri) skipGuardRef.current = { uri: track.uri, at: Date.now() };
    setProgressMs(0);
    publishProgress(0);
    void spotify.control({ action: "next" }).then(() => { window.setTimeout(refreshPlayback, 400); window.setTimeout(refreshPlayback, 1100); }).catch(() => undefined);
  };

  const ensurePlaybackDevice = useCallback(async () => {
    if (!spotify) return { ok: false as const, error: "Spotify is only available in the Clyra desktop app." };
    if (device?.id && device.is_active) return { ok: true as const, deviceId: device.id };

    // The main process picks (or wakes) a device: an active one first, then
    // this computer, and if Spotify isn't running anywhere it opens the
    // desktop app in the background and waits for it to come online.
    if (spotify.prepareDevice) {
      setStartingDevice(true);
      const prepared = await spotify.prepareDevice(device?.id).catch(() => null);
      setStartingDevice(false);
      if (!prepared?.ok || !prepared.device) {
        const message = prepared?.error || "Clyra couldn't reach a Spotify device.";
        setError(message);
        return { ok: false as const, error: message };
      }
      setDevice(prepared.device);
      setError(null);
      return { ok: true as const, deviceId: prepared.device.id };
    }

    const response = await spotify.devices().catch(() => null);
    const availableDevices = response?.ok ? (response.devices ?? []).filter((item) => item.id && !item.is_restricted) : [];
    setDevices(response?.ok ? response.devices ?? [] : []);
    const target = availableDevices.find((item) => item.is_active) ?? availableDevices[0];
    if (!target) {
      const message = "Open Spotify on a phone or computer once, then choose that device in Clyra.";
      setError(message);
      return { ok: false as const, error: message };
    }

    if (!target.is_active) {
      const transferred = await spotify.control({ action: "transfer", deviceId: target.id, play: false });
      if (!transferred.ok) {
        const message = transferred.error || "Clyra couldn't activate that Spotify device.";
        setError(message);
        return { ok: false as const, error: message };
      }
    }
    setDevice(target);
    setError(null);
    return { ok: true as const, deviceId: target.id };
  }, [spotify, device?.id, device?.is_active]);

  /** Resume where Spotify left off; when a freshly woken device has nothing
   * to resume, start the listening history instead so Play always plays. */
  const recentTracksRef = useRef<SpotifyTrack[]>([]);
  const lastTrackRef = useRef<SpotifyTrack | null>(null);
  const startOrResume = useCallback(async (): Promise<{ ok: boolean; error?: string }> => {
    if (!spotify) return { ok: false, error: "Spotify is only available in the Clyra desktop app." };
    const ready = await ensurePlaybackDevice();
    if (!ready.ok) return ready;
    const resumed = await spotify.control({ action: "play", deviceId: ready.deviceId });
    if (resumed.ok) {
      // A woken device may accept "play" with nothing loaded; confirm.
      await new Promise((resolve) => window.setTimeout(resolve, 500));
      const state = await spotify.playbackState().catch(() => null);
      if (state?.ok && state.state?.item) return resumed;
    }
    const history = [lastTrackRef.current, ...recentTracksRef.current].filter((item): item is SpotifyTrack => Boolean(item?.uri));
    const uris = [...new Set(history.map((item) => item.uri))].slice(0, 50);
    if (!uris.length) return resumed.ok ? { ok: false, error: "Choose a song or playlist to start listening." } : resumed;
    return spotify.control({ action: "play", deviceId: ready.deviceId, uris });
  }, [spotify, ensurePlaybackDevice]);

  const onToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!spotify) return;
    const next = !isPlaying;
    if (!next) {
      setIsPlaying(false);
      void spotify.control({ action: "pause", ...(device?.id ? { deviceId: device.id } : {}) }).then(() => window.setTimeout(refreshPlayback, 400)).catch(() => undefined);
      return;
    }
    setIsPlaying(true);
    void (async () => {
      const result = await startOrResume();
      if (!result.ok) {
        setIsPlaying(false);
        setError(result.error || "Spotify couldn't start playback.");
      }
      window.setTimeout(refreshPlayback, 400);
    })();
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
    const res = await startOrResume();
    window.setTimeout(refreshPlayback, 400);
    return res;
  }, [startOrResume, refreshPlayback]);

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

  /** Search Spotify and start a short, contiguous result queue so playback
   * continues naturally when the selected result ends. */
  const playQuery = useCallback(
    async (query: string): Promise<{ ok: boolean; error?: string; trackName?: string; artistName?: string }> => {
      if (!spotify) return { ok: false, error: "Spotify is only available in the Clyra desktop app." };
      const res = await spotify.search(query, "track", 10);
      if (!res.ok) return { ok: false, error: res.error || "Spotify search failed." };
      const found = res.tracks?.[0];
      if (!found) return { ok: false, error: `No Spotify track matched "${query}".` };
      const uris = res.tracks
        ?.map((track) => track.uri)
        .filter((uri): uri is string => Boolean(uri))
        .slice(0, 10) ?? [found.uri];
      const ready = await ensurePlaybackDevice();
      if (!ready.ok) return ready;
      const playRes = await spotify.control({ action: "play", uris, deviceId: ready.deviceId });
      if (!playRes.ok) return { ok: false, error: playRes.error || "Couldn't start playback — is a Spotify device active?" };
      window.setTimeout(refreshPlayback, 600);
      return { ok: true, trackName: found.name, artistName: found.artists.map((a) => a.name).join(", ") };
    },
    [spotify, refreshPlayback, ensurePlaybackDevice],
  );

  /** Play a well-known trending/top-hits playlist — Spotify's Web API has no
   *  direct "trending" endpoint, so this resolves it via search. */
  const playTrending = useCallback(async (): Promise<{ ok: boolean; error?: string; playlistName?: string }> => {
    if (!spotify) return { ok: false, error: "Spotify is only available in the Clyra desktop app." };
    const res = await spotify.search("Today's Top Hits", "playlist", 1);
    if (!res.ok) return { ok: false, error: res.error || "Spotify search failed." };
    const playlist = res.playlists?.[0];
    if (!playlist) return { ok: false, error: "Couldn't find a trending playlist." };
    const ready = await ensurePlaybackDevice();
    if (!ready.ok) return ready;
    const playRes = await spotify.control({ action: "play", contextUri: playlist.uri, deviceId: ready.deviceId });
    if (!playRes.ok) return { ok: false, error: playRes.error || "Couldn't start playback — is a Spotify device active?" };
    window.setTimeout(refreshPlayback, 600);
    return { ok: true, playlistName: playlist.name };
  }, [spotify, refreshPlayback, ensurePlaybackDevice]);

  const refreshPlaylists = useCallback(() => {
    if (!spotify) return;
    void spotify.playlists().then((res) => {
      if (res.ok) setPlaylists(res.playlists ?? []);
    });
  }, [spotify]);

  const refreshRecentTracks = useCallback(() => {
    if (!spotify) return;
    void spotify.recentlyPlayed().then((res) => {
      if (res.ok) {
        setRecentTracks((current) => mergeHistory(res.tracks ?? [], current));
        setRecentContexts(res.contexts ?? []);
      } else if (res.code === "SPOTIFY_SCOPE_REQUIRED") {
        setNeedsReconnect(true);
      }
    });
  }, [spotify]);

  // History survives restarts locally, so Search and Home can show what was
  // played before even while Spotify's own history endpoint is unavailable.
  useEffect(() => {
    setRecentTracks((current) => mergeHistory(current, readLocalHistory()));
  }, []);
  useEffect(() => {
    recentTracksRef.current = recentTracks;
    if (recentTracks.length) writeLocalHistory(recentTracks);
  }, [recentTracks]);
  useEffect(() => {
    if (track) lastTrackRef.current = track;
  }, [track]);

  const refreshSavedTracks = useCallback(() => {
    if (!spotify) return;
    void spotify.savedTracks().then((res) => {
      if (res.ok) setSavedTracks(res.tracks ?? []);
    });
  }, [spotify]);

  // Playback can be monitored by Chat without loading the full music library.
  // Keep those heavier reads for a visible Music surface or notch.
  useEffect(() => {
    if (!loadLibrary || !connected) return;
    refreshPlaylists();
    refreshRecentTracks();
    refreshSavedTracks();
  }, [loadLibrary, connected, refreshPlaylists, refreshRecentTracks, refreshSavedTracks]);

  const playTrackUri = useCallback(
    async (uri: string, from?: { contextUri?: string; uris?: string[] }) => {
      if (!spotify) return { ok: false, error: "Spotify is only available in the Clyra desktop app." };
      const ready = await ensurePlaybackDevice();
      if (!ready.ok) return ready;
      const uris = from?.uris?.length ? [...new Set(from.uris)].slice(0, 100) : null;
      const res = from?.contextUri
        ? await spotify.control({ action: "play", contextUri: from.contextUri, offsetUri: uri, deviceId: ready.deviceId })
        : uris && uris.includes(uri)
          ? await spotify.control({ action: "play", uris, offsetUri: uri, deviceId: ready.deviceId })
          : await spotify.control({ action: "play", uris: [uri], deviceId: ready.deviceId });
      if (!res.ok) setError(res.error || "Spotify couldn't play that song.");
      else setIsPlaying(true);
      window.setTimeout(refreshPlayback, 450);
      return res;
    },
    [spotify, refreshPlayback, ensurePlaybackDevice],
  );

  const savedTracksRef = useRef<SpotifyTrack[]>([]);
  useEffect(() => {
    savedTracksRef.current = savedTracks;
  }, [savedTracks]);
  const playLikedSongs = useCallback(
    async (startUri?: string) => {
      if (!spotify) return { ok: false, error: "Spotify is only available in the Clyra desktop app." };
      const uris = savedTracksRef.current.map((item) => item.uri);
      if (!uris.length) return { ok: false, error: "You haven't liked any songs yet." };
      return playTrackUri(startUri && uris.includes(startUri) ? startUri : uris[0], { uris });
    },
    [spotify, playTrackUri],
  );

  const playPlaylistUri = useCallback(
    async (uri: string) => {
      if (!spotify) return { ok: false, error: "Spotify is only available in the Clyra desktop app." };
      const ready = await ensurePlaybackDevice();
      if (!ready.ok) return ready;
      const res = await spotify.control({ action: "play", contextUri: uri, deviceId: ready.deviceId });
      if (!res.ok) setError(res.error || "Spotify couldn't play that playlist.");
      else {
        setIsPlaying(true);
        setContextUri(uri);
      }
      window.setTimeout(refreshPlayback, 450);
      return res;
    },
    [spotify, refreshPlayback, ensurePlaybackDevice],
  );

  const lyricsForTrack = useCallback(async (currentTrack: SpotifyTrack) => {
    if (!spotify) return { ok: false, error: "Lyrics are only available in the Clyra desktop app." };
    return spotify.lyrics({
      trackName: currentTrack.name,
      artistName: currentTrack.artists.map((artist) => artist.name).join(", "),
      albumName: currentTrack.album?.name,
      durationMs: currentTrack.duration_ms,
    });
  }, [spotify]);

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

  // A new item is the useful moment to update both side panels.  Spotify's
  // recently-played endpoint can lag a little, so immediately prepend the
  // newly observed track as well; its server order will take over on the
  // next library refresh and duplicate IDs are removed either way.
  useEffect(() => {
    if (!loadLibrary || !connected || !track) return;
    setRecentTracks((items) => [{ ...track, played_at: new Date().toISOString() }, ...items.filter((item) => item.id !== track.id)].slice(0, 50));
    refreshQueue();
    const id = window.setTimeout(() => refreshRecentTracks(), 900);
    return () => window.clearTimeout(id);
  }, [track?.id, loadLibrary, connected, refreshQueue, refreshRecentTracks]);

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
    if (!loadLibrary || !connected) return;
    void refreshQueue();
    const id = window.setInterval(() => void refreshQueue(), POLL_MS * 2);
    return () => window.clearInterval(id);
  }, [loadLibrary, connected, refreshQueue]);

  const browse = useCallback(async (kind: SpotifyBrowseKind, args: Record<string, unknown> = {}): Promise<SpotifyBrowseResult> => {
    if (!spotify?.browse) return { ok: false, error: "Update the Clyra desktop app to use this feature." };
    try {
      return await spotify.browse(kind, args);
    } catch {
      return { ok: false, error: "Spotify request failed." };
    }
  }, [spotify]);

  const likeUris = useCallback(async (uris: string[], like: boolean) => {
    if (!spotify) return { ok: false, error: "Spotify is only available in the Clyra desktop app." };
    const result = like ? await spotify.saveLibrary(uris) : await spotify.removeLibrary(uris);
    if (result.ok) {
      setError(null);
      void spotify.savedTracks().then((res) => { if (res.ok) setSavedTracks(res.tracks ?? []); });
      if (track?.uri && uris.includes(track.uri)) setLiked(like);
    } else {
      setError(result.error || "Spotify couldn't update your Library.");
    }
    return result;
  }, [spotify, track?.uri]);

  const checkLiked = useCallback(async (uris: string[]) => {
    if (!spotify || !uris.length) return uris.map(() => false);
    const out: boolean[] = [];
    for (let index = 0; index < uris.length; index += 40) {
      const chunk = uris.slice(index, index + 40);
      const res = await spotify.libraryContains(chunk).catch(() => null);
      out.push(...(res?.ok ? chunk.map((_, offset) => Boolean(res.contains?.[offset])) : chunk.map(() => false)));
    }
    return out;
  }, [spotify]);

  const toggleShuffle = useCallback(() => {
    if (!spotify) return;
    const next = !shuffleOn;
    setShuffleOn(next);
    void spotify.control({ action: "shuffle", state: next }).then((result) => {
      if (!result.ok) {
        setShuffleOn(!next);
        setError(result.error || "Spotify couldn't update shuffle.");
        return;
      }
      setError(null);
      window.setTimeout(refreshPlayback, 300);
    }).catch(() => {
      setShuffleOn(!next);
      setError("Spotify couldn't update shuffle.");
    });
  }, [spotify, shuffleOn, refreshPlayback]);

  const cycleRepeat = useCallback(() => {
    if (!spotify) return;
    const order: RepeatMode[] = ["off", "context", "track"];
    const next = order[(order.indexOf(repeatMode) + 1) % order.length];
    setRepeatMode(next);
    void spotify.control({ action: "repeat", state: next }).catch(() => undefined);
  }, [spotify, repeatMode]);

  const pct = track ? (progressMs / track.duration_ms) * 100 : 0;

  return useStableObject({
    progress: progressStore,
    available,
    connected,
    connecting,
    profile,
    track,
    isPlaying,
    progressMs,
    device,
    volume: Math.round(volume),
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
    playLikedSongs,
    contextUri,
    recentContexts,
    startingDevice,
    needsReconnect,
    playPlaylistUri,
    lyricsForTrack,
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
    browse,
    likeUris,
    checkLiked,
    playlistsChanged: refreshPlaylists,
  // The position moves on every poll; it reaches the screen through the progress store, so on its own it is not a
  // reason to hand every consumer a new object (and re-render all of Clyra Music).
  }, ["progressMs", "pct"]);
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
  onDismiss,
}: {
  visible: boolean;
  playback: SpotifyPlaybackHook;
  /** Opens the full Home/Search/Library Clyra Music workspace. */
  onExpand?: () => void;
  /** Hides the music notch until the user starts music again. */
  onDismiss?: () => void;
}) {
  const { connected, track, isPlaying, volume, onSeek, onPrev, onNext, onToggle, onVolumeDown, onVolumeWheel } = playback;
  const progressMs = useSpotifyProgress(playback);
  const pct = track ? (progressMs / track.duration_ms) * 100 : 0;
  // While the pointer is on the scrubber, the fill follows the pointer; the
  // real position is committed on release (see the pointer handlers below).
  const [scrubPct, setScrubPct] = useState<number | null>(null);
  const shownPct = scrubPct ?? pct;
  const shownMs = track ? (shownPct / 100) * track.duration_ms : 0;
  // Only glide on normal forward ticks. Track changes, restarts and seeks jump instantly instead of dragging back.
  const lastScrub = useRef({ uri: track?.uri ?? null, ms: progressMs });
  const glide = lastScrub.current.uri === (track?.uri ?? null) && progressMs >= lastScrub.current.ms && progressMs - lastScrub.current.ms < 1500;
  lastScrub.current = { uri: track?.uri ?? null, ms: progressMs };
  const scrubTransition = scrubPct !== null ? "none" : glide ? "width 0.3s linear" : "none";
  const scrubFromEvent = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!track) return null;
    const r = e.currentTarget.getBoundingClientRect();
    return Math.max(0, Math.min(100, ((e.clientX - r.left) / r.width) * 100));
  };
  const showPlayer = connected && track;
  // Content lands in three soft beats after the shell has mostly grown.
  const stagger = (i: number): React.CSSProperties => ({
    opacity: visible ? 1 : 0,
    transform: visible ? "translateY(0)" : "translateY(6px)",
    transition: visible
      ? `opacity 300ms ease ${MORPH_REVEAL_DELAY_MS + i * 45}ms, transform 420ms ${MORPH_EASE} ${MORPH_REVEAL_DELAY_MS + i * 45}ms`
      : `opacity ${MORPH_HIDE_MS}ms ease, transform ${MORPH_HIDE_MS}ms ease`,
  });
  return (
    <div
      style={{
        position: "absolute",
        left: "50%",
        top: 0,
        width: 424,
        padding: "18px 22px 12px",
        boxSizing: "border-box",
        display: "flex",
        flexDirection: "column",
        gap: 10,
        justifyContent: showPlayer ? "flex-start" : "center",
        minHeight: showPlayer ? undefined : 196,
        transition: visible
          ? `opacity ${MORPH_REVEAL_MS}ms ease ${MORPH_REVEAL_DELAY_MS}ms`
          : `opacity ${MORPH_HIDE_MS}ms ease`,
        opacity: visible ? 1 : 0,
        transform: "translateX(-50%)",
        pointerEvents: visible ? "auto" : "none",
      }}
    >
      {onDismiss ? (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onDismiss();
          }}
          title="Hide music"
          aria-label="Hide music"
          style={{ ...cornerButton, top: 12, right: 14 }}
        >
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
      ) : null}
      {!showPlayer ? (
        <ConnectPrompt playback={playback} />
      ) : (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 16, ...stagger(0) }}>
            <div
              style={{
                position: "relative",
                width: 78,
                height: 78,
                borderRadius: 16,
                flex: "0 0 auto",
                overflow: "hidden",
                background: "linear-gradient(145deg,oklch(0.93 0.01 258),oklch(0.86 0.015 258))",
                boxShadow: "0 8px 18px -10px oklch(0.3 0.02 260 / 0.55)",
              }}
            >
              {track.album?.images?.[0]?.url ? (
                <img src={track.album.images[0].url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              ) : null}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0, flex: "1 1 auto", paddingRight: 22 }}>
              <div style={{ fontSize: 20, fontWeight: 650, letterSpacing: "-0.02em", color: "oklch(0.18 0.005 260)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {track.name}
              </div>
              <div style={{ fontSize: 16, color: "oklch(0.52 0.005 260)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {track.artists.map((a) => a.name).join(", ")}
              </div>
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 12, fontVariantNumeric: "tabular-nums", color: "oklch(0.52 0.005 260)", ...stagger(1) }}>
            <div style={{ minWidth: 32 }}>{fmt(shownMs)}</div>
            <div
              onClick={onSeek}
              onPointerDown={(e) => {
                if (!track) return;
                e.stopPropagation();
                try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* synthetic/odd pointers */ }
                const next = scrubFromEvent(e);
                if (next !== null) setScrubPct(next);
              }}
              onPointerMove={(e) => {
                if (scrubPct === null) return;
                e.stopPropagation();
                const next = scrubFromEvent(e);
                if (next !== null) setScrubPct(next);
              }}
              onPointerUp={(e) => {
                if (scrubPct === null) return;
                e.stopPropagation();
                setScrubPct(null);
                // React's PointerEvent is a MouseEvent subtype; onSeek only
                // reads clientX and the bar's rect, so it commits the seek.
                if (track) onSeek(e);
              }}
              onPointerCancel={() => setScrubPct(null)}
              style={{ position: "relative", flex: 1, height: 9, borderRadius: 999, overflow: "hidden", background: "oklch(0.925 0.002 258)", cursor: "pointer", touchAction: "none" }}
            >
              <div
                style={{
                  position: "absolute",
                  left: 0,
                  top: 0,
                  height: "100%",
                  background: "oklch(0.62 0.004 258)",
                  transition: scrubTransition,
                  width: `${shownPct.toFixed(2)}%`,
                }}
              />
            </div>
            <div style={{ minWidth: 32, textAlign: "right" }}>-{fmt(Math.max(0, track.duration_ms - shownMs))}</div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", alignItems: "center", ...stagger(2) }}>
            <div
              onMouseDown={onVolumeDown}
              onWheel={onVolumeWheel}
              title={`Volume ${volume}%`}
              style={{ display: "flex", alignItems: "center", gap: 6, width: 74, cursor: "pointer", padding: "8px 0", color: "oklch(0.52 0.005 260)" }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" style={{ flexShrink: 0 }}>
                <path d="M3 9v6h4l5 4V5L7 9H3z" />
              </svg>
              <div style={{ position: "relative", flex: 1, height: 4, borderRadius: 999, overflow: "hidden", background: "oklch(0.925 0.002 258)" }}>
                <div style={{ position: "absolute", left: 0, top: 0, height: "100%", background: "oklch(0.62 0.004 258)", width: `${volume}%` }} />
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 34 }}>
              <div onClick={onPrev} style={transportButton} aria-label="Previous">
                <svg width="36" height="26" viewBox="0 0 30 22" fill="oklch(0.2 0.005 260)">
                  <path d="M14 3.2v15.6a1.4 1.4 0 0 1-2.2 1.1L1.3 12.1a1.4 1.4 0 0 1 0-2.2L11.8 2.1A1.4 1.4 0 0 1 14 3.2zM28 3.2v15.6a1.4 1.4 0 0 1-2.2 1.1L15.3 12.1a1.4 1.4 0 0 1 0-2.2L25.8 2.1A1.4 1.4 0 0 1 28 3.2z" />
                </svg>
              </div>
              <div onClick={onToggle} style={{ ...transportButton, width: 44, height: 44 }} aria-label={isPlaying ? "Pause" : "Play"}>
                <svg width="30" height="32" viewBox="0 0 26 28" fill="oklch(0.2 0.005 260)">
                  <g style={{ opacity: isPlaying ? 1 : 0, transition: "opacity 0.18s ease" }}>
                    <rect x="3" y="2" width="8" height="24" rx="2.6" />
                    <rect x="15" y="2" width="8" height="24" rx="2.6" />
                  </g>
                  <path
                    d="M6 3.6v20.8a1.5 1.5 0 0 0 2.3 1.3l16-10.4a1.5 1.5 0 0 0 0-2.5L8.3 2.3A1.5 1.5 0 0 0 6 3.6z"
                    style={{ opacity: isPlaying ? 0 : 1, transition: "opacity 0.18s ease" }}
                  />
                </svg>
              </div>
              <div onClick={onNext} style={transportButton} aria-label="Next">
                <svg width="36" height="26" viewBox="0 0 30 22" fill="oklch(0.2 0.005 260)">
                  <path d="M16 3.2v15.6a1.4 1.4 0 0 0 2.2 1.1l10.5-7.8a1.4 1.4 0 0 0 0-2.2L18.2 2.1A1.4 1.4 0 0 0 16 3.2zM2 3.2v15.6a1.4 1.4 0 0 0 2.2 1.1l10.5-7.8a1.4 1.4 0 0 0 0-2.2L4.2 2.1A1.4 1.4 0 0 0 2 3.2z" />
                </svg>
              </div>
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              {onExpand && connected ? (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onExpand();
                  }}
                  title="Open Clyra Music"
                  aria-label="Open Clyra Music"
                  style={{ ...cornerButton, position: "static", width: 28, height: 28, background: "transparent" }}
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M9 3H3v6M15 21h6v-6M21 3l-7 7M3 21l7-7" />
                  </svg>
                </button>
              ) : null}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

const cornerButton: React.CSSProperties = {
  position: "absolute",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  width: 24,
  height: 24,
  borderRadius: "50%",
  border: "none",
  background: "oklch(0.955 0.002 258)",
  color: "oklch(0.45 0.005 260)",
  cursor: "pointer",
  zIndex: 1,
};

const transportButton: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  width: 40,
  height: 40,
  cursor: "pointer",
  userSelect: "none",
};
