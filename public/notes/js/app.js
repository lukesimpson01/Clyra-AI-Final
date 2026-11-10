/* Application controller: bootstraps the workspace, owns the tab router and
   provides the shared actions every surface calls back into. */
import { el, clear, icon, iconButton, menu, modal, toast, confirmDialog, closeTopLayer, closeAllLayers, layerCount, mod, modKey, append, frozenHtml } from "./dom.js";
import { api } from "./api.js";
import {
  state, subscribe, emit, loadWorkspace, refreshPages, restoreSession, saveSession,
  openTab, closeTab, selectTab, activeTab, cycleTab, reopenTab, getPageMeta,
  flushAll, flushPage, dropPage, withError, childrenOf, isSealed,
} from "./state.js";
import { Sidebar, TabStrip, Toolbar } from "./shell.js";
import { Rail } from "./rail.js";
import { readPreference, prefOn, shortcutMatches } from "./preferences.js";
import { PageView } from "./page-view.js";
import { openLockDialog } from "./passcode.js";
import { openSearch } from "./search.js";
import { renderHome } from "./views/home.js";
import { renderFlashcards } from "./views/flashcards.js";
import { renderTests } from "./views/tests.js";
import { renderChat } from "./views/chat.js";
import { renderWelcome, loadTourState, tourSeen, markTourSeen } from "./views/welcome.js";
import { openCommandPalette } from "./command-palette.js";
import { renderInbox } from "./views/inbox.js";
import { renderLibrary } from "./views/library.js";
import { renderFiles } from "./views/files.js";
import { openTrash } from "./views/trash.js";
import { renderTemplatesView } from "./views/templates.js";
import { openImport } from "./views/import.js";
import { openCourses, openSettings } from "./views/settings.js";
import { runGenerator } from "./views/generators.js";
import { openTerminal } from "./runner.js";
import { TaskView } from "./task-view.js";
import { openVersions } from "./version-history.js";

const TAB_LABELS = {
  home: { title: "Home", icon: "home" },
  welcome: { title: "Welcome", icon: "home", emoji: "\u{1F44B}" },
  templates: { title: "Templates", icon: "template" },
  chat: { title: "AI chat", icon: "comment" },
  flashcards: { title: "Flashcards", icon: "cards" },
  tests: { title: "Practice tests", icon: "check_square" },
  inbox: { title: "Inbox", icon: "inbox" },
  library: { title: "Library", icon: "book" },
  files: { title: "Files", icon: "grid" },
};

class App {
  constructor(root) {
    this.root = root;
    this.history = [];
    this.forward = [];
    this.currentView = null;
    this.paneViews = new Map();
    this.split = null;
    this.splitPanels = null;
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
    /* The rail is constructed before the workspace has loaded, so anything
       it built from empty state — the chat panel's "AI is not configured"
       screen above all — is refreshed once the real answer is in. */
    this.rail?.refresh();
    this.bindKeys();
    subscribe((reason) => {
      if (reason === "tabs") { this.renderChrome(); this.renderSurface(); this.maybeOpenRail(); this.rail?.refresh(); }
      else if (reason === "pages" || reason === "workspace") {
        this.sidebar.renderBody();
        this.toolbar.render();
        this.tabstrip.render();
        this.rail?.refresh();
      }
      else if (reason === "save-status") this.toolbar.render();
    });
    window.addEventListener("clyra:open-page", (event) => this.openPage(event.detail.id, { newTab: event.detail.newTab }));
    /* Links to a page, or to one block of it (/notes#page or /notes#page:block), open it: the links Copy link and the chat's "Open note" make. */
    const followLink = () => {
      const [pageId, blockId] = decodeURIComponent(location.hash.slice(1)).split(":");
      if (!pageId || !getPageMeta(pageId)) return;
      this.openPage(pageId, { blockId: blockId || undefined });
      history.replaceState(null, "", `${location.pathname}${location.search}`);
    };
    window.addEventListener("hashchange", followLink);
    followLink();
    /* The first time this workspace is opened, it opens on the tour. It stays in the sidebar for later. */
    try {
      await loadTourState();
      if (!tourSeen() && !location.hash) { markTourSeen(); this.openView({ kind: "welcome" }); }
    } catch { /* skip the tour */ }
    this.root.removeAttribute("aria-busy");
  }

  build() {
    clear(this.root);
    this.root.className = `workspace${state.sidebarHidden ? " sidebar-hidden" : ""}${state.railHidden === false ? "" : " rail-hidden"}`;
    const sidebarHost = el("aside", { class: "sidebar", "aria-label": "Workspace navigation" });
    this.tabstripHost = el("div", { class: "tabstrip" });
    this.toolbarHost = el("div", { class: "doc-toolbar" });
    this.surface = el("main", { class: "surface" });
    const railHost = el("aside", { class: "rail", "aria-label": "Tools" });
    this.main = el("div", { class: "main" }, this.tabstripHost, this.toolbarHost, this.surface);
    this.root.append(
      sidebarHost,
      el("div", { class: "sidebar-scrim", onclick: () => this.closeMobileSidebar() }),
      this.main,
      railHost,
    );
    this.sidebar = new Sidebar(sidebarHost, this);
    this.listenForImport();
    this.tabstrip = new TabStrip(this.tabstripHost, this);
    this.toolbar = new Toolbar(this.toolbarHost, this);
    this.rail = new Rail(railHost, this);
  }

  renderChrome() {
    this.reconcileSplit();
    this.tabstrip.render();
    this.toolbar.render();
    this.sidebar.renderBody();
  }

