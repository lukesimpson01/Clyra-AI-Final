/* Brainstorm: an infinite board to think on.

   Sticky notes, text, shapes, drawings, pictures, frames and cards that point at your real notes, all on a canvas you pan and zoom.
   Hover anything and four points appear on its sides: drag from one to another item to connect them, or drop in empty space to
   make a new note there and connect it. A round toolbar floats at the bottom. The board is plain data (items and connections), kept
   in the block that holds it, so it saves and syncs like the rest of the page. */
import { el, clear, icon, iconButton, menu, toast } from "./dom.js";
import { api } from "./api.js";
import { state } from "./state.js";
import { openSearch } from "./search.js";
import { promptDialog } from "./slash-extras.js";

const COLORS = [["white", "#ffffff", "#2c2c2b"], ["yellow", "#fff3b0", "#7a5c00"], ["pink", "#ffd6e7", "#8f1f4f"], ["blue", "#cfe6ff", "#14508f"], ["green", "#d4f2dc", "#1d6a3a"], ["purple", "#e6dcff", "#4b2e96"], ["orange", "#ffe0c2", "#8a4a10"], ["gray", "#ececea", "#46453f"]];
const colorOf = (name) => COLORS.find(([id]) => id === name) || COLORS[0];
const SHAPES = [["rect", "Rectangle"], ["pill", "Rounded"], ["ellipse", "Ellipse"], ["diamond", "Diamond"], ["triangle", "Triangle"]];
const STICKERS = ["⭐", "❤️", "👍", "💡", "✅", "❓", "❗", "🔥", "🎯", "🚀", "⚠️", "🎉"];
const SIDES = ["t", "r", "b", "l"];
/* The board's own icons: one stroke weight, drawn for these tools. */
const GLYPHS = {
  select: "M5 4l14 6.6-6.1 1.8-1.9 6.1z", hand: "M8 12.5V6.8a1.4 1.4 0 0 1 2.8 0V11m0-4.7V5.3a1.4 1.4 0 0 1 2.8 0V11m0-4a1.4 1.4 0 0 1 2.8 0v6.2c0 3.3-2 5.8-5.4 5.8h-.6c-2.1 0-3.4-1-4.4-2.8L4.9 13a1.3 1.3 0 0 1 2.2-1.4L8 13",
  sticky: "M5 5h14v9.5L14.5 19H5zM14.5 19v-4.5H19", text: "M6 7V5.5h12V7M12 5.5v13M9.5 18.5h5",
  shape: "M4.5 4.5h8v8h-8zM16.5 12.5a4 4 0 1 1 0 8 4 4 0 0 1 0-8z", connect: "M3.8 18.4a1.8 1.8 0 1 0 3.6 0 1.8 1.8 0 0 0-3.6 0zM16.6 5.6a1.8 1.8 0 1 0 3.6 0 1.8 1.8 0 0 0-3.6 0zM7.4 18.2c6.8 0 3.6-11.4 9.2-11.4",
  pen: "M4.5 19.5l.9-3.9L16.3 4.7a2 2 0 0 1 2.8 2.8L8.2 18.6zM14.6 6.4l3 3", frame: "M8.5 3.5v17M15.5 3.5v17M3.5 8.5h17M3.5 15.5h17",
  note: "M7 3.5h7l4 4v13H7zM14 3.5v4h4M10 12h5M10 15.5h5", image: "M4 5.5h16v13H4zM4 16l5-5 4 4 3-3 4 4M9 9.4h.01", file: "M19.5 11.2l-7.7 7.7a4.8 4.8 0 0 1-6.8-6.8l8.3-8.3a3.2 3.2 0 0 1 4.6 4.6l-8.2 8.2a1.6 1.6 0 0 1-2.3-2.3l7.6-7.6",
  stamp: "M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17zM8.7 14.3c.9 1.3 2 1.9 3.3 1.9s2.4-.6 3.3-1.9M9 9.6h.01M15 9.6h.01",
  undo: "M8.5 6L4 10.5 8.5 15M4 10.5h10a5 5 0 0 1 0 10h-2.5", redo: "M15.5 6L20 10.5 15.5 15M20 10.5H10a5 5 0 0 0 0 10h2.5",
  expand: "M4 9.5V4h5.5M20 9.5V4h-5.5M4 14.5V20h5.5M20 14.5V20h-5.5", shrink: "M9.5 4v5.5H4M14.5 4v5.5H20M9.5 20v-5.5H4M14.5 20v-5.5H20",
};
const glyph = (name, size = 18) => {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24"); svg.setAttribute("width", String(size)); svg.setAttribute("height", String(size)); svg.setAttribute("fill", "none"); svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.6"); svg.setAttribute("stroke-linecap", "round"); svg.setAttribute("stroke-linejoin", "round"); svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path"); path.setAttribute("d", GLYPHS[name]); svg.append(path);
  return svg;
};
const fileSize = (bytes) => (bytes > 1_000_000 ? `${(bytes / 1_000_000).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1000))} KB`);
const uid = () => Math.random().toString(36).slice(2, 9);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export const emptyBoard = () => ({ items: [], edges: [], cam: { x: 0, y: 0, z: 1 } });

export class Brainstorm {
  constructor(host, { data, onChange, openPage, readOnly = false }) {
    this.host = host;
    this.data = { items: [], edges: [], cam: { x: 0, y: 0, z: 1 }, ...(data || {}) };
    this.data.items = this.data.items || []; this.data.edges = this.data.edges || [];
    this.onChange = onChange; this.openPage = openPage; this.readOnly = readOnly;
    this.tool = "select"; this.color = "white"; this.shape = "rect";
    this.selection = new Set(); this.nodes = new Map(); this.history = []; this.future = []; this.clipboard = [];
    this.space = false; this.saveTimer = 0; this.editing = null; this.titles = new Map();
    this.build();
    this.render();
    if (!this.data.items.length) this.fit(true);
  }

