import type { SpotifyPlayContext, SpotifyPlaylist, SpotifyTrack } from "../../lib/electron-runtime";

const PLAYLIST_RECENCY_KEY = "clyra-music-playlist-recency-v1";
const HISTORY_KEY = "clyra-music-history-v1";
const RECENT_SEARCHES_KEY = "clyra-music-recent-searches-v1";
const HISTORY_LIMIT = 50;
const RECENT_SEARCH_LIMIT = 12;

export type PlaylistRecency = Record<string, number>;

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* The player still works when local storage is unavailable. */
  }
}

/** Playlist id from a `spotify:playlist:<id>` (or `spotify:user:x:playlist:<id>`) URI. */
export function playlistIdFromUri(uri: string | null | undefined) {
  const match = /(?:^|:)playlist:([A-Za-z0-9]+)$/.exec(String(uri || ""));
  return match ? match[1] : null;
}

/** Spotify's "Recents" order: whatever was last opened in Clyra or played
 *  anywhere (from listening history) comes first; untouched playlists keep
 *  Spotify's own library order underneath. */
export function sortPlaylistsByRecency(playlists: SpotifyPlaylist[], recency: PlaylistRecency) {
  return playlists
    .map((playlist, index) => ({ playlist, index }))
    .sort((left, right) => {
      const recentDifference = (recency[right.playlist.id] || 0) - (recency[left.playlist.id] || 0);
      return recentDifference || left.index - right.index;
    })
    .map(({ playlist }) => playlist);
}

/** Folds Spotify play contexts into the local recency map (newest wins). */
export function mergeContextRecency(recency: PlaylistRecency, contexts: SpotifyPlayContext[]) {
  let changed = false;
  const next = { ...recency };
  for (const context of contexts) {
    const id = playlistIdFromUri(context.uri);
    const at = Date.parse(context.playedAt);
    if (!id || !Number.isFinite(at)) continue;
    if ((next[id] || 0) < at) {
      next[id] = at;
      changed = true;
    }
  }
  return changed ? next : recency;
}

export function readPlaylistRecency(): PlaylistRecency {
  const parsed = readJson<unknown>(PLAYLIST_RECENCY_KEY, {});
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  return Object.fromEntries(Object.entries(parsed).filter(([id, value]) => id && Number.isFinite(value)) as Array<[string, number]>);
}

export function writePlaylistRecency(recency: PlaylistRecency) {
  writeJson(PLAYLIST_RECENCY_KEY, recency);
}

function compactTrack(track: SpotifyTrack): SpotifyTrack {
  return {
    id: track.id,
    name: track.name,
    uri: track.uri,
    duration_ms: track.duration_ms,
    artists: track.artists.map((artist) => ({ name: artist.name, ...(artist.id ? { id: artist.id } : {}) })),
    album: { name: track.album?.name || "", ...(track.album?.id ? { id: track.album.id } : {}), images: (track.album?.images || []).slice(0, 3).map((image) => ({ url: image.url })) },
    ...(track.explicit ? { explicit: true } : {}),
    ...(track.played_at ? { played_at: track.played_at } : {}),
  };
}

/** Newest-first, de-duplicated listening history. `primary` wins ties. */
export function mergeHistory(primary: SpotifyTrack[], secondary: SpotifyTrack[]) {
  const seen = new Set<string>();
  const time = (track: SpotifyTrack) => Date.parse(track.played_at || "") || 0;
  return [...primary, ...secondary]
    .filter((track) => track?.id && track.uri && !seen.has(track.id) && seen.add(track.id))
    .sort((left, right) => time(right) - time(left))
    .slice(0, HISTORY_LIMIT);
}

export function readLocalHistory(): SpotifyTrack[] {
  const rows = readJson<unknown>(HISTORY_KEY, []);
  return Array.isArray(rows) ? (rows as SpotifyTrack[]).filter((row) => row?.id && row.uri && Array.isArray(row.artists)) : [];
}

export function writeLocalHistory(tracks: SpotifyTrack[]) {
  writeJson(HISTORY_KEY, tracks.slice(0, HISTORY_LIMIT).map(compactTrack));
}

export type RecentSearch =
  | { kind: "track"; id: string; at: number; track: SpotifyTrack }
  | { kind: "playlist"; id: string; at: number; playlist: SpotifyPlaylist };

export function readRecentSearches(): RecentSearch[] {
  const rows = readJson<unknown>(RECENT_SEARCHES_KEY, []);
  return Array.isArray(rows) ? (rows as RecentSearch[]).filter((row) => row && (row.kind === "track" ? row.track?.uri : row.kind === "playlist" ? row.playlist?.uri : false)) : [];
}

export function addRecentSearch(current: RecentSearch[], entry: { track: SpotifyTrack } | { playlist: SpotifyPlaylist }) {
  const next: RecentSearch = "track" in entry
    ? { kind: "track", id: entry.track.id, at: Date.now(), track: compactTrack(entry.track) }
    : { kind: "playlist", id: entry.playlist.id, at: Date.now(), playlist: { id: entry.playlist.id, name: entry.playlist.name, uri: entry.playlist.uri, images: (entry.playlist.images || []).slice(0, 1), owner: entry.playlist.owner, tracks: entry.playlist.tracks } };
  const rows = [next, ...current.filter((row) => !(row.kind === next.kind && row.id === next.id))].slice(0, RECENT_SEARCH_LIMIT);
  writeJson(RECENT_SEARCHES_KEY, rows);
  return rows;
}

export function removeRecentSearch(current: RecentSearch[], kind: RecentSearch["kind"], id: string) {
  const rows = current.filter((row) => !(row.kind === kind && row.id === id));
  writeJson(RECENT_SEARCHES_KEY, rows);
  return rows;
}

export function clearRecentSearches() {
  writeJson(RECENT_SEARCHES_KEY, []);
  return [] as RecentSearch[];
}
