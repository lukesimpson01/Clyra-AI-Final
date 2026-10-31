// Clyra Editor: a light, blue build of the open-source OpenFilm Studio (vendor/openfilm), run locally by Clyra's server
// and framed here. It is wired into the rest of Clyra: the Clyra media drawer sends AI Clipper clips, Shorts projects
// and the Music/SFX library into the timeline, and inside the editor Whisper, the Creator voices and Clyra's model
// do transcription, voice-over and subtitle translation (lib/openfilm/routes.ts).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, AudioLines, Captions, Clapperboard, Expand, FolderOpen, Layers, Music2, PanelRightClose, PanelRightOpen, Plus, RefreshCw, Scissors, Sparkles } from "lucide-react";

export type EditorSendItem = {
  kind: "shorts-export" | "shorts-source" | "clipper" | "library-music" | "library-sfx";
  projectId?: string;
  file: string;
  subtitles?: boolean;
};

export type EditorSend = { items: EditorSendItem[]; name?: string };

type Sources = {
  projects: Array<{ id: string; title: string; kind: string; aspect: string; hasSource: boolean; hasCaptions: boolean; thumbnail: string | null; exports: Array<{ file: string; durationMs: number; aspect: string }> }>;
  clips: Array<{ file: string; bytes: number; modifiedAt: string }>;
  music: Array<{ file: string; title: string; durationMs: number }>;
  sfx: Array<{ file: string; title: string; durationMs: number }>;
  exports: Array<{ file: string; bytes: number; modifiedAt: string }>;
};

type Tab = "clips" | "projects" | "music" | "sfx" | "exports";

const TABS: Array<{ id: Tab; label: string; icon: typeof Scissors }> = [
  { id: "clips", label: "AI Clips", icon: Sparkles },
  { id: "projects", label: "Projects", icon: Layers },
  { id: "music", label: "Music", icon: Music2 },
  { id: "sfx", label: "SFX", icon: AudioLines },
  { id: "exports", label: "Exports", icon: FolderOpen },
];

async function post<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.ok === false) throw new Error(data?.error || `Request failed (${response.status})`);
  return data as T;
}

