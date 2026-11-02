/* Welcome: a short tour you do, one screen at a time.

   It opens on a calm "Welcome" screen; Space (or the button) starts the tour. After that there is nothing to scroll. A bar along
   the top shows how far along you are, each step is one idea with a line or two of explanation and something to try, and the
   thing to try is the real thing: the same editor, "/" menu, AI composer, chat, database, whiteboard and tools you will use on
   your own pages. The last step asks for your first note and opens it. Finish the tour once and Welcome says everything is sorted;
   close it half way and it starts over the next time. The practice page it writes to is an ordinary page called "Practice page". */
import { el, clear, icon, append, toast } from "../dom.js";
import { api } from "../api.js";
import { state, loadPage, refreshPages } from "../state.js";
import { Editor, makeBlock, serializeTree } from "../editor.js";
import { plain } from "../richtext.js";
import { DatabaseView, buildDatabase } from "../database.js";
import { Brainstorm } from "../brainstorm.js";
import { renderChat } from "./chat.js";
import { TEMPLATES } from "../templates-data.js";

const PRACTICE = "clyra-notes:welcome-practice";
const DEMO_DB = "clyra-notes:welcome-db";
const WAVE = "\u{1F44B}";
const remembered = (key) => { try { return localStorage.getItem(key); } catch { return null; } };
const remember = (key, value) => { try { localStorage.setItem(key, value); } catch { /* storage off */ } };
/* Whether the tour has been seen and finished lives with the workspace (not in one browser), so Notes in the browser and in the
   desktop app agree, and the workspace can be put back to "first time" from one place. */
const tourState = { seen: false, done: false };
export async function loadTourState() {
  const found = await api.get("/api/notes/meta/tour").catch(() => null);
  try { Object.assign(tourState, JSON.parse(found?.value || "{}")); } catch { /* an unreadable flag counts as unseen */ }
  return tourState;
}
export const tourSeen = () => tourState.seen;
function saveTour(patch) { Object.assign(tourState, patch); api.put("/api/notes/meta/tour", { value: JSON.stringify({ seen: tourState.seen, done: tourState.done }) }).catch(() => {}); }
const finished = () => tourState.done;
const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const SVG = "http://www.w3.org/2000/svg";

/* Start the tour from the top again. */
export function resetTour() { session = null; saveTour({ done: false }); }

/* A plain tick that draws itself: a blue disc with a check, nothing else inside. */
function tick(size = 11) {
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("viewBox", "0 0 20 20"); svg.setAttribute("width", String(size)); svg.setAttribute("height", String(size)); svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS(SVG, "path");
  path.setAttribute("d", "M5 10.5l3.4 3.4L15 6.6");
  svg.append(path);
  return svg;
}

/* A title whose words rise in one after another. */
const words = (text) => text.split(" ").flatMap((word, i) => [el("span", { class: "wl-w", style: { "--w": String(i) } }, el("span", { text: word })), " "]).slice(0, -1);

/* The page the editor steps write to: made once, emptied and seeded at the start of each step. */
async function practicePage(seed = []) {
  let page = null;
  const known = remembered(PRACTICE);
  if (known) page = await loadPage(known, { force: true }).catch(() => null);
  if (!page || page.trashed_at) {
    /* an earlier tour (or another device's) may already have made it */
    const existing = (await api.get("/api/notes/pages").catch(() => [])).find((entry) => entry.title === "Practice page" && entry.icon === "\u{1F393}" && !entry.trashed_at);
    if (existing) remember(PRACTICE, existing.id);
    else {
      const made = await api.post("/api/notes/pages", { title: "Practice page", icon: "\u{1F393}", blocks: [] });
      remember(PRACTICE, made.id);
      refreshPages();
    }
  }
  const id = remembered(PRACTICE);
  const blocks = serializeTree([...seed.map((text) => makeBlock("text", plain(text))), makeBlock()]);
  await api.put(`/api/notes/pages/${id}/blocks`, { blocks });
  return loadPage(id, { force: true });
}

