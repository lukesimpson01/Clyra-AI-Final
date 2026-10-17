/**
 * The page-level views of Clyra Music: Home, Search/Browse, Your Library,
 * playlist/Liked Songs/album collections, the artist page and lyrics.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { SpotifyAlbum, SpotifyArtist, SpotifyLyrics, SpotifyPlaylist, SpotifyPlaylistItem, SpotifyTrack } from "../../lib/electron-runtime";
import type { SpotifyPlaybackHook } from "../chat/SpotifyNotch";
import { useSp } from "./ctx";
import { CardsSkeleton, MediaCard, QuickTile, RowsSkeleton, Shelf, TrackTable, sortRows, type SortState, type TrackRowData } from "./lists";
import { addRecentSearch, clearRecentSearches, readRecentSearches, removeRecentSearch, type RecentSearch } from "./music-state";
import { Artwork, Icon, IconBtn, LikedArt, PlayBtn, bigImage, fmtCount, fmtDuration, greeting, initials, midImage } from "./ui";

/* ── Artwork tint (collection + lyrics backgrounds) ──────────────────────── */

const tintCache = new Map<string, string>();

/** Average colour of an image, darkened for text contrast. */
export function useArtworkTint(src?: string, strength = 0.62) {
  const [tint, setTint] = useState<string | null>(() => (src ? tintCache.get(`${src}|${strength}`) ?? null : null));
  useEffect(() => {
    if (!src) { setTint(null); return; }
    const key = `${src}|${strength}`;
    const cached = tintCache.get(key);
    if (cached) { setTint(cached); return; }
    setTint(null);
    let cancelled = false;
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = 12;
        canvas.height = 12;
        const context = canvas.getContext("2d", { willReadFrequently: true });
        if (!context) return;
        context.drawImage(image, 0, 0, 12, 12);
        const data = context.getImageData(0, 0, 12, 12).data;
        let r = 0, g = 0, b = 0, n = 0;
        for (let index = 0; index < data.length; index += 4) { r += data[index]; g += data[index + 1]; b += data[index + 2]; n += 1; }
        const value = `rgb(${Math.round((r / n) * strength)}, ${Math.round((g / n) * strength)}, ${Math.round((b / n) * strength)})`;
        tintCache.set(key, value);
        if (!cancelled) setTint(value);
      } catch { /* cross-origin art can't be sampled; the default tint stays */ }
    };
    image.src = src;
    return () => { cancelled = true; };
  }, [src, strength]);
  return tint;
}

/** Soft page wash behind a collection header, like Spotify's coloured fade. */
export function PageWash({ color }: { color: string | null }) {
  const base = color || "#8aa4dc";
  return <div className="sp-main__bg" style={{ background: `linear-gradient(180deg, color-mix(in srgb, ${base} 58%, white) 0%, color-mix(in srgb, ${base} 20%, var(--sp-panel)) 62%, var(--sp-panel) 100%)` }} />;
}

/* ── Home ────────────────────────────────────────────────────────────────── */

export type HomeFilter = "all" | "music" | "playlists" | "artists";

export function HomeView({ filter, onWash }: { filter: HomeFilter; onWash: (color: string | null) => void }) {
  const { playback, openPlaylist, openArtist, openAlbum, openMenu, trackMenu, goTo, isPlaying, playingTrackId } = useSp();
  const { playlists, recentTracks, savedTracks, playTrackUri, playLikedSongs, playPlaylistUri, browse, contextUri, profile } = playback;
  const [topArtists, setTopArtists] = useState<SpotifyArtist[]>([]);
  const [topTracks, setTopTracks] = useState<SpotifyTrack[]>([]);
  const [savedAlbums, setSavedAlbums] = useState<SpotifyAlbum[]>([]);
  const [hoverWash, setHoverWash] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void browse("top-artists").then((res) => { if (alive && res.ok) setTopArtists(res.artists ?? []); });
    void browse("top-tracks").then((res) => { if (alive && res.ok) setTopTracks(res.tracks ?? []); });
    void browse("saved-albums").then((res) => { if (alive && res.ok) setSavedAlbums(res.albums ?? []); });
    return () => { alive = false; };
  }, [browse]);

  useEffect(() => { onWash(hoverWash); }, [hoverWash, onWash]);

  const quick = useMemo(() => {
    const items: Array<{ key: string; title: string; art?: string; liked?: boolean; open: () => void; play: () => void; playing: boolean }> = [];
    if (savedTracks.length) items.push({ key: "liked", title: "Liked Songs", liked: true, open: () => goTo({ type: "liked" }), play: () => void playLikedSongs(), playing: false });
    for (const playlist of playlists.slice(0, 7)) {
      items.push({ key: playlist.id, title: playlist.name, art: midImage(playlist.images), open: () => openPlaylist(playlist), play: () => void playPlaylistUri(playlist.uri), playing: contextUri === playlist.uri });
    }
    return items.slice(0, 8);
  }, [playlists, savedTracks.length, goTo, openPlaylist, playLikedSongs, playPlaylistUri, contextUri]);

  const recentUris = useMemo(() => recentTracks.map((item) => item.uri), [recentTracks]);
  const showMusic = filter === "all" || filter === "music";
  const showPlaylists = filter === "all" || filter === "playlists";
  const showArtists = filter === "all" || filter === "artists";
  const showAlbums = filter === "all" || filter === "music";
  const name = profile?.displayName?.split(" ")[0];

  const trackCard = (item: SpotifyTrack, uris: string[], key: string) => (
    <MediaCard
      key={key}
      art={bigImage(item.album?.images)}
      title={item.name}
      sub={item.artists.map((artist) => artist.name).join(", ")}
      playing={playingTrackId === item.id && isPlaying}
      onOpen={() => openAlbum(item.album, item)}
      onPlay={() => void playTrackUri(item.uri, { uris })}
      onContextMenu={(event) => openMenu(event, trackMenu(item))}
    />
  );

  const empty = !quick.length && !recentTracks.length && !topArtists.length && !playlists.length;

  return (
    <div>
      <h1 className="sp-greet">{greeting()}{name ? `, ${name}` : ""}</h1>
      {showPlaylists && quick.length > 0 ? (
        <div className="sp-quick">
          {quick.map((item) => (
            <div key={item.key} onMouseEnter={() => setHoverWash(item.liked ? "#4a62e8" : null)} onMouseLeave={() => setHoverWash(null)} style={{ display: "contents" }}>
              <QuickTile
                title={item.title}
                art={item.art}
                artNode={item.liked ? <LikedArt /> : undefined}
                playing={item.playing && isPlaying}
                onOpen={item.open}
                onPlay={item.play}
              />
            </div>
          ))}
        </div>
      ) : null}

      {showMusic && recentTracks.length > 0 ? (
        <Shelf title="Recently played" count={recentTracks.length}>
          {recentTracks.slice(0, 20).map((item, index) => trackCard(item, recentUris, `recent-${item.id}-${index}`))}
        </Shelf>
      ) : null}

      {showArtists && topArtists.length > 0 ? (
        <Shelf title="Your top artists" count={topArtists.length}>
          {topArtists.map((artist) => (
            <MediaCard
              key={artist.id}
              round
              art={bigImage(artist.images)}
              title={artist.name}
              sub="Artist"
              onOpen={() => openArtist(artist)}
              onPlay={() => void playPlaylistUri(artist.uri)}
              label={`Open artist ${artist.name}`}
            />
          ))}
        </Shelf>
      ) : null}

      {showPlaylists && playlists.length > 0 ? (
        <Shelf title="Your playlists" onTitle={() => goTo({ type: "library" })} count={playlists.length}>
          {playlists.map((playlist) => (
            <MediaCard
              key={playlist.id}
              art={bigImage(playlist.images)}
              title={playlist.name}
              sub={`By ${playlist.owner?.display_name || "Spotify"}`}
              playing={contextUri === playlist.uri && isPlaying}
              onOpen={() => openPlaylist(playlist)}
              onPlay={() => void playPlaylistUri(playlist.uri)}
            />
          ))}
        </Shelf>
      ) : null}

      {showMusic && topTracks.length > 0 ? (
        <Shelf title="Your top songs" count={topTracks.length}>
          {topTracks.map((item, index) => trackCard(item, topTracks.map((entry) => entry.uri), `top-${item.id}-${index}`))}
        </Shelf>
      ) : null}

      {showAlbums && savedAlbums.length > 0 ? (
        <Shelf title="Albums you saved" count={savedAlbums.length}>
          {savedAlbums.map((album) => (
            <MediaCard
              key={album.id}
              art={bigImage(album.images)}
              title={album.name}
              sub={`${album.release_date?.slice(0, 4) ?? ""} • ${album.artists?.map((artist) => artist.name).join(", ") ?? ""}`}
              onOpen={() => openAlbum(album)}
              onPlay={() => void playPlaylistUri(album.uri)}
            />
          ))}
        </Shelf>
      ) : null}

      {empty ? (
        <div className="sp-empty">
          <h3>Nothing here yet</h3>
          <p>Play something from Search and it will show up here.</p>
          <div style={{ marginTop: 20 }}><button type="button" className="sp-pill" onClick={() => goTo({ type: "search" })}>Find something to play</button></div>
        </div>
      ) : null}
    </div>
  );
}

