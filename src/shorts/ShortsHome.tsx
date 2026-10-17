// Shorts welcome page. Composer first, then recent work, then the tools. The
// composer accepts a YouTube link, a dropped or pasted file, or a prompt; the
// rail shows real projects from the store (no sample content).

import { useEffect, useRef, useState, type ClipboardEvent, type DragEvent, type FormEvent } from "react";
import { motion, useReducedMotion } from "motion/react";
import { Captions, Clapperboard, Columns2, Gamepad2, HardDrive, LayoutGrid, ListOrdered, Mic, MessagesSquare, Newspaper, Scissors, CircleHelp, Sparkles, Upload, Link2, Library, Film, Plus, X, Youtube } from "lucide-react";
import { shortsApi, uploadVideoFile, type ProjectSummary, type YoutubeSource } from "./api";
import type { ShortsKind } from "../../lib/shorts/schema";

export type ComposerSource =
  | { kind: "youtube"; source: YoutubeSource }
  | { kind: "upload"; uploadId: string; name: string; durationMs: number; width: number; height: number; fps: number; hasAudio: boolean };

export type ShortsHomeActions = {
  onStartClipper: (source: ComposerSource) => void;
  onCreate: (kind: ShortsKind, prompt?: string) => void;
  onBlank: (aspect: "9:16" | "4:5" | "1:1" | "16:9") => void;
  onOpenProject: (id: string) => void;
  onOpenLibrary: () => void;
  onOpenCutCrop: () => void;
};

type ComposerTab = "clipper" | "generate" | "blank";

const CREATE_CARDS: Array<{ kind: ShortsKind; title: string; detail: string; icon: typeof Scissors; tone: string; wide?: boolean }> = [
  { kind: "ai-clip", title: "AI Clipper", detail: "Find the strongest moments in a long video, framed and captioned.", icon: Scissors, tone: "blue", wide: true },
  { kind: "fake-text", title: "Fake Text", detail: "Chat stories with typing, read receipts and reactions.", icon: MessagesSquare, tone: "green" },
  { kind: "would-rather", title: "Would You Rather", detail: "Two choices, a countdown, and a simulated split.", icon: Columns2, tone: "rose" },
  { kind: "reddit-story", title: "Reddit Story", detail: "A post card that reveals word by word.", icon: Newspaper, tone: "amber" },
  { kind: "narrated-story", title: "Narrated Story", detail: "Hook, setup, escalation and payoff, scene by scene.", icon: Mic, tone: "violet" },
  { kind: "quiz", title: "Quiz", detail: "Question, answers, countdown, and a checked explanation.", icon: CircleHelp, tone: "teal" },
  { kind: "list", title: "List", detail: "Ranked items that count down to the number one.", icon: ListOrdered, tone: "blue" },
  { kind: "gameplay-story", title: "Gameplay Story", detail: "Story text over footage you supply, looped to length.", icon: Gamepad2, tone: "slate" },
  { kind: "caption-video", title: "Caption Video", detail: "Your video with word-timed captions and style presets.", icon: Captions, tone: "blue" },
];

const GENERATE_TOOLS: Array<{ kind: ShortsKind; label: string }> = [
  { kind: "fake-text", label: "Fake text" },
  { kind: "would-rather", label: "Would you rather" },
  { kind: "reddit-story", label: "Reddit story" },
  { kind: "narrated-story", label: "Narrated story" },
  { kind: "quiz", label: "Quiz" },
  { kind: "list", label: "List" },
];

const EASE = [0.2, 0.8, 0.3, 1] as const;

