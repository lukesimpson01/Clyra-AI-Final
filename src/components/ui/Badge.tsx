import * as React from "react";
import { cn } from "../../lib/utils";

export type BadgeTone = "neutral" | "accent" | "success" | "warning" | "danger";

const TONE_CLASS: Record<BadgeTone, string> = {
  neutral: "bg-[var(--clyra-color-surface-muted)] text-[var(--clyra-color-label-secondary)]",
  accent: "bg-[var(--clyra-color-accent-soft)] text-[var(--clyra-color-accent)]",
  success: "bg-[var(--clyra-color-success-soft)] text-[var(--clyra-color-success)]",
  warning: "bg-[var(--clyra-color-warning-soft)] text-[var(--clyra-color-warning)]",
  danger: "bg-[var(--clyra-color-danger-soft)] text-[var(--clyra-color-danger)]",
};

export type BadgeProps = React.HTMLAttributes<HTMLSpanElement> & {
  tone?: BadgeTone;
  icon?: React.ReactNode;
};

/** Small pill label — category tags, permission scopes, "Installed" status. */
export const Badge = React.forwardRef<HTMLSpanElement, BadgeProps>(
  ({ className, tone = "neutral", icon, children, ...props }, ref) => (
    <span
      ref={ref}
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-[var(--clyra-radius-pill)] px-2 py-0.5 text-[11px] font-medium leading-[1.6]",
        TONE_CLASS[tone],
        className,
      )}
      {...props}
    >
      {icon}
      {children}
    </span>
  ),
);
Badge.displayName = "Badge";
