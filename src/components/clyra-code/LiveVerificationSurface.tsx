import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { AgentCursor } from "../vibe-coder/preview/AgentCursor";
import type { ClyraCodeState } from "./store";

/**
 * Mirrors screenshots from the REAL shared Clyra Chromium browser while the
 * agent verifies the generated project. The pointer never invents a path:
 * coordinates are emitted by the browser as it actually moves/clicks.
 */
export function LiveVerificationSurface({
  verification,
}: {
  verification: NonNullable<ClyraCodeState["verification"]>;
}) {
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const [bounds, setBounds] = useState({ width: 1, height: 1 });
  const [frame, setFrame] = useState(0);
  const [frameLoaded, setFrameLoaded] = useState(false);
  const [browser, setBrowser] = useState<{
    cursor?: { x: number; y: number; kind?: string; at?: number };
    viewport?: { width: number; height: number };
    url?: string;
  } | null>(null);

  useEffect(() => {
    const node = surfaceRef.current;
    if (!node) return;
    const update = () => setBounds({
      width: Math.max(1, node.clientWidth),
      height: Math.max(1, node.clientHeight),
    });
    const observer = new ResizeObserver(update);
    observer.observe(node);
    update();
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let mounted = true;
    const update = async () => {
      try {
        const response = await fetch("/api/openbrowser/state", { cache: "no-store" });
        if (!response.ok) return;
        const body = await response.json() as {
          state?: {
            url?: string;
            cursor?: { x: number; y: number; kind?: string; at?: number };
            viewport?: { width: number; height: number };
          };
        };
        if (mounted && body.state) setBrowser(body.state);
      } catch { /* Keep last confirmed browser state during a short reconnect. */ }
    };
    void update();
    const interval = window.setInterval(() => {
      setFrame(Date.now());
      void update();
    }, 700);
    return () => {
      mounted = false;
      window.clearInterval(interval);
    };
  }, []);

  const viewport = browser?.viewport ?? verification.viewport;
  const width = Math.max(1, viewport?.width ?? 1440);
  const height = Math.max(1, viewport?.height ?? 900);
  const scale = Math.min(bounds.width / width, bounds.height / height);
  const left = (bounds.width - width * scale) / 2;
  const top = (bounds.height - height * scale) / 2;
  const cursor = browser?.cursor ?? verification.cursor;
  const fresh = Boolean(cursor && Date.now() - Number(cursor.at ?? 0) < 1800);
  const safePosition = fresh && cursor &&
    Number.isFinite(cursor.x) && Number.isFinite(cursor.y) &&
    cursor.x >= 0 && cursor.y >= 0 && cursor.x <= width && cursor.y <= height;

  return (
    <motion.div
      ref={surfaceRef}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.26 }}
      className="pointer-events-none absolute inset-0 z-[35] overflow-hidden bg-white"
      aria-label="Live AI browser testing the generated application"
    >
      <img
        src={"/api/openbrowser/frame?fresh=1&verification=" + frame}
        alt="Actual managed browser view during verification"
        className="absolute bg-white"
        style={{ left, top, width: width * scale, height: height * scale }}
        onLoad={() => setFrameLoaded(true)}
        onError={() => setFrameLoaded(false)}
      />
      {frameLoaded && safePosition && cursor ? (
        <AgentCursor
          x={left + cursor.x * scale}
          y={top + cursor.y * scale}
          isClicking={cursor.kind === "click" || cursor.kind === "double_click" || cursor.kind === "right_click"}
          isActive
        />
      ) : null}
      <AnimatePresence mode="wait">
        <motion.div
          key={verification.message}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.18 }}
          className="absolute bottom-3 left-1/2 z-[60] flex max-w-[94%] -translate-x-1/2 items-center gap-2 rounded-full bg-white/95 px-3 py-2 text-[11.5px] font-medium text-[#333941] shadow-[0_2px_18px_rgba(30,40,56,0.13)]"
        >
          <span className="h-[6px] w-[6px] shrink-0 animate-pulse rounded-full bg-[#1E6FFF]" />
          <span className="truncate">{verification.message}</span>
        </motion.div>
      </AnimatePresence>
    </motion.div>
  );
}
