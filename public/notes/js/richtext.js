/* Rich text bridge between stored spans and the contenteditable DOM.

   Spans are the source of truth. The editor renders them to DOM, lets the
   browser handle caret and IME, then reads the DOM back into spans on input,
   which keeps marks, mentions and equations intact through native editing. */
import { el, icon } from "./dom.js";

export const MARKS = ["b", "i", "u", "s", "c"];

const sameMarks = (a, b) =>
  MARKS.every((mark) => Boolean(a[mark]) === Boolean(b[mark])) &&
  a.col === b.col && a.bg === b.bg && a.href === b.href && a.page === b.page &&
  a.date === b.date && a.eq === b.eq && a.colHex === b.colHex && a.bgHex === b.bgHex &&
  a.highlightId === b.highlightId && a.categoryId === b.categoryId && a.highlightNote === b.highlightNote &&
  a.font === b.font && a.size === b.size;

export function normalizeSpans(spans) {
  const out = [];
  for (const span of spans || []) {
    if (!span || (!span.t && !span.eq && !span.page && !span.date && !span.person)) continue;
    const last = out[out.length - 1];
    if (last && !last.eq && !last.page && !last.date && !last.person && !span.eq && !span.page && !span.date && !span.person && sameMarks(last, span)) {
      last.t += span.t;
    } else out.push({ ...span });
  }
  return out;
}

export const spansText = (spans) => (spans || []).map((span) => span.t ?? "").join("");

const safeHex = (value) => /^#[0-9a-f]{6}$/i.test(String(value || "")) ? String(value) : null;

/* ------------------------------------------------------- spans -> DOM */

function renderSpan(span, context) {
  if (span.eq) {
    return el("span", { class: "inline-equation", "data-eq": span.eq, contenteditable: "false" }, span.t || span.eq);
  }
  if (span.page) {
    const page = context.pageById?.(span.page);
    return el("span", {
      class: "page-mention", "data-page": span.page, contenteditable: "false",
      onclick: (event) => { event.preventDefault(); context.onOpenPage?.(span.page, event); },
    }, page?.icon || "", page?.title || span.t || "New page");
  }
  if (span.person) {
    return el("span", { class: "person-mention", "data-person": span.person, contenteditable: "false" }, el("i", { class: "person-avatar", text: span.person.trim().charAt(0).toUpperCase() }), span.person);
  }
  if (span.date) {
    return el("span", { class: "date-mention", "data-date": span.date, contenteditable: "false" }, span.t || span.date);
  }
  let node = document.createTextNode(span.t ?? "");
  const wrap = (tag, props) => { const parent = el(tag, props); parent.append(node); node = parent; };
  if (span.c) wrap("code", { class: "rt-code" });
  if (span.b) wrap("strong");
  if (span.i) wrap("em");
  if (span.u) wrap("u");
  if (span.s) wrap("s");
  if (span.col || span.bg) {
    const color = safeHex(span.colHex) || (span.col && span.col !== "default" && span.col !== "custom" ? `var(--c-${span.col})` : "");
    const background = safeHex(span.bgHex) || (span.bg && span.bg !== "default" && span.bg !== "custom" ? `var(--c-${span.bg}-bg)` : "");
    wrap("span", {
      class: "rt-color", "data-color": span.col || "", "data-background": span.bg || "",
      "data-color-hex": safeHex(span.colHex) || "", "data-background-hex": safeHex(span.bgHex) || "",
      "data-highlight-id": span.highlightId || "", "data-category-id": span.categoryId || "",
      "data-highlight-note": span.highlightNote || "", "data-highlight-created-at": span.highlightCreatedAt || "",
      style: {
        color,
        background,
        borderRadius: span.bg ? "3px" : "",
        padding: span.bg ? "0 2px" : "",
      },
    });
    if (span.categoryId) node.classList.add("smart-highlight");
  }
  if (span.font || span.size) {
    wrap("span", { class: "rt-type", "data-font": span.font || "", "data-size": span.size || "", style: { fontFamily: span.font || "", fontSize: span.size || "" } });
  }
  if (span.href) {
    wrap("a", { class: "rt-link", href: span.href, target: "_blank", rel: "noreferrer noopener" });
  }
  return node;
}

export function renderSpans(target, spans, context = {}) {
  while (target.firstChild) target.firstChild.remove();
  for (const span of normalizeSpans(spans)) target.append(renderSpan(span, context));
}

/* ------------------------------------------------------- DOM -> spans */

