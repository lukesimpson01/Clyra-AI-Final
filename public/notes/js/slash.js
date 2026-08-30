/* The slash command menu. Positioned under the caret, filtered as you type,
   and driven entirely from the block catalogue so it can never offer a block
   the editor cannot build. */
import { el, icon, menu, position, pushLayer, toast } from "./dom.js";
import { BLOCK_TYPES } from "./block-types.js";
import { caretOffset, setCaret, spansText, sliceSpans, spansLength } from "./richtext.js";
import { state } from "./state.js";

const GROUP_ORDER = ["AI", "Basic blocks", "Lists", "Media", "Advanced", "Study"];

export function slashCommands(editor) {
  const commands = [];
  if (state.aiConfigured) {
    commands.push({
      key: "ai", label: "Ask AI", group: "AI", icon: "sparkle",
      desc: "Write, explain or summarise with AI.", keywords: "ai write generate assistant",
      run: (block) => editor.openAiComposer(block),
    });
    commands.push({
      key: "flashcards", label: "Generate flashcards", group: "AI", icon: "cards",
      desc: "Make cards from this page.", keywords: "ai cards revision anki",
      run: () => editor.onGenerate?.("flashcards", { pageId: editor.page.id }),
    });
    commands.push({
      key: "quiz", label: "Generate practice test", group: "AI", icon: "check_square",
      desc: "Make exam questions from this page.", keywords: "ai test quiz exam questions",
      run: () => editor.onGenerate?.("questions", { pageId: editor.page.id }),
    });
    commands.push({
      key: "studyguide", label: "Generate study guide", group: "AI", icon: "target",
      desc: "Build a revision document.", keywords: "ai revision guide summary",
      run: () => editor.onGenerate?.("study-guide", { pageId: editor.page.id }),
    });
  }
  for (const [type, meta] of Object.entries(BLOCK_TYPES)) {
    commands.push({
      key: type, label: meta.label, group: meta.group, icon: meta.icon,
      desc: meta.desc, md: meta.md, keywords: `${type} ${meta.keywords || ""}`,
      run: (block) => insertType(editor, block, type),
    });
  }
  commands.push({
    key: "lecture", label: "Lecture notes", group: "Study", icon: "mic",
    desc: "Record and transcribe a lecture.", keywords: "record audio transcript class",
    run: () => editor.onGenerate?.("lecture", { pageId: editor.page.id }),
  });
  return commands;
}

function insertType(editor, block, type) {
  if (type === "page") { editor.onCreateChildPage?.(block); return; }
  if (type === "link_to_page") { editor.onLinkPage?.(block); return; }
  if (type === "columns") { editor.splitIntoColumns(block); return; }
  editor.turnInto(block, type);
  /* Blocks with no text of their own leave a fresh paragraph behind so the
     caret has somewhere to land. */
  if (["divider", "toc", "breadcrumb", "image", "video", "audio", "file", "pdf", "bookmark", "embed", "transcript", "source", "table"].includes(type)) {
    editor.insertAfter(block, editor.blank());
  }
}

