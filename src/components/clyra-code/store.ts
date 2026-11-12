/**
 * Clyra Code event store.
 *
 * Connects the existing OpenCode harness SSE stream to a normalized,
 * frontend-friendly model: an ordered work log of user prompts, assistant
 * commentary, and agent actions that update in place by stable id.
 * Nothing here fabricates activity — every entry originates from a real
 * harness event or a real API response.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, type FileDiff, type OpenCodeMessage, type OpenCodePart, type VibeProject } from "./api";
import { publishActivity, dismissActivity } from "../../lib/clyraHome";
import { isInternalPrompt } from "../../../lib/vibe-agent-v3/internal-prompt";
import { verifyLiveVibeProject, type LiveVerificationEvent } from "../../lib/vibe-coder/live-browser-verification";

export type ActionKind =
  | "read"
  | "edit"
  | "create"
  | "delete"
  | "search"
  | "research"
  | "mcp"
  | "component"
  | "list"
  | "command"
  | "build"
  | "check"
  | "test"
  | "preview"
  | "fetch"
  | "todo"
  | "permission"
  | "generic";

export type ActionStatus = "queued" | "active" | "success" | "error" | "cancelled";

export type AgentAction = {
  id: string;
  kind: ActionKind;
  tool: string;
  status: ActionStatus;
  /** Filename, command, search query or other action target. */
  target: string;
  output?: string;
  error?: string;
  additions?: number;
  deletions?: number;
  startedAt: number;
  endedAt?: number;
  /** Unified diff text from the edit tool's metadata, when provided. */
  patch?: string;
  /** Full file content written by the write tool (used for fallback diffs). */
  contentAfter?: string;
  /** Real before/after snapshots from the session diff endpoint. */
  before?: string;
  after?: string;
  /** For permission rows. */
  permissionId?: string;
  permissionResolved?: string;
  /** Real todo-tool payload for "todo" kind actions — the session's current plan. */
  todos?: Array<{ content: string; status: string; priority: string }>;
};

/** Normalize a todowrite tool's `{todos: [...]}` input, or a bare todos array, into typed rows. */
function parseTodos(value: unknown): AgentAction["todos"] {
  const list = Array.isArray(value) ? value : (value as { todos?: unknown } | undefined)?.todos;
  if (!Array.isArray(list)) return undefined;
  const todos = list
    .map((item) => {
      const row = item as Record<string, unknown>;
      const content = typeof row?.content === "string" ? row.content : "";
      if (!content) return null;
      return {
        content,
        status: typeof row?.status === "string" ? row.status : "pending",
        priority: typeof row?.priority === "string" ? row.priority : "medium",
      };
    })
    .filter((row): row is { content: string; status: string; priority: string } => Boolean(row));
  return todos.length ? todos : undefined;
}

export type UserAnswer = { question: string; answer: string };

export type LogEntry =
  | { type: "user"; id: string; text: string; ts: number; answers?: UserAnswer[] }
  | { type: "assistant"; id: string; text: string; ts: number }
  /** A concise, provider-supplied reasoning summary — never hidden chain of thought. */
  | { type: "reasoning"; id: string; text?: string; ts: number; endedAt?: number }
  | { type: "action"; id: string; actionId: string; ts: number };

export type RunState = "idle" | "starting" | "running" | "complete" | "failed" | "cancelled";

export type ConnectionState = "idle" | "connected" | "reconnecting";

export type ProjectPlatform = "web";

export type ClyraCodeState = {
  projects: VibeProject[];
  activeProjectId: string | null;
  sessionId: string | null;
  sessionTitle: string;
  runState: RunState;
  /** The real managed browser is inspecting the generated app; not an animated mock. */
  verification?: {
    status: "starting" | "testing" | "repairing" | "passed" | "failed";
    message: string;
    attempt: number;
    cursor?: { x: number; y: number; kind?: string; at?: number };
    viewport?: { width: number; height: number };
  };
  runStartedAt: number | null;
  runEndedAt: number | null;
  log: LogEntry[];
  actions: Record<string, AgentAction>;
  diffs: FileDiff[];
  error: string | null;
  connection: ConnectionState;
  model: string | null;
  tokens: { input: number; output: number } | null;
  restored: boolean;
  /** A saved task is open while its runtime and transcript are still loading. */
  loadingSession?: boolean;
  platform: ProjectPlatform;
};

