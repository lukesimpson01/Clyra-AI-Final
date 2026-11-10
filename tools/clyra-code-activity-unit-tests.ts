import assert from "node:assert/strict";
import {
  changeTotals, describeCall, groupSummary, isGitCommand, parseGit, parseMcpTool, normalizePlanStatus, phaseOf, planProgress, reconcilePlan, replayPlan, splitIntoGroups, stepDisplay,
  type PlanRow,
} from "../src/components/clyra-code/activityModel";
import type { AgentAction } from "../src/components/clyra-code/store";

let failures = 0;
const test = (name: string, fn: () => void) => {
  try { fn(); console.log(`PASS  ${name}`); } catch (error) { failures += 1; console.log(`FAIL  ${name}\n      ${error instanceof Error ? error.message : String(error)}`); }
};
const equal = (actual: unknown, expected: unknown, message?: string) => assert.deepEqual(actual, expected, message);
const action = (id: string, kind: string, target: string, status: AgentAction["status"] = "success", tool = kind): AgentAction =>
  ({ id, kind, tool, target, status, startedAt: 1 } as unknown as AgentAction);
const row = (content: string, status: string) => ({ content, status });

test("status names from different tools fold onto five states", () => {
  equal(["done", "Completed", "in-progress", "RUNNING", "failed", "skipped", "todo", "", undefined].map((s) => normalizePlanStatus(s as string)),
    ["completed", "completed", "in_progress", "in_progress", "blocked", "cancelled", "pending", "pending", "pending"]);
});

test("a finished step stays finished when a later todo_write forgets it", () => {
  const first = reconcilePlan(null, [row("Inspect", "in_progress"), row("Build", "pending")]);
  const second = reconcilePlan(first, [row("Inspect", "completed"), row("Build", "in_progress")]);
  const forgetful = reconcilePlan(second, [row("Inspect", "pending"), row("Build", "in_progress")]);
  equal(forgetful.map((r) => r.status), ["completed", "in_progress"]);
});

test("an explicit blocked or cancelled status is never overridden", () => {
  const prev = reconcilePlan(null, [row("A", "completed"), row("B", "in_progress")]);
  const next = reconcilePlan(prev, [row("A", "blocked"), row("B", "cancelled")]);
  equal(next.map((r) => r.status), ["blocked", "cancelled"]);
});

test("a revised plan keeps what was done and adds the new step", () => {
  const prev = reconcilePlan(null, [row("A", "completed"), row("B", "in_progress")]);
  const next = reconcilePlan(prev, [row("A", "pending"), row("B", "completed"), row("C", "in_progress")]);
  equal(next.map((r) => `${r.content}:${r.status}`), ["A:completed", "B:completed", "C:in_progress"]);
});

test("replaying the same events twice gives the same plan (duplicates are harmless)", () => {
  const events = [[row("A", "in_progress"), row("B", "pending")], [row("A", "completed"), row("B", "in_progress")]];
  equal(replayPlan([...events, ...events]), replayPlan(events));
});

test("Step N / M only while the steps run in order", () => {
  const sequential: PlanRow[] = [row("A", "completed"), row("B", "in_progress"), row("C", "pending")].map((r) => ({ ...r, status: r.status as PlanRow["status"] }));
  const p = planProgress(sequential, true);
  equal([p.current, p.label, p.summary], [2, "Step 2 / 3", "Plan · Step 2 / 3"]);
  const parallel = planProgress([{ content: "A", status: "pending" }, { content: "B", status: "in_progress" }, { content: "C", status: "completed" }], true);
  equal([parallel.current, parallel.label], [null, "1 / 3 completed"]);
});

test("a step finished out of order makes the plan non-sequential, so only a count is shown", () => {
  const p = planProgress([{ content: "A", status: "completed" }, { content: "B", status: "in_progress" }, { content: "C", status: "pending" }, { content: "D", status: "completed" }], true);
  equal([p.current, p.label], [null, "2 / 4 completed"]);
});

test("5 / 5 completed is reported only when every step is completed", () => {
  const four: PlanRow[] = [1, 2, 3, 4].map((n) => ({ content: String(n), status: "completed" as const }));
  equal(planProgress([...four, { content: "5", status: "in_progress" }], false).allDone, false);
  equal(planProgress([...four, { content: "5", status: "completed" }], false).label, "5 / 5 completed");
  equal(planProgress([...four, { content: "5", status: "completed" }], false).allDone, true);
});

test("a step still marked in progress after the run ended is paused, not spinning", () => {
  equal(stepDisplay("in_progress", false), "paused");
  equal(stepDisplay("in_progress", true), "in_progress");
  equal(stepDisplay("completed", false), "completed");
});

test("an empty plan has no progress to claim", () => {
  const p = planProgress([], true);
  equal([p.total, p.allDone, p.current], [0, false, null]);
});

test("tool kinds fall into explore / change / run phases", () => {
  equal(["read", "list", "search", "research", "fetch"].map(phaseOf), Array(5).fill("explore"));
  equal(["edit", "create", "delete"].map(phaseOf), Array(3).fill("change"));
  equal(["command", "build", "test", "preview", "todo", "generic"].map(phaseOf), Array(6).fill("run"));
});

test("consecutive calls split into groups only when the phase changes", () => {
  const groups = splitIntoGroups([action("1", "read", "a"), action("2", "list", "b"), action("3", "edit", "c"), action("4", "create", "d"), action("5", "command", "npm run build"), action("6", "read", "e")]);
  equal(groups.map((g) => g.map((a) => a.id)), [["1", "2"], ["3", "4"], ["5"], ["6"]]);
});

