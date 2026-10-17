import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export interface TextFadeInProps extends Omit<HTMLAttributes<HTMLParagraphElement>, "children"> {
  children: string;
  className?: string;
  /** Seconds before the first chunk starts fading in. */
  delay?: number;
  /** Seconds each chunk takes to fade and un-blur. */
  duration?: number;
  /** Seconds between consecutive chunks. */
  staggerDelay?: number;
  by?: "word" | "character";
}

/**
 * Reveals finished prose in chunks, mirroring the reference reply animation:
 * each chunk fades up from a soft blur, staggered in order.
 *
 * Chunks are plain inline spans (no inline-block, no per-chunk transform) and
 * the container keeps `white-space: pre-wrap`, so line breaks, paragraph gaps
 * and wrapping stay exactly as the text was written. The previous per-word
 * `inline-block` version split on spaces and reflowed multi-paragraph replies
 * into jumbled lines. Motion is CSS-only; `.clyra-chunk` in index.css turns it
 * off under `prefers-reduced-motion`.
 */
export function TextFadeIn({
  children,
  className,
  duration = 0.42,
  delay = 0.04,
  by = "word",
  staggerDelay = 0.028,
  style,
  ...props
}: TextFadeInProps) {
  const units = by === "word" ? splitWordChunks(children) : Array.from(children);

  return (
    <p className={cn("whitespace-pre-wrap", className)} style={style} {...props}>
      {units.map((unit, index) => (
        <span
          key={index}
          className="clyra-chunk"
          style={{
            animationDuration: `${duration}s`,
            animationDelay: `${(delay + index * staggerDelay).toFixed(3)}s`,
          }}
        >
          {unit}
        </span>
      ))}
    </p>
  );
}

/** Splits text into word-plus-trailing-whitespace units, so newlines are kept verbatim. */
function splitWordChunks(text: string): string[] {
  return text.match(/\S+\s*|\s+/g) ?? [];
}

export default TextFadeIn;