  /* --------------------------------------------------------------- shell */
  build() {
    this.root = el("div", { class: "bs", tabindex: "0", "aria-label": "Brainstorm board" });
    this.world = el("div", { class: "bs-world" });
    this.svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    this.svg.setAttribute("class", "bs-edges");
    this.edgeLayer = document.createElementNS("http://www.w3.org/2000/svg", "g");
    this.svg.append(this.edgeLayer);
    this.marquee = el("div", { class: "bs-marquee", hidden: true });
    this.world.append(this.svg);
    this.fullButton = el("button", { class: "bs-tool bs-small", type: "button", "aria-label": "Full screen", "data-tip": "Full screen" }, glyph("expand", 16));
    this.fullButton.addEventListener("click", (event) => { event.stopPropagation(); this.toggleFull(); });
    this.zoomLabel = el("button", { class: "bs-zoom-label", type: "button", "data-tip": "Fit to content", onclick: () => this.fit() });
    this.selbar = el("div", { class: "bs-selbar", hidden: true });
    this.toolbar = this.buildToolbar();
    this.hint = el("div", { class: "bs-hint" });
    this.root.append(this.world, this.marquee, this.selbar, this.toolbar,
      el("div", { class: "bs-history bs-pill" }, this.undoButton, this.redoButton),
      el("div", { class: "bs-corner bs-pill" }, this.zoomLabel, this.fullButton), this.hint);
    this.host.append(this.root);
    this.root.addEventListener("pointerdown", (event) => this.onDown(event));
    this.root.addEventListener("wheel", (event) => this.onWheel(event), { passive: false });
    this.root.addEventListener("dblclick", (event) => this.onDouble(event));
    this.root.addEventListener("keydown", (event) => this.onKey(event));
    /* keys typed on the board are the board's, not the page's behind it */
    this.root.addEventListener("keydown", (event) => event.stopPropagation());
    this.root.addEventListener("keyup", (event) => event.stopPropagation());
    this.root.addEventListener("keyup", (event) => { if (event.key === " ") { this.space = false; this.root.classList.remove("panning"); } });
    this.root.addEventListener("dragover", (event) => event.preventDefault());
    this.root.addEventListener("drop", (event) => this.onDrop(event));
    this.root.addEventListener("paste", (event) => this.onPaste(event));
    this.resizeObserver = new ResizeObserver(() => this.applyCam());
    this.resizeObserver.observe(this.root);
  }

  buildToolbar() {
    const bar = el("div", { class: "bs-toolbar", role: "toolbar", "aria-label": "Board tools" });
    this.toolButtons = new Map();
    const tool = (id, name, label, key, onPick, extra = "") => {
      const button = el("button", { class: `bs-tool${extra}`, type: "button", "aria-label": label, "aria-pressed": "false", "data-tip": key ? `${label}  ${key}` : label }, glyph(name, 18));
      button.addEventListener("click", (event) => { event.stopPropagation(); onPick ? onPick(button) : this.setTool(id); });
      this.toolButtons.set(id, button);
      return button;
    };
    const group = (...buttons) => el("div", { class: "bs-group" }, ...buttons);
    this.colorDot = el("button", { class: "bs-tool bs-color", type: "button", "aria-label": "Colour", "data-tip": "Colour" }, el("i"));
    this.colorDot.addEventListener("click", (event) => { event.stopPropagation(); this.colorMenu(this.colorDot, (name) => { this.color = name; this.paintToolbar(); if (this.selection.size) this.mutate(() => this.selected().forEach((item) => { if (item.type !== "pen") item.color = name; })); }); });
    this.undoButton = tool("undo", "undo", "Undo", "\u2318Z", () => this.undo(), " bs-small");
    this.redoButton = tool("redo", "redo", "Redo", "\u21e7\u2318Z", () => this.redo(), " bs-small");
    bar.append(
      group(tool("select", "select", "Select", "V"), tool("hand", "hand", "Hand", "H")),
      group(tool("sticky", "sticky", "Sticky note", "S"), tool("text", "text", "Text", "T"),
        tool("shape", "shape", "Shape", "R", (button) => menu(button, SHAPES.map(([id, label]) => ({ label, checked: this.shape === id, onSelect: () => { this.shape = id; this.setTool("shape"); } })), { side: "top", align: "center" })),
        tool("connect", "connect", "Connector", "C"), tool("pen", "pen", "Draw", "P"), tool("frame", "frame", "Frame", "F")),
      group(tool("note", "note", "Add a note", "N", () => this.addNoteCard()), tool("image", "image", "Add a picture", "I", () => this.pickImage()), tool("file", "file", "Attach a file", "", () => this.pickFile()),
        tool("stamp", "stamp", "Stamp", "", (button) => menu(button, STICKERS.map((g) => ({ label: g, icon: g, onSelect: () => this.placeAtCenter({ type: "emoji", text: g, w: 56, h: 56 }) })), { side: "top", align: "center", class: "bs-stamps" }))),
      group(this.colorDot),
    );
    return bar;
  }

  paintToolbar() {
    for (const [id, button] of this.toolButtons) { const on = id === this.tool && !["note", "image", "file", "stamp", "undo", "redo"].includes(id); button.classList.toggle("active", on); button.setAttribute("aria-pressed", String(on)); }
    const [, fill] = colorOf(this.color);
    this.colorDot.firstChild.style.background = fill;
    this.root.dataset.tool = this.tool;
    this.hint.textContent = { sticky: "Click to place a sticky note", text: "Click to add text", shape: "Click or drag to draw a shape", connect: "Drag from one item to another", pen: "Draw freehand", frame: "Drag to draw a frame", hand: "Drag to move around" }[this.tool] || "";
    this.hint.classList.toggle("on", Boolean(this.hint.textContent));
  }

  setTool(id) { this.tool = id; this.paintToolbar(); this.root.classList.toggle("connecting-mode", id === "connect"); }

  colorMenu(anchor, onPick) {
    let entry;
    const render = () => el("div", { class: "bs-swatches" }, COLORS.map(([id, fill]) => el("button", { class: `bs-swatch${id === this.color ? " on" : ""}`, type: "button", "aria-label": id, style: { background: fill }, onclick: () => { entry.close("select"); onPick(id); } })));
    entry = menu(anchor, [{ type: "custom", render }], { side: "top", align: "center", class: "bs-swatch-menu" });
  }

  toggleFull() {
    const full = this.root.classList.toggle("bs-full");
    document.body.classList.toggle("bs-locked", full);
    this.fullButton.firstChild?.replaceWith(glyph(full ? "shrink" : "expand", 16)); this.fullButton.dataset.tip = full ? "Exit full screen" : "Full screen";
    this.root.focus();
    requestAnimationFrame(() => this.applyCam());
  }

