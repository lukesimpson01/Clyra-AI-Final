/* Subjects and workspace settings.

   The panel is a two-column dialog: a grouped nav on the left, one page of
   settings on the right. Every control is bound to an entry in
   preferences.js and to code that reads it — the panel deliberately has no
   way to render a switch that nothing is listening to.

   Appearance is the one thing it does not offer. Notes is a same-origin
   surface inside Clyra and follows the theme chosen there, rather than
   keeping a second control that can drift out of sync with it. */
import { el, clear, icon, iconButton, modal, toast, confirmDialog, append } from "../dom.js";
import { api } from "../api.js";
import { state, loadWorkspace, refreshPages, withError, saveSession } from "../state.js";
import { PREFERENCES, readPreference, writePreference, prefOn, SHORTCUTS, shortcutLabel, shortcutValue, writeShortcut, resetShortcuts } from "../preferences.js";
import { empty } from "./home.js";

export function applyNotesPreferences() {
  const chatTheme = (() => {
    try { return localStorage.getItem("clyra-theme") ?? "Light"; } catch { return "Light"; }
  })();
  const dark = String(chatTheme).toLowerCase() === "dark";
  try { localStorage.removeItem("clyra-notes:theme"); } catch { /* storage may be unavailable */ }
  document.documentElement.dataset.notesTheme = dark ? "dark" : "light";
  document.documentElement.dataset.notesThemePreference = dark ? "Dark" : "Light";
  document.documentElement.style.colorScheme = dark ? "dark" : "light";
  document.documentElement.dataset.notesDensity = readPreference("density");
  document.documentElement.classList.toggle("reduce-motion", prefOn("reduceMotion"));
}

/* ------------------------------------------------------------- controls */

const settingRow = (label, hint, control, extra = {}) =>
  el("div", { class: `setting-row${extra.className ? ` ${extra.className}` : ""}` },
    el("div", { class: "setting-copy" },
      el("div", { class: "setting-label" },
        el("span", { text: label }),
        extra.badge ? el("span", { class: "setting-badge", text: extra.badge }) : null),
      hint ? el("div", { class: "setting-hint", text: hint }) : null),
    el("div", { class: "setting-control" }, control));

const selectControl = (label, name, options, onChange) => {
  const select = el("select", { class: "settings-select", "aria-label": label },
    options.map(([value, text]) => el("option", { value, text })));
  select.value = readPreference(name);
  select.addEventListener("change", () => {
    writePreference(name, select.value);
    onChange?.(select.value);
  });
  return select;
};

/* A switch rather than a checkbox: the rows are wide, and the state has to
   read from the other side of the dialog. */
const switchControl = (label, name, onChange) => {
  const input = el("input", { type: "checkbox", class: "switch-input", "aria-label": label });
  input.checked = prefOn(name);
  const wrap = el("label", { class: "switch" }, input,
    el("span", { class: "switch-track" }, el("span", { class: "switch-thumb" })));
  input.addEventListener("change", () => {
    writePreference(name, input.checked ? "1" : "0");
    onChange?.(input.checked);
  });
  return wrap;
};

const numberControl = (label, name, { min, max, step = 1, suffix } = {}) => {
  const input = el("input", {
    class: "settings-number", type: "number", "aria-label": label,
    min: String(min), max: String(max), step: String(step),
  });
  input.value = readPreference(name);
  input.addEventListener("change", () => {
    const value = Math.min(max, Math.max(min, Number(input.value) || Number(PREFERENCES[name].fallback)));
    input.value = String(value);
    writePreference(name, value);
  });
  return suffix
    ? el("div", { class: "settings-number-wrap" }, input, el("span", { class: "settings-suffix", text: suffix }))
    : input;
};

const sectionBlock = (title, rows) => el("section", { class: "settings-section" },
  el("h3", { class: "settings-section-title", text: title }),
  el("div", { class: "settings-section-body" }, rows.filter(Boolean)));

const modKeyLabel = /Mac|iPhone|iPad/.test(navigator.platform || "") ? "⌘" : "Ctrl";

/* ---------------------------------------------------------------- pages */

