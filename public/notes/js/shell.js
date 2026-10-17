/* Sidebar, tab strip and page toolbar. */
import { el, clear, icon, iconButton, tooltip, menu, modal, toast, confirmDialog, mod, modKey, append } from "./dom.js";
import { api } from "./api.js";
import {
  state, childrenOf, hasChildren, getPageMeta, saveSession, refreshPages,
  openTab, closeTab, selectTab, moveTab, activeTab, withError, dropPage,
} from "./state.js";

/* --------------------------------------------------------------- sidebar */

export class Sidebar {
  constructor(host, context) {
    this.host = host;
    this.context = context;
    this.build();
  }

  build() {
    clear(this.host);
    this.body = el("div", { class: "sidebar-body scroll" });
    /* Content lives in a fixed-width inner shell so collapsing the sidebar
       slides it away rather than squeezing every row as the track shrinks. */
    this.host.append(
      append(el("div", { class: "sidebar-inner" }), this.buildHeader(), this.buildNav(), this.body, this.buildFooter()),
      this.buildResizer(),
    );
    this.renderBody();
  }

  buildHeader() {
    return el("div", { class: "workspace-header" },
      el("button", {
        class: "workspace-button", type: "button",
        onclick: (event) => this.workspaceMenu(event.currentTarget),
      },
        el("span", { class: "workspace-avatar", text: "C" }),
        el("span", { class: "workspace-name", text: "Clyra Notes" }),
        icon("chevron_down", 13)),
      iconButton("panel", "Hide sidebar", () => this.context.toggleSidebar(), { shortcut: `${mod}+\\` }),
    );
  }

  workspaceMenu(anchor) {
    menu(anchor, [
      { type: "label", label: "Workspace" },
      { label: "Settings", icon: "settings", onSelect: () => this.context.openSettings() },
      { label: "Courses", icon: "book", onSelect: () => this.context.openCourses() },
      { type: "separator" },
      { label: "Import", icon: "import", onSelect: () => this.context.openImport(null) },
      { label: "Export all notes", icon: "export", onSelect: () => this.context.exportAll() },
      { type: "separator" },
      { label: "Trash", icon: "trash", hint: state.trashCount ? String(state.trashCount) : undefined, onSelect: () => this.context.openTrash() },
    ], { align: "start" });
  }

  /* The nav rail is icon-first but never mute: each item expands to show its
     label on hover or focus, and the selected one stays expanded. */
  /* One horizontal row: the selected item carries its label, the rest are
     icons that expand to their name on hover or focus. Nothing is nameless
     for longer than it takes to point at it. */
  buildNav() {
    const nav = el("div", { class: "sidebar-nav" });
    const item = (kind, label, iconName, shortcut, onClick) => {
      const selected = state.view.kind === kind;
      const button = el("button", {
        class: `nav-item${selected ? " selected" : ""}`, type: "button",
        "aria-label": label, "aria-current": selected ? "page" : null,
        onclick: onClick || ((event) => this.context.openView({ kind }, { newTab: modKey(event) })),
      },
        el("span", { class: "nav-icon" }, icon(iconName, 17)),
        el("span", { class: "nav-name" }, el("span", { class: "nav-name-text", text: label })),
      );
      if (shortcut) button.title = `${label}  ${shortcut}`;
      if (kind === "inbox" && state.inbox.some((event) => !event.read_at)) button.classList.add("has-unread");
      return button;
    };
    append(nav,
      item("home", "Home", "home"),
      item("chat", "AI chat", "comment"),
      item("flashcards", "Flashcards", "cards"),
      item("tests", "Tests", "check_square"),
      item("inbox", "Inbox", "inbox"),
      item("search", "Search", "search", `${mod}+P`, () => this.context.openSearch()),
    );
    return nav;
  }

  /* The footer is the workspace's utilities plus one primary action. Kept as
     a distinct band so it reads as chrome rather than more page rows. */
  buildFooter() { return null; }