  renderSurface() {
    const tab = activeTab();
    if (!tab) return;
    this.reconcileSplit();
    if (this.split) { this.renderSplitSurface(); return; }
    const key = tab.kind === "page" ? `page:${tab.pageId}` : tab.kind;
    if (this.currentKey === key && this.currentTabId === tab.id) return;
    /* Anchored menus belong to the view that opened them.  Leaving one on
       screen when its toolbar is unmounted creates orphaned controls and can
       overlap the next note or template. */
    closeAllLayers("navigation");
    this.captureActiveTabPreview();
    this.currentView?.destroy?.();
    this.currentKey = key;
    this.currentTabId = tab.id;
    this.surface.className = "surface";
    clear(this.surface);
    state.view = { kind: tab.kind };
    if (tab.kind === "page") {
      this.currentView = new PageView(this.surface, tab.pageId, this, tab.scrollTop || 0);
      return;
    }
    const renderers = {
      home: renderHome, welcome: renderWelcome, templates: (surface, app) => renderTemplatesView(surface, app, activeTab()?.parentId), chat: renderChat, flashcards: renderFlashcards,
      tests: renderTests, inbox: renderInbox, library: renderLibrary, files: renderFiles,
    };
    const render = renderers[tab.kind] || renderHome;
    this.currentView = render(this.surface, this) || null;
  }

  /* Split panes stay real PageViews. Each group has its own tab run while the
     primary strip remains the workspace dock. Keeping this state local means
     a person can experiment with a layout without changing their saved tabs. */
  renderSplitSurface() {
    const groups = this.split.groups;
    const active = activeTab();
    closeAllLayers("navigation");
    this.captureSplitPreviews();
    if (!this.paneNodes) this.paneNodes = new Map();
    /* The old single-view surface is replaced once, then panes are reconciled
       in place so an editor never remounts just because a neighbouring tab
       opened, closed or moved. */
    if (!this.surface.classList.contains("split-surface")) {
      this.currentView?.destroy?.();
      this.currentView = null;
      clear(this.surface);
      this.paneNodes.clear();
    }
    this.surface.className = `surface split-surface ${this.split.layout}`;
    this.surface.dataset.panes = String(groups.length);
    this.currentKey = `split:${this.split.layout}`;
    this.currentTabId = active?.id || null;
    state.view = { kind: active?.kind || "page" };
    const wanted = new Set(groups.map((group) => group.id));
    for (const [id, entry] of [...this.paneNodes]) {
      if (wanted.has(id)) continue;
      this.paneNodes.delete(id);
      entry.view?.destroy?.();
      for (const key of [...this.paneViews.keys()]) if (this.paneViews.get(key) === entry.view) this.paneViews.delete(key);
      entry.pane.classList.add("leaving");
      setTimeout(() => entry.pane.remove(), 200);
    }
    let cursor = null;
    for (const group of groups) {
      let entry = this.paneNodes.get(group.id);
      if (!entry) entry = this.createPane(group);
      entry.group = group;
      if (entry.pane.previousElementSibling !== cursor && entry.pane.parentNode) this.surface.insertBefore(entry.pane, cursor ? cursor.nextSibling : this.surface.firstChild);
      else if (!entry.pane.parentNode) this.surface.insertBefore(entry.pane, cursor ? cursor.nextSibling : this.surface.firstChild);
      cursor = entry.pane;
      const paneTab = state.tabs.find((tab) => tab.id === group.activeId);
      entry.pane.classList.toggle("active", paneTab?.id === active?.id);
      entry.pane.dataset.tabId = paneTab?.id || "";
      this.paintPaneTabs(entry, group);
      if (paneTab && entry.tabId !== paneTab.id) {
        entry.view?.destroy?.();
        for (const key of [...this.paneViews.keys()]) if (this.paneViews.get(key) === entry.view) this.paneViews.delete(key);
        clear(entry.body);
        entry.tabId = paneTab.id;
        entry.view = new PageView(entry.body, paneTab.pageId, this, paneTab.scrollTop || 0);
        this.paneViews.set(paneTab.id, entry.view);
      }
      if (paneTab && paneTab.id === active?.id) this.currentView = entry.view;
    }
    this.surface.querySelectorAll(".split-drop-overlay").forEach((node) => this.surface.append(node));
  }

  createPane(group) {
    const entry = { group, pane: null, head: null, list: null, body: null, view: null, tabId: null, nodes: new Map() };
    entry.list = el("div", { class: "split-pane-tabs", role: "tablist", "aria-label": "Split note tabs" });
    entry.head = el("header", { class: "split-pane-head" }, entry.list,
      iconButton("plus", "Open a new note here", () => { this.split.focus = entry.group.id; this.createPage(null, { newTab: true }); }, { size: 14, className: "split-pane-add" }),
      iconButton("close", "Close this group", () => this.closeGroup(entry.group.id), { size: 14, className: "split-pane-close" }));
    entry.body = el("div", { class: "split-pane-body" });
    entry.pane = el("section", {
      class: "split-pane entering", dataset: { groupId: group.id },
      onpointerdown: () => {
        this.split.focus = entry.group.id;
        const id = entry.group.activeId;
        if (id && state.activeTab !== id) this.selectSplitTab(entry.group.id, id);
      },
      ondragover: (event) => { if (this.paneDrag) { event.preventDefault(); entry.pane.classList.add("drop-ready"); } },
      ondragleave: (event) => { if (!entry.pane.contains(event.relatedTarget)) entry.pane.classList.remove("drop-ready"); },
      ondrop: (event) => {
        entry.pane.classList.remove("drop-ready");
        const tabId = this.paneDrag?.tabId;
        if (!tabId) return;
        event.preventDefault();
        this.moveTabToPane(tabId, entry.group.id);
        this.paneDrag = null;
        this.clearSplitTargets();
      },
    }, entry.head, entry.body);
    this.paneNodes.set(group.id, entry);
    setTimeout(() => entry.pane.classList.remove("entering"), 320);
    return entry;
  }

