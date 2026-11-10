/* The active catalogue. A template remains a normal page, so creating one
   never introduces a second editor or persistence model. */
import { table } from "./template-kit.js";
import { TEMPLATE_LIBRARY_V3, V3_CATEGORIES } from "./template-library-v3.js";

export const TEMPLATE_GROUPS = ["School"];
/* One active shelf, supplied by the active template registry. */
export const TEMPLATE_CATEGORIES = V3_CATEGORIES;

/* A template whose page is only a database previews as a table of its sample records. */
const previewTable = (spec) => {
  if (!spec?.properties?.length) return [];
  const names = spec.properties.map((property) => property.name);
  const cell = (value) => (value && typeof value === "object" && "offsetDays" in value
    ? new Date(Date.now() + value.offsetDays * 86_400_000).toLocaleDateString([], { day: "numeric", month: "short" })
    : value === true ? "✓" : value === false ? "" : value ?? "");
  return [table([names, ...spec.records.slice(0, 5).map((record) => names.map((name) => String(cell(record[name]))))], { tint: "gray" })];
};

export const TEMPLATES = TEMPLATE_LIBRARY_V3;

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
/* Grey is the default surface. A tone recolours only what was grey: the banner and cards (through templateTone), callouts and table headers. */
export const TEMPLATE_TONES = ["gray", "blue", "green", "purple", "pink", "orange", "yellow", "red", "brown"];
export function applyTone(blocks, tone) {
  if (!tone || tone === "gray") return blocks;
  const walk = (list) => list.forEach((block) => {
    if (block.props?.templateStyle) block.props = { ...block.props, templateTone: tone };
    if (block.type === "callout") block.props = { ...block.props, color: tone };
    if (block.type === "table") block.props = { ...block.props, tint: tone };
    walk(block.children || []);
  });
  walk(blocks);
  return blocks;
}
export const templateBlocks = (template, tone = "gray") => applyTone(mint(template.blocks()), tone);

/* A preview shows each embedded database as a table of its sample rows, since the real database only exists once the page is made. */
export function templatePreviewBlocks(template, tone = "gray") {
  const dbs = template.databases || [];
  const swap = (list) => list.flatMap((block) => (block.type === "database"
    ? (dbs[block.props?.dbIndex] ? previewTable(dbs[block.props.dbIndex]) : [])
    : [{ ...block, children: swap(block.children || []) }]));
  return applyTone(mint(swap(template.blocks())), tone);
}