  /* ----------------------------------------------------------- coordinates */
  cam() { return this.data.cam; }
  toWorld(clientX, clientY) { const r = this.root.getBoundingClientRect(); const c = this.cam(); return { x: (clientX - r.left - c.x) / c.z, y: (clientY - r.top - c.y) / c.z }; }
  applyCam() {
    const c = this.cam();
    this.world.style.transform = `translate(${c.x}px, ${c.y}px) scale(${c.z})`;
    const g = 24 * c.z;
    this.root.style.backgroundSize = `${g}px ${g}px`;
    this.root.style.backgroundPosition = `${c.x}px ${c.y}px`;
    this.zoomLabel.textContent = `${Math.round(c.z * 100)}%`;
    this.root.style.setProperty("--z", String(c.z));
    this.positionSelbar();
  }
  fit(soft = false) {
    const items = this.data.items;
    const r = this.root.getBoundingClientRect();
    if (!items.length || !r.width) { this.data.cam = { x: r.width / 2, y: r.height / 2, z: 1 }; this.applyCam(); return; }
    const box = this.bounds(items);
    const z = clamp(Math.min((r.width - 160) / Math.max(box.w, 1), (r.height - 220) / Math.max(box.h, 1)), 0.2, 1.4);
    this.data.cam = { z, x: (r.width - box.w * z) / 2 - box.x * z, y: (r.height - 70 - box.h * z) / 2 - box.y * z };
    this.applyCam();
    if (!soft) this.queue();
  }
  bounds(items) {
    const xs = items.flatMap((i) => [i.x, i.x + i.w]), ys = items.flatMap((i) => [i.y, i.y + i.h]);
    const x = Math.min(...xs), y = Math.min(...ys);
    return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
  }
  zoomAt(factor, clientX, clientY) {
    const c = this.cam(); const r = this.root.getBoundingClientRect();
    const px = clientX - r.left, py = clientY - r.top;
    const z = clamp(c.z * factor, 0.1, 3);
    c.x = px - ((px - c.x) / c.z) * z; c.y = py - ((py - c.y) / c.z) * z; c.z = z;
    this.applyCam(); this.queue();
  }
  placeAtCenter(partial) {
    const r = this.root.getBoundingClientRect();
    const p = this.toWorld(r.left + r.width / 2, r.top + r.height / 2 - 30);
    /* each new item lands a little off the last one, so a run of them fans out instead of stacking */
    let x = p.x - (partial.w || 160) / 2, y = p.y - (partial.h || 160) / 2;
    while (this.data.items.some((other) => Math.abs(other.x - x) < 14 && Math.abs(other.y - y) < 14)) { x += 30; y += 30; }
    const item = this.makeItem({ ...partial, x, y });
    this.mutate(() => this.data.items.push(item));
    this.select([item.id]); this.setTool("select");
    return item;
  }

  /* -------------------------------------------------------------- data */
  makeItem(spec) {
    const base = { id: uid(), x: 0, y: 0, w: 160, h: 120, color: this.color, text: "", z: this.data.items.reduce((m, i) => Math.max(m, i.z || 0), 0) + 1 };
    const sizes = { sticky: { w: 168, h: 168 }, text: { w: 200, h: 36 }, shape: { w: 160, h: 110 }, frame: { w: 420, h: 280 }, note: { w: 230, h: 120 }, image: { w: 240, h: 160 }, file: { w: 250, h: 72 }, emoji: { w: 56, h: 56 } };
    return { ...base, ...(sizes[spec.type] || {}), ...spec };
  }
  selected() { return this.data.items.filter((item) => this.selection.has(item.id)); }
  item(id) { return this.data.items.find((entry) => entry.id === id); }

  snapshot() { return JSON.stringify({ items: this.data.items, edges: this.data.edges }); }
  mutate(change) {
    this.history.push(this.snapshot()); if (this.history.length > 80) this.history.shift(); this.future = [];
    change();
    this.render(); this.queue();
  }
  restore(json) { const { items, edges } = JSON.parse(json); this.data.items = items; this.data.edges = edges; this.selection = new Set([...this.selection].filter((id) => this.item(id))); this.render(); this.queue(); }
  undo() { if (!this.history.length) return; this.future.push(this.snapshot()); this.restore(this.history.pop()); }
  redo() { if (!this.future.length) return; this.history.push(this.snapshot()); this.restore(this.future.pop()); }
  queue() { clearTimeout(this.saveTimer); this.saveTimer = setTimeout(() => this.onChange?.({ items: this.data.items, edges: this.data.edges, cam: this.data.cam }), 400); }
  flush() { clearTimeout(this.saveTimer); this.onChange?.({ items: this.data.items, edges: this.data.edges, cam: this.data.cam }); }
  destroy() { this.flush(); this.resizeObserver?.disconnect(); document.body.classList.remove("bs-locked"); this.root.remove(); }

  /* ------------------------------------------------------------- render */
  render() {
    const seen = new Set();
    for (const item of this.data.items) {
      seen.add(item.id);
      let node = this.nodes.get(item.id);
      if (!node) { node = this.buildItem(item); this.nodes.set(item.id, node); this.world.append(node); }
      this.paintItem(node, item);
    }
    for (const [id, node] of this.nodes) if (!seen.has(id)) { node.remove(); this.nodes.delete(id); }
    this.renderEdges();
    this.paintToolbar();
    this.applyCam();
  }

  buildItem(item) {
    const node = el("div", { class: `bs-item bs-${item.type}`, "data-id": item.id });
    node.append(el("div", { class: "bs-body" }));
    for (const side of SIDES) node.append(el("i", { class: `bs-pt bs-pt-${side}`, "data-side": side, "data-id": item.id }));
    if (["sticky", "shape", "frame", "image", "note"].includes(item.type)) node.append(el("i", { class: "bs-grip", "data-grip": item.id, "aria-hidden": "true" }));
    return node;
  }

