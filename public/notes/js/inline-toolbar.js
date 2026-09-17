/* The floating toolbar shown over a text selection.

   It exists only while a selection does, which is what keeps AI actions out
   of the page until the student actually asks for them. */
import { el, icon, iconButton, menu, modal, position, pushLayer, toast, mod, append } from "./dom.js";
import { markState, spansText, sliceSpans } from "./richtext.js";
import { BLOCK_TYPES, TURN_INTO, COLORS } from "./block-types.js";
import { state } from "./state.js";
import { openColourPalette } from "./colour-coding.js";

let current = null;

export function closeInlineToolbar() {
  current?.close("replaced");
  current = null;
}

export function openInlineToolbar({ editor, block, line, range }) {
  closeInlineToolbar();
  const marks = markState(block.text, range.start, range.end);
  const node = el("div", { class: "inline-toolbar", role: "toolbar", "aria-label": "Text formatting" });

  const markButton = (name, label, mark, shortcut) => {
    const button = iconButton(name, label, () => {
      editor.toggleMark(block, line, mark);
      button.classList.toggle("active");
    }, { shortcut, size: 15 });
    if (marks[mark]) button.classList.add("active");
    return button;
  };

  const dropdown = (label, title, onOpen) => el("button", {
    class: "text-button", type: "button", "aria-label": title, title,
    onclick: (event) => onOpen(event.currentTarget),
  }, label, icon("chevron_down", 11));

  append(node,
    state.aiConfigured ? el("button", {
      class: "text-button ai", type: "button",
      /* Opens the composer with the selection attached, so a typed
         instruction rewrites the highlighted text. The presets sit under the
         input rather than replacing it. */
      onclick: () => {
        closeInlineToolbar();
        editor.openAiComposer(block, {
          selection: { line, range },
          seedText: spansText(sliceSpans(block.text, range.start, range.end)),
          suggestions: AI_ACTIONS,
        });
      },
    }, icon("sparkle", 15), "Ask AI") : null,
    state.aiConfigured ? el("div", { class: "sep" }) : null,
    dropdown(BLOCK_TYPES[block.type]?.label || "Text", "Turn into", (anchor) =>
      menu(anchor, TURN_INTO.map((type) => ({
        label: BLOCK_TYPES[type].label, icon: BLOCK_TYPES[type].icon,
        checked: block.type === type, keywords: BLOCK_TYPES[type].keywords,
        onSelect: () => editor.turnInto(block, type),
      })), { search: true, searchPlaceholder: "Turn into…" })),
    dropdown("Aa", "Font and size", (anchor) => styleMenu(editor, block, line, anchor)),
    el("div", { class: "sep" }),
    markButton("bold", "Bold", "b", `${mod}+B`),
    markButton("italic", "Italic", "i", `${mod}+I`),
    markButton("underline", "Underline", "u", `${mod}+U`),
    markButton("strike", "Strikethrough", "s", `${mod}+Shift+S`),
    markButton("code", "Inline code", "c", `${mod}+E`),
    iconButton("equation", "Equation", () => {
      const text = spansText(sliceSpans(block.text, range.start, range.end));
      editor.replaceSelection(block, line, [{ t: text, eq: text }], range);
    }, { size: 15 }),
    el("div", { class: "sep" }),
    iconButton("link", "Link", (event) => promptLink(editor, block, line, range, event.currentTarget), { shortcut: `${mod}+K`, size: 15 }),
    iconButton("palette", "Colour and highlight", (event) => colorMenu(editor, block, line, event.currentTarget), { size: 15 }),
    el("button", { class: "text-button smart-highlight-button", type: "button", "aria-label": "Highlight / Colour Code", onclick: (event) => openColourPalette(editor, block, line, event.currentTarget, range) }, icon("highlight", 14), "Highlight", icon("chevron_down", 11)),
  );

  const entry = pushLayer(node, { closeOnOutside: false, onClose: () => { current = null; } });
  current = entry;

  const selection = window.getSelection();
  const rect = selection?.rangeCount ? selection.getRangeAt(0).getBoundingClientRect() : line.getBoundingClientRect();
  position(node, rect, { side: "top", align: "center", gap: 8 });

  const dismiss = (event) => {
    if (node.contains(event.target)) return;
    const active = window.getSelection();
    if (active && !active.isCollapsed && line.contains(active.anchorNode)) return;
    entry.close("blur");
    document.removeEventListener("mousedown", dismiss, true);
    document.removeEventListener("keydown", onKey, true);
  };
  const onKey = (event) => {
    if (event.key === "Escape") { entry.close("escape"); document.removeEventListener("keydown", onKey, true); return; }
    if (event.key.length === 1 || event.key === "Backspace" || event.key === "Enter") {
      entry.close("typing");
      document.removeEventListener("mousedown", dismiss, true);
      document.removeEventListener("keydown", onKey, true);
    }
  };
  document.addEventListener("mousedown", dismiss, true);
  document.addEventListener("keydown", onKey, true);
  return entry;
}

