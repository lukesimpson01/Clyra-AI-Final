/* Inbox: study reminders and completed AI jobs, as compact rows. */
import { el, clear, icon, iconButton, toast, append } from "../dom.js";
import { api } from "../api.js";
import { state, withError } from "../state.js";
import { empty } from "./home.js";
import { formatRelative } from "../app.js";

const KIND_ICONS = { study: "cards", ai: "sparkle", test: "check_square", system: "inbox" };

export function renderInbox(host, app) {
  let showUnread = false;

  const draw = async () => {
    clear(host);
    const scroll = el("div", { class: "page-scroll scroll" });
    const column = el("div", { class: "page-column view-column" });
    scroll.append(column);
    host.append(scroll);

    const events = await withError(() => api.get("/api/notes/inbox", showUnread ? { unread: "1" } : undefined), "Could not load the inbox");
    if (!events) return;
    state.inbox = events;

    append(column, el("div", { class: "view-header" },
      el("h1", { class: "view-title", text: "Inbox" }),
      el("div", { class: "view-header-actions" },
        el("button", {
          class: `button${showUnread ? " primary" : ""}`, type: "button",
          onclick: () => { showUnread = !showUnread; draw(); },
        }, "Unread"),
        el("button", {
          class: "button", type: "button", disabled: !events.some((event) => !event.read_at),
          onclick: async () => { await withError(() => api.post("/api/notes/inbox/read-all"), "Could not update"); draw(); },
        }, "Mark all read"))));

    if (!events.length) {
      append(column, empty(showUnread ? "Nothing unread." : "Nothing here yet. Reminders and finished AI jobs appear in your inbox."));
      return;
    }

    append(column, el("div", { class: "view-rows" }, events.map((event) =>
      el("div", { class: `inbox-row${event.read_at ? "" : " unread"}` },
        el("span", { class: "page-icon" }, icon(KIND_ICONS[event.kind] || "inbox", 16)),
        el("button", {
          class: "inbox-body", type: "button",
          onclick: async () => {
            if (!event.read_at) await api.post(`/api/notes/inbox/${event.id}/read`).catch(() => {});
            if (event.page_id) app.openPage(event.page_id);
            else draw();
          },
        },
          el("span", { class: "inbox-title", text: event.title }),
          event.body ? el("span", { class: "inbox-text", text: event.body }) : null),
        el("span", { class: "view-row-meta", text: formatRelative(event.created_at) }),
        iconButton("close", "Archive", async () => {
          await withError(() => api.post(`/api/notes/inbox/${event.id}/archive`), "Could not archive");
          draw();
        })))));
  };

  draw();
  return { destroy() {} };
}