  renderBody() {
    clear(this.body);
    /* Before the workspace has loaded the sidebar stays quiet rather than
       claiming there are no pages. */
    if (!state.ready) {
      append(this.body, el("div", { class: "loading-row", style: { padding: "10px 14px" } }, el("span", { class: "spinner" }), "Loading…"));
      return;
    }
    const sections = [];
    const favorites = state.pages.filter((page) => page.favorite && page.kind !== "record");
    const recents = [...state.pages]
      .filter((page) => page.kind !== "record")
      .sort((a, b) => String(b.updated_at || "").localeCompare(String(a.updated_at || "")))
      .slice(0, 5);

    if (recents.length) sections.push(this.section("Recents", recents.map((page) => this.pageRow(page, 0, { flat: true }))));
    if (favorites.length) sections.push(this.section("Favorites", favorites.map((page) => this.pageRow(page, 0, { flat: true }))));

    /* Every course gets a section even when empty, so a newly created
       subject is somewhere you can drop a page rather than invisible. */
    for (const course of state.classes) {
      const pages = childrenOf(null).filter((page) => page.class_id === course.id);
      sections.push(this.section(course.name, pages.length
        ? pages.map((page) => this.pageRow(page, 0))
        : [el("div", { class: "sidebar-empty", text: "Drop a page here" })], { classId: course.id }));
    }

    /* The invitation sits with the subjects it creates, above the unfiled
       list — below it, a long page list pushes it out of view entirely. */
    sections.push(el("div", { class: "sidebar-section subjects-cta" },
      el("button", {
        class: "sidebar-add-subject", type: "button",
        title: "Subjects group pages in the sidebar",
        onclick: () => this.context.newSubject(),
      },
        el("span", { class: "add-subject-icon" }, icon("plus", 14)),
        el("span", { class: "add-subject-label", text: "New subject" }))));

    const notesPages = childrenOf(null).filter((page) => !page.class_id);
    sections.push(this.section("Notes", notesPages.length
      ? notesPages.map((page) => this.pageRow(page, 0))
      : [el("div", { class: "sidebar-empty", text: "No notes yet" })], { onAdd: () => this.context.createPage(null) }));

    sections.push(this.section("Study", [
      this.staticRow("Flashcards", "cards", () => this.context.openView({ kind: "flashcards" }), state.study.due ? `${state.study.due} due` : null),
      this.staticRow("Practice tests", "check_square", () => this.context.openView({ kind: "tests" })),
    ]));

    /* Workspace utilities read as ordinary rows at the end of the tree, not
       as a separate pinned band. */
    sections.push(el("div", { class: "sidebar-section utilities" },
      this.staticRow("Library", "book", () => this.context.openView({ kind: "library" })),
      this.staticRow("Templates", "template", () => this.context.openTemplates(null)),
      this.staticRow("Import", "import", () => this.context.openImport(null)),
      this.staticRow("Trash", "trash", () => this.context.openTrash(), state.trashCount ? String(state.trashCount) : null)));

    append(this.body, ...sections);
  }

  section(title, rows, options = {}) {
    const key = title.toLowerCase();
    const collapsed = state.collapsedSections.has(key);
    const content = el("div", { class: "section-content", hidden: collapsed }, rows);
    const header = el("div", { class: "section-header" },
      el("button", {
        type: "button", "aria-expanded": collapsed ? "false" : "true",
        onclick: () => {
          collapsed ? state.collapsedSections.delete(key) : state.collapsedSections.add(key);
          saveSession();
          this.renderBody();
        },
      }, title),
      append(el("div", { class: "section-actions" }),
        options.classId
          ? iconButton("pencil", `Rename ${title}`, (event) => {
              event.stopPropagation();
              this.context.renameSubject(options.classId, title);
            })
          : null,
        options.classId
          ? iconButton("trash", `Delete ${title}`, (event) => {
              event.stopPropagation();
              this.context.deleteSubject(options.classId, title);
            })
          : null,
        options.classId
          ? iconButton("dots", `${title} options`, (event) => {
              event.stopPropagation();
              this.subjectMenu(options.classId, title, event.currentTarget);
            })
          : null,
        options.onAdd || options.classId
          ? iconButton("plus", `New page in ${title}`, () =>
              (options.classId ? this.context.createPage(null, { classId: options.classId }) : options.onAdd()))
          : null),
    );
    const node = el("div", { class: "sidebar-section" }, header, content);
    /* Dropping onto a subject header files the page into that subject; the
       Notes header clears the subject again. */
    if (options.classId !== undefined || key === "notes" || key === "private") {
      const classId = options.classId ?? null;
      node.addEventListener("dragover", (event) => {
        if (!this.dragging) return;
        event.preventDefault();
        this.clearDropHints();
        header.classList.add("drop-into");
        this.dropMode = { mode: "class", classId };
      });
      node.addEventListener("dragleave", (event) => {
        if (node.contains(event.relatedTarget)) return;
        header.classList.remove("drop-into");
      });
      node.addEventListener("drop", async (event) => {
        if (!this.dragging || this.dropMode?.mode !== "class") return;
        event.preventDefault();
        event.stopPropagation();
        const pageId = this.dragging;
        this.clearDropHints();
        this.dragging = null;
        await withError(() => api.patch(`/api/notes/pages/${pageId}`, { classId, parentId: null }), "Could not move that page");
        await refreshPages();
        this.renderBody();
        toast(classId ? `Moved to ${title}` : "Moved to Notes");
      });
    }
    return node;
  }

