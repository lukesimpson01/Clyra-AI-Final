/* Databases: a page that holds records, seen as a table, a board, a list, a gallery or a calendar.

   The server already stores properties, views, filters, sorts and grouping; this is the screen for them. A view keeps its
   own filter, sort, group and hidden columns in its config, so switching tabs switches the whole arrangement, as in
   Notion. Every record is an ordinary page, so opening one opens it for writing. */
import { el, clear, icon, iconButton, menu, modal, toast, confirmDialog, append } from "./dom.js";
import { api } from "./api.js";
import { withError, refreshPages } from "./state.js";
import { templateBlocks } from "./templates-data.js";

const TYPE_LABEL = {
  title: "Title", text: "Text", number: "Number", select: "Select", multi_select: "Multi-select", status: "Status", date: "Date", checkbox: "Checkbox",
  url: "URL", email: "Email", phone: "Phone", person: "Person", created_time: "Created time", last_edited_time: "Last edited time",
  formula: "Formula", relation: "Relation", rollup: "Rollup", created_by: "Created by", last_edited_by: "Last edited by", unique_id: "ID", files: "Files", button: "Button", place: "Place",
};
const TYPE_ICON = {
  title: "text", text: "align_left", number: "numbers", select: "toggle", multi_select: "list", status: "target", date: "calendar", checkbox: "check_square",
  url: "link", email: "link", phone: "link", person: "star", created_time: "history", last_edited_time: "history", formula: "equation",
};
const ADDABLE = ["text", "number", "select", "multi_select", "status", "date", "checkbox", "url", "email", "phone", "created_time", "last_edited_time"];
const VIEW_KINDS = [["table", "Table", "table"], ["board", "Board", "panel"], ["timeline", "Timeline", "calendar"], ["calendar", "Calendar", "calendar"], ["list", "List", "list"], ["gallery", "Gallery", "image"], ["feed", "Feed", "list"], ["chart", "Chart", "chart"], ["dashboard", "Dashboard", "panel"], ["form", "Form", "page"]];
const CHART_KINDS = [["vbar", "Vertical bar"], ["hbar", "Horizontal bar"], ["line", "Line"], ["donut", "Donut"], ["number", "Number"]];
const PALETTE = ["#337ea9", "#448361", "#d9730d", "#9065b0", "#c14f87", "#cb912f", "#d44c47", "#9f6b53", "#787774"];
const COLORS = ["gray", "brown", "orange", "yellow", "green", "blue", "purple", "pink", "red"];
const COMPUTED = new Set(["formula", "rollup", "created_time", "created_by", "last_edited_time", "last_edited_by", "unique_id", "button"]);
const SELECTY = new Set(["select", "status", "multi_select"]);

const OPERATORS = {
  text: [["contains", "contains"], ["does_not_contain", "does not contain"], ["is", "is"], ["is_not", "is not"], ["is_empty", "is empty"], ["is_not_empty", "is not empty"]],
  number: [["is", "="], ["greater_than", ">"], ["less_than", "<"], ["greater_or_equal", "≥"], ["less_or_equal", "≤"], ["is_empty", "is empty"], ["is_not_empty", "is not empty"]],
  select: [["is", "is"], ["is_not", "is not"], ["is_empty", "is empty"], ["is_not_empty", "is not empty"]],
  multi_select: [["any_of", "contains any of"], ["none_of", "contains none of"], ["is_empty", "is empty"], ["is_not_empty", "is not empty"]],
  checkbox: [["is_checked", "is checked"], ["is_unchecked", "is not checked"]],
  date: [["is_today", "is today"], ["before", "is before"], ["after", "is after"], ["on_or_before", "is on or before"], ["on_or_after", "is on or after"], ["is_before_today", "is in the past"], ["is_within_next_days", "is within the next 7 days"], ["is_empty", "is empty"], ["is_not_empty", "is not empty"]],
};
const operatorsFor = (type) => OPERATORS[type === "status" ? "select" : ["text", "number", "select", "multi_select", "checkbox", "date"].includes(type) ? type : type === "created_time" || type === "last_edited_time" ? "date" : "text"];
const NO_VALUE = new Set(["is_empty", "is_not_empty", "is_checked", "is_unchecked", "is_today", "is_before_today", "is_within_next_days"]);

