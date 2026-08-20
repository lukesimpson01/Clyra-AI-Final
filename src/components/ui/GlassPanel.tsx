import * as React from "react";
import { cn } from "../../lib/utils";

type GlassPanelProps = React.HTMLAttributes<HTMLDivElement> & {
  /** Use the more opaque variant for the primary floating control in a view
   * (Section 3.1: "the most important floating control... sits visually
   * closest"). Secondary/receding chrome should leave this false. */
  strong?: boolean;
};

/**
 * Liquid-Glass chrome surface (Platform-Wide UI/UX Overhaul, Section 3.1).
 * Depth comes from translucency + blur, not a hard border or drop shadow -
 * use for sidebars, composer bars, floating pills, toolbars, and modals.
 * Content surfaces (cards holding page content, not chrome) should keep
 * using --color-surface directly instead of this.
 */
export const GlassPanel = React.forwardRef<HTMLDivElement, GlassPanelProps>(
  ({ className, strong, children, ...props }, ref) => (
    <div ref={ref} className={cn("glass-surface", strong && "glass-surface--strong", className)} {...props}>
      {children}
    </div>
  ),
);
GlassPanel.displayName = "GlassPanel";