  staticRow(label, iconName, onClick, hint) {
    return el("button", { class: "page-row", type: "button", onclick: onClick },
      el("span", { class: "page-caret leaf" }),
      el("span", { class: "page-icon" }, icon(iconName, 15)),
      el("span", { class: "page-title", text: label }),
      hint ? el("span", { class: "shortcut", text: hint }) : null);
  }

  pageRow(page, depth, options = {}) {
    const id = String(page.id);
    const expanded = state.expanded.has(id);
    const children = options.flat ? [] : childrenOf(id);
    const hasKids = !options.flat && hasChildren(id);
    const tab = activeTab();
    const selected = tab?.kind === "page" && String(tab.pageId) === id;

    const caret = el("button", {
      class: `page-caret${hasKids ? "" : " leaf"}${expanded ? " open" : ""}`, type: "button",
      "aria-label": expanded ? "Collapse" : "Expand", "aria-expanded": expanded ? "true" : "false",
      onclick: (event) => {
        event.stopPropagation();
        expanded ? state.expanded.delete(id) : state.expanded.add(id);
        saveSession();
        this.renderBody();
      },
    }, icon("chevron_right", 12));

    const row = el("div", {
      class: `page-row${selected ? " selected" : ""}`, role: "treeitem", tabindex: "0",
      draggable: "true", "data-page": id,
      style: { paddingLeft: `${6 + depth * 14}px` },
      onclick: (event) => this.context.openPage(id, { newTab: modKey(event) }),
      onauxclick: (event) => { if (event.button === 1) { event.preventDefault(); this.context.openPage(id, { newTab: true, background: true }); } },
      oncontextmenu: (event) => { event.preventDefault(); this.pageMenu(page, row); },
      onkeydown: (event) => {
        if (event.key === "Enter") this.context.openPage(id);
        if (event.key === "ArrowRight" && hasKids && !expanded) { state.expanded.add(id); saveSession(); this.renderBody(); }
        if (event.key === "ArrowLeft" && expanded) { state.expanded.delete(id); saveSession(); this.renderBody(); }
      },
    },
      caret,
      el("span", { class: "page-icon", text: page.icon && !/^https?:|^\//.test(page.icon) ? page.icon : "" },
        page.icon && /^https?:|^\//.test(page.icon)
          ? el("img", { src: page.icon, alt: "", style: { width: "15px", height: "15px", borderRadius: "3px" } })
          : page.icon ? null : icon(page.kind === "database" ? "table" : "page", 15)),
      el("span", { class: "page-title", text: page.title || "New page" }),
      el("div", { class: "page-row-actions" },
        iconButton("pencil", "Rename", (event) => { event.stopPropagation(); this.renameInline(row, page); }),
        iconButton("trash", "Move to trash", (event) => { event.stopPropagation(); this.context.trashPage(page, () => this.renderBody()); }),
        iconButton("dots", "More actions", (event) => { event.stopPropagation(); this.pageMenu(page, event.currentTarget); }),
        iconButton("plus", "Add a page inside", (event) => { event.stopPropagation(); this.context.createPage(id); })),
    );
    /* Double-click renames in place — the fastest path, and the menu offers
       the same thing for anyone who does not know the gesture. */
    row.addEventListener("dblclick", (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.renameInline(row, page);
    });
    this.bindRowDrag(row, page);

    const node = el("div", { class: "page-node" }, row);
    if (expanded && children.length) {
      append(node, el("div", { class: "page-children" }, children.map((child) => this.pageRow(child, depth + 1))));
    } else if (expanded && hasKids) {
      append(node, el("div", { class: "sidebar-empty", style: { paddingLeft: `${32 + depth * 14}px` }, text: "No pages inside" }));
    }
    return node;
  }

  /* Dropping on the middle third of a row nests; the outer thirds reorder,
     which is what makes an accurate insertion line worth drawing. */
  bindRowDrag(row, page) {
    row.addEventListener("dragstart", (event) => {
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", String(page.id));
      this.dragging = String(page.id);
    });
    row.addEventListener("dragend", () => { this.dragging = null; this.clearDropHints(); });
    row.addEventListener("dragover", (event) => {
      if (!this.dragging || this.dragging === String(page.id)) return;
      event.preventDefault();
      const rect = row.getBoundingClientRect();
      const ratio = (event.clientY - rect.top) / rect.height;
      this.clearDropHints();
      if (ratio > 0.3 && ratio < 0.7) { row.classList.add("drop-into"); this.dropMode = { mode: "into", id: String(page.id) }; return; }
      this.dropMode = { mode: ratio <= 0.3 ? "before" : "after", id: String(page.id) };
      const line = el("div", { class: "drop-line" });
      Object.assign(line.style, {
        top: `${(ratio <= 0.3 ? rect.top : rect.bottom) - this.host.getBoundingClientRect().top - 1}px`,
        left: "8px", right: "8px",
      });
      this.host.append(line);
      this.dropLine = line;
    });
    row.addEventListener("drop", async (event) => {
      event.preventDefault();
      const dragged = this.dragging;
      const target = this.dropMode;
      this.clearDropHints();
      this.dragging = null;
      if (!dragged || !target) return;
      const targetPage = getPageMeta(target.id);
      const parentId = target.mode === "into" ? target.id : targetPage?.parent_id ?? null;
      const siblings = childrenOf(parentId).filter((candidate) => String(candidate.id) !== dragged);
      const index = target.mode === "into"
        ? childrenOf(target.id).length
        : siblings.findIndex((candidate) => String(candidate.id) === target.id) + (target.mode === "after" ? 1 : 0);
      const result = await withError(() => api.post(`/api/notes/pages/${dragged}/move`, { parentId, index }), "Could not move that page");
      if (result?.error) { toast(result.error, "error"); return; }
      if (target.mode === "into") state.expanded.add(target.id);
      await refreshPages();
      this.renderBody();
    });
  }

  clearDropHints() {
    this.dropLine?.remove();
    this.dropLine = null;
    this.dropMode = null;
    this.host.querySelectorAll(".drop-into").forEach((node) => node.classList.remove("drop-into"));
  }

  pageMenu(page, anchor) {
    this.context.pageMenu(page, anchor, () => this.renderBody(), {
      onRename: () => {
        const row = this.host.querySelector(`.page-row[data-page="${CSS.escape(String(page.id))}"]`);
        if (row) this.renameInline(row, page);
      },
    });
  }

  /* Swaps the row's label for an input, so renaming happens where the name
     is rather than in a dialog on top of it. */
  renameInline(row, page) {
    if (row.querySelector(".page-rename")) return;
    const label = row.querySelector(".page-title");
    const input = el("input", {
      class: "page-rename", type: "text", value: page.title || "",
      placeholder: "New page", "aria-label": "Page name",
      onclick: (event) => event.stopPropagation(),
      ondblclick: (event) => event.stopPropagation(),
    });
    label.replaceWith(input);
    input.focus();
    input.select();

    let settled = false;
    const finish = async (commit) => {
      if (settled) return;
      settled = true;
      const name = input.value.trim();
      input.replaceWith(label);
      if (!commit || name === (page.title || "")) return;
      page.title = name;
      const meta = getPageMeta(page.id);
      if (meta) meta.title = name;
      label.textContent = name || "New page";
      await withError(() => api.patch(`/api/notes/pages/${page.id}`, { title: name }), "Could not rename that page");
      dropPage(String(page.id));
      await refreshPages();
      this.context.repaintChrome();
    };
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") { event.preventDefault(); finish(true); }
      if (event.key === "Escape") { event.preventDefault(); finish(false); }
    });
    input.addEventListener("blur", () => finish(true));
  }

  subjectMenu(classId, name, anchor) {
    menu(anchor, [
      { label: "New page in this subject", icon: "plus", onSelect: () => this.context.createPage(null, { classId }) },
      { label: "Rename subject", icon: "text", onSelect: () => this.context.renameSubject(classId, name) },
      { type: "separator" },
      { label: "Delete subject", icon: "trash", danger: true, onSelect: () => this.context.deleteSubject(classId, name) },
    ], { align: "end" });
  }

  buildResizer() {
    const handle = el("div", { class: "sidebar-resize", role: "separator", "aria-label": "Resize sidebar" });
    handle.addEventListener("mousedown", (event) => {
      event.preventDefault();
      handle.classList.add("dragging");
      document.querySelector(".workspace")?.classList.add("resizing");
      const move = (moveEvent) => {
        const width = Math.min(380, Math.max(220, moveEvent.clientX));
        state.sidebarWidth = width;
        this.context.applySidebarWidth();
      };
      const up = () => {
        handle.classList.remove("dragging");
        document.querySelector(".workspace")?.classList.remove("resizing");
        saveSession();
        document.removeEventListener("mousemove", move);
        document.removeEventListener("mouseup", up);
      };
      document.addEventListener("mousemove", move);
      document.addEventListener("mouseup", up);
    });
    return handle;
  }
}

