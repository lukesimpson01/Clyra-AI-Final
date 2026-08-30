/* Application controller: bootstraps the workspace, owns the tab router and
   provides the shared actions every surface calls back into. */
import { el, clear, icon, iconButton, menu, modal, toast, confirmDialog, closeTopLayer, closeAllLayers, layerCount, mod, modKey, append } from "./dom.js";
import { api } from "./api.js";
import {
  state, subscribe, emit, loadWorkspace, refreshPages, restoreSession, saveSession,
  openTab, closeTab, selectTab, activeTab, cycleTab, reopenTab, getPageMeta,
  flushAll, flushPage, dropPage, withError, childrenOf,
} from "./state.js";
import { Sidebar, TabStrip, Toolbar } from "./shell.js";
import { PageView } from "./page-view.js";
import { openSearch } from "./search.js";
import { renderHome } from "./views/home.js";
import { renderFlashcards } from "./views/flashcards.js";
import { renderTests } from "./views/tests.js";
import { renderChat } from "./views/chat.js";
import { renderInbox } from "./views/inbox.js";
import { renderLibrary } from "./views/library.js";
import { openTrash } from "./views/trash.js";
import { openTemplates } from "./views/templates.js";
import { openImport } from "./views/import.js";
import { openCourses, openSettings } from "./views/settings.js";
import { runGenerator } from "./views/generators.js";

const TAB_LABELS = {
  home: { title: "Home", icon: "home" },
  chat: { title: "AI chat", icon: "sparkle" },
  flashcards: { title: "Flashcards", icon: "cards" },
  tests: { title: "Practice tests", icon: "check_square" },
  inbox: { title: "Inbox", icon: "inbox" },
  library: { title: "Library", icon: "book" },
};

class App {
  constructor(root) {
    this.root = root;
    this.history = [];
    this.forward = [];
    this.currentView = null;
  }

  async start() {
    restoreSession();
    this.applySidebarWidth();
    window.addEventListener("resize", () => this.applySidebarWidth());
    this.build();
    await withError(() => loadWorkspace(), "Clyra Notes could not load your workspace.");
    if (!state.tabs.length) openTab({ kind: "home" }, { newTab: true });
    this.sidebar.build();
    this.renderChrome();
    this.renderSurface();
    this.bindKeys();
    subscribe((reason) => {
      if (reason === "tabs") { this.renderChrome(); this.renderSurface(); }
      else if (reason === "pages" || reason === "workspace") { this.sidebar.renderBody(); this.toolbar.render(); this.tabstrip.render(); }
      else if (reason === "save-status") this.toolbar.render();
    });
    window.addEventListener("clyra:open-page", (event) => this.openPage(event.detail.id, { newTab: event.detail.newTab }));
    this.root.removeAttribute("aria-busy");
  }

  build() {
    clear(this.root);
    this.root.className = `workspace${state.sidebarHidden ? " sidebar-hidden" : ""}`;
    const sidebarHost = el("aside", { class: "sidebar", "aria-label": "Workspace navigation" });
    this.tabstripHost = el("div", { class: "tabstrip" });
    this.toolbarHost = el("div", { class: "doc-toolbar" });
    this.surface = el("main", { class: "surface" });
    this.root.append(
      sidebarHost,
      el("div", { class: "sidebar-scrim", onclick: () => this.closeMobileSidebar() }),
      el("div", { class: "main" }, this.tabstripHost, this.toolbarHost, this.surface),
    );
    this.sidebar = new Sidebar(sidebarHost, this);
    this.tabstrip = new TabStrip(this.tabstripHost, this);
    this.toolbar = new Toolbar(this.toolbarHost, this);
  }

  renderChrome() {
    this.tabstrip.render();
    this.toolbar.render();
    this.sidebar.renderBody();
  }