/* ── Search / Browse all ─────────────────────────────────────────────────── */

const GENRES: Array<{ name: string; color: string; query?: string }> = [
  { name: "Pop", color: "#2f6bff" }, { name: "Hip-Hop", color: "#6b4bdb" }, { name: "Rock", color: "#0f4fd8" }, { name: "Latin", color: "#e0457b" },
  { name: "Dance & Electronic", color: "#1aa6c9", query: "electronic dance" }, { name: "Indie", color: "#4a7c9b" }, { name: "Chill", color: "#3f8ee8" }, { name: "R&B", color: "#8a3fcf" },
  { name: "Workout", color: "#e0713a" }, { name: "Mood", color: "#2d9bd6" }, { name: "Focus", color: "#3358a8" }, { name: "Sleep", color: "#4a3fa5" },
  { name: "Jazz", color: "#c2873a" }, { name: "Classical", color: "#5b6b8c" }, { name: "Country", color: "#b8683a" }, { name: "Metal", color: "#37404f" },
  { name: "Party", color: "#d93f9b" }, { name: "K-pop", color: "#7a52e8" }, { name: "Soul", color: "#a8453f" }, { name: "Acoustic", color: "#3f8f8a" },
];

export type SearchTab = "all" | "songs" | "artists" | "albums" | "playlists";
type SearchBundle = { tracks: SpotifyTrack[]; playlists: SpotifyPlaylist[]; artists: SpotifyArtist[]; albums: SpotifyAlbum[] };
const EMPTY_RESULTS: SearchBundle = { tracks: [], playlists: [], artists: [], albums: [] };

