/* The floating toolbar shown over a text selection.

   It exists only while a selection does, which is what keeps AI actions out
   of the page until the student actually asks for them. */
import { el, icon, iconButton, menu, modal, position, pushLayer, toast, mod, append } from "./dom.js";
import { markState, spansText, sliceSpans, selectionRectIn } from "./richtext.js";
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

  const dropdown = (label, title, onOpen, className = "") => el("button", {
    class: `text-button ${className}`.trim(), type: "button", "aria-label": title, title,
    onclick: (event) => onOpen(event.currentTarget),
  }, label, icon("chevron_down", 11));

  const alignButton = el("button", {
    class: "icon-button", type: "button", title: "Text alignment", "aria-label": "Text alignment",
    onclick: (event) => alignmentMenu(editor, block, line, event.currentTarget),
  }, icon(block.props?.textAlign === "center" ? "align_center" : block.props?.textAlign === "right" ? "align_right" : "align_left", 15));

  append(node,
    /* One intentional AI entry point keeps the selection toolbar short.
       It opens the real Clyra sidebar with the selection attached, rather
       than offering three competing ways to do the same thing. */
    state.aiConfigured ? el("button", {
      class: "text-button ask-clyra", type: "button", title: "Ask Clyra about the selection",
      onclick: () => { const text = spansText(sliceSpans(block.text, range.start, range.end)); closeInlineToolbar(); editor.onAskClyra?.(text, "ask"); },
    }, icon("sparkle", 15), "Ask Clyra") : null,
    el("div", { class: "sep" }),
    dropdown("Format", "Text format", (anchor) =>
      menu(anchor, TURN_INTO.map((type) => ({
        label: BLOCK_TYPES[type].label, icon: BLOCK_TYPES[type].icon,
        checked: block.type === type, keywords: BLOCK_TYPES[type].keywords,
        onSelect: () => editor.turnInto(block, type),
      })), { side: "bottom", align: "start", class: "toolbar-menu", search: true, searchPlaceholder: "Search formats…" }), "toolbar-format"),
    dropdown("Font", "Font", (anchor) => fontMenu(editor, block, line, anchor), "toolbar-font"),
    alignButton,
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
    iconButton("comment", "Comment on selection", () => {
      const text = spansText(sliceSpans(block.text, range.start, range.end));
      closeInlineToolbar();
      editor.onComment?.(block, text);
    }, { size: 15 }),
    colourButton("text", "Text colour", (event) => colorMenu(editor, block, line, event.currentTarget, "text")),
    colourButton("highlight", "Highlight colour", (event) => colorMenu(editor, block, line, event.currentTarget, "bg")),
    iconButton("dots", "More text options", (event) => openColourPalette(editor, block, line, event.currentTarget, range), { size: 15 }),
  );

  const entry = pushLayer(node, { closeOnOutside: false, onClose: () => { current = null; } });
  current = entry;

  const rect = selectionRectIn(line) || line.getBoundingClientRect();
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

function alignmentMenu(editor, block, line, anchor) {
  const current = block.props?.textAlign || "left";
  menu(anchor, [
    { type: "label", label: "Text alignment" },
    { label: "Align left", icon: "align_left", checked: current === "left", onSelect: () => editor.setTextAlign(block, line, "left") },
    { label: "Align centre", icon: "align_center", checked: current === "center", onSelect: () => editor.setTextAlign(block, line, "center") },
    { label: "Align right", icon: "align_right", checked: current === "right", onSelect: () => editor.setTextAlign(block, line, "right") },
  ], { side: "bottom", align: "start", class: "toolbar-menu", search: true, searchPlaceholder: "Search fonts and formatting…" });
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
function colourButton(kind, label, onClick) {
  const glyph = kind === "text" ? el("span", { class: "toolbar-colour-letter", text: "A" }) : icon("highlight", 16);
  return el("button", { class: `icon-button toolbar-colour toolbar-colour-${kind}`, type: "button", title: label, "aria-label": label, onclick: onClick }, glyph);
}

function colorMenu(editor, block, line, anchor, kind) {
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
  const isText = kind === "text";
  entry = menu(anchor, [
    { type: "label", label: isText ? "Text colour" : "Highlight colour" },
    { type: "custom", render: () => swatchGrid(kind) },
    { type: "custom", render: () => customColourField(isText ? "Text" : "Highlight", isText ? "#37352f" : "#fff0a8", (hex) => applyCustom(isText ? { colorHex: hex } : { backgroundHex: hex })) },
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
function fontMenu(editor, block, line, anchor) {
  menu(anchor, [
    { type: "label", label: "Selection font" },
    ...[["inherit", "Default"], ["Georgia, serif", "Serif"], ["ui-monospace, monospace", "Mono"]].map(([value, label]) => ({ label, onSelect: () => editor.applyTextStyle(block, line, { font: value === "inherit" ? null : value }) })),
    { type: "separator" },
    { type: "label", label: "Selection size" },
    ...[["0.875em", "Small"], ["1em", "Medium"], ["1.18em", "Large"]].map(([size, label]) => ({ label, onSelect: () => editor.applyTextStyle(block, line, { size }) })),
  ], { side: "bottom", align: "start", class: "toolbar-menu", search: true, searchPlaceholder: "Search font or size…" });
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
