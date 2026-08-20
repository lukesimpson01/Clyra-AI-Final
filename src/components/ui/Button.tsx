import * as React from "react";
import { Loader2 } from "lucide-react";
import { cn } from "../../lib/utils";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary: "bg-[var(--clyra-color-accent)] text-white hover:opacity-90",
  secondary:
    "bg-[var(--clyra-color-surface)] text-[var(--clyra-color-label)] border border-[var(--clyra-color-border)] hover:bg-[var(--clyra-color-surface-muted)]",
  ghost: "text-[var(--clyra-color-label-secondary)] hover:bg-[var(--clyra-color-surface-muted)] hover:text-[var(--clyra-color-label)]",
  danger: "bg-[var(--clyra-color-danger-soft)] text-[var(--clyra-color-danger)] hover:opacity-80",
};

const SIZE_CLASS: Record<ButtonSize, string> = {
  sm: "h-7 gap-1 rounded-[var(--clyra-radius-sm)] px-2.5 text-[12px]",
  md: "h-9 gap-1.5 rounded-[var(--clyra-radius-md)] px-3.5 text-[13px]",
  lg: "h-10 gap-2 rounded-[var(--clyra-radius-md)] px-4 text-[14px]",
};

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: React.ReactNode;
  fullWidth?: boolean;
};

/** Universal button — every surface (Tool Library included) should render actions through this instead of one-off styled buttons. */
export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "secondary", size = "md", loading, icon, fullWidth, disabled, children, ...props }, ref) => (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cn(
        "inline-flex shrink-0 items-center justify-center whitespace-nowrap font-medium transition-[background-color,color,opacity,transform] duration-150 active:scale-[var(--clyra-press-scale)] disabled:pointer-events-none disabled:opacity-45",
        VARIANT_CLASS[variant],
        SIZE_CLASS[size],
        fullWidth && "w-full",
        className,
      )}
      {...props}
    >
      {loading ? <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" /> : icon}
      {children ? <span className="truncate">{children}</span> : null}
    </button>
  ),
);
Button.displayName = "Button";

/** Icon-only square button (overflow triggers, close buttons, card affordances). */
export const IconButton = React.forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement> & { size?: ButtonSize; variant?: ButtonVariant; "aria-label": string }
>(({ className, variant = "ghost", size = "md", disabled, children, ...props }, ref) => {
  const dim = size === "sm" ? "h-7 w-7" : size === "lg" ? "h-10 w-10" : "h-8 w-8";
  return (
    <button
      ref={ref}
      disabled={disabled}
      className={cn(
        "grid shrink-0 place-items-center rounded-full transition-[background-color,color,opacity,transform] duration-150 active:scale-[var(--clyra-press-scale)] disabled:pointer-events-none disabled:opacity-45",
        VARIANT_CLASS[variant],
        dim,
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
});
IconButton.displayName = "IconButton";
