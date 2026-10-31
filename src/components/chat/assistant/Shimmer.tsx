import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { AI_DURATION, AI_EASE } from "./motion";

/** Text with the moving highlight. Mount it only while the work it names is really running. */
export function ShimmerText({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <span className={`clyra-ai-shimmer ${className}`.trim()}>{children}</span>;
}

/**
 * The live status line ("Thinking", "Searching the web"…). Without an icon of its own it leads with the breathing
 * orb. When a real event changes the status the old label lifts away (120ms) and the new one rises in (240ms);
 * the row itself never moves.
 */
export function StatusLine({
  label,
  icon,
  shimmer = true,
}: {
  label: string;
  icon?: React.ReactNode;
  shimmer?: boolean;
}) {
  const reduced = useReducedMotion();
  const isThinking = label === "Thinking";
  return (
    <div className="clyra-ai-status__line" role="status" aria-live="polite">
      {icon ? <span className="clyra-ai-status__icon" aria-hidden>{icon}</span> : <span className="clyra-ai-orb" aria-hidden />}
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={label}
          className="clyra-ai-status__label"
          initial={reduced ? false : { opacity: 0, y: 5 }}
          animate={{ opacity: 1, y: 0, transition: { duration: reduced ? 0 : AI_DURATION.statusIn, ease: AI_EASE } }}
          exit={reduced ? undefined : { opacity: 0, y: -4, transition: { duration: AI_DURATION.statusOut, ease: [0.4, 0, 1, 1] } }}
        >
          {shimmer ? <ShimmerText>{label}</ShimmerText> : label}
          {isThinking ? (
            <span className="clyra-ai-status__dots" aria-hidden>
              <i />
              <i />
              <i />
            </span>
          ) : null}
        </motion.span>
      </AnimatePresence>
    </div>
  );
}
