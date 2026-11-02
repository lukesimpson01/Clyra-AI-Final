/**
 * The browser agent's run feed: how the managed browser's streamed progress events become readable action rows.
 * Same event contract as the Browser app (/api/openbrowser/assist), so a task run from chat and one run in the
 * Browser app read identically. Kept in step with the reducer in WebBrowserWorkspace.
 */
export type AgentStatus =
  | "idle" | "planning" | "observing" | "executing" | "verifying" | "recovering"
  | "waiting_for_user" | "paused" | "completed" | "failed" | "cancelled";

export type StepEvaluation = { verdict: "Success" | "Failure" | "Uncertain"; reason?: string };

export type CompletionEvidence = { url: string; title: string; checks: string[] };

/** A progress event streamed over SSE or replayed from the persisted session. */
export type RunEvent = {
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

export type RunItem =
  | { id: string; kind: "reasoning"; step?: number; evaluation?: StepEvaluation; nextGoal: string; memory?: string }
  | { id: string; kind: "action"; step?: number; actionType: string; label: string; icon: ActionIconKey; status: "running" | "success" | "error"; detail: string; result?: string }
  | { id: string; kind: "recovery" | "strategy"; message: string }
  | { id: string; kind: "ask"; question: string }
  | { id: string; kind: "complete"; success: boolean; message: string; evidence?: CompletionEvidence };


function displayHost(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "") || "New tab";
  } catch {
    return "New tab";
  }
}

export type ActionIconKey =
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
export function actionSummary(action: Record<string, unknown> & { type?: string }): { label: string; icon: ActionIconKey } {
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
export function reduceRunItems(items: RunItem[], event: RunEvent): RunItem[] {
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

