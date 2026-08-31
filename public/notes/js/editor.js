/* The block editor.

   Blocks are the model; the DOM is rebuilt from them by a keyed reconcile.
   Typing mutates a block's spans in place and never re-renders, so the caret
   and IME composition are the browser's to manage. Structural edits change
   the model, re-render, and then place the caret explicitly. */
import { el, clear, icon, iconButton, tooltip, menu, modal, toast, confirmDialog, position, modKey, mod, append } from "./dom.js";
import { executeBlock, isExecutable, isPreviewable, runnerLabel } from "./runner.js";
import {
  renderSpans, readSpans, plain, spansText, spansLength, sliceSpans, applyMark,
  markState, caretOffset, setCaret, selectionRangeIn, normalizeSpans, replaceRange,
} from "./richtext.js";
import {
  BLOCK_TYPES, TEXT_BLOCKS, CONTAINER_BLOCKS, LIST_BLOCKS, HEADINGS,
  TURN_INTO, PLACEHOLDERS, MARKDOWN_RULES, COLORS, CODE_LANGUAGES,
} from "./block-types.js";
import { openSlashMenu } from "./slash.js";
import { highlight, handlePairs, handleNewline, completionsFor } from "./code.js";
import { openInlineToolbar } from "./inline-toolbar.js";
import { runAiComposer } from "./ai-composer.js";
import { state, getPageMeta, queueBlockSave } from "./state.js";

