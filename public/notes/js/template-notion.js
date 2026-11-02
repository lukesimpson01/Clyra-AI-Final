/* The templates from template-notion-data.js, as pages. A template's blocks are plain data; this turns them into the block
   tree the editor and the page API use. A block of type "database" points (by index) at one of the template's databases, which
   are created alongside the page when the template is used. */
import { NOTION_TOP } from "./template-notion-data.js";
import { b, columns, table, cover } from "./template-kit.js";

const toBlock = (spec) => {
  if (spec.type === "columns") return columns(...spec.columns.map((column) => column.map(toBlock)));
  if (spec.type === "database") return b("database", "", { dbIndex: spec.dbIndex });
  if (spec.type === "table") {
    const rows = spec.props?.rows?.length ? spec.props.rows : [["", ""]];
    return table(rows, { align: rows[0].map(() => "left"), tint: "gray" });
  }
  return b(spec.type, spec.text || "", spec.props || {}, (spec.children || []).map(toBlock));
};

export const NOTION = NOTION_TOP.map((entry, index) => ({
  id: entry.id, name: entry.name, emoji: entry.emoji, category: entry.category, group: entry.group, desc: entry.desc || `${entry.name}, from Notion's library.`,
  cover: cover(index), library: true, databases: entry.databases,
  blocks: () => entry.blocks.map(toBlock),
}));