export function ShortsHome(actions: ShortsHomeActions) {
  const reduceMotion = useReducedMotion();
  const [tab, setTab] = useState<ComposerTab>("clipper");
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    shortsApi.listProjects().then((result) => alive && setProjects(result.projects)).catch((error: Error) => alive && setLoadError(error.message));
    return () => {
      alive = false;
    };
  }, []);

  const enter = (index: number) =>
    reduceMotion ? { initial: false as const } : { initial: { opacity: 0, y: 6 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.28, ease: EASE, delay: 0.03 * index } };

  return (
    <div className="shorts-root" style={{ minHeight: "100%", padding: "56px 40px 96px" }}>
      <div style={{ maxWidth: 1080, margin: "0 auto" }}>
        <motion.header {...enter(0)} style={{ marginBottom: 28 }}>
          <h1 style={{ margin: 0, fontSize: 40, lineHeight: 1.08, fontWeight: 650, letterSpacing: "-0.03em" }}>Create something worth watching</h1>
          <p className="sh-muted" style={{ margin: "10px 0 0", fontSize: 15, maxWidth: 620, lineHeight: 1.5 }}>
            Start from a YouTube link, a video file, a prompt, or a blank canvas. Clyra frames, captions and paces the rest, and everything stays editable.
          </p>
        </motion.header>

        <motion.section {...enter(1)} className="sh-card" style={{ padding: 18 }}>
          <div className="sh-row" style={{ justifyContent: "flex-start", gap: 6, marginBottom: 14 }}>
            <div className="sh-segmented" role="tablist" aria-label="Start from">
              {(["clipper", "generate", "blank"] as ComposerTab[]).map((value) => (
                <button key={value} type="button" role="tab" aria-selected={tab === value} onClick={() => setTab(value)}>
                  {value === "clipper" ? "AI Clipper" : value === "generate" ? "Generate Video" : "Start Blank"}
                </button>
              ))}
            </div>
          </div>
          {tab === "clipper" ? <ClipperComposer onStart={actions.onStartClipper} /> : null}
          {tab === "generate" ? <GenerateComposer onCreate={actions.onCreate} /> : null}
          {tab === "blank" ? <BlankComposer onBlank={actions.onBlank} /> : null}
        </motion.section>

        <motion.section {...enter(2)} style={{ marginTop: 40 }}>
          <div className="sh-row" style={{ marginBottom: 12 }}>
            <h2 className="sh-section-title" style={{ margin: 0 }}>Continue editing</h2>
            <button type="button" className="sh-btn sh-btn--ghost sh-btn--sm" onClick={actions.onOpenLibrary}>
              <Library size={14} strokeWidth={1.6} /> Library
            </button>
          </div>
          <RecentRail projects={projects} error={loadError} onOpen={actions.onOpenProject} />
        </motion.section>

        <motion.section {...enter(3)} style={{ marginTop: 40 }}>
          <h2 className="sh-section-title">Create</h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(230px, 1fr))", gap: 14 }}>
            {CREATE_CARDS.map((card, index) => (
              <CreateCard
                key={card.kind}
                title={card.title}
                detail={card.detail}
                icon={card.icon}
                wide={card.wide}
                index={index}
                reduceMotion={Boolean(reduceMotion)}
                onClick={() => (card.kind === "ai-clip" ? setTab("clipper") : actions.onCreate(card.kind))}
              />
            ))}
          </div>
          <div className="sh-row" style={{ justifyContent: "flex-start", gap: 10, marginTop: 18 }}>
            <span className="sh-muted" style={{ fontSize: 13 }}>Also:</span>
            <button type="button" className="sh-btn sh-btn--sm" onClick={actions.onOpenCutCrop}>
              <Scissors size={14} strokeWidth={1.6} /> Cut and crop
            </button>
          </div>
        </motion.section>
      </div>
    </div>
  );
}

function CreateCard({ title, detail, icon: Icon, wide, index, reduceMotion, onClick }: { title: string; detail: string; icon: typeof Scissors; wide?: boolean; index: number; reduceMotion: boolean; onClick: () => void }) {
  return (
    <motion.button
      type="button"
      onClick={onClick}
      initial={reduceMotion ? false : { opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease: EASE, delay: 0.1 + index * 0.04 }}
      className="sh-card sh-create-card"
      style={{ gridColumn: wide ? "span 2" : undefined, textAlign: "left", padding: 18, display: "flex", flexDirection: "column", gap: 14, minHeight: wide ? 148 : 132, transition: "transform 160ms var(--sh-ease), box-shadow 160ms var(--sh-ease), border-color 160ms var(--sh-ease)" }}
    >
      <span className="sh-create-icon" style={{ width: 38, height: 38, borderRadius: 12, display: "grid", placeItems: "center", background: "var(--sh-blue-soft)", color: "var(--sh-blue-ink)", transition: "transform 200ms var(--sh-ease)" }}>
        <Icon size={19} strokeWidth={1.6} />
      </span>
      <span style={{ display: "block" }}>
        <span style={{ display: "block", fontSize: 16, fontWeight: 600, letterSpacing: "-0.015em" }}>{title}</span>
        <span className="sh-muted" style={{ display: "block", marginTop: 4, fontSize: 13, lineHeight: 1.45 }}>{detail}</span>
      </span>
    </motion.button>
  );
}

