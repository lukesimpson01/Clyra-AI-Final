/* Workspace search. Opens on recents, searches titles, block text and
   database values, and hands back a result rather than navigating itself so
   it can also serve "link to page" and "move to". */
import { el, clear, icon, modal, pushLayer, position, mod, modKey, append } from "./dom.js";
import { api } from "./api.js";
import { state, getPageMeta } from "./state.js";

/* With no query the palette lists the whole workspace, most recent first —
   so it doubles as a file list you can jump from, not just a search box. */
const allFiles = () =>
  [...state.pages]
    .filter((page) => page.kind !== "record")
    .sort((a, b) => String(b.updated_at || "").localeCompare(String(a.updated_at || "")));

const crumbFor = (page) => {
  const trail = [];
  let cursor = page.parent_id ? state.pageById.get(String(page.parent_id)) : null;
  const guard = new Set();
  while (cursor && !guard.has(String(cursor.id))) {
    guard.add(String(cursor.id));
    trail.unshift(cursor.title || "New page");
    cursor = cursor.parent_id ? state.pageById.get(String(cursor.parent_id)) : null;
  }
  const course = state.classes.find((entry) => entry.id === page.class_id);
  return course ? [course.name, ...trail] : trail;
};

export function openSearch({ title = "Search", onSelect, onClose, filterKinds } = {}) {
  const input = el("input", {
    class: "search-input", type: "text", placeholder: "Search pages, notes and study material…",
    "aria-label": "Search", autocomplete: "off", spellcheck: "false",
  });
  const filterBar = el("div", { class: "search-filters" });
  const results = el("div", { class: "search-results scroll", role: "listbox" });
  const node = el("div", { class: "modal search-modal", role: "dialog", "aria-modal": "true", "aria-label": title },
    el("div", { class: "search-header" }, icon("search", 16), input),
    filterBar,
    results,
    el("div", { class: "search-footer" },
      el("span", { class: "shortcut", text: "↑↓ to navigate" }),
      el("span", { class: "shortcut", text: "↵ to open" }),
      el("span", { class: "shortcut", text: `${mod}+↵ opens in a new tab` })),
  );

  let rows = [];
  let activeIndex = 0;
  let classFilter = null;
  let token = 0;
  const entry = pushLayer(node, { scrim: true, onClose });

  const buildFilters = () => {
    clear(filterBar);
    if (!state.classes.length) return;
    const chip = (label, value) => el("button", {
      class: `filter-chip${classFilter === value ? " active" : ""}`, type: "button",
      onclick: () => { classFilter = classFilter === value ? null : value; buildFilters(); run(input.value); },
    }, label);
    append(filterBar, chip("All courses", null), ...state.classes.map((course) => chip(course.name, course.id)));
  };

  const rowFor = (item) => {
    const row = el("button", { class: "search-row", type: "button", role: "option" },
      el("span", { class: "page-icon", text: item.icon || "" }, item.icon ? null : icon(item.kind === "database" ? "table" : "page", 15)),
      el("span", { class: "search-text" },
        el("span", { class: "search-title", text: item.title || "New page" }),
        item.excerpt
          ? el("span", { class: "search-excerpt", html: item.excerpt })
          : item.breadcrumb?.length ? el("span", { class: "search-crumb", text: item.breadcrumb.join(" / ") }) : null),
      item.badge ? el("span", { class: "search-badge", text: item.badge }) : null);
    row.addEventListener("click", (event) => choose(item, modKey(event)));
    row.addEventListener("mouseenter", () => setActive(rows.indexOf(row)));
    return row;
  };

  const setActive = (index) => {
    rows.forEach((row) => row.classList.remove("active"));
    activeIndex = Math.max(0, Math.min(index, rows.length - 1));
    rows[activeIndex]?.classList.add("active");
    rows[activeIndex]?.scrollIntoView({ block: "nearest" });
  };

  let items = [];
  /* The selection runs before the layer closes: closing first would fire
     onClose, and callers use that to detect a dismissal. */
  const choose = (item, newTab) => {
    onSelect
      ? onSelect(item, { newTab })
      : window.dispatchEvent(new CustomEvent("clyra:open-page", { detail: { id: item.page_id || item.id, newTab } }));
    entry.close("select");
  };

  const paint = (list, heading) => {
    clear(results);
    rows = [];
    items = list;
    if (heading) append(results, el("div", { class: "search-heading", text: heading }));
    if (!list.length) {
      append(results, el("div", { class: "search-empty", text: input.value.trim() ? "No results." : "Nothing here yet." }));
      return;
    }
    for (const item of list) { const row = rowFor(item); rows.push(row); append(results, row); }
    setActive(0);
  };

  const run = async (query) => {
    const trimmed = query.trim();
    if (!trimmed) {
      const files = allFiles()
        .filter((page) => !classFilter || page.class_id === classFilter)
        .map((page) => ({ ...page, page_id: page.id, breadcrumb: crumbFor(page) }));
      paint(files, files.length ? `All pages · ${files.length}` : null);
      return;
    }
    const current = ++token;
    const found = await api.get("/api/notes/search", classFilter ? { q: trimmed, classId: classFilter } : { q: trimmed })
      .catch(() => []);
    if (current !== token) return;
    const filtered = filterKinds ? found.filter((item) => filterKinds.includes(item.kind)) : found;
    paint(filtered.map((item) => ({ ...item, badge: item.kind === "database" ? "Database" : item.kind === "record" ? "Record" : null })), null);
  };

  input.addEventListener("input", () => run(input.value));
  input.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown") { event.preventDefault(); setActive(activeIndex + 1); }
    else if (event.key === "ArrowUp") { event.preventDefault(); setActive(activeIndex - 1); }
    else if (event.key === "Enter") { event.preventDefault(); if (items[activeIndex]) choose(items[activeIndex], modKey(event)); }
    else if (event.key === "Escape") { event.preventDefault(); entry.close("escape"); }
  });

  buildFilters();
  run("");
  queueMicrotask(() => input.focus());
  return entry;
}
