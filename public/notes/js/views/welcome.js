/* Welcome: a tutorial you play with, not a note you read.

   Every demo on the page is a small working copy of the real thing (the "/" menu, the AI bar on a blank line, a board you can
   drag, a flashcard that flips), so by the time you open a real page your hands already know it. What you try is ticked off a
   short checklist that is remembered on this device. Nothing here calls the AI or changes your notes; the demos are scripted. */
import { el, clear, icon, append } from "../dom.js";

const KEY = "clyra-notes:welcome";
const TASKS = [
  ["slash", "Use the / menu", "Type / in the first demo and pick a block."],
  ["ai", "Ask AI on a blank line", "Press Space in the second demo."],
  ["board", "Move a card on a board", "Drag a card to another column."],
  ["card", "Flip a flashcard", "Click the card to see the answer."],
  ["templates", "Look at the templates", "Open the gallery of 50."],
];
const read = () => { try { return JSON.parse(localStorage.getItem(KEY) || "{}"); } catch { return {}; } };
const write = (value) => { try { localStorage.setItem(KEY, JSON.stringify(value)); } catch { /* storage off */ } };
const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const sleep = (ms, signal) => new Promise((resolve) => { const t = setTimeout(resolve, reduced() ? Math.min(ms, 30) : ms); signal?.addEventListener("abort", () => { clearTimeout(t); resolve(); }, { once: true }); });

const BLOCKS = [
  ["Heading", "h1", "Large section heading", "#"],
  ["To-do list", "todo", "Track tasks with a checkbox", "[]"],
  ["Bulleted list", "bullet", "A simple bulleted list", "-"],
  ["Callout", "callout", "Make writing stand out", ""],
  ["Quote", "quote", "Set text apart", "\""],
  ["Divider", "divider", "A horizontal rule", "---"],
];

