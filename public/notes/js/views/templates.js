/* Templates create ordinary pages — there is no separate template runtime,
   which is why every template inherits the editor's behaviour for free.

   Previews are real screenshots of the page each template builds, captured by
   tools/notes-template-shots.mjs from the same renderer the editor uses. */
import { el, clear, icon, modal, toast, append } from "../dom.js";
import { api } from "../api.js";
import { refreshPages, withError } from "../state.js";
import { createFromTemplate } from "../database.js";
import { TEMPLATES, TEMPLATE_CATEGORIES, templateBlocks } from "../templates-data.js";

export { TEMPLATES, TEMPLATE_CATEGORIES };

const shotUrl = (template, theme, view = "") => `/notes/img/templates/${template.id}${view}${theme === "dark" ? "-dark" : ""}.png`;

export function templatePreview(template) {
  const canvas = el("div", {
    class: "tpl-preview", "aria-hidden": "true",
    style: { "--tpl-accent": template.accent || "var(--accent)" },
  });
  const light = el("img", { class: "tpl-shot light", src: shotUrl(template, "light"), alt: "", loading: "lazy", decoding: "async" });
  const dark = el("img", { class: "tpl-shot dark", src: shotUrl(template, "dark"), alt: "", loading: "lazy", decoding: "async" });
  /* Never substitute a made-up miniature for a missing capture. A missing
     capture stays obvious and is caught by the screenshot verification job. */
  const missing = () => canvas.classList.add("missing-shot");
  light.addEventListener("error", missing);
  dark.addEventListener("error", missing);
  append(canvas, light, dark);
  return canvas;
}

const CATEGORY_ICONS = {
  All: "sparkle",
  "Study & Education": "book",
  "Planning & Productivity": "calendar",
  "Work & Business": "template",
  "Life & Finance": "bookmark",
  "Dashboards & Knowledge": "page",
  "Résumés & Cover Letters": "page",
  "Official Documents": "template",
};

/* Built-in templates are intentionally recognisable at a glance. These are
   app icons, not decorative cover banners, so they remain quiet beside real
   screenshots and retain their meaning in compact lists. */
const CATEGORY_EMOJI = {
  "Study & Education": "📘",
  "Planning & Productivity": "🗓️",
  "Work & Business": "💼",
  "Life & Finance": "🔖",
  "Dashboards & Knowledge": "🧠",
  "Résumés & Cover Letters": "📄",
  "Official Documents": "📑",
};

/* The gallery should help a person understand the actual working surface
   before they create it. These labels are derived from the template's real
   editable blocks and database views — never from a decorative mockup. */
function templateSignals(template, limit = 4) {
  const types = new Set();
  const walk = (blocks = []) => blocks.forEach((block) => {
    types.add(block.type);
    walk(block.children || []);
  });
  walk(template.blocks?.() || []);
  const databases = template.databases || [];
  const viewTypes = new Set(databases.flatMap((database) => (database.views || []).map((view) => view.type)));
  const relations = databases.flatMap((database) => database.properties || []).some((property) => property.type === "relation");
  const signals = [];
  if (databases.length) signals.push({ icon: "table", label: `${databases.length} ${databases.length === 1 ? "database" : "databases"}` });
  if (relations) signals.push({ icon: "link", label: "Linked records" });
  if (viewTypes.has("board")) signals.push({ icon: "template", label: "Board view" });
  if (viewTypes.has("calendar")) signals.push({ icon: "calendar", label: "Calendar view" });
  if (viewTypes.has("timeline")) signals.push({ icon: "timeline", label: "Timeline" });
  if (viewTypes.has("gallery")) signals.push({ icon: "cards", label: "Gallery view" });
  if (types.has("todo")) signals.push({ icon: "check_square", label: "Checklist" });
  if (types.has("table")) signals.push({ icon: "table", label: "Editable table" });
  if (types.has("columns")) signals.push({ icon: "template", label: "Structured layout" });
  if (types.has("toggle")) signals.push({ icon: "chevron_right", label: "Folded guidance" });
  if (types.has("callout")) signals.push({ icon: "callout", label: "Quick guidance" });
  if (types.has("h2")) signals.push({ icon: "list", label: "Guided sections" });
  return signals.slice(0, limit);
}

