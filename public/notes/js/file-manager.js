/* The workspace as files and folders, in the left sidebar: a list or a grid,
   with the page tree as the folder structure. Anything can be dragged into a
   folder or onto a path crumb, renamed in place, duplicated, exported or
   trashed, from the keyboard or the context menu, the way a drive behaves. */
import { el, clear, icon, menu, toast, confirmDialog, append, modKey } from "./dom.js";
import { api } from "./api.js";
import { state, childrenOf, hasChildren, refreshPages, withError, getPageMeta } from "./state.js";
import { formatRelative } from "./app.js";
import { pagePreview } from "./page-preview.js";
import { shortcutLabel } from "./preferences.js";

const VIEW_KEY = "clyra-notes:files-view";
const SORT_KEY = "clyra-notes:files-sort";
const read = (key, fallback) => { try { return localStorage.getItem(key) || fallback; } catch { return fallback; } };
const write = (key, value) => { try { localStorage.setItem(key, value); } catch { /* not persisted */ } };
const DRAG = "application/x-clyra-pages";

const svg = (paths, size = 18) => {
  const node = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  node.setAttribute("viewBox", "0 0 20 20"); node.setAttribute("width", size); node.setAttribute("height", size); node.setAttribute("fill", "none"); node.setAttribute("stroke", "currentColor"); node.setAttribute("stroke-width", "1.4"); node.setAttribute("stroke-linejoin", "round");
  node.innerHTML = paths;
  return node;
};
const folderIcon = (size) => svg('<path d="M2.5 6.2c0-.9.7-1.6 1.6-1.6h3.2l1.7 1.9h6.9c.9 0 1.6.7 1.6 1.6v6.1c0 .9-.7 1.6-1.6 1.6H4.1c-.9 0-1.6-.7-1.6-1.6z"/>', size);

