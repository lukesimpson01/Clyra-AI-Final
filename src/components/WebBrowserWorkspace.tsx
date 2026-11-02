import {
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Bookmark,
  Copy,
  Crop,
  Download,
  Ellipsis,
  EllipsisVertical,
  Globe2,
  History,
  Loader2,
  LockKeyhole,
  Minus,
  MousePointerClick,
  PanelRightClose,
  Plus,
  RotateCcw,
  RotateCw,
  Search,
  Settings2,
  Sparkles,
  Star,
  X,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { createPortal } from "react-dom";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";
import { cn } from "../lib/utils";
import { getElectronDesktop, isElectronRuntime, requestElectronBrowser } from "../lib/electron-runtime";
import { ElectronWebContentsSurface } from "./ElectronWebContentsSurface";
import { BrowserStartPage, faviconFor, hasUsedAskClyra, isBrowserStartPageUrl, looksLikeUrl, markAskClyraUsed } from "./BrowserStartPage";
import { BrowserAgentAura } from "./BrowserAgentAura";
import { ActionStream, AssistantMessage, ChatEmpty, ThinkingRow, type FinishedRun, type RunRow, type RunRowKind } from "./browser/AtlasChat";
import { AtlasInternalPage } from "./browser/AtlasInternalPages";

type AgentStatus =
  | "idle"
  | "planning"
  | "observing"
  | "executing"
  | "verifying"
  | "recovering"
  | "waiting_for_user"
  | "paused"
  | "completed"
  | "failed"
  | "cancelled";

type BrowserSettings = {
  /* Google only. Kept in the type so stored profiles still parse. */
  defaultSearchEngine: "google";
  restoreTabs: boolean;
  saveHistory: boolean;
  showBookmarksBar: boolean;
  showAiCursor: boolean;
  showAiActionLabels: boolean;
  aiCursorSpeed: "instant" | "fast" | "natural";
  reducedMotion: boolean;
  performanceMode: "quality" | "balanced" | "efficient";
  privateMode: boolean;
};

type BrowserTab = {
  id: string;
  title: string;
  url: string;
  active: boolean;
  loading: boolean;
  favicon?: string;
  zoom: number;
};

type InternalBrowserPage = "history" | "bookmarks" | "settings" | "downloads";

type InternalBrowserTab = {
  id: string;
  page: InternalBrowserPage;
};

type BrowserHistoryEntry = {
  id: string;
  title: string;
  url: string;
  visitedAt: string;
  visitCount: number;
  query?: string;
};

type BrowserBookmark = {
  id: string;
  title: string;
  url: string;
  folder: string;
};

type BrowserDownload = {
  id: string;
  filename: string;
  url: string;
  status: "running" | "complete" | "failed" | "cancelled";
  path?: string;
  error?: string;
};

interface BrowserState {
  url: string;
  title: string;
  frameVersion: number;
  viewport: { width: number; height: number; scrollX: number; scrollY: number; pageHeight: number };
  loading: boolean;
  tabs: BrowserTab[];
  activeTabId: string;
  canGoBack: boolean;
  canGoForward: boolean;
  secure: boolean;
  zoom: number;
  history: BrowserHistoryEntry[];
  bookmarks: BrowserBookmark[];
  recentlyClosed: Array<{ id: string; title: string; url: string; closedAt: string }>;
  downloads: BrowserDownload[];
  settings: BrowserSettings;
  agent: { status: AgentStatus; paused: boolean; manualControl: boolean; task?: string };
  /** The most recent cursor position from *any* agent-driven action against
   * this browser, including ones triggered outside this component (Cowork's
   * Hermes/Mission Runtime tool calls) — carried on every state poll, not
   * only this component's own direct action responses. */
  cursor?: { x: number; y: number; kind: AgentCursor["kind"]; label: string; id: number } | null;
}

type BrowserAction =
  | { type: "back" | "forward" | "reload" | "stop_loading" | "open_tab" | "restore_closed_tab" }
  | { type: "switch_tab" | "close_tab" | "duplicate_tab"; tabId: string }
  | { type: "click_at"; x: number; y: number }
  | { type: "press"; key: string }
  | { type: "type"; text: string; submit?: boolean; clearFirst?: boolean }
  | { type: "scroll"; direction: "up" | "down"; amount: number };

type AgentCursor = {
  id: number;
  x: number;
  y: number;
  kind: "move" | "click" | "double_click" | "right_click" | "hover" | "type" | "scroll";
  label: string;
};

type TaskPlan = {
  goal: string;
  steps: Array<{ id: string; label: string; status: "pending" | "active" | "complete" | "blocked" }>;
  successCriteria: string[];
};

type StepEvaluation = { verdict: "Success" | "Failure" | "Uncertain"; reason?: string };

type CompletionEvidence = { url: string; title: string; checks: string[] };

/** A progress event streamed over SSE or replayed from the persisted session. */
type RunEvent = {
  phase?: AgentStatus;
  kind?: string;
  message?: string;
  step?: number;
  action?: Record<string, unknown> & { type?: string };
  evaluation?: StepEvaluation;
  memory?: string;
  nextGoal?: string;
  actionIndex?: number;
  actionCount?: number;
  success?: boolean;
  evidence?: CompletionEvidence;
};

type RunItem =
  | { id: string; kind: "reasoning"; step?: number; evaluation?: StepEvaluation; nextGoal: string; memory?: string }
  | { id: string; kind: "action"; step?: number; actionType: string; label: string; icon: ActionIconKey; status: "running" | "success" | "error"; detail: string; result?: string }
  | { id: string; kind: "recovery" | "strategy"; message: string }
  | { id: string; kind: "ask"; question: string }
  | { id: string; kind: "complete"; success: boolean; message: string; evidence?: CompletionEvidence };

type AgentSession = {
  id: string;
  task: string;
  status: AgentStatus;
  message: string;
  startedAt: string;
  updatedAt: string;
  plan?: TaskPlan;
  completedCriteria: number;
  totalCriteria: number;
  factCount: number;
  recentEvents: Array<RunEvent & { phase: AgentStatus; message: string }>;
  result?: {
    message: string;
    steps: string[];
    facts: Array<{ claim: string; sourceUrl: string }>;
  };
};

interface AgentMessage {
  id: string;
  role: "assistant" | "user";
  content: string;
  steps?: string[];
  facts?: Array<{ claim: string; sourceUrl: string }>;
  /** The finished action log, kept collapsed above the answer. */
  run?: FinishedRun;
  error?: boolean;
}

const BROWSER_CHAT_STORAGE = "clyra-browser-agent-chat-v3";
const BROWSER_CHAT_STORAGE_LEGACY = "clyra-browser-agent-chat-v2";
const ACTIVE_AGENT_PHASES = new Set<AgentStatus>([
  "planning",
  "observing",
  "executing",
  "verifying",
  "recovering",
  "waiting_for_user",
  "paused",
]);

/** One shared agent chat for the whole browser workspace (all tabs). */
function initialAgentMessages(): AgentMessage[] {
  const withoutRetiredWelcome = (messages: AgentMessage[]) => messages.filter((message) =>
    !(message.role === "assistant" && /^Ready when you are\.?$/i.test(message.content.trim())),
  );
  if (typeof window !== "undefined") {
    try {
      const raw = window.localStorage.getItem(BROWSER_CHAT_STORAGE)
        || window.localStorage.getItem(BROWSER_CHAT_STORAGE_LEGACY)
        || "[]";
      const saved = JSON.parse(raw) as AgentMessage[] | Record<string, AgentMessage[]>;
      if (Array.isArray(saved)) return withoutRetiredWelcome(saved).slice(-60);
      if (saved && typeof saved === "object") {
        // Migrate v2 per-tab transcripts into one shared session.
        const merged = Object.values(saved)
          .filter((messages): messages is AgentMessage[] => Array.isArray(messages))
          .flat();
        return withoutRetiredWelcome(merged).slice(-60);
      }
    } catch {
      // A malformed local draft should not prevent the browser from opening.
    }
  }
  return [];
}

/** Turns provider/transport failures into something a person can act on. */
function friendlyAgentError(message: string) {
  if (/insufficient balance|insufficient_quota|exceeded your current quota|payment required/i.test(message)) {
    return "The AI model account is out of credit, so I can't think through this right now. Top up the DeepSeek account (or add a different API key in Settings) and try again.";
  }
  if (/api key|unauthori[sz]ed|invalid_api_key|401/i.test(message)) {
    return "The AI model key was rejected. Check the DeepSeek API key in Clyra's settings, then try again.";
  }
  if (/timed out|timeout/i.test(message)) return "The model took too long to respond. Please try again.";
  if (/failed to fetch|network|ECONNREFUSED/i.test(message)) return "I couldn't reach Clyra's browser service. Check that Clyra is running, then try again.";
  return message;
}

function looksLikeStaleFailureTranscript(messages: AgentMessage[]) {
  if (!messages.length) return false;
  const lastAssistant = [...messages].reverse().find((message) => message.role === "assistant");
  if (!lastAssistant) return false;
  return /could not complete|task not completed|was not verified|i stopped instead of looping|failed/i.test(lastAssistant.content);
}

type SideView = "agent" | "history" | "bookmarks" | "downloads" | "settings";

type SnipCard = {
  image: string;
  text: string;
  rect: { x: number; y: number; width: number; height: number };
  pageUrl?: string;
  pageTitle?: string;
  left: number;
  top: number;
  status: "loading" | "done" | "error";
  direct?: string;
  explanation?: string;
  error?: string;
};

const defaultSettings: BrowserSettings = {
  defaultSearchEngine: "google",
  restoreTabs: true,
  saveHistory: true,
  showBookmarksBar: false,
  showAiCursor: true,
  showAiActionLabels: true,
  aiCursorSpeed: "fast",
  reducedMotion: false,
  performanceMode: "balanced",
  privateMode: false,
};

function displayHost(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "") || "New tab";
  } catch {
    return "New tab";
  }
}

function displayPageName(url: string, title?: string) {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, "").toLowerCase();
    const knownNames: Record<string, string> = {
      "google.com": "Google",
      "github.com": "GitHub",
      "youtube.com": "YouTube",
      "docs.google.com": "Google Docs",
      "notion.so": "Notion",
      "figma.com": "Figma",
    };
    if (knownNames[hostname]) return knownNames[hostname];
    const hostLabel = hostname
      .split(".")
      .slice(0, -1)
      .join(" ")
      .replace(/[-_]+/g, " ")
      .replace(/\b\w/g, (letter) => letter.toUpperCase());
    if (hostLabel) return hostLabel;
  } catch {
    // A new tab is not necessarily a valid URL.
  }
  return title?.trim() || "New tab";
}

function compactUrl(url: string) {
  try {
    const parsed = new URL(url);
    return `${parsed.hostname.replace(/^www\./, "")}${parsed.pathname === "/" ? "" : parsed.pathname}`;
  } catch {
    return url;
  }
}

function responseError(payload: unknown, fallback: string) {
  if (
    payload &&
    typeof payload === "object" &&
    "error" in payload &&
    payload.error &&
    typeof payload.error === "object" &&
    "message" in payload.error
  ) {
    return String(payload.error.message);
  }
  return fallback;
}

type ActionIconKey =
  | "click" | "keyboard" | "navigate" | "search" | "scrollDown" | "scrollUp"
  | "back" | "forward" | "reload" | "tab" | "wait" | "read" | "check" | "hover" | "done" | "ask" | "generic";

