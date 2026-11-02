/* The comments panel: the conversation on the open page, and on single blocks of it.

   A comment belongs to a page, or to one block of it with the block's words kept beside it, so the thread still reads
   sensibly if the block is later changed or removed. Resolved threads move out of the way, as in Notion, and can be
   reopened. */
import { el, clear, icon, iconButton, toast, confirmDialog } from "../dom.js";
import { api } from "../api.js";
import { withError } from "../state.js";
import { formatRelative } from "../app.js";

export function commentsPanel(app) {
  let pageId = null;
  let comments = [];
  let showResolved = false;
  let target = null; // { blockId, quote } when the next comment is about one block

  const list = el("div", { class: "comments-list scroll" });
  const targetChip = el("div", { class: "comment-target", hidden: true });
  const input = el("textarea", { class: "comment-input", rows: "1", placeholder: "Add a comment…", "aria-label": "Add a comment" });
  const send = el("button", { class: "comment-send", type: "button", "aria-label": "Post comment", disabled: true },
    el("span", { html: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V6M6 12l6-6 6 6"/></svg>' }));
  const tabs = el("div", { class: "comments-tabs", role: "tablist" });
  const node = el("div", { class: "rail-panel comments-panel" }, tabs, list, el("div", { class: "comment-composer" }, targetChip, input, el("div", { class: "comment-actions" }, send)));

  const grow = () => { input.style.height = "auto"; input.style.height = `${Math.min(120, input.scrollHeight)}px`; };
  const sync = () => { send.disabled = !input.value.trim(); };
  input.addEventListener("input", () => { grow(); sync(); });
  input.addEventListener("keydown", (event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); post(); } });
  send.addEventListener("click", () => post());

  const paintTarget = () => {
    clear(targetChip);
    targetChip.hidden = !target;
    if (!target) return;
    targetChip.append(icon("comment", 13), el("span", { class: "comment-target-text", text: target.quote ? `“${target.quote.slice(0, 80)}”` : "This block" }),
      el("button", { class: "comment-target-clear", type: "button", "aria-label": "Comment on the whole page", onclick: () => { target = null; paintTarget(); input.focus(); } }, icon("close", 10)));
  };

  const load = async () => {
    pageId = app.currentPageId?.() ? String(app.currentPageId()) : null;
    comments = pageId ? (await withError(() => api.get(`/api/notes/pages/${pageId}/comments`), "Could not load comments")) || [] : [];
    paint();
    app.refreshCommentMarks?.();
  };

  const post = async () => {
    const body = input.value.trim();
    if (!body || !pageId) return;
    const made = await withError(() => api.post(`/api/notes/pages/${pageId}/comments`, { body, blockId: target?.blockId, quote: target?.quote }), "Could not post that comment");
    if (!made) return;
    input.value = ""; grow(); sync(); target = null; paintTarget();
    await load();
    list.scrollTop = list.scrollHeight;
  };

  const setResolved = async (comment, resolved) => {
    await withError(() => api.patch(`/api/notes/comments/${comment.id}`, { resolved }), "Could not update that comment");
    await load();
  };

  const remove = async (comment) => {
    const ok = await confirmDialog({ title: "Delete comment", message: "This comment is removed for good.", confirmLabel: "Delete" });
    if (!ok) return;
    await withError(() => api.del(`/api/notes/comments/${comment.id}`), "Could not delete that comment");
    await load();
  };

  const edit = (comment, body) => {
    const field = el("textarea", { class: "comment-edit", rows: "2", "aria-label": "Edit comment" });
    field.value = comment.body;
    const save = el("button", { class: "ai-action", type: "button" }, "Save");
    const cancel = el("button", { class: "ai-action", type: "button" }, "Cancel");
    const row = el("div", { class: "comment-edit-row" }, field, el("div", { class: "comment-edit-actions" }, cancel, save));
    body.replaceWith(row);
    field.focus();
    cancel.addEventListener("click", () => paint());
    save.addEventListener("click", async () => {
      const value = field.value.trim();
      if (!value) return;
      await withError(() => api.patch(`/api/notes/comments/${comment.id}`, { body: value }), "Could not save that comment");
      await load();
    });
  };

  const card = (comment) => {
    const body = el("p", { class: "comment-body", text: comment.body });
    return el("article", { class: `comment${comment.resolved ? " resolved" : ""}` },
      el("div", { class: "comment-head" },
        el("span", { class: "comment-avatar", "aria-hidden": "true", text: "Y" }),
        el("span", { class: "comment-author", text: "You" }),
        el("span", { class: "comment-time", text: formatRelative(comment.created_at) }),
        el("span", { class: "comment-spacer" }),
        iconButton("check_square", comment.resolved ? "Reopen" : "Resolve", () => setResolved(comment, !comment.resolved), { size: 14, className: "comment-tool" }),
        iconButton("pencil", "Edit", () => edit(comment, body), { size: 14, className: "comment-tool" }),
        iconButton("trash", "Delete", () => remove(comment), { size: 14, className: "comment-tool" })),
      comment.block_id
        ? el("button", { class: "comment-quote", type: "button", title: "Show this block", onclick: () => app.openPage(pageId, { blockId: comment.block_id }) }, comment.quote ? `“${comment.quote}”` : "A block on this page")
        : null,
      body);
  };

  const paint = () => {
    const open = comments.filter((comment) => !comment.resolved);
    const done = comments.filter((comment) => comment.resolved);
    clear(tabs);
    for (const [label, resolvedView, count] of [["Open", false, open.length], ["Resolved", true, done.length]]) {
      tabs.append(el("button", {
        class: `comments-tab${showResolved === resolvedView ? " selected" : ""}`, type: "button", role: "tab", "aria-selected": String(showResolved === resolvedView),
        onclick: () => { showResolved = resolvedView; paint(); },
      }, label, count ? el("span", { class: "comments-count", text: String(count) }) : null));
    }
    clear(list);
    if (!pageId) { list.append(el("div", { class: "comments-empty", text: "Open a note to see its comments." })); input.disabled = true; return; }
    input.disabled = false;
    const shown = showResolved ? done : open;
    if (!shown.length) {
      list.append(el("div", { class: "comments-empty" },
        el("strong", { text: showResolved ? "Nothing resolved yet" : "No comments yet" }),
        el("span", { text: showResolved ? "Resolved comments collect here." : "Start a conversation on this page, or on a block from its ⋮⋮ menu." })));
      return;
    }
    for (const comment of shown) list.append(card(comment));
  };

  /* "Comment" on a block's menu lands here with the block already chosen. */
  const onTarget = (event) => {
    const { blockId, quote } = event.detail || {};
    target = blockId ? { blockId, quote: String(quote || "").replace(/\s+/g, " ").trim().slice(0, 240) } : null;
    showResolved = false;
    paintTarget();
    paint();
    input.focus();
  };
  window.addEventListener("clyra:comment-on", onTarget);

  paintTarget();
  return {
    node,
    refresh: load,
    focus: () => input.focus(),
    destroy: () => window.removeEventListener("clyra:comment-on", onTarget),
  };
}
