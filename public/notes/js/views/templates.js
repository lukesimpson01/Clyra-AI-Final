/* Templates create ordinary pages — there is no separate template runtime,
   which is why every template inherits the editor's behaviour for free.

   Previews are real screenshots of the page each template builds, captured by
   tools/notes-template-shots.mjs from the same renderer the editor uses. A
   drawn sketch stands in if a shot is missing, so the modal still works on a
   checkout where the images have not been generated. */
import { el, clear, icon, modal, toast, append } from "../dom.js";
import { api } from "../api.js";
import { refreshPages, withError } from "../state.js";
import { TEMPLATES, TEMPLATE_CATEGORIES, TEMPLATE_GROUPS, templateGroup, templateBlocks } from "../templates-data.js";

export { TEMPLATES, TEMPLATE_CATEGORIES };

const shotUrl = (template, theme) => `/notes/img/templates/${template.id}${theme === "dark" ? "-dark" : ""}.png`;

/* Draws a template as a miniature page. Only used when a screenshot has not
   been generated; it reads the same block tree the template inserts, so the
   sketch cannot describe a page the template does not build. */
function templateSketch(template) {
  const sheet = el("div", { class: "tpl-sheet" });
  sheet.append(el("div", { class: "tpl-title" }));
  const draw = (blocks, depth = 0) => {
    for (const block of blocks) {
      if (sheet.childElementCount > 15) return;
      if (["h1", "h2", "h3"].includes(block.type)) sheet.append(el("div", { class: `tpl-h ${block.type}` }));
      else if (block.type === "table") {
        const rows = block.props?.rows || [];
        const columns = Math.max(2, rows[0]?.length || 2);
        const grid = el("div", { class: "tpl-table", style: { gridTemplateColumns: `repeat(${columns}, 1fr)` } });
        for (let index = 0; index < columns * Math.min(3, Math.max(2, rows.length)); index += 1) {
          grid.append(el("div", { class: `tpl-cell${index < columns ? " head" : ""}` }));
        }
        sheet.append(grid);
      } else if (block.type === "callout") {
        sheet.append(el("div", { class: "tpl-callout" }, el("div", { class: "tpl-callout-dot" }), el("div", { class: "tpl-line w80" })));
      } else if (block.type === "todo" || block.type === "exam_checklist") {
        sheet.append(el("div", { class: "tpl-row" }, el("div", { class: "tpl-check" }), el("div", { class: "tpl-line w70" })));
      } else if (["bulleted", "numbered", "toggle"].includes(block.type)) {
        sheet.append(el("div", { class: "tpl-row" },
          el("div", { class: `tpl-marker${block.type === "numbered" ? " num" : ""}` }),
          el("div", { class: "tpl-line w60" })));
      } else if (["quote", "study_summary", "objective"].includes(block.type)) {
        sheet.append(el("div", { class: "tpl-quote" }, el("div", { class: "tpl-line w75" })));
      } else if (block.type === "divider") sheet.append(el("div", { class: "tpl-divider" }));
      else sheet.append(el("div", { class: "tpl-line w85" }));
      if (block.children?.length && depth < 1) draw(block.children, depth + 1);
    }
  };
  draw(template.blocks());
  if (sheet.childElementCount === 1) sheet.append(el("div", { class: "tpl-empty-hint" }));
  return sheet;
}

export function templatePreview(template) {
  const canvas = el("div", {
    class: "tpl-preview", "aria-hidden": "true",
    style: { "--tpl-accent": template.accent || "var(--accent)" },
  });
  const light = el("img", { class: "tpl-shot light", src: shotUrl(template, "light"), alt: "", loading: "lazy", decoding: "async" });
  const dark = el("img", { class: "tpl-shot dark", src: shotUrl(template, "dark"), alt: "", loading: "lazy", decoding: "async" });
  /* One missing shot retires both, so a half-generated set can never show a
     light screenshot inside a dark card. */
  const fallback = () => {
    if (canvas.classList.contains("sketching")) return;
    canvas.classList.add("sketching");
    light.remove();
    dark.remove();
    canvas.append(templateSketch(template));
  };
  light.addEventListener("error", fallback);
  dark.addEventListener("error", fallback);
  append(canvas, light, dark);
  return canvas;
}

/* Notion's Marketplace, in our own words: Discover, then Work, Life and School. A card is one click: it makes the page and opens it. */
const FEATURES = {
  School: { eyebrow: "School", title: "Finals season", text: "Notes, planners and revision pages to study smarter and stay organised.", ids: ["cornell", "student-dashboard", "revision"], tint: "#f4f0f7" },
  Work: { eyebrow: "Work", title: "Run the week", text: "Meetings, projects and trackers for the work your team does every day.", ids: ["meeting", "project", "task-tracker"], tint: "#e7f3f8" },
  Life: { eyebrow: "Life", title: "Organise your life", text: "Habits, money, reading and plans without starting from a blank page.", ids: ["habit-tracker", "budget", "reading-list"], tint: "#edf3ec" },
};
const SECTIONS = [
  ["School", "Student life", "Class notes, study guides, planners and trackers for school."],
  ["Work", "Work essentials", "Tools that work with your team."],
  ["Life", "Organise your life", "Goals, habits, trips and the rest."],
];

