import * as React from "react";
import { cn } from "../../lib/utils";

export type CardProps = React.HTMLAttributes<HTMLDivElement> & {
  /** Content cards (tool cards, list rows) use a flat surface + hairline border, not the glass material — glass is reserved for chrome (Section 3.1 in index.css). */
  interactive?: boolean;
};

/** Universal content card. Base for tool cards, detail panels, and any bordered content block. */
export const Card = React.forwardRef<HTMLDivElement, CardProps>(
  ({ className, interactive, children, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        "rounded-[var(--clyra-radius-lg)] border border-[var(--clyra-color-border)] bg-[var(--clyra-color-surface)] transition-[border-color,box-shadow,transform] duration-150",
        interactive &&
          "cursor-pointer hover:border-[var(--clyra-color-border-strong)] hover:shadow-[var(--clyra-shadow-popover)] active:scale-[0.99]",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  ),
);
Card.displayName = "Card";

export const CardHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => <div ref={ref} className={cn("flex items-start justify-between gap-3 p-4 pb-2.5", className)} {...props} />,
);
CardHeader.displayName = "CardHeader";

export const CardBody = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => <div ref={ref} className={cn("px-4 pb-2.5", className)} {...props} />,
);
CardBody.displayName = "CardBody";

export const CardFooter = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("flex items-center gap-2 border-t border-[var(--clyra-color-border)] p-3", className)} {...props} />
  ),
);
CardFooter.displayName = "CardFooter";