export function ClipperComposer({ onStart }: { onStart: (source: ComposerSource) => void }) {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState<null | "inspect" | "upload" | "probe">(null);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [youtube, setYoutube] = useState<YoutubeSource | null>(null);
  const [upload, setUpload] = useState<(ComposerSource & { kind: "upload" }) | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => () => abort.current?.abort(), []);

  const inspect = async (raw: string) => {
    setError(null);
    setUpload(null);
    setBusy("inspect");
    try {
      const { source } = await shortsApi.inspectYoutube(raw.trim());
      setYoutube(source);
      setUrl(source.url);
    } catch (cause) {
      setYoutube(null);
      setError(cause instanceof Error ? cause.message : "The link could not be inspected.");
    } finally {
      setBusy(null);
    }
  };

  const takeFile = async (file: File) => {
    setError(null);
    setYoutube(null);
    const extension = file.name.split(".").pop()?.toLowerCase() || "";
    if (!["mp4", "mov", "m4v", "webm", "mkv"].includes(extension)) {
      setError("Use an MP4, MOV, M4V, WebM or MKV video.");
      return;
    }
    abort.current?.abort();
    abort.current = new AbortController();
    setBusy("upload");
    setProgress(0);
    try {
      const uploaded = await uploadVideoFile(file, setProgress, abort.current.signal);
      setBusy("probe");
      const { probe } = await shortsApi.probeUpload(uploaded.uploadId, uploaded.name);
      setUpload({ kind: "upload", uploadId: uploaded.uploadId, name: uploaded.name, durationMs: probe.durationMs, width: probe.width, height: probe.height, fps: probe.fps, hasAudio: probe.hasAudio });
    } catch (cause) {
      if (cause instanceof Error && cause.message !== "Upload cancelled") setError(cause.message);
    } finally {
      setBusy(null);
    }
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (url.trim()) void inspect(url);
  };

  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files?.[0];
    if (file) void takeFile(file);
  };

  const onPaste = (event: ClipboardEvent) => {
    const file = event.clipboardData.files?.[0];
    if (file) {
      event.preventDefault();
      void takeFile(file);
      return;
    }
    const text = event.clipboardData.getData("text").trim();
    if (/^https?:\/\//i.test(text) && /youtu/i.test(text)) {
      event.preventDefault();
      setUrl(text);
      void inspect(text);
    }
  };

  const ready = youtube ? { kind: "youtube" as const, source: youtube } : upload;

  return (
    <div className="sh-clipper-import-grid" onPaste={onPaste}>
      <section className="sh-clipper-source-panel">
        <header className="sh-clipper-panel-head"><div><strong>Video source</strong><span>Choose a local file or paste a link</span></div><span className="sh-format-badge">MP4 · MOV · WEBM</span></header>
        <div
          className={`sh-clipper-drop${dragging ? " is-dragging" : ""}`}
          role="button"
          tabIndex={0}
          onClick={() => !busy && fileInput.current?.click()}
          onKeyDown={(event) => { if ((event.key === "Enter" || event.key === " ") && !busy) fileInput.current?.click(); }}
          onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          aria-label="Choose or drop a video file"
        >
          <span className="sh-clipper-upload-glyph"><Upload size={22} strokeWidth={1.65} /></span>
          <h2>Drop your video here</h2>
          <p>Drag a file into this space or choose one from your computer.</p>
          <span className={`sh-btn sh-btn--primary${busy !== null ? " is-disabled" : ""}`} aria-hidden="true">Choose video</span>
          <small><HardDrive size={12} strokeWidth={1.8} /> Imported locally · up to 1.25 GB</small>
        </div>
        <input ref={fileInput} type="file" accept="video/*,.mkv" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) void takeFile(file); event.target.value = ""; }} />

        <div className="sh-clipper-or"><span>or import from YouTube</span></div>
        <form className="sh-clipper-youtube" onSubmit={onSubmit}>
          <Youtube size={20} strokeWidth={1.7} />
          <div><strong>YouTube or Shorts</strong><span>Paste a public video link</span></div>
          <label><Link2 size={14} strokeWidth={1.7} /><input placeholder="https://youtube.com/watch?v=…" value={url} onChange={(event) => setUrl(event.target.value)} aria-label="YouTube link" /></label>
          <button type="submit" className="sh-btn sh-btn--sm" disabled={!url.trim() || busy !== null}>{busy === "inspect" ? "Checking…" : "Load"}</button>
        </form>

        {busy === "upload" ? <div className="sh-clipper-progress"><div className="sh-row"><span>Uploading video</span><span>{Math.round(progress * 100)}%</span></div><div className="sh-progress"><span style={{ width: `${Math.round(progress * 100)}%` }} /></div></div> : null}
        {busy === "probe" || busy === "inspect" ? <div className="sh-clipper-status"><span className="sh-video-editor__spinner" />{busy === "probe" ? "Reading local video details…" : "Reading video details from YouTube…"}</div> : null}
        {error ? <p className="sh-error sh-clipper-error">{error}</p> : null}
      </section>

      <aside className="sh-clipper-preview-panel">
        <header className="sh-clipper-panel-head"><div><strong>Preview</strong><span>Review the source before analysis</span></div><span className={`sh-status-pill${ready ? " is-good" : ""}`}>{ready ? "Ready" : "Awaiting source"}</span></header>
        <div className={`sh-clipper-preview-well${ready ? " has-source" : ""}`}>
          {ready ? <SourceCard source={ready} onChange={() => { setYoutube(null); setUpload(null); setUrl(""); }} onContinue={() => onStart(ready)} /> : <div className="sh-clipper-preview-empty"><span><Film size={26} strokeWidth={1.4} /></span><strong>Your source preview appears here</strong><p>No footage leaves this device until you explicitly use a supported link workflow.</p></div>}
        </div>
      </aside>
    </div>
  );
}

