/* The command palette (Cmd/Ctrl+S).

   One box for everything you do around your notes rather than inside one: make a page, a database or a board, jump anywhere, open a
   tool, ask the assistant, change the layout. Type to narrow it, or to find a page by name. Recently used commands float to the top.
   It looks and moves like the command surface in the rest of Clyra: a soft blurred panel, small capital section labels, a rounded
   icon tile on each row, and a gentle slide as you move down the list. */
import { el, clear, icon, matchScore, pushLayer, toast, modal, mod } from "./dom.js";
import { api } from "./api.js";
import { state, refreshPages } from "./state.js";
import { createDatabase } from "./database.js";
import { openSearch } from "./search.js";
import { openPersonalize, openAgentEditor } from "./chat-extras.js";
import { emptyBoard } from "./brainstorm.js";
import { resetTour } from "./views/welcome.js";

const RECENT = "clyra-notes:palette-recent";
const readRecent = () => { try { return JSON.parse(localStorage.getItem(RECENT) || "[]"); } catch { return []; } };
const remember = (id) => { try { localStorage.setItem(RECENT, JSON.stringify([id, ...readRecent().filter((x) => x !== id)].slice(0, 6))); } catch { /* storage off */ } };
const blockId = () => `b${Math.random().toString(36).slice(2, 10)}`;
const makeBlocks = (list) => list.map(([type, text = "", props = {}]) => ({ id: blockId(), type, text: text ? [{ t: text }] : [], props, children: [] }));

async function newPage(app, { title, icon: glyph, blocks }) {
  const created = await api.post("/api/notes/pages", { title, icon: glyph, blocks: makeBlocks(blocks) });
  await refreshPages();
  app.openPage(created.id);
  return created;
}