const titleOf = (record) => String(record.title || "").trim() || "Untitled";
const dateText = (value) => { const raw = value && typeof value === "object" ? value.start : value; if (!raw) return ""; const d = new Date(String(raw).includes("T") ? raw : `${raw}T00:00:00`); return Number.isFinite(d.getTime()) ? d.toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" }) : String(raw); };
const dateKey = (value) => { const raw = value && typeof value === "object" ? value.start : value; return raw ? String(raw).slice(0, 10) : ""; };
const optionsOf = (property) => (Array.isArray(property?.config?.options) ? property.config.options : []);
const colorVars = (color) => ({ "--chip-fg": `var(--c-${color || "gray"})`, "--chip-bg": `var(--c-${color || "gray"}-bg)` });
const chip = (option) => el("span", { class: "db-chip", style: colorVars(option.color) }, option.name);

export async function createDatabase(context, parentId = null) {
  const made = await withError(() => api.post("/api/notes/databases", { name: "Untitled database", parentId }), "Could not create the database");
  if (!made) return null;
  /* Notion's databases start without an icon; the server's placeholder glyph is too heavy to keep */
  await api.patch(`/api/notes/pages/${made.page_id}`, { icon: null }).catch(() => {});
  await refreshPages();
  context.openPage(made.page_id);
  return made;
}

/* A template's database: its properties, sample rows and views, made with the ordinary database API. Option names become
   option ids and colours, and dates written as an offset from today become real dates. */
const slug = (text) => String(text).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "x";
const OPTION_COLORS = ["gray", "blue", "orange", "green", "purple", "pink", "yellow", "red", "brown"];
const NOTION_COLOR = { default: "gray", gray: "gray", brown: "brown", orange: "orange", yellow: "yellow", green: "green", blue: "blue", purple: "purple", pink: "pink", red: "red", teal: "green" };
const STATUS_DEFAULT = ["Not started", "In progress", "Done"];

export async function buildDatabase(spec, { parentId = null, inline = false, icon = null, cover = null, name } = {}) {
  const properties = spec.properties.map((def) => {
    let options = def.options;
    if (def.type === "status" && !(options && options.length)) options = STATUS_DEFAULT;
    return {
      name: def.name, type: def.type,
      config: options ? { options: options.map((label, index) => ({ id: slug(label), name: label, color: NOTION_COLOR[def.colors?.[index]] || OPTION_COLORS[(index + 1) % OPTION_COLORS.length] })) } : {},
    };
  });
  const made = await withError(() => api.post("/api/notes/databases", { name: name || spec.name, parentId, inline, properties }), "Could not create the database");
  if (!made) return null;
  await api.patch(`/api/notes/pages/${made.page_id}`, { icon, cover }).catch(() => {});
  const byName = new Map(made.properties.map((property) => [property.name, property]));
  const value = (definition, raw) => {
    if (raw === undefined || raw === null) return undefined;
    if (raw && typeof raw === "object" && "offsetDays" in raw) return { start: new Date(Date.now() + raw.offsetDays * 86_400_000).toISOString().slice(0, 10) };
    if (definition.type === "select" || definition.type === "status") return slug(raw);
    if (definition.type === "multi_select") return (Array.isArray(raw) ? raw : [raw]).map(slug);
    return raw;
  };
  const titleName = spec.properties.find((def) => def.type === "title").name;
  for (const record of spec.records || []) {
    const values = {};
    for (const def of spec.properties) {
      if (def.type === "title" || !byName.get(def.name)) continue;
      const next = value(def, record[def.name]);
      if (next !== undefined) values[byName.get(def.name).id] = next;
    }
    await api.post(`/api/notes/databases/${made.id}/records`, { title: record[titleName] || "", values }).catch(() => {});
  }
  const viewConfig = (view) => {
    const config = {};
    if (view.group && byName.get(view.group)) config.group = byName.get(view.group).id;
    if (view.date && byName.get(view.date)) config.dateProperty = byName.get(view.date).id;
    if (view.chart) config.chart = view.chart;
    if (view.sort && byName.get(view.sort)) config.sorts = [{ property: byName.get(view.sort).id, direction: "ascending" }];
    return config;
  };
  const views = spec.views?.length ? spec.views : [{ name: "Table", type: "table" }];
  const [first, ...rest] = views;
  const existing = made.views[0];
  if (existing) await api.patch(`/api/notes/views/${existing.id}`, { name: first.name, type: first.type, config: viewConfig(first) }).catch(() => {});
  for (const view of rest) await api.post(`/api/notes/databases/${made.id}/views`, { name: view.name, type: view.type, config: viewConfig(view) }).catch(() => {});
  return made;
}

/* A template becomes a page, with each database it carries created inside it and shown in place. A template that is only one
   database becomes that database's own page. */
export async function createFromTemplate(context, template, parentId = null, { open = true } = {}) {
  const dbs = template.databases || [];
  const blocks = templateBlocks(template);
  const dbBlocks = [];
  const walk = (list) => { for (const block of list) { if (block.type === "database") dbBlocks.push(block); walk(block.children || []); } };
  walk(blocks);
  let pageId = null;
  if (blocks.length === 1 && blocks[0].type === "database" && dbs[blocks[0].props.dbIndex]) {
    const made = await buildDatabase(dbs[blocks[0].props.dbIndex], { parentId, icon: template.emoji, cover: template.cover, name: template.name });
    pageId = made?.page_id;
  } else {
    const created = await withError(() => api.post("/api/notes/pages", { parentId, title: template.name, icon: template.emoji, cover: template.cover || undefined, blocks }), "Could not create the page");
    if (!created) return null;
    pageId = created.id;
    for (const block of dbBlocks) {
      const spec = dbs[block.props.dbIndex];
      const made = spec ? await buildDatabase(spec, { parentId: pageId, inline: true }) : null;
      block.props = made ? { pageId: made.page_id } : {};
    }
    if (dbBlocks.length) await api.put(`/api/notes/pages/${pageId}/blocks`, { blocks }).catch(() => toast("Some databases could not be placed"));
  }
  if (!pageId) return null;
  await refreshPages();
  if (open) context.openPage(pageId);
  return { pageId };
}

export class DatabaseView {
  constructor(host, page, context, options = {}) {
    this.host = host; this.page = page; this.context = context; this.embedded = Boolean(options.embedded);
    this.db = null; this.data = null; this.viewId = null; this.month = new Date(); this.search = "";
    this.node = el("div", { class: "db" });
    host.append(this.node);
    this.load();
  }

  destroy() { clearTimeout(this.saveTimer); }

  async load() {
    this.db = await withError(() => api.get(`/api/notes/pages/${this.page.id}/database`), "Could not open this database");
    if (!this.db) { this.node.append(el("div", { class: "empty-state", text: "This database could not be opened." })); return; }
    if (!this.db.views.length) { const view = await api.post(`/api/notes/databases/${this.db.id}/views`, { name: "Table", type: "table" }); this.db.views.push(view); }
    this.viewId = this.viewId && this.db.views.some((view) => view.id === this.viewId) ? this.viewId : this.db.views[0].id;
    await this.query();
  }

  get view() { return this.db.views.find((view) => view.id === this.viewId); }
  get props() { return this.db.properties; }
  prop(id) { return this.props.find((property) => property.id === id); }
  get config() { return this.view.config || (this.view.config = {}); }
  groupProperty() {
    const configured = this.prop(this.config.group);
    if (configured) return configured;
    return this.props.find((property) => property.type === "status") || this.props.find((property) => property.type === "select") || null;
  }
  dateProperty() { return this.prop(this.config.dateProperty) || this.props.find((property) => property.type === "date") || null; }
  visibleProps() { const hidden = new Set(this.config.hidden || []); return this.props.filter((property) => property.type !== "title" && !hidden.has(property.id)); }
  titleProp() { return this.props.find((property) => property.type === "title"); }

  async query() {
    const view = this.view;
    /* the view's arrangement goes with the question, so a change shows at once rather than after it is saved */
    const overrides = { filter: this.config.filter || { conditions: [] }, sorts: this.config.sorts || [] };
    if (this.search) overrides.search = this.search;
    if (view.type === "board") overrides.group = this.groupProperty()?.id;
    else if (this.config.group) overrides.group = this.config.group;
    else overrides.group = null;
    this.data = await withError(() => api.post(`/api/notes/views/${view.id}/query`, overrides), "Could not load the records");
    if (!this.data) return;
    this.paint();
  }

  saveConfig() {
    clearTimeout(this.saveTimer);
    const { id, config } = this.view;
    this.saveTimer = setTimeout(() => api.patch(`/api/notes/views/${id}`, { config }).catch(() => toast("Could not save the view")), 250);
  }

  /* ------------------------------------------------------------ chrome */

  paint() {
    clear(this.node);
    this.node.classList.toggle("embedded", this.embedded);
    append(this.node, this.embedded ? el("div", { class: "db-title", text: this.db.name }) : null, this.buildTabs(), this.buildBar(), this.buildBody());
  }

  buildTabs() {
    const tabs = el("div", { class: "db-tabs", role: "tablist" });
    for (const view of this.db.views) {
      const kind = VIEW_KINDS.find(([type]) => type === view.type) || VIEW_KINDS[0];
      const active = view.id === this.viewId;
      tabs.append(el("button", {
        class: `db-tab${active ? " active" : ""}`, type: "button", role: "tab", "aria-selected": String(active),
        onclick: () => { if (!active) { this.viewId = view.id; this.query(); } else this.viewMenu(view, tabs); },
        oncontextmenu: (event) => { event.preventDefault(); this.viewMenu(view, event.currentTarget); },
      }, icon(kind[2], 14), el("span", { text: view.name })));
    }
    const add = iconButton("plus", "Add a view", () => menu(add, VIEW_KINDS.map(([type, label, glyph]) => ({ label, icon: glyph, onSelect: () => this.addView(type, label) })), { align: "start" }), { size: 14, className: "db-tab-add" });
    tabs.append(add);
    return tabs;
  }

  async addView(type, label) {
    const config = {};
    const made = await withError(() => api.post(`/api/notes/databases/${this.db.id}/views`, { name: label, type, config }), "Could not add the view");
    if (!made) return;
    this.db.views.push(made); this.viewId = made.id;
    if (type === "board") { const group = this.groupProperty(); if (group) { this.config.group = group.id; this.saveConfig(); } }
    await this.query();
  }

  viewMenu(view, anchor) {
    menu(anchor, [
      { label: "Rename view", icon: "pencil", onSelect: () => this.promptName("Rename view", view.name, async (name) => { view.name = name; await api.patch(`/api/notes/views/${view.id}`, { name }); this.paint(); }) },
      ...VIEW_KINDS.filter(([type]) => type !== view.type).map(([type, label, glyph]) => ({ label: `Show as ${label.toLowerCase()}`, icon: glyph, onSelect: async () => { view.type = type; await api.patch(`/api/notes/views/${view.id}`, { type }); if (type === "board" && !view.config.group) { const g = this.groupProperty(); if (g) { view.config.group = g.id; this.saveConfig(); } } this.query(); } })),
      { type: "separator" },
      { label: "Delete view", icon: "trash", danger: true, disabled: this.db.views.length < 2, onSelect: async () => {
        if (!(await confirmDialog({ title: "Delete view", message: `"${view.name}" is removed. The records stay.`, confirmLabel: "Delete view" }))) return;
        await api.del(`/api/notes/views/${view.id}`); this.db.views = this.db.views.filter((entry) => entry.id !== view.id); this.viewId = this.db.views[0].id; this.query();
      } },
    ], { align: "start" });
  }

  promptName(title, value, onSave) {
    const input = el("input", { class: "extras-input", value, "aria-label": title });
    const save = el("button", { class: "button primary", type: "button" }, "Save");
    const cancel = el("button", { class: "button", type: "button" }, "Cancel");
    const entry = modal({ title, width: 400, body: el("div", { class: "extras-body" }, input), footer: [cancel, save] });
    const commit = () => { const text = input.value.trim(); if (!text) return; entry.close("save"); onSave(text); };
    cancel.addEventListener("click", () => entry.close("cancel")); save.addEventListener("click", commit);
    input.addEventListener("keydown", (event) => { if (event.key === "Enter") { event.preventDefault(); commit(); } });
    input.select();
  }

  buildBar() {
    const type = this.view.type;
    const filterCount = (this.config.filter?.conditions || []).length;
    const sortCount = (this.config.sorts || []).length;
    const button = (label, glyph, count, onClick) => {
      const node = el("button", { class: `db-tool${count ? " on" : ""}`, type: "button", onclick: () => onClick(node) }, icon(glyph, 14), el("span", { text: count ? `${label} · ${count}` : label }));
      return node;
    };
    const search = el("input", { class: "db-search", type: "search", placeholder: "Search", "aria-label": "Search records", value: this.search });
    let timer = 0;
    search.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(async () => { this.search = search.value; await this.query(); const next = this.node.querySelector(".db-search"); next?.focus(); next?.setSelectionRange(next.value.length, next.value.length); }, 220); });
    return el("div", { class: "db-bar" },
      button("Filter", "list", filterCount, (anchor) => this.filterMenu(anchor)),
      button("Sort", "arrow_up", sortCount, (anchor) => this.sortMenu(anchor)),
      type !== "calendar" && type !== "gallery" && type !== "timeline" && type !== "form" && type !== "dashboard" ? button(type === "chart" ? "Group by" : "Group", "panel", this.config.group && type !== "board" ? 1 : 0, (anchor) => this.groupMenu(anchor)) : null,
      type === "chart" ? button((CHART_KINDS.find(([key]) => key === (this.config.chart || "vbar")) || CHART_KINDS[0])[1], "chart", 0, (anchor) => menu(anchor, CHART_KINDS.map(([key, label]) => ({ label, checked: (this.config.chart || "vbar") === key, onSelect: () => { this.config.chart = key; this.saveConfig(); this.paint(); } })), { align: "start" })) : null,
      type === "calendar" || type === "timeline" ? button("Date by", "calendar", 0, (anchor) => this.dateByMenu(anchor)) : null,
      button("Properties", "pencil", (this.config.hidden || []).length, (anchor) => this.propertiesMenu(anchor)),
      el("span", { class: "db-bar-spacer" }),
      search,
      el("button", { class: "db-new", type: "button", onclick: () => this.newRecord() }, icon("plus", 14), el("span", { text: "New" })));
  }

  popover(anchor, render) { return menu(anchor, [{ type: "custom", render }], { class: "db-pop", align: "start" }); }

  filterMenu(anchor) {
    const conditions = (this.config.filter ||= { conjunction: "and", conditions: [] }).conditions;
    const redraw = () => { this.saveConfig(); this.query(); };
    return this.popover(anchor, () => {
      const root = el("div", { class: "db-pop-body" });
      const draw = () => {
        clear(root);
        if (!conditions.length) root.append(el("div", { class: "db-pop-empty", text: "No filters yet." }));
        conditions.forEach((condition, index) => {
          const property = this.prop(condition.property) || this.props[0];
          const prop = el("select", { class: "db-select", "aria-label": "Property" }, this.props.map((candidate) => el("option", { value: candidate.id, text: candidate.name, selected: candidate.id === property.id })));
          const operator = el("select", { class: "db-select", "aria-label": "Condition" }, operatorsFor(property.type).map(([value, label]) => el("option", { value, text: label, selected: value === condition.operator })));
          let value = null;
          if (!NO_VALUE.has(condition.operator) && !["is_checked", "is_unchecked"].includes(condition.operator)) {
            if (SELECTY.has(property.type)) { value = el("select", { class: "db-select", "aria-label": "Value" }, [el("option", { value: "", text: "Choose…" }), ...optionsOf(property).map((option) => el("option", { value: option.id, text: option.name, selected: option.id === condition.value }))]); }
            else value = el("input", { class: "db-input", type: property.type === "number" ? "number" : ["date", "created_time", "last_edited_time"].includes(property.type) ? "date" : "text", value: condition.value ?? "", "aria-label": "Value", placeholder: "Value" });
          }
          prop.addEventListener("change", () => { condition.property = prop.value; condition.operator = operatorsFor(this.prop(prop.value).type)[0][0]; condition.value = ""; draw(); redraw(); });
          operator.addEventListener("change", () => { condition.operator = operator.value; draw(); redraw(); });
          value?.addEventListener(value.tagName === "SELECT" ? "change" : "input", () => { condition.value = value.value; redraw(); });
          if (!condition.operator) condition.operator = operatorsFor(property.type)[0][0];
          root.append(el("div", { class: "db-cond" }, prop, operator, value, iconButton("close", "Remove filter", () => { conditions.splice(index, 1); draw(); redraw(); }, { size: 12 })));
        });
        root.append(el("button", { class: "db-pop-add", type: "button", onclick: () => { const first = this.props[0]; conditions.push({ property: first.id, operator: operatorsFor(first.type)[0][0], value: "" }); draw(); } }, icon("plus", 13), "Add a filter"));
      };
      draw();
      return root;
    });
  }

  sortMenu(anchor) {
    const sorts = (this.config.sorts ||= []);
    const redraw = () => { this.saveConfig(); this.query(); };
    return this.popover(anchor, () => {
      const root = el("div", { class: "db-pop-body" });
      const draw = () => {
        clear(root);
        if (!sorts.length) root.append(el("div", { class: "db-pop-empty", text: "No sorting yet." }));
        sorts.forEach((sort, index) => {
          const prop = el("select", { class: "db-select", "aria-label": "Sort by" }, this.props.map((candidate) => el("option", { value: candidate.id, text: candidate.name, selected: candidate.id === sort.property })));
          const direction = el("select", { class: "db-select", "aria-label": "Direction" }, [["ascending", "Ascending"], ["descending", "Descending"]].map(([value, label]) => el("option", { value, text: label, selected: (sort.direction || "ascending") === value })));
          prop.addEventListener("change", () => { sort.property = prop.value; redraw(); });
          direction.addEventListener("change", () => { sort.direction = direction.value; redraw(); });
          root.append(el("div", { class: "db-cond" }, prop, direction, iconButton("close", "Remove sort", () => { sorts.splice(index, 1); draw(); redraw(); }, { size: 12 })));
        });
        root.append(el("button", { class: "db-pop-add", type: "button", onclick: () => { sorts.push({ property: this.props[0].id, direction: "ascending" }); draw(); redraw(); } }, icon("plus", 13), "Add a sort"));
      };
      draw();
      return root;
    });
  }

  groupMenu(anchor) {
    const groupable = this.props.filter((property) => SELECTY.has(property.type));
    menu(anchor, [
      { label: "None", checked: !this.config.group, onSelect: () => { delete this.config.group; this.saveConfig(); this.query(); } },
      ...groupable.map((property) => ({ label: property.name, icon: TYPE_ICON[property.type], checked: this.config.group === property.id, onSelect: () => { this.config.group = property.id; this.saveConfig(); this.query(); } })),
      groupable.length ? null : { label: "Add a Select or Status property first", disabled: true },
    ].filter(Boolean), { align: "start" });
  }

  dateByMenu(anchor) {
    const dates = this.props.filter((property) => property.type === "date");
    menu(anchor, dates.length ? dates.map((property) => ({ label: property.name, icon: "calendar", checked: this.dateProperty()?.id === property.id, onSelect: () => { this.config.dateProperty = property.id; this.saveConfig(); this.paint(); } })) : [{ label: "No date property yet", disabled: true }], { align: "start" });
  }

  propertiesMenu(anchor) {
    const hidden = new Set(this.config.hidden || []);
    menu(anchor, [
      { type: "label", label: "Shown in this view" },
      ...this.props.filter((property) => property.type !== "title").map((property) => ({
        label: property.name, icon: TYPE_ICON[property.type] || "text", switch: true, checked: !hidden.has(property.id), keepOpen: true,
        onSelect: () => { hidden.has(property.id) ? hidden.delete(property.id) : hidden.add(property.id); this.config.hidden = [...hidden]; this.saveConfig(); this.paint(); },
      })),
      { type: "separator" },
      { label: "New property", icon: "plus", onSelect: () => this.addPropertyMenu(anchor) },
    ], { align: "start" });
  }

  addPropertyMenu(anchor) {
    menu(anchor, ADDABLE.map((type) => ({ label: TYPE_LABEL[type], icon: TYPE_ICON[type] || "text", onSelect: async () => {
      const config = type === "status" ? { options: [{ id: "todo", name: "Not started", color: "gray" }, { id: "doing", name: "In progress", color: "blue" }, { id: "done", name: "Done", color: "green" }] }
        : type === "select" || type === "multi_select" ? { options: [{ id: "a", name: "Option A", color: "blue" }, { id: "b", name: "Option B", color: "green" }] } : {};
      const made = await withError(() => api.post(`/api/notes/databases/${this.db.id}/properties`, { name: TYPE_LABEL[type], type, config }), "Could not add the property");
      if (made) { this.db.properties.push(made); this.query(); }
    } })), { align: "start", class: "db-type-menu" });
  }

  /* ----------------------------------------------------------- records */

  async newRecord(values = {}, title = "") {
    const made = await withError(() => api.post(`/api/notes/databases/${this.db.id}/records`, { title, values }), "Could not add the record");
    if (!made) return null;
    await this.query();
    return made;
  }

  async setValue(record, property, value) {
    record.values[property.id] = value;
    if (property.type === "title") record.title = value;
    const result = await withError(() => api.patch(`/api/notes/records/${record.id}`, { values: { [property.id]: value } }), "Could not save that");
    return Boolean(result);
  }

  async removeRecord(record) {
    if (!(await confirmDialog({ title: "Delete record", message: `"${titleOf(record)}" moves to the trash.`, confirmLabel: "Delete" }))) return;
    await withError(() => api.del(`/api/notes/pages/${record.id}`), "Could not delete the record");
    await refreshPages(); await this.query();
  }

  open(record) { this.context.openPage(record.id); }

  recordMenu(record, anchor) {
    menu(anchor, [
      { label: "Open", icon: "page", onSelect: () => this.open(record) },
      { label: "Delete", icon: "trash", danger: true, onSelect: () => this.removeRecord(record) },
    ], { align: "start" });
  }

  /* ------------------------------------------------------------- cells */

  /* The read-only look of a value, shared by every view. */
  display(property, value) {
    if (value === null || value === undefined || value === "" || (Array.isArray(value) && !value.length)) return null;
    switch (property.type) {
      case "select": case "status": { const option = optionsOf(property).find((entry) => entry.id === value); return option ? chip(option) : el("span", { text: String(value) }); }
      case "multi_select": return el("span", { class: "db-chips" }, (Array.isArray(value) ? value : [value]).map((id) => { const option = optionsOf(property).find((entry) => entry.id === id); return option ? chip(option) : el("span", { text: String(id) }); }));
      case "date": case "created_time": case "last_edited_time": return el("span", { text: dateText(value) });
      case "checkbox": return icon(value ? "check_square" : "close", 14);
      case "url": return el("a", { href: String(value), target: "_blank", rel: "noopener noreferrer", text: String(value), onclick: (event) => event.stopPropagation() });
      case "number": return el("span", { text: String(value) });
      default: return el("span", { text: typeof value === "object" ? (value.__error ? "⚠" : JSON.stringify(value)) : String(value) });
    }
  }

  /* An editable cell: click to change it, the change is saved as it is made. */
  cell(record, property, { compact = false } = {}) {
    const node = el("div", { class: `db-cell type-${property.type}${compact ? " compact" : ""}` });
    const show = () => { clear(node); const shown = this.display(property, record.values[property.id]); if (shown) node.append(shown); else if (!compact) node.append(el("span", { class: "db-empty", text: "" })); };
    show();
    if (COMPUTED.has(property.type)) { node.classList.add("readonly"); return node; }
    const commit = async (value) => { const ok = await this.setValue(record, property, value); if (ok) show(); };
    if (property.type === "checkbox") { node.addEventListener("click", (event) => { event.stopPropagation(); commit(!record.values[property.id]); }); return node; }
    if (SELECTY.has(property.type)) { node.addEventListener("click", (event) => { event.stopPropagation(); this.optionMenu(node, record, property, commit); }); return node; }
    node.addEventListener("click", (event) => {
      if (event.target.closest("a")) return;
      event.stopPropagation();
      const kind = property.type === "number" ? "number" : property.type === "date" ? "date" : property.type === "email" ? "email" : "text";
      const input = el("input", { class: "db-cell-input", type: kind, value: property.type === "date" ? dateKey(record.values[property.id]) : record.values[property.id] ?? "", "aria-label": property.name });
      clear(node); node.append(input); input.focus();
      let done = false;
      const finish = async (save) => {
        if (done) return; done = true;
        if (save) {
          let value = input.value;
          if (property.type === "number") value = value === "" ? null : Number(value);
          else if (property.type === "date") value = value ? { start: value } : null;
          if (JSON.stringify(value) !== JSON.stringify(record.values[property.id])) { await commit(value); return; }
        }
        show();
      };
      input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); finish(true); } else if (e.key === "Escape") { e.preventDefault(); finish(false); } });
      input.addEventListener("blur", () => finish(true));
      if (kind === "date") input.addEventListener("change", () => finish(true));
    });
    return node;
  }

  optionMenu(anchor, record, property, commit) {
    const multi = property.type === "multi_select";
    const current = multi ? [...(record.values[property.id] || [])] : record.values[property.id];
    const items = optionsOf(property).map((option) => ({
      label: option.name, checked: multi ? current.includes(option.id) : current === option.id, keepOpen: multi,
      onSelect: () => {
        if (multi) { const at = current.indexOf(option.id); at >= 0 ? current.splice(at, 1) : current.push(option.id); commit([...current]); }
        else commit(option.id);
      },
    }));
    menu(anchor, [
      ...items,
      { type: "separator" },
      { label: "New option…", icon: "plus", onSelect: () => this.promptName("New option", "", async (name) => {
        const options = [...optionsOf(property), { id: `o${Date.now().toString(36)}`, name, color: COLORS[optionsOf(property).length % COLORS.length] }];
        const updated = await withError(() => api.patch(`/api/notes/properties/${property.id}`, { config: { ...property.config, options } }), "Could not add the option");
        if (!updated) return;
        property.config = { ...property.config, options };
        const added = options[options.length - 1];
        commit(multi ? [...current, added.id] : added.id);
      }) },
      !multi || current.length ? { label: "Clear", icon: "close", onSelect: () => commit(multi ? [] : null) } : null,
    ].filter(Boolean), { align: "start", class: "db-option-menu" });
  }

  headerMenu(property, anchor) {
    const sorts = (this.config.sorts ||= []);
    menu(anchor, [
      { label: "Rename", icon: "pencil", onSelect: () => this.promptName("Rename property", property.name, async (name) => { await api.patch(`/api/notes/properties/${property.id}`, { name }); property.name = name; this.paint(); }) },
      SELECTY.has(property.type) ? { label: "Edit options", icon: "list", onSelect: () => this.optionsEditor(property) } : null,
      { label: "Sort ascending", icon: "arrow_up", onSelect: () => { this.config.sorts = [{ property: property.id, direction: "ascending" }]; this.saveConfig(); this.query(); } },
      { label: "Sort descending", icon: "arrow_down", onSelect: () => { this.config.sorts = [{ property: property.id, direction: "descending" }]; this.saveConfig(); this.query(); } },
      property.type !== "title" ? { label: "Hide in view", icon: "close", onSelect: () => { this.config.hidden = [...(this.config.hidden || []), property.id]; this.saveConfig(); this.paint(); } } : null,
      property.type !== "title" ? { type: "separator" } : null,
      property.type !== "title" ? { label: "Delete property", icon: "trash", danger: true, onSelect: async () => {
        if (!(await confirmDialog({ title: "Delete property", message: `"${property.name}" and its values are removed from every record.`, confirmLabel: "Delete property" }))) return;
        await api.del(`/api/notes/properties/${property.id}`); this.db.properties = this.db.properties.filter((entry) => entry.id !== property.id); this.query();
      } } : null,
      sorts.length ? null : null,
    ].filter(Boolean), { align: "start" });
  }

  optionsEditor(property) {
    const options = optionsOf(property).map((option) => ({ ...option }));
    const list = el("div", { class: "db-options" });
    const draw = () => {
      clear(list);
      options.forEach((option, index) => {
        const name = el("input", { class: "db-input", value: option.name, "aria-label": "Option name" });
        const color = el("select", { class: "db-select", "aria-label": "Colour" }, COLORS.map((value) => el("option", { value, text: value[0].toUpperCase() + value.slice(1), selected: value === option.color })));
        name.addEventListener("input", () => { option.name = name.value; });
        color.addEventListener("change", () => { option.color = color.value; });
        list.append(el("div", { class: "db-option-row" }, el("span", { class: "db-dot", style: colorVars(option.color) }), name, color, iconButton("trash", "Remove option", () => { options.splice(index, 1); draw(); }, { size: 13 })));
      });
      list.append(el("button", { class: "db-pop-add", type: "button", onclick: () => { options.push({ id: `o${Date.now().toString(36)}`, name: "New option", color: COLORS[options.length % COLORS.length] }); draw(); } }, icon("plus", 13), "Add an option"));
    };
    draw();
    const save = el("button", { class: "button primary", type: "button" }, "Save");
    const cancel = el("button", { class: "button", type: "button" }, "Cancel");
    const entry = modal({ title: `Options for ${property.name}`, width: 460, body: list, footer: [cancel, save] });
    cancel.addEventListener("click", () => entry.close("cancel"));
    save.addEventListener("click", async () => {
      const clean = options.filter((option) => option.name.trim());
      const updated = await withError(() => api.patch(`/api/notes/properties/${property.id}`, { config: { ...property.config, options: clean } }), "Could not save the options");
      if (!updated) return;
      property.config = { ...property.config, options: clean }; entry.close("save"); this.query();
    });
  }

  /* ------------------------------------------------------------- views */

  buildBody() {
    const type = this.view.type;
    const body = el("div", { class: `db-body db-${type}` });
    if (!this.data) return body;
    const builder = { table: () => this.table(), board: () => this.board(), list: () => this.list(), gallery: () => this.gallery(), calendar: () => this.calendar(), feed: () => this.feed(), timeline: () => this.timeline(), form: () => this.form(), chart: () => this.chart(), dashboard: () => this.dashboard() }[type] || (() => this.table());
    body.append(builder());
    return body;
  }

  rows() { return this.data.records; }

  table() {
    const groups = this.data.groups;
    const wrap = el("div", { class: "db-table-wrap" });
    const columns = [this.titleProp(), ...this.visibleProps()].filter(Boolean);
    const head = el("tr", {}, columns.map((property) => el("th", { scope: "col" },
      el("button", { class: "db-th", type: "button", onclick: (event) => this.headerMenu(property, event.currentTarget) }, icon(TYPE_ICON[property.type] || "text", 13), el("span", { text: property.name })))),
      el("th", { class: "db-th-add" }, iconButton("plus", "Add a property", (event) => this.addPropertyMenu(event.currentTarget), { size: 14 })));
    const section = (records) => records.map((record) => this.tableRow(record, columns));
    const body = el("tbody");
    if (groups && this.config.group) {
      for (const group of groups) {
        body.append(el("tr", { class: "db-group-row" }, el("td", { colspan: String(columns.length + 1) }, el("span", { class: "db-group-name" }, group.color ? chip({ name: group.label, color: group.color }) : el("span", { text: group.label }), el("span", { class: "db-count", text: String(group.records.length) })))));
        body.append(...section(group.records));
      }
    } else body.append(...section(this.rows()));
    body.append(el("tr", { class: "db-new-row" }, el("td", { colspan: String(columns.length + 1) }, el("button", { type: "button", onclick: () => this.newRecord() }, icon("plus", 13), "New"))));
    wrap.append(el("table", { class: "db-table" }, el("thead", {}, head), body));
    return wrap;
  }

  tableRow(record, columns) {
    return el("tr", { class: "db-row" }, columns.map((property, index) => {
      const td = el("td", {}, this.cell(record, property));
      if (index === 0) td.append(el("span", { class: "db-row-actions" },
        el("button", { class: "db-open", type: "button", onclick: () => this.open(record) }, icon("page", 12), "Open"),
        iconButton("dots", "Row actions", (event) => this.recordMenu(record, event.currentTarget), { size: 13 })));
      return td;
    }), el("td", { class: "db-pad" }));
  }

  card(record, { board = false } = {}) {
    const props = this.visibleProps().filter((property) => property.id !== this.groupProperty()?.id || !board);
    const shown = props.map((property) => ({ property, node: this.display(property, record.values[property.id]) })).filter((entry) => entry.node);
    const card = el("article", { class: "db-card", tabindex: "0", draggable: board ? "true" : "false", "data-record": record.id,
      onclick: () => this.open(record), onkeydown: (event) => { if (event.key === "Enter") this.open(record); } },
      el("div", { class: "db-card-title", text: titleOf(record) }),
      ...shown.slice(0, 4).map((entry) => el("div", { class: "db-card-prop", title: entry.property.name }, entry.node)));
    if (board) {
      card.addEventListener("dragstart", (event) => { event.dataTransfer.setData("text/plain", record.id); event.dataTransfer.effectAllowed = "move"; card.classList.add("dragging"); });
      card.addEventListener("dragend", () => card.classList.remove("dragging"));
    }
    return card;
  }

  board() {
    const group = this.groupProperty();
    const wrap = el("div", { class: "db-board" });
    if (!group) { wrap.append(el("div", { class: "db-pop-empty", text: "Add a Select or Status property to group this board." })); return wrap; }
    for (const column of this.data.groups || []) {
      const col = el("section", { class: "db-col", "aria-label": column.label },
        el("header", { class: "db-col-head" }, column.color ? chip({ name: column.label, color: column.color }) : el("span", { class: "db-col-name", text: column.label }), el("span", { class: "db-count", text: String(column.records.length) }),
          el("span", { class: "db-bar-spacer" }), iconButton("plus", `Add to ${column.label}`, () => this.newRecord(column.key ? { [group.id]: group.type === "multi_select" ? [column.key] : column.key } : {}), { size: 14 })),
        el("div", { class: "db-col-cards" }, column.records.map((record) => this.card(record, { board: true }))));
      col.addEventListener("dragover", (event) => { event.preventDefault(); col.classList.add("over"); });
      col.addEventListener("dragleave", () => col.classList.remove("over"));
      col.addEventListener("drop", async (event) => {
        event.preventDefault(); col.classList.remove("over");
        const id = event.dataTransfer.getData("text/plain");
        const record = this.data.records.find((entry) => entry.id === id);
        if (!record) return;
        await this.setValue(record, group, column.key ? (group.type === "multi_select" ? [column.key] : column.key) : null);
        this.query();
      });
      wrap.append(col);
    }
    return wrap;
  }

  list() {
    const wrap = el("div", { class: "db-list" });
    const groups = this.data.groups && this.config.group ? this.data.groups : [{ label: "", records: this.rows() }];
    for (const group of groups) {
      if (group.label) wrap.append(el("div", { class: "db-group-name db-list-group" }, group.color ? chip({ name: group.label, color: group.color }) : el("span", { text: group.label }), el("span", { class: "db-count", text: String(group.records.length) })));
      for (const record of group.records) {
        wrap.append(el("div", { class: "db-list-row", tabindex: "0", onclick: () => this.open(record), onkeydown: (event) => { if (event.key === "Enter") this.open(record); } },
          el("span", { class: "db-list-title", text: titleOf(record) }),
          el("span", { class: "db-list-props" }, this.visibleProps().map((property) => this.display(property, record.values[property.id])).filter(Boolean).slice(0, 4)),
          el("span", { class: "db-row-actions" }, iconButton("dots", "Row actions", (event) => { event.stopPropagation(); this.recordMenu(record, event.currentTarget); }, { size: 13 }))));
      }
    }
    wrap.append(el("button", { class: "db-list-new", type: "button", onclick: () => this.newRecord() }, icon("plus", 13), "New"));
    return wrap;
  }

  gallery() {
    const wrap = el("div", { class: "db-gallery" }, this.rows().map((record) => this.card(record)));
    wrap.append(el("button", { class: "db-card db-card-new", type: "button", onclick: () => this.newRecord() }, icon("plus", 16), el("span", { text: "New" })));
    return wrap;
  }

  feed() {
    const wrap = el("div", { class: "db-feed" });
    for (const record of this.rows()) {
      wrap.append(el("article", { class: "db-feed-item", tabindex: "0", onclick: () => this.open(record), onkeydown: (event) => { if (event.key === "Enter") this.open(record); } },
        el("h4", { class: "db-feed-title", text: titleOf(record) }),
        ...this.visibleProps().map((property) => { const shown = this.display(property, record.values[property.id]); return shown ? el("div", { class: "db-feed-prop" }, el("span", { class: "db-feed-label", text: property.name }), shown) : null; }).filter(Boolean)));
    }
    wrap.append(el("button", { class: "db-list-new", type: "button", onclick: () => this.newRecord() }, icon("plus", 13), "New"));
    return wrap;
  }

  /* A timeline lays records out along a row of days by their date; each runs three days from its start. */
  timeline() {
    const dateProp = this.dateProperty();
    const wrap = el("div", { class: "db-timeline" });
    if (!dateProp) { wrap.append(el("div", { class: "db-pop-empty", text: "A timeline needs a Date property." })); return wrap; }
    const DAY = 86_400_000, DAYS = 3;
    const day = (value) => { const key = dateKey(value); return key ? Math.floor(new Date(`${key}T00:00:00Z`).getTime() / DAY) : null; };
    const dated = this.rows().map((record) => ({ record, at: day(record.values[dateProp.id]) })).filter((entry) => entry.at !== null);
    const today = Math.floor(new Date(new Date().toISOString().slice(0, 10) + "T00:00:00Z").getTime() / DAY);
    const first = Math.min(today - 3, ...dated.map((entry) => entry.at)) - 1;
    const last = Math.max(today + 10, ...dated.map((entry) => entry.at + DAYS)) + 1;
    const span = Math.min(90, last - first + 1);
    const cell = 34;
    const head = el("div", { class: "db-tl-head", style: { gridTemplateColumns: `220px repeat(${span}, ${cell}px)` } }, el("div", { class: "db-tl-corner" }));
    for (let i = 0; i < span; i += 1) {
      const date = new Date((first + i) * DAY);
      head.append(el("div", { class: `db-tl-day${first + i === today ? " today" : ""}` }, el("span", { class: "db-tl-dow", text: date.toLocaleDateString([], { weekday: "narrow", timeZone: "UTC" }) }), el("span", { text: String(date.getUTCDate()) })));
    }
    wrap.append(head);
    for (const { record, at } of dated) {
      const row = el("div", { class: "db-tl-row", style: { gridTemplateColumns: `220px repeat(${span}, ${cell}px)` } },
        el("button", { class: "db-tl-name", type: "button", onclick: () => this.open(record), text: titleOf(record) }));
      const start = Math.max(0, at - first);
      row.append(el("div", { class: "db-tl-bar", style: { gridColumn: `${start + 2} / span ${DAYS}` } }, el("span", { text: titleOf(record) })));
      wrap.append(row);
    }
    wrap.append(el("button", { class: "db-list-new", type: "button", onclick: () => this.newRecord({ [dateProp.id]: { start: new Date().toISOString().slice(0, 10) } }) }, icon("plus", 13), "New"));
    return wrap;
  }

  /* A form: one field per property, and a submit that adds a record. */
  form() {
    const wrap = el("form", { class: "db-form", novalidate: "true" });
    const fields = this.props.filter((property) => !COMPUTED.has(property.type));
    const readers = [];
    for (const property of fields) {
      let control;
      if (SELECTY.has(property.type)) {
        control = el("select", { class: "db-select", "aria-label": property.name, multiple: property.type === "multi_select" || undefined }, [property.type === "multi_select" ? null : el("option", { value: "", text: "Choose\u2026" }), ...optionsOf(property).map((option) => el("option", { value: option.id, text: option.name }))].filter(Boolean));
        readers.push([property, () => (property.type === "multi_select" ? [...control.selectedOptions].map((option) => option.value) : control.value || null)]);
      } else if (property.type === "checkbox") {
        control = el("input", { type: "checkbox", "aria-label": property.name });
        readers.push([property, () => control.checked]);
      } else {
        control = el("input", { class: "db-input", type: property.type === "number" ? "number" : property.type === "date" ? "date" : "text", "aria-label": property.name });
        readers.push([property, () => (property.type === "number" ? (control.value === "" ? null : Number(control.value)) : property.type === "date" ? (control.value ? { start: control.value } : null) : control.value)]);
      }
      wrap.append(el("label", { class: "db-form-field" }, el("span", { class: "db-form-label", text: property.name }), control));
    }
    const note = el("div", { class: "db-form-note", role: "status" });
    wrap.append(el("button", { class: "db-new", type: "submit" }, "Submit"), note);
    wrap.addEventListener("submit", async (event) => {
      event.preventDefault();
      const values = {}; let title = "";
      for (const [property, read] of readers) { const value = read(); if (property.type === "title") title = String(value || ""); else if (value !== null && value !== "" && !(Array.isArray(value) && !value.length)) values[property.id] = value; }
      if (!title.trim()) { note.textContent = "Add a title first."; return; }
      const made = await this.newRecord(values, title);
      if (made) { wrap.reset(); note.textContent = "Submitted. The record is in the database."; this.paint(); }
    });
    return wrap;
  }

  /* Count records by a property: the buckets a chart draws, in the order the property lists them. */
  buckets(property) {
    const rows = this.rows();
    const counts = new Map();
    const bump = (key, label, color) => { const entry = counts.get(key) || { label, color, n: 0 }; entry.n += 1; counts.set(key, entry); };
    if (property && SELECTY.has(property.type)) {
      for (const option of optionsOf(property)) counts.set(option.id, { label: option.name, color: `var(--c-${option.color || "gray"})`, n: 0 });
      for (const record of rows) { const raw = record.values[property.id]; const list = Array.isArray(raw) ? raw : raw ? [raw] : []; if (!list.length) bump("", "None"); for (const id of list) { const option = optionsOf(property).find((entry) => entry.id === id); bump(id, option?.name || String(id), option ? `var(--c-${option.color || "gray"})` : undefined); } }
    } else if (property && property.type === "checkbox") {
      for (const record of rows) bump(record.values[property.id] ? "yes" : "no", record.values[property.id] ? "Checked" : "Unchecked");
    } else if (property && (property.type === "date" || property.type === "created_time")) {
      for (const record of rows) { const key = dateKey(record.values[property.id]); bump(key || "", key ? dateText(key) : "No date"); }
      return [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([, entry]) => entry);
    } else if (property) {
      for (const record of rows) { const raw = property.type === "title" ? record.title : record.values[property.id]; const key = raw === null || raw === undefined || raw === "" ? "" : String(raw).slice(0, 24); bump(key, key || "None"); }
    }
    return [...counts.values()].filter((entry) => entry.n > 0 || (property && SELECTY.has(property.type)));
  }

  chartProperty() {
    return this.prop(this.config.group) || this.props.find((property) => property.type === "status") || this.props.find((property) => property.type === "select") || this.props.find((property) => property.type === "date") || this.titleProp();
  }

  drawChart(kind, buckets, title) {
    const NS = "http://www.w3.org/2000/svg";
    const node = (tag, attrs = {}, ...kids) => { const n = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v); n.append(...kids); return n; };
    const color = (entry, index) => (entry.color && !String(entry.color).includes("--c-gray") ? entry.color : PALETTE[index % PALETTE.length]);
    const total = buckets.reduce((sum, entry) => sum + entry.n, 0);
    const card = el("figure", { class: "db-chart", "aria-label": title });
    card.append(el("figcaption", { class: "db-chart-title", text: title }));
    if (kind === "number") { card.append(el("div", { class: "db-chart-number" }, el("strong", { text: String(total) }), el("span", { text: total === 1 ? "record" : "records" }))); return card; }
    if (!buckets.length || !total) { card.append(el("div", { class: "db-pop-empty", text: "No data to chart yet." })); return card; }
    const max = Math.max(...buckets.map((entry) => entry.n), 1);
    if (kind === "donut") {
      const svg = node("svg", { viewBox: "0 0 160 160", class: "db-chart-svg donut", role: "img" });
      let angle = -Math.PI / 2;
      buckets.forEach((entry, index) => {
        if (!entry.n) return;
        const sweep = (entry.n / total) * Math.PI * 2, r = 64, x1 = 80 + r * Math.cos(angle), y1 = 80 + r * Math.sin(angle), x2 = 80 + r * Math.cos(angle + sweep), y2 = 80 + r * Math.sin(angle + sweep);
        svg.append(node("path", { d: entry.n === total ? `M80 16 A64 64 0 1 1 79.99 16` : `M${x1} ${y1} A${r} ${r} 0 ${sweep > Math.PI ? 1 : 0} 1 ${x2} ${y2}`, fill: "none", stroke: color(entry, index), "stroke-width": "26" }, node("title", {}, `${entry.label}: ${entry.n}`)));
        angle += sweep;
      });
      svg.append(node("text", { x: "80", y: "86", "text-anchor": "middle", class: "db-chart-total" }, String(total)));
      card.append(svg, el("ul", { class: "db-chart-legend" }, buckets.map((entry, index) => el("li", {}, el("i", { style: { background: color(entry, index) } }), `${entry.label} \u00B7 ${entry.n}`))));
      return card;
    }
    if (kind === "hbar") {
      card.append(el("div", { class: "db-hbars" }, buckets.map((entry, index) => el("div", { class: "db-hbar" }, el("span", { class: "db-hbar-label", text: entry.label }), el("span", { class: "db-hbar-track" }, el("i", { style: { width: `${(entry.n / max) * 100}%`, background: color(entry, index) } })), el("span", { class: "db-hbar-n", text: String(entry.n) })))));
      return card;
    }
    const W = 520, H = 220, pad = { l: 28, r: 8, t: 10, b: 38 }, iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;
    const svg = node("svg", { viewBox: `0 0 ${W} ${H}`, class: "db-chart-svg", role: "img" });
    for (let i = 0; i <= 4; i += 1) { const y = pad.t + (ih * i) / 4; svg.append(node("line", { x1: pad.l, x2: W - pad.r, y1: y, y2: y, stroke: "currentColor", "stroke-opacity": ".1" }), node("text", { x: pad.l - 6, y: y + 3, "text-anchor": "end", class: "db-chart-tick" }, String(Math.round(max - (max * i) / 4)))); }
    const step = iw / buckets.length;
    if (kind === "line") {
      const points = buckets.map((entry, index) => [pad.l + step * index + step / 2, pad.t + ih - (entry.n / max) * ih]);
      svg.append(node("polyline", { points: points.map((point) => point.join(",")).join(" "), fill: "none", stroke: PALETTE[0], "stroke-width": "2.5", "stroke-linejoin": "round" }));
      points.forEach(([x, y], index) => svg.append(node("circle", { cx: x, cy: y, r: "4", fill: PALETTE[0] }, node("title", {}, `${buckets[index].label}: ${buckets[index].n}`))));
    } else {
      buckets.forEach((entry, index) => { const h = (entry.n / max) * ih; svg.append(node("rect", { x: pad.l + step * index + step * 0.18, y: pad.t + ih - h, width: step * 0.64, height: Math.max(h, 0), rx: "3", fill: color(entry, index) }, node("title", {}, `${entry.label}: ${entry.n}`))); });
    }
    buckets.forEach((entry, index) => svg.append(node("text", { x: pad.l + step * index + step / 2, y: H - 20, "text-anchor": "middle", class: "db-chart-tick" }, entry.label.length > 10 ? `${entry.label.slice(0, 9)}\u2026` : entry.label)));
    card.append(svg);
    return card;
  }

  chart() {
    const property = this.chartProperty();
    return el("div", { class: "db-chart-wrap" }, this.drawChart(this.config.chart || "vbar", this.buckets(property), `${property?.name || "Records"}`));
  }

  /* A dashboard: a count, then a chart for each select-like property and one over time. */
  dashboard() {
    const grid = el("div", { class: "db-dashboard" });
    grid.append(this.drawChart("number", this.buckets(null), "Total records"));
    const selectish = this.props.filter((property) => SELECTY.has(property.type)).slice(0, 3);
    selectish.forEach((property, index) => grid.append(this.drawChart(index % 2 ? "vbar" : "donut", this.buckets(property), `By ${property.name}`)));
    const when = this.props.find((property) => property.type === "date");
    if (when) grid.append(this.drawChart("line", this.buckets(when), `Over ${when.name}`));
    return grid;
  }

  calendar() {
    const dateProp = this.dateProperty();
    const wrap = el("div", { class: "db-calendar" });
    if (!dateProp) {
      wrap.append(el("div", { class: "db-pop-empty" }, "This calendar needs a Date property. ", el("button", { class: "db-link", type: "button", onclick: async () => { const made = await withError(() => api.post(`/api/notes/databases/${this.db.id}/properties`, { name: "Date", type: "date" }), "Could not add it"); if (made) { this.db.properties.push(made); this.query(); } } }, "Add one")));
      return wrap;
    }
    const year = this.month.getFullYear(), month = this.month.getMonth();
    const first = new Date(year, month, 1);
    const start = new Date(year, month, 1 - first.getDay());
    const byDay = new Map();
    for (const record of this.rows()) { const key = dateKey(record.values[dateProp.id]); if (key) (byDay.get(key) || byDay.set(key, []).get(key)).push(record); }
    const shift = (delta) => { this.month = new Date(year, month + delta, 1); this.paint(); };
    wrap.append(el("div", { class: "db-cal-head" },
      el("strong", { text: first.toLocaleDateString([], { month: "long", year: "numeric" }) }),
      el("span", { class: "db-bar-spacer" }),
      iconButton("chevron_left", "Previous month", () => shift(-1), { size: 15 }),
      el("button", { class: "db-tool", type: "button", onclick: () => { this.month = new Date(); this.paint(); } }, "Today"),
      iconButton("chevron_right", "Next month", () => shift(1), { size: 15 })));
    const grid = el("div", { class: "db-cal-grid" }, ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => el("div", { class: "db-cal-dow", text: day })));
    const todayKey = new Date().toISOString().slice(0, 10);
    for (let index = 0; index < 42; index += 1) {
      const day = new Date(start.getFullYear(), start.getMonth(), start.getDate() + index);
      const key = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
      const cell = el("div", { class: `db-cal-day${day.getMonth() !== month ? " outside" : ""}${key === todayKey ? " today" : ""}` },
        el("span", { class: "db-cal-num", text: String(day.getDate()) }),
        ...(byDay.get(key) || []).map((record) => el("button", { class: "db-cal-item", type: "button", onclick: () => this.open(record) }, titleOf(record))),
        el("button", { class: "db-cal-add", type: "button", "aria-label": `Add on ${key}`, onclick: () => this.newRecord({ [dateProp.id]: { start: key } }) }, icon("plus", 12)));
      grid.append(cell);
    }
    wrap.append(grid);
    return wrap;
  }
}

/* The properties of one record, shown above its page: the same cells the table uses, one to a row. */
export async function recordProperties(page, context) {
  const database = await api.get(`/api/notes/databases/${page.database_id}`).catch(() => null);
  if (!database) return null;
  const records = await api.get(`/api/notes/databases/${page.database_id}/records`).catch(() => []);
  const record = records.find((entry) => entry.id === page.id);
  if (!record) return null;
  const shim = Object.create(DatabaseView.prototype);
  database.views = [{ id: "record", type: "table", config: {} }];
  Object.assign(shim, { db: database, context, viewId: "record", query: async () => {}, paint: () => {} });
  const panel = el("div", { class: "db-record-props" });
  for (const property of database.properties.filter((entry) => entry.type !== "title")) {
    panel.append(el("div", { class: "db-record-row" },
      el("span", { class: "db-record-label" }, icon(TYPE_ICON[property.type] || "text", 14), el("span", { text: property.name })),
      shim.cell(record, property)));
  }
  return panel;
}
