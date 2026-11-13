/* The template library as the assistant sees it: what every template is for,
   how it looks, what it contains, and a way to create a real page from it.
   The data is generated from the same definitions the Templates screen uses
   (tools/notes-templates-catalog.mjs), so the two cannot drift apart. */
import fs from "node:fs";
import path from "node:path";
import * as store from "./store";
import { blocksToMarkdown, spanText, type Block } from "./blocks";

type CatalogBlock = { id: string; type: string; text: Array<{ t: string }>; props: Record<string, any>; children: CatalogBlock[] };
type DbSpec = { name: string; properties: Array<{ name: string; type: string; options?: string[]; colors?: string[]; config?: Record<string, unknown> }>; records?: Array<Record<string, any>>; views?: Array<{ name: string; type: string; group?: string; date?: string; sort?: string }> };
type Entry = { cover?: string | null; id: string; name: string; category: string; description: string; layout: string; look?: string; emoji: string; blocks: CatalogBlock[]; databases: DbSpec[] };

let cache: Entry[] | null = null;
const load = (): Entry[] => {
  if (cache) return cache;
  for (const candidate of [path.join(process.cwd(), "public", "notes", "templates-catalog.json"), path.join(process.cwd(), "dist", "notes", "templates-catalog.json")]) {
    try { cache = JSON.parse(fs.readFileSync(candidate, "utf8")) as Entry[]; return cache; } catch { /* try the next place */ }
  }
  cache = [];
  return cache;
};

const headings = (blocks: CatalogBlock[], out: string[] = []) => { for (const block of blocks) { if (["h1", "h2", "h3", "toggle_h1", "toggle_h2", "toggle_h3"].includes(block.type)) { const text = block.text.map((s) => s.t).join("").trim(); if (text) out.push(text); } headings(block.children || [], out); } return out; };
const toBlocks = (blocks: CatalogBlock[]): Block[] => blocks.map((block) => ({ id: block.id, page_id: "", parent_id: null, type: block.type as Block["type"], text: block.text as any, props: block.props || {}, sort: 0, children: toBlocks(block.children || []) }));

export const catalog = () => load().map((entry) => ({ id: entry.id, name: entry.name, category: entry.category, description: entry.description, layout: entry.layout, outline: headings(entry.blocks).slice(0, 10) }));

export function describe(id: string) {
  const entry = load().find((candidate) => candidate.id === id);
  if (!entry) return null;
  return {
    id: entry.id, name: entry.name, category: entry.category, description: entry.description, layout: entry.layout, look: entry.look || "A designed page with sections.",
    outline: headings(entry.blocks),
    databases: entry.databases.map((spec) => ({ name: spec.name, columns: spec.properties.map((property) => `${property.name} (${property.type})`), views: (spec.views || []).map((view) => `${view.name} — ${view.type}`) })),
    markdown: blocksToMarkdown(toBlocks(entry.blocks)).slice(0, 9000),
  };
}

const slug = (text: unknown) => String(text).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "x";
const COLORS = ["gray", "blue", "orange", "green", "purple", "pink", "yellow", "red", "brown"];
const TONES = new Set(["blue", "green", "purple", "pink", "orange", "yellow", "red", "brown"]);

function buildDatabase(spec: DbSpec, parentId: string) {
  const properties = spec.properties.filter((property) => !["relation", "rollup", "formula"].includes(property.type)).map((def) => {
    const options = def.type === "status" && !(def.options?.length) ? ["Not started", "In progress", "Done"] : def.options;
    return { name: def.name, type: def.type, config: options ? { ...(def.config || {}), options: options.map((label, i) => ({ id: slug(label), name: label, color: COLORS[(i + 1) % COLORS.length], group: def.type === "status" ? (i === 0 ? "todo" : i === options.length - 1 ? "done" : "doing") : undefined })) } : def.config || {} };
  });
  const made = store.createDatabase({ name: spec.name, parentId, inline: true, properties }) as any;
  const byName = new Map<string, any>(made.properties.map((property: any) => [property.name, property]));
  const titleName = spec.properties.find((def) => def.type === "title")?.name ?? "Name";
  for (const record of spec.records || []) {
    const values: Record<string, unknown> = {};
    for (const def of spec.properties) {
      const prop = byName.get(def.name);
      const raw = record[def.name];
      if (def.type === "title" || !prop || raw === undefined || raw === null) continue;
      if (raw && typeof raw === "object" && "offsetDays" in raw) values[prop.id] = { start: new Date(Date.now() + raw.offsetDays * 86_400_000).toISOString().slice(0, 10) };
      else if (def.type === "select" || def.type === "status") values[prop.id] = slug(raw);
      else if (def.type === "multi_select") values[prop.id] = (Array.isArray(raw) ? raw : [raw]).map(slug);
      else values[prop.id] = raw;
    }
    store.createRecord(made.id, { title: record[titleName] || "", values });
  }
  const views = spec.views?.length ? spec.views : [{ name: "Table", type: "table" }];
  const configOf = (view: NonNullable<DbSpec["views"]>[number]) => {
    const config: Record<string, unknown> = {};
    if (view.group && byName.get(view.group)) config.group = byName.get(view.group).id;
    if (view.date && byName.get(view.date)) config.dateProperty = byName.get(view.date).id;
    if (view.sort && byName.get(view.sort)) config.sorts = [{ property: byName.get(view.sort).id, direction: "ascending" }];
    return config;
  };
  const [first, ...rest] = views;
  const existing = made.views?.[0];
  if (existing && first) store.updateView(existing.id, { name: first.name, type: first.type, config: configOf(first) });
  for (const view of rest) store.createView(made.id, { name: view.name, type: view.type, config: configOf(view) });
  return made;
}

export function instantiate(id: string, options: { title?: string; tone?: string; parentId?: string }) {
  const entry = load().find((candidate) => candidate.id === id);
  if (!entry) return null;
  const tone = options.tone && TONES.has(options.tone) ? options.tone : "";
  const blocks = JSON.parse(JSON.stringify(entry.blocks)) as CatalogBlock[];
  const tint = (list: CatalogBlock[]) => list.forEach((block) => {
    if (tone) { if (block.props?.templateStyle) block.props.templateTone = tone; if (block.type === "callout") block.props.color = tone; if (block.type === "table") block.props.tint = tone; }
    tint(block.children || []);
  });
  tint(blocks);
  const page = store.createPage({ parentId: options.parentId || null, title: options.title || entry.name, icon: entry.emoji || undefined, cover: entry.cover || undefined, fullWidth: true, blocks: blocks as any }) as { id: string; title: string } | null;
  if (!page) return null;
  /* Databases are real: build each one under the new page and point its block at it. */
  const dbBlocks: CatalogBlock[] = [];
  const collect = (list: CatalogBlock[]) => list.forEach((block) => { if (block.type === "database") dbBlocks.push(block); collect(block.children || []); });
  collect(blocks);
  if (dbBlocks.length) {
    for (const block of dbBlocks) {
      const spec = entry.databases[Number(block.props?.dbIndex)];
      const made = spec ? buildDatabase(spec, page.id) : null;
      block.props = made ? { pageId: made.page_id } : {};
    }
    store.saveBlocks(page.id, toBlocks(blocks).map((block, i) => ({ ...block, page_id: page.id, sort: i })) as any);
  }
  return { id: String(page.id), title: String(page.title || entry.name) };
}
export { spanText };
