import { cn } from "../../lib/utils";

export type AgentStepStatus = "queued" | "running" | "done" | "failed";

const STATUS_CLASS: Record<AgentStepStatus, string> = {
  queued: "bg-[var(--clyra-color-label-tertiary)]",
  running: "bg-[var(--clyra-color-accent)] animate-pulse",
  done: "bg-[var(--clyra-color-success)]",
  failed: "bg-[var(--clyra-color-danger)]",
};

const STATUS_LABEL: Record<AgentStepStatus, string> = {
  queued: "Queued",
  running: "Running",
  done: "Done",
  failed: "Failed",
};

/**
 * Shared status indicator (Section 3.6) for any queued/running/done/failed
 * step - tool-call rows in Clyra Code, browser agent-reasoning rows, and
 * Forge's future harness steps all render this same dot so the meaning of
 * each state is visually identical regardless of which surface it's in.
 */
export function StatusDot({ status, className }: { status: AgentStepStatus; className?: string }) {
  return (
    <span
      role="img"
      aria-label={STATUS_LABEL[status]}
      title={STATUS_LABEL[status]}
      className={cn("inline-block h-[7px] w-[7px] shrink-0 rounded-full", STATUS_CLASS[status], className)}
    />
  );
}
