import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { motion, useReducedMotion } from "motion/react";
import { beamDurationSeconds, roundedRectPerimeter } from "./beamGeometry";

type BoxSize = { width: number; height: number };

/**
 * A rounded-rect stroke moving at a fixed number of on-screen pixels per
 * second. Unlike a spinning conic gradient, a single SVG dash follows the
 * perimeter linearly on both long straight edges and short curved corners.
 * All measures and animations are compositor-friendly; no per-frame JS.
 */
export function PerimeterBeam({
  active,
  children,
  className = "",
  radius = 22,
}: {
  active: boolean;
  children: ReactNode;
  className?: string;
  radius?: number;
}) {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState<BoxSize>({ width: 0, height: 0 });
  const reduceMotion = useReducedMotion();

  useLayoutEffect(() => {
    const node = wrapperRef.current;
    if (!node) return;
    const update = () => {
      const bounds = node.getBoundingClientRect();
      const width = Math.round(bounds.width * 10) / 10;
      const height = Math.round(bounds.height * 10) / 10;
      if (width <= 0 || height <= 0) return;
      setSize((old) => old.width === width && old.height === height ? old : { width, height });
    };
    update();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", update, { passive: true });
      return () => window.removeEventListener("resize", update);
    }
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const width = Math.max(0, size.width - 2.4);
  const height = Math.max(0, size.height - 2.4);
  const pxRadius = Math.max(0, Math.min(radius - 1.2, width / 2, height / 2));
  const perimeter = roundedRectPerimeter(width, height, pxRadius);
  const dash = Math.min(84, perimeter * 0.16);
  const duration = beamDurationSeconds(perimeter);
  const drawBeam = active && width > 60 && height > 40 && perimeter > dash;

  return (
    <div ref={wrapperRef} className={`relative mx-auto w-full ${className}`}>
      {children}
      {drawBeam ? (
        <svg className="pointer-events-none absolute inset-0 z-[5] h-full w-full overflow-visible"
          viewBox={`0 0 ${size.width} ${size.height}`}
          preserveAspectRatio="none" aria-hidden="true" focusable="false">
          <rect x={1.2} y={1.2} width={width} height={height} rx={pxRadius}
            fill="none" stroke="#3977F6" strokeWidth={1.15} opacity={0.12} />
          {reduceMotion ? (
            <rect x={1.2} y={1.2} width={width} height={height} rx={pxRadius}
              fill="none" stroke="#3977F6" strokeWidth={1.6} opacity={0.55} />
          ) : (
            <>
              <motion.rect key={`trail-${width}-${height}`}
                x={1.2} y={1.2} width={width} height={height} rx={pxRadius}
                fill="none" stroke="#3977F6" strokeWidth={2} strokeLinecap="round"
                strokeDasharray={`${dash} ${perimeter - dash}`}
                initial={{ strokeDashoffset: 0 }}
                animate={{ strokeDashoffset: -perimeter }}
                transition={{ duration, repeat: Infinity, ease: "linear" }}
                opacity={0.72}
              />
              <motion.rect key={`highlight-${width}-${height}`}
                x={1.2} y={1.2} width={width} height={height} rx={pxRadius}
                fill="none" stroke="#1E6FFF" strokeWidth={2.45} strokeLinecap="round"
                strokeDasharray={`${Math.min(25, dash * 0.45)} ${perimeter - Math.min(25, dash * 0.45)}`}
                initial={{ strokeDashoffset: 0 }}
                animate={{ strokeDashoffset: -perimeter }}
                transition={{ duration, repeat: Infinity, ease: "linear" }}
              />
            </>
          )}
        </svg>
      ) : null}
    </div>
  );
}