export function SearchView({ query, setQuery, tab, onTab }: { query: string; setQuery: (value: string) => void; tab: SearchTab; onTab: (tab: SearchTab) => void }) {
  const { playback, openPlaylist, openArtist, openAlbum, openMenu, trackMenu, isPlaying, playingTrackId } = useSp();
  const { browse, search, playTrackUri, playPlaylistUri, recentTracks, contextUri } = playback;
  const [results, setResults] = useState<SearchBundle>(EMPTY_RESULTS);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recent, setRecent] = useState<RecentSearch[]>(readRecentSearches);
  const requestRef = useRef(0);
  const trimmed = query.trim();

  useEffect(() => {
    if (!trimmed) {
      requestRef.current += 1;
      setResults(EMPTY_RESULTS);
      setSearching(false);
      setError(null);
      return;
    }
    const request = ++requestRef.current;
    setSearching(true);
    setError(null);
    const timer = window.setTimeout(async () => {
      try {
        let bundle: SearchBundle | null = null;
        const full = await browse("search-all", { query: trimmed });
        if (full.ok) bundle = { tracks: full.tracks ?? [], playlists: full.playlists ?? [], artists: full.artists ?? [], albums: full.albums ?? [] };
        else {
          const basic = await search(trimmed, "track,playlist", 10);
          if (basic.ok) bundle = { ...EMPTY_RESULTS, tracks: basic.tracks ?? [], playlists: basic.playlists ?? [] };
          else if (request === requestRef.current) setError(basic.error || full.error || "Search is temporarily unavailable.");
        }
        if (request === requestRef.current && bundle) setResults(bundle);
      } catch {
        if (request === requestRef.current) setError("Search is temporarily unavailable.");
      } finally {
        if (request === requestRef.current) setSearching(false);
      }
    }, 220);
    return () => window.clearTimeout(timer);
  }, [trimmed, browse, search]);

  const remember = (entry: { track: SpotifyTrack } | { playlist: SpotifyPlaylist }) => setRecent((current) => addRecentSearch(current, entry));
  const playResult = (item: SpotifyTrack) => { remember({ track: item }); void playTrackUri(item.uri, { uris: results.tracks.map((entry) => entry.uri) }); };
  const recentUris = useMemo(() => recentTracks.map((item) => item.uri), [recentTracks]);

  if (!trimmed) {
    return (
      <div>
        {recent.length > 0 ? (
          <section className="sp-shelf" aria-label="Recent searches">
            <div className="sp-shelf__head">
              <h2 className="sp-shelf__title">Recent searches</h2>
              <button type="button" className="sp-shelf__more" onClick={() => setRecent(clearRecentSearches())}>Clear</button>
            </div>
            <div className="sp-recent-grid">
              {recent.map((entry) => {
                const isTrack = entry.kind === "track";
                const title = isTrack ? entry.track.name : entry.playlist.name;
                return (
                  <MediaCard
                    key={`${entry.kind}-${entry.id}`}
                    art={isTrack ? bigImage(entry.track.album?.images) : bigImage(entry.playlist.images)}
                    title={title}
                    sub={isTrack ? `Song • ${entry.track.artists.map((artist) => artist.name).join(", ")}` : `Playlist • ${entry.playlist.owner?.display_name || "Spotify"}`}
                    onOpen={() => { if (isTrack) { remember({ track: entry.track }); void playTrackUri(entry.track.uri); } else { remember({ playlist: entry.playlist }); openPlaylist(entry.playlist); } }}
                    onPlay={() => { if (isTrack) void playTrackUri(entry.track.uri); else void playPlaylistUri(entry.playlist.uri); }}
                    onRemove={() => setRecent((current) => removeRecentSearch(current, entry.kind, entry.id))}
                  />
                );
              })}
            </div>
          </section>
        ) : null}
        <h2 className="sp-section-h">Browse all</h2>
        <div className="sp-genres">
          {GENRES.map((genre) => (
            <button key={genre.name} type="button" className="sp-genre" style={{ background: genre.color }} onClick={() => setQuery(genre.query ?? genre.name)}>
              {genre.name}
              <span className="sp-genre__art"><Icon name="note" size={30} /></span>
            </button>
          ))}
        </div>
        {recentTracks.length > 0 && recent.length === 0 ? (
          <Shelf title="Recently played" count={recentTracks.length}>
            {recentTracks.slice(0, 10).map((item, index) => (
              <MediaCard key={`${item.id}-${index}`} art={bigImage(item.album?.images)} title={item.name} sub={item.artists.map((artist) => artist.name).join(", ")} playing={playingTrackId === item.id && isPlaying} onOpen={() => openAlbum(item.album, item)} onPlay={() => void playTrackUri(item.uri, { uris: recentUris })} onContextMenu={(event) => openMenu(event, trackMenu(item))} />
            ))}
          </Shelf>
        ) : null}
      </div>
    );
  }

  const tabs: Array<[SearchTab, string]> = [["all", "All"], ["songs", "Songs"], ["artists", "Artists"], ["albums", "Albums"], ["playlists", "Playlists"]];
  const nothing = !searching && !error && !results.tracks.length && !results.playlists.length && !results.artists.length && !results.albums.length;
  const top = pickTopResult(trimmed, results);
  const songRows: TrackRowData[] = (tab === "songs" ? results.tracks : results.tracks.slice(0, 4)).map((item) => ({ track: item }));

  const artistCards = (
    <>
      {results.artists.map((artist) => (
        <MediaCard key={artist.id} round art={bigImage(artist.images)} title={artist.name} sub="Artist" onOpen={() => openArtist(artist)} onPlay={() => void playPlaylistUri(artist.uri)} label={`Open artist ${artist.name}`} />
      ))}
    </>
  );
  const albumCards = (
    <>
      {results.albums.map((album) => (
        <MediaCard key={album.id} art={bigImage(album.images)} title={album.name} sub={`${album.release_date?.slice(0, 4) ?? ""} • ${album.artists?.map((artist) => artist.name).join(", ") ?? ""}`} onOpen={() => openAlbum(album)} onPlay={() => void playPlaylistUri(album.uri)} />
      ))}
    </>
  );
  const playlistCards = (
    <>
      {results.playlists.map((playlist) => (
        <MediaCard key={playlist.id} art={bigImage(playlist.images)} title={playlist.name} sub={`By ${playlist.owner?.display_name || "Spotify"}`} playing={contextUri === playlist.uri && isPlaying} onOpen={() => { remember({ playlist }); openPlaylist(playlist); }} onPlay={() => { remember({ playlist }); void playPlaylistUri(playlist.uri); }} />
      ))}
    </>
  );

  return (
    <div style={{ opacity: searching ? 0.7 : 1, transition: "opacity .15s" }}>
      <div className="sp-chips" style={{ padding: "8px 24px 16px" }} role="tablist" aria-label="Search filters">
        {tabs.map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} className={`sp-chip ${tab === id ? "is-on" : ""}`} onClick={() => onTab(id)}>{label}</button>
        ))}
      </div>
      {error ? <div className="sp-empty"><h3>Search unavailable</h3><p>{error}</p></div> : null}
      {searching && nothing ? <RowsSkeleton /> : null}
      {nothing && !searching ? (
        <div className="sp-empty"><h3>No results found for “{trimmed}”</h3><p>Please make sure your words are spelled correctly, or use fewer or different keywords.</p></div>
      ) : null}

      {tab === "all" && (top || songRows.length > 0) ? (
        <div className="sp-top-result" style={{ marginBottom: 8 }}>
          {top ? (
            <div className="sp-top-result__col">
              <h2 className="sp-section-h">Top result</h2>
              <div
                className="sp-top-result__card"
                role="button"
                tabIndex={0}
                onClick={() => top.open()}
                onContextMenu={top.menu ? (event) => openMenu(event, top.menu!) : undefined}
                onKeyDown={(event) => { if (event.key === "Enter") top.open(); }}
              >
                <div className={`sp-top-result__art ${top.round ? "is-round" : ""}`}><Artwork src={top.art} round={top.round} /></div>
                <div className="sp-top-result__name sp-ellipsis">{top.title}</div>
                <div className="sp-top-result__kind"><b>{top.kind}</b><span className="sp-ellipsis">{top.sub}</span></div>
                <PlayBtn onClick={() => top.play()} label={`Play ${top.title}`} />
              </div>
            </div>
          ) : null}
          {songRows.length > 0 ? (
            <div className="sp-top-result__list">
              <h2 className="sp-section-h">Songs</h2>
              <TrackTable rows={songRows} variant="simple" header={false} onPlayRow={(item) => playResult(item)} rowKeyPrefix="s" />
            </div>
          ) : null}
        </div>
      ) : null}
      {tab === "songs" && songRows.length > 0 ? <TrackTable rows={songRows} variant="simple" header={false} onPlayRow={(item) => playResult(item)} rowKeyPrefix="s" /> : null}
      {(tab === "all" || tab === "artists") && results.artists.length > 0 ? (tab === "all" ? <Shelf title="Artists" count={results.artists.length}>{artistCards}</Shelf> : <div className="sp-shelf__grid is-open" style={{ paddingTop: 8 }}>{artistCards}</div>) : null}
      {(tab === "all" || tab === "albums") && results.albums.length > 0 ? (tab === "all" ? <Shelf title="Albums" count={results.albums.length}>{albumCards}</Shelf> : <div className="sp-shelf__grid is-open" style={{ paddingTop: 8 }}>{albumCards}</div>) : null}
      {(tab === "all" || tab === "playlists") && results.playlists.length > 0 ? (tab === "all" ? <Shelf title="Playlists" count={results.playlists.length}>{playlistCards}</Shelf> : <div className="sp-shelf__grid is-open" style={{ paddingTop: 8 }}>{playlistCards}</div>) : null}
    </div>
  );

  function pickTopResult(text: string, found: SearchBundle) {
    const lowered = text.toLowerCase();
    const exactArtist = found.artists.find((artist) => artist.name.toLowerCase() === lowered);
    if (exactArtist || (!found.tracks.length && found.artists[0])) {
      const artist = exactArtist ?? found.artists[0];
      return { kind: "Artist", title: artist.name, sub: "", art: bigImage(artist.images), round: true, open: () => openArtist(artist), play: () => void playPlaylistUri(artist.uri), menu: undefined as ReturnType<typeof trackMenu> | undefined };
    }
    const first = found.tracks[0];
    if (!first) return null;
    return { kind: "Song", title: first.name, sub: first.artists.map((artist) => artist.name).join(", "), art: bigImage(first.album?.images), round: false, open: () => playResult(first), play: () => playResult(first), menu: trackMenu(first) };
  }
}

