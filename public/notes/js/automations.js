/* Database automations, as in Notion: "When a page is added" or "When Status
   changes to Done", then set properties or send yourself a notification.
   Rules are saved with the database and run on the server whenever a record
   changes, so they work from any view, from the AI and from forms alike. */
import { el, icon, modal, toast, clear } from "./dom.js";
import { api } from "./api.js";
import { withError } from "./state.js";

const SETTABLE = new Set(["text", "number", "select", "multi_select", "status", "date", "checkbox", "url", "email", "phone", "person"]);
const optionsOf = (property) => (Array.isArray(property?.config?.options) ? property.config.options : []);
const newRule = () => ({ id: `r${Date.now().toString(36)}`, name: "New automation", enabled: true, trigger: { type: "changed", property: "", to: "" }, actions: [{ type: "notify", text: "" }] });

/* A value picker that fits the property: options for selects, a switch for checkboxes, "Now" for dates. */
function valueField(property, value, onChange, { anyLabel = null } = {}) {
  if (!property) return el("span", { class: "auto-muted", text: "—" });
  if (["select", "status", "multi_select"].includes(property.type)) {
    const select = el("select", { class: "auto-input", onchange: (event) => onChange(event.target.value) },
      anyLabel ? el("option", { value: "", text: anyLabel, selected: !value }) : null,
      optionsOf(property).map((option) => el("option", { value: option.id, text: option.name, selected: String(value) === String(option.id) })));
    return select;
  }
  if (property.type === "checkbox") {
    return el("select", { class: "auto-input", onchange: (event) => onChange(event.target.value === "" ? "" : event.target.value === "true") },
      anyLabel ? el("option", { value: "", text: anyLabel, selected: value === "" || value === undefined }) : null,
      el("option", { value: "true", text: "Checked", selected: value === true }),
      el("option", { value: "false", text: "Unchecked", selected: value === false }));
  }
  if (property.type === "date") {
    return el("select", { class: "auto-input", onchange: (event) => onChange(event.target.value) },
      anyLabel ? el("option", { value: "", text: anyLabel, selected: !value }) : null,
      el("option", { value: "@now", text: "Now (today's date)", selected: value === "@now" || !anyLabel }));
  }
  return el("input", { class: "auto-input", type: property.type === "number" ? "number" : "text", value: value ?? "", placeholder: anyLabel || "Value",
    oninput: (event) => onChange(property.type === "number" ? Number(event.target.value) : event.target.value) });
}

