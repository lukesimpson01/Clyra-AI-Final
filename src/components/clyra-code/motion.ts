/**
 * Shared motion language for the Clyra agent transcript.
 *
 * One controlled easing everywhere: actions slot into the development log
 * from the left, layout reflow glides instead of snapping, and expanding
 * bodies use measured height so text never stretches.
 */

export const AGENT_EASE = [0.22, 1, 0.36, 1] as const;

/** Reflow of surrounding rows when an action expands or collapses. */
export const LAYOUT_TRANSITION = {
  layout: { duration: 0.28, ease: AGENT_EASE },
} as const;

/** Every agent action settles into the transcript with almost no travel. */
export const ROW_ENTER = {
  initial: { opacity: 0, y: 2 },
  animate: { opacity: 1, y: 0 },
  transition: {
    opacity: { duration: 0.16, ease: AGENT_EASE },
    y: { duration: 0.15, ease: AGENT_EASE },
  },
} as const;

/** Soft vertical fade for results and assistant prose. */
export const SUBTLE_ENTER = {
  initial: { opacity: 0, y: 3 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.18, ease: AGENT_EASE },
} as const;

/** Measured height open/close for diff bodies and details. */
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

type EnterSpec = {
  initial: Record<string, number>;
  animate: Record<string, number>;
  transition: Record<string, unknown>;
};

/**
 * Entrance props for a transcript row.
 *
 * Always keep `animate` mounted and vary only `initial`. Swapping the whole
 * prop set — passing `{}` for rows that should not animate — leaves a live
 * component with no animation target, so it keeps whatever style `initial`
 * put there. That is how streamed assistant prose ended up permanently at
 * `opacity: 0` while still occupying its full height: the row was mounted
 * with the fade-in props, and the "is this still fresh?" condition flipped to
 * false a few seconds later and took `animate` away mid-life. The result was
 * a tall blank gap in the middle of the conversation.
 *
 * `initial: false` tells Motion to start at the animate values, which is the
 * correct way to express "this row is historical, do not replay it".
 */
export function enterProps(spec: EnterSpec, animate: boolean) {
  return {
    initial: animate ? spec.initial : false,
    animate: spec.animate,
    transition: spec.transition,
  } as const;
}