/* ── Library page (mobile/collapsed destination) ─────────────────────────── */

export function LibraryView() {
  const { playback, openPlaylist, openArtist, openAlbum, goTo } = useSp();
  const { playlists, savedTracks, playLikedSongs, playPlaylistUri, browse } = playback;
  const [artists, setArtists] = useState<SpotifyArtist[]>([]);
  const [albums, setAlbums] = useState<SpotifyAlbum[]>([]);
  useEffect(() => {
    let alive = true;
    void browse("followed-artists").then((res) => { if (alive && res.ok) setArtists(res.artists ?? []); });
    void browse("saved-albums").then((res) => { if (alive && res.ok) setAlbums(res.albums ?? []); });
    return () => { alive = false; };
  }, [browse]);
  return (
    <div>
      <h1 className="sp-greet">Your Library</h1>
      <div className="sp-shelf__grid is-open" style={{ paddingTop: 16 }}>
        {savedTracks.length ? <MediaCard art={undefined} title="Liked Songs" sub={`Playlist • ${savedTracks.length} songs`} onOpen={() => goTo({ type: "liked" })} onPlay={() => void playLikedSongs()} /> : null}
        {playlists.map((playlist) => <MediaCard key={playlist.id} art={bigImage(playlist.images)} title={playlist.name} sub={`Playlist • ${playlist.owner?.display_name || "Spotify"}`} onOpen={() => openPlaylist(playlist)} onPlay={() => void playPlaylistUri(playlist.uri)} />)}
        {artists.map((artist) => <MediaCard key={artist.id} round art={bigImage(artist.images)} title={artist.name} sub="Artist" onOpen={() => openArtist(artist)} onPlay={() => void playPlaylistUri(artist.uri)} />)}
        {albums.map((album) => <MediaCard key={album.id} art={bigImage(album.images)} title={album.name} sub={`Album • ${album.artists?.[0]?.name ?? ""}`} onOpen={() => openAlbum(album)} onPlay={() => void playPlaylistUri(album.uri)} />)}
      </div>
      {!playlists.length && !savedTracks.length && !artists.length && !albums.length ? <div className="sp-empty"><h3>Your Library is empty</h3><p>Save songs, follow artists and create playlists to see them here.</p></div> : null}
    </div>
  );
}

/* ── Collections: playlist, Liked Songs, album ───────────────────────────── */

type CollectionProps = {
  kind: "Playlist" | "Album" | "Single" | "EP";
  title: string;
  art: ReactNode;
  artSrc?: string;
  byline: ReactNode;
  stats: string;
  rows: TrackRowData[] | null;
  error: string | null;
  contextUri: string | null;
  variant: "playlist" | "album";
  emptyText: string;
  libraryUri?: string;
  editable?: boolean;
  onAddTrack?: (track: SpotifyTrack) => Promise<boolean> | void;
  onWash: (color: string | null) => void;
  children?: ReactNode;
  menuItems?: () => import("./ctx").MenuItem[];
  extraMenu?: (track: SpotifyTrack) => { playlist?: SpotifyPlaylist; onRemove?: () => void } | undefined;
  onReady?: () => void;
};