export async function openAutomations(database) {
  let rules = (await withError(() => api.get(`/api/notes/databases/${database.id}/automations`), "Could not load automations")) || [];
  const properties = database.properties;
  const byId = (id) => properties.find((property) => property.id === id);
  const list = el("div", { class: "auto-list" });
  let dirty = false;

  const save = async () => {
    const result = await withError(() => api.put(`/api/notes/databases/${database.id}/automations`, { automations: rules }), "Could not save automations");
    if (result?.ok) { rules = result.automations; dirty = false; toast("Automations saved"); paint(); }
  };
  const touch = () => { dirty = true; saveButton.disabled = false; };

  const ruleCard = (rule) => {
    const trigger = rule.trigger;
    const triggerProperty = trigger.type === "changed" ? byId(trigger.property) : null;
    const actions = el("div", { class: "auto-actions" }, rule.actions.map((action, index) => {
      const remove = el("button", { class: "auto-icon", type: "button", "aria-label": "Remove action", onclick: () => { rule.actions.splice(index, 1); touch(); paint(); } }, icon("close", 12));
      if (action.type === "notify") {
        return el("div", { class: "auto-line" }, el("span", { class: "auto-word", text: "Notify me" }),
          el("input", { class: "auto-input wide", value: action.text, placeholder: "Message (optional)", oninput: (event) => { action.text = event.target.value; touch(); } }), remove);
      }
      const property = byId(action.property);
      return el("div", { class: "auto-line" }, el("span", { class: "auto-word", text: "Set" }),
        el("select", { class: "auto-input", onchange: (event) => { action.property = event.target.value; action.value = ""; touch(); paint(); } },
          el("option", { value: "", text: "Choose a property", selected: !action.property }),
          properties.filter((p) => SETTABLE.has(p.type)).map((p) => el("option", { value: p.id, text: p.name, selected: p.id === action.property }))),
        el("span", { class: "auto-word", text: "to" }),
        valueField(property, action.value, (value) => { action.value = value; touch(); }), remove);
    }));
    return el("section", { class: `auto-rule${rule.enabled ? "" : " is-off"}` },
      el("header", { class: "auto-head" },
        el("input", { class: "auto-name", value: rule.name, "aria-label": "Automation name", oninput: (event) => { rule.name = event.target.value; touch(); } }),
        el("label", { class: "auto-switch" }, el("input", { type: "checkbox", checked: rule.enabled, onchange: (event) => { rule.enabled = event.target.checked; touch(); paint(); } }), el("span", { text: rule.enabled ? "On" : "Off" })),
        el("button", { class: "auto-icon", type: "button", "aria-label": "Delete automation", onclick: () => { rules = rules.filter((r) => r !== rule); touch(); paint(); } }, icon("trash", 13))),
      el("div", { class: "auto-line" }, el("span", { class: "auto-word strong", text: "When" }),
        el("select", { class: "auto-input", onchange: (event) => { const value = event.target.value; rule.trigger = value === "@added" ? { type: "added" } : { type: "changed", property: value, to: "" }; touch(); paint(); } },
          el("option", { value: "@added", text: "A page is added", selected: trigger.type === "added" }),
          properties.filter((p) => SETTABLE.has(p.type) || p.type === "title").map((p) => el("option", { value: p.id, text: `${p.name} changes`, selected: trigger.type === "changed" && trigger.property === p.id }))),
        trigger.type === "changed" && triggerProperty && triggerProperty.type !== "title" ? el("span", { class: "auto-word", text: "to" }) : null,
        trigger.type === "changed" && triggerProperty && triggerProperty.type !== "title" ? valueField(triggerProperty, trigger.to, (value) => { trigger.to = value; touch(); }, { anyLabel: "Any value" }) : null),
      el("div", { class: "auto-line" }, el("span", { class: "auto-word strong", text: "Then" })),
      actions,
      el("div", { class: "auto-add" },
        el("button", { class: "auto-link", type: "button", onclick: () => { rule.actions.push({ type: "set", property: "", value: "" }); touch(); paint(); } }, icon("plus", 12), "Set a property"),
        el("button", { class: "auto-link", type: "button", onclick: () => { rule.actions.push({ type: "notify", text: "" }); touch(); paint(); } }, icon("plus", 12), "Send a notification")));
  };

  const paint = () => {
    clear(list);
    if (!rules.length) list.append(el("p", { class: "auto-empty", text: "No automations yet. Add one to update pages or notify you when something changes." }));
    rules.forEach((rule) => list.append(ruleCard(rule)));
  };
  const saveButton = el("button", { class: "button primary", type: "button", disabled: true, onclick: save }, "Save");
  const entry = modal({
    title: `Automations · ${database.name}`, width: 640, className: "auto-modal",
    body: el("div", { class: "auto-body" }, list,
      el("button", { class: "auto-new", type: "button", onclick: () => { const rule = newRule(); rule.trigger.property = properties.find((p) => p.type === "status" || p.type === "select")?.id || ""; rules.push(rule); touch(); paint(); } }, icon("plus", 14), "New automation")),
    footer: el("div", { class: "auto-foot" }, el("span", { class: "auto-muted", text: "Automations run whenever a page in this database changes." }), saveButton),
    onClose: () => { if (dirty) toast("Unsaved automation changes were discarded"); },
  });
  paint();
  return entry;
}
