/* Templates create ordinary pages — there is no separate template runtime,
   which is why every template inherits the editor's behaviour for free.

   Previews are real screenshots of the page each template builds, captured by
   tools/notes-template-shots.mjs from the same renderer the editor uses. A
   drawn sketch stands in if a shot is missing, so the modal still works on a
   checkout where the images have not been generated. */
import { el, clear, icon, modal, toast, append } from "../dom.js";
import { api } from "../api.js";
import { refreshPages, withError } from "../state.js";
import { createFromTemplate } from "../database.js";
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

const CATEGORY_ICONS = { All: "sparkle", Notes: "page", Study: "book", Work: "template", Planning: "calendar", Writing: "pencil", Research: "search", Money: "bookmark", Personal: "star" };

/* App Store style "Get" control: a pill that collapses into a progress ring while the page is created, then
   reopens as "Open". Clicking Open takes the reader to the new page. */
function getButton(template, state, onGet, onOpen, { large = false } = {}) {
  const button = el("button", { class: `as-get${large ? " large" : ""}`, type: "button", "aria-label": `Get ${template.name}` });
  const label = el("span", { class: "as-get-label", text: "Get" });
  const ring = el("span", { class: "as-ring", "aria-hidden": "true" });
  ring.innerHTML = '<svg viewBox="0 0 28 28"><circle class="as-ring-track" cx="14" cy="14" r="11.5"/><circle class="as-ring-fill" cx="14" cy="14" r="11.5"/></svg><i class="as-ring-stop"></i>';
  append(button, label, ring);
  const paint = () => {
    const created = state.created.get(template.id);
    button.classList.toggle("is-busy", state.busy.has(template.id));
    button.classList.toggle("is-open", Boolean(created));
    label.textContent = created ? "Open" : "Get";
    button.setAttribute("aria-label", `${created ? "Open" : "Get"} ${template.name}`);
  };
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    if (state.busy.has(template.id)) return;
    if (state.created.get(template.id)) onOpen(template);
    else onGet(template);
  });
  state.paints.add(paint);
  paint();
  return button;
}

function appIcon(template, size = 44) {
  return el("span", {
    class: "as-icon", "aria-hidden": "true",
    style: { width: `${size}px`, height: `${size}px`, "--tpl-accent": template.accent || "#2383e2" },
  }, template.emoji
    ? el("span", { class: "as-emoji", style: { fontSize: `${Math.round(size * 0.52)}px` }, text: template.emoji })
    : icon(template.icon || "page", Math.round(size * 0.46)));
}

/* The gallery as a page of the workspace, where notes are shown, rather than a pop-up over one. */
export function renderTemplatesView(host, app, parentId) {
  return openTemplates(app, parentId, { host });
}

