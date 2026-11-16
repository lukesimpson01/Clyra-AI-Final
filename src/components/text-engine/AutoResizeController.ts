/**
 * Grows a textarea with its content up to a maximum, then scrolls inside. One read and one write per change, batched in the
 * layout phase, so the text never shifts after paint. The caret is preserved: only the height changes.
 */
export function autoResize(el: HTMLTextAreaElement, maxHeight = 240) {
  const scrollTop = el.scrollTop;
  el.style.height = "auto";
  const next = Math.min(el.scrollHeight, maxHeight);
  el.style.height = `${next}px`;
  el.style.overflowY = el.scrollHeight > maxHeight ? "auto" : "hidden";
  if (el.scrollHeight > maxHeight) el.scrollTop = scrollTop;
}