export function CollectionPage({ kind, title, art, artSrc, byline, stats, rows, error, contextUri, variant, emptyText, libraryUri, editable, onAddTrack, onWash, children, menuItems, extraMenu, onReady }: CollectionProps) {
  const { playback, openMenu, toast, isPlaying } = useSp();
  const { playTrackUri, playPlaylistUri, track: nowPlaying, pause, resume, shuffleOn, toggleShuffle, contextUri: playingContext, likeUris, checkLiked } = playback;
  const [filter, setFilter] = useState("");
  const [findOpen, setFindOpen] = useState(false);
  const [sort, setSort] = useState<SortState>({ key: "default", dir: 1 });
  const [saved, setSaved] = useState(false);
  const tint = useArtworkTint(artSrc, 0.95);
  useEffect(() => { onWash(tint); return () => onWash(null); }, [tint, onWash]);
  useEffect(() => { onReady?.(); }, [onReady, rows]);

  useEffect(() => {
    if (!libraryUri) return;
    let alive = true;
    void checkLiked([libraryUri]).then((flags) => { if (alive) setSaved(Boolean(flags[0])); });
    return () => { alive = false; };
  }, [libraryUri, checkLiked]);

  const uris = useMemo(() => (rows ?? []).map((row) => row.track.uri), [rows]);
  const thisPlaying = contextUri ? playingContext === contextUri : Boolean(nowPlaying && uris.includes(nowPlaying.uri) && !playingContext);
  const needle = filter.trim().toLowerCase();
  const visible = useMemo(() => {
    const base = rows ?? [];
    const filtered = needle ? base.filter(({ track }) => `${track.name} ${track.artists.map((a) => a.name).join(" ")} ${track.album?.name ?? ""}`.toLowerCase().includes(needle)) : base;
    return sortRows(filtered, sort);
  }, [rows, needle, sort]);

  const playRow = (track: SpotifyTrack) => {
    if (nowPlaying?.id === track.id && thisPlaying) { void (isPlaying ? pause() : resume()); return; }
    void playTrackUri(track.uri, contextUri ? { contextUri } : { uris });
  };
  const playAll = () => {
    if (thisPlaying) { void (isPlaying ? pause() : resume()); return; }
    if (contextUri) void playPlaylistUri(contextUri);
    else if (uris.length) void playTrackUri(uris[0], { uris });
  };
  const onSort = (key: SortState["key"]) => setSort((current) => (current.key === key ? (current.dir === 1 ? { key, dir: -1 } : { key: "default", dir: 1 }) : { key, dir: 1 }));
  const long = title.length > 22;

  return (
    <div>
      <div className="sp-hero">
        <div className="sp-hero__art">{art}</div>
        <div className="sp-hero__meta">
          <span className="sp-hero__kind">{kind}</span>
          <h1 className={`sp-hero__title ${long ? "is-long" : ""}`}>{title}</h1>
          <div className="sp-hero__byline">{byline}{stats ? <><span className="sp-dot">•</span><span className="sp-sub">{stats}</span></> : null}</div>
        </div>
      </div>
      <div className="sp-actions">
        <PlayBtn size="lg" playing={thisPlaying && isPlaying} disabled={!rows?.length} onClick={playAll} />
        <IconBtn icon="shuffle" label={shuffleOn ? "Disable shuffle" : "Enable shuffle"} on={shuffleOn} size={28} onClick={toggleShuffle} />
        {libraryUri ? (
          <IconBtn
            icon={saved ? "heartFill" : "heart"}
            label={saved ? `Remove ${kind.toLowerCase()} from Your Library` : `Save ${kind.toLowerCase()} to Your Library`}
            on={saved}
            size={28}
            onClick={() => {
              const next = !saved;
              setSaved(next);
              void likeUris([libraryUri], next).then((result) => {
                if (!result.ok) { setSaved(!next); toast(result.error || "Couldn't update your Library."); }
                else toast(next ? `Added to Your Library` : `Removed from Your Library`);
              });
            }}
          />
        ) : null}
        {menuItems ? <IconBtn icon="more" label="More options" size={26} onClick={(event) => { const rect = event.currentTarget.getBoundingClientRect(); openMenu({ clientX: rect.left, clientY: rect.bottom + 4 }, menuItems()); }} /> : null}
        <div className="sp-actions__right">
          <div className={`sp-find ${findOpen ? "is-open" : ""}`}>
            <IconBtn icon="search" label="Search in list" size={18} onClick={() => setFindOpen((value) => !value)} />
            <input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder={`Search in ${kind.toLowerCase()}`} aria-label={`Search in ${title}`} tabIndex={findOpen ? 0 : -1} onBlur={() => { if (!filter) setFindOpen(false); }} />
          </div>
          {variant === "playlist" ? (
            <button type="button" className="sp-sortbtn" onClick={() => onSort(sort.key === "default" ? "title" : sort.key === "title" ? "artist" : sort.key === "artist" ? "album" : sort.key === "album" ? "added" : "default")}>
              {sort.key === "default" ? "Custom order" : sort.key === "added" ? "Date added" : sort.key[0].toUpperCase() + sort.key.slice(1)}
              <Icon name="list" size={16} />
            </button>
          ) : null}
        </div>
      </div>

      {error ? (
        <div className="sp-empty"><h3>Couldn't load this {kind.toLowerCase()}</h3><p>{error}</p></div>
      ) : rows === null ? (
        <RowsSkeleton />
      ) : rows.length === 0 ? (
        editable ? null : <div className="sp-empty"><p>{emptyText}</p></div>
      ) : (
        <>
          <TrackTable rows={visible} variant={variant} sort={sort} onSort={onSort} onPlayRow={(track) => playRow(track)} extraMenu={extraMenu} rowKeyPrefix={contextUri ?? "liked"} />
          {visible.length === 0 ? <div className="sp-empty"><p>No songs match “{filter.trim()}”.</p></div> : null}
        </>
      )}
      {editable && rows && rows.length === 0 && onAddTrack ? <PlaylistFinder onAdd={onAddTrack} /> : null}
      {children}
    </div>
  );
}

/** "Let's find something for your playlist" — Spotify's empty-playlist search. */
function PlaylistFinder({ onAdd }: { onAdd: (track: SpotifyTrack) => Promise<boolean> | void }) {
  const { playback } = useSp();
  const [text, setText] = useState("");
  const [found, setFound] = useState<SpotifyTrack[]>([]);
  const [added, setAdded] = useState<Set<string>>(new Set());
  useEffect(() => {
    const value = text.trim();
    if (!value) { setFound([]); return; }
    let alive = true;
    const timer = window.setTimeout(() => {
      void playback.search(value, "track", 10).then((res) => { if (alive && res.ok) setFound(res.tracks ?? []); });
    }, 220);
    return () => { alive = false; window.clearTimeout(timer); };
  }, [text, playback]);
  return (
    <div className="sp-finder">
      <h3>Let's find something for your playlist</h3>
      <div className="sp-finder__input">
        <Icon name="search" size={16} />
        <input value={text} onChange={(event) => setText(event.target.value)} placeholder="Search for songs" aria-label="Search for songs to add" />
      </div>
      {found.map((item) => (
        <div key={item.id} className="sp-tr" style={{ gridTemplateColumns: "40px minmax(0,1fr) auto", gap: 16 }}>
          <div className="sp-tr__art"><Artwork src={midImage(item.album?.images)} /></div>
          <div className="sp-tr__text"><div className="sp-tr__name sp-ellipsis">{item.name}</div><div className="sp-tr__artist sp-ellipsis">{item.artists.map((artist) => artist.name).join(", ")}</div></div>
          <button
            type="button"
            className="sp-pill sp-pill--ghost"
            disabled={added.has(item.id)}
            onClick={async () => { const ok = await onAdd(item); if (ok !== false) setAdded((current) => new Set(current).add(item.id)); }}
          >
            {added.has(item.id) ? "Added" : "Add"}
          </button>
        </div>
      ))}
    </div>
  );
}

