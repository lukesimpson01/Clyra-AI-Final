/* Task view for Notes: every open tab as a card on one light surface, the same
   gesture as the workspace's own Task View. Cards are frozen captures of the
   real rendered pages (never a redrawn thumbnail), so what you see is what
   each tab shows. The sidebars slide away while it is open and slide back to
   exactly where they were when it closes. */
import { el, icon, frozenHtml } from "./dom.js";
import { state, selectTab, closeTab } from "./state.js";
import { PageView } from "./page-view.js";
import { isAiWorking } from "./ai-live.js";

const FRAME_W = 1040;
const FRAME_H = 680;

export class TaskView {
  constructor(app) {
    this.app = app;
    this.node = null;
    this.open = false;
    this.restore = null;
  }

  toggle() { this.open ? this.close() : this.show(); }

  /* A frozen render of one tab. The active tab is captured live; a tab that has
     never been on screen this session is rendered once out of sight. */
  async snapshot(tab) {
    if (tab.id === state.activeTab) this.app.captureActiveTabPreview?.();
    if (tab.preview?.html) return tab.preview;
    if (tab.kind !== "page") return null;
    const host = el("div", { class: "tab-preview-render-host", "aria-hidden": "true" });
    document.body.append(host);
    const view = new PageView(host, tab.pageId, this.app, tab.scrollTop || 0);
    try {
      const html = await new Promise((resolve, reject) => {
        const started = performance.now();
        const poll = () => {
          const scroll = host.querySelector(".page-scroll");
          if (scroll?.querySelector(".page-canvas")) { resolve(frozenHtml(scroll)); return; }
          if (performance.now() - started > 2200) { reject(new Error("timeout")); return; }
          requestAnimationFrame(poll);
        };
        poll();
      });
      tab.preview = { html, scrollTop: Number(tab.scrollTop) || 0 };
      return tab.preview;
    } catch { return null; } finally { view.destroy?.(); host.remove(); }
  }

  async show() {
    if (this.open) return;
    this.open = true;
    this.app.captureActiveTabPreview?.();
    const root = this.app.root;
    /* Remember which sidebars were showing, hide them for the duration, and
       give back only those. Nothing here touches the saved preference. */
    this.restore = {
      sidebar: !root.classList.contains("sidebar-hidden"),
      rail: !root.classList.contains("rail-hidden"),
      splitSidebar: root.classList.contains("split-sidebar-open"),
      splitRail: root.classList.contains("split-rail-open"),
    };
    root.classList.add("task-view-open", "sidebar-hidden", "rail-hidden");
    root.classList.remove("split-sidebar-open", "split-rail-open", "split-panels-dimmed");

    this.node = el("div", { class: "tv", role: "dialog", "aria-label": "Task view of open notes" });
    this.query = "";
    /* The way out is always in reach: Home on the left, search in the middle. */
    this.search = el("input", { class: "tv-search", type: "search", placeholder: "Search open notes", "aria-label": "Search open notes", spellcheck: "false", oninput: (event) => { this.query = event.target.value; this.paintCards(); } });
    this.bar = el("div", { class: "tv-bar" },
      el("button", { class: "tv-home", type: "button", "aria-label": "Home", title: "Home", onclick: () => { this.close(); setTimeout(() => this.app.goHome(), 60); } }, icon("home", 16), el("span", { text: "Home" })),
      el("label", { class: "tv-searchbox" }, icon("search", 15), this.search),
      el("span", { class: "tv-count", "aria-live": "polite" }));
    this.grid = el("div", { class: "tv-grid" });
    this.hint = el("div", { class: "tv-hint" }, el("span", { text: "Click a note to open it" }), el("kbd", { text: "Esc" }), el("span", { text: "to go back" }));
    this.node.append(el("div", { class: "tv-backdrop", onclick: () => this.close() }), this.bar, this.grid, this.hint);
    this.app.main.append(this.node);
    this.onKey = (event) => this.keys(event);
    document.addEventListener("keydown", this.onKey, true);
    this.layout();
    this.paintCards();
    requestAnimationFrame(() => { this.node.classList.add("in"); this.search.focus({ preventScroll: true }); });
    /* Captures that were not already in memory arrive a moment later. */
    for (const tab of state.tabs) {
      if (tab.preview?.html || tab.kind !== "page") continue;
      this.snapshot(tab).then(() => this.open && this.paintCards());
    }
  }

  layout() {
    const count = state.tabs.length + 1;
    const width = count <= 2 ? 440 : count <= 4 ? 380 : count <= 6 ? 330 : count <= 9 ? 280 : count <= 14 ? 240 : 200;
    this.node.style.setProperty("--tv-w", `${width}px`);
    this.node.style.setProperty("--tv-s", String(width / FRAME_W));
    this.node.style.setProperty("--tv-h", `${Math.round(FRAME_H * (width / FRAME_W))}px`);
  }

