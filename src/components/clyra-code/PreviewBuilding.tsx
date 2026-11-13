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

// Every cycle keeps the same DOM nodes and morphs their geometry into a
// genuinely different page. Do not clear/restart the fake page between cycles.
const LAYOUTS: readonly Block[][] = [
  BLOCKS,
  [ // Analytics dashboard: compact navigation, metrics, data panels
    { x: 14, y: 12, w: 14, h: 14, tone: "logo" },
    { x: 42, y: 17, w: 24, h: 4, tone: "link" },
    { x: 75, y: 17, w: 25, h: 4, tone: "link" },
    { x: 108, y: 17, w: 24, h: 4, tone: "link" },
    { x: 228, y: 12, w: 38, h: 14, tone: "button" },
    { x: 14, y: 42, w: 95, h: 9, tone: "heading" },
    { x: 14, y: 57, w: 68, h: 5, tone: "copy" },
    { x: 14, y: 79, w: 76, h: 40, tone: "card" },
    { x: 100, y: 79, w: 77, h: 40, tone: "card" },
    { x: 187, y: 79, w: 79, h: 40, tone: "card" },
    { x: 14, y: 132, w: 76, h: 28, tone: "card" },
    { x: 100, y: 132, w: 77, h: 28, tone: "card" },
    { x: 187, y: 132, w: 79, h: 28, tone: "card" },
    { x: 180, y: 42, w: 86, h: 21, tone: "art" },
    { x: 114, y: 57, w: 48, h: 6, tone: "copy" },
  ],
  [ // Document editor: toolbar, text canvas, contextual inspector
    { x: 14, y: 12, w: 14, h: 14, tone: "logo" },
    { x: 42, y: 17, w: 16, h: 4, tone: "link" },
    { x: 65, y: 17, w: 16, h: 4, tone: "link" },
    { x: 88, y: 17, w: 22, h: 4, tone: "link" },
    { x: 227, y: 12, w: 39, h: 14, tone: "button" },
    { x: 28, y: 44, w: 112, h: 10, tone: "heading" },
    { x: 28, y: 62, w: 154, h: 5, tone: "copy" },
    { x: 28, y: 76, w: 144, h: 5, tone: "copy" },
    { x: 28, y: 90, w: 157, h: 5, tone: "copy" },
    { x: 28, y: 104, w: 120, h: 5, tone: "copy" },
    { x: 28, y: 122, w: 61, h: 15, tone: "cta" },
    { x: 99, y: 122, w: 61, h: 15, tone: "ghost" },
    { x: 204, y: 44, w: 62, h: 42, tone: "art" },
    { x: 204, y: 99, w: 62, h: 61, tone: "card" },
    { x: 28, y: 149, w: 141, h: 5, tone: "copy" },
  ],
  [ // Product storefront: editorial hero and a four-product shelf
    { x: 14, y: 12, w: 14, h: 14, tone: "logo" },
    { x: 84, y: 17, w: 23, h: 4, tone: "link" },
    { x: 119, y: 17, w: 23, h: 4, tone: "link" },
    { x: 154, y: 17, w: 23, h: 4, tone: "link" },
    { x: 226, y: 12, w: 40, h: 14, tone: "button" },
    { x: 14, y: 40, w: 118, h: 10, tone: "heading" },
    { x: 14, y: 56, w: 83, h: 5, tone: "copy" },
    { x: 14, y: 75, w: 58, h: 13, tone: "cta" },
    { x: 80, y: 75, w: 52, h: 13, tone: "ghost" },
    { x: 153, y: 40, w: 113, h: 49, tone: "art" },
    { x: 14, y: 104, w: 54, h: 56, tone: "card" },
    { x: 80, y: 104, w: 54, h: 56, tone: "card" },
    { x: 146, y: 104, w: 54, h: 56, tone: "card" },
    { x: 212, y: 104, w: 54, h: 56, tone: "card" },
    { x: 14, y: 64, w: 94, h: 5, tone: "copy" },
  ],
];

const STEP_MS = 170;
const HOLD_MS = 2350;

export function PreviewBuilding({ phase, step }: { phase: "starting" | "building"; step?: string | null }) {
  const reduced = useReducedMotion();
  const [built, setBuilt] = useState(reduced ? BLOCKS.length : 0);
  const [layoutIndex, setLayoutIndex] = useState(0);

  useEffect(() => {
    if (reduced) { setBuilt(BLOCKS.length); return; }
    const timer = built < BLOCKS.length
      ? window.setTimeout(() => setBuilt((count) => count + 1), built === 0 ? 260 : STEP_MS)
      : window.setTimeout(() => {
          // Restart the drawing strokes on EVERY layout. Previously built was
          // stuck at the final count, so the animation stopped after one cycle.
          setBuilt(0);
          setLayoutIndex((index) => (index + 1) % LAYOUTS.length);
        }, HOLD_MS);
    return () => window.clearTimeout(timer);
  }, [built, layoutIndex, reduced]);

  const blocks = LAYOUTS[layoutIndex];
  const pen = blocks[Math.max(0, Math.min(built, blocks.length) - 1)];
  const drawing = !reduced && built > 0 && built < blocks.length;
  const title = phase === "starting" ? "Starting live preview…" : "Building your project…";
  const detail = step || (phase === "starting" ? "Preparing the development server" : "The preview appears when files are ready");

  return (
    <div className="cc-pb" role="status" aria-live="polite" aria-label={title}>
      <div className="cc-pb-grid" aria-hidden />
      <div className="cc-pb-stage" aria-hidden>
        <div className="cc-pb-glow" />
        <div className="cc-pb-window" data-done={built >= BLOCKS.length ? "" : undefined}>
          <div className="cc-pb-chrome">
            <i /><i /><i />
            <span className="cc-pb-address" />
          </div>
          <div className="cc-pb-page">
            {blocks.map((block, index) => (
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