export function openTemplates(app, parentId) {
  let entry;
  let tab = "Discover";
  let query = "";
  const busy = new Set();
  const main = el("div", { class: "nm-main scroll" });
  const tabs = el("div", { class: "nm-tabs", role: "tablist" });
  const search = el("input", { class: "nm-search", placeholder: "Search templates", type: "search", "aria-label": "Search templates" });

  const use = async (template) => {
    if (busy.has(template.id)) return;
    busy.add(template.id);
    const created = await withError(
      () => api.post("/api/notes/pages", {
        parentId: parentId || null,
        title: template.id === "blank" ? "" : template.name,
        icon: template.id === "blank" ? undefined : template.emoji,
        cover: template.cover || undefined,
        blocks: templateBlocks(template),
      }),
      "Could not create the page",
    );
    busy.delete(template.id);
    if (!created) return;
    await refreshPages();
    entry.close("used");
    app.openPage(created.id);
    toast(template.id === "blank" ? "New page ready" : `${template.name} is ready`);
  };

  const card = (template, index) => el("button", {
    class: "nm-card", type: "button", "aria-label": `Use ${template.name}`,
    style: { animationDelay: `${Math.min(index, 8) * 24}ms` },
    onclick: () => use(template),
  },
    el("span", { class: "nm-art" }, templatePreview(template), el("span", { class: "nm-use", text: "Use template" })),
    el("span", { class: "nm-meta" },
      el("span", { class: "nm-name" }, el("span", { class: "nm-emoji", text: template.emoji || "" }), template.name),
      el("span", { class: "nm-desc", text: template.desc })));

  const feature = (group) => {
    const spec = FEATURES[group];
    const first = spec.ids.map((id) => TEMPLATES.find((t) => t.id === id)).find(Boolean);
    return el("section", { class: "nm-feature", style: { "--nm-tint": spec.tint } },
      el("span", { class: "nm-eyebrow", text: spec.eyebrow }),
      el("h3", { class: "nm-feature-title", text: spec.title }),
      el("p", { class: "nm-feature-text", text: spec.text }),
      el("div", { class: "nm-feature-list" }, spec.ids.map((id) => TEMPLATES.find((t) => t.id === id)).filter(Boolean).map((t) =>
        el("button", { class: "nm-pill", type: "button", onclick: () => use(t) }, el("span", { text: t.emoji || "" }), t.name))),
      first ? el("button", { class: "nm-explore", type: "button", onclick: () => { tab = group; paintTabs(); paint(); } }, `Explore ${group}`) : null);
  };

  const row = (title, text, list, group) => el("section", { class: "nm-section" },
    el("div", { class: "nm-section-head" },
      el("div", {}, el("h4", { class: "nm-section-title", text: title }), el("p", { class: "nm-section-text", text })),
      el("button", { class: "nm-see-all", type: "button", text: "See all", onclick: () => { tab = group; paintTabs(); paint(); } })),
    el("div", { class: "nm-row" }, list.slice(0, 4).map((t, i) => card(t, i))));

  const paintTabs = () => {
    clear(tabs);
    for (const name of ["Discover", ...TEMPLATE_GROUPS]) {
      tabs.append(el("button", {
        class: `nm-tab${tab === name ? " active" : ""}`, type: "button", role: "tab", "aria-selected": tab === name ? "true" : "false",
        onclick: () => { tab = name; query = ""; search.value = ""; paintTabs(); paint(); },
      }, name));
    }
  };

  const paint = () => {
    clear(main);
    main.scrollTop = 0;
    const needle = query.trim().toLowerCase();
    const matches = (t) => !needle || `${t.name} ${t.desc} ${t.category}`.toLowerCase().includes(needle);
    if (tab === "Discover" && !needle) {
      main.append(el("h2", { class: "nm-heading", text: "Get started faster with templates" }),
        el("div", { class: "nm-features" }, TEMPLATE_GROUPS.map((group) => feature(group))));
      const blank = TEMPLATES.find((t) => t.id === "blank");
      for (const [group, title, text] of SECTIONS) {
        const list = TEMPLATES.filter((t) => t.id !== "blank" && templateGroup(t) === group);
        if (list.length) main.append(row(title, text, list, group));
      }
      if (blank) main.append(el("div", { class: "nm-blank" }, el("button", { class: "nm-blank-btn", type: "button", onclick: () => use(blank) }, icon("page", 16), "Start with a blank page")));
      return;
    }
    const list = TEMPLATES.filter((t) => t.id !== "blank" && (tab === "Discover" || templateGroup(t) === tab) && matches(t));
    main.append(el("h2", { class: "nm-heading", text: needle ? `Results for “${query}”` : tab }));
    if (!list.length) { main.append(el("div", { class: "template-empty", text: `No templates match “${query}”` })); return; }
    const grid = el("div", { class: "nm-grid" });
    list.forEach((t, i) => grid.append(card(t, i)));
    main.append(grid);
  };

  search.addEventListener("input", () => { query = search.value; paint(); });
  entry = modal({
    title: "Templates",
    width: 1120,
    className: "template-modal notion-gallery",
    body: el("div", { class: "nm-layout" }, el("div", { class: "nm-top" }, tabs, search), main),
  });
  paintTabs();
  paint();
  queueMicrotask(() => search.focus());
  return entry;
}