  paintCards() {
    if (!this.grid) return;
    const focused = this.grid.querySelector(".tv-card:focus")?.dataset.id;
    this.grid.replaceChildren();
    const query = (this.query || "").trim().toLowerCase();
    const tabs = query ? state.tabs.filter((tab) => {
      const label = this.app.tabLabel(tab);
      const body = (tab.preview?.html || "").replace(/<[^>]+>/g, " ").toLowerCase();
      return label.title.toLowerCase().includes(query) || body.includes(query);
    }) : state.tabs;
    const counter = this.bar?.querySelector(".tv-count");
    if (counter) counter.textContent = query ? `${tabs.length} of ${state.tabs.length}` : `${state.tabs.length} open`;
    if (query && !tabs.length) { this.grid.append(el("div", { class: "tv-none" }, el("b", { text: "No open note matches" }), el("span", { text: `Nothing open mentions “${this.query.trim()}”.` }))); return; }
    tabs.forEach((tab, index) => {
      const label = this.app.tabLabel(tab);
      const snap = tab.preview?.html ? tab.preview : null;
      const frame = el("div", { class: "tv-frame" });
      const page = el("div", { class: `tv-page${tab.kind === "chat" ? " tv-chat" : ""}` });
      if (snap) page.innerHTML = snap.html;
      else page.append(el("div", { class: "tv-empty" }, label.emoji ? el("span", { class: "tv-empty-emoji", text: label.emoji }) : icon(label.icon, 44), el("span", { text: label.title })));
      page.querySelectorAll("[contenteditable]").forEach((node) => node.removeAttribute("contenteditable"));
      frame.append(page);
      const card = el("div", {
        class: `tv-card${tab.id === state.activeTab ? " active" : ""}${tab.kind === "page" && isAiWorking(tab.pageId) ? " ai-working" : ""}`,
        dataset: { id: tab.id }, tabindex: "0", role: "button", "aria-label": `Open ${label.title}`,
        style: { "--i": String(index) },
        onclick: () => this.pick(tab.id),
        onkeydown: (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); this.pick(tab.id); } },
      },
        el("div", { class: "tv-window" }, frame, el("span", { class: "tv-glow", "aria-hidden": "true" })),
        el("div", { class: "tv-label" }, label.emoji ? el("span", { text: label.emoji }) : icon(label.icon, 14), el("span", { text: label.title })),
        el("button", { class: "tv-close", type: "button", "aria-label": `Close ${label.title}`, onclick: (event) => { event.stopPropagation(); this.closeCard(tab.id, card); } }, icon("close", 12)));
      this.grid.append(card);
    });
    if (!query) this.grid.append(el("button", { class: "tv-card tv-new", type: "button", style: { "--i": String(state.tabs.length) }, onclick: async () => { this.close(); await this.app.createPage(null, { newTab: true }); } },
      el("div", { class: "tv-window" }, el("div", { class: "tv-new-plus" }, icon("plus", 26))),
      el("div", { class: "tv-label" }, el("span", { text: "New note" }))));
    if (focused) this.grid.querySelector(`.tv-card[data-id="${CSS.escape(focused)}"]`)?.focus();
  }

  pick(id) {
    this.close();
    if (state.activeTab !== id) setTimeout(() => selectTab(id), 40);
  }

  /* A closed card collapses; the rest of the grid glides into the space. */
  closeCard(id, card) {
    const rects = new Map([...this.grid.querySelectorAll(".tv-card")].map((node) => [node, node.getBoundingClientRect()]));
    card.classList.add("leaving");
    setTimeout(() => {
      closeTab(id);
      if (!this.open) return;
      if (!state.tabs.length) { this.close(); return; }
      this.layout();
      this.paintCards();
      const after = new Map([...this.grid.querySelectorAll(".tv-card")].map((node) => [node.dataset.id || "new", node]));
      for (const [oldNode, before] of rects) {
        const target = after.get(oldNode.dataset.id || "new");
        if (!target || oldNode === card) continue;
        const now = target.getBoundingClientRect();
        const dx = before.left - now.left; const dy = before.top - now.top;
        if (Math.abs(dx) + Math.abs(dy) < 2) continue;
        target.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }], { duration: 360, easing: "cubic-bezier(0.22, 1, 0.36, 1)" });
      }
    }, 170);
  }

  keys(event) {
    if (event.key === "Escape") {
      event.preventDefault(); event.stopPropagation();
      if (this.query) { this.query = ""; this.search.value = ""; this.paintCards(); } else this.close();
      return;
    }
    if (event.target === this.search) {
      if (event.key === "ArrowDown" || event.key === "Enter") { event.preventDefault(); const first = this.grid.querySelector(".tv-card"); if (event.key === "Enter" && this.query && first?.dataset.id) this.pick(first.dataset.id); else first?.focus(); }
      return;
    }
    const cards = [...this.grid.querySelectorAll(".tv-card")];
    const at = cards.indexOf(document.activeElement);
    if (["ArrowRight", "ArrowLeft", "ArrowDown", "ArrowUp"].includes(event.key)) {
      event.preventDefault();
      const columns = Math.max(1, Math.round(this.grid.clientWidth / (this.grid.firstElementChild?.getBoundingClientRect().width + 28 || 1)));
      const delta = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: columns, ArrowUp: -columns }[event.key];
      cards[Math.max(0, Math.min(cards.length - 1, (at < 0 ? cards.findIndex((card) => card.classList.contains("active")) : at) + delta))]?.focus();
    }
    if ((event.key === "Backspace" || event.key === "Delete") && at >= 0 && cards[at].dataset.id) { event.preventDefault(); this.closeCard(cards[at].dataset.id, cards[at]); }
  }

  close() {
    if (!this.open) return;
    this.open = false;
    document.removeEventListener("keydown", this.onKey, true);
    const root = this.app.root;
    const node = this.node;
    node.classList.remove("in");
    node.classList.add("out");
    /* Sidebars return together with the fade, each only if it was open before. */
    const prior = this.restore;
    if (prior.sidebar) root.classList.remove("sidebar-hidden");
    if (prior.rail) root.classList.remove("rail-hidden");
    if (prior.splitSidebar) root.classList.add("split-sidebar-open");
    if (prior.splitRail) root.classList.add("split-rail-open");
    if (prior.splitSidebar || prior.splitRail) root.classList.add("split-panels-dimmed");
    root.classList.remove("task-view-open");
    this.app.tabstrip?.syncRailToggle?.();
    setTimeout(() => { node.remove(); }, 320);
    this.node = null;
  }
}
