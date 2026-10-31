// AI Clipper. Configure, run, review. The run streams the clipper engine's own
// progress events, so every percentage and stage name comes from the engine.
// Clips appear as soon as the engine reports them. Each clip opens in the same
// Shorts editor as every other project.

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Check, ChevronRight, Download, Loader2, Play, Sparkles, X } from "lucide-react";
import { shortsApi, waitForJob, type YoutubeSource } from "./api";
import { ClipperComposer, type ComposerSource } from "./ShortsHome";
import { Field, Segmented, Slider, TextInput, Toggle } from "./workspace/controls";
import type { JobSnapshot } from "./api";
import { publishActivity, dismissActivity } from "../lib/clyraHome";
import { SHORTS_ASPECTS } from "../../lib/shorts/schema";

type Goal = "auto" | "viral" | "educational" | "funny" | "controversial" | "storytelling" | "highlights" | "custom";
type Length = "auto" | "15-30" | "30-60" | "60-90" | "90-180" | "custom";
type Count = "auto" | "3" | "5" | "10" | "20" | "custom";
type Layout = "auto" | "single" | "two" | "interview" | "podcast" | "presentation" | "gameplay";

export type ClipConfig = {
  goal: Goal;
  customPrompt: string;
  length: Length;
  customLength: number;
  count: Count;
  customCount: number;
  layout: Layout;
  aspect: (typeof SHORTS_ASPECTS)[number];
  resolution: 720 | 1080;
  captions: boolean;
  removeFillers: boolean;
};

export const DEFAULT_CLIP_CONFIG: ClipConfig = {
  goal: "auto",
  customPrompt: "",
  length: "auto",
  customLength: 45,
  count: "auto",
  customCount: 5,
  layout: "auto",
  aspect: "9:16",
  resolution: 1080,
  captions: true,
  removeFillers: true,
};

/** Engine goal names. Options the engine cannot target are not offered (see GOALS). */
const GOAL_TO_ENGINE: Record<Exclude<Goal, "custom">, string> = {
  auto: "viral",
  viral: "viral",
  educational: "educational",
  funny: "funny",
  controversial: "opinions",
  storytelling: "emotional",
  highlights: "highlights",
};

const GOALS: Array<[Goal, string]> = [
  ["auto", "Auto"],
  ["viral", "Viral moments"],
  ["educational", "Educational"],
  ["funny", "Funny"],
  ["controversial", "Controversial / debate"],
  ["storytelling", "Storytelling"],
  ["highlights", "Highlights"],
  ["custom", "Custom instruction"],
];

const LENGTH_SECONDS: Record<Exclude<Length, "custom">, number> = { auto: 60, "15-30": 30, "30-60": 45, "60-90": 75, "90-180": 120 };

const LAYOUTS: Array<[Layout, string, string]> = [
  ["auto", "Auto", "Chosen from framing, speaker activity and crop safety."],
  ["single", "Single speaker", "Smart centred crop on the subject."],
  ["two", "Two speakers", "Keeps both people in frame when they fit."],
  ["interview", "Interview", "Follows the active speaker."],
  ["podcast", "Podcast", "Speaker switching with stable framing."],
  ["presentation", "Presentation", "Keeps the screen content in frame."],
  ["gameplay", "Gameplay", "Preserves the full gameplay area."],
];

const LAYOUT_TO_REFRAME: Record<Layout, string> = {
  auto: "auto",
  single: "single_speaker",
  two: "multi_speaker",
  interview: "multi_speaker",
  podcast: "multi_speaker",
  presentation: "keep_all",
  gameplay: "keep_all",
};

const STAGE_LABELS: Record<string, string> = {
  captions: "Source and transcript",
  analyze: "Finding moments",
  clip: "Framing and cutting",
  transcribe: "Aligning captions",
  subtitles: "Styling captions",
  render: "Encoding",
  complete: "Done",
};

