/* Import: files, pasted text and URLs become ordinary pages. AI-structured
   notes are offered separately so an import never silently rewrites a file. */
import { el, clear, icon, modal, toast } from "../dom.js";
import { api } from "../api.js";
import { state, refreshPages, withError } from "../state.js";

const TEXT_TYPES = /\.(md|markdown|txt|csv|html?|json)$/i;

export function openImport(app, parentId) {
  const drop = el("div", { class: "import-drop" },
    icon("import", 22),
    el("div", { class: "import-drop-label", text: "Drop files here, or choose files" }),
    el("div", { class: "import-drop-hint", text: "Markdown, text, CSV and HTML import as pages. Other files attach to a new page." }));
  const fileField = el("input", { type: "file", multiple: true, style: { display: "none" } });
  const pasteField = el("textarea", { class: "textarea", placeholder: "Or paste text or a URL…", style: { minHeight: "120px" } });
  const status = el("div", { class: "import-status" });
  let entry;

  drop.addEventListener("click", () => fileField.click());
  drop.addEventListener("dragover", (event) => { event.preventDefault(); drop.classList.add("over"); });
  drop.addEventListener("dragleave", () => drop.classList.remove("over"));
  drop.addEventListener("drop", (event) => {
    event.preventDefault();
    drop.classList.remove("over");
    handleFiles([...event.dataTransfer.files]);
  });
  fileField.addEventListener("change", () => handleFiles([...fileField.files]));

  async function handleFiles(files) {
    if (!files.length) return;
    let created = 0;
    let last = null;
    for (const file of files) {
      status.textContent = `Importing ${file.name}…`;
      if (TEXT_TYPES.test(file.name)) {
        const text = await file.text();
        const page = await withError(
          () => api.post("/api/notes/import/markdown", { markdown: htmlToMarkdown(file.name, text), title: file.name.replace(/\.[^.]+$/, ""), parentId: parentId || null }),
          `Could not import ${file.name}`,
        );
        if (page) { created += 1; last = page; }
        continue;
      }
      /* Binary files keep their bytes and get a page that embeds them, so a
         PDF of slides is readable in the workspace rather than just listed. */
      const { uploadFile } = await import("../editor.js");
      const uploaded = await withError(() => uploadFile(file), `Could not upload ${file.name}`);
      if (!uploaded) continue;
      const type = file.type.startsWith("image/") ? "image"
        : file.type.startsWith("video/") ? "video"
        : file.type.startsWith("audio/") ? "audio"
        : file.type === "application/pdf" ? "pdf" : "file";
      const page = await withError(() => api.post("/api/notes/pages", {
        parentId: parentId || null,
        title: file.name.replace(/\.[^.]+$/, ""),
        blocks: [{ id: `b${Date.now().toString(36)}`, type, text: [], props: { url: uploaded.url, name: uploaded.name, size: uploaded.size }, children: [] }],
      }), `Could not create a page for ${file.name}`);
      if (page) { created += 1; last = page; }
    }
    status.textContent = "";
    if (!created) return;
    entry.close("imported");
    await refreshPages();
    toast(`Imported ${created} file${created === 1 ? "" : "s"}`);
    if (last) app.openPage(last.id);
  }

  async function importPasted(structure) {
    const text = pasteField.value.trim();
    if (!text) { toast("Paste some text or a URL first", "error"); return; }
    const isUrl = /^https?:\/\/\S+$/i.test(text);
    status.textContent = structure ? "Asking AI to structure these notes…" : "Importing…";
    let page;
    if (structure) {
      const result = await withError(
        () => api.post("/api/notes/ai/source-notes", {
          parentId: parentId || null,
          title: isUrl ? text : undefined,
          sources: [{ pageId: "", title: isUrl ? text : "Pasted text", text: isUrl ? `Source URL: ${text}` : text }],
        }),
        "Could not generate notes",
      );
      page = result?.page;
      if (page && isUrl) await api.post("/api/notes/sources", { pageId: page.id, url: text, title: text, type: "web" }).catch(() => {});
    } else {
      page = await withError(
        () => api.post("/api/notes/import/markdown", { markdown: isUrl ? `[${text}](${text})` : text, parentId: parentId || null }),
        "Could not import",
      );
    }
    status.textContent = "";
    if (!page) return;
    entry.close("imported");
    await refreshPages();
    app.openPage(page.id);
  }

  entry = modal({
    title: "Import",
    width: 560,
    body: el("div", {}, drop, fileField, el("label", { class: "field" }, pasteField), status),
    footer: [
      el("button", { class: "button", type: "button", onclick: () => entry.close("cancel") }, "Cancel"),
      el("button", { class: "button", type: "button", onclick: () => importPasted(false) }, "Import as-is"),
      state.aiConfigured
        ? el("button", { class: "button primary", type: "button", onclick: () => importPasted(true) }, "Create structured notes")
        : null,
    ].filter(Boolean),
  });
  return entry;
}

/* HTML is reduced to text rather than rendered, so an imported web page
   cannot bring markup or scripts into a note. */
function htmlToMarkdown(name, text) {
  if (!/\.html?$/i.test(name)) return text;
  const doc = new DOMParser().parseFromString(text, "text/html");
  doc.querySelectorAll("script, style, nav, footer").forEach((node) => node.remove());
  const lines = [];
  for (const node of doc.body?.querySelectorAll("h1, h2, h3, p, li, blockquote, pre") || []) {
    const content = node.textContent.trim();
    if (!content) continue;
    const tag = node.tagName.toLowerCase();
    if (tag === "h1") lines.push(`# ${content}`);
    else if (tag === "h2") lines.push(`## ${content}`);
    else if (tag === "h3") lines.push(`### ${content}`);
    else if (tag === "li") lines.push(`- ${content}`);
    else if (tag === "blockquote") lines.push(`> ${content}`);
    else if (tag === "pre") lines.push("```\n" + content + "\n```");
    else lines.push(content);
  }
  return lines.join("\n\n");
}
