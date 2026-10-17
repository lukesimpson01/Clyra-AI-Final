// Content library. Projects, uploads (projects that started from a file),
// exports, templates and brand presets all come from the store. Sections for
// media that needs a licensed library say so; they never show placeholder items.

import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, AudioWaveform, Clapperboard, Download, Film, FolderOpen, LayoutGrid, List as ListIcon, Lock, Music2, Palette, Pause, Play, Search, Shapes, Trash2, Upload } from "lucide-react";
import { shortsApi, type LibraryTrack, type ProjectSummary } from "./api";
import { kindLabel, relativeTime } from "./ShortsHome";
import { SHORTS_KINDS, type ShortsKind, type ShortsProject } from "../../lib/shorts/schema";
import { mergePresets } from "../../lib/shorts/caption-presets";
import type { CaptionPreset } from "../../lib/shorts/schema";

type Section = "projects" | "uploads" | "exports" | "templates" | "brand" | "music" | "sfx" | "broll";

const SECTIONS: Array<[Section, string]> = [
  ["projects", "Projects"],
  ["uploads", "Uploads"],
  ["exports", "Exports"],
  ["templates", "Templates"],
  ["brand", "Brand"],
  ["music", "Music"],
  ["sfx", "SFX"],
  ["broll", "B-roll"],
];

const SECTION_ICONS = { projects: Clapperboard, uploads: Upload, exports: Download, templates: Shapes, brand: Palette, music: Music2, sfx: AudioWaveform, broll: Film } satisfies Record<Section, typeof Clapperboard>;

const TEMPLATE_DESCRIPTIONS: Record<ShortsKind, string> = {
  "ai-clip": "Long video in, ranked clips out. Each clip is captioned and editable.",
  "fake-text": "Chat story with typing indicators, receipts and reactions.",
  "would-rather": "Two options, a countdown, and a clearly labelled simulated split.",
  "reddit-story": "Post card with the story revealed word by word.",
  "narrated-story": "Hook, setup, escalation and payoff, one scene at a time.",
  quiz: "Question, answers, countdown and a one-line explanation.",
  list: "Title, then ranked items counting down to number one.",
  "gameplay-story": "Story text over footage you supply, looped to length.",
  "caption-video": "Your video with word-timed captions.",
  "cut-crop": "Trim a range and crop to the output ratio.",
};

