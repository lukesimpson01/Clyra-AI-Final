/* The rest of Notion's "/" menu: embeds from other services, imports, emoji, inline equations, buttons, tabs, AI blocks,
   Mermaid diagrams and the extra database views. Kept apart from slash.js so the catalogue of the basics stays short and
   readable; slash.js asks for these and adds them to the menu. */
import { el, icon, menu, modal, toast } from "./dom.js";
import { api } from "./api.js";
import { state, refreshPages } from "./state.js";
import { buildDatabase } from "./database.js";
import { caretOffset, setCaret, insertSpans, spansText } from "./richtext.js";

/* Embeds: each is the ordinary embed block, asked for its link with the service's name. */
const EMBED_PROVIDERS = ["Google Drive", "Tweet", "GitHub Gist", "Google Maps", "Figma", "Abstract", "Invision", "Mixpanel", "Framer", "Whimsical", "Miro", "Sketch", "Excalidraw", "PDF", "Loom", "Typeform", "CodePen", "Replit", "Hex", "Deepnote", "Trello", "Pitch", "OneDrive", "Dropbox", "Amplitude", "Claap", "Box", "Linear", "Lucidchart", "Lucidspark", "Eraser", "ClickUp", "Plus", "Dovetail", "Streak Share", "Shortcut", "SendOwl", "Zendesk", "Jira", "GitHub", "GitLab", "Asana", "Zoom", "Discord", "PagerDuty", "Adobe XD", "Google Contacts", "Microsoft Contacts"];
const IMPORTS = ["CSV", "Text and Markdown", "Word", "Google Docs", "Confluence", "Dropbox Paper", "Evernote", "Workflowy"];

const EMOJI = "😀 😃 😄 😁 😆 😅 😂 🙂 😉 😊 😍 🥰 😘 😎 🤓 🤔 😴 😮 😢 😭 😡 🥳 🤯 🙌 👍 👎 👏 🙏 💪 👀 🧠 ❤️ 🧡 💛 💚 💙 💜 🔥 ✨ ⭐ 🌟 💡 ✅ ❌ ⚠️ ❓ ❗ 🎯 🚀 🎉 🏆 📌 📍 📎 📝 📚 📖 📅 ⏰ 🔔 🔒 🔑 💻 📱 🖥️ ☕ 🍕 🍎 🌱 🌍 ☀️ 🌙 ⚡ 🌈 🎵 🎨 🏠 🚗 ✈️ 💰 📈 📉 🔍 🛠️ 🧪 🔬 ➕ ➖ ➡️ ⬆️ ⬇️".split(" ");

const lineOf = (editor, block) => editor.nodes.get(block.id)?.querySelector(".text-line");

/* Put some inline spans at the caret (after the "/" has been removed). */
function insertInline(editor, block, spans) {
  const line = lineOf(editor, block);
  if (!line) return;
  line.focus();
  const at = caretOffset(line);
  editor.push();
  block.text = insertSpans(block.text, at, spans);
  editor.paint(line, block);
  const length = spans.reduce((total, span) => total + (span.t || "").length, 0);
  editor.focus(block.id, at + length);
  editor.commit("inline", true);
}

function promptDialog({ title, fields, confirm = "Insert", onSubmit }) {
  const inputs = fields.map((field) => {
    const input = field.multiline
      ? el("textarea", { class: "extras-field", rows: "4", placeholder: field.placeholder || "", "aria-label": field.label })
      : el("input", { class: "extras-input", placeholder: field.placeholder || "", "aria-label": field.label, type: field.type || "text" });
    input.value = field.value || "";
    return input;
  });
  const save = el("button", { class: "button primary", type: "button" }, confirm);
  const cancel = el("button", { class: "button", type: "button" }, "Cancel");
  const body = el("div", { class: "extras-body" }, ...fields.flatMap((field, index) => [el("label", { class: "field-label", text: field.label }), inputs[index]]));
  const entry = modal({ title, width: 440, body, footer: [cancel, save] });
  cancel.addEventListener("click", () => entry.close("cancel"));
  const submit = () => { const values = inputs.map((input) => input.value.trim()); if (!values[0]) { inputs[0].focus(); return; } entry.close("save"); onSubmit(values); };
  save.addEventListener("click", submit);
  inputs[0].addEventListener("keydown", (event) => { if (event.key === "Enter" && !event.shiftKey && !fields[0].multiline) { event.preventDefault(); submit(); } });
}

