/* Workspace search. Opens on recents, searches titles, block text and
   database values, and hands back a result rather than navigating itself so
   it can also serve "link to page" and "move to". */
import { el, clear, icon, pushLayer, mod, modKey, append } from "./dom.js";
import { api } from "./api.js";
import { state, getPageMeta } from "./state.js";

/* With no query the palette lists the whole workspace, most recent first —
   so it doubles as a file list you can jump from, not just a search box. */
const allFiles = () =>
  [...state.pages]
    .filter((page) => page.kind !== "record")
    .sort((a, b) => String(b.updated_at || "").localeCompare(String(a.updated_at || "")));

/* Where a page lives, read outwards: its subject first if it has one, then
   every ancestor page down to its parent. The guard is for a parent chain
   that has been corrupted into a loop — the palette must still open. */
const crumbFor = (page) => {
  if (!page) return [];
  const trail = [];
  let cursor = page.parent_id ? state.pageById.get(String(page.parent_id)) : null;
  const guard = new Set();
  while (cursor && !guard.has(String(cursor.id))) {
    guard.add(String(cursor.id));
    trail.unshift({ id: String(cursor.id), name: cursor.title || "New page", kind: "page" });
    cursor = cursor.parent_id ? state.pageById.get(String(cursor.parent_id)) : null;
  }
  const course = state.classes.find((entry) => entry.id === page.class_id);
  return course ? [{ id: course.id, name: course.name, kind: "subject" }, ...trail] : trail;
};

/* Every result is a page in the tree, so it is decorated the same way
   whether it arrived from the local list or the server index. */
const decorate = (item) => {
  const pageId = String(item.page_id || item.id);
  const page = state.pageById.get(pageId) || item;
  return {
    ...item,
    page_id: pageId,
    icon: item.icon ?? page.icon ?? null,
    title: item.title || page.title || "New page",
    breadcrumb: crumbFor(page),
  };
};

export function openSearch({ title = "Search", onSelect, onClose, filterKinds } = {}) {
  const input = el("input", {
    class: "search-input", type: "text", placeholder: "Search pages, notes and study material…",
    "aria-label": "Search", autocomplete: "off", spellcheck: "false",
  });
  const filterBar = el("div", { class: "search-filters" });
  const results = el("div", { class: "search-results scroll", role: "listbox" });
  const node = el("div", { class: "command-palette", role: "dialog", "aria-label": title },
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
  /* This is a workspace jump menu, not a separate mode. It stays a compact
     dropdown over the current note so the writing surface remains in view. */
  const entry = pushLayer(node, { onClose });

  const buildFilters = () => {
    clear(filterBar);
    if (!state.classes.length) return;
    const chip = (label, value) => el("button", {
      class: `filter-chip${classFilter === value ? " active" : ""}`, type: "button",
      onclick: () => { classFilter = classFilter === value ? null : value; buildFilters(); run(input.value); },
    }, label);
    append(filterBar, chip("All courses", null), ...state.classes.map((course) => chip(course.name, course.id)));
  };

  /* The path is shown on every row, not only on rows without an excerpt:
     two pages called "Notes" are told apart by where they live, which is
     exactly the case where an excerpt is least help. */
  const crumbLine = (breadcrumb) => {
    if (!breadcrumb?.length) return null;
    const line = el("span", { class: "search-crumb" });
    breadcrumb.forEach((crumb, index) => {
      if (index) append(line, el("span", { class: "search-crumb-sep", text: "/" }));
      append(line, el("span", { class: `search-crumb-part${crumb.kind === "subject" ? " subject" : ""}`, text: crumb.name }));
    });
    return line;
  };

  const rowFor = (item) => {
    const row = el("button", { class: "search-row", type: "button", role: "option" },
      el("span", { class: "page-icon", text: item.icon || "" }, item.icon ? null : icon(item.kind === "database" ? "table" : "page", 15)),
      el("span", { class: "search-text" },
        el("span", { class: "search-title", text: item.title || "New page" }),
        crumbLine(item.breadcrumb),
        item.excerpt ? el("span", { class: "search-excerpt", html: item.excerpt }) : null),
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

  /* A page whose title matches is always offered, even before the server's
     index has caught up with a rename — the palette is the file list, so a
     file you can see in the sidebar has to be findable here. */
  const localMatches = (term) => allFiles()
    .filter((page) => !classFilter || page.class_id === classFilter)
    .map((page) => {
      const title = String(page.title || "New page").toLowerCase();
      const path = crumbFor(page).map((crumb) => crumb.name).join(" ").toLowerCase();
      if (title === term) return { page, rank: 0 };
      if (title.startsWith(term)) return { page, rank: 1 };
      if (title.includes(term)) return { page, rank: 2 };
      if (path.includes(term)) return { page, rank: 3 };
      return null;
    })
    .filter(Boolean)
    .sort((a, b) => a.rank - b.rank)
    .map(({ page }) => decorate({ ...page, page_id: page.id }));

  const run = async (query) => {
    const trimmed = query.trim();
    if (!trimmed) {
      const files = allFiles()
        .filter((page) => !classFilter || page.class_id === classFilter)
        .map((page) => decorate({ ...page, page_id: page.id }));
      paint(files, files.length ? `All pages \u00b7 ${files.length}` : null);
      return;
    }
    const term = trimmed.toLowerCase();
    /* Title matches paint immediately; the server's full-text results are
       merged in underneath them when they arrive. */
    const local = localMatches(term);
    paint(dedupe(local), null);

    const current = ++token;
    const found = await api.get("/api/notes/search", classFilter ? { q: trimmed, classId: classFilter } : { q: trimmed })
      .catch(() => []);
    if (current !== token) return;
    const filtered = filterKinds ? found.filter((item) => filterKinds.includes(item.kind)) : found;
    const remote = filtered.map((item) => ({
      ...decorate(item),
      badge: item.kind === "database" ? "Database" : item.kind === "record" ? "Record" : null,
    }));
    paint(dedupe([...local, ...remote]), null);
  };

  /* One row per page: a title hit and a body hit for the same file are the
     same destination, and the title hit is the one worth keeping. */
  const dedupe = (list) => {
    const seen = new Set();
    const out = [];
    for (const item of list) {
      const key = `${item.page_id}:${item.block_id || ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(item);
    }
    return out;
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
