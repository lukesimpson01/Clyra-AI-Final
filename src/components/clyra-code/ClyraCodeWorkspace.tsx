import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { AppWindow, Bug, Folder, FolderOpen, LibraryBig, PanelLeftOpen, PanelRightClose, PanelRightOpen, Play } from "lucide-react";
import { cn } from "../../lib/utils";
import { api } from "./api";
import { shouldAskPlatform, useClyraCode, type AgentAction } from "./store";
import { Sidebar, ClyraMark, SIDEBAR_DEFAULT_WIDTH, clampSidebarWidth, type ChatThread, type SidebarSort } from "./Sidebar";
import { Conversation } from "./Conversation";
import { liveStepLabel } from "./CodexActivity";
import { Composer, type ComposerAttachment, type ComposerCommand, type ComposerContext } from "./Composer";
import { summarizeAnswers, type QuestionAnswers, type QuestionSet } from "./QuestionComposer";
import { RightPanel, usePreview, type RightTab } from "./RightPanel";
import { TerminalPanel } from "./TerminalPanel";
import { GitHubPopover } from "./GitHubPopover";
import { formatTokens } from "./format";
import { answerDirective, platformDirective, type BriefPlatform } from "./appBrief";
import { AppRail, APP_RAIL_WIDTH, type WorkspaceMode } from "./ModeTabs";
import { DesignPicker } from "./DesignPicker";
import { OpenDesignPanel } from "./OpenDesignPanel";
import { TemplateLibrary } from "./TemplateLibrary";
import { AiKeyPill } from "./AiKeyPill";
import { addUserApp, removeUserApp, useUserApps } from "../../lib/user-apps";
import { WelcomeProjectPicker, formatRecentTime } from "./WelcomeProjectPicker";
import { designDirective, type DesignSystemSummary, type DesignTemplateSummary } from "../../../lib/clyra-design/directive";

const WIDTH_KEY = "clyra-code:conversation-width";
const SIDEBAR_KEY = "clyra-code:sidebar-collapsed";
const RAIL_WIDTH_KEY = "clyra-code:sidebar-width";
const SORT_KEY = "clyra-code:sidebar-sort";
const MIN_CONVERSATION = 400;
const MIN_PREVIEW = 520;
/** Below this workspace width the sidebar becomes a drawer and the panes take turns. */
const NARROW_BREAKPOINT = 720;
// Panels glide on one calm curve (no spring overshoot); while the divider is dragged they follow the pointer exactly.
const PANEL_EASE = { duration: 0.4, ease: [0.3, 0.8, 0.3, 1] as const };
const UNTITLED_PROJECT_NAME = "Untitled project";

/** A greeting from the person's own clock. */
const greetingFor = (date = new Date()) => {
  const hour = date.getHours();
  return hour < 5 ? "Working late." : hour < 12 ? "Good morning." : hour < 18 ? "Good afternoon." : "Good evening.";
};

const WELCOME_SUBTITLES = [
  ["Turn an ", "idea", " into something real."],
  ["", "Build", " something worth shipping."],
  ["Start with an ", "idea", ". Clyra handles the details."],
  ["Describe it. We'll ", "build", " from there."],
  ["Create something worth ", "shipping", "."],
  ["From first idea to working ", "product", "."],
  ["Build it, improve it, make it ", "yours", "."],
  ["Bring your next ", "idea", " to life."],
  ["Start anywhere. Clyra will help ", "shape", " it."],
  ["Make something ", "great", ", one change at a time."],
] as const;

const PLATFORM_QUESTIONS: QuestionSet = {
  questions: [
    {
      id: "platform",
      question: "Which platform should I target?",
      type: "single",
      options: ["Web app", "Desktop app", "iOS app", "Choose for me"],
    },
  ],
};

const DESKTOP_FRAMEWORK_QUESTIONS: QuestionSet = {
  questions: [
    {
      id: "framework",
      question: "Which desktop framework should I use?",
      type: "single",
      options: ["Electron", "Tauri", "Choose for me"],
    },
  ],
};

const DEMO_QUESTIONS: QuestionSet = {
  questions: [
    { id: "layout", question: "Which layout should I use?", type: "single", options: ["Current layout", "New layout"] },
    { id: "animations", question: "Should I preserve existing animations?", type: "single", options: ["Yes", "No", "Only the good ones"] },
    { id: "scope", question: "How much should I change?", type: "single", options: ["Minimal", "Balanced", "Full rebuild"] },
    { id: "direction", question: "Any visual direction?", type: "single", options: ["Keep it clean", "More colorful", "Dark mode"], allowCustom: true },
  ],
};

function encodeAttachment(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("Could not read attachment."));
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      resolve(result.includes(",") ? result.slice(result.indexOf(",") + 1) : result);
    };
    reader.readAsDataURL(file);
  });
}

/**
 * Clyra Code — the agent-first coding workspace. Three columns: project
 * sidebar, live agent work log, and the project preview. Every rendered
 * action mirrors a real OpenCode harness event.
 */
