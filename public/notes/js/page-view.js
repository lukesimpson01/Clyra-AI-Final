/* The document surface: cover, icon, title, backlinks and the block editor. */
import { el, clear, icon, iconButton, menu, modal, toast, confirmDialog, mod, modKey, append } from "./dom.js";
import { api } from "./api.js";
import { Editor, makeBlock, uploadFile } from "./editor.js";
import { plain } from "./richtext.js";
import { state, emit, loadPage, queueMetaSave, flushPage, getPageMeta, refreshPages, withError } from "./state.js";
import { openSearch } from "./search.js";
import { openColourLegend } from "./colour-coding.js";
import { unlockForm } from "./passcode.js";

const COVERS = [
  "linear-gradient(120deg, #d5e3f0 0%, #eef2f6 100%)",
  "linear-gradient(120deg, #efe6dd 0%, #f7f3ee 100%)",
  "linear-gradient(120deg, #e3ede4 0%, #f2f7f2 100%)",
  "linear-gradient(120deg, #ece3f1 0%, #f6f1f9 100%)",
  "linear-gradient(120deg, #f5e5e2 0%, #fbf3f1 100%)",
  "linear-gradient(120deg, #e8e8e6 0%, #f5f5f3 100%)",
];

/* The toolbar speaks in camelCase patch names; the page row uses the same
   names the API takes, so the mapping stays in one place. */
const mapStyle = (patch) => {
  const out = {};
  if (patch.fontStyle !== undefined) out.font_style = patch.fontStyle;
  if (patch.textSize !== undefined) out.text_size = patch.textSize;
  if (patch.fullWidth !== undefined) out.full_width = patch.fullWidth;
  return out;
};

export class PageView {
  constructor(host, pageId, context) {
    this.host = host;
    this.pageId = String(pageId);
    this.context = context;
    this.render();
  }

  async render() {
    clear(this.host);
    this.host.append(el("div", { class: "page-scroll scroll" }, el("div", { class: "loading-row", style: { padding: "40px 60px" } }, el("span", { class: "spinner" }), "Opening…")));
    const page = await withError(() => loadPage(this.pageId), "That page could not be opened.");
    if (!page) { this.renderMissing(); return; }
    this.page = page;
    this.draw();
  }

  renderMissing() {
    clear(this.host);
    this.host.append(el("div", { class: "page-scroll scroll" },
      el("div", { class: "page-column" },
        el("div", { class: "empty-state" }, "This page no longer exists.",
          el("div", { class: "actions" },
            el("button", { class: "button", type: "button", onclick: () => this.context.goHome() }, "Go home"))))));
  }

  /* A page with a passcode shows nothing of itself — no title, icon, cover or text — until the passcode is entered
     (once per session). */
  drawLocked() {
    const page = this.page;
    const sessionKey = `clyra.notes.unlocked.${page.id}`;
    try { sessionStorage.removeItem(sessionKey); } catch { /* optional */ }
    const pin = page.lock_kind === "pin6" || page.lock_kind === "pin8";
    const form = unlockForm({
      kind: page.lock_kind || "password", submitLabel: "Unlock",
      onSubmit: async (value) => {
        const result = await api.post(`/api/notes/pages/${page.id}/check-lock`, { password: value });
        if (result?.ok) {
          try { sessionStorage.setItem(sessionKey, "1"); } catch { /* optional */ }
          if (result.page) { this.page = result.page; state.open.set(String(page.id), result.page); }
          emit("tabs");
          screen.classList.add("is-opening");
          setTimeout(() => this.draw(), 260);
          return { ok: true };
        }
        return { ok: false, error: result?.message || "That passcode is not right." };
      },
    });
    const screen = el("div", { class: "lock-screen" },
      el("div", { class: "lock-hero lock-hero-large" }, el("span", { class: "lock-hero-rings", "aria-hidden": "true" }), el("span", { class: "lock-hero-badge" }, icon("lock", 28))),
      el("div", { class: "lock-screen-title", text: "Locked" }),
      el("div", { class: "lock-dialog-text", text: pin ? `Enter your ${page.lock_kind === "pin8" ? 8 : 6}-digit PIN to open this page.` : "Enter the password to open this page." }),
      form.node,
      el("div", { class: "lock-screen-foot" }, icon("shield", 13), "Protected on this device · wrong tries are rate-limited"));
    clear(this.host);
    this.host.append(el("div", { class: "page-scroll scroll lock-stage" }, screen));
    setTimeout(() => form.focus?.(), 80);
  }