  /* Pane tabs are reconciled like the dock: a new tab grows into place, a
     closed one collapses first, and its neighbours slide across with it. */
  paintPaneTabs(entry, group) {
    const tabs = group.tabIds.map((id) => state.tabs.find((tab) => tab.id === id)).filter((tab) => tab?.kind === "page");
    const wanted = new Set(tabs.map((tab) => tab.id));
    for (const [id, node] of [...entry.nodes]) {
      if (wanted.has(id)) continue;
      entry.nodes.delete(id);
      node.classList.add("closing");
      node.classList.remove("settled");
      node.style.pointerEvents = "none";
      setTimeout(() => node.remove(), 220);
    }
    let cursor = entry.list.firstChild;
    while (cursor && cursor.classList.contains("closing")) cursor = cursor.nextSibling;
    for (const tab of tabs) {
      let node = entry.nodes.get(tab.id);
      const label = this.tabLabel(tab);
      if (!node) {
        node = this.paneTabNode(entry, tab);
        entry.nodes.set(tab.id, node);
        entry.list.insertBefore(node, cursor);
        void node.offsetWidth;
        node.classList.add("settled");
      } else if (node !== cursor) entry.list.insertBefore(node, cursor);
      const icon$ = node.querySelector(".split-pane-icon");
      clear(icon$);
      if (label.emoji) icon$.textContent = label.emoji; else icon$.append(icon(label.icon, 13));
      node.querySelector(".split-pane-tab-label").textContent = label.title;
      node.title = label.title;
      node.classList.toggle("active", tab.id === group.activeId);
      node.setAttribute("aria-selected", String(tab.id === group.activeId));
      cursor = node.nextSibling;
      while (cursor && cursor.classList.contains("closing")) cursor = cursor.nextSibling;
    }
  }

