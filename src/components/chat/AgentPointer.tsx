import type { CSSProperties } from "react";
import { motion } from "motion/react";
import "./assistant/agent-actions.css";

/** A tailless pointer bound to confirmed AI control coordinates. */
export function AgentPointer({ x, y, kind, id }: { x: number; y: number; kind?: string; id: number }) {
  const press = kind === "click" || kind === "double_click" || kind === "right_click";
  return (
    <motion.div
      className="clyra-pointer"
      initial={false}
      animate={{ left: x, top: y }}
      transition={{ type: "spring", stiffness: 430, damping: 38, mass: 0.38, restDelta: 0.1 }}
      aria-hidden
    >
      <span className="clyra-pointer__halo" />
      <span key={`core-${id}`} className={`clyra-pointer__core${press ? " is-press" : ""}`} />
      {press ? <span key={`wave-${id}`} className="clyra-pointer__wave" aria-hidden>
        <i className="clyra-pointer__flash" />
        {[0, 1].map((n) => <i key={n} className="clyra-pointer__ripple" style={{ "--n": n } as CSSProperties} />)}
      </span> : null}
    </motion.div>
  );
}