const seconds = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}`;
const megabytes = (bytes: number) => `${(bytes / 1048576).toFixed(1)} MB`;

type Row = { key: string; title: string; meta: string; thumb: string | null; actions: Array<{ label: string; item: EditorSendItem }>; href?: string };

export function ShortsVideoEditor({ onBack, send }: { onBack: () => void; send?: EditorSend }) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [instance, setInstance] = useState(0);
  const [ready, setReady] = useState(false);
  const [address, setAddress] = useState<{ url: string; origin: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [drawer, setDrawer] = useState(true);
  const [tab, setTab] = useState<Tab>("clips");
  const [sources, setSources] = useState<Sources | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const sentRef = useRef(false);

  const launch = useCallback(async (to = "/") => {
    setError(null);
    try {
      const result = await post<{ url: string; origin: string }>("/api/openfilm/launch", { to });
      setAddress({ url: result.url, origin: result.origin });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The editor could not start.");
    }
  }, []);

  // `send` is read once, when the editor first opens, so the first launch must not race the hand-over below.
  useEffect(() => {
    if (send && !sentRef.current) return;
    void launch();
  }, [launch, instance, send]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (!address || event.origin !== address.origin || event.source !== frameRef.current?.contentWindow) return;
      if (event.data?.type === "clyra-editor-ready") setReady(true);
      if (event.data?.type === "clyra-editor-project") setProjectId(typeof event.data.id === "string" ? event.data.id : null);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [address]);

  const loadSources = useCallback(async () => {
    try {
      const response = await fetch("/api/openfilm/sources");
      const data = await response.json();
      if (data?.ok) setSources(data as Sources);
    } catch { /* the drawer says it is empty */ }
  }, []);

  useEffect(() => { void loadSources(); }, [loadSources]);

  const sendItems = useCallback(async (items: EditorSendItem[], name?: string, target: string | null = projectId) => {
    setBusy(true);
    setNotice(null);
    try {
      const result = await post<{ projectId: string; created: boolean; count: number }>("/api/openfilm/send", { items, name, projectId: target || undefined });
      setNotice(result.created ? "Started a new project with your media." : `Added ${result.count} ${result.count === 1 ? "item" : "items"} to the timeline.`);
      if (result.created || result.projectId !== projectId) {
        setReady(false);
        await launch(`/projects/${encodeURIComponent(result.projectId)}`);
      }
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : "Could not add that to the editor.");
      if (!address) await launch();
    } finally {
      setBusy(false);
    }
  }, [address, launch, projectId]);

  // Media handed over from AI Clipper or a Shorts project opens as a new project exactly once.
  useEffect(() => {
    if (!send || sentRef.current) return;
    sentRef.current = true;
    void sendItems(send.items, send.name, null);
  }, [send, sendItems]);

  const reload = () => {
    setReady(false);
    setAddress(null);
    setInstance((value) => value + 1);
  };

  const enterFullscreen = async () => {
    await frameRef.current?.requestFullscreen?.().catch(() => undefined);
  };

  const rows = useMemo<Row[]>(() => {
    if (!sources) return [];
    if (tab === "clips") return sources.clips.map((clip) => ({
      key: clip.file,
      title: clip.file.replace(/\.mp4$/i, ""),
      meta: `${megabytes(clip.bytes)} · ${new Date(clip.modifiedAt).toLocaleDateString()}`,
      thumb: null,
      actions: [{ label: "Add", item: { kind: "clipper", file: clip.file } }],
    }));
    if (tab === "projects") return sources.projects.flatMap<Row>((project) => {
      const actions: Row["actions"] = [
        ...(project.hasSource ? [{ label: "Source", item: { kind: "shorts-source", projectId: project.id, file: "source" } as EditorSendItem }] : []),
        ...(project.hasSource && project.hasCaptions ? [{ label: "Source + subtitles", item: { kind: "shorts-source", projectId: project.id, file: "source", subtitles: true } as EditorSendItem }] : []),
        ...project.exports.slice(-1).map((record) => ({ label: "Latest export", item: { kind: "shorts-export", projectId: project.id, file: record.file } as EditorSendItem })),
      ];
      return actions.length ? [{ key: project.id, title: project.title, meta: `${project.kind.replace(/-/g, " ")} · ${project.aspect}`, thumb: project.thumbnail, actions }] : [];
    });
    if (tab === "music" || tab === "sfx") return sources[tab].map((track) => ({
      key: track.file,
      title: track.title,
      meta: seconds(track.durationMs),
      thumb: null,
      actions: [{ label: "Add", item: { kind: tab === "music" ? "library-music" : "library-sfx", file: track.file } }],
    }));
    return sources.exports.map((entry) => ({
      key: entry.file,
      title: entry.file,
      meta: `${megabytes(entry.bytes)} · ${new Date(entry.modifiedAt).toLocaleString()}`,
      thumb: null,
      actions: [],
      href: `/api/openfilm/exports/file?file=${encodeURIComponent(entry.file)}&download=1`,
    }));
  }, [sources, tab]);

  const emptyText = tab === "clips" ? "Clips from AI Clipper show up here."
    : tab === "projects" ? "Shorts projects with a source video or an export show up here."
      : tab === "exports" ? "Videos you export from the editor show up here."
        : "Drop audio files into your Shorts library folder and they show up here.";

  return (
    <section className="sh-video-editor" aria-label="Clyra Editor">
      <header className="sh-video-editor__bar">
        <div className="sh-video-editor__group">
          <button type="button" className="sh-video-editor__back" onClick={onBack}>
            <ArrowLeft size={16} strokeWidth={1.8} />
            Shorts home
          </button>
          <span className="sh-video-editor__divider" />
          <div>
            <div className="sh-video-editor__title">Clyra Editor</div>
            <div className="sh-video-editor__subtitle">Timeline, effects, subtitles and AI, all on this computer</div>
          </div>
        </div>
        <div className="sh-video-editor__actions">
          <span className="sh-video-editor__local"><Captions size={13} strokeWidth={1.8} /> Whisper · Clyra voices</span>
          <button type="button" className="sh-icon-btn" onClick={() => setDrawer((open) => !open)} aria-label={drawer ? "Hide Clyra media" : "Show Clyra media"} title="Clyra media">
            {drawer ? <PanelRightClose size={15} strokeWidth={1.8} /> : <PanelRightOpen size={15} strokeWidth={1.8} />}
          </button>
          <button type="button" className="sh-icon-btn" onClick={reload} aria-label="Reload editor" title="Reload editor">
            <RefreshCw size={15} strokeWidth={1.8} />
          </button>
          <button type="button" className="sh-icon-btn" onClick={() => void enterFullscreen()} aria-label="Open editor fullscreen" title="Fullscreen">
            <Expand size={15} strokeWidth={1.8} />
          </button>
        </div>
      </header>

      <div className="sh-video-editor__body">
        <div className="sh-video-editor__surface">
          {error ? (
            <div className="sh-video-editor__loading" role="alert">
              <Clapperboard size={26} strokeWidth={1.5} />
              <strong>The editor could not start</strong>
              <span style={{ maxWidth: 420, textAlign: "center" }}>{error}</span>
              <button type="button" className="sh-btn sh-btn--primary sh-btn--sm" onClick={reload}>Try again</button>
            </div>
          ) : !ready ? (
            <div className="sh-video-editor__loading" role="status">
              <span className="sh-video-editor__spinner" />
              <strong>Opening the editor</strong>
              <span>The local editing engine is starting (the first run also fetches its rendering browser)…</span>
            </div>
          ) : null}
          {address ? (
            <iframe
              key={address.url}
              ref={frameRef}
              className={`sh-video-editor__frame${ready ? " is-ready" : ""}`}
              src={address.url}
              title="Clyra Editor"
              onLoad={() => setReady(true)}
              allow="fullscreen; clipboard-read; clipboard-write; autoplay"
              allowFullScreen
            />
          ) : null}
        </div>

        {drawer ? (
          <aside className="sh-video-editor__drawer" aria-label="Clyra media">
            <div className="sh-video-editor__drawer-head">
              <strong>Clyra media</strong>
              <span>{projectId ? "Adds to the open project" : "Starts a new project"}</span>
            </div>
            <div className="sh-video-editor__tabs" role="tablist">
              {TABS.map(({ id, label, icon: Icon }) => (
                <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? "is-active" : undefined} onClick={() => { setTab(id); void loadSources(); }}>
                  <Icon size={13} strokeWidth={1.8} /> {label}
                </button>
              ))}
            </div>
            {notice ? <p className="sh-video-editor__notice" role="status">{notice}</p> : null}
            <div className="sh-video-editor__list clyra-scroll">
              {!sources ? <p className="sh-video-editor__empty">Loading…</p> : rows.length === 0 ? (
                <p className="sh-video-editor__empty">{emptyText}</p>
              ) : rows.map((row) => (
                <div key={row.key} className="sh-video-editor__row">
                  {row.thumb ? <img src={row.thumb} alt="" /> : <span className="sh-video-editor__row-icon"><Plus size={14} strokeWidth={1.8} /></span>}
                  <div className="sh-video-editor__row-text">
                    <span title={row.title}>{row.title}</span>
                    <small>{row.meta}</small>
                    <div className="sh-video-editor__row-actions">
                      {row.actions.map((action) => (
                        <button key={action.label} type="button" className="sh-btn sh-btn--sm" disabled={busy} onClick={() => void sendItems([action.item])}>
                          {action.label}
                        </button>
                      ))}
                      {row.href ? <a className="sh-btn sh-btn--sm" href={row.href}>Download</a> : null}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </aside>
        ) : null}
      </div>
    </section>
  );
}