/* Every command: id, group, label, a few words about it, an icon, optional shortcut text, and what it does. */
export function paletteCommands(app) {
  const pageId = app.currentPageId?.();
  const page = pageId ? state.pageById?.get(String(pageId)) : null;
  const rail = (panel) => () => { if (!app.railOpen?.()) app.toggleRail?.(); app.showRailPanel?.(panel); };
  const day = new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });
  const C = (id, group, label, desc, glyph, run, shortcut = "", keywords = "") => ({ id, group, label, desc, glyph, run, shortcut, keywords: `${label} ${desc} ${keywords}` });
  const list = [
    C("new-page", "Create", "New page", "A blank page", "plus", () => app.createPage(null), `${mod}N`, "blank note write"),
    C("new-database", "Create", "New database", "Table, board, calendar and more", "table", () => createDatabase(app, null), "", "tracker list records"),
    C("new-board", "Create", "New brainstorm board", "A whiteboard for ideas", "target", () => newPage(app, { title: "Brainstorm", icon: "\u{1F9E0}", blocks: [["brainstorm", "", { board: emptyBoard(), tall: true }], ["text"]] }), "", "whiteboard canvas sticky figjam miro mind map"),
    C("new-todo", "Create", "New to-do list", "A page with a checklist ready", "check_square", () => newPage(app, { title: "To-do", icon: "✅", blocks: [["h2", "Today"], ["todo"], ["todo"], ["todo"], ["h2", "This week"], ["todo"], ["todo"]] }), "", "tasks checklist"),
    C("daily-note", "Create", "Daily note", `Today, ${day}`, "calendar", () => newPage(app, { title: day, icon: "☀️", blocks: [["callout", "Three things that would make today a good day.", { icon: "\u{1F3AF}", color: "yellow" }], ["h2", "Top three"], ["numbered"], ["numbered"], ["numbered"], ["h2", "Notes"], ["text"], ["h2", "Shutdown"], ["todo", "Plan tomorrow"]] }), "", "journal today diary plan"),
    C("meeting-note", "Create", "Meeting notes", "Agenda, notes and actions", "mic", () => newPage(app, { title: "Meeting notes", icon: "\u{1F465}", blocks: [["callout", "Write the purpose before, the decisions during.", { icon: "\u{1F465}", color: "blue" }], ["h2", "Agenda"], ["bulleted"], ["h2", "Notes"], ["text"], ["h2", "Decisions"], ["bulleted"], ["h2", "Action items"], ["todo"], ["todo"]] }), "", "agenda minutes"),
    C("record", "Create", "Record or upload a lecture", "Audio becomes a styled note", "mic", () => app.generate?.("lecture", {}), "", "meeting transcribe audio speech"),
    C("new-chat", "Create", "New AI chat", "Ask about all your notes", "comment", () => app.newChat(), "", "assistant"),
    C("new-subject", "Create", "New subject", "Group pages by course or topic", "book", () => app.newSubject()),
    C("from-template", "Create", "New page from a template", "Fifty ready-made pages", "template", () => app.openTemplates(null), "", "gallery"),
    C("import", "Create", "Import", "Markdown, CSV, Word and more", "import", () => app.openImport(null)),

    C("go-home", "Go to", "Home", "Your recent pages", "home", () => app.goHome()),
    C("go-welcome", "Go to", "Welcome tour", "The short interactive tour", "\u{1F44B}", () => app.openView({ kind: "welcome" }), "", "tutorial help"),
    C("go-chat", "Go to", "AI chat", "Full-screen chat", "comment", () => app.openView({ kind: "chat" })),
    C("go-flashcards", "Go to", "Flashcards", "Review what is due", "cards", () => app.openView({ kind: "flashcards" })),
    C("go-tests", "Go to", "Practice tests", "Graded questions", "check_square", () => app.openView({ kind: "tests" })),
    C("go-inbox", "Go to", "Inbox", "Reminders and updates", "inbox", () => app.openView({ kind: "inbox" })),
    C("go-library", "Go to", "Library", "Files and sources", "book", () => app.openView({ kind: "library" })),
    C("go-templates", "Go to", "Templates", "Browse the gallery", "template", () => app.openTemplates(null)),
    C("go-trash", "Go to", "Trash", "Restore or delete pages", "trash", () => app.openTrash()),
    C("go-search", "Go to", "Search pages", "Find anything by words", "search", () => openSearch(), `${mod}P`),
    C("go-settings", "Go to", "Settings", "Preferences and subjects", "settings", () => app.openSettings()),
    C("go-back", "Go to", "Go back", "To the previous page", "arrow_left", () => app.goBack(), `${mod}[`),
    C("go-forward", "Go to", "Go forward", "To the next page", "arrow_right", () => app.goForward(), `${mod}]`),

    C("toggle-sidebar", "View", "Toggle sidebar", "Hide or show the left sidebar", "panel", () => { app.toggleSidebar(); app.tabstrip?.syncRailToggle?.(); }, `${mod}\\`),
    C("toggle-rail", "View", "Toggle tools panel", "Hide or show the right panel", "panel", () => { app.toggleRail(); app.tabstrip?.syncRailToggle?.(); }, `${mod}⇧\\`),
    C("tool-chat", "View", "Chat panel", "Ask about the page you are on", "comment", rail("chat"), "⌃⇧J"),
    C("tool-calculator", "View", "Calculator", "Basic and scientific, in the side panel", "equation", rail("calculator"), "⌃⇧K"),
    C("tool-browser", "View", "Web browser", "Look something up beside your note", "embed", rail("browser"), "⌃⇧B", "internet web"),
    C("tool-outline", "View", "Outline", "Headings of this page", "list", rail("outline"), "⌃⇧O"),
    C("tool-links", "View", "Linked notes", "What links to and from this page", "link", rail("links"), "⌃⇧L", "backlinks"),
    C("tool-comments", "View", "Comments", "Discuss this page or a block", "comments", rail("comments"), "⌃⇧M"),

    C("ai-personalize", "AI", "Personalize AI", "How you want answers written", "sparkle", () => openPersonalize()),
    C("ai-agent", "AI", "New AI agent", "A chat with its own instructions", "plus", () => openAgentEditor(null, () => app.openView({ kind: "chat" }))),

    C("export-all", "Workspace", "Export all notes", "Download everything as Markdown", "export", () => app.exportAll()),
    C("restart-tour", "Workspace", "Restart the welcome tour", "Go through it again", "\u{1F44B}", () => { resetTour(); app.openView({ kind: "welcome" }); }),
    C("shortcuts", "Workspace", "Keyboard shortcuts", "Everything you can press", "keyboard", () => openShortcuts()),
    C("reload", "Workspace", "Reload workspace", "Fetch everything again", "refresh", () => location.reload()),
  ];

  if (page) {
    const refresh = async () => { await refreshPages(); app.toolbar?.render?.(); };
    list.push(
      C("p-ask", "This page", "Ask AI about this page", page.title || "Untitled", "comment", () => app.askAboutPage(page)),
      C("p-flashcards", "This page", "Make flashcards from this page", "Spaced repetition cards", "cards", () => app.generate?.("flashcards", { pageId })),
      C("p-test", "This page", "Make a practice test from this page", "Graded questions", "check_square", () => app.generate?.("questions", { pageId })),
      C("p-guide", "This page", "Make a study guide from this page", "A revision document", "target", () => app.generate?.("study-guide", { pageId })),
      C("p-fav", "This page", page.favorite ? "Remove from favourites" : "Add to favourites", "Pin it in the sidebar", "star", async () => { await api.patch(`/api/notes/pages/${pageId}`, { favorite: !page.favorite }); await refresh(); }),
      C("p-dup", "This page", "Duplicate this page", "Make a copy", "duplicate", async () => { const copy = await api.post(`/api/notes/pages/${pageId}/duplicate`); await refresh(); app.openPage(copy.id); }),
      C("p-link", "This page", "Copy link to this page", "Share a link", "link", () => { navigator.clipboard.writeText(`${location.origin}/notes#${pageId}`); toast("Link copied"); }),
      C("p-export", "This page", "Export this page as Markdown", "Download a .md file", "export", () => app.exportPage(page)),
      C("p-history", "This page", "Version history", "See and restore earlier versions", "history", () => app.versionDialog(page)),
      C("p-lock", "This page", page.locked ? "Unlock this page" : "Lock this page", "Protect it with a passcode", "lock", () => app.lockDialog(page, refresh)),
      C("p-trash", "This page", "Move this page to trash", "You can restore it", "trash", () => app.trashPage(page)),
    );
  }
  return list;
}