export function readSpans(root) {
  const spans = [];
  const walk = (node, marks) => {
    for (const child of node.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) {
        if (child.nodeValue) spans.push({ ...marks, t: child.nodeValue });
        continue;
      }
      if (child.nodeType !== Node.ELEMENT_NODE) continue;
      if (child.tagName === "BR") { spans.push({ ...marks, t: "\n" }); continue; }
      if (child.dataset?.eq !== undefined) { spans.push({ ...marks, t: child.textContent, eq: child.dataset.eq }); continue; }
      if (child.dataset?.page !== undefined) { spans.push({ ...marks, t: child.textContent, page: child.dataset.page }); continue; }
      if (child.dataset?.person !== undefined) { spans.push({ ...marks, t: `@${child.dataset.person}`, person: child.dataset.person }); continue; }
      if (child.dataset?.date !== undefined) { spans.push({ ...marks, t: child.textContent, date: child.dataset.date }); continue; }
      const next = { ...marks };
      const tag = child.tagName;
      if (tag === "B" || tag === "STRONG") next.b = 1;
      if (tag === "I" || tag === "EM") next.i = 1;
      if (tag === "U") next.u = 1;
      if (tag === "S" || tag === "STRIKE" || tag === "DEL") next.s = 1;
      if (tag === "CODE") next.c = 1;
      if (tag === "A" && child.getAttribute("href")) next.href = child.getAttribute("href");
      if (child.dataset?.color) next.col = child.dataset.color;
      if (child.dataset?.background) next.bg = child.dataset.background;
      if (safeHex(child.dataset?.colorHex)) next.colHex = child.dataset.colorHex;
      if (safeHex(child.dataset?.backgroundHex)) next.bgHex = child.dataset.backgroundHex;
      if (child.dataset?.highlightId) next.highlightId = child.dataset.highlightId;
      if (child.dataset?.categoryId) next.categoryId = child.dataset.categoryId;
      if (child.dataset?.highlightNote) next.highlightNote = child.dataset.highlightNote;
      if (child.dataset?.highlightCreatedAt) next.highlightCreatedAt = child.dataset.highlightCreatedAt;
      if (child.dataset?.font) next.font = child.dataset.font;
      if (child.dataset?.size) next.size = child.dataset.size;
      walk(child, next);
    }
  };
  walk(root, {});
  return normalizeSpans(spans);
}

/* ------------------------------------------------------ caret helpers */

export function caretOffset(root) {
  const selection = window.getSelection();
  if (!selection || !selection.rangeCount) return 0;
  const range = selection.getRangeAt(0).cloneRange();
  range.selectNodeContents(root);
  range.setEnd(selection.getRangeAt(0).endContainer, selection.getRangeAt(0).endOffset);
  return range.toString().length;
}

export function setCaret(root, offset) {
  const selection = window.getSelection();
  const range = document.createRange();
  let remaining = Math.max(0, offset);
  let placed = false;
  const walk = (node) => {
    if (placed) return;
    if (node.nodeType === Node.TEXT_NODE) {
      const length = node.nodeValue.length;
      if (remaining <= length) { range.setStart(node, remaining); placed = true; return; }
      remaining -= length;
      return;
    }
    if (node.nodeType === Node.ELEMENT_NODE && node.getAttribute?.("contenteditable") === "false") {
      const length = node.textContent.length;
      if (remaining <= length) { range.setStartAfter(node); placed = true; return; }
      remaining -= length;
      return;
    }
    for (const child of [...node.childNodes]) walk(child);
  };
  walk(root);
  if (!placed) range.selectNodeContents(root), range.collapse(false);
  else range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
}

export const caretAtStart = (root) => caretOffset(root) === 0 && window.getSelection()?.isCollapsed;
export const caretAtEnd = (root) => {
  const selection = window.getSelection();
  return selection?.isCollapsed && caretOffset(root) >= root.textContent.length;
};

export function selectionRangeIn(root) {
  const selection = window.getSelection();
  if (!selection || !selection.rangeCount) return null;
  const range = selection.getRangeAt(0);
  if (!root.contains(range.commonAncestorContainer)) return null;
  const before = range.cloneRange();
  before.selectNodeContents(root);
  before.setEnd(range.startContainer, range.startOffset);
  const start = before.toString().length;
  return { start, end: start + range.toString().length, collapsed: range.collapsed };
}

/* ------------------------------------------------------ span slicing */

export function sliceSpans(spans, start, end) {
  const out = [];
  let cursor = 0;
  for (const span of spans) {
    const length = (span.t ?? "").length;
    const from = Math.max(start, cursor);
    const to = Math.min(end, cursor + length);
    if (to > from) out.push({ ...span, t: span.t.slice(from - cursor, to - cursor) });
    cursor += length;
  }
  return normalizeSpans(out);
}

export const spansLength = (spans) => (spans || []).reduce((total, span) => total + (span.t ?? "").length, 0);

export function applyMark(spans, start, end, mark, value) {
  if (start >= end) return spans;
  const before = sliceSpans(spans, 0, start);
  const middle = sliceSpans(spans, start, end).map((span) => {
    const next = { ...span };
    if (value === null || value === false) delete next[mark];
    else next[mark] = value;
    return next;
  });
  const after = sliceSpans(spans, end, spansLength(spans));
  return normalizeSpans([...before, ...middle, ...after]);
}

export function markState(spans, start, end) {
  const slice = sliceSpans(spans, start, end).filter((span) => span.t);
  if (!slice.length) return {};
  const state = {};
  for (const mark of [...MARKS, "href"]) {
    state[mark] = slice.every((span) => Boolean(span[mark]));
  }
  return state;
}

export function insertSpans(spans, offset, inserted) {
  return normalizeSpans([
    ...sliceSpans(spans, 0, offset),
    ...inserted,
    ...sliceSpans(spans, offset, spansLength(spans)),
  ]);
}

export function replaceRange(spans, start, end, inserted) {
  return normalizeSpans([
    ...sliceSpans(spans, 0, start),
    ...inserted,
    ...sliceSpans(spans, end, spansLength(spans)),
  ]);
}

export const plain = (text) => (text ? [{ t: text }] : []);