export function renderWelcome(host, app) {
  const abort = new AbortController();
  const { signal } = abort;
  const done = read();
  const refreshers = [];
  const mark = (id) => { if (done[id]) return; done[id] = true; write(done); refreshers.forEach((fn) => fn()); };

  const scroll = el("div", { class: "page-scroll scroll wl-scroll" });
  const column = el("div", { class: "wl-column" });
  scroll.append(column);
  host.append(scroll);

  /* ---------------------------------------------------------- hero */
  const stage = buildStage(signal);
  const hero = el("header", { class: "wl-hero" },
    el("div", { class: "wl-hero-text" },
      el("span", { class: "wl-eyebrow" }, icon("sparkle", 13), "A five minute tour"),
      el("h1", { class: "wl-title", text: "Welcome to Clyra Notes" }),
      el("p", { class: "wl-lead", text: "Write with blocks, ask AI when you are stuck, keep everything in databases, and study from what you wrote. Try each piece below; they all work." }),
      el("div", { class: "wl-cta" },
        el("button", { class: "wl-button primary", type: "button", onclick: () => column.querySelector("#wl-write")?.scrollIntoView({ behavior: reduced() ? "auto" : "smooth", block: "start" }) }, "Start the tour"),
        el("button", { class: "wl-button", type: "button", onclick: () => app.createPage?.(null) }, "Skip to a blank page"))),
    stage);

  /* ------------------------------------------------------- checklist */
  const ring = el("div", { class: "wl-ring" });
  const list = el("ol", { class: "wl-tasks" });
  const paintTasks = () => {
    const count = TASKS.filter(([id]) => done[id]).length;
    ring.style.setProperty("--p", String(count / TASKS.length));
    ring.dataset.label = `${count}/${TASKS.length}`;
    clear(list);
    for (const [id, title, hint] of TASKS) {
      list.append(el("li", { class: `wl-task${done[id] ? " done" : ""}` },
        el("span", { class: "wl-check", "aria-hidden": "true" }, icon("check_square", 14)),
        el("span", { class: "wl-task-text" }, el("strong", { text: title }), el("span", { text: hint }))));
    }
    if (count === TASKS.length) list.append(el("li", { class: "wl-all-done" }, "That is the whole tour. Open a page and write."));
  };
  refreshers.push(paintTasks);
  paintTasks();
  const progress = el("section", { class: "wl-progress wl-reveal", "aria-label": "Your progress" },
    ring, el("div", { class: "wl-progress-body" }, el("h2", { class: "wl-h2", text: "Your first five minutes" }), list));

  /* --------------------------------------------------------- chapters */
  const chapter = (number, id, title, text, demo) => el("section", { class: `wl-chapter wl-reveal${number % 2 === 0 ? " flip" : ""}`, id },
    el("div", { class: "wl-chapter-text" }, el("span", { class: "wl-number", text: String(number).padStart(2, "0") }), el("h2", { class: "wl-h2", text: title }), el("p", { text })),
    el("div", { class: "wl-demo" }, demo));

  const chapters = [
    chapter(1, "wl-write", "Write with blocks", "Everything on a page is a block. Type / on any line to turn it into a heading, a to-do, a callout, a table, a database and more. There are over a hundred.", slashDemo(() => mark("slash"), signal)),
    chapter(2, "wl-ai", "Ask AI on a blank line", "Press Space on an empty line to draft, summarise or continue writing. The result lands as real blocks you can keep, retry or discard.", aiDemo(() => mark("ai"), signal)),
    chapter(3, "wl-data", "Keep it in a database", "Trackers, reading lists and plans are databases. See the same rows as a board, a table or a calendar, and drag cards between columns.", boardDemo(() => mark("board"))),
    chapter(4, "wl-study", "Study from your notes", "Turn any page into flashcards and practice tests, then review what is due. Scheduling adapts to how well you remember each card.", cardDemo(() => mark("card"))),
    chapter(5, "wl-templates", "Start from a template", "Fifty free templates cloned from Notion's most popular: planners, trackers, class notes, CRMs and more, each with its databases ready.", templatesDemo(() => { mark("templates"); app.openTemplates?.(null); })),
  ];

  /* -------------------------------------------------------- shortcuts */
  const keys = el("section", { class: "wl-keys wl-reveal" },
    el("h2", { class: "wl-h2", text: "Keys worth learning" }),
    el("div", { class: "wl-keygrid" }, [
      ["/", "Insert any block"], ["@", "Mention a page or date"], ["Space", "Ask AI on a blank line"], ["⌘ K", "Search everything"], ["⌘ J", "Open the AI chat panel"], ["⌃⇧ M", "Comments"],
    ].map(([keycap, text]) => el("div", { class: "wl-key" }, el("kbd", { text: keycap }), el("span", { text })))));

  const outro = el("footer", { class: "wl-outro wl-reveal" },
    el("h2", { class: "wl-h2", text: "Ready when you are" }),
    el("div", { class: "wl-cta" },
      el("button", { class: "wl-button primary", type: "button", onclick: () => app.createPage?.(null) }, "Create a page"),
      el("button", { class: "wl-button", type: "button", onclick: () => app.newChat?.() }, "Open AI chat"),
      el("button", { class: "wl-button", type: "button", onclick: () => app.openTemplates?.(null) }, "Browse templates")));

  append(column, hero, progress, ...chapters, keys, outro);

  /* Sections ease in as they scroll into view. */
  const io = "IntersectionObserver" in window && !reduced()
    ? new IntersectionObserver((entries) => { for (const entry of entries) if (entry.isIntersecting) { entry.target.classList.add("in"); io.unobserve(entry.target); } }, { root: scroll, threshold: 0.12 })
    : null;
  column.querySelectorAll(".wl-reveal").forEach((node) => (io ? io.observe(node) : node.classList.add("in")));

  return { destroy() { abort.abort(); io?.disconnect(); } };
}

/* ------------------------------------------------------------ hero stage */

