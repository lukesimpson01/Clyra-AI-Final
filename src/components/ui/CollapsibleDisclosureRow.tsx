import { useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ChevronDown } from "lucide-react";
import { cn } from "../../lib/utils";
import { DISCLOSURE_OPEN, prefersReducedMotion } from "../../lib/motion";
import { StatusDot, type AgentStepStatus } from "./StatusDot";

export type DisclosureRowProps = {
  /** Leading icon - pencil for a file edit, globe for a web search, terminal
   * for a command, etc. Callers own the icon choice per action type. */
  icon?: ReactNode;
  /** Short description, e.g. "Edited ChunkManager.ts". */
  label: ReactNode;
  /** Optional filename/target rendered inline in a code style. */
  target?: string;
  status?: AgentStepStatus;
  /** Trailing content before the chevron - typically a DiffStatChip. */
  trailing?: ReactNode;
  /** Expanded body - a diff view, a tool-call transcript, reasoning text.
   * Kept fully generic (a pluggable renderer, not a fixed shape) so Clyra
   * Code's tool-call log, the browser's agent-reasoning rows, and Forge's
   * harness steps can all use this one component for different content. */
  children?: ReactNode;
  defaultOpen?: boolean;
  className?: string;
};

/**
 * Shared expandable "reasoning/action" row (Section 3.6/4). One component
 * renders both the coding agent's tool-call batches and the browser's
 * agent-reasoning steps - same iconography, same expand/collapse behavior,
 * same typography, wherever it's used.
 */
export function CollapsibleDisclosureRow({
  icon,
  label,
  target,
  status,
  trailing,
  children,
  defaultOpen = false,
  className,
}: DisclosureRowProps) {
  const [open, setOpen] = useState(defaultOpen);
  const reducedMotion = prefersReducedMotion();
  const canExpand = Boolean(children);

  return (
    <div className={cn("clyra-disclosure-row", className)}>
      <button
        type="button"
        onClick={() => canExpand && setOpen((value) => !value)}
        aria-expanded={canExpand ? open : undefined}
        disabled={!canExpand}
        className={cn(
          "flex min-h-[28px] w-full items-center gap-2 rounded-[var(--clyra-radius-sm)] px-1.5 py-1 text-left text-[13px] transition-colors duration-150",
          canExpand && "hover:bg-[var(--clyra-color-surface-muted)]",
        )}
      >
        {status ? <StatusDot status={status} /> : null}
        {icon ? <span className="grid h-4 w-4 shrink-0 place-items-center text-[var(--clyra-color-label-tertiary)]">{icon}</span> : null}
        <span className="min-w-0 flex-1 truncate text-[var(--clyra-color-label-secondary)]">
          {label}
          {target ? (
            <>
              {" "}
              <code className="rounded-[4px] bg-[var(--clyra-color-surface-muted)] px-1 py-0.5 text-[12px] text-[var(--clyra-color-label)]">
                {target}
              </code>
            </>
          ) : null}
        </span>
        {trailing}
        {canExpand ? (
          <ChevronDown
            className={cn("h-3.5 w-3.5 shrink-0 text-[var(--clyra-color-label-tertiary)] transition-transform duration-200", open && "rotate-180")}
            style={{ transitionTimingFunction: "var(--clyra-ease-spring)" }}
          />
        ) : null}
      </button>
      <AnimatePresence initial={false}>
        {open && canExpand ? (
          <motion.div
            {...(reducedMotion ? { transition: { duration: 0.01 } } : DISCLOSURE_OPEN)}
            className="overflow-hidden pl-6"
          >
            <div className="py-1.5">{children}</div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