/* -------------------------------------------------------------- tabstrip */

export class TabStrip {
  constructor(host, context) {
    this.host = host;
    this.context = context;
    this.nodes = new Map();
    this.build();
    this.render();
  }

  build() {
    clear(this.host);
    this.scroller = el("div", { class: "tab-scroll", role: "tablist" });
    /* One indicator slides between tabs instead of each tab painting its own
       hover, which is what makes the strip feel continuous. */
    this.indicator = el("div", { class: "tab-indicator", "aria-hidden": "true" });
    this.scroller.append(this.indicator);
    this.host.append(
      el("div", { class: "tabstrip-nav" },
        tooltip(el("button", { class: "icon-button sidebar-menu", type: "button", onclick: () => this.context.toggleSidebar() }, icon("list", 16)), "Show navigation"),
        iconButton("arrow_left", "Back", () => this.context.goBack(), { shortcut: `${mod}+[` }),
        iconButton("arrow_right", "Forward", () => this.context.goForward(), { shortcut: `${mod}+]` })),
      el("div", { class: "tab-list" },
        this.scroller,
        iconButton("plus", "New page", () => this.context.createPage(null, { newTab: true }), { shortcut: `${mod}+T`, className: "tab-new" })),
      /* The mirror of the sidebar's own toggle: same glyph flipped, same row,
         the opposite end. One shape means "show me the panel on that side". */
      el("div", { class: "tabstrip-end" }, this.railToggle()),
    );
    this.scroller.addEventListener("mouseleave", () => this.moveIndicator());
  }