/* A looping picture of the product: a line is typed, "/" opens the menu, a block is chosen, Space opens AI, a draft arrives. */
function buildStage(signal) {
  const title = el("div", { class: "wl-s-title" });
  const lineA = el("div", { class: "wl-s-line" });
  const lineB = el("div", { class: "wl-s-line" });
  const menu = el("div", { class: "wl-s-menu" }, BLOCKS.slice(0, 4).map(([label, glyph]) => el("div", { class: "wl-s-item" }, icon(glyph === "h1" ? "h1" : glyph === "todo" ? "check_square" : glyph === "bullet" ? "bullet" : "callout", 14), el("span", { text: label }))));
  const bar = el("div", { class: "wl-s-ai" }, el("i", { class: "wl-s-mark" }), el("span", { class: "wl-s-ai-text" }));
  const result = el("div", { class: "wl-s-result" }, ["Day 1: tiles and trams", "Day 2: Belem and the coast", "Day 3: food and fado"].map((text) => el("div", { class: "wl-s-r", text })));
  const stage = el("div", { class: "wl-stage", "aria-hidden": "true" },
    el("div", { class: "wl-s-glow" }),
    el("div", { class: "wl-s-card" }, el("div", { class: "wl-s-dots" }, el("i"), el("i"), el("i")), title, lineA, lineB, menu, bar, result));

  async function type(node, text, speed = 38) { for (let i = 1; i <= text.length && !signal.aborted; i += 1) { node.textContent = text.slice(0, i); await sleep(speed, signal); } }
  async function play() {
    while (!signal.aborted) {
      [title, lineA, lineB].forEach((node) => { node.textContent = ""; node.className = node.className.replace(" todo", ""); });
      stage.classList.remove("menu", "ai", "result"); bar.querySelector(".wl-s-ai-text").textContent = ""; menu.dataset.active = "0";
      await sleep(500, signal); await type(title, "Trip to Lisbon", 55); await sleep(300, signal);
      lineA.textContent = "/"; stage.classList.add("menu"); await sleep(700, signal);
      for (const index of [1, 2]) { menu.dataset.active = String(index); await sleep(380, signal); }
      menu.dataset.active = "1"; await sleep(420, signal);
      stage.classList.remove("menu"); lineA.textContent = ""; lineA.classList.add("todo"); await type(lineA, "Book tram 28 tickets", 34); await sleep(500, signal);
      stage.classList.add("ai"); await type(bar.querySelector(".wl-s-ai-text"), "Plan three days", 52); await sleep(450, signal);
      stage.classList.add("result"); await sleep(3600, signal);
      stage.classList.remove("ai", "result"); await sleep(600, signal);
    }
  }
  play();
  return stage;
}

/* ----------------------------------------------------------------- demos */

