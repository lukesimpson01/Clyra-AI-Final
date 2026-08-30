/**
 * Re-exports the shared Clyra motion tokens (now promoted to
 * src/lib/motion.ts so other surfaces can reuse the same physical,
 * non-bouncy feel instead of ad hoc per-component durations/easings).
 * Kept here so existing imports in this directory don't need to change.
 */
export {
  AGENT_EASE,
  LAYOUT_TRANSITION,
  ROW_ENTER,
  SUBTLE_ENTER,
  HEIGHT_OPEN,
  LABEL_MORPH,
  POPOVER_ENTER,
} from "../../lib/motion";
