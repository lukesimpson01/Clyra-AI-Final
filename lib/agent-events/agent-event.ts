/**
 * Typed run events the chat renders. They are derived from persisted mission
 * snapshots (see deriveAgentEvents), never from model text, so every status the
 * user sees corresponds to real execution state. Browser/computer frames are not
 * part of this protocol yet; they will be added when those runtimes emit them.
 */

/** The structural view of a mission both the server record and the chat's
 * MissionStatus satisfy. Only fields the chat needs are read. */
export type RunSnapshot = {
  id: string;
  state: string;
  plan: {
    steps: Array<{
      id: string;
      description: string;
      toolId?: string;
      status: string;
      approval?: { status: string };
      verification?: { status: string };
    }>;
  };
  /** Chat's mission status exposes a pending approval at the top level. */
  approval?: { stepId: string; toolId: string };
  error?: { code?: string; message: string };
};

export type AgentTaskView = {
  id: string;
  description: string;
  toolId?: string;
  status: string;
  verification?: string;
};

export type AgentEvent =
  | { type: "run.started"; runId: string }
  | { type: "plan.updated"; runId: string; tasks: AgentTaskView[] }
  | { type: "tool.started"; runId: string; taskId: string; toolId?: string; label: string }
  | { type: "approval.required"; runId: string; taskId: string; toolId?: string }
  | { type: "run.completed"; runId: string }
  | { type: "run.cancelled"; runId: string }
  | { type: "run.failed"; runId: string; error: { code: string; message: string } };

/** Step statuses from both the server record (queued/pending/...) and the chat status (pending/...). */
const TASK_STATUSES = new Set(["queued", "pending", "running", "waiting", "blocked", "paused", "retrying", "completed", "failed", "cancelled"]);

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/** Validates an event received across IPC or from a stored log before the UI trusts it. */
export function isAgentEvent(value: unknown): value is AgentEvent {
  if (!isRecord(value) || typeof value.runId !== "string" || !value.runId) return false;
  switch (value.type) {
    case "run.started":
    case "run.completed":
    case "run.cancelled":
      return true;
    case "plan.updated":
      return Array.isArray(value.tasks) && value.tasks.every((task) => isRecord(task) && typeof task.id === "string" && typeof task.description === "string" && (task.toolId === undefined || typeof task.toolId === "string") && typeof task.status === "string" && TASK_STATUSES.has(task.status));
    case "tool.started":
      return typeof value.taskId === "string" && (value.toolId === undefined || typeof value.toolId === "string") && typeof value.label === "string";
    case "approval.required":
      return typeof value.taskId === "string" && (value.toolId === undefined || typeof value.toolId === "string");
    case "run.failed":
      return isRecord(value.error) && typeof value.error.code === "string" && typeof value.error.message === "string";
    default:
      return false;
  }
}

function toTaskView(step: RunSnapshot["plan"]["steps"][number]): AgentTaskView {
  return { id: step.id, description: step.description, toolId: step.toolId, status: step.status, verification: step.verification?.status };
}

function sameTasks(a: RunSnapshot["plan"]["steps"], b: RunSnapshot["plan"]["steps"]) {
  if (a.length !== b.length) return false;
  return a.every((step, index) => {
    const other = b[index];
    return step.id === other.id && step.status === other.status && step.verification?.status === other.verification?.status && step.approval?.status === other.approval?.status;
  });
}

/** Approval is pending either on a step or at the top level of the snapshot. */
function pendingApprovalTask(snapshot: RunSnapshot): { taskId: string; toolId?: string } | null {
  const step = snapshot.plan.steps.find((candidate) => candidate.approval?.status === "pending");
  if (step) return { taskId: step.id, toolId: step.toolId };
  if (snapshot.approval) return { taskId: snapshot.approval.stepId, toolId: snapshot.approval.toolId };
  return null;
}

/**
 * Diffs two consecutive snapshots and returns the events between them.
 * Pass `previous = null` for the first snapshot of a run.
 */
export function deriveAgentEvents(previous: RunSnapshot | null, next: RunSnapshot): AgentEvent[] {
  const runId = next.id;
  const events: AgentEvent[] = [];
  if (!previous) events.push({ type: "run.started", runId });

  if (!previous || !sameTasks(previous.plan.steps, next.plan.steps)) {
    events.push({ type: "plan.updated", runId, tasks: next.plan.steps.map(toTaskView) });
  }

  const before = new Map((previous?.plan.steps ?? []).map((step) => [step.id, step]));
  for (const step of next.plan.steps) {
    const prior = before.get(step.id);
    if (step.status === "running" && prior?.status !== "running") {
      events.push({ type: "tool.started", runId, taskId: step.id, toolId: step.toolId, label: step.description });
    }
  }

  const approvalNow = pendingApprovalTask(next);
  if (approvalNow && !(previous && pendingApprovalTask(previous)?.taskId === approvalNow.taskId)) {
    events.push({ type: "approval.required", runId, taskId: approvalNow.taskId, toolId: approvalNow.toolId });
  }

  const stateChanged = previous?.state !== next.state;
  if (stateChanged && next.state === "COMPLETED") events.push({ type: "run.completed", runId });
  if (stateChanged && next.state === "CANCELLED") events.push({ type: "run.cancelled", runId });
  if (stateChanged && next.state === "FAILED") {
    events.push({ type: "run.failed", runId, error: { code: next.error?.code ?? "unknown", message: next.error?.message ?? "The run failed." } });
  }
  return events;
}

/** The latest step the run is executing, from real snapshot state. */
export function currentActivity(snapshot: RunSnapshot): { label: string; toolId?: string } | null {
  const running = snapshot.plan.steps.find((step) => step.status === "running");
  return running ? { label: running.description, toolId: running.toolId } : null;
}
