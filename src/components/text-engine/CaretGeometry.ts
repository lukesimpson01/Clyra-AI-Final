/**
 * Caret geometry, for diagnostics and for anchoring things (suggestion popovers, ghost text) to the real insertion point.
 * It never draws a caret: the native caret stays the only one, and is never moved or animated.
 */

/** The collapsed selection's rectangle in viewport coordinates (contenteditable and plain DOM text). */
export function getCaretRect(): DOMRect | null {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0).cloneRange();
  range.collapse(true);
  const rects = range.getClientRects();
  if (rects.length > 0) return rects[0];
  const fallback = range.getBoundingClientRect();
  return fallback.height > 0 ? fallback : null;
}

const MIRRORED = [
  "boxSizing", "width", "height", "overflowX", "overflowY", "borderTopWidth", "borderRightWidth", "borderBottomWidth", "borderLeftWidth",
  "paddingTop", "paddingRight", "paddingBottom", "paddingLeft", "fontStyle", "fontVariant", "fontWeight", "fontStretch", "fontSize",
  "fontSizeAdjust", "lineHeight", "fontFamily", "textAlign", "textTransform", "textIndent", "textDecoration", "letterSpacing", "wordSpacing",
  "tabSize", "whiteSpace", "wordBreak", "overflowWrap", "fontKerning", "fontVariantLigatures",
] as const;

/**
 * The caret rectangle inside a textarea or input, in viewport coordinates. A textarea has no DOM selection range, so an
 * off-screen mirror with identical metrics lays out the same text and reports where the position falls. Used for diagnostics
 * and to anchor popovers; the visible caret is still the browser's own.
 */
export function getTextControlCaretRect(el: HTMLTextAreaElement | HTMLInputElement, position = el.selectionStart ?? el.value.length): DOMRect {
  const style = getComputedStyle(el);
  const mirror = document.createElement("div");
  const target = mirror.style as unknown as Record<string, string>;
  const source = style as unknown as Record<string, string>;
  for (const key of MIRRORED) target[key] = source[key];
  mirror.style.position = "fixed";
  mirror.style.visibility = "hidden";
  mirror.style.pointerEvents = "none";
  mirror.style.top = "0";
  mirror.style.left = "-99999px";
  mirror.style.whiteSpace = el instanceof HTMLTextAreaElement ? "pre-wrap" : "pre";
  mirror.style.overflow = "hidden";
  mirror.textContent = el.value.slice(0, position);
  const marker = document.createElement("span");
  marker.textContent = el.value.slice(position) || ".";
  mirror.appendChild(marker);
  document.body.appendChild(mirror);
  const box = el.getBoundingClientRect();
  const markerRect = marker.getBoundingClientRect();
  const mirrorRect = mirror.getBoundingClientRect();
  document.body.removeChild(mirror);
  const lineHeight = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.4;
  return new DOMRect(box.left + (markerRect.left - mirrorRect.left) - el.scrollLeft, box.top + (markerRect.top - mirrorRect.top) - el.scrollTop, 1, lineHeight);
}
