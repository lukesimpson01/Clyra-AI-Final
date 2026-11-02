/* The template catalogue: fifty finished pages across Work, School and Life, plus a blank page.

   A template is a block tree (or, for trackers, a database definition), not a markdown string, so what a person gets is a
   page with a cover, an icon, callouts, side-by-side columns and tables that already have the right columns. Templates
   are created through the ordinary page and database APIs; there is no separate template runtime, so whatever the editor
   or a database can do, a template inherits. The three sets live in template-work.js, template-school.js and
   template-life.js; template-kit.js is their shared vocabulary. */
import { p, table } from "./template-kit.js";
import { NOTION } from "./template-notion.js";

export const TEMPLATE_GROUPS = ["Work", "Life", "School"];
/* The gallery's shelves. Every template sits in one; its Work, Life or School group is kept as well, for the filters that use it. */
export const TEMPLATE_CATEGORIES = ["Notes", "Study", "Work", "Planning", "Writing", "Money", "Personal"];
const ACCENT = { Notes: "#6e7bf2", Study: "#2f9e6b", Work: "#2383e2", Planning: "#e08a3a", Writing: "#9b51e0", Money: "#2d9cdb", Personal: "#d9534f" };

/* A template whose page is only a database previews as a table of its sample records. */
const previewTable = (spec) => {
  if (!spec?.properties?.length) return [];
  const names = spec.properties.map((property) => property.name);
  const cell = (value) => (value && typeof value === "object" && "offsetDays" in value
    ? new Date(Date.now() + value.offsetDays * 86_400_000).toLocaleDateString([], { day: "numeric", month: "short" })
    : value === true ? "✓" : value === false ? "" : value ?? "");
  return [table([names, ...spec.records.slice(0, 5).map((record) => names.map((name) => String(cell(record[name]))))], { tint: "gray" })];
};

const library = NOTION.map((entry) => ({
  ...entry,
  accent: ACCENT[entry.category] || "#5f6672",
  blocks: entry.blocks,
}));

export const TEMPLATES = [
  { id: "blank", name: "Blank page", icon: "page", category: "Notes", group: "School", desc: "An empty page with nothing in the way.", accent: "#8a8f9c", cover: null, blocks: () => [p("")] },
  ...library,
];

export const templateById = (id) => TEMPLATES.find((template) => template.id === id) || null;
export const templateGroup = (template) => template.group || "School";

/* Blocks arrive as a plain tree; the store needs stable ids before it can write parent links, so they are minted here
   rather than server-side. */
const mint = (list) => {
  const id = () => `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 9)}`;
  const walk = (blocks) => blocks.map((block) => ({
    id: id(),
    type: block.type,
    text: block.text || [],
    props: block.props || {},
    children: walk(block.children || []),
  }));
  return walk(list);
};
export const templateBlocks = (template) => mint(template.blocks());

/* A preview shows each embedded database as a table of its sample rows, since the real database only exists once the page is made. */
export function templatePreviewBlocks(template) {
  const dbs = template.databases || [];
  const swap = (list) => list.flatMap((block) => (block.type === "database"
    ? (dbs[block.props?.dbIndex] ? previewTable(dbs[block.props.dbIndex]) : [])
    : [{ ...block, children: swap(block.children || []) }]));
  return mint(swap(template.blocks()));
}