function truncateLabel(value: string, max = 30) {
  const clean = value.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

function describeTarget(target: unknown): string {
  if (typeof target === "number") return `element ${target}`;
  if (target && typeof target === "object") {
    const record = target as Record<string, unknown>;
    const name = record.name || record.label || record.text || record.placeholder || record.testId || record.elementId;
    if (name) return `'${truncateLabel(String(name), 26)}'`;
  }
  return "the element";
}

/** One-line, browser-use style summary of a runtime action for the chat feed. */
function actionSummary(action: Record<string, unknown> & { type?: string }): { label: string; icon: ActionIconKey } {
  const type = String(action.type || "");
  switch (type) {
    case "click": case "double_click": case "right_click": case "click_at":
      return { label: `Clicking ${"x" in action ? "the page" : describeTarget(action.target)}`, icon: "click" };
    case "type":
      return { label: action.text ? `Typing "${truncateLabel(String(action.text), 24)}"` : "Typing into a field", icon: "keyboard" };
    case "press": case "press_key":
      return { label: `Pressing ${truncateLabel(String(action.key || "a key"), 16)}`, icon: "keyboard" };
    case "key_combination":
      return { label: `Pressing ${(Array.isArray(action.keys) ? action.keys : []).join("+") || "keys"}`, icon: "keyboard" };
    case "navigate": case "open_tab":
      return { label: `Opening ${displayHost(String(action.url || "")) || "a new tab"}`, icon: type === "open_tab" ? "tab" : "navigate" };
    case "search":
      return { label: `Searching "${truncateLabel(String(action.query || ""), 26)}"`, icon: "search" };
    case "scroll":
      return { label: `Scrolling ${String(action.direction || "down")}`, icon: action.direction === "up" ? "scrollUp" : "scrollDown" };
    case "scroll_to":
      return { label: `Scrolling to ${describeTarget(action.target)}`, icon: "scrollDown" };
    case "scroll_to_top": return { label: "Scrolling to the top", icon: "scrollUp" };
    case "scroll_to_bottom": return { label: "Scrolling to the bottom", icon: "scrollDown" };
    case "go_back": case "back": return { label: "Going back", icon: "back" };
    case "go_forward": case "forward": return { label: "Going forward", icon: "forward" };
    case "reload": return { label: "Reloading the page", icon: "reload" };
    case "stop_loading": return { label: "Stopping the page load", icon: "reload" };
    case "switch_tab": return { label: "Switching tab", icon: "tab" };
    case "close_tab": return { label: "Closing a tab", icon: "tab" };
    case "duplicate_tab": return { label: "Duplicating the tab", icon: "tab" };
    case "restore_closed_tab": return { label: "Restoring a closed tab", icon: "tab" };
    case "wait": return { label: "Waiting for the page", icon: "wait" };
    case "read_page": case "extract": case "inspect_element": return { label: "Reading the page", icon: "read" };
    case "find_text": return { label: `Finding "${truncateLabel(String(action.text || ""), 22)}"`, icon: "search" };
    case "select_option": return { label: `Selecting ${truncateLabel(String(action.label || action.value || "an option"), 22)}`, icon: "check" };
    case "check": return { label: `Checking ${describeTarget(action.target)}`, icon: "check" };
    case "uncheck": return { label: `Unchecking ${describeTarget(action.target)}`, icon: "check" };
    case "hover": case "focus": return { label: `${type === "hover" ? "Hovering over" : "Focusing"} ${describeTarget(action.target)}`, icon: "hover" };
    case "drag": return { label: "Dragging an element", icon: "hover" };
    case "download": return { label: "Downloading a file", icon: "generic" };
    case "done": return { label: "Finishing up", icon: "done" };
    case "ask_user": return { label: "Asking you a question", icon: "ask" };
    default: return { label: truncateLabel(type.replace(/_/g, " ") || "Working", 30), icon: "generic" };
  }
}

let runItemSequence = 0;
const nextRunItemId = () => `run-${++runItemSequence}`;
const MAX_RUN_ITEMS = 80;

/** Folds one streamed progress event into the browser-use style run feed. */
function reduceRunItems(items: RunItem[], event: RunEvent): RunItem[] {
  const phase = event.phase;
  if (!phase) return items;
  const next = [...items];
  const finishRunning = (status: "success" | "error", result?: string) => {
    for (let index = next.length - 1; index >= 0; index -= 1) {
      const item = next[index];
      if (item.kind === "action" && item.status === "running") {
        next[index] = { ...item, status, result: result ?? item.result };
        return;
      }
    }
  };
  if (event.kind === "reasoning" && (event.nextGoal || event.evaluation || event.memory)) {
    next.push({
      id: nextRunItemId(),
      kind: "reasoning",
      step: event.step,
      evaluation: event.evaluation,
      nextGoal: event.nextGoal || event.message || "Deciding the next step",
      memory: event.memory,
    });
    return next.slice(-MAX_RUN_ITEMS);
  }
  if (phase === "executing" && event.action) {
    // A previous action still marked running had no explicit verification event.
    finishRunning("success");
    const summary = actionSummary(event.action);
    next.push({
      id: nextRunItemId(),
      kind: "action",
      step: event.step,
      actionType: String(event.action.type || ""),
      label: summary.label,
      icon: summary.icon,
      status: "running",
      detail: JSON.stringify(event.action, null, 2),
    });
    return next.slice(-MAX_RUN_ITEMS);
  }
  if (phase === "verifying" && event.action) {
    finishRunning("success", event.message);
    return next.slice(-MAX_RUN_ITEMS);
  }
  if (phase === "recovering") {
    finishRunning("error", event.message);
    const message = event.message || "Recovering";
    const last = next[next.length - 1];
    if (!(last && (last.kind === "recovery" || last.kind === "strategy") && last.message === message)) {
      next.push({ id: nextRunItemId(), kind: event.kind === "strategy" ? "strategy" : "recovery", message });
    }
    return next.slice(-MAX_RUN_ITEMS);
  }
  if (phase === "waiting_for_user") {
    next.push({ id: nextRunItemId(), kind: "ask", question: event.message || "The agent needs your input." });
    return next.slice(-MAX_RUN_ITEMS);
  }
  if (phase === "completed" || phase === "failed" || phase === "cancelled") {
    finishRunning(phase === "completed" ? "success" : "error");
    next.push({
      id: nextRunItemId(),
      kind: "complete",
      success: event.success ?? phase === "completed",
      message: event.message || "",
      evidence: event.evidence,
    });
    return next.slice(-MAX_RUN_ITEMS);
  }
  return items;
}

type WebBrowserWorkspaceProps = {
  /** A task drafted in the main Clyra composer before Browser mounts. */
  initialTaskDraft?: string;
  /** A deterministic navigation already requested and verified by Chat. */
  initialUrl?: string;
  /** Increments for every explicit Browse launch, including an empty draft. */
  launchRequestId?: number;
  /** Only used for read-only intents already approved by the user in Chat. */
  autoRunInitialTask?: boolean;
  onTaskDraftConsumed?: () => void;
};

export default function WebBrowserWorkspace({ initialTaskDraft = "", initialUrl = "", launchRequestId = 0, autoRunInitialTask = false, onTaskDraftConsumed }: WebBrowserWorkspaceProps) {
  const desktopChromium = isElectronRuntime();
  const [browserState, setBrowserState] = useState<BrowserState | null>(null);
  const [address, setAddress] = useState("");
  const [task, setTask] = useState("");
  // Loading the persisted Chromium state is passive work. Treating it as a
  // navigation made a freshly opened Browser look as though Clyra was already
  // reading the restored page.
  const [isBrowserBusy, setIsBrowserBusy] = useState(false);
  const [isAgentBusy, setIsAgentBusy] = useState(false);
  const [showAskClyraPulse, setShowAskClyraPulse] = useState(() => !hasUsedAskClyra());
  useEffect(() => {
    if (!showAskClyraPulse) return;
    const timer = window.setTimeout(() => setShowAskClyraPulse(false), 6_000);
    return () => window.clearTimeout(timer);
  }, [showAskClyraPulse]);
  const [snipBusy, setSnipBusy] = useState(false);
  const [snipCard, setSnipCard] = useState<SnipCard | null>(null);
  const [snipFollowUp, setSnipFollowUp] = useState("");
  const [snipFollowUpBusy, setSnipFollowUpBusy] = useState(false);
  const [sideView, setSideView] = useState<SideView>("agent");
  // Start with Ask Clyra closed so a new browser / new tab opens on the page canvas.
  const [sideOpen, setSideOpen] = useState(false);
  useEffect(() => {
    // /browse <request> comes from the main Clyra composer. Preserve the
    // request as an editable, page-aware draft; autonomous control begins
    // only after the user deliberately sends it from this workspace.
    try {
      const draft = window.sessionStorage.getItem("clyra-browser-task-draft");
      if (!draft) return;
      window.sessionStorage.removeItem("clyra-browser-task-draft");
      sideLockRef.current = true;
      setSideView("agent");
      setSideOpen(true);
      setTask(draft);
    } catch {
      // Storage can be unavailable in strict privacy contexts; direct
      // browser launch remains fully usable without an initial draft.
    }
  }, []);
  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState("");
  const [findResult, setFindResult] = useState<{ total: number; current: number } | null>(null);
  const findInputRef = useRef<HTMLInputElement | null>(null);
  const [omniboxFocused, setOmniboxFocused] = useState(false);
  /* What the reader has typed and what the page is showing are two different
     things. Browser state streams in continuously while a page loads, and
     every one of those updates used to overwrite the address bar — so a query
     typed during a load was silently replaced by the current URL, and Enter
     then "did nothing" because it re-navigated to where we already were.
     A ref rather than state: it must be readable inside applyState without
     making applyState depend on it, and it must never trigger a render. */
  const editingAddressRef = useRef(false);
  const [agentDemo] = useState(() => {
    if (typeof window === "undefined") return false;
    const mode = new URLSearchParams(window.location.search).get("browserDemo");
    return mode === "agent" || mode === "ebay" || mode === "typing" || mode === "click";
  });
  const [agentDemoKind] = useState(() => {
    if (typeof window === "undefined") return "agent" as const;
    const demo = new URLSearchParams(window.location.search).get("browserDemo");
    if (demo === "ebay") return "ebay" as const;
    // A focused visual-QA state for the real typing cursor treatment. It is
    // intentionally query-only and mirrors the same `type` event used by an
    // agent action, so we can inspect that state without submitting a task.
    if (demo === "typing") return "typing" as const;
    if (demo === "click") return "click" as const;
    return "agent" as const;
  });
  const [agentStatus, setAgentStatus] = useState("Ready");
  const [agentPhase, setAgentPhase] = useState<AgentStatus>("idle");
  const [liveSteps, setLiveSteps] = useState<string[]>([]);
  const [plan, setPlan] = useState<TaskPlan | null>(null);
  const [criteriaProgress, setCriteriaProgress] = useState({ complete: 0, total: 0 });
  const [factCount, setFactCount] = useState(0);
  const [activityOpen, setActivityOpen] = useState(false);
  const [planDisclosureOpen, setPlanDisclosureOpen] = useState(false);
  const [browserMenuOpen, setBrowserMenuOpen] = useState(false);
  // These pages deliberately live in the tab strip rather than the utility
  // drawer. They are browser destinations in their own right, while still
  // using the same persisted local profile as the native Chromium tabs.
  const [internalTabs, setInternalTabs] = useState<InternalBrowserTab[]>([]);
  const [activeInternalTabId, setActiveInternalTabId] = useState<string | null>(null);
  const [cursor, setCursor] = useState<AgentCursor | null>(null);
  const cursorIntent = truncateLabel(
    agentDemo
      ? (agentDemoKind === "ebay" ? "Opening MacBook M2 listing" : agentDemoKind === "typing" ? "Typing Clyra AI" : agentDemoKind === "click" ? "Opening result" : "Searching for sunscreen")
      : (agentStatus && agentStatus !== "Ready" ? agentStatus : cursor?.label || "Working"),
    44,
  );
  const [frameTick, setFrameTick] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [messages, setMessagesState] = useState<AgentMessage[]>(() => {
    const saved = initialAgentMessages();
    // Opening Browser on a finished failure should show welcome, not the last error.
    return looksLikeStaleFailureTranscript(saved) ? [] : saved;
  });
  const [runItems, setRunItems] = useState<RunItem[]>([]);
  const runItemsRef = useRef<RunItem[]>([]);
  runItemsRef.current = runItems;
  const [runStartedAt, setRunStartedAt] = useState(0);
  const runStartedAtRef = useRef(0);
  const [askingPage, setAskingPage] = useState(false);
  const askAbortRef = useRef<AbortController | null>(null);
  const [agentMode, setAgentModeState] = useState(() => {
    try { return window.localStorage.getItem("clyra-browser-agent-mode") !== "off"; } catch { return true; }
  });
  const setAgentMode = useCallback((update: boolean | ((value: boolean) => boolean)) => {
    setAgentModeState((current) => {
      const next = typeof update === "function" ? update(current) : update;
      try { window.localStorage.setItem("clyra-browser-agent-mode", next ? "on" : "off"); } catch { /* optional */ }
      return next;
    });
  }, []);
  /** Snapshot of the live run, attached to the message that ends it. */
  const finishedRun = (outcome: FinishedRun["outcome"]): FinishedRun | undefined => {
    const rows = rowsFromRunItems(runItemsRef.current).map((row) => row.status === "running" ? { ...row, status: outcome === "completed" ? "done" as const : "failed" as const } : row);
    if (!rows.length) return undefined;
    return { rows, durationMs: Math.max(1_000, Date.now() - (runStartedAtRef.current || Date.now())), outcome };
  };
  const [runTask, setRunTask] = useState("");
  const [completedStepsOpen, setCompletedStepsOpen] = useState(false);
  const [agentControlledTabId, setAgentControlledTabId] = useState<string | null>(null);
  const streamingRunRef = useRef(false);
  const assistAbortRef = useRef<AbortController | null>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const typingBufferRef = useRef("");
  const typingTimerRef = useRef<number | null>(null);
  const scrollTimerRef = useRef<number | null>(null);
  const cursorSequenceRef = useRef(0);
  const lastPolledCursorIdRef = useRef(0);
  const externalCursorTimerRef = useRef<number | null>(null);
  const [externalCursorActive, setExternalCursorActive] = useState(false);
  const mountedRef = useRef(true);
  const viewportSizeRef = useRef({ width: 0, height: 0 });
  const viewportTimerRef = useRef<number | null>(null);
  const previousActiveTabRef = useRef("default");
  const agentOriginTabRef = useRef<string | null>(null);
  const sideLockRef = useRef(false);
  const consumedExternalDraftRef = useRef<string | null>(null);
  const autoRunDraftRef = useRef<{ key: string; task: string } | null>(null);
  useEffect(() => {
    const draft = initialTaskDraft.trim();
    const key = `${launchRequestId}:${draft}`;
    if ((!launchRequestId && !draft) || consumedExternalDraftRef.current === key) return;
    consumedExternalDraftRef.current = key;
    sideLockRef.current = true;
    setSideView("agent");
    setSideOpen(true);
    if (draft) {
      if (autoRunInitialTask) autoRunDraftRef.current = { key, task: draft };
      setTask(draft);
      onTaskDraftConsumed?.();
    }
  }, [autoRunInitialTask, initialTaskDraft, launchRequestId, onTaskDraftConsumed]);
  const handledAgentSessionsRef = useRef(new Set(
    messages
      .map((message) => message.id)
      .filter((id) => id.startsWith("session-"))
      .map((id) => id.slice("session-".length)),
  ));
  const hydratedMessageIdsRef = useRef(new Set(messages.map((message) => message.id)));

  const setMessages = useCallback((update: React.SetStateAction<AgentMessage[]>) => {
    setMessagesState((current) => {
      const next = typeof update === "function" ? update(current) : update;
      return next.slice(-60);
    });
  }, []);

  const focusOmnibox = useCallback(() => {
    editingAddressRef.current = true;
    setOmniboxFocused(true);
    setAddress(browserState?.url || address);
    window.requestAnimationFrame(() => {
      const input = document.querySelector<HTMLInputElement>("[data-browser-omnibox]");
      input?.focus({ preventScroll: true });
      input?.select();
    });
  }, [address, browserState?.url]);

  const applyState = useCallback((state: BrowserState) => {
    const previousActive = previousActiveTabRef.current;
    previousActiveTabRef.current = state.activeTabId || previousActive;
    setBrowserState(state);
    if (!editingAddressRef.current) setAddress(state.url);
    setAgentPhase(state.agent.status);
    setError(null);
    setFrameTick((value) => value + 1);
    // A state poll can carry a cursor event this component did not itself
    // request (an external Mission Runtime / Hermes browser.action call).
    // The server-assigned `id` lets every open browser surface dedupe
    // against its own locally-numbered sequence and still show it once.
    if (state.cursor && state.cursor.id !== lastPolledCursorIdRef.current) {
      lastPolledCursorIdRef.current = state.cursor.id;
      setCursor({ x: state.cursor.x, y: state.cursor.y, kind: state.cursor.kind, label: state.cursor.label, id: ++cursorSequenceRef.current });
      // `isAgentBusy` only tracks this component's own task runner, so an
      // externally-driven action (Cowork's Hermes/Mission Runtime tool
      // calls) would otherwise be gated out of the live-cursor check below.
      // Treat a just-received real cursor event as its own short busy
      // window instead.
      setExternalCursorActive(true);
      if (externalCursorTimerRef.current !== null) window.clearTimeout(externalCursorTimerRef.current);
      externalCursorTimerRef.current = window.setTimeout(() => setExternalCursorActive(false), 2_500);
    }
  }, []);

  const requestBrowser = useCallback(
    async (path: string, options: { method?: "GET" | "POST" | "PATCH" | "DELETE"; body?: unknown; quiet?: boolean } = {}) => {
      if (!options.quiet) setIsBrowserBusy(true);
      setError(null);
      try {
        const electronPayload = await requestElectronBrowser(path, { body: options.body });
        if (electronPayload) {
          if (!electronPayload?.ok) throw new Error(responseError(electronPayload, "Browser action failed."));
          if (electronPayload.state) applyState(electronPayload.state);
          return electronPayload;
        }
        const response = await fetch(path, {
          method: options.method || "POST",
          headers: options.body === undefined ? undefined : { "Content-Type": "application/json" },
          body: options.body === undefined ? undefined : JSON.stringify(options.body),
        });
        const payload = await response.json();
        if (!response.ok || !payload?.ok) throw new Error(responseError(payload, "Browser action failed."));
        if (payload.state) applyState(payload.state);
        if (payload.cursor) {
          setCursor({ ...payload.cursor, id: ++cursorSequenceRef.current });
        }
        return payload;
      } catch (nextError) {
        const message = nextError instanceof Error ? nextError.message : "Browser action failed.";
        setError(message);
        throw nextError;
      } finally {
        if (!options.quiet) setIsBrowserBusy(false);
      }
    },
    [applyState],
  );

  const loadState = useCallback(async () => {
    try {
      await requestBrowser("/api/openbrowser/state", { method: "GET", quiet: true });
    } catch {
      // Error state is handled by requestBrowser.
    }
  }, [requestBrowser]);

  const applyAgentSession = useCallback((session: AgentSession | null) => {
    // The ?browserDemo QA fixture owns the run state; polling must not erase it.
    if (agentDemo) return;
    if (!session) {
      setIsAgentBusy(false);
      setAgentPhase("idle");
      setAgentStatus("Ready");
      if (!streamingRunRef.current) {
        setRunItems([]);
        setRunTask("");
      }
      return;
    }
    const active = ACTIVE_AGENT_PHASES.has(session.status);
    setIsAgentBusy(active);
    setAgentPhase(session.status);
    setAgentStatus(session.message || (active ? "Working" : "Ready"));
    if (session.plan) setPlan(session.plan);
    setCriteriaProgress({ complete: session.completedCriteria || 0, total: session.totalCriteria || 0 });
    setFactCount(session.factCount || 0);
    if (active && session.recentEvents?.length) {
      setLiveSteps(session.recentEvents.slice(-20).map((event) => `${event.phase}: ${event.message}`));
      // While an SSE stream is live it owns the run feed; the polled session
      // is only used to rebuild it after a reload/reconnect.
      if (!streamingRunRef.current) {
        setRunTask(session.task || "");
        setRunItems(session.recentEvents.reduce((acc, event) => reduceRunItems(acc, event), [] as RunItem[]));
      }
    } else if (!streamingRunRef.current) {
      // Idle reopen must not resurrect a finished Failed run card.
      setRunItems([]);
      setRunTask("");
      setLiveSteps([]);
    }
    if (!active) {
      // Mark finished sessions handled without injecting them into chat on open.
      if (session.id) handledAgentSessionsRef.current.add(session.id);
      agentOriginTabRef.current = null;
      setAgentControlledTabId(null);
    }
  }, [agentDemo]);

  const syncAgentSession = useCallback(async () => {
    try {
      const response = await fetch("/api/openbrowser/session", { cache: "no-store" });
      const payload = await response.json();
      if (response.ok && payload?.ok) applyAgentSession(payload.session as AgentSession | null);
    } catch {
      // The browser state request owns the visible connection error.
    }
  }, [applyAgentSession]);

  useEffect(() => {
    mountedRef.current = true;
    let cancelled = false;
    void (async () => {
      await loadState();
      await syncAgentSession();
      if (cancelled || !mountedRef.current) return;
      // A direct Chat request (for example “Open YouTube”) outranks the normal
      // welcome page. Without this boundary the mount-time Google navigation
      // could overwrite an already verified Chat navigation.
      // Reopening the Browser keeps whatever tabs were already open, like a
      // real browser. Only an explicit request (for example “Open YouTube”
      // from Chat) navigates the active tab.
      const openingTarget = initialUrl.trim();
      if (openingTarget) {
        await requestBrowser("/api/openbrowser/navigate", {
          body: { target: openingTarget },
          quiet: true,
        }).catch(() => undefined);
      }
      if (!cancelled && mountedRef.current) {
        setSideOpen(false);
        if (openingTarget) setAddress(openingTarget);
      }
    })();
    return () => {
      cancelled = true;
      mountedRef.current = false;
      if (typingTimerRef.current != null) window.clearTimeout(typingTimerRef.current);
      if (scrollTimerRef.current != null) window.clearTimeout(scrollTimerRef.current);
      if (externalCursorTimerRef.current != null) window.clearTimeout(externalCursorTimerRef.current);
      if (viewportTimerRef.current != null) window.clearTimeout(viewportTimerRef.current);
    };
  }, [initialUrl, loadState, requestBrowser, syncAgentSession]);

  useEffect(() => {
    const desktop = getElectronDesktop();
    if (!desktop) return;
    const stopState = desktop.browser.onState((state) => applyState(state as BrowserState));
    const stopAddress = desktop.browser.onFocusAddress(focusOmnibox);
    const stopFind = desktop.browser.onFocusFind(() => {
      setFindOpen(true);
      window.setTimeout(() => findInputRef.current?.select(), 30);
    });
    return () => {
      stopState();
      stopAddress();
      stopFind();
    };
  }, [applyState, focusOmnibox]);

  useEffect(() => {
    window.localStorage.setItem(BROWSER_CHAT_STORAGE, JSON.stringify(messages));
  }, [messages]);

  useEffect(() => {
    if (!agentDemo) return;
    if (agentDemoKind === "ebay") {
      setMessagesState((current) => current.length ? current : [{
        id: "demo-user",
        role: "user",
        content: "Look at MacBook M2 on eBay and compare the best listings.",
      }, {
        id: "demo-assistant",
        role: "assistant",
        content: "I'll open eBay, search for MacBook M2 laptops, and compare condition, price, and seller ratings.",
      }]);
      setRunTask("Searching MacBook M2 on eBay");
      setAgentPhase("executing");
      setAgentStatus("Opening eBay listings");
      void requestBrowser("/api/openbrowser/navigate", {
        body: { target: "https://www.ebay.com/sch/i.html?_nkw=MacBook+M2&_sacat=0" },
        quiet: true,
      }).catch(() => undefined);
      return;
    }
    setMessagesState((current) => current.length ? current : [{
      id: "demo-user",
      role: "user",
      content: "Find well-rated sunscreen, beach towels and a bucket hat for a beach day.",
    }, {
      id: "demo-assistant",
      role: "assistant",
      content: "The usual. I’ll grab well-rated SPF 50 sunscreen, towels they love, and a sturdy bucket hat so you can enjoy the day.",
    }]);
    setRunTask("Fulfilling beach essentials request");
    setAgentPhase("executing");
    setAgentStatus("Comparing sunscreen");
    // Visual-QA fixture for the action stream. Query-only (?browserDemo=agent).
    runStartedAtRef.current = Date.now() - 14_000;
    setRunStartedAt(runStartedAtRef.current);
    setRunItems([
      { id: "demo-r1", kind: "reasoning", nextGoal: "Search for well-rated SPF 50 sunscreen" },
      { id: "demo-a1", kind: "action", actionType: "search", label: "Searching \"SPF 50 sunscreen reviews\"", icon: "search", status: "success", detail: "", result: "Opened Google results" },
      { id: "demo-a2", kind: "action", actionType: "click", label: "Clicking 'Best sunscreens of 2026'", icon: "click", status: "success", detail: "", result: "Article opened" },
      { id: "demo-a3", kind: "action", actionType: "scroll", label: "Scrolling down", icon: "scrollDown", status: "success", detail: "" },
      { id: "demo-a4", kind: "action", actionType: "read_page", label: "Reading the page", icon: "read", status: "running", detail: "" },
    ]);
  }, [agentDemo, agentDemoKind, requestBrowser]);

  useEffect(() => {
    const timer = window.setInterval(() => void syncAgentSession(), isAgentBusy ? 650 : 2_400);
    return () => window.clearInterval(timer);
  }, [isAgentBusy, syncAgentSession]);

  // This component's own action-driven flow already keeps `browserState`
  // current via direct request responses; nothing otherwise polls the
  // general browser state while idle. A browser.action taken through
  // Cowork's Hermes/Mission Runtime path (a caller entirely outside this
  // component) still needs to reach this view — including its cursor —
  // so poll lightly for that case too, skipped whenever this component is
  // already driving its own busy task (which gets much more frequent
  // updates from its own requests).
  useEffect(() => {
    if (desktopChromium || isAgentBusy) return;
    const timer = window.setInterval(() => { void loadState(); }, 1_800);
    return () => window.clearInterval(timer);
  }, [desktopChromium, isAgentBusy, loadState]);

  useEffect(() => {
    if (desktopChromium) return;
    const surface = previewRef.current;
    if (!surface || !browserState) return;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const displayWidth = Math.max(1, entry.contentRect.width);
      const displayHeight = Math.max(1, entry.contentRect.height);
      const scale = displayWidth < 760 ? 1.7 : 1.45;
      const width = Math.round(Math.max(900, Math.min(1_800, displayWidth * scale)));
      const height = Math.round(width * (displayHeight / displayWidth));
      const previous = viewportSizeRef.current;
      if (Math.abs(previous.width - width) < 12 && Math.abs(previous.height - height) < 12) return;
      viewportSizeRef.current = { width, height };
      if (viewportTimerRef.current != null) window.clearTimeout(viewportTimerRef.current);
      viewportTimerRef.current = window.setTimeout(() => {
        void requestBrowser("/api/openbrowser/viewport", { body: { width, height }, quiet: true }).catch(() => undefined);
      }, 180);
    });
    observer.observe(surface);
    return () => observer.disconnect();
  }, [browserState?.activeTabId, desktopChromium, requestBrowser]);

  useEffect(() => {
    if (desktopChromium) return;
    if (!browserState || document.visibilityState === "hidden") return;
    // Keep streamed browser actions legible without turning the page viewer into
    // a high-frequency screenshot loop while it is idle.
    const delay = isAgentBusy || browserState.loading ? 140 : 1_800;
    const timer = window.setTimeout(() => setFrameTick((value) => value + 1), delay);
    return () => window.clearTimeout(timer);
  }, [browserState, desktopChromium, frameTick, isAgentBusy]);

  const performAction = useCallback(
    async (action: BrowserAction, quiet = false) => {
      if (action.type === "open_tab") {
        setActiveInternalTabId(null);
        sideLockRef.current = false;
        setSideOpen(false);
        setSideView("agent");
      }
      return requestBrowser("/api/openbrowser/action", { body: { action }, quiet });
    },
    [requestBrowser],
  );

  const takeManualControl = useCallback(async () => {
    if (!isAgentBusy || browserState?.agent.manualControl) return;
    const response = await requestBrowser("/api/openbrowser/control", { body: { command: "take_control" }, quiet: true }).catch(() => null);
    const agent = response?.agent as { status?: AgentStatus; paused?: boolean; manualControl?: boolean } | undefined;
    if (agent) {
      setBrowserState((current) => current ? {
        ...current,
        agent: { ...current.agent, status: agent.status || "paused", paused: true, manualControl: true },
      } : current);
      setCursor(null);
    }
    setAgentPhase("paused");
    setAgentStatus("You have control");
  }, [browserState?.agent.manualControl, isAgentBusy, requestBrowser]);

  /* The one navigation path. The form's submit, the Enter key and every
     programmatic caller land here, so there is a single place where a
     navigation can start and a single place it can fail. */
  const navigate = async (event?: FormEvent, target = address) => {
    event?.preventDefault();
    const input = String(target ?? "").trim();
    if (!input) return;
    editingAddressRef.current = false;
    // Typing an address from a Clyra page returns to the last real browser tab.
    setActiveInternalTabId(null);
    const startedAt = performance.now();
    await takeManualControl();
    try {
      await requestBrowser("/api/openbrowser/navigate", { body: { target: input } });
      if (process.env.NODE_ENV !== "production") {
        console.debug(`[browser] navigate "${input}" dispatched in ${Math.round(performance.now() - startedAt)}ms`);
      }
    } catch (error) {
      /* A navigation that fails used to disappear into .catch(() => undefined),
         which is why "search does nothing" was invisible rather than reported. */
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[browser] navigate failed for "${input}":`, message);
      setError(`Could not open “${input}”. ${message}`);
    }
  };

  // "Snip & Ask": the toolbar crop icon and the "Ask Clyra about selection"
  // context-menu item both end here. A screenshot goes to the same Gemini
  // vision pipeline the voice-call camera already uses — the answer card
  // just formats the response as a direct answer first, explanation after.
  const askVisionSnip = useCallback(async (image: string, pageText: string, question: string) => {
    try {
      const response = await fetch("/api/companion/vision-frame", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          image,
          question:
            `${question}\n\n` +
            (pageText ? `Page text near the selection:\n${pageText.slice(0, 3000)}\n\n` : "") +
            "Answer in two parts: the direct answer first (one or two sentences, no preamble), " +
            "then, only if genuinely useful, a short \"Explanation\" section with a few key points. " +
            "Keep it compact — this renders in a small floating card.",
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload?.ok === false) {
        throw new Error(payload?.error || "Clyra couldn't read that selection.");
      }
      const text = String(payload.text || payload.summary || "").trim();
      const splitAt = text.search(/\n\s*(explanation|key points)[:\-]?/i);
      return splitAt > 0
        ? { direct: text.slice(0, splitAt).trim(), explanation: text.slice(splitAt).replace(/^\n?\s*(explanation|key points)[:\-]?\s*/i, "").trim() }
        : { direct: text, explanation: "" };
    } catch (error) {
      return { error: error instanceof Error ? error.message : "Clyra couldn't read that selection." };
    }
  }, []);

  const positionSnipCard = useCallback((rect: { x: number; y: number; width: number; height: number }) => {
    const hostRect = previewRef.current?.getBoundingClientRect();
    const cardWidth = 340;
    if (!hostRect) return { left: 80, top: 80 };
    const spaceRight = hostRect.width - (rect.x + rect.width);
    const left = spaceRight > cardWidth + 24
      ? hostRect.left + rect.x + rect.width + 14
      : Math.max(hostRect.left + 12, hostRect.left + rect.x - cardWidth - 14);
    const top = Math.min(hostRect.top + rect.y, hostRect.top + hostRect.height - 160);
    return { left: Math.round(left), top: Math.round(Math.max(hostRect.top + 12, top)) };
  }, []);

  const openSnipCard = useCallback(
    async (payload: { image: string; text: string; rect: { x: number; y: number; width: number; height: number }; pageUrl?: string; pageTitle?: string }) => {
      const { left, top } = positionSnipCard(payload.rect);
      setSnipCard({ ...payload, left, top, status: "loading" });
      const result = await askVisionSnip(
        payload.image,
        payload.text,
        "What is in this screenshot? If it's a question, problem, or diagram, answer or solve it directly.",
      );
      setSnipCard((current) => {
        if (!current || current.image !== payload.image) return current;
        return "error" in result && result.error
          ? { ...current, status: "error", error: result.error }
          : { ...current, status: "done", direct: result.direct, explanation: result.explanation };
      });
    },
    [askVisionSnip, positionSnipCard],
  );

  const handleSnip = useCallback(async () => {
    const desktop = getElectronDesktop();
    if (!desktop || snipBusy) return;
    setSnipBusy(true);
    try {
      const res = await desktop.browser.snip(browserState?.activeTabId);
      if (!res?.ok || res.cancelled || !res.image || !res.rect) return;
      void openSnipCard({ image: res.image, text: res.text || "", rect: res.rect, pageUrl: res.pageUrl, pageTitle: res.pageTitle });
    } finally {
      setSnipBusy(false);
    }
  }, [browserState?.activeTabId, openSnipCard, snipBusy]);

  const handleSnipFollowUp = useCallback(async () => {
    if (!snipCard || !snipFollowUp.trim()) return;
    setSnipFollowUpBusy(true);
    const question = snipFollowUp.trim();
    setSnipFollowUp("");
    const result = await askVisionSnip(snipCard.image, snipCard.text, question);
    setSnipFollowUpBusy(false);
    setSnipCard((current) => {
      if (!current) return current;
      if ("error" in result && result.error) return { ...current, status: "error", error: result.error };
      const appended = current.explanation ? `${current.explanation}\n\n— ${question}\n${result.direct}` : `— ${question}\n${result.direct}`;
      return { ...current, status: "done", direct: current.direct, explanation: appended };
    });
  }, [askVisionSnip, snipCard, snipFollowUp]);

  const handleSnipCardDragStart = useCallback((event: ReactMouseEvent) => {
    if (!snipCard) return;
    event.preventDefault();
    const startX = event.clientX;
    const startY = event.clientY;
    const originLeft = snipCard.left;
    const originTop = snipCard.top;
    const onMove = (moveEvent: MouseEvent) => {
      setSnipCard((current) =>
        current ? { ...current, left: originLeft + (moveEvent.clientX - startX), top: originTop + (moveEvent.clientY - startY) } : current,
      );
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [snipCard]);

  // The context-menu path (right-click → "Ask Clyra about selection") sends
  // plain text, not a screenshot — route it straight into the existing "Ask
  // Clyra" chat panel instead of the floating card, since there's no image
  // for the vision pipeline to look at.
  useEffect(() => {
    const desktop = getElectronDesktop();
    if (!desktop) return;
    return desktop.browser.onAskSelection(({ text }) => {
      if (!text?.trim()) return;
      setSideView("agent");
      setSideOpen(true);
      void runAgentTask(`About this selected text, answer or explain it:\n\n"${text.trim().slice(0, 2000)}"`);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const flushTyping = useCallback(() => {
    if (typingTimerRef.current != null) window.clearTimeout(typingTimerRef.current);
    typingTimerRef.current = null;
    const text = typingBufferRef.current;
    typingBufferRef.current = "";
    if (text) void performAction({ type: "type", text }, true);
  }, [performAction]);

  const controlAgent = async (command: "pause" | "resume" | "take_control" | "return_control" | "stop") => {
    if (command === "stop") {
      assistAbortRef.current?.abort();
      assistAbortRef.current = null;
      streamingRunRef.current = false;
      setIsAgentBusy(false);
      setAgentPhase("idle");
      setAgentStatus("Ready");
      setCursor(null);
      setAgentControlledTabId(null);
      agentOriginTabRef.current = null;
    }
    const response = await requestBrowser("/api/openbrowser/control", { body: { command }, quiet: true }).catch(() => null);
    if (!response) return;
    const agent = response.agent as { status?: AgentStatus; paused?: boolean; manualControl?: boolean } | undefined;
    if (agent) {
      setBrowserState((current) => current ? {
        ...current,
        agent: {
          ...current.agent,
          status: agent.status || current.agent.status,
          paused: Boolean(agent.paused),
          manualControl: Boolean(agent.manualControl),
        },
      } : current);
      if (agent.manualControl || command === "pause") setCursor(null);
    }
    if (command === "stop") {
      setAgentStatus("Ready");
    } else if (command === "pause" || command === "take_control") {
      setAgentPhase("paused");
      setAgentStatus(command === "take_control" ? "You have control" : "Task paused");
    } else {
      setAgentPhase("observing");
      setAgentStatus("Reading the current page");
    }
  };

  const runAgentTask = async (taskOverride?: string) => {
    const cleanTask = (taskOverride ?? task).trim();
    if (!cleanTask || isAgentBusy) return;
    const originTabId = browserState?.activeTabId || previousActiveTabRef.current || "default";
    agentOriginTabRef.current = originTabId;
    setAgentControlledTabId(originTabId);
    setTask("");
    setIsAgentBusy(true);
    sideLockRef.current = true;
    setSideOpen(true);
    setSideView("agent");
    setAgentPhase("planning");
    setAgentStatus("Building a plan");
    setLiveSteps([]);
    setPlan(null);
    setCriteriaProgress({ complete: 0, total: 0 });
    setFactCount(0);
    streamingRunRef.current = true;
    setRunItems([]);
    setRunTask(cleanTask);
    setCompletedStepsOpen(false);
    runStartedAtRef.current = Date.now();
    setRunStartedAt(runStartedAtRef.current);
    // Let the sidebar width animation start, then float the user bubble up.
    await new Promise<void>((resolve) => {
      window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve()));
    });
    setMessages((current) => [...current, { id: `user-${Date.now()}`, role: "user", content: cleanTask }]);
    const abort = new AbortController();
    assistAbortRef.current?.abort();
    assistAbortRef.current = abort;
    try {
      const response = await fetch("/api/openbrowser/assist", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
        body: JSON.stringify({ task: cleanTask, tabId: originTabId }),
        signal: abort.signal,
      });
      if (!response.ok || !response.body) {
        const payload = await response.json().catch(() => null);
        throw new Error(responseError(payload, "The browser agent could not start that task."));
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let completePayload: Record<string, unknown> | null = null;
      let acknowledgedPlan = false;
      while (true) {
        if (abort.signal.aborted) break;
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split("\n\n");
        buffer = events.pop() || "";
        for (const event of events) {
          const line = event.split("\n").find((item) => item.startsWith("data: "));
          if (!line) continue;
          const next = JSON.parse(line.slice(6)) as Record<string, any>;
          if (next.type === "error") throw new Error(responseError(next, "The browser agent could not complete that task."));
          if (typeof next.message === "string") setAgentStatus(next.message);
          if (next.state) applyState(next.state as BrowserState);
          if (next.plan) {
            setPlan(next.plan as TaskPlan);
            if (!acknowledgedPlan) {
              acknowledgedPlan = true;
              setMessages((current) => [
                ...current,
                {
                  id: `assistant-plan-${Date.now()}`,
                  role: "assistant",
                  content: "I’ll work through this in the browser, verify each result, and then bring back the outcome.",
                },
              ]);
            }
          }
          if (next.cursor) setCursor({ ...(next.cursor as Omit<AgentCursor, "id">), id: ++cursorSequenceRef.current });
          if (typeof next.completedCriteria === "number" || typeof next.totalCriteria === "number") {
            setCriteriaProgress((current) => ({
              complete: typeof next.completedCriteria === "number" ? next.completedCriteria : current.complete,
              total: typeof next.totalCriteria === "number" ? next.totalCriteria : current.total,
            }));
          }
          if (typeof next.facts === "number") setFactCount(next.facts);
          if (next.type === "progress" && next.phase) {
            setAgentPhase(next.phase as AgentStatus);
            setLiveSteps((current) => [...current.slice(-19), `${next.phase}: ${next.message || "Working"}`]);
            setRunItems((current) => reduceRunItems(current, next as RunEvent));
          }
          if (next.type === "complete") completePayload = next;
        }
      }
      if (abort.signal.aborted) {
        setMessages((current) => [
          ...current,
          { id: `assistant-stop-${Date.now()}`, role: "assistant", content: "Stopped.", run: finishedRun("stopped") },
        ]);
        return;
      }
      if (!completePayload?.ok) throw new Error("The browser agent stopped before returning a verified result.");
      const payload = completePayload as Record<string, any>;
      if (payload.state) applyState(payload.state as BrowserState);
      const uniqueSources = Array.isArray(payload.facts)
        ? Array.from(
            new Map<string, { claim: string; sourceUrl: string }>(
              payload.facts
                .filter(
                  (fact: { claim?: unknown; sourceUrl?: unknown }) =>
                    typeof fact?.claim === "string" &&
                    typeof fact?.sourceUrl === "string" &&
                    fact.sourceUrl,
                )
                .map((fact: { claim: string; sourceUrl: string }) => [
                  fact.sourceUrl,
                  { claim: fact.claim, sourceUrl: fact.sourceUrl },
                ]),
            ).values(),
          )
        : undefined;
      setMessages((current) => [
        ...current,
        {
          id: `assistant-${Date.now()}`,
          role: "assistant",
          content: String(payload.content || "Done."),
          steps: Array.isArray(payload.steps) ? payload.steps : undefined,
          facts: uniqueSources,
          run: finishedRun(payload.success === false ? "failed" : "completed"),
          error: payload.success === false,
        },
      ]);
    } catch (nextError) {
      if (abort.signal.aborted || (nextError instanceof DOMException && nextError.name === "AbortError")) {
        // Soft stop — already messaged above when aborting cleanly.
      } else {
        setMessages((current) => [
          ...current,
          {
            id: `error-${Date.now()}`,
            role: "assistant",
            content: friendlyAgentError(nextError instanceof Error ? nextError.message : "The browser agent could not complete that task."),
            run: finishedRun("failed"),
            error: true,
          },
        ]);
      }
    } finally {
      if (assistAbortRef.current === abort) assistAbortRef.current = null;
      streamingRunRef.current = false;
      if (mountedRef.current) {
        setIsAgentBusy(false);
        setAgentPhase("idle");
        setAgentStatus("Ready");
        setAgentControlledTabId(null);
        agentOriginTabRef.current = null;
        setRunItems([]);
        setRunTask("");
        // A completed task hands the page straight back to the user.  Leaving
        // the last cursor coordinate on screen made an idle browser look as if
        // the agent still had the controls.
        setCursor(null);
      }
    }
  };

  /** Agent-off "Ask" mode: answer from the current page without acting. */
  const askAboutPage = async (question: string) => {
    const clean = question.trim();
    if (!clean || askingPage || isAgentBusy) return;
    setTask("");
    sideLockRef.current = true;
    setSideOpen(true);
    setSideView("agent");
    setMessages((current) => [...current, { id: `user-${Date.now()}`, role: "user", content: clean }]);
    const abort = new AbortController();
    askAbortRef.current = abort;
    setAskingPage(true);
    try {
      const response = await fetch("/api/openbrowser/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: clean }),
        signal: abort.signal,
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.ok) throw new Error(responseError(payload, "I couldn't read this page."));
      const sourceUrl = String(payload.source?.url || "");
      setMessages((current) => [...current, {
        id: `assistant-${Date.now()}`,
        role: "assistant",
        content: String(payload.answer || ""),
        facts: /^https?:/.test(sourceUrl) ? [{ claim: String(payload.source?.title || ""), sourceUrl }] : undefined,
      }]);
    } catch (nextError) {
      if (!abort.signal.aborted) {
        setMessages((current) => [...current, { id: `error-${Date.now()}`, role: "assistant", content: friendlyAgentError(nextError instanceof Error ? nextError.message : "I couldn't read this page."), error: true }]);
      }
    } finally {
      if (askAbortRef.current === abort) askAbortRef.current = null;
      setAskingPage(false);
    }
  };

  // A user asking Chat to inspect public pages should not have to repeat the
  // same instruction inside Browser. This is deliberately limited to the
  // caller's read-only classifier; Browser's own agent continues to pause for
  // credentials, payments and any review-required web action.
  useEffect(() => {
    const pending = autoRunDraftRef.current;
    if (!pending || pending.key !== `${launchRequestId}:${initialTaskDraft.trim()}` || isAgentBusy) return;
    autoRunDraftRef.current = null;
    void runAgentTask(pending.task);
  }, [initialTaskDraft, isAgentBusy, launchRequestId, runAgentTask]);

  const clickPreview = async (event: ReactMouseEvent<HTMLImageElement>) => {
    if (!browserState || isBrowserBusy) return;
    await takeManualControl();
    const rect = event.currentTarget.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * browserState.viewport.width;
    const y = ((event.clientY - rect.top) / rect.height) * browserState.viewport.height;
    previewRef.current?.focus();
    await performAction({ type: "click_at", x, y }, true).catch(() => undefined);
  };

  const handlePreviewWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    void takeManualControl();
    if (scrollTimerRef.current != null) window.clearTimeout(scrollTimerRef.current);
    const direction = event.deltaY < 0 ? "up" : "down";
    const amount = Math.max(180, Math.min(1_100, Math.abs(event.deltaY) * 2.2));
    scrollTimerRef.current = window.setTimeout(() => {
      void performAction({ type: "scroll", direction, amount }, true);
    }, 22);
  };

  const handlePreviewKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (showStartPage) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest("input, textarea, select, [contenteditable='true']")) return;
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const supported = event.key.length === 1 || ["Enter", "Backspace", "Tab", "Escape", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key);
    if (!supported) return;
    event.preventDefault();
    void takeManualControl();
    if (event.key.length === 1) {
      typingBufferRef.current += event.key;
      if (typingTimerRef.current != null) window.clearTimeout(typingTimerRef.current);
      typingTimerRef.current = window.setTimeout(flushTyping, 36);
      return;
    }
    if (event.key === "Enter" && typingBufferRef.current) {
      if (typingTimerRef.current != null) window.clearTimeout(typingTimerRef.current);
      const text = typingBufferRef.current;
      typingBufferRef.current = "";
      void performAction({ type: "type", text, submit: true }, true);
      return;
    }
    flushTyping();
    void performAction({ type: "press", key: event.key }, true);
  };

  const updateSettings = async (patch: Partial<BrowserSettings>) => {
    await requestBrowser("/api/openbrowser/settings", { method: "PATCH", body: patch, quiet: true }).catch(() => undefined);
  };

  const runFind = async (query: string) => {
    try {
      const payload = await requestBrowser("/api/openbrowser/find", { body: { text: query }, quiet: true });
      setFindResult(query ? payload?.result || { total: 0, current: 0 } : null);
    } catch {
      setFindResult(query ? { total: 0, current: 0 } : null);
    }
  };

  const closeFind = () => {
    setFindOpen(false);
    setFindQuery("");
    setFindResult(null);
    void requestBrowser("/api/openbrowser/find", { body: { text: "" }, quiet: true }).catch(() => undefined);
  };

  const saveBookmark = async () => {
    await requestBrowser("/api/openbrowser/bookmarks", { body: {}, quiet: true }).catch(() => undefined);
  };

  const zoom = async (delta: number | "reset") => {
    await requestBrowser("/api/openbrowser/zoom", { body: { delta }, quiet: true }).catch(() => undefined);
  };

  useEffect(() => {
    const onShortcut = (event: globalThis.KeyboardEvent) => {
      const modifier = event.metaKey || event.ctrlKey;
      const target = event.target as HTMLElement | null;
      const typing = target?.matches("input, textarea, [contenteditable='true']");
      if (modifier && event.key.toLowerCase() === "l") {
        event.preventDefault();
        focusOmnibox();
      } else if (modifier && event.key.toLowerCase() === "t") {
        event.preventDefault();
        void performAction({ type: "open_tab" });
      } else if (modifier && event.shiftKey && event.key.toLowerCase() === "t") {
        event.preventDefault();
        void performAction({ type: "restore_closed_tab" });
      } else if (modifier && event.key.toLowerCase() === "w" && !typing && browserState?.activeTabId) {
        event.preventDefault();
        void performAction({ type: "close_tab", tabId: browserState.activeTabId });
      } else if (modifier && event.key.toLowerCase() === "r") {
        event.preventDefault();
        void performAction({ type: "reload" });
      } else if (modifier && (event.key === "+" || event.key === "=")) {
        event.preventDefault();
        void zoom(0.1);
      } else if (modifier && event.key === "-") {
        event.preventDefault();
        void zoom(-0.1);
      } else if (modifier && event.key === "0") {
        event.preventDefault();
        void zoom("reset");
      } else if (modifier && event.key.toLowerCase() === "f" && !typing) {
        // Electron's own Cmd+F is caught by the native window shortcut and
        // arrives via onFocusFind; this covers the web-preview fallback path
        // (no Electron bridge) so the same find bar still opens there.
        if (!getElectronDesktop()) {
          event.preventDefault();
          setFindOpen(true);
          window.setTimeout(() => findInputRef.current?.select(), 30);
        }
      } else if (event.key === "Escape" && findOpen) {
        closeFind();
      }
    };
    window.addEventListener("keydown", onShortcut);
    return () => window.removeEventListener("keydown", onShortcut);
  }, [browserState?.activeTabId, focusOmnibox, performAction, findOpen]);

  const settings = browserState?.settings || defaultSettings;

  useEffect(() => {
    const scroller = chatScrollRef.current;
    if (!scroller) return;
    const snap = () => {
      scroller.scrollTop = scroller.scrollHeight;
      chatEndRef.current?.scrollIntoView({ behavior: settings.reducedMotion ? "instant" as ScrollBehavior : "smooth", block: "end" });
    };
    snap();
    // Agent progress rows grow after the first paint — catch the final bottom.
    const t1 = window.setTimeout(snap, 80);
    const t2 = window.setTimeout(snap, 240);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, [messages.length, isAgentBusy, runItems.length, settings.reducedMotion, planDisclosureOpen, completedStepsOpen]);

  useEffect(() => {
    if (!desktopChromium) return;
    const desktop = getElectronDesktop();
    if (!desktop) return;
    if (!cursor || !isAgentBusy || !settings.showAiCursor || browserState?.agent.manualControl) {
      void desktop.browser.setCursor(null);
      return;
    }
    void desktop.browser.setCursor({
      ...cursor,
      label: cursorIntent,
      showLabel: settings.showAiActionLabels,
      reducedMotion: settings.reducedMotion,
    });
    return () => { void desktop.browser.setCursor(null); };
  }, [browserState?.agent.manualControl, cursor, cursorIntent, desktopChromium, isAgentBusy, settings.reducedMotion, settings.showAiActionLabels, settings.showAiCursor]);
  const activeTab = useMemo(
    () => browserState?.tabs.find((tab) => tab.active),
    [browserState?.tabs],
  );
  const activeInternalTab = useMemo(
    () => internalTabs.find((tab) => tab.id === activeInternalTabId) || null,
    [activeInternalTabId, internalTabs],
  );
  const currentPageBookmark = useMemo(() => {
    const url = activeTab?.url || browserState?.url;
    return url ? browserState?.bookmarks.find((bookmark) => bookmark.url === url) : undefined;
  }, [activeTab?.url, browserState?.bookmarks, browserState?.url]);
  const pageName = useMemo(
    () => displayPageName(activeTab?.url || browserState?.url || address, activeTab?.title || browserState?.title),
    [activeTab?.title, activeTab?.url, address, browserState?.title, browserState?.url],
  );
  const pageContextReady = Boolean((activeTab?.url || browserState?.url) && (activeTab?.title || browserState?.title));
  const frameUrl = browserState
    ? `/api/openbrowser/frame?${isAgentBusy || agentDemo ? "fresh=1&" : ""}v=${browserState.frameVersion}&t=${frameTick}`
    : "";
  const showAgentChrome = isAgentBusy || agentDemo || externalCursorActive;
  const showStartPage =
    !activeInternalTab &&
    !showAgentChrome &&
    (!browserState || isBrowserStartPageUrl(activeTab?.url || browserState?.url || ""));

  // The Electron browser is a native sibling view rather than a DOM child.
  // Ensure it is explicitly hidden while Clyra owns the new-tab welcome
  // surface; otherwise an async surface update from the prior web page can
  // briefly leave a white Chromium layer above this React view.
  useEffect(() => {
    if (!desktopChromium || (!showStartPage && !activeInternalTab)) return;
    const desktop = getElectronDesktop();
    void desktop?.browser.setSurface({ visible: false });
  }, [activeInternalTab, desktopChromium, showStartPage]);
  const aiInControl = agentDemo
    || (["planning", "observing", "executing", "verifying", "recovering"].includes(agentPhase) && !browserState?.agent.manualControl);

  // Keep Ask Clyra closed on pure welcome loads, but never yank it shut mid-send.
  useEffect(() => {
    if (!showStartPage || sideLockRef.current || isAgentBusy) return;
    setSideOpen(false);
  }, [activeTab?.id, showStartPage, isAgentBusy]);
  const agentTaskTitle = agentDemo
    ? (agentDemoKind === "ebay" ? "Searching MacBook M2 on eBay" : agentDemoKind === "typing" ? "Typing a search query" : agentDemoKind === "click" ? "Opening a result" : "Fulfilling beach essentials request")
    : (runTask || browserState?.agent.task || agentStatus || "Working");
  const demoCursor = agentDemo
    ? {
        x: Math.round((browserState?.viewport.width || 1440) * (agentDemoKind === "ebay" ? 0.48 : agentDemoKind === "typing" ? 0.46 : agentDemoKind === "click" ? 0.52 : 0.42)),
        y: Math.round((browserState?.viewport.height || 900) * (agentDemoKind === "ebay" ? 0.44 : agentDemoKind === "typing" ? 0.36 : agentDemoKind === "click" ? 0.48 : 0.38)),
        kind: agentDemoKind === "typing" ? ("type" as const) : agentDemoKind === "click" ? ("click" as const) : ("move" as const),
        label: agentDemoKind === "ebay" ? "Opening MacBook M2 listing" : agentDemoKind === "typing" ? "Typing Clyra AI" : agentDemoKind === "click" ? "Opening result" : "Searching for sunscreen",
        id: 1,
      }
    : null;
  const liveCursor = cursor && (isAgentBusy || externalCursorActive) ? cursor : demoCursor;

  const openInternalPage = (page: InternalBrowserPage) => {
    const existing = internalTabs.find((tab) => tab.page === page);
    const tabId = existing?.id || `clyra-${page}-${Date.now()}`;
    if (!existing) setInternalTabs((tabs) => [...tabs, { id: tabId, page }]);
    setActiveInternalTabId(tabId);
    sideLockRef.current = false;
    setSideOpen(false);
    setBrowserMenuOpen(false);
  };

  const closeInternalPage = (tabId: string) => {
    setInternalTabs((tabs) => tabs.filter((tab) => tab.id !== tabId));
    setActiveInternalTabId((active) => active === tabId ? null : active);
  };

  /* ======================================================================
   * Atlas UI — everything below is presentation and UI-only state. All
   * browsing, agent and profile work goes through the handlers above.
   * ==================================================================== */
  const [toastText, setToastText] = useState<string | null>(null);
  const toastTimerRef = useRef<number | null>(null);
  const toast = useCallback((text: string) => {
    setToastText(text);
    if (toastTimerRef.current != null) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setToastText(null), 2_400);
  }, []);
  const [bookmarkPop, setBookmarkPop] = useState<{ id?: string; title: string; url: string; originalUrl: string; justAdded?: boolean } | null>(null);
  const [sideMenuOpen, setSideMenuOpen] = useState(false);
  const [omniIndex, setOmniIndex] = useState(-1);
  const [tabContext, setTabContext] = useState<{ id: string; x: number; y: number } | null>(null);
  const [frozenFrame, setFrozenFrame] = useState<string | null>(null);
  const [reloadSpin, setReloadSpin] = useState(0);
  const [tabOrder, setTabOrder] = useState<string[]>([]);
  const [dragTab, setDragTab] = useState<{ id: string; x: number; y: number; width: number; offset: number } | null>(null);
  const tabsRef = useRef<HTMLDivElement | null>(null);
  const omniJustFocusedRef = useRef(false);
  const indicatorRef = useRef<HTMLSpanElement | null>(null);
  const toolbarRef = useRef<HTMLDivElement | null>(null);

  const orderedTabs = useMemo(() => {
    const list = browserState?.tabs || [];
    const byId = new Map(list.map((tab) => [tab.id, tab]));
    const ordered = tabOrder.filter((id) => byId.has(id)).map((id) => byId.get(id)!);
    for (const tab of list) if (!tabOrder.includes(tab.id)) ordered.push(tab);
    return ordered;
  }, [browserState?.tabs, tabOrder]);

  // Slide the single blue indicator under whichever tab is active.
  useEffect(() => {
    const strip = tabsRef.current;
    const indicator = indicatorRef.current;
    if (!strip || !indicator) return;
    let frame = 0;
    const until = performance.now() + 520;
    const place = () => {
      const active = strip.querySelector<HTMLElement>(".ab-tab.is-active");
      if (!active) {
        indicator.style.opacity = "0";
      } else {
        const width = Math.max(26, Math.min(active.offsetWidth * 0.72, active.offsetWidth - 24));
        const left = active.offsetLeft + (active.offsetWidth - width) / 2;
        indicator.style.transform = `translate3d(${left}px,0,0)`;
        indicator.style.width = `${width}px`;
        indicator.style.opacity = "1";
      }
      if (performance.now() < until) frame = requestAnimationFrame(place);
    };
    frame = requestAnimationFrame(place);
    const onResize = () => requestAnimationFrame(place);
    window.addEventListener("resize", onResize);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", onResize);
    };
  }, [activeInternalTabId, browserState?.activeTabId, orderedTabs.length, internalTabs.length, settings.reducedMotion]);

  // Chrome-style drag to reorder. Order is a presentation preference; the
  // native tab identities and their pages are untouched.
  const beginTabDrag = (event: React.PointerEvent<HTMLElement>, id: string) => {
    if (event.button !== 0 || (event.target as HTMLElement).closest(".ab-tab-close")) return;
    const node = event.currentTarget;
    const rect = node.getBoundingClientRect();
    const startX = event.clientX;
    let active = false;
    const onMove = (move: PointerEvent) => {
      if (!active && Math.abs(move.clientX - startX) < 5) return;
      if (!active) {
        active = true;
        try { node.setPointerCapture(event.pointerId); } catch { /* best effort */ }
      }
      const strip = tabsRef.current;
      const stripRect = strip?.getBoundingClientRect();
      const x = Math.max(stripRect?.left ?? 0, Math.min((stripRect?.right ?? innerWidth) - rect.width, move.clientX - (startX - rect.left)));
      setDragTab({ id, x, y: rect.top, width: rect.width, offset: startX - rect.left });
      const others = [...(strip?.querySelectorAll<HTMLElement>(".ab-tab[data-tab-id]") || [])].filter((el) => el.dataset.tabId !== id && el.dataset.native === "1");
      const centre = x + rect.width / 2;
      const ids = orderedTabs.map((tab) => tab.id).filter((tabId) => tabId !== id);
      let insertAt = ids.length;
      for (let index = 0; index < others.length; index += 1) {
        const other = others[index]!.getBoundingClientRect();
        if (centre < other.left + other.width / 2) {
          insertAt = ids.indexOf(others[index]!.dataset.tabId || "");
          break;
        }
      }
      ids.splice(Math.max(0, insertAt), 0, id);
      setTabOrder((current) => (current.join("|") === ids.join("|") ? current : ids));
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      if (active) {
        suppressTabClickRef.current = true;
        window.setTimeout(() => { suppressTabClickRef.current = false; }, 120);
      }
      setDragTab(null);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  };
  const suppressTabClickRef = useRef(false);

  const activateTab = (id: string) => {
    if (suppressTabClickRef.current) return;
    setActiveInternalTabId(null);
    void performAction({ type: "switch_tab", tabId: id });
  };
  const closeTab = (id: string) => {
    if ((browserState?.tabs.length || 0) <= 1 && !internalTabs.length) {
      void requestBrowser("/api/openbrowser/navigate", { body: { target: "https://www.google.com/" }, quiet: true }).catch(() => undefined);
      return;
    }
    void performAction({ type: "close_tab", tabId: id });
  };

  /* ---------- Omnibox ---------- */
  const omniQuery = omniboxFocused ? address.trim() : "";
  const omniItems = useMemo(() => {
    if (!omniboxFocused) return [] as Array<{ key: string; icon: "search" | "globe" | "history" | "star"; label: string; detail: string; target: string; url?: string }>;
    const items: Array<{ key: string; icon: "search" | "globe" | "history" | "star"; label: string; detail: string; target: string; url?: string }> = [];
    const typed = omniQuery && omniQuery !== browserState?.url ? omniQuery : "";
    if (typed) {
      if (looksLikeUrl(typed)) items.push({ key: "visit", icon: "globe", label: typed, detail: "Visit", target: typed });
      items.push({ key: "search", icon: "search", label: `Search Google for “${typed}”`, detail: "Google", target: /\s/.test(typed) || !looksLikeUrl(typed) ? typed : `${typed} `.trim() });
    }
    const needle = typed.toLowerCase();
    const seen = new Set<string>();
    const pool = [
      ...(browserState?.bookmarks || []).map((entry) => ({ ...entry, kind: "star" as const })),
      ...(browserState?.history || []).map((entry) => ({ ...entry, kind: "history" as const })),
    ];
    for (const entry of pool) {
      if (items.length >= 7) break;
      if (seen.has(entry.url) || isBrowserStartPageUrl(entry.url)) continue;
      if (needle && !`${entry.title} ${entry.url}`.toLowerCase().includes(needle)) continue;
      seen.add(entry.url);
      items.push({ key: `${entry.kind}-${entry.id}`, icon: entry.kind, label: entry.title || displayHost(entry.url), detail: compactUrl(entry.url), target: entry.url, url: entry.url });
    }
    return items;
  }, [browserState?.bookmarks, browserState?.history, browserState?.url, omniQuery, omniboxFocused]);
  useEffect(() => setOmniIndex(-1), [omniQuery]);

  const displayAddress = useMemo(() => {
    if (omniboxFocused) return address;
    const url = browserState?.url || address;
    if (!url || isBrowserStartPageUrl(url)) return "";
    try {
      const parsed = new URL(url);
      if (/(^|\.)google\.[a-z.]+$/i.test(parsed.hostname) && parsed.pathname === "/search" && parsed.searchParams.get("q")) {
        return parsed.searchParams.get("q") || "";
      }
      return `${parsed.hostname.replace(/^www\./, "")}${parsed.pathname === "/" ? "" : parsed.pathname}${parsed.search}`;
    } catch {
      return url;
    }
  }, [address, browserState?.url, omniboxFocused]);

  /* ---------- Bookmarks ---------- */
  const openBookmarkEditor = async () => {
    const url = activeTab?.url || browserState?.url;
    if (!url || activeInternalTab || isBrowserStartPageUrl(url)) {
      toast("Visit a webpage to bookmark it");
      return;
    }
    let existing = browserState?.bookmarks.find((bookmark) => bookmark.url === url);
    const justAdded = !existing;
    if (!existing) {
      const response = await requestBrowser("/api/openbrowser/bookmarks", { body: { url, title: browserState?.title || activeTab?.title }, quiet: true }).catch(() => null);
      existing = (response?.state as BrowserState | undefined)?.bookmarks?.find((bookmark) => bookmark.url === url);
      toast("Added to bookmarks");
    }
    setBookmarkPop({ id: existing?.id, title: existing?.title || browserState?.title || activeTab?.title || displayHost(url), url, originalUrl: url, justAdded });
  };
  const saveBookmarkEdit = async (event: FormEvent) => {
    event.preventDefault();
    if (!bookmarkPop) return;
    const url = normalizeTypedUrl(bookmarkPop.url);
    if (!url) {
      toast("Enter a valid website address");
      return;
    }
    if (bookmarkPop.id && url !== bookmarkPop.originalUrl) {
      await requestBrowser(`/api/openbrowser/bookmarks/${bookmarkPop.id}`, { method: "DELETE", quiet: true }).catch(() => undefined);
    }
    await requestBrowser("/api/openbrowser/bookmarks", { body: { url, title: bookmarkPop.title.trim() || displayHost(url) }, quiet: true }).catch(() => undefined);
    if (!settings.showBookmarksBar) void updateSettings({ showBookmarksBar: true });
    setBookmarkPop(null);
  };
  const removeBookmarkFromPop = async () => {
    if (bookmarkPop?.id) await requestBrowser(`/api/openbrowser/bookmarks/${bookmarkPop.id}`, { method: "DELETE", quiet: true }).catch(() => undefined);
    setBookmarkPop(null);
    toast("Bookmark removed");
  };

  /* ---------- Native page freeze while a menu overlaps it ---------- */
  const omniMenuVisible = omniboxFocused && omniItems.length > 0;
  const pageOverlayOpen = desktopChromium && !showStartPage && !activeInternalTab
    && (omniMenuVisible || browserMenuOpen || Boolean(bookmarkPop) || Boolean(tabContext));
  useEffect(() => {
    if (!desktopChromium) return;
    if (!pageOverlayOpen) {
      window.dispatchEvent(new CustomEvent("clyra:native-surface-occlusion", { detail: { occluded: false } }));
      const timer = window.setTimeout(() => setFrozenFrame(null), 90);
      return () => window.clearTimeout(timer);
    }
    let cancelled = false;
    const desktop = getElectronDesktop();
    void (async () => {
      // A native Chromium view paints above every DOM layer, so a menu that
      // overlaps the page shows a pixel-exact snapshot of the page instead.
      const shot = await desktop?.taskView
        .capture({ bounds: { x: 0, y: 0, width: 2, height: 2 }, nativeBrowser: true, nativeOnly: true })
        .catch(() => null);
      if (cancelled) return;
      if (shot?.nativeLayer?.src) setFrozenFrame(shot.nativeLayer.src);
      window.dispatchEvent(new CustomEvent("clyra:native-surface-occlusion", { detail: { occluded: true } }));
    })();
    return () => { cancelled = true; };
  }, [desktopChromium, pageOverlayOpen]);
  useEffect(() => () => {
    window.dispatchEvent(new CustomEvent("clyra:native-surface-occlusion", { detail: { occluded: false } }));
  }, []);

  // Close floating UI on outside click / Escape.
  useEffect(() => {
    const onDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement;
      if (!target.closest(".ab-menu-pop, [data-menu-toggle]")) setBrowserMenuOpen(false);
      if (!target.closest(".ab-bookmark-pop, [data-bookmark-toggle]")) setBookmarkPop(null);
      if (!target.closest(".ab-side-menu, [data-side-menu-toggle]")) setSideMenuOpen(false);
      if (!target.closest(".ab-tab-context")) setTabContext(null);
    };
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setBrowserMenuOpen(false);
      setBookmarkPop(null);
      setSideMenuOpen(false);
      setTabContext(null);
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [setBrowserMenuOpen]);

  // Clicks on the status pill injected into the native page (Electron).
  const controlAgentRef = useRef(controlAgent);
  controlAgentRef.current = controlAgent;
  useEffect(() => {
    const desktop = getElectronDesktop();
    if (!desktop?.browser.onAgentControl) return;
    return desktop.browser.onAgentControl(({ command }) => { void controlAgentRef.current(command); });
  }, []);

  const runRows = useMemo(() => rowsFromRunItems(runItems), [runItems]);
  const liveThinking = (((isAgentBusy || agentDemo) && !["executing", "paused", "waiting_for_user"].includes(agentPhase)) || askingPage)
    && !runRows.some((row) => row.status === "running");
  const askQuestion = [...runItems].reverse().find((item): item is Extract<RunItem, { kind: "ask" }> => item.kind === "ask");
  const sendFromSidebar = () => {
    const text = task.trim();
    if (!text) return;
    if (agentMode) void runAgentTask(text);
    else void askAboutPage(text);
  };
  const openAssistant = (draft?: string) => {
    markAskClyraUsed();
    sideLockRef.current = true;
    setSideView("agent");
    setSideOpen(true);
    if (draft !== undefined) setTask(draft);
    window.setTimeout(() => document.querySelector<HTMLTextAreaElement>(".ab-chat-box textarea")?.focus(), 320);
  };
  const tabIcon = (tab: BrowserTab) => {
    if (tab.loading) return <Loader2 className="animate-spin" />;
    if (isBrowserStartPageUrl(tab.url)) return <Search />;
    const src = tab.favicon || (tab.url && !isBrowserStartPageUrl(tab.url) ? faviconFor(tab.url) : "");
    if (src) return <img src={src} alt="" onError={(event) => { event.currentTarget.style.display = "none"; }} />;
    return isBrowserStartPageUrl(tab.url) ? <Search /> : <Globe2 />;
  };
  const showWebStatus = !desktopChromium && showAgentChrome;

  return (
    <div className={cn("ab", settings.reducedMotion && "ab-reduced")}>
      {/* ---------------- Tab strip ---------------- */}
      <div className="ab-tabbar">
        <div className="ab-tabs" ref={tabsRef} role="tablist" aria-label="Browser tabs">
          {orderedTabs.map((tab) => {
            const agentOwnsTab = Boolean(agentControlledTabId && tab.id === agentControlledTabId && isAgentBusy && !browserState?.agent.manualControl);
            const selected = tab.active && !activeInternalTab;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={selected}
                data-tab-id={tab.id}
                data-native="1"
                className={cn("ab-tab", selected && "is-active", dragTab?.id === tab.id && "is-dragging")}
                title={agentOwnsTab ? "Clyra is working in this tab" : tab.title || "New tab"}
                onClick={() => activateTab(tab.id)}
                onPointerDown={(event) => beginTabDrag(event, tab.id)}
                onAuxClick={(event) => { if (event.button === 1) closeTab(tab.id); }}
                onContextMenu={(event) => { event.preventDefault(); setTabContext({ id: tab.id, x: event.clientX, y: event.clientY }); }}
              >
                <span className="ab-tab-icon">{tabIcon(tab)}</span>
                <span className={cn("ab-tab-label", agentOwnsTab && "ab-shine")}>
                  {agentOwnsTab ? truncateLabel(agentStatus || "Working", 28) : isBrowserStartPageUrl(tab.url) ? "New Tab" : (tab.active && browserState?.title && browserState.url === tab.url ? browserState.title : tab.title) || displayHost(tab.url)}
                </span>
                <span
                  role="button"
                  tabIndex={-1}
                  aria-label={`Close ${tab.title || "tab"}`}
                  className="ab-tab-close"
                  onClick={(event) => { event.stopPropagation(); closeTab(tab.id); }}
                >
                  <X />
                </span>
              </button>
            );
          })}
          {internalTabs.map((tab) => {
            const title = tab.page === "history" ? "History" : tab.page === "bookmarks" ? "Bookmarks" : tab.page === "downloads" ? "Downloads" : "Settings";
            const Icon = tab.page === "history" ? History : tab.page === "bookmarks" ? Star : tab.page === "downloads" ? Download : Settings2;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={activeInternalTabId === tab.id}
                data-tab-id={tab.id}
                className={cn("ab-tab", activeInternalTabId === tab.id && "is-active")}
                onClick={() => setActiveInternalTabId(tab.id)}
                onAuxClick={(event) => { if (event.button === 1) closeInternalPage(tab.id); }}
              >
                <span className="ab-tab-icon"><Icon /></span>
                <span className="ab-tab-label">{title}</span>
                <span role="button" tabIndex={-1} aria-label={`Close ${title}`} className="ab-tab-close" onClick={(event) => { event.stopPropagation(); closeInternalPage(tab.id); }}>
                  <X />
                </span>
              </button>
            );
          })}
          <span className="ab-tab-indicator" ref={indicatorRef} aria-hidden />
        </div>
        <button type="button" className="ab-iconbtn" title="New tab (⌘T)" aria-label="New tab" onClick={() => void performAction({ type: "open_tab" })}>
          <Plus />
        </button>
        <span className="ab-tab-spacer" />
        <button type="button" className={cn("ab-iconbtn", browserMenuOpen && "is-on")} data-menu-toggle aria-label="Browser menu" title="Customize and control browser" aria-expanded={browserMenuOpen} onClick={() => setBrowserMenuOpen((value) => !value)}>
          <EllipsisVertical />
        </button>
        {browserMenuOpen ? (
          <div className="ab-pop ab-menu-pop" role="menu" style={{ right: 10, top: 44, width: 268 }}>
            <button type="button" className="ab-pop-row" onClick={() => { setBrowserMenuOpen(false); void performAction({ type: "open_tab" }); }}><Plus /><span className="ab-pop-main">New tab</span><small>⌘T</small></button>
            <button type="button" className="ab-pop-row" onClick={() => { setBrowserMenuOpen(false); void performAction({ type: "restore_closed_tab" }); }}><RotateCcw /><span className="ab-pop-main">Reopen closed tab</span><small>⇧⌘T</small></button>
            <div className="ab-pop-sep" />
            <button type="button" className="ab-pop-row" onClick={() => openInternalPage("history")}><History /><span className="ab-pop-main">History</span></button>
            <button type="button" className="ab-pop-row" onClick={() => openInternalPage("bookmarks")}><Star /><span className="ab-pop-main">Bookmarks</span></button>
            <button type="button" className="ab-pop-row" onClick={() => openInternalPage("downloads")}><Download /><span className="ab-pop-main">Downloads</span></button>
            <button type="button" className="ab-pop-row" onClick={() => { setBrowserMenuOpen(false); void updateSettings({ showBookmarksBar: !settings.showBookmarksBar }); }}><Bookmark /><span className="ab-pop-main">{settings.showBookmarksBar ? "Hide" : "Show"} bookmarks bar</span><small>⇧⌘B</small></button>
            <div className="ab-pop-sep" />
            <button type="button" className="ab-pop-row" onClick={() => { setBrowserMenuOpen(false); setFindOpen(true); window.setTimeout(() => findInputRef.current?.select(), 30); }}><Search /><span className="ab-pop-main">Find in page</span><small>⌘F</small></button>
            {desktopChromium ? (
              <button type="button" className="ab-pop-row" disabled={snipBusy} onClick={() => { setBrowserMenuOpen(false); void handleSnip(); }}><Crop /><span className="ab-pop-main">Snip &amp; Ask</span></button>
            ) : null}
            <div className="ab-pop-zoom">
              <span style={{ textAlign: "left", minWidth: 0, fontSize: 12.8, color: "#3b3d42" }}>Zoom</span>
              <div>
                <button type="button" className="ab-iconbtn" aria-label="Zoom out" onClick={() => void zoom(-0.1)}><Minus /></button>
                <span>{Math.round((browserState?.zoom || 1) * 100)}%</span>
                <button type="button" className="ab-iconbtn" aria-label="Zoom in" onClick={() => void zoom(0.1)}><Plus /></button>
              </div>
            </div>
            <div className="ab-pop-sep" />
            <button type="button" className="ab-pop-row" onClick={() => openInternalPage("settings")}><Settings2 /><span className="ab-pop-main">Settings</span></button>
          </div>
        ) : null}
        {tabContext ? (
          <div className="ab-pop ab-tab-context" role="menu" style={{ position: "fixed", left: Math.min(tabContext.x, innerWidth - 200), top: tabContext.y + 4, width: 190 }}>
            <button type="button" className="ab-pop-row" onClick={() => { setTabContext(null); void performAction({ type: "open_tab" }); }}><Plus /><span className="ab-pop-main">New tab</span></button>
            <button type="button" className="ab-pop-row" onClick={() => { const id = tabContext.id; setTabContext(null); void performAction({ type: "duplicate_tab", tabId: id }); }}><Copy /><span className="ab-pop-main">Duplicate</span></button>
            <button type="button" className="ab-pop-row" onClick={() => { const id = tabContext.id; setTabContext(null); closeTab(id); }}><X /><span className="ab-pop-main">Close tab</span></button>
            <button type="button" className="ab-pop-row" onClick={() => { setTabContext(null); void performAction({ type: "restore_closed_tab" }); }}><RotateCcw /><span className="ab-pop-main">Reopen closed tab</span></button>
          </div>
        ) : null}
      </div>
      {dragTab ? (
        <div className="ab-tab-float" style={{ left: dragTab.x, top: dragTab.y, width: dragTab.width }} aria-hidden>
          {(() => {
            const tab = orderedTabs.find((item) => item.id === dragTab.id);
            return tab ? <><span className="ab-tab-icon">{tabIcon(tab)}</span><span className="ab-tab-label">{isBrowserStartPageUrl(tab.url) ? "New Tab" : tab.title}</span></> : null;
          })()}
        </div>
      ) : null}

      {/* ---------------- Toolbar ---------------- */}
      <div className="ab-toolbar" ref={toolbarRef}>
        <nav className="ab-nav" aria-label="Browser navigation">
          <button type="button" className="ab-iconbtn" title="Back" aria-label="Back" disabled={Boolean(activeInternalTab) || !browserState?.canGoBack} onClick={() => void performAction({ type: "back" })}><ArrowLeft /></button>
          <button type="button" className="ab-iconbtn" title="Forward" aria-label="Forward" disabled={Boolean(activeInternalTab) || !browserState?.canGoForward} onClick={() => void performAction({ type: "forward" })}><ArrowRight /></button>
          <button
            type="button"
            key={reloadSpin}
            className={cn("ab-iconbtn ab-reload", reloadSpin > 0 && "is-spinning")}
            title={browserState?.loading ? "Stop loading" : "Reload"}
            aria-label={browserState?.loading ? "Stop loading" : "Reload"}
            disabled={Boolean(activeInternalTab)}
            onClick={() => {
              if (browserState?.loading) {
                void performAction({ type: "stop_loading" });
                return;
              }
              setReloadSpin((value) => value + 1);
              void performAction({ type: "reload" });
            }}
          >
            {browserState?.loading ? <X /> : <RotateCw />}
          </button>
        </nav>
        <div className="ab-address" role="search">
          <span className="ab-address-icon">{browserState?.secure && !omniboxFocused && !showStartPage ? <LockKeyhole /> : <Search />}</span>
          <input
            data-browser-omnibox
            value={displayAddress}
            placeholder="Search Google or type a URL"
            aria-label="Address and search bar"
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => {
              editingAddressRef.current = true;
              setAddress(event.target.value);
            }}
            onFocus={(event) => {
              editingAddressRef.current = true;
              setOmniboxFocused(true);
              const url = browserState?.url || "";
              setAddress(isBrowserStartPageUrl(url) ? "" : url);
              const input = event.currentTarget;
              omniJustFocusedRef.current = true;
              window.setTimeout(() => input.select(), 0);
            }}
            onMouseUp={(event) => {
              // Chrome behaviour: the first click selects the whole address;
              // the mouseup would otherwise collapse that selection.
              if (!omniJustFocusedRef.current) return;
              omniJustFocusedRef.current = false;
              event.preventDefault();
              event.currentTarget.select();
            }}
            onBlur={() => {
              window.setTimeout(() => {
                editingAddressRef.current = false;
                setOmniboxFocused(false);
                if (browserState?.url) setAddress(browserState.url);
              }, 140);
            }}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown" && omniItems.length) {
                event.preventDefault();
                setOmniIndex((index) => (index + 1) % omniItems.length);
                return;
              }
              if (event.key === "ArrowUp" && omniItems.length) {
                event.preventDefault();
                setOmniIndex((index) => (index <= 0 ? omniItems.length - 1 : index - 1));
                return;
              }
              if (event.key === "Escape") {
                editingAddressRef.current = false;
                if (browserState?.url) setAddress(browserState.url);
                event.currentTarget.blur();
                return;
              }
              if (event.key !== "Enter") return;
              event.preventDefault();
              const picked = omniIndex >= 0 ? omniItems[omniIndex] : null;
              const typed = picked ? picked.target : event.currentTarget.value;
              editingAddressRef.current = false;
              setOmniboxFocused(false);
              void navigate(undefined, typed);
              event.currentTarget.blur();
            }}
          />
          <div className="ab-address-end">
            <button
              type="button"
              className="ab-addr-btn is-clear"
              aria-label="Clear"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => { setAddress(""); document.querySelector<HTMLInputElement>("[data-browser-omnibox]")?.focus(); }}
            >
              <X />
            </button>
            <button
              type="button"
              data-bookmark-toggle
              className={cn("ab-addr-btn", currentPageBookmark && "is-starred")}
              title={currentPageBookmark ? "Edit bookmark" : "Bookmark this page (⌘D)"}
              aria-label={currentPageBookmark ? "Edit bookmark" : "Bookmark this page"}
              disabled={Boolean(activeInternalTab) || showStartPage}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => { if (bookmarkPop) setBookmarkPop(null); else void openBookmarkEditor(); }}
            >
              <Star />
            </button>
          </div>
          {omniMenuVisible ? (
            <div className="ab-pop ab-omnibox" role="listbox">
              {omniItems.map((item, index) => (
                <button
                  key={item.key}
                  type="button"
                  role="option"
                  aria-selected={index === omniIndex}
                  className={cn("ab-pop-row", index === omniIndex && "is-selected")}
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseEnter={() => setOmniIndex(index)}
                  onClick={() => {
                    editingAddressRef.current = false;
                    setOmniboxFocused(false);
                    void navigate(undefined, item.target);
                    (document.activeElement as HTMLElement | null)?.blur();
                  }}
                >
                  {item.url ? <img src={faviconFor(item.url)} alt="" onError={(event) => { event.currentTarget.style.display = "none"; }} /> : item.icon === "search" ? <Search /> : <Globe2 />}
                  <span className="ab-pop-main">{item.label}</span>
                  <small>{item.detail}</small>
                </button>
              ))}
            </div>
          ) : null}
          {bookmarkPop ? (
            <form className="ab-pop ab-bookmark-pop" style={{ right: 0, top: 46 }} onSubmit={(event) => void saveBookmarkEdit(event)}>
              <header>
                <strong>{bookmarkPop.justAdded ? "Bookmark added" : "Edit bookmark"}</strong>
                <button type="button" className="ab-iconbtn" aria-label="Close" onClick={() => setBookmarkPop(null)}><X /></button>
              </header>
              <label>Name<input value={bookmarkPop.title} onChange={(event) => setBookmarkPop((current) => current ? { ...current, title: event.target.value } : current)} maxLength={90} autoFocus /></label>
              <label>URL<input value={bookmarkPop.url} onChange={(event) => setBookmarkPop((current) => current ? { ...current, url: event.target.value } : current)} spellCheck={false} /></label>
              <footer>
                <button type="button" className="ab-btn is-danger" onClick={() => void removeBookmarkFromPop()}>Remove</button>
                <button type="button" className="ab-btn" onClick={() => setBookmarkPop(null)}>Cancel</button>
                <button type="submit" className="ab-btn is-primary">Save</button>
              </footer>
            </form>
          ) : null}
        </div>
        <div className="ab-end">
          <button
            type="button"
            className={cn("ab-ask", sideOpen && "is-open")}
            title="Assistant (⌥A)"
            aria-pressed={sideOpen}
            onClick={() => {
              markAskClyraUsed();
              setShowAskClyraPulse(false);
              setSideView("agent");
              setSideOpen((value) => {
                sideLockRef.current = !value;
                return !value;
              });
            }}
          >
            <Sparkles />
            <span>Assistant</span>
          </button>
        </div>
        <div className={cn("ab-loading", (browserState?.loading || isBrowserBusy) && !showStartPage && "is-on")} aria-hidden />
      </div>

      {/* ---------------- Bookmarks bar ---------------- */}
      {settings.showBookmarksBar ? (
        <div className="ab-bmbar" aria-label="Bookmarks bar">
          <div className="ab-bmbar-items">
            {browserState?.bookmarks.length ? browserState.bookmarks.slice(0, 24).map((bookmark) => (
              <button key={bookmark.id} type="button" title={bookmark.url} onClick={() => void navigate(undefined, bookmark.url)}>
                <img src={faviconFor(bookmark.url)} alt="" onError={(event) => { event.currentTarget.style.display = "none"; }} />
                <span>{bookmark.title || displayHost(bookmark.url)}</span>
              </button>
            )) : (
              <button type="button" className="ab-bmbar-empty" onClick={() => void openBookmarkEditor()}>☆&nbsp; Save pages with the star in the address bar</button>
            )}
          </div>
          <button type="button" onClick={() => openInternalPage("bookmarks")} title="All bookmarks"><Bookmark /><span>All bookmarks</span></button>
        </div>
      ) : null}

      {/* ---------------- Page + assistant ---------------- */}
      <div className="ab-main">
        <main
          className="ab-web"
          ref={previewRef}
          tabIndex={0}
          onKeyDown={handlePreviewKeyDown}
          onWheel={showStartPage || activeInternalTab ? undefined : handlePreviewWheel}
          aria-label="Web page"
        >
          {activeInternalTab ? (
            <AtlasInternalPage
              page={activeInternalTab.page}
              history={browserState?.history || []}
              bookmarks={browserState?.bookmarks || []}
              downloads={browserState?.downloads || []}
              settings={settings}
              onOpenPage={openInternalPage}
              onNavigate={(target) => void navigate(undefined, target)}
              onClearHistory={(ids) => void requestBrowser("/api/openbrowser/history", { method: "DELETE", body: ids ? { ids } : {}, quiet: true }).catch(() => undefined)}
              onRemoveBookmark={(id) => void requestBrowser(`/api/openbrowser/bookmarks/${id}`, { method: "DELETE", quiet: true }).catch(() => undefined)}
              onAddBookmark={() => {
                const url = activeTab?.url || browserState?.url;
                if (!url || isBrowserStartPageUrl(url)) { toast("Open a webpage first, then bookmark it"); return; }
                void requestBrowser("/api/openbrowser/bookmarks", { body: { url, title: activeTab?.title }, quiet: true }).then(() => toast("Bookmark saved")).catch(() => undefined);
              }}
              onUpdateSettings={(patch) => void updateSettings(patch)}
            />
          ) : showStartPage ? (
            <BrowserStartPage
              onNavigate={(target) => void navigate(undefined, target)}
              onAskAgent={(prompt) => {
                openAssistant();
                void runAgentTask(prompt);
              }}
            />
          ) : browserState && desktopChromium ? (
            <>
              <ElectronWebContentsSurface
                title={`Live browser page: ${browserState.title}`}
                surfaceId="primary-browser"
                kind="browser"
                className="h-full w-full"
                active={!showStartPage && !activeInternalTab}
              />
              {frozenFrame ? <img className="ab-freeze" src={frozenFrame} alt="" aria-hidden /> : null}
            </>
          ) : browserState ? (
            <img
              data-clyra-browser-frame="1"
              src={frameUrl}
              alt={`Live browser page: ${browserState.title}`}
              draggable={false}
              onClick={(event) => void clickPreview(event)}
              className="ab-web-frame"
              style={{ opacity: isBrowserBusy || (isAgentBusy && browserState.loading) ? 0.6 : 1, transition: "opacity .15s ease" }}
            />
          ) : (
            <div className="ab-skeleton"><div><i style={{ width: "50%", height: 26 }} /><i /><i style={{ width: "80%" }} /><i style={{ height: 160, marginTop: 16 }} /></div></div>
          )}

          {/* Web-preview mode draws its own aura + pill; the native Electron
              page carries an injected equivalent (electron/agent-chrome-script). */}
          {!desktopChromium ? <BrowserAgentAura active={aiInControl && !activeInternalTab} reducedMotion={settings.reducedMotion} className="ab-aura" /> : null}

          {/* While Clyra works the page is hers: clicks and keys go nowhere until the task ends (Stop is the way out). */}
          {!desktopChromium && aiInControl && !activeInternalTab ? (
            <div className="ab-lock" role="status" aria-live="polite">
              <span className="ab-lock-pill">
                <Sparkles />
                <span>Clyra is working here. You'll get control back when it finishes.</span>
                <button type="button" onClick={() => void controlAgent("stop")}>Stop</button>
              </span>
            </div>
          ) : null}

          {!desktopChromium && liveCursor && showAgentChrome && settings.showAiCursor && !browserState?.agent.manualControl ? (
            <motion.div
              className="ab-cursor"
              initial={false}
              animate={{
                left: `${(liveCursor.x / (browserState?.viewport.width || 1440)) * 100}%`,
                top: `${(liveCursor.y / (browserState?.viewport.height || 900)) * 100}%`,
              }}
              transition={settings.aiCursorSpeed === "instant" ? { duration: 0.04 } : { type: "spring", stiffness: settings.aiCursorSpeed === "fast" ? 430 : 260, damping: settings.aiCursorSpeed === "fast" ? 34 : 29, mass: 0.52 }}
              aria-hidden
            >
              <span className="ab-cursor-glow" />
              <svg className="ab-cursor-arrow" viewBox="0 0 24 24" aria-hidden><path d="M5 3v17l4.7-4.7 3 6.4 3-1.5-3.1-6.2 6.8-.7L5 3z" /></svg>
              {settings.showAiActionLabels ? <span className="ab-cursor-label">{cursorIntent}</span> : null}
              {liveCursor.kind === "click" || liveCursor.kind === "double_click" ? <span key={liveCursor.id} className="ab-cursor-click" /> : null}
            </motion.div>
          ) : null}

          <AnimatePresence>
            {showWebStatus ? (
              <motion.div
                className="ab-status"
                role="status"
                initial={{ opacity: 0, x: "-50%", y: 16 }}
                animate={{ opacity: 1, x: "-50%", y: 0 }}
                exit={{ opacity: 0, x: "-50%", y: 12 }}
                transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
              >
                <Sparkles />
                <span className="ab-status-label">
                  {browserState?.agent.manualControl ? "You have control" : agentPhase === "paused" ? "Paused" : truncateLabel(agentStatus && agentStatus !== "Ready" ? agentStatus : agentTaskTitle, 60)}
                </span>
                {browserState?.agent.manualControl ? (
                  <button type="button" onClick={() => void controlAgent("return_control")}>Return control</button>
                ) : agentPhase === "paused" ? (
                  <button type="button" onClick={() => void controlAgent("resume")}>Resume</button>
                ) : (
                  <button type="button" onClick={() => void controlAgent("take_control")}>Take control</button>
                )}
                <button type="button" className="is-stop" onClick={() => void controlAgent("stop")}>Stop</button>
              </motion.div>
            ) : null}
          </AnimatePresence>

          {findOpen ? (
            <div className="ab-find" role="search">
              <Search />
              <input
                ref={findInputRef}
                autoFocus
                value={findQuery}
                placeholder="Find on page"
                onChange={(event) => {
                  setFindQuery(event.target.value);
                  void runFind(event.target.value);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") { event.preventDefault(); void runFind(findQuery); }
                  else if (event.key === "Escape") { event.preventDefault(); closeFind(); }
                }}
              />
              {findResult ? <small>{findResult.total ? `${findResult.current} of ${findResult.total}` : "No results"}</small> : null}
              <button type="button" className="ab-iconbtn" aria-label="Close find" onClick={closeFind}><X /></button>
            </div>
          ) : null}

          {error ? (
            <div className="ab-error" role="alert">
              <span>{error.split("╔")[0]?.trim() || error}</span>
              <button type="button" onClick={() => { setError(null); void loadState(); }}>Retry</button>
            </div>
          ) : null}
          {toastText ? <div className="ab-toast" role="status">{toastText}</div> : null}
        </main>

        {typeof document !== "undefined" ? createPortal(
          <AnimatePresence>
            {snipCard ? (
              <motion.div
                key="snip-card"
                initial={{ opacity: 0, scale: 0.96, y: 4 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.97, transition: { duration: 0.12 } }}
                transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
                style={{ position: "fixed", left: snipCard.left, top: snipCard.top, width: 340, zIndex: 300 }}
                className="overflow-hidden rounded-2xl border border-black/[0.08] bg-white shadow-[0_20px_50px_rgba(15,23,42,0.16)]"
              >
                <div onMouseDown={handleSnipCardDragStart} className="flex cursor-grab items-center justify-between gap-2 border-b border-black/[0.06] px-3.5 py-2.5 active:cursor-grabbing">
                  <span className="text-[11.5px] font-semibold text-[#1f2227]">Clyra</span>
                  <button type="button" onClick={() => setSnipCard(null)} aria-label="Close" className="grid h-6 w-6 place-items-center rounded-full text-[#8a9099] hover:bg-black/[0.05]"><X className="h-3.5 w-3.5" /></button>
                </div>
                <div className="max-h-[340px] overflow-y-auto px-3.5 py-3">
                  {snipCard.status === "loading" ? (
                    <div className="flex items-center gap-2 text-[13px] text-[#5a6170]"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Reading selection…</div>
                  ) : snipCard.status === "error" ? (
                    <p className="text-[13px] leading-relaxed text-rose-600">{snipCard.error}</p>
                  ) : (
                    <>
                      <p className="text-[13.5px] leading-relaxed text-[#1f2227]">{snipCard.direct}</p>
                      {snipCard.explanation ? <p className="mt-2.5 whitespace-pre-wrap text-[12.5px] leading-relaxed text-[#5a6170]">{snipCard.explanation}</p> : null}
                    </>
                  )}
                </div>
                {snipCard.status === "done" ? (
                  <div className="flex items-center gap-1.5 border-t border-black/[0.06] px-3 py-2">
                    <input
                      value={snipFollowUp}
                      onChange={(event) => setSnipFollowUp(event.target.value)}
                      onKeyDown={(event) => { if (event.key === "Enter") void handleSnipFollowUp(); }}
                      placeholder="Ask a follow-up…"
                      className="min-w-0 flex-1 bg-transparent text-[12.5px] outline-none"
                    />
                    <button type="button" onClick={() => void handleSnipFollowUp()} disabled={snipFollowUpBusy || !snipFollowUp.trim()} aria-label="Ask follow-up" className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-[#1677ff] text-white disabled:opacity-25">
                      {snipFollowUpBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <ArrowUp className="h-3 w-3" />}
                    </button>
                  </div>
                ) : null}
              </motion.div>
            ) : null}
          </AnimatePresence>,
          document.body,
        ) : null}

        {/* ---------------- Assistant sidebar ---------------- */}
        <AnimatePresence initial={false}>
          {sideOpen ? (
            <motion.aside
              className="ab-sidebar"
              aria-label="Assistant"
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: "var(--ab-sidebar)", opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ duration: settings.reducedMotion ? 0.01 : 0.4, ease: [0.22, 1, 0.36, 1] }}
              onUpdate={() => window.dispatchEvent(new Event("clyra:native-surface-layout"))}
              onAnimationComplete={() => window.dispatchEvent(new Event("clyra:native-surface-layout"))}
            >
              <div className="ab-sidebar-inner">
                <header className="ab-side-head">
                  <button type="button" className="ab-iconbtn" aria-label="Close assistant" title="Close" onClick={() => { sideLockRef.current = false; setSideOpen(false); }}>
                    <PanelRightClose />
                  </button>
                  <span className="ab-side-title">{isAgentBusy ? <span className="ab-shine">{truncateLabel(agentTaskTitle, 34)}</span> : "Assistant"}</span>
                  <button type="button" className={cn("ab-iconbtn", sideMenuOpen && "is-on")} data-side-menu-toggle aria-label="Conversation options" onClick={() => setSideMenuOpen((value) => !value)}>
                    <Ellipsis />
                  </button>
                  {sideMenuOpen ? (
                    <div className="ab-pop ab-side-menu" role="menu">
                      <button type="button" className="ab-pop-row" onClick={() => { setSideMenuOpen(false); if (isAgentBusy) void controlAgent("stop"); setMessages([]); toast("New chat started"); }}><Plus /><span className="ab-pop-main">New chat</span></button>
                      <button
                        type="button"
                        className="ab-pop-row"
                        disabled={!messages.length}
                        onClick={() => {
                          setSideMenuOpen(false);
                          const text = messages.map((message) => `${message.role === "user" ? "You" : "Assistant"}: ${message.content}`).join("\n\n");
                          void navigator.clipboard?.writeText(text).then(() => toast("Conversation copied")).catch(() => toast("Clipboard unavailable"));
                        }}
                      >
                        <Copy /><span className="ab-pop-main">Copy conversation</span>
                      </button>
                      <button type="button" className="ab-pop-row" onClick={() => { setSideMenuOpen(false); sideLockRef.current = false; setSideOpen(false); }}><PanelRightClose /><span className="ab-pop-main">Close assistant</span></button>
                    </div>
                  ) : null}
                </header>

                <div className="ab-chat" ref={chatScrollRef}>
                  {messages.length === 0 && !isAgentBusy && !askingPage ? (
                    <ChatEmpty onPick={(prompt) => {
                      if (/ $/.test(prompt)) {
                        setTask(prompt);
                        window.setTimeout(() => document.querySelector<HTMLTextAreaElement>(".ab-chat-box textarea")?.focus(), 30);
                      } else if (agentMode) void runAgentTask(prompt);
                      else void askAboutPage(prompt);
                    }} />
                  ) : null}
                  {messages.length > 0 && pageContextReady && !showStartPage ? (
                    <div className="ab-chat-page">
                      {activeTab?.url ? <img src={activeTab.favicon || faviconFor(activeTab.url)} alt="" onError={(event) => { event.currentTarget.style.display = "none"; }} /> : <Globe2 />}
                      <span>{pageName}</span>
                    </div>
                  ) : null}
                  {messages.map((message) => message.role === "user" ? (
                    <div key={message.id} className="ab-user">{message.content}</div>
                  ) : (
                    <div key={message.id}>
                      {message.run?.rows.length ? <ActionStream rows={message.run.rows} live={false} finished={message.run} /> : null}
                      <AssistantMessage content={message.content} sources={message.facts} error={message.error} onCopied={() => toast("Copied")} />
                    </div>
                  ))}
                  {(isAgentBusy || agentDemo) && runRows.length ? (
                    <ActionStream rows={runRows} live startedAt={runStartedAt || undefined} />
                  ) : null}
                  {askQuestion && agentPhase === "waiting_for_user" ? (
                    <div className="ab-ask-card"><strong>Needs your input</strong>{askQuestion.question}</div>
                  ) : null}
                  {liveThinking ? <ThinkingRow label={askingPage ? "Reading this page" : agentPhase === "planning" ? "Thinking" : truncateLabel(agentStatus && agentStatus !== "Ready" ? agentStatus : "Thinking", 48)} /> : null}
                  <div ref={chatEndRef} aria-hidden style={{ height: 1 }} />
                </div>

                <div className="ab-chat-composer">
                  {pageContextReady && !showStartPage && !activeInternalTab ? (
                    <div className="ab-chip-row">
                      <span className="ab-chip" title={activeTab?.url}>
                        {activeTab?.url ? <img src={activeTab.favicon || faviconFor(activeTab.url)} alt="" onError={(event) => { event.currentTarget.style.display = "none"; }} /> : <Globe2 />}
                        <span>{pageName}</span>
                      </span>
                    </div>
                  ) : null}
                  <form className="ab-chat-box" onSubmit={(event) => { event.preventDefault(); sendFromSidebar(); }}>
                    <textarea
                      value={task}
                      rows={2}
                      placeholder={agentMode ? "Ask anything or describe a task" : "Ask about this page"}
                      aria-label="Message the assistant"
                      onChange={(event) => {
                        setTask(event.target.value);
                        const node = event.currentTarget;
                        node.style.height = "auto";
                        node.style.height = `${Math.min(140, Math.max(43, node.scrollHeight))}px`;
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" && !event.shiftKey) {
                          event.preventDefault();
                          sendFromSidebar();
                        }
                      }}
                    />
                    <div className="ab-chat-actions">
                      <button
                        type="button"
                        className={cn("ab-toggle", agentMode && "is-on")}
                        aria-pressed={agentMode}
                        title={agentMode ? "Agent mode: the assistant can use the browser" : "Ask mode: answers from the current page only"}
                        onClick={() => setAgentMode((value) => !value)}
                      >
                        <MousePointerClick /> Agent
                      </button>
                      <span className="ab-grow" />
                      {isAgentBusy || askingPage ? (
                        <button type="button" className="ab-stop-btn" aria-label="Stop" title="Stop" onClick={() => { if (askingPage) askAbortRef.current?.abort(); else void controlAgent("stop"); }}><i /></button>
                      ) : (
                        <button type="submit" className="ab-send" disabled={!task.trim()} aria-label="Send message"><ArrowUp /></button>
                      )}
                    </div>
                  </form>
                </div>
              </div>
            </motion.aside>
          ) : null}
        </AnimatePresence>
      </div>
    </div>
  );
}

const ICON_TO_ROW: Record<ActionIconKey, RunRowKind> = {
  click: "click", keyboard: "keyboard", navigate: "navigate", search: "search", scrollDown: "scroll", scrollUp: "scroll",
  back: "back", forward: "forward", reload: "reload", tab: "tab", wait: "wait", read: "read", check: "done", hover: "hover",
  done: "done", ask: "ask", generic: "generic",
};

/** Folds the streamed run feed into Codex-style action rows. */
function rowsFromRunItems(items: RunItem[]): RunRow[] {
  const rows: RunRow[] = [];
  let pendingGoal: string | undefined;
  for (const item of items) {
    if (item.kind === "reasoning") {
      pendingGoal = item.nextGoal;
    } else if (item.kind === "action") {
      const space = item.label.indexOf(" ");
      rows.push({
        id: item.id,
        kind: ICON_TO_ROW[item.icon] || "generic",
        verb: space > 0 ? item.label.slice(0, space) : item.label,
        target: space > 0 ? item.label.slice(space + 1) : undefined,
        status: item.status === "running" ? "running" : item.status === "error" ? "failed" : "done",
        detail: item.result,
        goal: pendingGoal ? `Goal: ${pendingGoal}` : undefined,
      });
      pendingGoal = undefined;
    } else if (item.kind === "recovery" || item.kind === "strategy") {
      rows.push({ id: item.id, kind: "recover", verb: item.message, status: "done" });
    }
  }
  return rows;
}

function normalizeTypedUrl(value: string) {
  const v = value.trim();
  if (!v) return null;
  try {
    const url = new URL(/^https?:\/\//i.test(v) ? v : `https://${v}`);
    return ["http:", "https:"].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}
