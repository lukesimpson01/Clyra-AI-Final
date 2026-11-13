import { useLayoutEffect, useRef, type CSSProperties, type ReactNode } from "react";
import { beamDurationSeconds, roundedRectPerimeter } from "./beamGeometry";

/** Comet particles trailing the head: [distance behind the head as a fraction of the lap, opacity, size px]. */
const TRAIL: ReadonlyArray<readonly [number, number, number]> = [
  [0, 1, 24], [0.008, 0.95, 24], [0.018, 0.75, 22], [0.03, 0.55, 20], [0.044, 0.34, 18], [0.06, 0.16, 16],
];
const HALO: ReadonlyArray<readonly [number, number, number]> = [[0, 0.5, 64], [0.02, 0.32, 56], [0.045, 0.16, 48]];

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
          <span aria-hidden className="pbeam__halo">
            {HALO.map(([behind, opacity, size]) => (
              <i key={behind} style={{ "--pb-behind": behind, "--pb-o": opacity, "--pb-s": `${size}px` } as CSSProperties} />
            ))}
          </span>
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
