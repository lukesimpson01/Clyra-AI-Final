import { AnimatePresence, motion } from "motion/react";
import { WifiOff } from "lucide-react";
import type { ConnectivityStatus } from "../hooks/useConnectivity";
import { AI_EASE, StatusLine } from "./chat/assistant";

/**
 * The next row after the last message while the app is offline, drawn with the
 * same status line as live assistant work so it reads as part of the thread.
 */
export function ConnectivityIndicator({ status }: { status: ConnectivityStatus }) {
  return (
    <AnimatePresence>
      {status === "offline" ? (
        <motion.div
          key="connectivity-indicator"
          className="clyra-turn"
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 3, transition: { duration: 0.14, ease: AI_EASE } }}
          transition={{ duration: 0.2, ease: AI_EASE }}
        >
          <div className="clyra-assistant-column">
            <StatusLine label="Reconnecting…" icon={<WifiOff />} />
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