/* A small database to play with: made once, hidden from the sidebar like any inline database. */
async function demoDatabase() {
  const known = remembered(DEMO_DB);
  if (known) { const found = await api.get(`/api/notes/pages/${known}/database`).catch(() => null); if (found) return known; }
  const old = (await api.get("/api/notes/pages").catch(() => [])).find((entry) => entry.kind === "database" && entry.title === "Tour tasks" && entry.inline && !entry.trashed_at);
  if (old) { remember(DEMO_DB, old.id); return old.id; }
  const spec = {
    name: "Tour tasks",
    properties: [{ name: "Task", type: "title" }, { name: "Status", type: "status", options: ["To do", "Doing", "Done"] }, { name: "Due", type: "date" }, { name: "Area", type: "select", options: ["Study", "Work", "Home"] }],
    records: [
      { Task: "Outline the essay", Status: "To do", Due: { offsetDays: 2 }, Area: "Study" },
      { Task: "Read chapter 4", Status: "To do", Due: { offsetDays: 4 }, Area: "Study" },
      { Task: "Send the weekly update", Status: "Doing", Due: { offsetDays: 1 }, Area: "Work" },
      { Task: "Book the dentist", Status: "Done", Due: { offsetDays: -1 }, Area: "Home" },
    ],
    views: [{ name: "Board", type: "board", group: "Status" }, { name: "Table", type: "table" }, { name: "Calendar", type: "calendar", date: "Due" }],
  };
  const made = await buildDatabase(spec, { parentId: null, inline: true });
  if (!made) return null;
  remember(DEMO_DB, made.page_id);
  return made.page_id;
}

/* Where you are in the tour while its tab stays open. Opening a template or another tool in a new tab and coming back picks up
   where you left off; closing the tab (or leaving it for another page) drops this, so the next time it starts from the top. */
let session = null;
export const markTourSeen = () => saveTour({ seen: true });