export const newBlockId = () =>
  `b${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

export const makeBlock = (type = "text", text = [], props = {}) =>
  ({ id: newBlockId(), type, text, props, children: [] });

const isTextBlock = (block) => TEXT_BLOCKS.has(block.type);

/* Props are per-type, so converting a block keeps only what the new type
   understands — otherwise a to-do turned into a quote stays "checked". */
const KEEP_PROPS = { todo: ["checked"], code: ["language"], callout: ["icon", "color"] };
function propsFor(type, props = {}) {
  const keep = KEEP_PROPS[type] || [];
  const next = {};
  for (const key of keep) if (props[key] !== undefined) next[key] = props[key];
  if (type.startsWith("toggle") && props.collapsed !== undefined) next.collapsed = props.collapsed;
  if (type === "todo" && next.checked === undefined) next.checked = false;
  if (type === "code" && next.language === undefined) next.language = "plain";
  if (type === "callout" && next.icon === undefined) next.icon = "💡";
  return next;
}

export class Editor {
  constructor(host, options) {
    this.host = host;
    this.page = options.page;
    this.onNavigate = options.onNavigate || (() => {});
    this.readOnly = Boolean(options.readOnly);
    this.blocks = normalizeTree(options.page.blocks || []);
    if (!this.blocks.length) this.blocks = [makeBlock()];
    this.nodes = new Map();
    this.selection = new Set();
    this.history = [];
    this.future = [];
    this.historyTimer = null;
    this.typingBurst = false;
    this.baseline = cloneTree(this.blocks);
    this.container = el("div", { class: "blocks" });
    this.dropIndicator = null;
    host.append(this.container);
    this.render();
    this.bindGlobal();
  }

  /* ------------------------------------------------------------ model */

  flat(list = this.blocks, parent = null, out = []) {
    for (const block of list) {
      out.push({ block, parent });
      this.flat(block.children || [], block, out);
    }
    return out;
  }

  find(id) { return this.flat().find((entry) => entry.block.id === id) || null; }
  siblingsOf(id) {
    const entry = this.find(id);
    if (!entry) return this.blocks;
    return entry.parent ? (entry.parent.children ||= []) : this.blocks;
  }

  before(id) {
    const list = this.siblingsOf(id);
    return list[list.findIndex((block) => block.id === id) - 1] || null;
  }

  /* The visual order of every text block, which is what arrow-key movement
     between blocks and multi-block selection walk along. */
  linear() { return this.flat().map((entry) => entry.block); }

  /* ----------------------------------------------------------- render */

  render(focus) {
    this.reconcile(this.container, this.blocks, null);
    for (const [id, node] of [...this.nodes]) {
      if (!node.isConnected) this.nodes.delete(id);
    }
    if (focus) this.focus(focus.id, focus.offset);
    this.updateSelectionStyles();
  }

  reconcile(host, list, parentBlock) {
    let counter = 0;
    const wanted = [];
    for (const block of list) {
      counter = block.type === "numbered" ? counter + 1 : 0;
      let node = this.nodes.get(block.id);
      if (!node || node.__type !== block.type || block.__dirty) {
        node = this.buildBlock(block, parentBlock);
        this.nodes.set(block.id, node);
        delete block.__dirty;
      }
      node.__block = block;
      if (block.type === "numbered") {
        const marker = node.querySelector(":scope > .block-row > .block-marker");
        if (marker) marker.textContent = `${counter}.`;
      }
      wanted.push(node);
      const childHost = node.__childrenHost;
      if (childHost) this.reconcile(childHost, block.children || [], block);
    }
    /* Re-appending in order is cheap and keeps DOM identity, so reused nodes
       keep focus and scroll position through a structural edit. */
    let cursor = host.firstChild;
    for (const node of wanted) {
      if (cursor === node) { cursor = cursor.nextSibling; continue; }
      host.insertBefore(node, cursor);
    }
    while (cursor) { const next = cursor.nextSibling; cursor.remove(); cursor = next; }
  }

  buildBlock(block, parentBlock) {
    const node = el("div", { class: "block", "data-block": block.id, "data-type": block.type });
    node.__type = block.type;
    node.__block = block;

    const gutter = this.readOnly ? null : el("div", { class: "block-gutter" },
      iconButton("plus", "Insert block below", (event) => this.insertMenu(block, event.currentTarget), { shortcut: "/" }),
      tooltip(el("button", { class: "icon-button block-handle", type: "button", draggable: "true" }, icon("grip", 14)),
        "Drag to move · click for actions"),
    );
    const handle = gutter?.querySelector(".block-handle");
    if (handle) {
      handle.addEventListener("click", (event) => { event.preventDefault(); this.blockMenu(block, handle); });
      this.bindDrag(handle, block, node);
    }

    const row = el("div", { class: "block-row" }, gutter);
    append(node, row);

    const content = el("div", { class: "block-content" });
    const parts = this.renderBlockBody(block, node, content, parentBlock);
    append(row, ...(parts.leading || []), content);

    /* Almost every block can hold children — indenting a list item is the
       common case — so a child host is created unless the body already
       provided one (callout, columns) or the type cannot nest. */
    if (!node.__childrenHost && block.type !== "divider") {
      const children = el("div", { class: "block-children" });
      append(node, children);
      node.__childrenHost = children;
    }
    if (block.type.startsWith("toggle") && block.props?.collapsed) node.classList.add("collapsed");
    return node;
  }

  renderBlockBody(block, node, content, parentBlock) {
    const leading = [];
    if (block.type === "divider") {
      append(content, el("div", { class: "divider-block" }, el("hr")));
      return { leading };
    }
    if (block.type === "columns") {
      const row = el("div", { class: "columns" });
      append(content, row);
      node.__childrenHost = row;
      return { leading };
    }
    if (block.type === "column") {
      const column = el("div", { class: "column" });
      append(content, column);
      node.__childrenHost = column;
      return { leading };
    }
    if (block.type === "breadcrumb") { append(content, this.renderBreadcrumb()); return { leading }; }
    if (block.type === "toc") { append(content, this.renderToc()); return { leading }; }
    if (block.type === "page" || block.type === "link_to_page") { append(content, this.renderPageLink(block)); return { leading }; }
    if (["image", "video", "audio", "file", "pdf", "bookmark", "embed"].includes(block.type)) {
      append(content, this.renderMedia(block)); return { leading };
    }
    if (block.type === "table") { append(content, this.renderTable(block)); return { leading }; }
    if (block.type === "source") { append(content, this.renderSource(block)); return { leading }; }
    if (block.type === "transcript") { append(content, this.renderTranscript(block)); return { leading }; }
    if (block.type === "exam_checklist") { append(content, this.renderChecklistHeader(block)); return { leading }; }

    /* ---- text bearing blocks ---- */
    if (block.type === "numbered") leading.push(el("div", { class: "block-marker", text: "1." }));
    if (block.type === "bulleted") leading.push(el("div", { class: "block-marker" }));
    if (block.type === "todo") {
      const box = el("button", {
        class: "todo-check", type: "button", role: "checkbox",
        "aria-checked": block.props?.checked ? "true" : "false",
        "aria-label": "Toggle to-do",
        onclick: () => {
          block.props = { ...block.props, checked: !block.props?.checked };
          node.classList.toggle("done", Boolean(block.props.checked));
          box.setAttribute("aria-checked", block.props.checked ? "true" : "false");
          this.commit("todo");
        },
      }, icon("check_square", 11));
      if (block.props?.checked) node.classList.add("done");
      leading.push(box);
    }
    if (block.type.startsWith("toggle")) {
      const caret = el("button", {
        class: `toggle-caret${block.props?.collapsed ? "" : " open"}`, type: "button",
        "aria-label": "Toggle children", "aria-expanded": block.props?.collapsed ? "false" : "true",
        onclick: () => {
          block.props = { ...block.props, collapsed: !block.props?.collapsed };
          node.classList.toggle("collapsed", Boolean(block.props.collapsed));
          caret.classList.toggle("open", !block.props.collapsed);
          caret.setAttribute("aria-expanded", block.props.collapsed ? "false" : "true");
          this.commit("toggle");
        },
      }, icon("chevron_right", 12));
      leading.push(caret);
    }

    const line = this.buildLine(block);

    if (block.type === "callout") {
      const wrapper = el("div", { class: "callout", style: block.props?.color && block.props.color !== "default" ? { background: `var(--c-${block.props.color}-bg)` } : {} },
        el("button", {
          class: "callout-icon", type: "button", "aria-label": "Change callout icon",
          onclick: (event) => this.pickEmoji(event.currentTarget, (emoji) => {
            block.props = { ...block.props, icon: emoji };
            event.currentTarget.textContent = emoji;
            this.commit("callout-icon");
          }),
        }, block.props?.icon || "💡"),
        el("div", { class: "callout-body" }, line, el("div", { class: "block-children callout-children" })),
      );
      append(content, wrapper);
      /* The children host must not contain the callout's own line: reconcile
         clears anything in the host that is not a child block. */
      node.__childrenHost = wrapper.querySelector(".callout-children");
      return { leading };
    }
    if (block.type === "code") {
      const wrapper = el("div", { class: "code-block" },
        el("button", {
          class: "code-lang", type: "button",
          onclick: (event) => menu(event.currentTarget, CODE_LANGUAGES.map((language) => ({
            label: language, checked: (block.props?.language || "plain") === language,
            onSelect: () => { block.props = { ...block.props, language }; event.currentTarget.textContent = language; this.commit("code-lang"); },
          })), { search: true, searchPlaceholder: "Language…" }),
        }, block.props?.language || "plain"),
        /* Copy sits to the left of Run: the safe action first, and the one
           that changes nothing stays in the same place whether or not the
           language happens to be executable. */
        el("span", { class: "code-actions" },
          iconButton("copy", "Copy code", () => {
            navigator.clipboard.writeText(spansText(block.text)).then(() => toast("Code copied"));
          }, { className: "code-copy", size: 14 }),
          isExecutable(block.props?.language) ? iconButton(
            isPreviewable(block.props?.language) ? "panel" : "play",
            runnerLabel(block.props?.language),
            () => executeBlock(block.props?.language || "plain", spansText(block.text), this.page?.title || "Preview"),
            { className: "code-run", size: 14 },
          ) : null,
        ),
        line,
      );
      append(content, wrapper);
      return { leading };
    }
    if (block.type === "equation") {
      const wrapper = el("div", { class: "equation-block" }, line);
      append(content, wrapper);
      return { leading };
    }
    if (block.type === "key_term") {
      const term = el("span", {
        class: "key-term-name", contenteditable: this.readOnly ? "false" : "true",
        "data-placeholder": "Term",
        oninput: (event) => { block.props = { ...block.props, term: event.currentTarget.textContent }; this.commit("term"); },
      });
      term.textContent = block.props?.term || "";
      append(content, el("div", { class: "key-term" }, term, el("span", { class: "key-term-dash", text: "—" }), line));
      return { leading };
    }
    if (block.type === "study_summary" || block.type === "objective") {
      append(content, el("div", { class: `study-panel ${block.type}` },
        el("div", { class: "study-panel-label", text: block.type === "objective" ? "Learning objective" : "Study summary" }),
        line));
      return { leading };
    }

    append(content, line);
    return { leading };
  }

  buildLine(block) {
    const line = el("div", {
      class: "text-line",
      contenteditable: this.readOnly ? "false" : "true",
      spellcheck: block.type === "code" ? "false" : "true",
      "data-placeholder": PLACEHOLDERS[block.type] ?? "",
      role: "textbox",
      "aria-multiline": block.type === "code" ? "true" : "false",
    });
    this.paint(line, block);
    line.__block = block;
    if (block.type === "code") {
      line.addEventListener("input", () => this.onCodeInput(block, line));
      line.addEventListener("keydown", (event) => this.onCodeKeyDown(event, block, line));
      line.addEventListener("blur", () => this.closeCompletions());
    } else {
      line.addEventListener("input", () => this.onInput(block, line));
      line.addEventListener("keydown", (event) => this.onKeyDown(event, block, line));
    }
    line.addEventListener("paste", (event) => this.onPaste(event, block, line));
    line.addEventListener("focus", () => { this.activeBlockId = block.id; this.clearSelection(); });
    line.addEventListener("mouseup", () => this.maybeInlineToolbar(block, line));
    line.addEventListener("keyup", (event) => { if (event.shiftKey || event.key === "Escape") this.maybeInlineToolbar(block, line); });
    return line;
  }

  paint(line, block) {
    if (block.type === "code") {
      line.innerHTML = highlight(spansText(block.text), block.props?.language || "plain");
      line.dataset.placeholder = "";
      return;
    }
    renderSpans(line, block.text, {
      pageById: (id) => getPageMeta(id),
      onOpenPage: (id, event) => this.onNavigate(id, { newTab: modKey(event) }),
    });
    line.dataset.placeholder = PLACEHOLDERS[block.type] ?? "";
    if (block.id === this.firstEmptyId()) line.dataset.placeholder = `Press '${"space"}' for AI, '/' for commands`;
  }

  firstEmptyId() {
    const first = this.blocks[0];
    return this.blocks.length === 1 && first && isTextBlock(first) && !spansLength(first.text) ? first.id : null;
  }

  lineOf(id) { return this.nodes.get(id)?.querySelector(".text-line") || null; }

  focus(id, offset = 0) {
    const line = this.lineOf(id);
    if (!line) return;
    line.focus({ preventScroll: false });
    setCaret(line, offset === "end" ? line.textContent.length : offset);
    this.activeBlockId = id;
  }

  /* ------------------------------------------------------------ edits */

  onInput(block, line) {
    block.text = readSpans(line);
    if (this.applyMarkdown(block, line)) return;
    this.checkSlash(block, line);
    this.commit("type");
  }

  /* Markdown shortcuts fire on the space or character that completes them,
     which is why the rules match the whole line rather than a prefix. */
  applyMarkdown(block, line) {
    if (block.type === "code") return false;
    const text = spansText(block.text);
    for (const [pattern, type] of MARKDOWN_RULES) {
      if (!pattern.test(text)) continue;
      if (type === "divider") {
        this.push();
        block.type = "divider";
        block.text = [];
        block.__dirty = true;
        const next = makeBlock();
        this.siblingsOf(block.id).splice(this.siblingsOf(block.id).indexOf(block) + 1, 0, next);
        this.render({ id: next.id, offset: 0 });
        this.commit("markdown", true);
        return true;
      }
      this.push();
      block.type = type;
      block.text = [];
      block.props = propsFor(type, block.props);
      block.__dirty = true;
      this.render({ id: block.id, offset: 0 });
      this.commit("markdown", true);
      return true;
    }
    return false;
  }

  checkSlash(block, line) {
    if (this.slashOpen) return;
    const offset = caretOffset(line);
    const text = spansText(block.text).slice(0, offset);
    if (!text.endsWith("/")) return;
    this.openSlash(block, line, offset);
  }

  openSlash(block, line, triggerOffset) {
    this.slashOpen = true;
    openSlashMenu({
      editor: this,
      block,
      line,
      triggerOffset,
      onClose: () => { this.slashOpen = false; },
    });
  }

  onPaste(event, block, line) {
    const text = event.clipboardData?.getData("text/plain");
    if (!text) return;
    event.preventDefault();
    /* Multi-line pastes become blocks; a single line is inserted inline so
       pasting a word does not fragment the paragraph. */
    if (!text.includes("\n") || block.type === "code") {
      document.execCommand("insertText", false, text);
      block.text = readSpans(line);
      this.commit("paste");
      return;
    }
    this.push();
    const parsed = parseMarkdownBlocks(text);
    const list = this.siblingsOf(block.id);
    const index = list.indexOf(block);
    const offset = caretOffset(line);
    const head = sliceSpans(block.text, 0, offset);
    const tail = sliceSpans(block.text, offset, spansLength(block.text));
    block.text = head.length ? head : parsed[0].text;
    if (!head.length) { block.type = parsed[0].type; block.props = parsed[0].props; block.__dirty = true; parsed.shift(); }
    const rest = parsed.map((draft) => ({ ...makeBlock(draft.type, draft.text, draft.props), children: draft.children || [] }));
    if (tail.length) rest.push(makeBlock("text", tail));
    list.splice(index + 1, 0, ...rest);
    const last = rest[rest.length - 1] || block;
    this.render({ id: last.id, offset: "end" });
    this.commit("paste", true);
  }

  onKeyDown(event, block, line) {
    if (this.readOnly) return;
    const offset = caretOffset(line);
    const length = line.textContent.length;
    const selection = selectionRangeIn(line);

    if (modKey(event) && !event.shiftKey && event.key.toLowerCase() === "z") {
      event.preventDefault(); this.undo(); return;
    }
    if (modKey(event) && (event.key.toLowerCase() === "y" || (event.shiftKey && event.key.toLowerCase() === "z"))) {
      event.preventDefault(); this.redo(); return;
    }
    if (modKey(event) && "biu".includes(event.key.toLowerCase()) && selection && !selection.collapsed) {
      event.preventDefault();
      this.toggleMark(block, line, { b: "b", i: "i", u: "u" }[event.key.toLowerCase()]);
      return;
    }
    if (modKey(event) && event.shiftKey && event.key.toLowerCase() === "s" && selection && !selection.collapsed) {
      event.preventDefault(); this.toggleMark(block, line, "s"); return;
    }
    if (modKey(event) && event.key.toLowerCase() === "e" && selection && !selection.collapsed) {
      event.preventDefault(); this.toggleMark(block, line, "c"); return;
    }
    if (modKey(event) && event.key.toLowerCase() === "d") {
      event.preventDefault(); this.duplicateBlock(block); return;
    }
    if (modKey(event) && event.key === "/") {
      event.preventDefault(); this.blockMenu(block, this.nodes.get(block.id).querySelector(".block-handle")); return;
    }
    if (modKey(event) && event.key === "Enter") {
      event.preventDefault();
      if (block.type === "todo") this.nodes.get(block.id).querySelector(".todo-check")?.click();
      else if (block.type.startsWith("toggle")) this.nodes.get(block.id).querySelector(".toggle-caret")?.click();
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      line.blur();
      this.selection = new Set([block.id]);
      this.updateSelectionStyles();
      return;
    }

    /* Space on an untouched line opens the AI composer — the fastest path
       from a blank page to a draft, and the reason the hint says so. */
    if (event.key === " " && !length && isTextBlock(block) && state.aiConfigured) {
      event.preventDefault();
      this.openAiComposer(block);
      return;
    }

    if (event.key === "Enter" && !event.shiftKey) {
      if (block.type === "code") return;   // newline inside code
      event.preventDefault();
      this.splitBlock(block, line, offset);
      return;
    }
    if (event.key === "Enter" && event.shiftKey) {
      if (block.type === "code") return;
      event.preventDefault();
      document.execCommand("insertLineBreak");
      block.text = readSpans(line);
      this.commit("softbreak");
      return;
    }
    if (event.key === "Tab") {
      event.preventDefault();
      event.shiftKey ? this.outdent(block) : this.indent(block);
      return;
    }
    if (event.key === "Backspace" && offset === 0 && selection?.collapsed) {
      event.preventDefault();
      this.backspaceAtStart(block);
      return;
    }
    if (event.key === "Delete" && offset === length && selection?.collapsed) {
      const next = this.nextTextBlock(block);
      if (next) { event.preventDefault(); this.mergeInto(block, next); }
      return;
    }
    if (event.key === "ArrowUp" && selection?.collapsed && !line.textContent.slice(0, offset).includes("\n")) {
      const previous = this.previousTextBlock(block);
      if (previous) { event.preventDefault(); this.focus(previous.id, "end"); }
      return;
    }
    if (event.key === "ArrowDown" && selection?.collapsed && !line.textContent.slice(offset).includes("\n")) {
      const next = this.nextTextBlock(block);
      if (next) { event.preventDefault(); this.focus(next.id, 0); }
    }
  }

  splitBlock(block, line, offset) {
    this.push();
    const text = spansText(block.text);
    if (LIST_BLOCKS.has(block.type) && !text.length) { this.outdentOrPlain(block); return; }
    const head = sliceSpans(block.text, 0, offset);
    const tail = sliceSpans(block.text, offset, spansLength(block.text));
    block.text = head;
    const carry = LIST_BLOCKS.has(block.type) ? block.type : HEADINGS.has(block.type) || block.type === "quote" || block.type === "callout" ? "text" : block.type;
    const next = makeBlock(carry === "code" ? "text" : carry, tail);
    next.props = propsFor(next.type, {});
    /* A split inside a container keeps the new block inside it, so pressing
       Enter in a toggle's first child does not jump out of the toggle. */
    const list = this.siblingsOf(block.id);
    list.splice(list.indexOf(block) + 1, 0, next);
    this.render({ id: next.id, offset: 0 });
    this.commit("split", true);
  }

  outdentOrPlain(block) {
    const entry = this.find(block.id);
    if (entry?.parent) this.outdent(block);
    else { block.type = "text"; block.props = {}; block.__dirty = true; this.render({ id: block.id, offset: 0 }); this.commit("plain", true); }
  }

  backspaceAtStart(block) {
    if (block.type !== "text") {
      this.push();
      block.type = "text";
      block.props = {};
      block.__dirty = true;
      this.render({ id: block.id, offset: 0 });
      this.commit("plain", true);
      return;
    }
    const entry = this.find(block.id);
    if (entry?.parent && this.siblingsOf(block.id)[0] === block) { this.outdent(block); return; }
    const previous = this.previousTextBlock(block);
    if (!previous) return;
    this.push();
    this.mergeInto(previous, block);
  }

  mergeInto(target, source) {
    const offset = spansLength(target.text);
    target.text = normalizeSpans([...target.text, ...source.text]);
    /* Children follow their text so merging a toggle's title does not orphan
       everything nested under it. */
    if (source.children?.length) (target.children ||= []).push(...source.children);
    this.removeBlock(source.id);
    if (this.nodes.get(target.id)) this.paint(this.lineOf(target.id) || document.createElement("div"), target);
    this.render({ id: target.id, offset });
    this.commit("merge", true);
  }

  removeBlock(id) {
    const list = this.siblingsOf(id);
    const index = list.findIndex((block) => block.id === id);
    if (index >= 0) list.splice(index, 1);
    this.nodes.delete(id);
  }

  indent(block) {
    const previous = this.before(block.id);
    if (!previous) return;
    this.push();
    const list = this.siblingsOf(block.id);
    list.splice(list.indexOf(block), 1);
    (previous.children ||= []).push(block);
    if (CONTAINER_BLOCKS.has(previous.type) && previous.props?.collapsed) {
      previous.props = { ...previous.props, collapsed: false };
      previous.__dirty = true;
    }
    const offset = this.caretIn(block);
    this.render({ id: block.id, offset });
    this.commit("indent", true);
  }

  outdent(block) {
    const entry = this.find(block.id);
    if (!entry?.parent) return;
    this.push();
    const parentEntry = this.find(entry.parent.id);
    const parentList = parentEntry?.parent ? parentEntry.parent.children : this.blocks;
    const children = entry.parent.children;
    const index = children.indexOf(block);
    /* Later siblings become this block's children so outdenting the middle
       of a list does not silently reorder the ones after it. */
    const trailing = children.splice(index + 1);
    children.splice(index, 1);
    if (trailing.length) (block.children ||= []).push(...trailing);
    parentList.splice(parentList.indexOf(entry.parent) + 1, 0, block);
    const offset = this.caretIn(block);
    this.render({ id: block.id, offset });
    this.commit("outdent", true);
  }

  caretIn(block) {
    const line = this.lineOf(block.id);
    return line && document.activeElement === line ? caretOffset(line) : 0;
  }

  previousTextBlock(block) {
    const order = this.linear().filter(isTextBlock);
    return order[order.indexOf(block) - 1] || null;
  }

  nextTextBlock(block) {
    const order = this.linear().filter(isTextBlock);
    return order[order.indexOf(block) + 1] || null;
  }

  insertAfter(block, next, { focus = true } = {}) {
    this.push();
    const list = this.siblingsOf(block.id);
    list.splice(list.indexOf(block) + 1, 0, next);
    this.render(focus && isTextBlock(next) ? { id: next.id, offset: 0 } : undefined);
    this.commit("insert", true);
    return next;
  }

  appendBlock(next) {
    this.push();
    this.blocks.push(next);
    this.render(isTextBlock(next) ? { id: next.id, offset: 0 } : undefined);
    this.commit("append", true);
    return next;
  }

  turnInto(block, type) {
    this.push();
    block.type = type;
    block.props = propsFor(type, block.props);
    block.__dirty = true;
    this.render(TEXT_BLOCKS.has(type) ? { id: block.id, offset: "end" } : undefined);
    this.commit("turn-into", true);
  }

  duplicateBlock(block) {
    this.push();
    const copy = cloneBlock(block);
    const list = this.siblingsOf(block.id);
    list.splice(list.indexOf(block) + 1, 0, copy);
    this.render({ id: copy.id, offset: "end" });
    this.commit("duplicate", true);
  }

  deleteBlocks(ids) {
    this.push();
    const order = this.linear();
    const firstIndex = Math.min(...ids.map((id) => order.findIndex((block) => block.id === id)));
    for (const id of ids) this.removeBlock(id);
    if (!this.blocks.length) this.blocks.push(makeBlock());
    const remaining = this.linear();
    const target = remaining[Math.max(0, firstIndex - 1)] || remaining[0];
    this.clearSelection();
    this.render(target && isTextBlock(target) ? { id: target.id, offset: "end" } : undefined);
    this.commit("delete", true);
  }

  moveBlock(id, targetId, placement) {
    if (id === targetId) return;
    const entry = this.find(id);
    if (!entry) return;
    /* Refuse a move into the block's own subtree, which would detach it. */
    let cursor = this.find(targetId);
    while (cursor) {
      if (cursor.block.id === id) return;
      cursor = cursor.parent ? this.find(cursor.parent.id) : null;
    }
    this.push();
    const sourceList = this.siblingsOf(id);
    sourceList.splice(sourceList.indexOf(entry.block), 1);
    if (placement === "inside") {
      const target = this.find(targetId);
      (target.block.children ||= []).push(entry.block);
    } else {
      const targetList = this.siblingsOf(targetId);
      const index = targetList.findIndex((block) => block.id === targetId);
      targetList.splice(placement === "before" ? index : index + 1, 0, entry.block);
    }
    this.render();
    this.commit("move", true);
  }

  /* ------------------------------------------------------------ marks */

  toggleMark(block, line, mark) {
    const range = selectionRangeIn(line);
    if (!range || range.collapsed) return;
    this.push();
    const current = markState(block.text, range.start, range.end);
    block.text = applyMark(block.text, range.start, range.end, mark, current[mark] ? null : 1);
    this.paint(line, block);
    setCaretRange(line, range.start, range.end);
    this.commit("mark", true);
  }

  applyLink(block, line, href) {
    const range = selectionRangeIn(line);
    if (!range || range.collapsed) return;
    this.push();
    block.text = applyMark(block.text, range.start, range.end, "href", href || null);
    this.paint(line, block);
    setCaretRange(line, range.start, range.end);
    this.commit("link", true);
  }

  applyColor(block, line, { color, background }) {
    const range = selectionRangeIn(line);
    if (!range || range.collapsed) return;
    this.push();
    if (color !== undefined) block.text = applyMark(block.text, range.start, range.end, "col", color === "default" ? null : color);
    if (background !== undefined) block.text = applyMark(block.text, range.start, range.end, "bg", background === "default" ? null : background);
    this.paint(line, block);
    setCaretRange(line, range.start, range.end);
    this.commit("color", true);
  }

  /* The caller may pass the range it captured earlier: by the time an action
     button is clicked the DOM selection is gone, so reading it live would
     append the result instead of replacing what was highlighted. */
  replaceSelection(block, line, spans, savedRange) {
    this.push();
    const range = savedRange
      || selectionRangeIn(line)
      || { start: spansLength(block.text), end: spansLength(block.text) };
    block.text = replaceRange(block.text, range.start, range.end, spans);
    this.paint(line, block);
    this.focus(block.id, range.start + spansLength(spans));
    this.commit("replace", true);
  }

  maybeInlineToolbar(block, line) {
    const range = selectionRangeIn(line);
    if (!range || range.collapsed || block.type === "code") return;
    openInlineToolbar({ editor: this, block, line, range });
  }

  /* ------------------------------------------------------- selection */

  clearSelection() {
    if (!this.selection.size) return;
    this.selection.clear();
    this.updateSelectionStyles();
  }

  updateSelectionStyles() {
    for (const [id, node] of this.nodes) node.classList.toggle("selected", this.selection.has(id));
  }

  selectAll() {
    this.selection = new Set(this.linear().map((block) => block.id));
    document.activeElement?.blur?.();
    this.updateSelectionStyles();
  }

  /* --------------------------------------------------------- history */

  push() {
    clearTimeout(this.historyTimer);
    this.typingBurst = false;
    this.history.push({ blocks: cloneTree(this.blocks), focus: this.activeBlockId });
    if (this.history.length > 120) this.history.shift();
    this.future.length = 0;
    this.baseline = cloneTree(this.blocks);
  }

  /* Typing coalesces into one undo entry per pause, so undo removes a phrase
     rather than a character. The entry is pushed at the START of a burst and
     holds the text as it was before it — snapshotting at the end would put
     the present on top of the stack and make the first undo do nothing. */
  pushDebounced() {
    if (!this.typingBurst) {
      this.typingBurst = true;
      this.history.push({ blocks: cloneTree(this.baseline || this.blocks), focus: this.activeBlockId });
      if (this.history.length > 120) this.history.shift();
      this.future.length = 0;
    }
    clearTimeout(this.historyTimer);
    this.historyTimer = setTimeout(() => {
      this.typingBurst = false;
      this.baseline = cloneTree(this.blocks);
    }, 600);
  }

  undo() {
    clearTimeout(this.historyTimer);
    this.typingBurst = false;
    const entry = this.history.pop();
    if (!entry) return;
    this.future.push({ blocks: cloneTree(this.blocks), focus: this.activeBlockId });
    this.blocks = entry.blocks;
    this.baseline = cloneTree(this.blocks);
    this.nodes.clear();
    clear(this.container);
    this.render(entry.focus ? { id: entry.focus, offset: "end" } : undefined);
    this.commit("undo");
  }

  redo() {
    clearTimeout(this.historyTimer);
    this.typingBurst = false;
    const entry = this.future.pop();
    if (!entry) return;
    this.history.push({ blocks: cloneTree(this.blocks), focus: this.activeBlockId });
    this.blocks = entry.blocks;
    this.baseline = cloneTree(this.blocks);
    this.nodes.clear();
    clear(this.container);
    this.render(entry.focus ? { id: entry.focus, offset: "end" } : undefined);
    this.commit("redo");
  }

  /* Called when the page view is replaced. Anything the editor parked
     outside its own subtree has to come with it. */
  destroy() {
    this.closeCompletions();
    clearTimeout(this.historyTimer);
  }

  commit(reason, structural = false) {
    if (this.readOnly) return;
    if (!structural && reason === "type") this.pushDebounced();
    queueBlockSave(this.page.id, serializeTree(this.blocks));
    this.page.blocks = this.blocks;
    this.onChange?.(reason);
    if (structural || reason === "type") this.refreshDependentBlocks();
  }

  /* Table of contents and breadcrumb blocks derive from other content, so
     they are repainted whenever the document structure changes. */
  refreshDependentBlocks() {
    for (const { block } of this.flat()) {
      if (block.type !== "toc") continue;
      const node = this.nodes.get(block.id);
      const host = node?.querySelector(".toc-block");
      if (host) host.replaceWith(this.renderToc());
    }
  }
}

/* ------------------------------------------------------------ helpers */

export function setCaretRange(line, start, end) {
  setCaret(line, start);
  if (end === start) return;
  const selection = window.getSelection();
  const range = selection.getRangeAt(0);
  const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
  let remaining = end;
  let node;
  while ((node = walker.nextNode())) {
    if (remaining <= node.nodeValue.length) { range.setEnd(node, remaining); break; }
    remaining -= node.nodeValue.length;
  }
  selection.removeAllRanges();
  selection.addRange(range);
}

export const cloneBlock = (block) => ({
  ...block,
  id: newBlockId(),
  text: block.text.map((span) => ({ ...span })),
  props: { ...block.props },
  children: (block.children || []).map(cloneBlock),
});

export const cloneTree = (blocks) => blocks.map((block) => ({
  ...block,
  text: block.text.map((span) => ({ ...span })),
  props: { ...block.props },
  children: cloneTree(block.children || []),
}));

export function normalizeTree(blocks) {
  return (blocks || []).map((block) => ({
    id: block.id || newBlockId(),
    type: block.type || "text",
    text: Array.isArray(block.text) ? block.text : [],
    props: block.props || {},
    children: normalizeTree(block.children || []),
  }));
}

export const serializeTree = (blocks) => blocks.map((block) => ({
  id: block.id,
  type: block.type,
  text: block.text,
  props: block.props || {},
  children: serializeTree(block.children || []),
}));

/* Parses pasted markdown into draft blocks, reusing the same rules the
   server uses for imported files. */
export function parseMarkdownBlocks(text) {
  const lines = String(text).replace(/\r\n?/g, "\n").split("\n");
  const out = [];
  let index = 0;
  while (index < lines.length) {
    const raw = lines[index];
    const body = raw.trim();
    index += 1;
    if (!body) continue;
    const separator = (value) => Boolean(value) && /^\|?[\s:|-]+\|[\s:|-]*$/.test(value) && value.includes("-");
    if (body.startsWith("|") && separator((lines[index] || "").trim())) {
      const cells = (value) => value.replace(/^\||\|$/g, "").split("|").map((cell) => cell.trim());
      const rows = [cells(body)];
      index += 1;
      while (index < lines.length && lines[index].trim().startsWith("|")) rows.push(cells(lines[index++].trim()));
      out.push({ type: "table", text: [], props: { rows, hasHeader: true } });
      continue;
    }
    const fence = body.match(/^```(\w*)$/);
    if (fence) {
      const code = [];
      while (index < lines.length && lines[index].trim() !== "```") code.push(lines[index++]);
      index += 1;
      out.push({ type: "code", text: plain(code.join("\n")), props: { language: fence[1] || "plain" } });
      continue;
    }
    if (/^(---|\*\*\*|___)$/.test(body)) { out.push({ type: "divider", text: [], props: {} }); continue; }
    const heading = body.match(/^(#{1,3})\s+(.*)$/);
    if (heading) { out.push({ type: `h${heading[1].length}`, text: inlineMarkdown(heading[2]), props: {} }); continue; }
    /* An empty list item loses its trailing space to trim(), so the content
       group is optional — otherwise "- " pastes in as a paragraph. */
    const todo = body.match(/^[-*+]\s*\[( |x|X)\]\s*(.*)$/);
    if (todo) { out.push({ type: "todo", text: inlineMarkdown(todo[2]), props: { checked: todo[1] !== " " } }); continue; }
    const bullet = body.match(/^[-*+](?:\s+(.*))?$/);
    if (bullet) { out.push({ type: "bulleted", text: inlineMarkdown(bullet[1] ?? ""), props: {} }); continue; }
    const numbered = body.match(/^\d+[.)](?:\s+(.*))?$/);
    if (numbered) { out.push({ type: "numbered", text: inlineMarkdown(numbered[1] ?? ""), props: {} }); continue; }
    const quote = body.match(/^>\s?(.*)$/);
    if (quote) { out.push({ type: "quote", text: inlineMarkdown(quote[1]), props: {} }); continue; }
    out.push({ type: "text", text: inlineMarkdown(body), props: {} });
  }
  return out.length ? out : [{ type: "text", text: [], props: {} }];
}