/* The "/" menu on a line you can type in. */
function slashDemo(onDone, signal) {
  const page = el("div", { class: "wl-editor" });
  const first = line("Try typing a slash on the next line");
  const input = line("", { placeholder: "Type '/' for blocks" });
  append(page, first, input);
  let pop = null, active = 0, matches = BLOCKS;

  function line(text, options = {}) {
    const node = el("div", { class: "wl-line", contenteditable: options.placeholder ? "true" : "false", spellcheck: "false", "data-placeholder": options.placeholder || "" });
    node.textContent = text;
    return node;
  }
  const closeMenu = () => { pop?.remove(); pop = null; };
  const query = () => { const value = input.textContent; return value.startsWith("/") ? value.slice(1).toLowerCase() : null; };
  const paint = () => {
    const q = query();
    if (q === null) { closeMenu(); return; }
    matches = BLOCKS.filter(([label]) => label.toLowerCase().includes(q));
    active = Math.min(active, Math.max(0, matches.length - 1));
    if (!pop) { pop = el("div", { class: "wl-menu", role: "listbox" }); page.append(pop); }
    clear(pop);
    pop.append(el("div", { class: "wl-menu-label", text: q ? "Results" : "Basic blocks" }));
    if (!matches.length) pop.append(el("div", { class: "wl-menu-empty", text: "No blocks match" }));
    matches.forEach(([label, glyph, desc, shortcut], index) => pop.append(el("button", {
      class: `wl-menu-row${index === active ? " active" : ""}`, type: "button", role: "option",
      onmouseenter: () => { active = index; paint(); }, onmousedown: (event) => { event.preventDefault(); choose(matches[index]); },
    }, el("span", { class: "wl-menu-icon" }, icon({ h1: "h1", todo: "check_square", bullet: "bullet", callout: "callout", quote: "quote", divider: "divider" }[glyph], 15)),
      el("span", { class: "wl-menu-name", text: label }), shortcut ? el("span", { class: "wl-menu-md", text: shortcut }) : null)));
    pop.append(el("div", { class: "wl-menu-foot" }, el("span", { text: "Close menu" }), el("kbd", { text: "esc" })));
  };
  function choose([label, glyph]) {
    closeMenu();
    const block = el("div", { class: `wl-block wl-block-${glyph}` });
    const text = { h1: "A heading you made with /", todo: "A to-do you can tick", bullet: "A bulleted point", callout: "A callout draws the eye", quote: "A quote stands apart", divider: "" }[glyph];
    if (glyph === "todo") block.append(el("button", { class: "wl-todo-box", type: "button", "aria-label": "Tick", onclick: (event) => event.currentTarget.parentElement.classList.toggle("ticked") }, icon("check_square", 11)));
    if (glyph === "callout") block.append(el("span", { class: "wl-callout-icon", text: "\u{1F4A1}" }));
    if (glyph === "divider") block.append(el("hr")); else block.append(el("span", { class: "wl-block-text", text }));
    input.before(block);
    input.textContent = ""; input.focus();
    onDone();
  }
  input.addEventListener("input", () => { active = 0; paint(); });
  input.addEventListener("keydown", (event) => {
    if (!pop) return;
    if (event.key === "ArrowDown") { event.preventDefault(); active = Math.min(active + 1, matches.length - 1); paint(); }
    else if (event.key === "ArrowUp") { event.preventDefault(); active = Math.max(active - 1, 0); paint(); }
    else if (event.key === "Enter" && matches[active]) { event.preventDefault(); choose(matches[active]); }
    else if (event.key === "Escape") { event.preventDefault(); input.textContent = ""; closeMenu(); }
  });
  input.addEventListener("blur", () => setTimeout(() => { if (document.activeElement !== input) closeMenu(); }, 120));
  signal.addEventListener("abort", closeMenu, { once: true });
  return el("div", { class: "wl-card" }, page, el("p", { class: "wl-demo-hint" }, "Type ", el("kbd", { text: "/" }), " then ", el("kbd", { text: "↑" }), el("kbd", { text: "↓" }), el("kbd", { text: "↵" })));
}

