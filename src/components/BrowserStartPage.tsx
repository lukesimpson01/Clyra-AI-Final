import { ArrowUp, ChevronDown, MessageSquareText, PencilLine, Plus, Search, X } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";

const ASK_CLYRA_USED_KEY = "clyra-browser-ask-clyra-used";
const SHORTCUTS_KEY = "clyra-browser-shortcuts-v1";
const HOME_PREFS_KEY = "clyra-browser-home-v1";

export function hasUsedAskClyra(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(ASK_CLYRA_USED_KEY) === "1";
  } catch {
    return false;
  }
}

export function markAskClyraUsed() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(ASK_CLYRA_USED_KEY, "1");
  } catch {
    // Storage can be unavailable in strict privacy contexts.
  }
}

export type BrowserStartHistoryEntry = { id: string; title: string; url: string; visitedAt: string };
export type BrowserStartBookmark = { id: string; title: string; url: string };

/** A Google homepage (no query) or a blank tab is Clyra's new-tab page. */
export function isBrowserStartPageUrl(url?: string | null) {
  const value = String(url || "").trim();
  if (!value || value === "about:blank") return true;
  if (/\/api\/openbrowser\/new-tab/i.test(value)) return true;
  if (/^(chrome|edge|devtools|chrome-error|chromewebdata):/i.test(value)) return true;
  try {
    const parsed = new URL(value);
    const host = parsed.hostname.replace(/^www\./, "").toLowerCase();
    if (host !== "google.com") return false;
    const path = parsed.pathname || "/";
    if (path !== "/" && path !== "/webhp") return false;
    return !parsed.searchParams.get("q");
  } catch {
    return true;
  }
}

export function looksLikeUrl(value: string) {
  const v = value.trim();
  if (!v || /\s/.test(v)) return false;
  return /^https?:\/\//i.test(v) || /^localhost(:\d+)?(\/|$)/i.test(v) || /^(?:[\w-]+\.)+[a-z]{2,}(?::\d+)?(?:[/?#].*)?$/i.test(v);
}