export function inlineMarkdown(source) {
  const spans = [];
  const pattern = /(\*\*\*(.+?)\*\*\*)|(\*\*(.+?)\*\*)|(\*(.+?)\*)|(_(.+?)_)|(~~(.+?)~~)|(`(.+?)`)|(\[(.+?)\]\((\S+?)\))|(\[\[(.+?)\]\])/;
  let rest = String(source);
  while (rest) {
    const match = pattern.exec(rest);
    if (!match) { spans.push({ t: rest }); break; }
    if (match.index) spans.push({ t: rest.slice(0, match.index) });
    if (match[2]) spans.push({ t: match[2], b: 1, i: 1 });
    else if (match[4]) spans.push({ t: match[4], b: 1 });
    else if (match[6]) spans.push({ t: match[6], i: 1 });
    else if (match[8]) spans.push({ t: match[8], i: 1 });
    else if (match[10]) spans.push({ t: match[10], s: 1 });
    else if (match[12]) spans.push({ t: match[12], c: 1 });
    else if (match[14]) spans.push({ t: match[14], href: match[15] });
    else if (match[17]) spans.push({ t: match[17], page: `title:${match[17]}` });
    rest = rest.slice(match.index + match[0].length);
  }
  return normalizeSpans(spans);
}

/* Block chrome, embedded block renderers and drag behaviour. Defined on the
   prototype so the class above stays focused on the editing model. */
