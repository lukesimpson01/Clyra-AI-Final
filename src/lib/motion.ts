/**
 * Universal motion language (Platform-Wide UI/UX Overhaul, Section 3.5).
 *
 * One shared set of spring/easing presets consumed by every surface - Chat,
 * Clyra Code, Forge, the browser workspace - so a "thinking" pulse, a panel
 * opening, or a button press feels identical no matter which tool it's in.
 * `src/components/clyra-code/motion.ts` predates this file and keeps its own
 * narrower AGENT_EASE export for its existing call sites; new/migrated code
 * should prefer the presets here.
 */

/** Snappy, small-settle spring for buttons, toggles, chips, in-place controls. */
export const SPRING_INTERACTIVE = { type: "spring", stiffness: 300, damping: 30, mass: 1 } as const;

/** Softer, more-travel spring for panels, sidebars, sheets, larger surfaces. */
export const SPRING_PANEL = { type: "spring", stiffness: 200, damping: 25, mass: 1 } as const;

/**
 * Apple's actual spring vocabulary (WWDC18 "Designing Fluid Interfaces"):
 * damping ratio (1.0 = critically damped, no bounce; <1.0 overshoots) and
 * response (seconds to reach the target - not a fixed duration, the settle
 * time emerges from the physics). Motion's `bounce`/`duration` spring API
 * maps directly onto this, so these are the two families to reach for
 * instead of hand-tuning stiffness/damping/mass:
 *
 *   animate(el, { y: 0 }, SPRING_CRITICAL)   // menus, fades, most UI
 *   animate(el, { y: target }, SPRING_MOMENTUM) // only after a flick/drag
 */
export const SPRING_CRITICAL = { type: "spring", bounce: 0, duration: 0.4 } as const;
export const SPRING_MOMENTUM = { type: "spring", bounce: 0.2, duration: 0.4 } as const;
/** Apple's shipped drawer/sheet spring - a little more bounce, a touch snappier. */
export const SPRING_SHEET = { type: "spring", bounce: 0.15, duration: 0.3 } as const;
/** Apple's shipped rotation spring - the bounciest of the three named presets. */
export const SPRING_ROTATION = { type: "spring", bounce: 0.35, duration: 0.4 } as const;

/**
 * Converts a release velocity (px/s) into the spring's expected initial
 * velocity for a given remaining distance, for spring APIs that want a
 * distance-relative value rather than raw px/s (Section 5, velocity handoff).
 * Motion's own `velocity` option takes raw px/s directly - use this only
 * when an API explicitly wants the normalized form.
 */
export function relativeVelocity(gestureVelocityPxPerSec: number, current: number, target: number): number {
  const distance = target - current;
  if (Math.abs(distance) < 0.001) return 0;
  return gestureVelocityPxPerSec / distance;
}

/**
 * Projects where a flick/drag would naturally come to rest, the same
 * exponential-decay math as scroll deceleration (Section 6) - not the
 * textbook v^2/(2*decel) formula. Use the result to choose the nearest
 * snap point, then hand off the real release velocity to the spring so the
 * animation continues at the exact speed the gesture was moving.
 */
export function projectMomentum(releaseVelocityPxPerSec: number, decelerationRate = 0.998): number {
  return (releaseVelocityPxPerSec / 1000) * decelerationRate / (1 - decelerationRate);
}

/**
 * Progressive resistance at a drag boundary instead of a hard stop
 * (Section 9). `overshoot` is how far past the boundary the raw gesture
 * would go; returns how far it should actually move.
 */
export function rubberband(overshoot: number, dimension: number, constant = 0.55): number {
  return (overshoot * dimension * constant) / (dimension + constant * Math.abs(overshoot));
}

/** CSS cubic-bezier fallback for stacks/properties that can't run a JS spring. */
export const EASE_SPRING = [0.32, 0.72, 0, 1] as const;

export const DURATION_FAST = 0.18;
export const DURATION_BASE = 0.28;
export const DURATION_SLOW = 0.4;

/** Press feedback stand-in for haptics - scale down on press, spring back on release. */
export const PRESS_TAP = { scale: 0.97 } as const;
export const PRESS_TRANSITION = SPRING_INTERACTIVE;

/** Row/list item entrance - fade + slight upward slide, meant to be staggered. */
export const LIST_ITEM_ENTER = {
  initial: { opacity: 0, y: 6 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: DURATION_FAST, ease: EASE_SPRING },
} as const;

/** Stagger delay per index for a list using LIST_ITEM_ENTER. */
export function listStagger(index: number, step = 0.035, cap = 0.28) {
  return { transition: { delay: Math.min(index * step, cap) } };
}

/** Panel/sheet open+close - use with SPRING_PANEL for the width/height transition. */
export const PANEL_ENTER_EXIT = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
} as const;

/** Measured height open/close for disclosure rows and expandable detail. */
export const DISCLOSURE_OPEN = {
  initial: { height: 0, opacity: 0 },
  animate: { height: "auto", opacity: 1 },
  exit: { height: 0, opacity: 0 },
  transition: {
    height: { duration: DURATION_BASE, ease: EASE_SPRING },
    opacity: { duration: DURATION_FAST, delay: 0.05 },
  },
} as const;

/** True when the user has requested reduced motion - gate springs behind this. */
export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** True when translucent glass surfaces should go frostier/solid instead. */
export function prefersReducedTransparency(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-reduced-transparency: reduce)").matches;
}

/** Returns a plain-fade transition instead of a spring when motion is reduced. */
export function motionSafe<T extends { transition?: unknown }>(config: T, reducedMotion: boolean): T {
  if (!reducedMotion) return config;
  return { ...config, transition: { duration: 0.01 } };
}
