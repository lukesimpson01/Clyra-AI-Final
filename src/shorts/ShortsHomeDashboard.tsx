// Shorts Studio welcome dashboard. Its information architecture follows the
// supplied reference (sidebar, hero, continue working, full tool grid and
// recent exports) while every visible datum and action is backed by the real
// Shorts project store.

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import {
  ArrowRight,
  Captions,
  CheckCircle2,
  ChevronDown,
  CircleHelp,
  Crop,
  FolderOpen,
  HardDrive,
  Home,
  Layers3,
  MessageSquareText,
  MonitorPlay,
  PlayCircle,
  Scissors,
  Search,
  Settings as SettingsIcon,
  ShieldCheck,
  Sparkles,
  X,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { shortsApi, type ProjectSummary, type ShortsUsage } from "./api";
import type { ComposerSource } from "./ShortsHome";
import { kindLabel, relativeTime } from "./ShortsHome";
import type { ShortsKind } from "../../lib/shorts/schema";
import "./dashboard.css";

export type DashboardActions = {
  onStartClipper: (source: ComposerSource | null) => void;
  onCreate: (kind: ShortsKind, prompt?: string) => void;
  onOpenProject: (id: string) => void;
  onOpenLibrary: () => void;
  onOpenVideoEditor: () => void;
  onOpenSettings: () => void;
  userName: string;
  onClose?: () => void;
  /** Tool whose project is being created; its card shows progress and others wait. */
  busyTool?: string | null;
};

const CATEGORY_LABEL: Record<Category, string> = { all: "All tools", create: "Create", edit: "Edit" };

type Category = "all" | "create" | "edit";
type ExportRow = { projectId: string; title: string; createdAt: string; durationMs: number; resolution: number; thumbnail: string | null };
type ToolEntry = {
  id: string;
  label: string;
  description: string;
  category: Exclude<Category, "all">;
  icon: LucideIcon;
  image: string;
  action: () => void;
};

export function ShortsHomeDashboard(actions: DashboardActions) {
  const [toolsOpen, setToolsOpen] = useState(true);
  const [category, setCategory] = useState<Category>("all");
  const [query, setQuery] = useState("");
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [exports, setExports] = useState<ExportRow[] | null>(null);
  const [usage, setUsage] = useState<ShortsUsage | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let alive = true;
    shortsApi.listProjects().then(({ projects: rows }) => alive && setProjects(rows)).catch(() => alive && setProjects([]));
    shortsApi.usage().then(({ usage: value }) => alive && setUsage(value)).catch(() => undefined);
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (!projects) return;
    let alive = true;
    const candidates = projects.filter((project) => project.exportCount > 0).slice(0, 8);
    if (!candidates.length) {
      setExports([]);
      return;
    }
    Promise.all(candidates.map((summary) => shortsApi.getProject(summary.id).then(({ project }) => ({ summary, project })).catch(() => null)))
      .then((rows) => {
        if (!alive) return;
        const realExports = rows.flatMap((row) => row ? row.project.exports.map((record) => ({
          projectId: row.project.id,
          title: row.project.title,
          createdAt: record.createdAt,
          durationMs: record.durationMs,
          resolution: record.resolution,
          thumbnail: row.summary.thumbnail,
        })) : []);
        setExports(realExports.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 4));
      })
      .catch(() => alive && setExports([]));
    return () => { alive = false; };
  }, [projects]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Only tools with a dedicated, end-to-end editor are listed here. The
  // template generators (story, quiz, list, gameplay) remain in the codebase
  // but are not offered until they have their own editors and a working
  // script provider.
  const tools = useMemo<ToolEntry[]>(() => [
    { id: "fake-text", label: "Fake Text Story", description: "Realistic, voiced chat stories over gameplay.", category: "create", icon: MessageSquareText, image: "/media/shorts-studio-v2/shorts-studio-v2-007.png", action: () => actions.onCreate("fake-text") },
    { id: "would-rather", label: "Would You Rather", description: "Paced dilemma videos with animated votes.", category: "create", icon: CircleHelp, image: "/media/shorts-studio-v2/shorts-studio-v2-008.png", action: () => actions.onCreate("would-rather") },
    { id: "ai-clip", label: "AI Clipper", description: "Turn long videos into focused, captioned shorts.", category: "create", icon: Scissors, image: "/media/shorts-studio-v2/shorts-studio-v2-006.png", action: () => actions.onStartClipper(null) },
    { id: "caption-video", label: "Caption Studio", description: "Generate and style word-timed captions.", category: "edit", icon: Captions, image: "/media/shorts-studio-v2/shorts-studio-v2-015.png", action: () => actions.onCreate("caption-video") },
    { id: "cut-crop", label: "Cut & Crop", description: "Trim, reframe and resize a source video.", category: "edit", icon: Crop, image: "/media/shorts-studio-v2/shorts-studio-v2-014.png", action: () => actions.onCreate("cut-crop") },
    { id: "video-editor", label: "Video Editor", description: "Multi-track timeline, effects and compositing.", category: "edit", icon: MonitorPlay, image: "/media/shorts-studio-v2/shorts-studio-v2-016.png", action: actions.onOpenVideoEditor },
  ], [actions]);

  const needle = query.trim().toLowerCase();
  const visibleTools = tools.filter((tool) => (category === "all" || tool.category === category) && (!needle || `${tool.label} ${tool.description}`.toLowerCase().includes(needle)));
  const visibleProjects = (projects ?? []).filter((project) => !needle || `${project.title} ${kindLabel(project.kind)}`.toLowerCase().includes(needle)).slice(0, 3);
  const initials = (actions.userName.trim().split(/\s+/).map((part) => part[0]).join("") || "?").slice(0, 2).toUpperCase();

  const scrollToTools = () => document.getElementById("studio-tool-grid")?.scrollIntoView({
    behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
    block: "start",
  });

  return (
    <div className="sd-root">
      <aside className="sd-sidebar">
        <div className="sd-brand">
          <img src="/media/shorts-studio-v2/shorts-studio-v2-001.png" alt="" />
          <span>Shorts Studio</span>
        </div>

        <nav className="sd-primary-nav" aria-label="Studio navigation">
          <button type="button" className="is-active" aria-current="page"><Home size={19} /> Home</button>
          <button type="button" onClick={actions.onOpenLibrary}><FolderOpen size={19} /> My Projects</button>
        </nav>

        <div className="sd-rule" />
        <button type="button" className="sd-tools-toggle" onClick={() => setToolsOpen((value) => !value)} aria-expanded={toolsOpen}>
          <span>Tools</span><ChevronDown size={16} className={toolsOpen ? "is-open" : ""} />
        </button>
        {toolsOpen ? (
          <div className="sd-side-tools">
            {tools.map((tool) => {
              const Icon = tool.icon;
              return <button type="button" key={tool.id} onClick={tool.action} disabled={Boolean(actions.busyTool)} aria-busy={actions.busyTool === tool.id || undefined}><Icon size={18} /> <span>{tool.label}</span>{actions.busyTool === tool.id ? <span className="sd-spinner" aria-hidden /> : null}</button>;
            })}
          </div>
        ) : null}

        <div className="sd-sidebar-bottom">
          <UsageCard usage={usage} />
          <button type="button" className="sd-settings" onClick={actions.onOpenSettings}><SettingsIcon size={18} /> Settings</button>
        </div>
      </aside>

      <main className="sd-workspace">
        <header className="sd-topbar">
          <label className="sd-search">
            <Search size={16} />
            <input ref={searchRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search tools and projects…" />
            <span>⌘ K</span>
          </label>
          <div className="sd-top-actions">
            <span className="sd-avatar" title={actions.userName}>{initials}</span>
            {actions.onClose ? <button type="button" onClick={actions.onClose} aria-label="Close Shorts"><X size={17} /></button> : null}
          </div>
        </header>

        <div className="sd-content">
          <section className="sd-top-grid">
            <div className="sd-hero">
              <img src="/media/shorts-studio-v2/shorts-studio-v2-002.png" alt="Short-form video creation preview" />
              <div className="sd-hero-copy">
                <span className="sd-eyebrow">SHORTS STUDIO</span>
                <h1>Create short{"\u2011"}form<br />videos, <em>faster.</em></h1>
                <p>Move from raw idea or long video to a polished, editable short in one focused workspace.</p>
                <button type="button" onClick={scrollToTools}>Start creating <ArrowRight size={15} /></button>
              </div>
              <div className="sd-benefits">
                <div><Zap size={20} /><span><strong>Local workflow</strong><small>Your files stay yours</small></span></div>
                <div><Layers3 size={20} /><span><strong>Every format</strong><small>9:16 · 4:5 · 1:1 · 16:9</small></span></div>
                <div><ShieldCheck size={20} /><span><strong>Fully editable</strong><small>Review every AI choice</small></span></div>
              </div>
            </div>

            <div className="sd-continue-column">
              <button type="button" className="sd-library-button" onClick={actions.onOpenLibrary}><FolderOpen size={17} /> Open Project Library <ArrowRight size={14} /></button>
              <section className="sd-continue">
                <div className="sd-section-head"><h2>Continue working</h2><button type="button" onClick={actions.onOpenLibrary}>View all <ArrowRight size={12} /></button></div>
                <div className="sd-work-list">
                  {projects === null ? Array.from({ length: 3 }, (_, index) => <div key={index} className="sd-work-skeleton" aria-hidden />) : null}
                  {projects && visibleProjects.length === 0 ? <EmptyProjects filtered={Boolean(needle)} onCreate={() => actions.onCreate("fake-text")} /> : null}
                  {visibleProjects.map((project) => <ProjectRow key={project.id} project={project} onOpen={() => actions.onOpenProject(project.id)} />)}
                </div>
              </section>
            </div>
          </section>

          <section className="sd-tools-section" id="studio-tool-grid">
            <div className="sd-tools-heading">
              <div><h2>Creation tools</h2><p>Every tool opens a full editor with preview and export.</p></div>
              <div className="sd-categories" aria-label="Tool categories">
                {(["all", "create", "edit"] as Category[]).map((value) => (
                  <button type="button" key={value} aria-pressed={category === value} onClick={() => setCategory(value)}>{CATEGORY_LABEL[value]}</button>
                ))}
              </div>
            </div>
            <div className="sd-tool-grid">
              {visibleTools.map((tool, index) => <ToolCard key={tool.id} tool={tool} index={index} busy={actions.busyTool === tool.id} disabled={Boolean(actions.busyTool)} />)}
              {visibleTools.length === 0 ? <div className="sd-no-results">No tools match “{query}”.</div> : null}
            </div>
          </section>

          <section className="sd-exports-section">
            <div className="sd-section-head"><h2>Recent exports</h2><button type="button" onClick={actions.onOpenLibrary}>View all <ArrowRight size={12} /></button></div>
            <div className="sd-export-grid">
              {exports === null ? Array.from({ length: 4 }, (_, index) => <div key={index} className="sd-export-skeleton" aria-hidden />) : null}
              {exports && exports.length === 0 ? <div className="sd-exports-empty">Finished exports will appear here after your first render.</div> : null}
              {exports?.map((row) => <ExportCard key={`${row.projectId}-${row.createdAt}`} row={row} onOpen={() => actions.onOpenProject(row.projectId)} />)}
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}

function ToolCard({ tool, index, busy, disabled }: { tool: ToolEntry; index: number; busy: boolean; disabled: boolean }) {
  const Icon = tool.icon;
  return (
    <button type="button" className={`sd-tool-card${busy ? " is-busy" : ""}`} style={{ "--sd-i": index } as CSSProperties} onClick={tool.action} disabled={disabled} aria-busy={busy || undefined}>
      <span className="sd-tool-image"><img src={tool.image} alt="" decoding="async" /><span><Icon size={16} /></span></span>
      <span className="sd-tool-info"><span><strong>{tool.label}</strong><small>{tool.description}</small></span><i>{busy ? <span className="sd-spinner" aria-hidden /> : <ArrowRight size={14} />}</i></span>
    </button>
  );
}

function ProjectRow({ project, onOpen }: { project: ProjectSummary; onOpen: () => void }) {
  return (
    <button type="button" className="sd-project-row" onClick={onOpen}>
      <span className="sd-project-thumb">{project.thumbnail ? <img src={project.thumbnail} alt="" /> : <PlayCircle size={19} />}</span>
      <span className="sd-project-copy"><strong>{project.title}</strong><small>Edited {relativeTime(project.updatedAt)}</small><span><i>{kindLabel(project.kind)}</i><i>{project.aspect}</i></span></span>
      <ArrowRight size={14} />
    </button>
  );
}

function EmptyProjects({ filtered, onCreate }: { filtered: boolean; onCreate: () => void }) {
  if (filtered) return <p className="sd-empty-copy">No saved projects match this search.</p>;
  return <button type="button" className="sd-empty-project" onClick={onCreate}><Sparkles size={18} /><span><strong>Create your first project</strong><small>Start with a text story</small></span><ArrowRight size={14} /></button>;
}

function ExportCard({ row, onOpen }: { row: ExportRow; onOpen: () => void }) {
  return (
    <button type="button" className="sd-export-card" onClick={onOpen}>
      <span className="sd-export-thumb">{row.thumbnail ? <img src={row.thumbnail} alt="" /> : <PlayCircle size={17} />}</span>
      <span className="sd-export-copy"><strong>{row.title}</strong><small>{formatDuration(row.durationMs)} · {row.resolution}p</small></span>
      <span className="sd-export-status"><CheckCircle2 size={16} /><small>Exported<br />{relativeTime(row.createdAt)}</small></span>
      <ArrowRight size={14} />
    </button>
  );
}

function UsageCard({ usage }: { usage: ShortsUsage | null }) {
  const fraction = Math.max(0, Math.min(1, usage?.fraction ?? 0));
  const used = formatBytes(usage?.totalBytes ?? 0);
  const budget = formatBytes(usage?.budgetBytes ?? 0);
  return (
    <div className="sd-usage">
      <div><span>Local storage</span><HardDrive size={14} /></div>
      <div className="sd-usage-body">
        <span className="sd-usage-ring" style={{ "--sd-ring": `${Math.round(fraction * 360)}deg` } as CSSProperties}><strong>{Math.round(fraction * 100)}%</strong></span>
        <span><strong>{used} used</strong><small>{usage ? `${budget} workspace budget` : "Loading usage…"}</small></span>
      </div>
    </div>
  );
}

function formatDuration(durationMs: number) {
  const seconds = Math.max(0, Math.round(durationMs / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function formatBytes(bytes: number) {
  if (bytes < 1_048_576) return `${Math.max(0, bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1_073_741_824) return `${(bytes / 1_048_576).toFixed(1)} MB`;
  return `${(bytes / 1_073_741_824).toFixed(2)} GB`;
}