export default function ClyraCodeWorkspace({
  initialProjectId,
  onInitialProjectOpened,
}: {
  /** A project imported from Chat. It is consumed once, then normal Vibe
   * navigation remains entirely user-controlled. */
  initialProjectId?: string;
  onInitialProjectOpened?: (projectId: string) => void;
} = {}) {
  const reducedMotion = useReducedMotion();
  const {
    state: rawState,
    actionList,
    running,
    effectiveDiffs,
    plan,
    selectProject,
    selectThread,
    loadProjects,
    startRun,
    beginOptimisticPrompt,
    failOptimisticPrompt,
    cancelRun,
    undoLastCheckpoint,
    replyPermission,
    recordVisualEdit,
  } = useClyraCode();

  useEffect(() => {
    // Keep Chat/Vibe/Clip rail out of the coding surface; hover-dot reveals it.
    window.dispatchEvent(new CustomEvent("clyra:workflow-tabs-hide"));
  }, []);

  // Views consume harness diffs when present, or summaries synthesized from
  // real tool payloads when the diff endpoint is empty.
  const state = useMemo(
    () => ({ ...rawState, diffs: effectiveDiffs }),
    [rawState, effectiveDiffs],
  );

  const [rightTab, setRightTab] = useState<RightTab>("browser");
  const [focusFile, setFocusFile] = useState<string | null>(null);
  const [contexts, setContexts] = useState<ComposerContext[]>([]);
  const [creating, setCreating] = useState(false);
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  // True while a design project is being handed back to the Code workspace:
  // the design surface fades out before the switch, so the handoff reads as
  // one continuous motion instead of a hard cut.
  const [designExiting, setDesignExiting] = useState(false);
  const [rightPanelOpen, setRightPanelOpen] = useState(false);
  const [previewContentVisible, setPreviewContentVisible] = useState(false);
  const [previewFullscreen, setPreviewFullscreen] = useState(false);
  const [terminalHeight, setTerminalHeight] = useState(200);
  const [agentActivityCount, setAgentActivityCount] = useState(0);
  // The app type chosen from the welcome chips. It stays set until the brief is sent or cleared.
  const [briefPlatform, setBriefPlatform] = useState<BriefPlatform | null>(null);
  // Code and Design are two workspaces over the same runtime. The mode decides
  // which projects the sidebar lists and which welcome a new task opens with.
  // The workspace always opens on the Code welcome — the previous Design mode
  // must never swallow the opening screen.
  const [mode, setMode] = useState<WorkspaceMode>("code");
  const [catalog, setCatalog] = useState<{ systems: DesignSystemSummary[]; templates: DesignTemplateSummary[] }>({ systems: [], templates: [] });
  const [designSystemId, setDesignSystemId] = useState<string | null>(null);
  const [designTemplateId, setDesignTemplateId] = useState<string | null>(null);
  const [welcomeSubtitle] = useState(() => WELCOME_SUBTITLES[Math.floor(Math.random() * WELCOME_SUBTITLES.length)]);
  const [greeting] = useState(() => greetingFor());
  const [composerDraft, setComposerDraft] = useState<{ id: number; text: string } | null>(null);
  const [threadsByProject, setThreadsByProject] = useState<Record<string, ChatThread[]>>({});
  const [hiddenProjectIds, setHiddenProjectIds] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem("clyra-code:hidden-projects") || "[]"); } catch { return []; }
  });
  const autoFixedPreviewError = useRef<string | null>(null);
  const [questionSet, setQuestionSet] = useState<QuestionSet | null>(null);
  const questionSetRef = useRef<QuestionSet | null>(null);
  const [questionSubmitting, setQuestionSubmitting] = useState(false);
  const [effort, setEffort] = useState<"low" | "medium" | "high">("medium");
  // Which welcome-screen menu is open ("projects" picker or the effort menu).
  // Kept here so opening one always closes the other — a single smooth toggle.
  const [welcomeMenu, setWelcomeMenu] = useState<"projects" | "effort" | null>(null);
  const pendingPromptRef = useRef<string>("");

  const openedInitialProjectRef = useRef<string | null>(null);
  useEffect(() => {
    if (!initialProjectId || openedInitialProjectRef.current === initialProjectId) return;
    let cancelled = false;
    void loadProjects().then(() => {
      if (cancelled) return;
      openedInitialProjectRef.current = initialProjectId;
      selectProject(initialProjectId);
      onInitialProjectOpened?.(initialProjectId);
    }).catch(() => {
      // The normal workspace error handling remains responsible for an
      // unavailable project. Do not claim an import opened when it didn't.
    });
    return () => { cancelled = true; };
  }, [initialProjectId, loadProjects, onInitialProjectOpened, selectProject]);

  /* -------------------- open existing project -------------------- */
  const [importingProject, setImportingProject] = useState(false);
  const [importPathDraft, setImportPathDraft] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

  const importProjectFromPath = useCallback(async (rawPath: string) => {
    const trimmed = rawPath.trim();
    if (!trimmed || importingProject) return;
    setImportingProject(true);
    setImportError(null);
    try {
      const project = await api.importProject(trimmed);
      await loadProjects();
      selectProject(project.id);
      setImportPathDraft(null);
    } catch (error) {
      setImportError(error instanceof Error ? error.message : "Could not import that project.");
    } finally {
      setImportingProject(false);
    }
  }, [importingProject, loadProjects, selectProject]);

  const requestOpenExistingProject = useCallback(async () => {
    if (importingProject) return;
    setImportError(null);
    const pick = window.clyraDesktop?.selectFolder;
    if (pick) {
      const result = await pick().catch(() => null);
      if (!result || result.canceled || !result.path) return;
      await importProjectFromPath(result.path);
      return;
    }
    setImportPathDraft("");
  }, [importProjectFromPath, importingProject]);

  const refreshThreads = useCallback(async () => {
    const rows = await Promise.all(state.projects.map(async (project) => {
      const threads = await api.listSessions(project.id).catch(() => [] as ChatThread[]);
      return [project.id, threads] as const;
    }));
    setThreadsByProject(Object.fromEntries(rows));
  }, [state.projects]);

  useEffect(() => { void refreshThreads(); }, [refreshThreads, state.sessionId, state.runState]);

  // Removing a project from the sidebar is recorded with the project. No project
  // file is deleted or moved.
  const hideProject = useCallback((projectId: string) => {
    void api.updateProjectState(projectId, { archived: true }).then(() => loadProjects()).catch(() => undefined);
    if (state.activeProjectId === projectId) selectProject(null);
  }, [loadProjects, selectProject, state.activeProjectId]);

  const setProjectPinned = useCallback((projectId: string, pinned: boolean) => {
    void api.updateProjectState(projectId, { pinned }).then(() => loadProjects()).catch(() => undefined);
  }, [loadProjects]);

  const renameProjectFromSidebar = useCallback((projectId: string, name: string) => {
    void api.renameProject(projectId, name).then(() => loadProjects()).catch(() => undefined);
  }, [loadProjects]);

  // Projects hidden by the earlier browser-only list are moved into project data once.
  useEffect(() => {
    let legacy: string[] = [];
    try {
      legacy = JSON.parse(localStorage.getItem("clyra-code:hidden-projects") || "[]");
    } catch {
      legacy = [];
    }
    if (!Array.isArray(legacy) || legacy.length === 0) return;
    void Promise.all(legacy.map((id) => api.updateProjectState(String(id), { archived: true }).catch(() => null)))
      .then(() => {
        try { localStorage.removeItem("clyra-code:hidden-projects"); } catch { /* storage unavailable */ }
        setHiddenProjectIds([]);
        return loadProjects();
      });
  // Runs once when the workspace mounts.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A finished run bumps buildVersion so the browser preview reloads.
  const [buildVersion, setBuildVersion] = useState(0);
  const previousRunState = useRef(state.runState);
  useEffect(() => {
    const wasBusy = previousRunState.current === "running" || previousRunState.current === "starting";
    const settled = state.runState !== "running" && state.runState !== "starting";
    // Any way out of a run refreshes the preview, not just a clean finish —
    // a cancelled or partially failed run still left real files on disk, and
    // leaving the frame stale makes it look like nothing was built.
    if (wasBusy && settled) setBuildVersion((v) => v + 1);
    previousRunState.current = state.runState;
  }, [state.runState]);

  /* Files landing mid-run refresh the preview too, so a long build shows its
     product as it appears rather than only at the end. Debounced so a burst
     of edits reloads the frame once. */
  const editedFileCount = useMemo(
    () => new Set(
      Object.values(state.actions)
        .filter((action) => action.kind === "edit" && action.target)
        .map((action) => action.target),
    ).size,
    [state.actions],
  );
  const lastEditedCount = useRef(0);
  useEffect(() => {
    if (editedFileCount === lastEditedCount.current) return;
    lastEditedCount.current = editedFileCount;
    if (!editedFileCount) return;
    const timer = window.setTimeout(() => setBuildVersion((v) => v + 1), 1200);
    return () => window.clearTimeout(timer);
  }, [editedFileCount]);

  useEffect(() => {
    setAgentActivityCount(Object.values(state.actions).filter((action) => /^(command|build|check|test|preview|git)$/.test(action.kind)).length);
  }, [state.actions]);

  const preview = usePreview(state.activeProjectId, buildVersion);

  /* -------------------- resizable centre column -------------------- */
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try {
      return localStorage.getItem(SIDEBAR_KEY) === "1";
    } catch {
      return false;
    }
  });
  // The rail width is the user's choice, persisted locally. It is a UI preference,
  // so it is not stored with project data.
  const [railWidth, setRailWidth] = useState(() => {
    try {
      const raw = Number(localStorage.getItem(RAIL_WIDTH_KEY));
      return Number.isFinite(raw) && raw > 0 ? clampSidebarWidth(raw) : SIDEBAR_DEFAULT_WIDTH;
    } catch {
      return SIDEBAR_DEFAULT_WIDTH;
    }
  });
  const updateRailWidth = useCallback((next: number) => {
    const clamped = clampSidebarWidth(next);
    setRailWidth(clamped);
    try { localStorage.setItem(RAIL_WIDTH_KEY, String(clamped)); } catch { /* storage unavailable */ }
  }, []);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const drawerOpenerRef = useRef<HTMLButtonElement | null>(null);
  const closeDrawer = useCallback(() => {
    setDrawerOpen(false);
    requestAnimationFrame(() => drawerOpenerRef.current?.focus());
  }, []);
  const [sidebarSort, setSidebarSort] = useState<SidebarSort>(() => {
    try {
      return localStorage.getItem(SORT_KEY) === "name" ? "name" : "recent";
    } catch {
      return "recent";
    }
  });
  const updateSidebarSort = useCallback((next: SidebarSort) => {
    setSidebarSort(next);
    try { localStorage.setItem(SORT_KEY, next); } catch { /* storage unavailable */ }
  }, []);
  // macOS hides the native title bar, so the traffic lights sit over the top-left.
  const desktopPlatform = (window as unknown as { clyraDesktop?: { platform?: string } }).clyraDesktop?.platform;
  const macInset = desktopPlatform === "darwin";
  const shellRef = useRef<HTMLDivElement | null>(null);
  const [shellWidth, setShellWidth] = useState(0);
  const narrow = shellWidth > 0 && shellWidth < NARROW_BREAKPOINT;
  // Below the breakpoint the rail leaves the layout; it returns as an overlay drawer.
  const sidebarWidth = narrow || sidebarCollapsed ? 0 : railWidth;
  const [dragging, setDragging] = useState(false);
  const [conversationWidth, setConversationWidth] = useState(() => {
    const raw = Number(localStorage.getItem(WIDTH_KEY));
    if (Number.isFinite(raw) && raw >= MIN_CONVERSATION) return raw;
    // ~47% of the chat+preview pair on a typical desktop (sidebar aside).
    return 560;
  });

  // Animate real pane widths rather than using a flex-grow interpolation.
  // Flex-grow makes children briefly scale/stretch while the free space is
  // redistributed; measured widths let both panes reflow like the left rail.
  useLayoutEffect(() => {
    const shell = shellRef.current;
    if (!shell) return;
    const update = () => setShellWidth(Math.max(0, shell.clientWidth - APP_RAIL_WIDTH));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(shell);
    return () => observer.disconnect();
  }, []);

  const availableWorkspaceWidth = Math.max(0, shellWidth - sidebarWidth - 2);
  const openConversationWidth = Math.min(
    Math.max(MIN_CONVERSATION, conversationWidth),
    Math.max(MIN_CONVERSATION, availableWorkspaceWidth - MIN_PREVIEW),
  );
  // Narrow: one primary surface at a time. The preview takes the full width when open,
  // and the chat takes it when the preview is closed. Neither keeps its desktop minimum.
  const conversationTargetWidth = narrow
    ? (rightPanelOpen ? 0 : availableWorkspaceWidth)
    : (rightPanelOpen ? openConversationWidth : availableWorkspaceWidth);
  const previewTargetWidth = narrow
    ? (rightPanelOpen ? availableWorkspaceWidth : 0)
    : (rightPanelOpen ? Math.max(0, availableWorkspaceWidth - openConversationWidth) : 0);

  // First layout (no saved width): pin conversation to ~47% of remaining space.
  useEffect(() => {
    if (localStorage.getItem(WIDTH_KEY)) return;
    const shell = shellRef.current;
    if (!shell) return;
    const available = shell.clientWidth - APP_RAIL_WIDTH - sidebarWidth - 2;
    const target = Math.round(available * 0.47);
    const max = available - MIN_PREVIEW;
    setConversationWidth(Math.min(max, Math.max(MIN_CONVERSATION, target)));
  // Only establish the initial split once. The sidebar itself now owns its
  // interpolated width, so recalculating the conversation width on every
  // sidebar toggle would make the chat jump before the pane finishes moving.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleSidebarCollapsed = useCallback(() => {
    setSidebarCollapsed((current) => {
      const next = !current;
      try {
        localStorage.setItem(SIDEBAR_KEY, next ? "1" : "0");
      } catch {
        // ignore
      }
      return next;
    });
  }, []);

  const onDragStart = useCallback(
    (event: React.PointerEvent) => {
      event.preventDefault();
      setDragging(true);
      const startX = event.clientX;
      const startWidth = conversationWidth;
      const move = (moveEvent: PointerEvent) => {
        const shell = shellRef.current;
        if (!shell) return;
        const max = shell.clientWidth - APP_RAIL_WIDTH - sidebarWidth - MIN_PREVIEW - 2;
        const next = Math.min(max, Math.max(MIN_CONVERSATION, startWidth + moveEvent.clientX - startX));
        setConversationWidth(next);
      };
      const up = () => {
        setDragging(false);
        setConversationWidth((width) => {
          localStorage.setItem(WIDTH_KEY, String(width));
          return width;
        });
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    },
    [conversationWidth, sidebarWidth],
  );

  /* -------------------- project creation -------------------- */
  const createProject = useCallback(async (name = UNTITLED_PROJECT_NAME, options?: { designSystemId?: string | null; designTemplateId?: string | null }) => {
    if (creating) return;
    setCreating(true);
    try {
      // A project created while the Design tab is open is a design project.
      const project = await api.createProject(name.trim() || UNTITLED_PROJECT_NAME, "", {
        kind: mode === "design" ? "design" : "code",
        designSystemId: options?.designSystemId ?? null,
        designTemplateId: options?.designTemplateId ?? null,
      });
      await loadProjects();
      selectProject(project.id);
      return project;
    } catch {
      /* surfaced by empty state */
    } finally {
      setCreating(false);
    }
  }, [creating, loadProjects, mode, selectProject]);

  const requestNewProject = useCallback(() => {
    if (creating) return;
    void createProject();
  }, [creating, createProject]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "n") {
        event.preventDefault();
        requestNewProject();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [requestNewProject]);

  /* -------------------- helpers -------------------- */
  const activeProject = state.projects.find((p) => p.id === state.activeProjectId) ?? null;
  /* A task with no saved title is named by its first request, as Codex does, rather than a generic "Task". */
  const firstPrompt = (state.log.find((entry) => entry.type === "user") as { text?: string } | undefined)?.text?.replace(/\s+/g, " ").trim() ?? "";
  const taskTitle = state.sessionTitle || (firstPrompt ? (firstPrompt.length > 70 ? `${firstPrompt.slice(0, 68)}…` : firstPrompt) : state.log.length ? "Task" : "");
  const diffTotals = useMemo(
    () => state.diffs.reduce((acc, diff) => ({ files: acc.files + 1, additions: acc.additions + (diff.additions || 0), deletions: acc.deletions + (diff.deletions || 0) }), { files: 0, additions: 0, deletions: 0 }),
    [state.diffs],
  );
  const agentStatus = useMemo(() => {
    if (state.connection === "reconnecting") return { label: "Reconnecting", tone: "warning" as const };
    if (state.runState === "failed") return { label: "Needs attention", tone: "error" as const };
    if (running) {
      const active = [...actionList].reverse().find((action) => action.status === "active" || action.status === "queued");
      return { label: active ? (liveStepLabel([active]) ?? "Working") : "Preparing", tone: "active" as const };
    }
    return { label: state.sessionId ? "Ready to continue" : "Ready", tone: "idle" as const };
  }, [actionList, running, state.connection, state.runState, state.sessionId]);
  const terminalError = useMemo(() => {
    // Session errors include failures before an agent has had a chance to
    // produce an action (for example, an unavailable provider on Send).
    if (state.error) {
      return {
        id: `session:${state.runStartedAt ?? state.runEndedAt ?? 0}:${state.error}`,
        message: state.error,
      };
    }
    // Tool errors can occur inside an otherwise continuing run. Surface the
    // latest concrete one in the terminal too, where multiline diagnostics are
    // easier to read and copy than in the compact activity row.
    const failedAction = [...actionList].reverse().find((action) =>
      action.status === "error" && Boolean(action.error || action.output),
    );
    if (!failedAction) return null;
    const detail = (failedAction.error || failedAction.output || "Tool failed").trim();
    return {
      id: `action:${failedAction.id}:${failedAction.endedAt ?? failedAction.startedAt}:${detail}`,
      message: `${failedAction.target}: ${detail}`,
    };
  }, [actionList, state.error, state.runEndedAt, state.runStartedAt]);
  const desktopProject = /\b(?:desktop|electron)\b/i.test(`${activeProject?.name ?? ""} ${taskTitle}`);
  const canLaunchElectronPreview = Boolean(window.clyraDesktop?.preview?.launch);
  const launchDesktopPreview = useCallback(async () => {
    const url = preview.session?.url;
    if (!url) return;
    await window.clyraDesktop?.preview?.launch({ url, title: activeProject?.name || "Clyra desktop project" });
  }, [activeProject?.name, preview.session?.url]);
  // A selected task is open even when it has no messages yet. Gating on the log alone
  // made an empty or unloaded task look like nothing had happened on click.
  const hasConversation = state.log.length > 0 || Boolean(state.sessionId);

  // The composer is a different element on the welcome and conversation
  // screens. To make the hand-off read as one object, remember where the
  // welcome composer sat, then slide the conversation composer from there to
  // its docked place at the bottom (a FLIP move, no shared-layout library).
  const welcomeComposerRef = useRef<HTMLDivElement | null>(null);
  const conversationComposerRef = useRef<HTMLDivElement | null>(null);
  const welcomeComposerTop = useRef<number | null>(null);
  // Runs only when the screen flips between welcome and conversation. Measuring on every render forced a full
  // document layout each time anything re-rendered (hundreds of ms while Task View was laying out every app).
  useLayoutEffect(() => {
    if (!hasConversation) {
      welcomeComposerTop.current = welcomeComposerRef.current?.getBoundingClientRect().top ?? null;
      return;
    }
    // The outgoing welcome screen is still mounted while it exits, so its composer gives the freshest start point.
    const welcomeNode = welcomeComposerRef.current;
    if (welcomeNode?.isConnected) welcomeComposerTop.current = welcomeNode.getBoundingClientRect().top;
    const from = welcomeComposerTop.current;
    welcomeComposerTop.current = null;
    const node = conversationComposerRef.current;
    if (from === null || !node || reducedMotion) return;
    const delta = from - node.getBoundingClientRect().top;
    if (Math.abs(delta) < 4) return;
    node.animate(
      [{ transform: `translateY(${delta}px)` }, { transform: "translateY(0)" }],
      { duration: 380, easing: "cubic-bezier(0.22, 1, 0.36, 1)" },
    );
  }, [hasConversation, reducedMotion]);
  const recentProjects = useMemo(
    () => state.projects.filter((project) => !project.archivedAt && !hiddenProjectIds.includes(project.id) && (project.kind === "design") === (mode === "design")),
    [mode, state.projects, hiddenProjectIds],
  );

  // Keep preview content out of the width animation.  The pane itself glides
  // in first; the browser surface then fades up at its final width, so it is
  // never visibly stretched while the sidebar opens. The hand-off is short on
  // purpose: any longer and the open panel reads as an empty white gap.
  useEffect(() => {
    if (!rightPanelOpen) {
      setPreviewContentVisible(false);
      return;
    }
    const timer = window.setTimeout(() => setPreviewContentVisible(true), 120);
    return () => window.clearTimeout(timer);
  }, [rightPanelOpen]);

  // A blank project gives the welcome workspace all available width. Selecting
  // an existing thread or sending the first prompt activates the preview.
  useEffect(() => {
    setRightPanelOpen(Boolean(state.activeProjectId && hasConversation));
  }, [hasConversation, state.activeProjectId, state.sessionId]);

  const openFileDiff = useCallback((path: string) => {
    setFocusFile(path);
    setRightTab("changes");
  }, []);

  const retryAction = useCallback(
    (action: AgentAction) => {
      void startRun(
        /^(command|build|check|test|preview|git)$/.test(action.kind)
          ? `The command \`${action.target}\` failed. Investigate the error and fix it:\n${action.error ?? ""}\n${(action.output ?? "").slice(-2000)}`
          : `The ${action.kind} action on ${action.target} failed. Investigate and fix it.`,
      );
    },
    [startRun],
  );

  const restoreLastCheckpoint = useCallback(async () => {
    const restored = await undoLastCheckpoint();
    if (restored) {
      setRightTab("browser");
      setBuildVersion((version) => version + 1);
    }
  }, [undoLastCheckpoint]);

  const submitPrompt = useCallback(
    async (
      text: string,
      attachments: ComposerAttachment[] = [],
      command?: ComposerCommand,
      options?: {
        userText?: string;
        answers?: Array<{ question: string; answer: string }>;
        effort?: "low" | "medium" | "high";
        /** Set when the app type was already chosen from a welcome chip, so the platform question is skipped. */
        platform?: BriefPlatform;
      },
    ) => {
      window.dispatchEvent(new CustomEvent("clyra:workflow-tabs-hide"));
      const trimmed = text.trim();
      if (trimmed === "/ask") {
        pendingPromptRef.current = "";
        questionSetRef.current = DEMO_QUESTIONS;
        setQuestionSet(DEMO_QUESTIONS);
        return true;
      }
      // A fresh request that clearly asks to build a new app/website/product
      // with no platform signal turns into a question instead of guessing.
      // Follow-ups inside an existing session and ordinary requests always
      // send immediately so the composer never feels like it swallowed a turn.
      if (!command && !options?.platform && /\bdesktop\s+app\b/i.test(trimmed) && !/\b(electron|tauri)\b/i.test(trimmed) && !state.sessionId) {
        pendingPromptRef.current = trimmed;
        questionSetRef.current = DESKTOP_FRAMEWORK_QUESTIONS;
        setQuestionSet(DESKTOP_FRAMEWORK_QUESTIONS);
        return false;
      }
      if (!command && !options?.platform && shouldAskPlatform(trimmed) && !state.sessionId) {
        pendingPromptRef.current = trimmed;
        questionSetRef.current = PLATFORM_QUESTIONS;
        setQuestionSet(PLATFORM_QUESTIONS);
        return false;
      }
      // The message lands in the transcript before any project, upload or
      // runtime work starts, so a send never looks like it did nothing.
      beginOptimisticPrompt(options?.userText ?? trimmed, options?.answers);
      let projectId = state.activeProjectId;
      if (!projectId) {
        const project = await createProject(UNTITLED_PROJECT_NAME, { designSystemId, designTemplateId });
        projectId = project?.id ?? null;
      }
      setRightPanelOpen(true);
      if (!projectId) {
        failOptimisticPrompt("Clyra could not open a project for this task.");
        return false;
      }
      try {
        const uploaded = attachments.length
          ? await api.uploadAttachments(projectId, await Promise.all(attachments.map(async (attachment) => ({
              name: attachment.file.name,
              relativePath: (attachment.file as File & { webkitRelativePath?: string }).webkitRelativePath || undefined,
              type: attachment.file.type || "application/octet-stream",
              data: await encodeAttachment(attachment.file),
            }))))
          : { attachments: [] };
        const attachmentContext = uploaded.attachments.length
          ? `Attached project files (inspect these before editing):\n${uploaded.attachments.map((attachment) => `- ${attachment.path} (${attachment.type})`).join("\n")}\n\n`
          : "";
        const commandInstruction: Record<ComposerCommand, string> = {
          browser: "[Clyra Browser mode] Use the existing live preview and real browser/preview tools to observe, act, verify, repair source when needed, rebuild and retest. Do not claim browser interactions that did not occur.\n\n",
          plan: "[Clyra Plan mode] Inspect the repository, create a detailed PLAN.md at project root with findings, files, implementation steps, risks and validation. Do not edit implementation files in this turn; stop after presenting the plan for user approval.\n\n",
          test: "[Clyra Test mode] Determine the appropriate real checks for this project. Run relevant tests, typecheck/build and live-preview checks where available; diagnose and fix genuine failures, then rerun validation.\n\n",
          debug: "[Clyra Debug mode] Reproduce the reported issue, inspect real logs and relevant code, make the smallest correct repair, then rerun the reproduction and validation.\n\n",
          explain: "[Clyra Explain mode] Inspect the actual repository and explain the requested architecture or code. Do not edit files unless the user separately asks for a change.\n\n",
        };
        // Fire the run without awaiting the full network round trip: startRun
        // appends the optimistic user message synchronously before its first
        // await, so the composer can clear immediately instead of freezing
        // the input until the agent's runtime/session/prompt calls resolve.
        const platformInstruction = options?.platform ? platformDirective(options.platform) : "";
        // The first message of a design task carries its system and layout, so the
        // agent builds to the real reference files the server wrote for this project.
        // An existing design project takes the welcome's choices on its first send,
        // so the files the agent reads always match what the user picked.
        if (mode === "design" && !state.sessionId && state.activeProjectId && projectId) {
          if ((activeProject?.designSystemId ?? null) !== designSystemId || (activeProject?.designTemplateId ?? null) !== designTemplateId) {
            await api.setProjectDesign(projectId, { designSystemId, designTemplateId }).catch(() => undefined);
            void loadProjects();
          }
        }
        const designInstruction = mode === "design" && !state.sessionId
          ? designDirective({
              system: catalog.systems.find((system) => system.id === designSystemId) ?? null,
              template: catalog.templates.find((template) => template.id === designTemplateId) ?? null,
            })
          : "";
        void startRun(designInstruction + platformInstruction + (command ? commandInstruction[command] : "") + attachmentContext + text, command === "plan" ? "plan" : undefined, {
          ...options,
          userText: options?.userText ?? trimmed,
          effort,
          optimistic: true,
        });
        return true;
      } catch {
        failOptimisticPrompt("The message could not be sent. Check the project and try again.");
        return false;
      }
    },
    [activeProject, beginOptimisticPrompt, catalog, createProject, designSystemId, designTemplateId, effort, failOptimisticPrompt, loadProjects, mode, startRun, state.activeProjectId, state.sessionId],
  );

  // "Open in Clyra Code" from the Library: select the installed project, bring up
  // the live preview (usePreview starts the dev server for the active project),
  // then send one setup prompt once that project is actually active so the
  // message can never land in a different project.
  const [autoStart, setAutoStart] = useState<{ projectId: string; name: string; repositoryUrl: string; aiPowered: boolean } | null>(null);
  // Imported apps whose features need a model API: the pill above the composer offers Clyra AI or the user's own key.
  const userApps = useUserApps();
  const AI_PROJECTS_KEY = "clyra.library.aiProjects";
  const [aiProjects, setAiProjects] = useState<Record<string, string>>(() => {
    try { return JSON.parse(localStorage.getItem(AI_PROJECTS_KEY) ?? "{}") as Record<string, string>; } catch { return {}; }
  });
  const rememberAiProject = useCallback((projectId: string, name: string) => {
    setAiProjects((current) => {
      const next = { ...current, [projectId]: name };
      try { localStorage.setItem(AI_PROJECTS_KEY, JSON.stringify(next)); } catch { /* storage unavailable */ }
      return next;
    });
  }, []);
  // Library hand-off: the shell fades out (same pure fade as first entering
  // Vibe Coder), the project lands with the sidebar and preview open, then the
  // shell fades back in while the dev server's build animation runs.
  const [handoffFading, setHandoffFading] = useState(false);
  // The installed app's thread gets a quiet welcome prompt once setup is done.
  const [libraryWelcome, setLibraryWelcome] = useState<{ name: string; sessionId: string | null } | null>(null);
  useEffect(() => {
    if (!libraryWelcome || libraryWelcome.sessionId || !state.sessionId || !running) return;
    setLibraryWelcome((current) => (current && !current.sessionId ? { ...current, sessionId: state.sessionId } : current));
  }, [libraryWelcome, running, state.sessionId]);
  useEffect(() => {
    if (!autoStart || state.activeProjectId !== autoStart.projectId || running) return;
    const { name, repositoryUrl, aiPowered } = autoStart;
    setAutoStart(null);
    setRightPanelOpen(true);
    setRightTab("browser");
    void submitPrompt(
      `I just installed ${name} (source: ${repositoryUrl}) into this project from the Clyra Library. Set it up to run: read its README and package files, install dependencies, start the dev server and confirm the live preview loads, fixing any setup problems you hit. Remove every external account, sign-in, sign-up, authentication or third-party connection screen so the app opens straight into its main interface: replace logins with a single local default user (or no auth), and delete or stub anything that needs an outside account, such as OAuth, billing, cloud sync, analytics or telemetry. Keep the change minimal and tell me what you removed.${aiPowered ? " This app's AI features need an AI model API. Say so plainly: tell me the AI features need an API, and that I can use Clyra AI (nothing to set up) or add my own API key with the AI setup card above the composer. Never ask me to paste a key into chat. Once I choose, read the settings from .env.local (OPENAI_API_KEY, OPENAI_BASE_URL, CLYRA_AI_MODEL), map them to whatever variable names the app expects, and never print, log or hard-code a key or token." : ""} When it is running, give me a two-line summary of what the app does, then ask what I would like to change, and offer to publish it when I am happy.`,
      [],
      undefined,
      { userText: `Set up and run ${name}` },
    );
  }, [autoStart, running, state.activeProjectId, submitPrompt]);

  const aiPill = activeProject && aiProjects[activeProject.id] ? (
                  <AiKeyPill
                    projectId={activeProject.id}
                    appName={aiProjects[activeProject.id]}
                    onChosen={(mode) => void submitPrompt(
                      mode === "clyra"
                        ? `I chose Clyra AI for ${aiProjects[activeProject.id]}'s AI features. The project's .env.local now holds the Clyra AI address and a project token. Wire the app to use it and confirm the AI features work. Never print or hard-code the token.`
                        : `I added my own API key for ${aiProjects[activeProject.id]}'s AI features. It is saved in the project's .env.local. Wire the app to use it and confirm the AI features work. Never print or hard-code the key.`,
                      [], undefined, { userText: mode === "clyra" ? "Use Clyra AI for this app" : "I added my own API key" },
                    )}
                  />
                ) : null;

  // The welcome composer sends with the chosen app type. The brief clears only
  // after a send succeeds, so a rejected send keeps the user's choice.
  const submitFromWelcome = useCallback(
    async (text: string, attachments: ComposerAttachment[], command?: ComposerCommand) => {
      const platform = briefPlatform;
      const sent = await submitPrompt(text, attachments, command, platform ? { platform, userText: text.trim() } : undefined);
      if (sent && platform) setBriefPlatform(null);
      return sent;
    },
    [briefPlatform, submitPrompt],
  );

  const handleQuestionSubmit = useCallback(
    (answers: QuestionAnswers) => {
      const answer = answers.platform?.values?.[0] ?? answers.framework?.values?.[0] ?? answers.layout?.values?.[0] ?? "";
      const pending = pendingPromptRef.current;
      pendingPromptRef.current = "";
      const usedSet = questionSetRef.current;
      const summary = summarizeAnswers(usedSet, answers);
      setQuestionSubmitting(true);
      window.setTimeout(() => {
        setQuestionSubmitting(false);
        setQuestionSet(null);
        if (pending) {
          void submitPrompt(answerDirective(answer) + pending, [], undefined, {
            userText: pending,
            answers: summary,
          });
        }
      }, 240);
    },
    [submitPrompt],
  );

  const handleQuestionBack = useCallback(() => {
    pendingPromptRef.current = "";
    setQuestionSubmitting(false);
    setQuestionSet(null);
  }, []);

  // A preview failure that appears after an otherwise finished run is a real
  // validation signal. Feed it back into the same agent session once, rather
  // than leaving the user to copy opaque console output by hand.
  const handlePreviewError = useCallback((message: string) => {
    const normalized = message.trim();
    // "No recognised project target" means nothing has been built yet. That is
    // not a runtime failure, so it must not start a repair run by itself.
    if (/no recognised project target|nothing to preview/i.test(normalized)) return;
    if (!normalized || running || state.runState !== "complete" || autoFixedPreviewError.current === normalized) return;
    autoFixedPreviewError.current = normalized;
    void startRun(`The live preview failed after the task completed. Diagnose and fix the real project error, then validate the preview again:\n${normalized}`);
  }, [running, startRun, state.runState]);

  useEffect(() => {
    autoFixedPreviewError.current = null;
    // Inspect and terminal references belong to one chat thread only.
    setContexts([]);
  }, [state.activeProjectId, state.sessionId]);

  const addTerminalErrorContext = useCallback(() => {
    if (!state.error) return;
    const detail = state.error.trim();
    setContexts((previous) => previous.some((entry) => entry.detail === detail)
      ? previous
      : [...previous, { id: `terminal-error-${Date.now()}`, label: "Terminal error", detail }]);
  }, [state.error]);

  const tokensLabel = formatTokens(state.tokens);
  // Code and Design each list only their own projects.
  const modeProjects = useMemo(
    () => state.projects.filter((project) => (project.kind === "design") === (mode === "design")),
    [mode, state.projects],
  );
  const visibleProjects = modeProjects.filter((project) => !hiddenProjectIds.includes(project.id));

  useEffect(() => {
    void api.designCatalog().then(setCatalog).catch(() => undefined);
  }, []);

  const changeMode = useCallback((next: WorkspaceMode) => {
    setMode(next);
    try { localStorage.setItem("clyra-code:mode", next); } catch { /* storage unavailable */ }
    // A task from the other mode is not left open under this one.
    const current = state.projects.find((project) => project.id === state.activeProjectId);
    if (current && (current.kind === "design") !== (next === "design")) selectProject(null);
    setContexts([]);
    setFocusFile(null);
  }, [selectProject, state.activeProjectId, state.projects]);

  // The welcome's picks follow the open design project, so they never describe
  // a different project than the one the user is looking at.
  useEffect(() => {
    if (!activeProject) return;
    setDesignSystemId(activeProject.designSystemId ?? null);
    setDesignTemplateId(activeProject.designTemplateId ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProject?.id, activeProject?.designSystemId, activeProject?.designTemplateId]);

  /**
   * "New task" always lands on the welcome screen: the open conversation
   * closes and the home composer takes over, with the project kept selected
   * so the next prompt becomes a fresh task inside it. The home dropdown can
   * point that task at a different project — or a brand-new one — first.
   */
  const handleNewChat = useCallback((projectId: string) => {
    selectProject(projectId);
    setQuestionSet(null);
    questionSetRef.current = null;
    pendingPromptRef.current = "";
    setContexts([]);
    setRightTab("browser");
    setFocusFile(null);
  }, [selectProject]);

  /** The home dropdown's "new project": clear the selection, keep the welcome
   * open. The project is created on the first send, so an abandoned click
   * never leaves an empty project behind. */
  const prepareNewProject = useCallback(() => {
    selectProject(null);
    setQuestionSet(null);
    questionSetRef.current = null;
    pendingPromptRef.current = "";
    setContexts([]);
    setFocusFile(null);
    setRightTab("browser");
  }, [selectProject]);

  /**
   * "Open in Clyra Code" from the embedded OpenDesign UI. The design surface
   * fades out, the project folder is imported, the Code workspace opens with
   * it (a fresh "Continue in Clyra Code" task so the preview panel appears
   * immediately), and the preview server starts serving the generated page.
   */
  const handleOpenDesignSendToCode = useCallback(async (openDesignProjectId: string, projectName?: string) => {
    // Smooth hand-off: fade the design surface out while the import runs,
    // then land on the Code workspace already showing the project.
    setDesignExiting(true);
    await new Promise((resolve) => setTimeout(resolve, 260));
    try {
      const imported = await api.importOpenDesignProject(openDesignProjectId, projectName);
      await loadProjects();
      changeMode("code");
      setRightTab("browser");
      await api.startRuntime(imported.id).catch(() => undefined);
      const session = await api.createSession(imported.id, "Continue in Clyra Code").catch(() => null);
      if (session) {
        await selectThread(imported.id, session.id);
      } else {
        selectProject(imported.id);
      }
    } catch (error) {
      console.error("OpenDesign handoff failed:", error);
      setRightTab("browser");
    } finally {
      setDesignExiting(false);
    }
  }, [api, changeMode, loadProjects, selectProject, selectThread]);

  const handleDeleteChat = useCallback(async (projectId: string, sessionId: string) => {
    if (!window.confirm("Delete this chat? Project files will not be changed.")) return;
    try {
      await api.deleteSession(projectId, sessionId);
      const remaining = (await api.listSessions(projectId)).filter((thread) => thread.id !== sessionId);
      setThreadsByProject((prev) => ({ ...prev, [projectId]: remaining }));
      if (state.activeProjectId === projectId && state.sessionId === sessionId) {
        if (remaining[0]) await selectThread(projectId, remaining[0].id);
        else selectProject(projectId);
      }
    } catch { /* leave the existing thread visible if deletion fails */ }
  }, [selectProject, selectThread, state.activeProjectId, state.sessionId]);

  /* -------------------- render -------------------- */
  return (
    <motion.div
      ref={shellRef}
      className="clyra-code-root flex h-full w-full flex-col overflow-hidden"
      initial={{ opacity: 0 }}
      // Library "Open" hands off through the same pure fade used when the
      // workspace is first entered: fade out, land on the new project, fade in.
      animate={{ opacity: handoffFading ? 0 : 1 }}
      transition={{ duration: reducedMotion ? 0 : 0.32, ease: [0.22, 1, 0.36, 1] }}
    >
      {/* The rail and the workspace sit side by side; the terminal docks under both. */}
      <div className="flex min-h-0 w-full flex-1 overflow-hidden">
      {/* The app rail, as in Codex: surfaces and the Library as icons on the far left. */}
      <AppRail mode={mode} onChange={changeMode} onOpenLibrary={() => { if (mode !== "code") changeMode("code"); setLibraryOpen(true); }} />
      <div className="relative h-full min-h-0 min-w-0 flex-1 overflow-hidden">
      {/* OpenDesign embed. Mounted once so the Design tab switches instantly
          (the iframe stays loaded in the background) and never reloads. */}
      <motion.div
        initial={false}
        animate={designExiting ? { opacity: 0, scale: 0.992 } : { opacity: 1, scale: 1 }}
        transition={{ duration: reducedMotion ? 0 : 0.26, ease: [0.22, 1, 0.36, 1] }}
        className={cn(
          "absolute inset-0 z-30 flex flex-col bg-white",
          (mode as WorkspaceMode) === "design" ? "" : "hidden",
        )}
        aria-hidden={(mode as WorkspaceMode) === "design" ? undefined : true}
      >
        <div className="flex min-h-0 flex-1 flex-col">
          <OpenDesignPanel onSendToCode={handleOpenDesignSendToCode} />
        </div>
      </motion.div>
      <div
        className="relative flex h-full min-h-0 w-full flex-1 overflow-hidden"
        aria-hidden={(mode as WorkspaceMode) === "design" ? true : undefined}
      >
      {/* Narrow widths: the same sidebar as an off-canvas drawer with a scrim. */}
      {narrow && drawerOpen ? (
        <div aria-hidden onClick={closeDrawer} className="fixed inset-0 z-40 bg-black/20" />
      ) : null}
      <Sidebar
        projects={visibleProjects}
        threadsByProject={threadsByProject}
        activeProjectId={state.activeProjectId}
        activeSessionId={state.sessionId}
        runningSessionId={running ? state.sessionId : null}
        failedSessionId={state.runState === "failed" ? state.sessionId : null}
        waitingSessionId={questionSet && state.sessionId ? state.sessionId : null}
        variant={narrow ? "drawer" : "rail"}
        collapsed={narrow ? !drawerOpen : sidebarCollapsed}
        width={railWidth}
        onResizeWidth={updateRailWidth}
        macInset={macInset}
        sort={sidebarSort}
        onSortChange={updateSidebarSort}
        onToggleCollapsed={narrow ? closeDrawer : toggleSidebarCollapsed}
        onOpenExisting={() => void requestOpenExistingProject()}
        onSetProjectPinned={setProjectPinned}
        onRenameProject={renameProjectFromSidebar}
        onSelectProject={(id) => {
          // Clicking the project that is already open only expands or collapses
          // it. Re-selecting it would reset the open conversation to the welcome.
          if (id === state.activeProjectId) return;
          // A project opens where its work is: the most recent task, if any.
          const latest = threadsByProject[id]?.[0];
          if (latest) void selectThread(id, latest.id);
          else selectProject(id);
          setContexts([]);
          setRightTab("browser");
          setFocusFile(null);
          if (narrow) closeDrawer();
        }}
        onSelectChat={(projectId, sessionId) => {
          void selectThread(projectId, sessionId);
          setContexts([]);
          setRightTab("browser");
          setFocusFile(null);
          if (narrow) closeDrawer();
        }}
        onNewProject={requestNewProject}
        newProjectLabel={mode === "design" ? "New design" : "New project"}
        noun={mode === "design" ? "Designs" : "Projects"}
        onNewChat={handleNewChat}
        onRenameChat={(projectId, sessionId, title) => {
          void api.renameSession(projectId, sessionId, title).then(() => refreshThreads());
        }}
        onDeleteChat={(projectId, sessionId) => void handleDeleteChat(projectId, sessionId)}
        onRemoveProject={hideProject}
        launcherProjectIds={userApps.map((app) => app.projectId)}
        onToggleLauncher={(projectId, name, add) => { if (add) addUserApp(projectId, name); else removeUserApp(projectId); }}
        onOpenProjectFolder={(projectId) => {
          void api.openProjectFolder(projectId).catch((error) => {
            console.error("Could not open the project folder:", error);
          });
        }}
      />

      {/* -------- centre: agent conversation -------- */}
      <motion.section
        initial={false}
        animate={{ width: conversationTargetWidth }}
        transition={reducedMotion || dragging ? { duration: 0 } : PANEL_EASE}
        className="cc-conversation-panel flex min-h-0 shrink-0 flex-col overflow-hidden bg-[color:var(--main-background)]"
      >
        {state.connection === "reconnecting" && running ? (
          <motion.div
            initial={reducedMotion ? false : { opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
            className="border-b border-[color:var(--border-subtle)] bg-[#fff8ec] px-4 py-1.5 text-center text-[11.5px] text-[color:var(--warning-amber)]"
          >
            Connection interrupted. Reconnecting…
          </motion.div>
        ) : null}

        {/* All header controls are inline now (no floating overlay), so the
            title flexes between them and nothing can overlap at any width. */}
        <header className={cn("cc-workspace-header relative flex h-[48px] shrink-0 items-center gap-2 px-3.5", macInset && (narrow || sidebarCollapsed) && "pl-[78px]")}>
          {narrow && !drawerOpen ? (
            <button
              ref={drawerOpenerRef}
              type="button"
              aria-label="Open sidebar"
              title="Open sidebar"
              aria-expanded={drawerOpen}
              onClick={() => setDrawerOpen(true)}
              className="flex h-[31px] w-[31px] shrink-0 items-center justify-center rounded-[9px] text-[#5F6368] transition-colors duration-150 hover:bg-black/[0.045] focus-visible:ring-2 focus-visible:ring-[#3977F6]/35"
            >
              <PanelLeftOpen className="h-[16px] w-[16px]" strokeWidth={1.6} />
            </button>
          ) : null}
          {!narrow && sidebarCollapsed ? (
            <button
              type="button"
              aria-label="Expand sidebar"
              title="Expand sidebar"
              onClick={toggleSidebarCollapsed}
              className="flex h-[31px] w-[31px] shrink-0 items-center justify-center rounded-[9px] text-[#5F6368] transition-colors duration-150 hover:bg-black/[0.045]"
            >
              <PanelLeftOpen className="h-[16px] w-[16px]" strokeWidth={1.6} />
            </button>
          ) : null}
          {activeProject ? (
            <>
              {/* One line, as in Codex: a folder glyph, the task, and the project it belongs to. */}
              <div className="flex min-w-0 flex-1 items-center gap-2">
                <Folder className="h-[15px] w-[15px] shrink-0 text-[#5D5D5D]" strokeWidth={1.7} aria-hidden />
                <h1 className="min-w-0 shrink truncate text-[14px] font-medium tracking-[-0.01em] text-[var(--text-primary)]">
                  {taskTitle || "New task"}
                </h1>
                <span className="hidden min-w-[60px] max-w-[40%] shrink-[3] truncate text-[13px] text-[var(--text-tertiary)] lg:inline">{activeProject.name}</span>
              </div>
              {running ? (
                <span className="cc-thread-status" aria-live="polite">
                  <span className="cc-thread-status-dot" aria-hidden />
                  {agentStatus.label}
                </span>
              ) : null}
              {diffTotals.files ? (
                <button
                  type="button"
                  title="Review changes"
                  onClick={() => { setRightTab("changes"); setFocusFile(null); setRightPanelOpen(true); }}
                  className="cc-thread-chip"
                >
                  <span className="text-[#1a7f37]">+{diffTotals.additions}</span>
                  <span className="text-[#cf222e]">−{diffTotals.deletions}</span>
                </button>
              ) : null}
              {!narrow ? (
                <button
                  type="button"
                  title="Open project folder"
                  aria-label="Open project folder"
                  onClick={() => void api.openProjectFolder(activeProject.id).catch((error) => console.error("Could not open the project folder:", error))}
                  className="cc-thread-chip"
                >
                  <FolderOpen className="h-[15px] w-[15px]" strokeWidth={1.7} />
                </button>
              ) : null}
              {mode === "code" && activeProject ? (
                <GitHubPopover projectId={activeProject.id} projectName={activeProject.name} />
              ) : null}
              {mode === "code" && desktopProject && preview.session?.url && canLaunchElectronPreview ? (
                <button
                  type="button"
                  onClick={() => void launchDesktopPreview()}
                  className="flex h-[30px] shrink-0 items-center gap-1.5 rounded-[8px] px-2.5 text-[11.5px] font-medium text-[#3977F6] transition-colors duration-150 hover:bg-[#3977F6]/[0.07]"
                  title="Launch this desktop project in Electron"
                >
                  <Play className="h-[12px] w-[12px]" fill="currentColor" strokeWidth={1.8} />
                  <span className="hidden md:inline">Launch app</span>
                </button>
              ) : null}
              <button
                type="button"
                aria-label={rightPanelOpen ? "Close preview" : "Open preview"}
                title={rightPanelOpen ? "Close preview" : "Open preview"}
                onClick={() => setRightPanelOpen((open) => !open)}
                className="flex h-[37px] w-[37px] shrink-0 items-center justify-center rounded-[10px] text-[#5F6368] transition-colors duration-150 hover:bg-black/[0.045]"
              >
                {rightPanelOpen ? <PanelRightClose className="h-[18px] w-[18px]" strokeWidth={1.65} /> : <PanelRightOpen className="h-[18px] w-[18px]" strokeWidth={1.65} />}
              </button>
            </>
          ) : <span className="flex-1" aria-hidden />}
        </header>

        {
          <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
          <AnimatePresence mode="popLayout" initial={false}>
            {!hasConversation ? (
              <motion.div
                key="welcome"
                // Re-entry (New task) is the same pure fade as first entering
                // Vibe Coder: opacity only, nothing translates, so the trip
                // home never reads as movement or heavy layout work.
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0, transition: { duration: reducedMotion ? 0 : 0.18, ease: [0.2, 0.8, 0.2, 1] } }}
                transition={{ duration: reducedMotion ? 0 : 0.22, ease: [0.2, 0.8, 0.2, 1] }}
                className="cc-welcome cc-scroll flex min-h-0 flex-1 flex-col justify-center overflow-y-auto pt-[14vh]"
              >
                <div className="mx-auto flex w-full max-w-[620px] flex-col items-center px-5 text-center">
                  <ClyraMark size={40} />
                  <h2 className="mt-4 text-[25px] font-medium leading-[1.18] tracking-[-0.03em] text-[var(--text-primary)]">
                    {mode === "design" ? "What are we designing?" : "What do you want to build?"}
                  </h2>
                  <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }} className="mt-2 text-[14px] leading-[1.5] text-[var(--text-tertiary)]">
                    {mode === "design" ? (
                      "Pick a house style and a layout, then describe the screen."
                    ) : (
                      <>{welcomeSubtitle[0]}<span className="text-[var(--accent-blue)]">{welcomeSubtitle[1]}</span>{welcomeSubtitle[2]}</>
                    )}
                  </motion.p>
                  <div className="mt-[18px] flex justify-center">
                    <WelcomeProjectPicker
                      projects={visibleProjects}
                      activeProjectId={state.activeProjectId}
                      onSelectProject={(projectId) => selectProject(projectId)}
                      onNewProject={prepareNewProject}
                      newProjectLabel={mode === "design" ? "New design" : "New project"}
                      open={welcomeMenu === "projects"}
                      onOpenChange={(open) => setWelcomeMenu(open ? "projects" : null)}
                    />
                  </div>
                  {aiPill ? <div className="mt-4 w-full">{aiPill}</div> : null}
                  <div ref={welcomeComposerRef} className="mt-[26px] w-full">
                    <Composer
                      running={false}
                      model={state.model}
                      contexts={contexts}
                      onRemoveContext={(id) => setContexts((prev) => prev.filter((c) => c.id !== id))}
                      onSubmit={submitFromWelcome}
                      onStop={cancelRun}
                      placeholder={mode === "design" ? "Describe the screen to design…" : "Ask Clyra to build, fix, or change something…"}
                      welcome
                      brief={mode === "design" ? null : briefPlatform}
                      onBriefClear={() => setBriefPlatform(null)}
                      question={questionSet}
                      questionSubmitting={questionSubmitting}
                      onQuestionSubmit={handleQuestionSubmit}
                      onQuestionBack={handleQuestionBack}
                      effort={effort}
                      onEffortChange={setEffort}
                      effortMenuOpen={welcomeMenu === "effort"}
                      onEffortMenuOpenChange={(open) => setWelcomeMenu(open ? "effort" : null)}
                    />
                  </div>
                  {mode === "design" ? (
                    <div className="mt-4 w-full">
                      <DesignPicker systems={catalog.systems} templates={catalog.templates} systemId={designSystemId} templateId={designTemplateId} onSystem={setDesignSystemId} onTemplate={setDesignTemplateId} />
                    </div>
                  ) : null}
                  {importError ? <p className="mt-2 text-[11.5px] text-[#D64545]">{importError}</p> : null}
                  {recentProjects.length ? (
                    <div className="mt-8 w-full text-left">
                      <p className="mb-2 px-0.5 text-[10.5px] font-medium uppercase tracking-[0.06em] text-[#C1C3C7]">Recent</p>
                      <div className="grid grid-cols-3 gap-2.5">
                        {recentProjects.slice(0, 3).map((project) => (
                          <button
                            key={project.id}
                            type="button"
                            title={project.displayName || project.name || project.id}
                            onClick={() => selectProject(project.id)}
                            className="group flex flex-col overflow-hidden rounded-[11px] border border-[var(--border-subtle)] bg-[var(--composer-surface)] text-left shadow-[0_1px_2px_rgba(0,0,0,0.02)] transition-[border-color,transform] duration-150 hover:-translate-y-0.5 hover:border-black/[0.14]"
                          >
                            <span className="aspect-[16/10] w-full overflow-hidden bg-[var(--surface-muted)]">
                              <img src={`/api/vibe/projects/${project.id}/thumbnail`} alt="" loading="lazy" className="h-full w-full object-cover object-top transition-transform duration-300 group-hover:scale-[1.03]" onError={(event) => { event.currentTarget.style.visibility = "hidden"; }} />
                            </span>
                            <span className="flex flex-col gap-0.5 px-2.5 py-2">
                              <span className="min-w-0 truncate text-[11.5px] font-medium text-[#3A3C40]">{project.displayName || project.name || project.id}</span>
                              <span className="text-[10px] text-[#B0B2B6]">{formatRecentTime(project.updatedAt)}</span>
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              </motion.div>
            ) : (
              <motion.div
                key="conversation"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0, transition: { duration: reducedMotion ? 0 : 0.18, ease: [0.22, 1, 0.36, 1] } }}
                transition={{ duration: reducedMotion ? 0 : 0.26, ease: [0.22, 1, 0.36, 1] }}
                className="flex min-h-0 flex-1 flex-col"
              >
                {/* A library app's thread keeps a quiet welcome prompt at the top:
                    the setup run finishes, then the user is invited to change it. */}
                {libraryWelcome && state.sessionId === libraryWelcome.sessionId && state.log.length > 0 ? (
                  <div className="mx-auto mt-3 flex w-full max-w-[688px] items-center gap-3 rounded-[12px] border border-[var(--border-subtle)] bg-[var(--composer-surface)] px-4 py-2.5 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
                    <span className="cc-squircle flex h-8 w-8 shrink-0 items-center justify-center bg-[#3977F6]/[0.09] text-[#3977F6]"><LibraryBig className="h-4 w-4" strokeWidth={1.7} /></span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12.5px] font-medium text-[var(--text-primary)]">{libraryWelcome.name} {running ? "is being set up" : "is ready"}</span>
                      <span className="block text-[11.5px] leading-[1.45] text-[var(--text-tertiary)]">From the Clyra Library — what would you like to change or improve?</span>
                    </span>
                  </div>
                ) : null}
                {state.log.length === 0 ? (
                  <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-1 px-6 text-center">
                    <p className="text-[13px] font-medium text-[#45474C]">{state.error ? "Task unavailable" : state.loadingSession ? "Opening task…" : "No messages in this task yet"}</p>
                    <p className="max-w-[360px] text-[11.5px] leading-[1.5] text-[#96989D]">
                      {state.error ?? (state.loadingSession ? "Loading its messages and changes." : "Ask Clyra below to start this task. Its history stays with the project.")}
                    </p>
                  </div>
                ) : (
                  <Conversation
                    state={state}
                    running={running}
                    onReplyPermission={(id, response) => void replyPermission(id, response)}
                    onRetry={retryAction}
                    onOpenTerminal={() => setTerminalOpen(true)}
                    onOpenFile={openFileDiff}
                    onOpenChanges={() => setRightTab("changes")}
                    onUndoCheckpoint={() => void restoreLastCheckpoint()}
                    onStop={() => void cancelRun()}
                  />
                )}
                {state.runState === "failed" && state.error ? (
                  <div className="mx-auto mb-1 flex w-full max-w-[688px] items-center gap-2 px-5 text-[11.5px] text-[#76787D]">
                    <span className="min-w-0 flex-1 truncate">The last run needs attention.</span>
                    <button
                      type="button"
                      onClick={addTerminalErrorContext}
                      className="shrink-0 rounded-[6px] px-1.5 py-1 font-medium text-[#3977F6] transition-colors hover:bg-[#3977F6]/[0.06]"
                    >
                      Add error to chat
                    </button>
                  </div>
                ) : null}
                {aiPill}
                {/* Codex keeps the space above the composer clear: only the token count, when there is one. */}
                {tokensLabel ? (
                  <footer className="flex h-[17px] shrink-0 items-center justify-end px-4 text-[10.5px] text-[#A0A2A6]">
                    <span className="cc-counter">{tokensLabel}</span>
                  </footer>
                ) : null}
                <div ref={conversationComposerRef}>
                <Composer
                  running={running}
                  model={state.model}
                  contexts={contexts}
                  onRemoveContext={(id) => setContexts((prev) => prev.filter((c) => c.id !== id))}
                  onSubmit={submitPrompt}
                  onStop={() => void cancelRun()}
                  question={questionSet}
                  questionSubmitting={questionSubmitting}
                  onQuestionSubmit={handleQuestionSubmit}
                  onQuestionBack={handleQuestionBack}
                  effort={effort}
                  onEffortChange={setEffort}
                  plan={plan}
                />
                </div>
              </motion.div>
            )}
          </AnimatePresence>
          </div>
        }
      </motion.section>

      <motion.div
        initial={false}
        animate={rightPanelOpen
          ? { width: previewTargetWidth, x: 0, opacity: 1 }
          : { width: 0, x: 4, opacity: 0 }}
        transition={reducedMotion || dragging ? { duration: 0 } : PANEL_EASE}
        className={cn("flex min-h-0 shrink-0 overflow-hidden", !rightPanelOpen && "pointer-events-none")}
        aria-hidden={!rightPanelOpen || undefined}
      >
          {narrow ? null : <div className="cc-resize-handle" data-active={dragging || undefined} onPointerDown={onDragStart} role="separator" aria-orientation="vertical" />}
          <motion.div
            className="flex min-h-0 min-w-0 flex-1"
            initial={false}
            animate={{ opacity: previewContentVisible ? 1 : 0, x: previewContentVisible ? 0 : 4 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
          >
            <RightPanel
              state={state}
              actionList={actionList}
              plan={plan}
              tab={rightTab}
              onTabChange={(tab) => { setRightTab(tab); if (tab !== "changes") setFocusFile(null); }}
              preview={preview}
              onAddContext={(context) => setContexts((prev) => (prev.some((item) => item.detail === context.detail) ? prev : [...prev, context]))}
              focusFile={focusFile}
              agentRunning={running}
              onOpenTerminal={() => setTerminalOpen(true)}
              onVisualEdit={(instruction) => void startRun(instruction)}
              onVisualSourceEdit={recordVisualEdit}
              onPreviewError={handlePreviewError}
              fullscreen={previewFullscreen}
              onToggleFullscreen={() => setPreviewFullscreen((value) => !value)}
              onClose={() => setRightPanelOpen(false)}
            />
          </motion.div>
      </motion.div>
      </div>

      <TemplateLibrary
        open={libraryOpen && mode === "code"}
        projectId={state.activeProjectId}
        onClose={() => setLibraryOpen(false)}
        onImported={(projectId) => {
          setLibraryOpen(false);
          void loadProjects().then(() => selectProject(projectId));
        }}
        existingProjectIds={state.projects.map((project) => project.id)}
        onOpenInstalled={(projectId, entry) => {
          setLibraryOpen(false);
          setHandoffFading(true);
          void loadProjects().then(async () => {
            selectProject(projectId);
            setSidebarCollapsed(false);
            try { localStorage.setItem(SIDEBAR_KEY, "0"); } catch { /* storage unavailable */ }
            setRightPanelOpen(true);
            setRightTab("browser");
            setLibraryWelcome({ name: entry.name, sessionId: null });
            if (entry.aiPowered) rememberAiProject(projectId, entry.name);
            setAutoStart({ projectId, name: entry.name, repositoryUrl: entry.repositoryUrl, aiPowered: entry.aiPowered });
            await new Promise((resolve) => window.setTimeout(resolve, reducedMotion ? 0 : 240));
            setHandoffFading(false);
          });
        }}
        onAskClyra={(entry) => {
          void submitPrompt(
            `Inspect ${entry.name} as a possible starting point for this project. Its public source is ${entry.repositoryUrl}. Explain the architecture, compatible parts and license considerations. Do not clone, install dependencies, run commands or copy source until I explicitly choose an import mode.`,
            [],
            "plan",
          );
        }}
      />

      </div>
      </div>
      <div aria-hidden={(mode as WorkspaceMode) === "design" ? true : undefined}>
      <TerminalPanel
        projectId={state.activeProjectId}
        open={terminalOpen}
        height={terminalHeight}
        onHeightChange={setTerminalHeight}
        onToggle={() => setTerminalOpen((open) => !open)}
        reportedError={terminalError}
        agentActivityCount={agentActivityCount}
      />
      </div>
    </motion.div>
  );
}
