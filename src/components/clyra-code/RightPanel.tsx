import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import Editor, { type OnMount, loader } from "@monaco-editor/react";
import * as monaco from "monaco-editor";
// Load Monaco from the local bundle instead of the CDN loader default so the
// Files editor renders in the desktop/offline shell, not only on the web.
loader.config({ monaco });
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronDown,
  Circle,
  CircleDot,
  ExternalLink,
  FileCode2,
  FilePlus2,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  Globe,
  ListChecks,
  Maximize2,
  MessageSquarePlus,
  Minimize2,
  Monitor,
  MousePointer2,
  RotateCw,
  SlidersHorizontal,
  Smartphone,
  Tablet,
  Save,
  Search,
  Pencil,
  Trash2,
  X,
  XCircle,
} from "lucide-react";
import { cn } from "../../lib/utils";
import { isElectronRuntime } from "../../lib/electron-runtime";
import { ElectronWebContentsSurface } from "../ElectronWebContentsSurface";
import { ShiningText } from "../ShiningText";
import { PreviewBuilding } from "./PreviewBuilding";
import { liveStepLabel } from "./CodexActivity";
import { describeCodeError } from "./codeErrorPresentation";
import { api, type FileDiff, type PreviewLogLine, type PreviewSession } from "./api";
import type { AgentAction, ClyraCodeState } from "./store";
import { DiffCounters } from "./AnimatedCounter";
import { computeLineDiff, linesFromPatch } from "./diff";
import { stripFilePrefix } from "./format";
import type { ComposerContext } from "./Composer";
import {
  VisualInspector,
  selectionChipLabel,
  selectionContextDetail,
  type InspectPayload,
} from "./VisualInspector";

export type RightTab = "browser" | "plan" | "changes" | "files";