  renderSurface() {
    const tab = activeTab();
    if (!tab) return;
    const key = tab.kind === "page" ? `page:${tab.pageId}` : tab.kind;
    if (this.currentKey === key && this.currentTabId === tab.id) return;
    this.currentView?.destroy?.();
    this.currentKey = key;
    this.currentTabId = tab.id;
    clear(this.surface);
    state.view = { kind: tab.kind };
    if (tab.kind === "page") {
      this.currentView = new PageView(this.surface, tab.pageId, this);
      return;
    }
    const renderers = {
      home: renderHome, chat: renderChat, flashcards: renderFlashcards,
      tests: renderTests, inbox: renderInbox, library: renderLibrary,
    };
    const render = renderers[tab.kind] || renderHome;
    this.currentView = render(this.surface, this) || null;
  }

  /* ------------------------------------------------------- navigation */

  tabLabel(tab) {
    if (tab.kind === "page") {
      const page = getPageMeta(tab.pageId);
      const emoji = page?.icon && !/^https?:|^\//.test(page.icon) ? page.icon : null;
      return { title: page?.title || "New page", icon: page?.kind === "database" ? "table" : "page", emoji };
    }
    return TAB_LABELS[tab.kind] || TAB_LABELS.home;
  }

  openPage(id, options = {}) {
    if (!id) return;
    this.pushHistory();
    /* A block target survives the tab switch so "Show source" lands on the
       exact paragraph, including when the page is already open. */
    this.pendingBlock = options.blockId || null;
    const current = activeTab();
    const already = current?.kind === "page" && String(current.pageId) === String(id) && !options.newTab;
    openTab({ kind: "page", pageId: String(id) }, options);
    if (already) this.revealBlock();
  }

  revealBlock() {
    const blockId = this.pendingBlock;
    this.pendingBlock = null;
    if (!blockId) return;
    const node = this.surface.querySelector(`[data-block="${CSS.escape(blockId)}"]`);
    if (!node) return;
    node.scrollIntoView({ behavior: "smooth", block: "center" });
    node.classList.remove("cited");
    void node.offsetWidth;
    node.classList.add("cited");
    setTimeout(() => node.classList.remove("cited"), 1800);
  }

  /* Navigating to the view you are already on reloads it, which is what
     makes "generate, then land back on Flashcards" show the new deck. */
  openView(view, options = {}) {
    const current = activeTab();
    const repeat = Boolean(current && current.kind === view.kind && view.kind !== "page" && !options.newTab);
    this.pushHistory();
    openTab(view, options);
    if (repeat) this.reloadView();
  }

  /* A saved sidebar width would otherwise swallow a narrow window, because
     an inline custom property beats the responsive rule in the stylesheet. */
  applySidebarWidth() {
    const cap = Math.max(200, Math.round(window.innerWidth * 0.3));
    document.documentElement.style.setProperty("--sidebar-width", `${Math.min(state.sidebarWidth, cap)}px`);
  }

  reloadView() {
    this.currentKey = null;
    this.renderSurface();
  }

  pushHistory() {
    const tab = activeTab();
    if (!tab) return;
    this.history.push({ kind: tab.kind, pageId: tab.pageId });
    if (this.history.length > 60) this.history.shift();
    this.forward.length = 0;
  }

  goBack() {
    const entry = this.history.pop();
    if (!entry) return;
    const tab = activeTab();
    if (tab) this.forward.push({ kind: tab.kind, pageId: tab.pageId });
    openTab(entry);
  }

  goForward() {
    const entry = this.forward.pop();
    if (!entry) return;
    const tab = activeTab();
    if (tab) this.history.push({ kind: tab.kind, pageId: tab.pageId });
    openTab(entry);
  }

  /* Renaming a page has to show up where the name is repeated — the tab, the
     breadcrumb and the sidebar row — otherwise the document looks unnamed
     however much you type. Debounced so a keystroke is not a full repaint. */
  onTitleChanged() {
    clearTimeout(this.titleRepaint);
    this.titleRepaint = setTimeout(() => this.repaintChrome(), 140);
  }

  onMetaChanged() { this.repaintChrome(); }

  repaintChrome() {
    this.tabstrip.render();
    this.toolbar.render();
    this.sidebar.renderBody();
  }

  goHome() { this.openView({ kind: "home" }); }
  reopenTab() { reopenTab(); }
  refreshSidebar() { this.sidebar.renderBody(); }

