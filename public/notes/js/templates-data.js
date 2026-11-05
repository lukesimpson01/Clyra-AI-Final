/* The active catalogue is deliberately small and explicit: four Clyra-native
   study templates. A template remains a normal page, so creating one never
   introduces a second editor or persistence model. */
import { table } from "./template-kit.js";
import { TEMPLATE_LIBRARY_V2, TEMPLATE_LIBRARY_V2_CATEGORIES } from "./template-library-v2.js";

export const TEMPLATE_GROUPS = ["School"];
/* One active shelf, supplied by the active template registry. */
export const TEMPLATE_CATEGORIES = TEMPLATE_LIBRARY_V2_CATEGORIES;

/* A template whose page is only a database previews as a table of its sample records. */
const previewTable = (spec) => {
  if (!spec?.properties?.length) return [];
  const names = spec.properties.map((property) => property.name);
  const cell = (value) => (value && typeof value === "object" && "offsetDays" in value
    ? new Date(Date.now() + value.offsetDays * 86_400_000).toLocaleDateString([], { day: "numeric", month: "short" })
    : value === true ? "✓" : value === false ? "" : value ?? "");
  return [table([names, ...spec.records.slice(0, 5).map((record) => names.map((name) => String(cell(record[name]))))], { tint: "gray" })];
};

export const TEMPLATES = [
  ...TEMPLATE_LIBRARY_V2,
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
