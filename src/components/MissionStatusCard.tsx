import { useState } from "react";
import { ActivitySteps, StatusLine, WorkSummary, type ActivityStep } from "./chat/assistant";

export type MissionStatusStep = {
  id: string;
  description: string;
  status: "pending" | "running" | "completed" | "failed" | "blocked" | "cancelled";
};

export type MissionStatus = {
  id: string;
  state: string;
  plan: { objective: string; steps: MissionStatusStep[] };
  /** Delegated work is compactly exposed only when a mission actually fans out. */
  agents?: Array<{
    id: string;
    label: string;
    status: "working" | "completed" | "failed";
    app?: string;
    startedAt?: number;
  }>;
  /** Runtime events are operational state only—never model deliberation. */
  traces?: Array<{ at: number; state: string; event: string; stepId?: string; toolId?: string; errorCode?: string }>;
  approval?: { stepId: string; toolId: string };
  error?: { message: string };
  updatedAt?: number;
};

const TERMINAL = new Set(["COMPLETED", "FAILED", "CANCELLED"]);

const HOME = /^\/Users\/[^/]+|^\/home\/[^/]+/;
const COMMAND = /^(?:cat|ls|cd|npm|npx|pnpm|yarn|node|tsx|git|python3?|pip3?|curl|wget|grep|rg|echo|mkdir|rm|mv|cp|touch|head|tail|sed|awk|make|cargo|go|tsc|vite|bash|sh|zsh|brew|docker|open)\b/;

/** Turns the runtime's raw step text into a readable row: paths become file rows, shell commands become command rows. */
function describeStep(step: MissionStatusStep): Pick<ActivityStep, "label" | "detail" | "kind"> {
  const text = step.description.trim();
  if (/^(?:~|\.{0,2})?\/[^\s]+$/.test(text)) {
    const clean = text.replace(/\/+$/, "");
    const name = clean.split("/").pop() || clean;
    const dir = clean.slice(0, clean.length - name.length).replace(/\/$/, "").replace(HOME, "~");
    return { label: name, detail: dir && dir !== "~" ? dir : undefined, kind: "file" };
  }
  if (COMMAND.test(text)) {
    return { label: step.status === "running" ? `Running ${text}` : `Ran ${text}`, kind: "coding" };
  }
  return { label: text };
}

/** Consecutive identical operations (create then edit of one file) read as one row. */
function collapseSteps(steps: ActivityStep[]): ActivityStep[] {
  const out: Array<ActivityStep & { count: number }> = [];
  for (const step of steps) {
    const last = out[out.length - 1];
    if (last && last.kind === "file" && last.label === step.label && last.detail === step.detail) {
      last.count += 1;
      last.state = step.state === "running" || last.state === "running" ? "running" : step.state === "failed" ? "failed" : step.state;
      continue;
    }
    out.push({ ...step, count: 1 });
  }
  return out.map(({ count, ...step }) => (count > 1 ? { ...step, detail: [step.detail, `${count} changes`].filter(Boolean).join(" · ") } : step));
}

function stepState(status: MissionStatusStep["status"]): ActivityStep["state"] {
  if (status === "completed") return "done";
  if (status === "failed" || status === "cancelled") return "failed";
  if (status === "running") return "running";
  return "queued";
}

/** Task progress in the assistant's own language: one shimmering status line while
 * work runs, real steps underneath, quiet text controls, and a collapsed record
 * once it ends. It renders only persisted mission state. */
export function MissionStatusCard({
  mission,
  onResume,
  onPause,
  onStop,
  onApprove,
}: {
  mission: MissionStatus;
  onResume?: (mission: MissionStatus) => Promise<void>;
  onPause?: (mission: MissionStatus) => Promise<void>;
  onStop?: (mission: MissionStatus) => Promise<void>;
  onApprove?: (mission: MissionStatus) => Promise<void>;
}) {
  const [control, setControl] = useState<"resume" | "pause" | "stop" | "approve" | null>(null);
  const steps: ActivityStep[] = collapseSteps(mission.plan.steps.map((step) => ({ id: step.id, ...describeStep(step), state: stepState(step.status) })));
  const agents = mission.agents || [];
  const terminal = TERMINAL.has(mission.state);
  const resumable = ["PAUSED", "RECOVERING", "READY", "EXECUTING", "OBSERVING", "VERIFYING", "REPLANNING"].includes(mission.state);
  const pausable = ["UNDERSTANDING", "PLANNING", "READY", "EXECUTING", "OBSERVING", "VERIFYING", "REPLANNING", "RECOVERING"].includes(mission.state);
  const approval = mission.state === "WAITING_FOR_APPROVAL" && mission.approval;
  const waitingForUser = mission.state === "WAITING_FOR_USER";
  const paused = mission.state === "PAUSED";

  const run = (kind: NonNullable<typeof control>, action?: (mission: MissionStatus) => Promise<void>) => {
    if (!action) return;
    setControl(kind);
    void action(mission).finally(() => setControl(null));
  };

  if (terminal) {
    const done = steps.filter((step) => step.state === "done").length;
    const label = mission.state === "COMPLETED"
      ? `Completed ${done} of ${steps.length} step${steps.length === 1 ? "" : "s"}`
      : mission.state === "CANCELLED" ? "Stopped" : "Needs attention";
    return (
      <div className="clyra-ai-mission" aria-label="Task activity">
        <WorkSummary label={label} steps={steps} />
        {mission.state === "FAILED" && mission.error?.message ? <p className="clyra-ai-note">{mission.error.message}</p> : null}
      </div>
    );
  }

  const running = mission.plan.steps.find((step) => step.status === "running");
  const statusLabel = approval ? "Waiting for your approval"
    : waitingForUser ? "Waiting for you"
    : paused ? "Paused"
    : running?.description || "Working";
  const live = !approval && !waitingForUser && !paused;

  return (
    <div className="clyra-ai-mission clyra-ai-status" aria-label="Task activity">
      <StatusLine label={statusLabel} shimmer={live} />
      <ActivitySteps steps={steps} />
      {agents.length > 1 ? (
        <p className="clyra-ai-status__detail">
          {agents.filter((agent) => agent.status === "completed").length} of {agents.length} agents finished
        </p>
      ) : null}
      <div className="clyra-ai-controls">
        {approval && onApprove ? (
          <button type="button" className="clyra-ai-control clyra-ai-control--primary" disabled={control !== null} onClick={() => run("approve", onApprove)}>
            Approve and continue
          </button>
        ) : null}
        {!approval && (paused || resumable) && !live && onResume ? (
          <button type="button" className="clyra-ai-control clyra-ai-control--primary" disabled={control !== null} onClick={() => run("resume", onResume)}>
            Resume
          </button>
        ) : null}
        {live && pausable && onPause ? (
          <button type="button" className="clyra-ai-control" disabled={control !== null} onClick={() => run("pause", onPause)}>
            Pause
          </button>
        ) : null}
        {onStop ? (
          <button type="button" className="clyra-ai-control" disabled={control !== null} onClick={() => run("stop", onStop)}>
            Stop
          </button>
        ) : null}
      </div>
    </div>
  );
}