function openShortcuts() {
  const rows = [["Command palette", `${mod} S`], ["Search pages", `${mod} P`], ["New page", `${mod} N`], ["Insert a block", "/"], ["Mention a page or date", "@"], ["Ask AI on a blank line", "Space"], ["Toggle sidebar", `${mod} \\`], ["Toggle tools panel", `${mod} ⇧ \\`], ["Chat panel", "⌃ ⇧ J"], ["Calculator", "⌃ ⇧ K"], ["Web browser", "⌃ ⇧ B"], ["Comments", "⌃ ⇧ M"], ["Bold, italic, underline", `${mod} B / I / U`], ["Undo, redo", `${mod} Z / ⇧ ${mod} Z`], ["Back, forward", `${mod} [ / ]`], ["Close tab", `${mod} W`]];
  modal({ title: "Keyboard shortcuts", width: 460, body: el("div", { class: "cp-shortcuts" }, rows.map(([label, keys]) => el("div", { class: "cp-srow" }, el("span", { text: label }), el("kbd", { text: keys })))) });
}

export function openCommandPalette(app) {
  const commands = paletteCommands(app);
  const recent = readRecent();
  let query = "";
  let active = 0;
  let shown = [];
  let entry;

  const input = el("input", { class: "cp-input", type: "text", placeholder: "Type a command or search your pages…", "aria-label": "Command palette", spellcheck: "false", autocomplete: "off" });
  const list = el("div", { class: "cp-list", role: "listbox" });
  const node = el("div", { class: "cp", role: "dialog", "aria-modal": "true", "aria-label": "Command palette" },
    el("div", { class: "cp-field" }, icon("search", 16), input, el("kbd", { class: "cp-esc", text: "esc" })),
    list,
    el("div", { class: "cp-foot" }, el("span", {}, el("kbd", { text: "↑" }), el("kbd", { text: "↓" }), " move"), el("span", {}, el("kbd", { text: "↵" }), " run"), el("span", { class: "cp-count" })));

  const pageResults = (term) => [...state.pages]
    .filter((p) => p.kind !== "record" && !p.inline)
    .map((p) => ({ p, rank: matchScore(p.title || "Untitled", "", term) }))
    .filter((r) => r.rank >= 0).sort((a, b) => b.rank - a.rank).slice(0, 6)
    .map(({ p }) => ({ id: `page-${p.id}`, group: "Pages", label: p.title || "Untitled", desc: p.kind === "database" ? "Database" : "Page", glyph: p.kind === "database" ? "table" : "page", emoji: p.icon && !/^https?:|^\//.test(p.icon) ? p.icon : "", run: () => app.openPage(p.id), shortcut: "" }));

  const compute = () => {
    const term = query.trim().toLowerCase();
    if (!term) {
      const picked = recent.map((id) => commands.find((c) => c.id === id)).filter(Boolean).slice(0, 4).map((c) => ({ ...c, group: "Recent" }));
      const rest = commands.filter((c) => !picked.some((r) => r.id === c.id));
      return [...picked, ...rest];
    }
    const scored = commands.map((c) => ({ c, rank: matchScore(c.label, c.keywords, term) })).filter((r) => r.rank >= 0).sort((a, b) => b.rank - a.rank).map((r) => r.c);
    return [...scored, ...pageResults(term)];
  };

  const paint = () => {
    shown = compute();
    active = Math.min(active, Math.max(0, shown.length - 1));
    clear(list);
    if (!shown.length) list.append(el("div", { class: "cp-empty", text: `Nothing matches "${query}"` }));
    let lastGroup = null;
    shown.forEach((c, index) => {
      if (c.group !== lastGroup) { lastGroup = c.group; list.append(el("div", { class: "cp-head" }, el("span", { text: c.group }))); }
      list.append(el("button", { class: `cp-option${index === active ? " active" : ""}`, type: "button", role: "option", "aria-selected": String(index === active),
        onmouseenter: () => { if (active !== index) { active = index; markActive(); } }, onclick: () => run(c) },
      el("span", { class: "cp-ico" }, c.emoji ? el("span", { text: c.emoji }) : /^[a-z_]+$/i.test(c.glyph) ? icon(c.glyph, 15) : el("span", { text: c.glyph })),
      el("span", { class: "cp-text" }, el("span", { class: "cp-name", text: c.label }), c.desc ? el("span", { class: "cp-desc", text: c.desc }) : null),
      c.shortcut ? el("kbd", { class: "cp-key", text: c.shortcut }) : null));
    });
    node.querySelector(".cp-count").textContent = shown.length ? `${shown.length} ${shown.length === 1 ? "result" : "results"}` : "";
  };
  const markActive = () => {
    [...list.querySelectorAll(".cp-option")].forEach((row, i) => { row.classList.toggle("active", i === active); row.setAttribute("aria-selected", String(i === active)); if (i === active) row.scrollIntoView({ block: "nearest" }); });
  };
  const run = (command) => {
    if (!command.id.startsWith("page-")) remember(command.id);
    entry.close("run");
    /* let the palette finish closing before the command opens its own surface */
    setTimeout(() => { try { const result = command.run(); if (result?.catch) result.catch((error) => toast(error?.message || "That did not work")); } catch (error) { toast(error?.message || "That did not work"); } }, 60);
  };

  input.addEventListener("input", () => { query = input.value; active = 0; paint(); });
  input.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown") { event.preventDefault(); active = Math.min(active + 1, shown.length - 1); markActive(); }
    else if (event.key === "ArrowUp") { event.preventDefault(); active = Math.max(active - 1, 0); markActive(); }
    else if (event.key === "Enter") { event.preventDefault(); if (shown[active]) run(shown[active]); }
    else if (event.key === "Escape") { event.preventDefault(); entry.close("escape"); }
  });

  entry = pushLayer(node, { scrim: true });
  paint();
  requestAnimationFrame(() => input.focus());
  return entry;
}