function preferencesPage(app) {
  return {
    title: "Preferences",
    lead: "Choose how Clyra Notes looks and behaves.",
    body: [
      sectionBlock("Appearance", [
        settingRow("Sidebar density", "Comfortable gives roomier rows; compact fits more of the tree on screen.",
          selectControl("Sidebar density", "density",
            [["comfortable", "Comfortable"], ["compact", "Compact"]], applyNotesPreferences)),
        settingRow("Reduce motion", "Turn off panel transitions, tab travel and animated loaders.",
          switchControl("Reduce motion", "reduceMotion", applyNotesPreferences)),
      ]),
      sectionBlock("New notes", [
        settingRow("Font", "The typeface a new note starts in. Rounded uses Comfortaa where it is installed.",
          selectControl("Font", "noteFont",
            [["default", "Default"], ["serif", "Serif"], ["mono", "Mono"], ["rounded", "Rounded"]])),
        settingRow("Text size", "Body size for new notes. Existing notes keep the size they were made with.",
          selectControl("Text size", "noteTextSize",
            [["small", "Small"], ["medium", "Medium"], ["large", "Large"]])),
        settingRow("Full width", "Use the whole canvas instead of the centred column — better for wide tables.",
          switchControl("Full width", "fullWidth")),
      ]),
      sectionBlock("Tools panel", [
        settingRow("Open with every note", "Show the right-hand tools panel automatically when you open a note.",
          switchControl("Open tools panel with every note", "railAuto")),
        settingRow("Opens on", "Show the list of tools, or go straight to one of them.",
          selectControl("Opens on", "railPanel", [
            ["", "All tools"], ["outline", "Outline"], ["links", "Linked notes"],
            ["calculator", "Calculator"], ["chat", "Chat"], ["browser", "Browser"],
          ], (value) => app.showRailPanel?.(value || null))),
      ]),
    ],
  };
}

function editorPage() {
  return {
    title: "Editor",
    lead: "What happens as you type.",
    body: [
      sectionBlock("Typing", [
        settingRow("Markdown shortcuts", "Turn “# ” into a heading, “- ” into a bullet, “``` ” into code.",
          switchControl("Markdown shortcuts", "markdownShortcuts")),
        settingRow("Spell check", "Underline misspelled words in note text. Code blocks are never checked.",
          switchControl("Spell check", "spellcheck")),
        settingRow("Solve maths as you type", "Show the answer beside a line that is a calculation or an equation.",
          switchControl("Solve maths as you type", "smartMath")),
        settingRow("Detect pasted code", "Offer to turn a pasted snippet into a code block with the right language.",
          switchControl("Detect pasted code", "codeDetection")),
      ]),
      sectionBlock("Note", [
        el("p", { class: "settings-note", text: "Changes apply to notes you open from now on. Reopen a note already on screen to see them take effect." }),
      ]),
    ],
  };
}

function studyPage() {
  const flagSelect = el("select", { class: "settings-select", "aria-label": "Flagged card scheduling" },
    [["1", "Show again very soon"], ["2", "Show again sooner than normal"]].map(([value, text]) =>
      el("option", { value, text })));
  flagSelect.value = readPreference("studyFlagRating");
  flagSelect.addEventListener("change", () => writePreference("studyFlagRating", flagSelect.value));

  return {
    title: "Study",
    lead: "How review sessions are put together.",
    body: [
      sectionBlock("Sessions", [
        settingRow("Cards per session", "The most cards a single review session will hand you.",
          numberControl("Cards per session", "studyLimit", { min: 5, max: 200, step: 5, suffix: "cards" })),
        settingRow("Flagged cards", "How a card you flag during review is rescheduled.", flagSelect),
      ]),
      sectionBlock("Right now", [
        settingRow("Due today", "Cards the scheduler has ready for you.",
          el("span", { class: "setting-status on", text: `${state.study?.due || 0} due` })),
        settingRow("Reviewed today", "Counted across every deck.",
          el("span", { class: "setting-status", text: String(state.study?.reviewedToday || 0) })),
      ]),
    ],
  };
}