  draw() {
    const page = this.page;
    let unlockedHere = false;
    try { unlockedHere = sessionStorage.getItem(`clyra.notes.unlocked.${page.id}`) === "1"; } catch { /* optional */ }
    if (page.sealed || (page.locked && page.lock_has_password && !unlockedHere)) { this.drawLocked(); return; }
    clear(this.host);
    const canvas = el("div", { class: "page-canvas" });
    canvas.classList.toggle("full-width", Boolean(page.full_width));
    canvas.classList.toggle("has-cover", Boolean(page.cover));
    canvas.classList.toggle("has-icon", Boolean(page.icon));
    canvas.classList.toggle("record", page.kind === "record");
    if (page.text_size && page.text_size !== "medium") canvas.classList.add(`text-${page.text_size}`);
    if (page.font_style && page.font_style !== "default") canvas.classList.add(`font-${page.font_style}`);
    this.canvas = canvas;
    this.activeColourFilters = new Set();

    if (page.cover) append(canvas, this.buildCover());

    const column = el("div", { class: "page-column" });
    const head = el("div", { class: "page-head" });
    append(head, this.buildHeadActions(), ...(page.icon ? [this.buildIcon()] : []), this.buildTitle());
    append(column, head);
    if ((page.backlinks || []).length) append(column, this.buildBacklinks());

    const editorHost = el("div", { class: "editor-host" });
    append(column, editorHost);
    append(canvas, column);
    this.host.append(el("div", { class: "page-scroll scroll" }, canvas));

    this.editor = new Editor(editorHost, {
      page,
      readOnly: Boolean(page.locked),
      onNavigate: (id, options) => this.context.openPage(id, options),
    });
    this.editor.onChange = () => this.syncQuickstart();
    this.editor.onAskClyra = (text, mode) => this.context.askWithSelection?.(text, mode);
    this.editor.onGenerate = (kind, target) => this.context.generate(kind, target);
    this.editor.onCreateChildPage = (block) => this.createChildPage(block);
    this.editor.onLinkPage = (block) => this.linkPage(block);
    this.editor.onPageStyle = (patch) => this.setMeta(mapStyle(patch));
    this.applyColourFocus();
    requestAnimationFrame(() => this.context.revealBlock?.());

    this.quickstart = el("div", { class: "quickstart" });
    append(column, this.quickstart);
    this.syncQuickstart();
  }

  /* Quick-start chips are for an empty page only; they disappear the moment
     the page has real content rather than lingering as decoration. */
  syncQuickstart() {
    if (!this.quickstart) return;
    const blocks = this.editor?.blocks || [];
    const empty = blocks.length <= 1 && !(blocks[0]?.text || []).some((span) => span.t?.trim());
    if (!empty || this.page.locked) { this.quickstart.hidden = true; clear(this.quickstart); return; }
    if (this.quickstart.childElementCount) { this.quickstart.hidden = false; return; }
    this.quickstart.hidden = false;
    const chip = (iconName, label, onClick) =>
      el("button", { class: "chip", type: "button", onclick: onClick }, icon(iconName, 15), label);
    const first = () => this.editor.blocks[0];
    const chips = el("div", { class: "quickstart-chips" });
    this.quickstart.append(chips);
    append(chips, 
      state.aiConfigured
        ? chip("sparkle", "Ask AI", () => this.editor.openAiComposer(first(), { mount: this.quickstart }))
        : null,
      chip("mic", "Lecture notes", () => this.context.generate("lecture", { pageId: this.page.id })),
      state.aiConfigured ? chip("cards", "Flashcards", () => this.context.generate("flashcards", { pageId: this.page.id })) : null,
      state.aiConfigured ? chip("check_square", "Practice test", () => this.context.generate("questions", { pageId: this.page.id })) : null,
      chip("template", "Templates", () => this.context.openTemplates(this.page.id)),
      chip("import", "Import", () => this.context.openImport(this.page.id)),
    );
  }

