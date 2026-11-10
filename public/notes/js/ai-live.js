/* Live AI edits.

   While the assistant works on a note, the note itself shows it: a slow blue
   gradient runs around the page, additions are typed in as green text, and
   anything that is not plain text (a table, a calendar, an image) is drawn
   out by a cursor that drags from corner to corner and reveals what it is.
   Text that would be replaced appears struck through in red with its
   replacement typed beside it. Nothing here changes the note: the change is
   only applied when it is accepted in chat (or from the small bar on the
   suggestion), and declining simply lets the suggestion fade away. */
import { el, icon } from "./dom.js";
import { api } from "./api.js";

/* ------------------------------------------------------------ shared state */

const working = new Map();
const pending = new Map();
const settleHandlers = new Map();
const emit = (name, detail) => window.dispatchEvent(new CustomEvent(name, { detail }));

export const isAiWorking = (pageId) => (working.get(String(pageId)) || 0) > 0;
export function setAiWorking(pageId, on) {
  if (!pageId) return;
  const id = String(pageId);
  const next = Math.max(0, (working.get(id) || 0) + (on ? 1 : -1));
  if (next) working.set(id, next); else working.delete(id);
  emit("clyra:ai-work", { pageId: id, on: next > 0 });
}
export function clearAiWorking() {
  const ids = [...working.keys()];
  working.clear();
  ids.forEach((pageId) => emit("clyra:ai-work", { pageId, on: false }));
}

/* A proposed edit stays registered until it is applied or declined, so it can
   be shown again whenever its note is opened. */
export function registerEdit(edit, handlers) {
  pending.set(edit.id, edit);
  settleHandlers.set(edit.id, handlers);
  emit("clyra:ai-edit", { edit });
}
export const pendingEdits = (pageId) => [...pending.values()].filter((edit) => String(edit.pageId) === String(pageId) && (!edit.status || edit.status === "pending"));
export function settleEdit(editId, status) {
  const edit = pending.get(editId);
  if (!edit) return;
  edit.status = status;
  pending.delete(editId);
  settleHandlers.delete(editId);
  emit("clyra:ai-settle", { editId, status });
}
export const decide = (editId, decision) => settleHandlers.get(editId)?.[decision]?.();

/* --------------------------------------------------------------- the ghost */

const RICH_LABEL = {
  table: "Table", database: "Database", image: "Image", chart: "Chart", columns: "Columns", tabs: "Tabs", embed: "Embed", bookmark: "Bookmark",
  video: "Video", audio: "Audio", file: "File", pdf: "PDF", divider: "Divider", equation: "Equation", synced: "Synced block", button: "Button", brainstorm: "Whiteboard", toc: "Table of contents",
};
const TEXTUAL = new Set(["text", "h1", "h2", "h3", "h4", "bulleted", "numbered", "todo", "quote", "callout", "toggle", "toggle_h1", "toggle_h2", "toggle_h3", "code", "key_term", "study_summary", "objective", "source", "exam_checklist"]);
const mint = (list) => list.map((block) => ({ id: `ghost${Math.random().toString(36).slice(2, 9)}`, type: block.type, text: block.text || [], props: block.props || {}, children: mint(block.children || []) }));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

/* The label a cursor shows for a block that is not text: a database says what
   view it is, so a calendar announces itself as a calendar. */
function richLabel(node) {
  const type = node.dataset.type;
  if (type === "database") {
    const html = node.innerHTML;
    if (/db-calendar|db-cal/.test(html)) return "Calendar";
    if (/db-board/.test(html)) return "Board";
    if (/db-gallery/.test(html)) return "Gallery";
    if (/db-timeline/.test(html)) return "Timeline";
    if (/db-list/.test(html)) return "List";
    return "Database";
  }
  return RICH_LABEL[type] || "Block";
}

function textNodesOf(root) {
  const nodes = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, { acceptNode: (node) => (node.nodeValue.trim() || node.parentElement?.closest(".text-line") ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT) });
  while (walker.nextNode()) nodes.push(walker.currentNode);
  return nodes;
}