export function openTemplates(app, parentId, { host = null } = {}) {
  let entry;
  let category = "All";
  let query = "";
  const state = { busy: new Set(), created: new Map(), paints: new Set() };
  const repaintButtons = () => state.paints.forEach((paint) => paint());

  const main = el("div", { class: "template-main as-main scroll" });
  const rail = el("div", { class: "template-rail as-rail" });
  const search = el("input", { class: "input template-search as-search", placeholder: "Search", type: "search", "aria-label": "Search templates" });

  const create = async (template) => {
    state.busy.add(template.id);
    repaintButtons();
    const started = Date.now();
    if (template.databases?.length) {
      /* some of these pages hold databases: they are made inside the page and shown in place */
      const made = await createFromTemplate(app, template, parentId || null, { open: false });
      await new Promise((resolve) => setTimeout(resolve, Math.max(0, 900 - (Date.now() - started))));
      state.busy.delete(template.id);
      if (made) { state.created.set(template.id, made.pageId); await refreshPages(); toast(`${template.name} is ready`); }
      repaintButtons();
      return;
    }
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
    // Let the ring complete one honest sweep, the way an App Store download settles before it reads Open.
    await new Promise((resolve) => setTimeout(resolve, Math.max(0, 900 - (Date.now() - started))));
    state.busy.delete(template.id);
    if (created) {
      state.created.set(template.id, created.id);
      await refreshPages();
      toast(template.id === "blank" ? "New page ready" : `${template.name} is ready`);
    }
    repaintButtons();
  };
  const open = (template) => {
    const id = state.created.get(template.id);
    if (!id) return;
    entry.close("used");
    app.openPage(id);
  };

  const card = (template, index, { wide = false } = {}) => {
    const node = el("div", {
      class: `as-card${wide ? " wide" : ""}`, role: "button", tabindex: "0",
      style: { animationDelay: `${Math.min(index, 10) * 22}ms`, "--tpl-accent": template.accent || "var(--accent)" },
      onclick: () => (state.created.get(template.id) ? open(template) : create(template)),
      onkeydown: (event) => { if (event.key === "Enter") { event.preventDefault(); node.click(); } },
    },
      el("div", { class: "as-art" }, templatePreview(template)),
      el("div", { class: "as-lockup" },
        appIcon(template, 40),
        el("span", { class: "as-text" },
          el("span", { class: "as-name", text: template.name }),
          el("span", { class: "as-sub", text: template.desc })),
        getButton(template, state, create, open)),
    );
    return node;
  };

  const hero = (template) => el("section", { class: "as-hero", style: { "--tpl-accent": template.accent || "var(--accent)" } },
    el("div", { class: "as-hero-text" },
      el("span", { class: "as-eyebrow", text: `Featured · ${template.category}` }),
      el("h3", { class: "as-hero-title", text: template.name }),
      el("p", { class: "as-hero-desc", text: template.desc }),
      el("div", { class: "as-hero-lockup" },
        appIcon(template, 46),
        el("span", { class: "as-text" },
          el("span", { class: "as-name", text: template.name }),
          el("span", { class: "as-sub", text: `${template.category} template` })),
        getButton(template, state, create, open, { large: true }))),
    el("div", { class: "as-hero-art" }, templatePreview(template)));

  const shelf = (title, list) => {
    const row = el("div", { class: "as-shelf-row" });
    list.forEach((template, index) => row.append(card(template, index, { wide: true })));
    return el("section", { class: "as-shelf" },
      el("div", { class: "as-shelf-head" },
        el("h4", { class: "as-shelf-title", text: title }),
        el("button", { class: "as-see-all", type: "button", text: "See All", onclick: () => { category = title; paintRail(); paint(); } })),
      row);
  };

  const paintRail = () => {
    clear(rail);
    for (const name of ["All", ...TEMPLATE_CATEGORIES]) {
      rail.append(el("button", {
        class: `as-tab${category === name ? " active" : ""}`, type: "button",
        onclick: () => { category = name; paintRail(); paint(); },
      }, el("span", { class: "as-tab-icon" }, icon(CATEGORY_ICONS[name] || "page", 15)), el("span", { text: name === "All" ? "Discover" : name })));
    }
  };

  const paint = () => {
    state.paints.clear();
    clear(main);
    main.scrollTop = 0;
    const needle = query.trim().toLowerCase();
    if (category === "All" && !needle) {
      main.append(el("h2", { class: "as-page-title", text: "Discover" }));
      const featured = TEMPLATES.find((t) => t.id !== "blank" && t.category === "Study") || TEMPLATES[1] || TEMPLATES[0];
      if (featured) main.append(hero(featured));
      for (const name of TEMPLATE_CATEGORIES) {
        const list = TEMPLATES.filter((t) => t.category === name);
        if (list.length) main.append(shelf(name, list));
      }
      return;
    }
    const list = TEMPLATES.filter((template) =>
      (category === "All" || template.category === category) &&
      (!needle || template.name.toLowerCase().includes(needle) || template.desc.toLowerCase().includes(needle)));
    main.append(el("h2", { class: "as-page-title", text: needle ? "Results" : category }));
    if (!list.length) {
      main.append(el("div", { class: "template-empty", text: `No templates match "${query}"` }));
      return;
    }
    const grid = el("div", { class: "as-grid" });
    list.forEach((template, index) => grid.append(card(template, index)));
    main.append(grid);
  };

  search.addEventListener("input", () => { query = search.value; paint(); });

  const layout = el("div", { class: "template-layout as-layout" }, el("aside", { class: "template-side as-side" }, search, rail), main);
  if (host) {
    /* in the workspace: the same page, filling the area, with nothing to close */
    entry = { close() {} };
    host.append(el("div", { class: "template-modal appstore as-view" }, layout));
  } else {
    entry = modal({ title: "Templates", width: 1120, className: "template-modal appstore", body: layout });
  }
  paintRail();
  paint();
  queueMicrotask(() => search.focus());
  return entry;
}
