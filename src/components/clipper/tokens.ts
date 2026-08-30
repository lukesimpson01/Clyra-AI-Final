/**
 * Shared design tokens for the AI Clipper desktop editor.
 *
 * Every editor surface (clips sidebar, centre stage, timeline, word-timing
 * inspector) reads from this single palette so the layout stays cohesive.
 * No gradients, no glassmorphism — flat white surfaces with 1px hairlines.
 *
 * These resolve to the app-wide --clyra-* CSS custom properties (see
 * src/index.css) rather than static hex, so the editor actually follows
 * light/dark theme instead of staying hard-light regardless of the app's
 * theme setting. `karaoke` is the one deliberate exception: it's burned
 * into the exported video pixels by FFmpeg, not rendered UI, so it must
 * stay a real fixed color.
 */
export const CLIP_EDITOR = {
  /** Base page background. */
  bg: "var(--clyra-canvas)",
  /** Secondary panel background (fields, quiet wells). */
  panel: "var(--clyra-surface-muted)",
  /** Primary text. */
  textPrimary: "var(--clyra-text)",
  /** Secondary text. */
  textSecondary: "var(--clyra-text-secondary)",
  /** Muted/metadata text. */
  textMuted: "var(--clyra-text-tertiary)",
  /** Standard 1px border. */
  border: "var(--clyra-border)",
  /** Extra-light separator for row dividers. */
  separator: "var(--clyra-border)",
  /** Primary action blue — the same accent used across Clyra's other workspaces. */
  blue: "var(--clyra-accent)",
  /** Selected surface. */
  selected: "var(--clyra-selected)",
  /** Hover surface. */
  hover: "var(--clyra-hover)",
  /** Karaoke active-word highlight used by the FFmpeg burn-in (unrelated to app chrome). */
  karaoke: "#FFD54A",
} as const;

/** Native desktop typography — matches the app's global body font stack. */
export const CLIP_EDITOR_FONT =
  '-apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", sans-serif';

export const CLIP_EDITOR_MONO =
  'ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace';

/** mm:ss.mmm — the monospace timecode used across the timeline + inspector. */
export function formatEditorTime(seconds: number) {
  const safe = Math.max(0, seconds || 0);
  const mins = Math.floor(safe / 60);
  const secs = Math.floor(safe % 60);
  const millis = Math.floor((safe % 1) * 1000);
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}.${String(millis).padStart(3, "0")}`;
}