  closeMobileSidebar() { this.root.classList.remove("sidebar-open"); }

  toggleSidebar() {
    if (window.matchMedia("(max-width: 860px)").matches) {
      this.root.classList.toggle("sidebar-open");
      return;
    }
    state.sidebarHidden = !state.sidebarHidden;
    saveSession();
    this.root.classList.toggle("sidebar-hidden", state.sidebarHidden);
  }

  openSearch() { openSearch(); }

  /* ---------------------------------------------------------- actions */

  async createPage(parentId, options = {}) {
    const { newTab, ...extra } = options;
    const created = await withError(
      () => api.post("/api/notes/pages", { parentId: parentId || null, title: "", ...extra }),
      "Could not create a page",
    );
    if (!created) return null;
    await refreshPages();
    if (parentId) state.expanded.add(String(parentId));
    this.openPage(created.id, { newTab });
    return created;
  }

  newChat() { this.openView({ kind: "chat" }); window.dispatchEvent(new CustomEvent("clyra:new-chat")); }

  /* Subjects are the sidebar's grouping primitive, so creating and editing
     one lives next to the sections it produces rather than in Settings. */
  async newSubject() {
    const field = el("input", { class: "input", placeholder: "e.g. Biology", "aria-label": "Subject name" });
    let entry;
    const submit = async () => {
      const name = field.value.trim();
      if (!name) { toast("Give the subject a name", "error"); return; }
      entry.close("created");
      const course = await withError(() => api.post("/api/notes/classes", { name }), "Could not create the subject");
      if (!course) return;
      state.classes.push(course);
      state.collapsedSections.delete(name.toLowerCase());
      this.repaintChrome();
      toast(`${name} added`);
    };
    entry = modal({
      title: "New subject", width: 420,
      body: el("div", {},
        el("label", { class: "field" },
          el("span", { class: "field-label", text: "Name" }), field),
        el("p", { class: "field-note", text: "Subjects group pages in the sidebar. Drag a page onto a subject to file it there." })),
      footer: [
        el("button", { class: "button", type: "button", onclick: () => entry.close("cancel") }, "Cancel"),
        el("button", { class: "button primary", type: "button", onclick: submit }, "Create"),
      ],
    });
    field.addEventListener("keydown", (event) => { if (event.key === "Enter") { event.preventDefault(); submit(); } });
  }

  async renameSubject(classId, current) {
    const field = el("input", { class: "input", value: current, "aria-label": "Subject name" });
    let entry;
    const submit = async () => {
      const name = field.value.trim();
      if (!name || name === current) { entry.close("cancel"); return; }
      entry.close("renamed");
      await withError(() => api.patch(`/api/notes/classes/${classId}`, { name }), "Could not rename the subject");
      const course = state.classes.find((entry_) => entry_.id === classId);
      if (course) course.name = name;
      this.repaintChrome();
    };
    entry = modal({
      title: "Rename subject", width: 400,
      body: el("label", { class: "field" }, field),
      footer: [
        el("button", { class: "button", type: "button", onclick: () => entry.close("cancel") }, "Cancel"),
        el("button", { class: "button primary", type: "button", onclick: submit }, "Save"),
      ],
    });
    field.addEventListener("keydown", (event) => { if (event.key === "Enter") { event.preventDefault(); submit(); } });
  }

  async deleteSubject(classId, name) {
    const count = state.pages.filter((page) => page.class_id === classId).length;
    const ok = await confirmDialog({
      title: "Delete subject",
      message: `"${name}" is removed. Its ${count} page${count === 1 ? "" : "s"} ${count === 1 ? "moves" : "move"} to Private — nothing is deleted.`,
      confirmLabel: "Delete subject",
    });
    if (!ok) return;
    await withError(() => api.del(`/api/notes/classes/${classId}`), "Could not delete the subject");
    state.classes = state.classes.filter((course) => course.id !== classId);
    await refreshPages();
    this.repaintChrome();
  }

