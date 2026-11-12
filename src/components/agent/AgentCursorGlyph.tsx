import type { CSSProperties } from "react";

/** Shared native-looking cursor. The SVG tip at (4,3) is the actual input point. */
export const AI_CURSOR_PATH = "M4 3 L4 29.2 Q4 30.5 5.4 30.5 L11.4 24.6 L16.9 34.3 Q17.5 35.4 18.6 34.9 L22 33.1 Q23 32.6 22.4 31.5 L16.9 21.8 L29.1 21.8 Q30.8 21.8 30 20.4 L5.9 2.2 Q4 0.9 4 3 Z";

export function AgentCursorGlyph({
  pressed = false,
  guide = false,
  className = "",
  style,
}: {
  pressed?: boolean;
  guide?: boolean;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 34 38"
      width="34"
      height="38"
      focusable="false"
      className={`clyra-ai-cursor-glyph${pressed ? " is-pressed" : ""}${guide ? " is-guide" : ""} ${className}`}
      style={{
        position: "absolute",
        left: -4,
        top: -3,
        width: 34,
        height: 38,
        overflow: "visible",
        pointerEvents: "none",
        transformOrigin: "4px 3px",
        filter: "drop-shadow(0 0 2.5px rgba(30,111,255,.32)) drop-shadow(0 3px 3px rgba(22,34,55,.18))",
        ...style,
      }}
    >
      <path d={AI_CURSOR_PATH} fill="#1E6FFF" stroke="#1E6FFF" strokeWidth="5.4" strokeLinejoin="round" />
      <path d={AI_CURSOR_PATH} fill="#FFFFFF" stroke="#252A35" strokeWidth="2.45" strokeLinejoin="round" />
    </svg>
  );
}
