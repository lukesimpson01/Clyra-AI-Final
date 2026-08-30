import { forwardRef } from "react";
import type { ButtonHTMLAttributes } from "react";
import { cn } from "../../lib/utils";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg" | "icon";

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary:
    "bg-[var(--clyra-accent)] text-white hover:brightness-110 disabled:bg-[var(--clyra-surface-muted)] disabled:text-[var(--clyra-text-disabled)]",
  secondary:
    "bg-[var(--clyra-surface)] text-[var(--clyra-text)] border border-[var(--clyra-border)] hover:bg-[var(--clyra-hover)] disabled:text-[var(--clyra-text-disabled)]",
  ghost:
    "bg-transparent text-[var(--clyra-text-secondary)] hover:bg-[var(--clyra-hover)] hover:text-[var(--clyra-text)] disabled:text-[var(--clyra-text-disabled)]",
  danger:
    "bg-transparent text-[var(--clyra-danger)] hover:bg-[var(--clyra-danger)]/[0.08] disabled:text-[var(--clyra-text-disabled)]",
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: "h-7 px-2.5 text-[12px] gap-1.5 rounded-[var(--clyra-radius-sm)]",
  md: "h-8 px-3 text-[13px] gap-1.5 rounded-[var(--clyra-radius-md)]",
  lg: "h-9 px-4 text-[13.5px] gap-2 rounded-[var(--clyra-radius-md)]",
  icon: "h-8 w-8 rounded-[var(--clyra-radius-sm)]",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

/** Token-driven button primitive. One place to change every button's
 * radius/color/focus behavior across Clyra instead of per-component hex. */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant = "secondary", size = "md", type = "button", ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(
        "inline-flex items-center justify-center font-medium transition-colors duration-150",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--clyra-focus-ring)]",
        "disabled:cursor-not-allowed disabled:opacity-70",
        "active:scale-[0.97]",
        VARIANT_CLASSES[variant],
        SIZE_CLASSES[size],
        className,
      )}
      {...props}
    />
  );
});

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  "aria-label": string;
  active?: boolean;
}

/** Icon-only button — always requires an aria-label since there's no visible text. */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { className, active = false, type = "button", ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(
        "inline-flex h-7 w-7 items-center justify-center rounded-[var(--clyra-radius-sm)] transition-colors duration-150",
        "text-[var(--clyra-text-tertiary)] hover:bg-[var(--clyra-hover)] hover:text-[var(--clyra-text)]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--clyra-focus-ring)]",
        "disabled:cursor-not-allowed disabled:opacity-50",
        "active:scale-[0.94]",
        active && "bg-[var(--clyra-selected)] text-[var(--clyra-accent)]",
        className,
      )}
      {...props}
    />
  );
});
