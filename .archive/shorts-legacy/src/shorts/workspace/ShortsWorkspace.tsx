// The Shorts editor. One workspace serves every tool: a project loads into the
// same shell regardless of its kind, and the tool only changes which items and
// inspector tabs are offered. State changes go through the command history, and
// the project autosaves through the server's atomic writer.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Download, Pause, Play, Redo2, Save, Scissors, Undo2 } from "lucide-react";
import { shortsApi, subscribeJob, type JobSnapshot } from "../api";
import { ShortsCanvas, designSizeFor } from "../engine/ShortsCanvas";
import { commit, emptyHistory, redo, redoLabel, undo, undoLabel, type History } from "../history";
import { kindLabel } from "../ShortsHome";
import { Timeline } from "./Timeline";
import { Inspector, type InspectorTab } from "./Inspector";
import { LeftRail } from "./LeftRail";
import { CutCropPanel } from "./CutCropPanel";
import { formatClock } from "../format";
import { addItem, deleteItems, duplicateItem, findItem, moveItem, resizeItem, splitItem, updateItem } from "../../../lib/shorts/ops";
import { outputSize, projectDurationMs, type ShortsProject, type TimelineItem, type TimelineItemType } from "../../../lib/shorts/schema";

type SaveState = { status: "idle" | "saving" | "saved" | "error"; message?: string };

export type ShortsWorkspaceProps = {
  projectId: string;
  onBack: () => void;
  onOpenLibrary: () => void;
};

const SAVE_DEBOUNCE_MS = 700;

