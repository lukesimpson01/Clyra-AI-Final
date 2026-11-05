/* The slash command menu. Positioned under the caret, filtered as you type,
   and driven entirely from the block catalogue so it can never offer a block
   the editor cannot build. */
import { openFileMenu } from "./file-menu.js";
import { el, icon, matchScore, menu, position, pushLayer, toast } from "./dom.js";
import { BLOCK_TYPES } from "./block-types.js";
import { caretOffset, setCaret, spansText, sliceSpans, spansLength, selectionRectIn } from "./richtext.js";
import { state, refreshPages } from "./state.js";
import { buildDatabase } from "./database.js";
import { openSearch } from "./search.js";
import { insertSpans } from "./richtext.js";
import { extraCommands } from "./slash-extras.js";

const GROUP_ORDER = ["Suggested", "Basic blocks", "Media", "Database", "Advanced blocks", "Inline", "Import", "AI", "Study"];

export function slashCommands(editor) {
  const commands = [];
  if (state.aiConfigured) {
    commands.push({
      key: "ai", label: "Ask AI", group: "AI", icon: "sparkle",
      desc: "Write, explain or summarise with AI.", keywords: "ai write generate assistant",
      run: (block) => editor.openAiComposer(block),
    });
    for (const [key, label, glyph, desc, options] of [
      ["summarize", "Summarize page", "list", "A short summary with the key points.", { action: "summarize" }],
      ["actionitems", "Find action items", "check_square", "Pull the tasks out of this page as a checklist.", { action: "action_items" }],
      ["continuewriting", "Continue writing", "pencil", "Carry on from where the page stops.", { action: "continue" }],
      ["brainstorm", "Brainstorm ideas", "sparkle", "Ideas on a topic you name.", { prefill: "Brainstorm ideas for " }],
      ["draftblog", "Draft a blog post", "text", "A first draft of a post on a topic you name.", { prefill: "Write a blog post about " }],
    ]) {
      commands.push({ key, label, group: "AI", icon: glyph, desc, keywords: `ai ${label.toLowerCase()} notion`, run: (block) => editor.openAiComposer(block, options) });
    }
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
  /* blocks with their own setup (a database, tabs, a button, an AI block) have dedicated commands below */
  /* Blocks with a setup flow are offered explicitly below. HTML remains a
     normal, non-executing code block; Embed gets its own URL and framing
     check rather than creating an unverified iframe directly. */
  const HAND_BUILT = new Set(["database", "tabs", "button", "ai_block", "synced", "brainstorm", "embed", "html"]);
  for (const [type, meta] of Object.entries(BLOCK_TYPES)) {
    if (HAND_BUILT.has(type)) continue;
    commands.push({
      key: type, label: meta.label, group: meta.group, icon: meta.icon,
      desc: meta.desc, md: meta.md, keywords: `${type} ${meta.keywords || ""}`,
      run: (block) => insertType(editor, block, type),
    });
  }
  /* Notion's Suggested group: what it expects you to reach for first. */
  commands.push({
    key: "meetingnotes", label: "AI Meeting Notes", group: "Suggested", icon: "mic",
    desc: "Record a meeting or lecture and get notes.", keywords: "ai meeting record transcript summary notes",
    run: () => editor.onGenerate?.("lecture", { pageId: editor.page.id }),
  });
  commands.push({
    key: "html", label: "HTML", group: "Suggested", icon: "code", hint: "Code", badge: "New",
    desc: "Start a normal code block with a basic HTML document.", keywords: "html code snippet document doctype",
    run: (block) => insertHtmlDocument(editor, block),
  });
  commands.push({
    key: "embed", label: "Embed", group: "Media", icon: "embed",
    desc: "Paste a link to show an embeddable page in this note.", keywords: "embed website iframe link page",
    run: (block) => insertType(editor, block, "embed"),
  });
  /* Databases: a view of records inside the page, or a page of their own. */
  for (const [kind, label, glyph] of [["table", "Table view", "table"], ["board", "Board view", "panel"], ["gallery", "Gallery view", "image"], ["list", "List view", "list"], ["calendar", "Calendar view", "calendar"]]) {
    commands.push({ key: `${kind}view`, label, group: "Database", icon: glyph, desc: `A new database shown as a ${kind}.`, keywords: `database ${kind} view records`, run: (block) => insertDatabase(editor, block, kind) });
  }
  commands.push({ key: "dbinline", label: "Database - Inline", group: "Database", icon: "table", desc: "A database inside this page.", keywords: "database inline table", run: (block) => insertDatabase(editor, block, "table") });
  commands.push({ key: "dbfull", label: "Database - Full page", group: "Database", icon: "table", desc: "A database on its own page, linked here.", keywords: "database full page", run: (block) => insertDatabase(editor, block, "table", { fullPage: true }) });
  commands.push({
    key: "dblinked", label: "Linked view of data source", group: "Database", icon: "link", desc: "Show a database you already have.", keywords: "database linked view existing source",
    run: (block) => openSearch({ title: "Link a database", filterKinds: ["database"], onSelect: (page) => {
      if (page.kind && page.kind !== "database") { toast("Choose a database"); return; }
      editor.turnInto(block, "database"); block.props = { pageId: String(page.page_id || page.id) }; block.__dirty = true; editor.render(); editor.commit("database", true);
    } }),
  });
  /* Columns, two to five wide, as Notion lists them. */
  for (const count of [2, 3, 4, 5]) {
    commands.push({ key: `columns${count}`, label: `${count} columns`, group: "Advanced blocks", icon: "panel", desc: `Place blocks side by side in ${count} columns.`, keywords: `columns layout ${count}`, run: (block) => editor.splitIntoColumns(block, count) });
  }
  /* Notion places meeting capture in both Suggested and Advanced. Keep both
     entry points: the first is discoverable; this one remains where people
     scan the complete block catalogue. */
  commands.push({
    key: "meetingnotes-advanced", label: "AI Meeting Notes", group: "Advanced blocks", icon: "mic",
    desc: "Record a meeting or lecture and turn it into notes.", keywords: "ai meeting record transcript summary notes lecture",
    run: () => editor.onGenerate?.("lecture", { pageId: editor.page.id }),
  });
  /* Inline: mentions and dates, which land inside a line of text. */
  for (const [key, label, glyph, desc] of [["mentionperson", "Mention a person", "users", "Tag someone right in the text."], ["mentionpage", "Mention a page or data source", "page", "Link a page right in the text."], ["datemention", "Date or reminder", "calendar", "Today, tomorrow, or a date you pick."]]) {
    commands.push({ key, label, group: "Inline", icon: glyph, desc, keywords: "mention person people date reminder page link @", run: (block) => editor.startMention(block) });
  }
  commands.push(...extraCommands(editor));
  commands.push({
    key: "lecture", label: "Lecture notes", group: "Study", icon: "mic",
    desc: "Record and transcribe a lecture.", keywords: "record audio transcript class",
    run: () => editor.onGenerate?.("lecture", { pageId: editor.page.id }),
  });
  return commands;
}

const BASIC_HTML_DOCUMENT = "<!doctype html>\n<html lang=\"en\">\n<head>\n  <meta charset=\"utf-8\">\n  <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n  <title>Untitled document</title>\n</head>\n<body>\n  <main>\n    <h1>Hello, Clyra</h1>\n    <p>Start building your page here.</p>\n  </main>\n</body>\n</html>";

/* HTML is just code: it gets the same renderer, language picker and copy
   controls as every other code block. It never mounts an iframe or runs it. */
function insertHtmlDocument(editor, block) {
  editor.turnInto(block, "code");
  block.props = { ...block.props, language: "html" };
  block.text = [{ t: BASIC_HTML_DOCUMENT }];
  block.__dirty = true;
  editor.insertAfter(block, editor.blank());
  editor.render({ id: block.id, offset: "end" });
  editor.commit("html-code", true);
}

const VIEW_NAME = { table: "Table", board: "Board", gallery: "Gallery", list: "List", calendar: "Calendar" };

/* Make a new database and put it where the "/" was: as a view inside the page, or as its own page with a link here. */
async function insertDatabase(editor, block, kind, { fullPage = false } = {}) {
  const spec = {
    name: "Untitled database",
    properties: [{ name: "Name", type: "title" }, { name: "Status", type: "status" }, { name: "Date", type: "date" }, { name: "Tags", type: "multi_select", options: ["Tag 1", "Tag 2"] }],
    records: [{ Name: "Item one", Status: "Not started" }, { Name: "Item two", Status: "In progress" }, { Name: "Item three", Status: "Done" }],
    views: [{ name: VIEW_NAME[kind] || "Table", type: kind, group: kind === "board" ? "Status" : undefined, date: kind === "calendar" ? "Date" : undefined }],
  };
  const made = await buildDatabase(spec, { parentId: String(editor.page.id), inline: !fullPage });
  if (!made) return;
  editor.turnInto(block, fullPage ? "link_to_page" : "database");
  block.props = { pageId: made.page_id };
  block.__dirty = true;
  editor.insertAfter(block, editor.blank());
  editor.render();
  editor.commit("database", true);
  await refreshPages();
}

function insertType(editor, block, type) {
  if (type === "page") { editor.onCreateChildPage?.(block); return; }
  if (type === "link_to_page") { editor.onLinkPage?.(block); return; }
  if (type === "columns") { editor.splitIntoColumns(block); return; }
  editor.turnInto(block, type);
  /* A dropdown begins as the two places people expect: an always-visible
     heading and a separate detail line nested underneath it. The second line
     is what hides, never the heading itself. */
  if (type.startsWith("toggle")) {
    block.props = { ...block.props, collapsed: false };
    if (!(block.children || []).length) block.children = [editor.blank()];
    editor.render({ id: block.id, offset: "end" });
    editor.commit("toggle", true);
    return;
  }
  /* Media blocks ask for their file or address straight away, instead of leaving an empty chip to click. For "File" that
     picker lists the files already in the workspace first. */
  if (type === "file") setTimeout(() => openFileMenu(editor, block), 160);
  else if (["image", "pdf", "video", "audio", "embed", "bookmark"].includes(type)) setTimeout(() => editor.mediaPrompt(block, null), 30);
  /* Blocks with no text of their own leave a fresh paragraph behind so the
     caret has somewhere to land. */
  if (["divider", "toc", "breadcrumb", "image", "video", "audio", "file", "pdf", "bookmark", "embed", "transcript", "source", "table", "chart"].includes(type)) {
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
    const rect = selectionRectIn(line);
    return rect && (rect.width || rect.height) ? rect : line.getBoundingClientRect();
  };

  const visible = () => {
    const term = query.trim().toLowerCase();
    if (!term) return commands.slice();
    return commands
      .map((command, index) => ({ command, index, rank: matchScore(command.label, command.keywords, term) }))
      .filter((scored) => scored.rank >= 0)
      .sort((a, b) => b.rank - a.rank || a.index - b.index)
      .map((scored) => scored.command);
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
    /* While searching, the group holding the best match leads, so the top row
       of the menu is always the best answer. Idle, the catalogue order is
       what a student learns to scan. */
    const searching = Boolean(query.trim());
    const best = new Map([...groups].map(([group, list]) => [group, matched.indexOf(list[0])]));
    const order = [...groups.keys()].sort((a, b) => searching
      ? best.get(a) - best.get(b)
      : GROUP_ORDER.indexOf(a) - GROUP_ORDER.indexOf(b));
    for (const group of order) {
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
          command.hint ? el("span", { class: "m-sub", text: `\u00B7 ${command.hint}` }) : null,
          command.badge ? el("span", { class: "m-badge", text: command.badge }) : null,
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
