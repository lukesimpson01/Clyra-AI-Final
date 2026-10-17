import assert from "node:assert/strict";
import { currentActivity, deriveAgentEvents, isAgentEvent, type AgentEvent, type RunSnapshot } from "../lib/agent-events/agent-event";
import type { MissionRecord, MissionStep } from "../lib/clyra-agent/core";

let assertions = 0;
const check = (condition: unknown, message: string) => {
  assertions += 1;
  assert.ok(condition, message);
};

const step = (id: string, overrides: Partial<MissionStep> = {}): MissionStep => ({
  id,
  description: `Step ${id}`,
  toolId: "web.search",
  args: {},
  dependsOn: [],
  status: "queued",
  ...overrides,
});

const mission = (state: MissionRecord["state"], steps: MissionStep[], extra: Partial<MissionRecord> = {}): MissionRecord => ({
  id: "run-1",
  state,
  plan: { objective: "test", steps },
  traces: [],
  outputs: {},
  startedAt: 0,
  updatedAt: 0,
  ...extra,
});

const kinds = (events: AgentEvent[]) => events.map((event) => event.type);

const first = deriveAgentEvents(null, mission("PLANNING", [step("a"), step("b")]));
check(kinds(first).join(",") === "run.started,plan.updated", "First snapshot emits run.started then plan.updated");
const planEvent = first[1] as Extract<AgentEvent, { type: "plan.updated" }>;
check(planEvent.tasks.length === 2 && planEvent.tasks[0].status === "queued", "Plan lists every real step with its real status");

const same = deriveAgentEvents(mission("EXECUTING", [step("a")]), mission("EXECUTING", [step("a")]));
check(same.length === 0, "Identical snapshots emit no events");

const started = deriveAgentEvents(mission("EXECUTING", [step("a")]), mission("EXECUTING", [step("a", { status: "running" })]));
const toolEvent = started.find((event) => event.type === "tool.started");
check(kinds(started).includes("plan.updated") && toolEvent?.type === "tool.started", "Running step emits plan.updated and tool.started");
check(toolEvent?.type === "tool.started" && toolEvent.label === "Step a" && toolEvent.toolId === "web.search", "tool.started carries the real tool id and description");

const approval = deriveAgentEvents(
  mission("EXECUTING", [step("a", { status: "running" })]),
  mission("WAITING_FOR_APPROVAL", [step("a", { status: "waiting", approval: { required: true, status: "pending" } })]),
);
check(approval.filter((event) => event.type === "approval.required").length === 1, "Pending approval emits approval.required once");
const repeat = deriveAgentEvents(
  mission("WAITING_FOR_APPROVAL", [step("a", { status: "waiting", approval: { required: true, status: "pending" } })]),
  mission("WAITING_FOR_APPROVAL", [step("a", { status: "waiting", approval: { required: true, status: "pending" } })]),
);
check(!repeat.some((event) => event.type === "approval.required"), "Approval is not re-announced on identical snapshots");

const done = deriveAgentEvents(mission("EXECUTING", []), mission("COMPLETED", []));
check(kinds(done).filter((type) => type === "run.completed").length === 1, "Completion emits run.completed once");
const failed = deriveAgentEvents(mission("EXECUTING", []), mission("FAILED", [], { error: { code: "TOOL_FAILED", message: "Search timed out" } }));
const failEvent = failed.find((event) => event.type === "run.failed");
check(failEvent?.type === "run.failed" && failEvent.error.message === "Search timed out", "Failure carries the real error message");
const cancelled = deriveAgentEvents(mission("EXECUTING", []), mission("CANCELLED", []));
check(kinds(cancelled).includes("run.cancelled"), "Cancellation emits run.cancelled");

const all = [...first, ...started, ...approval, ...done, ...failed, ...cancelled];
check(all.every(isAgentEvent), "All derived events validate against the protocol");

check(!isAgentEvent({ type: "tool.started", runId: "r" }), "Validator rejects tool.started without a tool id");
check(!isAgentEvent({ type: "plan.updated", runId: "r", tasks: [{ id: "a", description: "x", toolId: "t", status: "done" }] }), "Validator rejects an unknown task status");
check(!isAgentEvent({ type: "run.completed" }), "Validator rejects events without a runId");
check(!isAgentEvent({ type: "frame.drawn", runId: "r" }), "Validator rejects unknown event types");

// Chat's MissionStatus shape (string statuses, top-level approval) produces the same events.
const chatSnapshot = (state: string, steps: RunSnapshot["plan"]["steps"], extra: Partial<RunSnapshot> = {}): RunSnapshot => ({
  id: "chat-1",
  state,
  plan: { steps },
  ...extra,
});
const chatWaiting = deriveAgentEvents(
  chatSnapshot("EXECUTING", [{ id: "s1", description: "Search", toolId: "web.search", status: "running" }]),
  chatSnapshot("WAITING_FOR_APPROVAL", [{ id: "s1", description: "Search", toolId: "web.search", status: "waiting" }], { approval: { stepId: "s1", toolId: "web.search" } }),
);
check(chatWaiting.some((event) => event.type === "approval.required" && event.taskId === "s1"), "Top-level chat approval emits approval.required");
check(currentActivity(chatSnapshot("EXECUTING", [{ id: "s1", description: "Reading sources", toolId: "web.fetch", status: "running" }]))?.label === "Reading sources", "Current activity is the real running step description");
check(currentActivity(chatSnapshot("COMPLETED", [{ id: "s1", description: "Done", toolId: "t", status: "completed" }])) === null, "No activity is shown once no step is running");

console.log(`Agent events: ${assertions}/${assertions} PASS`);
