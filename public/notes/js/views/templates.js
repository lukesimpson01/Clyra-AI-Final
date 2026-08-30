/* Templates create ordinary pages — there is no separate template runtime,
   which is why every template inherits the editor's behaviour for free.

   Previews are rendered from each template's own content rather than stored
   as screenshots, so a card can never drift out of date with what it makes. */
import { el, clear, icon, modal, toast, append } from "../dom.js";
import { api } from "../api.js";
import { refreshPages, withError } from "../state.js";
import { parseMarkdownBlocks } from "../editor.js";

export const TEMPLATE_CATEGORIES = ["Notes", "Study", "Planning", "Writing", "Research"];

export const TEMPLATES = [
  { id: "blank", name: "Blank page", icon: "page", category: "Notes",
    desc: "Start from nothing.", markdown: "" },

  { id: "lecture", name: "Lecture notes", icon: "mic", category: "Notes",
    desc: "Capture a class, then structure it after.",
    markdown: "## Before the lecture\n\n- What is this lecture about?\n- What do I already know?\n\n## Notes\n\n\n## Key terms\n\n\n## Questions I still have\n\n- \n\n## To revise\n\n- [ ] " },

  { id: "cornell", name: "Cornell notes", icon: "template", category: "Notes",
    desc: "Cues, notes and a summary.",
    markdown: "## Cues\n\n- \n- \n\n## Notes\n\n\n\n## Summary\n\n" },

  { id: "class", name: "Class notes", icon: "book", category: "Notes",
    desc: "A single lesson, with homework.",
    markdown: "## Topic\n\n## What we covered\n\n- \n- \n\n## Examples\n\n## Homework\n\n- [ ] " },

  { id: "textbook", name: "Textbook notes", icon: "book", category: "Notes",
    desc: "Read a chapter and record what matters.",
    markdown: "## Chapter\n\n## Main argument\n\n## Key definitions\n\n| Term | Meaning |\n| --- | --- |\n|  |  |\n|  |  |\n\n## Evidence and examples\n\n## My questions\n\n- " },

  { id: "meeting", name: "Group meeting", icon: "users", category: "Notes",
    desc: "Decisions and who does what.",
    markdown: "## Attending\n\n## Agenda\n\n1. \n2. \n\n## Decisions\n\n- \n\n## Actions\n\n- [ ] \n- [ ] " },

  { id: "study-guide", name: "Study guide", icon: "target", category: "Study",
    desc: "A revision document for one topic.",
    markdown: "## Overview\n\n## Learning objectives\n\n- \n- \n\n## Key concepts\n\n## Definitions\n\n| Term | Definition |\n| --- | --- |\n|  |  |\n\n## Common mistakes\n\n> \n\n## Exam-style questions\n\n1. \n\n## Checklist\n\n- [ ] " },

  { id: "revision", name: "Exam revision", icon: "clock", category: "Study",
    desc: "Plan what to revise and when.",
    markdown: "## Exam\n\n## Topics\n\n- [ ] \n- [ ] \n- [ ] \n\n## Weak areas\n\n> \n\n## Practice done\n\n## Final review\n\n- [ ] " },

  { id: "flashcard-source", name: "Term sheet", icon: "cards", category: "Study",
    desc: "Terms and definitions, ready to turn into cards.",
    markdown: "## Terms\n\n| Term | Definition |\n| --- | --- |\n|  |  |\n|  |  |\n|  |  |\n\n## Notes\n\n- " },

  { id: "practice", name: "Practice questions", icon: "check_square", category: "Study",
    desc: "Write questions and mark your answers.",
    markdown: "## Topic\n\n## Questions\n\n1. \n2. \n3. \n\n## My answers\n\n## What I got wrong\n\n- " },

  { id: "planner", name: "Weekly study planner", icon: "calendar", category: "Planning",
    desc: "One week of revision.",
    markdown: "## This week's goal\n\n## Monday\n\n- [ ] \n\n## Tuesday\n\n- [ ] \n\n## Wednesday\n\n- [ ] \n\n## Thursday\n\n- [ ] \n\n## Friday\n\n- [ ] \n\n## Weekend review\n\n- [ ] " },

  { id: "assignment", name: "Assignment planner", icon: "check_square", category: "Planning",
    desc: "Break a task into steps with dates.",
    markdown: "## Brief\n\n## Due date\n\n## Steps\n\n- [ ] Read the brief\n- [ ] Research\n- [ ] Outline\n- [ ] First draft\n- [ ] Edit\n- [ ] Submit\n\n## Sources\n\n- " },

  { id: "project", name: "Project tracker", icon: "board", category: "Planning",
    desc: "Scope, milestones and blockers.",
    markdown: "## Goal\n\n## Milestones\n\n| Milestone | Date | Status |\n| --- | --- | --- |\n|  |  |  |\n\n## Blockers\n\n> \n\n## Next actions\n\n- [ ] " },

  { id: "essay", name: "Essay plan", icon: "text", category: "Writing",
    desc: "Argument, evidence and structure.",
    markdown: "## Question\n\n## Thesis\n\n> \n\n## Paragraph 1\n\n**Point:** \n\n**Evidence:** \n\n**Analysis:** \n\n## Paragraph 2\n\n**Point:** \n\n**Evidence:** \n\n**Analysis:** \n\n## Conclusion\n\n## Sources\n\n- " },

  { id: "reading", name: "Reading notes", icon: "book", category: "Writing",
    desc: "What you read and what it means.",
    markdown: "## Text\n\n## Summary\n\n## Key passages\n\n> \n\n## My response\n\n## Vocabulary\n\n- " },

  { id: "report", name: "Report", icon: "file", category: "Writing",
    desc: "A structured written report.",
    markdown: "## Introduction\n\n## Background\n\n## Findings\n\n| Finding | Evidence |\n| --- | --- |\n|  |  |\n\n## Discussion\n\n## Conclusion\n\n## References\n\n- " },

  { id: "research", name: "Research notes", icon: "search", category: "Research",
    desc: "Track what each source says.",
    markdown: "## Research question\n\n## Sources\n\n### Source 1\n\n**Reference:** \n\n**Claim:** \n\n**Useful quotes:** \n\n> \n\n### Source 2\n\n**Reference:** \n\n**Claim:** \n\n## Synthesis\n\n## Gaps" },

  { id: "lab", name: "Lab report", icon: "template", category: "Research",
    desc: "Method, results and conclusion.",
    markdown: "## Aim\n\n## Hypothesis\n\n## Method\n\n1. \n2. \n3. \n\n## Results\n\n| Trial | Measurement |\n| --- | --- |\n|  |  |\n|  |  |\n\n## Analysis\n\n## Sources of error\n\n- \n\n## Conclusion" },

  { id: "literature", name: "Literature review", icon: "book", category: "Research",
    desc: "Compare what the field says.",
    markdown: "## Scope\n\n## Themes\n\n### Theme 1\n\n**Agreement:** \n\n**Disagreement:** \n\n### Theme 2\n\n## Method comparison\n\n| Study | Method | Finding |\n| --- | --- | --- |\n|  |  |  |\n\n## Gaps and next steps\n\n- " },
];

