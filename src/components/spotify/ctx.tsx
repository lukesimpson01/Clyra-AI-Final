/**
 * Shared state for the Clyra Music views: navigation, the context-menu host,
 * toasts, the "new playlist" dialog and the liked-song cache. Views read it
 * through `useSp()` so none of them need prop-drilling.
 */
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { SpotifyPlaybackHook } from "../chat/SpotifyNotch";
import type { SpotifyAlbum, SpotifyArtist, SpotifyPlaylist, SpotifyTrack } from "../../lib/electron-runtime";
import { Icon, type IconName } from "./ui";

export type ViewEntry =
  | { type: "home" }
  | { type: "search" }
  | { type: "library" }
  | { type: "liked" }
  | { type: "lyrics" }
  | { type: "playlist"; playlist: SpotifyPlaylist }
  | { type: "album"; album: SpotifyAlbum }
  | { type: "artist"; artist: Pick<SpotifyArtist, "id" | "name"> & Partial<SpotifyArtist> };

export function viewKey(view: ViewEntry) {
  if (view.type === "playlist") return `playlist:${view.playlist.id}`;
  if (view.type === "album") return `album:${view.album.id}`;
  if (view.type === "artist") return `artist:${view.artist.id}`;
  return view.type;
}

export type MenuItem =
  | { kind?: "item"; label: string; icon?: IconName; onClick?: () => void; disabled?: boolean; submenu?: MenuItem[] }
  | { kind: "sep" }
  | { kind: "label"; label: string };

export type SpContext = {
  playback: SpotifyPlaybackHook;
  view: ViewEntry;
  goTo: (view: ViewEntry) => void;
  openArtist: (artist: { id?: string; name: string }) => void;
  openAlbum: (album: { id?: string; name: string; images?: Array<{ url: string }> } | undefined, track?: SpotifyTrack) => void;
  openPlaylist: (playlist: SpotifyPlaylist) => void;
  openMenu: (event: { clientX: number; clientY: number; preventDefault?: () => void; stopPropagation?: () => void }, items: MenuItem[], onClose?: () => void) => void;
  toast: (message: string) => void;
  /** Playlists the signed-in user can add songs to. */
  editablePlaylists: SpotifyPlaylist[];
  isLiked: (track: SpotifyTrack) => boolean;
  primeLiked: (tracks: SpotifyTrack[]) => void;
  toggleLike: (track: SpotifyTrack) => void;
  addToPlaylist: (playlist: SpotifyPlaylist, tracks: SpotifyTrack[]) => Promise<boolean>;
  newPlaylist: (seed?: SpotifyTrack[]) => void;
  trackMenu: (track: SpotifyTrack, extra?: { playlist?: SpotifyPlaylist; onRemove?: () => void }) => MenuItem[];
  playingTrackId: string | null;
  isPlaying: boolean;
};

const Ctx = createContext<SpContext | null>(null);
export const SpProvider = Ctx.Provider;
export function useSp() {
  const value = useContext(Ctx);
  if (!value) throw new Error("useSp must be used inside the Clyra Music workspace.");
  return value;
}

/* ── Context menu host ───────────────────────────────────────────────────── */

type MenuState = { x: number; y: number; items: MenuItem[]; onClose?: () => void };

function MenuList({ items, onPick, anchor, depth = 0 }: { items: MenuItem[]; onPick: () => void; anchor: { x: number; y: number }; depth?: number }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number }>({ left: anchor.x, top: anchor.y });
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const [subAnchor, setSubAnchor] = useState<{ x: number; y: number; flip: boolean }>({ x: 0, y: 0, flip: false });

  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const rect = node.getBoundingClientRect();
    const margin = 8;
    let left = anchor.x;
    let top = anchor.y;
    if (left + rect.width > window.innerWidth - margin) left = Math.max(margin, depth > 0 ? anchor.x - rect.width - 4 : window.innerWidth - rect.width - margin);
    if (top + rect.height > window.innerHeight - margin) top = Math.max(margin, window.innerHeight - rect.height - margin);
    setPos({ left, top });
  }, [anchor.x, anchor.y, depth, items.length]);

  return (
    <div ref={ref} className="sp-menu" role="menu" style={{ left: pos.left, top: pos.top }} onContextMenu={(event) => event.preventDefault()}>
      {items.map((item, index) => {
        if (item.kind === "sep") return <div key={index} className="sp-menu__sep" role="separator" />;
        if (item.kind === "label") return <div key={index} className="sp-menu__label">{item.label}</div>;
        const hasSub = Boolean(item.submenu?.length);
        return (
          <div key={index} style={{ position: "relative" }}>
            <button
              type="button"
              role="menuitem"
              className={`sp-menu__item ${openIndex === index ? "is-open" : ""}`}
              disabled={item.disabled}
              onMouseEnter={(event) => {
                if (hasSub) {
                  const rect = event.currentTarget.getBoundingClientRect();
                  setSubAnchor({ x: rect.right - 2, y: rect.top - 4, flip: false });
                  setOpenIndex(index);
                } else setOpenIndex(null);
              }}
              onClick={() => {
                if (hasSub) return;
                onPick();
                item.onClick?.();
              }}
            >
              {item.icon ? <Icon name={item.icon} size={16} /> : null}
              <span className="sp-ellipsis">{item.label}</span>
              {hasSub ? <span className="sp-menu__chev"><Icon name="chevR" size={14} /></span> : null}
            </button>
            {hasSub && openIndex === index ? <MenuList items={item.submenu!} onPick={onPick} anchor={subAnchor} depth={depth + 1} /> : null}
          </div>
        );
      })}
    </div>
  );
}

