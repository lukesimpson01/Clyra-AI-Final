/* "/file": the same dropdown as the slash menu, listing every note (type to search), with "Add your own file" first.
   Choosing a note drops a link to it; choosing "Add your own file" opens a drop-zone to upload by button or drag. */
import { el, icon, menu, modal, toast, append, clear } from "./dom.js";
import { state } from "./state.js";
import { uploadFile, makeBlock } from "./editor.js";

const formatBytes = (n) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1048576).toFixed(1)} MB`);

function caretRect(editor, block) {
  const selection = window.getSelection();
  if (selection?.rangeCount) {
    const rect = selection.getRangeAt(0).getBoundingClientRect();
    if (rect.width || rect.height || rect.top) return rect;
  }
  const node = editor.nodes?.get(block.id);
  return (node || editor.container).getBoundingClientRect();
}

export function setBlockMedia(editor, block, props) {
  block.props = { ...block.props, ...props };
  block.__dirty = true;
  editor.render();
  editor.commit("media", true);
}

function linkToNote(editor, block, page) {
  editor.push?.();
  block.type = "link_to_page";
  block.props = { pageId: page.id, title: page.title };
  block.text = [];
  block.__dirty = true;
  editor.insertAfter(block, makeBlock());
  editor.render();
  editor.commit("link-note", true);
}

export function openFileMenu(editor, block) {
  const pages = (state.pages || []).filter((page) => !page.trashed_at && page.kind !== "record" && page.id !== editor.page?.id);
  const items = [
    { label: "Add your own file", icon: "plus", keywords: "upload attach drop computer", onSelect: () => setTimeout(() => openFileModal(editor, block), 80) /* after the menu has finished closing, or it would close the sheet too */ },
    pages.length ? { type: "separator" } : null,
    pages.length ? { type: "label", label: "Link to a note" } : null,
    ...pages.map((page) => ({
      label: page.title || "Untitled", icon: "page", keywords: "note page link",
      onSelect: () => linkToNote(editor, block, page),
    })),
  ].filter(Boolean);
  return menu(caretRect(editor, block), items, { class: "slash-menu file-menu", search: true, searchPlaceholder: "Search notes, or add a file…", align: "start" });
}

/* The upload sheet: one large drop-zone (click or drag), the files already in the workspace beneath it, and a link field. */
export function openFileModal(editor, block) {
  let entry;
  const finish = (props) => { setBlockMedia(editor, block, props); entry.close("done"); };
  const input = el("input", { type: "file", hidden: true });
  const zone = el("div", { class: "file-drop", role: "button", tabindex: "0", "aria-label": "Choose a file or drop one here" });
  const idle = () => {
    clear(zone);
    zone.classList.remove("is-busy", "is-over");
    append(zone,
      el("div", { class: "file-drop-badge" }, icon("file", 26)),
      el("div", { class: "file-drop-title", text: "Drag a file here" }),
      el("div", { class: "file-drop-sub" }, "or ", el("span", { class: "file-drop-link", text: "browse your computer" })),
      el("div", { class: "file-drop-note", text: "Any file up to 25 MB" }));
  };
  const busy = (name) => {
    clear(zone);
    zone.classList.add("is-busy");
    append(zone,
      el("div", { class: "file-drop-badge" }, el("span", { class: "ag-spinner" })),
      el("div", { class: "file-drop-title", text: "Uploading" }),
      el("div", { class: "file-drop-sub", text: name }),
      el("div", { class: "file-drop-bar" }, el("span")));
  };
  const upload = async (file) => {
    if (!file) return;
    busy(file.name);
    try {
      const uploaded = await uploadFile(file);
      finish({ url: uploaded.url, name: uploaded.name, size: uploaded.size });
    } catch (error) {
      toast(error.message || "Upload failed", "error");
      idle();
    }
  };
  idle();
  zone.addEventListener("click", () => input.click());
  zone.addEventListener("keydown", (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); input.click(); } });
  input.addEventListener("change", () => upload(input.files?.[0]));
  for (const type of ["dragenter", "dragover"]) zone.addEventListener(type, (event) => { event.preventDefault(); zone.classList.add("is-over"); });
  for (const type of ["dragleave", "drop"]) zone.addEventListener(type, (event) => { event.preventDefault(); zone.classList.remove("is-over"); });
  zone.addEventListener("drop", (event) => upload(event.dataTransfer?.files?.[0]));

  const recent = el("div", { class: "file-recent", hidden: true }, el("div", { class: "file-recent-title", text: "Already in your workspace" }));
  fetch("/api/notes/files").then((r) => r.json()).then(({ files }) => {
    if (!files?.length) return;
    const list = el("div", { class: "file-recent-list scroll" }, files.slice(0, 20).map((file) =>
      el("button", { class: "existing-file", type: "button", onclick: () => finish({ url: file.url, name: file.name, size: file.size }) },
        icon("file", 16), el("span", { class: "existing-file-name", text: file.name }), el("span", { class: "meta", text: formatBytes(file.size) }))));
    recent.append(list);
    recent.hidden = false;
  }).catch(() => undefined);

  const link = el("input", { class: "input", type: "url", placeholder: "Or paste a link to a file…", "aria-label": "Link to a file" });
  link.addEventListener("keydown", (event) => { if (event.key === "Enter" && link.value.trim()) { event.preventDefault(); finish({ url: link.value.trim(), name: link.value.trim().split("/").pop() || link.value.trim() }); } });
  entry = modal({
    title: "Add a file", width: 520,
    body: el("div", { class: "file-sheet" }, zone, input, recent, link),
    footer: [el("button", { class: "button", type: "button", onclick: () => entry.close("cancel") }, "Cancel")],
  });
}
