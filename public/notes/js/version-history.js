/* Version history for a note, backed by git on the server. Every change
   accepted from chat is recorded before and after, tagged with the chat
   message it came from. Any version can be previewed as the real page,
   compared line by line with the one before it, and restored (restoring is
   itself recorded, so nothing is ever lost). */
import { el, clear, icon, modal, toast, confirmDialog } from "./dom.js";
import { api } from "./api.js";
import { Editor } from "./editor.js";
import { refreshPages } from "./state.js";

const relative = (iso) => {
  const seconds = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h ago`;
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" }) + ", " + new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
};

/* A small line diff (longest common subsequence) so the comparison reads like a review. */
export function lineDiff(before, after) {
  const a = before.split("\n"); const b = after.split("\n");
  const table = Array.from({ length: a.length + 1 }, () => new Uint16Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i -= 1) for (let j = b.length - 1; j >= 0; j -= 1) table[i][j] = a[i] === b[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
  const out = []; let i = 0; let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { out.push({ type: "same", text: a[i] }); i += 1; j += 1; }
    else if (table[i + 1][j] >= table[i][j + 1]) { out.push({ type: "del", text: a[i] }); i += 1; }
    else { out.push({ type: "add", text: b[j] }); j += 1; }
  }
  while (i < a.length) out.push({ type: "del", text: a[i++] });
  while (j < b.length) out.push({ type: "add", text: b[j++] });
  return out;
}

export async function openVersions(app, pageId, { focus = null, title = "" } = {}) {
  const versions = await api.get(`/api/notes/pages/${encodeURIComponent(pageId)}/history`).catch(() => []);
  const list = el("div", { class: "vh-list", role: "listbox", "aria-label": "Versions" });
  const stage = el("div", { class: "vh-stage" });
  const footer = el("div", { class: "vh-footer" });
  const saveNow = async () => {
    const result = await api.post(`/api/notes/pages/${encodeURIComponent(pageId)}/history`, { label: "Saved version" }).catch(() => null);
    if (!result?.ok) { toast("Could not save a version"); return; }
    entry.close("saved"); toast("Version saved"); openVersions(app, pageId, { focus: result.sha, title });
  };
  let active = null;
  let tab = "preview";
  let loaded = null;
  const entry = modal({ title: `Version history${title ? ` · ${title}` : ""}`, width: 1040, className: "vh-modal", body: el("div", { class: "vh" }, list, el("div", { class: "vh-main" }, stage, footer)) });

  const paintStage = () => {
    clear(stage); clear(footer);
    if (!loaded) { stage.append(el("div", { class: "vh-empty" }, "Choose a version to preview it.")); return; }
    const switcher = el("div", { class: "vh-tabs", role: "tablist" }, ["preview", "changes"].map((name) =>
      el("button", { class: `vh-tab${tab === name ? " on" : ""}`, type: "button", role: "tab", onclick: () => { tab = name; paintStage(); } }, name === "preview" ? "Preview" : "Changes")));
    stage.append(switcher);
    if (tab === "preview") {
      const host = el("div", { class: "vh-page" }, el("h2", { class: "vh-title", text: `${loaded.icon && !/^https?:|^\//.test(loaded.icon) ? `${loaded.icon} ` : ""}${loaded.title}` }));
      const body = el("div", { class: "vh-doc" });
      host.append(body);
      stage.append(host);
      new Editor(body, { page: { id: `vh-${active.sha}`, title: loaded.title, blocks: loaded.blocks, breadcrumb: [] }, readOnly: true });
    } else {
      const rows = lineDiff(loaded.previous || "", loaded.markdown || "").filter((row, index, all) => row.type !== "same" || all.slice(Math.max(0, index - 2), index + 3).some((near) => near.type !== "same"));
      const diff = el("div", { class: "vh-diff" }, rows.length ? rows.map((row) => el("div", { class: `vh-line ${row.type}` }, el("span", { class: "vh-sign", text: row.type === "add" ? "+" : row.type === "del" ? "−" : " " }), el("span", { class: "vh-text", text: row.text || " " }))) : el("div", { class: "vh-empty" }, "No differences from the version before."));
      stage.append(diff);
    }
    footer.append(
      el("span", { class: "vh-meta", text: `${active.label} · ${relative(active.at)}` }),
      el("button", { class: "button", type: "button", onclick: saveNow }, "Save current state"),
      el("button", { class: "button", type: "button", onclick: () => entry.close("done") }, "Close"),
      el("button", { class: "button primary", type: "button", onclick: async () => {
        const ok = await confirmDialog({ title: "Restore this version?", message: "The note goes back to this version. The current state is saved first, so you can come back to it.", confirmLabel: "Restore", danger: false });
        if (!ok) return;
        const result = await api.post(`/api/notes/pages/${encodeURIComponent(pageId)}/history/${active.sha}/restore`, {}).catch(() => null);
        if (!result?.ok) { toast("Could not restore that version"); return; }
        await refreshPages();
        if (String(app.currentPageId?.() || "") === String(pageId)) app.reloadView?.();
        entry.close("restored");
        toast("Version restored");
      } }, icon("refresh", 13), "Restore this version"));
  };

  const select = async (version) => {
    active = version;
    [...list.children].forEach((node) => node.classList.toggle("on", node.dataset.sha === version.sha));
    loaded = await api.get(`/api/notes/pages/${encodeURIComponent(pageId)}/history/${version.sha}`).catch(() => null);
    paintStage();
  };

  if (!versions.length) { list.append(el("div", { class: "vh-empty" }, "No versions yet. They appear when a change from chat is applied.")); paintStage(); return entry; }
  versions.forEach((version) => {
    const kind = version.kind === "before" ? "Before" : version.kind === "restore" ? "Restore" : version.kind === "after" ? "Clyra" : "Saved";
    list.append(el("button", { class: "vh-item", type: "button", role: "option", dataset: { sha: version.sha }, onclick: () => select(version) },
      el("span", { class: `vh-badge ${version.kind || ""}`, text: kind }),
      el("span", { class: "vh-label", text: version.label.replace(/^Clyra: /, "") }),
      el("span", { class: "vh-when", text: relative(version.at) })));
  });
  const initial = (focus && versions.find((version) => version.sha.startsWith(focus))) || versions[0];
  select(initial);
  return entry;
}
