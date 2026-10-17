import {
  Bookmark,
  Download,
  FileDown,
  Gauge,
  Globe2,
  History,
  MousePointer2,
  Palette,
  Search,
  Settings2,
  ShieldCheck,
  Star,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import { useMemo, useState } from "react";

export type InternalPage = "history" | "bookmarks" | "settings" | "downloads";

export type AtlasSettings = {
  restoreTabs: boolean;
  saveHistory: boolean;
  showBookmarksBar: boolean;
  showAiCursor: boolean;
  showAiActionLabels: boolean;
  aiCursorSpeed: "instant" | "fast" | "natural";
  reducedMotion: boolean;
  performanceMode: "quality" | "balanced" | "efficient";
  privateMode: boolean;
};

type HistoryEntry = { id: string; title: string; url: string; visitedAt: string; visitCount?: number };
type BookmarkEntry = { id: string; title: string; url: string; folder?: string };
type DownloadEntry = { id: string; filename: string; url: string; status: string; path?: string };

const favicon = (url: string) => {
  try {
    return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(new URL(url).hostname)}&sz=32`;
  } catch {
    return "";
  }
};
const host = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
};

function SiteIcon({ url }: { url: string }) {
  const [failed, setFailed] = useState(false);
  const src = favicon(url);
  if (!src || failed) return <Globe2 />;
  return <img src={src} alt="" onError={() => setFailed(true)} />;
}

function PageFrame({
  icon: Icon,
  title,
  search,
  onSearch,
  placeholder,
  nav,
  children,
}: {
  icon: LucideIcon;
  title: string;
  search: string;
  onSearch: (value: string) => void;
  placeholder: string;
  nav: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="ab-page">
      <header className="ab-page-head">
        <div className="ab-page-title"><span className="ab-page-mark"><Icon /></span>{title}</div>
        <label className="ab-page-search">
          <Search />
          <input value={search} onChange={(event) => onSearch(event.target.value)} placeholder={placeholder} aria-label={placeholder} />
        </label>
      </header>
      <div className="ab-page-shell">
        <nav className="ab-page-nav">{nav}</nav>
        <div className="ab-page-body">{children}</div>
      </div>
    </div>
  );
}

function Switch({ on, onChange, label }: { on: boolean; onChange: (value: boolean) => void; label: string }) {
  return <button type="button" role="switch" aria-checked={on} aria-label={label} className={`ab-switch ${on ? "is-on" : ""}`} onClick={() => onChange(!on)} />;
}

export function AtlasInternalPage({
  page,
  history,
  bookmarks,
  downloads,
  settings,
  onOpenPage,
  onNavigate,
  onClearHistory,
  onRemoveBookmark,
  onAddBookmark,
  onUpdateSettings,
}: {
  page: InternalPage;
  history: HistoryEntry[];
  bookmarks: BookmarkEntry[];
  downloads: DownloadEntry[];
  settings: AtlasSettings;
  onOpenPage: (page: InternalPage) => void;
  onNavigate: (url: string) => void;
  onClearHistory: (ids?: string[]) => void;
  onRemoveBookmark: (id: string) => void;
  onAddBookmark: () => void;
  onUpdateSettings: (patch: Partial<AtlasSettings>) => void;
}) {
  const [search, setSearch] = useState("");
  const [section, setSection] = useState<"appearance" | "agent" | "privacy" | "performance">("appearance");
  const query = search.trim().toLowerCase();

  const libraryNav = (
    <>
      <button type="button" className={page === "history" ? "is-on" : ""} onClick={() => onOpenPage("history")}><History /> History</button>
      <button type="button" className={page === "bookmarks" ? "is-on" : ""} onClick={() => onOpenPage("bookmarks")}><Star /> Bookmarks</button>
      <button type="button" className={page === "downloads" ? "is-on" : ""} onClick={() => onOpenPage("downloads")}><Download /> Downloads</button>
      <button type="button" onClick={() => onOpenPage("settings")}><Settings2 /> Settings</button>
    </>
  );

  const groupedHistory = useMemo(() => {
    const groups = new Map<string, HistoryEntry[]>();
    for (const entry of history) {
      if (query && !`${entry.title} ${entry.url}`.toLowerCase().includes(query)) continue;
      const date = new Date(entry.visitedAt);
      const today = new Date();
      const label = Number.isNaN(date.valueOf())
        ? "Earlier"
        : date.toDateString() === today.toDateString()
          ? `Today · ${date.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })}`
          : date.toDateString() === new Date(Date.now() - 86_400_000).toDateString()
            ? "Yesterday"
            : date.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
      groups.set(label, [...(groups.get(label) || []), entry]);
    }
    return [...groups.entries()];
  }, [history, query]);

  if (page === "history") {
    return (
      <PageFrame icon={History} title="History" search={search} onSearch={setSearch} placeholder="Search history" nav={libraryNav}>
        <div className="ab-page-actions">
          <div><h2>Browsing history</h2><p style={{ margin: 0, fontSize: 13, color: "#818792" }}>{history.length} visits saved on this device</p></div>
          <button type="button" className="ab-outline-btn" disabled={!history.length} onClick={() => { if (window.confirm("Delete all browsing history?")) onClearHistory(); }}>Delete browsing data</button>
        </div>
        <div className="ab-list">
          {groupedHistory.length ? groupedHistory.map(([label, entries]) => (
            <div key={label}>
              <div className="ab-list-day">{label}</div>
              {entries.slice(0, 200).map((entry) => (
                <div key={entry.id} className="ab-list-row">
                  <time>{new Date(entry.visitedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</time>
                  <SiteIcon url={entry.url} />
                  <button type="button" className="ab-list-link" onClick={() => onNavigate(entry.url)} title={entry.url}>
                    <strong>{entry.title || host(entry.url)}</strong><small>{host(entry.url)}</small>
                  </button>
                  <button type="button" className="ab-list-del" aria-label="Remove from history" onClick={() => onClearHistory([entry.id])}><Trash2 /></button>
                </div>
              ))}
            </div>
          )) : (
            <div className="ab-list-empty"><History /><strong>{query ? "No matching history" : "No browsing history yet"}</strong>Pages you visit will appear here.</div>
          )}
        </div>
      </PageFrame>
    );
  }

  if (page === "bookmarks") {
    const visible = bookmarks.filter((entry) => !query || `${entry.title} ${entry.url}`.toLowerCase().includes(query));
    return (
      <PageFrame icon={Bookmark} title="Bookmarks" search={search} onSearch={setSearch} placeholder="Search bookmarks" nav={libraryNav}>
        <div className="ab-page-actions">
          <div><h2>All bookmarks</h2><p style={{ margin: 0, fontSize: 13, color: "#818792" }}>Keep useful pages close.</p></div>
          <button type="button" className="ab-btn is-primary" onClick={onAddBookmark}>+ Bookmark current page</button>
        </div>
        <div className="ab-list">
          {visible.length ? visible.map((entry) => (
            <div key={entry.id} className="ab-list-row">
              <SiteIcon url={entry.url} />
              <button type="button" className="ab-list-link" onClick={() => onNavigate(entry.url)} title={entry.url}>
                <strong>{entry.title || host(entry.url)}</strong><small>{entry.url}</small>
              </button>
              <button type="button" className="ab-list-del" aria-label="Remove bookmark" onClick={() => onRemoveBookmark(entry.id)}><Trash2 /></button>
            </div>
          )) : (
            <div className="ab-list-empty"><Star /><strong>{query ? "No matching bookmarks" : "No bookmarks yet"}</strong>Save any page with the star in the address bar.</div>
          )}
        </div>
      </PageFrame>
    );
  }

  if (page === "downloads") {
    const visible = downloads.filter((entry) => !query || `${entry.filename} ${entry.url}`.toLowerCase().includes(query));
    return (
      <PageFrame icon={Download} title="Downloads" search={search} onSearch={setSearch} placeholder="Search downloads" nav={libraryNav}>
        <h2>Downloads</h2>
        <p>Files downloaded in Clyra's browser are saved to its downloads folder.</p>
        <div className="ab-list">
          {visible.length ? visible.map((entry) => (
            <div key={entry.id} className="ab-list-row">
              <FileDown />
              <div className="ab-list-link" title={entry.path || entry.url}>
                <strong>{entry.filename}</strong><small>{entry.status === "complete" ? "Complete" : entry.status === "running" ? "Downloading…" : entry.status}</small>
              </div>
            </div>
          )) : (
            <div className="ab-list-empty"><Download /><strong>No downloads</strong>Files you download will show up here.</div>
          )}
        </div>
      </PageFrame>
    );
  }

  type Row = { label: string; description: string; control: React.ReactNode };
  const sections: Record<typeof section, { title: string; icon: LucideIcon; rows: Row[] }> = {
    appearance: {
      title: "Appearance",
      icon: Palette,
      rows: [
        { label: "Show bookmarks bar", description: "Display saved sites below the address bar", control: <Switch label="Show bookmarks bar" on={settings.showBookmarksBar} onChange={(v) => onUpdateSettings({ showBookmarksBar: v })} /> },
        { label: "Reduce motion", description: "Minimise transitions, the agent wave and animations", control: <Switch label="Reduce motion" on={settings.reducedMotion} onChange={(v) => onUpdateSettings({ reducedMotion: v })} /> },
        { label: "Default search engine", description: "Searches from the address bar and new tab use Google", control: <span style={{ fontSize: 12.5, color: "#5a6170" }}>Google</span> },
      ],
    },
    agent: {
      title: "Assistant & agent",
      icon: MousePointer2,
      rows: [
        { label: "Show agent cursor", description: "Display where the assistant is pointing while it works", control: <Switch label="Show agent cursor" on={settings.showAiCursor} onChange={(v) => onUpdateSettings({ showAiCursor: v })} /> },
        { label: "Show action labels", description: "Label the cursor with what the assistant is doing", control: <Switch label="Show action labels" on={settings.showAiActionLabels} onChange={(v) => onUpdateSettings({ showAiActionLabels: v })} /> },
        {
          label: "Cursor speed",
          description: "How the agent cursor moves between targets",
          control: (
            <select value={settings.aiCursorSpeed} onChange={(event) => onUpdateSettings({ aiCursorSpeed: event.target.value as AtlasSettings["aiCursorSpeed"] })}>
              <option value="natural">Natural</option><option value="fast">Fast</option><option value="instant">Instant</option>
            </select>
          ),
        },
      ],
    },
    privacy: {
      title: "Privacy and security",
      icon: ShieldCheck,
      rows: [
        { label: "Save browsing history", description: "Keep a local record of pages you visit", control: <Switch label="Save browsing history" on={settings.saveHistory} onChange={(v) => onUpdateSettings({ saveHistory: v })} /> },
        { label: "Private session", description: "Don't record history for this session", control: <Switch label="Private session" on={settings.privateMode} onChange={(v) => onUpdateSettings({ privateMode: v })} /> },
        { label: "Clear browsing data", description: "Remove saved visit history from this device", control: <button type="button" className="ab-outline-btn" onClick={() => onOpenPage("history")}>Open</button> },
      ],
    },
    performance: {
      title: "Performance",
      icon: Gauge,
      rows: [
        { label: "Restore tabs on startup", description: "Reopen the tabs you had open last time", control: <Switch label="Restore tabs" on={settings.restoreTabs} onChange={(v) => onUpdateSettings({ restoreTabs: v })} /> },
        {
          label: "Performance mode",
          description: "Balance visual quality against battery and memory",
          control: (
            <select value={settings.performanceMode} onChange={(event) => onUpdateSettings({ performanceMode: event.target.value as AtlasSettings["performanceMode"] })}>
              <option value="quality">Quality</option><option value="balanced">Balanced</option><option value="efficient">Efficient</option>
            </select>
          ),
        },
      ],
    },
  };
  const shown = (Object.keys(sections) as Array<typeof section>)
    .filter((key) => query || key === section)
    .map((key) => ({ key, ...sections[key], rows: sections[key].rows.filter((row) => !query || `${row.label} ${row.description}`.toLowerCase().includes(query)) }))
    .filter((group) => group.rows.length);

  return (
    <PageFrame
      icon={Settings2}
      title="Settings"
      search={search}
      onSearch={setSearch}
      placeholder="Search settings"
      nav={
        <>
          {(Object.keys(sections) as Array<typeof section>).map((key) => {
            const Icon = sections[key].icon;
            return <button key={key} type="button" className={!query && section === key ? "is-on" : ""} onClick={() => { setSearch(""); setSection(key); }}><Icon /> {sections[key].title}</button>;
          })}
          <button type="button" onClick={() => onOpenPage("history")}><History /> History</button>
          <button type="button" onClick={() => onOpenPage("bookmarks")}><Star /> Bookmarks</button>
        </>
      }
    >
      {shown.length ? shown.map((group) => (
        <section key={group.key}>
          <div className="ab-group-title">{group.title}</div>
          <div className="ab-card">
            {group.rows.map((row) => (
              <div key={row.label} className="ab-setting">
                <div className="ab-setting-meta"><strong>{row.label}</strong><small>{row.description}</small></div>
                {row.control}
              </div>
            ))}
          </div>
        </section>
      )) : <div className="ab-list-empty"><Search /><strong>No matching settings</strong>Try another search.</div>}
    </PageFrame>
  );
}