Object.assign(Editor.prototype, {
  bindGlobal() {
    this.container.addEventListener("mousedown", (event) => {
      if (event.target.closest(".text-line, .block-gutter, button, a, input")) return;
      this.clearSelection();
    });
    /* Clicking the empty space under the last block appends a paragraph,
       which is how a page keeps growing without reaching for the menu. */
    this.host.addEventListener("mousedown", (event) => {
      if (event.target !== this.host || this.readOnly) return;
      const last = this.blocks[this.blocks.length - 1];
      if (last && isTextBlock(last) && !spansLength(last.text)) { this.focus(last.id, 0); return; }
      this.appendBlock(makeBlock());
    });
  },

  insertMenu(block, anchor) {
    const target = spansLength(block.text) || !isTextBlock(block)
      ? this.insertAfter(block, makeBlock(), { focus: false })
      : block;
    const line = this.lineOf(target.id);
    if (line) { line.focus(); setCaret(line, 0); }
    this.openSlash(target, line, 0);
  },

  blockMenu(block, anchor) {
    const node = this.nodes.get(block.id);
    node?.classList.add("menu-open");
    const ids = this.selection.size > 1 && this.selection.has(block.id) ? [...this.selection] : [block.id];
    const entry = menu(anchor, [
      { label: "Delete", icon: "trash", shortcut: "Del", danger: true, onSelect: () => this.deleteBlocks(ids) },
      { label: "Duplicate", icon: "duplicate", shortcut: `${mod}+D`, onSelect: () => this.duplicateBlock(block) },
      isTextBlock(block) ? {
        label: "Turn into", icon: "refresh", onSelect: () => this.turnIntoMenu(block, anchor),
      } : null,
      { label: "Copy link to block", icon: "link", onSelect: () => {
        navigator.clipboard.writeText(`${location.origin}/notes#${this.page.id}:${block.id}`);
        toast("Block link copied");
      } },
      { type: "separator" },
      { label: "Move up", icon: "chevron_right", shortcut: "↑", onSelect: () => this.shift(block, -1) },
      { label: "Move down", icon: "chevron_right", shortcut: "↓", onSelect: () => this.shift(block, 1) },
      isTextBlock(block) ? { label: "Colour", icon: "palette", onSelect: () => this.colorMenu(block, anchor) } : null,
      state.aiConfigured ? { type: "separator" } : null,
      state.aiConfigured ? { label: "Ask AI about this", icon: "sparkle", onSelect: () => this.openAiComposer(block, { seedText: spansText(block.text) }) } : null,
      state.aiConfigured ? { label: "Generate flashcards", icon: "cards", onSelect: () => this.generateFrom(block, "flashcards") } : null,
      state.aiConfigured ? { label: "Generate questions", icon: "check_square", onSelect: () => this.generateFrom(block, "questions") } : null,
    ].filter(Boolean), { onClose: () => node?.classList.remove("menu-open") });
    return entry;
  },

  turnIntoMenu(block, anchor) {
    menu(anchor, TURN_INTO.map((type) => ({
      label: BLOCK_TYPES[type].label, icon: BLOCK_TYPES[type].icon,
      checked: block.type === type, keywords: BLOCK_TYPES[type].keywords,
      onSelect: () => this.turnInto(block, type),
    })), { search: true, searchPlaceholder: "Turn into…" });
  },

  colorMenu(block, anchor) {
    menu(anchor, [
      { type: "label", label: "Text" },
      ...COLORS.map((color) => ({
        label: color === "default" ? "Default" : color[0].toUpperCase() + color.slice(1),
        icon: el("span", { style: { color: `var(--c-${color})`, fontWeight: "600" }, text: "A" }),
        onSelect: () => { block.props = { ...block.props, color }; block.__dirty = true; this.render(); this.commit("block-color", true); },
      })),
    ], { align: "start" });
  },

  shift(block, direction) {
    const list = this.siblingsOf(block.id);
    const index = list.indexOf(block);
    const target = index + direction;
    if (target < 0 || target >= list.length) return;
    this.push();
    list.splice(index, 1);
    list.splice(target, 0, block);
    this.render();
    this.commit("shift", true);
  },

  pickEmoji(anchor, onPick) {
    const groups = {
      Common: ["💡", "📌", "✅", "⚠️", "❗", "📝", "🔑", "⭐", "🎯", "🔥", "❓", "📚"],
      Study: ["🧠", "📖", "🎓", "🔬", "🧪", "🧮", "🗒️", "🖊️", "📊", "🧾", "⏱️", "🏁"],
      Subjects: ["🧬", "⚛️", "🌍", "🏛️", "🎼", "🎨", "💻", "⚖️", "💰", "🩺", "🌱", "🗣️"],
    };
    menu(anchor, Object.entries(groups).flatMap(([name, emojis]) => [
      { type: "label", label: name },
      { type: "custom", render: () => el("div", { class: "emoji-grid" },
        emojis.map((emoji) => el("button", { class: "emoji-cell", type: "button", onclick: () => { onPick(emoji); closeEmoji(); } }, emoji))) },
    ]).concat([
      { type: "separator" },
      { label: "Remove", icon: "close", onSelect: () => onPick(null) },
    ]), { class: "emoji-menu" });
    function closeEmoji() { document.querySelector(".emoji-menu")?.previousSibling?.dispatchEvent(new MouseEvent("mousedown")); }
  },

  /* ---- embedded block renderers ---- */

  renderBreadcrumb() {
    const trail = [...(this.page.breadcrumb || []), { id: this.page.id, title: this.page.title, icon: this.page.icon }];
    return el("div", { class: "breadcrumb-block" },
      trail.flatMap((crumb, index) => [
        index ? el("span", { class: "crumb-sep", text: "/" }) : null,
        el("button", {
          class: "crumb", type: "button",
          onclick: (event) => this.onNavigate(crumb.id, { newTab: modKey(event) }),
        }, crumb.icon ? el("span", { class: "page-icon", text: crumb.icon }) : icon("page", 14), el("span", { text: crumb.title || "New page" })),
      ].filter(Boolean)));
  },

  renderToc() {
    const headings = this.flat()
      .map((entry) => entry.block)
      .filter((block) => HEADINGS.has(block.type) && spansLength(block.text));
    const node = el("div", { class: "toc-block" });
    if (!headings.length) {
      append(node, el("div", { class: "toc-empty", text: "Add headings to build a table of contents." }));
      return node;
    }
    for (const heading of headings) {
      append(node, el("a", {
        href: `#${heading.id}`, "data-level": String(heading.type.replace(/\D/g, "")),
        text: spansText(heading.text),
        onclick: (event) => {
          event.preventDefault();
          this.nodes.get(heading.id)?.scrollIntoView({ behavior: "smooth", block: "start" });
          this.focus(heading.id, 0);
        },
      }));
    }
    return node;
  },

  renderPageLink(block) {
    const meta = block.props?.pageId ? getPageMeta(block.props.pageId) : null;
    const title = meta?.title || block.props?.title || "New page";
    return el("button", {
      class: "page-link-block", type: "button",
      onclick: (event) => block.props?.pageId && this.onNavigate(block.props.pageId, { newTab: modKey(event) }),
    },
      el("span", { class: "page-icon", text: meta?.icon || "" }, meta?.icon ? null : icon("page", 16)),
      el("span", { class: "name", text: title }));
  },

  renderMedia(block) {
    const url = block.props?.url;
    const wrapper = el("div", { class: "media-block" });
    if (!url) {
      append(wrapper, el("button", {
        class: "file-chip", type: "button",
        onclick: (event) => this.mediaPrompt(block, event.currentTarget),
      }, icon(BLOCK_TYPES[block.type].icon, 18), `Add ${BLOCK_TYPES[block.type].label.toLowerCase()}`));
      return wrapper;
    }
    if (block.type === "image") append(wrapper, el("img", { src: url, alt: block.props?.caption || "", loading: "lazy" }));
    else if (block.type === "video") {
      const embed = youtubeEmbed(url);
      append(wrapper, embed
        ? el("iframe", { class: "media-frame", src: embed, allowfullscreen: true, loading: "lazy", title: "Video" })
        : el("video", { src: url, controls: true, preload: "metadata" }));
    } else if (block.type === "audio") append(wrapper, el("audio", { src: url, controls: true, preload: "metadata" }));
    else if (block.type === "pdf") append(wrapper, el("iframe", { class: "media-frame", src: url, loading: "lazy", title: block.props?.caption || "PDF", style: { aspectRatio: "3 / 4" } }));
    else if (block.type === "embed") append(wrapper, el("iframe", { class: "media-frame", src: url, loading: "lazy", title: block.props?.caption || "Embed" }));
    else if (block.type === "bookmark") {
      append(wrapper, el("a", { class: "bookmark", href: url, target: "_blank", rel: "noreferrer noopener" },
        el("div", {}, el("div", { class: "bookmark-title", text: block.props?.title || url }),
          el("div", { class: "bookmark-url", text: url }))));
    } else {
      append(wrapper, el("a", { class: "file-chip", href: url, target: "_blank", rel: "noreferrer noopener" },
        icon("file", 18), el("span", { text: block.props?.name || url.split("/").pop() }),
        block.props?.size ? el("span", { class: "meta", text: formatBytes(block.props.size) }) : null));
    }
    if (block.type !== "bookmark" && block.type !== "file") {
      const caption = el("div", {
        class: "media-caption", contenteditable: this.readOnly ? "false" : "true",
        oninput: (event) => { block.props = { ...block.props, caption: event.currentTarget.textContent }; this.commit("caption"); },
      });
      caption.textContent = block.props?.caption || "";
      append(wrapper, caption);
    }
    return wrapper;
  },

  mediaPrompt(block, anchor) {
    const accept = { image: "image/*", video: "video/*", audio: "audio/*", pdf: "application/pdf", file: "*/*" }[block.type];
    const urlField = el("input", { class: "input", placeholder: "Paste a link…", type: "url" });
    const fileField = accept ? el("input", { type: "file", accept, class: "input" }) : null;
    let entry;
    const apply = (props) => {
      block.props = { ...block.props, ...props };
      block.__dirty = true;
      this.render();
      this.commit("media", true);
      entry.close("done");
    };
    entry = modal({
      title: `Add ${BLOCK_TYPES[block.type].label.toLowerCase()}`,
      width: 460,
      body: el("div", {},
        fileField ? el("label", { class: "field" }, el("span", { class: "field-label", text: "Upload a file" }), fileField) : null,
        el("label", { class: "field" }, el("span", { class: "field-label", text: "Or paste a link" }), urlField)),
      footer: [
        el("button", { class: "button", type: "button", onclick: () => entry.close("cancel") }, "Cancel"),
        el("button", {
          class: "button primary", type: "button",
          onclick: async (event) => {
            const button = event.currentTarget;
            const file = fileField?.files?.[0];
            if (file) {
              button.disabled = true;
              button.textContent = "Uploading…";
              const uploaded = await uploadFile(file).catch((error) => { toast(error.message, "error"); return null; });
              button.disabled = false;
              button.textContent = "Add";
              if (!uploaded) return;
              apply({ url: uploaded.url, name: uploaded.name, size: uploaded.size });
              return;
            }
            const url = urlField.value.trim();
            if (!url) { toast("Add a file or a link first", "error"); return; }
            apply({ url, title: url });
          },
        }, "Add"),
      ],
    });
  },

  /* Cells are plain contenteditable text: a table here is for laying out
     facts inside a note, not a database, which is a separate block. */
  renderTable(block) {
    const rows = (block.props?.rows || [["", ""], ["", ""]]).map((row) => [...row]);
    const width = Math.max(1, ...rows.map((row) => row.length));
    for (const row of rows) while (row.length < width) row.push("");
    const save = () => {
      block.props = { ...block.props, rows };
      this.commit("table");
    };
    const wrapper = el("div", { class: "table-block" });
    const scroller = el("div", { class: "table-scroll scroll" });
    const table = el("table", { class: "note-table" });
    rows.forEach((row, rowIndex) => {
      const tr = el("tr");
      row.forEach((cell, columnIndex) => {
        const isHeader = block.props?.hasHeader !== false && rowIndex === 0;
        const node = el(isHeader ? "th" : "td", {
          contenteditable: this.readOnly ? "false" : "true",
          oninput: (event) => { rows[rowIndex][columnIndex] = event.currentTarget.textContent; save(); },
          onkeydown: (event) => {
            if (event.key !== "Tab") return;
            event.preventDefault();
            const cellsInOrder = [...table.querySelectorAll("th, td")];
            const position = cellsInOrder.indexOf(event.currentTarget);
            const target = cellsInOrder[position + (event.shiftKey ? -1 : 1)];
            target?.focus();
          },
        });
        node.textContent = cell;
        tr.append(node);
      });
      table.append(tr);
    });
    scroller.append(table);
    append(wrapper, scroller, this.readOnly ? null : el("div", { class: "table-actions" },
      el("button", { class: "text-button", type: "button", onclick: () => {
        rows.push(Array.from({ length: width }, () => ""));
        block.props = { ...block.props, rows };
        block.__dirty = true;
        this.render();
        this.commit("table-row", true);
      } }, icon("plus", 14), "Row"),
      el("button", { class: "text-button", type: "button", onclick: () => {
        for (const row of rows) row.push("");
        block.props = { ...block.props, rows };
        block.__dirty = true;
        this.render();
        this.commit("table-column", true);
      } }, icon("plus", 14), "Column"),
      rows.length > 1 ? el("button", { class: "text-button", type: "button", onclick: () => {
        rows.pop();
        block.props = { ...block.props, rows };
        block.__dirty = true;
        this.render();
        this.commit("table-row", true);
      } }, "Remove row") : null,
      width > 1 ? el("button", { class: "text-button", type: "button", onclick: () => {
        for (const row of rows) row.pop();
        block.props = { ...block.props, rows };
        block.__dirty = true;
        this.render();
        this.commit("table-column", true);
      } }, "Remove column") : null,
    ));
    return wrapper;
  },

  renderSource(block) {
    const { url, title, kind } = block.props || {};
    const edit = () => this.editSource(block);
    return append(el("div", { class: "source-block" }),
      icon("link", 15),
      url
        ? el("a", { href: url, target: "_blank", rel: "noreferrer noopener", text: title || url })
        : el("button", { class: "source-empty", type: "button", onclick: edit }, title || "Add a source\u2026"),
      kind ? el("span", { class: "source-kind", text: kind }) : null,
      this.readOnly ? null : iconButton("text", "Edit source", edit, { size: 13, className: "source-edit" }));
  },

  editSource(block) {
    const titleField = el("input", { class: "input", placeholder: "Title", value: block.props?.title || "" });
    const urlField = el("input", { class: "input", type: "url", placeholder: "https://\u2026", value: block.props?.url || "" });
    const kindField = el("select", { class: "select" },
      ["Web", "Book", "Article", "Lecture", "Video", "Paper"].map((value) =>
        el("option", { value, text: value, selected: block.props?.kind === value })));
    let entry;
    entry = modal({
      title: "Source",
      width: 460,
      body: el("div", {},
        el("label", { class: "field" }, el("span", { class: "field-label", text: "Title" }), titleField),
        el("label", { class: "field" }, el("span", { class: "field-label", text: "Link" }), urlField),
        el("label", { class: "field" }, el("span", { class: "field-label", text: "Type" }), kindField)),
      footer: [
        el("button", { class: "button", type: "button", onclick: () => entry.close("cancel") }, "Cancel"),
        el("button", { class: "button primary", type: "button", onclick: () => {
          const link = urlField.value.trim();
          block.props = {
            ...block.props,
            title: titleField.value.trim() || link,
            url: link ? (/^https?:\/\//i.test(link) ? link : `https://${link}`) : null,
            kind: kindField.value,
          };
          block.__dirty = true;
          this.render();
          this.commit("source", true);
          entry.close("saved");
        } }, "Save"),
      ],
    });
  },

  renderTranscript(block) {
    const segments = block.props?.segments || [];
    const node = el("div", { class: "transcript-block" });
    if (!segments.length) {
      append(node, el("div", { class: "transcript-empty", text: "Transcript will appear here while recording." }));
      return node;
    }
    for (const segment of segments) {
      append(node, el("div", { class: "transcript-line" },
        el("button", {
          class: "transcript-time", type: "button",
          onclick: () => this.onSeek?.(segment.start),
        }, formatTime(segment.start)),
        el("span", { class: "transcript-text", text: segment.text })));
    }
    return node;
  },

  renderChecklistHeader(block) {
    return el("div", { class: "checklist-header" },
      icon("check_square", 15),
      el("span", { text: block.props?.title || "Exam checklist" }));
  },

  /* ---- drag and drop ---- */

  bindDrag(handle, block, node) {
    let dropTarget = null;
    handle.addEventListener("dragstart", (event) => {
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", block.id);
      event.dataTransfer.setDragImage(node, 10, 10);
      node.classList.add("dragging");
    });
    handle.addEventListener("dragend", () => {
      node.classList.remove("dragging");
      this.dropIndicator?.remove();
      this.dropIndicator = null;
      if (dropTarget) this.moveBlock(block.id, dropTarget.id, dropTarget.placement);
      dropTarget = null;
    });
    if (this.dragBound) return;
    this.dragBound = true;
    this.container.addEventListener("dragover", (event) => {
      event.preventDefault();
      const target = event.target.closest?.(".block");
      if (!target) return;
      const rect = target.getBoundingClientRect();
      const placement = event.clientY < rect.top + rect.height / 2 ? "before" : "after";
      dropTarget = { id: target.dataset.block, placement };
      this.showDrop(target, placement);
    });
    this.container.addEventListener("drop", (event) => event.preventDefault());
  },

  showDrop(target, placement) {
    this.dropIndicator ||= el("div", { class: "block-drop" });
    const rect = target.getBoundingClientRect();
    const host = this.container.getBoundingClientRect();
    Object.assign(this.dropIndicator.style, {
      top: `${(placement === "before" ? rect.top : rect.bottom) - host.top - 1}px`,
      left: "0px",
      right: "0px",
    });
    this.container.style.position = "relative";
    this.container.append(this.dropIndicator);
  },

  /* ---- AI ---- */

  openAiComposer(block, options = {}) {
    runAiComposer({ editor: this, block, ...options });
  },


  generateFrom(block, kind) {
    this.onGenerate?.(kind, { pageId: this.page.id, blockIds: [block.id] });
  },
});

export function youtubeEmbed(url) {
  const match = String(url).match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([\w-]{6,})/);
  return match ? `https://www.youtube-nocookie.com/embed/${match[1]}` : null;
}