  /* Shared by the sidebar's trash button and the page menu so both confirm
     and clean up identically. */
  async trashPage(page, onChange) {
    const ok = await confirmDialog({
      title: "Move to trash",
      message: `"${page.title || "New page"}" and everything inside it moves to the trash. You can restore it later.`,
      confirmLabel: "Move to trash",
    });
    if (!ok) return;
    await withError(() => api.del(`/api/notes/pages/${page.id}`), "Could not delete");
    state.tabs.filter((tab) => tab.kind === "page" && String(tab.pageId) === String(page.id)).forEach((tab) => closeTab(tab.id));
    dropPage(String(page.id));
    state.trashCount += 1;
    await refreshPages();
    onChange?.();
    this.repaintChrome();
  }

  openTemplates(parentId) { openTemplates(this, parentId); }
  openImport(parentId) { openImport(this, parentId); }
  openTrash() { openTrash(this); }
  openCourses() { openCourses(this); }
  openSettings() { openSettings(this); }
  generate(kind, target) { runGenerator(this, kind, target); }

  async exportAll() {
    const result = await withError(() => api.post("/api/notes/export"), "Export failed");
    if (result) toast(`Exported ${result.count} notes to ${result.path}`);
  }

  shareMenu(page, anchor) {
    menu(anchor, [
      { type: "label", label: "Access" },
      { label: "Private to you", icon: "lock", checked: true, disabled: true },
      { type: "separator" },
      { label: "Copy link", icon: "link", onSelect: () => {
        navigator.clipboard.writeText(`${location.origin}/notes#${page.id}`);
        toast("Link copied");
      } },
      { label: "Export as Markdown", icon: "export", onSelect: () => this.exportPage(page) },
    ], { align: "end" });
  }