test("a group is named by what it did, in the order it did it", () => {
  equal(groupSummary([action("1", "edit", "a.ts"), action("2", "edit", "b.ts"), action("3", "edit", "c.ts"), action("4", "create", "d.ts")]), "Edited 3 files · Created 1 file");
  equal(groupSummary([action("1", "create", "a.ts"), action("2", "edit", "b.ts")]), "Created 1 file · Edited 1 file");
  equal(groupSummary([action("1", "command", "ls"), action("2", "command", "pwd")]), "Ran 2 commands");
  equal(groupSummary([action("1", "build", "npm run build"), action("2", "test", "npm test")]), "Ran 2 checks");
  equal(groupSummary([action("1", "read", "a"), action("2", "list", "src"), action("3", "read", "b")]), "Explored 3 files");
  equal(groupSummary([action("1", "research", "q"), action("2", "research", "r")]), "Searched 2 websites");
});

test("a repeated verb is written once", () => {
  equal(groupSummary([action("1", "command", "ls"), action("2", "build", "npm run build"), action("3", "test", "npm test")]), "Ran 1 command · 2 checks");
  equal(groupSummary([action("1", "edit", "a.ts"), action("2", "create", "b.ts")]), "Edited 1 file · Created 1 file");
});

test("editing the same file twice counts one file", () => {
  equal(groupSummary([action("1", "edit", "a.ts"), action("2", "edit", "a.ts")]), "Edited 1 file");
});

test("a group with work still running ends in an ellipsis and never claims it is done", () => {
  equal(groupSummary([action("1", "edit", "a.ts"), action("2", "command", "npm run build", "active")]), "Edited 1 file · Ran 1 command…");
});

test("change totals add real diffs and nothing else", () => {
  equal(changeTotals([{ additions: 10, deletions: 2 }, { additions: 5 }, {}]), { files: 3, additions: 15, deletions: 2 });
  equal(changeTotals([]), { files: 0, additions: 0, deletions: 0 });
});


test("git commands are recognised wherever they sit in a shell line, and ordinary commands are not", () => {
  equal(["git status", "cd app && git diff --stat", "git -C repo log -3", "npm run build && git add -A"].map(isGitCommand), [true, true, true, true]);
  equal(["npm run build", "echo digit", "gitleaks detect", "ls .git"].map(isGitCommand), [false, false, false, false]);
  equal(parseGit("git commit -m 'x'")?.sub, "commit");
});

test("git calls read as what they did", () => {
  const words = (cmd: string) => describeCall(action("1", "git", cmd))!;
  equal(words("git status").done, "Checked Git status");
  equal(words("git status").active, "Checking Git status");
  equal(words("git diff").done, "Viewed changes");
  equal(words("git checkout -b feature/ui").done, "Created branch feature/ui");
  equal(words("git switch main").done, "Switched to main");
  equal(words("git add -A").done, "Staged changes");
  equal(words("git commit -m hi").done, "Committed changes");
  equal(words("git push origin main").failed, "Push failed");
  equal(words("git rebase main").done, "Ran git rebase");
  equal(words("git branch").done, "Listed branches");
});

test("browser calls read as what they did, with the page or element as the target", () => {
  const w = (tool: string, target = "") => describeCall(action("1", "browser", target, "success", tool))!;
  equal([w("browser_navigate", "https://example.com/a").done, w("browser_navigate", "https://example.com/a").target], ["Opened", "https://example.com/a"]);
  equal(w("browser_click", "#buy").done, "Clicked");
  equal(w("browser_get_state").done, "Inspected the page");
  equal(w("browser_get_content").done, "Read the page");
  equal(w("browser_list_tabs").done, "Listed browser tabs");
  equal(w("browser_unknown_op").done, "Used the browser");
});

test("subagent, image and connector calls are worded from their real tool names", () => {
  equal(describeCall(action("1", "subagent", "Review the API", "success", "subagent"))!.done, "Ran a subagent");
  equal(describeCall(action("2", "subagent", "", "success", "interrupt_agent"))!.done, "Stopped a subagent");
  equal(describeCall(action("3", "image", "shot.png", "success", "read_image"))!.done, "Viewed an image");
  equal(parseMcpTool("mcp__github__create_issue"), { server: "github", name: "create_issue" });
  equal(describeCall(action("4", "mcp", "", "success", "mcp__github__create_issue"))!.target, "create_issue · github");
  equal(describeCall(action("5", "read", "a.ts")), null);
});

test("a call that failed is worded as a failure, one still running as running", () => {
  const w = describeCall(action("1", "git", "git push"))!;
  equal([w.active, w.done, w.failed], ["Pushing changes", "Pushed changes", "Push failed"]);
});

test("new kinds group by their own phase and are named in group headers", () => {
  equal(["git", "browser", "image", "subagent", "mcp"].map(phaseOf), ["git", "browser", "explore", "agent", "agent"]);
  equal(groupSummary([action("1", "git", "git status")]), "Checked Git status");
  equal(groupSummary([action("1", "git", "git status"), action("2", "git", "git diff")]), "Ran 2 Git commands");
  equal(groupSummary([action("1", "browser", "https://a.com", "success", "browser_navigate"), action("2", "browser", "#x", "success", "browser_click")]), "Inspected the website");
  equal(groupSummary([action("1", "subagent", "A", "success", "subagent"), action("2", "subagent", "B", "success", "subagent")]), "Ran 2 subagents");
  equal(groupSummary([action("1", "image", "a.png", "success", "read_image"), action("2", "image", "b.png", "success", "read_image")]), "Viewed 2 images");
  equal(groupSummary([action("1", "subagent", "A", "active", "subagent")]), "Ran a subagent…");
});

console.log(failures ? `\n${failures} failed` : "\nAll activity-model tests passed");
process.exit(failures ? 1 : 0);
