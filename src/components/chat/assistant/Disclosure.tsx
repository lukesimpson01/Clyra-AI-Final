import { useId, useState, type ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ChevronDown } from "lucide-react";
import { AI_DURATION, AI_EASE } from "./motion";

/**
 * A compact disclosure row ("Searched 6 sources ⌄"): 32px, transparent, a hover veil. Opening grows to the
 * content's height and fades it in 3px down (220ms); closing collapses both (180ms), and what is below moves with
 * it. Collapsed content is unmounted, so nothing hidden can take keyboard focus.
 */
export function ActivityDisclosure({
  icon,
  leading,
  label,
  meta,
  defaultOpen = false,
  className = "",
  children,
}: {
  icon?: ReactNode;
  /** In place of the 16px icon, e.g. a group of source favicons. */
  leading?: ReactNode;
  label: ReactNode;
  /** Right-aligned detail before the chevron ("+24 −8"). */
  meta?: ReactNode;
  defaultOpen?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const contentId = useId();
  const reduced = useReducedMotion();
  return (
    <section className={`clyra-ai-disclosure ${className}`.trim()}>
      <button
        type="button"
        className="clyra-ai-disclosure__trigger"
        aria-expanded={open}
        aria-controls={open ? contentId : undefined}
        onClick={() => setOpen((value) => !value)}
      >
        {leading ? <span className="clyra-ai-disclosure__leading">{leading}</span> : icon ? <span className="clyra-ai-disclosure__icon" aria-hidden>{icon}</span> : null}
        <span className="clyra-ai-disclosure__label">{label}</span>
        {meta ? <span className="clyra-ai-disclosure__meta">{meta}</span> : null}
        <motion.span
          className="clyra-ai-disclosure__chevron"
          aria-hidden
          animate={{ rotate: open ? 180 : 0 }}
          transition={{ duration: reduced ? 0 : AI_DURATION.chevron, ease: AI_EASE }}
        >
          <ChevronDown size={14} />
        </motion.span>
      </button>
      <AnimatePresence initial={false}>
        {open ? (
          <motion.div
            id={contentId}
            key="content"
            style={{ overflow: "hidden" }}
            initial={reduced ? false : { height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1, transition: { duration: reduced ? 0 : AI_DURATION.disclosureOpen, ease: AI_EASE } }}
            exit={{ height: 0, opacity: 0, transition: { duration: reduced ? 0 : AI_DURATION.disclosureClose, ease: AI_EASE } }}
          >
            <motion.div
              className="clyra-ai-disclosure__content"
              initial={reduced ? false : { y: -3 }}
              animate={{ y: 0 }}
              transition={{ duration: reduced ? 0 : AI_DURATION.disclosureOpen, ease: AI_EASE }}
            >
              {children}
            </motion.div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </section>
  );
}
