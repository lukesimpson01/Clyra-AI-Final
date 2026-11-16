import { AnimatePresence, motion } from "framer-motion";

/**
 * While an agent drives or tests a live preview: the same blue gradient edge, status chip and control dock as computer use.
 * The glow fades in over ~380 ms and out over ~300 ms; the dock has Stop (and Pause when the caller can pause).
 */
export function AgentControlOverlay({
  isActive,
  label = "AI control active",
  onStop,
  onPause,
  paused = false,
}: {
  isActive: boolean;
  label?: string;
  onStop?: () => void;
  onPause?: () => void;
  paused?: boolean;
}) {
  return (
    <AnimatePresence>
      {isActive && (
        <motion.div
          key="agent-control"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.38, ease: [0.32, 0.72, 0, 1] }}
          className="pointer-events-none absolute inset-0 z-40 overflow-hidden rounded-[inherit]"
          aria-live="polite"
        >
          <div className="clyra-agent-glow" aria-hidden />
          <motion.div
            initial={{ opacity: 0, y: 10, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 6, scale: 0.985, transition: { duration: 0.24 } }}
            transition={{ type: "spring", stiffness: 380, damping: 34 }}
            className="clyra-agent-dock pointer-events-auto"
          >
            <span className="clyra-agent-dock__dot" aria-hidden />
            <span className="clyra-agent-dock__label">{paused ? "Paused" : label}</span>
            {onPause ? (
              <button type="button" className="clyra-agent-dock__btn" onClick={onPause} aria-label={paused ? "Resume" : "Pause"} title={paused ? "Resume" : "Pause"}>
                {paused
                  ? <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor" aria-hidden><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z" /></svg>
                  : <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor" aria-hidden><rect x="6.5" y="5" width="4" height="14" rx="1.3" /><rect x="13.5" y="5" width="4" height="14" rx="1.3" /></svg>}
              </button>
            ) : null}
            {onStop ? (
              <button type="button" className="clyra-agent-dock__btn is-stop" onClick={onStop} aria-label="Stop" title="Stop and take control back">
                <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor" aria-hidden><rect x="6" y="6" width="12" height="12" rx="2.5" /></svg>
              </button>
            ) : null}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