const VIEW_SPECS = {
  feed: { name: "Feed", label: "Feed view", glyph: "list" },
  timeline: { name: "Timeline", label: "Timeline view", glyph: "calendar" },
  form: { name: "Form", label: "Form", glyph: "page" },
  dashboard: { name: "Dashboard", label: "Dashboard view", glyph: "panel", badge: "New" },
  vbar: { name: "Vertical bar chart", label: "Vertical bar chart", glyph: "chart", chart: "vbar" },
  hbar: { name: "Horizontal bar chart", label: "Horizontal bar chart", glyph: "chart", chart: "hbar" },
  line: { name: "Line chart", label: "Line chart", glyph: "chart", chart: "line" },
  donut: { name: "Donut chart", label: "Donut chart", glyph: "target", chart: "donut" },
  number: { name: "Number chart", label: "Number chart", glyph: "numbers", chart: "number" },
};

async function insertDatabaseView(editor, block, key) {
  const view = VIEW_SPECS[key];
  const spec = {
    name: "Untitled database",
    properties: [{ name: "Name", type: "title" }, { name: "Status", type: "status" }, { name: "Date", type: "date" }, { name: "Type", type: "select", options: ["Design", "Build", "Review"] }, { name: "Estimate", type: "number" }],
    records: [
      { Name: "Plan the work", Status: "Done", Date: { offsetDays: -3 }, Type: "Design", Estimate: 3 },
      { Name: "Build the first version", Status: "In progress", Date: { offsetDays: 1 }, Type: "Build", Estimate: 8 },
      { Name: "Get feedback", Status: "Not started", Date: { offsetDays: 4 }, Type: "Review", Estimate: 2 },
      { Name: "Polish and ship", Status: "Not started", Date: { offsetDays: 8 }, Type: "Build", Estimate: 5 },
    ],
    views: [{ name: view.name, type: view.chart || key === "dashboard" ? (key === "dashboard" ? "dashboard" : "chart") : key, date: "Date", chart: view.chart, group: view.chart ? "Status" : undefined }],
  };
  const made = await buildDatabase(spec, { parentId: String(editor.page.id), inline: true });
  if (!made) return;
  editor.turnInto(block, "database");
  block.props = { pageId: made.page_id };
  block.__dirty = true;
  editor.insertAfter(block, editor.blank());
  editor.render();
  editor.commit("database", true);
  await refreshPages();
}

/* Mermaid diagrams are drawn from a text description, in a preview window, so a code block of diagram text stays text. */
export const MERMAID_SAMPLE = "graph TD\n  A[Idea] --> B{Worth doing?}\n  B -- Yes --> C[Plan it]\n  B -- No --> D[Park it]\n  C --> E[Ship it]";