export function faviconFor(url: string) {
  try {
    const host = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`).hostname;
    return host ? `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=64` : "";
  } catch {
    return "";
  }
}

type Shortcut = { name: string; url: string; mark?: string; tone?: string };
const DEFAULT_SHORTCUTS: Shortcut[] = [
  { name: "YouTube", url: "https://www.youtube.com", mark: "▶", tone: "#ff3544" },
  { name: "GitHub", url: "https://github.com", mark: "⌘", tone: "#222934" },
  { name: "Gmail", url: "https://mail.google.com", mark: "M", tone: "#d93025" },
  { name: "Wikipedia", url: "https://www.wikipedia.org", mark: "W", tone: "#3d434e" },
  { name: "Reddit", url: "https://www.reddit.com", mark: "●", tone: "#ff5d25" },
];
type HomePrefs = { scene: "white" | "sky" | "violet" | "warm"; showShortcuts: boolean; mode: "ask" | "search" };
const DEFAULT_PREFS: HomePrefs = { scene: "white", showShortcuts: true, mode: "ask" };

function readPrefs(): HomePrefs {
  try {
    const raw = window.localStorage.getItem(HOME_PREFS_KEY);
    return raw ? { ...DEFAULT_PREFS, ...JSON.parse(raw) } : DEFAULT_PREFS;
  } catch {
    return DEFAULT_PREFS;
  }
}

function normalizeShortcutUrl(value: string) {
  const v = value.trim();
  if (!v) return null;
  try {
    const url = new URL(/^https?:\/\//i.test(v) ? v : `https://${v}`);
    return ["http:", "https:"].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

type BrowserStartPageProps = {
  /** Opens a URL or searches Google for the text. */
  onNavigate: (target: string) => void;
  /** Sends a prompt to the assistant (agent or page Q&A). */
  onAskAgent: (prompt: string) => void;
};

export function BrowserStartPage({ onNavigate, onAskAgent }: BrowserStartPageProps) {
  const [query, setQuery] = useState("");
  const [prefs, setPrefs] = useState<HomePrefs>(readPrefs);
  const [shortcuts, setShortcuts] = useState<Shortcut[]>(() => {
    try {
      const saved = JSON.parse(window.localStorage.getItem(SHORTCUTS_KEY) || "null");
      return Array.isArray(saved) ? saved : DEFAULT_SHORTCUTS;
    } catch {
      return DEFAULT_SHORTCUTS;
    }
  });
  const [modesOpen, setModesOpen] = useState(false);
  const [customizer, setCustomizer] = useState<null | "appearance" | "shortcuts">(null);
  const [editing, setEditing] = useState<number | null>(null);
  const [menuFor, setMenuFor] = useState<{ index: number; left: number; top: number } | null>(null);
  const [draftName, setDraftName] = useState("");
  const [draftUrl, setDraftUrl] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);
  const rootRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    try { window.localStorage.setItem(HOME_PREFS_KEY, JSON.stringify(prefs)); } catch { /* optional */ }
  }, [prefs]);
  useEffect(() => {
    try { window.localStorage.setItem(SHORTCUTS_KEY, JSON.stringify(shortcuts)); } catch { /* optional */ }
  }, [shortcuts]);
  useEffect(() => {
    const id = window.setTimeout(() => inputRef.current?.focus({ preventScroll: true }), 60);
    return () => window.clearTimeout(id);
  }, []);
  // Click-away / Escape for every floating panel on this page.
  useEffect(() => {
    const onDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement;
      if (!target.closest(".ab-modes-pop, .ab-mode")) setModesOpen(false);
      if (!target.closest(".ab-customizer, .ab-customize, .ab-shortcut-add, .ab-shortcut-menu")) setCustomizer(null);
      if (!target.closest(".ab-shortcut-menu, .ab-shortcut-more")) setMenuFor(null);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setModesOpen(false);
      setCustomizer(null);
      setMenuFor(null);
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  const submit = (event?: FormEvent) => {
    event?.preventDefault();
    const value = query.trim();
    if (!value) return;
    const searchPrefix = /^(?:search|google)(?:\s+for)?\s+/i;
    if (looksLikeUrl(value)) onNavigate(value);
    else if (prefs.mode === "search" || searchPrefix.test(value)) onNavigate(value.replace(searchPrefix, "") || value);
    else onAskAgent(value);
    setQuery("");
  };

  const openEditor = (index: number | null) => {
    setEditing(index);
    setDraftName(index === null ? "" : shortcuts[index]?.name || "");
    setDraftUrl(index === null ? "" : shortcuts[index]?.url || "");
    setCustomizer("shortcuts");
    setMenuFor(null);
  };

  const saveShortcut = (event: FormEvent) => {
    event.preventDefault();
    const url = normalizeShortcutUrl(draftUrl);
    const name = draftName.trim();
    if (!url || !name) return;
    const item: Shortcut = { name, url, mark: name[0]?.toUpperCase(), tone: "#4277be" };
    setShortcuts((list) => editing === null ? [...list, item].slice(0, 11) : list.map((entry, i) => i === editing ? item : entry));
    setEditing(null);
    setDraftName("");
    setDraftUrl("");
    setCustomizer(null);
  };

  const setMode = (mode: HomePrefs["mode"]) => {
    setPrefs((p) => ({ ...p, mode }));
    setModesOpen(false);
    inputRef.current?.focus();
  };

  return (
    <section className="ab-newtab" data-scene={prefs.scene} ref={rootRef} aria-label="New tab">
      <div className="ab-newtab-body">
        <div className="ab-newtab-mark" aria-hidden>
          <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round"><path d="M24 4.5 28.5 19.5 43 24l-14.5 4.5L24 43.5l-4.5-15L5 24l14.5-4.5L24 4.5Z" /></svg>
        </div>
        <div className="ab-hero">
          <div className="ab-hero-eyebrow"><span>✦</span> A calmer way to browse</div>
          <h1>Where will curiosity take you?</h1>
          <p>One place to explore, build, and get things done.</p>
        </div>
        <form className="ab-composer" role="search" onSubmit={submit}>
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={prefs.mode === "search" ? "Search Google or type a URL" : "Ask anything, search Google or type a URL"}
            aria-label="Ask or search"
            autoComplete="off"
            spellCheck={false}
          />
          <div className="ab-composer-row">
            <button type="button" className="ab-mode" onClick={() => setModesOpen((v) => !v)} aria-haspopup="menu" aria-expanded={modesOpen}>
              {prefs.mode === "search" ? <Search /> : <MessageSquareText />}
              <span>{prefs.mode === "search" ? "Search" : "Ask"}</span>
              <ChevronDown className="ab-chev" />
            </button>
            <span className="ab-grow" />
            <button type="submit" className="ab-send" disabled={!query.trim()} aria-label={prefs.mode === "search" ? "Search" : "Send"} title="Send or search">
              <ArrowUp />
            </button>
          </div>
          {modesOpen ? (
            <div className="ab-pop ab-modes-pop" role="menu">
              <button type="button" className={`ab-pop-row ${prefs.mode === "ask" ? "is-selected" : ""}`} onClick={() => setMode("ask")}>
                <MessageSquareText /><span className="ab-pop-main">Ask the assistant</span>
              </button>
              <button type="button" className={`ab-pop-row ${prefs.mode === "search" ? "is-selected" : ""}`} onClick={() => setMode("search")}>
                <Search /><span className="ab-pop-main">Search Google</span>
              </button>
            </div>
          ) : null}
        </form>

        {prefs.showShortcuts ? (
          <>
            <div className="ab-shortcuts" aria-label="Website shortcuts">
              {shortcuts.slice(0, 11).map((item, index) => (
                <div
                  key={`${item.url}-${index}`}
                  role="button"
                  tabIndex={0}
                  className="ab-shortcut"
                  title={item.url}
                  onClick={() => onNavigate(item.url)}
                  onKeyDown={(event) => { if (event.key === "Enter" && event.target === event.currentTarget) onNavigate(item.url); }}
                >
                  <span className="ab-shortcut-ico" style={{ color: item.tone || "#697789" }}>
                    {item.mark || item.name[0]?.toUpperCase()}
                    <FaviconOverlay url={item.url} />
                  </span>
                  <span className="ab-shortcut-name">{item.name}</span>
                  <button
                    type="button"
                    className="ab-shortcut-more"
                    aria-label={`Edit or remove ${item.name}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      const host = rootRef.current?.getBoundingClientRect();
                      const rect = event.currentTarget.getBoundingClientRect();
                      setMenuFor({
                        index,
                        left: Math.max(8, rect.right - (host?.left || 0) - 170),
                        top: rect.bottom - (host?.top || 0) + 6 + (rootRef.current?.scrollTop || 0),
                      });
                    }}
                  >⋮</button>
                </div>
              ))}
              {shortcuts.length < 11 ? (
                <button type="button" className="ab-shortcut ab-shortcut-add" onClick={() => openEditor(null)}>
                  <span className="ab-shortcut-ico"><Plus size={20} /></span>
                  <span className="ab-shortcut-name">Add shortcut</span>
                </button>
              ) : null}
            </div>
            <div className="ab-shortcut-hint">Your websites, one click away</div>
          </>
        ) : null}
      </div>

      {menuFor ? (
        <div className="ab-pop ab-shortcut-menu" style={{ left: menuFor.left, top: menuFor.top }} role="menu">
          <button type="button" className="ab-pop-row" onClick={() => openEditor(menuFor.index)}><PencilLine /><span className="ab-pop-main">Edit shortcut</span></button>
          <button type="button" className="ab-pop-row" onClick={() => { setShortcuts((list) => list.filter((_, i) => i !== menuFor.index)); setMenuFor(null); }}><X /><span className="ab-pop-main">Remove shortcut</span></button>
        </div>
      ) : null}

      <button type="button" className="ab-customize" onClick={() => setCustomizer((v) => v ? null : "appearance")}>
        <PencilLine /><span>Customize</span>
      </button>
      {customizer ? (
        <div className="ab-pop ab-customizer" role="dialog" aria-label="Customize new tab">
          <header>
            <strong>Customize new tab</strong>
            <button type="button" className="ab-iconbtn" onClick={() => setCustomizer(null)} aria-label="Close"><X /></button>
          </header>
          <p>Choose your look and manage your favourite websites. Changes are saved on this device.</p>
          <div className="ab-seg">
            <button type="button" className={customizer === "appearance" ? "is-on" : ""} onClick={() => setCustomizer("appearance")}>Appearance</button>
            <button type="button" className={customizer === "shortcuts" ? "is-on" : ""} onClick={() => setCustomizer("shortcuts")}>Shortcuts</button>
          </div>
          {customizer === "appearance" ? (
            <section>
              <strong style={{ fontSize: 12, color: "#444b54" }}>Background</strong>
              <div className="ab-scenes">
                {([
                  ["white", "#fff"],
                  ["sky", "linear-gradient(135deg,#dceefa,#e1f0ff,#fff)"],
                  ["violet", "linear-gradient(135deg,#e7e6ff,#fbf8ff,#ffedf9)"],
                  ["warm", "linear-gradient(135deg,#ffe8d6,#fff8ea,#faebf2)"],
                ] as const).map(([scene, background]) => (
                  <button key={scene} type="button" title={scene} aria-label={`${scene} background`} className={prefs.scene === scene ? "is-on" : ""} style={{ background }} onClick={() => setPrefs((p) => ({ ...p, scene }))} />
                ))}
              </div>
              <label className="ab-check">
                <input type="checkbox" checked={prefs.showShortcuts} onChange={(event) => setPrefs((p) => ({ ...p, showShortcuts: event.target.checked }))} />
                Show website shortcuts
              </label>
              <button type="button" className="ab-link" onClick={() => setPrefs((p) => ({ ...DEFAULT_PREFS, mode: p.mode }))}>Reset appearance</button>
            </section>
          ) : (
            <form onSubmit={saveShortcut}>
              <strong style={{ fontSize: 12, color: "#444b54" }}>{editing === null ? "Add a shortcut" : "Edit shortcut"}</strong>
              <label>Website name<input value={draftName} onChange={(e) => setDraftName(e.target.value)} placeholder="e.g. My website" maxLength={32} required /></label>
              <label>Website address<input value={draftUrl} onChange={(e) => setDraftUrl(e.target.value)} placeholder="example.com" required /></label>
              <button type="submit" className="ab-btn is-primary" style={{ width: "100%", marginTop: 14 }}>{editing === null ? "Add shortcut" : "Save changes"}</button>
              <button type="button" className="ab-link" onClick={() => { setShortcuts(DEFAULT_SHORTCUTS); setEditing(null); }}>Reset shortcuts</button>
            </form>
          )}
        </div>
      ) : null}
    </section>
  );
}

/** Real site favicon layered over the letter mark; removed if it fails to load. */
function FaviconOverlay({ url }: { url: string }) {
  const [state, setState] = useState<"loading" | "ok" | "failed">("loading");
  const src = faviconFor(url);
  if (!src || state === "failed") return null;
  return (
    <img
      src={src}
      alt=""
      style={{ opacity: state === "ok" ? 1 : 0, background: "#f2f4f8" }}
      onLoad={(event) => setState(event.currentTarget.naturalWidth > 16 ? "ok" : "failed")}
      onError={() => setState("failed")}
    />
  );
}

export default BrowserStartPage;