function signalRow(template, className = "") {
  const signals = templateSignals(template);
  if (!signals.length) return null;
  return el("div", { class: `as-signals ${className}`.trim(), "aria-label": "Template contents" },
    signals.map(({ icon: glyph, label }) => el("span", { class: "as-signal" }, icon(glyph, 12), el("span", { text: label }))));
}

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
  }, el("span", { class: "as-emoji", style: { fontSize: `${Math.round(size * 0.52)}px` }, text: template.emoji || CATEGORY_EMOJI[template.category] || "📝" }));
}

/* The gallery as a page of the workspace, where notes are shown, rather than a pop-up over one. */
export function renderTemplatesView(host, app, parentId) {
  return openTemplates(app, parentId, { host });
}

export function openTemplates(app, parentId, { host = null } = {}) {
  let entry;
  let category = "All";
  let query = "";
  let detail = null;
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
      let made = null;
      try {
        made = await createFromTemplate(app, template, parentId || null, { open: false });
      } catch (error) {
        console.error("Template creation failed", error);
      }
      await new Promise((resolve) => setTimeout(resolve, Math.max(0, 900 - (Date.now() - started))));
      state.busy.delete(template.id);
      if (made) { state.created.set(template.id, made.pageId); await refreshPages(); toast(`${template.name} is ready`); }
      else toast(`Could not create ${template.name}. Nothing was added.`);
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

  /* This is a read-only, rendered capture from the same page renderer used
     to create the template. It gives the person a proper look before Get,
     without accidentally creating a mutable note. */
  const preview = (template) => {
    const image = el("img", { class: "as-live-preview-shot", src: shotUrl(template, "light"), alt: `${template.name} template preview` });
    modal({
      title: `${template.name} preview`, width: 1600, className: "as-live-preview-modal fullscreen-modal",
      body: el("div", { class: "as-live-preview" }, image, el("p", { class: "as-live-preview-note", text: "Preview only — choose Get to create an editable copy in your workspace." })),
    });
  };

  const showDetail = (template) => { detail = template; paint(); };

  const detailScreen = (template) => {
    const back = el("button", { class: "as-detail-back", type: "button", onclick: () => { detail = null; paint(); } }, icon("chevron_left", 15), "Back");
    const slides = [
      ["Overview", "The opening view", ""],
      ["Details", "The next section of this real page", "-detail"],
      ["Workflow", "The working area further down the same page", "-workflow"],
    ];
    const shots = el("div", { class: "as-detail-gallery", "aria-label": `${template.name} previews` });
    const track = el("div", { class: "as-detail-shots", role: "region", tabindex: "0", "aria-label": "Template preview carousel" });
    const figures = slides.map(([label, note, view]) => el("figure", { class: "as-detail-shot" },
      (() => {
        const canvas = el("div", { class: "tpl-preview", "aria-hidden": "true" });
        canvas.append(
          el("img", { class: "tpl-shot light", src: shotUrl(template, "light", view), alt: "", decoding: "async" }),
          el("img", { class: "tpl-shot dark", src: shotUrl(template, "dark", view), alt: "", decoding: "async" }),
        );
        return canvas;
      })(),
      el("figcaption", {}, el("strong", { text: label }), el("span", { text: note }))
    ));
    figures.forEach((figure) => track.append(figure));
    let activeSlide = 0;
    let previousArrow = null;
    let nextArrow = null;
    let dots = [];
    const setActive = (next, { move = false } = {}) => {
      activeSlide = Math.max(0, Math.min(figures.length - 1, next));
      figures.forEach((figure, position) => figure.classList.toggle("is-active", position === activeSlide));
      if (previousArrow) previousArrow.hidden = activeSlide === 0;
      if (nextArrow) nextArrow.hidden = activeSlide === figures.length - 1;
      dots.forEach((dot, position) => {
        const current = position === activeSlide;
        dot.classList.toggle("is-active", current);
        dot.setAttribute("aria-current", current ? "true" : "false");
      });
      if (move) figures[activeSlide]?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
    };
    nextArrow = el("button", { class: "as-gallery-arrow as-gallery-next", type: "button", "aria-label": "Next preview", onclick: () => setActive(activeSlide + 1, { move: true }) }, icon("chevron_right", 17));
    previousArrow = el("button", { class: "as-gallery-arrow as-gallery-prev", type: "button", "aria-label": "Previous preview", onclick: () => setActive(activeSlide - 1, { move: true }) }, icon("chevron_left", 17));
    const dotRow = el("div", { class: "as-gallery-dots", role: "tablist", "aria-label": "Preview position" });
    dots = figures.map((_, position) => el("button", {
      class: "as-gallery-dot", type: "button", role: "tab",
      "aria-label": `Show preview ${position + 1} of ${figures.length}`,
      onclick: () => setActive(position, { move: true }),
    }));
    dots.forEach((dot) => dotRow.append(dot));
    track.addEventListener("scroll", () => {
      const centre = track.getBoundingClientRect().left + track.clientWidth / 2;
      let nearest = 0; let distance = Infinity;
      figures.forEach((figure, position) => { const box = figure.getBoundingClientRect(); const delta = Math.abs(box.left + box.width / 2 - centre); if (delta < distance) { nearest = position; distance = delta; } });
      setActive(nearest);
    }, { passive: true });
    track.addEventListener("keydown", (event) => {
      if (event.key === "ArrowRight") { event.preventDefault(); setActive(activeSlide + 1, { move: true }); }
      if (event.key === "ArrowLeft") { event.preventDefault(); setActive(activeSlide - 1, { move: true }); }
    });
    setActive(0);
    shots.append(track, previousArrow, nextArrow, dotRow);
    return el("article", { class: "as-detail", style: { "--tpl-accent": template.accent || "var(--accent)" } },
      back,
      el("header", { class: "as-detail-head" },
        appIcon(template, 72),
        el("div", { class: "as-detail-title" }, el("h2", { text: template.name }), el("p", { text: `${template.category} · Clyra template` })),
        el("div", { class: "as-detail-actions" },
          el("button", { class: "as-preview-button", type: "button", onclick: () => preview(template) }, icon("page", 14), "Preview"),
          getButton(template, state, create, open, { large: true }))),
      shots,
      el("section", { class: "as-detail-copy" },
        el("h3", { text: "About this template" }),
        el("p", { text: template.desc }),
        signalRow(template, "as-detail-signals"),
        el("p", { class: "as-detail-note", text: "Preview before adding it. Nothing is created until you press Get." })));
  };

  const card = (template, index, { wide = false } = {}) => {
    const node = el("div", {
      class: `as-card${wide ? " wide" : ""}`, role: "button", tabindex: "0",
      style: { animationDelay: `${Math.min(index, 10) * 22}ms`, "--tpl-accent": template.accent || "var(--accent)" },
      onclick: () => showDetail(template),
      onkeydown: (event) => { if (event.key === "Enter") { event.preventDefault(); node.click(); } },
    },
      el("div", { class: "as-art" }, templatePreview(template)),
      el("div", { class: "as-lockup" },
        appIcon(template, 40),
        el("span", { class: "as-text" },
          el("span", { class: "as-name", text: template.name }),
          el("span", { class: "as-sub", text: template.desc })),
        getButton(template, state, create, open)),
      signalRow(template, "as-card-signals"),
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
        onclick: () => { detail = null; category = name; paintRail(); paint(); },
      }, el("span", { class: "as-tab-icon" }, icon(CATEGORY_ICONS[name] || "page", 15)), el("span", { text: name === "All" ? "Discover" : name })));
    }
  };

  const paint = () => {
    state.paints.clear();
    clear(main);
    main.scrollTop = 0;
    if (detail) { main.append(detailScreen(detail)); return; }
    const needle = query.trim().toLowerCase();
    if (category === "All" && !needle) {
      main.append(el("h2", { class: "as-page-title", text: "Discover" }));
      const featured = TEMPLATES.find((t) => t.category === "Study & Education") || TEMPLATES[0];
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
