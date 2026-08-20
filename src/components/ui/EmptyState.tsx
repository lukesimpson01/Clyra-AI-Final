import * as React from "react";
import { cn } from "../../lib/utils";

export type EmptyStateProps = {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
};

/** Universal empty state — no results, nothing installed yet, no permissions granted, etc. */
export function EmptyState({ icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-1 px-6 py-16 text-center", className)}>
      {icon ? (
        <div className="mb-2 grid h-11 w-11 place-items-center rounded-full bg-[var(--clyra-color-surface-muted)] text-[var(--clyra-color-label-tertiary)]">
          {icon}
        </div>
      ) : null}
      <p className="text-[14px] font-medium text-[var(--clyra-color-label)]">{title}</p>
      {description ? <p className="max-w-[320px] text-[12.5px] leading-[1.5] text-[var(--clyra-color-label-secondary)]">{description}</p> : null}
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  );
}
