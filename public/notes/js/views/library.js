/* Library: an expanded view of everything in the workspace, filtered the
   same way the sidebar groups it. */
import { el, clear, icon, modKey, append } from "../dom.js";
import { state } from "../state.js";
import { row, empty } from "./home.js";
import { formatRelative } from "../app.js";

export function renderLibrary(host, app) {
  let kind = "all";
  let classId = null;
  let sort = "recent";
  let query = "";

  const draw = () => {
    clear(host);
    const scroll = el("div", { class: "page-scroll scroll" });
    const column = el("div", { class: "page-column view-column" });
    scroll.append(column);
    host.append(scroll);

    const search = el("input", { class: "input library-search", placeholder: "Filter by title…", value: query });
    search.addEventListener("input", () => { query = search.value; paint(); });

    append(column, 
      el("h1", { class: "view-title", text: "Library" }),
      el("div", { class: "library-controls" },
        search,
        chipGroup([["all", "All"], ["page", "Pages"], ["database", "Databases"], ["favorite", "Favorites"]], kind, (value) => { kind = value; paint(); }),
        state.classes.length
          ? chipGroup([[null, "Every course"], ...state.classes.map((course) => [course.id, course.name])], classId, (value) => { classId = value; paint(); })
          : null,
        chipGroup([["recent", "Recently edited"], ["created", "Newest"], ["title", "A–Z"]], sort, (value) => { sort = value; paint(); })),
    );

    const list = el("div", { class: "view-rows" });
    append(column, list);

    const paint = () => {
      clear(list);
      let pages = state.pages.filter((page) => page.kind !== "record");
      if (kind === "page") pages = pages.filter((page) => page.kind === "page");
      if (kind === "database") pages = pages.filter((page) => page.kind === "database");
      if (kind === "favorite") pages = pages.filter((page) => page.favorite);
      if (classId) pages = pages.filter((page) => page.class_id === classId);
      if (query.trim()) pages = pages.filter((page) => (page.title || "").toLowerCase().includes(query.trim().toLowerCase()));
      pages = [...pages].sort((a, b) =>
        sort === "title" ? String(a.title || "").localeCompare(String(b.title || ""))
          : sort === "created" ? String(b.created_at || "").localeCompare(String(a.created_at || ""))
          : String(b.updated_at || "").localeCompare(String(a.updated_at || "")));
      if (!pages.length) { append(list, empty("Nothing matches these filters.")); return; }
      for (const page of pages) {
        append(list, row({
          emoji: page.icon && !/^https?:|^\//.test(page.icon) ? page.icon : null,
          icon: page.kind === "database" ? "table" : "page",
          title: page.title || "New page",
          badge: page.favorite ? "★" : null,
          meta: formatRelative(page.updated_at),
          onClick: (event) => app.openPage(page.id, { newTab: modKey(event) }),
        }));
      }
    };
    paint();
  };

  const chipGroup = (options, current, onPick) =>
    el("div", { class: "chip-group" }, options.map(([value, label]) =>
      el("button", {
        class: `filter-chip${current === value ? " active" : ""}`, type: "button",
        onclick: () => onPick(value),
      }, label)));

  draw();
  return { destroy() {} };
}