/* Space on a blank line opens the AI bar; a scripted draft streams in. */
function aiDemo(onDone, signal) {
  const line = el("div", { class: "wl-line wl-ai-line", tabindex: "0", role: "textbox", "aria-label": "A blank line. Press Space.", "data-placeholder": "Press 'space' for AI, '/' for commands" });
  const stageBox = el("div", { class: "wl-ai-stage" });
  const wrap = el("div", { class: "wl-editor" }, el("div", { class: "wl-line", text: "Meeting with the design team" }), line, stageBox);
  let busy = false;

  const open = () => {
    if (busy || stageBox.firstChild) return;
    const input = el("div", { class: "wl-ai-input" }, el("span", { class: "wl-ai-avatar" }, el("i", { class: "wl-s-mark" })), el("span", { class: "wl-ai-prompt", "data-placeholder": "Edit with AI" }), el("span", { class: "wl-ai-send" }, icon("arrow_up", 14)));
    const chips = el("div", { class: "wl-ai-chips" }, ["Summarise the meeting", "Draft an agenda", "List action items"].map((label) => el("button", { class: "wl-chip", type: "button", onclick: () => run(label) }, label)));
    stageBox.append(input, chips);
    requestAnimationFrame(() => stageBox.classList.add("open"));
    onDone();
  };
  async function run(label) {
    if (busy) return; busy = true;
    const prompt = stageBox.querySelector(".wl-ai-prompt"); stageBox.querySelector(".wl-ai-chips")?.remove();
    for (let i = 1; i <= label.length && !signal.aborted; i += 1) { prompt.textContent = label.slice(0, i); await sleep(24, signal); }
    stageBox.querySelector(".wl-ai-send")?.classList.add("on");
    await sleep(350, signal);
    const out = el("div", { class: "wl-ai-out" }, el("div", { class: "wl-shimmer" }), el("div", { class: "wl-shimmer short" }));
    stageBox.append(out); await sleep(1100, signal);
    const lines = { "Summarise the meeting": ["The team agreed the new onboarding flow ships in two weeks.", "Open risks: copy is not final and analytics are not wired up.", "Next step: design reviews the mocks on Thursday."], "Draft an agenda": ["1. Where we are (5 min)", "2. Open decisions (15 min)", "3. Owners and dates (10 min)"], "List action items": ["Sam to finish the copy by Wednesday", "Priya to wire analytics events", "Jo to book the Thursday review"] }[label];
    clear(out);
    for (const text of lines) { const row = el("div", { class: "wl-ai-row", text }); out.append(row); await sleep(420, signal); }
    out.append(el("div", { class: "wl-ai-actions" }, el("button", { class: "wl-button primary small", type: "button", onclick: reset }, "Accept"), el("button", { class: "wl-button small", type: "button", onclick: reset }, "Discard")));
    busy = false;
  }
  function reset() { clear(stageBox); stageBox.classList.remove("open"); busy = false; line.focus(); }
  line.addEventListener("keydown", (event) => { if (event.key === " ") { event.preventDefault(); open(); } else if (event.key === "Escape") reset(); });
  line.addEventListener("click", () => line.focus());
  return el("div", { class: "wl-card" }, wrap, el("p", { class: "wl-demo-hint" }, "Click the blank line, then press ", el("kbd", { text: "Space" }), el("button", { class: "wl-inline-button", type: "button", onclick: open }, "or press here")));
}

/* One set of cards, three ways to see it. */
function boardDemo(onDone) {
  const columns = [["Not started", ["Outline the essay", "Read chapter 4"]], ["In progress", ["Lab report"]], ["Done", ["Book exam slot"]]];
  const rows = columns.flatMap(([status, cards]) => cards.map((title, index) => ({ title, status, due: ["Nov 6", "Nov 9", "Nov 12", "Nov 14"][(index + status.length) % 4] })));
  const body = el("div", { class: "wl-db-body" });
  let view = "Board";
  const paint = () => {
    clear(body);
    if (view === "Board") {
      const board = el("div", { class: "wl-board" });
      for (const [status] of columns) {
        const col = el("div", { class: "wl-col" }, el("div", { class: "wl-col-head" }, el("span", { class: `wl-pill s${columns.findIndex(([name]) => name === status)}`, text: status }), el("span", { class: "wl-count", text: String(rows.filter((r) => r.status === status).length) })));
        const drop = el("div", { class: "wl-drop" });
        rows.filter((r) => r.status === status).forEach((row) => {
          const card = el("div", { class: "wl-dcard", draggable: "true" }, el("span", { text: row.title }), el("small", { text: row.due }));
          card.addEventListener("dragstart", (event) => { event.dataTransfer.setData("text/plain", row.title); card.classList.add("dragging"); });
          card.addEventListener("dragend", () => card.classList.remove("dragging"));
          drop.append(card);
        });
        col.addEventListener("dragover", (event) => { event.preventDefault(); col.classList.add("over"); });
        col.addEventListener("dragleave", () => col.classList.remove("over"));
        col.addEventListener("drop", (event) => { event.preventDefault(); const row = rows.find((r) => r.title === event.dataTransfer.getData("text/plain")); if (row && row.status !== status) { row.status = status; onDone(); paint(); } });
        col.append(drop); board.append(col);
      }
      body.append(board);
    } else if (view === "Table") {
      body.append(el("table", { class: "wl-table" }, el("thead", {}, el("tr", {}, ["Name", "Status", "Due"].map((h) => el("th", { text: h })))), el("tbody", {}, rows.map((r) => el("tr", {}, el("td", { text: r.title }), el("td", {}, el("span", { class: `wl-pill s${columns.findIndex(([n]) => n === r.status)}`, text: r.status })), el("td", { text: r.due }))))));
    } else {
      const grid = el("div", { class: "wl-cal" }, ["M", "T", "W", "T", "F", "S", "S"].map((d) => el("div", { class: "wl-cal-dow", text: d })));
      for (let day = 4; day <= 17; day += 1) grid.append(el("div", { class: "wl-cal-day" }, el("span", { text: String(day) }), ...rows.filter((r) => r.due === `Nov ${day}`).map((r) => el("em", { text: r.title }))));
      body.append(grid);
    }
  };
  const tabs = el("div", { class: "wl-tabs", role: "tablist" }, ["Board", "Table", "Calendar"].map((name) => el("button", { class: `wl-tab${name === view ? " active" : ""}`, type: "button", role: "tab", onclick: (event) => { view = name; tabs.querySelectorAll(".wl-tab").forEach((t) => t.classList.toggle("active", t === event.currentTarget)); paint(); } }, name)));
  paint();
  return el("div", { class: "wl-card" }, el("div", { class: "wl-db-title", text: "Assignments" }), tabs, body, el("p", { class: "wl-demo-hint" }, "Drag a card to another column, or switch the view."));
}

