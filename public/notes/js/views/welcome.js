/* Welcome: a short tour you do, one screen at a time.

   It opens on a calm "Welcome" screen; Space (or the button) starts the tour. After that there is nothing to scroll. A bar along
   the top shows how far along you are, each step is one idea with a line or two of explanation and something to try, and the
   thing to try is the real thing: the same editor, "/" menu, AI composer, chat, database, whiteboard and tools you will use on
   your own pages. The last step asks for your first note and opens it. Finish the tour once and Welcome says everything is sorted;
   close it half way and it starts over the next time. The practice page it writes to is an ordinary page called "Practice page". */
import { el, clear, icon, append, menu } from "../dom.js";
import { api } from "../api.js";
import { state } from "../state.js";
import { TEMPLATES } from "../templates-data.js";
import { progressLoader } from "./generation.js";
import { closeTerminal } from "../runner.js";
import { shortcutLabel } from "../preferences.js";

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
  let finishCreate = null;
  let autoAdvance = null;
  let sortedTimer = null;
  let sortedTicker = null;
  let sortedMomentVersion = 0;
  let celebrationTimer = null;
  let leaving = false;

  /* A checked item has a moment to settle before the next lesson arrives. This
     keeps the tour feeling responsive without making the completion feedback
     flash past the person who just did the action. */
  const mark = (id) => {
    if (done[id]) return;
    done[id] = true;
    paintTasks(true);
    const step = STEPS[index];
    if (!step?.tasks?.length || !step.tasks.every(([taskId]) => done[taskId])) return;
    clearTimeout(autoAdvance);
    /* Completion is acknowledged before moving forward, but never holds the
       learner on a finished interaction long enough to feel stalled. */
    const settle = step?.id === "selection" ? 1000 : step?.id === "terminal" ? 2000 : 760;
    autoAdvance = setTimeout(() => {
      if (!busy && STEPS[index] === step) go(index + 1);
    }, reduced() ? 0 : settle);
  };
  const openRail = (panel) => { if (!app.railOpen?.()) app.toggleRail?.(); app.showRailPanel?.(panel); };

  /* ------------------------------------------------------------- steps */
  /* These previews deliberately start empty: the menu appears only after the
     real shortcut. Neither has a pretend editor/input underneath it. */
  const slashDemo = (stage) => {
    const shell = el("div", { class: "wl-menu-preview", "aria-live": "polite" });
    stage.append(shell);
    let menu = null;
    let active = 0;
    const commands = [["Text", "text"], ["Heading 1", "h1"], ["Heading 2", "h2"], ["Bulleted list", "list"], ["To-do list", "check_square"], ["Quote", "quote"], ["Callout", "comment"], ["Table", "table"]];
    const paint = () => {
      menu?.querySelectorAll(".wl-sd-row").forEach((row, position) => {
        const current = position === active;
        row.classList.toggle("on", current);
        row.setAttribute("aria-selected", String(current));
      });
    };
    const select = () => {
      if (!menu) return;
      const row = menu.querySelectorAll(".wl-sd-row")[active];
      row?.classList.add("chosen");
      shell.dataset.selected = "true";
      mark("sl-select");
    };
    stage.revealTourSlash = () => {
      if (menu) return;
      shell.dataset.open = "true";
      menu = el("div", { class: "wl-sd-menu wl-sd-menu--real", role: "listbox", "aria-label": "Slash commands" });
      menu.append(el("div", { class: "wl-menu-label", text: "Suggested" }), ...commands.map(([label, glyph], position) => el("button", {
        class: `wl-sd-row${position === 0 ? " on" : ""}`, type: "button", role: "option", "aria-selected": String(position === 0),
        onclick: () => { active = position; paint(); mark("sl-move"); select(); },
      }, icon(glyph, 16), el("span", { text: label }))));
      shell.append(menu);
      paint();
    };
    stage.handleTourSlashKey = (event) => {
      if (!menu) return false;
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        active = (active + (event.key === "ArrowDown" ? 1 : commands.length - 1)) % commands.length;
        paint();
        mark("sl-move");
        return true;
      }
      if (event.key === "Enter") { event.preventDefault(); select(); return true; }
      if (event.key === "Escape") { event.preventDefault(); menu.remove(); menu = null; delete shell.dataset.open; return true; }
      return false;
    };
    return () => { delete stage.revealTourSlash; delete stage.handleTourSlashKey; };
  };

  /* Command palette is deliberately a preview in the tour. It uses the real
     command names and visual hierarchy, but cannot focus, run, or mutate a
     workspace. The production palette remains unchanged once the tour ends. */
  const palettePreview = (stage) => {
    const shell = el("div", { class: "wl-menu-preview", "aria-live": "polite" });
    stage.append(shell);
    let panel = null;
    let active = 0;
    let foot = null;
    const commands = [
      ["plus", "New page", "A blank page"],
      ["search", "Search pages", "Find anything by words"],
      ["template", "Templates", "Browse the library"],
      ["comment", "Ask Clyra", "Open a new AI chat"],
    ];
    const paint = () => panel?.querySelectorAll(".cp-option").forEach((row, position) => {
      row.classList.toggle("active", position === active);
      row.setAttribute("aria-selected", String(position === active));
    });
    const show = () => {
      if (panel) return;
      foot = el("div", { class: "cp-foot cp-tour-foot" }, "↑ ↓ to move · Enter to choose");
      panel = el("div", { class: "cp cp-embedded cp-tour-readonly", role: "listbox", "aria-label": "Command palette preview" },
        el("div", { class: "cp-field" }, icon("search", 16), el("span", { class: "cp-tour-query", text: "Search commands" }), el("kbd", { class: "cp-esc", text: "Tour" })),
        el("div", { class: "cp-list" },
          el("div", { class: "cp-head" }, el("span", { text: "Suggested" })),
          ...commands.map(([glyph, title, detail]) => el("div", { class: "cp-option", role: "option" },
            el("span", { class: "cp-ico" }, icon(glyph, 15)),
            el("span", { class: "cp-text" }, el("span", { class: "cp-name", text: title }), el("span", { class: "cp-desc", text: detail }))))),
        foot);
      shell.dataset.open = "true";
      shell.append(panel);
      paint();
    };
    stage.revealTourPalette = show;
    stage.handleTourPaletteKey = (event) => {
      if (!panel || !["ArrowDown", "ArrowUp", "Enter"].includes(event.key)) return false;
      event.preventDefault();
      if (event.key === "Enter") {
        /* Enter is the last step: it means something only once a row has been chosen with the arrows. */
        if (!done["palette-move"]) return true;
        foot.textContent = `“${commands[active][1]}” would run now. Commands are paused during the tour.`;
        panel.querySelectorAll(".cp-option")[active]?.classList.add("chosen");
        mark("palette-run");
        return true;
      }
      active = (active + (event.key === "ArrowDown" ? 1 : -1) + commands.length) % commands.length;
      paint();
      mark("palette-move");
      return true;
    };
    return () => { delete stage.revealTourPalette; delete stage.handleTourPaletteKey; };
  };

  /* A local, no-network simulation of the same note → configuration →
     generation flow used by Notes. It lets the welcome tour teach the shape of
     the workflow without creating a deck or requiring an AI key. */
  const studyPreview = (stage) => {
    const flow = el("div", { class: "wl-study-flow", "aria-live": "polite" });
    const timers = [];
    const clearFlow = () => clear(flow);
    const config = () => {
      flow.classList.remove("is-switching");
      clearFlow();
      const generate = el("button", { class: "wl-study-generate", type: "button" }, icon("sparkle", 15), "Generate deck");
      generate.addEventListener("click", () => {
        if (flow.dataset.generating) return;
        flow.dataset.generating = "true";
        const loader = progressLoader({
          title: "Making your flashcards",
          stages: ["Reading your note", "Choosing what to test", "Writing the cards", "Checking for duplicates"],
          art: "cards",
        });
        flow.classList.add("is-switching");
        timers.push(setTimeout(() => {
          clearFlow();
          flow.classList.remove("is-switching");
          flow.append(loader.node);
          /* Short, distinct progress beats keep the demo moving without
             pretending an actual network generation has completed. */
          timers.push(setTimeout(() => loader.advance(1), 620));
          timers.push(setTimeout(() => loader.advance(2), 1240));
          timers.push(setTimeout(() => loader.advance(3), 1860));
        }, reduced() ? 0 : 110));
        timers.push(setTimeout(() => {
          flow.dataset.done = "true";
          loader.finish("Deck ready · 12 cards");
          mark("study-generate");
        }, reduced() ? 0 : 2800));
      });
      flow.append(
        el("div", { class: "wl-study-flow-head" }, icon("cards", 17), el("span", { text: "Generate flashcards" })),
        el("div", { class: "wl-study-note picked" }, icon("page", 15), el("span", { text: "Biology · cell division" }), tick(13)),
        el("div", { class: "wl-study-fields" },
          el("label", {}, el("span", { text: "Cards" }), el("input", { value: "12", type: "number", readOnly: true })),
          el("label", {}, el("span", { text: "Difficulty" }), el("select", {}, el("option", { text: "Mixed difficulty" }))),
          el("label", {}, el("span", { text: "Style" }), el("select", {}, el("option", { text: "Question & answer" })))),
        generate,
      );
    };
    const pick = () => {
      mark("study-note");
      flow.classList.add("is-switching");
      setTimeout(config, reduced() ? 0 : 180);
    };
    flow.append(
      el("div", { class: "wl-study-flow-head" }, icon("cards", 17), el("span", { text: "Generate flashcards" })),
      el("p", { class: "wl-study-hint", text: "Choose a note to turn into a deck." }),
      el("button", { class: "wl-study-note", type: "button", onclick: pick }, icon("page", 15), el("span", { text: "Biology · cell division" }), el("span", { class: "wl-study-note-meta", text: "842 words" })),
      el("button", { class: "wl-study-note", type: "button", onclick: pick }, icon("page", 15), el("span", { text: "Chemistry · atoms" }), el("span", { class: "wl-study-note-meta", text: "516 words" })),
    );
    stage.append(flow);
    return () => timers.forEach((timer) => clearTimeout(timer));
  };

  /* The same interaction as the real selection toolbar, built from the same
     parts: nothing shows while the mouse is still dragging, and the toolbar
     floats in above the selection the moment the button is released. */
  const selectionToolbarDemo = (stage) => {
    const demo = el("div", { class: "wl-selection-demo" });
    const text = el("p", { class: "wl-selection-copy", contenteditable: "true", spellcheck: "false" },
      "Click and drag across a few words in this short note, then let go to reveal Clyra’s formatting toolbar.");
    let saved = null;
    let dragging = false;
    const keep = (event) => event.preventDefault();
    const remember = () => { const selection = window.getSelection(); if (selection?.rangeCount && !selection.isCollapsed) saved = selection.getRangeAt(0).cloneRange(); };
    const restore = () => { if (!saved) return; const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(saved); };
    /* Formatting applies to the words that are selected, exactly as it does in a note. */
    const exec = (command, value = null) => { restore(); document.execCommand("styleWithCSS", false, true); document.execCommand(command, false, value); remember(); };
    const colour = (kind, label, task) => el("button", { class: `icon-button toolbar-colour toolbar-colour-${kind} wl-attention`, type: "button", title: label, "aria-label": label, onmousedown: keep, onclick: (event) => {
      remember();
      const swatches = kind === "text"
        ? [["Default", "#37352f"], ["Blue", "#1e6fff"], ["Green", "#198754"], ["Red", "#c54949"], ["Purple", "#805ad5"]]
        : [["Yellow", "#f5dc79"], ["Green", "#b8e4c8"], ["Blue", "#bfd7ff"], ["Pink", "#f5c7d8"], ["Clear", "transparent"]];
      menu(event.currentTarget, swatches.map(([name, value]) => ({ label: name, onSelect: () => {
        exec(kind === "text" ? "foreColor" : "hiliteColor", value);
        mark(task);
      } })), { align: "end", class: "toolbar-menu" });
    } },
      kind === "text" ? el("span", { class: "toolbar-colour-letter", text: "A" }) : icon("highlight", 15));
    const drop = (label, className, items, onPick) => el("button", { class: `text-button ${className}`, type: "button", title: label, onmousedown: keep, onclick: (event) => { remember(); menu(event.currentTarget, items.map(([name, value]) => ({ label: name, onSelect: () => onPick(value) })), { align: "start", class: "toolbar-menu" }); } }, label, icon("chevron_down", 11));
    const mark$ = (glyph, label, command) => el("button", { class: "icon-button", type: "button", title: label, "aria-label": label, onmousedown: keep, onclick: (event) => { if (command) { exec(command); event.currentTarget.classList.toggle("active"); } } }, icon(glyph, 15));
    const sep = () => el("div", { class: "sep", "aria-hidden": "true" });
    const toolbar = el("div", { class: "inline-toolbar wl-floating-toolbar", role: "toolbar", "aria-label": "Text formatting", hidden: true },
      el("button", { class: "text-button ask-clyra", type: "button", title: "Ask Clyra about the selection", onmousedown: keep }, icon("sparkle", 15), "Ask Clyra"),
      sep(),
      drop("Format", "toolbar-format", [["Paragraph", "p"], ["Heading", "h2"], ["Quote", "blockquote"]], () => {}),
      drop("Font", "toolbar-font", [["Default", "inherit"], ["Serif", "Georgia, serif"], ["Mono", "ui-monospace, monospace"]], (value) => exec("fontName", value)),
      mark$("align_left", "Text alignment"),
      sep(),
      mark$("bold", "Bold", "bold"), mark$("italic", "Italic", "italic"), mark$("underline", "Underline", "underline"), mark$("strike", "Strikethrough", "strikeThrough"), mark$("code", "Inline code"), mark$("equation", "Equation"),
      sep(),
      mark$("link", "Link"), mark$("comment", "Comment"),
      colour("text", "Change text colour", "selection-text-colour"),
      colour("highlight", "Change highlight colour", "selection-highlight-colour"),
      mark$("dots", "More formatting"));
    const hint = el("span", { class: "wl-selection-hint", text: "Drag across some words, then let go" });
    demo.append(text, hint);
    stage.append(demo);
    document.body.append(toolbar);

    const selected = () => {
      const selection = window.getSelection();
      if (!selection?.rangeCount || selection.isCollapsed) return null;
      const range = selection.getRangeAt(0);
      const node = range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE ? range.commonAncestorContainer : range.commonAncestorContainer.parentElement;
      return node && text.contains(node) ? range : null;
    };
    const hide = () => { toolbar.hidden = true; demo.classList.remove("selected"); };
    const place = (range) => {
      const box = range.getBoundingClientRect();
      toolbar.hidden = false;
      /* Restart the entrance each time, the way a freshly opened toolbar arrives. */
      toolbar.style.animation = "none"; void toolbar.offsetWidth; toolbar.style.animation = "";
      const left = Math.max(12, Math.min(window.innerWidth - toolbar.offsetWidth - 12, box.left + box.width / 2 - toolbar.offsetWidth / 2));
      const above = box.top - toolbar.offsetHeight - 10;
      toolbar.style.left = `${left}px`;
      toolbar.style.top = `${above > 8 ? above : box.bottom + 10}px`;
    };
    const settle = () => {
      const range = selected();
      if (!range) { hide(); hint.textContent = "Drag across some words, then let go"; return; }
      remember();
      place(range);
      demo.classList.add("selected");
      hint.textContent = "Now change the text colour and add a highlight";
      mark("selection-highlight");
    };
    const press = (event) => { if (event.button === 0) { dragging = true; hide(); } };
    const lift = () => { if (dragging) { dragging = false; setTimeout(settle, 0); } };
    const keyed = (event) => { if (event.key === "Shift" || event.key.startsWith("Arrow")) settle(); };
    /* A selection that disappears takes the toolbar with it, unless one of its own menus is open. */
    const changed = () => { if (!dragging && !toolbar.hidden && !selected() && !document.querySelector(".layer")) hide(); };
    text.addEventListener("pointerdown", press);
    document.addEventListener("pointerup", lift);
    document.addEventListener("selectionchange", changed);
    text.addEventListener("keyup", keyed);
    return () => {
      text.removeEventListener("pointerdown", press);
      document.removeEventListener("pointerup", lift);
      document.removeEventListener("selectionchange", changed);
      text.removeEventListener("keyup", keyed);
      toolbar.remove();
    };
  };

  const STEPS = [
    { id: "hello", title: "Welcome", hero: true },

    { id: "palette", kicker: "Keyboard", title: "Command palette", text: "Every action lives in one search box. Open it, move through the list, and choose one. During the tour it stays safely paused, so nothing here can change your workspace.",
      tasks: [["palette-open", "Open the command palette", { keys: shortcutLabel("commandPalette") }], ["palette-move", "Use ↑ or ↓ to move through commands"], ["palette-run", "Press Enter to choose the highlighted command"]],
      tips: ["The same three moves work everywhere: open, arrow, Enter.", "Your most-used commands appear in Recent."], mount: palettePreview },

    { id: "terminal", kicker: "Workspace", title: "Terminal", text: "A real terminal, available whenever you need it, without leaving Notes. You can't get this wrong: type anything at all. It doesn't have to be a command.",
      tasks: [["terminal-open", "Open the terminal", { keys: shortcutLabel("terminal") }], ["terminal-type", "Type anything: a command like ls, your name, or random letters"], ["terminal-enter", "Press Enter to send it"]],
      tips: ["If it isn't a real command, the terminal simply says so, and nothing breaks.", "It is a separate workspace tool, not a command-palette action."] },

    { id: "slash", kicker: "Editing", title: "Slash menu", text: "On any line, press / to choose headings, lists, quotes, tables, media, databases and more.",
      tasks: [["sl-try", "Press / to open the slash menu"], ["sl-move", "Use ↑ or ↓ to move through commands"], ["sl-select", "Press Enter to choose the highlighted command"]],
      tips: ["Arrow keys move through choices. Enter inserts one.", "Esc closes it."], mount: slashDemo },

    { id: "rail", kicker: "Tools", title: "Right sidebar", railButton: true, listLabel: "Press each tab",
      text: "Tools beside the page you are writing. Press the sidebar button on the right edge, then press each tab.",
      button: { run: () => { if (!app.railOpen?.()) app.toggleRail?.(); app.tabstrip?.syncRailToggle?.(); app.showRailPanel?.(null); } },
      tasks: [["r-calc", "Calculator"], ["r-browser", "Browser"], ["r-outline", "Outline"], ["r-links", "Linked notes"], ["r-comments", "Comments"], ["r-chat", "Chat"]],
      observe: () => { const panel = document.querySelector(".rail-title")?.textContent?.trim(); const id = { Calculator: "r-calc", Browser: "r-browser", Outline: "r-outline", "Linked notes": "r-links", Comments: "r-comments", Chat: "r-chat" }[panel]; if (id) mark(id); },
      tips: ["The chat is saved with the page you are on.", "Close the sidebar with the cross at its top right."] },

    { id: "templates", kicker: "Create", title: "Cornell Notes", text: "The real Cornell method: a ruled cue column for recall questions, notes beside it, and a summary to write at the end.",
      tasks: [["template-preview", "Look through the template previews"]],
      tips: ["Choose it and it is copied into your notes.", "Everything in it is yours to change."],
      mount: async (stage) => {
        const list = TEMPLATES;
        stage.append(el("div", { class: "wl-page wl-gallery" }, el("div", { class: "wl-gallery-grid" }, list.map((template, i) => el("div", { class: "wl-gcard", style: { "--i": String(i) } },
          el("span", { class: "wl-gimg" }, el("img", { src: `/notes/img/templates/${template.id}.png`, alt: "", loading: "lazy" })),
          el("span", { class: "wl-gname" }, el("span", { text: template.emoji || "" }), template.name),
          el("button", { class: "wl-gcard-hit", type: "button", "aria-label": `Preview ${template.name}`, onclick: () => mark("template-preview") }))))));
        return () => {};
      } },

    { id: "study", kicker: "Study", title: "Flashcards and tests", text: "Choose a note, set the deck options, then generate. This guided preview never creates study material in your workspace.",
      tasks: [["study-note", "Choose a note"], ["study-generate", "Generate the 12-card deck"]],
      tips: ["Rate each card Again, Hard, Good or Easy.", "Wrong answers can become flashcards."], mount: studyPreview },

    { id: "selection", kicker: "Writing", title: "Make text your own", text: "Click and drag across a few words, then let go. The toolbar appears the moment you release, just like in a real note.",
      tasks: [["selection-highlight", "Click and drag to highlight text"], ["selection-text-colour", "Change the text colour"], ["selection-highlight-colour", "Add a highlight colour"]],
      tips: ["The tour pauses for five seconds once the checklist is complete.", "Use the compact toolbar to format, link or ask Clyra about the selected text."], mount: selectionToolbarDemo },

    { id: "sorted", title: "Everything is sorted", sortedMoment: true },

    { id: "finish", title: "Make your first note", finish: true },
  ];

  const LAST = STEPS.length - 1;

  /* ------------------------------------------------------------ layout */
  /* The exact sidebar control from Notes, positioned beside the tour so it can
     open the real rail without an imitation interface. */
  const railBtn = el("button", { class: "wl-railbtn icon-button rail-toggle", type: "button", "aria-label": "Open the right sidebar", "aria-expanded": "false", hidden: true }, icon("panel", 19));
  /* This is the production rail, not a tour imitation. Keeping the trigger
     around after it opens gives a clear route back to the launcher and, more
     importantly, means it never becomes a tiny one-shot target at the edge. */
  const syncTourRailButton = () => {
    const open = Boolean(app.railOpen?.());
    railBtn.classList.toggle("pressed", open);
    railBtn.classList.toggle("active", open);
    railBtn.setAttribute("aria-expanded", String(open));
    railBtn.setAttribute("aria-pressed", String(open));
    railBtn.setAttribute("aria-label", open ? "Show all right-sidebar tools" : "Open the right sidebar");
  };
  railBtn.addEventListener("click", () => {
    if (STEPS[index]?.id !== "rail") return;
    try {
      if (!app.railOpen?.()) app.toggleRail?.();
      app.showRailPanel?.(null);
      requestAnimationFrame(syncTourRailButton);
    } catch { /* the rail owns any display errors */ }
  });
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

  function revealShell() {
    workspace?.classList.add("tour-returning");
    workspace?.classList.remove("tour-mode");
  }

  /* Skipping leaves the tour unfinished so it starts over next time; "later"
     counts as done. Reveal the app chrome before replacing the tour, so the
     sidebar and tabs return as a composed transition instead of a zoom. */
  function leave(complete) {
    if (leaving) return;
    leaving = true;
    if (complete) saveTour({ done: true });
    root.classList.add("is-leaving");
    revealShell();
    setTimeout(() => app.goHome?.(), reduced() ? 0 : 260);
  }

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
    const rail = document.querySelector(".rail");
    rail?.classList.toggle("tour-hints", step.id === "rail" && step.tasks.some(([id]) => done[id]));
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
    nav.hidden = intro || last || Boolean(step.sortedMoment);
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
    for (let i = 0; i < 58; i += 1) {
      const angle = (Math.PI * 2 * i) / 58 + Math.random() * 0.24, distance = 100 + Math.random() * 190;
      layer.append(el("i", { style: { "--x": `${Math.cos(angle) * distance}px`, "--y": `${Math.sin(angle) * distance - 48}px`, "--r": `${Math.round(Math.random() * 720 - 360)}deg`, "--c": palette[i % palette.length], "--d": `${Math.round(Math.random() * 180)}ms`, "--s": `${Math.round(5 + Math.random() * 5)}px` } }));
    }
    parent.append(layer);
    setTimeout(() => layer.remove(), 1900);
  }

  const bigTick = () => { const orb = el("div", { class: "wl-orb done", "aria-hidden": "true" }, tick(30)); return orb; };
  const bigThumb = () => el("div", { class: "wl-celebrate-emoji", "aria-hidden": "true", text: "👍" });
  function celebrate() {
    copy.classList.add("wl-celebration-build");
    clearTimeout(celebrationTimer);
    celebrationTimer = setTimeout(() => {
      copy.classList.add("wl-celebration-live");
      confetti(copy);
    }, reduced() ? 0 : 360);
  }

  function buildIntro() {
    append(copy,
      el("div", { class: "wl-intro-emoji", "aria-hidden": "true" }, el("div", { class: "wl-wave" }, el("span", { text: WAVE }))),
      el("span", { class: "wl-intro-kicker", text: "Notes that stay in motion" }),
      el("h1", { class: "wl-title hero wl-intro-title" }, ...words("Welcome to Clyra")),
      el("p", { class: "wl-text hero wl-intro-copy" }, "A quiet home for notes, study and the ideas you want to keep moving."),
      el("div", { class: "wl-intro-actions" }, el("button", { class: "wl-press", type: "button", onclick: () => begin() }, "Press", el("kbd", { text: "Space" }), "to start")),
      el("div", { class: "wl-intro-meta", "aria-label": "Tour details" }, el("span", { text: "Write" }), el("i", { "aria-hidden": "true" }), el("span", { text: "Organise" }), el("i", { "aria-hidden": "true" }), el("span", { text: "Study" })),
      el("p", { class: "wl-intro-hint", text: "A short hands-on tour · about 1 minute" }));
  }

  function buildSorted() {
    const orb = bigTick();
    append(copy, orb, el("h1", { class: "wl-title hero" }, ...words("Everything is sorted")),
      el("p", { class: "wl-text hero" }, "You have been through the whole tour. Your notes are ready whenever you are."),
      el("div", { class: "wl-cta" },
        el("button", { class: "wl-button primary", type: "button", onclick: () => app.createPage?.(null) }, icon("plus", 14), "New note"),
        el("button", { class: "wl-button", type: "button", onclick: () => app.openTemplates?.(null) }, "Templates"),
        el("button", { class: "wl-button", type: "button", onclick: () => replay() }, icon("history", 14), "Replay the tour")));
    requestAnimationFrame(celebrate);
  }

  function buildSortedMoment() {
    const version = ++sortedMomentVersion;
    const countdown = el("strong", { class: "wl-countdown", text: "5" });
    append(copy,
      bigThumb(),
      el("span", { class: "wl-kicker", text: "Complete" }),
      el("h1", { class: "wl-title hero" }, ...words("Everything is sorted")),
      el("p", { class: "wl-text hero" }, "Your workspace is ready. Your first note opens in ", countdown, " seconds."));
    requestAnimationFrame(celebrate);
    const startedAt = Date.now();
    sortedTicker = setInterval(() => {
      const remaining = Math.max(0, 5 - Math.floor((Date.now() - startedAt) / 1000));
      countdown.textContent = String(remaining);
    }, 180);
    sortedTimer = setTimeout(() => {
      if (root.isConnected && document.querySelector(".wl-root") === root && version === sortedMomentVersion && !busy && STEPS[index]?.id === "sorted") go(index + 1);
    }, 5000);
  }

  function buildFinish() {
    const make = el("button", { class: "wl-button primary wl-finish-create", type: "button" }, icon("plus", 15), "Create my first note");
    const create = async () => {
      if (make.disabled) return;
      make.disabled = true;
      saveTour({ done: true });
      root.classList.add("is-leaving");
      revealShell();
      await new Promise((resolve) => setTimeout(resolve, reduced() ? 0 : 280));
      const page = await app.createPage?.(null, { title: "My first note" });
      if (!page) { root.classList.remove("is-leaving"); make.disabled = false; }
    };
    finishCreate = create;
    make.addEventListener("click", create);
    append(copy,
      el("div", { class: "wl-finish-emoji", "aria-hidden": "true" }, el("span", { text: "✍️" })),
      el("span", { class: "wl-finish-kicker", text: "Your workspace is ready" }),
      el("h1", { class: "wl-title hero" }, ...words("Make your first note")),
      el("p", { class: "wl-text hero" }, "A clean page is waiting. Give it a thought, a title, or a first line."),
      el("p", { class: "wl-finish-hint" }, "Choose how you would like to begin."),
      el("div", { class: "wl-finish-actions" }, make, el("button", { class: "wl-button wl-finish-later", type: "button", onclick: () => leave(true) }, "I’ll do it later")));
    requestAnimationFrame(celebrate);
  }

  function buildCopy(step) {
    copy.classList.remove("wl-celebration-build", "wl-celebration-live");
    clearTimeout(celebrationTimer);
    clear(copy);
    if (sorted) { buildSorted(); return; }
    if (step.hero) { buildIntro(); return; }
    if (step.sortedMoment) { buildSortedMoment(); return; }
    if (step.finish) { buildFinish(); return; }
    const tasks = step.tasks || [];
    const keyed = tasks.filter(([, , opts]) => opts?.keys).map(([id, label, opts]) => [opts.keys, label, id]);
    append(copy,
      step.kicker ? el("span", { class: "wl-kicker", text: step.kicker }) : null,
      el("h1", { class: "wl-title" }, ...words(step.title)),
      el("p", { class: "wl-text", text: step.text }),
      keyed.length ? el("div", { class: "wl-hotkeys", "aria-label": "Keyboard shortcuts" }, keyed.map(([keys, label], i) => el("div", { class: "wl-hotkey", style: { "--i": String(i) } },
        el("span", { class: "wl-keys-cap" }, ...keys.split(" ").map((key) => el("kbd", { text: key }))), el("span", { class: "wl-hotkey-label", text: label })))) : null,
      tasks.length ? el("div", { class: "wl-actions wl-under" }, el("div", { class: "wl-tasks-head" }, el("span", { text: step.listLabel || "Checklist" }), el("span", { class: "wl-count" })), el("ul", { class: "wl-tasks" })) : null,
      step.tips?.length ? el("ul", { class: "wl-tips" }, step.tips.slice(0, 2).map((tip, i) => el("li", { style: { "--i": String(i) }, text: tip }))) : null);
    if (tasks.length) paintTasks();
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
    sortedMomentVersion += 1;
    clearTimeout(autoAdvance); autoAdvance = null;
    clearTimeout(sortedTimer); sortedTimer = null;
    clearInterval(sortedTicker); sortedTicker = null;
    release?.(); release = null;
    /* A real terminal belongs to its own lesson only, then closes cleanly as
       the tour moves on so it cannot obscure another interaction. */
    if (step.id !== "terminal") closeTerminal();
    const plain = !step.hero && !step.finish && !step.sortedMoment && !sorted;

    buildCopy(step);
    if (!step.finish) finishCreate = null;
    clear(stage);
    const poster = Boolean(sorted || step.hero || step.sortedMoment || step.finish);
    const solo = !poster && !step.mount;
    stage.hidden = poster || solo;
    main.classList.toggle("poster", poster);
    main.classList.toggle("solo", solo);
    main.classList.toggle("centered", Boolean(plain && solo));
    root.classList.toggle("wl-menu-step", step.id === "palette" || step.id === "slash" || step.id === "study");
    stage.dataset.preview = step.id;
    railBtn.hidden = !(plain && step.railButton);
    syncTourRailButton();
    if (!poster) attach(step);
    cleanup = !poster && step.mount ? await step.mount(stage) : null;
  }

  /* One short, springy handoff between lessons. It uses compositor-friendly
     transforms only, making quick keyboard completion feel light rather than
     theatrical. */
  async function go(target) {
    if (busy || sorted || target < 1 || target > LAST || target === index) return;
    busy = true;
    const forward = target > index;
    const nodes = [main];
    const SLIDE = 30, EASE = "cubic-bezier(.22, 1, .36, 1)";
    if (!reduced()) await Promise.all(nodes.map((node) => node.animate([{ opacity: 1, transform: "none" }, { opacity: 0, transform: `translateX(${forward ? -SLIDE : SLIDE}px)` }], { duration: 190, easing: EASE, fill: "forwards" }).finished.catch(() => {})));
    /* A tool panel belongs to its lesson. Let it glide away before the next
       lesson takes its full-width canvas instead of leaking into it. */
    if (STEPS[index]?.id === "rail" && app.railOpen?.()) app.toggleRail?.();
    if (STEPS[index]?.id === "terminal" && target !== index) closeTerminal();
    document.querySelector(".rail")?.classList.remove("tour-hints");
    try { await cleanup?.(); } catch { /* a step that cannot clean up is replaced anyway */ }
    cleanup = null;
    index = target;
    const step = paintChrome();
    await show(step);
    nodes.forEach((node) => node.getAnimations().forEach((animation) => animation.cancel()));
    if (!reduced()) nodes.forEach((node) => node.animate([{ opacity: 0, transform: `translateX(${forward ? SLIDE : -SLIDE}px)` }, { opacity: 1, transform: "none" }], { duration: 300, easing: EASE, fill: "backwards" }));
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

  document.addEventListener("clyra:tour-command-palette", () => {
    if (STEPS[index].id !== "palette") return;
    stage.revealTourPalette?.();
    mark("palette-open");
  }, { signal });
  document.addEventListener("clyra:terminal-opened", () => {
    if (STEPS[index]?.id === "terminal") mark("terminal-open");
  }, { signal });
  /* Whatever is typed counts. Enter only completes the lesson once something has been typed. */
  document.addEventListener("clyra:terminal-data", (event) => {
    if (STEPS[index]?.id !== "terminal" || !done["terminal-open"]) return;
    const data = String(event.detail?.data || "");
    if (data.includes("\r") && done["terminal-type"]) { mark("terminal-enter"); return; }
    if (/[^\r\n\x7f\x1b]/.test(data) && !data.startsWith("\x1b")) mark("terminal-type");
  }, { signal });
  const onKey = (event) => {
    /* The embedded palette owns the keystroke itself. The tour only observes
       it so its checklist follows the same Arrow / Enter sequence as the
       real command palette rather than inventing a second control. */
    if (STEPS[index].id === "palette" && stage.handleTourPaletteKey?.(event)) return;
    if (event.target?.closest?.("input, textarea, select, [contenteditable='true']") || document.querySelector(".layer, .modal, .cp")) return;
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (index === 0 && !sorted && (event.key === " " || event.key === "Enter")) { event.preventDefault(); begin(); return; }
    if (STEPS[index].id === "slash" && stage.handleTourSlashKey?.(event)) return;
    if (STEPS[index].id === "slash" && event.key === "/") { event.preventDefault(); stage.revealTourSlash?.(); mark("sl-try"); return; }
    if (STEPS[index].finish && (event.key === " " || event.key === "Enter")) { event.preventDefault(); finishCreate?.(); return; }
  };
  document.addEventListener("keydown", onKey, { signal });

  root.classList.toggle("is-sorted", sorted);
  show(paintChrome());
  if (!reduced()) copy.animate([{ opacity: 0, transform: "translateY(12px)" }, { opacity: 1, transform: "none" }], { duration: 520, easing: "cubic-bezier(0.22, 1, 0.36, 1)" });

  return { destroy() {
    workspace?.classList.remove("tour-mode");
    workspace?.classList.remove("tour-returning");
    clearTimeout(autoAdvance);
    clearTimeout(sortedTimer);
    clearInterval(sortedTicker);
    clearTimeout(celebrationTimer);
    abort.abort();
    closeTerminal();
    document.querySelector(".rail")?.classList.remove("tour-hints");
    try { cleanup?.(); } catch { /* ignore */ }
    release?.();
    session = started && !sorted && index > 0 && state.tabs.some((tab) => tab.id === tabId && tab.kind === "welcome") ? { index, done, tabId } : null;
  } };
}
