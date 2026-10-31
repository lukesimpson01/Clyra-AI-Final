import { useState, type ReactNode } from "react";
import { motion, useReducedMotion } from "motion/react";
import { AI_DURATION, AI_EASE } from "./motion";

/**
 * The assistant's reply body. It enters once — fading in as it rises 6px over 320ms — and only when the reply
 * really arrived while this view was open: a conversation reopened from storage mounts finished and never replays.
 * While it streams, a block that appears later settles in via CSS (.clyra-ai-response--live); blocks already on
 * screen are never remounted, so they never move again.
 */
export function AssistantResponse({
  enter,
  streaming,
  plain = false,
  error = false,
  children,
}: {
  enter: boolean;
  streaming: boolean;
  plain?: boolean;
  error?: boolean;
  children: ReactNode;
}) {
  const [enterOnMount] = useState(enter);
  const reduced = useReducedMotion();
  const className = [
    "clyra-ai-response clyra-assistant-prose",
    streaming && "clyra-ai-response--live",
    plain && "clyra-ai-response--plain",
    error && "clyra-ai-response--error",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <motion.article
      className={className}
      data-invert-ignore
      initial={enterOnMount && !reduced ? { opacity: 0, y: 6 } : false}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: reduced ? 0 : AI_DURATION.response, ease: AI_EASE }}
    >
      {children}
    </motion.article>
  );
}
