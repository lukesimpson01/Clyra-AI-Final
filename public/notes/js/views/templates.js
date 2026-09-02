/* Templates create ordinary pages — there is no separate template runtime,
   which is why every template inherits the editor's behaviour for free.

   Previews are real screenshots of the page each template builds, captured by
   tools/notes-template-shots.mjs from the same renderer the editor uses. A
   drawn sketch stands in if a shot is missing, so the modal still works on a
   checkout where the images have not been generated. */
import { el, clear, icon, modal, toast, append } from "../dom.js";
import { api } from "../api.js";
import { refreshPages, withError } from "../state.js";
import { TEMPLATES, TEMPLATE_CATEGORIES, templateBlocks } from "../templates-data.js";

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

export function openTemplates(app, parentId) {
  let entry;
  let category = "All";
  let query = "";

  const grid = el("div", { class: "template-grid" });
  const rail = el("div", { class: "template-rail" });
  const search = el("input", { class: "input template-search", placeholder: "Search templates…", type: "search" });

  const use = async (template) => {
    entry.close("used");
    const created = await withError(
      () => api.post("/api/notes/pages", {
        parentId: parentId || null,
        title: template.id === "blank" ? "" : template.name,
        blocks: templateBlocks(template),
      }),
      "Could not create the page",
    );
    if (!created) return;
    await refreshPages();
    app.openPage(created.id);
    toast(template.id === "blank" ? "New page created" : `${template.name} created`);
  };

  const paintRail = () => {
    clear(rail);
    for (const name of ["All", ...TEMPLATE_CATEGORIES]) {
      const count = name === "All" ? TEMPLATES.length : TEMPLATES.filter((t) => t.category === name).length;
      rail.append(el("button", {
        class: `template-tab${category === name ? " active" : ""}`, type: "button",
        onclick: () => { category = name; paintRail(); paintGrid(); },
      }, el("span", { text: name }), el("span", { class: "template-count", text: String(count) })));
    }
  };

  const paintGrid = () => {
    clear(grid);
    const needle = query.trim().toLowerCase();
    const list = TEMPLATES.filter((template) =>
      (category === "All" || template.category === category) &&
      (!needle || template.name.toLowerCase().includes(needle) || template.desc.toLowerCase().includes(needle)));
    if (!list.length) {
      grid.append(el("div", { class: "template-empty", text: `No templates match "${query}"` }));
      return;
    }
    list.forEach((template, index) => {
      const card = el("button", {
        class: "template-card", type: "button",
        style: { animationDelay: `${Math.min(index, 8) * 18}ms`, "--tpl-accent": template.accent || "var(--accent)" },
        onclick: () => use(template),
      },
        templatePreview(template),
        el("div", { class: "template-meta" },
          el("span", { class: "template-icon" }, icon(template.icon, 15)),
          el("span", { class: "template-text" },
            el("span", { class: "template-name", text: template.name }),
            el("span", { class: "template-desc", text: template.desc }))),
      );
      grid.append(card);
    });
  };

  search.addEventListener("input", () => { query = search.value; paintGrid(); });

  entry = modal({
    title: "Templates",
    width: 920,
    className: "template-modal",
    body: el("div", { class: "template-layout" },
      el("aside", { class: "template-side" }, search, rail),
      el("div", { class: "template-main scroll" }, grid)),
  });
  paintRail();
  paintGrid();
  queueMicrotask(() => search.focus());
  return entry;
}
