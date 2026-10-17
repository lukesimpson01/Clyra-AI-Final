/**
 * Cards, shelves and the track table — the three building blocks every
 * Spotify screen is made of.
 */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { SpotifyPlaylist, SpotifyTrack } from "../../lib/electron-runtime";
import { useSp } from "./ctx";
import { Artwork, Eq, Icon, PlayBtn, activateOnKey, bigImage, fmt, fmtDate, midImage } from "./ui";

/* ── Cards ───────────────────────────────────────────────────────────────── */

export function MediaCard({ art, title, sub, round = false, playing = false, onOpen, onPlay, onContextMenu, onRemove, label }: {
  art?: string;
  title: string;
  sub?: ReactNode;
  round?: boolean;
  playing?: boolean;
  onOpen: () => void;
  onPlay?: () => void;
  onContextMenu?: (event: React.MouseEvent) => void;
  onRemove?: () => void;
  label?: string;
}) {
  return (
    <div
      className={`sp-card ${round ? "sp-card--round" : ""} ${playing ? "is-playing" : ""}`}
      role="button"
      tabIndex={0}
      aria-label={label ?? `Open ${title}`}
      onClick={onOpen}
      onKeyDown={(event) => { if (event.target === event.currentTarget) activateOnKey(event, onOpen); }}
      onContextMenu={onContextMenu}
    >
      <div className="sp-card__art">
        <Artwork src={art} round={round} />
        {onPlay ? <PlayBtn className="sp-card__play" playing={playing} onClick={onPlay} label={`Play ${title}`} /> : null}
      </div>
      <div className="sp-card__title sp-ellipsis">{title}</div>
      {sub ? <div className="sp-card__sub sp-clamp2">{sub}</div> : null}
      {onRemove ? (
        <button type="button" className="sp-recent-x" aria-label={`Remove ${title}`} onClick={(event) => { event.stopPropagation(); onRemove(); }}>
          <Icon name="close" size={12} />
        </button>
      ) : null}
    </div>
  );
}

export function QuickTile({ art, title, playing, onOpen, onPlay, onContextMenu, artNode }: { art?: string; artNode?: ReactNode; title: string; playing?: boolean; onOpen: () => void; onPlay: () => void; onContextMenu?: (event: React.MouseEvent) => void }) {
  return (
    <div className={`sp-qtile ${playing ? "is-playing" : ""}`} role="button" tabIndex={0} aria-label={`Open ${title}`} onClick={onOpen} onKeyDown={(event) => { if (event.target === event.currentTarget) activateOnKey(event, onOpen); }} onContextMenu={onContextMenu}>
      <div className="sp-qtile__art">{artNode ?? <Artwork src={art} />}</div>
      <div className="sp-qtile__title sp-clamp2">{title}</div>
      <PlayBtn playing={playing} onClick={onPlay} label={`Play ${title}`} />
    </div>
  );
}

export function Shelf({ title, onTitle, children, count = 99, showAll = true }: { title: string; onTitle?: () => void; children: ReactNode; count?: number; showAll?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <section className="sp-shelf" aria-label={title}>
      <div className="sp-shelf__head">
        {onTitle ? <h2 className="sp-shelf__title sp-link" onClick={onTitle}>{title}</h2> : <h2 className="sp-shelf__title">{title}</h2>}
        {showAll && count > 5 ? <button type="button" className="sp-shelf__more" onClick={() => setOpen((value) => !value)}>{open ? "Show less" : "Show all"}</button> : null}
      </div>
      <div className={`sp-shelf__grid ${open ? "is-open" : ""}`}>{children}</div>
    </section>
  );
}

/* ── Track table ─────────────────────────────────────────────────────────── */

export type TrackRowData = { track: SpotifyTrack; addedAt?: string };
export type SortState = { key: "default" | "title" | "artist" | "album" | "added" | "duration"; dir: 1 | -1 };

export function sortRows(rows: TrackRowData[], sort: SortState) {
  if (sort.key === "default") return rows;
  const text = (value: string) => value.toLocaleLowerCase();
  const pick = (row: TrackRowData) => {
    switch (sort.key) {
      case "title": return text(row.track.name);
      case "artist": return text(row.track.artists[0]?.name || "");
      case "album": return text(row.track.album?.name || "");
      case "added": return row.addedAt || "";
      default: return row.track.duration_ms;
    }
  };
  return [...rows].sort((a, b) => {
    const left = pick(a);
    const right = pick(b);
    return (left < right ? -1 : left > right ? 1 : 0) * sort.dir;
  });
}