export function extraCommands(editor) {
  const commands = [];
  const add = (command) => commands.push(command);

  for (const key of ["feed", "dashboard", "timeline", "form", "vbar", "hbar", "line", "donut", "number"]) {
    const view = VIEW_SPECS[key];
    add({ key: `db-${key}`, label: view.label, group: "Database", icon: view.glyph, badge: view.badge, desc: `A new database shown as a ${view.label.toLowerCase()}.`, keywords: `database ${key} view chart`, run: (block) => insertDatabaseView(editor, block, key) });
  }

  add({ key: "brainstorm", label: "Brainstorm", group: "Suggested", icon: "target", badge: "New", desc: "A whiteboard for ideas: stickies, shapes, notes and connectors.", keywords: "brainstorm whiteboard board canvas figjam miro sticky mind map diagram flow ideas",
    run: (block) => editor.insertBrainstorm(block) });

  add({ key: "synced", label: "Synced block", group: "Advanced blocks", icon: "refresh", desc: "The same text in many pages, edited in one place.", keywords: "synced sync mirror shared copy reuse",
    run: async (block) => {
      const existing = await api.get("/api/notes/synced").catch(() => []);
      const anchor = lineOf(editor, block) || document.body;
      menu(anchor, [
        { label: "New synced block", icon: "plus", onSelect: () => editor.insertSynced(block) },
        ...(existing.length ? [{ type: "label", label: "Use an existing one" }] : []),
        ...existing.slice(0, 12).map((entry) => ({ label: (entry.text || "").split("\n")[0].slice(0, 48) || "Empty synced block", icon: "refresh", onSelect: () => editor.insertSynced(block, entry.id) })),
      ], { align: "start" });
    } });

  add({ key: "button", label: "Button", group: "Advanced blocks", icon: "plus", desc: "A button that adds content to the page when pressed.", keywords: "button action add template",
    run: (block) => promptDialog({ title: "New button", confirm: "Create button", fields: [{ label: "Label", placeholder: "Add a meeting note", value: "Add a note" }, { label: "What it adds (markdown)", placeholder: "## Notes\n- ", multiline: true, value: "## Notes\n- " }],
      onSubmit: ([label, content]) => { editor.turnInto(block, "button"); block.props = { label, content }; block.__dirty = true; editor.insertAfter(block, editor.blank()); editor.render(); editor.commit("button", true); } }) });

  add({ key: "tabs", label: "Tabs", group: "Advanced blocks", icon: "panel", badge: "New", desc: "Show one pane at a time under tabs.", keywords: "tabs panes sections",
    run: (block) => editor.insertTabs(block) });

  add({ key: "aiblock", label: "AI Block", group: "Advanced blocks", icon: "sparkle", desc: "A summary, action items or custom answer that updates on demand.", keywords: "ai block summary key info translation custom",
    run: (block) => {
      if (!state.aiConfigured) { toast("AI is not set up"); return; }
      const anchor = lineOf(editor, block) || document.body;
      menu(anchor, [
        { label: "Summary", icon: "list", onSelect: () => editor.insertAiBlock(block, "summarize", "Summary") },
        { label: "Key info", icon: "check_square", onSelect: () => editor.insertAiBlock(block, "action_items", "Action items") },
        { label: "Translation", icon: "translate", onSelect: () => promptDialog({ title: "Translate this page", confirm: "Translate", fields: [{ label: "Into which language?", placeholder: "Spanish" }], onSubmit: ([language]) => editor.insertAiBlock(block, "translate", `Translation (${language})`, language) }) },
        { label: "Custom AI block", icon: "sparkle", onSelect: () => promptDialog({ title: "Custom AI block", confirm: "Generate", fields: [{ label: "What should it write?", placeholder: "List the risks mentioned on this page", multiline: true }], onSubmit: ([prompt]) => editor.insertAiBlock(block, "custom", "AI block", prompt) }) },
      ], { align: "start" });
    } });

  add({ key: "mermaid", label: "Code - Mermaid", group: "Advanced blocks", icon: "code", desc: "A diagram written as text.", keywords: "mermaid diagram flowchart graph code",
    run: (block) => { editor.turnInto(block, "code"); block.props = { ...block.props, language: "mermaid" }; block.text = [{ t: MERMAID_SAMPLE }]; block.__dirty = true; editor.render({ id: block.id, offset: "end" }); editor.commit("mermaid", true); } });

  add({ key: "emoji", label: "Emoji", group: "Inline", icon: "star", desc: "Pick an emoji to put in the text.", keywords: "emoji smiley icon",
    run: (block) => {
      let entry;
      const grid = () => el("div", { class: "emoji-grid" }, EMOJI.map((glyph) => el("button", { class: "emoji-cell", type: "button", "aria-label": glyph, onclick: () => { entry.close("select"); insertInline(editor, block, [{ t: glyph }]); } }, glyph)));
      entry = menu(lineOf(editor, block) || document.body, [{ type: "custom", render: grid }], { class: "emoji-menu" });
    } });

  add({ key: "inlineequation", label: "Inline equation", group: "Inline", icon: "equation", desc: "A formula inside a line of text.", keywords: "equation math latex inline formula",
    run: (block) => promptDialog({ title: "Inline equation", fields: [{ label: "Formula", placeholder: "E = mc^2" }], onSubmit: ([tex]) => insertInline(editor, block, [{ t: tex, eq: tex }, { t: " " }]) }) });

  for (const provider of EMBED_PROVIDERS) {
    add({ key: `embed-${provider}`, label: provider, group: "Embeds", icon: "embed", desc: `Embed ${provider} content.`, keywords: `embed ${provider}`,
      run: (block) => editor.insertEmbed(block, provider) });
  }
  for (const source of IMPORTS) {
    add({ key: `import-${source}`, label: source, group: "Import", icon: "import", desc: `Import from ${source}.`, keywords: `import ${source}`,
      run: () => window.dispatchEvent(new CustomEvent("clyra:open-import", { detail: { source } })) });
  }
  return commands;
}

export { promptDialog };