  railToggle() {
    const paint = (button) => {
      const open = this.context.railOpen();
      button.classList.toggle("active", open);
      button.setAttribute("aria-pressed", open ? "true" : "false");
      button.title = open ? `Hide tools  ${mod}+Shift+\\` : `Show tools  ${mod}+Shift+\\`;
    };
    const button = el("button", {
      class: "icon-button rail-toggle", type: "button", "aria-label": "Show or hide tools",
      onclick: () => { this.context.toggleRail(); paint(button); },
    }, icon("panel", 16));
    paint(button);
    this.railButtonNode = button;
    return button;
  }

  syncRailToggle() {
    if (!this.railButtonNode) return;
    const open = this.context.railOpen();
    this.railButtonNode.classList.toggle("active", open);
    this.railButtonNode.setAttribute("aria-pressed", open ? "true" : "false");
  }

  /* Tabs are reconciled rather than rebuilt so an opening tab can grow into
     place and a closing one can collapse before it leaves. */
  render() {
    const wanted = new Set(state.tabs.map((tab) => tab.id));
    for (const [id, node] of [...this.nodes]) {
      if (!wanted.has(id)) { this.retire(id, node); }
    }
    let cursor = this.indicator.nextSibling;
    for (const tab of state.tabs) {
      let node = this.nodes.get(tab.id);
      if (!node) {
        node = this.tabNode(tab);
        this.nodes.set(tab.id, node);
        this.scroller.insertBefore(node, cursor);
        /* Resolving style and layout flushes the collapsed state, so the
           browser has something to transition away from. Without both reads
           the tab is born at full width and never animates. */
        void getComputedStyle(node).maxWidth;
        void node.offsetWidth;
        node.classList.add("settled");
      } else {
        this.paintTab(node, tab);
        if (cursor !== node) this.scroller.insertBefore(node, cursor);
      }
      cursor = node.nextSibling;
    }
    for (const [id, node] of this.nodes) {
      node.classList.toggle("active", id === state.activeTab);
      node.setAttribute("aria-selected", id === state.activeTab ? "true" : "false");
    }
    requestAnimationFrame(() => this.moveIndicator());
  }

