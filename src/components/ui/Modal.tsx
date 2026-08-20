import * as React from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { X } from "lucide-react";
import { cn } from "../../lib/utils";
import { IconButton } from "./Button";
import { SPRING_PANEL, EASE_SPRING, DURATION_FAST } from "../../lib/motion";

export type ModalProps = {
  open: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  children: React.ReactNode;
  /** "dialog" centers a panel; "sheet" slides in from the right edge (detail views, settings). */
  variant?: "dialog" | "sheet";
  width?: number;
  footer?: React.ReactNode;
};

/**
 * Universal overlay surface for the Tool Library (and anything else that
 * needs a dialog/sheet) — same backdrop, corner radius, close affordance and
 * motion as the rest of Clyra's floating chrome instead of a one-off modal.
 */
export function Modal({ open, onClose, title, subtitle, children, variant = "dialog", width = 480, footer }: ModalProps) {
  const reduceMotion = useReducedMotion();
  const isSheet = variant === "sheet";

  React.useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          className={cn("fixed inset-0 z-[400] flex", isSheet ? "items-stretch justify-end" : "items-center justify-center p-4")}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: DURATION_FAST }}
        >
          <motion.div
            className="absolute inset-0 bg-[var(--clyra-color-label)]/25"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            initial={isSheet ? { opacity: 0, x: 24 } : { opacity: 0, scale: 0.97, y: 10 }}
            animate={isSheet ? { opacity: 1, x: 0 } : { opacity: 1, scale: 1, y: 0 }}
            exit={isSheet ? { opacity: 0, x: 16, transition: { duration: DURATION_FAST } } : { opacity: 0, scale: 0.98, y: 6, transition: { duration: DURATION_FAST } }}
            transition={reduceMotion ? { duration: 0.01 } : isSheet ? SPRING_PANEL : { duration: 0.32, ease: EASE_SPRING }}
            style={{ width: isSheet ? Math.min(width, window.innerWidth - 32) : undefined, maxWidth: isSheet ? undefined : `min(${width}px, calc(100vw - 32px))` }}
            className={cn(
              "glass-surface--strong relative flex max-h-[86vh] flex-col overflow-hidden",
              isSheet ? "my-2 mr-2 rounded-[var(--clyra-radius-xl)]" : "w-full rounded-[var(--clyra-radius-xl)]",
            )}
          >
            {title ? (
              <div className="flex shrink-0 items-start justify-between gap-3 border-b border-[var(--clyra-color-border)] px-5 py-4">
                <div className="min-w-0">
                  <h2 className="truncate text-[15px] font-semibold text-[var(--clyra-color-label)]">{title}</h2>
                  {subtitle ? <p className="mt-0.5 truncate text-[12.5px] text-[var(--clyra-color-label-secondary)]">{subtitle}</p> : null}
                </div>
                <IconButton aria-label="Close" size="sm" onClick={onClose}>
                  <X className="h-4 w-4" />
                </IconButton>
              </div>
            ) : null}
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
            {footer ? <div className="flex shrink-0 items-center justify-end gap-2 border-t border-[var(--clyra-color-border)] px-5 py-3">{footer}</div> : null}
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
