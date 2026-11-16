import type { CSSProperties } from "react";

/** Shared dart pointer: solid blue, tailless, bent-in base. The SVG tip at (4,3) is the actual input point. */
export const AI_CURSOR_PATH = "M4 3 L4 28.5 L11 23.2 L23.5 22.5 Z";

export function AgentCursorGlyph({
  pressed = false,
  dragging = false,
  pulseKey,
  guide = false,
  className = "",
  style,
}: {
  pressed?: boolean;
  /** Held-button state for drag actions: slightly compressed, deeper blue, lifted shadow. */
  dragging?: boolean;
  /** Change this value to replay the click pulse centred on the cursor tip. Omit to render no pulse. */
  pulseKey?: string | number;
  guide?: boolean;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <>
      {pulseKey !== undefined ? (
        <span key={pulseKey} aria-hidden="true" className="clyra-ai-cursor-pulse">
          <i />
        </span>
      ) : null}
      <svg
        aria-hidden="true"
        viewBox="0 0 34 38"
        width="34"
        height="38"
        focusable="false"
        className={`clyra-ai-cursor-glyph${pressed ? " is-pressed" : ""}${dragging ? " is-dragging" : ""}${guide ? " is-guide" : ""} ${className}`}
        style={{
          position: "absolute",
          left: -4,
          top: -3,
          width: 34,
          height: 38,
          overflow: "visible",
          pointerEvents: "none",
          transformOrigin: "4px 3px",
          ...style,
        }}
      >
        <path d={AI_CURSOR_PATH} className="clyra-ai-cursor-glyph__edge" fill="#FFFFFF" stroke="#FFFFFF" strokeWidth="5.2" strokeLinejoin="round" />
        <path d={AI_CURSOR_PATH} className="clyra-ai-cursor-glyph__body" fill="#1E6FFF" stroke="#1E6FFF" strokeWidth="2.6" strokeLinejoin="round" />
      </svg>
    </>
  );
}