export function renderWelcome(host, app) {
  const abort = new AbortController();
  const { signal } = abort;
  const tabId = state.activeTab;
  const resume = session && session.tabId === tabId ? session : null;
  session = null;
  /* What has been tried this time round. */
  const done = resume ? resume.done : {};
  let index = resume ? resume.index : 0;
  let cleanup = null;
  let busy = false;
  let started = Boolean(resume);
  let sorted = !resume && finished();

  const mark = (id) => { if (done[id]) return; done[id] = true; paintTasks(true); };
  const openRail = (panel) => { if (!app.railOpen?.()) app.toggleRail?.(); app.showRailPanel?.(panel); };

  /* ------------------------------------------------------------- steps */
  const editorStep = (seed, focusLast, watch) => async (stage) => {
    const page = await practicePage(seed);
    if (signal.aborted) return () => {};
    const shell = el("div", { class: "wl-page" }, el("h3", { class: "wl-page-title", text: "Practice page" }), el("div", { class: "editor-host" }));
    stage.append(shell);
    const editor = new Editor(shell.querySelector(".editor-host"), { page, onNavigate: (id, options) => app.openPage(id, options) });
    editor.onGenerate = (kind, target) => app.generate?.(kind, target);
    editor.onChange = () => watch?.(editor, shell);
    const observer = new MutationObserver(() => watch?.(editor, shell));
    observer.observe(shell, { childList: true, subtree: true });
    requestAnimationFrame(() => { const lines = shell.querySelectorAll(".text-line"); (focusLast ? lines[lines.length - 1] : lines[0])?.focus(); });
    return () => { observer.disconnect(); editor.destroy?.(); };
  };

  /* A stack of rows you can press: each opens the real thing. */
  const rowsStep = (rows) => async (stage) => {
    stage.append(el("div", { class: "wl-page wl-krows" }, rows.map(([keys, label, text, action, glyph], i) =>
      el("button", { class: "wl-krow", type: "button", style: { "--i": String(i) }, onclick: action },
        keys.length ? el("span", { class: "wl-kcaps" }, ...keys.map((key) => el("kbd", { text: key }))) : glyph ? el("span", { class: "wl-kicon" }, icon(glyph, 18)) : null,
        el("span", { class: "wl-krow-text" }, el("b", { text: label }), el("small", { text }))))));
    return () => {};
  };

  const toolTiles = (items) => async (stage) => {
    stage.append(el("div", { class: "wl-page wl-features" }, items.map(([glyph, name, text, action, chord], i) =>
      el("button", { class: "wl-feature", type: "button", style: { "--i": String(i) }, onclick: action },
        el("span", { class: "wl-feature-icon" }, icon(glyph, 20)),
        el("span", { class: "wl-feature-name" }, name, chord ? el("kbd", { text: chord }) : null),
        el("span", { class: "wl-feature-text", text })))));
    return () => {};
  };

  const inTab = (view) => app.openView(view, { newTab: true });
  const chord = (key, { shift = false, ctrl = false } = {}) => (event) => event.key.toLowerCase() === key && event.shiftKey === shift && (ctrl ? event.ctrlKey && !event.metaKey : event.metaKey || event.ctrlKey);
  const opened = new Set();
  const noteTool = (panel) => { opened.add(panel); mark("rail"); if (opened.size > 1) mark("rail2"); };
  const useTool = (panel) => { noteTool(panel); openRail(panel); };
  const TOOL_KEYS = { k: "calculator", b: "browser", o: "outline", l: "links", m: "comments", j: "chat" };

  const STEPS = [
    { id: "hello", title: "Welcome", hero: true },
    {
      id: "blocks", title: "Everything is a block", text: "Type / on a line to turn it into a heading, a to-do, a table, a database, a whiteboard and over a hundred more. Keep typing to narrow the list.",
      tasks: [["slash", "Type / and pick a block"]], keys: [["/", "Insert any block"]],
      mount: editorStep([], false, (editor) => { if (editor.blocks.some((block) => block.type !== "text")) mark("slash"); }),
    },
    {
      id: "style", title: "Style and mention", text: "Select words to bold, highlight or link them. Type @ to mention a page or a date that stays linked.",
      tasks: [["style", "Select text and style it"], ["mention", "Type @ and mention a date"]], keys: [["@", "Mention a page or date"], ["⌘ B", "Bold"], ["⌘ I", "Italic"]],
      mount: editorStep(["Select a few of these words, then style them. At the end of this line, type @ to add a date"], false, (editor, shell) => {
        if (editor.blocks.some((block) => (block.text || []).some((span) => span.b || span.i || span.u || span.s || span.c))) mark("style");
        if (shell.querySelector(".date-mention, .page-mention")) mark("mention");
      }),
    },
    {
      id: "speed", title: "Write at speed", text: "Markdown shortcuts work as you type. Start a line with # and a space for a heading, [] and a space for a to-do, - for a bullet or > for a quote.",
      tasks: [["md-h", "Type # and a space"], ["md-todo", "Type [] and a space"]], keys: [["⌘ Z", "Undo"], ["Tab", "Indent a line"]],
      mount: editorStep([], false, (editor) => {
        if (editor.blocks.some((block) => /^h[123]$/.test(block.type))) mark("md-h");
        if (editor.blocks.some((block) => block.type === "todo")) mark("md-todo");
      }),
    },
    {
      id: "ai", title: "Ask AI on a blank line", text: "Press Space on an empty line. Ask it to draft, summarise or continue; you get real blocks to accept, retry or discard.",
      tasks: [["ai-open", "Press Space on the blank line"], ["ai-done", "Send a request and read the answer"]], keys: [["Space", "Open AI on a blank line"]],
      mount: editorStep(["Meeting notes: the team agreed the new onboarding flow ships in two weeks. Copy is not final and analytics are not wired up yet."], true, (editor, shell) => {
        if (shell.querySelector(".ai-composer")) mark("ai-open");
        if (shell.querySelector(".ai-actions:not([hidden]) .ai-action.primary")) mark("ai-done");
      }),
    },
    {
      id: "chat", title: "Chat with your notes", text: "The same assistant lives in three places: a side panel next to any page, a full-screen chat from the sidebar, and the Space bar on a blank line. It reads all your notes, and a chat you start on a page stays with that page.",
      tasks: [["chat", "Send a message below"], ["chat-key", "Press ⌃ ⇧ J for the side panel"]], keys: [["⌃ ⇧ J", "Open the chat panel"]],
      chords: [[chord("j", { shift: true, ctrl: true }), "chat-key"]],
      mount: async (stage) => {
        const box = el("div", { class: "rail-chat wl-chat" });
        stage.append(box);
        const view = renderChat(box, app, { compact: true });
        const observer = new MutationObserver(() => { if (box.querySelector(".chat-row.user")) mark("chat"); });
        observer.observe(box, { childList: true, subtree: true });
        return () => { observer.disconnect(); view?.destroy?.(); };
      },
    },
    {
      id: "data", title: "Keep it in a database", text: "Trackers, plans and reading lists are databases. Drag cards between columns, then switch the same rows to a table or a calendar.",
      tasks: [["drag", "Drag a card to another column"], ["views", "Switch to another view"]], keys: [],
      mount: async (stage) => {
        const pageId = await demoDatabase();
        if (!pageId || signal.aborted) { stage.append(el("div", { class: "wl-empty", text: "The sample database could not be made." })); return () => {}; }
        const shell = el("div", { class: "wl-page" });
        stage.append(shell);
        const view = new DatabaseView(shell, { id: pageId }, { openPage: (id, options) => app.openPage(id, options) }, { embedded: true });
        const onDrop = () => mark("drag");
        const onClick = (event) => { if (event.target.closest(".db-tab") && !event.target.closest(".db-tab.active")) mark("views"); };
        shell.addEventListener("drop", onDrop, true);
        shell.addEventListener("click", onClick);
        return () => { view.destroy?.(); shell.removeEventListener("drop", onDrop, true); shell.removeEventListener("click", onClick); };
      },
    },
    {
      id: "brainstorm", title: "Brainstorm on a board", text: "A whiteboard inside any page. Drop stickies, shapes, notes, pictures and files, then hover an item: four dots appear to drag a connector to another.",
      tasks: [["bs-add", "Add a sticky from the bar below"], ["bs-link", "Drag from a dot to connect two"]], keys: [["/ brainstorm", "Add a board to any page"]],
      mount: async (stage) => {
        const box = el("div", { class: "wl-board" });
        stage.append(box);
        const seed = { items: [
          { id: "t1", type: "sticky", x: 40, y: 50, w: 150, h: 120, color: "white", text: "Idea", z: 1 },
          { id: "t2", type: "sticky", x: 250, y: 190, w: 150, h: 120, color: "white", text: "Next step", z: 2 },
        ], edges: [], cam: { x: 0, y: 0, z: 1 } };
        const board = new Brainstorm(box, { data: seed, openPage: (id, options) => app.openPage(id, options), onChange: (data) => {
          if (data.items.length > 2) mark("bs-add");
          if (data.edges.length > 0) mark("bs-link");
        } });
        return () => board?.destroy?.();
      },
    },
    {
      id: "palette", title: "Do anything from the keyboard", text: "The command palette runs any action from one search box: a new page, a new board, a daily note, anywhere you want to go. Search finds any page by its title or text.",
      tasks: [["palette", "Press ⌘ S for the command palette"], ["search", "Press ⌘ P to search your pages"]], keys: [],
      chords: [[chord("s"), "palette"], [chord("p"), "search"]],
      mount: rowsStep([
        [["⌘", "S"], "Command palette", "Every action in one search box", () => { mark("palette"); app.openCommandPalette?.(); }],
        [["⌘", "P"], "Search pages", "Jump to any note by title or text", () => { mark("search"); app.openSearch?.(); }],
        [["⌘", "N"], "New page", "A blank page, ready to type", () => toast("Press ⌘ N once the tour is done")],
      ]),
    },
    {
      id: "rail", title: "Tools in the right sidebar", text: "Open the tools panel beside any page: a calculator, a web browser, an outline, linked notes, comments and the chat. Each one has its own shortcut.",
      tasks: [["rail", "Open a tool: click one or press its keys"], ["rail2", "Open a second tool"]], keys: [],
      chords: Object.entries(TOOL_KEYS).map(([key, panel]) => [chord(key, { shift: true, ctrl: true }), () => noteTool(panel)]),
      mount: toolTiles([
        ["equation", "Calculator", "Maths and unit sums without leaving the note.", () => useTool("calculator"), "⌃ ⇧ K"],
        ["embed", "Browser", "Look something up in a real browser beside the page.", () => useTool("browser"), "⌃ ⇧ B"],
        ["list", "Outline", "Every heading on the page, one click away.", () => useTool("outline"), "⌃ ⇧ O"],
        ["link", "Linked notes", "What this page links to and what links back.", () => useTool("links"), "⌃ ⇧ L"],
        ["comments", "Comments", "Talk about a block, resolve it when done.", () => useTool("comments"), "⌃ ⇧ M"],
        ["comment", "Chat", "Ask about the page you have open.", () => useTool("chat"), "⌃ ⇧ J"],
      ]),
    },
    {
      id: "move", title: "Move around", text: "Hide the sidebar for focus, open pages in tabs side by side, and step back through where you have been.",
      tasks: [["side", "Hide or show the sidebar"], ["tab", "Open a new tab"]], keys: [],
      chords: [[chord("\\"), "side"], [chord("t"), "tab"]],
      mount: rowsStep([
        [["⌘", "\\"], "Sidebar", "Hide or show your pages", () => { mark("side"); app.toggleSidebar?.(); }],
        [["⌘", "⇧", "\\"], "Tools panel", "Hide or show the right sidebar", () => { app.toggleRail?.(); app.tabstrip?.syncRailToggle?.(); }],
        [["⌘", "T"], "New tab", "Keep this one and start another", () => { mark("tab"); inTab({ kind: "home" }); }],
        [["⌘", "["], "Back", "To the page you came from", () => toast("Press ⌘ [ on any page to go back")],
      ]),
    },
    {
      id: "templates", title: "Start from a template", text: "Fifty free templates cloned from Notion's most popular: planners, trackers, class notes, CRMs. Each arrives with its databases ready.",
      tasks: [["templates", "Open the template gallery"]], keys: [],
      mount: async (stage) => {
        const wanted = ["weekly-planner", "class-notes", "finance-tracker", "habit-tracker", "gantt-chart", "sales-crm"];
        const found = wanted.map((id) => TEMPLATES.find((t) => t.id === id)).filter(Boolean);
        const list = found.length >= 4 ? found : TEMPLATES.filter((t) => t.id !== "blank").slice(0, 6);
        const open = () => { mark("templates"); inTab({ kind: "templates", parentId: null }); };
        stage.append(el("div", { class: "wl-page wl-gallery" },
          el("div", { class: "wl-gallery-grid" }, list.map((template, i) => el("button", { class: "wl-gcard", type: "button", style: { "--i": String(i) }, onclick: open },
            el("span", { class: "wl-gimg" }, el("img", { src: `/notes/img/templates/${template.id}.png`, alt: "", loading: "lazy" })),
            el("span", { class: "wl-gname" }, el("span", { text: template.emoji || "" }), template.name)))),
          el("button", { class: "wl-button primary", type: "button", onclick: open }, icon("template", 15), "Browse all templates")));
        return () => {};
      },
    },
    {
      id: "study", title: "Study and record", text: "Turn any page into flashcards and practice tests. Record or upload a lecture or meeting and Notes writes it up, shaped by what was said.",
      tasks: [["study", "Open flashcards, tests or the recorder"]], keys: [],
      mount: toolTiles([
        ["cards", "Flashcards", "Spaced repetition on cards made from your pages.", () => { mark("study"); inTab({ kind: "flashcards" }); }],
        ["check_square", "Practice tests", "Graded questions in the style you choose.", () => { mark("study"); inTab({ kind: "tests" }); }],
        ["mic", "Meeting and lecture notes", "Record or upload audio; it is transcribed and written up as a styled note.", () => { mark("study"); app.generate?.("lecture", null); }],
      ]),
    },
    {
      id: "organise", title: "Keep it tidy", text: "Group pages into subjects, import from other apps, restore from the trash. Favourites, lock, version history, sharing and export live in the ⋯ menu on any page.",
      tasks: [["tidy", "Try any of these"]], keys: [],
      mount: rowsStep([
        [[], "New subject", "Group pages in the sidebar", () => { mark("tidy"); app.newSubject?.(); }, "plus"],
        [[], "Import", "From Notion, Markdown, Word, CSV and more", () => { mark("tidy"); window.dispatchEvent(new CustomEvent("clyra:open-import", { detail: {} })); }, "import"],
        [[], "Page menu", "Favourite, lock, history, share and export on a page", async () => { mark("tidy"); const page = await practicePage(["Open the ⋯ menu at the top right of this page."]); app.openPage(page.id, { newTab: true }); }, "dots"],
        [[], "Trash", "Restore anything you removed", () => { mark("tidy"); app.openTrash?.(); }, "trash"],
        [[], "Library", "Sources and files in one place", () => { mark("tidy"); inTab({ kind: "library" }); }, "book"],
      ]),
    },
    { id: "finish", title: "Make your first note", finish: true },
  ];
  const LAST = STEPS.length - 1;

  /* ------------------------------------------------------------ layout */
  const barFill = el("i");
  const bar = el("div", { class: "wl-bar", role: "progressbar", "aria-label": "Tour progress", "aria-valuemin": "0", "aria-valuemax": String(STEPS.length - 1) }, barFill);
  const counter = el("span", { class: "wl-counter" });
  const top = el("div", { class: "wl-top" }, el("span", { class: "wl-brand" }, el("span", { class: "wl-brand-emoji", text: WAVE }), "Welcome"), counter,
    el("button", { class: "wl-skip", type: "button", onclick: () => leave(false) }, "Skip tour"));
  const copy = el("div", { class: "wl-copy" });
  const stage = el("div", { class: "wl-stage" });
  const main = el("div", { class: "wl-main" }, copy, stage);
  const back = el("button", { class: "wl-button", type: "button", onclick: () => go(index - 1) }, icon("chevron_left", 14), "Back");
  const next = el("button", { class: "wl-button primary", type: "button", onclick: () => go(index + 1) });
  const dots = el("div", { class: "wl-dots", role: "tablist", "aria-label": "Steps" });
  const nav = el("div", { class: "wl-nav" }, back, dots, next);
  const root = el("div", { class: "wl-root" }, bar, top, main, nav);
  host.append(root);

  /* Skipping leaves the tour unfinished so it starts over next time; "later" on the last step counts as done. */
  function leave(complete) { if (complete) saveTour({ done: true }); app.goHome?.(); }

  function paintTasks(pop) {
    const list = copy.querySelector(".wl-tasks");
    if (!list) return;
    const step = STEPS[index];
    const existing = [...list.children];
    step.tasks.forEach(([id, label], i) => {
      let row = existing[i];
      if (!row) { row = el("li", { class: "wl-task", style: { "--i": String(i) } }, el("span", { class: "wl-check", "aria-hidden": "true" }, tick()), el("span", { class: "wl-task-label", text: label })); list.append(row); }
      const was = row.classList.contains("done");
      row.classList.toggle("done", Boolean(done[id]));
      if (pop && done[id] && !was) row.classList.add("pop");
    });
    const all = step.tasks.length && step.tasks.every(([id]) => done[id]);
    next.classList.toggle("ready", Boolean(all));
  }

  function paintChrome() {
    const step = STEPS[index];
    const intro = index === 0, last = index === LAST;
    root.classList.toggle("is-intro", intro);
    barFill.style.width = `${(index / LAST) * 100}%`;
    bar.setAttribute("aria-valuenow", String(index));
    counter.textContent = intro ? "" : `${index} of ${LAST}`;
    back.hidden = index <= 1;
    nav.hidden = intro || last;
    next.classList.remove("ready");
    clear(next);
    next.append("Next", icon("chevron_right", 14));
    clear(dots);
    STEPS.forEach((entry, i) => { if (i > 0) dots.append(el("button", { class: `wl-dot${i === index ? " active" : ""}${i < index ? " past" : ""}`, type: "button", role: "tab", "aria-selected": String(i === index), "aria-label": entry.title, onclick: () => go(i) })); });
    return step;
  }

  /* ------------------------------------------------------ the poster screens */
  function confetti(parent) {
    if (reduced()) return;
    const palette = ["#2383e2", "#f6c343", "#ee7aa8", "#52b788", "#a78bfa", "#ff9a5c"];
    const layer = el("div", { class: "wl-confetti", "aria-hidden": "true" });
    for (let i = 0; i < 34; i += 1) {
      const angle = (Math.PI * 2 * i) / 34 + Math.random() * 0.3, distance = 90 + Math.random() * 150;
      layer.append(el("i", { style: { "--x": `${Math.cos(angle) * distance}px`, "--y": `${Math.sin(angle) * distance - 40}px`, "--r": `${Math.round(Math.random() * 540 - 270)}deg`, "--c": palette[i % palette.length], "--d": `${Math.round(Math.random() * 120)}ms` } }));
    }
    parent.append(layer);
    setTimeout(() => layer.remove(), 1600);
  }

  const bigTick = () => { const orb = el("div", { class: "wl-orb done", "aria-hidden": "true" }, tick(30)); return orb; };

  function buildIntro() {
    append(copy,
      el("div", { class: "wl-wave", "aria-hidden": "true" }, el("span", { text: WAVE })),
      el("h1", { class: "wl-title hero" }, ...words("Welcome")),
      el("p", { class: "wl-text hero" }, "Study smarter or manage your notes, projects and ideas, all in one calm place."),
      el("button", { class: "wl-press", type: "button", onclick: () => begin() }, "Press ", el("kbd", { text: "Space" }), " to continue"));
  }

  function buildSorted() {
    const orb = bigTick();
    append(copy, orb, el("h1", { class: "wl-title hero" }, ...words("Everything is sorted")),
      el("p", { class: "wl-text hero" }, "You have been through the whole tour. Your notes are ready whenever you are."),
      el("div", { class: "wl-cta" },
        el("button", { class: "wl-button primary", type: "button", onclick: () => app.createPage?.(null) }, icon("plus", 14), "New note"),
        el("button", { class: "wl-button", type: "button", onclick: () => app.openTemplates?.(null) }, "Templates"),
        el("button", { class: "wl-button", type: "button", onclick: () => replay() }, icon("history", 14), "Replay the tour")));
    requestAnimationFrame(() => confetti(copy));
  }

  function buildFinish() {
    const field = el("input", { class: "wl-input", type: "text", placeholder: "Untitled", "aria-label": "Title of your first note", maxlength: "120" });
    const make = el("button", { class: "wl-button primary big", type: "button" }, icon("plus", 14), "Create my note");
    const create = async () => {
      if (make.disabled) return;
      make.disabled = true;
      const title = field.value.trim() || "My first note";
      saveTour({ done: true });
      const page = await app.createPage?.(null, { title });
      if (!page) { make.disabled = false; return; }
      toast("First note created");
    };
    make.addEventListener("click", create);
    field.addEventListener("keydown", (event) => { if (event.key === "Enter") { event.preventDefault(); create(); } });
    append(copy,
      el("div", { class: "wl-wave", "aria-hidden": "true" }, el("span", { text: "✍️" })),
      el("h1", { class: "wl-title hero" }, ...words("Make your first note")),
      el("p", { class: "wl-text hero" }, "That was the tour. Give your first note a name and it opens ready to write."),
      el("div", { class: "wl-first" }, field, make),
      el("div", { class: "wl-cta" }, el("button", { class: "wl-link", type: "button", onclick: () => leave(true) }, "I will do it later")));
    requestAnimationFrame(() => field.focus());
  }

  function buildCopy(step) {
    clear(copy);
    if (sorted) { buildSorted(); return; }
    if (step.hero) { buildIntro(); return; }
    if (step.finish) { buildFinish(); return; }
    append(copy, el("span", { class: "wl-step", text: `Step ${index}` }), el("h1", { class: "wl-title" }, ...words(step.title)), el("p", { class: "wl-text", text: step.text }), el("ul", { class: "wl-tasks" }));
    if (step.keys?.length) copy.append(el("div", { class: "wl-keys" }, step.keys.map(([cap, label]) => el("span", { class: "wl-keyline" }, el("kbd", { text: cap }), label))));
    paintTasks();
  }

  async function show(step) {
    buildCopy(step);
    clear(stage);
    const poster = Boolean(sorted || step.hero || step.finish);
    stage.hidden = poster;
    main.classList.toggle("poster", poster);
    cleanup = !poster && step.mount ? await step.mount(stage) : null;
  }

  /* One step out, the next in: fade and drift, then build the new one. */
  async function go(target) {
    if (busy || sorted || target < 1 || target > LAST || target === index) return;
    busy = true;
    const forward = target > index;
    const nodes = [main];
    const SLIDE = 72;
    if (!reduced()) await Promise.all(nodes.map((node) => node.animate([{ opacity: 1, transform: "none" }, { opacity: 0, transform: `translateX(${forward ? -SLIDE : SLIDE}px)` }], { duration: 230, easing: "cubic-bezier(.4, 0, 1, 1)", fill: "forwards" }).finished.catch(() => {})));
    try { await cleanup?.(); } catch { /* a step that cannot clean up is replaced anyway */ }
    cleanup = null;
    index = target;
    const step = paintChrome();
    await show(step);
    nodes.forEach((node) => node.getAnimations().forEach((animation) => animation.cancel()));
    if (!reduced()) nodes.forEach((node) => node.animate([{ opacity: 0, transform: `translateX(${forward ? SLIDE : -SLIDE}px)` }, { opacity: 1, transform: "none" }], { duration: 520, easing: "cubic-bezier(0.16, 1, 0.3, 1)", fill: "backwards" }));
    busy = false;
  }

  /* From the Welcome screen into step one. */
  async function begin() {
    if (started || busy) return;
    started = true;
    await go(1);
  }

  function replay() {
    resetTour();
    sorted = false; started = false;
    root.classList.remove("is-sorted");
    index = 0;
    const step = paintChrome();
    show(step);
    copy.animate([{ opacity: 0, transform: "translateY(10px)" }, { opacity: 1, transform: "none" }], { duration: 420, easing: "cubic-bezier(0.22, 1, 0.36, 1)" });
  }

  /* Real shortcuts tick their task whether or not the pointer was used. */
  const onChord = (event) => { for (const [test, id] of STEPS[index].chords || []) if (test(event)) { if (typeof id === "function") id(); else mark(id); } };
  document.addEventListener("keydown", onChord, { signal, capture: true });
  const onKey = (event) => {
    if (event.target?.closest?.("input, textarea, select, [contenteditable='true']") || document.querySelector(".layer, .modal, .cp")) return;
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (index === 0 && !sorted && (event.key === " " || event.key === "Enter")) { event.preventDefault(); begin(); return; }
    if (event.key === "ArrowRight") go(index + 1); else if (event.key === "ArrowLeft") go(index - 1);
  };
  document.addEventListener("keydown", onKey, { signal });

  root.classList.toggle("is-sorted", sorted);
  show(paintChrome());
  if (!reduced()) copy.animate([{ opacity: 0, transform: "translateY(12px)" }, { opacity: 1, transform: "none" }], { duration: 520, easing: "cubic-bezier(0.22, 1, 0.36, 1)" });

  return { destroy() {
    abort.abort();
    try { cleanup?.(); } catch { /* ignore */ }
    session = started && !sorted && index > 0 && state.tabs.some((tab) => tab.id === tabId && tab.kind === "welcome") ? { index, done, tabId } : null;
  } };
}
