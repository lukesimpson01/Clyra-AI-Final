/* Welcome: a short tour you do, one screen at a time.

   There is nothing to scroll. A bar along the top shows how far along you are, each step is one idea with a line or two of
   explanation and something to try, and the thing to try is the real thing: the same editor, "/" menu, AI composer, chat,
   database and gallery you will use on your own pages. What you try is ticked off and remembered on this device. The practice
   page it writes to is an ordinary page called "Practice page"; delete it whenever you like. */
import { el, clear, icon, append, toast } from "../dom.js";
import { api } from "../api.js";
import { loadPage, refreshPages } from "../state.js";
import { Editor, makeBlock, serializeTree } from "../editor.js";
import { plain } from "../richtext.js";
import { DatabaseView, buildDatabase } from "../database.js";
import { renderChat } from "./chat.js";
import { TEMPLATES } from "../templates-data.js";

const KEY = "clyra-notes:welcome";
const PRACTICE = "clyra-notes:welcome-practice";
const DEMO_DB = "clyra-notes:welcome-db";
const read = () => { try { return JSON.parse(localStorage.getItem(KEY) || "{}"); } catch { return {}; } };
const write = (value) => { try { localStorage.setItem(KEY, JSON.stringify(value)); } catch { /* storage off */ } };
const remembered = (key) => { try { return localStorage.getItem(key); } catch { return null; } };
const remember = (key, value) => { try { localStorage.setItem(key, value); } catch { /* storage off */ } };
const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

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

