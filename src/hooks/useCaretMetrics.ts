import { useCallback } from "react";
import { getTextControlCaretRect } from "../components/text-engine/CaretGeometry";

/** The viewport rectangle of a text control's caret, on demand (for anchoring a popover). Nothing is measured while typing. */
export function useCaretMetrics() {
  return useCallback((el: HTMLTextAreaElement | HTMLInputElement | null) => (el ? getTextControlCaretRect(el) : null), []);
}