export function PlaylistPage({ playlist, onWash }: { playlist: SpotifyPlaylist; onWash: (color: string | null) => void }) {
  const { playback, toast, addToPlaylist } = useSp();
  const { getPlaylistTracks, profile, playlistsChanged } = playback;
  const [items, setItems] = useState<SpotifyPlaylistItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let alive = true;
    setItems(null);
    setError(null);
    void getPlaylistTracks(playlist.id).then((res) => {
      if (!alive) return;
      if (res.ok) setItems(res.items ?? []);
      else setError(res.error || "Couldn't load this playlist.");
    });
    return () => { alive = false; };
  }, [playlist.id, getPlaylistTracks, version]);

  const rows = useMemo<TrackRowData[] | null>(() => (items ? items.map((item) => ({ track: item.track, addedAt: item.addedAt })) : null), [items]);
  const total = useMemo(() => (rows ?? []).reduce((sum, row) => sum + (row.track.duration_ms || 0), 0), [rows]);
  const owner = playlist.owner?.display_name || "Spotify";
  const mine = Boolean(profile?.id && playlist.owner?.id === profile.id);
  const stats = rows ? `${rows.length} song${rows.length === 1 ? "" : "s"}${total > 0 ? `, ${fmtDuration(total)}` : ""}` : "";

  return (
    <CollectionPage
      kind="Playlist"
      title={playlist.name}
      art={<Artwork src={bigImage(playlist.images)} eager />}
      artSrc={bigImage(playlist.images)}
      byline={<><span className="sp-hero__avatar">{mine && profile?.image ? <img src={profile.image} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : initials(owner)}</span><strong>{owner}</strong></>}
      stats={stats}
      rows={rows}
      error={error}
      contextUri={playlist.uri}
      variant="playlist"
      libraryUri={mine ? undefined : playlist.uri}
      emptyText="This playlist has no songs yet."
      editable={mine}
      onWash={onWash}
      onAddTrack={async (track) => {
        const ok = await addToPlaylist(playlist, [track]);
        if (ok) { setVersion((value) => value + 1); playlistsChanged(); }
        return ok;
      }}
      menuItems={() => [
        { label: "Copy playlist link", icon: "link", onClick: () => copyLink(`https://open.spotify.com/playlist/${playlist.id}`, toast) },
        { label: "Open in Spotify", icon: "external", onClick: () => window.open(`https://open.spotify.com/playlist/${playlist.id}`, "_blank", "noopener") },
      ]}
      extraMenu={() => (mine ? { playlist } : undefined)}
    />
  );
}

export function LikedPage({ onWash }: { onWash: (color: string | null) => void }) {
  const { playback } = useSp();
  const { savedTracks, profile } = playback;
  const rows = useMemo<TrackRowData[]>(() => savedTracks.map((track) => ({ track })), [savedTracks]);
  const total = rows.reduce((sum, row) => sum + row.track.duration_ms, 0);
  return (
    <CollectionPage
      kind="Playlist"
      title="Liked Songs"
      art={<LikedArt />}
      byline={<><span className="sp-hero__avatar">{profile?.image ? <img src={profile.image} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : initials(profile?.displayName || "You")}</span><strong>{profile?.displayName || "You"}</strong></>}
      stats={rows.length ? `${rows.length} songs${total ? `, ${fmtDuration(total)}` : ""}` : ""}
      rows={rows}
      error={null}
      contextUri={null}
      variant="playlist"
      emptyText="Songs you like will appear here. Save songs by tapping the + icon."
      onWash={onWash}
    />
  );
}