/** Match Clyra Browser: anything that is not a URL is a Google search. */
export function normalizePreviewNavigation(input: string) {
  const value = input.trim();
  if (!value) return "";
  if (/^https?:\/\//i.test(value)) return value;
  if (/^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(?:[/?#].*)?$/i.test(value)) return `http://${value}`;
  if (/^(?:[\w-]+\.)+[a-z]{2,}(?::\d+)?(?:[/?#].*)?$/i.test(value)) return `https://${value}`;
  return `https://www.google.com/search?q=${encodeURIComponent(value)}`;
}

/* ------------------------------------------------------------------ */
/* Preview controller                                                  */
/* ------------------------------------------------------------------ */

export function usePreview(projectId: string | null, buildVersion: number) {
  const [session, setSession] = useState<PreviewSession | null>(null);
  const [logs, setLogs] = useState<PreviewLogLine[]>([]);
  const [frameVersion, setFrameVersion] = useState(0);
  const startedForRef = useRef<string | null>(null);

  const start = useCallback(async () => {
    if (!projectId) return;
    setSession((prev) => (prev ? { ...prev, status: "starting" } : { projectId, status: "starting" }));
    try {
      const next = await api.previewStart(projectId);
      setSession(next);
    } catch (error) {
      setSession({
        projectId,
        status: "build_failed",
        lastError: { message: error instanceof Error ? error.message : "Preview failed to start" },
      });
    }
  }, [projectId]);

  const restart = useCallback(async () => {
    if (!projectId) return;
    setSession((prev) => (prev ? { ...prev, status: "restarting" } : prev));
    try {
      setSession(await api.previewRestart(projectId));
    } catch {
      /* status poll recovers */
    }
  }, [projectId]);

  const reload = useCallback(() => setFrameVersion((v) => v + 1), []);

  useEffect(() => {
    if (!projectId) return;
    if (startedForRef.current !== projectId) {
      startedForRef.current = projectId;
      // Drop the previous project's session immediately so its preview can
      // never render against the newly selected project.
      setSession(null);
      setFrameVersion(0);
      void start();
    }
    let retryingMissingEntry = false;
    const interval = window.setInterval(async () => {
      const status = await api.previewStatus(projectId).catch(() => null);
      if (status) setSession(status);
      const lines = await api.previewLogs(projectId).catch(() => null);
      if (lines) setLogs(lines);

      // Agent often creates index.html after the first preview probe. Retry
      // start while the failure is "entry missing" so the browser comes up
      // mid-run instead of waiting for session.idle / a manual Retry click.
      const missingEntry =
        status?.status === "build_failed" &&
        /index\.html entry point/i.test(status.lastError?.message ?? "");
      if (missingEntry && !retryingMissingEntry) {
        retryingMissingEntry = true;
        try {
          const next = await api.previewStart(projectId);
          setSession(next);
          if (next.url && (next.status === "ready" || next.status === "running")) {
            setFrameVersion((v) => v + 1);
          }
        } catch {
          /* status poll retries next tick */
        } finally {
          retryingMissingEntry = false;
        }
      }
    }, 2000);
    return () => window.clearInterval(interval);
  }, [projectId, start]);

  // Reload the frame after each successful agent run so the preview always
  // reflects the latest build.
  useEffect(() => {
    if (buildVersion > 0) {
      setFrameVersion((v) => v + 1);
      if (projectId && (!session?.url || session.status === "stopped" || session.status === "build_failed")) {
        void start();
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buildVersion]);

  return { session, logs, frameVersion, start, restart, reload };
}

/* ------------------------------------------------------------------ */
/* Browser view                                                        */
function BrowserView({
  session,
  frameVersion,
  onReload,
  onRestart,
  onOpenTerminal,
  onAddContext,
  agentRunning = false,
  buildStep,
  projectId,
  inspectMode,
  onToggleInspect,
  onFrameReady,
  onPreviewError,
  fullscreen,
  onToggleFullscreen,
}: {
  session: PreviewSession | null;
  frameVersion: number;
  onReload: () => void;
  onRestart: () => void;
  onOpenTerminal?: () => void;
  onAddContext: (context: ComposerContext) => void;
  agentRunning?: boolean;
  /** What the agent is doing right now ("Editing App.tsx"), shown under the building animation. */
  buildStep?: string | null;
  projectId: string | null;
  inspectMode: boolean;
  onToggleInspect: () => void;
  onFrameReady: (win: Window | null) => void;
  onPreviewError?: (message: string) => void;
  fullscreen: boolean;
  onToggleFullscreen: () => void;
}) {
  const projectPreviewSrc = `/api/vibe/projects/${encodeURIComponent(projectId ?? "")}/preview/`;
  type PreviewTab = { id: number; url: string | null; history: string[]; index: number };
  const [previewTabs, setPreviewTabs] = useState<PreviewTab[]>([{ id: 0, url: null, history: [], index: -1 }]);
  const [activePreviewTabId, setActivePreviewTabId] = useState(0);
  const nextPreviewTabId = useRef(1);
  const currentTab = previewTabs.find((tab) => tab.id === activePreviewTabId) ?? previewTabs[0];
  const navigatedSrc = currentTab.url;
  const history = currentTab.history;
  const historyIndex = currentTab.index;
  const [address, setAddress] = useState("");
  const [frameLoaded, setFrameLoaded] = useState(false);

  const surfaceRef = useRef<HTMLDivElement | null>(null);

  // Viewport sizing (device presets + free responsive width) and zoom.
  type ViewportPreset = "desktop" | "tablet" | "mobile" | "custom";
  const [viewport, setViewport] = useState<ViewportPreset>("desktop");
  const [viewportWidth, setViewportWidth] = useState(768);
  const [zoom, setZoom] = useState<"fit" | number>("fit");
  const [zoomMenuOpen, setZoomMenuOpen] = useState(false);
  const zoomMenuRef = useRef<HTMLDivElement | null>(null);
  const [stageWidth, setStageWidth] = useState(0);

  const PRESET_WIDTH: Record<"tablet" | "mobile", number> = { tablet: 768, mobile: 390 };
  const effectiveWidth =
    viewport === "desktop" ? null : viewport === "custom" ? viewportWidth : PRESET_WIDTH[viewport];
  const zoomFactor = zoom === "fit"
    ? (effectiveWidth && stageWidth ? Math.min(1, (stageWidth - 20) / effectiveWidth) : 1)
    : zoom;

  // Toolbar collapses secondary labels when the preview pane gets narrow (e.g.
  // sidebar open + a non-maximised window), so controls never overlap or wrap.
  const compact = stageWidth > 0 && stageWidth < 480;

  useEffect(() => {
    const node = surfaceRef.current;
    if (!node) return;
    const update = () => setStageWidth(node.clientWidth);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  // Dismiss the zoom menu on outside press / Escape.
  useEffect(() => {
    if (!zoomMenuOpen) return;
    const onDown = (event: PointerEvent) => {
      if (zoomMenuRef.current?.contains(event.target as Node)) return;
      setZoomMenuOpen(false);
    };
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setZoomMenuOpen(false); };
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [zoomMenuOpen]);

  const onResizeStart = useCallback(
    (event: React.PointerEvent) => {
      event.preventDefault();
      const startX = event.clientX;
      const startWidth = effectiveWidth ?? viewportWidth;
      const move = (moveEvent: PointerEvent) => {
        const upper = Math.max(240, (stageWidth || 800) - 8);
        const next = Math.round(Math.min(upper, Math.max(240, startWidth + (moveEvent.clientX - startX))));
        setViewportWidth(next);
        setViewport("custom");
      };
      const up = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    },
    [effectiveWidth, stageWidth, viewportWidth],
  );

  const url = session?.url ?? "";
  const activeSrc = navigatedSrc ?? projectPreviewSrc;
  const displayAddress = address || (navigatedSrc ?? url).replace(/^https?:\/\//, "").replace(/\/$/, "");
  const ready = Boolean(url) && (session?.status === "ready" || session?.status === "running");
  const starting =
    session?.status === "starting" ||
    session?.status === "installing" ||
    session?.status === "compiling" ||
    session?.status === "restarting" ||
    session?.status === "refreshing";
  const missingEntry =
    /index\.html|entry point|not yet created/i.test(String(session?.lastError?.message || ""));
  const failed =
    !missingEntry &&
    (session?.status === "build_failed" ||
      session?.status === "server_crashed" ||
      session?.status === "runtime_error");
  const previewError = describeCodeError(session?.lastError?.message || session?.status || "Preview failed");

  useEffect(() => {
    if (failed && session?.lastError?.message) onPreviewError?.(session.lastError.message);
  }, [failed, onPreviewError, session?.lastError?.message]);

  /* The frame is unmounted while a run is in flight, so when the run ends it
     has to come back pointed at the finished files. Reloading on the falling
     edge of agentRunning is the one signal this component can always see —
     without it the preview keeps showing whatever existed when it last
     mounted, which reads as "the agent built nothing". */
  // Keep the existing animated building screen until the actual project frame
  // has loaded, not just until the dev server reports its port is ready.
  useEffect(() => { setFrameLoaded(false); }, [projectId, frameVersion, activePreviewTabId, navigatedSrc]);
  const waitingForFirstFrame = ready && !isElectronRuntime() && !frameLoaded;
  const previewLoading = !failed && !navigatedSrc && Boolean(projectId) &&
    (starting || (agentRunning && !ready) || waitingForFirstFrame || !session);

  const wasAgentRunning = useRef(agentRunning);
  useEffect(() => {
    if (wasAgentRunning.current && !agentRunning) {
      const timer = window.setTimeout(() => onReload(), 400);
      wasAgentRunning.current = agentRunning;
      return () => window.clearTimeout(timer);
    }
    wasAgentRunning.current = agentRunning;
  }, [agentRunning, onReload]);

  useEffect(() => {
    // A different coding project starts with a clean, project-owned preview.
    setPreviewTabs([{ id: 0, url: null, history: [], index: -1 }]);
    setActivePreviewTabId(0);
    nextPreviewTabId.current = 1;
    setAddress("");
  }, [projectId]);

  useEffect(() => {
    setAddress(navigatedSrc ?? "");
  }, [activePreviewTabId, navigatedSrc]);

  const updateCurrentTab = useCallback((update: (tab: PreviewTab) => PreviewTab) => {
    setPreviewTabs((tabs) => tabs.map((tab) => tab.id === activePreviewTabId ? update(tab) : tab));
  }, [activePreviewTabId]);

  const navigate = useCallback((raw: string) => {
    const target = normalizePreviewNavigation(raw);
    if (!target) return;
    updateCurrentTab((tab) => {
      const history = [...tab.history.slice(0, tab.index + 1), target];
      return { ...tab, url: target, history, index: history.length - 1 };
    });
    setAddress(target);
  }, [updateCurrentTab]);

  const navigateHistory = useCallback((index: number) => {
    const target = history[index];
    if (!target) return;
    updateCurrentTab((tab) => ({ ...tab, index, url: target }));
    setAddress(target);
  }, [history, updateCurrentTab]);

  const returnToPreview = useCallback(() => {
    updateCurrentTab((tab) => ({ ...tab, url: null }));
    setAddress("");
  }, [updateCurrentTab]);

  const addPreviewTab = useCallback(() => {
    const id = nextPreviewTabId.current++;
    setPreviewTabs((tabs) => [...tabs, { id, url: null, history: [], index: -1 }]);
    setActivePreviewTabId(id);
    setAddress("");
  }, []);

  const closePreviewTab = useCallback((id: number) => {
    if (previewTabs.length <= 1) return;
    const index = previewTabs.findIndex((tab) => tab.id === id);
    const remaining = previewTabs.filter((tab) => tab.id !== id);
    setPreviewTabs(remaining);
    if (id === activePreviewTabId) setActivePreviewTabId(remaining[Math.min(index, remaining.length - 1)].id);
  }, [activePreviewTabId, previewTabs]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-[35px] min-w-0 shrink-0 items-center gap-1 border-b border-[color:var(--border-subtle)] px-2">
        <div className="cc-scroll flex min-w-0 flex-1 items-center gap-1 overflow-x-auto [scrollbar-width:none]" role="tablist" aria-label="Live preview browser tabs">
          {previewTabs.map((item, index) => {
            const active = item.id === activePreviewTabId;
            const label = item.url ? (() => { try { return new URL(item.url).hostname; } catch { return "Website"; } })() : index === 0 ? "Live preview" : "Preview " + (index + 1);
            return <div key={item.id} className={cn("group flex h-[27px] min-w-[95px] max-w-[185px] shrink-0 items-center rounded-[7px] px-2 text-[11.5px] transition-colors", active ? "bg-black/[0.055] text-[#2D3035]" : "text-[#777B81] hover:bg-black/[0.035]")}>
              <button type="button" role="tab" aria-selected={active} onClick={() => setActivePreviewTabId(item.id)} className="flex min-w-0 flex-1 items-center gap-1.5 text-left">
                <Globe className="h-[12px] w-[12px] shrink-0" strokeWidth={1.65} /><span className="truncate">{label}</span>
              </button>
              {previewTabs.length > 1 ? <button type="button" aria-label={"Close " + label + " tab"} title="Close tab" onClick={() => closePreviewTab(item.id)} className="ml-1 shrink-0 rounded p-0.5 opacity-50 hover:bg-black/[0.065] hover:opacity-100"><X className="h-[11px] w-[11px]" /></button> : null}
            </div>;
          })}
        </div>
        <button type="button" aria-label="New preview tab" title="New preview tab" onClick={addPreviewTab} className="flex h-[25px] w-[25px] shrink-0 items-center justify-center rounded-[6px] text-[#6A6D73] hover:bg-black/[0.05]"><FilePlus2 className="h-[13px] w-[13px]" strokeWidth={1.7} /></button>
      </div>
      <div className="flex h-[40px] items-center gap-0.5 border-b border-[color:var(--border-subtle)] px-2.5">
        <button
          type="button"
          aria-label="Back"
          disabled={historyIndex <= 0}
          onClick={() => navigateHistory(historyIndex - 1)}
          className="rounded-[7px] p-1.5 text-[#93959A] transition-colors hover:bg-[color:var(--surface-hover)] disabled:text-[color:var(--text-disabled)]"
        >
          <ArrowLeft className="h-[13px] w-[13px]" strokeWidth={1.8} />
        </button>
        <button
          type="button"
          aria-label="Forward"
          disabled={historyIndex >= history.length - 1}
          onClick={() => navigateHistory(historyIndex + 1)}
          className="rounded-[7px] p-1.5 text-[#93959A] transition-colors hover:bg-[color:var(--surface-hover)] disabled:text-[color:var(--text-disabled)]"
        >
          <ArrowRight className="h-[13px] w-[13px]" strokeWidth={1.8} />
        </button>
        <button
          type="button"
          aria-label="Reload"
          onClick={onReload}
          className="rounded-[7px] p-1.5 text-[#93959A] transition-colors hover:bg-[color:var(--surface-hover)]"
        >
          <RotateCw className="h-[13px] w-[13px]" strokeWidth={1.8} />
        </button>
        <form
          className="mx-2 flex h-[28px] min-w-0 flex-1 items-center rounded-[8px] bg-black/[0.025] px-3 focus-within:bg-white focus-within:ring-1 focus-within:ring-[#3977F6]/25"
          onSubmit={(event) => { event.preventDefault(); navigate(address || displayAddress); }}
        >
          <input
            value={address}
            onChange={(event) => setAddress(event.target.value)}
            placeholder={starting ? "Starting development server…" : displayAddress || "Search Google or enter an address"}
            aria-label="Preview address or Google search"
            spellCheck={false}
            autoComplete="off"
            className="cc-mono h-full min-w-0 flex-1 bg-transparent text-[11.5px] text-[color:var(--text-secondary)] outline-none placeholder:text-[color:var(--text-tertiary)]"
          />
        </form>
        {navigatedSrc ? (
          <button
            type="button"
            aria-label="Return to live preview"
            title="Return to live preview"
            onClick={returnToPreview}
            className="rounded-[7px] px-2 py-1 text-[10.5px] font-medium text-[color:var(--text-secondary)] transition-colors hover:bg-[color:var(--surface-hover)]"
          >
            Preview
          </button>
        ) : null}
        {ready ? (
          <button
            type="button"
            aria-label="Open project on development server"
            title="Open project on development server"
            onClick={() => window.open(url, "_blank", "noopener")}
            className={cn(
              "flex h-7 items-center rounded-[7px] text-[10.5px] font-medium text-[color:var(--text-secondary)] transition-colors hover:bg-[color:var(--surface-hover)]",
              compact ? "px-1.5" : "gap-1 px-2",
            )}
          >
            <ExternalLink className="h-[12px] w-[12px]" strokeWidth={1.8} />
            {!compact ? "Dev server" : null}
          </button>
        ) : null}
        {activeSrc ? (
          <button
            type="button"
            aria-label="Open externally"
            onClick={() => window.open(activeSrc, "_blank", "noopener")}
            className="rounded-[7px] p-1.5 text-[color:var(--text-secondary)] transition-colors hover:bg-[color:var(--surface-hover)]"
          >
            <ExternalLink className="h-[14px] w-[14px]" strokeWidth={1.8} />
          </button>
        ) : null}
        <div className="ml-1 flex h-7 shrink-0 items-center rounded-[8px] bg-[color:var(--surface-muted)] p-0.5">
          {([["desktop", Monitor, "Desktop"], ["tablet", Tablet, "Tablet"], ["mobile", Smartphone, "Mobile"]] as const).map(([id, Icon, label]) => (
            <button
              key={id}
              type="button"
              aria-label={`${label} viewport`}
              title={label}
              onClick={() => setViewport(id)}
              className={cn(
                "flex h-6 w-6 items-center justify-center rounded-[6px] transition-colors",
                viewport === id ? "bg-white text-[#1E6FFF] shadow-[0_1px_2px_rgba(0,0,0,0.1)]" : "text-[#93959A] hover:text-[#5F6368]",
              )}
            >
              <Icon className="h-[13px] w-[13px]" strokeWidth={1.8} />
            </button>
          ))}
        </div>
        <div ref={zoomMenuRef} className="relative shrink-0">
          <button
            type="button"
            aria-label="Zoom"
            title="Zoom"
            onClick={() => setZoomMenuOpen((open) => !open)}
            className="flex h-7 items-center gap-0.5 rounded-[7px] px-1.5 text-[11px] font-medium text-[#5F6368] transition-colors hover:bg-[color:var(--surface-hover)]"
          >
            {zoom === "fit" ? "Fit" : `${Math.round(zoom * 100)}%`}
            <ChevronDown className="h-[11px] w-[11px]" strokeWidth={1.8} />
          </button>
          {zoomMenuOpen ? (
            <div className="absolute right-0 top-[calc(100%+6px)] z-40 w-[118px] rounded-[10px] border border-[color:var(--border-subtle)] bg-white p-1 shadow-[0_10px_28px_rgba(15,23,42,0.13)]">
              {([["fit", "Fit"], [1, "100%"], [0.75, "75%"], [0.5, "50%"]] as const).map(([value, label]) => (
                <button
                  key={String(value)}
                  type="button"
                  onClick={() => { setZoom(value); setZoomMenuOpen(false); }}
                  className={cn(
                    "flex h-7 w-full items-center justify-between rounded-[6px] px-2 text-[11.5px] transition-colors",
                    zoom === value ? "bg-[color:var(--surface-selected)] font-medium text-[#1E6FFF]" : "text-[#5F6368] hover:bg-[color:var(--surface-hover)]",
                  )}
                >
                  {label}
                  {zoom === value ? <Check className="h-[12px] w-[12px]" strokeWidth={2} /> : null}
                </button>
              ))}
            </div>
          ) : null}
        </div>
        <button
          type="button"
          aria-label={fullscreen ? "Exit full screen preview" : "Full screen preview"}
          title={fullscreen ? "Exit full screen" : "Full screen"}
          onClick={onToggleFullscreen}
          className="rounded-[7px] p-1.5 text-[color:var(--text-secondary)] transition-colors hover:bg-[color:var(--surface-hover)]"
        >
          {fullscreen ? <Minimize2 className="h-[14px] w-[14px]" strokeWidth={1.8} /> : <Maximize2 className="h-[14px] w-[14px]" strokeWidth={1.8} />}
        </button>
        <button
          type="button"
          onClick={onToggleInspect}
          aria-label={inspectMode ? "Exit edit mode" : "Edit"}
          title={inspectMode ? "Exit edit mode" : "Edit"}
          className={cn(
            "flex h-7 items-center rounded-[8px] text-[11.5px] transition-colors",
            compact ? "ml-0.5 gap-0 px-2" : "ml-0.5 gap-1.5 px-2.5",
            inspectMode
              ? "bg-[#E8F0FE] font-medium text-[#1E6FFF]"
              : "font-medium text-[color:var(--text-secondary)] hover:bg-[color:var(--surface-hover)]",
          )}
        >
          <Pencil className={cn(compact ? "h-[13.5px] w-[13.5px]" : "h-[12.5px] w-[12.5px]")} strokeWidth={1.8} />
          {compact ? null : (inspectMode ? "Editing" : "Edit")}
        </button>
      </div>

      <div ref={surfaceRef} className="relative min-h-0 flex-1 bg-[#F7F7F6]">
        <div className="cc-scroll absolute inset-0 overflow-auto">
          {(ready || navigatedSrc) ? (
            <div
              className={cn("relative", effectiveWidth ? "mx-auto" : "h-full w-full")}
              style={{
                width: effectiveWidth ? `${effectiveWidth}px` : "100%",
                height: "100%",
                transform: zoomFactor !== 1 ? `scale(${zoomFactor})` : undefined,
                transformOrigin: "top center",
              }}
            >
              {isElectronRuntime() ? (
                <ElectronWebContentsSurface
                  key={`${projectId}:${activePreviewTabId}:${frameVersion}:${activeSrc}`}
                  source={activeSrc}
                  title={navigatedSrc ? "Vibe browser" : "Live preview"}
                  surfaceId="clyra-code-live-preview"
                  kind="preview"
                  className="h-full w-full"
                />
              ) : (
                <iframe
                  key={`${projectId}:${activePreviewTabId}:${frameVersion}:${activeSrc}`}
                  // Keep the trailing slash so the preview behaves as a directory:
                  // relative JS/CSS assets and the injected inspect bridge resolve
                  // inside this project's proxied namespace.
                  src={activeSrc}
                  title={navigatedSrc ? "Vibe browser" : "Live preview"}
                  className="h-full w-full border-0 bg-white"
                  sandbox="allow-forms allow-modals allow-popups allow-same-origin allow-scripts"
                  onLoad={(event) => {
                    const win = event.currentTarget.contentWindow;
                    onFrameReady(win);
                    setFrameLoaded(true);
                    if (!navigatedSrc) win?.postMessage({ type: "clyra:mode", mode: inspectMode }, "*");
                  }}
                />
              )}
              {effectiveWidth ? (
                <button
                  type="button"
                  aria-label="Resize preview width"
                  title="Drag to resize preview width"
                  onPointerDown={onResizeStart}
                  className="absolute -right-[9px] top-0 z-20 h-full w-[18px] cursor-ew-resize"
                >
                  <span className="absolute left-1/2 top-1/2 h-[44px] w-[3px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-black/[0.12] transition-colors hover:bg-[#1E6FFF]" />
                </button>
              ) : null}
            </div>
          ) : failed ? (
            <div className="flex h-full flex-col items-center justify-center gap-2.5 bg-[#FAFAF9] px-6 text-center" role="alert">
              <XCircle className="mb-1 h-6 w-6 text-[#B45454]" strokeWidth={1.5} />
              <p className="text-[14px] font-medium text-[#25272B]">{previewError.title}</p>
              <p className="max-w-[390px] text-[12px] leading-[1.55] text-[#75777D]">{previewError.detail}</p>
              <p className="max-w-[390px] text-[11.5px] leading-[1.5] text-[#85878C]">{previewError.nextStep}</p>
              {session?.lastError?.message ? <details className="max-w-[440px] text-left">
                <summary className="cursor-pointer text-[11px] text-[#6A6D72] hover:underline">Technical details</summary>
                <pre className="cc-scroll mt-2 max-h-[120px] overflow-auto whitespace-pre-wrap break-all rounded-[8px] bg-black/[0.035] p-2 text-[10.5px] text-[#62656B]">{session.lastError.message}</pre>
              </details> : null}
              <div className="mt-1 flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={onRestart}
                  className="h-7 rounded-[7px] border border-[#EEEEEC] px-2.5 text-[11.5px] text-[#171717] transition-colors hover:bg-[#F6F6F5]"
                >
                  Retry
                </button>
                <button
                  type="button"
                  onClick={onOpenTerminal}
                  className="h-7 rounded-[7px] px-2.5 text-[11.5px] text-[#5F6368] transition-colors hover:bg-[#F6F6F5]"
                >
                  View logs
                </button>
              </div>
            </div>
          ) : (!starting && !agentRunning) ? (
            <div className="relative flex h-full flex-col items-center justify-center overflow-hidden bg-[#F7F7F6]">
              <div className="relative z-[1] flex max-w-[300px] flex-col items-center px-5 text-center">
                <Globe className="mb-2.5 h-6 w-6 text-[#B7B9BD]" strokeWidth={1.4} />
                <h3 className="text-[13px] font-medium tracking-[-0.015em] text-[#3D3F43]">
                  Preview will appear here
                </h3>
                <p className="mt-1 text-[11.5px] leading-[1.45] text-[#94969A]">
                  Describe what to create in the chat. The live preview opens here once files are ready.
                </p>
              </div>
            </div>
          ) : null}
        </div>

        <AnimatePresence>
          {previewLoading ? (
            <motion.div
              key="preview-loading"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.36, ease: [0.22, 1, 0.36, 1] }}
              className="absolute inset-0 z-10"
            >
              <PreviewBuilding phase={starting ? "starting" : "building"} step={buildStep} />
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Changes view                                                        */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/* Plan view — the session's real, current todowrite() checklist       */
/* ------------------------------------------------------------------ */

type PlanTodo = { content: string; status: string; priority: string };

function PlanView({ plan }: { plan: PlanTodo[] | null }) {
  if (!plan || !plan.length) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center">
        <p className="text-[12.5px] text-[color:var(--text-tertiary)]">No plan for this task yet.</p>
      </div>
    );
  }
  const done = plan.filter((todo) => todo.status === "completed").length;
  return (
    <div className="cc-scroll min-h-0 flex-1 overflow-y-auto py-2">
      <div className="flex items-center justify-between px-3.5 py-1.5">
        <span className="text-[11px] font-medium text-[color:var(--text-tertiary)]">
          {done} of {plan.length} done
        </span>
      </div>
      <ul className="flex flex-col">
        {plan.map((todo, index) => (
          <li
            key={index}
            className={cn(
              "flex items-start gap-2 px-3.5 py-[7px] text-[12px] leading-[1.45]",
              todo.status === "in_progress" && "bg-[color:var(--surface-selected)]",
            )}
          >
            <span className="mt-[1.5px] shrink-0">
              {todo.status === "completed" ? (
                <CheckCircle2 className="h-[14px] w-[14px] text-[#2E9A5A]" strokeWidth={1.8} />
              ) : todo.status === "in_progress" ? (
                <CircleDot className="h-[14px] w-[14px] text-[#3977F6]" strokeWidth={1.8} />
              ) : todo.status === "cancelled" ? (
                <XCircle className="h-[14px] w-[14px] text-[color:var(--text-disabled)]" strokeWidth={1.8} />
              ) : (
                <Circle className="h-[14px] w-[14px] text-[color:var(--text-disabled)]" strokeWidth={1.8} />
              )}
            </span>
            <span
              className={cn(
                "min-w-0 flex-1",
                todo.status === "completed" && "text-[color:var(--text-tertiary)] line-through decoration-[color:var(--text-disabled)]",
                todo.status === "cancelled" && "text-[color:var(--text-disabled)] line-through",
                (todo.status === "pending" || todo.status === "in_progress") && "text-[color:var(--text-secondary)]",
              )}
            >
              {todo.content}
            </span>
            {todo.priority === "high" && todo.status !== "completed" && todo.status !== "cancelled" ? (
              <span className="mt-[2px] h-[5px] w-[5px] shrink-0 rounded-full bg-[#D9822B]" title="High priority" />
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

function ChangesView({
  diffs,
  actions,
  focusFile,
}: {
  diffs: FileDiff[];
  actions: AgentAction[];
  focusFile: string | null;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const activeFile = focusFile ?? selected ?? (diffs[0] ? stripFilePrefix(diffs[0].file) : null);
  const activeDiff = diffs.find((d) => stripFilePrefix(d.file) === activeFile) ?? null;
  const lines = useMemo(() => {
    if (!activeDiff) return [];
    if (activeDiff.before || activeDiff.after) {
      return computeLineDiff(activeDiff.before ?? "", activeDiff.after ?? "");
    }
    const patch = [...actions]
      .reverse()
      .find((a) => a.target === activeFile && a.patch)?.patch;
    return patch ? linesFromPatch(patch) : [];
  }, [activeDiff, actions, activeFile]);

  if (!diffs.length) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center">
        <p className="text-[12.5px] text-[color:var(--text-tertiary)]">No changes yet.</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1">
      <div className="cc-scroll w-[220px] shrink-0 overflow-y-auto border-r border-[color:var(--border-subtle)] py-2">
        {diffs.map((diff) => {
          const path = stripFilePrefix(diff.file);
          const active = path === activeFile;
          return (
            <button
              key={diff.file}
              type="button"
              onClick={() => setSelected(path)}
              title={path}
              className={cn(
                "grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-1.5 px-3 py-[5px] text-left transition-colors",
                active ? "bg-[color:var(--surface-selected)]" : "hover:bg-[color:var(--surface-hover)]",
              )}
            >
              <span className="cc-mono truncate text-[11px] text-[color:var(--text-secondary)]">
                {path.split("/").pop()}
              </span>
              <DiffCounters additions={diff.additions} deletions={diff.deletions} className="text-[10.5px]" />
            </button>
          );
        })}
      </div>
      <div className="cc-scroll min-h-0 flex-1 overflow-auto">
        {activeDiff ? (
          <>
            <div className="sticky top-0 flex items-center gap-2 border-b border-[color:var(--border-subtle)] bg-white/95 px-4 py-2 backdrop-blur">
              <span className="cc-mono truncate text-[11.5px] text-[color:var(--text-secondary)]">
                {stripFilePrefix(activeDiff.file)}
              </span>
              <DiffCounters
                additions={activeDiff.additions}
                deletions={activeDiff.deletions}
                className="ml-auto"
              />
            </div>
            <table className="w-full border-collapse">
              <tbody>
                {lines.map((line, index) => (
                  <tr
                    key={index}
                    className={cn(
                      line.kind === "add" && "bg-[rgba(46,160,90,0.085)]",
                      line.kind === "del" && "bg-[rgba(195,73,73,0.075)]",
                    )}
                  >
                    <td className="cc-mono w-10 select-none px-2 text-right align-top text-[10px] leading-[1.7] text-[color:var(--text-disabled)]">
                      {line.beforeLine ?? ""}
                    </td>
                    <td className="cc-mono w-10 select-none px-2 text-right align-top text-[10px] leading-[1.7] text-[color:var(--text-disabled)]">
                      {line.afterLine ?? ""}
                    </td>
                    <td
                      className={cn(
                        "cc-mono whitespace-pre-wrap px-2 text-[11.5px] leading-[1.7]",
                        line.kind === "add" && "text-[#1c6b3d]",
                        line.kind === "del" && "text-[#a53c3c]",
                        line.kind === "context" && "text-[color:var(--text-secondary)]",
                      )}
                    >
                      {line.kind === "add" ? "+ " : line.kind === "del" ? "− " : "  "}
                      {line.text}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        ) : null}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Files view                                                          */
/* ------------------------------------------------------------------ */

type WorkspaceFile = { path: string; content: string };
type FileTreeNode = { name: string; path: string; children: Map<string, FileTreeNode>; file?: WorkspaceFile };

function fileLanguage(filePath: string) {
  const extension = filePath.split(".").pop()?.toLowerCase();
  return ({ ts: "typescript", tsx: "typescript", js: "javascript", jsx: "javascript", json: "json", css: "css", html: "html", md: "markdown", yml: "yaml", yaml: "yaml", sh: "shell", zsh: "shell" } as Record<string, string>)[extension ?? ""] ?? "plaintext";
}

function buildFileTree(files: WorkspaceFile[]) {
  const root: FileTreeNode = { name: "", path: "", children: new Map() };
  for (const file of files) {
    let node = root;
    const segments = file.path.split("/").filter(Boolean);
    segments.forEach((segment, index) => {
      const nextPath = node.path ? `${node.path}/${segment}` : segment;
      let next = node.children.get(segment);
      if (!next) {
        next = { name: segment, path: nextPath, children: new Map() };
        node.children.set(segment, next);
      }
      if (index === segments.length - 1) next.file = file;
      node = next;
    });
  }
  return root;
}

function shouldShowWorkspaceFile(path: string) {
  // Hide Clyra/OpenCode instruction and private runtime files from the
  // user-facing Files explorer. Keep them on disk for the agent harness.
  const normalized = path.replace(/\\/g, "/").replace(/^\.\//, "");
  const segments = normalized.split("/");
  if (segments.some((segment) => [".git", ".agent", ".agents", ".clyra", ".opencode", "node_modules"].includes(segment))) return false;
  if (segments.some((segment) => /^(?:AGENTS|CLAUDE|SOUL|SYSTEM_PROMPT)\.md$/i.test(segment))) return false;
  return true;
}

function FilesView({ projectId, diffs }: { projectId: string | null; diffs: FileDiff[] }) {
  const [files, setFiles] = useState<WorkspaceFile[]>([]);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [openFiles, setOpenFiles] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(() => new Set());

  const refresh = useCallback(async () => {
    if (!projectId) { setFiles([]); return; }
    const data = await api.getProject(projectId).catch(() => null);
    const next = (data?.files ?? []).filter((file) => shouldShowWorkspaceFile(file.path));
    setFiles(next);
    setSelected((current) => current && next.some((file) => file.path === current) ? current : next[0]?.path ?? null);
  }, [projectId]);

  useEffect(() => { void refresh(); }, [refresh, diffs.length]);

  const changed = useMemo(() => new Set(diffs.map((d) => stripFilePrefix(d.file))), [diffs]);
  const tree = useMemo(() => buildFileTree(files), [files]);
  const selectedFile = files.find((file) => file.path === selected) ?? null;

  useEffect(() => {
    if (!selectedFile) { setDraft(""); return; }
    setDraft(selectedFile.content);
    setOpenFiles((current) => current.includes(selectedFile.path) ? current : [...current, selectedFile.path]);
  }, [selectedFile?.path]);

  const selectFile = useCallback((filePath: string) => setSelected(filePath), []);
  const save = useCallback(async () => {
    if (!projectId || !selected) return;
    setSaving(true);
    try {
      const result = await api.writeProjectFile(projectId, selected, draft);
      setFiles(result.files.filter((file) => shouldShowWorkspaceFile(file.path)));
    } finally { setSaving(false); }
  }, [draft, projectId, selected]);

  const createFile = useCallback(async () => {
    if (!projectId) return;
    const requested = window.prompt("New file path", "src/Untitled.ts");
    if (!requested?.trim()) return;
    const result = await api.writeProjectFile(projectId, requested.trim(), "");
    setFiles(result.files.filter((file) => shouldShowWorkspaceFile(file.path)));
    setSelected(requested.trim());
  }, [projectId]);

  const createFolder = useCallback(async () => {
    if (!projectId) return;
    const requested = window.prompt("New folder path", "src/components");
    if (!requested?.trim()) return;
    await api.createProjectFolder(projectId, requested.trim());
    await refresh();
  }, [projectId, refresh]);

  const removeSelected = useCallback(async () => {
    if (!projectId || !selected || !window.confirm(`Remove ${selected}?`)) return;
    await api.deleteProjectFile(projectId, selected);
    setOpenFiles((current) => current.filter((path) => path !== selected));
    setSelected(null);
    await refresh();
  }, [projectId, refresh, selected]);

  const renamePath = useCallback(async (path: string) => {
    if (!projectId) return;
    const nextPath = window.prompt("Rename path", path)?.trim();
    if (!nextPath || nextPath === path) return;
    const result = await api.moveProjectPath(projectId, path, nextPath);
    const visibleFiles = result.files.filter((file) => shouldShowWorkspaceFile(file.path));
    setFiles(visibleFiles);
    setSelected((current) => current === path ? nextPath : current);
    setOpenFiles((current) => current.map((item) => item === path ? nextPath : item));
  }, [projectId]);

  const removePath = useCallback(async (path: string, folder = false) => {
    if (!projectId || !window.confirm(`Remove ${folder ? "folder" : "file"} ${path}?`)) return;
    await api.deleteProjectFile(projectId, path, folder);
    setOpenFiles((current) => current.filter((item) => item !== path && !item.startsWith(`${path}/`)));
    setSelected((current) => current === path || current?.startsWith(`${path}/`) ? null : current);
    await refresh();
  }, [projectId, refresh]);

  const handleEditorMount: OnMount = useCallback((editor, monaco) => {
    // Monaco normally shows an empty widget for a brand-new file until it has
    // language-server data. Keep one quiet, useful local completion source
    // available so the editor behaves like an IDE from the first key.
    const disposable = monaco.languages.registerCompletionItemProvider("*", {
      triggerCharacters: [".", "<", "@", "(", "[", "\"", "'"],
      provideCompletionItems: (model, position) => {
        const range = model.getWordUntilPosition(position);
        const editRange = {
          startLineNumber: position.lineNumber,
          endLineNumber: position.lineNumber,
          startColumn: range.startColumn,
          endColumn: range.endColumn,
        };
        const language = model.getLanguageId();
        const entries = language === "typescript" || language === "javascript"
          ? ["const", "function", "return", "useState", "useEffect", "async", "export default"]
          : ["class", "function", "return", "import", "const", "let", "if", "for"];
        return { suggestions: entries.map((label) => ({
          label,
          kind: monaco.languages.CompletionItemKind.Keyword,
          insertText: label,
          range: editRange,
          detail: "Clyra code suggestion",
          sortText: `0-${label}`,
        })) };
      },
    });
    // Deliberately suggest after any source change: compact Monaco suggestions
    // make a single typed character useful without changing the editor model.
    editor.onDidChangeModelContent(() => {
      // Trigger after every typed character. The provider above always offers
      // context-safe basics, so users never get an empty IDE-style popup.
      window.setTimeout(() => {
        if (editor.hasTextFocus()) editor.trigger("clyra", "editor.action.triggerSuggest", {});
      }, 36);
    });
    requestAnimationFrame(() => editor.trigger("clyra", "editor.action.triggerSuggest", {}));
    editor.onDidDispose(() => disposable.dispose());
  }, []);

  const renderNode = (node: FileTreeNode, depth = 0): React.ReactNode[] => {
    const children = [...node.children.values()].sort((a, b) => Number(Boolean(a.file)) - Number(Boolean(b.file)) || a.name.localeCompare(b.name));
    return children.flatMap((child) => {
      if (child.file) {
        if (query && !child.path.toLowerCase().includes(query.toLowerCase())) return [];
        return <div key={child.path} style={{ paddingLeft: 12 + depth * 14 }} className={cn("group flex h-[26px] items-center pr-1.5", selected === child.path ? "bg-black/[0.045]" : "hover:bg-black/[0.03]")}><button type="button" onClick={() => selectFile(child.path)} title={child.path} className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 text-left"><FileCode2 className="h-[12px] w-[12px] shrink-0 text-[#85878C]" strokeWidth={1.55} /><span className="truncate text-[11.5px] text-[#5C5F64]">{child.name}</span>{changed.has(child.path) ? <span className="ml-auto h-1 w-1 shrink-0 rounded-full bg-[#3977F6]" /> : null}</button><button type="button" onClick={(event) => { event.stopPropagation(); void renamePath(child.path); }} title={`Rename ${child.name}`} className="invisible ml-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-[5px] text-[#7D8086] opacity-0 transition-[opacity,background-color] duration-100 hover:bg-black/[0.05] group-hover:visible group-hover:opacity-100"><Pencil className="h-[11px] w-[11px]" strokeWidth={1.6} /></button><button type="button" onClick={(event) => { event.stopPropagation(); void removePath(child.path); }} title={`Remove ${child.name}`} className="invisible ml-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-[5px] text-[#8A6262] opacity-0 transition-[opacity,background-color] duration-100 hover:bg-[#C24949]/[0.08] group-hover:visible group-hover:opacity-100"><Trash2 className="h-[11px] w-[11px]" strokeWidth={1.6} /></button></div>;
      }
      const hidden = collapsedFolders.has(child.path);
      const descendants = renderNode(child, depth + 1);
      if (query && descendants.length === 0) return [];
      return [<div key={`${child.path}-folder`} style={{ paddingLeft: 11 + depth * 14 }} className="group flex h-[27px] items-center pr-1.5 text-[11.75px] font-medium text-[#55585D] transition-colors hover:bg-black/[0.03]"><button type="button" onClick={() => setCollapsedFolders((current) => { const next = new Set(current); if (next.has(child.path)) next.delete(child.path); else next.add(child.path); return next; })} className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 text-left"><ChevronDown className={cn("h-[11px] w-[11px] shrink-0 transition-transform duration-150", hidden && "-rotate-90")} strokeWidth={1.65} />{hidden ? <Folder className="h-[13px] w-[13px] text-[#777A80]" strokeWidth={1.5} /> : <FolderOpen className="h-[13px] w-[13px] text-[#777A80]" strokeWidth={1.5} />}<span className="truncate">{child.name}</span></button><button type="button" onClick={(event) => { event.stopPropagation(); void renamePath(child.path); }} title={`Rename ${child.name}`} className="invisible ml-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-[5px] text-[#7D8086] opacity-0 transition-[opacity,background-color] duration-100 hover:bg-black/[0.05] group-hover:visible group-hover:opacity-100"><Pencil className="h-[11px] w-[11px]" strokeWidth={1.6} /></button><button type="button" onClick={(event) => { event.stopPropagation(); void removePath(child.path, true); }} title={`Remove ${child.name}`} className="invisible ml-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-[5px] text-[#8A6262] opacity-0 transition-[opacity,background-color] duration-100 hover:bg-[#C24949]/[0.08] group-hover:visible group-hover:opacity-100"><Trash2 className="h-[11px] w-[11px]" strokeWidth={1.6} /></button></div>, ...(hidden ? [] : descendants)];
    });
  };

  return (
    <div className="flex min-h-0 flex-1 bg-white">
      <div className="flex w-[218px] shrink-0 flex-col border-r border-black/[0.06]">
        <div className="flex h-[42px] items-center gap-1.5 border-b border-black/[0.06] px-2.5">
          <div className="flex min-w-0 flex-1 items-center gap-1.5 rounded-[7px] bg-black/[0.025] px-2 py-1.5 focus-within:bg-black/[0.04]">
            <Search className="h-[12px] w-[12px] text-[#96989D]" strokeWidth={1.7} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search files" className="min-w-0 flex-1 bg-transparent text-[11.5px] text-[#55575C] outline-none placeholder:text-[#9A9CA0]" />
            {query ? <button type="button" onClick={() => setQuery("")} className="text-[#92949A] hover:text-[#52545A]"><X className="h-[12px] w-[12px]" /></button> : null}
          </div>
          <button type="button" onClick={() => void createFile()} title="New file" className="flex h-[27px] w-[27px] items-center justify-center rounded-[7px] text-[#66696F] transition-colors hover:bg-black/[0.045]"><FilePlus2 className="h-[14px] w-[14px]" strokeWidth={1.55} /></button>
          <button type="button" onClick={() => void createFolder()} title="New folder" className="flex h-[27px] w-[27px] items-center justify-center rounded-[7px] text-[#66696F] transition-colors hover:bg-black/[0.045]"><FolderPlus className="h-[14px] w-[14px]" strokeWidth={1.55} /></button>
        </div>
        <div className="cc-scroll min-h-0 flex-1 overflow-y-auto py-1.5">{files.length ? renderNode(tree) : <p className="px-3 py-3 text-[11.5px] text-[#989AA0]">No files yet.</p>}</div>
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-[34px] items-end gap-1 border-b border-black/[0.06] px-2 pt-1.5">
          <div className="flex min-w-0 flex-1 items-end gap-1 overflow-x-auto">
            {openFiles.map((filePath) => <button key={filePath} type="button" onClick={() => selectFile(filePath)} className={cn("group flex h-[27px] max-w-[190px] shrink-0 items-center gap-1.5 rounded-t-[7px] px-2 text-[11.5px] transition-colors", selected === filePath ? "bg-black/[0.055] text-[#36383D]" : "text-[#84868B] hover:bg-black/[0.03]")}><FileCode2 className="h-[11px] w-[11px] shrink-0" strokeWidth={1.55} /><span className="truncate">{filePath.split("/").at(-1)}</span><span role="button" aria-label={`Close ${filePath}`} onClick={(event) => { event.stopPropagation(); setOpenFiles((current) => current.filter((path) => path !== filePath)); if (selected === filePath) setSelected(openFiles.find((path) => path !== filePath) ?? null); }} className="ml-0.5 rounded p-0.5 opacity-0 transition-opacity hover:bg-black/[0.06] group-hover:opacity-100"><X className="h-[10px] w-[10px]" /></span></button>)}
          </div>
          {selectedFile ? <><button type="button" onClick={() => void save()} disabled={saving || draft === selectedFile.content} title="Save file" className="mb-0.5 flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-[7px] text-[#5F6368] transition-colors hover:bg-black/[0.045] disabled:opacity-35"><Save className="h-[13px] w-[13px]" strokeWidth={1.55} /></button><button type="button" onClick={() => void removeSelected()} title="Remove file" className="mb-0.5 flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-[7px] text-[#7A5656] transition-colors hover:bg-[#C24949]/[0.08]"><Trash2 className="h-[13px] w-[13px]" strokeWidth={1.55} /></button></> : null}
        </div>
        {selectedFile ? <div className="cc-code-editor min-h-0 flex-1 overflow-hidden"><Editor height="100%" path={selectedFile.path} language={fileLanguage(selectedFile.path)} value={draft} onChange={(value) => setDraft(value ?? "")} onMount={handleEditorMount} theme="vs" options={{ fontSize: 12, lineHeight: 19, fontFamily: '"SFMono-Regular", "SF Mono", Menlo, Monaco, Consolas, monospace', minimap: { enabled: false }, padding: { top: 12, bottom: 12 }, scrollBeyondLastLine: false, renderLineHighlight: "gutter", suggestOnTriggerCharacters: true, quickSuggestions: { other: true, comments: true, strings: true }, suggest: { showIcons: true, showStatusBar: false, preview: false, selectionMode: "whenQuickSuggestion" }, fixedOverflowWidgets: false, tabSize: 2, automaticLayout: true, smoothScrolling: true, wordWrap: "off", overviewRulerBorder: false }} /></div> : <div className="flex h-full items-center justify-center"><p className="text-[12px] text-[#999BA0]">Select a file to edit.</p></div>}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Panel shell with tabs                                               */
/* ------------------------------------------------------------------ */

const EXTRA_TABS: Array<{ id: RightTab; label: string; icon?: typeof Globe }> = [
  { id: "changes", label: "Changes" },
  { id: "files", label: "Files" },
];

/* A selection made in the live preview is offered as a reference before it is
   edited. The primary action turns it into a chat reference chip; the
   secondary action opens the full style inspector for live source edits. */
function SelectionPopover({
  payload,
  added,
  onAdd,
  onEdit,
  onClose,
}: {
  payload: InspectPayload;
  added: boolean;
  onAdd: () => void;
  onEdit: () => void;
  onClose: () => void;
}) {
  const sourceHint = payload.sourceHint ?? payload.rules?.find((rule) => rule.file)?.file ?? null;
  return (
    <motion.div
      initial={{ opacity: 0, y: 6, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
      className="cc-composer absolute right-3 top-[52px] z-30 w-[250px] rounded-[14px] border border-black/[0.08] bg-white p-2.5 shadow-[0_2px_4px_rgba(0,0,0,0.03),0_12px_30px_rgba(0,0,0,0.10)]"
    >
      <div className="flex items-center gap-1.5">
        <MousePointer2 className="h-3.5 w-3.5 shrink-0 text-[#1E6FFF]" strokeWidth={1.8} />
        <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-[#202124]">
          {payload.label ?? payload.name ?? payload.kind ?? "Element"}
        </span>
        <button
          type="button"
          aria-label="Dismiss selection"
          onClick={onClose}
          className="rounded-[6px] p-1 text-[#96989D] transition-colors hover:bg-black/[0.04] hover:text-[#202124]"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <p className="mt-0.5 flex min-w-0 items-center gap-1 text-[10.5px] text-[#96989D]">
        <span className="truncate">{payload.kind ?? "Element"}</span>
        {sourceHint ? (
          <span className="cc-mono truncate text-[#B7B9BD]">· {sourceHint.split("/").pop()}</span>
        ) : null}
      </p>
      <div className="mt-2.5 flex flex-col gap-1">
        <button
          type="button"
          onClick={onAdd}
          disabled={added}
          className={cn(
            "flex h-8 w-full items-center justify-center gap-1.5 rounded-[9px] text-[12px] font-medium transition-colors",
            added ? "bg-[#E8F0FE] text-[#1E6FFF]" : "bg-[#1E6FFF] text-white hover:brightness-105",
          )}
        >
          <MessageSquarePlus className="h-3.5 w-3.5" strokeWidth={1.9} />
          {added ? "Referenced in chat" : "Ask Clyra"}
        </button>
        <button
          type="button"
          onClick={onEdit}
          className="flex h-8 w-full items-center justify-center gap-1.5 rounded-[9px] text-[12px] font-medium text-[#5F6368] transition-colors hover:bg-black/[0.04]"
        >
          <SlidersHorizontal className="h-3.5 w-3.5" strokeWidth={1.9} />
          Edit properties
        </button>
      </div>
    </motion.div>
  );
}

export function RightPanel({
  state,
  actionList,
  plan,
  tab,
  onTabChange,
  preview,
  onAddContext,
  focusFile,
  agentRunning = false,
  onOpenTerminal,
  onVisualEdit,
  onVisualSourceEdit,
  onPreviewError,
  fullscreen = false,
  onToggleFullscreen,
}: {
  state: ClyraCodeState;
  actionList: AgentAction[];
  plan: PlanTodo[] | null;
  tab: RightTab;
  onTabChange: (tab: RightTab) => void;
  preview: ReturnType<typeof usePreview>;
  onAddContext: (context: ComposerContext) => void;
  focusFile: string | null;
  agentRunning?: boolean;
  onOpenTerminal?: () => void;
  /** Route visual changes that need the agent back into the coding stream. */
  onVisualEdit?: (instruction: string) => void;
  /** Record a successful direct source edit in Clyra's existing change stream. */
  onVisualSourceEdit?: (edit: { file: string; before: string; after: string; additions: number; deletions: number }) => void;
  /** A real preview error can be offered to the agent after its run settles. */
  onPreviewError?: (message: string) => void;
  fullscreen?: boolean;
  onToggleFullscreen?: () => void;
}) {
  const [inspectMode, setInspectMode] = useState(false);
  const [selection, setSelection] = useState<InspectPayload | null>(null);
  const [showInspector, setShowInspector] = useState(false);
  const [addedToChat, setAddedToChat] = useState(false);
  const frameWindowRef = useRef<Window | null>(null);
  const buildStep = useMemo(() => (agentRunning ? liveStepLabel(actionList) : null), [actionList, agentRunning]);
  const reduceMotion = useReducedMotion();

  const postToFrame = (message: unknown) => {
    frameWindowRef.current?.postMessage(message, "*");
  };

  const addSelectionContext = (payload: InspectPayload) => {
    onAddContext({
      id: `inspect-${Date.now()}`,
      label: selectionChipLabel(payload),
      detail: selectionContextDetail(payload),
    });
  };

  // Messages from the injected inspect script inside the preview frame.
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const data = event.data as {
        type?: string;
        payload?: InspectPayload;
        elId?: number;
        rect?: { left: number; top: number; width: number; height: number };
        absolute?: boolean;
      };
      if (!data || typeof data !== "object" || !data.type) return;
      if (event.source !== frameWindowRef.current) return;
      if (data.type === "clyra:element" && data.payload) {
        setSelection(data.payload);
        setAddedToChat(false);
        setShowInspector(false);
      } else if (data.type === "clyra:clear") {
        setSelection(null);
      } else if (data.type === "clyra:drag" && data.rect) {
        handleDragChange({
          elId: data.elId,
          rect: data.rect,
          absolute: data.absolute,
          styles: (data as { styles?: Record<string, string> }).styles,
        });
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection, inspectMode, state.activeProjectId]);

  // Esc clears the selection; toggling off clears everything.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && (selection || inspectMode)) {
        setSelection(null);
        setShowInspector(false);
        setAddedToChat(false);
        postToFrame({ type: "clyra:clear" });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection, inspectMode]);

  useEffect(() => {
    postToFrame({ type: "clyra:mode", mode: inspectMode });
    if (!inspectMode) {
      setSelection(null);
      setShowInspector(false);
      setAddedToChat(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inspectMode]);

  const agentFallback = (property: string, value: string) => {
    if (!selection || !onVisualEdit) return;
    onVisualEdit(
      `Change ${property} to "${value}" on the selected preview element. Here is its structured inspect context:\n${selectionContextDetail(selection)}\nUpdate the real source files so the change is permanent. Do not use a temporary preview-only style.`,
    );
  };

  const cssProperty = (property: string) => property.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);

  const recordSourceEdit = (result: Awaited<ReturnType<typeof api.sourceEdit>>, reload = true) => {
    if (result.applied && result.file && typeof result.before === "string" && typeof result.after === "string") {
      onVisualSourceEdit?.({
        file: result.file,
        before: result.before,
        after: result.after,
        additions: result.additions ?? 0,
        deletions: result.deletions ?? 0,
      });
      if (reload) preview.reload();
    }
  };

  const handleChange = (property: string, value: string, liveStyles?: Record<string, string>) => {
    if (!selection || !state.activeProjectId) return;
    if (liveStyles && selection.elId) {
      postToFrame({ type: "clyra:style", elId: selection.elId, styles: liveStyles });
    }
    const rule =
      selection.rules?.find((r) => r.file && r.declarations[property] !== undefined) ??
      selection.rules?.find((r) => r.file);
    if (rule?.file && rule.selector) {
      void api
        .sourceEdit(state.activeProjectId, {
          file: rule.file,
          selector: rule.selector,
          property: cssProperty(property),
          value,
        })
        .then((result) => {
          if (!result.applied) agentFallback(property, value);
          else recordSourceEdit(result);
        })
        .catch(() => agentFallback(property, value));
    } else {
      agentFallback(property, value);
    }
  };

  const handleDragChange = (data: {
    elId?: number;
    rect: { left: number; top: number; width: number; height: number };
    absolute?: boolean;
    styles?: Record<string, string>;
  }) => {
    if (!selection || !state.activeProjectId) return;
    const rule = selection.rules?.find((r) => r.file);
    const rect = data.rect;
    if (rule?.file && rule.selector && data.styles && Object.keys(data.styles).length) {
      const edits = Object.entries(data.styles).map(([property, value]) => ({ property: cssProperty(property), value }));
      void Promise.all(
        edits.map((edit) =>
          api.sourceEdit(state.activeProjectId!, {
            file: rule.file!,
            selector: rule.selector,
            property: edit.property,
            value: edit.value,
          }),
        ),
      )
        .then((results) => {
          results.forEach((result) => recordSourceEdit(result, false));
          preview.reload();
        })
        .catch(() => agentFallback("layout", `${Math.round(rect.width)}×${Math.round(rect.height)}`));
    } else if (onVisualEdit) {
      onVisualEdit(
        `Move or resize the selected preview element so it is ${Math.round(rect.width)}×${Math.round(rect.height)} at (${Math.round(rect.left)}, ${Math.round(rect.top)}).\n${selectionContextDetail(selection)}\nUse its existing responsive layout system (flex, grid, or CSS layout) rather than introducing absolute positioning unless it is already positioned freely.`,
      );
    }
  };

  const tabs: Array<{ id: RightTab; label: string; icon?: typeof Globe }> = [
    { id: "browser", label: "Browser", icon: Globe },
    ...(plan?.length ? [{ id: "plan" as const, label: "Plan", icon: ListChecks }] : []),
    ...EXTRA_TABS,
  ];

  return (
    <motion.section
      layout
      transition={reduceMotion ? { duration: 0 } : { duration: 0.42, ease: [0.32, 0.72, 0, 1] }}
      className={cn("relative flex min-h-0 min-w-0 flex-1 flex-col bg-[color:var(--preview-background)]", fullscreen && "fixed inset-0 z-[130] bg-white")}
    >
      <div className="relative flex h-[42px] min-w-max items-center gap-1 border-b border-[color:var(--border-subtle)] px-2.5">
        {tabs.map((entry) => {
          const Icon = entry.icon;
          const selected = tab === entry.id;
          return (
            <button
              key={entry.id}
              type="button"
              onClick={() => onTabChange(entry.id)}
              className={cn(
                "relative flex items-center gap-1.5 rounded-[7px] px-[9px] py-[6px] text-[11.75px] transition-colors duration-100",
                selected
                  ? "bg-[#F1F1F0] font-medium text-[#34363A]"
                  : "text-[#818388] hover:bg-black/[0.03]",
              )}
            >
              <span className="flex items-center gap-1.5">
                {Icon ? <Icon className="h-[13px] w-[13px]" strokeWidth={1.8} /> : null}
                {entry.label}
              </span>
            </button>
          );
        })}
      </div>

      {tab === "browser" ? (
        <BrowserView
          session={preview.session}
          frameVersion={preview.frameVersion}
          onReload={preview.reload}
          onRestart={preview.restart}
          onOpenTerminal={onOpenTerminal}
          onAddContext={onAddContext}
          agentRunning={agentRunning}
          buildStep={buildStep}
          projectId={state.activeProjectId}
          inspectMode={inspectMode}
          onToggleInspect={() => setInspectMode((mode) => !mode)}
          onFrameReady={(win) => {
            frameWindowRef.current = win;
          }}
          onPreviewError={onPreviewError}
          fullscreen={fullscreen}
          onToggleFullscreen={() => onToggleFullscreen?.()}
        />
      ) : tab === "plan" ? (
        <PlanView plan={plan} />
      ) : tab === "changes" ? (
        <ChangesView diffs={state.diffs} actions={actionList} focusFile={focusFile} />
      ) : (
        <FilesView projectId={state.activeProjectId} diffs={state.diffs} />
      )}

      {inspectMode && selection ? (
        showInspector ? (
          <VisualInspector
            payload={selection}
            onClose={() => {
              setShowInspector(false);
              setSelection(null);
              postToFrame({ type: "clyra:clear" });
            }}
            onChange={handleChange}
          />
        ) : (
          <SelectionPopover
            payload={selection}
            added={addedToChat}
            onAdd={() => {
              addSelectionContext(selection);
              setAddedToChat(true);
            }}
            onEdit={() => setShowInspector(true)}
            onClose={() => {
              setSelection(null);
              setAddedToChat(false);
              postToFrame({ type: "clyra:clear" });
            }}
          />
        )
      ) : null}
    </motion.section>
  );
}
