/* The right sidebar.

   It mirrors the left one — same shell, same collapse behaviour, same glide —
   but holds tools rather than navigation: an outline of the page you are on,
   the notes it is linked to, a calculator, a chat grounded in the current
   page, and a browser for looking something up without leaving the note.

   Each panel is built once and kept, so switching back to the calculator
   does not lose what you were half way through typing. */
import { el, clear, icon, iconButton, append } from "./dom.js";
import { api } from "./api.js";
import { state, withError } from "./state.js";
import { readPreference, writePreference } from "./preferences.js";
import { calculatorPanel } from "./panels/calculator.js";
import { browserPanel } from "./panels/browser.js";
import { renderChat } from "./views/chat.js";

/* Each tool carries its own shortcut. They are real bindings, not labels:
   the chord opens the rail on that tool from anywhere in the workspace. */
const PANELS = [
  { id: "outline", label: "Outline", icon: "list", key: "o", chord: "\u2303\u21e7O" },
  { id: "links", label: "Linked notes", icon: "link", key: "l", chord: "\u2303\u21e7L" },
  { id: "calculator", label: "Calculator", icon: "equation", key: "k", chord: "\u2303\u21e7K" },
  { id: "chat", label: "Chat", icon: "comment", key: "j", chord: "\u2303\u21e7J" },
  { id: "browser", label: "Browser", icon: "embed", key: "b", chord: "\u2303\u21e7B" },
];

export class Rail {
  constructor(host, context) {
    this.host = host;
    this.context = context;
    this.panels = new Map();
    /* Null is the launcher. The rail opens on the list of tools rather than
       on whichever one happened to be last, so the panel is a place you
       choose from rather than a state you have to undo. */
    const saved = readPreference("railPanel");
    this.current = PANELS.some((panel) => panel.id === saved) ? saved : null;
    this.build();
    this.bindKeys();
  }

  build() {
    clear(this.host);
    this.tabs = el("div", { class: "rail-tabs", role: "tablist" });
    this.body = el("div", { class: "rail-body" });
    this.title = el("span", { class: "rail-title" });
    this.back = iconButton("chevron_left", "All tools", () => this.show(null), { size: 15, className: "rail-back" });
    this.host.append(
      el("div", { class: "rail-resize" }),
      append(el("div", { class: "rail-inner" }),
        el("div", { class: "rail-head" },
          this.back,
          this.title,
          iconButton("close", "Hide tools", () => this.context.toggleRail(), { size: 14 })),
        this.tabs,
        this.body),
    );
    this.show(this.current);
  }

  bindKeys() {
    this.onKey = (event) => {
      if (!event.ctrlKey || !event.shiftKey || event.metaKey || event.altKey) return;
      const panel = PANELS.find((entry) => entry.key === event.key.toLowerCase());
      if (!panel) return;
      event.preventDefault();
      if (!this.context.railOpen()) this.context.toggleRail();
      this.show(panel.id);
    };
    document.addEventListener("keydown", this.onKey);
  }

  destroy() {
    if (this.onKey) document.removeEventListener("keydown", this.onKey);
    for (const built of this.panels.values()) built?.destroy?.();
  }

  paintTabs() {
    clear(this.tabs);
    /* The tab strip only exists once a tool is open; on the launcher it
       would be a second copy of the list underneath it. */
    if (!this.current) return;
    for (const panel of PANELS) {
      const selected = panel.id === this.current;
      const button = el("button", {
        class: `rail-tab${selected ? " selected" : ""}`, type: "button",
        role: "tab", "aria-selected": selected ? "true" : "false",
        "aria-label": panel.label, title: `${panel.label}  ${panel.chord}`,
        onclick: () => this.show(panel.id),
      },
        el("span", { class: "rail-tab-icon" }, icon(panel.icon, 16)),
        el("span", { class: "rail-tab-name" }, el("span", { class: "rail-tab-name-text", text: panel.label })));
      this.tabs.append(button);
    }
  }

  /* The launcher: every tool listed one under another with its shortcut, in
     the same shape as the workspace's own command list. */
  buildLauncher() {
    const list = el("div", { class: "rail-launcher" });
    for (const panel of PANELS) {
      list.append(el("button", {
        class: "rail-launch", type: "button", title: `${panel.label}  ${panel.chord}`,
        onclick: () => this.show(panel.id),
      },
        el("span", { class: "rail-launch-icon" }, icon(panel.icon, 18)),
        el("span", { class: "rail-launch-label", text: panel.label })));
    }
    return list;
  }

  show(id) {
    this.current = id;
    writePreference("railPanel", id || "");
    this.host.classList.toggle("is-launcher", !id);
    this.paintTabs();
    this.title.textContent = id ? PANELS.find((panel) => panel.id === id)?.label || "" : "Tools";
    if (this.back) this.back.hidden = !id;
    /* A panel that paints outside the DOM — the browser hosts a native
       Chromium layer — has to be told it is leaving, or it keeps painting
       over the workspace after you switch away from it. */
    for (const [panelId, built] of this.panels) if (panelId !== id) built?.hide?.();
    clear(this.body);
    if (!id) { this.body.append(this.buildLauncher()); return; }
    const panel = this.panelFor(id);
    if (panel?.node) this.body.append(panel.node);
    panel?.refresh?.();
    /* Called synchronously: the node is already in the document, and reading
       its rect forces the layout the native layer needs. requestAnimationFrame
       does not fire reliably here because this view is not always
       compositing. */
    panel?.show?.();
    queueMicrotask(() => panel?.focus?.());
  }