function subjectsPage(app, rerender) {
  const list = el("div", { class: "course-list" });
  const nameField = el("input", { class: "input", placeholder: "Add a subject…" });

  const paint = () => {
    clear(list);
    if (!state.classes.length) {
      list.append(empty("No subjects yet. Subjects group notes in the sidebar."));
      return;
    }
    for (const course of state.classes) {
      const count = state.pages.filter((page) => page.class_id === course.id).length;
      list.append(el("div", { class: "course-row" },
        el("span", { class: "course-dot", style: { background: course.color || "var(--accent)" } }),
        el("span", { class: "view-row-title", text: course.name }),
        el("span", { class: "view-row-meta", text: `${count} note${count === 1 ? "" : "s"}` }),
        iconButton("trash", "Delete subject", async () => {
          const ok = await confirmDialog({
            title: "Delete subject",
            message: `"${course.name}" is removed. Its ${count} note${count === 1 ? " stays" : "s stay"} in Notes.`,
            confirmLabel: "Delete subject",
          });
          if (!ok) return;
          await withError(() => api.del(`/api/notes/classes/${course.id}`), "Could not delete the subject");
          await loadWorkspace();
          await refreshPages();
          rerender();
        }, { size: 14 })));
    }
  };

  const add = async () => {
    const name = nameField.value.trim();
    if (!name) return;
    await withError(() => api.post("/api/notes/classes", { name }), "Could not add the subject");
    nameField.value = "";
    await loadWorkspace();
    rerender();
  };
  nameField.addEventListener("keydown", (event) => {
    if (event.key === "Enter") { event.preventDefault(); add(); }
  });

  paint();
  return {
    title: "Subjects",
    lead: "Subjects group notes in the sidebar and filter the command palette.",
    body: [
      el("section", { class: "settings-section" }, list),
      el("div", { class: "course-add" }, nameField,
        el("button", { class: "button primary", type: "button", onclick: add }, "Add subject")),
    ],
  };
}

function aiPage() {
  return {
    title: "AI",
    lead: "Clyra Notes uses the model provider already configured for Clyra.",
    body: [
      sectionBlock("Connection", [
        settingRow("Clyra AI", state.aiConfigured
          ? "Connected. Chat, generation and grading are available."
          : "Not configured. Add DEEPSEEK_API_KEY to .env.local and restart the server.",
          el("span", { class: `setting-status ${state.aiConfigured ? "on" : "off"}`, text: state.aiConfigured ? "Connected" : "Off" })),
      ]),
      sectionBlock("What AI can read", [
        settingRow("Your notes", "Answers are grounded in the pages you attach with @, and cite the block they came from.",
          el("span", { class: "setting-status on", text: "On request" })),
        settingRow("The web", "The browser panel fetches pages through this machine. Nothing reaches the model unless you attach it.",
          el("span", { class: "setting-status", text: "Local only" })),
      ]),
    ],
  };
}

function dataPage(app, close) {
  return {
    title: "Data",
    lead: "Everything lives on this machine. Nothing is uploaded.",
    body: [
      sectionBlock("Your notes", [
        settingRow("Export", "Download every note as markdown.",
          el("button", { class: "button", type: "button", onclick: () => app.exportAll() }, "Export all")),
        settingRow("Import", "Bring in markdown files or a folder of notes.",
          el("button", { class: "button", type: "button", onclick: () => { close(); app.openImport(null); } }, "Import…")),
        settingRow("Trash", "Deleted notes stay recoverable until you empty it.",
          el("button", { class: "button", type: "button", onclick: () => { close(); app.openTrash(); } },
            state.trashCount ? `Open trash (${state.trashCount})` : "Open trash")),
      ]),
      sectionBlock("Danger zone", [
        settingRow("Reset workspace",
          "Permanently removes every note, subject, study item, chat and attachment. This cannot be undone.",
          el("button", { class: "button danger", type: "button", onclick: async () => {
            const ok = await confirmDialog({
              title: "Remove everything?",
              message: "This permanently deletes all Notes pages, subjects, study data, chats and attachments. It cannot be undone.",
              confirmLabel: "Remove everything",
            });
            if (!ok) return;
            const result = await withError(() => api.del("/api/notes/workspace"), "Could not reset the Notes workspace");
            if (!result) return;
            state.open.clear();
            state.tabs = [];
            state.activeTab = null;
            state.closedTabs = [];
            state.classes = [];
            state.decks = [];
            state.tests = [];
            state.inbox = [];
            state.trashCount = 0;
            await loadWorkspace();
            saveSession();
            app.goHome();
            app.renderChrome();
            toast("Notes workspace reset");
            close();
          } }, "Remove everything"),
          { className: "danger-row" }),
      ]),
    ],
  };
}

