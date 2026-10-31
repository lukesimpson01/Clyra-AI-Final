import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ArrowDown } from "lucide-react";
import { AI_EASE } from "./motion";

/** Shown while the reader is above the newest content: white, a hairline, 10px radius. */
export function JumpToLatest({ visible, onJump }: { visible: boolean; onJump: () => void }) {
  const reduced = useReducedMotion();
  return (
    <AnimatePresence>
      {visible ? (
        <div className="clyra-ai-jump-anchor" key="anchor">
          <motion.button
            type="button"
            className="clyra-ai-jump"
            aria-label="Jump to latest message"
            initial={reduced ? false : { opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0, transition: { duration: reduced ? 0 : 0.16, ease: AI_EASE } }}
            exit={{ opacity: 0, y: 2, transition: { duration: reduced ? 0 : 0.12, ease: AI_EASE } }}
            onPointerDown={(event) => { event.preventDefault(); event.stopPropagation(); onJump(); }}
            onClick={(event) => { if (event.detail !== 0) return; event.preventDefault(); onJump(); }}
          >
            Jump to latest <ArrowDown aria-hidden />
          </motion.button>
        </div>
      ) : null}
    </AnimatePresence>
  );
}