/* Types a block's text into place a few characters at a time. */
async function typeBlock(block, caret, state) {
  const nodes = textNodesOf(block).map((node) => ({ node, full: node.nodeValue }));
  nodes.forEach(({ node }) => { node.nodeValue = ""; });
  for (const { node, full } of nodes) {
    if (!full) continue;
    node.parentNode.insertBefore(caret, node.nextSibling);
    for (let at = 0; at < full.length; at += state.step) {
      if (state.skipped) { node.nodeValue = full; break; }
      node.nodeValue = full.slice(0, at + state.step);
      await sleep(state.delay);
    }
    node.nodeValue = full;
  }
}

/* A cursor drags from the block's corner to its far corner while the block is
   uncovered along the same path. */
async function dragReveal(block, host, cursor, tag, state) {
  const hostBox = host.getBoundingClientRect();
  const box = block.getBoundingClientRect();
  const x0 = box.left - hostBox.left; const y0 = box.top - hostBox.top;
  tag.textContent = `Clyra · ${richLabel(block)}`;
  cursor.style.transform = `translate(${x0 + 4}px, ${y0 + 4}px)`;
  cursor.classList.add("show");
  block.style.visibility = "visible";
  if (state.skipped || reduced()) { block.style.clipPath = "none"; return; }
  block.style.clipPath = "inset(0 100% 100% 0 round 8px)";
  await sleep(90);
  const duration = Math.min(900, 380 + box.height * 1.1);
  const reveal = block.animate([{ clipPath: "inset(0 100% 100% 0 round 8px)" }, { clipPath: "inset(0 0 0 0 round 8px)" }], { duration, easing: "cubic-bezier(.45,.05,.2,1)", fill: "forwards" });
  cursor.animate([{ transform: `translate(${x0 + 4}px, ${y0 + 4}px)` }, { transform: `translate(${x0 + box.width - 10}px, ${y0 + box.height - 10}px)` }], { duration, easing: "cubic-bezier(.45,.05,.2,1)", fill: "forwards" });
  await reveal.finished.catch(() => {});
  block.style.clipPath = "none";
  cursor.getAnimations().forEach((animation) => animation.cancel());
  cursor.style.transform = `translate(${x0 + box.width - 10}px, ${y0 + box.height - 10}px)`;
  await sleep(160);
}

async function playBlocks(addHost, state) {
  const blocks = [...addHost.querySelectorAll(".block")].filter((node) => !node.parentElement.closest(".block"));
  const total = blocks.reduce((sum, block) => sum + (TEXTUAL.has(block.dataset.type) ? block.textContent.length : 0), 0);
  state.step = Math.max(1, Math.ceil(total / 210));
  state.delay = 16;
  const caret = el("span", { class: "ai-caret", "aria-hidden": "true" });
  const cursor = el("div", { class: "ai-cursor", "aria-hidden": "true" },
    el("svg", { viewBox: "0 0 16 16", width: "16", height: "16" }, el("path", { d: "M2.5 1.8 13 8.2l-4.6 1.1-1.9 4.3z", fill: "currentColor" })),
    el("span", { class: "ai-cursor-tag" }));
  const tag = cursor.querySelector(".ai-cursor-tag");
  addHost.append(cursor);
  blocks.forEach((block) => { block.style.visibility = "hidden"; });
  for (const block of blocks) {
    if (!block.isConnected || state.cancelled) return;
    if (TEXTUAL.has(block.dataset.type)) {
      cursor.classList.remove("show");
      block.style.visibility = "visible";
      await typeBlock(block, caret, state);
    } else await dragReveal(block, addHost, cursor, tag, state);
  }
  caret.remove();
  cursor.classList.remove("show");
  setTimeout(() => cursor.remove(), 300);
}

/* Builds the suggestion for one edit inside a note's editor column. Returns
   { node, destroy }. A replace is drawn inline (removed text struck through in
   red, its replacement typed in green); an insert is a green block that is
   typed or drawn in. There are no controls here: the chat owns the decision. */
