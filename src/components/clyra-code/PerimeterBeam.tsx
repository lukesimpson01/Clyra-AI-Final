import { useLayoutEffect, useRef, type CSSProperties, type ReactNode } from "react";
import { beamDurationSeconds, roundedRectPerimeter } from "./beamGeometry";

/** Comet particles trailing the head: [distance behind the head as a fraction of the lap, opacity, size px]. */
const TRAIL: ReadonlyArray<readonly [number, number, number]> = [
  [0, 1, 18], [0.006, 0.92, 18], [0.013, 0.8, 17], [0.021, 0.66, 16], [0.03, 0.52, 15],
  [0.04, 0.4, 14], [0.051, 0.29, 13], [0.063, 0.19, 12], [0.076, 0.1, 11], [0.09, 0.04, 10],
];

/**
 * A blue comet that travels the composer border at a constant speed. Each
 * particle rides the same rounded-rect `offset-path`, so it keeps the same
 * on-screen velocity on straight edges and around corners (a rotating conic
 * gradient would not). The lap time comes from the real perimeter, measured
 * once per resize straight into a CSS variable: no React state, no per-frame
 * script, only a few tiny elements animating a single property.
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

  useLayoutEffect(() => {
    const node = wrapperRef.current;
    if (!node) return;
    const update = () => {
      const { width, height } = node.getBoundingClientRect();
      const lap = beamDurationSeconds(roundedRectPerimeter(width, height, radius));
      if (lap > 0) node.style.setProperty("--pb-lap", `${lap.toFixed(2)}s`);
    };
    update();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, [radius]);

  return (
    <div ref={wrapperRef} className={`pbeam relative mx-auto w-full ${className}`} style={{ "--pb-r": `${radius}px`, "--pb-lap": "6s" } as CSSProperties}>
      {children}
      {active ? (
        <>
          <span aria-hidden className="pbeam__ring">
            {TRAIL.map(([behind, opacity, size]) => (
              <i key={behind} style={{ "--pb-behind": behind, "--pb-o": opacity, "--pb-s": `${size}px` } as CSSProperties} />
            ))}
          </span>
        </>
      ) : null}
    </div>
  );
}