  paneTabNode(entry, tab) {
    const node = el("div", {
      class: "split-pane-tab", role: "tab", draggable: "true", tabindex: "0",
      onclick: (event) => { event.stopPropagation(); this.selectSplitTab(entry.group.id, tab.id); },
      onauxclick: (event) => { if (event.button === 1) { event.preventDefault(); closeTab(tab.id); } },
      oncontextmenu: (event) => {
        event.preventDefault();
        menu(node, [
          { label: "Close tab", icon: "close", onSelect: () => closeTab(tab.id) },
          { label: "Return to top strip", icon: "arrow_left", onSelect: () => this.returnTabToTop(tab.id) },
        ]);
      },
    },
      el("span", { class: "split-pane-icon" }),
      el("span", { class: "split-pane-tab-label" }),
      el("button", { class: "split-pane-tab-close", type: "button", tabindex: "-1", onclick: (event) => { event.stopPropagation(); closeTab(tab.id); } }, icon("close", 11)));
    this.tabstrip?.bindPreview(node, tab);
    node.addEventListener("dragstart", (event) => {
      this.tabstrip?.hideTabPreview();
      this.paneDrag = { tabId: tab.id, groupId: entry.group.id };
      if (event.dataTransfer) { event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", tab.id); }
      node.classList.add("dragging");
      this.beginTabTearOff(tab.id, entry.group.id);
    });
    node.addEventListener("dragend", () => { node.classList.remove("dragging"); this.paneDrag = null; this.clearSplitTargets(); });
    node.addEventListener("dragover", (event) => { if (this.paneDrag && this.paneDrag.tabId !== tab.id) { event.preventDefault(); event.stopPropagation(); node.classList.add("drag-over"); } });
    node.addEventListener("dragleave", () => node.classList.remove("drag-over"));
    node.addEventListener("drop", (event) => {
      node.classList.remove("drag-over");
      const dragged = this.paneDrag?.tabId;
      if (!dragged || dragged === tab.id) return;
      event.preventDefault();
      event.stopPropagation();
      this.moveTabToPane(dragged, entry.group.id, tab.id);
      this.paneDrag = null;
      this.clearSplitTargets();
    });
    return node;
  }

  closeGroup(groupId) {
    const group = this.split?.groups.find((entry) => entry.id === groupId);
    if (!group) return;
    /* Closing a group hands its notes back to the dock rather than closing them. */
    this.split.groups = this.split.groups.filter((entry) => entry !== group);
    if (this.split.groups.length < 2) { this.captureSplitPreviews(); this.teardownSplit(this.split.groups[0]?.activeId || state.activeTab); emit("tabs"); return; }
    this.split.layout = this.layoutForSplit("right", this.split.groups.length);
    const next = this.split.groups[0];
    emit("tabs");
    if (!this.isSplitTab(state.activeTab)) selectTab(next.activeId);
  }

  captureTabPreview(tab, host) {
    /* A chat is previewed as the conversation it holds: the same rendered
       markup, frozen, so the card shows real messages and tool calls. */
    if (tab?.kind === "chat") {
      const view = host?.querySelector?.(".chat-view");
      if (!view) return;
      const thread = view.querySelector(".chat-thread, .thread") || view;
      tab.preview = { kind: "chat", html: frozenHtml(view), scrollTop: thread.scrollTop || 0, landing: view.classList.contains("landing") };
      return;
    }
    /* Every other view (Files, Home, Templates, Library…) is previewed as the screen it shows right now. */
    if (tab && tab.kind !== "page") {
      const scroller = host?.querySelector?.(".page-scroll, .scroll") || host;
      if (!scroller || !scroller.childElementCount) return;
      tab.preview = { kind: "view", html: frozenHtml(scroller), scrollTop: scroller.scrollTop || 0 };
      return;
    }
    if (!tab || tab.kind !== "page") return;
    const scroller = host?.querySelector?.(".page-scroll");
    if (!scroller?.querySelector?.(".page-canvas")) return;
    tab.scrollTop = scroller.scrollTop;
    tab.preview = { html: frozenHtml(scroller), scrollTop: scroller.scrollTop, scrollHeight: scroller.scrollHeight };
  }

  captureSplitPreviews() {
    if (!this.split) return;
    for (const group of this.split.groups) {
      const tabId = group.activeId;
      const tab = state.tabs.find((entry) => entry.id === tabId);
      this.captureTabPreview(tab, this.surface.querySelector(`.split-pane[data-tab-id="${CSS.escape(tabId)}"]`));
    }
  }

  /* Save the actual rendered document before its tab changes. The hover card
     uses this source, rather than invented grey lines, and the scroll offset
     is restored when the person comes back to the still-open tab. */
  captureActiveTabPreview() {
    const previous = state.tabs.find((candidate) => candidate.id === this.currentTabId);
    const host = this.split && previous ? this.surface.querySelector(`.split-pane[data-tab-id="${CSS.escape(previous.id)}"]`) : this.surface;
    this.captureTabPreview(previous, host);
  }

  reconcileSplit() {
    if (!this.split) return;
    const isNote = (id) => state.tabs.some((tab) => tab.id === id && tab.kind === "page");
    this.split.groups = this.split.groups
      .map((group) => {
        const tabIds = group.tabIds.filter(isNote);
        return { ...group, tabIds, activeId: tabIds.includes(group.activeId) ? group.activeId : tabIds[0] };
      })
      .filter((group) => group.tabIds.length);
    const active = activeTab();
    /* A note opened from the dock while split lands in the focused group
       rather than throwing the whole layout away. */
    if (active?.kind === "page" && !this.isSplitTab(active.id) && this.split.groups.length) {
      const target = this.split.groups.find((group) => group.id === this.split.focus) || this.split.groups[0];
      const holder = target.tabIds.length ? target : this.split.groups[0];
      holder.tabIds.push(active.id);
      holder.activeId = active.id;
    }
    const live = this.split.groups.find((group) => group.tabIds.includes(state.activeTab));
    if (live) { live.activeId = state.activeTab; this.split.focus = live.id; }
    if (this.split.groups.length >= 2 && live) {
      this.split.layout = this.layoutForSplit(this.split.edge || "right", this.split.groups.length);
      return;
    }
    this.captureSplitPreviews();
    this.teardownSplit(live?.activeId || this.split.groups[0]?.activeId || null);
  }

  teardownSplit(survivor = null) {
    for (const view of this.paneViews.values()) view?.destroy?.();
    this.paneViews.clear();
    this.paneNodes?.clear();
    this.currentView = null;
    this.split = null;
    this.splitPanels = null;
    this.root.classList.remove("has-split", "split-sidebar-open", "split-rail-open", "split-panels-dimmed");
    this.currentKey = null;
    this.tabstrip?.syncRailToggle();
    if (survivor && state.activeTab !== survivor && state.tabs.some((tab) => tab.id === survivor)) { state.activeTab = survivor; saveSession(); }
  }

  layoutForSplit(edge, count) {
    if (count <= 2) return edge === "top" || edge === "bottom" ? "vertical" : "horizontal";
    return count === 3 ? "grid-3" : "grid-4";
  }

  selectSplitTab(groupId, tabId) {
    const group = this.split?.groups.find((entry) => entry.id === groupId);
    if (!group || !group.tabIds.includes(tabId)) return;
    group.activeId = tabId;
    this.split.focus = groupId;
    if (state.activeTab === tabId) { this.renderSplitSurface(); this.toolbar?.render(); return; }
    selectTab(tabId);
  }

  /* Tabs move between groups (or reorder inside one) without remounting the
     pane they came from; an emptied group quietly folds away. */
  moveTabToPane(tabId, targetGroupId, beforeTabId = null) {
    const target = this.split?.groups.find((group) => group.id === targetGroupId);
    const source = this.split?.groups.find((group) => group.tabIds.includes(tabId));
    if (!target) return;
    if (source) {
      source.tabIds = source.tabIds.filter((id) => id !== tabId);
      if (source.activeId === tabId) source.activeId = source.tabIds[0];
    }
    const at = beforeTabId ? target.tabIds.indexOf(beforeTabId) : -1;
    if (at >= 0) target.tabIds.splice(at, 0, tabId); else target.tabIds.push(tabId);
    target.activeId = tabId;
    this.split.focus = target.id;
    if (source && !source.tabIds.length) this.split.groups = this.split.groups.filter((group) => group !== source);
    if (this.split.groups.length < 2) { this.captureSplitPreviews(); this.teardownSplit(tabId); emit("tabs"); return; }
    this.split.layout = this.layoutForSplit(this.split.edge || "right", this.split.groups.length);
    if (state.activeTab === tabId) { this.renderSplitSurface(); this.toolbar?.render(); this.tabstrip?.render(); } else selectTab(tabId);
  }

  splitTab(tabId, edge, sourceGroupId = null) {
    const moved = state.tabs.find((tab) => tab.id === tabId);
    if (!moved || moved.kind !== "page") { toast("Only note tabs can be placed beside another note"); return; }
    if (this.split) {
      if (this.split.groups.length >= 4) { toast("Up to four note groups can be open at once"); return; }
      const source = this.split.groups.find((group) => group.id === sourceGroupId) || this.split.groups.find((group) => group.tabIds.includes(tabId));
      if (source && source.tabIds.length < 2) { toast("Drag a note from a pane with two or more tabs, or from the top strip, to add a group"); return; }
      if (source) {
        source.tabIds = source.tabIds.filter((id) => id !== tabId);
        if (source.activeId === tabId) source.activeId = source.tabIds[0];
      }
      const newGroup = { id: `pane-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`, tabIds: [tabId], activeId: tabId };
      this.split.groups.push(newGroup);
      this.split.edge = edge;
      this.split.focus = newGroup.id;
      this.split.layout = this.layoutForSplit(edge, this.split.groups.length);
      if (state.activeTab === tabId) { this.renderSplitSurface(); this.toolbar?.render(); this.tabstrip?.render(); } else selectTab(tabId);
      return;
    }
    const active = activeTab();
    const retained = active?.id !== tabId && active?.kind === "page"
      ? active
      : state.tabs.find((tab) => tab.id !== tabId && tab.kind === "page");
    if (!retained) { toast("Open another note first, then drag a tab to split the view"); return; }
    this.captureActiveTabPreview();
    this.split = {
      layout: this.layoutForSplit(edge, 2),
      edge,
      focus: null,
      groups: [
        { id: "pane-main", tabIds: [retained.id], activeId: retained.id },
        { id: `pane-${Date.now().toString(36)}`, tabIds: [moved.id], activeId: moved.id },
      ],
    };
    this.split.focus = this.split.groups[1].id;
    this.splitPanels = { sidebar: false, rail: false };
    this.root.classList.add("has-split");
    this.syncSplitPanels();
    this.currentKey = null;
    if (state.activeTab !== moved.id) selectTab(moved.id);
    else emit("tabs");
  }

  exitSplit() {
    if (!this.split) return;
    this.captureSplitPreviews();
    this.teardownSplit(state.activeTab);
    emit("tabs");
  }

  /* A tab dropped back on the dock leaves its group. If that leaves a single
     group the split dissolves; otherwise the remaining panes just re-flow. */
  returnTabToTop(tabId) {
    if (!this.split) return;
    const source = this.split.groups.find((group) => group.tabIds.includes(tabId));
    if (!source) return;
    this.captureSplitPreviews();
    source.tabIds = source.tabIds.filter((id) => id !== tabId);
    if (source.activeId === tabId) source.activeId = source.tabIds[0];
    if (!source.tabIds.length) this.split.groups = this.split.groups.filter((group) => group !== source);
    if (this.split.groups.length < 2) { this.teardownSplit(tabId); emit("tabs"); return; }
    this.split.layout = this.layoutForSplit(this.split.edge || "right", this.split.groups.length);
    const next = this.split.groups.find((group) => group.id === this.split.focus) || this.split.groups[0];
    if (state.activeTab === next.activeId) { this.renderSplitSurface(); this.toolbar?.render(); emit("tabs"); }
    else selectTab(next.activeId);
  }

  isSplitTab(tabId) { return Boolean(this.split?.groups.some((group) => group.tabIds.includes(tabId))); }

  beginTabTearOff(tabId, sourceGroupId = null) {
    const tab = state.tabs.find((entry) => entry.id === tabId);
    if (!tab || tab.kind !== "page") return;
    this.clearSplitTargets();
    const overlay = el("div", { class: "split-drop-overlay", "aria-label": "Split view targets" });
    const zones = [["left", "Left"], ["right", "Right"], ["top", "Top"], ["bottom", "Bottom"]];
    for (const [edge, label] of zones) {
      const zone = el("div", { class: `split-drop-zone ${edge}`, dataset: { edge }, role: "button", "aria-label": `Place ${this.tabLabel(tab).title} on the ${label.toLowerCase()}` });
      zone.addEventListener("dragenter", (event) => { event.preventDefault(); overlay.dataset.edge = edge; });
      zone.addEventListener("dragover", (event) => { event.preventDefault(); overlay.dataset.edge = edge; });
      zone.addEventListener("drop", (event) => { event.preventDefault(); this.clearSplitTargets(); this.splitTab(tabId, edge, sourceGroupId); });
      overlay.append(zone);
    }
    overlay.addEventListener("dragleave", (event) => { if (!overlay.contains(event.relatedTarget)) delete overlay.dataset.edge; });
    overlay.addEventListener("dragover", (event) => event.preventDefault());
    this.surface.append(overlay);
    this.splitDropOverlay = overlay;
  }

  clearSplitTargets() {
    this.splitDropOverlay?.remove();
    this.splitDropOverlay = null;
  }

  syncSplitPanels() {
    if (!this.split) return;
    const sidebar = Boolean(this.splitPanels?.sidebar);
    const rail = Boolean(this.splitPanels?.rail);
    this.root.classList.toggle("split-sidebar-open", sidebar);
    this.root.classList.toggle("split-rail-open", rail);
    this.root.classList.toggle("split-panels-dimmed", sidebar || rail);
    /* The overlays are temporary: a press anywhere on the documents puts them
       away again, without touching the tab strip that stays put above. */
    if (sidebar || rail) {
      if (!this.splitPanelDismiss) {
        this.splitPanelDismiss = (event) => {
          if (!this.split || event.target.closest?.(".sidebar, .rail, .tabstrip, .layer")) return;
          this.splitPanels.sidebar = false; this.splitPanels.rail = false;
          this.syncSplitPanels();
        };
        this.surface.addEventListener("pointerdown", this.splitPanelDismiss, true);
      }
    } else if (this.splitPanelDismiss) {
      this.surface.removeEventListener("pointerdown", this.splitPanelDismiss, true);
      this.splitPanelDismiss = null;
    }
    if (!rail) this.rail?.hideAll();
    else { this.rail?.refresh(); this.rail?.showCurrent(); }
    this.tabstrip?.syncRailToggle();
  }

  toggleTaskView() {
    this.taskView ||= new TaskView(this);
    if (!this.taskView.open) this.captureActiveTabPreview();
    this.taskView.toggle();
  }

  /* ------------------------------------------------------- navigation */

  tabLabel(tab) {
    if (tab.kind === "page") {
      const page = getPageMeta(tab.pageId);
      const sealed = isSealed(tab.pageId);
      const emoji = !sealed && page?.icon && !/^https?:|^\//.test(page.icon) ? page.icon : null;
      return { title: sealed ? "Locked page" : page?.title || "New page", icon: page?.kind === "database" ? "table" : "page", emoji };
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
    if (this.split) {
      this.splitPanels.sidebar = !this.splitPanels.sidebar;
      this.syncSplitPanels();
      return;
    }
    if (window.matchMedia("(max-width: 860px)").matches) {
      this.root.classList.toggle("sidebar-open");
      return;
    }
    state.sidebarHidden = !state.sidebarHidden;
    saveSession();
    this.root.classList.toggle("sidebar-hidden", state.sidebarHidden);
  }

  /* The right sidebar is the left one's mirror: same collapse, same glide,
     same persisted preference. */
  toggleRail() {
    if (this.split) {
      this.splitPanels.rail = !this.splitPanels.rail;
      this.syncSplitPanels();
      return;
    }
    state.railHidden = state.railHidden === false;
    saveSession();
    this.root.classList.toggle("rail-hidden", state.railHidden);
    this.tabstrip?.syncRailToggle();
    if (state.railHidden) {
      /* The browser panel can be hosting a native Chromium layer, which is
         not a DOM node and so does not disappear when the rail slides away.
         Hide it immediately rather than after the animation, or it hangs in
         the air over the workspace for the length of the transition. */
      this.rail?.hideAll();
      return;
    }
    this.rail?.refresh();
    this.rail?.showCurrent();
  }

  railOpen() { return this.split ? Boolean(this.splitPanels?.rail) : state.railHidden === false; }

  /* The chat lives in one place at a time. Moving it to the sidebar leaves
     the full-screen chat for wherever you were before it. */
  leaveChatView() {
    if (activeTab()?.kind !== "chat") return;
    if (this.history.length) this.goBack();
    else this.openView({ kind: "home" });
  }

  openChatSidebar() {
    this.leaveChatView();
    if (!this.railOpen()) this.toggleRail();
    this.showRailPanel("chat");
  }

  showRailPanel(id) { this.rail?.show(id); }

  /* Clyra context is available wherever a page is open, not only after
     navigating to the separate Chat view. This opens the compact Chat rail
     with the page (and its outgoing links) already attached. */
  /* Selected text in a page, handed to the chat panel. */
  askWithSelection(text, mode = "add") {
    if (!this.currentPageId()) return;
    if (!this.railOpen()) this.toggleRail();
    this.showRailPanel("chat");
    setTimeout(() => window.dispatchEvent(new CustomEvent("clyra:notes-quote", { detail: { text, mode } })), 160);
  }

  /* The chat panel's "Read this page" switch was turned back on: attach the open page again. */
  reattachChatContext() { this.rail?.panels.get("chat")?.reattach?.(); }

  /* Comment on one block: open the Comments panel with that block already chosen. */
  commentOnBlock(blockId, quote = "") {
    if (!this.currentPageId()) return;
    if (!this.railOpen()) this.toggleRail();
    this.showRailPanel("comments");
    setTimeout(() => window.dispatchEvent(new CustomEvent("clyra:comment-on", { detail: { blockId, quote } })), 120);
  }

  /* Blocks carrying open comments get a quiet mark in the margin. */
  async refreshCommentMarks() {
    const pageId = this.currentPageId();
    const surface = document.querySelector(".editor-host");
    if (!surface) return;
    surface.querySelectorAll(".block[data-commented]").forEach((node) => node.removeAttribute("data-commented"));
    if (!pageId) return;
    const counts = await api.get(`/api/notes/pages/${pageId}/comment-counts`).catch(() => []);
    for (const row of counts || []) surface.querySelector(`[data-block="${CSS.escape(String(row.block_id))}"]`)?.setAttribute("data-commented", String(row.n));
  }

  askAboutPage(page = null) {
    const pageId = page?.id ? String(page.id) : this.currentPageId();
    if (!pageId) { toast("Open a page first"); return; }
    if (String(this.currentPageId() || "") !== pageId) this.openPage(pageId);
    if (!this.railOpen()) this.toggleRail();
    this.showRailPanel("chat");
    queueMicrotask(() => this.rail?.refresh());
  }

  /* The "open the tools panel with every note" preference. Applied when a
     page tab becomes active rather than on every render, so closing the
     panel on a note does not have it spring straight back. */
  maybeOpenRail() {
    if (!prefOn("railAuto") || !state.railHidden) return;
    if (this.currentPageId() === null) return;
    this.toggleRail();
    this.tabstrip?.syncRailToggle();
  }

  currentPageId() {
    const tab = activeTab();
    return tab?.kind === "page" ? tab.pageId : null;
  }

  /* Used by the calculator and by anything else in the rail that wants to
     put a line into the note the reader is actually looking at. */
  async insertTextIntoCurrentPage(text) {
    const editor = this.currentView?.editor;
    if (!editor || !text) return false;
    const { makeBlock } = await import("./editor.js");
    const { plain } = await import("./richtext.js");
    const block = editor.appendBlock(makeBlock("text", plain(String(text))));
    editor.focus(block.id, "end");
    return true;
  }

  async createBookmarkNote(url, title) {
    const created = await withError(
      () => api.post("/api/notes/pages", { title: title || url, markdown: `[${title || url}](${url})` }),
      "Could not save that page",
    );
    if (!created) return null;
    await refreshPages();
    return created;
  }

  openSearch() { openSearch(); }

  /* ---------------------------------------------------------- actions */

  async createPage(parentId, options = {}) {
    const { newTab, ...extra } = options;
    /* New notes are born with the defaults from Settings rather than the
       editor's hard-coded ones, so "every note I make is serif" is a
       preference instead of four clicks after every page. */
    const created = await withError(
      () => api.post("/api/notes/pages", {
        parentId: parentId || null,
        title: "",
        fullWidth: prefOn("fullWidth"),
        fontStyle: readPreference("noteFont"),
        textSize: readPreference("noteTextSize"),
        ...extra,
      }),
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
      message: `"${name}" is removed. Its ${count} page${count === 1 ? "" : "s"} ${count === 1 ? "moves" : "move"} to Notes — nothing is deleted.`,
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

  openTemplates(parentId) { this.openView({ kind: "templates", parentId: parentId || null }); }
  openImport(parentId) { openImport(this, parentId); }
  openCommandPalette(options) { return openCommandPalette(this, options); }

  /* slash menu entries for importing from other tools open the same import screen */
  listenForImport() { window.addEventListener("clyra:open-import", () => this.openImport(null)); }
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
      { label: "Only you", icon: "lock", checked: true, disabled: true },
      { type: "separator" },
      { label: "Copy link", icon: "link", onSelect: () => {
        navigator.clipboard.writeText(`${location.origin}/notes#${page.id}`);
        toast("Link copied");
      } },
      { type: "label", label: "Export" },
      { label: "Word document (.docx)", icon: "export", onSelect: () => this.exportPage(page, "docx") },
      { label: "Google Docs (.docx)", icon: "export", onSelect: () => this.exportPage(page, "docx", { googleDocs: true }) },
      { label: "PDF", icon: "export", onSelect: () => this.exportPage(page, "pdf") },
      { label: "Markdown (.md)", icon: "export", onSelect: () => this.exportPage(page, "md") },
      { label: "Web page (.html)", icon: "export", onSelect: () => this.exportPage(page, "html") },
    ], { align: "end" });
  }

  /* Word, PDF and Markdown are built on the server from the page's real blocks
     (databases become tables, calendars become agendas). If PDF rendering is
     unavailable the same page opens in the system print dialog instead. */
  async exportPage(page, format = "md", { googleDocs = false } = {}) {
    const labels = { docx: "Word document", pdf: "PDF", md: "Markdown", html: "Web page" };
    toast(`Preparing ${labels[format] || format}…`);
    const response = await fetch(`/api/notes/pages/${encodeURIComponent(page.id)}/export?format=${format}`).catch(() => null);
    if (response?.status === 501 && format === "pdf") { await this.printPage(page); return; }
    if (!response?.ok) { toast("Export failed"); return; }
    const filename = decodeURIComponent(response.headers.get("X-Export-Filename") || `${(page.title || "Untitled").replace(/[^\w -]/g, "")}.${format}`);
    const link = el("a", { href: URL.createObjectURL(await response.blob()), download: filename });
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 4000);
    /* Google Docs opens Word files directly: the same .docx keeps headings, lists, tables, shading and images. */
    toast(googleDocs ? `Saved ${filename}. In Google Docs choose File, Open, Upload to open it.` : `${labels[format] || "File"} saved as ${filename}`);
  }

