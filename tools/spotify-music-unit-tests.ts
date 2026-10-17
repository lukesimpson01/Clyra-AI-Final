import assert from "node:assert/strict";
import { normalizeLyricsPayload, parseLrc } from "../electron/spotify-lyrics.mjs";
import { mergeContextRecency, mergeHistory, playlistIdFromUri, sortPlaylistsByRecency } from "../src/components/spotify/music-state";
import type { SpotifyPlaylist, SpotifyTrack } from "../src/lib/electron-runtime";

const parsed = parseLrc("[00:12.50]First line\n[01:03.007]Second line\n[ar:ignored]");
assert.deepEqual(parsed, [
  { timeMs: 12_500, text: "First line" },
  { timeMs: 63_007, text: "Second line" },
]);

assert.deepEqual(normalizeLyricsPayload({ syncedLyrics: "[00:01.00]Hello", plainLyrics: "Fallback" }), {
  synced: true,
  instrumental: false,
  lines: [{ timeMs: 1_000, text: "Hello" }],
  source: "LRCLIB",
});

assert.deepEqual(normalizeLyricsPayload({ plainLyrics: "One\n\nTwo" }).lines, [
  { timeMs: null, text: "One" },
  { timeMs: null, text: "Two" },
]);

const playlists = ["a", "b", "c"].map((id) => ({ id, name: id, uri: `spotify:playlist:${id}` })) as SpotifyPlaylist[];
assert.deepEqual(sortPlaylistsByRecency(playlists, { b: 20, c: 10 }).map((playlist) => playlist.id), ["b", "c", "a"]);
assert.deepEqual(sortPlaylistsByRecency(playlists, {}).map((playlist) => playlist.id), ["a", "b", "c"]);

// Playlists played anywhere move to the top in Recents order.
assert.equal(playlistIdFromUri("spotify:playlist:37i9dQZF1DX"), "37i9dQZF1DX");
assert.equal(playlistIdFromUri("spotify:user:me:playlist:abc"), "abc");
assert.equal(playlistIdFromUri("spotify:album:abc"), null);
const merged = mergeContextRecency({ a: 5 }, [
  { uri: "spotify:playlist:c", type: "playlist", playedAt: "2026-10-13T10:00:00.000Z" },
  { uri: "spotify:album:x", type: "album", playedAt: "2026-10-13T11:00:00.000Z" },
]);
assert.deepEqual(sortPlaylistsByRecency(playlists, merged).map((playlist) => playlist.id), ["c", "a", "b"]);
const unchanged = { c: Date.parse("2026-10-14T00:00:00.000Z") };
assert.equal(mergeContextRecency(unchanged, [{ uri: "spotify:playlist:c", type: "playlist", playedAt: "2026-10-13T10:00:00.000Z" }]), unchanged);

// History is newest-first and de-duplicated across server and local copies.
const song = (id: string, playedAt?: string) => ({ id, name: id, uri: `spotify:track:${id}`, duration_ms: 1, artists: [{ name: "A" }], album: { name: "" }, ...(playedAt ? { played_at: playedAt } : {}) }) as SpotifyTrack;
assert.deepEqual(
  mergeHistory([song("x", "2026-10-13T09:00:00Z"), song("y", "2026-10-13T08:00:00Z")], [song("y", "2026-10-12T00:00:00Z"), song("z", "2026-10-13T10:00:00Z")]).map((track) => track.id),
  ["z", "x", "y"],
);

console.log("Spotify music unit tests passed");