export function engineConfigFrom(config: ClipConfig) {
  const goal = config.goal === "custom" ? (config.customPrompt.trim() || "viral") : GOAL_TO_ENGINE[config.goal];
  const seconds = config.length === "custom" ? config.customLength : LENGTH_SECONDS[config.length];
  const count = config.count === "custom" ? config.customCount : config.count === "auto" ? 3 : Number(config.count);
  return {
    moment_type: goal,
    clip_duration: Math.max(15, Math.min(180, seconds)),
    clip_count: Math.max(1, Math.min(12, count)),
    aspect_ratio: config.aspect,
    render_quality: config.resolution === 720 ? "balanced" : "premium",
    captions_enabled: config.captions,
    // A clip card is already a finished, downloadable result. Keep the
    // editor's detached caption workflow for later refinements, but make the
    // first rendered MP4 match what the user asked for when Captions is on.
    burn_captions: config.captions,
    remove_fillers: config.removeFillers,
    clip_name: "clip",
    auto_reframe: true,
    face_tracking: {
      enabled: true,
      mode: "smooth",
      allowZoom: false,
      smartReframe: true,
      reframeMode: LAYOUT_TO_REFRAME[config.layout],
      speakerMode: "auto",
      trackingQuality: "high_quality",
    },
  };
}

type EngineResult = {
  output: string;
  title: string;
  reason?: string;
  caption?: string;
  hashtags?: string;
  rank?: number;
  score?: number;
  virality_score?: number;
  clip_potential_score?: number;
  score_breakdown?: Record<string, { score?: number; max?: number }>;
  source_title?: string;
  source_start?: string;
  source_end?: string;
  clip_duration?: string;
  words?: Array<{ word?: string; text?: string; start: number; end: number }>;
  file_size?: number;
  subtitles_burned?: boolean;
};

type ClipCard = { key: string; result: EngineResult; selected: boolean; state: "ready" | "importing" | "rendering" | "done" | "failed"; detail?: string; projectId?: string; download?: string };

type RunState = { status: "idle" | "running" | "done" | "error" | "cancelled"; step: string; message: string; measured: number; error?: string; log: string[] };

/**
 * Entry point: shows the link/file composer until a source is chosen, then
 * hands off to the configure → run → review flow below. Kept as a thin
 * wrapper so the (large) flow component only ever deals with a real source.
 */
export function ShortsClipper({ source: initialSource, onBack, onOpenProject }: { source: ComposerSource | null; onBack: () => void; onOpenProject: (id: string) => void }) {
  const [source, setSource] = useState(initialSource);
  if (!source) {
    return (
      <div className="shorts-root sh-clipper-page sh-clipper-studio">
        <div className="sh-page-frame sh-page-frame--wide">
          <header className="sh-page-header sh-clipper-page-header">
            <div className="sh-page-heading">
              <button type="button" className="sh-icon-btn" onClick={onBack} aria-label="Back to Shorts"><ArrowLeft size={17} strokeWidth={1.8} /></button>
              <div><span className="sh-page-eyebrow">CREATOR STUDIO / AI CLIPPER</span><h1>Import Video</h1><p>Upload a video or connect a YouTube link to begin.</p></div>
            </div>
            <span className="sh-local-badge">Local workflow</span>
          </header>
          <ClipperSteps active="import" />
          <ClipperComposer onStart={setSource} />
        </div>
      </div>
    );
  }
  return <ShortsClipperFlow source={source} onBack={onBack} onOpenProject={onOpenProject} />;
}