/* Flashcards that flip, then ask how well you knew it. */
function cardDemo(onDone) {
  const deck = [["What does a callout block do?", "Draws the eye to a note with an icon and a tinted background."], ["How do you open AI on a blank line?", "Press Space."], ["What is a database view?", "A way of showing the same records: board, table, calendar and more."]];
  let index = 0, flipped = false;
  const face = el("div", { class: "wl-flash", role: "button", tabindex: "0", "aria-label": "Flip the card" });
  const rate = el("div", { class: "wl-rate", hidden: true }, [["Again", "r1"], ["Good", "r2"], ["Easy", "r3"]].map(([label, tone]) => el("button", { class: `wl-rate-btn ${tone}`, type: "button", onclick: () => next() }, label)));
  const count = el("span", { class: "wl-flash-count" });
  const paint = () => { face.classList.toggle("flipped", flipped); face.replaceChildren(el("div", { class: "wl-flash-side front" }, deck[index][0]), el("div", { class: "wl-flash-side back" }, deck[index][1])); count.textContent = `${index + 1} / ${deck.length}`; rate.hidden = !flipped; };
  const flip = () => { flipped = !flipped; if (flipped) onDone(); paint(); };
  const next = () => { flipped = false; index = (index + 1) % deck.length; paint(); };
  face.addEventListener("click", flip);
  face.addEventListener("keydown", (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); flip(); } });
  paint();
  return el("div", { class: "wl-card" }, count, face, rate, el("p", { class: "wl-demo-hint" }, "Click the card to flip it."));
}

function templatesDemo(onOpen) {
  const tiles = [["📋", "Weekly Planner", "#e8f0fe"], ["🎓", "University Planner", "#e4f4ec"], ["💰", "Expense Tracker", "#fff1e0"], ["🧠", "Cornell Notes", "#f1ebfa"], ["🍳", "Recipe Book", "#fdebea"], ["📈", "Gantt Chart", "#e6f6fb"]];
  return el("div", { class: "wl-card" },
    el("div", { class: "wl-tiles" }, tiles.map(([emoji, name, tint], index) => el("button", { class: "wl-tile", type: "button", style: { "--tint": tint, "--i": String(index) }, onclick: onOpen }, el("span", { class: "wl-tile-emoji", text: emoji }), el("span", { class: "wl-tile-name", text: name })))),
    el("button", { class: "wl-button primary", type: "button", onclick: onOpen }, icon("template", 15), "Browse all 50 templates"));
}