function MenuHost({ state, close }: { state: MenuState | null; close: () => void }) {
  useEffect(() => {
    if (!state) return;
    const onDown = (event: MouseEvent) => {
      if (!(event.target as HTMLElement | null)?.closest(".sp-menu")) close();
    };
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") close(); };
    window.addEventListener("mousedown", onDown, true);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("blur", close);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("mousedown", onDown, true);
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("blur", close);
      window.removeEventListener("resize", close);
    };
  }, [state, close]);
  if (!state) return null;
  return createPortal(<MenuList items={state.items} onPick={close} anchor={{ x: state.x, y: state.y }} />, document.body);
}

/* ── Provider state shared by the workspace ──────────────────────────────── */

export function useMenuHost() {
  const [state, setState] = useState<MenuState | null>(null);
  const close = useCallback(() => {
    setState((current) => {
      current?.onClose?.();
      return null;
    });
  }, []);
  const open: SpContext["openMenu"] = useCallback((event, items, onClose) => {
    event.preventDefault?.();
    event.stopPropagation?.();
    setState({ x: event.clientX, y: event.clientY, items, onClose });
  }, []);
  return { open, node: <MenuHost state={state} close={close} /> };
}

export function useToastHost() {
  const [message, setMessage] = useState<string | null>(null);
  const timer = useRef<number | null>(null);
  const toast = useCallback((next: string) => {
    setMessage(next);
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setMessage(null), 2600);
  }, []);
  useEffect(() => () => { if (timer.current) window.clearTimeout(timer.current); }, []);
  return { toast, node: message ? createPortal(<div className="sp-toast" role="status">{message}</div>, document.body) : null };
}

export function NewPlaylistDialog({ open, busy, onClose, onCreate }: { open: boolean; busy: boolean; onClose: () => void; onCreate: (name: string) => void }) {
  const [name, setName] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (open) {
      setName("");
      window.setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [open]);
  if (!open) return null;
  const submit = () => {
    const trimmed = name.trim();
    if (trimmed && !busy) onCreate(trimmed);
  };
  return createPortal(
    <div className="sp-modal-scrim" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="sp-modal" role="dialog" aria-modal="true" aria-label="Create playlist">
        <h2>Create playlist</h2>
        <input
          ref={inputRef}
          value={name}
          maxLength={100}
          placeholder="My playlist"
          aria-label="Playlist name"
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") submit();
            if (event.key === "Escape") onClose();
          }}
        />
        <div className="sp-modal__row">
          <button type="button" className="sp-pill sp-pill--ghost" onClick={onClose}>Cancel</button>
          <button type="button" className="sp-pill sp-pill--accent" disabled={!name.trim() || busy} onClick={submit} style={!name.trim() || busy ? { opacity: 0.5 } : undefined}>{busy ? "Creating…" : "Create"}</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** Builds the liked-song cache used by every row's "+"/check control. */
export function useLikedCache(playback: SpotifyPlaybackHook) {
  const { savedTracks, checkLiked, likeUris, track } = playback;
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});
  const [known, setKnown] = useState<Record<string, boolean>>({});
  const pending = useRef(new Set<string>());
  const savedIds = useMemo(() => new Set(savedTracks.map((item) => item.id)), [savedTracks]);

  const isLiked = useCallback((item: SpotifyTrack) => {
    if (item.id in overrides) return overrides[item.id];
    if (item.id in known) return known[item.id];
    if (track?.id === item.id) return playback.liked;
    return savedIds.has(item.id);
  }, [overrides, known, savedIds, track?.id, playback.liked]);

  const primeLiked = useCallback((items: SpotifyTrack[]) => {
    const ids = items.filter((item) => item?.id && item.uri && !pending.current.has(item.id)).slice(0, 120);
    if (!ids.length) return;
    ids.forEach((item) => pending.current.add(item.id));
    void checkLiked(ids.map((item) => item.uri)).then((flags) => {
      setKnown((current) => {
        const next = { ...current };
        ids.forEach((item, index) => { next[item.id] = Boolean(flags[index]); });
        return next;
      });
    }).catch(() => ids.forEach((item) => pending.current.delete(item.id)));
  }, [checkLiked]);

  const toggleLike = useCallback((item: SpotifyTrack) => {
    const next = !isLiked(item);
    setOverrides((current) => ({ ...current, [item.id]: next }));
    void likeUris([item.uri], next).then((result) => {
      if (!result.ok) setOverrides((current) => ({ ...current, [item.id]: !next }));
    });
    return next;
  }, [isLiked, likeUris]);

  return { isLiked, primeLiked, toggleLike };
}
