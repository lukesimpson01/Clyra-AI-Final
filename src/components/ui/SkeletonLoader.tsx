import { cn } from "../../lib/utils";

/**
 * Shared shimmer placeholder (Section 3.5) - shaped like the content it will
 * become, not a generic spinner, wherever the eventual layout is predictable
 * (a list row, a card, a paragraph). Respects prefers-reduced-motion via the
 * `clyra-skeleton` keyframes' own media guard in index.css.
 */
export function SkeletonLoader({ className }: { className?: string }) {
  return <div className={cn("clyra-skeleton rounded-[var(--clyra-radius-sm)] bg-[var(--clyra-color-surface-muted)]", className)} />;
}

/** A row of skeletons shaped like a typical list item (icon + two lines). */
export function SkeletonListRow({ className }: { className?: string }) {
  return (
    <div className={cn("flex items-center gap-2.5 px-2 py-2", className)}>
      <SkeletonLoader className="h-7 w-7 shrink-0 !rounded-full" />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <SkeletonLoader className="h-3 w-3/5" />
        <SkeletonLoader className="h-2.5 w-2/5" />
      </div>
    </div>
  );
}