function SourceCard({ source, onChange, onContinue }: { source: ComposerSource; onChange: () => void; onContinue: () => void }) {
  const isYoutube = source.kind === "youtube";
  const title = isYoutube ? source.source.title : source.name;
  const durationMs = isYoutube ? source.source.durationMs : source.durationMs;
  const width = isYoutube ? source.source.width : source.width;
  const height = isYoutube ? source.source.height : source.height;
  const minutes = Math.round(durationMs / 60000);
  const longForm = durationMs > 25 * 60_000;
  return (
    <div className="sh-source-card">
      {isYoutube ? (
        <img className="sh-source-card-thumb" src={source.source.thumbnail} alt="" />
      ) : (
        <div className="sh-source-card-thumb sh-source-card-file">
          <Film size={26} strokeWidth={1.4} className="sh-muted" />
        </div>
      )}
      <div className="sh-source-card-copy">
        <strong>{title}</strong>
        <span>
          {isYoutube ? source.source.channel || "YouTube" : "Local file"} · {minutes} min · {width}×{height}
        </span>
        <div className="sh-source-card-badges">
          <span className="sh-pill">{longForm ? "Long-form analysis" : "Standard analysis"}</span>
          <span className="sh-pill">{isYoutube ? "Source: YouTube" : "Source: upload"}</span>
        </div>
      </div>
      <div className="sh-source-card-actions">
        <button type="button" className="sh-btn sh-btn--primary" onClick={onContinue}><Sparkles size={15} strokeWidth={1.6} /> Configure clips</button>
        <button type="button" className="sh-btn sh-btn--ghost sh-btn--sm" onClick={onChange}><X size={14} strokeWidth={1.6} /> Change source</button>
      </div>
    </div>
  );
}

function GenerateComposer({ onCreate }: { onCreate: (kind: ShortsKind, prompt?: string) => void }) {
  const [prompt, setPrompt] = useState("");
  const [kind, setKind] = useState<ShortsKind>("fake-text");
  return (
    <div>
      <textarea className="sh-textarea" style={{ minHeight: 70 }} placeholder="What should the video be about? e.g. a roommate who keeps eating my food and gets caught" value={prompt} onChange={(event) => setPrompt(event.target.value)} aria-label="Video idea" />
      <div className="sh-row" style={{ marginTop: 12, gap: 10, flexWrap: "wrap", justifyContent: "space-between" }}>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {GENERATE_TOOLS.map((tool) => (
            <button key={tool.kind} type="button" className="sh-btn sh-btn--sm" aria-pressed={kind === tool.kind} onClick={() => setKind(tool.kind)} style={{ background: kind === tool.kind ? "var(--sh-blue-soft)" : undefined, color: kind === tool.kind ? "var(--sh-blue-ink)" : undefined, borderColor: kind === tool.kind ? "transparent" : undefined }}>
              {tool.label}
            </button>
          ))}
        </div>
        <button type="button" className="sh-btn sh-btn--primary" onClick={() => onCreate(kind, prompt.trim() || undefined)}>
          <Sparkles size={15} strokeWidth={1.6} /> Continue
        </button>
      </div>
      <p className="sh-hint">Scripts are written by DeepSeek and can be edited line by line. Nothing is posted anywhere.</p>
    </div>
  );
}