/* Draws a template as a miniature page: headings as weighted bars, body as
   light rules, lists with markers, tables as grids. It is generated from the
   same markdown the template inserts, so preview and result cannot diverge. */
export function templatePreview(template) {
  const canvas = el("div", { class: "tpl-preview", "aria-hidden": "true" });
  const sheet = el("div", { class: "tpl-sheet" });
  canvas.append(sheet);
  sheet.append(el("div", { class: "tpl-title" }));
  if (!template.markdown.trim()) {
    sheet.append(el("div", { class: "tpl-empty-hint" }));
    return canvas;
  }
  const blocks = parseMarkdownBlocks(template.markdown).slice(0, 14);
  for (const block of blocks) {
    if (block.type === "h1" || block.type === "h2" || block.type === "h3") {
      sheet.append(el("div", { class: `tpl-h ${block.type}` }));
      continue;
    }
    if (block.type === "table") {
      const rows = block.props?.rows || [];
      const columns = Math.max(2, rows[0]?.length || 2);
      const grid = el("div", { class: "tpl-table", style: { gridTemplateColumns: `repeat(${columns}, 1fr)` } });
      for (let index = 0; index < columns * Math.min(3, Math.max(2, rows.length)); index += 1) {
        grid.append(el("div", { class: `tpl-cell${index < columns ? " head" : ""}` }));
      }
      sheet.append(grid);
      continue;
    }
    if (block.type === "todo") {
      sheet.append(el("div", { class: "tpl-row" }, el("div", { class: "tpl-check" }), el("div", { class: "tpl-line w70" })));
      continue;
    }
    if (block.type === "bulleted" || block.type === "numbered") {
      sheet.append(el("div", { class: "tpl-row" },
        el("div", { class: `tpl-marker${block.type === "numbered" ? " num" : ""}` }),
        el("div", { class: "tpl-line w60" })));
      continue;
    }
    if (block.type === "quote") {
      sheet.append(el("div", { class: "tpl-quote" }, el("div", { class: "tpl-line w75" })));
      continue;
    }
    if (block.type === "divider") { sheet.append(el("div", { class: "tpl-divider" })); continue; }
    sheet.append(el("div", { class: "tpl-line w85" }));
  }
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
        markdown: template.markdown,
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
        style: { animationDelay: `${Math.min(index, 8) * 18}ms` },
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
    width: 880,
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