export function ShortsLibrary({ onBack, onOpenProject, onCreate }: { onBack: () => void; onOpenProject: (id: string) => void; onCreate: (kind: ShortsKind) => void }) {
  const [section, setSection] = useState<Section>("projects");
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [kindFilter, setKindFilter] = useState<ShortsKind | "all">("all");
  const [layout, setLayout] = useState<"grid" | "list">("grid");
  const [exports, setExports] = useState<Array<{ projectId: string; projectTitle: string; file: string; createdAt: string; bytes: number; resolution: number; durationMs: number }> | null>(null);
  const [presets, setPresets] = useState<CaptionPreset[] | null>(null);
  const [libraryTracks, setLibraryTracks] = useState<{ tracks: LibraryTrack[]; folder: string } | null>(null);
  const [playingFile, setPlayingFile] = useState<string | null>(null);

  const refresh = () => shortsApi.listProjects().then((result) => setProjects(result.projects)).catch((cause: Error) => setError(cause.message));

  useEffect(() => {
    void refresh();
  }, []);

  useEffect(() => {
    if (section !== "exports" || !projects) return;
    let alive = true;
    const withExports = projects.filter((project) => project.exportCount > 0);
    Promise.all(withExports.map((project) => shortsApi.getProject(project.id).then(({ project: full }) => full).catch(() => null)))
      .then((loaded) => {
        if (!alive) return;
        const rows = loaded
          .filter((project): project is ShortsProject => Boolean(project))
          .flatMap((project) => project.exports.map((record) => ({ projectId: project.id, projectTitle: project.title, file: record.file, createdAt: record.createdAt, bytes: record.bytes, resolution: record.resolution, durationMs: record.durationMs })));
        setExports(rows.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)));
      });
    return () => {
      alive = false;
    };
  }, [section, projects]);

  useEffect(() => {
    if (section !== "brand" || presets) return;
    shortsApi.listPresets().then(({ presets: saved }) => setPresets(mergePresets(saved))).catch((cause: Error) => setError(cause.message));
  }, [section, presets]);

  useEffect(() => {
    if (section !== "music" && section !== "sfx") return;
    setPlayingFile(null);
    shortsApi.listLibrary(section).then(setLibraryTracks).catch((cause: Error) => setError(cause.message));
  }, [section]);

  const togglePreview = (kind: "music" | "sfx", file: string) => {
    if (playingFile === file) {
      setPlayingFile(null);
      return;
    }
    const audio = new Audio(shortsApi.libraryFileUrl(kind, file));
    audio.play().catch(() => undefined);
    audio.onended = () => setPlayingFile((current) => (current === file ? null : current));
    setPlayingFile(file);
  };

  const filtered = useMemo(() => {
    const base = projects ?? [];
    const scoped = section === "uploads" ? base.filter((project) => project.origin === "upload") : base;
    const kind = kindFilter === "all" ? scoped : scoped.filter((project) => project.kind === kindFilter);
    if (!query.trim()) return kind;
    const needle = query.trim().toLowerCase();
    return kind.filter((project) => project.title.toLowerCase().includes(needle));
  }, [projects, kindFilter, query, section]);

  const remove = async (project: ProjectSummary) => {
    if (!window.confirm(`Delete “${project.title}”? Its copied media and exports are removed. Your original files are not touched.`)) return;
    try {
      await shortsApi.deleteProject(project.id);
      setProjects((current) => (current ? current.filter((item) => item.id !== project.id) : current));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The project could not be deleted.");
    }
  };

  return (
    <div className="shorts-root sh-library-page">
      <div className="sh-page-frame sh-page-frame--wide">
        <header className="sh-page-header">
          <div className="sh-page-heading">
            <button type="button" className="sh-icon-btn" onClick={onBack} aria-label="Back to Shorts"><ArrowLeft size={17} strokeWidth={1.8} /></button>
            <div><span className="sh-page-eyebrow">SHORTS STUDIO</span><h1>Projects</h1><p>Everything you create, export and reuse—kept together on this computer.</p></div>
          </div>
          <button type="button" className="sh-btn sh-btn--primary" onClick={onBack}>Create new</button>
        </header>

        <div className="sh-library-layout">
          <nav className="sh-library-nav" aria-label="Library sections">
            {SECTIONS.map(([value, label]) => {
              const Icon = SECTION_ICONS[value];
              return (
                <button key={value} type="button" aria-current={section === value ? "page" : undefined} onClick={() => setSection(value)}>
                  <Icon size={16} strokeWidth={1.7} />
                  {label}
                </button>
              );
            })}
          </nav>

          <div className="sh-library-content" key={section}>
            {error ? <p className="sh-error" style={{ marginBottom: 12 }}>{error}</p> : null}

            {section === "projects" || section === "uploads" ? (
              <>
                <div className="sh-project-toolbar">
                  <div className="sh-project-search">
                    <Search size={14} strokeWidth={1.6} style={{ position: "absolute", left: 11, top: 11, color: "var(--sh-ink-3)" }} />
                    <input className="sh-input" style={{ paddingLeft: 32, height: 36 }} placeholder="Search projects" value={query} onChange={(event) => setQuery(event.target.value)} aria-label="Search projects" />
                  </div>
                  <select className="sh-select" style={{ width: 200, height: 36 }} value={kindFilter} onChange={(event) => setKindFilter(event.target.value as ShortsKind | "all")} aria-label="Filter by tool">
                    <option value="all">All tools</option>
                    {SHORTS_KINDS.map((kind) => <option key={kind} value={kind}>{kindLabel(kind)}</option>)}
                  </select>
                  <div className="sh-segmented" aria-label="Layout">
                    <button type="button" aria-pressed={layout === "grid"} onClick={() => setLayout("grid")} aria-label="Grid view"><LayoutGrid size={14} strokeWidth={1.6} /></button>
                    <button type="button" aria-pressed={layout === "list"} onClick={() => setLayout("list")} aria-label="List view"><ListIcon size={14} strokeWidth={1.6} /></button>
                  </div>
                </div>
                {projects === null ? <div className="sh-project-skeletons" aria-label="Loading projects">{Array.from({ length: 8 }, (_, index) => <span key={index} />)}</div> : null}
                {projects && filtered.length === 0 ? <div className="sh-library-empty"><Clapperboard size={24} strokeWidth={1.4} /><strong>{section === "uploads" ? "No uploaded projects yet" : "No projects match"}</strong><p>{section === "uploads" ? "Projects started from a local video will appear here." : "Try another search or create a new Short."}</p><button type="button" className="sh-btn sh-btn--primary sh-btn--sm" onClick={onBack}>Create a project</button></div> : null}
                <div className={`sh-project-collection is-${layout}`}>
                  {filtered.map((project) => (
                      <div key={project.id} className="sh-card sh-project-card">
                        <button type="button" className="sh-project-card-main" onClick={() => onOpenProject(project.id)}>
                          <div className="sh-project-card-thumb">
                            {project.thumbnail ? <img src={project.thumbnail} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <Clapperboard size={20} strokeWidth={1.3} className="sh-muted" />}
                          </div>
                          <div className="sh-project-card-copy">
                            <strong>{project.title}</strong>
                            <span>{kindLabel(project.kind)} · {relativeTime(project.updatedAt)} · {project.exportCount} export{project.exportCount === 1 ? "" : "s"}</span>
                          </div>
                        </button>
                        <button type="button" className="sh-icon-btn sh-project-delete" aria-label={`Delete ${project.title}`} onClick={() => void remove(project)}>
                          <Trash2 size={14} strokeWidth={1.6} />
                        </button>
                      </div>
                    ))}
                </div>
              </>
            ) : null}

            {section === "exports" ? (
              <>
                {exports === null ? <p className="sh-muted">Loading exports…</p> : null}
                {exports && exports.length === 0 ? <p className="sh-muted" style={{ fontSize: 14 }}>Exports you render appear here, newest first.</p> : null}
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {exports?.map((record) => (
                    <div key={`${record.projectId}-${record.file}`} className="sh-card" style={{ padding: "12px 14px", display: "flex", alignItems: "center", gap: 12 }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13.5, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{record.projectTitle}</div>
                        <div className="sh-muted" style={{ fontSize: 12, marginTop: 2 }}>{record.resolution}p · {(record.durationMs / 1000).toFixed(1)}s · {(record.bytes / 1_000_000).toFixed(1)} MB · {relativeTime(record.createdAt)}</div>
                      </div>
                      <button type="button" className="sh-btn sh-btn--sm" onClick={() => onOpenProject(record.projectId)}>Open</button>
                      <a className="sh-btn sh-btn--sm" style={{ textDecoration: "none" }} href={`/api/shorts/projects/${record.projectId}/exports/${encodeURIComponent(record.file)}?download=1`}><Download size={13} strokeWidth={1.6} /> Download</a>
                    </div>
                  ))}
                </div>
              </>
            ) : null}

            {section === "templates" ? (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(230px, 1fr))", gap: 14 }}>
                {SHORTS_KINDS.map((kind) => (
                  <div key={kind} className="sh-card" style={{ padding: 16, display: "flex", flexDirection: "column", gap: 8 }}>
                    <span style={{ fontSize: 14.5, fontWeight: 600 }}>{kindLabel(kind)}</span>
                    <span className="sh-muted" style={{ fontSize: 12.5, lineHeight: 1.45, flex: 1 }}>{TEMPLATE_DESCRIPTIONS[kind]}</span>
                    <button type="button" className="sh-btn sh-btn--sm" style={{ alignSelf: "flex-start" }} onClick={() => onCreate(kind)}>Start from this</button>
                  </div>
                ))}
              </div>
            ) : null}

            {section === "brand" ? (
              <>
                <p className="sh-muted" style={{ fontSize: 13.5, lineHeight: 1.5, marginTop: 0 }}>Caption presets are Clyra's brand kit for captions. Save a look in the Caption Studio and it appears here and in every project.</p>
                {presets === null ? <p className="sh-muted">Loading presets…</p> : null}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))", gap: 12 }}>
                  {presets?.map((preset) => (
                    <div key={preset.id} className="sh-card" style={{ padding: 14, display: "flex", flexDirection: "column", gap: 6 }}>
                      <span style={{ fontSize: 13.5, fontWeight: 600 }}>{preset.name}</span>
                      <span className="sh-muted" style={{ fontSize: 12 }}>{preset.builtin ? "Built in" : "Saved"} · {preset.style.font} {preset.style.weight} · {preset.style.animation}</span>
                    </div>
                  ))}
                </div>
              </>
            ) : null}

            {section === "music" || section === "sfx" ? (
              <>
                <div className="sh-notice" style={{ display: "flex", gap: 10, alignItems: "flex-start", marginBottom: 14 }}>
                  <FolderOpen size={15} strokeWidth={1.6} style={{ marginTop: 1, flexShrink: 0 }} />
                  <span>
                    Drop audio files you have the rights to use into this folder and they show up here automatically — no import step, nothing uploaded anywhere:
                    <br />
                    <code style={{ fontSize: 11, wordBreak: "break-all" }}>{libraryTracks?.folder ?? "…"}</code>
                  </span>
                </div>
                {libraryTracks === null ? <p className="sh-muted">Loading…</p> : null}
                {libraryTracks && libraryTracks.tracks.length === 0 ? <p className="sh-muted" style={{ fontSize: 13.5 }}>No files in this folder yet.</p> : null}
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {libraryTracks?.tracks.map((track) => (
                    <div key={track.file} className="sh-card" style={{ padding: "10px 12px", display: "flex", alignItems: "center", gap: 12 }}>
                      <button type="button" className="sh-icon-btn" aria-label={playingFile === track.file ? "Pause" : "Preview"} onClick={() => togglePreview(section as "music" | "sfx", track.file)}>
                        {playingFile === track.file ? <Pause size={14} strokeWidth={1.8} /> : <Play size={14} strokeWidth={1.8} />}
                      </button>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13.5, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{track.title}</div>
                        <div className="sh-muted" style={{ fontSize: 12 }}>{(track.durationMs / 1000).toFixed(1)}s · {(track.bytes / 1_000_000).toFixed(1)} MB · added {relativeTime(track.addedAt)}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            ) : null}

            {section === "broll" ? (
              <div className="sh-card" style={{ padding: 22, display: "flex", gap: 14, alignItems: "flex-start" }}>
                <Lock size={18} strokeWidth={1.6} className="sh-muted" style={{ marginTop: 2 }} />
                <div>
                  <div style={{ fontSize: 15, fontWeight: 600 }}>B-roll is not available yet</div>
                  <p className="sh-muted" style={{ margin: "6px 0 0", fontSize: 13, lineHeight: 1.5 }}>
                    B-roll needs a stock provider with licence checks and cached searches. None is connected in this build.
                  </p>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