function BlankComposer({ onBlank }: { onBlank: (aspect: "9:16" | "4:5" | "1:1" | "16:9") => void }) {
  const [aspect, setAspect] = useState<"9:16" | "4:5" | "1:1" | "16:9">("9:16");
  const options: Array<["9:16" | "4:5" | "1:1" | "16:9", string]> = [["9:16", "Shorts · Reels · TikTok"], ["4:5", "Instagram feed"], ["1:1", "Square"], ["16:9", "YouTube"]];
  return (
    <div className="sh-row" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {options.map(([value, label]) => (
          <button key={value} type="button" className="sh-btn" aria-pressed={aspect === value} onClick={() => setAspect(value)} style={{ borderColor: aspect === value ? "var(--sh-blue)" : undefined }}>
            <span style={{ fontWeight: 600 }}>{value}</span>
            <span className="sh-muted" style={{ fontWeight: 400 }}>{label}</span>
          </button>
        ))}
      </div>
      <button type="button" className="sh-btn sh-btn--primary" onClick={() => onBlank(aspect)}><Plus size={15} strokeWidth={1.6} /> Create blank project</button>
    </div>
  );
}

function RecentRail({ projects, error, onOpen }: { projects: ProjectSummary[] | null; error: string | null; onOpen: (id: string) => void }) {
  if (error) return <p className="sh-error">Recent projects could not be loaded: {error}</p>;
  if (projects === null) return <p className="sh-muted" style={{ fontSize: 13 }}>Loading projects…</p>;
  if (projects.length === 0) {
    return (
      <div className="sh-card" style={{ padding: "22px 20px", display: "flex", alignItems: "center", gap: 14 }}>
        <LayoutGrid size={20} strokeWidth={1.4} className="sh-muted" />
        <span className="sh-muted" style={{ fontSize: 13.5 }}>Projects you create appear here, with their latest frame. Nothing is saved until you make something.</span>
      </div>
    );
  }
  return (
    <div style={{ display: "flex", gap: 14, overflowX: "auto", paddingBottom: 6 }} className="clyra-scroll">
      {projects.slice(0, 12).map((project) => (
        <button key={project.id} type="button" onClick={() => onOpen(project.id)} className="sh-card" style={{ flexShrink: 0, width: 150, padding: 0, overflow: "hidden", textAlign: "left", transition: "transform 160ms var(--sh-ease), box-shadow 160ms var(--sh-ease)" }}>
          <div style={{ aspectRatio: "9 / 12", background: "linear-gradient(160deg, var(--sh-line), var(--sh-surface-2))", display: "grid", placeItems: "center", position: "relative" }}>
            {project.thumbnail ? <img src={project.thumbnail} alt="" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }} /> : <Clapperboard size={22} strokeWidth={1.3} className="sh-muted" />}
          </div>
          <div style={{ padding: "10px 12px 12px" }}>
            <div style={{ fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{project.title}</div>
            <div className="sh-muted" style={{ fontSize: 11.5, marginTop: 2 }}>{kindLabel(project.kind)} · {relativeTime(project.updatedAt)}</div>
          </div>
        </button>
      ))}
    </div>
  );
}

export function kindLabel(kind: ShortsKind) {
  const labels: Record<ShortsKind, string> = {
    "ai-clip": "AI Clipper",
    "fake-text": "Fake Text Story",
    "would-rather": "Would You Rather",
    "reddit-story": "Reddit/Story Video",
    "narrated-story": "Narrated Story",
    quiz: "Quiz/Trivia",
    list: "List/Ranking Video",
    "gameplay-story": "Split Gameplay Story",
    "caption-video": "Caption Video",
    "cut-crop": "Cut & Crop",
  };
  return labels[kind];
}

export function relativeTime(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.round(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.round(hours / 24)} d ago`;
}