const isFolder = (page) => page.icon === "\u{1F4C1}" || hasChildren(page.id);
const emojiOf = (page) => (page.icon && !/^https?:|^\//.test(page.icon) && page.icon !== "\u{1F4C1}" ? page.icon : null);
const kindOf = (page) => (isFolder(page) ? "Folder" : page.kind === "database" ? "Database" : "Note");

export class FileManager {
  constructor(app, options = {}) {
    this.app = app;
    this.wide = Boolean(options.page);
    this.folder = null;
    this.view = read(VIEW_KEY, "list");
    this.sort = read(SORT_KEY, "name");
    this.selected = new Set();
    this.filter = "";
    this.anchorId = null;
    this.node = el("div", { class: `fm${this.wide ? " fm-page" : ""}` });
  }

  items() {
    const text = this.filter.trim().toLowerCase();
    const source = text ? state.pages.filter((page) => page.kind !== "record" && !page.inline && String(page.title || "Untitled").toLowerCase().includes(text)) : childrenOf(this.folder);
    const by = { name: (a, b) => String(a.title || "").localeCompare(String(b.title || ""), undefined, { sensitivity: "base" }), modified: (a, b) => String(b.updated_at || "").localeCompare(String(a.updated_at || "")), type: (a, b) => kindOf(a).localeCompare(kindOf(b)) || String(a.title || "").localeCompare(String(b.title || "")) }[this.sort];
    /* Folders first, as a drive lists them. */
    return [...source].sort((a, b) => (isFolder(b) - isFolder(a)) || by(a, b));
  }

  path() {
    const trail = [];
    let cursor = this.folder ? getPageMeta(this.folder) : null;
    const guard = new Set();
    while (cursor && !guard.has(String(cursor.id))) { guard.add(String(cursor.id)); trail.unshift(cursor); cursor = cursor.parent_id ? getPageMeta(cursor.parent_id) : null; }
    return trail;
  }

  descendantOf(id, ancestor) {
    let cursor = getPageMeta(id);
    const guard = new Set();
    while (cursor && !guard.has(String(cursor.id))) { if (String(cursor.id) === String(ancestor)) return true; guard.add(String(cursor.id)); cursor = cursor.parent_id ? getPageMeta(cursor.parent_id) : null; }
    return false;
  }

  /* ------------------------------------------------------------- actions */

  /* The dragged cards shrink into whatever they were dropped on before the move is made. */
  flyInto(ids, targetNode) {
    const to = targetNode?.getBoundingClientRect();
    if (!to || matchMedia("(prefers-reduced-motion: reduce)").matches) return Promise.resolve();
    const flights = ids.map((id) => this.node.querySelector(`.fm-item[data-id="${CSS.escape(String(id))}"]`)).filter((node) => node && node !== targetNode).map((node) => {
      const from = node.getBoundingClientRect();
      const dx = to.left + to.width / 2 - (from.left + from.width / 2); const dy = to.top + to.height / 2 - (from.top + from.height / 2);
      node.style.zIndex = "30"; node.style.pointerEvents = "none";
      return node.animate([{ transform: "none", opacity: 1 }, { transform: `translate(${dx}px, ${dy}px) scale(.2)`, opacity: 0 }], { duration: 320, easing: "cubic-bezier(.55,.05,.4,1)", fill: "forwards" }).finished.catch(() => {});
    });
    targetNode.animate([{ transform: "scale(1)" }, { transform: "scale(1.05)", offset: .7 }, { transform: "scale(1)" }], { duration: 360, easing: "ease-out" });
    return Promise.all(flights);
  }

  /* Dropping a note onto another note makes a folder around the two of them. */
  async merge(ids, page, targetNode) {
    const mine = ids.map(String).filter((id) => id !== String(page.id));
    if (!mine.length) return;
    await this.flyInto(mine, targetNode);
    const made = await withError(() => api.post("/api/notes/pages", { parentId: this.folder || null, title: "New folder", icon: "\u{1F4C1}" }), "Could not create the folder");
    if (!made) { this.render(); return; }
    for (const id of [String(page.id), ...mine]) await withError(() => api.post(`/api/notes/pages/${id}/move`, { parentId: String(made.id), index: 0 }), "Could not move that");
    await refreshPages();
    this.selected = new Set([String(made.id)]);
    this.justMade = String(made.id);
    this.render();
    setTimeout(() => this.rename(String(made.id)), 380);
    toast(`Made a folder with ${mine.length + 1} notes`);
  }

  async move(ids, parentId, targetNode) {
    if (targetNode) await this.flyInto(ids, targetNode);
    const movable = ids.filter((id) => String(id) !== String(parentId ?? "") && !(parentId && this.descendantOf(parentId, id)) && String(getPageMeta(id)?.parent_id ?? "") !== String(parentId ?? ""));
    if (!movable.length) return;
    for (const id of movable) await withError(() => api.post(`/api/notes/pages/${id}/move`, { parentId: parentId || null, index: 0 }), "Could not move that");
    await refreshPages();
    this.selected.clear();
    toast(`Moved ${movable.length === 1 ? (getPageMeta(movable[0])?.title || "Untitled") : `${movable.length} items`}${parentId ? ` into ${getPageMeta(parentId)?.title || "Untitled"}` : " to the top level"}`);
  }

  async newNote() { await this.app.createPage(this.folder || null); }
  async newFolder() {
    const made = await withError(() => api.post("/api/notes/pages", { parentId: this.folder || null, title: "New folder", icon: "\u{1F4C1}" }), "Could not create the folder");
    if (!made) return;
    await refreshPages();
    this.selected = new Set([String(made.id)]);
    this.render();
    this.rename(String(made.id));
  }

  open(page, event) {
    if (isFolder(page)) { this.folder = String(page.id); this.selected.clear(); this.filter = ""; this.render(); return; }
    this.app.openPage(page.id, { newTab: event ? modKey(event) : false });
  }

  rename(id) {
    const row = this.node.querySelector(`[data-id="${CSS.escape(String(id))}"] .fm-name`);
    const page = getPageMeta(id);
    if (!row || !page) return;
    const input = el("input", { class: "fm-rename", value: page.title || "", "aria-label": "Rename", spellcheck: "false" });
    row.replaceWith(input);
    input.focus(); input.select();
    let done = false;
    const finish = async (save) => {
      if (done) return; done = true;
      const title = input.value.trim();
      if (save && title && title !== page.title) { await withError(() => api.patch(`/api/notes/pages/${id}`, { title }), "Could not rename"); await refreshPages(); }
      this.render();
    };
    input.addEventListener("keydown", (event) => { event.stopPropagation(); if (event.key === "Enter") finish(true); if (event.key === "Escape") finish(false); });
    input.addEventListener("blur", () => finish(true));
    input.addEventListener("click", (event) => event.stopPropagation());
  }

  async trash(ids) {
    if (!ids.length) return;
    const ok = await confirmDialog({ title: ids.length === 1 ? `Move “${getPageMeta(ids[0])?.title || "Untitled"}” to trash?` : `Move ${ids.length} items to trash?`, message: "They stay in Trash until you empty it, and can be restored.", confirmLabel: "Move to trash" });
    if (!ok) return;
    for (const id of ids) await withError(() => api.del(`/api/notes/pages/${id}`), "Could not delete");
    await refreshPages();
    this.selected.clear();
  }

  async duplicate(id) {
    const copy = await withError(() => api.post(`/api/notes/pages/${id}/duplicate`), "Could not duplicate");
    if (copy) { await refreshPages(); toast("Duplicated"); }
  }

  moveDialog(ids, anchor) {
    const folders = state.pages.filter((page) => page.kind !== "record" && !page.inline && isFolder(page) && !ids.some((id) => String(id) === String(page.id) || this.descendantOf(page.id, id)));
    menu(anchor, [
      { label: "Top level", icon: "home", onSelect: () => this.move(ids, null) },
      ...(folders.length ? [{ type: "separator" }] : []),
      ...folders.slice(0, 40).map((page) => ({ label: page.title || "Untitled", icon: "move", onSelect: () => this.move(ids, String(page.id)) })),
    ], { align: "start" });
  }

  /* The three-dot button: the two things people reach for first, then the rest. */
  moreMenu(page, anchor) {
    this.selected = new Set([String(page.id)]);
    this.paintSelection();
    menu(anchor, [
      { label: "Rename", icon: "pencil", hint: "F2", onSelect: () => this.rename(page.id) },
      { label: "Delete", icon: "trash", onSelect: () => this.trash([String(page.id)]) },
      { type: "separator" },
      { label: isFolder(page) ? "Open folder" : "Open", icon: "arrow_right", onSelect: () => this.open(page) },
      { label: "More…", icon: "dots", onSelect: () => this.contextMenu(page, anchor) },
    ], { align: "end" });
  }

  contextMenu(page, anchor, point) {
    const ids = this.selected.has(String(page.id)) && this.selected.size > 1 ? [...this.selected] : [String(page.id)];
    const single = ids.length === 1;
    menu(anchor, [
      ...(single ? [
        { label: isFolder(page) ? "Open folder" : "Open", icon: "arrow_right", onSelect: () => this.open(page) },
        ...(isFolder(page) ? [] : [{ label: "Open in new tab", icon: "expand", onSelect: () => this.app.openPage(page.id, { newTab: true }) }]),
        { label: "Rename", icon: "pencil", hint: "F2", onSelect: () => this.rename(page.id) },
        { label: "Duplicate", icon: "duplicate", onSelect: () => this.duplicate(page.id) },
        { label: page.favorite ? "Remove from favourites" : "Add to favourites", icon: "star", onSelect: async () => { await withError(() => api.patch(`/api/notes/pages/${page.id}`, { favorite: !page.favorite }), "Could not update favourites"); await refreshPages(); } },
        { label: "New note inside", icon: "plus", onSelect: () => this.app.createPage(page.id) },
        { type: "separator" },
      ] : [{ type: "label", label: `${ids.length} selected` }]),
      { label: "Move to…", icon: "move", onSelect: () => this.moveDialog(ids, anchor) },
      ...(single && !isFolder(page) ? [
        { type: "label", label: "Download" },
        { label: "Word document (.docx)", icon: "export", onSelect: () => this.app.exportPage(page, "docx") },
        { label: "PDF", icon: "export", onSelect: () => this.app.exportPage(page, "pdf") },
        { label: "Markdown (.md)", icon: "export", onSelect: () => this.app.exportPage(page, "md") },
      ] : []),
      { type: "separator" },
      { label: "Delete", icon: "trash", onSelect: () => this.trash(ids) },
    ], { align: "start", point });
  }

  /* ----------------------------------------------------------- rendering */

  select(page, event) {
    const id = String(page.id);
    const order = this.items().map((item) => String(item.id));
    if (event.shiftKey && this.anchorId) {
      const [a, b] = [order.indexOf(this.anchorId), order.indexOf(id)].sort((x, y) => x - y);
      this.selected = new Set(order.slice(a, b + 1));
    } else if (event.metaKey || event.ctrlKey) { this.selected.has(id) ? this.selected.delete(id) : this.selected.add(id); this.anchorId = id; }
    else { this.selected = new Set([id]); this.anchorId = id; }
    this.paintSelection();
  }

  paintSelection() {
    this.node.querySelectorAll(".fm-item").forEach((node) => node.classList.toggle("selected", this.selected.has(node.dataset.id)));
    const bar = this.node.querySelector(".fm-selbar");
    if (bar) { bar.hidden = this.selected.size < 2; bar.querySelector(".fm-count").textContent = `${this.selected.size} selected`; }
  }

  itemNode(page, index) {
    const folder = isFolder(page);
    const emoji = emojiOf(page);
    const glyph = el("span", { class: "fm-glyph" }, emoji ? el("span", { class: "fm-emoji", text: emoji }) : folder ? folderIcon(this.view === "grid" ? 38 : 18) : icon(page.kind === "database" ? "table" : "page", this.view === "grid" ? 34 : 16));
    /* The grid shows each file as it really looks. Folders keep their folder; a page fills in its preview as soon as it scrolls into view. */
    const plainFolder = page.icon === "\u{1F4C1}";
    const thumb = this.view === "grid" && !plainFolder ? this.thumbNode(page, glyph) : null;
    const node = el("div", {
      class: `fm-item ${folder ? "is-folder" : ""}${thumb ? " has-thumb" : ""}${this.selected.has(String(page.id)) ? " selected" : ""}`, role: "option", tabindex: "0", draggable: "true",
      dataset: { id: String(page.id) }, style: { "--i": String(Math.min(index, 14)) },
      onclick: (event) => { if (event.detail > 1) return; if (event.metaKey || event.ctrlKey || event.shiftKey) { this.select(page, event); return; } this.select(page, event); this.open(page, event); },
      ondblclick: (event) => { event.preventDefault(); },
      oncontextmenu: (event) => { event.preventDefault(); if (!this.selected.has(String(page.id))) { this.selected = new Set([String(page.id)]); this.paintSelection(); } this.contextMenu(page, node, { x: event.clientX, y: event.clientY }); },
      onkeydown: (event) => {
        if (event.key === "Enter") { event.preventDefault(); this.open(page, event); }
        else if (event.key === "F2") { event.preventDefault(); this.rename(page.id); }
        else if (event.key === "Delete" || event.key === "Backspace") { event.preventDefault(); this.trash(this.selected.size ? [...this.selected] : [String(page.id)]); }
        else if (["ArrowDown", "ArrowUp", "ArrowRight", "ArrowLeft"].includes(event.key)) { event.preventDefault(); const nodes = [...this.node.querySelectorAll(".fm-item")]; const at = nodes.indexOf(node); const step = (event.key === "ArrowDown" || event.key === "ArrowRight") ? 1 : -1; nodes[Math.max(0, Math.min(nodes.length - 1, at + step))]?.focus(); }
      },
    },
      thumb || glyph,
      el("span", { class: "fm-name", text: page.title || "Untitled" }),
      this.view === "list" && this.wide ? el("span", { class: "fm-kind", text: kindOf(page) }) : null,
      this.view === "list" ? el("span", { class: "fm-meta", text: formatRelative(page.updated_at) }) : null,
      el("button", { class: "fm-more", type: "button", "aria-label": "More", onclick: (event) => { event.stopPropagation(); this.moreMenu(page, event.currentTarget); } }, icon("dots", 14)));
    node.addEventListener("dragstart", (event) => {
      const ids = this.selected.has(String(page.id)) ? [...this.selected] : [String(page.id)];
      event.dataTransfer.setData(DRAG, JSON.stringify(ids)); event.dataTransfer.setData("text/plain", ids.join(",")); event.dataTransfer.effectAllowed = "move";
      node.classList.add("dragging");
      this.node.classList.add("is-dragging");
    });
    node.addEventListener("dragend", () => { node.classList.remove("dragging"); this.node.classList.remove("is-dragging"); this.node.querySelectorAll(".drop").forEach((n) => n.classList.remove("drop")); });
    /* A folder takes what is dropped on it; a plain note turns into a folder with it. */
    this.droppable(node, () => String(page.id), { onDrop: (ids) => (folder ? this.move(ids, String(page.id), node) : this.merge(ids, page, node)), skip: (ids) => ids.length === 1 && String(ids[0]) === String(page.id) });
    if (String(page.id) === this.justMade) { node.classList.add("pop"); this.justMade = null; }
    return node;
  }

  thumbNode(page, fallback) {
    const frame = el("div", { class: "fm-thumb-frame" });
    const subpages = childrenOf(page.id).length;
    const thumb = el("div", { class: "fm-thumb" }, el("div", { class: "fm-thumb-skeleton" }, fallback), frame,
      subpages ? el("span", { class: "fm-badge", title: `${subpages} subpage${subpages === 1 ? "" : "s"} inside` }, folderIcon(13), String(subpages)) : null);
    const load = () => pagePreview(this.app, page).then((html) => {
      if (!html || !thumb.isConnected) return;
      const scale = thumb.clientWidth / 1040;
      thumb.style.setProperty("--s", String(scale || .2));
      frame.innerHTML = html;
      frame.querySelectorAll("[contenteditable]").forEach((node) => node.removeAttribute("contenteditable"));
      requestAnimationFrame(() => thumb.classList.add("ready"));
    });
    /* Only what is on screen is rendered. */
    this.observer ||= new IntersectionObserver((entries) => entries.forEach((entry) => { if (entry.isIntersecting) { this.observer.unobserve(entry.target); entry.target.__load?.(); } }), { rootMargin: "240px" });
    thumb.__load = load;
    this.observer.observe(thumb);
    return thumb;
  }

  /* One control for both views: at rest it shows the current one, and on hover it opens into a slider with both. */
  viewSlider() {
    const modes = ["list", "grid"];
    const slider = el("div", { class: "fm-view", role: "group", "aria-label": "View", dataset: { mode: this.view } },
      el("span", { class: "fm-view-thumb", "aria-hidden": "true" }),
      modes.map((mode) => el("button", {
        class: `fm-view-btn${this.view === mode ? " on" : ""}`, type: "button", "aria-pressed": String(this.view === mode), "aria-label": `${mode} view`, title: `${mode[0].toUpperCase()}${mode.slice(1)} view`,
        onclick: () => {
          if (this.view === mode) { if (!slider.classList.contains("open")) slider.classList.add("open"); return; }
          this.view = mode; write(VIEW_KEY, mode);
          slider.dataset.mode = mode;
          slider.querySelectorAll(".fm-view-btn").forEach((button) => button.classList.toggle("on", button === slider.querySelector(`[aria-label="${mode} view"]`)));
          /* Let the thumb finish its slide before the grid redraws. */
          setTimeout(() => this.render(), 160);
        },
      }, icon(mode === "list" ? "list" : "grid", 15))));
    return slider;
  }

  /* Anything that accepts a dragged item: a folder, a crumb, or the empty space. */
  droppable(node, target, options = {}) {
    node.addEventListener("dragover", (event) => {
      if (!event.dataTransfer.types.includes(DRAG)) return;
      event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = "move";
      /* Only the thing being touched is marked. */
      if (!node.classList.contains("drop")) { this.node.querySelectorAll(".drop").forEach((other) => other.classList.remove("drop")); node.classList.add("drop"); }
    });
    node.addEventListener("dragleave", (event) => { if (!node.contains(event.relatedTarget)) node.classList.remove("drop"); });
    node.addEventListener("drop", (event) => {
      node.classList.remove("drop");
      const raw = event.dataTransfer.getData(DRAG);
      if (!raw) return;
      event.preventDefault(); event.stopPropagation();
      const ids = JSON.parse(raw);
      if (options.skip?.(ids)) return;
      if (options.onDrop) options.onDrop(ids); else this.move(ids, target());
    });
  }

  render() {
    const trail = this.path();
    const crumb = (label, id, last) => {
      const node = el("button", { class: `fm-crumb${last ? " current" : ""}`, type: "button", onclick: () => { this.folder = id; this.selected.clear(); this.render(); } }, label);
      this.droppable(node, () => id);
      return node;
    };
    const crumbs = el("nav", { class: "fm-path", "aria-label": "Folder path" }, crumb("All notes", null, !trail.length));
    trail.forEach((page, index) => { append(crumbs, el("span", { class: "fm-sep", text: "/" }), crumb(page.title || "Untitled", String(page.id), index === trail.length - 1)); });

    const toolbar = el("div", { class: "fm-toolbar" },
      el("button", { class: "fm-btn primary", type: "button", onclick: () => this.newNote() }, icon("plus", 14), "Note"),
      el("button", { class: "fm-btn", type: "button", onclick: () => this.newFolder() }, folderIcon(15), "Folder"),
      el("span", { class: "fm-spacer" }),
      el("button", { class: "fm-icon", type: "button", "aria-label": "Sort", title: "Sort", onclick: (event) => menu(event.currentTarget, ["name", "modified", "type"].map((key) => ({ label: `Sort by ${key}`, checked: this.sort === key, onSelect: () => { this.sort = key; write(SORT_KEY, key); this.render(); } })), { align: "end" }) }, icon("sort", 15)),
      this.viewSlider(),
      el("button", { class: "fm-hint", type: "button", title: "View all open notes", onclick: () => this.app.toggleTaskView?.() }, el("kbd", { text: shortcutLabel("taskView") }), el("span", { text: "All open notes" })));
    const search = el("label", { class: "fm-searchbox" }, icon("search", 15),
      el("input", { class: "fm-search", type: "search", placeholder: "Search files", value: this.filter, "aria-label": "Search files", spellcheck: "false", oninput: (event) => { this.filter = event.target.value; this.renderItems(); } }));
    const selbar = el("div", { class: "fm-selbar", hidden: true },
      el("span", { class: "fm-count" }),
      el("button", { class: "fm-btn", type: "button", onclick: (event) => this.moveDialog([...this.selected], event.currentTarget) }, icon("move", 13), "Move"),
      el("button", { class: "fm-btn danger", type: "button", onclick: () => this.trash([...this.selected]) }, icon("trash", 13), "Delete"),
      el("button", { class: "fm-btn", type: "button", onclick: () => { this.selected.clear(); this.paintSelection(); } }, "Clear"));
    this.list = el("div", { class: `fm-items ${this.view}`, role: "listbox", "aria-multiselectable": "true" });
    this.droppable(this.list, () => this.folder);
    this.observer?.disconnect(); this.observer = null;
    clear(this.node);
    this.node.append(toolbar, crumbs, search, selbar, this.list);
    this.renderItems();
    this.paintSelection();
    return this.node;
  }

  renderItems() {
    clear(this.list);
    const items = this.items();
    if (!items.length) {
      this.list.append(el("div", { class: "fm-empty" }, this.filter ? "Nothing matches that." : "This folder is empty.", el("span", { text: "Drag notes here, or create one." })));
      return;
    }
    if (this.view === "list") this.list.append(el("div", { class: "fm-head", "aria-hidden": "true" }, el("span", { text: "Name" }), this.wide ? el("span", { text: "Kind" }) : null, el("span", { text: "Modified" })));
    items.forEach((page, index) => this.list.append(this.itemNode(page, index)));
    this.paintSelection();
  }
}
