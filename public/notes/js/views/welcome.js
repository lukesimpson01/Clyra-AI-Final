/* Welcome: a short tour you do, one screen at a time.

   It opens on a calm "Welcome" screen; Space (or the button) starts the tour. After that there is nothing to scroll. A bar along
   the top shows how far along you are, each step is one idea with a line or two of explanation and something to try, and the
   thing to try is the real thing: the same editor, "/" menu, AI composer, chat, database, whiteboard and tools you will use on
   your own pages. The last step asks for your first note and opens it. Finish the tour once and Welcome says everything is sorted;
   close it half way and it starts over the next time. The practice page it writes to is an ordinary page called "Practice page". */
import { el, clear, icon, append, toast } from "../dom.js";
import { api } from "../api.js";
import { state } from "../state.js";
import { Brainstorm } from "../brainstorm.js";
import { TEMPLATES } from "../templates-data.js";

const WAVE = "\u{1F44B}";
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
  const inTab = (view, note = true) => { app.openView(view, { newTab: true }); if (note) toast("Opened in a new tab. Come back to Welcome to carry on."); };
  const chord = (key, { shift = false, ctrl = false } = {}) => (event) => event.key.toLowerCase() === key && event.shiftKey === shift && (ctrl ? event.ctrlKey && !event.metaKey : event.metaKey || event.ctrlKey);
  const sidebarItem = (label) => () => [...document.querySelectorAll(".sidebar .page-row, .sidebar .nav-item, .sidebar button")].filter((node) => (node.getAttribute("aria-label") || node.textContent || "").trim().startsWith(label)).slice(0, 1);
  const railKey = (key) => chord(key, { shift: true, ctrl: true });
  const tool = (id, panel, label, key) => [id, label, { run: () => openRail(panel), keys: `⌃ ⇧ ${key.toUpperCase()}` }];

  /* The slash menu, played on a loop: a line, a "/", the real list narrowing as you type, a block appearing. No page needed. */
  const slashDemo = async (stage) => {
    const LIST = [["Text", "text"], ["Heading 1", "h1"], ["Heading 2", "h2"], ["Bulleted list", "list"], ["To-do list", "check_square"], ["Toggle list", "chevron_right"], ["Quote", "quote"], ["Callout", "comment"], ["Table", "table"], ["Code", "code"], ["Divider", "minus"], ["Image", "image"], ["Database", "table"], ["Brainstorm", "target"], ["AI block", "sparkle"]];
    const SHOWS = [{ query: "quote", pick: "Quote", type: "quote", text: "A line worth remembering." }, { query: "head", pick: "Heading 1", type: "h1", text: "Meeting notes" }, { query: "todo", pick: "To-do list", type: "todo", text: "Send the update" }];
    const line = el("div", { class: "wl-sd-line" });
    const menuNode = el("div", { class: "wl-sd-menu", hidden: true });
    stage.append(el("div", { class: "wl-sd" }, el("div", { class: "wl-sd-card" }, line, menuNode), el("p", { class: "wl-sd-cap", text: "Type / on any line" })));
    let alive = true;
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const rows = (query, active) => {
      clear(menuNode);
      const shown = LIST.filter(([name]) => !query || name.toLowerCase().includes(query)).slice(0, 7);
      shown.forEach(([name, glyph], i) => menuNode.append(el("div", { class: `wl-sd-row${name === active || (!active && i === 0) ? " on" : ""}` }, icon(glyph, 16), el("span", { text: name }))));
      return shown;
    };
    const type = async (target, text, speed = 55) => { for (const char of text) { if (!alive) return; target.textContent += char; await sleep(speed); } };
    const play = async () => {
      for (let round = 0; alive; round = (round + 1) % SHOWS.length) {
        const show = SHOWS[round];
        clear(line); line.className = "wl-sd-line";
        const body = el("span", { class: "wl-sd-text" }); line.append(body, el("i", { class: "wl-sd-caret" }));
        await sleep(700); if (!alive) return;
        await type(body, "/", 0);
        menuNode.hidden = false; menuNode.classList.remove("out"); rows("", null);
        await sleep(1100);
        for (let n = 1; n <= show.query.length; n += 1) { if (!alive) return; body.textContent = `/${show.query.slice(0, n)}`; rows(show.query.slice(0, n), null); await sleep(260); }
        await sleep(500); if (!alive) return;
        menuNode.querySelector(".wl-sd-row")?.classList.add("hit");
        await sleep(350);
        menuNode.classList.add("out"); await sleep(180); menuNode.hidden = true;
        body.textContent = ""; line.classList.add(`as-${show.type}`);
        if (show.type === "todo") line.prepend(el("span", { class: "wl-sd-box" }));
        await type(body, show.text, 45);
        await sleep(1900);
        line.classList.add("fade"); await sleep(450);
      }
    };
    play();
    return () => { alive = false; };
  };

  /* The command palette, played on a loop: it eases in, a few letters narrow it, the top result is chosen. */
  const paletteDemo = async (stage) => {
    const ALL = [["New page", "plus", "Create"], ["New database", "table", "Create"], ["New brainstorm board", "target", "Create"], ["New to-do list", "check_square", "Create"], ["Daily note", "calendar", "Create"], ["Go to Templates", "template", "Go to"], ["Go to Flashcards", "cards", "Go to"], ["Toggle sidebar", "panel", "View"], ["Export all notes", "export", "Workspace"]];
    const QUERIES = ["board", "go to", "new"];
    const input = el("div", { class: "wl-pd-input" }, icon("search", 15), el("span", { class: "wl-pd-text" }), el("i", { class: "wl-sd-caret" }));
    const listNode = el("div", { class: "wl-pd-list" });
    const panel = el("div", { class: "wl-pd out" }, input, listNode, el("div", { class: "wl-pd-foot" }, el("span", { text: "↑ ↓ move" }), el("span", { text: "↵ run" })));
    stage.append(el("div", { class: "wl-pdwrap" }, panel, el("p", { class: "wl-sd-cap", text: "One box for every action" })));
    const text = input.querySelector(".wl-pd-text");
    let alive = true;
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const draw = (query, hit) => {
      clear(listNode);
      const shown = ALL.filter(([name, , group]) => !query || name.toLowerCase().includes(query) || group.toLowerCase().includes(query)).slice(0, 6);
      let last = "";
      shown.forEach(([name, glyph, group], i) => {
        if (group !== last) { last = group; listNode.append(el("div", { class: "wl-pd-head", text: group })); }
        listNode.append(el("div", { class: `wl-pd-row${i === 0 ? " on" : ""}${i === 0 && hit ? " hit" : ""}` }, icon(glyph, 15), el("span", { text: name })));
      });
    };
    const play = async () => {
      for (let round = 0; alive; round = (round + 1) % QUERIES.length) {
        text.textContent = ""; draw("", false);
        panel.classList.remove("out"); await sleep(1300); if (!alive) return;
        for (const char of QUERIES[round]) { if (!alive) return; text.textContent += char; draw(text.textContent.toLowerCase(), false); await sleep(210); }
        await sleep(900); if (!alive) return;
        draw(text.textContent.toLowerCase(), true); await sleep(520);
        panel.classList.add("out"); await sleep(900);
      }
    };
    play();
    return () => { alive = false; };
  };

  const STEPS = [
    { id: "hello", title: "Welcome", hero: true },

    { id: "palette", kicker: "Keyboard", title: "Command palette", text: "Every action in one search box. Make a page, a board or a daily note, jump anywhere, hide panels, export.",
      tasks: [["cp", "Open the command palette", { run: () => app.openCommandPalette?.(), keys: "⌘ S" }]], watch: [[".cp", "cp"]], chords: [[chord("s"), "cp"]],
      tips: ["Type a few letters, then Enter.", "What you use most rises to Recent.", "It finds pages by title too."], mount: paletteDemo },

    { id: "slash", kicker: "Editing", title: "Slash menu", text: "On any line, type / to turn it into a block: headings, lists, quotes, tables, media, databases and more.",
      tasks: [["sl-try", "Try it on a new note", { run: () => app.createPage?.(null, { newTab: true }), keys: "/" }]], watch: [[".slash-menu", "sl-try"]],
      tips: ["Keep typing to narrow it: /quote, /h2, /todo.", "↑ ↓ to move, Enter to pick, Esc to close.", "Space on a blank line asks AI instead."], mount: slashDemo },

    { id: "rail", kicker: "Tools", title: "Right sidebar", railButton: true, listLabel: "Press each tab",
      text: "Tools beside the page you are writing. Press the sidebar button at the top right of the window, then press each tab.",
      button: { run: () => { if (!app.railOpen?.()) app.toggleRail?.(); app.tabstrip?.syncRailToggle?.(); app.showRailPanel?.(null); } },
      tasks: [["r-calc", "Calculator"], ["r-browser", "Browser"], ["r-outline", "Outline"], ["r-links", "Linked notes"], ["r-comments", "Comments"], ["r-chat", "Chat"]],
      observe: () => { const panel = document.querySelector(".rail-title")?.textContent?.trim(); const id = { Calculator: "r-calc", Browser: "r-browser", Outline: "r-outline", "Linked notes": "r-links", Comments: "r-comments", Chat: "r-chat" }[panel]; if (id) mark(id); },
      tips: ["The chat is saved with the page you are on.", "Close the sidebar with the cross at its top right."] },

    { id: "brainstorm", kicker: "Create", title: "Brainstorm", text: "A whiteboard inside any page. Stickies, shapes, notes, pictures and files, joined by connectors.",
      tasks: [["bs-add", "Add a sticky from the bar below"], ["bs-link", "Drag from a dot to connect two"]],
      tips: ["Hover an item and four dots appear on its sides.", "Drop a connector on empty space for a new sticky.", "Type /brainstorm on any page to add one."],
      mount: async (stage) => {
        const box = el("div", { class: "wl-board" });
        stage.append(box);
        const seed = { items: [
          { id: "t1", type: "sticky", x: 28, y: 70, w: 140, h: 100, color: "white", text: "Idea", z: 1 },
          { id: "t2", type: "sticky", x: 196, y: 150, w: 140, h: 100, color: "white", text: "Next step", z: 2 },
        ], edges: [], cam: { x: 0, y: 0, z: 1 } };
        const board = new Brainstorm(box, { data: seed, openPage: (id, options) => app.openPage(id, options), onChange: (data) => {
          if (data.items.length > 2) mark("bs-add");
          if (data.edges.length > 0) mark("bs-link");
        } });
        return () => board?.destroy?.();
      } },

    { id: "templates", kicker: "Create", title: "Templates", text: "Fifty ready-made pages from planners to CRMs, each with its databases already set up.",
      tasks: [["templates", "Open the template gallery", { run: () => inTab({ kind: "templates", parentId: null }) }]],
      tips: ["Pick one and it is copied into your notes.", "Everything in it is yours to change."],
      mount: async (stage) => {
        const wanted = ["weekly-planner", "class-notes", "finance-tracker", "habit-tracker", "gantt-chart", "sales-crm"];
        const found = wanted.map((id) => TEMPLATES.find((t) => t.id === id)).filter(Boolean);
        const list = found.length >= 4 ? found : TEMPLATES.filter((t) => t.id !== "blank").slice(0, 6);
        stage.append(el("div", { class: "wl-page wl-gallery" }, el("div", { class: "wl-gallery-grid" }, list.map((template, i) => el("div", { class: "wl-gcard", style: { "--i": String(i) } },
          el("span", { class: "wl-gimg" }, el("img", { src: `/notes/img/templates/${template.id}.png`, alt: "", loading: "lazy" })),
          el("span", { class: "wl-gname" }, el("span", { text: template.emoji || "" }), template.name))))));
        return () => {};
      } },

    { id: "study", kicker: "Study", title: "Flashcards and tests", text: "Turn any page into flashcards that come back on a schedule, or into a graded practice test.",
      tasks: [["cards", "Open Flashcards", { run: () => inTab({ kind: "flashcards" }) }], ["tests", "Open Practice tests", { run: () => inTab({ kind: "tests" }) }]],
      tips: ["Rate each card Again, Hard, Good or Easy.", "Wrong answers can become flashcards."] },

    { id: "search", kicker: "Navigate", title: "Search", text: "Find any page by its title or what is written in it, plus your flashcards and study material.",
      tasks: [["s-open", "Open search", { run: () => app.openSearch?.(), keys: "⌘ P" }]], watch: [[".search-input", "s-open"]], chords: [[chord("p"), "s-open"]],
      tips: ["Arrows and Enter open a result.", "Filters narrow it to pages, databases or study material."] },

    { id: "finish", title: "Make your first note", finish: true },
  ];

  const LAST = STEPS.length - 1;

  /* ------------------------------------------------------------ layout */
  /* The sidebar button, where it lives in the app: top right. Pressed, it slides the real sidebar in and steps aside. */
  const railBtn = el("button", { class: "wl-railbtn", type: "button", "aria-label": "Open the right sidebar", hidden: true, onclick: () => {
    try { STEPS[index].button?.run(); } catch { /* reports its own trouble */ }
    railBtn.classList.add("pressed"); setTimeout(() => { railBtn.hidden = true; }, 480);
  } }, icon("panel", 19));
  const barFill = el("i");
  const bar = el("div", { class: "wl-bar", role: "progressbar", "aria-label": "Tour progress", "aria-valuemin": "0", "aria-valuemax": "100" }, barFill);
  const counter = el("span", { class: "wl-counter" });
  const percent = el("span", { class: "wl-percent", "aria-hidden": "true" });
  const top = el("div", { class: "wl-top" }, el("span", { class: "wl-brand" }, el("span", { class: "wl-brand-emoji", text: WAVE }), "Welcome"), counter,
    el("div", { class: "wl-progress" }, bar, percent),
    el("button", { class: "wl-skip", type: "button", onclick: () => leave(false) }, "Skip tour"));
  const copy = el("div", { class: "wl-copy" });
  const stage = el("div", { class: "wl-stage" });
  const side = el("div", { class: "wl-side" }, stage);
  const main = el("div", { class: "wl-main" }, copy, side);
  const back = el("button", { class: "wl-button", type: "button", onclick: () => go(index - 1) }, icon("chevron_left", 14), "Back");
  const next = el("button", { class: "wl-button primary", type: "button", onclick: () => go(index + 1) });
  const dots = el("div", { class: "wl-dots", role: "tablist", "aria-label": "Steps" });
  const nav = el("div", { class: "wl-nav" }, back, dots, next);
  const railRow = el("div", { class: "wl-railrow" }, railBtn);
  const root = el("div", { class: "wl-root" }, top, railRow, main, nav);
  host.append(root);

  /* The tour takes the whole window: the tabs and both sidebars slide away, and slide back when you leave. */
  const workspace = document.querySelector(".workspace");
  if (app.railOpen?.()) { app.toggleRail?.(); app.tabstrip?.syncRailToggle?.(); }
  requestAnimationFrame(() => workspace?.classList.add("tour-mode"));

  /* Skipping leaves the tour unfinished so it starts over next time; "later" on the last step counts as done. */
  function leave(complete) { if (complete) saveTour({ done: true }); app.goHome?.(); }

  function paintTasks(pop) {
    const list = root.querySelector(".wl-tasks");
    if (!list) return;
    const step = STEPS[index];
    const existing = [...list.children];
    step.tasks.forEach(([id, label, opts = {}], i) => {
      let row = existing[i];
      if (!row) {
        const inner = [el("span", { class: "wl-check", "aria-hidden": "true" }, tick(13)), el("span", { class: "wl-task-label" }, el("span", { class: "wl-strike", text: label })), opts.run ? el("span", { class: "wl-task-go", "aria-hidden": "true" }, icon("chevron_right", 16)) : null];
        const control = opts.run
          ? el("button", { class: "wl-task-btn", type: "button", onclick: (event) => { mark(id); try { const result = opts.run(event.currentTarget); result?.catch?.(() => {}); } catch { /* the action reports its own trouble */ } } }, ...inner)
          : el("div", { class: "wl-task-btn passive" }, ...inner);
        row = el("li", { class: "wl-task", style: { "--i": String(i) } }, control);
        list.append(row);
      }
      const was = row.classList.contains("done");
      row.classList.toggle("done", Boolean(done[id]));
      if (pop && done[id] && !was) row.classList.add("pop");
    });
    const count = root.querySelector(".wl-count");
    if (count) count.textContent = `${step.tasks.filter(([id]) => done[id]).length} of ${step.tasks.length}`;
    const all = step.tasks.length && step.tasks.every(([id]) => done[id]);
    next.classList.toggle("ready", Boolean(all));
  }

  function paintChrome() {
    const step = STEPS[index];
    const intro = index === 0, last = index === LAST;
    root.classList.toggle("is-intro", intro);
    const pct = Math.round((index / LAST) * 100);
    barFill.style.width = `${pct}%`;
    bar.setAttribute("aria-valuenow", String(pct));
    percent.textContent = `${pct}%`;
    counter.textContent = intro || last ? "" : `${index} of ${LAST - 1}`;
    clear(dots);
    STEPS.forEach((entry, i) => { if (i > 0) dots.append(el("button", { class: `wl-dot${i === index ? " active" : ""}${i < index ? " past" : ""}`, type: "button", role: "tab", "aria-selected": String(i === index), "aria-label": entry.title, onclick: () => go(i) })); });
    back.classList.toggle("ghost", index <= 1);
    nav.hidden = intro || last;
    next.classList.remove("ready");
    clear(next);
    next.append("Next", icon("chevron_right", 14));
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
    const keyed = step.tasks.filter(([, , opts]) => opts?.keys).map(([id, label, opts]) => [opts.keys, label, id]);
    append(copy,
      step.kicker ? el("span", { class: "wl-kicker", text: step.kicker }) : null,
      el("h1", { class: "wl-title" }, ...words(step.title)),
      el("p", { class: "wl-text", text: step.text }),
      keyed.length ? el("div", { class: "wl-hotkeys", "aria-label": "Keyboard shortcuts" }, keyed.map(([keys, label], i) => el("div", { class: "wl-hotkey", style: { "--i": String(i) } },
        el("span", { class: "wl-keys-cap" }, ...keys.split(" ").map((key) => el("kbd", { text: key }))), el("span", { class: "wl-hotkey-label", text: label })))) : null,
      step.tasks.length ? el("div", { class: "wl-actions wl-under" }, el("div", { class: "wl-tasks-head" }, el("span", { text: step.listLabel || "Try it" }), el("span", { class: "wl-count" })), el("ul", { class: "wl-tasks" })) : null,
      step.tips?.length ? el("ul", { class: "wl-tips" }, step.tips.slice(0, 2).map((tip, i) => el("li", { style: { "--i": String(i) }, text: tip }))) : null);
    paintTasks();
  }

  let release = null;
  /* A soft ring on the part of the sidebar a step is about, and observers for things done outside the tour (a menu opening). */
  function attach(step) {
    const spotted = [];
    const found = typeof step.spot === "function" ? step.spot() : step.spot ? [...document.querySelectorAll(step.spot)] : [];
    for (const node of found.slice(0, 2)) { node.classList.add("wl-spot"); spotted.push(node); }
    let observer = null;
    if (step.watch?.length || step.observe) {
      const check = () => { for (const [selector, id] of step.watch || []) if (!done[id] && document.querySelector(selector)) mark(id); step.observe?.(); };
      observer = new MutationObserver(check);
      observer.observe(document.body, { childList: true, subtree: true });
    }
    release = () => { spotted.forEach((node) => node.classList.remove("wl-spot")); observer?.disconnect(); };
  }

  async function show(step) {
    release?.(); release = null;
    const plain = !step.hero && !step.finish && !sorted;

    buildCopy(step);
    clear(stage);
    const poster = Boolean(sorted || step.hero || step.finish);
    const solo = !poster && !step.mount;
    stage.hidden = poster || solo;
    main.classList.toggle("poster", poster);
    main.classList.toggle("solo", solo);
    main.classList.toggle("centered", Boolean(plain && solo));
    railBtn.classList.remove("pressed"); railBtn.hidden = !(plain && step.railButton) || Boolean(app.railOpen?.());
    if (!poster) attach(step);
    cleanup = !poster && step.mount ? await step.mount(stage) : null;
  }

  /* One step out, the next in: fade and drift, then build the new one. */
  async function go(target) {
    if (busy || sorted || target < 1 || target > LAST || target === index) return;
    busy = true;
    const forward = target > index;
    const nodes = [main];
    const SLIDE = 120, EASE = "cubic-bezier(.65, 0, .35, 1)";
    if (!reduced()) await Promise.all(nodes.map((node) => node.animate([{ opacity: 1, transform: "none" }, { opacity: 0, transform: `translateX(${forward ? -SLIDE : SLIDE}px)` }], { duration: 520, easing: EASE, fill: "forwards" }).finished.catch(() => {})));
    try { await cleanup?.(); } catch { /* a step that cannot clean up is replaced anyway */ }
    cleanup = null;
    index = target;
    const step = paintChrome();
    await show(step);
    nodes.forEach((node) => node.getAnimations().forEach((animation) => animation.cancel()));
    if (!reduced()) nodes.forEach((node) => node.animate([{ opacity: 0, transform: `translateX(${forward ? SLIDE : -SLIDE}px)` }, { opacity: 1, transform: "none" }], { duration: 760, easing: EASE, fill: "backwards" }));
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
    workspace?.classList.remove("tour-mode");
    abort.abort();
    try { cleanup?.(); } catch { /* ignore */ }
    release?.();
    session = started && !sorted && index > 0 && state.tabs.some((tab) => tab.id === tabId && tab.kind === "welcome") ? { index, done, tabId } : null;
  } };
}