  retire(id, node) {
    this.nodes.delete(id);
    node.classList.add("closing");
    node.classList.remove("settled");
    const drop = () => node.remove();
    /* Several properties transition together, so the first transitionend
       fires while the tab is still collapsing. Only the width finishing
       means the tab has actually gone. */
    node.addEventListener("transitionend", (event) => {
      if (event.propertyName === "max-width") drop();
    });
    setTimeout(drop, 240);
  }

  /* The active tab paints its own fill, so a tab that is still growing is
     already grey rather than turning grey once it arrives. Only the hover
     highlight travels, and it steps aside for the active tab. */
  moveIndicator(target) {
    const active = this.nodes.get(state.activeTab);
    if (!target || !target.isConnected || target === active) {
      this.indicator.style.opacity = "0";
      return;
    }
    this.indicator.style.opacity = "1";
    this.indicator.style.transform = `translateX(${target.offsetLeft}px)`;
    this.indicator.style.width = `${target.offsetWidth}px`;
  }

  paintTab(node, tab) {
    const label = this.context.tabLabel(tab);
    const iconHost = node.querySelector(".tab-icon");
    clear(iconHost);
    if (label.emoji) iconHost.textContent = label.emoji;
    else iconHost.append(icon(label.icon, 14));
    node.querySelector(".tab-label").textContent = label.title;
    node.querySelector(".tab-close").setAttribute("aria-label", `Close ${label.title}`);
  }

  tabNode(tab) {
    const node = el("div", {
      class: "tab", role: "tab", draggable: "true", tabindex: "0",
      onclick: () => selectTab(tab.id),
      onmouseenter: () => this.moveIndicator(node),
      onauxclick: (event) => { if (event.button === 1) { event.preventDefault(); closeTab(tab.id); } },
      oncontextmenu: (event) => {
        event.preventDefault();
        menu(node, [
          { label: "Close tab", icon: "close", onSelect: () => closeTab(tab.id) },
          { label: "Close other tabs", onSelect: () => state.tabs.filter((other) => other.id !== tab.id).forEach((other) => closeTab(other.id)) },
          { label: "Reopen closed tab", shortcut: `${mod}+Shift+T`, onSelect: () => this.context.reopenTab() },
        ]);
      },
    },
      el("span", { class: "tab-icon" }),
      el("span", { class: "tab-label" }),
      el("button", {
        class: "tab-close", type: "button",
        onclick: (event) => { event.stopPropagation(); closeTab(tab.id); },
      }, icon("close", 11)),
    );
    this.paintTab(node, tab);
    /* The surfaces track the tab while it is still growing or collapsing. */
    node.addEventListener("transitionend", (event) => {
      if (event.propertyName === "max-width") this.moveIndicator();
    });
    node.addEventListener("dragstart", () => { this.dragTab = tab.id; });
    node.addEventListener("dragover", (event) => { event.preventDefault(); node.classList.add("drag-over"); });
    node.addEventListener("dragleave", () => node.classList.remove("drag-over"));
    node.addEventListener("drop", (event) => {
      event.preventDefault();
      node.classList.remove("drag-over");
      if (this.dragTab && this.dragTab !== tab.id) moveTab(this.dragTab, state.tabs.indexOf(tab));
      this.dragTab = null;
    });
    return node;
  }
}