  async printPage(page) {
    const html = await fetch(`/api/notes/pages/${encodeURIComponent(page.id)}/export?format=html`).then((r) => r.ok ? r.text() : null).catch(() => null);
    if (!html) { toast("Export failed"); return; }
    const frame = el("iframe", { style: { position: "fixed", right: "0", bottom: "0", width: "0", height: "0", border: "0" } });
    document.body.append(frame);
    frame.srcdoc = html;
    frame.onload = () => { frame.contentWindow.focus(); frame.contentWindow.print(); setTimeout(() => frame.remove(), 60000); };
  }

  pageMenu(page, anchor, onChange, options = {}) {
    if (!page) return;
    const id = String(page.id);
    const refresh = async () => { await refreshPages(); onChange?.(); this.toolbar.render(); this.tabstrip.render(); };
    menu(anchor, [
      options.onRename
        ? { label: "Rename", icon: "text", shortcut: "Double-click", onSelect: () => options.onRename() }
        : { label: "Rename", icon: "text", onSelect: () => this.renameDialog(page, refresh) },
      { type: "custom", render: () => {
        const icons = ["📄", "📝", "📚", "💡", "🎯", "✅", "🧠", "📌", "⭐", "🔬", "💼", "🛒"];
        const row = el("div", { class: "sidebar-icon-picker", "aria-label": "Sidebar icon" },
          el("span", { class: "sidebar-icon-picker-label", text: "Sidebar icon" }),
          ...icons.map((emoji) => el("button", {
            class: `sidebar-icon-choice${page.icon === emoji ? " on" : ""}`, type: "button", "aria-label": `Use ${emoji} as sidebar icon`,
            onclick: async () => {
              page.icon = emoji;
              await withError(() => api.patch(`/api/notes/pages/${id}`, { icon: emoji }), "Could not update the icon");
              await refresh(); this.currentKey = null; this.renderSurface();
            },
          }, emoji)),
          page.icon ? el("button", { class: "sidebar-icon-clear", type: "button", onclick: async () => {
            page.icon = null;
            await withError(() => api.patch(`/api/notes/pages/${id}`, { icon: null }), "Could not remove the icon");
            await refresh(); this.currentKey = null; this.renderSurface();
          } }, "Remove icon") : null,
        );
        return row;
      } },
      { label: page.locked ? "Unlock page" : "Lock page", icon: "lock", onSelect: () => this.lockDialog(page, refresh) },
      /* Destructive actions belong close to the trigger instead of below the
         style controls, so they are visible in the first menu viewport. The
         confirmation in trashPage still protects against an accidental tap. */
      { label: "Move to trash", icon: "trash", danger: true, onSelect: () => this.trashPage(page, onChange) },
      { type: "separator" },
      { label: page.favorite ? "Remove from favourites" : "Add to favourites", icon: "star", onSelect: async () => {
        await withError(() => api.patch(`/api/notes/pages/${id}`, { favorite: !page.favorite }), "Could not update favourites");
        await refresh();
      } },
      { label: "Duplicate", icon: "duplicate", onSelect: async () => {
        const copy = await withError(() => api.post(`/api/notes/pages/${id}/duplicate`), "Could not duplicate");
        if (copy) { await refresh(); this.openPage(copy.id); }
      } },
      { label: "Copy link", icon: "link", onSelect: () => { navigator.clipboard.writeText(`${location.origin}/notes#${id}`); toast("Link copied"); } },
      { label: "Ask Clyra about this page", icon: "comment", onSelect: () => this.askAboutPage(page) },
      { label: "Move to", icon: "move", onSelect: () => this.moveDialog(page, refresh) },
      { label: "Move to subject", icon: "book", onSelect: () => this.subjectPicker(page, anchor, refresh) },
      { type: "separator" },
      { type: "label", label: "Export" },
      { label: "Word document (.docx)", icon: "export", onSelect: () => this.exportPage(page, "docx") },
      { label: "Google Docs (.docx)", icon: "export", onSelect: () => this.exportPage(page, "docx", { googleDocs: true }) },
      { label: "PDF", icon: "export", onSelect: () => this.exportPage(page, "pdf") },
      { label: "Markdown (.md)", icon: "export", onSelect: () => this.exportPage(page, "md") },
      { label: "Web page (.html)", icon: "export", onSelect: () => this.exportPage(page, "html") },
      { label: "Version history", icon: "history", onSelect: () => openVersions(this, page.id, { title: page.title }) },
      { type: "separator" },
      /* Notion's page style block: the typeface as chips, then two switches. Each applies at once; the menu stays open. */
      { type: "custom", render: () => {
        const row = el("div", { class: "menu-fonts", role: "radiogroup", "aria-label": "Font" });
        for (const [font, name] of [["default", "Default"], ["serif", "Serif"], ["mono", "Mono"], ["rounded", "Rounded"]]) {
          const on = (page.font_style || "default") === font;
          row.append(el("button", {
            class: `menu-font${on ? " on" : ""}`, type: "button", role: "radio", "aria-checked": on ? "true" : "false",
            onclick: async () => {
              row.querySelectorAll(".menu-font").forEach((b) => { b.classList.remove("on"); b.setAttribute("aria-checked", "false"); });
              row.querySelector(`[data-font="${font}"]`)?.classList.add("on");
              page.font_style = font;
              await withError(() => api.patch(`/api/notes/pages/${id}`, { fontStyle: font }), "Could not update the font");
              dropPage(id); await refresh(); this.currentKey = null; this.renderSurface();
            }, "data-font": font,
          }, el("span", { class: `menu-font-glyph font-${font}`, text: "Ag" }), el("span", { class: "menu-font-name", text: name })));
        }
        return row;
      } },
      { label: "Small text", icon: "text", switch: true, keepOpen: true, checked: page.text_size === "small", onSelect: async () => {
        const next = page.text_size === "small" ? "medium" : "small"; page.text_size = next;
        await withError(() => api.patch(`/api/notes/pages/${id}`, { textSize: next }), "Could not update text size");
        dropPage(id); await refresh(); this.currentKey = null; this.renderSurface();
      } },
      { label: "Full width", icon: "panel", switch: true, keepOpen: true, checked: Boolean(page.full_width), onSelect: async () => {
        const next = !page.full_width; page.full_width = next;
        await withError(() => api.patch(`/api/notes/pages/${id}`, { fullWidth: next }), "Could not update layout");
        dropPage(id); await refresh(); this.currentKey = null; this.renderSurface();
      } },
      { label: "More text sizes", icon: "text", onSelect: () => this.textSizeMenu(page, anchor, refresh) },
      { type: "separator" },
      { type: "custom", render: () => {
        const raw = page.updated_at ? new Date(`${String(page.updated_at).replace(" ", "T")}${/Z|\+/.test(String(page.updated_at)) ? "" : "Z"}`) : null;
        const when = raw && !Number.isNaN(raw.getTime()) ? raw.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "just now";
        return el("div", { class: "menu-footer" }, el("div", { class: "menu-footer-label", text: "Last edited" }), el("div", { text: when }));
      } },
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
    menu(anchor, ["default", "serif", "mono", "rounded"].map((font) => ({
      label: { default: "Default", serif: "Serif", mono: "Mono", rounded: "Rounded" }[font],
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

  /* Locking uses a PIN (6 or 8 digits, one box each) or a password, entered twice with a strength check. */
  lockDialog(page, refresh) {
    openLockDialog(page, {
      onDone: async () => {
        dropPage(page.id);
        await refresh();
        this.currentKey = null;
        this.renderSurface();
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
      /* Notes is a whole page, not a panel inside the React shell, so the
         shell's own launcher shortcut is not listening while you are here.
         The chord is answered locally and hands the workspace back with the
         launcher already open. */
      /* Keep the app-level chords ahead of editor typing, menus and browser
         focus. `code` is included because a few keyboard layouts report a
         localized `key` for the physical K/J keys. */
      const shortcutKey = String(event.key || "").toLowerCase();
      const shortcutCode = String(event.code || "").toLowerCase();
      if (shortcutMatches(event, "appLauncher")) {
        event.preventDefault();
        event.stopImmediatePropagation();
        try { flushAll(); } finally { window.location.assign("/?launcher=1"); }
        return;
      }
      /* Task view here is for the notes you have open: every tab as a card, the
         sidebars sliding away while it is up. The all-apps view keeps its own chord. */
      if (shortcutMatches(event, "taskView")) {
        event.preventDefault();
        event.stopImmediatePropagation();
        this.toggleTaskView();
        return;
      }
      if (shortcutMatches(event, "appTaskView")) {
        event.preventDefault();
        event.stopImmediatePropagation();
        try { flushAll(); } finally { window.location.assign("/?taskview=1"); }
        return;
      }
      /* Cmd/Ctrl+K belongs to the host app launcher. Notes deliberately does
         not intercept it; its own search remains available from the sidebar
         and Cmd/Ctrl+P. */
      if (shortcutMatches(event, "search")) { event.preventDefault(); openSearch(); return; }
      /* Cmd/Ctrl+S is "save" everywhere else; here pages save themselves, so it opens the command palette instead. */
      if (shortcutMatches(event, "commandPalette")) {
        event.preventDefault();
        /* During the welcome tour the real palette belongs in its preview
           column. This preserves the familiar shortcut without putting a
           full-screen layer over the lesson. */
        if (this.root.classList.contains("tour-mode")) {
          document.dispatchEvent(new CustomEvent("clyra:tour-command-palette", { detail: { app: this } }));
          return;
        }
        if (!document.querySelector(".cp")) openCommandPalette(this);
        return;
      }
      if (shortcutMatches(event, "toggleSidebar")) {
        event.preventDefault();
        this.toggleSidebar();
        this.tabstrip.syncRailToggle();
        return;
      }
      if (shortcutMatches(event, "toggleTools")) { event.preventDefault(); this.toggleRail(); this.tabstrip.syncRailToggle(); return; }
      if (shortcutMatches(event, "newPage") && !typing) { event.preventDefault(); this.createPage(null); return; }
      if (shortcutMatches(event, "terminal")) {
        event.preventDefault();
        /* Palette actions remain visual-only during the tour. The terminal
           lesson deliberately opens the real scoped drawer from its normal
           bottom edge, so its keyboard instruction is trustworthy. */
        const terminalLesson = document.querySelector(".wl-stage")?.dataset.preview === "terminal";
        if (this.root.classList.contains("tour-mode") && !terminalLesson) return;
        void openTerminal();
        return;
      }
      if (shortcutMatches(event, "reopenTab")) { event.preventDefault(); reopenTab(); return; }
      if (shortcutMatches(event, "closeTab")) { event.preventDefault(); if (state.activeTab) closeTab(state.activeTab); return; }
      if (shortcutMatches(event, "back")) { event.preventDefault(); this.goBack(); return; }
      if (shortcutMatches(event, "forward")) { event.preventDefault(); this.goForward(); return; }
      if (event.altKey && event.key === "ArrowRight") { event.preventDefault(); cycleTab(1); return; }
      if (event.altKey && event.key === "ArrowLeft") { event.preventDefault(); cycleTab(-1); return; }
      if (modKey(event) && /^[1-9]$/.test(event.key) && !typing) {
        const tab = state.tabs[Number(event.key) - 1];
        if (tab) { event.preventDefault(); selectTab(tab.id); }
      }
    }, true);
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
