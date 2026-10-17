// Fake Text Story's dedicated editor — a full replacement of the generic
// Shorts unified editor for this one tool, per spec. Layout: left editor
// panel (Script / Theme / Gameplay Video / Audio tabs) + right live preview,
// with a bottom workflow nav between stages. Message text/order is the only
// thing the user edits directly; timing (bubble/typing/scroll) always comes
// from the server's timeline build, which measures real synthesized speech —
// the editor never invents timing client-side.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ChevronRight, Loader2 } from "lucide-react";
import { shortsApi, subscribeJob, type JobSnapshot } from "../api";
import type { FakeTextScriptMessage } from "../../../lib/shorts/faketext-timeline";
import { planFakeTextSegments, geometryForFakeText } from "../../../lib/shorts/faketext-timeline";
import type { MessageItem, ShortsProject } from "../../../lib/shorts/schema";
import { ScriptTab } from "./ScriptTab";
import { ThemeTab } from "./ThemeTab";
import { GameplayTab } from "./GameplayTab";
import { AudioTab } from "./AudioTab";
import { FakeTextPreview } from "./FakeTextPreview";
import { ExportModal } from "./ExportModal";
import "./faketext.css";

export type FakeTextTab = "script" | "theme" | "gameplay" | "audio";
const TABS: Array<{ id: FakeTextTab; label: string }> = [
  { id: "script", label: "Script" },
  { id: "theme", label: "Theme" },
  { id: "gameplay", label: "Gameplay Video" },
  { id: "audio", label: "Audio" },
];

let counter = 0;
export function nextMessageId() {
  counter += 1;
  return `msg-${Date.now().toString(36)}-${counter.toString(36)}`;
}

