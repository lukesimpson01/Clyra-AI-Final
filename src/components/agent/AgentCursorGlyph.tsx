import type { CSSProperties } from "react";

/** Shared dart pointer: solid blue, tailless, bent-in base. The SVG tip at (4,3) is the actual input point. */
export const AI_CURSOR_PATH = "M2.4 2.4 L19.4 8.2 L11.2 11.4 L8.2 19.6 Z";

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
        viewBox="0 0 22 22"
        width="22"
        height="22"
        focusable="false"
        className={`clyra-ai-cursor-glyph${pressed ? " is-pressed" : ""}${dragging ? " is-dragging" : ""}${guide ? " is-guide" : ""} ${className}`}
        style={{
          position: "absolute",
          left: -2.4,
          top: -2.4,
          width: 22,
          height: 22,
          overflow: "visible",
          pointerEvents: "none",
          transformOrigin: "2.4px 2.4px",
          ...style,
        }}
      >
        <path d={AI_CURSOR_PATH} className="clyra-ai-cursor-glyph__edge" fill="#FFFFFF" stroke="#FFFFFF" strokeWidth="3.4" strokeLinejoin="round" />
        <path d={AI_CURSOR_PATH} className="clyra-ai-cursor-glyph__body" fill="#1E6FFF" stroke="#1E6FFF" strokeWidth="1.6" strokeLinejoin="round" />
      </svg>
    </>
  );
}