function promptLink(editor, block, line, range, anchor) {
  const field = el("input", { class: "input", placeholder: "Paste a link or search pages…", type: "text" });
  let entry;
  entry = modal({
    title: "Link",
    width: 440,
    body: el("div", {}, el("label", { class: "field" }, field)),
    footer: [
      el("button", { class: "button", type: "button", onclick: () => { editor.applyLink(block, line, null); entry.close("remove"); } }, "Remove link"),
      el("button", {
        class: "button primary", type: "button",
        onclick: () => {
          const value = field.value.trim();
          if (!value) { toast("Enter a link", "error"); return; }
          editor.applyLink(block, line, /^https?:\/\//i.test(value) ? value : `https://${value}`);
          entry.close("apply");
        },
      }, "Link"),
    ],
  });
  field.addEventListener("keydown", (event) => {
    if (event.key === "Enter") { event.preventDefault(); entry.node.querySelector(".button.primary").click(); }
  });
}

/* A swatch grid rather than two lists of twenty rows: colour is chosen by
   eye, so the menu should be scannable at a glance. */
function colorMenu(editor, block, line, anchor) {
  const swatchGrid = (kind) => {
    const grid = el("div", { class: "swatch-grid" });
    for (const color of COLORS) {
      const label = color === "default" ? "Default" : color[0].toUpperCase() + color.slice(1);
      grid.append(el("button", {
        class: `swatch-cell ${kind}`, type: "button", title: label,
        "aria-label": `${label} ${kind === "text" ? "text colour" : "highlight"}`,
        style: kind === "text"
          ? { color: color === "default" ? "var(--text-primary)" : `var(--c-${color})` }
          : { background: color === "default" ? "transparent" : `var(--c-${color}-bg)` },
        onclick: () => editor.applyColor(block, line, kind === "text" ? { color } : { background: color }),
      }, kind === "text" ? "A" : ""));
    }
    return grid;
  };
  let entry;
  const applyCustom = (patch) => {
    editor.applyColor(block, line, patch);
    entry?.close("custom-colour");
  };
  entry = menu(anchor, [
    { type: "label", label: "Text" },
    { type: "custom", render: () => swatchGrid("text") },
    { type: "custom", render: () => customColourField("Text", "#337ea9", (hex) => applyCustom({ colorHex: hex })) },
    { type: "separator" },
    { type: "label", label: "Highlight" },
    { type: "custom", render: () => swatchGrid("bg") },
    { type: "custom", render: () => customColourField("Highlight", "#fff0a8", (hex) => applyCustom({ backgroundHex: hex })) },
  ], { align: "center", class: "color-menu" });
}

/* The named palette keeps notes coherent, while a native picker gives students
   the one-off highlighter shade they actually use in class. */
function customColourField(label, value, onPick) {
  const input = el("input", {
    class: "custom-colour-input", type: "color", value,
    "aria-label": `Custom ${label.toLowerCase()} colour`,
  });
  input.addEventListener("change", () => onPick(input.value));
  return el("label", { class: "custom-colour-row" },
    el("span", { text: `Custom ${label.toLowerCase()}` }), input);
}

/* Font and text size belong to the page, so the menu labels them that way
   rather than implying they apply only to the selection. */
function styleMenu(editor, block, line, anchor) {
  const page = editor.page;
  const apply = (patch) => editor.onPageStyle?.(patch);
  menu(anchor, [
    { type: "label", label: "Selection font" },
    ...[["inherit", "Default"], ["Georgia, serif", "Serif"], ["ui-monospace, monospace", "Mono"]].map(([value, label]) => ({ label, onSelect: () => editor.applyTextStyle(block, line, { font: value === "inherit" ? null : value }) })),
    { type: "separator" },
    { type: "label", label: "Selection size" },
    ...[["0.875em", "Small"], ["1em", "Medium"], ["1.18em", "Large"]].map(([size, label]) => ({ label, onSelect: () => editor.applyTextStyle(block, line, { size }) })),
    { type: "separator" },
    { type: "label", label: "Page font" },
    ...[["default", "Default"], ["serif", "Serif"], ["mono", "Mono"], ["rounded", "Rounded"]].map(([value, label]) => ({
      label, checked: (page.font_style || "default") === value,
      icon: el("span", { class: `font-preview ${value}`, text: "Ag" }),
      onSelect: () => apply({ fontStyle: value }),
    })),
    { type: "separator" },
    { type: "label", label: "Page text size" },
    ...[["small", "Small"], ["medium", "Medium"], ["large", "Large"], ["xl", "Extra large"]].map(([value, label]) => ({
      label, checked: (page.text_size || "medium") === value,
      icon: "type_size",
      onSelect: () => apply({ textSize: value }),
    })),
    { type: "separator" },
    { label: "Full width", icon: "panel", checked: Boolean(page.full_width),
      onSelect: () => apply({ fullWidth: !page.full_width }) },
  ], { align: "center" });
}

const AI_ACTIONS = [
  { group: "Edit", items: [
    ["improve", "Improve writing"], ["fix", "Fix spelling & grammar"], ["shorter", "Make shorter"],
    ["longer", "Make longer"], ["simplify", "Simplify language"], ["tone", "Change tone"], ["translate", "Translate"],
  ] },
  { group: "Understand", items: [
    ["explain", "Explain this"], ["eli5", "Explain like I'm new to this"], ["example", "Give an example"],
    ["define", "Define terminology"], ["compare", "Compare concepts"],
  ] },
  { group: "Extract", items: [
    ["summarize", "Summarise"], ["key_points", "Extract key points"], ["action_items", "Extract action items"],
    ["table", "Create table"], ["outline", "Create outline"], ["continue", "Continue writing"],
  ] },
  { group: "Study", items: [
    ["memorize", "What should I memorise?"], ["weak_concepts", "Identify weak concepts"],
    ["mnemonic", "Create a mnemonic"], ["exam_answer", "Write an exam answer"],
  ] },
];

export { AI_ACTIONS };
