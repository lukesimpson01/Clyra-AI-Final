import { cn } from "../../lib/utils";

/**
 * Shared `+N -M` diff-stat indicator (Section 3.6). Used anywhere a file
 * edit is summarized - Clyra Code's tool-call rows today, Forge's future
 * scene/behavior-script edits and the browser's file-download diffs later -
 * so the same visual vocabulary for "how much changed" appears everywhere.
 */
export function DiffStatChip({ added, removed, className }: { added: number; removed: number; className?: string }) {
  if (!added && !removed) return null;
  return (
    <span className={cn("inline-flex shrink-0 items-center gap-1 text-[11px] font-medium tabular-nums", className)}>
      {added > 0 ? <span className="text-[var(--clyra-color-success)]">+{added}</span> : null}
      {removed > 0 ? <span className="text-[var(--clyra-color-danger)]">-{removed}</span> : null}
    </span>
  );
}