function ShortsClipperFlow({ source, onBack, onOpenProject }: { source: ComposerSource; onBack: () => void; onOpenProject: (id: string) => void }) {
  const [config, setConfig] = useState<ClipConfig>(DEFAULT_CLIP_CONFIG);
  const [run, setRun] = useState<RunState>({ status: "idle", step: "", message: "", measured: 0, log: [] });
  const [displayed, setDisplayed] = useState(0);
  const [cards, setCards] = useState<ClipCard[]>([]);
  const [sort, setSort] = useState<"recommended" | "score" | "length" | "timeline">("recommended");
  const [formError, setFormError] = useState<string | null>(null);
  const [queue, setQueue] = useState<{ running: boolean; done: number; total: number } | null>(null);
  const abort = useRef<AbortController | null>(null);
  // The engine job id, from the server's first SSE event. The job runs
  // independently of this connection — closing the tab does not stop it.
  // Only an explicit Cancel calls /api/clipper/jobs/:id/cancel to stop it for real.
  const jobId = useRef<string | null>(null);

  // Display progress eases toward the engine's measured value. It never runs ahead of it.
  useEffect(() => {
    if (run.status !== "running") {
      setDisplayed(run.status === "done" ? 100 : displayed);
      return;
    }
    let frame = 0;
    const step = () => {
      setDisplayed((current) => {
        const target = run.measured;
        if (target <= current) return current;
        return Math.min(target, current + Math.max(0.15, (target - current) * 0.12));
      });
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
    // Only the measured target drives the easing loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run.status, run.measured]);

  useEffect(() => () => abort.current?.abort(), []);

  const estimate = useMemo(() => {
    if (!source) return "";
    const durationMs = source.kind === "youtube" ? source.source.durationMs : source.durationMs;
    return durationMs > 25 * 60_000 ? "Long-form analysis: a low-cost pass over the whole video, then detailed work on the strongest candidates." : "Standard analysis: transcript, scene map, framing and captions for every candidate.";
  }, [source]);

  const start = async () => {
    if (!source) return;
    if (config.goal === "custom" && !config.customPrompt.trim()) {
      setFormError("Describe the moments you want, for example “moments where they explain why startups fail”.");
      return;
    }
    setFormError(null);
    setCards([]);
    setRun({ status: "running", step: "captions", message: "Starting", measured: 0, log: [] });
    setDisplayed(0);
    jobId.current = null;
    abort.current = new AbortController();
    const activityKey = `shorts:${Date.now()}`;
    const clipCount = { n: 0 };
    publishActivity({ key: activityKey, app: "shorts", title: source.kind === "youtube" ? "Generating clips from a YouTube video" : "Generating clips from your upload", detail: "Starting", progress: 0 });
    const body = source.kind === "youtube" ? { url: source.source.url, config: engineConfigFrom(config) } : { uploadId: source.uploadId, config: engineConfigFrom(config) };
    try {
      const response = await fetch("/api/clipper/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: abort.current.signal,
      });
      if (!response.ok || !response.body) {
        const detail = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(detail.error || `The clipper could not start (${response.status})`);
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let finished = false;
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const frames = buffer.split("\n\n");
        buffer = frames.pop() || "";
        for (const frame of frames) {
          const line = frame.split("\n").find((entry) => entry.startsWith("data: "));
          if (!line) continue;
          let event: Record<string, any>;
          try {
            event = JSON.parse(line.slice(6));
          } catch {
            continue;
          }
          if (event.type === "job" && event.jobId) {
            jobId.current = String(event.jobId);
          } else if (event.type === "clip_result" && event.result?.output) {
            const result = event.result as EngineResult;
            clipCount.n += 1;
            publishActivity({ key: activityKey, app: "shorts", title: "Generating clips", detail: `${clipCount.n} clip${clipCount.n === 1 ? "" : "s"} ready so far` });
            setCards((current) => (current.some((card) => card.result.output === result.output) ? current : [...current, { key: result.output, result, selected: false, state: "ready" }]));
          } else if (event.type === "progress") {
            publishActivity({ key: activityKey, app: "shorts", title: "Generating clips", detail: String(event.message || event.step || "Working"), progress: typeof event.overall === "number" ? event.overall : undefined });
            setRun((current) => ({
              ...current,
              step: String(event.step || current.step),
              message: String(event.message || current.message),
              measured: typeof event.overall === "number" ? Math.max(current.measured, event.overall) : current.measured,
              log: event.message ? [...current.log, String(event.message)].slice(-40) : current.log,
            }));
          } else if (event.type === "log" && event.message) {
            setRun((current) => ({ ...current, log: [...current.log, String(event.message)].slice(-40) }));
          } else if (event.type === "error") {
            finished = true;
            publishActivity({ key: activityKey, app: "shorts", title: "Clip generation failed", detail: String(event.message || "The clipper failed."), status: "failed" });
            setRun((current) => ({ ...current, status: "error", error: String(event.message || "The clipper failed."), log: [...current.log, `Error: ${event.message}`].slice(-40) }));
          } else if (event.type === "cancelled") {
            finished = true;
            dismissActivity(activityKey);
            setRun((current) => ({ ...current, status: "cancelled", message: "Cancelled" }));
          } else if (event.type === "complete") {
            publishActivity({ key: activityKey, app: "shorts", title: clipCount.n ? `${clipCount.n} clip${clipCount.n === 1 ? "" : "s"} finished` : "Clip generation finished", detail: "Ready in Shorts", status: "done" });
            setRun((current) => (current.status === "error" ? current : { ...current, status: "done", measured: 100, message: "Clips ready" }));
          }
        }
      }
      if (!finished) publishActivity({ key: activityKey, app: "shorts", title: clipCount.n ? `${clipCount.n} clip${clipCount.n === 1 ? "" : "s"} finished` : "Clip generation finished", detail: "Ready in Shorts", status: "done" });
      setRun((current) => (current.status === "running" ? { ...current, status: finished ? current.status : "done", measured: 100, message: "Clips ready" } : current));
    } catch (error) {
      if (abort.current?.signal.aborted) {
        dismissActivity(activityKey);
        setRun((current) => ({ ...current, status: "cancelled", message: "Cancelled" }));
      } else {
        publishActivity({ key: activityKey, app: "shorts", title: "Clip generation failed", detail: error instanceof Error ? error.message : "The clipper failed.", status: "failed" });
        setRun((current) => ({ ...current, status: "error", error: error instanceof Error ? error.message : "The clipper failed." }));
      }
    }
  };

  const cancelRun = () => {
    // Stopping the local connection alone would no longer stop the engine —
    // it keeps running in the background by design. This is the real stop.
    if (jobId.current) void fetch(`/api/clipper/jobs/${encodeURIComponent(jobId.current)}/cancel`, { method: "POST" }).catch(() => undefined);
    abort.current?.abort();
  };

  const sortedCards = useMemo(() => {
    const list = [...cards];
    const scoreOf = (card: ClipCard) => card.result.score ?? card.result.clip_potential_score ?? card.result.virality_score ?? -1;
    if (sort === "score") list.sort((a, b) => scoreOf(b) - scoreOf(a));
    if (sort === "length") list.sort((a, b) => parseClipSeconds(b.result.clip_duration) - parseClipSeconds(a.result.clip_duration));
    if (sort === "timeline") list.sort((a, b) => parseClipSeconds(a.result.source_start) - parseClipSeconds(b.result.source_start));
    if (sort === "recommended") list.sort((a, b) => (a.result.rank ?? 0) - (b.result.rank ?? 0));
    return list;
  }, [cards, sort]);

  const importAndOpen = async (card: ClipCard, options: { render?: boolean } = {}) => {
    if (!source) return null;
    const payload = {
      output: basename(card.result.output),
      title: card.result.title || "AI clip",
      reason: card.result.reason,
      caption: card.result.caption,
      hashtags: card.result.hashtags,
      rank: card.result.rank,
      score: card.result.score ?? card.result.clip_potential_score ?? card.result.virality_score ?? null,
      scoreBreakdown: card.result.score_breakdown,
      sourceUrl: source.kind === "youtube" ? source.source.url : undefined,
      sourceTitle: card.result.source_title || (source.kind === "youtube" ? source.source.title : source.name),
      sourceStart: card.result.source_start,
      sourceEnd: card.result.source_end,
      words: card.result.words,
      subtitlesBurned: Boolean(card.result.subtitles_burned),
      aspect: config.aspect,
    };
    const { project } = await shortsApi.importClip(payload);
    if (!options.render) return { projectId: project.id, job: null };
    const { job } = await shortsApi.startRender(project.id, { resolution: config.resolution, fps: 30, quality: "balanced" });
    return { projectId: project.id, job };
  };

  const openInEditor = async (card: ClipCard) => {
    setCards((current) => current.map((item) => (item.key === card.key ? { ...item, state: "importing" } : item)));
    try {
      const result = await importAndOpen(card);
      if (result) onOpenProject(result.projectId);
    } catch (error) {
      setCards((current) => current.map((item) => (item.key === card.key ? { ...item, state: "failed", detail: error instanceof Error ? error.message : "Import failed" } : item)));
    }
  };

  const exportSelected = async () => {
    const selected = cards.filter((card) => card.selected);
    if (!selected.length) return;
    setQueue({ running: true, done: 0, total: selected.length });
    for (const card of selected) {
      setCards((current) => current.map((item) => (item.key === card.key ? { ...item, state: "rendering", detail: "Queued" } : item)));
      try {
        const result = await importAndOpen(card, { render: true });
        if (!result?.job) throw new Error("Export did not start");
        const finished = await waitForJob(result.job.id, (job: JobSnapshot) => {
          setCards((current) => current.map((item) => (item.key === card.key ? { ...item, detail: `${job.stageLabel} · ${Math.floor(job.overall)}%` } : item)));
        });
        if (finished.status !== "completed") throw new Error(finished.error || "Export did not finish");
        setCards((current) => current.map((item) => (item.key === card.key ? { ...item, state: "done", projectId: result.projectId, download: finished.result?.url, detail: "Exported" } : item)));
      } catch (error) {
        setCards((current) => current.map((item) => (item.key === card.key ? { ...item, state: "failed", detail: error instanceof Error ? error.message : "Export failed" } : item)));
      }
      setQueue((current) => (current ? { ...current, done: current.done + 1 } : current));
    }
    setQueue((current) => (current ? { ...current, running: false } : current));
  };

  if (!source) {
    return (
      <div className="shorts-root" style={{ padding: 40, maxWidth: 640 }}>
        <p className="sh-muted" style={{ fontSize: 14, lineHeight: 1.5 }}>Choose a video first. Paste a YouTube link or add a file on the Shorts home page.</p>
        <button type="button" className="sh-btn" onClick={onBack} style={{ marginTop: 12 }}><ArrowLeft size={15} strokeWidth={1.6} /> Back to Shorts</button>
      </div>
    );
  }

  const sourceTitle = source.kind === "youtube" ? source.source.title : source.name;
  const sourceMinutes = Math.round((source.kind === "youtube" ? source.source.durationMs : source.durationMs) / 60000);
  const configured = run.status === "idle";

  return (
    <div className="shorts-root sh-clipper-page sh-clipper-studio">
      <div className="sh-page-frame sh-page-frame--wide">
        <div className="sh-row sh-clipper-flow-title">
          <button type="button" className="sh-icon-btn" onClick={onBack} aria-label="Back to Shorts"><ArrowLeft size={17} strokeWidth={1.6} /></button>
          <div><span className="sh-page-eyebrow">AI CLIPPER / CONFIGURE</span><h1>Find your strongest clips</h1><p>{sourceTitle} · {sourceMinutes} min</p></div>
        </div>

        <ClipperSteps active={cards.length > 0 || run.status === "done" ? "review" : run.status === "idle" ? "configure" : "generate"} />

        {configured ? (
          <div className="sh-clipper-config-grid">
            <div className="sh-card sh-clipper-config-card">
              <Field label="Clip goal" hint={config.goal === "storytelling" ? "Storytelling uses the emotional-moment finder." : undefined}>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {GOALS.map(([value, label]) => (
                    <button key={value} type="button" className="sh-btn sh-btn--sm" aria-pressed={config.goal === value} onClick={() => setConfig({ ...config, goal: value })} style={{ borderColor: config.goal === value ? "var(--sh-blue)" : undefined, color: config.goal === value ? "var(--sh-blue-ink)" : undefined }}>{label}</button>
                  ))}
                </div>
                <p className="sh-hint">Not offered yet: Quotes, Action and Product/marketing. The engine can't target them, so Clyra doesn't pretend it can.</p>
              </Field>
              {config.goal === "custom" ? (
                <Field label="Custom instruction">
                  <TextInput value={config.customPrompt} onChange={(value) => setConfig({ ...config, customPrompt: value.slice(0, 300) })} placeholder="Find moments where they discuss why startups fail." />
                </Field>
              ) : null}
              <Field label="Desired length">
                <Segmented value={config.length} options={[["auto", "Auto"], ["15-30", "15–30 s"], ["30-60", "30–60 s"], ["60-90", "60–90 s"], ["90-180", "90 s–3 min"], ["custom", "Custom"]]} onChange={(value) => setConfig({ ...config, length: value as Length })} />
                {config.length === "custom" ? <div style={{ marginTop: 10 }}><Slider min={15} max={180} value={config.customLength} format={(value) => `${value}s`} onChange={(value) => setConfig({ ...config, customLength: value })} /></div> : null}
              </Field>
              <Field label="Number of clips">
                <Segmented value={config.count} options={[["auto", "Auto"], ["3", "3"], ["5", "5"], ["10", "10"], ["20", "20"], ["custom", "Custom"]]} onChange={(value) => setConfig({ ...config, count: value as Count })} />
                {config.count === "20" ? <p className="sh-hint">One run returns up to 12 clips. Run again for more.</p> : null}
                {config.count === "custom" ? <div style={{ marginTop: 10 }}><Slider min={1} max={12} value={config.customCount} onChange={(value) => setConfig({ ...config, customCount: value })} /></div> : null}
              </Field>
              <Field label="Speaker and layout">
                <select className="sh-select" aria-label="Speaker and layout" value={config.layout} onChange={(event) => setConfig({ ...config, layout: event.target.value as Layout })}>
                  {LAYOUTS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
                <p className="sh-hint">{LAYOUTS.find(([value]) => value === config.layout)?.[2]}</p>
              </Field>
              <Field label="Aspect ratio">
                <Segmented value={config.aspect} options={SHORTS_ASPECTS.map((value) => [value, value] as [string, string])} onChange={(value) => setConfig({ ...config, aspect: value as ClipConfig["aspect"] })} />
              </Field>
              <Field label="Resolution" hint={config.resolution === 1080 ? "1080p is the full-quality path. A 720p source is upscaled, and the export says so." : "720p is a faster lane that skips pixels the output can't use."}>
                <Segmented value={String(config.resolution)} options={[["720", "720p"], ["1080", "1080p"]]} onChange={(value) => setConfig({ ...config, resolution: Number(value) as 720 | 1080 })} />
              </Field>
              <div className="sh-row" style={{ marginTop: 16 }}>
                <span className="sh-muted" style={{ fontSize: 13 }}>Captions from the speech</span>
                <Toggle checked={config.captions} onChange={(value) => setConfig({ ...config, captions: value })} label="Captions" />
              </div>
              <div className="sh-row" style={{ marginTop: 12 }}>
                <span className="sh-muted" style={{ fontSize: 13 }}>Remove filler words (um, uh)</span>
                <Toggle checked={config.removeFillers} onChange={(value) => setConfig({ ...config, removeFillers: value })} label="Remove filler words" />
              </div>
              {formError ? <p className="sh-error" style={{ marginTop: 14 }}>{formError}</p> : null}
              <div style={{ marginTop: 22 }}>
                <button type="button" className="sh-btn sh-btn--primary" onClick={() => void start()}><Sparkles size={15} strokeWidth={1.6} /> Find clips</button>
              </div>
            </div>
            <aside className="sh-card" style={{ padding: 18, position: "sticky", top: 16 }}>
              <div className="sh-section-title">Analysis</div>
              <p className="sh-muted" style={{ margin: 0, fontSize: 13, lineHeight: 1.5 }}>{estimate}</p>
              <div className="sh-divider" />
              <div className="sh-section-title">What you get</div>
              <p className="sh-muted" style={{ margin: 0, fontSize: 13, lineHeight: 1.5 }}>Each clip arrives with a Clyra Clip Score, the reasons it was chosen, and word-timed captions. Every clip opens in the editor and stays editable.</p>
            </aside>
          </div>
        ) : null}

        {!configured ? (
          <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 320px", gap: 22, alignItems: "start" }}>
            <div>
              <div className="sh-card" style={{ padding: 20 }}>
                <div className="sh-row" style={{ marginBottom: 10 }}>
                  <span style={{ fontSize: 15, fontWeight: 600 }}>{run.status === "running" ? "Finding the moments worth keeping" : run.status === "done" ? "Clips ready" : run.status === "cancelled" ? "Cancelled" : "Something went wrong"}</span>
                  <span className="sh-muted" style={{ fontVariantNumeric: "tabular-nums", fontSize: 13 }}>{run.status === "error" ? "" : `${Math.floor(displayed)}%`}</span>
                </div>
                <div className={`sh-progress${run.status === "running" ? " sh-progress--shimmer" : ""}`} style={{ height: 8 }}>
                  <span style={{ width: `${displayed}%` }} />
                </div>
                <div className="sh-muted" style={{ marginTop: 10, fontSize: 13 }}>
                  {STAGE_LABELS[run.step] ?? run.step} {run.message ? `· ${run.message}` : ""}
                </div>
                {run.status === "running" ? (
                  <div style={{ marginTop: 12 }}>
                    <button type="button" className="sh-btn sh-btn--sm" onClick={cancelRun}><X size={13} strokeWidth={1.6} /> Cancel</button>
                  </div>
                ) : null}
                {run.status === "error" ? <p className="sh-error" style={{ marginTop: 10 }}>{run.error}</p> : null}
                {run.status !== "running" && run.status !== "idle" ? (
                  <button type="button" className="sh-btn sh-btn--sm" style={{ marginTop: 12 }} onClick={() => setRun({ status: "idle", step: "", message: "", measured: 0, log: [] })}>Change settings and run again</button>
                ) : null}
              </div>
              {run.log.length ? (
                <details className="sh-card" style={{ marginTop: 14, padding: "12px 16px" }}>
                  <summary className="sh-muted" style={{ fontSize: 13, cursor: "pointer" }}>Activity ({run.log.length})</summary>
                  <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 4, maxHeight: 220, overflowY: "auto", fontSize: 12, color: "var(--sh-ink-2)" }} className="clyra-scroll">
                    {run.log.map((line, index) => <span key={index}>{line}</span>)}
                  </div>
                </details>
              ) : null}
            </div>
          </div>
        ) : null}

        {cards.length ? (
          <section style={{ marginTop: 28 }}>
            <div className="sh-row" style={{ marginBottom: 14, flexWrap: "wrap", gap: 10 }}>
              <span className="sh-section-title" style={{ margin: 0 }}>{cards.length} clip{cards.length === 1 ? "" : "s"}</span>
              <div className="sh-segmented" aria-label="Sort clips">
                {([["recommended", "Recommended"], ["score", "Score"], ["length", "Length"], ["timeline", "Timeline"]] as const).map(([value, label]) => (
                  <button key={value} type="button" aria-pressed={sort === value} onClick={() => setSort(value)}>{label}</button>
                ))}
              </div>
              <div style={{ flex: 1 }} />
              {queue ? <span className="sh-muted" style={{ fontSize: 12.5 }}>Export queue {queue.done} of {queue.total}{queue.running ? "" : " · finished"}</span> : null}
              <button type="button" className="sh-btn sh-btn--sm" disabled={!cards.some((card) => card.selected) || Boolean(queue?.running)} onClick={() => void exportSelected()}>
                <Download size={13} strokeWidth={1.6} /> Export selected (1 at a time)
              </button>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 16 }}>
              {sortedCards.map((card) => (
                <ClipCardView
                  key={card.key}
                  card={card}
                  onToggle={() => setCards((current) => current.map((item) => (item.key === card.key ? { ...item, selected: !item.selected } : item)))}
                  onOpen={() => void openInEditor(card)}
                  onRemove={() => setCards((current) => current.filter((item) => item.key !== card.key))}
                />
              ))}
            </div>
          </section>
        ) : null}
        {run.status === "done" && cards.length === 0 ? (
          <p className="sh-muted" style={{ marginTop: 24, fontSize: 14 }}>The clipper finished without a usable clip. Check the activity log for the reason, then try a different goal or length.</p>
        ) : null}
      </div>
    </div>
  );
}