  /* Closing the rail, or hiding it with the toggle, must take any native
     layer with it. */
  hideAll() {
    for (const built of this.panels.values()) built?.hide?.();
  }

  showCurrent() {
    if (!this.current) return;
    this.panels.get(this.current)?.show?.();
  }

  panelFor(id) {
    if (this.panels.has(id)) return this.panels.get(id);
    const built = this.buildPanel(id);
    this.panels.set(id, built);
    return built;
  }

  buildPanel(id) {
    if (id === "calculator") return calculatorPanel(this.context);
    if (id === "browser") return browserPanel(this.context);
    if (id === "chat") return this.buildChat();
    if (id === "links") return this.buildLinks();
    return this.buildOutline();
  }

  /* Chat in the rail is the same surface as the Ask AI page with its history
     column folded away, and it opens with the page you are reading already
     attached — the whole reason to have it beside the note. */
  buildChat() {
    const node = el("div", { class: "rail-chat" });
    let view = null;
    let attachedFor = null;
    /* The rail is constructed before the workspace has loaded, so a chat
       panel built at that moment renders the "AI is not configured" state
       and would keep it forever. It is rebuilt once the answer changes. */
    let builtWithAi = null;
    return {
      node,
      focus: () => view?.focus?.(),
      refresh: async () => {
        if (view && builtWithAi !== state.aiConfigured) {
          view.destroy?.();
          clear(node);
          view = null;
          attachedFor = null;
        }
        if (!view) {
          builtWithAi = state.aiConfigured;
          view = renderChat(node, this.context, { compact: true });
        }
        const pageId = this.context.currentPageId?.();
        if (!pageId || pageId === attachedFor) return;
        attachedFor = pageId;
        const page = state.pageById.get(String(pageId));
        const links = await api.get(`/api/notes/pages/${pageId}/links`).catch(() => null);
        view.setSources?.([
          { pageId: String(pageId), title: page?.title || "This page" },
          ...(links?.outgoing || []).map((entry) => ({ pageId: String(entry.id), title: entry.title || "Note" })),
        ]);
      },
    };
  }

  buildLinks() {
    const list = el("div", { class: "rail-list scroll" });
    const node = el("div", { class: "rail-panel" }, list);
    return {
      node,
      refresh: async () => {
        clear(list);
        const pageId = this.context.currentPageId?.();
        if (!pageId) { list.append(this.emptyState("Open a note to see what it links to.")); return; }
        const links = await withError(() => api.get(`/api/notes/pages/${pageId}/links`), "Could not load links");
        const groups = [["Links to", links?.outgoing || []], ["Linked from", links?.incoming || []]];
        if (!groups.some(([, rows]) => rows.length)) {
          list.append(this.emptyState("Nothing links to this note yet. Use /link to connect one."));
          return;
        }
        for (const [heading, rows] of groups) {
          if (!rows.length) continue;
          list.append(el("div", { class: "rail-group", text: heading }));
          for (const row of rows) {
            list.append(el("button", {
              class: "rail-row", type: "button", onclick: () => this.context.openPage(row.id),
            },
              el("span", { class: "page-icon", text: row.icon && !/^https?:|^\//.test(row.icon) ? row.icon : "" },
                row.icon ? null : icon("page", 14)),
              el("span", { class: "rail-row-title", text: row.title || "New page" })));
          }
        }
      },
    };
  }

  /* The outline is always available, unlike the contents block, which has to
     be inserted into the page first. */
  buildOutline() {
    const list = el("div", { class: "rail-list scroll" });
    const node = el("div", { class: "rail-panel" }, list);
    return {
      node,
      refresh: () => {
        clear(list);
        const editor = this.context.currentView?.editor;
        if (!editor) { list.append(this.emptyState("Open a note to see its outline.")); return; }
        const headings = editor.flat()
          .map((entry) => entry.block)
          .filter((block) => /^(toggle_)?h[123]$/.test(block.type) && block.text?.length);
        if (!headings.length) {
          list.append(this.emptyState("Add headings to this note and they will appear here."));
          return;
        }
        const base = Math.min(...headings.map((block) => Number(block.type.replace(/\D/g, "")) || 1));
        for (const heading of headings) {
          const level = Math.min(3, (Number(heading.type.replace(/\D/g, "")) || 1) - base + 1);
          list.append(el("button", {
            class: "rail-row outline-row", type: "button", "data-level": String(level),
            onclick: () => editor.jumpToBlock(heading.id),
          }, el("span", { class: "rail-row-title", text: heading.text.map((span) => span.t || "").join("") })));
        }
      },
    };
  }

  emptyState(message) {
    return el("div", { class: "rail-empty" }, icon("page", 18), el("span", { text: message }));
  }

  /* Called when the tab or the page changes: only the visible panel is
     refreshed, and only the ones that depend on the page have anything to do. */
  refresh() {
    if (!this.current) return;
    this.panelFor(this.current)?.refresh?.();
  }

  openBrowser(url) {
    this.show("browser");
    this.panelFor("browser")?.open?.(url);
  }
}