export function TrackTable({ rows, variant = "playlist", onPlayRow, header = true, sort, onSort, onMore, startIndex = 0, extraMenu, rowKeyPrefix = "r" }: {
  rows: TrackRowData[];
  variant?: "playlist" | "album" | "simple";
  onPlayRow: (track: SpotifyTrack, index: number) => void;
  header?: boolean;
  sort?: SortState;
  onSort?: (key: SortState["key"]) => void;
  onMore?: never;
  startIndex?: number;
  extraMenu?: (track: SpotifyTrack) => { playlist?: SpotifyPlaylist; onRemove?: () => void } | undefined;
  rowKeyPrefix?: string;
}) {
  const { playingTrackId, isPlaying, openArtist, openAlbum, openMenu, trackMenu, isLiked, toggleLike, primeLiked } = useSp();
  const [selected, setSelected] = useState<string | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const hasDates = variant === "playlist" && rows.some((row) => row.addedAt);
  const className = `sp-tracks ${variant === "simple" ? "is-simple" : variant === "album" ? "is-album" : hasDates ? "" : "is-nodate"}`;

  const tracks = useMemo(() => rows.map((row) => row.track), [rows]);
  useEffect(() => { primeLiked(tracks); }, [tracks, primeLiked]);

  const sortable = (key: SortState["key"], label: string) => onSort ? (
    <button type="button" className={sort?.key === key ? "is-on" : ""} onClick={() => onSort(key)}>
      {label}{sort?.key === key ? (sort.dir === 1 ? " ↑" : " ↓") : ""}
    </button>
  ) : <span>{label}</span>;

  return (
    <div className={className} role="table" aria-label="Songs">
      {header && variant !== "simple" ? (
        <div className="sp-th" role="row">
          <span role="columnheader">#</span>
          <span role="columnheader">{sortable("title", "Title")}</span>
          {variant === "playlist" ? <span role="columnheader">{sortable("album", "Album")}</span> : null}
          {hasDates ? <span role="columnheader">{sortable("added", "Date added")}</span> : null}
          <span role="columnheader" aria-label="Duration"><button type="button" onClick={() => onSort?.("duration")} style={{ display: "grid", placeItems: "center" }}><Icon name="clock" size={16} /></button></span>
        </div>
      ) : null}
      {rows.map((row, index) => {
        const { track } = row;
        const playing = playingTrackId === track.id;
        const liked = isLiked(track);
        const number = startIndex + index + 1;
        return (
          <div
            key={`${rowKeyPrefix}-${track.id}-${index}`}
            role="row"
            className={`sp-tr ${playing ? "is-playing" : ""} ${selected === track.id ? "is-selected" : ""} ${menuFor === `${track.id}-${index}` ? "is-menu" : ""}`}
            onClick={() => setSelected(track.id)}
            onDoubleClick={() => onPlayRow(track, index)}
            onContextMenu={(event) => {
              setMenuFor(`${track.id}-${index}`);
              openMenu(event, trackMenu(track, extraMenu?.(track)), () => setMenuFor(null));
            }}
          >
            <div className="sp-tr__n" role="cell">
              <span className="sp-tr__num">{playing ? <Eq paused={!isPlaying} /> : number}</span>
              <button type="button" className="sp-tr__go" aria-label={`Play ${track.name}`} onClick={(event) => { event.stopPropagation(); onPlayRow(track, index); }}>
                <Icon name={playing && isPlaying ? "pause" : "play"} size={16} />
              </button>
            </div>
            <div className="sp-tr__title" role="cell">
              {variant === "playlist" || variant === "simple" ? <div className="sp-tr__art"><Artwork src={midImage(track.album?.images)} /></div> : null}
              <div className="sp-tr__text">
                <div className="sp-tr__name sp-ellipsis">{track.name}</div>
                <div className="sp-tr__artist">
                  {track.explicit ? <span className="sp-explicit" title="Explicit">E</span> : null}
                  <span className="sp-ellipsis">
                    {track.artists.map((artist, artistIndex) => (
                      <span key={`${artist.name}-${artistIndex}`}>
                        {artistIndex > 0 ? ", " : ""}
                        <span className="sp-link" onClick={(event) => { event.stopPropagation(); openArtist(artist); }}>{artist.name}</span>
                      </span>
                    ))}
                  </span>
                </div>
              </div>
            </div>
            {variant === "playlist" ? (
              <div className="sp-tr__col sp-ellipsis" role="cell">
                <span className="sp-link" onClick={(event) => { event.stopPropagation(); openAlbum(track.album, track); }}>{track.album?.name}</span>
              </div>
            ) : null}
            {hasDates ? <div className="sp-tr__col sp-ellipsis" role="cell">{fmtDate(row.addedAt)}</div> : null}
            <div className="sp-tr__end" role="cell">
              <button type="button" className={`sp-tr__heart ${liked ? "is-on" : ""}`} aria-label={liked ? "Remove from Liked Songs" : "Save to Liked Songs"} aria-pressed={liked} onClick={(event) => { event.stopPropagation(); toggleLike(track); }}>
                <Icon name={liked ? "checkCircle" : "plusCircle"} size={16} />
              </button>
              <span className="sp-tr__time">{fmt(track.duration_ms)}</span>
              <button
                type="button"
                className="sp-tr__more"
                aria-label={`More options for ${track.name}`}
                onClick={(event) => {
                  event.stopPropagation();
                  const rect = event.currentTarget.getBoundingClientRect();
                  setMenuFor(`${track.id}-${index}`);
                  openMenu({ clientX: rect.left, clientY: rect.bottom + 4 }, trackMenu(track, extraMenu?.(track)), () => setMenuFor(null));
                }}
              >
                <Icon name="more" size={16} />
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function RowsSkeleton({ count = 8 }: { count?: number }) {
  return (
    <div className="sp-pad" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {Array.from({ length: count }, (_, index) => <div key={index} className="sp-skel" style={{ height: 48 }} />)}
    </div>
  );
}

export function CardsSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="sp-shelf__grid is-open" aria-hidden>
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className="sp-card"><div className="sp-card__art sp-skel" /><div className="sp-skel" style={{ height: 14, width: "70%", marginBottom: 8 }} /><div className="sp-skel" style={{ height: 12, width: "50%" }} /></div>
      ))}
    </div>
  );
}

export { bigImage };
