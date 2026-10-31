import * as ProgressPrimitive from "@radix-ui/react-progress";
import { motion, useReducedMotion } from "motion/react";

/**
 * The lightweight launch bar. Only `transform` and `opacity` are animated —
 * the fill slides via `translateX` and the wrapper only ever scales/fades — so
 * the whole intro composites on the GPU and never forces layout or repaint
 * while the app preloads underneath. The fill eases in and out so it starts
 * and stops softly rather than snapping between preload ticks.
 */

const EASE = [0.22, 1, 0.36, 1] as const;

interface ClyraStartupLoaderProps {
  /** Controlled progress, `0`–`100`. */
  progress: number;
  /** When true, play the collapse + fade-out exit animation. */
  exiting?: boolean;
  /** Fires once the exit animation has fully completed. */
  onExited?: () => void;
}

export function ClyraStartupLoader({
  progress,
  exiting = false,
  onExited,
}: ClyraStartupLoaderProps) {
  const reduced = !!useReducedMotion();
  const clamped = Number.isFinite(progress)
    ? Math.min(100, Math.max(0, progress))
    : 0;

  return (
    <motion.div
      className="clyra-startup-loader"
      initial={reduced ? { opacity: 1 } : { opacity: 0, scale: 0.94, y: 10 }}
      animate={
        exiting
          ? { opacity: 0, scale: 1.04, y: -10 }
          : { opacity: 1, scale: 1, y: 0 }
      }
      transition={
        exiting
          ? { duration: 0.42, ease: EASE }
          : { duration: 0.6, ease: EASE }
      }
      onAnimationComplete={() => {
        if (exiting) onExited?.();
      }}
    >
      <ProgressPrimitive.Root
        className="clyra-startup-progress"
        value={clamped}
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(clamped)}
        aria-valuetext={`${Math.round(clamped)}%`}
        aria-label="Starting Clyra"
      >
        <ProgressPrimitive.Indicator
          className="clyra-startup-progress__indicator"
          style={{ transform: `translateX(-${100 - clamped}%)` }}
        >
          {!reduced && (
            <span className="clyra-startup-progress__tip" aria-hidden="true" />
          )}
        </ProgressPrimitive.Indicator>
      </ProgressPrimitive.Root>
    </motion.div>
  );
}

export default ClyraStartupLoader;
