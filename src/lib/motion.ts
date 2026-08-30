/**
 * Shared Clyra motion tokens — one controlled easing for the whole shell
 * instead of ad hoc durations/easings per component. Originated in the
 * Clyra Code agent transcript (src/components/clyra-code/motion.ts, which
 * now re-exports from here); promoted so any surface can reuse the same
 * physical, quick, non-bouncy feel.
 */

export const AGENT_EASE = [0.22, 1, 0.36, 1] as const;

/** Reflow of surrounding rows when an element expands or collapses. */
export const LAYOUT_TRANSITION = {
  layout: { duration: 0.28, ease: AGENT_EASE },
} as const;

/** Default entrance for a new row/item settling into a list. */
export const ROW_ENTER = {
  initial: { opacity: 0, y: 2 },
  animate: { opacity: 1, y: 0 },
  transition: {
    opacity: { duration: 0.18, ease: AGENT_EASE },
    y: { duration: 0.18, ease: AGENT_EASE },
  },
} as const;

/** Soft vertical fade for results and prose. */
export const SUBTLE_ENTER = {
  initial: { opacity: 0, y: 3 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.18, ease: AGENT_EASE },
} as const;

/** Measured height open/close for disclosure panels and diff bodies. */
export const HEIGHT_OPEN = {
  initial: { height: 0, opacity: 0 },
  animate: { height: "auto", opacity: 1 },
  exit: { height: 0, opacity: 0 },
  transition: {
    height: { duration: 0.3, ease: AGENT_EASE },
    opacity: { duration: 0.18, delay: 0.05 },
  },
} as const;

/** Crossfade for labels morphing in place (Running → Ran, Editing → Edited). */
export const LABEL_MORPH = {
  initial: { opacity: 0, y: 2 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -2 },
  transition: { duration: 0.16, ease: AGENT_EASE },
} as const;

/** Popover/menu entrance — small scale + lift, used across dropdowns. */
export const POPOVER_ENTER = {
  initial: { opacity: 0, y: 4, scale: 0.98 },
  animate: { opacity: 1, y: 0, scale: 1 },
  exit: { opacity: 0, y: 3, scale: 0.98 },
  transition: { duration: 0.16, ease: AGENT_EASE },
} as const;