  paintItem(node, item) {
    const [, fill, ink] = colorOf(item.color);
    node.style.cssText = `left:${item.x}px;top:${item.y}px;width:${item.w}px;height:${item.h}px;z-index:${item.z || 1};--fill:${fill};--ink:${ink};`;
    node.classList.toggle("selected", this.selection.has(item.id));
    node.dataset.shape = item.shape || ""; node.dataset.color = item.color || "white";
    const body = node.querySelector(".bs-body");
    if (this.editing === item.id) return;
    if (item.type === "pen") {
      const box = this.penBox(item);
      body.innerHTML = `<svg viewBox="${box.x} ${box.y} ${Math.max(box.w, 1)} ${Math.max(box.h, 1)}" width="100%" height="100%" preserveAspectRatio="none"><path d="${this.penPath(item.points)}" fill="none" stroke="${ink}" stroke-width="${3 / Math.max(this.cam().z, 0.3)}" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    } else if (item.type === "image") {
      if (body.firstChild?.tagName !== "IMG") { body.replaceChildren(el("img", { src: item.src, alt: "", draggable: "false" })); }
    } else if (item.type === "note") this.paintNoteCard(body, item);
    else if (item.type === "file") body.replaceChildren(el("span", { class: "bs-file-ico" }, glyph("file", 20)), el("span", { class: "bs-file-text" }, el("b", { text: item.name || "File" }), el("small", { text: `${(String(item.name || "").split(".").pop() || "file").toUpperCase().slice(0, 5)}${item.size ? ` \u00B7 ${fileSize(item.size)}` : ""}` })));
    else if (item.type === "emoji") body.textContent = item.text;
    else if (item.type === "shape") body.replaceChildren(this.shapeSvg(item), el("span", { class: "bs-text", text: item.text || "" }));
    else if (item.type === "frame") body.replaceChildren(el("span", { class: "bs-frame-label", text: item.text || "Frame" }));
    else body.textContent = item.text || (item.type === "text" ? "" : "");
    node.classList.toggle("empty", !item.text && ["sticky", "text", "shape"].includes(item.type));
  }

  shapeSvg(item) {
    const NS = "http://www.w3.org/2000/svg";
    const [, fill, ink] = colorOf(item.color);
    const svg = document.createElementNS(NS, "svg"); svg.setAttribute("viewBox", `0 0 ${item.w} ${item.h}`); svg.setAttribute("preserveAspectRatio", "none"); svg.setAttribute("class", "bs-shape-svg");
    const w = item.w, h = item.h;
    const shape = { rect: () => { const r = document.createElementNS(NS, "rect"); r.setAttribute("x", 1); r.setAttribute("y", 1); r.setAttribute("width", w - 2); r.setAttribute("height", h - 2); r.setAttribute("rx", 6); return r; },
      pill: () => { const r = document.createElementNS(NS, "rect"); r.setAttribute("x", 1); r.setAttribute("y", 1); r.setAttribute("width", w - 2); r.setAttribute("height", h - 2); r.setAttribute("rx", h / 2); return r; },
      ellipse: () => { const e = document.createElementNS(NS, "ellipse"); e.setAttribute("cx", w / 2); e.setAttribute("cy", h / 2); e.setAttribute("rx", w / 2 - 1); e.setAttribute("ry", h / 2 - 1); return e; },
      diamond: () => { const p = document.createElementNS(NS, "polygon"); p.setAttribute("points", `${w / 2},1 ${w - 1},${h / 2} ${w / 2},${h - 1} 1,${h / 2}`); return p; },
      triangle: () => { const p = document.createElementNS(NS, "polygon"); p.setAttribute("points", `${w / 2},1 ${w - 1},${h - 1} 1,${h - 1}`); return p; } }[item.shape || "rect"]();
    shape.setAttribute("fill", fill); shape.setAttribute("stroke", ink); shape.setAttribute("stroke-opacity", ".55"); shape.setAttribute("stroke-width", "1.5"); shape.setAttribute("vector-effect", "non-scaling-stroke");
    svg.append(shape);
    return svg;
  }

  penPath(points) { return (points || []).map((p, i) => `${i ? "L" : "M"}${p[0]} ${p[1]}`).join(" "); }
  penBox(item) { const xs = item.points.map((p) => p[0]), ys = item.points.map((p) => p[1]); const x = Math.min(...xs) - 2, y = Math.min(...ys) - 2; return { x, y, w: Math.max(...xs) - x + 2, h: Math.max(...ys) - y + 2 }; }

  /* A card that points at one of your notes: its emoji, its title as it is now, and the first lines. */
  paintNoteCard(body, item) {
    const meta = state.pageById?.get(String(item.pageId));
    const title = meta?.title || item.text || "Untitled";
    body.replaceChildren(el("div", { class: "bs-note-head" }, el("span", { class: "bs-note-icon", text: meta?.icon || "" }, meta?.icon ? null : icon("page", 15)), el("span", { class: "bs-note-title", text: title })),
      el("div", { class: "bs-note-snippet", text: this.titles.get(item.pageId) || "" }), el("div", { class: "bs-note-open", text: "Open note" }));
    if (!this.titles.has(item.pageId) && item.pageId) {
      this.titles.set(item.pageId, "");
      api.get(`/api/notes/pages/${item.pageId}`).then((page) => {
        const text = (page.blocks || []).flatMap(function walk(b) { return [(b.text || []).map((s) => s.t).join(""), ...(b.children || []).flatMap(walk)]; }).filter(Boolean).join(" · ").slice(0, 150);
        this.titles.set(item.pageId, text); const node = this.nodes.get(item.id); if (node && this.editing !== item.id) this.paintNoteCard(node.querySelector(".bs-body"), item);
      }).catch(() => {});
    }
  }

  /* -------------------------------------------------------- connections */
  anchor(item, side) { return { t: [item.x + item.w / 2, item.y], r: [item.x + item.w, item.y + item.h / 2], b: [item.x + item.w / 2, item.y + item.h], l: [item.x, item.y + item.h / 2] }[side]; }
  end(ref) { if (ref.item) { const item = this.item(ref.item); return item ? { p: this.anchor(item, ref.side), side: ref.side } : null; } return { p: [ref.x, ref.y], side: null }; }
  normal(side) { return { t: [0, -1], r: [1, 0], b: [0, 1], l: [-1, 0] }[side] || [0, 0]; }
  edgePath(a, b, style) {
    const [x1, y1] = a.p, [x2, y2] = b.p;
    if (style === "straight") return `M${x1} ${y1} L${x2} ${y2}`;
    const d = Math.max(50, Math.hypot(x2 - x1, y2 - y1) / 2.4);
    const na = this.normal(a.side || (Math.abs(x2 - x1) > Math.abs(y2 - y1) ? (x2 > x1 ? "r" : "l") : (y2 > y1 ? "b" : "t")));
    const nb = this.normal(b.side || (Math.abs(x2 - x1) > Math.abs(y2 - y1) ? (x2 > x1 ? "l" : "r") : (y2 > y1 ? "t" : "b")));
    if (style === "elbow") {
      const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
      return Math.abs(na[0]) ? `M${x1} ${y1} L${mx} ${y1} L${mx} ${y2} L${x2} ${y2}` : `M${x1} ${y1} L${x1} ${my} L${x2} ${my} L${x2} ${y2}`;
    }
    return `M${x1} ${y1} C${x1 + na[0] * d} ${y1 + na[1] * d}, ${x2 + nb[0] * d} ${y2 + nb[1] * d}, ${x2} ${y2}`;
  }
  arrowHead(a, b, size) {
    const [x1, y1] = a, [x2, y2] = b; const ang = Math.atan2(y2 - y1, x2 - x1);
    const p = (da, r) => `${x2 - r * Math.cos(ang + da)},${y2 - r * Math.sin(ang + da)}`;
    return `${x2},${y2} ${p(0.45, size)} ${p(-0.45, size)}`;
  }
  renderEdges() {
    const NS = "http://www.w3.org/2000/svg";
    this.edgeLayer.replaceChildren();
    for (const edge of this.data.edges) {
      const a = this.end(edge.from), b = this.end(edge.to);
      if (!a || !b) continue;
      const [, , ink] = colorOf(edge.color || "gray");
      const d = this.edgePath(a, b, edge.style || "curve");
      const group = document.createElementNS(NS, "g"); group.setAttribute("class", `bs-edge${this.selection.has(edge.id) ? " selected" : ""}`); group.dataset.edge = edge.id;
      const hit = document.createElementNS(NS, "path"); hit.setAttribute("d", d); hit.setAttribute("class", "bs-edge-hit");
      const line = document.createElementNS(NS, "path"); line.setAttribute("d", d); line.setAttribute("class", "bs-edge-line"); line.setAttribute("stroke", ink);
      group.append(hit, line);
      const tip = (at, side, otherEnd) => {
        const n = this.normal(side);
        const from = side ? [at[0] + n[0] * 30, at[1] + n[1] * 30] : otherEnd;
        const h = document.createElementNS(NS, "polygon"); h.setAttribute("points", this.arrowHead(from, at, 12)); h.setAttribute("fill", ink); group.append(h);
      };
      if ((edge.arrow || "end") !== "none") tip(b.p, b.side, a.p);
      if (edge.arrow === "both") tip(a.p, a.side, b.p);
      if (edge.label) { const t = document.createElementNS(NS, "text"); t.setAttribute("x", (a.p[0] + b.p[0]) / 2); t.setAttribute("y", (a.p[1] + b.p[1]) / 2 - 6); t.setAttribute("text-anchor", "middle"); t.setAttribute("class", "bs-edge-label"); t.textContent = edge.label; group.append(t); }
      this.edgeLayer.append(group);
    }
    if (this.draft) {
      const line = document.createElementNS(NS, "path"); line.setAttribute("d", this.draft.d); line.setAttribute("class", "bs-edge-line draft"); this.edgeLayer.append(line);
    }
  }

  /* ----------------------------------------------------------- selection */
  select(ids, add = false) {
    if (!add) this.selection.clear();
    ids.forEach((id) => this.selection.add(id));
    this.render(); this.paintSelbar();
  }
  paintSelbar() {
    const items = this.selected(); const edge = this.data.edges.find((e) => this.selection.has(e.id));
    clear(this.selbar);
    this.selbar.hidden = !items.length && !edge;
    if (this.selbar.hidden) return;
    const button = (glyph, label, onClick) => iconButton(glyph, label, onClick, { size: 15, className: "bs-sel-btn" });
    if (edge) {
      this.selbar.append(
        button("link", "Curved", () => this.mutate(() => { edge.style = "curve"; })), button("align_left", "Straight", () => this.mutate(() => { edge.style = "straight"; })), button("list", "Elbow", () => this.mutate(() => { edge.style = "elbow"; })),
        button("arrow_right", "Arrow", () => this.mutate(() => { edge.arrow = edge.arrow === "none" ? "end" : "none"; })), button("pencil", "Label", () => promptDialog({ title: "Connector label", confirm: "Save", fields: [{ label: "Label", value: edge.label || "" }], onSubmit: ([label]) => this.mutate(() => { edge.label = label; }) })), button("trash", "Delete", () => this.removeSelection()));
    } else {
      const swatch = el("button", { class: "bs-sel-color", type: "button", "aria-label": "Colour" }, el("i", { style: { background: colorOf(items[0].color)[1] } }));
      swatch.addEventListener("click", () => this.colorMenu(swatch, (name) => this.mutate(() => items.forEach((i) => { if (i.type !== "pen") i.color = name; }))));
      this.selbar.append(swatch, button("duplicate", "Duplicate", () => this.duplicate()), button("arrow_up", "Bring to front", () => this.mutate(() => items.forEach((i) => { i.z = Math.max(...this.data.items.map((x) => x.z || 0)) + 1; }))), button("arrow_down", "Send to back", () => this.mutate(() => items.forEach((i) => { i.z = Math.min(...this.data.items.map((x) => x.z || 0)) - 1; }))), button("trash", "Delete", () => this.removeSelection()));
    }
    this.positionSelbar();
  }
  positionSelbar() {
    if (this.selbar.hidden) return;
    const items = this.selected(); const c = this.cam(); const r = this.root.getBoundingClientRect();
    let box;
    if (items.length) box = this.bounds(items);
    else { const edge = this.data.edges.find((e) => this.selection.has(e.id)); const a = edge && this.end(edge.from), b = edge && this.end(edge.to); if (!a || !b) return; box = { x: Math.min(a.p[0], b.p[0]), y: Math.min(a.p[1], b.p[1]), w: Math.abs(a.p[0] - b.p[0]), h: Math.abs(a.p[1] - b.p[1]) }; }
    const w = this.selbar.offsetWidth || 220;
    this.selbar.style.left = `${clamp(box.x * c.z + c.x + (box.w * c.z) / 2 - w / 2, 8, r.width - w - 8)}px`;
    this.selbar.style.top = `${Math.max(8, box.y * c.z + c.y - 52)}px`;
  }
  removeSelection() {
    const ids = new Set(this.selection);
    this.mutate(() => { this.data.items = this.data.items.filter((i) => !ids.has(i.id)); this.data.edges = this.data.edges.filter((e) => !ids.has(e.id) && !(e.from.item && ids.has(e.from.item)) && !(e.to.item && ids.has(e.to.item))); });
    this.selection.clear(); this.paintSelbar();
  }
  duplicate() {
    const copies = this.selected().map((i) => ({ ...JSON.parse(JSON.stringify(i)), id: uid(), x: i.x + 28, y: i.y + 28 }));
    if (!copies.length) return;
    this.mutate(() => this.data.items.push(...copies));
    this.select(copies.map((c) => c.id));
  }

  /* --------------------------------------------------------------- input */
  onWheel(event) {
    /* inside a page the board only takes the wheel once it is in use, so scrolling past it still works */
    if (!this.root.classList.contains("bs-full") && !event.ctrlKey && !event.metaKey && document.activeElement !== this.root) return;
    event.preventDefault();
    if (event.ctrlKey || event.metaKey) this.zoomAt(Math.exp(-event.deltaY * 0.01), event.clientX, event.clientY);
    else { const c = this.cam(); c.x -= event.deltaX; c.y -= event.deltaY; this.applyCam(); this.queue(); }
  }

  itemFrom(target) { return target.closest?.(".bs-item"); }

  onDown(event) {
    if (this.readOnly || event.button === 2) return;
    if (event.target.closest(".bs-toolbar, .bs-selbar, .bs-pill")) return;
    this.root.focus({ preventScroll: true });
    this.finishEdit();
    const point = this.toWorld(event.clientX, event.clientY);
    const target = event.target;

    if (event.button === 1 || this.space || this.tool === "hand") return this.startPan(event);

    const pt = target.closest?.(".bs-pt");
    if (pt) return this.startConnect(event, pt.dataset.id, pt.dataset.side);
    const edgeNode = target.closest?.(".bs-edge");
    if (edgeNode && this.tool === "select") { this.select([edgeNode.dataset.edge]); return; }

    const grip = target.closest?.("[data-grip]");
    if (grip) return this.startResize(event, grip.dataset.grip);

    if (this.tool === "sticky") { const item = this.makeItem({ type: "sticky", x: point.x - 84, y: point.y - 84 }); this.mutate(() => this.data.items.push(item)); this.setTool("select"); this.select([item.id]); return this.edit(item.id); }
    if (this.tool === "text") { const item = this.makeItem({ type: "text", x: point.x - 6, y: point.y - 14, color: "white" }); this.mutate(() => this.data.items.push(item)); this.setTool("select"); this.select([item.id]); return this.edit(item.id); }
    if (this.tool === "shape" || this.tool === "frame") return this.startDraw(event, point);
    if (this.tool === "pen") return this.startPen(event, point);

    const node = this.itemFrom(target);
    if (node) {
      const id = node.dataset.id;
      if (event.shiftKey) { this.selection.has(id) ? this.selection.delete(id) : this.selection.add(id); this.render(); this.paintSelbar(); return; }
      if (!this.selection.has(id)) this.select([id]);
      return this.startDrag(event, point);
    }
    this.startMarquee(event, point);
  }

  startPan(event) {
    this.root.classList.add("panning");
    const c = this.cam(); const sx = event.clientX, sy = event.clientY, ox = c.x, oy = c.y;
    const move = (e) => { c.x = ox + e.clientX - sx; c.y = oy + e.clientY - sy; this.applyCam(); };
    const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); this.root.classList.remove("panning"); this.queue(); };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", up);
  }

  startDrag(event, start) {
    const items = this.selected(); const origin = items.map((i) => [i.x, i.y]); let moved = false;
    this.history.push(this.snapshot());
    const move = (e) => {
      const p = this.toWorld(e.clientX, e.clientY); const dx = p.x - start.x, dy = p.y - start.y;
      if (!moved && Math.hypot(dx, dy) < 3 / this.cam().z) return; moved = true;
      items.forEach((i, n) => { i.x = origin[n][0] + dx; i.y = origin[n][1] + dy; });
      this.render(); this.positionSelbar();
    };
    const up = () => {
      window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up);
      if (!moved) { this.history.pop(); const node = this.itemFrom(event.target); const item = node && this.item(node.dataset.id); if (item?.type === "note" && (event.metaKey || event.ctrlKey)) this.openPage?.(item.pageId); this.paintSelbar(); return; }
      this.future = []; this.queue(); this.paintSelbar();
    };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", up);
  }

  startResize(event, id) {
    event.stopPropagation(); event.preventDefault();
    const item = this.item(id); const start = this.toWorld(event.clientX, event.clientY); const w0 = item.w, h0 = item.h;
    this.history.push(this.snapshot());
    const move = (e) => { const p = this.toWorld(e.clientX, e.clientY); item.w = Math.max(60, w0 + p.x - start.x); item.h = Math.max(item.type === "text" ? 28 : 44, h0 + p.y - start.y); this.render(); this.positionSelbar(); };
    const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); this.future = []; this.queue(); };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", up);
  }

  startMarquee(event, start) {
    const r = this.root.getBoundingClientRect(); const additive = event.shiftKey;
    if (!additive) { this.selection.clear(); this.render(); this.paintSelbar(); }
    const base = new Set(this.selection);
    const move = (e) => {
      const p = this.toWorld(e.clientX, e.clientY);
      const x = Math.min(p.x, start.x), y = Math.min(p.y, start.y), w = Math.abs(p.x - start.x), h = Math.abs(p.y - start.y);
      const c = this.cam();
      Object.assign(this.marquee.style, { left: `${x * c.z + c.x}px`, top: `${y * c.z + c.y}px`, width: `${w * c.z}px`, height: `${h * c.z}px` }); this.marquee.hidden = false;
      const hit = this.data.items.filter((i) => i.x < x + w && i.x + i.w > x && i.y < y + h && i.y + i.h > y).map((i) => i.id);
      this.selection = new Set([...base, ...hit]);
      for (const [id, node] of this.nodes) node.classList.toggle("selected", this.selection.has(id));
    };
    const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); this.marquee.hidden = true; this.paintSelbar(); };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", up);
    void r;
  }

  startDraw(event, start) {
    const type = this.tool === "frame" ? "frame" : "shape";
    const item = this.makeItem({ type, shape: this.shape, x: start.x, y: start.y, w: 4, h: 4, color: type === "frame" ? "gray" : this.color, text: type === "frame" ? "Frame" : "" });
    this.history.push(this.snapshot()); this.data.items.push(item); this.render(); let dragged = false;
    const move = (e) => { const p = this.toWorld(e.clientX, e.clientY); dragged = true; item.x = Math.min(p.x, start.x); item.y = Math.min(p.y, start.y); item.w = Math.max(20, Math.abs(p.x - start.x)); item.h = Math.max(20, Math.abs(p.y - start.y)); this.render(); };
    const up = () => {
      window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up);
      if (!dragged) { const d = type === "frame" ? { w: 420, h: 280 } : { w: 160, h: 110 }; item.x = start.x - d.w / 2; item.y = start.y - d.h / 2; item.w = d.w; item.h = d.h; }
      this.future = []; this.setTool("select"); this.select([item.id]); this.queue(); if (type === "shape") this.edit(item.id);
    };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", up);
  }

  startPen(event, start) {
    const item = this.makeItem({ type: "pen", points: [[start.x, start.y]], color: this.color === "white" ? "gray" : this.color, x: start.x, y: start.y, w: 4, h: 4 });
    this.history.push(this.snapshot()); this.data.items.push(item); this.render();
    const move = (e) => {
      const p = this.toWorld(e.clientX, e.clientY); const last = item.points[item.points.length - 1];
      if (Math.hypot(p.x - last[0], p.y - last[1]) < 2.5) return; item.points.push([Math.round(p.x), Math.round(p.y)]);
      const box = this.penBox(item); Object.assign(item, { x: box.x, y: box.y, w: Math.max(box.w, 4), h: Math.max(box.h, 4) }); this.render();
    };
    const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); if (item.points.length < 2) { this.data.items = this.data.items.filter((i) => i !== item); this.history.pop(); this.render(); return; } this.future = []; this.queue(); };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", up);
  }

  /* Drag from a point on one item to another item (or into empty space to make a new note there). */
  startConnect(event, fromId, fromSide) {
    event.stopPropagation(); event.preventDefault();
    const from = this.item(fromId); if (!from) return;
    this.root.classList.add("connecting");
    const a = { p: this.anchor(from, fromSide), side: fromSide }; let hover = null;
    const move = (e) => {
      const p = this.toWorld(e.clientX, e.clientY);
      const under = document.elementFromPoint(e.clientX, e.clientY)?.closest?.(".bs-item"); const target = under && under.dataset.id !== fromId ? this.item(under.dataset.id) : null;
      this.nodes.forEach((n) => n.classList.remove("target")); hover = null;
      let b = { p: [p.x, p.y], side: null };
      if (target) { under.classList.add("target"); const side = this.nearestSide(target, p); hover = { item: target.id, side }; b = { p: this.anchor(target, side), side }; }
      this.draft = { d: this.edgePath(a, b, "curve") }; this.renderEdges();
    };
    const up = (e) => {
      window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up);
      this.root.classList.remove("connecting"); this.nodes.forEach((n) => n.classList.remove("target")); this.draft = null;
      const p = this.toWorld(e.clientX, e.clientY);
      if (!hover && Math.hypot(p.x - a.p[0], p.y - a.p[1]) < 18) { this.renderEdges(); return; }
      const edge = { id: uid(), from: { item: fromId, side: fromSide }, to: hover || null, style: "curve", arrow: "end", color: "gray" };
      if (hover) this.mutate(() => this.data.edges.push(edge));
      else {
        const dir = this.normal(fromSide); const note = this.makeItem({ type: "sticky", x: p.x - 84 + dir[0] * 20, y: p.y - 84 + dir[1] * 20 });
        const toSide = { t: "b", b: "t", l: "r", r: "l" }[fromSide]; edge.to = { item: note.id, side: toSide };
        this.mutate(() => { this.data.items.push(note); this.data.edges.push(edge); });
        this.select([note.id]); this.edit(note.id);
      }
      this.renderEdges();
    };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", up);
  }
  nearestSide(item, p) {
    const dist = { t: Math.abs(p.y - item.y), b: Math.abs(p.y - (item.y + item.h)), l: Math.abs(p.x - item.x), r: Math.abs(p.x - (item.x + item.w)) };
    return Object.entries(dist).sort((a, b) => a[1] - b[1])[0][0];
  }

  /* ---------------------------------------------------------- editing text */
  onDouble(event) {
    const node = this.itemFrom(event.target); if (!node || this.readOnly) return;
    const item = this.item(node.dataset.id);
    if (item.type === "note") { this.openPage?.(item.pageId); return; }
    if (item.type === "file") { if (item.url) window.open(item.url, "_blank", "noopener"); return; }
    if (["sticky", "text", "shape", "frame"].includes(item.type)) this.edit(item.id);
  }
  edit(id) {
    const item = this.item(id); const node = this.nodes.get(id); if (!item || !node) return;
    this.editing = id; const body = node.querySelector(".bs-body");
    const field = el("div", { class: "bs-editor", contenteditable: "true", spellcheck: "false", role: "textbox" });
    field.textContent = item.text || "";
    body.replaceChildren(field); field.focus();
    const range = document.createRange(); range.selectNodeContents(field); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(range);
    field.addEventListener("keydown", (e) => { e.stopPropagation(); if (e.key === "Escape") { this.finishEdit(); this.root.focus(); } if (e.key === "Enter" && !e.shiftKey && item.type === "text") { e.preventDefault(); this.finishEdit(); this.root.focus(); } });
    field.addEventListener("blur", () => this.finishEdit());
    this.history.push(this.snapshot());
  }
  finishEdit() {
    if (!this.editing) return;
    const id = this.editing; this.editing = null;
    const node = this.nodes.get(id); const item = this.item(id); const field = node?.querySelector(".bs-editor");
    if (!item) return;
    if (field) {
      const text = field.innerText.replace(/\n+$/, "");
      if (item.type === "text" && !text.trim()) { this.data.items = this.data.items.filter((i) => i.id !== id); this.history.pop(); }
      else { item.text = text; if (item.type === "text") { item.w = Math.max(80, Math.min(520, text.length * 9 + 24)); item.h = Math.max(36, Math.ceil(text.length / 56) * 28 + 12); } this.future = []; this.queue(); }
    }
    this.render();
  }

  /* ------------------------------------------------------------- keyboard */
  onKey(event) {
    if (this.readOnly || this.editing || event.target.closest?.(".bs-editor")) return;
    const meta = event.metaKey || event.ctrlKey; const key = event.key.toLowerCase();
    if (event.key === " ") { this.space = true; this.root.classList.add("panning"); event.preventDefault(); return; }
    if (meta && key === "z") { event.preventDefault(); event.shiftKey ? this.redo() : this.undo(); return; }
    if (meta && key === "d") { event.preventDefault(); this.duplicate(); return; }
    if (meta && key === "a") { event.preventDefault(); this.select(this.data.items.map((i) => i.id)); return; }
    if (meta && key === "c") { this.clipboard = JSON.parse(JSON.stringify(this.selected())); return; }
    if (meta && key === "v" && this.clipboard.length) { event.preventDefault(); const copies = this.clipboard.map((i) => ({ ...i, id: uid(), x: i.x + 32, y: i.y + 32 })); this.mutate(() => this.data.items.push(...copies)); this.select(copies.map((c) => c.id)); return; }
    if (meta && (key === "=" || key === "+")) { event.preventDefault(); const r = this.root.getBoundingClientRect(); this.zoomAt(1.2, r.left + r.width / 2, r.top + r.height / 2); return; }
    if (meta && key === "-") { event.preventDefault(); const r = this.root.getBoundingClientRect(); this.zoomAt(1 / 1.2, r.left + r.width / 2, r.top + r.height / 2); return; }
    if (meta && key === "0") { event.preventDefault(); this.fit(); return; }
    if (event.key === "Delete" || event.key === "Backspace") { if (this.selection.size) { event.preventDefault(); this.removeSelection(); } return; }
    if (event.key === "Escape") { if (this.root.classList.contains("bs-full")) this.toggleFull(); else { this.selection.clear(); this.setTool("select"); this.render(); this.paintSelbar(); } return; }
    if (event.key === "Enter" && this.selection.size === 1) { const only = this.selected()[0]; if (only) { event.preventDefault(); this.edit(only.id); } return; }
    if (event.key.startsWith("Arrow") && this.selection.size) { event.preventDefault(); const step = event.shiftKey ? 20 : 4; const [dx, dy] = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[event.key]; this.mutate(() => this.selected().forEach((i) => { i.x += dx; i.y += dy; })); return; }
    if (meta) return;
    const tools = { v: "select", h: "hand", s: "sticky", t: "text", r: "shape", c: "connect", p: "pen", f: "frame" };
    if (tools[key]) { event.preventDefault(); this.setTool(tools[key]); }
    if (key === "n") { event.preventDefault(); this.addNoteCard(); }
    if (key === "i") { event.preventDefault(); this.pickImage(); }
  }

  /* ----------------------------------------------------- notes and pictures */
  addNoteCard() {
    openSearch({ title: "Add a note to the board", onSelect: (page) => {
      const id = String(page.page_id || page.id);
      this.placeAtCenter({ type: "note", pageId: id, text: page.title || "", color: "white" });
    } });
  }
  pickImage() {
    const input = el("input", { type: "file", accept: "image/*", multiple: "true", style: { display: "none" } });
    input.addEventListener("change", () => { const files = [...input.files]; input.remove(); files.forEach((file) => this.addFile(file)); });
    document.body.append(input); input.click();
  }
  pickFile() {
    const input = el("input", { type: "file", multiple: "true", style: { display: "none" } });
    input.addEventListener("change", () => { const files = [...input.files]; input.remove(); files.forEach((file) => this.addFile(file)); });
    document.body.append(input); input.click();
  }
  async upload(file) { const { uploadFile } = await import("./editor.js"); return uploadFile(file); }
  /* A picture goes on the board as a picture; anything else becomes a file card you can open. Small pictures live in the board
     itself; bigger ones and every other file are uploaded to the workspace. */
  async addFile(file, at) {
    const put = (partial, w, h) => {
      if (at) { const item = this.makeItem({ ...partial, w, h, x: at.x - w / 2, y: at.y - h / 2 }); this.mutate(() => this.data.items.push(item)); this.select([item.id]); }
      else this.placeAtCenter({ ...partial, w, h });
    };
    try {
      if (file.type.startsWith("image/")) {
        const src = file.size > 300_000 ? (await this.upload(file)).url : await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(file); });
        const image = new Image();
        image.onload = () => { const w = Math.min(320, image.naturalWidth || 320); put({ type: "image", src, color: "white" }, w, Math.round(w * ((image.naturalHeight || 200) / (image.naturalWidth || 320)))); };
        image.onerror = () => toast("That picture could not be read");
        image.src = src;
      } else {
        toast(`Uploading ${file.name}\u2026`);
        const stored = await this.upload(file);
        put({ type: "file", url: stored.url, name: stored.name || file.name, size: stored.size || file.size, color: "white" }, 250, 72);
      }
    } catch (error) { toast(error?.message || "Could not add that file"); }
  }
  onDrop(event) {
    event.preventDefault();
    const at = this.toWorld(event.clientX, event.clientY);
    const files = [...(event.dataTransfer?.files || [])];
    if (files.length) { files.forEach((file, i) => this.addFile(file, { x: at.x + i * 24, y: at.y + i * 24 })); return; }
    /* a note dragged out of the sidebar becomes a card for that note */
    const id = event.dataTransfer?.getData("text/plain");
    const meta = id && state.pageById?.get(String(id));
    if (meta) { const item = this.makeItem({ type: "note", pageId: String(id), text: meta.title || "", color: "white", x: at.x - 115, y: at.y - 50 }); this.mutate(() => this.data.items.push(item)); this.select([item.id]); }
  }
  onPaste(event) { const files = [...(event.clipboardData?.files || [])]; if (files.length) { event.preventDefault(); files.forEach((file) => this.addFile(file)); } }
}
