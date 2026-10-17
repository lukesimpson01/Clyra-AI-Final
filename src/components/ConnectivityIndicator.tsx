import { AnimatePresence, motion } from "motion/react";
import type { ConnectivityStatus } from "../hooks/useConnectivity";

/**
 * Rendered as the next row in the message list, right after the last
 * message — the same DOM position and wrapper markup a real "thinking" row
 * uses (`.clyra-assistant-message` / `.clyra-thinking-status`), so it reads
 * as part of the conversation rather than a floating toast.
 */
export function ConnectivityIndicator({ status }: { status: ConnectivityStatus }) {
  const isOffline = status === "offline";

  return (
    <AnimatePresence>
      {isOffline ? (
        <motion.div
          key="connectivity-indicator"
          role="status"
          aria-live="polite"
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 4, transition: { duration: 0.18, ease: [0.16, 1, 0.3, 1] } }}
          transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
          className="w-full flex items-start gap-3"
        >
          <div className="clyra-assistant-message">
            <div
              className="clyra-thinking-status flex flex-wrap items-center gap-2"
              style={{ animation: "clyraThinkIn .55s cubic-bezier(.32,.72,0,1) both" }}
            >
              <div className="clyra-thinking-status__line">
                <span style={{ display: "flex", alignItems: "center", color: "#9DA1A9", flexShrink: 0 }} aria-hidden>
                  <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round">
                    <path d="M2.5 8.8a15.3 15.3 0 0 1 19 0M5.6 12.4a10.8 10.8 0 0 1 12.8 0M8.8 16a6.3 6.3 0 0 1 6.4 0" />
                    <path d="M3 3l18 18" strokeLinecap="round" />
                  </svg>
                </span>
                <span className="clyra-thinking-wave clyra-thinking-wave--shimmer min-w-0 truncate">Reconnecting…</span>
              </div>
            </div>
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
