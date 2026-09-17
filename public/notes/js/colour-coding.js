/* Smart Colour Coding keeps the meaning on the page, while spans only carry
   a category id. That makes a renamed or recoloured category update every
   passage without touching the document text. */
import { el, icon, menu, modal, toast } from "./dom.js";
import { queueMetaSave } from "./state.js";

export const STUDY_COLOURS = ["#F5E6A8", "#CFE2F5", "#D3E9D7", "#F3D6E2", "#E2D8F1", "#F5DFC5"];
const DEFAULTS = ["Key information", "Definitions", "Examples", "Important dates", "Evidence / quotes", "Needs revision"];
const uid = () => `cc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

export function categories(page) {
  const value = page.colour_categories;
  if (Array.isArray(value)) return value;
  try { return JSON.parse(value || "[]"); } catch { return []; }
}

export function saveCategories(page, next) {
  page.colour_categories = next;
  queueMetaSave(page.id, { colourCategories: JSON.stringify(next) });
}

export function openColourPalette(editor, block, line, anchor, savedRange) {
  const list = categories(editor.page);
  const choose = (category) => { editor.lastColourCategory = category; editor.applySmartHighlight(block, line, category, savedRange); toast(`${category.name} applied`); };
  menu(anchor, [
    { type: "label", label: "Colour code" },
    { type: "custom", render: () => {
      const grid = el("div", { class: "colour-code-grid" });
      list.forEach((category) => grid.append(el("button", { class: "colour-code-choice", type: "button", onclick: () => choose(category) }, el("span", { class: "colour-code-dot", style: { background: category.colour } }), el("span", {}, category.name))));
      return grid;
    } },
    { type: "separator" },
    { label: "New colour meaning…", icon: "plus", onSelect: () => createCategory(editor.page, (category) => { saveCategories(editor.page, [...categories(editor.page), category]); choose(category); }) },
  ], { class: "colour-code-menu" });
}

function createCategory(page, done) {
  const name = el("input", { class: "input", placeholder: "e.g. Definitions" });
  const description = el("input", { class: "input", placeholder: "What should this colour mean? (optional)" });
  const colour = el("input", { class: "colour-picker", type: "color", value: STUDY_COLOURS[categories(page).length % STUDY_COLOURS.length] });
  let entry;
  entry = modal({ title: "Name this colour", width: 400, body: el("div", { class: "colour-category-form" }, name, description, el("label", {}, "Colour", colour)), footer: [el("button", { class: "button", type: "button", onclick: () => entry.close("cancel") }, "Cancel"), el("button", { class: "button primary", type: "button", onclick: () => { const value = name.value.trim(); if (!value) return toast("Add a colour meaning", "error"); done({ categoryId: uid(), name: value, description: description.value.trim(), colour: colour.value, ordering: categories(page).length }); entry.close("create"); } }, "Add colour")] });
  name.focus();
}

export function openColourLegend(view, anchor) {
  const page = view.page, list = categories(page), occurrences = new Map();
  view.editor.flat().forEach(({ block }) => (block.text || []).forEach((span) => { if (span.categoryId) occurrences.set(span.categoryId, (occurrences.get(span.categoryId) || 0) + 1); }));
  menu(anchor, [
    { type: "label", label: "Colour key" },
    { type: "custom", render: () => {
      const wrap = el("div", { class: "colour-legend" });
      if (!list.length) wrap.append(el("p", { class: "colour-legend-empty" }, "Highlight text, then give a colour its meaning."));
      list.forEach((category) => wrap.append(el("button", { class: `colour-legend-row${view.activeColourFilters?.has(category.categoryId) ? " is-active" : ""}`, type: "button", onclick: () => view.toggleColourFocus(category.categoryId) }, el("span", { class: "colour-code-dot", style: { background: category.colour } }), el("span", { class: "colour-legend-copy" }, el("strong", {}, category.name), category.description ? el("small", {}, category.description) : null), el("span", { class: "colour-count" }, String(occurrences.get(category.categoryId) || 0)))));
      return wrap;
    } },
    { type: "separator" },
    { label: "Show all", icon: "close", onSelect: () => view.clearColourFocus() },
    { label: "Add category…", icon: "plus", onSelect: () => createCategory(page, (cat) => { saveCategories(page, [...categories(page), cat]); view.draw(); }) },
  ], { class: "colour-legend-menu" });
}
