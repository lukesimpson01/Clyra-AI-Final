/**
 * The facts behind the Working timeline, kept free of React so they can be tested on their own.
 *
 * Three things live here: how a run of tool calls is split into groups and named ("Edited 3 files · Ran 2 commands"),
 * how the agent's plan moves from one todo_write to the next without losing finished steps, and how many steps are
 * honestly done. Nothing here marks work finished that the agent's own events did not.
 */
import type { AgentAction } from "./store";

/* ───────────────────────── plan ───────────────────────── */

export type PlanStatus = "pending" | "in_progress" | "completed" | "blocked" | "cancelled";
export type PlanRow = { content: string; status: PlanStatus; priority?: string };
export type RawPlanRow = { content: string; status: string; priority?: string };

/** The agent and its tools name the same five states in many ways; everything is folded onto five. */
export function normalizePlanStatus(raw: string | undefined | null): PlanStatus {
  const value = String(raw ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (/^(completed|complete|done|success|succeeded|finished)$/.test(value)) return "completed";
  if (/^(in_progress|inprogress|active|running|doing|started|working)$/.test(value)) return "in_progress";
  if (/^(blocked|failed|failure|error|errored)$/.test(value)) return "blocked";
  if (/^(cancelled|canceled|skipped|dropped|abandoned)$/.test(value)) return "cancelled";
  return "pending";
}

export const normalizePlan = (rows: readonly RawPlanRow[]): PlanRow[] =>
  rows.map((row) => ({ content: row.content, status: normalizePlanStatus(row.status), ...(row.priority ? { priority: row.priority } : {}) }));

/**
 * Applies the agent's newest todo_write on top of the plan it already had. A todo_write replaces the whole list, so a
 * forgetful model can send a step it had finished back as pending; a finished step stays finished unless the agent
 * says something else about it (blocked, cancelled), or drops the step from the list altogether (a real revision).
 */
export function reconcilePlan(previous: readonly PlanRow[] | null, next: readonly RawPlanRow[]): PlanRow[] {
  const incoming = normalizePlan(next);
  if (!previous?.length) return incoming;
  const finished = new Set(previous.filter((row) => row.status === "completed").map((row) => row.content.trim().toLowerCase()));
  return incoming.map((row) =>
    (row.status === "pending" || row.status === "in_progress") && finished.has(row.content.trim().toLowerCase())
      ? { ...row, status: "completed" as const }
      : row);
}

/** Replays every plan the agent reported, in order, into the plan as it stands now. */
export function replayPlan(updates: ReadonlyArray<readonly RawPlanRow[]>): PlanRow[] | null {
  let plan: PlanRow[] | null = null;
  for (const update of updates) if (update.length) plan = reconcilePlan(plan, update);
  return plan;
}

export type PlanProgress = {
  total: number;
  completed: number;
  blocked: number;
  /** 1-based index of the step being worked on, or null when none is. */
  current: number | null;
  /** True only when every step is confirmed completed. */
  allDone: boolean;
  /** "Step 2 / 5" when the steps are going in order, otherwise "3 / 5 completed". */
  label: string;
  /** The same, as the collapsed row reads it. */
  summary: string;
};

/**
 * Progress from the real statuses. "Step N / M" is used only while the work is genuinely sequential (every step before
 * the active one is finished); anything else is reported as a plain completed count, so it can never over-claim.
 */
export function planProgress(rows: readonly PlanRow[], live = true): PlanProgress {
  const total = rows.length;
  const completed = rows.filter((row) => row.status === "completed").length;
  const blocked = rows.filter((row) => row.status === "blocked").length;
  const activeIndex = rows.findIndex((row) => row.status === "in_progress");
  const sequential = activeIndex >= 0
    && rows.slice(0, activeIndex).every((row) => row.status === "completed" || row.status === "cancelled")
    && rows.slice(activeIndex + 1).every((row) => row.status !== "completed" && row.status !== "in_progress");
  const current = live && sequential ? activeIndex + 1 : null;
  const allDone = total > 0 && completed === total;
  const label = current ? `Step ${current} / ${total}` : `${completed} / ${total} completed`;
  return { total, completed, blocked, current, allDone, label, summary: `Plan · ${label}` };
}

/** What a step shows: an "in progress" step of a run that is no longer going is paused, not spinning. */
export function stepDisplay(status: PlanStatus, live: boolean): PlanStatus | "paused" {
  return status === "in_progress" && !live ? "paused" : status;
}

/* ───────────────────────── tool groups ───────────────────────── */

export type ToolPhase = "explore" | "change" | "run" | "git" | "browser" | "agent";

/** Which part of the work a tool call belongs to: looking around, changing files, running things, or a tool of its own. */
export function phaseOf(kind: string): ToolPhase {
  if (/^(read|list|search|research|fetch|image)$/.test(kind)) return "explore";
  if (/^(edit|create|delete)$/.test(kind)) return "change";
  if (kind === "git") return "git";
  if (kind === "browser") return "browser";
  if (/^(subagent|mcp)$/.test(kind)) return "agent";
  return "run";
}

const isActive = (action: AgentAction) => action.status === "active" || action.status === "queued";
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const distinct = (actions: readonly AgentAction[]) => new Set(actions.map((a) => a.target)).size || actions.length;

/**
 * "Edited 3 files · Created 1 file…" — what a group of tool calls did, in the order it started doing it. The trailing
 * ellipsis means something in the group is still running; nothing is called "Ran" or "Edited" before it has finished.
 */
export function groupSummary(actions: readonly AgentAction[]): string {
  const live = actions.some(isActive);
  const order: string[] = [];
  const buckets = new Map<string, AgentAction[]>();
  const add = (key: string, action: AgentAction) => {
    if (!buckets.has(key)) { buckets.set(key, []); order.push(key); }
    buckets.get(key)!.push(action);
  };
  for (const action of actions) {
    const kind = action.kind;
    if (kind === "edit") add("edit", action);
    else if (kind === "create") add("create", action);
    else if (kind === "delete") add("delete", action);
    else if (kind === "read" || kind === "list") add("explore", action);
    else if (kind === "search") add("search", action);
    else if (kind === "research") add("web", action);
    else if (kind === "fetch") add("fetch", action);
    else if (kind === "command") add("command", action);
    else if (kind === "build" || kind === "check" || kind === "test") add("check", action);
    else if (kind === "preview") add("preview", action);
    else if (kind === "git") add("git", action);
    else if (kind === "browser") add("browser", action);
    else if (kind === "image") add("image", action);
    else if (kind === "subagent") add("subagent", action);
    else if (kind === "mcp") add("mcp", action);
    else if (kind === "todo") add("plan", action);
    else if (kind === "permission") add("approval", action);
    else add("other", action);
  }
  const part = (key: string, list: AgentAction[]) => {
    switch (key) {
      case "edit": return `Edited ${plural(distinct(list), "file")}`;
      case "create": return `Created ${plural(distinct(list), "file")}`;
      case "delete": return `Deleted ${plural(distinct(list), "file")}`;
      case "explore": return `Explored ${plural(distinct(list), "file")}`;
      case "search": return list.length === 1 ? "Searched the codebase" : `Searched the codebase ${list.length} times`;
      case "web": return `Searched ${plural(list.length, "website")}`;
      case "fetch": return `Opened ${plural(list.length, "page")}`;
      case "command": return `Ran ${plural(list.length, "command")}`;
      case "check": return `Ran ${plural(list.length, "check")}`;
      case "preview": return "Opened the preview";
      case "git": return list.length === 1 ? (describeCall(list[0])?.done ?? "Ran a Git command") : `Ran ${plural(list.length, "Git command")}`;
      case "browser": return "Inspected the website";
      case "image": return list.length === 1 ? "Viewed an image" : `Viewed ${list.length} images`;
      case "subagent": return list.length === 1 ? (describeCall(list[0])?.done ?? "Ran a subagent") : `Ran ${list.length} subagents`;
      case "mcp": return `Used ${plural(list.length, "connector tool")}`;
      case "plan": return "Updated the plan";
      case "approval": return "Approval required";
      default: return `Used ${plural(list.length, "tool")}`;
    }
  };
  /* "Ran 1 command · Ran 2 checks" reads better as "Ran 1 command · 2 checks": a repeated leading verb is dropped. */
  let previousVerb = "";
  const text = order.map((key) => {
    const phrase = part(key, buckets.get(key)!);
    const verb = /^(Edited|Created|Deleted|Explored|Searched|Opened|Ran|Viewed|Checked|Used)\s/.exec(phrase)?.[1] ?? "";
    const out = verb && verb === previousVerb ? phrase.slice(verb.length + 1) : phrase;
    previousVerb = verb;
    return out;
  }).join(" · ");
  return live ? `${text}…` : text;
}

/** Splits consecutive tool calls into groups by phase, keeping their order. */
export function splitIntoGroups<T extends { kind: string }>(actions: readonly T[]): T[][] {
  const groups: T[][] = [];
  for (const action of actions) {
    const last = groups[groups.length - 1];
    if (last && phaseOf(last[last.length - 1].kind) === phaseOf(action.kind)) last.push(action);
    else groups.push([action]);
  }
  return groups;
}

/* ───────────────────────── how a call reads ───────────────────────── */

type CallLike = Pick<AgentAction, "kind" | "tool" | "target" | "status">;
export type CallWords = { active: string; done: string; failed: string; target: string };

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

/** The first git command in a shell line ("cd x && git status -s" → ["status", "-s"]). */
export function parseGit(command: string): { sub: string; args: string[] } | null {
  const match = /(?:^|&&|;|\|\|)\s*git\s+(?:-C\s+\S+\s+|-c\s+\S+\s+)*([a-z][a-z-]*)\b([^&;|]*)/i.exec(command);
  if (!match) return null;
  return { sub: match[1].toLowerCase(), args: match[2].trim().split(/\s+/).filter(Boolean) };
}

export const isGitCommand = (command: string) => parseGit(command) !== null;

function gitWords(command: string): CallWords {
  const git = parseGit(command);
  const sub = git?.sub ?? "";
  const rest = (git?.args ?? []).filter((a) => !a.startsWith("-"));
  const flags = (git?.args ?? []).filter((a) => a.startsWith("-"));
  const words = (active: string, done: string, failed: string): CallWords => ({ active, done, failed, target: "" });
  switch (sub) {
    case "status": return words("Checking Git status", "Checked Git status", "Couldn’t check Git status");
    case "diff": case "show": return words("Viewing changes", "Viewed changes", "Couldn’t view changes");
    case "log": return words("Viewing Git history", "Viewed Git history", "Couldn’t view Git history");
    case "add": return words("Staging changes", "Staged changes", "Couldn’t stage changes");
    case "commit": return words("Committing changes", "Committed changes", "Commit failed");
    case "push": return words("Pushing changes", "Pushed changes", "Push failed");
    case "pull": return words("Pulling changes", "Pulled changes", "Pull failed");
    case "fetch": return words("Fetching changes", "Fetched changes", "Fetch failed");
    case "stash": return words("Stashing changes", "Stashed changes", "Stash failed");
    case "init": return words("Creating a repository", "Created a repository", "Couldn’t create a repository");
    case "clone": return words("Cloning a repository", "Cloned a repository", "Clone failed");
    case "merge": return words(`Merging ${rest[0] ?? "a branch"}`, `Merged ${rest[0] ?? "a branch"}`, "Merge failed");
    case "branch": {
      const name = rest[0];
      if (name && !flags.some((f) => /^-(d|D|l|a|r|v|vv|-list|-delete)$/.test(f))) return words(`Creating branch ${name}`, `Created branch ${name}`, `Couldn’t create branch ${name}`);
      if (name) return words("Deleting a branch", "Deleted a branch", "Couldn’t delete the branch");
      return words("Listing branches", "Listed branches", "Couldn’t list branches");
    }
    case "checkout": case "switch": {
      const create = flags.some((f) => /^-(b|B|c|C)$/.test(f));
      const name = rest[0];
      if (create && name) return words(`Creating branch ${name}`, `Created branch ${name}`, `Couldn’t create branch ${name}`);
      return words(name ? `Switching to ${name}` : "Switching branch", name ? `Switched to ${name}` : "Switched branch", "Couldn’t switch branch");
    }
    default: return words(`Running git ${sub || "command"}`, `Ran git ${sub || "command"}`, `git ${sub || "command"} failed`);
  }
}

function browserWords(tool: string, target: string): CallWords {
  const op = tool.toLowerCase().replace(/^browser_/, "");
  const shown = clip(target, 56);
  const w = (active: string, done: string, failed: string, t = ""): CallWords => ({ active, done, failed, target: t });
  switch (op) {
    case "navigate": case "open": case "goto": return w("Opening", "Opened", "Couldn’t open", shown);
    case "click": return w("Clicking", "Clicked", "Couldn’t click", shown);
    case "type": case "fill": case "input": return w("Typing into", "Typed into", "Couldn’t type into", shown);
    case "get_state": return w("Inspecting the page", "Inspected the page", "Couldn’t inspect the page");
    case "get_content": return w("Reading the page", "Read the page", "Couldn’t read the page");
    case "get_storage": return w("Inspecting page storage", "Inspected page storage", "Couldn’t inspect page storage");
    case "list_tabs": return w("Listing browser tabs", "Listed browser tabs", "Couldn’t list browser tabs");
    case "switch_tab": return w("Switching tab", "Switched tab", "Couldn’t switch tab");
    case "close_tab": return w("Closing a tab", "Closed a tab", "Couldn’t close the tab");
    case "go_back": return w("Going back", "Went back", "Couldn’t go back");
    case "screenshot": return w("Taking a screenshot", "Took a screenshot", "Couldn’t take a screenshot");
    default: return w("Using the browser", "Used the browser", "Browser step failed", shown);
  }
}

function subagentWords(tool: string, target: string): CallWords {
  const shown = clip(target, 64);
  const w = (active: string, done: string, failed: string, t = ""): CallWords => ({ active, done, failed, target: t });
  switch (tool.toLowerCase()) {
    case "send_message": return w("Messaging a subagent", "Messaged a subagent", "Couldn’t message the subagent", shown);
    case "interrupt_agent": return w("Stopping a subagent", "Stopped a subagent", "Couldn’t stop the subagent");
    case "list_agents": return w("Listing subagents", "Listed subagents", "Couldn’t list subagents");
    case "list_subagent_models": return w("Listing subagent models", "Listed subagent models", "Couldn’t list subagent models");
    case "report": return w("Reporting findings", "Reported findings", "Couldn’t report findings", shown);
    default: return w("Running a subagent", "Ran a subagent", "Subagent failed", shown);
  }
}

/** "mcp__github__create_issue" → { server: "github", name: "create_issue" }. */
export function parseMcpTool(tool: string): { server: string; name: string } {
  const [, server = "", ...rest] = tool.split("__");
  return { server, name: rest.join("__") || tool };
}

/**
 * How the newer kinds of call read in a row: "Checked Git status", "Opened example.com", "Viewed an image",
 * "Ran a subagent". Null for kinds the ordinary row already words. The failure form is only ever shown for a call
 * that really returned an error.
 */
export function describeCall(call: CallLike): CallWords | null {
  switch (call.kind) {
    case "git": return gitWords(call.target);
    case "browser": return browserWords(call.tool, call.target);
    case "subagent": return subagentWords(call.tool, call.target);
    case "image": return { active: "Viewing an image", done: "Viewed an image", failed: "Couldn’t view the image", target: call.target };
    case "mcp": {
      const { server, name } = parseMcpTool(call.tool);
      return { active: "Using", done: "Used", failed: "Couldn’t use", target: server ? `${name} · ${server}` : name };
    }
    default: return null;
  }
}

/* ───────────────────────── changes ───────────────────────── */

export type ChangeTotals = { files: number; additions: number; deletions: number };

/** The floating summary's numbers, taken straight from the diffs the project actually has. */
export function changeTotals(diffs: ReadonlyArray<{ additions?: number; deletions?: number }>): ChangeTotals {
  return diffs.reduce<ChangeTotals>((sum, diff) => ({ files: sum.files + 1, additions: sum.additions + (diff.additions ?? 0), deletions: sum.deletions + (diff.deletions ?? 0) }), { files: 0, additions: 0, deletions: 0 });
}
