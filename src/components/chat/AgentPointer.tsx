import type { CSSProperties } from "react";
import { motion } from "motion/react";
import "./assistant/agent-actions.css";
import "./tool-agent.css";

/** The Clyra agent's pointer, positioned in the pixels of the window it is drawn over, with the same glide, press and ripple as in the browser run. */
export function AgentPointer({ x, y, kind, id }: { x: number; y: number; kind?: string; id: number }) {
  const press = kind === "click" || kind === "double_click";
  return (
    <motion.div
      className="clyra-pointer"
      initial={false}
      animate={{ left: x, top: y }}
      transition={{ type: "spring", stiffness: 240, damping: 28, mass: 0.6 }}
      aria-hidden
    >
      <span className="clyra-pointer__halo" />
      <svg className={`clyra-pointer__arrow${press ? " is-press" : ""}`} key={`a${id}`} viewBox="0 0 24 24"><path d="M5 3v17l4.7-4.7 3 6.4 3-1.5-3.1-6.2 6.8-.7L5 3z" /></svg>
      {press ? <span key={`w${id}`} className="clyra-pointer__wave" aria-hidden><i className="clyra-pointer__flash" />{[0, 1, 2, 3, 4].map((n) => <i key={n} className="clyra-pointer__ripple" style={{ "--n": n } as CSSProperties} />)}</span> : null}
    </motion.div>
  );
}
