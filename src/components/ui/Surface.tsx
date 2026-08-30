import { forwardRef } from "react";
import type { HTMLAttributes } from "react";
import { cn } from "../../lib/utils";

export type SurfaceElevation = "flat" | "raised" | "floating" | "inspector" | "sidebar";

const ELEVATION_CLASSES: Record<SurfaceElevation, string> = {
  flat: "bg-[var(--clyra-canvas)]",
  raised: "bg-[var(--clyra-surface)] border border-[var(--clyra-border)]",
  floating: "bg-[var(--clyra-floating)] border border-[var(--clyra-border)] shadow-[var(--clyra-shadow-elevated)]",
  inspector: "bg-[var(--clyra-inspector)] border-l border-[var(--clyra-border)]",
  sidebar: "bg-[var(--clyra-sidebar)] border-r border-[var(--clyra-border)]",
};

export interface SurfaceProps extends HTMLAttributes<HTMLDivElement> {
  elevation?: SurfaceElevation;
  radius?: "sm" | "md" | "lg" | "xl" | "none";
}

const RADIUS_CLASSES: Record<NonNullable<SurfaceProps["radius"]>, string> = {
  none: "",
  sm: "rounded-[var(--clyra-radius-sm)]",
  md: "rounded-[var(--clyra-radius-md)]",
  lg: "rounded-[var(--clyra-radius-lg)]",
  xl: "rounded-[var(--clyra-radius-xl)]",
};

/** Shared surface primitive — every "card"/panel in Clyra should pick one of
 * these five elevation roles instead of inventing its own background/border. */
export const Surface = forwardRef<HTMLDivElement, SurfaceProps>(function Surface(
  { className, elevation = "raised", radius = "lg", ...props },
  ref,
) {
  return (
    <div
      ref={ref}
      className={cn(ELEVATION_CLASSES[elevation], RADIUS_CLASSES[radius], className)}
      {...props}
    />
  );
});
