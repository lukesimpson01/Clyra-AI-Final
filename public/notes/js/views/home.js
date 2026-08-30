/* Home. A welcome header, four ways to start, and a recent table.
   The keyboard hint at the foot is live: Space opens AI on a fresh page and
   "/" opens the command palette, so the line is an affordance, not decor. */
import { el, clear, icon, modKey, append, tooltip } from "../dom.js";
import { state } from "../state.js";
import { openSearch } from "../search.js";
import { formatRelative } from "../app.js";

export function renderHome(host, app) {
  const scroll = el("div", { class: "page-scroll scroll" });
  const column = el("div", { class: "home-column" });
  scroll.append(column);
  host.append(scroll);

  append(column,
    el("header", { class: "home-hero" },
      el("div", { class: "home-wave", role: "img", "aria-label": "Waving hand", text: "\u{1F44B}" }),
      el("h1", { class: "home-title", text: "Welcome to your workspace" }),
      el("p", { class: "home-subtitle", text: "Notes, docs, and study tools — all in one place." })),
    buildTools(app),
    buildRecent(app),
    buildHint(app),
  );

  const onKey = (event) => {
    /* closest() only exists on elements; a key event can target the document
       itself, which would otherwise throw and kill the handler. */
    if (event.target?.closest?.("input, textarea, [contenteditable='true']")) return;
    if (document.querySelector(".layer, .modal, .menu")) return;
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.key === "/") { event.preventDefault(); openSearch(); return; }
    if (event.key === " ") { event.preventDefault(); startWithAi(app); }
  };
  document.addEventListener("keydown", onKey);
  return { destroy() { document.removeEventListener("keydown", onKey); } };
}

/* Space on Home means the same thing it means on a page: start writing with
   AI. It creates the page first so the composer has somewhere to land. */
async function startWithAi(app) {
  const created = await app.createPage(null);
  if (!created) return;
  const settle = () => {
    const view = app.currentView;
    if (!view?.editor) { setTimeout(settle, 80); return; }
    view.editor.openAiComposer(view.editor.blocks[0], { mount: view.quickstart });
  };
  setTimeout(settle, 120);
}

/* The workspace's tools, each showing what is actually in it right now.
   Live counts are what make the row worth reading — a static grid of
   feature names was decoration, this is a status line you can act on. */
function buildTools(app) {
  const due = state.study.due || 0;
  const reviewed = state.study.reviewedToday || 0;
  const decks = state.decks?.length || 0;
  const tests = state.tests?.length || 0;
  const bestTest = (state.tests || []).find((test) => test.best_ratio != null);

  const tool = (tone, iconName, name, status, live, onClick) =>
    el("button", { class: `tool-row tone-${tone}`, type: "button", onclick: onClick },
      el("span", { class: "tool-icon" }, icon(iconName, 17)),
      el("span", { class: "tool-text" },
        el("span", { class: "tool-name", text: name }),
        el("span", { class: "tool-status", text: status })),
      live ? el("span", { class: "tool-live", text: live }) : null);

  return el("section", { class: "home-section" },
    el("h2", { class: "home-section-title", text: "Your workspace" }),
    el("div", { class: "tool-grid" },
      tool("accent", "sparkle", "Ask AI", "Grounded in your notes", null,
        () => app.openView({ kind: "chat" })),
      tool("green", "cards", "Flashcards",
        decks ? `${decks} deck${decks === 1 ? "" : "s"}${reviewed ? ` · ${reviewed} today` : ""}` : "No decks yet",
        due ? `${due} due` : null,
        () => app.openView({ kind: "flashcards" })),
      tool("orange", "check_square", "Practice tests",
        tests ? `${tests} test${tests === 1 ? "" : "s"}` : "None yet",
        bestTest ? `${Math.round(bestTest.best_ratio * 100)}%` : null,
        () => app.openView({ kind: "tests" })),
      tool("ink", "mic", "Lecture notes", "Record and transcribe", null,
        () => app.generate("lecture", {}))));
}

/* The "type" column names where a page lives — its course, or the kind of
   thing it is — which is what makes the table scannable. */
function pageKindLabel(page) {
  if (page.kind === "database") return "Database";
  const course = state.classes.find((entry) => entry.id === page.class_id);
  if (course) return course.name;
  return page.parent_id ? "Subpage" : "Private";
}

function buildRecent(app) {
  const recents = [...state.pages]
    .filter((page) => page.kind !== "record")
    .sort((a, b) => String(b.updated_at || "").localeCompare(String(a.updated_at || "")))
    .slice(0, 3);

  const body = el("div", { class: "recent-table" });
  if (!recents.length) {
    body.append(el("div", { class: "recent-empty" },
      "Nothing here yet.",
      el("button", { class: "button primary", type: "button", onclick: () => app.createPage(null) }, "Create your first page")));
  } else {
    for (const page of recents) {
      const emoji = page.icon && !/^https?:|^\//.test(page.icon) ? page.icon : null;
      body.append(el("button", {
        class: "recent-row", type: "button",
        onclick: (event) => app.openPage(page.id, { newTab: modKey(event) }),
      },
        el("span", { class: "recent-icon", text: emoji || "" }, emoji ? null : icon(page.kind === "database" ? "table" : "page", 17)),
        el("span", { class: "recent-name", text: page.title || "New page" }),
        el("span", { class: "recent-kind", text: pageKindLabel(page) }),
        el("span", { class: "recent-time", text: formatRelative(page.updated_at) })));
    }
  }
  return el("section", { class: "home-section" },
    el("div", { class: "home-section-head" },
      el("h2", { class: "home-section-title", text: "Recent" }),
      recents.length
        ? el("button", { class: "home-section-link", type: "button", onclick: () => app.openView({ kind: "library" }) },
            "View all", icon("chevron_right", 12))
        : null),
    body);
}

function buildHint(app) {
  return el("div", { class: "home-hint" },
    el("span", { class: "home-hint-key" }, icon("keyboard", 15)),
    el("span", {}, "Press "),
    el("kbd", { text: "space" }),
    el("span", {}, " for AI, "),
    el("kbd", { text: "/" }),
    el("span", {}, " for commands…"));
}

/* Shared row and section helpers used by the other views. */
export function section(title, rows, actions) {
  return el("section", { class: "view-section" },
    el("div", { class: "view-section-head" },
      el("h2", { class: "view-section-title", text: title }),
      actions || null),
    el("div", { class: "view-rows" }, rows));
}

export function row({ icon: iconName, emoji, title, meta, badge, accent, onClick }) {
  return el("button", { class: `view-row${accent ? " accent" : ""}`, type: "button", onclick: onClick },
    el("span", { class: "page-icon", text: emoji || "" }, emoji ? null : icon(iconName || "page", 16)),
    el("span", { class: "view-row-title", text: title }),
    badge ? el("span", { class: "view-row-badge", text: badge }) : null,
    meta ? el("span", { class: "view-row-meta", text: meta }) : null);
}

export function empty(message, actions = []) {
  return el("div", { class: "empty-state" }, message,
    actions.length
      ? el("div", { class: "actions" }, actions.map((action) =>
          el("button", { class: `button${action.primary ? " primary" : ""}`, type: "button", onclick: action.onClick }, action.label)))
      : null);
}