export function FakeTextStoryEditor({ projectId, onBack, onOpenLibrary }: { projectId: string; onBack: () => void; onOpenLibrary: () => void }) {
  const [project, setProject] = useState<ShortsProject | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tab, setTab] = useState<FakeTextTab>("script");
  const [timeMs, setTimeMs] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [exportOpen, setExportOpen] = useState(false);
  const [buildJob, setBuildJob] = useState<JobSnapshot | null>(null);

  const projectRef = useRef<ShortsProject | null>(null);
  const saveTimer = useRef<number | null>(null);
  const jobUnsubscribe = useRef<(() => void) | null>(null);
  const dirtyRef = useRef(false);

  useEffect(() => {
    let alive = true;
    shortsApi.getProject(projectId).then(({ project: loaded }) => {
      if (!alive) return;
      setProject(loaded);
      projectRef.current = loaded;
    }).catch((cause) => alive && setLoadError(cause instanceof Error ? cause.message : "This project could not be opened."));
    return () => { alive = false; };
  }, [projectId]);

  useEffect(() => () => {
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    jobUnsubscribe.current?.();
  }, []);

  // ---- Save + rebuild pipeline --------------------------------------------
  // Every edit updates local state immediately (so typing feels instant), then
  // debounces a save + a background timeline rebuild. The rebuild is what
  // actually synthesizes/reuses speech and recomputes real timing; the on-disk
  // speech cache (keyed by voice+text) means an unrelated edit never re-fetches
  // audio for lines that did not change.

  // Two debounced paths, chosen per edit:
  //  - rebuild: anything that can change bubble/typing/scroll timing (text,
  //    voice, typing settings, or a Theme geometry field the scroll math
  //    reads) — saves, then re-synthesizes/reuses speech and recomputes the
  //    authoritative item timing on the server.
  //  - save-only: pure playback gain or cosmetic styling (volumes, colors,
  //    header visibility, chat position, corner radius) that the live
  //    preview already reflects instantly from `project` alone — persisting
  //    it is all that is needed, so this skips the TTS/timeline round trip
  //    entirely rather than pointlessly re-hitting the speech cache.
  // Both share one timer: the most recent edit decides which path fires, and
  // a rebuild request always wins if a rebuild-worthy edit lands mid-debounce.
  const pendingRebuild = useRef(false);

  const runSaveOnly = useCallback(async () => {
    const current = projectRef.current;
    if (!current) return;
    dirtyRef.current = false;
    setSaveState("saving");
    try {
      const { project: saved } = await shortsApi.saveProject(current);
      projectRef.current = saved;
      setSaveState("saved");
    } catch {
      setSaveState("error");
    }
  }, []);

  const runBuild = useCallback(async () => {
    const current = projectRef.current;
    if (!current) return;
    dirtyRef.current = false;
    setSaveState("saving");
    try {
      const { project: saved } = await shortsApi.saveProject(current);
      projectRef.current = saved;
      setProject(saved);
      const hasMessages = saved.items.some((item) => item.type === "message" && item.text.trim());
      if (!hasMessages) {
        setSaveState("saved");
        return;
      }
      const { job } = await shortsApi.buildFakeTextTimeline(saved.id);
      jobUnsubscribe.current?.();
      jobUnsubscribe.current = subscribeJob(job.id, (snapshot) => {
        setBuildJob(snapshot);
        if (snapshot.status === "completed" && snapshot.result && typeof snapshot.result === "object" && "project" in (snapshot.result as object)) {
          const rebuilt = (snapshot.result as { project: ShortsProject }).project;
          if (!dirtyRef.current) {
            projectRef.current = rebuilt;
            setProject(rebuilt);
          }
          setSaveState("saved");
        } else if (snapshot.status === "failed") {
          setSaveState("error");
        }
      }, () => setSaveState("error"));
    } catch {
      setSaveState("error");
    }
  }, []);

  const scheduleSave = useCallback((updated: ShortsProject, rebuild: boolean) => {
    projectRef.current = updated;
    dirtyRef.current = true;
    pendingRebuild.current = pendingRebuild.current || rebuild;
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      const doRebuild = pendingRebuild.current;
      pendingRebuild.current = false;
      void (doRebuild ? runBuild() : runSaveOnly());
    }, 900);
  }, [runBuild, runSaveOnly]);

  /** `rebuild` defaults true (the safe choice) — callers that know an edit is purely cosmetic pass false to skip the TTS/timeline round trip. */
  const update = useCallback((updater: (prev: ShortsProject) => ShortsProject, rebuild = true) => {
    setProject((prev) => {
      if (!prev) return prev;
      const next = updater(prev);
      scheduleSave(next, rebuild);
      return next;
    });
  }, [scheduleSave]);

  const flushNow = useCallback(() => {
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    pendingRebuild.current = false;
    void runBuild();
  }, [runBuild]);

  const messages = useMemo<MessageItem[]>(() => (project ? project.items.filter((item): item is MessageItem => item.type === "message") : []), [project]);

  const segments = useMemo(() => {
    if (!project) return [];
    const { geometry, viewportHeightPx } = geometryForFakeText(project.aspect, project.fakeText.theme);
    const scriptMessages: FakeTextScriptMessage[] = messages.map((item) => ({ id: item.id, side: item.side, sender: item.sender, text: item.text, reaction: item.reaction }));
    return planFakeTextSegments(scriptMessages, geometry, viewportHeightPx);
  }, [project, messages]);

  if (loadError) return <div className="ft-empty">{loadError}</div>;
  if (!project) return <div className="ft-empty"><Loader2 size={18} className="ft-spin" style={{ animation: "ft-spin 1s linear infinite" }} /> Loading…</div>;

  const tabIndex = TABS.findIndex((candidate) => candidate.id === tab);
  const goNext = () => {
    flushNow();
    if (tabIndex < TABS.length - 1) setTab(TABS[tabIndex + 1].id);
  };
  const goBack = () => {
    if (tabIndex > 0) setTab(TABS[tabIndex - 1].id);
    else onBack();
  };

  return (
    <div className="ft-root ft-root--creator-studio" data-tool="fake-text">
      <style>{"@keyframes ft-spin { to { transform: rotate(360deg); } }"}</style>
      <div className="ft-main">
        <div className="ft-panel ft-editor-col">
          {tab === "script" ? <ScriptTab project={project} messages={messages} segments={segments} onUpdate={update} onJumpTime={setTimeMs} /> : null}
          {tab === "theme" ? <ThemeTab project={project} onUpdate={update} /> : null}
          {tab === "gameplay" ? <GameplayTab project={project} onUpdate={update} onProjectReload={(p) => { setProject(p); projectRef.current = p; }} /> : null}
          {tab === "audio" ? <AudioTab project={project} onUpdate={update} onRebuildNow={flushNow} /> : null}
        </div>
        <div className="ft-panel ft-preview-col">
          <FakeTextPreview project={project} timeMs={timeMs} playing={playing} onTimeChange={setTimeMs} onPlayingChange={setPlaying} />
        </div>
      </div>

      <div className="ft-workflow">
        <div className="ft-workflow-left">
          <button type="button" className="ft-studio-back" onClick={onBack}><ArrowLeft size={15} strokeWidth={2} /> Studio</button>
          <span className="ft-stage-divider" />
          {TABS.map((item, index) => (
            <div key={item.id} style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <button type="button" className={`ft-stage-btn${tab === item.id ? " active" : ""}`} onClick={() => setTab(item.id)}>
                <span className="ft-stage-icon">{index + 1}</span>
                <span className="ft-stage-label">{item.label}</span>
              </button>
              {index < TABS.length - 1 ? <ChevronRight size={14} strokeWidth={2} className="ft-stage-chevron" /> : null}
            </div>
          ))}
        </div>
        <div className="ft-workflow-spacer" />
        <span className={`ft-save-state${saveState === "error" ? " error" : ""}`}>
          {saveState === "saving" || (buildJob && buildJob.status === "running") ? (buildJob?.message || "Saving…") : saveState === "error" ? "Could not save" : saveState === "saved" ? "Saved" : ""}
        </span>
        <button type="button" className="ft-back-btn" onClick={goBack}>
          <ArrowLeft size={15} strokeWidth={2} /> Back
        </button>
        <button type="button" className="ft-next-btn" onClick={tabIndex === TABS.length - 1 ? () => { flushNow(); setExportOpen(true); } : goNext}>
          {tabIndex === TABS.length - 1 ? "Export" : "Next"} <ChevronRight size={16} strokeWidth={2.4} />
        </button>
      </div>

      {exportOpen ? <ExportModal projectId={project.id} onClose={() => setExportOpen(false)} /> : null}
    </div>
  );
}