function ClipperSteps({ active }: { active: "import" | "configure" | "generate" | "review" }) {
  const steps = [
    ["import", "Import"],
    ["configure", "Configure"],
    ["generate", "Generate"],
    ["review", "Review"],
  ] as const;
  const activeIndex = steps.findIndex(([id]) => id === active);
  return (
    <div className="sh-studio-steps" aria-label="AI Clipper workflow">
      {steps.map(([id, label], index) => (
        <div key={id} className={`sh-studio-step${index === activeIndex ? " is-active" : ""}${index < activeIndex ? " is-complete" : ""}`} aria-current={index === activeIndex ? "step" : undefined}>
          <span>{index < activeIndex ? <Check size={13} strokeWidth={2.4} /> : index + 1}</span>
          <strong>{label}</strong>
          {index < steps.length - 1 ? <ChevronRight size={14} className="sh-studio-step__chevron" /> : null}
        </div>
      ))}
    </div>
  );
}

function ClipCardView({ card, onToggle, onOpen, onRemove }: { card: ClipCard; onToggle: () => void; onOpen: () => void; onRemove: () => void }) {
  const video = useRef<HTMLVideoElement | null>(null);
  const { result } = card;
  const score = result.score ?? result.clip_potential_score ?? result.virality_score;
  const breakdown = Object.entries(result.score_breakdown || {}).map(([key, value]) => [key, typeof value === "number" ? value : Number(value?.score)] as const).filter(([, value]) => Number.isFinite(value)).slice(0, 6);
  const busy = card.state === "importing" || card.state === "rendering";
  return (
    <article className="sh-card" style={{ overflow: "hidden", display: "flex", flexDirection: "column", transition: "transform 160ms var(--sh-ease), box-shadow 160ms var(--sh-ease)" }}>
      <div
        style={{ position: "relative", aspectRatio: "9 / 16", background: "#0b0c10", maxHeight: 340 }}
        onPointerEnter={() => void video.current?.play().catch(() => undefined)}
        onPointerLeave={() => { video.current?.pause(); if (video.current) video.current.currentTime = 0; }}
      >
        <video ref={video} src={`/api/clipper/media/${encodeURIComponent(basename(result.output))}`} muted loop playsInline preload="metadata" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        <label style={{ position: "absolute", top: 10, left: 10, background: "rgba(255,255,255,0.92)", borderRadius: 8, padding: 6, display: "flex", gap: 6, alignItems: "center", fontSize: 12, fontWeight: 600, color: "#14130f" }}>
          <input type="checkbox" checked={card.selected} onChange={onToggle} aria-label={`Select clip ${result.title}`} />
          Select
        </label>
        <span className="sh-pill" style={{ position: "absolute", bottom: 10, right: 10, background: "rgba(0,0,0,0.6)", color: "#fff", borderColor: "transparent" }}><Play size={10} strokeWidth={2} /> {result.clip_duration || "clip"}</span>
      </div>
      <div style={{ padding: 14, display: "flex", flexDirection: "column", gap: 8, flex: 1 }}>
        <div style={{ fontSize: 14.5, fontWeight: 600, lineHeight: 1.3 }}>{result.title}</div>
        <div className="sh-row" style={{ justifyContent: "flex-start", gap: 8 }}>
          {typeof score === "number" ? <span className="sh-pill sh-pill--blue">Clyra Clip Score {Math.round(score)}</span> : <span className="sh-pill">Score unavailable</span>}
          {result.source_start ? <span className="sh-pill">{result.source_start}–{result.source_end}</span> : null}
        </div>
        {result.reason ? <p className="sh-muted" style={{ margin: 0, fontSize: 12.5, lineHeight: 1.5 }}>{result.reason}</p> : null}
        {breakdown.length ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {breakdown.map(([key, value]) => (
              <div key={key} className="sh-row" style={{ gap: 8, fontSize: 11.5 }}>
                <span className="sh-muted" style={{ textTransform: "capitalize", minWidth: 90 }}>{key.replace(/_/g, " ")}</span>
                <div className="sh-progress" style={{ flex: 1, height: 4 }}><span style={{ width: `${Math.max(0, Math.min(100, value))}%` }} /></div>
              </div>
            ))}
          </div>
        ) : null}
        {card.detail ? <div className="sh-muted" style={{ fontSize: 12 }}>{card.detail}</div> : null}
        {card.state === "failed" ? <div className="sh-error" style={{ fontSize: 12.5 }}>{card.detail}</div> : null}
        <div className="sh-row" style={{ marginTop: "auto", paddingTop: 6, gap: 6, flexWrap: "wrap", justifyContent: "flex-start" }}>
          <button type="button" className="sh-btn sh-btn--primary sh-btn--sm" onClick={onOpen} disabled={busy}>
            {busy ? <Loader2 size={13} strokeWidth={1.6} className="sh-spin" /> : <Check size={13} strokeWidth={1.6} />} Open in editor
          </button>
          <button type="button" className="sh-btn sh-btn--ghost sh-btn--sm" onClick={onRemove} disabled={busy}>Remove</button>
        </div>
      </div>
    </article>
  );
}

function basename(value: string) {
  return value.split(/[\\/]/).pop() || value;
}

export function parseClipSeconds(value?: string) {
  if (!value) return 0;
  const parts = value.split(":").map(Number);
  if (parts.some((part) => !Number.isFinite(part))) return 0;
  return parts.reduce((total, part) => total * 60 + part, 0);
}

export type { YoutubeSource };
