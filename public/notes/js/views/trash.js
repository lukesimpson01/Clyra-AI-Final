/* Trash: search, restore, delete permanently. */
import { el, clear, icon, modal, toast, confirmDialog, append } from "../dom.js";
import { api } from "../api.js";
import { state, refreshPages, withError } from "../state.js";
import { empty } from "./home.js";
import { formatRelative } from "../app.js";

export function openTrash(app) {
  const body = el("div", { class: "trash-body" });
  const search = el("input", { class: "input", placeholder: "Search the trash…" });
  let entry;
  let items = [];

  const paint = () => {
    clear(body);
    const term = search.value.trim().toLowerCase();
    const list = items.filter((page) => !term || String(page.title || "").toLowerCase().includes(term));
    if (!list.length) { append(body, empty(items.length ? "No results." : "The trash is empty.")); return; }
    for (const page of list) {
      append(body, el("div", { class: "trash-row" },
        el("span", { class: "page-icon", text: page.icon && !/^https?:|^\//.test(page.icon) ? page.icon : "" },
          page.icon ? null : icon("page", 15)),
        el("span", { class: "view-row-title", text: page.title || "New page" }),
        el("span", { class: "view-row-meta", text: formatRelative(page.trashed_at) }),
        el("button", { class: "button", type: "button", onclick: async () => {
          await withError(() => api.post(`/api/notes/pages/${page.id}/restore`), "Could not restore");
          state.trashCount = Math.max(0, state.trashCount - 1);
          await refreshPages();
          await load();
          toast("Page restored");
        } }, "Restore"),
        el("button", { class: "button danger", type: "button", onclick: async () => {
          const ok = await confirmDialog({
            title: "Delete permanently",
            message: `"${page.title || "New page"}" cannot be recovered after this.`,
            confirmLabel: "Delete permanently",
          });
          if (!ok) return;
          await withError(() => api.del(`/api/notes/pages/${page.id}/forever`), "Could not delete");
          state.trashCount = Math.max(0, state.trashCount - 1);
          await load();
        } }, "Delete")));
    }
  };

  const load = async () => {
    items = (await withError(() => api.get("/api/notes/trash"), "Could not load the trash")) || [];
    state.trashCount = items.length;
    paint();
  };

  search.addEventListener("input", paint);
  entry = modal({
    title: "Trash", width: 620,
    body: el("div", {}, el("div", { class: "field" }, search), body),
  });
  load();
  return entry;
}