function shortcutsPage() {
  const controls = new Map();
  const capture = (id, label) => {
    const input = el("input", { class: "settings-shortcut-input", value: shortcutLabel(id), "aria-label": `${label} shortcut`, readOnly: "" });
    controls.set(id, input);
    input.addEventListener("keydown", (event) => {
      if (["Tab", "Escape"].includes(event.key)) return;
      if (!event.metaKey && !event.ctrlKey) return;
      event.preventDefault();
      const key = event.key === "\\" ? "backslash" : event.key.toLowerCase();
      if (["meta", "control", "alt", "shift"].includes(key)) return;
      const pieces = ["meta", event.altKey ? "alt" : "", event.shiftKey ? "shift" : "", key].filter(Boolean);
      writeShortcut(id, pieces.join("+"));
      input.value = shortcutLabel(id);
    });
    return input;
  };
  const reset = el("button", { class: "button", type: "button", onclick: () => {
    resetShortcuts();
    SHORTCUTS.forEach(([id]) => { const control = controls.get(id); if (control) control.value = shortcutLabel(id); });
  } }, "Reset defaults");
  return {
    title: "Shortcuts",
    lead: "Choose the chords Notes listens for everywhere. Changes apply immediately and the tour updates too.",
    body: [
      sectionBlock("Workspace shortcuts", SHORTCUTS.map(([id, label]) =>
        settingRow(label, "Click the key field, then press a modifier and key.", capture(id, label)))),
      sectionBlock("Editor keys", [["/", "Insert a block"], ["@", "Reference a note in chat"], ["Space", "Ask AI on an empty line"], ["Esc", "Select the block you are in"], ["Backspace", "Delete the selected block"]].map(([keys, label]) =>
        el("div", { class: "setting-row shortcut-row" },
          el("div", { class: "setting-copy" },
            el("div", { class: "setting-label" }, el("span", { text: label }))),
          el("div", { class: "setting-control" }, el("kbd", { class: "settings-kbd", text: keys }))))),
      el("div", { class: "settings-actions" }, reset),
    ],
  };
}

/* --------------------------------------------------------------- dialog */

const NAV = [
  { group: "Workspace", items: [
    { id: "preferences", label: "Preferences", icon: "settings" },
    { id: "editor", label: "Editor", icon: "text" },
    { id: "subjects", label: "Subjects", icon: "book" },
  ] },
  { group: "Features", items: [
    { id: "study", label: "Study", icon: "cards" },
    { id: "ai", label: "AI", icon: "sparkle" },
  ] },
  { group: "Data", items: [
    { id: "data", label: "Storage", icon: "export" },
    { id: "shortcuts", label: "Shortcuts", icon: "keyboard" },
  ] },
];

export function openSettings(app, options = {}) {
  let entry;
  let current = options.page || "preferences";

  const nav = el("nav", { class: "settings-nav scroll", "aria-label": "Settings sections" });
  const pane = el("div", { class: "settings-pane scroll" });
  const close = () => entry?.close("done");

  const pageFor = (id) => {
    if (id === "editor") return editorPage();
    if (id === "study") return studyPage();
    if (id === "subjects") return subjectsPage(app, () => show("subjects"));
    if (id === "ai") return aiPage();
    if (id === "data") return dataPage(app, close);
    if (id === "shortcuts") return shortcutsPage();
    return preferencesPage(app);
  };

  const paintNav = () => {
    clear(nav);
    for (const section of NAV) {
      nav.append(el("div", { class: "settings-nav-group", text: section.group }));
      for (const item of section.items) {
        nav.append(el("button", {
          class: `settings-nav-item${item.id === current ? " active" : ""}`, type: "button",
          onclick: () => show(item.id),
        },
          el("span", { class: "settings-nav-icon" }, icon(item.icon, 16)),
          el("span", { text: item.label })));
      }
    }
  };

  const show = (id) => {
    current = id;
    paintNav();
    const page = pageFor(id);
    clear(pane);
    append(pane,
      el("header", { class: "settings-page-head" },
        el("h2", { class: "settings-page-title", text: page.title }),
        page.lead ? el("p", { class: "settings-page-lead", text: page.lead }) : null),
      ...page.body);
    pane.scrollTop = 0;
  };

  entry = modal({
    title: null,
    className: "settings-modal",
    width: 940,
    body: el("div", { class: "settings-layout" },
      el("aside", { class: "settings-side" },
        el("div", { class: "settings-brand" },
          el("span", { class: "workspace-avatar", text: "C" }),
          el("span", { class: "settings-brand-name", text: "Clyra Notes" })),
        nav),
      el("div", { class: "settings-main" },
        iconButton("close", "Close settings", () => close(), { size: 16, className: "settings-close" }),
        pane)),
  });
  show(current);
  return entry;
}

/* The sidebar's Subjects entry opens the same dialog on that page rather
   than a second, differently-shaped one. */
export const openCourses = (app) => openSettings(app, { page: "subjects" });

applyNotesPreferences();
window.addEventListener("storage", (event) => {
  if (event.key === "clyra-theme") applyNotesPreferences();
});
