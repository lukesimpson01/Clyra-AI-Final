/* Building blocks for the template library.

   A template is a finished page, not an outline: a cover, an icon, a short banner saying what the page is for, the things
   you fill in laid out side by side, tables that already have the right columns, and a line or two of guidance folded
   away so it never crowds the page. Some templates are databases instead (a board, a calendar, a table with sample rows),
   because a tracker you can sort and drag is better than a table you can only type into. */
import { inlineMarkdown } from "./editor.js";

export const b = (type, text = "", props = {}, children = []) => ({ type, text: inlineMarkdown(text), props, children });
export const h1 = (text) => b("h1", text);
export const h2 = (text) => b("h2", text);
export const h3 = (text) => b("h3", text);
export const p = (text = "") => b("text", text);
export const li = (text = "") => b("bulleted", text);
export const num = (text = "") => b("numbered", text);
export const todo = (text = "", checked = false) => b("todo", text, { checked });
export const quote = (text) => b("quote", text);
export const divider = () => b("divider");
export const toc = () => b("toc");
export const callout = (icon, text, color = "blue") => b("callout", text, { icon, color });
export const toggle = (text, children = [p("")]) => b("toggle", text, { collapsed: false }, children);
export const term = (name, definition) => b("key_term", definition, { term: name });
export const objective = (text) => b("objective", text);
export const focusTimer = (minutes = 25) => b("focus_timer", "", { minutes, remaining: minutes * 60, running: false });
export const summary = (text) => b("study_summary", text);
export const checklist = (title, items) => b("exam_checklist", "", { title }, items.map((item) => todo(item)));
export const columns = (...cols) => b("columns", "", {}, cols.map((children) => b("column", "", {}, children)));
export const table = (rows, options = {}) => b("table", "", {
  rows, hasHeader: true, striped: options.striped !== false, align: options.align || rows[0].map(() => "left"), tint: options.tint || "gray",
});

/* A section heading with its own emoji, and a table with its header row and n empty rows underneath. */
export const section = (emoji, title) => h2(`${emoji} ${title}`);
export const grid = (headers, count = 3, options = {}) => table([headers, ...Array.from({ length: count }, (_, row) => headers.map((_, col) => (options.fill?.[col]?.[row] ?? options.fill?.[col] ?? "")))], options);
export const todos = (count, texts = []) => Array.from({ length: count }, (_, i) => todo(texts[i] || ""));
export const bullets = (count, texts = []) => Array.from({ length: count }, (_, i) => li(texts[i] || ""));
export const how = (text) => toggle("How to use this page", [p(text)]);
/* The facts that open a page: who, when, what. */
export const facts = (...pairs) => table([pairs.map(([k]) => k), pairs.map(([, v]) => v || "")], { striped: false });

/* Soft pastel covers, rotated across the library so a gallery reads as a family and not as one grey wall. */
const COVERS = [
  ["#e7efff", "#f3e8ff"], ["#e4f4ec", "#e9f1ff"], ["#fff1e0", "#fde8ef"], ["#e6f6fb", "#e8ecff"], ["#f4efe6", "#eaf3e4"],
  ["#fdebea", "#fff3de"], ["#e9eefc", "#e3f6f0"], ["#f1ebfa", "#fbe9f1"], ["#e5f3e8", "#fff6d9"], ["#ebeef2", "#e4eefb"],
];
export const cover = (index) => { const [a, c] = COVERS[index % COVERS.length]; return `linear-gradient(120deg, ${a} 0%, ${c} 100%)`; };

/* A template. `group` is Notion's Work, Life or School; `subject` is the finer label shown on the card.
   `database` makes the template a real database: properties (the first is the title), sample records, and views. */
let counter = 0;
export function template(spec) {
  counter += 1;
  /* Templates should start as clean documents rather than a wall of tinted
     covers. Individual templates can opt in with `cover` when a real visual
     identity helps the workflow; the catalogue itself does not manufacture
     colour just to distinguish cards. */
  return { ...spec, cover: spec.cover ?? null, library: true, category: spec.subject };
}

/* Database helpers. Options are written as plain names and get ids and colours when the database is built. */
export const COLORS = ["gray", "blue", "green", "orange", "purple", "pink", "yellow", "red", "brown"];
export const select = (name, options) => ({ name, type: "select", options });
export const status = (name, options = ["Not started", "In progress", "Done"]) => ({ name, type: "status", options });
export const multi = (name, options) => ({ name, type: "multi_select", options });
export const prop = (name, type) => ({ name, type });
export const day = (offset) => ({ offsetDays: offset });
