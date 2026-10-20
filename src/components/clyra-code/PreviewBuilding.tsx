import { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ShiningText } from "../ShiningText";
import { AGENT_EASE } from "./motion";

/*
 * The preview pane while a project is being built: a small page assembles itself block by block, traced by a
 * glowing pen, then a light sweep passes over it and it rebuilds. Only transform and opacity change (on CSS
 * transitions), so it stays smooth while the agent and dev server are busy.
 */

type Block = { x: number; y: number; w: number; h: number; tone: string };

// Page-space coordinates for a 280 × 172 page: nav, hero (two headline lines, copy, buttons, art) and three cards.
const BLOCKS: Block[] = [
  { x: 14, y: 12, w: 14, h: 14, tone: "logo" },
  { x: 146, y: 17, w: 20, h: 4, tone: "link" },
  { x: 172, y: 17, w: 20, h: 4, tone: "link" },
  { x: 198, y: 17, w: 20, h: 4, tone: "link" },
  { x: 230, y: 12, w: 36, h: 14, tone: "button" },
  { x: 14, y: 44, w: 166, h: 10, tone: "heading" },
  { x: 14, y: 59, w: 118, h: 10, tone: "heading" },
  { x: 14, y: 77, w: 150, h: 5, tone: "copy" },
  { x: 14, y: 86, w: 108, h: 5, tone: "copy" },
  { x: 14, y: 99, w: 54, h: 16, tone: "cta" },
  { x: 74, y: 99, w: 46, h: 16, tone: "ghost" },
  { x: 192, y: 44, w: 74, h: 71, tone: "art" },
  { x: 14, y: 126, w: 78, h: 34, tone: "card" },
  { x: 101, y: 126, w: 78, h: 34, tone: "card" },
  { x: 188, y: 126, w: 78, h: 34, tone: "card" },
];

const STEP_MS = 170;
const HOLD_MS = 1500;
const CLEAR_MS = 420;

export function PreviewBuilding({ phase, step }: { phase: "starting" | "building"; step?: string | null }) {
  const reduced = useReducedMotion();
  const [built, setBuilt] = useState(reduced ? BLOCKS.length : 0);
  const [clearing, setClearing] = useState(false);

  useEffect(() => {
    if (reduced) { setBuilt(BLOCKS.length); return; }
    let timer = 0;
    if (clearing) {
      timer = window.setTimeout(() => { setBuilt(0); setClearing(false); }, CLEAR_MS);
    } else if (built < BLOCKS.length) {
      timer = window.setTimeout(() => setBuilt((count) => count + 1), built === 0 ? 260 : STEP_MS);
    } else {
      timer = window.setTimeout(() => setClearing(true), HOLD_MS);
    }
    return () => window.clearTimeout(timer);
  }, [built, clearing, reduced]);

  const pen = BLOCKS[Math.max(0, Math.min(built, BLOCKS.length) - 1)];
  const drawing = !reduced && !clearing && built > 0 && built < BLOCKS.length;
  const title = phase === "starting" ? "Starting live preview…" : "Building your project…";
  const detail = step || (phase === "starting" ? "Preparing the development server" : "The preview appears when files are ready");

  return (
    <div className="cc-pb" role="status" aria-live="polite" aria-label={title}>
      <div className="cc-pb-grid" aria-hidden />
      <div className="cc-pb-stage" aria-hidden>
        <div className="cc-pb-glow" />
        <div className="cc-pb-window" data-done={built >= BLOCKS.length && !clearing ? "" : undefined}>
          <div className="cc-pb-chrome">
            <i /><i /><i />
            <span className="cc-pb-address" />
          </div>
          <div className="cc-pb-page" data-clearing={clearing ? "" : undefined}>
            {BLOCKS.map((block, index) => (
              <span
                key={index}
                className="cc-pb-block"
                data-tone={block.tone}
                data-on={index < built ? "" : undefined}
                style={{ left: block.x, top: block.y, width: block.w, height: block.h }}
              />
            ))}
            <span
              className="cc-pb-pen"
              data-on={drawing ? "" : undefined}
              style={{ transform: `translate3d(${pen.x + pen.w}px, ${pen.y + pen.h / 2}px, 0)` }}
            />
          </div>
          <span className="cc-pb-sweep" />
        </div>
      </div>
      <div className="cc-pb-copy">
        <ShiningText text={title} play={!reduced} duration={2} className="text-[13px] font-medium tracking-[-0.01em]" />
        <div className="cc-pb-step">
          <AnimatePresence mode="wait" initial={false}>
            <motion.p
              key={detail}
              initial={reduced ? false : { opacity: 0, y: 3 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -3 }}
              transition={{ duration: 0.22, ease: AGENT_EASE }}
              className="truncate"
            >
              {detail}
            </motion.p>
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