  async exportPage(page) {
    const markdown = await withError(() => api.get(`/api/notes/pages/${page.id}/markdown`), "Export failed");
    if (markdown === null) return;
    const blob = new Blob([markdown], { type: "text/markdown" });
    const link = el("a", { href: URL.createObjectURL(blob), download: `${(page.title || "Untitled").replace(/[^\w -]/g, "")}.md` });
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 4000);
  }

  pageMenu(page, anchor, onChange, options = {}) {
    if (!page) return;
    const id = String(page.id);
    const refresh = async () => { await refreshPages(); onChange?.(); this.toolbar.render(); this.tabstrip.render(); };
    menu(anchor, [
      options.onRename
        ? { label: "Rename", icon: "text", shortcut: "Double-click", onSelect: () => options.onRename() }
        : { label: "Rename", icon: "text", onSelect: () => this.renameDialog(page, refresh) },
      { label: page.favorite ? "Remove from favourites" : "Add to favourites", icon: "star", onSelect: async () => {
        await withError(() => api.patch(`/api/notes/pages/${id}`, { favorite: !page.favorite }), "Could not update favourites");
        await refresh();
      } },
      { label: "Duplicate", icon: "duplicate", onSelect: async () => {
        const copy = await withError(() => api.post(`/api/notes/pages/${id}/duplicate`), "Could not duplicate");
        if (copy) { await refresh(); this.openPage(copy.id); }
      } },
      { label: "Copy link", icon: "link", onSelect: () => { navigator.clipboard.writeText(`${location.origin}/notes#${id}`); toast("Link copied"); } },
      { label: "Move to", icon: "move", onSelect: () => this.moveDialog(page, refresh) },
      { label: "Move to subject", icon: "book", onSelect: () => this.subjectPicker(page, anchor, refresh) },
      { type: "separator" },
      { label: "Export as Markdown", icon: "export", onSelect: () => this.exportPage(page) },
      { label: page.locked ? "Unlock page" : "Lock page", icon: "lock", onSelect: async () => {
        await withError(() => api.patch(`/api/notes/pages/${id}`, { locked: !page.locked }), "Could not change the lock");
        dropPage(id);
        await refresh();
        this.currentKey = null;
        this.renderSurface();
      } },
      { label: "Version history", icon: "history", onSelect: () => this.versionDialog(page) },
      { type: "separator" },
      { type: "label", label: "Layout" },
      { label: "Full width", icon: "panel", checked: Boolean(page.full_width), onSelect: async () => {
        await withError(() => api.patch(`/api/notes/pages/${id}`, { fullWidth: !page.full_width }), "Could not update layout");
        dropPage(id); await refresh(); this.currentKey = null; this.renderSurface();
      } },
      { label: "Text size", icon: "text", onSelect: () => this.textSizeMenu(page, anchor, refresh) },
      { label: "Font", icon: "text", onSelect: () => this.fontMenu(page, anchor, refresh) },
      { type: "separator" },
      { label: "Move to trash", icon: "trash", danger: true, onSelect: () => this.trashPage(page, onChange) },
    ], { align: "end" });
  }

  /* The toolbar has no row to edit in place, so it gets a dialog that does
     the same job. */
  renameDialog(page, refresh) {
    const field = el("input", { class: "input", value: page.title || "", placeholder: "New page", "aria-label": "Page name" });
    let entry;
    const submit = async () => {
      const name = field.value.trim();
      entry.close("saved");
      if (name === (page.title || "")) return;
      await withError(() => api.patch(`/api/notes/pages/${page.id}`, { title: name }), "Could not rename that page");
      dropPage(String(page.id));
      await refresh();
      this.currentKey = null;
      this.renderSurface();
    };
    entry = modal({
      title: "Rename page", width: 400,
      body: el("label", { class: "field" }, field),
      footer: [
        el("button", { class: "button", type: "button", onclick: () => entry.close("cancel") }, "Cancel"),
        el("button", { class: "button primary", type: "button", onclick: submit }, "Save"),
      ],
    });
    field.addEventListener("keydown", (event) => { if (event.key === "Enter") { event.preventDefault(); submit(); } });
  }

  subjectPicker(page, anchor, refresh) {
    const items = state.classes.map((course) => ({
      label: course.name, icon: "book", checked: page.class_id === course.id,
      onSelect: async () => {
        await withError(() => api.patch(`/api/notes/pages/${page.id}`, { classId: course.id }), "Could not move that page");
        await refresh();
        toast(`Moved to ${course.name}`);
      },
    }));
    menu(anchor, [
      ...(items.length ? items : [{ label: "No subjects yet", disabled: true }]),
      { type: "separator" },
      page.class_id
        ? { label: "Remove from subject", icon: "close", onSelect: async () => {
            await withError(() => api.patch(`/api/notes/pages/${page.id}`, { classId: null }), "Could not move that page");
            await refresh();
          } }
        : null,
      { label: "New subject…", icon: "plus", onSelect: () => this.newSubject() },
    ].filter(Boolean), { align: "end", search: items.length > 6, searchPlaceholder: "Find a subject…" });
  }

  textSizeMenu(page, anchor, refresh) {
    menu(anchor, ["small", "medium", "large", "xl"].map((size) => ({
      label: { small: "Small", medium: "Medium", large: "Large", xl: "Extra large" }[size],
      checked: (page.text_size || "medium") === size,
      onSelect: async () => {
        await withError(() => api.patch(`/api/notes/pages/${page.id}`, { textSize: size }), "Could not update text size");
        dropPage(String(page.id)); await refresh(); this.currentKey = null; this.renderSurface();
      },
    })), { align: "end" });
  }

  fontMenu(page, anchor, refresh) {
    menu(anchor, ["default", "serif", "mono"].map((font) => ({
      label: { default: "Default", serif: "Serif", mono: "Mono" }[font],
      checked: (page.font_style || "default") === font,
      onSelect: async () => {
        await withError(() => api.patch(`/api/notes/pages/${page.id}`, { fontStyle: font }), "Could not update the font");
        dropPage(String(page.id)); await refresh(); this.currentKey = null; this.renderSurface();
      },
    })), { align: "end" });
  }

  moveDialog(page, refresh) {
    openSearch({
      title: "Move to",
      onSelect: async (target) => {
        const parentId = target.page_id || target.id;
        if (String(parentId) === String(page.id)) { toast("A page cannot be moved into itself", "error"); return; }
        const result = await withError(() => api.post(`/api/notes/pages/${page.id}/move`, { parentId, index: 0 }), "Could not move that page");
        if (result?.error) { toast(result.error, "error"); return; }
        state.expanded.add(String(parentId));
        await refresh();
        toast("Page moved");
      },
    });
  }

  async versionDialog(page) {
    const loaded = await withError(() => api.get(`/api/notes/pages/${page.id}`), "Could not load history");
    if (!loaded) return;
    const versions = loaded.versions || [];
    let entry;
    entry = modal({
      title: "Version history",
      width: 460,
      body: versions.length
        ? el("div", { class: "version-list" }, versions.map((version) =>
            el("div", { class: "version-row" },
              el("span", { class: "version-time", text: formatDateTime(version.created_at) }),
              el("button", {
                class: "button", type: "button",
                onclick: async () => {
                  const ok = await confirmDialog({
                    title: "Restore this version",
                    message: "The current content is saved as a new version first, so nothing is lost.",
                    confirmLabel: "Restore", danger: false,
                  });
                  if (!ok) return;
                  await withError(() => api.post(`/api/notes/pages/${page.id}/versions/${version.id}/restore`), "Could not restore");
                  dropPage(String(page.id));
                  entry.close("restored");
                  this.currentKey = null;
                  this.renderSurface();
                  toast("Version restored");
                },
              }, "Restore"))))
        : el("div", { class: "empty-state", text: "No earlier versions yet. Clyra saves one automatically as you edit." }),
    });
  }

  /* -------------------------------------------------------- shortcuts */

  bindKeys() {
    document.addEventListener("keydown", (event) => {
      const typing = event.target.closest?.("input, textarea, [contenteditable='true']");
      if (event.key === "Escape" && layerCount()) { event.preventDefault(); closeTopLayer(); return; }
      if (modKey(event) && event.key.toLowerCase() === "k") { event.preventDefault(); openSearch(); return; }
      if (modKey(event) && event.key.toLowerCase() === "p" && !event.shiftKey) { event.preventDefault(); openSearch(); return; }
      if (modKey(event) && event.key === "\\") { event.preventDefault(); this.toggleSidebar(); return; }
      if (modKey(event) && event.key.toLowerCase() === "n" && !typing) { event.preventDefault(); this.createPage(null); return; }
      if (modKey(event) && event.key.toLowerCase() === "t" && !event.shiftKey) { event.preventDefault(); this.openView({ kind: "home" }, { newTab: true }); return; }
      if (modKey(event) && event.shiftKey && event.key.toLowerCase() === "t") { event.preventDefault(); reopenTab(); return; }
      if (modKey(event) && event.key.toLowerCase() === "w") { event.preventDefault(); if (state.activeTab) closeTab(state.activeTab); return; }
      if (modKey(event) && event.key === "[") { event.preventDefault(); this.goBack(); return; }
      if (modKey(event) && event.key === "]") { event.preventDefault(); this.goForward(); return; }
      if (event.altKey && event.key === "ArrowRight") { event.preventDefault(); cycleTab(1); return; }
      if (event.altKey && event.key === "ArrowLeft") { event.preventDefault(); cycleTab(-1); return; }
      if (modKey(event) && /^[1-9]$/.test(event.key) && !typing) {
        const tab = state.tabs[Number(event.key) - 1];
        if (tab) { event.preventDefault(); selectTab(tab.id); }
      }
    });
  }
}

export const formatDateTime = (value) => {
  if (!value) return "";
  const date = new Date(String(value).includes("T") ? value : `${String(value).replace(" ", "T")}Z`);
  if (!Number.isFinite(date.getTime())) return String(value);
  return date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
};

export const formatRelative = (value) => {
  if (!value) return "";
  const date = new Date(String(value).includes("T") ? value : `${String(value).replace(" ", "T")}Z`);
  const elapsed = Date.now() - date.getTime();
  if (!Number.isFinite(elapsed)) return "";
  const minutes = Math.round(elapsed / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
};

const app = new App(document.getElementById("root"));
window.clyraNotes = app;
app.start();