export function renderWelcome(host, app) {
  const abort = new AbortController();
  const { signal } = abort;
  const done = read();
  let index = 0;
  let cleanup = null;
  let busy = false;

  const mark = (id) => { if (done[id]) return; done[id] = true; write(done); paintTasks(); };

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

  const STEPS = [
    { id: "hello", title: "Welcome to Clyra Notes", text: "Notes, databases, study tools and AI in one place. This tour takes about five minutes, and you do each part for real.", tasks: [], hero: true },
    {
      id: "blocks", title: "Everything is a block", text: "Type / on a line to turn it into a heading, a to-do, a table, a database and over a hundred more. Keep typing to narrow the list.",
      tasks: [["slash", "Type / and pick a block"]], keys: [["/", "Insert any block"]],
      mount: editorStep([], false, (editor) => { if (editor.blocks.some((block) => block.type !== "text")) mark("slash"); }),
    },
    {
      id: "style", title: "Style and mention", text: "Select words to bold, highlight or link them. Type @ to mention a page or a date that stays linked.",
      tasks: [["style", "Select text and style it"], ["mention", "Type @ and mention a date"]], keys: [["@", "Mention a page or date"], ["⌘ B", "Bold"]],
      mount: editorStep(["Select a few of these words, then style them. At the end of this line, type @ to add a date"], false, (editor, shell) => {
        if (editor.blocks.some((block) => (block.text || []).some((span) => span.b || span.i || span.u || span.s || span.c))) mark("style");
        if (shell.querySelector(".date-mention, .page-mention")) mark("mention");
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
      id: "chat", title: "Chat with your notes", text: "The same assistant lives in three places: a side panel next to any page (⌘ J), a full-screen chat from the sidebar, and the Space bar on a blank line.",
      tasks: [["chat", "Send a message below"]], keys: [["⌘ J", "Open the chat panel"]],
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
      id: "templates", title: "Start from a template", text: "Fifty free templates cloned from Notion's most popular: planners, trackers, class notes, CRMs. Each arrives with its databases ready.",
      tasks: [["templates", "Open the template gallery"]], keys: [],
      mount: async (stage) => {
        const wanted = ["weekly-planner", "class-notes", "finance-tracker", "habit-tracker", "gantt-chart", "sales-crm"];
        const found = wanted.map((id) => TEMPLATES.find((t) => t.id === id)).filter(Boolean);
        const list = found.length >= 4 ? found : TEMPLATES.filter((t) => t.id !== "blank").slice(0, 6);
        const open = () => { mark("templates"); app.openTemplates?.(null); };
        stage.append(el("div", { class: "wl-page wl-gallery" },
          el("div", { class: "wl-gallery-grid" }, list.map((template, i) => el("button", { class: "wl-gcard", type: "button", style: { "--i": String(i) }, onclick: open },
            el("span", { class: "wl-gimg" }, el("img", { src: `/notes/img/templates/${template.id}.png`, alt: "", loading: "lazy" })),
            el("span", { class: "wl-gname" }, el("span", { text: template.emoji || "" }), template.name)))),
          el("button", { class: "wl-button primary", type: "button", onclick: open }, icon("template", 15), "Browse all templates")));
        return () => {};
      },
    },
    {
      id: "study", title: "Study from what you write", text: "Turn any page into flashcards and practice tests, record a lecture into notes, and review what is due. Spaced repetition adapts to how well you remember.",
      tasks: [["study", "Open flashcards or tests"]], keys: [],
      mount: async (stage) => {
        const tile = (glyph, name, text, view) => el("button", { class: "wl-feature", type: "button", onclick: () => { mark("study"); app.openView({ kind: view }); } }, el("span", { class: "wl-feature-icon" }, icon(glyph, 20)), el("span", { class: "wl-feature-name", text: name }), el("span", { class: "wl-feature-text", text }));
        stage.append(el("div", { class: "wl-page wl-features" },
          tile("cards", "Flashcards", "Spaced repetition on cards made from your pages.", "flashcards"),
          tile("check_square", "Practice tests", "Graded questions in the style you choose.", "tests"),
          el("div", { class: "wl-feature static" }, el("span", { class: "wl-feature-icon" }, icon("mic", 20)), el("span", { class: "wl-feature-name", text: "Lecture notes" }), el("span", { class: "wl-feature-text", text: "Type / on any page and choose AI Meeting Notes to record and transcribe." }))));
        return () => {};
      },
    },
    {
      id: "organise", title: "Find and organise", text: "Search everything, comment on blocks, mark favourites, group pages by subject, and import or export when you need to.",
      tasks: [["search", "Open search"]], keys: [],
      mount: async (stage) => {
        const row = (keys, label, action) => el("button", { class: "wl-krow", type: "button", onclick: action }, el("span", { class: "wl-kcaps" }, ...keys.map((key) => el("kbd", { text: key }))), el("span", { text: label }));
        stage.append(el("div", { class: "wl-page wl-krows" },
          row(["⌘", "K"], "Search or ask", () => { mark("search"); app.openSearch?.(); }),
          row(["⌘", "N"], "New page", () => app.createPage?.(null)),
          row(["⌘", "J"], "Chat panel beside a page", () => app.newChat?.()),
          row(["⌃", "⇧", "M"], "Comments on a page or block", () => toast("Open any page, then press ⌃⇧M")),
          row(["⌘", "\\"], "Hide or show the sidebar", () => app.toggleSidebar?.()),
          row(["⌘", "Z"], "Undo anything", () => toast("Works in any page"))));
        return () => {};
      },
    },
    { id: "finish", title: "You are ready", text: "That is the whole app. Your practice page and sample database stay in your workspace so you can keep playing; delete them any time.", tasks: [], finish: true },
  ];

  /* ------------------------------------------------------------ layout */
  const barFill = el("i");
  const bar = el("div", { class: "wl-bar", role: "progressbar", "aria-label": "Tour progress", "aria-valuemin": "0", "aria-valuemax": String(STEPS.length) }, barFill);
  const counter = el("span", { class: "wl-counter" });
  const top = el("div", { class: "wl-top" }, el("span", { class: "wl-brand" }, icon("sparkle", 14), "Welcome tour"), counter,
    el("button", { class: "wl-skip", type: "button", onclick: () => app.goHome?.() }, "Skip tour"));
  const copy = el("div", { class: "wl-copy" });
  const stage = el("div", { class: "wl-stage" });
  const main = el("div", { class: "wl-main" }, copy, stage);
  const back = el("button", { class: "wl-button", type: "button", onclick: () => go(index - 1) }, icon("chevron_left", 14), "Back");
  const next = el("button", { class: "wl-button primary", type: "button", onclick: () => (index === STEPS.length - 1 ? app.goHome?.() : go(index + 1)) });
  const dots = el("div", { class: "wl-dots", role: "tablist", "aria-label": "Steps" });
  const nav = el("div", { class: "wl-nav" }, back, dots, next);
  const root = el("div", { class: "wl-root" }, bar, top, main, nav);
  host.append(root);

  function paintTasks() {
    const list = copy.querySelector(".wl-tasks");
    if (!list) return;
    clear(list);
    for (const [id, label] of STEPS[index].tasks) list.append(el("li", { class: `wl-task${done[id] ? " done" : ""}` }, el("span", { class: "wl-check", "aria-hidden": "true" }, icon("check_square", 13)), el("span", { text: label })));
  }

  function paintChrome() {
    barFill.style.width = `${((index + 1) / STEPS.length) * 100}%`;
    bar.setAttribute("aria-valuenow", String(index + 1));
    counter.textContent = `${index + 1} of ${STEPS.length}`;
    back.hidden = index === 0;
    const last = index === STEPS.length - 1;
    clear(next);
    next.append(last ? "Open my notes" : index === 0 ? "Start the tour" : "Next");
    if (!last) next.append(icon("chevron_right", 14));
    clear(dots);
    STEPS.forEach((entry, i) => dots.append(el("button", { class: `wl-dot${i === index ? " active" : ""}${i < index ? " past" : ""}`, type: "button", role: "tab", "aria-selected": String(i === index), "aria-label": entry.title, onclick: () => go(i) })));
    return STEPS[index];
  }

  function buildCopy(step) {
    clear(copy);
    if (step.hero) {
      append(copy, el("div", { class: "wl-orb", "aria-hidden": "true" }), el("h1", { class: "wl-title hero", text: step.title }), el("p", { class: "wl-text", text: step.text }),
        el("div", { class: "wl-chips" }, ["Blocks", "AI", "Chat", "Databases", "Templates", "Study", "Comments", "Search"].map((label, i) => el("span", { class: "wl-chipx", style: { "--i": String(i) }, text: label }))));
      return;
    }
    if (step.finish) {
      append(copy, el("div", { class: "wl-orb done", "aria-hidden": "true" }), el("h1", { class: "wl-title hero", text: step.title }), el("p", { class: "wl-text", text: step.text }),
        el("div", { class: "wl-cta" },
          el("button", { class: "wl-button primary", type: "button", onclick: () => app.createPage?.(null) }, "Create a page"),
          el("button", { class: "wl-button", type: "button", onclick: () => app.openTemplates?.(null) }, "Browse templates"),
          el("button", { class: "wl-button", type: "button", onclick: () => app.newChat?.() }, "Open AI chat")));
      return;
    }
    append(copy, el("span", { class: "wl-step", text: `Step ${index}` }), el("h1", { class: "wl-title", text: step.title }), el("p", { class: "wl-text", text: step.text }), el("ul", { class: "wl-tasks" }));
    if (step.keys?.length) copy.append(el("div", { class: "wl-keys" }, step.keys.map(([cap, label]) => el("span", { class: "wl-keyline" }, el("kbd", { text: cap }), label))));
    paintTasks();
  }

  async function show(step) {
    buildCopy(step);
    clear(stage);
    const poster = Boolean(step.hero || step.finish);
    stage.hidden = poster;
    main.classList.toggle("poster", poster);
    cleanup = step.mount ? await step.mount(stage) : null;
  }

  /* One step out, the next in: fade and drift, then build the new one. */
  async function go(target) {
    if (busy || target < 0 || target >= STEPS.length || target === index) return;
    busy = true;
    const forward = target > index;
    const nodes = [copy, stage];
    if (!reduced()) await Promise.all(nodes.map((node) => node.animate([{ opacity: 1, transform: "none" }, { opacity: 0, transform: `translateX(${forward ? -14 : 14}px)` }], { duration: 160, easing: "ease-in", fill: "forwards" }).finished.catch(() => {})));
    try { await cleanup?.(); } catch { /* a step that cannot clean up is replaced anyway */ }
    cleanup = null;
    index = target;
    const step = paintChrome();
    await show(step);
    nodes.forEach((node) => node.getAnimations().forEach((animation) => animation.cancel()));
    if (!reduced()) nodes.forEach((node) => node.animate([{ opacity: 0, transform: `translateX(${forward ? 14 : -14}px)` }, { opacity: 1, transform: "none" }], { duration: 280, easing: "cubic-bezier(0.22, 1, 0.36, 1)" }));
    busy = false;
  }

  const onKey = (event) => {
    if (event.target?.closest?.("input, textarea, [contenteditable='true']") || document.querySelector(".layer, .modal")) return;
    if (event.key === "ArrowRight") go(index + 1); else if (event.key === "ArrowLeft") go(index - 1);
  };
  document.addEventListener("keydown", onKey, { signal });

  show(paintChrome());
  if (!reduced()) copy.animate([{ opacity: 0, transform: "translateY(10px)" }, { opacity: 1, transform: "none" }], { duration: 420, easing: "cubic-bezier(0.22, 1, 0.36, 1)" });

  return { destroy() { abort.abort(); try { cleanup?.(); } catch { /* ignore */ } } };
}