export const formatBytes = (bytes) => {
  const units = ["B", "KB", "MB", "GB"];
  let value = Number(bytes) || 0;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit += 1; }
  return `${value < 10 && unit ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
};

export const formatTime = (seconds) => {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  const minutes = Math.floor(total / 60);
  const hours = Math.floor(minutes / 60);
  const pad = (value) => String(value).padStart(2, "0");
  return hours ? `${hours}:${pad(minutes % 60)}:${pad(total % 60)}` : `${minutes}:${pad(total % 60)}`;
};

/* Uploads stay inside the workspace: the file is written next to the
   database so notes and their attachments back up together. */
export async function uploadFile(file) {
  const MAX = 25 * 1024 * 1024;
  if (file.size > MAX) throw new Error(`${file.name} is larger than the 25 MB limit.`);
  const response = await fetch(`/api/notes/upload?name=${encodeURIComponent(file.name)}&type=${encodeURIComponent(file.type || "")}`, {
    method: "POST",
    headers: { "Content-Type": "application/octet-stream" },
    body: file,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.error) throw new Error(payload.error || "Upload failed");
  return payload;
}

/* Code editing: highlighting on every keystroke, bracket pairing, and an
   inline completion list. The line stays a plain contenteditable — the text
   is re-rendered and the caret restored by character offset, which keeps
   undo, selection and IME working the way they do everywhere else. */
Object.assign(Editor.prototype, {
  codeText(line) {
    /* innerText collapses the trailing newline the browser keeps in a
       contenteditable; textContent preserves the code exactly. */
    return line.textContent;
  },

  repaintCode(block, line, caret) {
    line.innerHTML = highlight(this.codeText(line), block.props?.language || "plain");
    if (caret !== undefined) setCaret(line, caret);
  },

  setCodeText(block, line, text, caret) {
    block.text = plain(text);
    line.innerHTML = highlight(text, block.props?.language || "plain");
    setCaret(line, caret);
    this.commit("code");
  },

  onCodeInput(block, line) {
    const caret = caretOffset(line);
    block.text = plain(this.codeText(line));
    this.repaintCode(block, line, caret);
    this.commit("code");
    this.showCompletions(block, line);
  },

  onCodeKeyDown(event, block, line) {
    if (this.readOnly) return;
    if (this.completionsOpen && this.handleCompletionKey(event, block, line)) return;

    if (modKey(event) && !event.shiftKey && event.key.toLowerCase() === "z") { event.preventDefault(); this.undo(); return; }
    if (modKey(event) && (event.key.toLowerCase() === "y" || (event.shiftKey && event.key.toLowerCase() === "z"))) { event.preventDefault(); this.redo(); return; }
    if (event.key === "Escape") { event.preventDefault(); this.closeCompletions(); line.blur(); return; }

    const range = selectionRangeIn(line);
    const text = this.codeText(line);
    const caret = range ? range.start : caretOffset(line);
    const end = range ? range.end : caret;

    if (event.key === "Tab") {
      event.preventDefault();
      const unit = "  ";
      if (event.shiftKey) {
        const lineStart = text.lastIndexOf("\n", caret - 1) + 1;
        if (text.startsWith(unit, lineStart)) {
          this.setCodeText(block, line, text.slice(0, lineStart) + text.slice(lineStart + unit.length), Math.max(lineStart, caret - unit.length));
        }
        return;
      }
      this.setCodeText(block, line, text.slice(0, caret) + unit + text.slice(end), caret + unit.length);
      return;
    }

    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      const next = handleNewline(text.slice(0, caret) + text.slice(end), caret);
      this.setCodeText(block, line, next.text, next.caret);
      return;
    }

    const paired = handlePairs(text, caret, event.key, end);
    if (paired) {
      event.preventDefault();
      this.setCodeText(block, line, paired.text, paired.caret);
      return;
    }
    if (event.key === "Backspace") {
      const removed = handlePairs(text, caret, "Backspace", end);
      if (removed) { event.preventDefault(); this.setCodeText(block, line, removed.text, removed.caret); }
    }
  },

  showCompletions(block, line) {
    const caret = caretOffset(line);
    const text = this.codeText(line);
    const { prefix, items } = completionsFor(text, caret, block.props?.language || "plain");
    /* An empty prefix is the bare-dot case — "items." has members to offer
       even though nothing has been typed after the dot yet. */
    if (!items.length) { this.closeCompletions(); return; }
    this.completionState = { block, line, prefix, items, index: 0, caret };

    if (!this.completionsOpen) {
      this.completionsNode = el("div", { class: "code-completions", role: "listbox" });
      document.getElementById("layers").append(this.completionsNode);
      this.completionsOpen = true;
    }
    clear(this.completionsNode);
    items.forEach((item, index) => {
      this.completionsNode.append(el("button", {
        class: `completion${index === 0 ? " active" : ""}`, type: "button", role: "option",
        onmousedown: (event) => { event.preventDefault(); this.applyCompletion(index); },
      },
        el("span", { class: `completion-kind ${item.kind}` }, icon(`kind_${item.kind}`, 13)),
        el("span", { class: "completion-label", text: item.label }),
        el("span", { class: "completion-detail", text: item.detail || item.kind })));
    });
    const selection = window.getSelection();
    const rect = selection?.rangeCount ? selection.getRangeAt(0).getBoundingClientRect() : line.getBoundingClientRect();
    position(this.completionsNode, rect.width || rect.height ? rect : line.getBoundingClientRect(), { gap: 6 });
  },

  closeCompletions() {
    if (!this.completionsOpen) return;
    this.completionsNode?.remove();
    this.completionsOpen = false;
    this.completionState = null;
  },

  handleCompletionKey(event, block, line) {
    const state_ = this.completionState;
    if (!state_) return false;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      state_.index = (state_.index + step + state_.items.length) % state_.items.length;
      [...this.completionsNode.children].forEach((node, index) => node.classList.toggle("active", index === state_.index));
      this.completionsNode.children[state_.index]?.scrollIntoView({ block: "nearest" });
      return true;
    }
    if (event.key === "Enter" || event.key === "Tab") { event.preventDefault(); this.applyCompletion(state_.index); return true; }
    if (event.key === "Escape") { event.preventDefault(); this.closeCompletions(); return true; }
    return false;
  },

  applyCompletion(index) {
    const state_ = this.completionState;
    if (!state_) return;
    const item = state_.items[index];
    const { block, line, prefix, caret } = state_;
    const text = this.codeText(line);
    const start = caret - prefix.length;
    /* `${}` marks where the caret belongs; a snippet without one simply
       leaves the caret after what it inserted. */
    const marker = item.insert.indexOf("${}");
    const body = marker === -1 ? item.insert : item.insert.replace("${}", "");
    /* A multi-line snippet keeps the indentation of the line it lands on. */
    const lineStart = text.lastIndexOf("\n", start - 1) + 1;
    const indent = (text.slice(lineStart, start).match(/^[ \t]*/) || [""])[0];
    const indented = body.replace(/\n/g, `\n${indent}`);
    const next = text.slice(0, start) + indented + text.slice(caret);
    const position_ = marker === -1 ? start + indented.length : start + marker;
    this.closeCompletions();
    this.setCodeText(block, line, next, position_);
  },
});
