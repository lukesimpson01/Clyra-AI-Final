/**
 * The agent's plan, in the Codex style: a small, quiet checklist that follows the agent's own todo_write events.
 *
 * Folded it is one line ("Plan · Step 2 / 5"); open it is a hairline card with a circle per step — thin when waiting,
 * a turning ring while in progress, a check when done, a "!" when blocked. The counts come from the real statuses
 * (see activityModel), so it never says "5 / 5" unless all five are confirmed done.
 */
import { memo, useId, useState } from "react";
import { ChevronRight, ListTodo } from "lucide-react";
import { cn } from "../../lib/utils";
import { planProgress, stepDisplay, type PlanRow, type PlanStatus } from "./activityModel";

function Glyph({ status }: { status: PlanStatus | "paused" }) {
  const common = { width: 16, height: 16, viewBox: "0 0 16 16", fill: "none", "aria-hidden": true } as const;
  if (status === "completed") {
    return (
      <svg {...common} className="pl-glyph pl-glyph--done">
        <circle cx="8" cy="8" r="6.4" stroke="currentColor" strokeWidth="1.3" />
        <path className="pl-tick" d="M5.2 8.2l2 2 3.6-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (status === "in_progress") {
    return (
      <svg {...common} className="pl-glyph pl-glyph--active">
        <circle cx="8" cy="8" r="6.4" stroke="currentColor" strokeOpacity=".2" strokeWidth="1.5" />
        <path className="pl-ring" d="M8 1.6a6.4 6.4 0 0 1 6.4 6.4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    );
  }
  if (status === "paused") {
    return (
      <svg {...common} className="pl-glyph pl-glyph--paused">
        <circle cx="8" cy="8" r="6.4" stroke="currentColor" strokeWidth="1.3" />
        <path d="M8 1.6a6.4 6.4 0 0 1 6.4 6.4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    );
  }
  if (status === "blocked") {
    return (
      <svg {...common} className="pl-glyph pl-glyph--blocked">
        <circle cx="8" cy="8" r="6.4" stroke="currentColor" strokeWidth="1.3" />
        <path d="M8 4.8v3.8M8 11.1v.1" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    );
  }
  if (status === "cancelled") {
    return (
      <svg {...common} className="pl-glyph pl-glyph--cancelled">
        <circle cx="8" cy="8" r="6.4" stroke="currentColor" strokeWidth="1.3" strokeDasharray="2 2" />
        <path d="M5.6 8h4.8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <svg {...common} className="pl-glyph pl-glyph--pending">
      <circle cx="8" cy="8" r="6.4" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  );
}

export const PlanCard = memo(function PlanCard({
  plan,
  live,
  variant = "dock",
  className,
}: {
  plan: readonly PlanRow[] | null | undefined;
  /** The agent is working right now: an in-progress step turns, and "Step N / M" is allowed. */
  live: boolean;
  variant?: "dock" | "panel";
  className?: string;
}) {
  const id = useId();
  const rows = plan ?? [];
  const progress = planProgress(rows, live);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  if (!rows.length) return null;

  /* In the dock it rests folded to one line and opens while the pointer or keyboard focus is on it. */
  const open = variant === "panel" ? true : hovered || focused;

  const list = (
    <ul className="pl-list" id={`${id}-list`}>
      {rows.map((row, index) => {
        const shown = stepDisplay(row.status, live);
        return (
          <li key={`${index}-${row.content}`} className="pl-step" data-status={shown}>
            <span className="pl-mark"><Glyph status={shown} /></span>
            <span className="pl-text">{row.content}</span>
          </li>
        );
      })}
    </ul>
  );

  if (variant === "panel") {
    return (
      <section className={cn("pl pl--panel", className)} aria-label="Plan">
        <header className="pl-head"><span className="pl-title">Plan</span><span className="pl-count">{progress.label}</span></header>
        {list}
      </section>
    );
  }

  return (
    <section
      className={cn("pl", className)}
      data-open={open || undefined}
      aria-label="Plan"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false); }}
    >
      <button type="button" className="pl-toggle" aria-expanded={open} aria-controls={`${id}-list`} onClick={() => setHovered((v) => !v)}>
        <ListTodo className="pl-icon" strokeWidth={1.75} aria-hidden />
        <span className="pl-title">Plan</span>
        <span className="pl-count" aria-live="polite">{open ? progress.label : progress.summary.replace(/^Plan · /, "")}</span>
        <ChevronRight className="pl-chevron" data-open={open || undefined} strokeWidth={1.8} aria-hidden />
      </button>
      <div className="pl-fold" data-open={open || undefined}>
        <div className="pl-fold-inner">{list}</div>
      </div>
    </section>
  );
});