export function openSlashMenu({ editor, block, line, triggerOffset, onClose }) {
  const commands = slashCommands(editor);
  const node = el("div", { class: "menu slash-menu", role: "listbox" });
  let query = "";
  let rows = [];
  let activeIndex = 0;
  let entry;

  const anchorRect = () => {
    const selection = window.getSelection();
    if (selection?.rangeCount) {
      const rect = selection.getRangeAt(0).getBoundingClientRect();
      if (rect.width || rect.height || rect.top) return rect;
    }
    return line.getBoundingClientRect();
  };

  const visible = () => {
    const term = query.trim().toLowerCase();
    return commands.filter((command) =>
      !term || command.label.toLowerCase().includes(term) || command.keywords.toLowerCase().includes(term));
  };

  const build = () => {
    node.replaceChildren();
    rows = [];
    const list = el("div", { class: "slash-scroll" });
    node.append(list);
    const matched = visible();
    if (!matched.length) {
      list.append(el("div", { class: "menu-empty", text: `No blocks match "${query}"` }));
    }
    const groups = new Map();
    for (const command of matched) {
      if (!groups.has(command.group)) groups.set(command.group, []);
      groups.get(command.group).push(command);
    }
    for (const group of [...groups.keys()].sort((a, b) => GROUP_ORDER.indexOf(a) - GROUP_ORDER.indexOf(b))) {
      list.append(el("div", { class: "menu-label", text: group }));
      for (const command of groups.get(group)) {
        const row = el("button", {
          class: "menu-item slash-item", type: "button", role: "option",
          title: command.desc,
          onmouseenter: () => setActive(rows.indexOf(row)),
          onclick: () => choose(command),
        },
          el("span", { class: "m-icon" }, icon(command.icon, 17)),
          el("span", { class: "m-name", text: command.label }),
          command.md ? el("span", { class: "m-md", text: command.md }) : null);
        rows.push(row);
        list.append(row);
      }
    }
    node.append(el("div", { class: "slash-footer" },
      el("button", { class: "menu-item", type: "button", onclick: () => entry.close("close") },
        el("span", { class: "m-name", text: "Close menu" }),
        el("span", { class: "shortcut", text: "esc" }))));
    setActive(Math.min(activeIndex, rows.length - 1));
    position(node, anchorRect(), { gap: 6 });
  };

  const setActive = (index) => {
    rows.forEach((row) => row.classList.remove("active"));
    activeIndex = Math.max(0, Math.min(index, rows.length - 1));
    rows[activeIndex]?.classList.add("active");
    rows[activeIndex]?.scrollIntoView({ block: "nearest" });
  };

  /* The "/query" text is removed before the command runs, so a converted
     block never keeps the command the student typed to reach it. */
  const consumeTrigger = () => {
    const from = Math.max(0, triggerOffset - 1);
    const to = triggerOffset + query.length;
    block.text = [
      ...sliceSpans(block.text, 0, from),
      ...sliceSpans(block.text, to, spansLength(block.text)),
    ];
    editor.paint(line, block);
    setCaret(line, from);
  };

  const choose = (command) => {
    consumeTrigger();
    entry.close("select");
    command.run(block);
  };

  /* Bound on the document in capture phase and stopped there: the editor's
     own Enter and arrow handling must not also run while the menu is open. */
  const onKey = (event) => {
    if (event.target !== line) return;
    const handled = ["ArrowDown", "ArrowUp", "Enter", "Escape", "Tab"];
    if (event.key === "Backspace" && !query) { entry.close("backspace"); return; }
    if (!handled.includes(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.key === "ArrowDown") { setActive(activeIndex + 1); return; }
    if (event.key === "ArrowUp") { setActive(activeIndex - 1); return; }
    if (event.key === "Escape") { entry.close("escape"); return; }
    const command = visible()[activeIndex];
    if (command) choose(command);
  };

  /* Notion shows the search hint inline in the block; mirroring it makes the
     "/" feel like a field rather than a stray character. */
  const paintHint = () => {
    line.dataset.slashHint = query ? "" : "Type to search";
  };

  const sync = () => {
    const offset = caretOffset(line);
    if (offset < triggerOffset) { entry.close("moved"); return; }
    query = spansText(block.text).slice(triggerOffset, offset);
    if (query.includes("\n")) { entry.close("newline"); return; }
    activeIndex = 0;
    paintHint();
    build();
  };

  /* The query is read from the input event rather than keydown so it stays
     correct through IME composition, autocorrect and pasted text. */
  document.addEventListener("keydown", onKey, true);
  line.addEventListener("input", sync);
  paintHint();
  entry = pushLayer(node, {
    onClose: () => {
      document.removeEventListener("keydown", onKey, true);
      line.removeEventListener("input", sync);
      delete line.dataset.slashHint;
      onClose?.();
    },
  });
  build();
}
