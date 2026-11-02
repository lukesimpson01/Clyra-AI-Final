/* The block editor.

   Blocks are the model; the DOM is rebuilt from them by a keyed reconcile.
   Typing mutates a block's spans in place and never re-renders, so the caret
   and IME composition are the browser's to manage. Structural edits change
   the model, re-render, and then place the caret explicitly. */
import { el, clear, icon, iconButton, tooltip, menu, modal, toast, confirmDialog, position, modKey, mod, append } from "./dom.js";
import { DatabaseView } from "./database.js";
import { Brainstorm } from "./brainstorm.js";
import { promptDialog } from "./slash-extras.js";
import { renderMarkdown } from "./ai-composer.js";
import { executeBlock, isExecutable, isPreviewable, runnerLabel } from "./runner.js";
import { detectCodeLanguage, solveMath, evaluateMathFunction } from "./smart-input.js";
import {
  insertSpans, renderSpans, readSpans, plain, spansText, spansLength, sliceSpans, applyMark,
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
import { api } from "./api.js";
import { prefOn } from "./preferences.js";

export const newBlockId = () =>
  `b${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

export const makeBlock = (type = "text", text = [], props = {}) =>
  ({ id: newBlockId(), type, text, props, children: [] });

const isTextBlock = (block) => TEXT_BLOCKS.has(block.type);

/* Props are per-type, so converting a block keeps only what the new type
   understands — otherwise a to-do turned into a quote stays "checked". */
const KEEP_PROPS = { todo: ["checked"], code: ["language"], callout: ["icon", "color"], html: ["code"], database: ["pageId"], link_to_page: ["pageId"], brainstorm: ["board"] };
function propsFor(type, props = {}) {
  const keep = KEEP_PROPS[type] || [];
  const next = {};
  for (const key of keep) if (props[key] !== undefined) next[key] = props[key];
  /* text and background colour belong to the block, whatever it becomes */
  for (const key of ["tc", "bg"]) if (props[key] && props[key] !== "default") next[key] = props[key];
  if (type.startsWith("toggle") && props.collapsed !== undefined) next.collapsed = props.collapsed;
  if (type === "todo" && next.checked === undefined) next.checked = false;
  if (type === "code" && next.language === undefined) next.language = "plain";
  if (type === "callout" && next.icon === undefined) next.icon = "💡";
  if (type === "chart") Object.assign(next, {
    kind: "cartesian", title: "Untitled graph", xLabel: "x", yLabel: "y",
    color: "#6e7bf2", gridColor: "#d8dbe5", axisColor: "#606776",
    xMin: -10, xMax: 10, yMin: -10, yMax: 10, dataSourceId: null,
    function: "",
    data: [{ x: -6, y: 3 }, { x: -3, y: -1 }, { x: 0, y: 2 }, { x: 3, y: 1 }, { x: 6, y: 5 }],
    ...props,
  });
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
    this.lastColourCategory = null;
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
    this.ensureTrailingLine();
    this.reconcile(this.container, this.blocks, null);
    for (const [id, node] of [...this.nodes]) {
      if (!node.isConnected) this.nodes.delete(id);
    }
    // Browsers are allowed to leave a <br> inside an empty contenteditable.
    // Keep the empty state as explicit data rather than relying on :empty so
    // the new-page "Press space" hint remains visible after focus changes,
    // undo and newly-created page hydration.
    this.refreshPlaceholders();
    if (focus) this.focus(focus.id, focus.offset);
    this.updateSelectionStyles();
  }

  /* A document that ends in a table, an image or a divider has nowhere to
     put the caret, so clicking below it or arrowing past it does nothing.
     One trailing paragraph fixes that for every void block at once. The
     change is local until the next edit commits it. */
  ensureTrailingLine() {
    if (this.readOnly) return;
    const last = this.blocks[this.blocks.length - 1];
    if (last && !isTextBlock(last)) this.blocks.push(makeBlock());
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
      if (block.type === "bulleted") node.dataset.listStyle = block.props?.listStyle || "bullet";
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
    if (block.props?.tc) node.dataset.tc = block.props.tc;
    if (block.props?.bg) node.dataset.bg = block.props.bg;
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
    if (block.type === "chart") { append(content, this.renderChart(block)); return { leading }; }
    if (block.type === "database") { append(content, this.renderDatabaseBlock(block)); return { leading }; }
    if (block.type === "html") { append(content, this.renderHtmlBlock(block)); return { leading }; }
    if (block.type === "brainstorm") { append(content, this.renderBrainstormBlock(block)); return { leading }; }
    if (block.type === "button") { append(content, this.renderButtonBlock(block)); return { leading }; }
    if (block.type === "ai_block") { append(content, this.renderAiBlock(block)); return { leading }; }
    if (block.type === "tabs") {
      const bar = el("div", { class: "tabs-bar", role: "tablist" });
      const host = el("div", { class: "tabs-host" });
      const wrap = el("div", { class: "tabs-block", "data-active": String(block.props?.active || 0) }, bar, host);
      this.paintTabsBar(block, bar, wrap);
      append(content, wrap);
      node.__childrenHost = host;
      return { leading };
    }
    if (block.type === "tab") {
      const pane = el("div", { class: "tab-pane" });
      append(content, pane);
      node.__childrenHost = pane;
      return { leading };
    }
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
            "play",
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
      const wrapper = el("div", { class: "equation-block" }, line, this.buildSmartAnswer(block));
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

    /* Plain paragraphs keep the deterministic math result on the same visual
       row as the caret. Other text-bearing blocks retain the quieter
       block-level annotation used by equations and study panels. */
    append(content, line, block.type === "text" ? this.buildSmartInlineAnswer(block) : this.buildSmartAnswer(block));
    return { leading };
  }

  /* A calculation is presented as a local result rather than silently
     changing the student's notes. It updates as they type and can be copied
     with one press. There is no AI/network path behind this UI. */
  buildSmartAnswer(block) {
    if (block.type === "code" || !prefOn("smartMath")) return null;
    const result = solveMath(spansText(block.text));
    const answer = el("div", { class: "smart-answer", hidden: !result, "aria-live": "polite" });
    answer.__blockId = block.id;
    if (result) this.paintSmartAnswer(answer, result);
    return answer;
  }

  buildSmartInlineAnswer(block) {
    if (!prefOn("smartMath")) return null;
    const result = solveMath(spansText(block.text));
    const answer = el("span", {
      class: "smart-inline-answer", hidden: !result, "aria-live": "polite",
      title: "Press Tab to insert this local result",
    });
    answer.__blockId = block.id;
    if (result) this.paintSmartInlineAnswer(answer, result);
    return answer;
  }

  paintSmartInlineAnswer(node, result) {
    clear(node);
    if (!result) { node.hidden = true; return; }
    node.hidden = false;
    append(node,
      icon("equation", 12),
      el("strong", { text: result.answer }),
      el("span", { class: "smart-inline-hint", text: "Tab to insert" }),
    );
  }

  paintSmartAnswer(node, result) {
    clear(node);
    if (!result) { node.hidden = true; return; }
    node.hidden = false;
    append(node,
      icon("equation", 13),
      el("span", { class: "smart-answer-label", text: result.kind === "equation" ? "Solved locally" : "Answer" }),
      el("strong", { text: result.answer }),
      iconButton("copy", "Copy answer", () => navigator.clipboard.writeText(result.answer).then(() => toast("Answer copied")), { size: 13, className: "smart-answer-copy" }),
    );
  }

  updateSmartAnswer(block) {
    const host = this.nodes.get(block.id);
    const result = solveMath(spansText(block.text));
    const inline = host?.querySelector(".smart-inline-answer");
    if (inline) this.paintSmartInlineAnswer(inline, result);
    const node = host?.querySelector(".smart-answer");
    if (node) this.paintSmartAnswer(node, result);
  }

  acceptSmartSuggestion(block, line) {
    const result = solveMath(spansText(block.text));
    if (!result) return false;
    this.push();
    const current = spansText(block.text).trimEnd();
    const separator = current.includes("=") ? "  → " : "  = ";
    const nextText = `${current}${separator}${result.answer}`;
    block.text = plain(nextText);
    this.paint(line, block);
    this.focus(block.id, nextText.length);
    this.updateSmartAnswer(block);
    this.commit("smart-answer");
    return true;
  }

  buildLine(block) {
    const line = el("div", {
      class: "text-line",
      contenteditable: this.readOnly ? "false" : "true",
      spellcheck: block.type === "code" || !prefOn("spellcheck") ? "false" : "true",
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
    this.updatePlaceholder(line, block);
  }

  firstEmptyId() {
    const first = this.blocks[0];
    return this.blocks.length === 1 && first && isTextBlock(first) && !spansLength(first.text) ? first.id : null;
  }

  updatePlaceholder(line, block) {
    if (!line || block.type === "code") return;
    const isFreshPageLine = block.id === this.firstEmptyId();
    line.dataset.placeholder = isFreshPageLine
      ? "Press 'space' for AI, '/' for commands"
      : PLACEHOLDERS[block.type] ?? "";
    if (isFreshPageLine && !spansLength(block.text)) line.dataset.empty = "true";
    else delete line.dataset.empty;
  }

  refreshPlaceholders() {
    for (const { block } of this.flat()) this.updatePlaceholder(this.lineOf(block.id), block);
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
    this.updatePlaceholder(line, block);
    if (this.replaceArrowShorthand(block, line)) {
      this.commit("type");
      return;
    }
    if (prefOn("markdownShortcuts") && this.applyMarkdown(block, line)) return;
    if (block.type === "text" && prefOn("codeDetection")) {
      const language = detectCodeLanguage(spansText(block.text));
      if (language) {
        this.push();
        block.type = "code";
        block.props = propsFor("code", { ...block.props, language });
        block.__dirty = true;
        this.render({ id: block.id, offset: "end" });
        this.commit("detected-code", true);
        return;
      }
    }
    this.checkSlash(block, line);
    this.checkMention(block, line);
    this.updateSmartAnswer(block);
    this.commit("type");
  }

  /* A small writing aid, not a markdown mode: swap the two-character arrows
     only at the caret, keep the surrounding span's formatting, and repaint
     once. That lets a student use -> / <- in prose without turning ordinary
     hyphens or code into a surprise transformation. */
  replaceArrowShorthand(block, line) {
    if (block.type === "code") return false;
    const caret = caretOffset(line);
    if (caret < 2) return false;
    const typed = spansText(block.text).slice(caret - 2, caret);
    const replacement = typed === "->" ? "→" : typed === "<-" ? "←" : null;
    if (!replacement) return false;
    const source = sliceSpans(block.text, caret - 1, caret)[0] || {};
    block.text = replaceRange(block.text, caret - 2, caret, [{ ...source, t: replacement }]);
    this.paint(line, block);
    setCaret(line, caret - 1);
    return true;
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

  /* "@" opens a small menu to mention a page or a date, as in Notion. The mention is a span in the text, so it moves with
     the words around it and a page mention follows the page's title. */
  checkMention(block, line) {
    if (this.slashOpen || this.mentionOpen || block.type === "code" || block.type === "equation") return;
    const offset = caretOffset(line);
    const text = spansText(block.text).slice(0, offset);
    if (!text.endsWith("@") || (text.length > 1 && !/\s/.test(text[text.length - 2]))) return;
    this.openMention(block, line, offset);
  }

  /* Slash commands "Mention a page" and "Date or reminder" start the same menu by typing the "@" for you. */
  startMention(block) {
    const line = this.nodes.get(block.id)?.querySelector(".text-line");
    if (!line) return;
    line.focus();
    const at = caretOffset(line);
    block.text = insertSpans(block.text, at, [{ t: "@" }]);
    this.paint(line, block);
    setCaret(line, at + 1);
    this.openMention(block, line, at + 1);
  }

  openMention(block, line, offset) {
    if (this.mentionOpen) return;
    this.mentionOpen = true;
    const insert = (span) => {
      this.push();
      block.text = replaceRange(block.text, offset - 1, offset, [span, { t: " " }]);
      this.paint(line, block);
      this.focus(block.id, offset + 1);
      this.commit("mention", true);
    };
    const fmt = (date) => date.toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" });
    const iso = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    const dayItem = (label, delta) => {
      const date = new Date(); date.setDate(date.getDate() + delta);
      return { label, icon: "calendar", hint: fmt(date), keywords: "date day", onSelect: () => insert({ t: fmt(date), date: iso(date) }) };
    };
    const pages = [...state.pages].filter((page) => page.kind !== "record" && String(page.id) !== String(this.page.id))
      .sort((a, b) => String(b.updated_at || "").localeCompare(String(a.updated_at || ""))).slice(0, 500);
    menu(line, [
      { type: "label", label: "Dates" },
      dayItem("Today", 0), dayItem("Tomorrow", 1), dayItem("Yesterday", -1),
      { label: "Pick a date\u2026", icon: "calendar", keywords: "date calendar", onSelect: () => {
        const input = el("input", { class: "extras-input", type: "date", "aria-label": "Date" });
        const save = el("button", { class: "button primary", type: "button" }, "Insert");
        const cancel = el("button", { class: "button", type: "button" }, "Cancel");
        const entry = modal({ title: "Mention a date", width: 360, body: el("div", { class: "extras-body" }, input), footer: [cancel, save] });
        cancel.addEventListener("click", () => entry.close("cancel"));
        save.addEventListener("click", () => { if (!input.value) return; const date = new Date(`${input.value}T00:00:00`); entry.close("save"); insert({ t: fmt(date), date: input.value }); });
      } },
      { type: "label", label: "Pages" },
      ...pages.map((page) => ({ label: page.title || "Untitled", icon: page.kind === "database" ? "table" : "page", keywords: "page link mention", onSelect: () => insert({ t: page.title || "Untitled", page: String(page.id) }) })),
    ], { search: true, searchPlaceholder: "Mention a page or date\u2026", class: "mention-menu", onClose: () => { this.mentionOpen = false; } });
  }

  checkSlash(block, line) {
    if (this.slashOpen) return;
    const offset = caretOffset(line);
    const text = spansText(block.text).slice(0, offset);
    if (!text.endsWith("/")) return;
    const beforeSlash = text.slice(0, -1).trim();
    const mathBeforeSlash = beforeSlash.replace(/^(?:what\s+is|calculate|compute|evaluate|solve|find\s+(?:the\s+)?(?:value|root|roots|solution|solutions)\s+of)\s+/i, "");
    /* In a formula `/` is an operator, not a command trigger. Give the
       writer an explicit choice so a command can still be reached without
       making ordinary fractions or `2/3` feel broken. */
    const equationContext = block.type === "equation"
      || (mathBeforeSlash && /[\dxyπ)]/i.test(mathBeforeSlash) && /^[\dxyπ\s()+\-*^%./]+$/i.test(mathBeforeSlash));
    if (equationContext) {
      this.openEquationSlashChoice(block, line, offset);
      return;
    }
    this.openSlash(block, line, offset);
  }

  openEquationSlashChoice(block, line, triggerOffset) {
    this.slashOpen = true;
    let entry;
    entry = menu(line, [
      {
        label: "Continue as division", icon: "equation", hint: "keep / and type a denominator",
        onSelect: () => { line.focus(); setCaret(line, triggerOffset); },
      },
      {
        label: "Open command palette", icon: "list", hint: "use / for blocks instead",
        onSelect: () => this.openSlash(block, line, triggerOffset),
      },
    ], {
      class: "equation-slash-menu",
      onClose: () => { this.slashOpen = false; },
    });
    /* The menu owns focus while open; returning focus after a division choice
       makes the next denominator character land exactly after `/`. */
    return entry;
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
      this.updatePlaceholder(line, block);
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
    if (modKey(event) && event.shiftKey && event.key.toLowerCase() === "h" && selection && !selection.collapsed && this.lastColourCategory) {
      event.preventDefault(); this.applySmartHighlight(block, line, this.lastColourCategory); return;
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
      if (block.type === "text" && this.acceptSmartSuggestion(block, line)) {
        event.preventDefault();
        return;
      }
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
      if (this.moveCaretOut(block, -1)) event.preventDefault();
      return;
    }
    if (event.key === "ArrowDown" && selection?.collapsed && !line.textContent.slice(offset).includes("\n")) {
      if (this.moveCaretOut(block, 1)) event.preventDefault();
    }
  }

  splitBlock(block, line, offset) {
    this.push();
    const text = spansText(block.text);
    if (LIST_BLOCKS.has(block.type) && !text.length) { this.outdentOrPlain(block); return; }
    const head = sliceSpans(block.text, 0, offset);
    const tail = sliceSpans(block.text, offset, spansLength(block.text));
    block.text = head;
    /* The head keeps its DOM node unless it is rebuilt: without this, pressing Enter at the very start of a line left the
       old text showing in the upper block while the same text was also moved into the new one, so it looked duplicated. */
    block.__dirty = true;
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
    if (block.type === "code" && !spansLength(block.text)) {
      this.push();
      const previous = this.previousTextBlock(block);
      const next = this.nextTextBlock(block);
      this.removeBlock(block.id);
      if (!this.blocks.length) this.blocks.push(makeBlock());
      const target = previous || next || this.blocks[0];
      this.render({ id: target.id, offset: previous ? "end" : 0 });
      this.commit("delete-empty-code", true);
      return;
    }
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
    /* The block immediately above may carry no text — an image, a table, a
       divider. Merging with the paragraph beyond it would jump straight over
       it and destroy the wrong thing, so the first Backspace selects it and
       the second removes it. */
    const before = this.previousBlock(block);
    if (before && !isTextBlock(before)) {
      if (!spansLength(block.text)) {
        this.push();
        this.removeBlock(block.id);
        if (!this.blocks.length) this.blocks.push(makeBlock());
        this.render();
        this.commit("delete", true);
      }
      this.selectOnly(before.id);
      return;
    }
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

  /* Visual order including the blocks that carry no text. The children of a
     collapsed toggle are not in it: the caret must never land somewhere the
     reader cannot see. */
  visibleOrder(list = this.blocks, out = []) {
    for (const block of list) {
      out.push(block);
      if (block.type.startsWith("toggle") && block.props?.collapsed) continue;
      this.visibleOrder(block.children || [], out);
    }
    return out;
  }

  previousBlock(block) {
    const order = this.visibleOrder();
    return order[order.indexOf(block) - 1] || null;
  }

  nextBlock(block) {
    const order = this.visibleOrder();
    return order[order.indexOf(block) + 1] || null;
  }

  /* Arrowing out of a text line lands on whatever is actually adjacent,
     block or not. Stepping straight to the next *text* line is what made a
     table, an image or a divider impossible to reach with the keyboard —
     and therefore impossible to select, move or delete without the mouse.
     Returns true when it moved, so the caller only swallows the key then. */
  moveCaretOut(block, direction) {
    const target = direction < 0 ? this.previousBlock(block) : this.nextBlock(block);
    if (!target) {
      /* Arrowing down past the last block gives you a line to write on
         instead of doing nothing, which is what keeps a note that ends in a
         table from being a dead end. */
      if (direction > 0 && !this.readOnly && !isTextBlock(block)) {
        const trailing = this.appendBlock(makeBlock());
        this.focus(trailing.id, 0);
        return true;
      }
      return false;
    }
    if (isTextBlock(target)) { this.focus(target.id, direction < 0 ? "end" : 0); return true; }
    this.selectOnly(target.id);
    return true;
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

  /* Shared by slash commands that insert a non-text block. Keeping this
     factory on the editor guarantees the follow-up paragraph has the same
     model shape and focus behaviour as a normal Enter-created block. */
  blank() { return makeBlock(); }

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

  applyColor(block, line, { color, background, colorHex, backgroundHex }) {
    const range = selectionRangeIn(line);
    if (!range || range.collapsed) return;
    this.push();
    if (color !== undefined || colorHex !== undefined) {
      const token = colorHex ? "custom" : color === "default" ? null : color;
      block.text = applyMark(block.text, range.start, range.end, "col", token);
      block.text = applyMark(block.text, range.start, range.end, "colHex", colorHex || null);
    }
    if (background !== undefined || backgroundHex !== undefined) {
      const token = backgroundHex ? "custom" : background === "default" ? null : background;
      block.text = applyMark(block.text, range.start, range.end, "bg", token);
      block.text = applyMark(block.text, range.start, range.end, "bgHex", backgroundHex || null);
    }
    this.paint(line, block);
    setCaretRange(line, range.start, range.end);
    this.commit("color", true);
  }

  applyTextStyle(block, line, patch) {
    const range = selectionRangeIn(line);
    if (!range || range.collapsed) return;
    this.push();
    for (const [key, value] of Object.entries(patch)) block.text = applyMark(block.text, range.start, range.end, key, value || null);
    this.paint(line, block); setCaretRange(line, range.start, range.end); this.commit("text-style", true);
  }

  applySmartHighlight(block, line, category, savedRange) {
    const range = savedRange || selectionRangeIn(line);
    if (!range || range.collapsed) return;
    this.push();
    const stamp = new Date().toISOString();
    const id = `hl-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
    for (const [key, value] of Object.entries({
      bg: "custom", bgHex: category.colour, categoryId: category.categoryId,
      highlightId: id, highlightCreatedAt: stamp,
    })) block.text = applyMark(block.text, range.start, range.end, key, value);
    this.paint(line, block);
    setCaretRange(line, range.start, range.end);
    this.commit("smart-highlight", true);
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

  /* Used by every block that has no text line of its own: it takes the
     keyboard away from whatever had it, so Delete lands on the block. */
  selectOnly(id) {
    document.activeElement?.blur?.();
    this.selection = new Set([id]);
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
    if (this.onDocumentKey) document.removeEventListener("keydown", this.onDocumentKey);
  }

  commit(reason, structural = false) {
    if (this.readOnly) return;
    if (!structural && reason === "type") this.pushDebounced();
    queueBlockSave(this.page.id, serializeTree(this.blocks));
    this.page.blocks = this.blocks;
    this.onChange?.(reason);
    if (structural || reason === "type" || reason === "table") this.refreshDependentBlocks();
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
    this.refreshChartBlocks();
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
    const chart = body.match(/^:::chart(?:\s+(\{.*\}))?$/i);
    if (chart) {
      while (index < lines.length && lines[index].trim() !== ":::") index += 1;
      if (index < lines.length) index += 1;
      let props = {};
      try { props = chart[1] ? JSON.parse(chart[1]) : {}; } catch { /* defaults are applied by the editor */ }
      out.push({ type: "chart", text: [], props });
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
  /* Right-click: one menu with what a block can do, in the order Notion people expect — clipboard first, then the block,
     then Clyra. Selected text adds its own formatting and "Add to chat" / "Ask Clyra" rows. */
  openContextMenu(event) {
    if (this.readOnly) return;
    const node = event.target.closest?.(".block");
    const block = node?.__block;
    if (!block) return;
    event.preventDefault();
    const selection = window.getSelection();
    const selectedText = selection && !selection.isCollapsed ? selection.toString() : "";
    const line = this.lineOf(block.id);
    const anchor = new DOMRect(event.clientX, event.clientY, 1, 1); // a rect, not an element: the menu opens at the pointer
    const textual = isTextBlock(block);
    const mark = (name) => () => { if (line) this.toggleMark(block, line, name); };
    const items = [
      selectedText ? { label: "Cut", icon: "duplicate", shortcut: `${mod}+X`, onSelect: () => { document.execCommand("cut"); } } : null,
      selectedText ? { label: "Copy", icon: "duplicate", shortcut: `${mod}+C`, onSelect: () => { document.execCommand("copy"); } } : null,
      { label: "Paste", icon: "duplicate", shortcut: `${mod}+V`, onSelect: async () => {
        try { const text = await navigator.clipboard.readText(); line?.focus(); document.execCommand("insertText", false, text); }
        catch { toast(`Press ${mod}+V to paste`); }
      } },
      { type: "separator" },
      selectedText ? { label: "Bold", icon: "bold", shortcut: `${mod}+B`, onSelect: mark("b") } : null,
      selectedText ? { label: "Italic", icon: "italic", shortcut: `${mod}+I`, onSelect: mark("i") } : null,
      selectedText ? { label: "Underline", icon: "underline", shortcut: `${mod}+U`, onSelect: mark("u") } : null,
      selectedText ? { label: "Strikethrough", icon: "strike", shortcut: `${mod}+Shift+S`, onSelect: mark("s") } : null,
      selectedText ? { label: "Code", icon: "code", shortcut: `${mod}+E`, onSelect: mark("c") } : null,
      selectedText ? { type: "separator" } : null,
      textual ? { label: "Turn into", icon: "refresh", onSelect: () => this.turnIntoMenu(block, anchor) } : null,
      { label: "Duplicate", icon: "duplicate", shortcut: `${mod}+D`, onSelect: () => this.duplicateBlock(block) },
      { label: "Insert block below", icon: "plus", onSelect: () => { const fresh = this.blank(); this.insertAfter(block, fresh); this.render({ id: fresh.id, offset: 0 }); this.commit("insert", true); } },
      { label: "Copy link to block", icon: "link", onSelect: () => { navigator.clipboard.writeText(`${location.origin}/notes#${this.page.id}:${block.id}`); toast("Block link copied"); } },
      { label: "Move up", icon: "chevron_right", onSelect: () => this.shift(block, -1) },
      { label: "Move down", icon: "chevron_right", onSelect: () => this.shift(block, 1) },
      { type: "separator" },
      state.aiConfigured && selectedText ? { label: "Add to chat", icon: "comment", onSelect: () => this.onAskClyra?.(selectedText, "add") } : null,
      state.aiConfigured && selectedText ? { label: "Ask Clyra", icon: "sparkle", onSelect: () => this.onAskClyra?.(selectedText, "ask") } : null,
      state.aiConfigured ? { label: "Ask AI about this", icon: "sparkle", onSelect: () => this.openAiComposer(block, { seedText: spansText(block.text) }) } : null,
      state.aiConfigured ? { label: "Generate flashcards", icon: "cards", onSelect: () => this.generateFrom(block, "flashcards") } : null,
      state.aiConfigured ? { label: "Generate questions", icon: "check_square", onSelect: () => this.generateFrom(block, "questions") } : null,
      { type: "separator" },
      { label: "Delete", icon: "trash", shortcut: "Del", danger: true, onSelect: () => this.deleteBlocks([block.id]) },
    ].filter(Boolean);
    menu(anchor, items, { align: "start" });
  },

  bindGlobal() {
    this.container.addEventListener("contextmenu", (event) => this.openContextMenu(event));
    this.container.addEventListener("mousedown", (event) => {
      if (event.target.closest(".text-line, .block-gutter, button, a, input, select, textarea, [contenteditable='true']")) return;
      /* A table, a chart or an image has no text line, so clicking its body
         is the only way to give it the keyboard. Selecting it here is what
         makes Backspace and Delete able to remove it at all. */
      const node = event.target.closest?.(".block");
      const block = node?.__block;
      if (block && !isTextBlock(block)) { this.selectOnly(block.id); return; }
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
    /* Keys that have to work when nothing holds the caret: a table, a chart
       or an image has no text line, so Delete on a selected block and undo
       after a table edit would otherwise never reach the editor. Bound on the
       document, and gated on this editor being the visible one. */
    this.onDocumentKey = (event) => {
      if (this.readOnly || !this.host.isConnected || this.host.offsetParent === null) return;
      const target = event.target;
      if (target instanceof HTMLElement
        && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))) return;
      const key = event.key.toLowerCase();
      if (modKey(event) && key === "z") {
        event.preventDefault();
        event.shiftKey ? this.redo() : this.undo();
        return;
      }
      if (modKey(event) && key === "y") { event.preventDefault(); this.redo(); return; }
      if (!this.selection.size) return;
      if (event.key === "Escape") { this.clearSelection(); return; }

      /* A selected block is a cursor position of its own: the arrows walk
         out of it, Enter opens a line under it, and Backspace removes it.
         Without these three a table could be reached but never left. */
      const single = this.selection.size === 1 ? this.find([...this.selection][0])?.block : null;
      if (single && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
        event.preventDefault();
        this.clearSelection();
        if (!this.moveCaretOut(single, event.key === "ArrowDown" ? 1 : -1)) this.selectOnly(single.id);
        return;
      }
      if (single && event.key === "Enter") {
        event.preventDefault();
        this.clearSelection();
        const created = this.insertAfter(single, makeBlock());
        this.focus(created.id, 0);
        return;
      }
      if (event.key !== "Backspace" && event.key !== "Delete") return;
      event.preventDefault();
      this.deleteBlocks([...this.selection]);
    };
    document.addEventListener("keydown", this.onDocumentKey);
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
    const text = spansText(block.text || []);
    const words = text.trim() ? text.trim().split(/\s+/).length : 0;
    const textual = isTextBlock(block);
    const meta = getPageMeta(this.page?.id);
    const stamp = meta?.updated_at ? new Date(`${String(meta.updated_at).replace(" ", "T")}${/Z|\+/.test(String(meta.updated_at)) ? "" : "Z"}`) : null;
    const edited = stamp && !Number.isNaN(stamp.getTime()) ? stamp.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "just now";
    /* the order and grouping are Notion's: how it looks, then what you do with it, then what it can do for you */
    const entry = menu(anchor, [
      { type: "label", label: ids.length > 1 ? `${ids.length} blocks` : (BLOCK_TYPES[block.type]?.label || "Block") },
      textual && ids.length === 1 ? { label: "Turn into", icon: "refresh", onSelect: () => this.turnIntoMenu(block, anchor) } : null,
      textual ? { label: "Color", icon: "palette", onSelect: () => this.blockColorMenu(block, anchor, ids) } : null,
      block.type === "callout" ? { label: "Highlight colour", icon: "palette", onSelect: () => this.colorMenu(block, anchor) } : null,
      block.type === "bulleted" ? { label: "Bullet style", icon: "bullet", onSelect: () => this.bulletStyleMenu(block, anchor) } : null,
      { type: "separator" },
      { label: "Comment", icon: "comments", keywords: "discuss note reply", onSelect: () => this.onComment?.(block, spansText(block.text || [])) },
      { label: "Copy link to block", icon: "link", keywords: "share url", onSelect: () => { navigator.clipboard.writeText(`${location.origin}/notes#${this.page.id}:${block.id}`); toast("Block link copied"); } },
      { label: "Duplicate", icon: "duplicate", shortcut: `${mod}+D`, onSelect: () => this.duplicateBlock(block) },
      { label: "Move to", icon: "move", keywords: "another page transfer", onSelect: () => this.moveBlocksMenu(ids, anchor) },
      { label: "Move up", icon: "chevron_right", shortcut: "↑", keywords: "reorder", onSelect: () => this.shift(block, -1) },
      { label: "Move down", icon: "chevron_right", shortcut: "↓", keywords: "reorder", onSelect: () => this.shift(block, 1) },
      { label: "Delete", icon: "trash", shortcut: "Del", danger: true, onSelect: () => this.deleteBlocks(ids) },
      state.aiConfigured ? { type: "separator" } : null,
      state.aiConfigured ? { label: "Ask AI", icon: "sparkle", shortcut: `${mod}+J`, keywords: "explain rewrite summarise", onSelect: () => this.openAiComposer(block, { seedText: text }) } : null,
      state.aiConfigured ? { label: "Generate flashcards", icon: "cards", onSelect: () => this.generateFrom(block, "flashcards") } : null,
      state.aiConfigured ? { label: "Generate questions", icon: "check_square", onSelect: () => this.generateFrom(block, "questions") } : null,
      { type: "separator" },
      { type: "custom", render: () => el("div", { class: "menu-footer" },
        el("div", { class: "menu-footer-label", text: "Last edited" }),
        el("div", { text: edited }),
        textual ? el("div", { class: "menu-footer-muted", text: `${words} word${words === 1 ? "" : "s"}, ${text.length} character${text.length === 1 ? "" : "s"}` }) : null) },
    ].filter(Boolean), { search: true, searchPlaceholder: "Search actions…", onClose: () => node?.classList.remove("menu-open") });
    return entry;
  },

  /* Text and background colour for any text block, the way Notion's Color menu offers them. */
  blockColorMenu(block, anchor, ids = [block.id]) {
    const label = (c) => (c === "default" ? "Default" : c[0].toUpperCase() + c.slice(1));
    const targets = this.linear().filter((b) => ids.includes(b.id) && isTextBlock(b));
    const set = (key, value) => {
      this.push();
      for (const target of targets.length ? targets : [block]) {
        const props = { ...(target.props || {}) };
        if (value === "default") delete props[key]; else props[key] = value;
        target.props = props; target.__dirty = true;
      }
      this.render(); this.commit("block-color", true);
    };
    menu(anchor, [
      { type: "label", label: "Text colour" },
      ...COLORS.map((c) => ({ label: label(c), checked: (block.props?.tc || "default") === c, keywords: `text ${c}`,
        icon: el("span", { class: "tint-swatch tc", style: { color: c === "default" ? "var(--text-primary)" : `var(--c-${c})` }, text: "A" }), onSelect: () => set("tc", c) })),
      { type: "separator" },
      { type: "label", label: "Background colour" },
      ...COLORS.map((c) => ({ label: label(c), checked: (block.props?.bg || "default") === c, keywords: `background ${c}`,
        icon: el("span", { class: "tint-swatch", style: { background: c === "default" ? "var(--background-subtle)" : `var(--c-${c}-bg)` } }), onSelect: () => set("bg", c) })),
    ], { align: "start", search: true, searchPlaceholder: "Search colours…" });
  },

  /* Move blocks onto another page: they are copied there with fresh ids, then removed here, so a failed save loses nothing. */
  moveBlocksMenu(ids, anchor) {
    const here = String(this.page?.id);
    const items = state.pages.filter((p) => String(p.id) !== here && !p.locked && !p.sealed).slice(0, 400).map((p) => ({
      label: p.title || "New page", keywords: p.title || "", icon: p.icon && !/^https?:|^\//.test(p.icon) ? p.icon : "page",
      onSelect: () => this.moveBlocksToPage(ids, p),
    }));
    menu(anchor, items.length ? items : [{ label: "No other pages", disabled: true }], { align: "start", search: true, searchPlaceholder: "Move to a page…" });
  },

  async moveBlocksToPage(ids, target) {
    const chosen = this.linear().filter((b) => ids.includes(b.id));
    if (!chosen.length) return;
    try {
      const page = await api.get(`/api/notes/pages/${target.id}`);
      const existing = (page.blocks || []).map((b) => ({ id: b.id, type: b.type, text: b.text || [], props: b.props || {}, children: b.children || [] }));
      const moved = chosen.map((b) => cloneBlock(b));
      await api.put(`/api/notes/pages/${target.id}/blocks`, { blocks: [...existing, ...moved] });
    } catch {
      toast("Could not move that block");
      return;
    }
    this.deleteBlocks(ids);
    toast(`Moved to ${target.title || "New page"}`);
  },

  turnIntoMenu(block, anchor) {
    menu(anchor, TURN_INTO.map((type) => ({
      label: BLOCK_TYPES[type].label, icon: BLOCK_TYPES[type].icon,
      checked: block.type === type, keywords: BLOCK_TYPES[type].keywords,
      onSelect: () => this.turnInto(block, type),
    })), { search: true, searchPlaceholder: "Turn into…" });
  },

  /* This sets the callout's background tint, not a text colour — see the
     callout wrapper's render and the gating in blockMenu() above. The label
     and swatch icon match tableTintMenu()'s highlight picker rather than the
     inline toolbar's lettered text-colour swatches, so the two don't look
     like the same kind of control. */
  colorMenu(block, anchor) {
    menu(anchor, [
      { type: "label", label: "Highlight" },
      ...COLORS.map((color) => ({
        label: color === "default" ? "Default" : color[0].toUpperCase() + color.slice(1),
        checked: (block.props?.color || "default") === color,
        icon: el("span", { class: "tint-swatch", style: { background: color === "default" ? "var(--background-subtle)" : `var(--c-${color}-bg)` } }),
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

  /* The contents block is derived, never edited: it repaints from the page's
     headings on every structural change. Levels are normalised against the
     shallowest heading on the page, so a note written entirely in H2s still
     reads as a flush-left list rather than one indented by an invisible H1. */
  /* An inline database: the same views, filters and cells as a database page, in the middle of a document. The block holds
     only the id of the database's page; the records live there. */
  renderDatabaseBlock(block) {
    const host = el("div", { class: "db-embed" });
    const pageId = block.props?.pageId;
    if (!pageId) {
      host.append(el("div", { class: "db-embed-empty" }, icon("table", 16), el("span", { text: block.props?.dbIndex !== undefined ? "A database from this template appears here once the page is made." : "This database is not set up yet." })));
      return host;
    }
    new DatabaseView(host, { id: pageId }, { openPage: (id, options) => this.onNavigate?.(id, options) }, { embedded: true });
    return host;
  },

  /* Turn an empty line into 2 to 5 columns, each with a line to type in. Anything already typed stays in the first. */
  splitIntoColumns(block, count = 2) {
    this.push();
    const carried = block.text;
    block.type = "columns";
    block.text = [];
    block.props = {};
    block.children = Array.from({ length: count }, (_, index) => {
      const column = makeBlock("column");
      const line = makeBlock();
      if (index === 0 && carried?.length) line.text = carried;
      column.children = [line];
      return column;
    });
    block.__dirty = true;
    this.render({ id: block.children[0].children[0].id, offset: 0 });
    this.commit("columns", true);
  },

  /* A small piece of HTML, run in a sandbox so it can show a widget or a diagram but cannot reach the rest of the page. */
  renderHtmlBlock(block) {
    const wrap = el("div", { class: "html-block" });
    const code = block.props?.code ?? "";
    const frame = el("iframe", { class: "html-frame", title: "HTML", sandbox: "allow-scripts", loading: "lazy" });
    frame.srcdoc = code || "<p style=\"font:14px system-ui;color:#888\">Nothing here yet.</p>";
    const editor = el("textarea", { class: "html-code", rows: "7", spellcheck: "false", "aria-label": "HTML code", placeholder: "<h1>Hello</h1>" });
    editor.value = code;
    editor.hidden = Boolean(code);
    const toggle = el("button", { class: "html-toggle", type: "button" }, code ? "Edit" : "Preview");
    toggle.addEventListener("click", () => {
      editor.hidden = !editor.hidden;
      toggle.textContent = editor.hidden ? "Edit" : "Preview";
      if (editor.hidden) {
        block.props = { ...block.props, code: editor.value };
        frame.srcdoc = editor.value || frame.srcdoc;
        this.commit("html");
      } else editor.focus();
    });
    wrap.append(el("div", { class: "html-bar" }, el("span", { class: "html-label", text: "HTML" }), toggle), editor, frame);
    return wrap;
  },

  /* Tabs: a bar of titles over one pane at a time. Which pane shows is a data attribute on the block, so switching never
     rebuilds the panes or loses the caret in them. */
  paintTabsBar(block, bar, wrap) {
    clear(bar);
    const active = block.props?.active || 0;
    (block.children || []).forEach((tab, index) => {
      bar.append(el("button", {
        class: `tabs-tab${index === active ? " active" : ""}`, type: "button", role: "tab", "aria-selected": String(index === active),
        title: "Double-click to rename",
        onclick: () => { block.props = { ...block.props, active: index }; wrap.dataset.active = String(index); this.paintTabsBar(block, bar, wrap); this.commit("tabs"); },
        ondblclick: () => promptDialog({ title: "Rename tab", confirm: "Rename", fields: [{ label: "Name", value: tab.props?.title || "" }], onSubmit: ([title]) => { tab.props = { ...tab.props, title }; this.paintTabsBar(block, bar, wrap); this.commit("tabs"); } }),
      }, tab.props?.title || `Tab ${index + 1}`));
    });
    if (!this.readOnly) bar.append(iconButton("plus", "Add a tab", () => {
      this.push();
      const tab = makeBlock("tab");
      tab.props = { title: `Tab ${(block.children || []).length + 1}` };
      tab.children = [makeBlock()];
      block.children = [...(block.children || []), tab];
      block.props = { ...block.props, active: block.children.length - 1 };
      block.__dirty = true;
      this.render({ id: tab.children[0].id, offset: 0 });
      this.commit("tabs", true);
    }, { size: 14, className: "tabs-add" }));
  },

  insertTabs(block) {
    this.push();
    block.type = "tabs";
    block.text = [];
    block.props = { active: 0 };
    block.children = ["Tab 1", "Tab 2"].map((title) => { const tab = makeBlock("tab"); tab.props = { title }; tab.children = [makeBlock()]; return tab; });
    block.__dirty = true;
    this.render({ id: block.children[0].children[0].id, offset: 0 });
    this.commit("tabs", true);
  },

  /* Embeds for named services are the ordinary embed block, asked for the service's link straight away. */
  insertEmbed(block, provider) {
    this.turnInto(block, "embed");
    block.props = { ...block.props, provider };
    this.insertAfter(block, this.blank());
    setTimeout(() => this.mediaPrompt(block, null), 30);
  },

  /* A button adds its saved content below itself each time it is pressed. */
  renderButtonBlock(block) {
    const wrap = el("div", { class: "button-block" });
    wrap.append(el("button", { class: "notion-button", type: "button", onclick: () => this.pressButton(block) }, block.props?.label || "Button"));
    if (!this.readOnly) wrap.append(iconButton("pencil", "Edit button", () => promptDialog({
      title: "Edit button", confirm: "Save",
      fields: [{ label: "Label", value: block.props?.label || "" }, { label: "What it adds (markdown)", multiline: true, value: block.props?.content || "" }],
      onSubmit: ([label, content]) => { block.props = { ...block.props, label, content }; block.__dirty = true; this.render(); this.commit("button", true); },
    }), { size: 14, className: "button-edit" }));
    return wrap;
  },

  pressButton(block) {
    const drafts = parseMarkdownBlocks(block.props?.content || "");
    if (!drafts.length) { toast("This button has nothing to add yet"); return; }
    const blocks = drafts.map((draft) => ({ ...makeBlock(draft.type, draft.text, draft.props), children: [] }));
    this.push();
    const list = this.siblingsOf(block.id);
    list.splice(list.indexOf(block) + 1, 0, ...blocks);
    this.render({ id: blocks[blocks.length - 1].id, offset: "end" });
    this.commit("button", true);
  },

  /* An AI block holds one generated answer and a button to make it again, so a summary can be kept up to date. */
  renderAiBlock(block) {
    const body = el("div", { class: "ai-block-body" });
    const paintBody = () => { if (block.props?.result) body.innerHTML = renderMarkdown(block.props.result); else body.textContent = "Nothing generated yet."; };
    paintBody();
    const update = iconButton("refresh", "Update", async () => {
      if (!state.aiConfigured) { toast("AI is not set up"); return; }
      wrap.classList.add("busy"); body.textContent = "Writing\u2026";
      try {
        const text = this.flat().map((entry) => spansText(entry.block.text)).filter(Boolean).join("\n").slice(0, 8000);
        const kind = block.props?.kind || "summarize";
        const result = await api.post("/api/notes/ai/inline", { action: kind, text, instruction: block.props?.extra || undefined, sources: [{ pageId: this.page.id }] });
        block.props = { ...block.props, result: String(result.text || "").trim(), updated: Date.now() };
        this.commit("ai-block");
      } catch (error) { toast(error?.message || "AI request failed"); }
      wrap.classList.remove("busy"); paintBody();
    }, { size: 14, className: "ai-block-update" });
    const wrap = el("div", { class: "ai-block" }, el("div", { class: "ai-block-head" }, icon("sparkle", 14), el("span", { class: "ai-block-title", text: block.props?.title || "AI block" }), el("span", { class: "ai-block-spacer" }), this.readOnly ? null : update), body);
    wrap.__update = () => update.click();
    return wrap;
  },

  insertAiBlock(block, kind, title, extra) {
    this.turnInto(block, "ai_block");
    block.props = { kind, title, extra: extra || "", result: "" };
    block.__dirty = true;
    this.insertAfter(block, this.blank());
    this.render();
    this.commit("ai-block", true);
    setTimeout(() => this.nodes.get(block.id)?.querySelector(".ai-block")?.__update?.(), 60);
  },

  /* A brainstorm board: the canvas lives in the block's props, so it is saved, restored and versioned with the page. */
  renderBrainstormBlock(block) {
    const host = el("div", { class: `bs-embed${block.props?.tall ? " tall" : ""}` });
    const board = new Brainstorm(host, {
      data: block.props?.board,
      readOnly: this.readOnly,
      openPage: (id) => this.onNavigate?.(id),
      onChange: (data) => { block.props = { ...block.props, board: data }; this.commit("brainstorm"); },
    });
    host.__board = board;
    return host;
  },

  insertBrainstorm(block) {
    this.turnInto(block, "brainstorm");
    block.props = { board: { items: [], edges: [], cam: { x: 0, y: 0, z: 1 } } };
    block.__dirty = true;
    this.insertAfter(block, this.blank());
    this.render();
    this.commit("brainstorm", true);
    setTimeout(() => this.nodes.get(block.id)?.querySelector(".bs")?.focus(), 80);
  },

  renderToc() {
    const headings = this.flat()
      .map((entry) => entry.block)
      .filter((block) => HEADINGS.has(block.type) && spansLength(block.text));
    const node = el("div", { class: "toc-block" });
    if (!headings.length) {
      append(node,
        el("div", { class: "toc-empty" },
          icon("list", 15),
          el("span", { text: "Add headings to this page and they will appear here." })));
      return node;
    }
    const level = (block) => Number(block.type.replace(/\D/g, "")) || 1;
    const base = Math.min(...headings.map(level));
    const list = el("div", { class: "toc-list" });
    const links = new Map();
    for (const heading of headings) {
      const link = el("a", {
        class: "toc-item",
        href: `#${heading.id}`,
        "data-level": String(Math.min(3, level(heading) - base + 1)),
        onclick: (event) => {
          event.preventDefault();
          this.jumpToBlock(heading.id);
        },
      }, el("span", { class: "toc-dot" }), el("span", { class: "toc-text", text: spansText(heading.text) }));
      links.set(heading.id, link);
      append(list, link);
    }
    append(node, el("div", { class: "toc-head" }, icon("list", 13), el("span", { text: "Contents" })), list);
    this.trackTocPosition(node, links);
    return node;
  },

  /* Highlights the section the reader is actually in. The block is built
     before it is inserted, so the scroller is resolved on the first frame
     and the listener only retires once a node that WAS in the document
     leaves it — which is what happens every time the contents repaint. */
  trackTocPosition(node, links) {
    let attached = false;
    const update = () => {
      if (node.isConnected) attached = true;
      else if (attached || !this.host.isConnected) { document.removeEventListener("scroll", update, true); return; }
      const scroller = this.host.closest(".scroll");
      const edge = (scroller ? scroller.getBoundingClientRect().top : 0) + 90;
      let active = null;
      for (const [id, link] of links) {
        const target = this.nodes.get(id);
        if (!target) continue;
        if (target.getBoundingClientRect().top <= edge) active = link;
      }
      for (const link of links.values()) link.classList.toggle("active", link === active);
    };
    /* Captured on the document rather than bound to the scroller: the block
       is built before it is inserted, so at this point there is no scroll
       container to attach to yet. */
    document.addEventListener("scroll", update, { passive: true, capture: true });
    requestAnimationFrame(update);
  },

  /* One jump used by the contents block and by block links: scroll the
     heading clear of the sticky page header, then put the caret in it. */
  jumpToBlock(id) {
    const target = this.nodes.get(id);
    if (!target) return;
    const scroller = this.host.closest(".scroll");
    if (scroller) {
      const offset = target.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
      scroller.scrollTo({ top: scroller.scrollTop + offset - 24, behavior: "smooth" });
    } else {
      target.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    target.classList.add("jump-target");
    setTimeout(() => target.classList.remove("jump-target"), 900);
    const line = this.lineOf(id);
    if (line) line.focus({ preventScroll: true });
  },

  bulletStyleMenu(block, anchor) {
    const styles = [
      ["bullet", "Round bullet", "•"], ["dash", "Dash", "–"],
      ["arrow", "Arrow", "→"], ["check", "Check", "✓"],
    ];
    menu(anchor, styles.map(([listStyle, label, marker]) => ({
      label, checked: (block.props?.listStyle || "bullet") === listStyle,
      icon: el("span", { class: "bullet-style-marker", text: marker }),
      onSelect: () => {
        this.push();
        block.props = { ...block.props, listStyle };
        block.__dirty = true;
        this.render({ id: block.id, offset: this.caretIn(block) });
        this.commit("bullet-style", true);
      },
    })), { align: "start" });
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
        onclick: (event) => (block.type === "file" ? import("./file-menu.js").then((m) => m.openFileMenu(this, block)) : this.mediaPrompt(block, event.currentTarget)),
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
    else if (block.type === "embed") {
      if (block.props?.embeddable === false) {
        append(wrapper, el("div", { class: "embed-card" },
          el("div", { class: "embed-card-main" },
            el("div", { class: "bookmark-title", text: block.props?.title || url }),
            el("div", { class: "bookmark-url", text: url }),
            el("div", { class: "embed-card-note", text: block.props?.reason || "This site does not allow itself to be shown inside other pages." })),
          el("a", { class: "button", href: url, target: "_blank", rel: "noreferrer noopener" }, "Open site")));
      } else append(wrapper, el("iframe", { class: "media-frame", src: url, loading: "lazy", title: block.props?.caption || "Embed", referrerpolicy: "no-referrer" }));
    }
    else if (block.type === "bookmark") {
      append(wrapper, el("a", { class: "bookmark", href: url, target: "_blank", rel: "noreferrer noopener" },
        el("div", {}, el("div", { class: "bookmark-title", text: block.props?.title || url }),
          el("div", { class: "bookmark-url", text: url }))));
    } else {
      /* A file reads like a link to a page: its icon with a small arrow, and its name, underlined. Opens in a new tab. */
      const name = block.props?.name || decodeURIComponent(url.split("/").pop() || "").replace(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-/i, "") || url;
      append(wrapper, el("a", { class: "file-link", href: url, target: "_blank", rel: "noreferrer noopener", title: `Open ${name}` },
        el("span", { class: "file-link-icon", "aria-hidden": "true" }, icon("file", 20),
          fileArrow()),
        el("span", { class: "file-link-name", text: name }),
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
    const urlField = el("input", { class: "input", placeholder: block.props?.provider ? `Paste a ${block.props.provider} link…` : "Paste a link…", type: "url" });
    const fileField = accept ? el("input", { type: "file", accept, class: "input" }) : null;
    let entry;
    const apply = (props) => {
      block.props = { ...block.props, ...props };
      block.__dirty = true;
      this.render();
      this.commit("media", true);
      entry.close("done");
    };
    /* "/file" offers the files already in this workspace, newest first, before asking for a new upload. */
    const existingFiles = el("div", { class: "field existing-files", hidden: true },
      el("span", { class: "field-label", text: "Choose a file you already added" }));
    if (block.type === "file") {
      fetch("/api/notes/files").then((r) => r.json()).then(({ files }) => {
        if (!files?.length) return;
        const list = el("div", { class: "existing-files-list scroll" });
        for (const file of files) {
          list.append(el("button", { class: "existing-file", type: "button", onclick: () => apply({ url: file.url, name: file.name, size: file.size }) },
            icon("file", 16), el("span", { class: "existing-file-name", text: file.name }), el("span", { class: "meta", text: formatBytes(file.size) })));
        }
        existingFiles.append(list);
        existingFiles.hidden = false;
      }).catch(() => undefined);
    }
    entry = modal({
      title: `Add ${BLOCK_TYPES[block.type].label.toLowerCase()}`,
      width: 460,
      body: el("div", {},
        fileField ? el("label", { class: "field" }, el("span", { class: "field-label", text: "Upload a file" }), fileField) : null,
        block.type === "file" ? existingFiles : null,
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
            if (block.type === "embed") {
              /* Ask first whether the site can be framed, so the block shows the site or an honest card, never an empty box. */
              button.disabled = true;
              button.textContent = "Checking…";
              const check = await fetch(`/api/notes/embed-check?url=${encodeURIComponent(url)}`).then((r) => r.json()).catch(() => null);
              button.disabled = false;
              button.textContent = "Add";
              apply({ url, title: check?.title || url, embeddable: check ? Boolean(check.embeddable) : true, reason: check?.reason });
              return;
            }
            apply({ url, title: url });
          },
        }, "Add"),
      ],
    });
  },

  /* ---------------------------------------------------------------- charts */

  chartSources() {
    return this.linear().filter((candidate) => candidate.type === "table"
      || (candidate.type === "text" && /-?(?:\d+\.?\d*|\.\d+)\s*[,;]\s*-?(?:\d+\.?\d*|\.\d+)/.test(spansText(candidate.text))));
  },

  chartPoints(block) {
    const props = block.props || {};
    if (props.function && !props.dataSourceId) {
      const min = Number.isFinite(Number(props.xMin)) ? Number(props.xMin) : -10;
      const max = Number.isFinite(Number(props.xMax)) ? Number(props.xMax) : 10;
      return Array.from({ length: 121 }, (_, index) => {
        const x = min + ((max - min) * index) / 120;
        const y = evaluateMathFunction(props.function, x);
        return { x, y };
      }).filter((point) => Number.isFinite(point.y));
    }
    const source = props.dataSourceId ? this.find(props.dataSourceId)?.block : null;
    if (source?.type === "table") {
      const rows = Array.isArray(source.props?.rows) ? source.props.rows : [];
      const xColumn = Math.max(0, Number(props.xColumn) || 0);
      const yColumn = Math.max(0, Number(props.yColumn) || 1);
      return rows.slice(1).map((row) => ({ x: Number(row?.[xColumn]), y: Number(row?.[yColumn]) }))
        .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
    }
    if (source?.type === "text") {
      const matches = spansText(source.text).matchAll(/(-?(?:\d+\.?\d*|\.\d+))\s*[,;]\s*(-?(?:\d+\.?\d*|\.\d+))/g);
      return [...matches].map((match) => ({ x: Number(match[1]), y: Number(match[2]) }))
        .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
    }
    return (Array.isArray(props.data) ? props.data : []).map((point) => ({ x: Number(point.x), y: Number(point.y) }))
      .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
  },

  renderChart(block) {
    const props = { ...propsFor("chart", block.props || {}) };
    const points = this.chartPoints({ ...block, props });
    const source = props.dataSourceId ? this.find(props.dataSourceId)?.block : null;
    const panel = el("section", { class: "chart-block", "aria-label": props.title || "Graph" });
    const title = el("div", { class: "chart-title", text: props.title || "Untitled graph" });
    const sourceText = source
      ? `Linked to ${source.type === "table" ? "table" : "paragraph"} · edits update this graph`
      : props.function
        ? `Plotted from y = ${props.function} · customize to edit`
      : "Add points below, or link a table to keep this graph in sync.";
    const header = el("div", { class: "chart-header" },
      el("div", { class: "chart-heading" }, icon("chart", 16), title,
        el("span", { class: "chart-kind", text: String(props.kind || "cartesian").replace(/^./, (char) => char.toUpperCase()) })),
      el("div", { class: "chart-actions" },
        !this.readOnly ? el("button", { class: "text-button chart-link-button", type: "button", onclick: () => this.editChart(block) },
          icon("link", 13), source ? "Change link" : "Link table") : null,
        !this.readOnly ? iconButton("pencil", "Customize graph", () => this.editChart(block), { size: 14, className: "chart-edit" }) : null));
    append(panel, header);
    append(panel, this.buildChartSvg(props, points));
    append(panel, el("div", { class: `chart-source ${source || props.function ? "linked" : "unlinked"}` },
      icon(source ? "link" : "kind_variable", 13), el("span", { text: sourceText })));
    return panel;
  },

  buildChartSvg(props, points) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "chart-svg");
    svg.setAttribute("viewBox", "0 0 720 360");
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", `${props.xLabel || "x"} by ${props.yLabel || "y"} graph`);
    const svgEl = (tag, attrs = {}, textValue = null) => {
      const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
      for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
      if (textValue !== null) node.textContent = textValue;
      svg.append(node);
      return node;
    };
    const left = 56, top = 22, width = 630, height = 278;
    let xMin = Number(props.xMin), xMax = Number(props.xMax), yMin = Number(props.yMin), yMax = Number(props.yMax);
    if (!Number.isFinite(xMin)) xMin = -10;
    if (!Number.isFinite(xMax) || xMax <= xMin) xMax = xMin + 20;
    if (!Number.isFinite(yMin)) yMin = -10;
    if (!Number.isFinite(yMax) || yMax <= yMin) yMax = yMin + 20;
    const x = (value) => left + ((value - xMin) / (xMax - xMin)) * width;
    const y = (value) => top + height - ((value - yMin) / (yMax - yMin)) * height;
    svgEl("rect", { x: 0, y: 0, width: 720, height: 360, rx: 12, fill: "transparent" });
    if (props.showGrid !== false) {
      for (let step = 0; step <= 10; step += 1) {
        const px = left + (width * step) / 10;
        const py = top + (height * step) / 10;
        svgEl("line", { x1: px, y1: top, x2: px, y2: top + height, stroke: props.gridColor, "stroke-width": 1, opacity: 0.62 });
        svgEl("line", { x1: left, y1: py, x2: left + width, y2: py, stroke: props.gridColor, "stroke-width": 1, opacity: 0.62 });
      }
    }
    const axisX = Math.max(top, Math.min(top + height, y(0)));
    const axisY = Math.max(left, Math.min(left + width, x(0)));
    if (props.showAxes !== false) {
      svgEl("line", { x1: left, y1: axisX, x2: left + width, y2: axisX, stroke: props.axisColor, "stroke-width": 1.4 });
      svgEl("line", { x1: axisY, y1: top, x2: axisY, y2: top + height, stroke: props.axisColor, "stroke-width": 1.4 });
    }
    for (let step = 0; step <= 5; step += 1) {
      const xv = xMin + ((xMax - xMin) * step) / 5;
      const yv = yMax - ((yMax - yMin) * step) / 5;
      svgEl("text", { x: x(xv), y: top + height + 20, "text-anchor": "middle", fill: props.axisColor, "font-size": 11 }, formatChartNumber(xv));
      svgEl("text", { x: left - 10, y: y(yv) + 4, "text-anchor": "end", fill: props.axisColor, "font-size": 11 }, formatChartNumber(yv));
    }
    svgEl("text", { x: left + width / 2, y: 348, "text-anchor": "middle", fill: props.axisColor, "font-size": 12, "font-weight": 600 }, props.xLabel || "x");
    const yLabel = svgEl("text", { x: 16, y: top + height / 2, "text-anchor": "middle", fill: props.axisColor, "font-size": 12, "font-weight": 600 }, props.yLabel || "y");
    yLabel.setAttribute("transform", `rotate(-90 16 ${top + height / 2})`);
    const safePoints = points.slice(0, 500);
    if (props.kind === "bar") {
      const barWidth = Math.max(3, Math.min(34, width / Math.max(safePoints.length, 1) * 0.62));
      safePoints.forEach((point) => {
        const base = y(Math.max(yMin, Math.min(yMax, 0)));
        const topValue = y(Math.max(yMin, Math.min(yMax, point.y)));
        svgEl("rect", { x: x(point.x) - barWidth / 2, y: Math.min(base, topValue), width: barWidth, height: Math.max(1, Math.abs(base - topValue)), rx: 3, fill: props.color, opacity: 0.84 });
      });
    } else {
      if ((props.kind === "line" || props.kind === "cartesian") && safePoints.length > 1) {
        svgEl("path", { d: safePoints.map((point, index) => `${index ? "L" : "M"}${x(point.x).toFixed(2)} ${y(point.y).toFixed(2)}`).join(" "), fill: "none", stroke: props.color, "stroke-width": 2.5, "stroke-linecap": "round", "stroke-linejoin": "round" });
      }
      safePoints.forEach((point) => svgEl("circle", { cx: x(point.x), cy: y(point.y), r: 4.5, fill: props.color, stroke: "var(--background-main)", "stroke-width": 2 }));
    }
    return svg;
  },

  editChart(block) {
    const props = { ...propsFor("chart", block.props || {}) };
    const sources = this.chartSources();
    const titleField = el("input", { class: "input", value: props.title || "Untitled graph", placeholder: "Graph title" });
    const kindField = el("select", { class: "select" }, ["cartesian", "line", "scatter", "bar"].map((value) =>
      el("option", { value, text: value === "cartesian" ? "Cartesian plane" : `${value[0].toUpperCase()}${value.slice(1)} chart`, selected: props.kind === value })));
    const sourceField = el("select", { class: "select" }, [
      el("option", { value: "manual", text: "Manual x,y points", selected: !props.dataSourceId }),
      ...sources.map((source) => el("option", { value: source.id, text: `${source.type === "table" ? "Table" : "Paragraph"} · ${source.type === "table" ? "first two columns" : "x,y pairs"}`, selected: props.dataSourceId === source.id })),
    ]);
    const functionField = el("input", { class: "input", value: props.function || "", placeholder: "e.g. x^2 - 3x + 1" });
    const manualField = el("textarea", { class: "textarea chart-data-input", rows: 5, placeholder: "x, y\n-2, 4\n0, 1\n2, 4", value: (props.data || []).map((point) => `${point.x}, ${point.y}`).join("\n") });
    const xColumn = el("input", { class: "input", type: "number", min: 0, value: Number(props.xColumn) || 0 });
    const yColumn = el("input", { class: "input", type: "number", min: 0, value: Number(props.yColumn) || 1 });
    const colorField = el("input", { class: "color-input", type: "color", value: /^#[0-9a-f]{6}$/i.test(props.color) ? props.color : "#6e7bf2" });
    const gridField = el("input", { class: "color-input", type: "color", value: /^#[0-9a-f]{6}$/i.test(props.gridColor) ? props.gridColor : "#d8dbe5" });
    const axisField = el("input", { class: "color-input", type: "color", value: /^#[0-9a-f]{6}$/i.test(props.axisColor) ? props.axisColor : "#606776" });
    const field = (label, control) => el("label", { class: "field" }, el("span", { class: "field-label", text: label }), control);
    const rangeFields = el("div", { class: "chart-range-fields" },
      field("X min", el("input", { class: "input", type: "number", step: "any", value: props.xMin })),
      field("X max", el("input", { class: "input", type: "number", step: "any", value: props.xMax })),
      field("Y min", el("input", { class: "input", type: "number", step: "any", value: props.yMin })),
      field("Y max", el("input", { class: "input", type: "number", step: "any", value: props.yMax })),
    );
    const xLabel = el("input", { class: "input", value: props.xLabel || "x" });
    const yLabel = el("input", { class: "input", value: props.yLabel || "y" });
    const manualWrap = field("Manual points", manualField);
    const functionWrap = field("Function y = f(x)", functionField);
    const columnWrap = el("div", { class: "chart-range-fields" }, field("X column", xColumn), field("Y column", yColumn));
    const syncSource = () => {
      const linked = sourceField.value !== "manual";
      manualWrap.hidden = linked;
      functionWrap.hidden = linked;
      const source = sources.find((candidate) => candidate.id === sourceField.value);
      columnWrap.hidden = !linked || source?.type !== "table";
    };
    sourceField.addEventListener("change", syncSource);
    syncSource();
    let entry;
    entry = modal({
      title: "Customize graph",
      width: 560,
      body: el("div", { class: "chart-editor" },
        el("div", { class: "chart-link-help" }, icon("link", 14), el("span", { text: "Linking keeps a graph live: add a Table block, choose it here, and edits to its first two numeric columns update the plot." })),
        field("Title", titleField), field("Chart type", kindField), field("Data source", sourceField),
        functionWrap, manualWrap, columnWrap,
        el("div", { class: "chart-editor-section" }, el("div", { class: "field-label", text: "Axes and range" }), field("X label", xLabel), field("Y label", yLabel), rangeFields),
        el("div", { class: "chart-editor-section" }, el("div", { class: "field-label", text: "Colours" }),
          el("div", { class: "chart-color-fields" }, field("Series", colorField), field("Grid", gridField), field("Axes", axisField))),
        !sources.some((source) => source.type === "table") ? el("div", { class: "chart-empty-help", text: "No table blocks yet. Close this dialog, add /table, then return to Link table." }) : null),
      footer: [
        el("button", { class: "button", type: "button", onclick: () => entry.close("cancel") }, "Cancel"),
        el("button", { class: "button primary", type: "button", onclick: () => {
          const parsePoints = (value) => String(value).split(/\n|;/).map((line) => line.match(/^\s*(-?(?:\d+\.?\d*|\.\d+))\s*,\s*(-?(?:\d+\.?\d*|\.\d+))/)).filter(Boolean).map((match) => ({ x: Number(match[1]), y: Number(match[2]) }));
          const linkedId = sourceField.value === "manual" ? null : sourceField.value;
          const range = [...rangeFields.querySelectorAll("input")].map((input) => Number(input.value));
          block.props = { ...props, title: titleField.value.trim() || "Untitled graph", kind: kindField.value, dataSourceId: linkedId,
            function: linkedId ? "" : functionField.value.trim(),
            data: linkedId ? props.data : parsePoints(manualField.value), xLabel: xLabel.value.trim() || "x", yLabel: yLabel.value.trim() || "y",
            xMin: Number.isFinite(range[0]) ? range[0] : -10, xMax: Number.isFinite(range[1]) ? range[1] : 10,
            yMin: Number.isFinite(range[2]) ? range[2] : -10, yMax: Number.isFinite(range[3]) ? range[3] : 10,
            xColumn: Number(xColumn.value) || 0, yColumn: Number(yColumn.value) || 1,
            color: colorField.value, gridColor: gridField.value, axisColor: axisField.value };
          block.__dirty = true;
          this.render();
          this.commit("chart", true);
          entry.close("saved");
        } }, "Save graph"),
      ],
    });
  },

  refreshChartBlocks() {
    for (const { block } of this.flat()) {
      if (block.type !== "chart") continue;
      const host = this.nodes.get(block.id);
      const panel = host?.querySelector(".chart-block");
      if (panel) panel.replaceWith(this.renderChart(block));
    }
  },

  /* Cells are plain contenteditable text: a table here is for laying out
     facts inside a note, not a database, which is a separate block.

     Every structural edit goes through mutateTable, so an inserted row, a
     moved column and a deleted table all land on the undo stack the same
     way and repaint the block exactly once. */
  tableShape(block) {
    const rows = (block.props?.rows || [["", ""], ["", ""]]).map((row) => [...row]);
    if (!rows.length) rows.push([""]);
    const width = Math.max(1, ...rows.map((row) => row.length));
    for (const row of rows) while (row.length < width) row.push("");
    const align = Array.from({ length: width }, (_, index) => block.props?.align?.[index] || "left");
    return { rows, width, align };
  },

  mutateTable(block, mutate, reason = "table") {
    const draft = { ...this.tableShape(block), props: {} };
    if (mutate(draft) === false) return;
    this.push();
    block.props = { ...block.props, ...draft.props, rows: draft.rows, align: draft.align };
    block.__dirty = true;
    this.render();
    this.commit(reason, true);
  },

  renderTable(block) {
    const { rows, width, align } = this.tableShape(block);
    const hasHeader = block.props?.hasHeader !== false;

    /* Typing is the one path that must not re-render: the caret lives in the
       cell being edited. It writes straight through to the model. */
    const save = () => {
      block.props = { ...block.props, rows };
      this.refreshChartBlocks();
      this.commit("table");
    };

    /* A tint is a named colour that resolves through the theme tokens, so a
       table styled once still reads correctly in dark mode. The explicit hex
       colours from the Style dialog override it when the student has picked
       their own. */
    const tint = block.props?.tint && block.props.tint !== "default" ? `var(--c-${block.props.tint}-bg)` : null;
    const wrapper = el("div", {
      class: `table-block${block.props?.striped ? " striped" : ""}${hasHeader ? " has-header" : ""}`,
      style: {
        "--table-header-color": block.props?.headerColor || tint || "var(--background-subtle)",
        "--table-border-color": block.props?.borderColor || "var(--border-soft)",
        "--table-cell-color": block.props?.cellColor || "transparent",
        "--table-text-color": block.props?.textColor || "var(--text-primary)",
      },
    });

    const scroller = el("div", { class: "table-scroll scroll" });
    const table = el("table", { class: "note-table" });

    /* The grips live in a real rail row and rail column rather than floating
       over the table, so they stay put through horizontal scrolling and can
       never cover a cell the student is typing in. */
    if (!this.readOnly) {
      const rail = el("tr", { class: "table-rail-row" });
      rail.append(el("td", { class: "rail-corner" },
        tooltip(el("button", {
          class: "table-grip corner-grip", type: "button", "aria-label": "Table options",
          onclick: (event) => this.tableMenu(block, event.currentTarget),
        }), "Table options")));
      for (let column = 0; column < width; column += 1) {
        rail.append(el("td", { class: "rail-column" },
          tooltip(el("button", {
            class: "table-grip column-grip", type: "button", "aria-label": `Column ${column + 1} options`,
            onclick: (event) => this.tableColumnMenu(block, column, event.currentTarget),
          }), "Click for column actions")));
      }
      table.append(rail);
    }

    rows.forEach((row, rowIndex) => {
      const isHeader = hasHeader && rowIndex === 0;
      /* Edge classes rather than :first-of-type: the rail cells share the
         td type, so a positional selector would land on the wrong cell. */
      const edges = `${rowIndex === 0 ? " first-row" : ""}${rowIndex === rows.length - 1 ? " last-row" : ""}`;
      const tr = el("tr", { class: `table-row${isHeader ? " header" : ""}${edges}${rowIndex % 2 ? " odd" : " even"}` });
      if (!this.readOnly) {
        tr.append(el("td", { class: "rail-row" },
          tooltip(el("button", {
            class: "table-grip row-grip", type: "button", "aria-label": `Row ${rowIndex + 1} options`,
            onclick: (event) => this.tableRowMenu(block, rowIndex, event.currentTarget),
          }), "Click for row actions")));
      }
      row.forEach((cell, columnIndex) => {
        const node = el(isHeader ? "th" : "td", {
          class: `table-cell${columnIndex === 0 ? " first-col" : ""}${columnIndex === width - 1 ? " last-col" : ""}`,
          contenteditable: this.readOnly ? "false" : "true",
          "data-placeholder": isHeader ? "Column" : "",
          style: { textAlign: align[columnIndex] },
          oninput: (event) => { rows[rowIndex][columnIndex] = event.currentTarget.textContent; save(); },
          onkeydown: (event) => this.onTableCellKey(event, block, rows, rowIndex, columnIndex, table),
        });
        /* markdown markers written by a model or pasted in are formatting, not text: show the words, not the asterisks */
        const clean = typeof cell === "string" ? cell.replace(/\*\*(.+?)\*\*/g, "$1").replace(/(^|[^*\w])\*([^*\s][^*]*?)\*(?![*\w])/g, "$1$2").replace(/`([^`]+)`/g, "$1") : cell;
        if (clean !== cell) rows[rowIndex][columnIndex] = clean;
        node.textContent = clean;
        tr.append(node);
      });
      table.append(tr);
    });

    scroller.append(table);
    append(wrapper, scroller, this.readOnly ? null : el("div", { class: "table-actions" },
      el("button", {
        class: "text-button", type: "button", title: "Add a row at the bottom",
        onclick: () => this.mutateTable(block, (draft) => { draft.rows.push(Array.from({ length: draft.width }, () => "")); }, "table-row"),
      }, icon("plus", 14), "Row"),
      el("button", {
        class: "text-button", type: "button", title: "Add a column on the right",
        onclick: () => this.mutateTable(block, (draft) => {
          for (const row of draft.rows) row.push("");
          draft.align.push("left");
        }, "table-column"),
      }, icon("plus", 14), "Column"),
      el("button", {
        class: `text-button${hasHeader ? " on" : ""}`, type: "button",
        title: hasHeader ? "Turn the header row back into a normal row" : "Use the first row as a header",
        onclick: () => this.mutateTable(block, (draft) => { draft.props.hasHeader = !hasHeader; }, "table-header"),
      }, icon("h1", 13), "Header"),
      el("button", { class: "text-button", type: "button", title: "Colours and row tint", onclick: () => this.editTableStyle(block) },
        icon("palette", 13), "Style"),
      /* The whole point of the hover bar: a table has no text line, so
         without an explicit control there is nothing to press Delete on. */
      el("button", {
        class: "text-button danger", type: "button", title: "Delete this table",
        onclick: () => this.deleteBlocks([block.id]),
      }, icon("trash", 13), "Delete table"),
    ));
    return wrapper;
  },

  /* Tab walks the cells and grows the table at the end, Enter drops a row
     instead of inserting a line break, and Escape hands the block back to
     the keyboard so Delete removes the table rather than a character. */
  onTableCellKey(event, block, rows, rowIndex, columnIndex, table) {
    const cells = () => [...table.querySelectorAll(".table-cell")];
    if (event.key === "Escape") {
      event.preventDefault();
      event.currentTarget.blur();
      this.selectOnly(block.id);
      return;
    }
    if (event.key === "Tab") {
      event.preventDefault();
      const order = cells();
      const at = order.indexOf(event.currentTarget);
      const next = order[at + (event.shiftKey ? -1 : 1)];
      if (next) { next.focus(); return; }
      if (event.shiftKey) return;
      this.mutateTable(block, (draft) => { draft.rows.push(Array.from({ length: draft.width }, () => "")); }, "table-row");
      this.focusTableCell(block, rows.length, 0);
      return;
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      if (rowIndex === rows.length - 1) {
        this.mutateTable(block, (draft) => { draft.rows.push(Array.from({ length: draft.width }, () => "")); }, "table-row");
      }
      this.focusTableCell(block, rowIndex + 1, columnIndex);
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      const target = rowIndex + (event.key === "ArrowDown" ? 1 : -1);
      if (target < 0 || target >= rows.length) return;
      event.preventDefault();
      this.focusTableCell(block, target, columnIndex);
    }
  },

  focusTableCell(block, rowIndex, columnIndex) {
    const host = this.nodes.get(block.id);
    const row = host?.querySelectorAll(".note-table .table-row")[rowIndex];
    const cell = row?.querySelectorAll(".table-cell")[columnIndex];
    if (!cell) return;
    cell.focus();
    const range = document.createRange();
    range.selectNodeContents(cell);
    range.collapse(false);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  },

  tableMenu(block, anchor) {
    const hasHeader = block.props?.hasHeader !== false;
    menu(anchor, [
      { label: hasHeader ? "Remove header row" : "Use first row as header", icon: "h1",
        onSelect: () => this.mutateTable(block, (draft) => { draft.props.hasHeader = !hasHeader; }, "table-header") },
      { label: block.props?.striped ? "Remove row tint" : "Tint alternating rows", icon: "table",
        onSelect: () => this.mutateTable(block, (draft) => { draft.props.striped = !block.props?.striped; }, "table-style") },
      { label: "Tint", icon: "palette", onSelect: () => this.tableTintMenu(block, anchor) },
      { label: "Style…", icon: "palette", onSelect: () => this.editTableStyle(block) },
      { type: "separator" },
      { label: "Clear all cells", icon: "close",
        onSelect: () => this.mutateTable(block, (draft) => { draft.rows = draft.rows.map((row) => row.map(() => "")); }, "table-clear") },
      { label: "Duplicate table", icon: "duplicate", onSelect: () => this.duplicateBlock(block) },
      { label: "Delete table", icon: "trash", danger: true, onSelect: () => this.deleteBlocks([block.id]) },
    ]);
  },

  /* Named tints resolve per theme; picking one clears any hand-picked hex
     colours so the two systems cannot half-apply. */
  tableTintMenu(block, anchor) {
    menu(anchor, COLORS.map((color) => ({
      label: color === "default" ? "No tint" : color[0].toUpperCase() + color.slice(1),
      checked: (block.props?.tint || "default") === color,
      icon: el("span", { class: "tint-swatch", style: { background: color === "default" ? "var(--background-subtle)" : `var(--c-${color}-bg)` } }),
      onSelect: () => this.mutateTable(block, (draft) => {
        Object.assign(draft.props, { tint: color, headerColor: null, cellColor: null, textColor: null });
      }, "table-style"),
    })), { align: "start" });
  },

  tableRowMenu(block, rowIndex, anchor) {
    const { rows } = this.tableShape(block);
    menu(anchor, [
      { type: "label", label: `Row ${rowIndex + 1}` },
      { label: "Insert above", icon: "arrow_up",
        onSelect: () => this.mutateTable(block, (draft) => { draft.rows.splice(rowIndex, 0, Array.from({ length: draft.width }, () => "")); }, "table-row") },
      { label: "Insert below", icon: "arrow_down",
        onSelect: () => this.mutateTable(block, (draft) => { draft.rows.splice(rowIndex + 1, 0, Array.from({ length: draft.width }, () => "")); }, "table-row") },
      { label: "Duplicate", icon: "duplicate",
        onSelect: () => this.mutateTable(block, (draft) => { draft.rows.splice(rowIndex + 1, 0, [...draft.rows[rowIndex]]); }, "table-row") },
      { type: "separator" },
      { label: "Move up", icon: "arrow_up", disabled: rowIndex === 0,
        onSelect: () => this.mutateTable(block, (draft) => { draft.rows.splice(rowIndex - 1, 0, draft.rows.splice(rowIndex, 1)[0]); }, "table-row") },
      { label: "Move down", icon: "arrow_down", disabled: rowIndex === rows.length - 1,
        onSelect: () => this.mutateTable(block, (draft) => { draft.rows.splice(rowIndex + 1, 0, draft.rows.splice(rowIndex, 1)[0]); }, "table-row") },
      { type: "separator" },
      { label: "Clear row", icon: "close",
        onSelect: () => this.mutateTable(block, (draft) => { draft.rows[rowIndex] = draft.rows[rowIndex].map(() => ""); }, "table-clear") },
      { label: "Delete row", icon: "trash", danger: true, disabled: rows.length <= 1,
        onSelect: () => this.mutateTable(block, (draft) => { draft.rows.splice(rowIndex, 1); }, "table-row") },
    ]);
  },

  tableColumnMenu(block, columnIndex, anchor) {
    const { width, align } = this.tableShape(block);
    const setAlign = (value) => this.mutateTable(block, (draft) => { draft.align[columnIndex] = value; }, "table-align");
    menu(anchor, [
      { type: "label", label: `Column ${columnIndex + 1}` },
      { label: "Insert left", icon: "arrow_left",
        onSelect: () => this.mutateTable(block, (draft) => {
          for (const row of draft.rows) row.splice(columnIndex, 0, "");
          draft.align.splice(columnIndex, 0, "left");
        }, "table-column") },
      { label: "Insert right", icon: "arrow_right",
        onSelect: () => this.mutateTable(block, (draft) => {
          for (const row of draft.rows) row.splice(columnIndex + 1, 0, "");
          draft.align.splice(columnIndex + 1, 0, "left");
        }, "table-column") },
      { label: "Duplicate", icon: "duplicate",
        onSelect: () => this.mutateTable(block, (draft) => {
          for (const row of draft.rows) row.splice(columnIndex + 1, 0, row[columnIndex]);
          draft.align.splice(columnIndex + 1, 0, draft.align[columnIndex]);
        }, "table-column") },
      { type: "separator" },
      { label: "Move left", icon: "arrow_left", disabled: columnIndex === 0,
        onSelect: () => this.mutateTable(block, (draft) => {
          for (const row of draft.rows) row.splice(columnIndex - 1, 0, row.splice(columnIndex, 1)[0]);
          draft.align.splice(columnIndex - 1, 0, draft.align.splice(columnIndex, 1)[0]);
        }, "table-column") },
      { label: "Move right", icon: "arrow_right", disabled: columnIndex === width - 1,
        onSelect: () => this.mutateTable(block, (draft) => {
          for (const row of draft.rows) row.splice(columnIndex + 1, 0, row.splice(columnIndex, 1)[0]);
          draft.align.splice(columnIndex + 1, 0, draft.align.splice(columnIndex, 1)[0]);
        }, "table-column") },
      { type: "separator" },
      { label: "Align left", icon: "align_left", checked: align[columnIndex] === "left", onSelect: () => setAlign("left") },
      { label: "Align centre", icon: "align_center", checked: align[columnIndex] === "center", onSelect: () => setAlign("center") },
      { label: "Align right", icon: "align_right", checked: align[columnIndex] === "right", onSelect: () => setAlign("right") },
      { type: "separator" },
      { label: "Clear column", icon: "close",
        onSelect: () => this.mutateTable(block, (draft) => { for (const row of draft.rows) row[columnIndex] = ""; }, "table-clear") },
      { label: "Delete column", icon: "trash", danger: true, disabled: width <= 1,
        onSelect: () => this.mutateTable(block, (draft) => {
          for (const row of draft.rows) row.splice(columnIndex, 1);
          draft.align.splice(columnIndex, 1);
        }, "table-column") },
    ]);
  },

  editTableStyle(block) {
    const props = block.props || {};
    const color = (value, fallback) => el("input", { class: "color-input", type: "color", value: /^#[0-9a-f]{6}$/i.test(value || "") ? value : fallback });
    const headerField = color(props.headerColor, "#f3f4f7");
    const borderField = color(props.borderColor, "#d8dbe5");
    const cellField = color(props.cellColor, "#ffffff");
    const textField = color(props.textColor, "#252936");
    const stripedField = el("input", { type: "checkbox", checked: props.striped === true });
    const field = (label, control) => el("label", { class: "field" }, el("span", { class: "field-label", text: label }), control);
    let entry;
    entry = modal({
      title: "Customize table",
      width: 430,
      body: el("div", { class: "table-style-editor" },
        el("div", { class: "chart-link-help" }, icon("palette", 14), el("span", { text: "Choose a visual treatment for this table. Your data and linked graphs stay unchanged." })),
        el("div", { class: "chart-color-fields table-color-fields" }, field("Header", headerField), field("Cells", cellField), field("Text", textField)),
        field("Grid", borderField),
        el("label", { class: "table-stripe-toggle" }, stripedField, el("span", { text: "Use alternating row tint" }))),
      footer: [
        el("button", { class: "button", type: "button", onclick: () => {
          this.mutateTable(block, (draft) => {
            Object.assign(draft.props, { headerColor: null, borderColor: null, cellColor: null, textColor: null, striped: false });
          }, "table-style");
          entry.close("reset");
        } }, "Reset"),
        el("button", { class: "button", type: "button", onclick: () => entry.close("cancel") }, "Cancel"),
        el("button", { class: "button primary", type: "button", onclick: () => {
          this.mutateTable(block, (draft) => {
            Object.assign(draft.props, {
              headerColor: headerField.value, borderColor: borderField.value,
              cellColor: cellField.value, textColor: textField.value, striped: stripedField.checked,
            });
          }, "table-style");
          entry.close("saved");
        } }, "Save style"),
      ],
    });
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

const formatChartNumber = (value) => Number.isInteger(value)
  ? String(value)
  : Number(value.toPrecision(6)).toLocaleString(undefined, { maximumFractionDigits: 4 });

/* Uploads stay inside the workspace: the file is written next to the
   database so notes and their attachments back up together. */
/* the small up-right arrow on a file's icon (a real SVG node: HTML-created <svg> elements do not render) */
function fileArrow() {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "file-link-arrow");
  svg.setAttribute("viewBox", "0 0 12 12");
  svg.setAttribute("width", "11");
  svg.setAttribute("height", "11");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", "M3 9 9 3M4.5 3H9v4.5");
  path.setAttribute("fill", "none");
  path.setAttribute("stroke", "currentColor");
  path.setAttribute("stroke-width", "1.6");
  path.setAttribute("stroke-linecap", "round");
  path.setAttribute("stroke-linejoin", "round");
  svg.append(path);
  return svg;
}

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
    this.detectCodeLanguageForBlock(block, line);
    line.innerHTML = highlight(text, block.props?.language || "plain");
    setCaret(line, caret);
    this.commit("code");
  },

  onCodeInput(block, line) {
    const caret = caretOffset(line);
    block.text = plain(this.codeText(line));
    this.detectCodeLanguageForBlock(block, line);
    this.repaintCode(block, line, caret);
    this.commit("code");
    this.showCompletions(block, line);
  },

  /* A pasted or transformed code block is not frozen to the language it had
     when it was first recognised. Strong signatures are safe to reclassify,
     so replacing an HTML snippet with Python immediately refreshes syntax,
     completions and the Run/Preview button without an extra dropdown step. */
  detectCodeLanguageForBlock(block, line) {
    const language = detectCodeLanguage(spansText(block.text));
    if (!language || language === block.props?.language) return false;
    block.props = { ...block.props, language };
    const wrapper = line?.closest?.(".code-block");
    const label = wrapper?.querySelector?.(".code-lang");
    if (label) label.textContent = language;
    const actions = wrapper?.querySelector?.(".code-actions");
    const existingRun = actions?.querySelector?.(".code-run");
    if (isExecutable(language)) {
      if (existingRun) existingRun.setAttribute("aria-label", runnerLabel(language));
      else if (actions) actions.append(iconButton(
        "play", runnerLabel(language),
        () => executeBlock(block.props?.language || "plain", spansText(block.text), this.page?.title || "Preview"),
        { className: "code-run", size: 14 },
      ));
    } else existingRun?.remove();
    return true;
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

    /* A code block is a multi-line editor, but its first and last logical
       rows still have normal block-editor boundaries. At the last row, Down
       Arrow reaches the text directly underneath; when there is none, create
       it rather than trapping the caret in the code surface. */
    if (event.key === "ArrowDown" && (!range || range.collapsed) && !text.slice(caret).includes("\n")) {
      event.preventDefault();
      const siblings = this.siblingsOf(block.id);
      const next = siblings[siblings.indexOf(block) + 1];
      if (next && isTextBlock(next)) this.focus(next.id, 0);
      else this.insertAfter(block, makeBlock());
      return;
    }
    if (event.key === "ArrowUp" && (!range || range.collapsed) && !text.slice(0, caret).includes("\n")) {
      const previous = this.previousTextBlock(block);
      if (previous) { event.preventDefault(); this.focus(previous.id, "end"); }
      return;
    }

    // A code block is an intentional container while it has content. Once it
    // is empty, Backspace should remove the container itself, matching the
    // rest of the block editor instead of leaving an inert code shell behind.
    if (event.key === "Backspace" && !text && caret === 0 && (!range || range.collapsed)) {
      event.preventDefault();
      this.backspaceAtStart(block);
      return;
    }

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