export async function renderSuggestion(editorHost, edit, { Editor, animate = true } = {}) {
  const wrap = el("section", { class: `ai-suggest ${edit.kind === "replace" ? "is-replace" : "is-insert"}`, dataset: { edit: edit.id } });
  /* The note shows only the change itself: green for what is added, red
     struck through for what goes. Accepting or dismissing happens in the chat. */
  wrap.setAttribute("aria-label", edit.kind === "replace" ? "Suggested change, decide in the chat" : "Suggested addition, decide in the chat");
  const state = { skipped: !animate, cancelled: false };
  wrap.addEventListener("click", () => { state.skipped = true; });
  let anchor = null;
  let replaced = null;

  /* The assistant writes markdown; the page holds plain text. Compare them on equal terms. */
  const norm = (text) => String(text || "").replace(/^\s*(?:[-*+]|\d+\.)\s+/gm, "").replace(/[*_`~]/g, "").replace(/\s+/g, " ").trim();
  if (edit.kind === "replace") {
    const findN = norm(edit.find);
    const all = [...editorHost.querySelectorAll(".block")].filter((node) => !node.closest(".ai-suggest"));
    const candidates = all.filter((node) => node.textContent.includes(edit.find) || norm(node.textContent).includes(findN));
    replaced = candidates.sort((a, b) => a.textContent.length - b.textContent.length)[0] || null;
    if (replaced) {
      const raw = replaced.querySelector(".text-line")?.textContent ?? replaced.textContent;
      const exact = raw.includes(edit.find);
      const full = exact ? raw : norm(raw);
      const needle = exact ? edit.find : findN;
      const at = full.indexOf(needle);
      const next = exact ? (edit.replace || "") : norm(edit.replace);
      const body = el("p", { class: "ai-inline" },
        el("span", { text: at >= 0 ? full.slice(0, at) : "" }),
        el("del", { class: "ai-del", text: needle }),
        el("ins", { class: "ai-ins", text: next }),
        el("span", { text: at >= 0 ? full.slice(at + needle.length) : "" }));
      wrap.append(body);
      replaced.classList.add("ai-replaced");
      anchor = replaced;
      if (animate && !reduced() && next) {
        const ins = body.querySelector("ins");
        const text = next; ins.textContent = "";
        const caret = el("span", { class: "ai-caret" }); ins.append(caret);
        const step = Math.max(1, Math.ceil(text.length / 120));
        (async () => { for (let i = 0; i < text.length && !state.skipped && !state.cancelled; i += step) { caret.before(text.slice(i, i + step)); await sleep(18); } ins.textContent = text; })();
      }
    }
  }
  if (edit.kind !== "replace" || !replaced) {
    const drafts = await api.post("/api/notes/markdown/blocks", { markdown: (edit.kind === "replace" ? edit.replace : edit.markdown) || "" }).catch(() => []);
    const addHost = el("div", { class: "ai-suggest-body" });
    wrap.append(addHost);
    new Editor(addHost, { page: { id: `ghost-${edit.id}`, title: "", blocks: mint(drafts || []), breadcrumb: [] }, readOnly: true });
    const blocks = [...editorHost.querySelectorAll(".block")].filter((node) => !node.parentElement.closest(".block") && !node.closest(".ai-suggest"));
    if (edit.position === "start") anchor = null;
    else if (edit.position === "after" && edit.afterText) anchor = [...blocks].find((node) => node.textContent.toLowerCase().includes(String(edit.afterText).toLowerCase())) || blocks[blocks.length - 1] || null;
    else anchor = blocks[blocks.length - 1] || null;
    requestAnimationFrame(() => playBlocks(addHost, state));
  }
  if (anchor) anchor.after(wrap);
  else editorHost.prepend(wrap);
  requestAnimationFrame(() => wrap.classList.add("in"));
  return {
    node: wrap,
    destroy: () => {
      state.cancelled = true;
      replaced?.classList.remove("ai-replaced");
      wrap.classList.remove("in");
      wrap.classList.add("out");
      setTimeout(() => wrap.remove(), 260);
    },
  };
}

/* The blue gradient: a thin element on the page's own surface, fading in when
   the assistant starts and out when it stops. */
export function mountGlow(host) {
  const glow = el("div", { class: "ai-glow", "aria-hidden": "true" }, el("span", { class: "ai-glow-edge" }), el("span", { class: "ai-glow-wash" }));
  host.append(glow);
  return { set: (on) => glow.classList.toggle("on", on), destroy: () => glow.remove() };
}