/* --------------------------------------------------------------- toolbar */

export class Toolbar {
  constructor(host, context) {
    this.host = host;
    this.context = context;
    this.render();
  }

  render() {
    clear(this.host);
    const tab = activeTab();
    const crumbs = el("div", { class: "breadcrumbs" });
    const actions = el("div", { class: "toolbar-actions" });

    if (tab?.kind === "page") {
      const page = getPageMeta(tab.pageId);
      const trail = this.trailFor(tab.pageId);
      trail.forEach((crumb, index) => {
        if (index) append(crumbs, el("span", { class: "crumb-sep", text: "/" }));
        append(crumbs, el("button", {
          class: `crumb${index === trail.length - 1 ? " current" : ""}`, type: "button",
          onclick: (event) => this.context.openPage(crumb.id, { newTab: modKey(event) }),
        },
          el("span", { class: "page-icon", text: crumb.icon && !/^https?:|^\//.test(crumb.icon) ? crumb.icon : "" },
            crumb.icon ? null : icon("page", 14)),
          el("span", { text: crumb.title || "New page" })));
      });
      if (page?.locked) append(crumbs, tooltip(el("span", { class: "crumb" }, icon("lock", 14)), "This page is locked"));
      /* append() turns a null into the text "null", so nullable children are
         filtered rather than passed straight through. */
      append(actions, ...[
        el("span", { class: "save-state", text: this.saveLabel() }),
        el("button", { class: "text-button", type: "button", onclick: () => this.context.askAboutPage(page) }, "Ask Clyra"),
        el("button", { class: "text-button", type: "button", onclick: (event) => this.context.shareMenu(page, event.currentTarget) }, "Share"),
        this.favoriteButton(page),
        iconButton("dots", "Page settings", (event) => this.context.pageMenu(page, event.currentTarget)),
      ].filter(Boolean));
    } else {
      append(crumbs, el("span", { class: "crumb current" }, el("span", { text: this.context.tabLabel(tab || { kind: "home" }).title })));
      append(actions,
        tab?.kind === "chat"
          ? iconButton("panel", "Show or hide chat history", () => this.context.currentView?.toggleHistory?.())
          : null,
        el("span", { class: "save-state", text: this.saveLabel() }));
    }
    this.host.append(crumbs, actions);
  }

  favoriteButton(page) {
    if (!page) return null;
    const button = tooltip(el("button", {
      class: `icon-button${page.favorite ? " active" : ""}`, type: "button",
      "aria-pressed": page.favorite ? "true" : "false",
      onclick: async () => {
        const next = !page.favorite;
        page.favorite = next;
        button.classList.toggle("active", next);
        button.setAttribute("aria-pressed", next ? "true" : "false");
        await withError(() => api.patch(`/api/notes/pages/${page.id}`, { favorite: next }), "Could not update favourites");
        this.context.refreshSidebar();
      },
    }, icon("star", 16)), page.favorite ? "Remove from favourites" : "Add to favourites");
    return button;
  }

  saveLabel() {
    return { saving: "Saving…", saved: "Saved", offline: "Offline — changes kept", error: "Save failed — retrying" }[state.saveStatus] || "";
  }

  trailFor(pageId) {
    const trail = [];
    let cursor = getPageMeta(pageId);
    const guard = new Set();
    while (cursor && !guard.has(String(cursor.id))) {
      guard.add(String(cursor.id));
      trail.unshift(cursor);
      cursor = cursor.parent_id ? getPageMeta(cursor.parent_id) : null;
    }
    return trail;
  }
}