  buildCover() {
    const cover = el("div", { class: "page-cover", style: { background: this.page.cover.startsWith("linear-gradient") ? this.page.cover : `url("${this.page.cover}") center/cover` } });
    cover.append(el("div", { class: "page-cover-actions" },
      el("button", { class: "text-button", type: "button", onclick: (event) => this.coverMenu(event.currentTarget) }, "Change cover"),
      el("button", { class: "text-button", type: "button", onclick: () => this.setMeta({ cover: null }) }, "Remove")));
    return cover;
  }

  buildIcon() {
    const button = el("button", { class: "page-icon-large", type: "button", "aria-label": "Change page icon" });
    if (/^https?:|^\/notes-files\//.test(this.page.icon)) button.append(el("img", { src: this.page.icon, alt: "" }));
    else button.textContent = this.page.icon;
    button.addEventListener("click", () => this.iconMenu(button));
    return button;
  }

  buildHeadActions() {
    const row = el("div", { class: "page-head-actions" });
    append(row, el("button", { class: "text-button colour-key-trigger", type: "button", onclick: (event) => openColourLegend(this, event.currentTarget) }, icon("palette", 15), "Colour key"));
    if (!this.page.icon) append(row, el("button", { class: "text-button", type: "button", onclick: (event) => this.iconMenu(event.currentTarget) }, icon("callout", 15), "Add icon"));
    if (!this.page.cover) append(row, el("button", { class: "text-button", type: "button", onclick: (event) => this.coverMenu(event.currentTarget) }, icon("image", 15), "Add cover"));
    return row;
  }

  toggleColourFocus(categoryId) {
    if (this.activeColourFilters.has(categoryId)) this.activeColourFilters.delete(categoryId);
    else this.activeColourFilters.add(categoryId);
    this.applyColourFocus();
  }

  clearColourFocus() { this.activeColourFilters.clear(); this.applyColourFocus(); }

  applyColourFocus() {
    if (!this.canvas) return;
    const active = this.activeColourFilters || new Set();
    this.canvas.classList.toggle("colour-focus-active", active.size > 0);
    this.canvas.querySelectorAll(".smart-highlight").forEach((node) => {
      node.classList.toggle("colour-focus-match", active.has(node.dataset.categoryId));
    });
  }

  buildTitle() {
    const input = el("textarea", {
      class: "page-title-input", rows: "1", placeholder: "New page",
      "aria-label": "Page title", spellcheck: "false",
      readonly: this.page.locked ? "" : null,
    });
    input.value = this.page.title || "";
    const grow = () => { input.style.height = "auto"; input.style.height = `${input.scrollHeight}px`; };
    queueMicrotask(grow);
    input.addEventListener("input", () => {
      grow();
      this.page.title = input.value;
      const meta = getPageMeta(this.page.id);
      if (meta) meta.title = input.value;
      queueMetaSave(this.page.id, { title: input.value });
      this.context.onTitleChanged?.(this.page.id, input.value);
    });
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        const first = this.editor?.blocks[0];
        if (first) this.editor.focus(first.id, 0);
      }
      if (event.key === "ArrowDown" && input.selectionStart === input.value.length) {
        const first = this.editor?.blocks[0];
        if (first) { event.preventDefault(); this.editor.focus(first.id, 0); }
      }
    });
    this.titleInput = input;
    if (!this.page.title) queueMicrotask(() => input.focus());
    return input;
  }

  buildBacklinks() {
    const details = el("details", { class: "backlinks" });
    details.append(
      el("summary", {}, icon("link", 13), `${this.page.backlinks.length} linked ${this.page.backlinks.length === 1 ? "reference" : "references"}`),
      el("div", { class: "backlink-list" }, this.page.backlinks.map((link) =>
        el("button", { class: "backlink", type: "button", onclick: (event) => this.context.openPage(link.id, { newTab: modKey(event) }) },
          el("span", { class: "page-icon", text: link.icon || "" }, link.icon ? null : icon("page", 13)),
          link.title || "New page"))),
    );
    return details;
  }

  iconMenu(anchor) {
    this.editor?.pickEmoji ? null : null;
    const groups = {
      Study: ["📚", "📝", "🧠", "🎓", "🔬", "🧪", "🧬", "⚛️", "🧮", "📊", "📖", "🗒️"],
      Subjects: ["🌍", "🏛️", "⚖️", "💰", "🩺", "💻", "🎨", "🎼", "🗣️", "🌱", "🏗️", "📐"],
      Marks: ["⭐", "🔥", "✅", "📌", "🎯", "❗", "❓", "💡", "🏁", "⏱️", "🔑", "🧭"],
    };
    let entry;
    const pick = (value) => { this.setMeta({ icon: value }); entry.close("pick"); };
    entry = menu(anchor, [
      ...Object.entries(groups).flatMap(([name, emojis]) => [
        { type: "label", label: name },
        { type: "custom", render: () => el("div", { class: "emoji-grid" },
          emojis.map((emoji) => el("button", { class: "emoji-cell", type: "button", onclick: () => pick(emoji) }, emoji))) },
      ]),
      { type: "separator" },
      { label: "Upload an image", icon: "image", onSelect: () => this.uploadIcon() },
      this.page.icon ? { label: "Remove icon", icon: "close", onSelect: () => this.setMeta({ icon: null }) } : null,
    ].filter(Boolean), { class: "emoji-menu" });
  }

  uploadIcon() {
    const field = el("input", { type: "file", accept: "image/*" });
    field.addEventListener("change", async () => {
      const file = field.files?.[0];
      if (!file) return;
      const uploaded = await withError(() => uploadFile(file), "Upload failed");
      if (uploaded) this.setMeta({ icon: uploaded.url });
    });
    field.click();
  }

  coverMenu(anchor) {
    let entry;
    entry = menu(anchor, [
      { type: "label", label: "Gallery" },
      { type: "custom", render: () => el("div", { class: "cover-grid" },
        COVERS.map((cover) => el("button", {
          class: "cover-swatch", type: "button", style: { background: cover },
          "aria-label": "Use this cover",
          onclick: () => { this.setMeta({ cover }); entry.close("pick"); },
        }))) },
      { type: "separator" },
      { label: "Upload an image", icon: "image", onSelect: () => {
        const field = el("input", { type: "file", accept: "image/*" });
        field.addEventListener("change", async () => {
          const file = field.files?.[0];
          if (!file) return;
          const uploaded = await withError(() => uploadFile(file), "Upload failed");
          if (uploaded) this.setMeta({ cover: uploaded.url });
        });
        field.click();
      } },
      this.page.cover ? { label: "Remove cover", icon: "close", onSelect: () => this.setMeta({ cover: null }) } : null,
    ].filter(Boolean));
  }

  setMeta(patch) {
    Object.assign(this.page, patch);
    const meta = getPageMeta(this.page.id);
    if (meta) Object.assign(meta, patch);
    /* The row uses snake_case; the save endpoint takes camelCase. */
    const payload = { ...patch };
    if ("font_style" in patch) payload.fontStyle = patch.font_style;
    if ("text_size" in patch) payload.textSize = patch.text_size;
    if ("full_width" in patch) payload.fullWidth = patch.full_width;
    if ("cover_offset" in patch) payload.coverOffset = patch.cover_offset;
    queueMetaSave(this.page.id, payload);
    this.draw();
    this.context.onMetaChanged?.(this.page.id);
  }

  async createChildPage(block) {
    const created = await withError(() => api.post("/api/notes/pages", { parentId: this.page.id, title: "" }), "Could not create the page");
    if (!created) return;
    await refreshPages();
    block.type = "page";
    block.props = { pageId: created.id, title: created.title };
    block.text = [];
    block.__dirty = true;
    this.editor.insertAfter(block, makeBlock());
    this.context.openPage(created.id);
  }

  linkPage(block) {
    openSearch({
      title: "Link to page",
      onSelect: (page) => {
        block.type = "link_to_page";
        block.props = { pageId: page.page_id || page.id, title: page.title };
        block.text = [];
        block.__dirty = true;
        this.editor.insertAfter(block, makeBlock());
      },
    });
  }

  destroy() {
    this.editor?.destroy();
    flushPage(this.pageId);
  }
}
