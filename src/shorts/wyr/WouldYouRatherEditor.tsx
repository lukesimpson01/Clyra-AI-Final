// Would You Rather's dedicated editor — a focused two-step wizard (Questions,
// Audio) replacing the generic unified Shorts workspace for this one tool, the
// same way Fake Text Story has its own editor. Questions are ChoiceItem
// timeline entries (the schema and render engine already support them); this
// file only adds a purpose-built way to edit a *list* of them and preview the
// result, reusing the same save/export/voice infrastructure as every other
// Shorts tool.

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, ChevronRight, Loader2 } from "lucide-react";
import { shortsApi } from "../api";
import type { ShortsProject } from "../../../lib/shorts/schema";
import { ScriptTab } from "./ScriptTab";
import { AudioTab } from "./AudioTab";
import { WyrPreview } from "./Preview";
import { ExportModal } from "../faketext/ExportModal";
import "../faketext/faketext.css";
import "./wyr.css";

export type WyrTab = "script" | "audio";
const TABS: Array<{ id: WyrTab; label: string }> = [
  { id: "script", label: "Questions" },
  { id: "audio", label: "Audio & Timing" },
];

let counter = 0;
export function nextChoiceId() {
  counter += 1;
  return `wyr-${Date.now().toString(36)}-${counter.toString(36)}`;
}

export function WouldYouRatherEditor({ projectId, onBack, onOpenLibrary }: { projectId: string; onBack: () => void; onOpenLibrary: () => void }) {
  const [project, setProject] = useState<ShortsProject | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tab, setTab] = useState<WyrTab>("script");
  const [timeMs, setTimeMs] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [exportOpen, setExportOpen] = useState(false);

  const projectRef = useRef<ShortsProject | null>(null);
  const saveTimer = useRef<number | null>(null);

  useEffect(() => {
    let alive = true;
    shortsApi.getProject(projectId).then(({ project: loaded }) => {
      if (!alive) return;
      setProject(loaded);
      projectRef.current = loaded;
    }).catch((cause) => alive && setLoadError(cause instanceof Error ? cause.message : "This project could not be opened."));
    return () => { alive = false; };
  }, [projectId]);

  useEffect(() => () => { if (saveTimer.current) window.clearTimeout(saveTimer.current); }, []);

  const runSave = useCallback(async () => {
    const current = projectRef.current;
    if (!current) return;
    setSaveState("saving");
    try {
      const { project: saved } = await shortsApi.saveProject(current);
      projectRef.current = saved;
      setSaveState("saved");
    } catch {
      setSaveState("error");
    }
  }, []);

  const scheduleSave = useCallback((updated: ShortsProject) => {
    projectRef.current = updated;
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => void runSave(), 700);
  }, [runSave]);

  const update = useCallback((updater: (prev: ShortsProject) => ShortsProject) => {
    setProject((prev) => {
      if (!prev) return prev;
      const next = updater(prev);
      scheduleSave(next);
      return next;
    });
  }, [scheduleSave]);

  const flushNow = useCallback(() => {
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    void runSave();
  }, [runSave]);

  if (loadError) return <div className="ft-empty">{loadError}</div>;
  if (!project) return <div className="ft-empty"><Loader2 size={18} style={{ animation: "ft-spin 1s linear infinite" }} /> Loading…</div>;

  const tabIndex = TABS.findIndex((candidate) => candidate.id === tab);
  const goNext = () => { flushNow(); if (tabIndex < TABS.length - 1) setTab(TABS[tabIndex + 1].id); };
  const goBack = () => { if (tabIndex > 0) setTab(TABS[tabIndex - 1].id); else onBack(); };

  return (
    <div className="ft-root ft-root--creator-studio" data-tool="would-rather">
      <style>{"@keyframes ft-spin { to { transform: rotate(360deg); } }"}</style>
      <div className="ft-main">
        <div className="ft-panel ft-editor-col">
          {tab === "script" ? <ScriptTab project={project} onUpdate={update} onJumpTime={setTimeMs} /> : null}
          {tab === "audio" ? <AudioTab project={project} onUpdate={update} /> : null}
        </div>
        <div className="ft-panel ft-preview-col">
          <WyrPreview project={project} timeMs={timeMs} playing={playing} onTimeChange={setTimeMs} onPlayingChange={setPlaying} />
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
        <span className={`ft-save-state${saveState === "error" ? " error" : ""}`}>{saveState === "saving" ? "Saving…" : saveState === "error" ? "Could not save" : saveState === "saved" ? "Saved" : ""}</span>
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