export function AlbumPage({ album: seed, onWash }: { album: SpotifyAlbum; onWash: (color: string | null) => void }) {
  const { playback, openArtist, toast } = useSp();
  const { browse } = playback;
  const [album, setAlbum] = useState<SpotifyAlbum>(seed);
  const [tracks, setTracks] = useState<SpotifyTrack[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [more, setMore] = useState<SpotifyAlbum[]>([]);

  useEffect(() => {
    let alive = true;
    setAlbum(seed);
    setTracks(null);
    setError(null);
    void browse("album", { id: seed.id }).then((res) => {
      if (!alive) return;
      if (res.ok && res.album) { setAlbum(res.album); setTracks(res.tracks ?? []); }
      else setError(res.error || "Couldn't load this album.");
    });
    return () => { alive = false; };
  }, [seed.id, browse]);

  const artistId = album.artists?.[0]?.id;
  useEffect(() => {
    if (!artistId) { setMore([]); return; }
    let alive = true;
    void browse("artist-albums", { id: artistId }).then((res) => { if (alive && res.ok) setMore((res.albums ?? []).filter((item) => item.id !== seed.id).slice(0, 12)); });
    return () => { alive = false; };
  }, [artistId, seed.id, browse]);

  const rows = useMemo<TrackRowData[] | null>(() => (tracks ? tracks.map((track) => ({ track: { ...track, album: { ...track.album, name: album.name, images: album.images } } })) : null), [tracks, album]);
  const total = (rows ?? []).reduce((sum, row) => sum + row.track.duration_ms, 0);
  const kind = album.album_type === "single" ? "Single" : album.album_type === "compilation" ? "Album" : "Album";
  const year = album.release_date?.slice(0, 4);
  const { playPlaylistUri } = playback;

  return (
    <CollectionPage
      kind={kind}
      title={album.name}
      art={<Artwork src={bigImage(album.images)} eager />}
      artSrc={bigImage(album.images)}
      byline={
        <>
          {album.artists?.map((artist, index) => (
            <span key={`${artist.name}-${index}`}>{index > 0 ? ", " : ""}<strong className="sp-link" onClick={() => openArtist(artist)}>{artist.name}</strong></span>
          ))}
          {year ? <><span className="sp-dot">•</span><span className="sp-sub">{year}</span></> : null}
        </>
      }
      stats={rows ? `${rows.length} song${rows.length === 1 ? "" : "s"}${total ? `, ${fmtDuration(total)}` : ""}` : ""}
      rows={rows}
      error={error}
      contextUri={album.uri}
      variant="album"
      libraryUri={album.uri}
      emptyText="This album has no playable songs."
      onWash={onWash}
      menuItems={() => [
        { label: "Copy album link", icon: "link", onClick: () => copyLink(`https://open.spotify.com/album/${album.id}`, toast) },
        { label: "Open in Spotify", icon: "external", onClick: () => window.open(`https://open.spotify.com/album/${album.id}`, "_blank", "noopener") },
      ]}
    >
      {more.length > 0 ? (
        <Shelf title={`More by ${album.artists?.[0]?.name ?? "this artist"}`} count={more.length}>
          {more.map((item) => (
            <AlbumCard key={item.id} album={item} onPlay={() => void playPlaylistUri(item.uri)} />
          ))}
        </Shelf>
      ) : null}
    </CollectionPage>
  );
}

function AlbumCard({ album, onPlay }: { album: SpotifyAlbum; onPlay: () => void }) {
  const { openAlbum } = useSp();
  return <MediaCard art={bigImage(album.images)} title={album.name} sub={`${album.release_date?.slice(0, 4) ?? ""} • ${album.album_type === "single" ? "Single" : "Album"}`} onOpen={() => openAlbum(album)} onPlay={onPlay} />;
}

export function copyLink(url: string, toast: (message: string) => void) {
  const done = () => toast("Link copied to clipboard");
  if (navigator.clipboard?.writeText) void navigator.clipboard.writeText(url).then(done, () => toast("Couldn't copy the link"));
  else toast("Couldn't copy the link");
}

/* ── Artist ──────────────────────────────────────────────────────────────── */

export function ArtistPage({ artist: seed, onWash }: { artist: { id: string; name: string } & Partial<SpotifyArtist>; onWash: (color: string | null) => void }) {
  const { playback, toast, isPlaying } = useSp();
  const { browse, playTrackUri, playPlaylistUri, pause, resume, track: nowPlaying, contextUri: playingContext } = playback;
  const [artist, setArtist] = useState<SpotifyArtist | null>(seed.images ? (seed as SpotifyArtist) : null);
  const [top, setTop] = useState<SpotifyTrack[] | null>(null);
  const [albums, setAlbums] = useState<SpotifyAlbum[] | null>(null);
  const [following, setFollowing] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [release, setRelease] = useState<"all" | "album" | "single">("all");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setTop(null);
    setAlbums(null);
    setShowAll(false);
    setRelease("all");
    setError(null);
    void browse("artist", { id: seed.id }).then((res) => { if (alive && res.ok && res.artist) setArtist(res.artist); else if (alive && !res.ok && !seed.images) setError(res.error || "Couldn't load this artist."); });
    void browse("artist-top-tracks", { id: seed.id, name: seed.name }).then((res) => { if (alive) setTop(res.ok ? res.tracks ?? [] : []); });
    void browse("artist-albums", { id: seed.id }).then((res) => { if (alive) setAlbums(res.ok ? res.albums ?? [] : []); });
    void browse("is-following", { id: seed.id }).then((res) => { if (alive && res.ok) setFollowing(Boolean(res.following?.[0])); });
    return () => { alive = false; };
  }, [seed.id, seed.name, seed.images, browse]);

  const image = bigImage(artist?.images ?? seed.images);
  const tint = useArtworkTint(image, 0.7);
  useEffect(() => { onWash(null); }, [onWash]);

  const topRows = useMemo<TrackRowData[]>(() => (top ?? []).map((track) => ({ track })), [top]);
  const uris = useMemo(() => topRows.map((row) => row.track.uri), [topRows]);
  const thisPlaying = Boolean(artist && playingContext === artist.uri) || Boolean(nowPlaying && uris.includes(nowPlaying.uri));
  const shownAlbums = useMemo(() => (albums ?? []).filter((album) => release === "all" || (release === "album" ? album.album_type !== "single" : album.album_type === "single")), [albums, release]);

  const playArtist = () => {
    if (thisPlaying) { void (isPlaying ? pause() : resume()); return; }
    if (uris.length) void playTrackUri(uris[0], { uris });
    else if (artist) void playPlaylistUri(artist.uri);
  };

  return (
    <div style={{ position: "relative" }}>
      <div className={`sp-artist-bg ${image ? "" : "is-empty"}`} style={image ? undefined : { ["--sp-tint" as string]: tint ?? "#7b9be0" }}>
        {image ? <img src={image} alt="" /> : null}
      </div>
      <div className="sp-hero sp-hero--artist" style={{ position: "relative", zIndex: 1 }}>
        <div className="sp-hero__meta">
          <span className="sp-hero__kind"><span className="sp-badge"><Icon name="checkCircle" size={22} /></span>Artist</span>
          <h1 className="sp-hero__title" style={{ textShadow: image ? "0 2px 24px rgba(11,16,32,.28)" : undefined, color: image ? "#fff" : undefined }}>{artist?.name ?? seed.name}</h1>
          <div className="sp-hero__byline" style={{ color: image ? "#fff" : undefined }}>
            {artist?.followers?.total ? <span>{fmtCount(artist.followers.total)} followers</span> : null}
          </div>
        </div>
      </div>
      <div className="sp-actions" style={{ position: "relative", zIndex: 1 }}>
        <PlayBtn size="lg" playing={thisPlaying && isPlaying} onClick={playArtist} />
        <button
          type="button"
          className="sp-pill sp-pill--ghost"
          aria-pressed={following}
          style={{ height: 32 }}
          onClick={() => {
            const next = !following;
            setFollowing(next);
            void browse(next ? "follow-artist" : "unfollow-artist", { id: seed.id }).then((res) => {
              if (!res.ok) { setFollowing(!next); toast(res.error || "Couldn't update follow."); }
            });
          }}
        >
          {following ? "Following" : "Follow"}
        </button>
      </div>
      {error ? <div className="sp-empty"><h3>Couldn't load this artist</h3><p>{error}</p></div> : null}
      {top === null ? <RowsSkeleton count={5} /> : topRows.length > 0 ? (
        <section style={{ position: "relative", zIndex: 1 }}>
          <h2 className="sp-section-h" style={{ paddingTop: 8 }}>Popular</h2>
          <TrackTable rows={showAll ? topRows : topRows.slice(0, 5)} variant="simple" header={false} onPlayRow={(item) => void playTrackUri(item.uri, { uris })} rowKeyPrefix="top" />
          {topRows.length > 5 ? <div className="sp-showmore"><button type="button" onClick={() => setShowAll((value) => !value)}>{showAll ? "Show less" : "See more"}</button></div> : null}
        </section>
      ) : null}
      {albums === null ? <CardsSkeleton /> : albums.length > 0 ? (
        <section style={{ position: "relative", zIndex: 1 }}>
          <Shelf title="Discography" count={shownAlbums.length}>
            {shownAlbums.map((album) => <AlbumCard key={album.id} album={album} onPlay={() => void playPlaylistUri(album.uri)} />)}
          </Shelf>
          <div className="sp-chips" style={{ padding: "0 24px 12px", order: -1 }}>
            {([["all", "Popular releases"], ["album", "Albums"], ["single", "Singles and EPs"]] as const).map(([id, label]) => (
              <button key={id} type="button" className={`sp-chip ${release === id ? "is-on" : ""}`} onClick={() => setRelease(id)}>{label}</button>
            ))}
          </div>
        </section>
      ) : null}
      {top !== null && albums !== null && !topRows.length && !albums.length && !error ? <div className="sp-empty"><h3>Nothing to show yet</h3><p>Spotify didn't return any songs or releases for this artist.</p></div> : null}
      <div style={{ height: 24 }} />
    </div>
  );
}

/* ── Lyrics ──────────────────────────────────────────────────────────────── */

const lyricsCache = new Map<string, { lyrics: SpotifyLyrics | null; error: string | null }>();

export function useTrackLyrics(track: SpotifyTrack | null, lyricsForTrack: SpotifyPlaybackHook["lyricsForTrack"]) {
  const cached = track ? lyricsCache.get(track.id) : undefined;
  const [state, setState] = useState<{ id: string | null; lyrics: SpotifyLyrics | null; error: string | null; loading: boolean }>(() => ({ id: track?.id ?? null, lyrics: cached?.lyrics ?? null, error: cached?.error ?? null, loading: Boolean(track && !cached) }));
  useEffect(() => {
    if (!track) { setState({ id: null, lyrics: null, error: null, loading: false }); return; }
    const hit = lyricsCache.get(track.id);
    if (hit) { setState({ id: track.id, ...hit, loading: false }); return; }
    let cancelled = false;
    setState({ id: track.id, lyrics: null, error: null, loading: true });
    void lyricsForTrack(track).then((result) => {
      const entry = result.ok ? { lyrics: result.lyrics ?? null, error: null } : { lyrics: null, error: result.error || "Lyrics are unavailable for this track." };
      if (result.ok) lyricsCache.set(track.id, entry);
      if (!cancelled) setState({ id: track.id, ...entry, loading: false });
    }).catch(() => { if (!cancelled) setState({ id: track.id, lyrics: null, error: "Lyrics are unavailable for this track.", loading: false }); });
    return () => { cancelled = true; };
  }, [track?.id, lyricsForTrack]);
  const fresh = state.id === (track?.id ?? null);
  return { lyrics: fresh ? state.lyrics : null, error: fresh ? state.error : null, loading: fresh ? state.loading : Boolean(track) };
}

export function activeLyricIndexFor(lyrics: SpotifyLyrics | null, progressMs: number) {
  if (!lyrics?.synced) return -1;
  let active = -1;
  for (let index = 0; index < lyrics.lines.length; index += 1) {
    const time = lyrics.lines[index].timeMs;
    if (time !== null && time <= progressMs + 150) active = index;
    else if (time !== null && time > progressMs + 150) break;
  }
  return active;
}

export function centerLyric(viewport: HTMLElement | null, index: number, smooth: boolean) {
  if (!viewport || index < 0) return;
  const line = viewport.querySelector<HTMLElement>(`[data-lyric-index="${index}"]`);
  if (!line) return;
  const top = line.getBoundingClientRect().top - viewport.getBoundingClientRect().top + viewport.scrollTop;
  viewport.scrollTo({ top: Math.max(0, top - viewport.clientHeight * 0.38), behavior: smooth ? "smooth" : "auto" });
}

export function LyricsView() {
  const { playback } = useSp();
  const { track, progressMs, seekTo, lyricsForTrack, isPlaying } = playback;
  const reduceMotion = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const userScrollUntil = useRef(0);
  const { lyrics, loading, error } = useTrackLyrics(track, lyricsForTrack);
  const artwork = bigImage(track?.album?.images);
  const tint = useArtworkTint(artwork);
  const activeIndex = useMemo(() => activeLyricIndexFor(lyrics, progressMs), [lyrics, progressMs]);

  useEffect(() => {
    if (Date.now() < userScrollUntil.current) return;
    centerLyric(viewportRef.current, activeIndex, !reduceMotion);
  }, [activeIndex, reduceMotion]);
  useEffect(() => { viewportRef.current?.scrollTo({ top: 0 }); }, [track?.id]);

  if (!track) {
    return <div className="sp-empty" style={{ paddingTop: 120 }}><h3>Lyrics</h3><p>Play a song to see its lyrics here.</p></div>;
  }
  const status = loading ? "Loading lyrics…" : lyrics?.instrumental ? "This track is instrumental." : error ? error : !lyrics || lyrics.lines.length === 0 ? "No lyrics are available for this song yet." : null;

  return (
    <div className="sp-lyrics" style={{ background: `linear-gradient(180deg, ${tint || "#3a56a8"}, color-mix(in srgb, ${tint || "#3a56a8"} 70%, #0b1020))` }}>
      <div ref={viewportRef} className="sp-lyrics__scroll" onWheel={() => { userScrollUntil.current = Date.now() + 3500; }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 34 }}>
          <div style={{ width: 56, height: 56, borderRadius: 4, overflow: "hidden", flexShrink: 0 }}><Artwork src={midImage(track.album?.images)} /></div>
          <div style={{ minWidth: 0 }}>
            <div className="sp-ellipsis" style={{ fontSize: 16, fontWeight: 700 }}>{track.name}</div>
            <div className="sp-ellipsis" style={{ fontSize: 14, color: "rgba(255,255,255,.75)" }}>{track.artists.map((a) => a.name).join(", ")}</div>
          </div>
        </div>
        {status ? <p role="status" style={{ fontSize: 28, fontWeight: 800, letterSpacing: "-.02em", color: "rgba(255,255,255,.88)" }}>{status}</p> : null}
        {!loading && lyrics && lyrics.lines.length > 0 ? (
          <div aria-label="Song lyrics">
            {lyrics.lines.map((line, index) => {
              const synced = lyrics.synced && line.timeMs !== null;
              const state = !lyrics.synced ? "plain" : index === activeIndex ? "active" : index < activeIndex ? "past" : "future";
              const color = state === "active" || state === "plain" ? "#fff" : state === "past" ? "rgba(255,255,255,.62)" : "rgba(11,16,32,.46)";
              return (
                <p
                  key={`${line.timeMs ?? "plain"}-${index}`}
                  data-lyric-index={index}
                  className={`sp-lyrics__line ${synced ? "is-synced" : ""}`}
                  onClick={synced ? () => { userScrollUntil.current = 0; seekTo(line.timeMs as number); } : undefined}
                  style={{ color, transform: state === "active" && !reduceMotion ? "scale(1.015)" : "none" }}
                >
                  {line.text}
                </p>
              );
            })}
            <div style={{ marginTop: 28, fontSize: 12, color: "rgba(255,255,255,.7)" }}>{lyrics.synced ? `Lyrics synced${isPlaying ? "" : " · paused"} · LRCLIB` : "Lyrics provided by LRCLIB"}</div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
