/* The template catalogue: fifty finished pages across Work, School and Life, plus a blank page.

   A template is a block tree (or, for trackers, a database definition), not a markdown string, so what a person gets is a
   page with a cover, an icon, callouts, side-by-side columns and tables that already have the right columns. Templates
   are created through the ordinary page and database APIs; there is no separate template runtime, so whatever the editor
   or a database can do, a template inherits. The three sets live in template-work.js, template-school.js and
   template-life.js; template-kit.js is their shared vocabulary. */
import { p, table } from "./template-kit.js";
import { WORK } from "./template-work.js";
import { SCHOOL } from "./template-school.js";
import { LIFE } from "./template-life.js";

export const TEMPLATE_GROUPS = ["Work", "Life", "School"];
/* The gallery's shelves. Every template sits in one; its Work, Life or School group is kept as well, for the filters that use it. */
export const TEMPLATE_CATEGORIES = ["Notes", "Study", "Work", "Planning", "Writing", "Research", "Personal"];
const CATEGORY = {
  Notes: ["meeting-notes", "one-on-one", "cornell-notes", "lecture-notes", "daily-journal", "personal-wiki", "team-wiki"],
  Study: ["exam-revision", "math-formulas", "source-analysis", "book-analysis", "language-vocab", "coding-notes", "student-dashboard", "grade-tracker"],
  Work: ["project-tracker", "product-roadmap", "sprint-board", "sales-crm", "content-calendar", "okrs", "prd", "retrospective", "decision-log", "hiring-pipeline", "interview-scorecard", "sop", "task-manager", "bug-tracker"],
  Planning: ["weekly-study-planner", "assignment-tracker", "college-applications", "weekly-review", "goal-setting", "monthly-budget", "habit-tracker", "event-planner", "trip-planner", "daily-planner"],
  Writing: ["essay-planner", "resume"],
  Research: ["research-paper", "lab-report", "competitor-analysis"],
  Personal: ["meal-planner", "workout-log", "recipe-book", "reading-list", "watchlist", "moving-checklist"],
};
const ACCENT = { Notes: "#6e7bf2", Study: "#2f9e6b", Work: "#2383e2", Planning: "#e08a3a", Writing: "#9b51e0", Research: "#2d9cdb", Personal: "#d9534f" };
const categoryOf = (id) => Object.entries(CATEGORY).find(([, ids]) => ids.includes(id))?.[0] || "Notes";

/* A database template has no blocks of its own; its preview is a table of its sample records, so the gallery card and the
   screenshot show what the tracker holds. */
const previewTable = (spec) => {
  const names = spec.properties.map((property) => property.name);
  const cell = (value) => (value && typeof value === "object" && "offsetDays" in value
    ? new Date(Date.now() + value.offsetDays * 86_400_000).toLocaleDateString([], { day: "numeric", month: "short" })
    : value === true ? "✓" : value === false ? "" : value ?? "");
  return [table([names, ...spec.records.slice(0, 5).map((record) => names.map((name) => String(cell(record[name]))))], { tint: "gray" })];
};

const library = [...WORK, ...SCHOOL, ...LIFE].map((entry) => ({
  ...entry,
  category: categoryOf(entry.id),
  accent: ACCENT[categoryOf(entry.id)],
  blocks: entry.blocks || (() => previewTable(entry.database)),
}));

export const TEMPLATES = [
  { id: "blank", name: "Blank page", icon: "page", category: "Notes", group: "School", desc: "An empty page with nothing in the way.", accent: "#8a8f9c", cover: null, blocks: () => [p("")] },
  ...library,
];

export const templateById = (id) => TEMPLATES.find((template) => template.id === id) || null;
export const templateGroup = (template) => template.group || "School";

/* Blocks arrive as a plain tree; the store needs stable ids before it can write parent links, so they are minted here
   rather than server-side. */
export function templateBlocks(template) {
  const id = () => `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 9)}`;
  const walk = (list) => list.map((block) => ({
    id: id(),
    type: block.type,
    text: block.text || [],
    props: block.props || {},
    children: walk(block.children || []),
  }));
  return walk(template.blocks());
}