export function ShortsWorkspace({ projectId, onBack, onOpenLibrary }: ShortsWorkspaceProps) {
  const [project, setProject] = useState<ShortsProject | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [history, setHistory] = useState<History>(emptyHistory);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [timeMs, setTimeMs] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [zoom, setZoom] = useState(80);
  const [tab, setTab] = useState<InspectorTab>("item");
  const [save, setSave] = useState<SaveState>({ status: "idle" });
  const [notice, setNotice] = useState<string | null>(null);
  const [showSafeArea, setShowSafeArea] = useState(false);
  const [previewBox, setPreviewBox] = useState({ width: 360 });
  const [job, setJob] = useState<JobSnapshot | null>(null);
  const [rippleDelete, setRippleDelete] = useState(true);

  const projectRef = useRef<ShortsProject | null>(null);
  projectRef.current = project;
  const dirtyRef = useRef(false);
  const saveTimer = useRef<number | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const centerRef = useRef<HTMLDivElement | null>(null);
  const jobUnsubscribe = useRef<(() => void) | null>(null);

  // ---- Load ---------------------------------------------------------------

  useEffect(() => {
    let alive = true;
    setProject(null);
    setLoadError(null);
    shortsApi
      .getProject(projectId)
      .then(({ project: loaded }) => {
        if (!alive) return;
        setProject(loaded);
        setHistory(emptyHistory());
        setSelectedIds([]);
        setTimeMs(0);
        setTab(loaded.kind === "cut-crop" ? "background" : "item");
      })
      .catch((error: Error) => alive && setLoadError(error.message));
    return () => {
      alive = false;
      jobUnsubscribe.current?.();
    };
  }, [projectId]);

  // ---- Save ---------------------------------------------------------------

  const flushSave = useCallback(async () => {
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = null;
    const current = projectRef.current;
    if (!current || !dirtyRef.current) return;
    dirtyRef.current = false;
    setSave({ status: "saving" });
    try {
      const { project: saved, savedAt } = await shortsApi.saveProject(current);
      // The server owns exports and derived clip data; take only those back so the
      // user's in-progress edits are never overwritten by a stale response.
      setProject((latest) => (latest ? { ...latest, exports: saved.exports, updatedAt: savedAt } : latest));
      setSave({ status: "saved" });
    } catch (error) {
      dirtyRef.current = true;
      setSave({ status: "error", message: error instanceof Error ? error.message : "Save failed" });
    }
  }, []);

  const scheduleSave = useCallback(() => {
    dirtyRef.current = true;
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => void flushSave(), SAVE_DEBOUNCE_MS);
  }, [flushSave]);

  // Pending edits are written when the editor closes or the window is hidden.
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === "hidden") void flushSave();
    };
    document.addEventListener("visibilitychange", onHide);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      void flushSave();
    };
  }, [flushSave]);

  // ---- Edits --------------------------------------------------------------

  /** Every change goes through here so undo, redo and autosave see the same edits. */
  const edit = useCallback(
    (label: string, next: ShortsProject, mergeKey?: string) => {
      const current = projectRef.current;
      if (!current || next === current) return;
      const stamped = { ...next, updatedAt: new Date().toISOString() };
      setHistory((h) => commit(h, current, stamped, label, mergeKey));
      setProject(stamped);
      scheduleSave();
    },
    [scheduleSave],
  );

  const doUndo = useCallback(() => {
    setHistory((h) => {
      const result = undo(h);
      if (result.project && projectRef.current) {
        setProject(result.project);
        dirtyRef.current = true;
        scheduleSave();
      }
      return result.history;
    });
  }, [scheduleSave]);

  const doRedo = useCallback(() => {
    setHistory((h) => {
      const result = redo(h);
      if (result.project) {
        setProject(result.project);
        dirtyRef.current = true;
        scheduleSave();
      }
      return result.history;
    });
  }, [scheduleSave]);

  const selectedItem = useMemo(() => (project && selectedIds.length === 1 ? findItem(project, selectedIds[0]) : null), [project, selectedIds]);

  const addTimelineItem = useCallback(
    (type: TimelineItemType) => {
      const current = projectRef.current;
      if (!current) return;
      const { project: next, item } = addItem(current, type);
      edit(`Add ${type.replace("-", " ")}`, next);
      setSelectedIds([item.id]);
      setTab("item");
      setTimeMs(item.startMs);
    },
    [edit],
  );

  const patchItem = useCallback(
    (id: string, patch: Partial<TimelineItem>, label: string) => {
      const current = projectRef.current;
      if (!current) return;
      edit(label, updateItem(current, id, patch), `item-${id}-${Object.keys(patch).join(",")}`);
    },
    [edit],
  );

  const removeSelected = useCallback(() => {
    const current = projectRef.current;
    if (!current || selectedIds.length === 0) return;
    edit(selectedIds.length > 1 ? `Delete ${selectedIds.length} items` : "Delete item", deleteItems(current, selectedIds, rippleDelete));
    setSelectedIds([]);
  }, [edit, rippleDelete, selectedIds]);

  const duplicateSelected = useCallback(() => {
    const current = projectRef.current;
    if (!current || selectedIds.length !== 1) return;
    const result = duplicateItem(current, selectedIds[0]);
    edit("Duplicate item", result.project);
    if (result.copyId) setSelectedIds([result.copyId]);
  }, [edit, selectedIds]);

  const splitAtPlayhead = useCallback(() => {
    const current = projectRef.current;
    if (!current || selectedIds.length !== 1) {
      setNotice("Select a narration, title or list item to split it at the playhead.");
      return;
    }
    const result = splitItem(current, selectedIds[0], timeMs);
    if (!result.splitId) {
      setNotice(result.reason || "This item cannot be split here.");
      return;
    }
    edit("Split item", result.project);
    setSelectedIds([result.splitId]);
    setNotice(null);
  }, [edit, selectedIds, timeMs]);

  const nudgeSelection = useCallback(
    (deltaMs: number) => {
      const current = projectRef.current;
      if (!current || selectedIds.length !== 1) return;
      const item = findItem(current, selectedIds[0]);
      if (!item) return;
      edit("Nudge item", moveItem(current, item.id, item.startMs + deltaMs), `nudge-${item.id}`);
    },
    [edit, selectedIds],
  );

  // ---- Playback -----------------------------------------------------------

  const duration = project ? projectDurationMs(project) : 0;

  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const delta = now - last;
      last = now;
      setTimeMs((value) => {
        const next = value + delta;
        if (next >= duration) {
          setPlaying(false);
          return duration;
        }
        return next;
      });
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, duration]);

  // The editor preview follows the playhead. Its video only resyncs on real drift, so playback does not stutter.
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !project || project.background.type !== "video") return;
    const background = project.background;
    const target = (background.trimStartMs + timeMs * background.speed) / 1000;
    const drift = Math.abs(video.currentTime - target);
    if (!playing && drift > 0.02) video.currentTime = target;
    if (playing && drift > 0.25) video.currentTime = target;
    if (playing && video.paused) void video.play().catch(() => undefined);
    if (!playing && !video.paused) video.pause();
  }, [playing, timeMs, project]);

  // ---- Keyboard -----------------------------------------------------------

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing = target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable);
      const mod = event.metaKey || event.ctrlKey;
      if (mod && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void flushSave();
        return;
      }
      if (typing) return;
      if (mod && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) doRedo();
        else doUndo();
        return;
      }
      if (mod && event.key.toLowerCase() === "y") {
        event.preventDefault();
        doRedo();
        return;
      }
      if (mod && event.key.toLowerCase() === "k") {
        event.preventDefault();
        splitAtPlayhead();
        return;
      }
      if (mod && event.key.toLowerCase() === "d") {
        event.preventDefault();
        duplicateSelected();
        return;
      }
      if (event.key === " ") {
        event.preventDefault();
        setPlaying((value) => !value);
      } else if (event.key.toLowerCase() === "k" && !mod) {
        setPlaying(false);
      } else if (event.key.toLowerCase() === "l" && !mod) {
        setPlaying(true);
      } else if (event.key.toLowerCase() === "j" && !mod) {
        setPlaying(false);
        setTimeMs((value) => Math.max(0, value - 1000));
      } else if (event.key === "Delete" || event.key === "Backspace") {
        if (selectedIds.length) {
          event.preventDefault();
          removeSelected();
        }
      } else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault();
        const step = event.shiftKey ? 1000 : 100;
        const direction = event.key === "ArrowLeft" ? -1 : 1;
        if (selectedIds.length === 1) nudgeSelection(direction * step);
        else setTimeMs((value) => Math.max(0, Math.min(duration, value + direction * (event.shiftKey ? 1000 : 33))));
      } else if (event.key === "Escape") {
        setSelectedIds([]);
      } else if (event.key === "=" || event.key === "+") {
        setZoom((value) => Math.min(240, value + 10));
      } else if (event.key === "-") {
        setZoom((value) => Math.max(30, value - 10));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [doRedo, doUndo, duplicateSelected, duration, flushSave, nudgeSelection, removeSelected, selectedIds.length, splitAtPlayhead]);

  // ---- Preview sizing -----------------------------------------------------

  useEffect(() => {
    const element = centerRef.current;
    if (!element) return;
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0].contentRect;
      setPreviewBox({ width: Math.max(160, Math.min(rect.width - 40, (rect.height - 90) * (project ? designSizeFor(project).width / designSizeFor(project).height : 0.5625))) });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [project]);

  // ---- Jobs ---------------------------------------------------------------

  const trackJob = useCallback((next: JobSnapshot, onDone?: (done: JobSnapshot) => void) => {
    jobUnsubscribe.current?.();
    setJob(next);
    jobUnsubscribe.current = subscribeJob(
      next.id,
      (update) => {
        setJob(update);
        if (update.status === "completed" || update.status === "failed" || update.status === "cancelled") {
          jobUnsubscribe.current?.();
          jobUnsubscribe.current = null;
          onDone?.(update);
        }
      },
      (message) => setNotice(message),
    );
  }, []);

  const refreshProject = useCallback(async () => {
    const { project: latest } = await shortsApi.getProject(projectId);
    setProject((current) => (current ? { ...current, exports: latest.exports, captions: latest.captions, source: latest.source, background: latest.background, crop: latest.crop } : latest));
  }, [projectId]);

  const exportProject = useCallback(
    async (options: { resolution: 720 | 1080; fps: number; quality: "fast" | "balanced" | "high" }) => {
      await flushSave();
      setNotice(null);
      try {
        const { job: started } = await shortsApi.startRender(projectId, options);
        trackJob(started, (done) => {
          if (done.status === "completed") void refreshProject();
          if (done.status === "failed") setNotice(done.error || "Export failed");
        });
      } catch (error) {
        setNotice(error instanceof Error ? error.message : "Export could not start");
      }
    },
    [flushSave, projectId, refreshProject, trackJob],
  );

  const transcribe = useCallback(
    async (model: "tiny" | "base" | "small") => {
      await flushSave();
      setNotice(null);
      try {
        const { job: started } = await shortsApi.startTranscribe(projectId, model);
        trackJob(started, (done) => {
          if (done.status === "completed") void refreshProject();
          if (done.status === "failed") setNotice(done.error || "Transcription failed");
        });
      } catch (error) {
        setNotice(error instanceof Error ? error.message : "Transcription could not start");
      }
    },
    [flushSave, projectId, refreshProject, trackJob],
  );

  const cutExport = useCallback(
    async (options: { resolution: 720 | 1080; fps: number; quality: "fast" | "balanced" | "high"; copyStreams: boolean }) => {
      const current = projectRef.current;
      if (!current || !current.source) return;
      await flushSave();
      setNotice(null);
      // The cut range lives on the background (trim start) and the project length (duration).
      const inMs = current.background.type === "video" ? current.background.trimStartMs : 0;
      const outMs = inMs + (current.durationMs ?? Math.max(0, (current.source?.durationMs ?? 0) - inMs));
      try {
        const { job: started } = await shortsApi.startCut(projectId, {
          inMs,
          outMs,
          crop: current.crop,
          copyStreams: options.copyStreams,
          resolution: options.resolution,
          fps: options.fps,
          quality: options.quality,
          aspect: current.aspect,
        });
        trackJob(started, (done) => {
          if (done.status === "completed") void refreshProject();
          if (done.status === "failed") setNotice(done.error || "Cut failed");
        });
      } catch (error) {
        setNotice(error instanceof Error ? error.message : "Cut could not start");
      }
    },
    [flushSave, projectId, refreshProject, trackJob],
  );

  const cancelJob = useCallback(async () => {
    if (!job) return;
    try {
      await shortsApi.cancelJob(job.id);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Cancel failed");
    }
  }, [job]);

  // ---- Render -------------------------------------------------------------

  if (loadError) {
    return (
      <div className="shorts-root" style={{ padding: 40 }}>
        <p className="sh-error">This project could not be opened: {loadError}</p>
        <button type="button" className="sh-btn" onClick={onBack} style={{ marginTop: 14 }}><ArrowLeft size={15} strokeWidth={1.6} /> Back to Shorts</button>
      </div>
    );
  }
  if (!project) {
    return <div className="shorts-root sh-muted" style={{ padding: 40, fontSize: 14 }}>Opening project…</div>;
  }

  const outSize = outputSize(project.aspect, 1080);
  const isCut = project.kind === "cut-crop";
  const undoText = undoLabel(history);
  const redoText = redoLabel(history);

  return (
    <div className="shorts-root" style={{ height: "100%", display: "flex", flexDirection: "column", minHeight: 0 }}>
      <header style={{ height: 52, display: "flex", alignItems: "center", gap: 10, padding: "0 14px", borderBottom: "1px solid var(--sh-line)", background: "var(--sh-surface)", flexShrink: 0 }}>
        <button type="button" className="sh-icon-btn" onClick={() => { void flushSave(); onBack(); }} aria-label="Back to Shorts"><ArrowLeft size={17} strokeWidth={1.6} /></button>
        <input
          className="sh-input"
          aria-label="Project title"
          value={project.title}
          onChange={(event) => edit("Rename project", { ...project, title: event.target.value.slice(0, 160) }, "rename")}
          style={{ maxWidth: 320, height: 32, padding: "4px 8px", fontWeight: 600, background: "transparent", border: "1px solid transparent" }}
        />
        <span className="sh-pill">{kindLabel(project.kind)}</span>
        <span className="sh-muted" style={{ fontSize: 12 }}>{outSize.width}×{outSize.height} · {project.aspect}</span>
        <div style={{ flex: 1 }} />
        <span className="sh-muted" style={{ fontSize: 12, minWidth: 90, textAlign: "right" }} aria-live="polite">
          {save.status === "saving" ? "Saving…" : save.status === "saved" ? "Saved" : save.status === "error" ? `Not saved: ${save.message}` : ""}
        </span>
        <button type="button" className="sh-icon-btn" onClick={doUndo} disabled={!undoText} title={undoText ? `Undo ${undoText}` : "Nothing to undo"} aria-label="Undo"><Undo2 size={16} strokeWidth={1.6} /></button>
        <button type="button" className="sh-icon-btn" onClick={doRedo} disabled={!redoText} title={redoText ? `Redo ${redoText}` : "Nothing to redo"} aria-label="Redo"><Redo2 size={16} strokeWidth={1.6} /></button>
        <button type="button" className="sh-btn sh-btn--sm" onClick={() => void flushSave()} title="Save (Ctrl/Cmd+S)"><Save size={14} strokeWidth={1.6} /> Save</button>
        <button type="button" className="sh-btn sh-btn--ghost sh-btn--sm" onClick={onOpenLibrary}>Library</button>
      </header>

      <div style={{ flex: 1, minHeight: 0, display: "grid", gridTemplateColumns: "216px minmax(0,1fr) 316px", gridTemplateRows: "minmax(0,1fr) auto", gridTemplateAreas: '"left center right" "timeline timeline timeline"' }}>
        <aside style={{ gridArea: "left", borderRight: "1px solid var(--sh-line)", background: "var(--sh-surface)", overflowY: "auto", minHeight: 0 }} className="clyra-scroll">
          <LeftRail
            project={project}
            onAdd={addTimelineItem}
            onProjectPatch={(next, label) => edit(label, next)}
            onAttachVideo={async (uploadId, name) => {
              await flushSave();
              try {
                const { project: attached } = await shortsApi.attachUpload(projectId, uploadId, name);
                setProject((current) => (current ? { ...current, source: attached.source, background: attached.background } : attached));
                setNotice(null);
              } catch (error) {
                setNotice(error instanceof Error ? error.message : "The video could not be attached.");
              }
            }}
          />
        </aside>

        <main ref={centerRef} style={{ gridArea: "center", position: "relative", minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "18px 20px 10px", background: "var(--sh-bg)" }}>
          {isCut ? (
            <CutCropPanel project={project} onCropChange={(crop) => edit("Crop", { ...project, crop }, "crop")} previewWidth={previewBox.width} videoRef={videoRef} />
          ) : (
            <div style={{ borderRadius: 18, overflow: "hidden", boxShadow: "var(--sh-shadow-lift)", border: "1px solid var(--sh-line)" }}>
              <ShortsCanvas
                project={project}
                timeMs={timeMs}
                mode="preview"
                pixelWidth={Math.round(previewBox.width)}
                showSafeArea={showSafeArea}
                videoRef={videoRef}
                selectedItemId={selectedItem?.id ?? null}
              />
            </div>
          )}
          <div className="sh-row" style={{ width: Math.round(previewBox.width), marginTop: 12, gap: 10 }}>
            <button type="button" className="sh-icon-btn" style={{ width: 38, height: 38, background: "var(--sh-ink)", color: "var(--sh-bg)" }} onClick={() => setPlaying((value) => !value)} aria-label={playing ? "Pause" : "Play"}>
              {playing ? <Pause size={17} strokeWidth={1.8} /> : <Play size={17} strokeWidth={1.8} />}
            </button>
            <span style={{ fontVariantNumeric: "tabular-nums", fontSize: 13 }}>{formatClock(timeMs)} <span className="sh-muted">/ {formatClock(duration)}</span></span>
            <div style={{ flex: 1 }} />
            <div className="sh-row" style={{ gap: 8, fontSize: 12.5 }}>
              <span className="sh-muted">Safe area</span>
              <button type="button" role="switch" aria-checked={showSafeArea} aria-label="Show safe area" className="sh-switch" onClick={() => setShowSafeArea((value) => !value)} />
            </div>
          </div>
          {notice ? <div className="sh-notice" role="status" style={{ marginTop: 10, maxWidth: Math.round(previewBox.width), color: "var(--sh-danger)" }}>{notice}</div> : null}
        </main>

        <aside style={{ gridArea: "right", borderLeft: "1px solid var(--sh-line)", background: "var(--sh-surface)", overflowY: "auto", minHeight: 0 }} className="clyra-scroll">
          <Inspector
            project={project}
            tab={tab}
            onTab={setTab}
            selectedItem={selectedItem}
            timeMs={timeMs}
            onPatchItem={patchItem}
            onDeleteSelected={removeSelected}
            onDuplicate={duplicateSelected}
            onSplit={splitAtPlayhead}
            onProjectEdit={(next, label, key) => edit(label, next, key)}
            onTranscribe={transcribe}
            onExport={exportProject}
            onCutExport={cutExport}
            job={job}
            onCancelJob={cancelJob}
            rippleDelete={rippleDelete}
            onRippleChange={setRippleDelete}
            onProjectRefresh={refreshProject}
          />
        </aside>

        <section style={{ gridArea: "timeline", borderTop: "1px solid var(--sh-line)", background: "var(--sh-surface)", minHeight: 0 }}>
          <Timeline
            project={project}
            timeMs={timeMs}
            zoom={zoom}
            onZoom={setZoom}
            selectedIds={selectedIds}
            onSelect={(ids) => setSelectedIds(ids)}
            onSeek={(value) => { setPlaying(false); setTimeMs(Math.max(0, Math.min(duration, value))); }}
            onMove={(id, startMs) => {
              const current = projectRef.current;
              if (current) edit("Move item", moveItem(current, id, startMs), `move-${id}`);
            }}
            onResize={(id, durationMs) => {
              const current = projectRef.current;
              if (current) edit("Resize item", resizeItem(current, id, durationMs), `resize-${id}`);
            }}
          />
        </section>
      </div>
    </div>
  );
}


