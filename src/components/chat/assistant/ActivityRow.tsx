import type { ReactNode } from "react";
import { CircleAlert, Check } from "lucide-react";
import { ShimmerText } from "./Shimmer";

export type ActivityState = "queued" | "running" | "done" | "failed";

/**
 * One line of real work, 14px. Only the running step shimmers; a finished step is still. A failure says so in
 * words and with its own (monochrome) icon — never a coloured card.
 */
export function ActivityRow({
  icon,
  label,
  meta,
  counts,
  title,
  state,
}: {
  icon?: ReactNode;
  label: ReactNode;
  meta?: string;
  /** additions and deletions, shown as "+24 −8" */
  counts?: { added: number; removed: number };
  /** the full text (a long path) when the label is shortened */
  title?: string;
  state: ActivityState;
}) {
  const mark =
    state === "failed" ? <CircleAlert />
    : icon ?? (state === "done" ? <Check /> : state === "running" ? <span className="clyra-ai-row__pulse" /> : <span className="clyra-ai-row__dot" />);
  return (
    <li className={`clyra-ai-row clyra-ai-row--${state}`} title={title}>
      <span className="clyra-ai-row__icon" aria-hidden>{mark}</span>
      <span className="clyra-ai-row__label">{state === "running" ? <ShimmerText>{label}</ShimmerText> : label}</span>
      {counts ? <span className="clyra-ai-row__counts">+{counts.added} −{counts.removed}</span> : null}
      {meta ? <span className="clyra-ai-row__meta">{meta}</span> : null}
    </li>
  );
}