const STORAGE_KEY = "clyra-code:last-session";
const PROJECTS_CACHE_KEY = "clyra-code:projects-cache";
/** The last known project list: the sidebar paints from it on the very first frame while the fresh list loads behind it. */
function readProjectsCache(): VibeProject[] {
  try {
    const raw = localStorage.getItem(PROJECTS_CACHE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return Array.isArray(parsed) ? (parsed as VibeProject[]) : [];
  } catch { return []; }
}
function writeProjectsCache(projects: VibeProject[]) {
  try { localStorage.setItem(PROJECTS_CACHE_KEY, JSON.stringify(projects.slice(0, 80))); } catch { /* storage unavailable */ }
}
const UNTITLED_PROJECT_NAME = "Untitled project";

/** Make a compact, human-readable project title from the user's first ask. */
export function projectNameFromFirstPrompt(prompt: string): string {
  const cleaned = prompt
    .replace(/\[[^\]]+\]/g, " ")
    .replace(/`[^`]*`/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^(?:please\s+)?(?:can you|could you|would you|i want(?: you)? to|help me(?: to)?|build(?: me)?|create(?: me)?|make(?: me)?|design(?: me)?|develop(?: me)?|code(?: me)?|implement(?: me)?|generate(?: me)?|write(?: me)?|ship(?: me)?)\s+/i, "")
    .replace(/^(?:an?|the)\s+/i, "")
    .replace(/^(?:(?:polished|complete|fully working|working|modern|responsive|production[- ]ready|beautiful|professional)[,\s]+)*/i, "")
    .split(/[.!?;]/, 1)[0]
    .replace(/\s+(?:with|using|that|which)\s+.*/i, "")
    .replace(/[^\p{L}\p{N}&+/' -]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 56);

  if (cleaned.length < 3) return UNTITLED_PROJECT_NAME;
  const minorWords = new Set(["a", "an", "and", "as", "at", "for", "in", "of", "on", "or", "the", "to", "with"]);
  return cleaned
    .split(" ")
    .map((word, index) => {
      if (/^[A-Z0-9]{2,}$/.test(word)) return word;
      const normalized = word.toLocaleLowerCase();
      return index > 0 && minorWords.has(normalized)
        ? normalized
        : `${normalized.slice(0, 1).toLocaleUpperCase()}${normalized.slice(1)}`;
    })
    .join(" ");
}

const INITIAL: ClyraCodeState = {
  projects: [],
  activeProjectId: null,
  sessionId: null,
  sessionTitle: "",
  runState: "idle",
  runStartedAt: null,
  runEndedAt: null,
  log: [],
  actions: {},
  diffs: [],
  error: null,
  connection: "idle",
  model: null,
  tokens: null,
  restored: false,
  platform: "web",
};

function stripProjectPrefix(path: string) {
  const normalized = path.replace(/\\/g, "/");
  if (/^.*\/projects\/[^/]+\/files\/?$/.test(normalized)) return "project root";
  return normalized.replace(/^.*\/projects\/[^/]+\/files\//, "").replace(/^\.\//, "");
}

/** The platform the user is asking to build for, or null when it is ambiguous. */
export type DetectedPlatform = "web" | "desktop" | "ios" | null;

const PLATFORM_STYLE_ONLY =
  /\b(apple|macos|mac|windows|android|material|apple-style|ios|iphone)[\s-]+(theme|style|styles|look|looks|feel|design|ui|ux|vibe|aesthetic|inspired|flavou?r|polish)\b/i;

const DESKTOP_RE =
  /\b(desktop\s+app|electron|tauri|menubar|menu\s+bar|system\s+tray|macos\s+app|windows\s+app|linux\s+app|native\s+desktop)\b/i;
const WEB_RE =
  /\b(website|web\s+app|webapp|landing\s+page|homepage|portfolio\s+site|react|next\.?js|vite|svelte|vue|angular|pwa|spa|html|css|javascript|typescript|browser|chrome\s+extension)\b/i;
const IOS_RE =
  /\b(ios|iphone|ipad|ios\s+app|iphone\s+app|ipad\s+app|swiftui|uikit|xcode|native\s+ios)\b/i;

/**
 * Detect the intended target platform from a prompt. Styling-only mentions of a
 * platform (e.g. "Apple theme", "iOS-style") are ignored so they never select a
 * platform. When the intent is unclear, or the prompt names two platforms, the
 * result is null and the caller should ask the user.
 */
export function detectPlatformIntent(prompt: string): DetectedPlatform {
  const stripped = prompt.toLowerCase().replace(PLATFORM_STYLE_ONLY, " ");
  const desktop = DESKTOP_RE.test(stripped);
  const web = WEB_RE.test(stripped);
  const ios = IOS_RE.test(stripped);
  const hits = [desktop, web, ios].filter(Boolean).length;
  if (hits !== 1) return null;
  if (ios) return "ios";
  if (desktop) return "desktop";
  return "web";
}

/**
 * Whether the composer should ask "which platform?" before sending. This only
 * fires for a clear request to build a new app/website/product with no platform
 * signal, so ordinary requests and follow-ups always send immediately.
 */
export function shouldAskPlatform(prompt: string): boolean {
  const t = prompt.toLowerCase().trim();
  if (!t || t.length > 160) return false;
  const build = /\b(build|make|create|start|generate|scaffold|develop|code|write|ship)\b/i.test(t);
  const deliverable = /\b(app|application|website|webapp|web\s+app|site|android|desktop|native|product|landing|page|project|game|tool|software|extension|store)\b/i.test(t);
  return build && deliverable && detectPlatformIntent(t) === null;
}

/** Commands often embed absolute project paths; compress them for display. */
function cleanCommand(command: string) {
  return command
    .replace(/cd\s+"[^"]*\/projects\/[^/]+\/files\/?"\s*(&&|;)\s*/g, "")
    .replace(/cd\s+\S*\/projects\/[^/\s]+\/files\/?\s*(&&|;)\s*/g, "")
    .replace(/"?\/[^\s"]*\/projects\/([^/\s"]+)\/files(\/[^\s"]*)?"?/g, (_m, _id, rest) => `.${rest ?? ""}`)
    .trim();
}

function classifyCommand(command: string): ActionKind {
  const c = command.toLowerCase();
  if (/\b(vitest|jest|pytest|playwright|cypress|mocha|ava|tap|npm\s+test|pnpm\s+test|yarn\s+test|cargo\s+test|go\s+test)\b/.test(c)) {
    return "test";
  }
  if (/\b(npm\s+run\s+build|pnpm\s+build|yarn\s+build|vite\s+build|next\s+build|astro\s+build|react-scripts\s+build|cargo\s+build|go\s+build)\b/.test(c)) {
    return "build";
  }
  if (/\b(tsc|typecheck|eslint|lint|prettier|biome|ruff|mypy|pyright|clippy|cargo\s+check)\b/.test(c)) {
    return "check";
  }
  if (/\b(vite\s+(?:preview|--host)|npm\s+run\s+(?:dev|preview)|pnpm\s+(?:dev|preview)|yarn\s+(?:dev|preview)|http-server|python(?:3)?\s+-m\s+http\.server|serve\s)\b/.test(c)) {
    return "preview";
  }
  return "command";
}

function classifyTool(tool: string, input: Record<string, unknown>): { kind: ActionKind; target: string } {
  // Providers use slightly different names and argument keys for the same
  // tool. Normalize those real variants here instead of hiding them behind a
  // generic "Completed" row in the transcript.
  const lower = tool.toLowerCase().replace(/[.\s-]+/g, "_");
  const file = firstString(input, "filePath", "filepath", "file_path", "path", "file", "target_file", "targetFile", "filename", "relativePath");
  const command = firstString(input, "command", "cmd", "script", "shell", "bash");
  const query = firstString(input, "pattern", "query", "search", "q", "text", "term");
  if (/(?:^|_)(shadcn|21st|twentyfirst|twenty_first)(?:_|$)/.test(lower)) {
    const provider = /shadcn/.test(lower) ? "shadcn/ui" : "21st.dev";
    const item = firstString(input, "name", "component", "componentName", "slug", "identifier", "item", "query", "q", "search");
    const operation = /(?:search|list|browse|inspiration|registr(?:y|ies)|lookup)/.test(lower) ? "Scanning" : /(?:get_component|view|fetch|read)/.test(lower) ? "Inspecting" : "Adding";
    return { kind: operation === "Scanning" ? "mcp" : "component", target: provider + " · " + operation + (item ? " " + item : " components") };
  }
  if (/^(bash|shell|command|execute|exec|run|terminal|shell_command)$/.test(lower)) {
    const cleaned = cleanCommand(command) || tool;
    return { kind: classifyCommand(cleaned), target: cleaned };
  }
  if (/^(write|write_file|create|create_file|file_write)$/.test(lower)) return { kind: "create", target: stripProjectPrefix(file) };
  if (/^(edit|edit_file|apply_patch|applypatch|str_replace|str_replace_editor|replace|replace_in_file|patch|file_edit)$/.test(lower)) return { kind: "edit", target: stripProjectPrefix(file) };
  if (/^(delete|delete_file|rm|remove|remove_file)$/.test(lower)) return { kind: "delete", target: stripProjectPrefix(file) };
  if (/^(read|read_file|read_image|open_file|view_file|cat|file_read)$/.test(lower)) return { kind: "read", target: stripProjectPrefix(file) };
  if (/^(web_search|websearch|search_web|internet_search)$/.test(lower)) return { kind: "research", target: query || tool };
  if (/^(grep|glob|search|codebase_search|find_in_files|ripgrep)$/.test(lower)) return { kind: "search", target: query || stripProjectPrefix(file) || tool };
  if (/^(list|ls|tree|list_files|readdir|directory_list)$/.test(lower)) return { kind: "list", target: stripProjectPrefix(file || firstString(input, "dir", "directory", "cwd")) || "project structure" };
  if (/^(browser|preview|screenshot|open_browser)$/.test(lower)) return { kind: "preview", target: String(input.url || query || "live preview") };
  if (/^(webfetch|web_fetch|fetch|curl)$/.test(lower)) return { kind: "fetch", target: String(input.url || query || tool) };
  if (/^(todowrite|todoread|todo|todo_write|todo_read)$/.test(lower)) return { kind: "todo", target: "task list" };
  return { kind: "generic", target: stripProjectPrefix(file) || command || query || tool };
}

function toolStatus(status?: string): ActionStatus {
  if (status === "error") return "error";
  if (status === "running") return "active";
  if (status === "pending") return "queued";
  return "success";
}

/** Line counts from an OpenCode edit-tool diff string, when metadata carries one. */
function countsFromDiffText(diff: string): { additions: number; deletions: number } | null {
  if (!diff || typeof diff !== "string") return null;
  let additions = 0;
  let deletions = 0;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+") && !line.startsWith("+++")) additions += 1;
    else if (line.startsWith("-") && !line.startsWith("---")) deletions += 1;
  }
  return additions || deletions ? { additions, deletions } : null;
}

/** Minimal unified patch rebuilt from an edit tool's real old/new inputs. */
function buildEditSnippet(kind: ActionKind, input: Record<string, unknown>): string {
  if (kind !== "edit") return "";
  const oldText = firstString(input, "old", "oldText", "old_string", "oldString", "search", "find", "from");
  const newText = firstString(input, "new", "newText", "new_string", "newString", "replace_with", "replacement", "to", "replace");
  if (!oldText && !newText) return "";
  const minus = oldText
    ? oldText.split("\n").map((line) => `-${line}`).join("\n")
    : "";
  const plus = newText
    ? newText.split("\n").map((line) => `+${line}`).join("\n")
    : "";
  return [minus, plus].filter(Boolean).join("\n");
}

function safeJsonParse(value: unknown): unknown {
  if (typeof value !== "string" || !value.trim()) return undefined;
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function firstString(input: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = input[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return "";
}

/**
 * Some providers occasionally mislabel scratch reasoning as a normal text
 * part. It is not a user-facing response. Keep the transcript to concise
 * public progress updates and tool facts rather than leaking a raw planning
 * monologue into the chat.
 */
function looksLikeInternalScratchpad(text: string) {
  const signals = [
    /\b(?:let me|actually|hmm|wait,?|I'?ll first|I'?ll make|I'?ll create)\b/gi,
    /\b(?:better:|simplest:|structure:)\b/gi,
  ].reduce((count, pattern) => count + (text.match(pattern)?.length ?? 0), 0);
  return text.length > 420 && signals >= 3;
}

export function useClyraCode() {
  const [state, setState] = useState<ClyraCodeState>(() => ({ ...INITIAL, projects: readProjectsCache() }));
  const eventSourceRef = useRef<EventSource | null>(null);
  const activeSessionRef = useRef<string | null>(null);
  const activeProjectRef = useRef<string | null>(null);
  /** A message already shown in the transcript whose run has not started yet. */
  const pendingPromptRef = useRef<LogEntry | null>(null);
  const runStateRef = useRef<RunState>("idle");
  const lastImplementationRequestRef = useRef("");
  const verifyControllerRef = useRef<AbortController | null>(null);
  const verifyingRef = useRef(false);
  const awaitingRepairRef = useRef(false);
  const repairCountRef = useRef(0);
  const verificationActionCountRef = useRef(0);
  const actionBaselineRef = useRef(0);
  const lastVerificationPhaseRef = useRef("");
  const verificationEpochRef = useRef(0);
  const stateSnapshotRef = useRef(state);
  stateSnapshotRef.current = state;
  const diffTimerRef = useRef<number | null>(null);
  const projectsRef = useRef<VibeProject[]>(readProjectsCache());
  const autoNamingProjectsRef = useRef(new Set<string>());

  useEffect(() => {
    runStateRef.current = state.runState;
  }, [state.runState]);

  useEffect(() => () => verifyControllerRef.current?.abort(), []);

  // Tell the home screen what Vibe Coder is doing, so a finished task shows up there.
  useEffect(() => {
    if (!state.sessionId) return;
    const project = state.projects.find((p) => p.id === state.activeProjectId);
    const title = (state.sessionTitle || "Vibe Coder task").slice(0, 80);
    const detail = project?.name ? `in ${project.name}` : undefined;
    const key = `vibe:${state.sessionId}`;
    if (state.runState === "running" || state.runState === "starting") publishActivity({ key, app: "vibe", title, detail, status: "running" });
    else if (state.runState === "complete") publishActivity({ key, app: "vibe", title, detail: detail ? `Finished ${detail}` : "Finished", status: "done" });
    else if (state.runState === "failed") publishActivity({ key, app: "vibe", title, detail: state.error || "The task failed", status: "failed" });
    else if (state.runState === "cancelled") dismissActivity(key);
  }, [state.runState, state.sessionId]); // eslint-disable-line react-hooks/exhaustive-deps

  const closeStream = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
  }, []);

  useEffect(() => () => closeStream(), [closeStream]);

  const refreshDiff = useCallback((projectId: string, sessionId: string) => {
    if (diffTimerRef.current) window.clearTimeout(diffTimerRef.current);
    diffTimerRef.current = window.setTimeout(() => {
      void api
        .sessionDiff(projectId, sessionId)
        .then((diffs) => {
          setState((prev) => {
            const actions = { ...prev.actions };
            for (const key of Object.keys(actions)) {
              const action = actions[key];
              if (!/^(edit|create|delete)$/.test(action.kind)) continue;
              const match = diffs.find(
                (d) => stripProjectPrefix(d.file) === action.target,
              );
              if (match) {
                actions[key] = {
                  ...action,
                  additions: match.additions,
                  deletions: match.deletions,
                  before: match.before || action.before,
                  after: match.after || action.after,
                };
              }
            }
            return { ...prev, diffs, actions };
          });
        })
        .catch(() => undefined);
    }, 400);
  }, []);

  /**
   * OpenCode going idle is NOT a successful build. Test the actual local page
   * with the shared Chat/Voice browser, then repair and retest if it fails.
   * Keep the run open throughout and only publish success on a passing verdict.
   */
  const verifyAfterIdle = useCallback(() => {
    if (verifyingRef.current || awaitingRepairRef.current) return;
    const projectId = activeProjectRef.current;
    const sessionId = activeSessionRef.current;
    const request = lastImplementationRequestRef.current;
    if (!projectId || !sessionId || !request) return;
    const snapshot = stateSnapshotRef.current;
    const wroteCode = Object.values(snapshot.actions).slice(actionBaselineRef.current)
      .some(action => /^(edit|create|delete|build|check|test)$/.test(action.kind));
    const implementationIntent = /\b(build|create|make|develop|fix|change|update|implement|add|remove|design|refactor|clone|test|repair|generate|improve|polish|code|website|app|function|feature)\b/i.test(request);
    if (!wroteCode && !implementationIntent) {
      setState(prev => ({
        ...prev,
        runState: "complete",
        runEndedAt: Date.now(),
        actions: finalizeActions(prev.actions, "success"),
      }));
      return;
    }

    const epoch = ++verificationEpochRef.current;
    const controller = new AbortController();
    verifyControllerRef.current?.abort();
    verifyControllerRef.current = controller;
    verifyingRef.current = true;
    const attempt = repairCountRef.current + 1;
    let displayed = 0;
    let lastActionId = "";
    lastVerificationPhaseRef.current = "";
    setState(prev => ({
      ...prev, runState: "running", runEndedAt: null,
      verification: { status: "starting", message: "Preparing live browser checks", attempt },
      log: prev.log.map(entry => entry.type === "reasoning" && !entry.endedAt
        ? { ...entry, endedAt: Date.now() } : entry),
    }));

    const recordAction = (kind: "preview" | "test", title: string, status: ActionStatus, detail = "") => {
      const now = Date.now();
      const id = "vibe-verify:" + epoch + ":" + (++verificationActionCountRef.current);
      setState(prev => {
        if (epoch !== verificationEpochRef.current) return prev;
        const actions = { ...prev.actions };
        if (lastActionId && actions[lastActionId]?.status === "active") {
          actions[lastActionId] = { ...actions[lastActionId], status: "success", endedAt: now };
        }
        actions[id] = {
          id, kind, tool: "live_browser_verification", target: title.slice(0, 200),
          output: detail.slice(0, 1800), status, startedAt: now,
          ...(status === "active" ? {} : { endedAt: now }),
        };
        return {
          ...prev, actions,
          log: [...prev.log, { type: "action" as const, id: "entry-" + id, actionId: id, ts: now }],
        };
      });
      lastActionId = id;
    };

    const onEvent = (event: LiveVerificationEvent) => {
      if (epoch !== verificationEpochRef.current || controller.signal.aborted) return;
      const status = event.phase === "starting" || event.phase === "opening" ? "starting" : "testing";
      setState(prev => ({
        ...prev,
        verification: {
          status, message: event.message, attempt,
          cursor: event.cursor
            ? { ...event.cursor, at: event.cursor.at ?? Date.now() }
            : prev.verification?.cursor,
          viewport: event.viewport ?? prev.verification?.viewport,
        },
      }));
      const meaningful = Boolean(event.action) || lastVerificationPhaseRef.current !== event.phase;
      if (meaningful && displayed < 45) {
        displayed += 1;
        const title = event.action
          ? event.action.type?.replaceAll("_", " ") + " · " + event.message
          : event.message;
        recordAction(status === "starting" ? "preview" : "test", title, "active",
          event.evaluation?.reason || "");
      }
      lastVerificationPhaseRef.current = event.phase;
    };

    void (async () => {
      try {
        const result = await verifyLiveVibeProject({
          projectId, request, signal: controller.signal, onEvent,
        });
        if (controller.signal.aborted || epoch !== verificationEpochRef.current) return;
        recordAction("test", "Verified live application · " + result.testedSteps + " browser actions", "success",
          result.summary);
        const checked = result.evidence.flatMap(item => item.checks ?? []).slice(0, 5);
        setState(prev => ({
          ...prev,
          verification: { status: "passed", message: "Live browser tests passed", attempt },
          runState: "complete", runEndedAt: Date.now(), error: null,
          actions: finalizeActions(prev.actions, "success"),
          log: [...prev.log, {
            type: "assistant" as const,
            id: "vibe-verified-" + epoch,
            ts: Date.now(),
            text: "Live browser verification passed (" + result.testedSteps + " real actions)." +
              (checked.length ? "\n\nVerified: " + checked.join("; ") : "") +
              "\n\n" + result.summary.slice(0, 750),
          }],
        }));
        refreshDiff(projectId, sessionId);
      } catch (error) {
        if (controller.signal.aborted || epoch !== verificationEpochRef.current) return;
        const problem = error instanceof Error ? error.message : String(error);
        recordAction("test", "Live browser verification failed", "error", problem);
        const environmental = /API key|unavailable|permission|not supported|cancelled|150-second limit|Browser control|browser tab|open tabs|Failed to fetch|NetworkError|not connected|event stream|authentication/i.test(problem);
        if (!environmental && repairCountRef.current < 2) {
          repairCountRef.current += 1;
          const nextAttempt = repairCountRef.current + 1;
          awaitingRepairRef.current = true;
          setState(prev => ({
            ...prev, runState: "running",
            verification: { status: "repairing", attempt: nextAttempt, message: "Repairing the observed failure" },
          }));
          recordAction("test", "Repairing failed browser checks · attempt " + nextAttempt, "active", problem);
          try {
            // A repair is a continuation of this same OpenCode session, not a new user prompt.
            await api.sendPrompt(projectId, sessionId, [
              "AUTOMATIC POST-BUILD VERIFICATION FAILED. This is not a new user request.",
              "Original user request: " + request.slice(0, 6000),
              "Observed failure: " + problem.slice(0, 3000),
              "Inspect your actual changed files and runtime diagnostics. Fix the underlying issue rather than bypassing the test.",
              "After repairs, rerun relevant local checks. The application will be browser-tested again automatically when your session goes idle.",
              "Do not claim the product works without evidence, do not fabricate tests, and keep other working functionality unchanged.",
            ].join("\n"), undefined, "high");
          } catch (repairError) {
            awaitingRepairRef.current = false;
            setState(prev => ({
              ...prev, runState: "failed", runEndedAt: Date.now(),
              verification: { status: "failed", message: problem, attempt: nextAttempt },
              error: "Verification failed and the repair agent could not start: " +
                (repairError instanceof Error ? repairError.message : String(repairError)),
            }));
          }
        } else {
          setState(prev => ({
            ...prev,
            verification: { status: "failed", message: problem, attempt },
            runState: "failed", runEndedAt: Date.now(),
            error: "The generated project was NOT verified as working. " + problem,
          }));
        }
      } finally {
        if (verifyControllerRef.current === controller) verifyControllerRef.current = null;
        verifyingRef.current = false;
      }
    })();
  }, [refreshDiff]);

  /** Normalize one ClyraAgentEvent envelope from the harness SSE stream. */
  const handleEvent = useCallback(
    (raw: unknown) => {
      const event = raw as {
        payload?: { type?: string; properties?: Record<string, unknown> };
        timestamp?: number;
      };
      const payload = event?.payload;
      if (!payload?.type) return;
      const properties = (payload.properties ?? {}) as Record<string, unknown>;
      const part = (properties.part ?? {}) as OpenCodePart;
      const eventSessionId = String(part.sessionID || properties.sessionID || "");
      if (
        eventSessionId &&
        activeSessionRef.current &&
        eventSessionId !== activeSessionRef.current
      ) {
        return;
      }
      const ts = Number(event?.timestamp) || Date.now();

      if (payload.type === "message.part.updated") {
        if (part.type === "text") {
          const text = String(part.text ?? "");
          if (!text) return;
          if (looksLikeInternalScratchpad(text)) {
            // The preceding reasoning row stays in place and settles into a
            // compact Thought entry once the next real tool action arrives.
            return;
          }
          const entryId = `assistant-${part.messageID}-${part.id}`;
          setState((prev) => {
            // OpenCode replays the submitted user prompt as a part; the
            // optimistic user entry already owns it. A replay may also carry a
            // hidden platform/instruction prefix, so treat a trailing match of
            // any user message as the same echoed turn rather than new prose.
            if (
              prev.log.some((e) => {
                if (e.type !== "user") return false;
                const userText = e.text.trim();
                if (!userText) return false;
                return e.text === text || text.trim().endsWith(userText);
              })
            ) {
              return prev;
            }
            // An assistant response means the preceding real reasoning phase
            // has concluded. Keep thought events sequential with the streamed
            // tool work instead of leaving several active at once.
            const log = prev.log.map((entry) =>
              entry.type === "reasoning" && !entry.endedAt
                ? { ...entry, endedAt: ts }
                : entry,
            );
            const index = log.findIndex((e) => e.id === entryId);
            const entry: LogEntry = { type: "assistant", id: entryId, text, ts };
            if (index >= 0) log[index] = entry;
            else log.push(entry);
            return { ...prev, log };
          });
          return;
        }
        if (part.type === "reasoning") {
          const entryId = `reasoning-${part.messageID}-${part.id}`;
          const summary = String(part.text ?? "").trim();
          setState((prev) => {
            const existing = prev.log.find((entry) => entry.id === entryId);
            if (existing) {
              if (existing.type !== "reasoning" || !summary || existing.text === summary) return prev;
              return {
                ...prev,
                log: prev.log.map((entry) => entry.id === entryId ? { ...entry, text: summary } : entry),
              };
            }
            return { ...prev, log: [...prev.log, { type: "reasoning", id: entryId, text: summary || undefined, ts }] };
          });
          return;
        }
        if (part.type === "step-finish") {
          const tokens = (part as { tokens?: { input?: number; output?: number } }).tokens;
          if (tokens) {
            setState((prev) => ({
              ...prev,
              tokens: {
                input: (prev.tokens?.input ?? 0) + (tokens.input ?? 0),
                output: (prev.tokens?.output ?? 0) + (tokens.output ?? 0),
              },
            }));
          }
          return;
        }
        if (part.type === "tool") {
          const tool = String(part.tool || "tool");
          const partState = part.state ?? { status: "pending" as const };
          const input = (partState.input ?? {}) as Record<string, unknown>;
          const { kind, target } = classifyTool(tool, input);
          const actionId = `${part.sessionID}:${part.messageID}:${part.id}`;
          const status = toolStatus(partState.status);
          // The harness question tool is the agent asking the user for input.
          // Render it as natural assistant prose instead of a fake
          // "Completed question" status row.
          if (/^(question|ask_user_question)$/.test(tool.trim().toLowerCase())) {
            if (status === "success") {
              const question = String(input.question || partState.output || "").trim();
              if (question) {
                setState((prev) => {
                  const settledLog = prev.log.map((entry) =>
                    entry.type === "reasoning" && !entry.endedAt
                      ? { ...entry, endedAt: ts }
                      : entry,
                  );
                  return {
                    ...prev,
                    log: [
                      ...settledLog,
                      { type: "assistant" as const, id: `assistant-${actionId}`, text: question, ts },
                    ],
                  };
                });
              }
            }
            return;
          }
          const metadataDiff =
            typeof partState.metadata?.diff === "string" ? (partState.metadata.diff as string) : "";
          // Edit tools often carry their old/new text right in the input; the
          // harness metadata has no diff for them. Rebuild the real change as
          // a minimal patch so streaming edit boxes have honest line content.
          const inputPatch = typeof input.patch === "string" ? input.patch : "";
          const editSnippet = buildEditSnippet(kind, input);
          const patchSource = metadataDiff || inputPatch || editSnippet;
          const counts = countsFromDiffText(patchSource);
          const writtenContent =
            kind === "create" && typeof input.content === "string" ? input.content : undefined;
          // The write tool creates whole files; the real addition count is the
          // content it wrote when the harness diff has nothing to report.
          const writeAdditions =
            writtenContent !== undefined && status === "success"
              ? writtenContent.split("\n").length
              : undefined;
          const todos =
            kind === "todo"
              ? parseTodos(input) ??
                parseTodos(safeJsonParse(partState.output)) ??
                undefined
              : undefined;
          setState((prev) => {
            const existing = prev.actions[actionId];
            const isFileKind = /^(create|edit|delete|read)$/.test(kind);
            const action: AgentAction = {
              id: actionId,
              kind,
              tool,
              status,
              target: target || existing?.target || (isFileKind ? "…" : tool),
              output: String(partState.output ?? existing?.output ?? ""),
              error:
                status === "error"
                  ? String(partState.error || "Tool failed")
                  : undefined,
              additions: counts?.additions ?? existing?.additions ?? writeAdditions,
              deletions: counts?.deletions ?? existing?.deletions,
              patch: patchSource || existing?.patch,
              contentAfter: writtenContent ?? existing?.contentAfter,
              todos: todos ?? existing?.todos,
              startedAt: existing?.startedAt ?? partState.time?.start ?? ts,
              endedAt:
                status === "success" || status === "error"
                  ? partState.time?.end ?? ts
                  : undefined,
            };
            const actions = { ...prev.actions, [actionId]: action };
            // A real tool invocation is the boundary of a thinking phase. The
            // transcript should show one current action, never a growing list
            // of still-shimmering thoughts.
            const settledLog = prev.log.map((entry) =>
              entry.type === "reasoning" && !entry.endedAt
                ? { ...entry, endedAt: ts }
                : entry,
            );
            const log = settledLog.some((e) => e.type === "action" && e.actionId === actionId)
              ? settledLog
              : [
                  ...settledLog,
                  { type: "action" as const, id: `entry-${actionId}`, actionId, ts },
                ];
            return { ...prev, actions, log };
          });
          if (
            status === "success" &&
            /^(write|edit|apply_patch|str_replace|patch|delete|rm)$/.test(tool.toLowerCase()) &&
            eventSessionId &&
            activeProjectRef.current
          ) {
            refreshDiff(activeProjectRef.current, eventSessionId);
          }
          return;
        }
        return;
      }

      if (payload.type === "permission.updated") {
        const permissionId = String(properties.id || "");
        const title = String(properties.title || properties.type || "Approve action");
        if (!permissionId) return;
        const actionId = `permission:${permissionId}`;
        setState((prev) => {
          if (prev.actions[actionId]) return prev;
          return {
            ...prev,
            actions: {
              ...prev.actions,
              [actionId]: {
                id: actionId,
                kind: "permission",
                tool: "permission",
                status: "active",
                target: title,
                startedAt: ts,
                permissionId,
              },
            },
            log: [...prev.log, { type: "action", id: `entry-${actionId}`, actionId, ts }],
          };
        });
        return;
      }

      if (payload.type === "permission.replied") {
        const permissionId = String(properties.permissionID || "");
        const actionId = `permission:${permissionId}`;
        setState((prev) => {
          const existing = prev.actions[actionId];
          if (!existing) return prev;
          return {
            ...prev,
            actions: {
              ...prev.actions,
              [actionId]: {
                ...existing,
                status: "success",
                endedAt: ts,
                permissionResolved: String(properties.response || "replied"),
              },
            },
          };
        });
        return;
      }

      if (payload.type === "session.error") {
        // A real coding-agent failure overrides any in-flight browser verdict.
        verifyControllerRef.current?.abort();
        verificationEpochRef.current += 1;
        verifyingRef.current = false;
        awaitingRepairRef.current = false;
        const error = properties.error as { data?: { message?: string }; message?: string } | undefined;
        const message = String(error?.data?.message || error?.message || "The coding session failed.");
        setState((prev) => ({
          ...prev,
          runState: "failed",
          runEndedAt: ts,
          error: message,
          actions: finalizeActions(prev.actions, "error"),
        }));
        return;
      }

      if (payload.type === "session.idle") {
        // Never show "complete" merely because the model stopped responding.
        if (runStateRef.current === "running" || runStateRef.current === "starting") {
          verifyAfterIdle();
        }
        if (activeProjectRef.current && activeSessionRef.current) {
          refreshDiff(activeProjectRef.current, activeSessionRef.current);
        }
        return;
      }

      if (payload.type === "session.status") {
        const status = properties.status as { type?: string } | undefined;
        if (status?.type === "busy") {
          awaitingRepairRef.current = false;
          setState((prev) =>
            prev.runState === "running" && prev.runStartedAt
              ? prev
              : {
                  ...prev,
                  runState: "running",
                  runStartedAt: prev.runStartedAt ?? ts,
                  runEndedAt: null,
                },
          );
        }
      }
    },
    [refreshDiff, verifyAfterIdle],
  );

  const openStream = useCallback(
    (projectId: string) => {
      closeStream();
      const source = new EventSource(api.eventsUrl(projectId));
      eventSourceRef.current = source;
      source.onopen = () => setState((prev) => ({ ...prev, connection: "connected" }));
      source.onmessage = (message) => {
        try {
          handleEvent(JSON.parse(message.data));
        } catch {
          /* malformed frame ignored */
        }
      };
      source.onerror = () => {
        // Browser EventSource retries automatically; the server replays
        // buffered project events on reconnect, and upserts are idempotent.
        if (runStateRef.current === "running" || runStateRef.current === "starting") {
          setState((prev) => ({ ...prev, connection: "reconnecting" }));
        }
      };
    },
    [closeStream, handleEvent],
  );

  const loadProjects = useCallback(async () => {
    // Retry transient failures (e.g. the dev server momentarily busy) so an
    // unlucky fetch cannot present an empty sidebar over real projects.
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const projects = await api.listProjects();
        projectsRef.current = projects;
        writeProjectsCache(projects);
        setState((prev) => ({ ...prev, projects }));
        return projects;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 700 * (attempt + 1)));
      }
    }
    return [] as VibeProject[];
  }, []);

  const selectProject = useCallback(
    (projectId: string | null) => {
      closeStream();
      verifyControllerRef.current?.abort();
      verificationEpochRef.current += 1;
      verifyingRef.current = false;
      awaitingRepairRef.current = false;
      repairCountRef.current = 0;
      lastImplementationRequestRef.current = "";
      activeSessionRef.current = null;
      activeProjectRef.current = projectId;
      // A prompt that was sent before its project existed must survive the
      // switch into that project, or the send would vanish mid-flight.
      const pending = pendingPromptRef.current;
      setState((prev) => ({
        ...INITIAL,
        projects: prev.projects,
        model: prev.model,
        activeProjectId: projectId,
        platform: "web",
        ...(pending ? { runState: "starting" as const, runStartedAt: pending.ts, log: [pending] } : {}),
      }));
      try {
        if (projectId) localStorage.setItem(STORAGE_KEY, JSON.stringify({ projectId }));
        else localStorage.removeItem(STORAGE_KEY);
      } catch { /* storage unavailable */ }
    },
    [closeStream],
  );

  /**
   * Shows the user's message in the transcript at once. Creating a project,
   * uploading attachments and starting the runtime all take time, and the
   * send must visibly land before any of them. startRun({ optimistic: true })
   * then skips appending the message a second time.
   */
  const beginOptimisticPrompt = useCallback((userText: string, answers?: UserAnswer[]) => {
    const now = Date.now();
    const userEntry: LogEntry = { type: "user", id: `user-${now}`, text: userText, ts: now, answers };
    pendingPromptRef.current = userEntry;
    setState((prev) => {
      const followUp = prev.runState === "running" || prev.runState === "starting";
      return {
        ...prev,
        runState: "starting",
        verification: undefined,
        runStartedAt: followUp ? prev.runStartedAt ?? now : now,
        runEndedAt: null,
        error: null,
        restored: false,
        verification: undefined,
        log: [...prev.log, userEntry],
      };
    });
  }, []);

  const failOptimisticPrompt = useCallback((message: string) => {
    pendingPromptRef.current = null;
    setState((prev) => ({
      ...prev,
      runState: "failed",
      runEndedAt: Date.now(),
      error: message,
    }));
  }, []);

  const startRun = useCallback(
    async (prompt: string, agent?: string, options?: { userText?: string; answers?: UserAnswer[]; effort?: "low" | "medium" | "high"; optimistic?: boolean }) => {
      const projectId = activeProjectRef.current;
      if (!projectId || !prompt.trim()) {
        // An optimistic message is already on screen, so the run must not be
        // left in "starting" when nothing can be sent.
        if (options?.optimistic) failOptimisticPrompt("Clyra could not open a project for this task.");
        return false;
      }
      verifyControllerRef.current?.abort();
      verificationEpochRef.current += 1;
      verifyingRef.current = false;
      awaitingRepairRef.current = false;
      repairCountRef.current = 0;
      lastImplementationRequestRef.current = options?.userText || prompt;
      actionBaselineRef.current = Object.keys(stateSnapshotRef.current.actions).length;
      setState(prev => ({ ...prev, verification: undefined }));
      let autoName: string | null = null;
      const followUp = Boolean(activeSessionRef.current) && runStateRef.current !== "idle";
      if (options?.optimistic) {
        pendingPromptRef.current = null;
      } else {
        const userEntry: LogEntry = {
          type: "user",
          id: `user-${Date.now()}`,
          text: options?.userText ?? prompt,
          ts: Date.now(),
          answers: options?.answers,
        };
        setState((prev) => ({
          ...prev,
          runState: "starting",
          runStartedAt: followUp ? prev.runStartedAt ?? Date.now() : Date.now(),
          runEndedAt: null,
          error: null,
          restored: false,
          log: [...prev.log, userEntry],
        }));
      }

      try {
        await api.startRuntime(projectId);
        if (!eventSourceRef.current) openStream(projectId);

        let sessionId = activeSessionRef.current;
        if (!sessionId) {
          const session = await api.createSession(projectId, prompt.slice(0, 72));
          sessionId = session.id;
          activeSessionRef.current = sessionId;
          setState((prev) => ({ ...prev, sessionId, sessionTitle: session.title ?? prompt.slice(0, 72) }));
          // The first prompt names an untitled project after the request has
          // started, so creation stays immediate and naming never blocks it.
          const fresh = projectsRef.current.find((p) => p.id === projectId);
          if (fresh && /^(new project|untitled(?: project)?)$/i.test(fresh.name.trim()) && !autoNamingProjectsRef.current.has(projectId)) {
            const proposedName = projectNameFromFirstPrompt(options?.userText ?? prompt);
            if (proposedName !== UNTITLED_PROJECT_NAME) {
              autoNamingProjectsRef.current.add(projectId);
              autoName = proposedName;
              setState((prev) => ({
                ...prev,
                projects: prev.projects.map((project) => project.id === projectId ? { ...project, name: "Naming project…" } : project),
              }));
            }
          }
          try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify({ projectId, sessionId }));
          } catch { /* storage unavailable */ }
        }
        await api.sendPrompt(projectId, sessionId, prompt, agent, options?.effort);
        if (autoName && autoName !== UNTITLED_PROJECT_NAME) {
          window.setTimeout(() => {
            void api.renameProject(projectId, autoName!).then((renamed) => {
              projectsRef.current = projectsRef.current.map((project) => (project.id === renamed.id ? renamed : project));
              setState((prev) => ({
                ...prev,
                projects: prev.projects.map((project) => (project.id === renamed.id ? renamed : project)),
              }));
            }).catch(() => undefined);
          }, 1800);
        }
        setState((prev) =>
          prev.runState === "starting" ? { ...prev, runState: "running" } : prev,
        );
        return true;
      } catch (error) {
        setState((prev) => ({
          ...prev,
          runState: "failed",
          runEndedAt: Date.now(),
          error: error instanceof Error ? error.message : "The run could not start.",
        }));
        return false;
      }
    },
    [openStream],
  );

  const cancelRun = useCallback(async () => {
    verifyControllerRef.current?.abort();
    verificationEpochRef.current += 1;
    verifyingRef.current = false;
    awaitingRepairRef.current = false;
    const projectId = activeProjectRef.current;
    const sessionId = activeSessionRef.current;
    setState((prev) => ({
      ...prev,
      runState: "cancelled",
      runEndedAt: Date.now(),
      actions: finalizeActions(prev.actions, "cancelled"),
      log: prev.log.map((entry) =>
        entry.type === "reasoning" && !entry.endedAt ? { ...entry, endedAt: Date.now() } : entry,
      ),
    }));
    if (projectId && sessionId) {
      await api.abortSession(projectId, sessionId).catch(() => undefined);
    }
  }, []);

  const undoLastCheckpoint = useCallback(async () => {
    const projectId = activeProjectRef.current;
    if (!projectId) return false;
    try {
      await api.undoLastCheckpoint(projectId);
      // OpenCode's historical session diff is immutable, so clear the local
      // result projection after the reversible Git restore. The next real
      // agent action repopulates it from the live stream.
      setState((prev) => ({
        ...prev,
        diffs: [],
        actions: {},
        log: prev.log.filter((entry) => entry.type !== "action"),
        restored: false,
      }));
      return true;
    } catch (error) {
      setState((prev) => ({
        ...prev,
        error: error instanceof Error ? error.message : "Could not restore the last checkpoint.",
      }));
      return false;
    }
  }, []);

  /**
   * A Visual Edit is a real write made through the same project filesystem as
   * OpenCode. Surface it in the existing action/diff stream so it remains
   * reviewable instead of behaving like an invisible preview mutation.
   */
  const recordVisualEdit = useCallback(
    (edit: { file: string; before: string; after: string; additions: number; deletions: number }) => {
      const now = Date.now();
      const actionId = `visual-edit:${now}:${Math.random().toString(36).slice(2, 7)}`;
      const target = stripProjectPrefix(edit.file);
      setState((prev) => ({
        ...prev,
        actions: {
          ...prev.actions,
          [actionId]: {
            id: actionId,
            kind: "edit",
            tool: "visual_edit",
            status: "success",
            target,
            additions: edit.additions,
            deletions: edit.deletions,
            before: edit.before,
            after: edit.after,
            startedAt: now,
            endedAt: now,
          },
        },
        log: [...prev.log, { type: "action", id: `entry:${actionId}`, actionId, ts: now }],
      }));
    },
    [],
  );

  const replyPermission = useCallback(
    async (permissionId: string, response: "allow" | "always" | "deny") => {
      const projectId = activeProjectRef.current;
      const sessionId = activeSessionRef.current;
      if (!projectId || !sessionId) return;
      await api.replyPermission(projectId, sessionId, permissionId, response).catch(() => undefined);
      setState((prev) => {
        const actionId = `permission:${permissionId}`;
        const existing = prev.actions[actionId];
        if (!existing) return prev;
        return {
          ...prev,
          actions: {
            ...prev.actions,
            [actionId]: {
              ...existing,
              status: "success",
              endedAt: Date.now(),
              permissionResolved: response,
            },
          },
        };
      });
    },
    [],
  );

  /** Rebuild the work log from persisted session messages after a reload. */
  const restoreSession = useCallback(
    async (projectId: string, sessionId: string) => {
      // Open the task at once in its loading state. Starting the runtime can take
      // several seconds, and the user must not be left on the welcome screen meanwhile.
      activeSessionRef.current = sessionId;
      setState((prev) => ({
        ...prev,
        sessionId,
        log: [],
        actions: {},
        diffs: [],
        error: null,
        restored: true,
        loadingSession: true,
      }));
      // Bring the runtime up so persisted sessions can be queried again.
      await api.startRuntime(projectId).catch(() => undefined);
      if (activeSessionRef.current !== sessionId) return false;
      const messages = await api.sessionMessages(projectId, sessionId).catch(() => null);
      if (activeSessionRef.current !== sessionId) return false;
      if (!messages) {
        // Open the task anyway and say why it is empty, rather than leaving the user where they were.
        setState((prev) => ({
          ...prev,
          sessionId,
          log: [],
          actions: {},
          diffs: [],
          runState: "idle",
          restored: true,
          loadingSession: false,
          error: "This task could not be loaded. Choose it again, or start a new task.",
        }));
        return false;
      }
      const log: LogEntry[] = [];
      const actions: Record<string, AgentAction> = {};
      for (const message of messages) {
        try {
          rebuildMessage(message, log, actions);
        } catch (error) {
          // One malformed message must not stop the whole task from opening.
          console.error("Could not read one message in this task.", message?.info?.id, error);
        }
      }
      activeSessionRef.current = sessionId;
      setState((prev) => ({
        ...prev,
        sessionId,
        log,
        actions,
        diffs: [],
        runState: "complete",
        restored: true,
        loadingSession: false,
      }));
      // The conversation is on screen before the changes are loaded. A slow diff
      // must never keep a task from opening, and its result is merged only if the
      // same task is still selected.
      void api.sessionDiff(projectId, sessionId)
        .then((diffs) => {
          if (activeSessionRef.current !== sessionId) return;
          setState((prev) => {
            const enriched: Record<string, AgentAction> = { ...prev.actions };
            for (const key of Object.keys(enriched)) {
              const action = enriched[key];
              const match = diffs.find((d) => stripProjectPrefix(d.file) === action.target);
              if (match && /^(edit|create|delete)$/.test(action.kind)) {
                enriched[key] = {
                  ...action,
                  additions: match.additions,
                  deletions: match.deletions,
                  before: match.before || action.before,
                  after: match.after || action.after,
                };
              }
            }
            return { ...prev, diffs, actions: enriched };
          });
        })
        .catch(() => undefined);
      // If the harness is still busy, reattach to the live stream. Replayed
      // buffered events reconcile into the same rows by stable id.
      openStream(projectId);
      return true;
    },
    [openStream],
  );

  /** Select a saved conversation without changing the workspace it belongs to. */
  const selectThread = useCallback(
    async (projectId: string, sessionId: string) => {
      selectProject(projectId);
      await restoreSession(projectId, sessionId);
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ projectId, sessionId }));
      } catch { /* storage unavailable */ }
    },
    [restoreSession, selectProject],
  );

  const boot = useCallback(async () => {
    const [, status] = await Promise.all([
      loadProjects(),
      api.openCodeStatus().catch(() => null),
    ]);
    // Clyra deliberately opens in a fresh, unbound welcome state. Projects
    // remain available in the sidebar, but reopening Vibe Coder never drops
    // a user back into an old conversation or restores its scroll position.
    activeProjectRef.current = null;
    activeSessionRef.current = null;
    setState((prev) => ({
      ...prev,
      activeProjectId: null,
      sessionId: null,
      sessionTitle: "",
      model: status?.model ?? null,
      platform: "web",
    }));
  }, [loadProjects]);

  useEffect(() => {
    void boot();
    // boot() is intentionally run once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const derived = useMemo(() => {
    const actionList = state.log
      .filter((e): e is Extract<LogEntry, { type: "action" }> => e.type === "action")
      .map((e) => state.actions[e.actionId])
      .filter(Boolean);
    const running = state.runState === "running" || state.runState === "starting";
    const fileActions = actionList.filter((a) => /^(edit|create|delete)$/.test(a.kind));
    const commandActions = actionList.filter((a) => /^(command|build|check|test|preview)$/.test(a.kind));
    const pendingPermissions = actionList.filter(
      (a) => a.kind === "permission" && a.status === "active",
    );
    // The harness diff endpoint only reports files it can compare against a
    // git baseline, so a run that also wrote untracked or ignored files comes
    // back short — the summary card said "Edited 1 file" for a run that wrote
    // six.  Union the endpoint's diffs with the files the tool payloads prove
    // were written: an endpoint entry wins wherever both exist (it carries the
    // real before/after and the authoritative counts) and a tool-derived entry
    // fills every gap.  Paths are keyed through stripProjectPrefix because the
    // endpoint returns absolute paths while a tool target is project-relative.
    // Nothing here invents numbers: an action with no counts contributes none.
    let effectiveDiffs: FileDiff[] = mergeFileDiffs(state.diffs, fileActions);
    // Keep direct Visual Edit writes visible beside harness-generated diffs.
    // When the same file has a session diff, preserve its original before
    // snapshot and layer the latest real visual edit over it.
    const directVisualEdits = fileActions.filter(
      (action) => action.tool === "visual_edit" && action.status === "success" && action.before !== undefined && action.after !== undefined,
    );
    if (directVisualEdits.length) {
      const byFile = new Map(effectiveDiffs.map((diff) => [diff.file, diff]));
      for (const action of directVisualEdits) {
        const existing = byFile.get(action.target);
        byFile.set(action.target, {
          file: action.target,
          before: existing?.before || action.before || "",
          after: action.after || existing?.after || "",
          additions: (existing?.additions ?? 0) + (action.additions ?? 0),
          deletions: (existing?.deletions ?? 0) + (action.deletions ?? 0),
        });
      }
      effectiveDiffs = [...byFile.values()];
    }
    // The plan is whichever todo action reported last — todowrite replaces the
    // whole list on every call, so the newest one is the session's real plan.
    const todoActions = actionList.filter((a) => a.kind === "todo" && a.todos?.length);
    const lastPlan = todoActions.length ? todoActions[todoActions.length - 1].todos ?? null : null;
    // A finished run has nothing left "in progress". Reconcile any rows the
    // agent never marked done (a reopened completed task, or a run that ended
    // between two todowrite calls) so a finished checklist reads finished
    // instead of leaving a spinner turning forever.
    const plan =
      lastPlan && state.runState === "complete"
        ? lastPlan.map((row) => (row.status === "completed" ? row : { ...row, status: "completed" }))
        : lastPlan;
    return { actionList, running, fileActions, commandActions, pendingPermissions, effectiveDiffs, plan };
  }, [state.log, state.actions, state.runState, state.diffs]);

  return {
    state,
    ...derived,
    loadProjects,
    selectProject,
    selectThread,
    startRun,
    beginOptimisticPrompt,
    failOptimisticPrompt,
    cancelRun,
    undoLastCheckpoint,
    replyPermission,
    recordVisualEdit,
    setState,
  };
}

function finalizeActions(
  actions: Record<string, AgentAction>,
  terminal: "success" | "error" | "cancelled",
): Record<string, AgentAction> {
  const next: Record<string, AgentAction> = {};
  for (const key of Object.keys(actions)) {
    const action = actions[key];
    next[key] =
      action.status === "active" || action.status === "queued"
        ? { ...action, status: terminal, endedAt: action.endedAt ?? Date.now() }
        : action;
  }
  return next;
}


/**
 * Unions the harness diff endpoint's report with the files the tool payloads
 * prove were written.
 *
 * The endpoint only reports files it can compare against a git baseline, so a
 * run that also wrote untracked or ignored files comes back short — the
 * completed-work card once said "Edited 1 file" for a run that wrote six. An
 * endpoint entry wins wherever both describe the same file (it carries the
 * real before/after and the authoritative counts); a tool-derived entry fills
 * every gap. Nothing here invents numbers: an action with no counts
 * contributes none.
 *
 * Paths are keyed through stripProjectPrefix because the endpoint returns
 * absolute paths while a tool target is project-relative.
 *
 * @param endpointDiffs - What the session diff endpoint reported.
 * @param fileActions - Every edit/create/delete action in the session.
 * @returns One entry per file that was actually changed.
 */
export function mergeFileDiffs(
  endpointDiffs: FileDiff[],
  fileActions: AgentAction[],
): FileDiff[] {
  if (!fileActions.length) return endpointDiffs;
  const authoritative = new Set(endpointDiffs.map((diff) => stripProjectPrefix(diff.file)));
  const byFile = new Map<string, FileDiff>();
  for (const diff of endpointDiffs) byFile.set(stripProjectPrefix(diff.file), diff);
  for (const action of fileActions) {
    if (action.status !== "success" || !action.target || action.target === "…") continue;
    const key = stripProjectPrefix(action.target);
    if (authoritative.has(key)) continue;
    const existing = byFile.get(key);
    byFile.set(key, {
      file: action.target,
      before: "",
      after: action.contentAfter ?? existing?.after ?? "",
      additions: (existing?.additions ?? 0) + (action.additions ?? 0),
      deletions: (existing?.deletions ?? 0) + (action.deletions ?? 0),
    });
  }
  return [...byFile.values()];
}

function rebuildMessage(
  message: OpenCodeMessage,
  log: LogEntry[],
  actions: Record<string, AgentAction>,
) {
  const role = message.info?.role;
  const ts = message.info?.time?.created ?? Date.now();
  for (const part of message.parts ?? []) {
    if (part.type === "text" && part.text) {
      /* Recovery nudges Clyra injects on the user's behalf are real turns to
         the model, but they are not something the person said — and not
         something the person should read. Checked for BOTH roles: the nudge
         arrives as a user turn, but a model that echoes its instruction back
         would otherwise print it as prose. */
      if (isInternalPrompt(part.text)) continue;
      if (role === "user") {
        log.push({ type: "user", id: `user-${message.info.id}-${part.id}`, text: part.text, ts });
      } else {
        log.push({
          type: "assistant",
          id: `assistant-${part.messageID}-${part.id}`,
          text: part.text,
          ts,
        });
      }
      continue;
    }
    if (part.type === "tool" && role === "assistant") {
      const tool = String(part.tool || "tool");
      const partState = part.state ?? { status: "completed" as const };
      const input = (partState.input ?? {}) as Record<string, unknown>;
      if (/^question$/.test(tool.trim().toLowerCase())) {
        const question = String(input.question || partState.output || "").trim();
        if (question) log.push({ type: "assistant", id: `assistant-${part.messageID}-${part.id}`, text: question, ts });
        continue;
      }
      const { kind, target } = classifyTool(tool, input);
      const actionId = `${part.sessionID}:${part.messageID}:${part.id}`;
      const metadataDiff =
        typeof partState.metadata?.diff === "string" ? (partState.metadata.diff as string) : "";
      const inputPatch = typeof input.patch === "string" ? input.patch : "";
      const patchSource = metadataDiff || inputPatch || buildEditSnippet(kind, input);
      const counts = countsFromDiffText(patchSource);
      const writtenContent =
        kind === "create" && typeof input.content === "string" ? input.content : undefined;
      actions[actionId] = {
        id: actionId,
        kind,
        tool,
        status: toolStatus(partState.status),
        target: target || (/^(create|edit|delete|read)$/.test(kind) ? "…" : tool),
        output: String(partState.output ?? ""),
        additions:
          counts?.additions ??
          (writtenContent !== undefined ? writtenContent.split("\n").length : undefined),
        deletions: counts?.deletions,
        patch: patchSource || undefined,
        contentAfter: writtenContent,
        todos: kind === "todo" ? parseTodos(input) ?? parseTodos(safeJsonParse(partState.output)) : undefined,
        startedAt: partState.time?.start ?? ts,
        endedAt: partState.time?.end,
      };
      log.push({ type: "action", id: `entry-${actionId}`, actionId, ts });
    }
  }
}
