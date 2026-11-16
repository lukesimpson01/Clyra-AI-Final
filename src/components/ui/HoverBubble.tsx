import { motion, useReducedMotion } from "motion/react";
import { useEffect, useState, type RefObject } from "react";

type Box = { x: number; y: number; w: number; h: number; radius: number };

/**
 * One soft grey bubble that glides between the rows of a list as the pointer moves, the same motion as the
 * workspace tab switcher. Put it inside a `position: relative` container and pass that container's ref and a
 * selector for the hoverable rows; the rows keep their own click handling and lose their per-row hover fill.
 */
export function HoverBubble({ containerRef, selector, color = "rgba(16, 18, 24, 0.06)" }: { containerRef: RefObject<HTMLElement | null>; selector: string; color?: string }) {
  const reduced = useReducedMotion();
  const [box, setBox] = useState<Box | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const measure = (target: Element) => {
      const rect = target.getBoundingClientRect();
      const base = container.getBoundingClientRect();
      const radius = parseFloat(getComputedStyle(target).borderTopLeftRadius) || 10;
      setBox({ x: rect.left - base.left + container.scrollLeft, y: rect.top - base.top + container.scrollTop, w: rect.width, h: rect.height, radius });
    };
    const over = (event: MouseEvent) => {
      const row = (event.target as Element | null)?.closest?.(selector);
      if (row && container.contains(row)) measure(row);
      else setBox(null);
    };
    const leave = () => setBox(null);
    container.addEventListener("mouseover", over);
    container.addEventListener("mouseleave", leave);
    container.addEventListener("scroll", leave, { passive: true });
    return () => {
      container.removeEventListener("mouseover", over);
      container.removeEventListener("mouseleave", leave);
      container.removeEventListener("scroll", leave);
    };
  }, [containerRef, selector]);

  return (
    <motion.span
      aria-hidden
      className="clyra-hover-bubble"
      initial={false}
      animate={box ? { opacity: 1, x: box.x, y: box.y, width: box.w, height: box.h, borderRadius: box.radius } : { opacity: 0 }}
      transition={reduced ? { duration: 0.01 } : { type: "spring", stiffness: 540, damping: 44, mass: 0.7, opacity: { duration: 0.14 } }}
      style={{ position: "absolute", left: 0, top: 0, pointerEvents: "none", zIndex: 0, background: color }}
    />
  );
}
