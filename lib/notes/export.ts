/* Export: one page, three faithful formats.

   A page is read once into a plain document model (blocks plus every embedded
   database resolved to rows), and each format is a renderer over that model:

   - Word (.docx): a real OOXML package written here, with no third-party
     dependency — styles, numbering, hyperlinks, shaded callouts, ruled quotes,
     bordered tables and a page-numbered footer. It opens in Word, Pages, Google
     Docs and LibreOffice.
   - Markdown: standard CommonMark/GFM. Anything with no markdown equivalent is
     turned into text: databases become tables, calendars and timelines become
     dated agendas, boards become grouped lists.
   - PDF: the HTML rendering is printed by Chromium when it is available, and
     otherwise returned as print-ready HTML for the desktop print dialog. */
import { deflateRawSync } from "node:zlib";
import { readFileSync } from "node:fs";
import path from "node:path";
import * as store from "./store";
import { blocksToMarkdown, spansToMarkdown, type Block, type Span } from "./blocks";

/* ------------------------------------------------------------------ model */

type Table = { columns: string[]; rows: string[][] };
type Agenda = { title: string; groups: Array<{ label: string; items: string[] }> };
type Embedded = { name: string; table: Table; agendas: Agenda[]; boards: Agenda[] };
export type ExportDoc = { id: string; title: string; icon: string; blocks: Block[]; databases: Map<string, Embedded>; self: Embedded | null };

const stringify = (value: unknown, options: Array<{ id: string; name: string }> = []): string => {
  if (value === null || value === undefined || value === "") return "";
  if (Array.isArray(value)) return value.map((entry) => stringify(entry, options)).filter(Boolean).join(", ");
  if (typeof value === "boolean") return value ? "Yes" : "";
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    if ("start" in record) return record.end ? `${record.start} – ${record.end}` : String(record.start ?? "");
    return String(record.name ?? record.title ?? record.url ?? record.value ?? "");
  }
  const text = String(value);
  return options.find((option) => option.id === text)?.name ?? text;
};

function embeddedDatabase(pageId: string): Embedded | null {
  const database = store.getDatabaseByPage(pageId);
  if (!database) return null;
  const properties = database.properties as Array<{ id: string; name: string; type: string; config?: Record<string, unknown> }>;
  const records = store.listRecords(database.id) as Array<Record<string, unknown>>;
  const optionsOf = (property: (typeof properties)[number]) => (Array.isArray(property.config?.options) ? (property.config!.options as Array<{ id: string; name: string }>) : []);
  const valueOf = (record: Record<string, unknown>, property: (typeof properties)[number]) => {
    const values = (record.values as Record<string, unknown> | undefined) ?? {};
    const raw = property.type === "title" ? record.title : values[property.id] ?? values[property.name] ?? record[property.id] ?? record[property.name];
    return stringify(raw, optionsOf(property));
  };
  const table: Table = { columns: properties.map((property) => property.name), rows: records.map((record) => properties.map((property) => valueOf(record, property))) };
  const titleProperty = properties.find((property) => property.type === "title") ?? properties[0];
  const dateProperties = properties.filter((property) => property.type === "date");
  const agendas: Agenda[] = [];
  const boards: Agenda[] = [];
  for (const view of database.views as Array<{ name: string; type: string; config?: Record<string, unknown> }>) {
    if ((view.type === "calendar" || view.type === "timeline") && dateProperties.length) {
      const dateProperty = dateProperties.find((property) => property.id === view.config?.dateProperty) ?? dateProperties[0]!;
      const groups = new Map<string, string[]>();
      for (const record of records) {
        const when = valueOf(record, dateProperty).split(" – ")[0] || "No date";
        groups.set(when, [...(groups.get(when) ?? []), valueOf(record, titleProperty!)]);
      }
      agendas.push({ title: `${view.name} (by ${dateProperty.name})`, groups: [...groups].sort(([a], [b]) => (a === "No date" ? 1 : b === "No date" ? -1 : a.localeCompare(b))).map(([label, items]) => ({ label, items })) });
    }
    if (view.type === "board") {
      const groupProperty = properties.find((property) => property.id === view.config?.group) ?? properties.find((property) => property.type === "select" || property.type === "status");
      if (groupProperty) {
        const groups = new Map<string, string[]>();
        for (const record of records) {
          const key = valueOf(record, groupProperty) || "No " + groupProperty.name.toLowerCase();
          groups.set(key, [...(groups.get(key) ?? []), valueOf(record, titleProperty!)]);
        }
        boards.push({ title: `${view.name} (grouped by ${groupProperty.name})`, groups: [...groups].map(([label, items]) => ({ label, items })) });
      }
    }
  }
  return { name: database.name, table, agendas, boards };
}

export function loadDoc(pageId: string): ExportDoc | null {
  const page = store.getPage(pageId) as Record<string, unknown> | null;
  if (!page || page.locked) return null;
  const blocks = store.blockTree(pageId);
  const databases = new Map<string, Embedded>();
  const walk = (list: Block[]) => {
    for (const block of list) {
      if (block.type === "database" && block.props?.pageId) {
        const found = embeddedDatabase(String(block.props.pageId));
        if (found) databases.set(String(block.props.pageId), found);
      }
      if (block.children?.length) walk(block.children);
    }
  };
  walk(blocks);
  return { id: pageId, title: String(page.title || "Untitled"), icon: typeof page.icon === "string" && !/^https?:|^\//.test(page.icon) ? page.icon : "", blocks, databases, self: page.kind === "database" ? embeddedDatabase(pageId) : null };
}

const safeName = (title: string) => (title || "Untitled").replace(/[\\/:*?"<>|]+/g, "").trim().slice(0, 80) || "Untitled";
export const exportFileName = (doc: ExportDoc, ext: string) => `${safeName(doc.title)}.${ext}`;

/* --------------------------------------------------------------- markdown */

const mdCell = (text: string) => text.replace(/\|/g, "\\|").replace(/\n/g, " ");
const mdTable = (table: Table) => {
  if (!table.columns.length) return "";
  const line = (row: string[]) => `| ${row.map(mdCell).join(" | ")} |`;
  return [line(table.columns), `| ${table.columns.map(() => "---").join(" | ")} |`, ...table.rows.map(line)].join("\n");
};
const mdEmbedded = (embedded: Embedded, heading = true) => [
  heading ? `**${embedded.name}**` : "",
  mdTable(embedded.table),
  ...embedded.agendas.map((agenda) => `*${agenda.title}*\n\n${agenda.groups.map((group) => `- **${group.label}**\n${group.items.map((item) => `  - ${item}`).join("\n")}`).join("\n")}`),
  ...embedded.boards.map((board) => `*${board.title}*\n\n${board.groups.map((group) => `- **${group.label}**\n${group.items.map((item) => `  - ${item}`).join("\n")}`).join("\n")}`),
].filter(Boolean).join("\n\n");

/* Blocks with no markdown form are rewritten as ordinary text blocks before
   the shared serialiser runs, so the output stays CommonMark. */
function flatten(blocks: Block[], doc: ExportDoc): Block[] {
  const text = (value: string, type: Block["type"] = "text"): Block => ({ id: "x", page_id: "", parent_id: null, type, text: [{ t: value }], props: {}, sort: 0 });
  return blocks.flatMap((block): Block[] => {
    const children = block.children?.length ? flatten(block.children, doc) : block.children;
    const role = String(block.props?.templateRole || "");
    if (role === "t-label" && block.text?.length) return [{ ...block, text: block.text.map((span) => ({ ...span, b: true })), children }];
    if (role === "t-kicker" && block.text?.length) return [{ ...block, text: block.text.map((span) => ({ ...span, i: true })), children }];
    /* A row of short label/value columns (facts, figures) reads best as a table. */
    if (block.type === "columns") {
      const cols = block.children ?? [];
      const pairs = cols.map((col) => (col.children ?? []).filter((child) => (child.text?.length || 0) > 0));
      if (cols.length > 1 && pairs.every((pair) => pair.length === 2 && pair.every((child) => child.type === "text" && !(child.children?.length)))) {
        const plainText = (b: Block) => (b.text || []).map((span) => span.t).join("").replace(/\|/g, "\\|").replace(/\n/g, " ");
        const valueFirst = pairs.every((pair) => String(pair[1]!.props?.templateRole || "") === "t-small");
        const head = pairs.map((pair) => plainText(valueFirst ? pair[1]! : pair[0]!));
        const row = pairs.map((pair) => plainText(valueFirst ? pair[0]! : pair[1]!));
        return [text(`| ${head.join(" | ")} |\n| ${head.map(() => "---").join(" | ")} |\n| ${row.join(" | ")} |`)];
      }
    }
    switch (block.type) {
      case "database": { const found = doc.databases.get(String(block.props?.pageId)); return found ? [text(mdEmbedded(found))] : []; }
      /* GitHub and many editors render > [!NOTE] as a callout; elsewhere it is still a readable quote. */
      case "callout": { const icon = String(block.props?.icon ?? ""); const kind = ({ red: "CAUTION", orange: "WARNING", yellow: "WARNING", green: "TIP", purple: "IMPORTANT" } as Record<string, string>)[String(block.props?.color || "")] || "NOTE"; return [text(`> [!${kind}]`), { ...block, type: "quote", text: icon ? [{ t: `${icon} ` }, ...block.text] : block.text, children }]; }
      case "tabs": return (children ?? []).flatMap((tab) => [text(String((tab.props as Record<string, unknown>)?.title || "Tab"), "h3"), ...(tab.children ?? [])]);
      case "columns": return children ?? [];
      case "column": return children ?? [];
      case "toc": case "breadcrumb": case "focus_timer": case "button": return [];
      case "toggle": return [{ ...block, type: "bulleted", children }];
      case "link_to_page": case "page": return [text(`[[${String(block.props?.title || "Untitled")}]]`)];
      case "synced": return [{ ...block, type: "text", children }];
      default: return [{ ...block, children }];
    }
  });
}

export function toMarkdown(doc: ExportDoc): string {
  const head = `# ${doc.icon ? `${doc.icon} ` : ""}${doc.title}`;
  const body = doc.self ? mdEmbedded(doc.self, false) : "";
  const text = blocksToMarkdown(flatten(doc.blocks, doc))
    /* Items of one list sit on consecutive lines (a tight list), and a callout marker joins its quote. */
    .replace(/^(\s*(?:[-*+] |\d+\. ).*)\n\n(?=\s*(?:[-*+] |\d+\. ))/gm, "$1\n")
    .replace(/^(\s*(?:[-*+] |\d+\. ).*)\n\n(?=\s*(?:[-*+] |\d+\. ))/gm, "$1\n")
    .replace(/^> \[!(\w+)\]\n\n>/gm, "> [!$1]\n>");
  return `${[head, body, text].filter(Boolean).join("\n\n").replace(/\n{3,}/g, "\n\n")}\n`;
}

/* ------------------------------------------------------------------ colour */

const TONES: Record<string, { bg: string; fg: string }> = {
  gray: { bg: "F1F1EF", fg: "787774" }, brown: { bg: "F4EEEE", fg: "9F6B53" }, orange: { bg: "FBECDD", fg: "D9730D" },
  yellow: { bg: "FBF3DB", fg: "CB912F" }, green: { bg: "EDF3EC", fg: "448361" }, blue: { bg: "E7F3F8", fg: "337EA9" },
  purple: { bg: "F6F3F9", fg: "9065B0" }, pink: { bg: "FAF1F5", fg: "C14C8A" }, red: { bg: "FDEBEC", fg: "D44C47" },
};
const toneOf = (name: unknown) => TONES[String(name || "gray")] ?? TONES.gray!;
const hex = (value: unknown) => (/^#[0-9a-f]{6}$/i.test(String(value)) ? String(value).slice(1).toUpperCase() : null);

/* -------------------------------------------------------------------- HTML */

const esc = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function spansHtml(spans: Span[] | undefined): string {
  return (spans || []).map((span) => {
    let text = esc(span.t ?? "").replace(/\n/g, "<br>");
    if (span.eq) return `<em class="eq">${esc(span.eq)}</em>`;
    if (span.c) text = `<code>${text}</code>`;
    if (span.b) text = `<strong>${text}</strong>`;
    if (span.i) text = `<em>${text}</em>`;
    if (span.u) text = `<u>${text}</u>`;
    if (span.s) text = `<s>${text}</s>`;
    const style = [span.col && TONES[span.col] ? `color:#${TONES[span.col]!.fg}` : hex(span.colHex) ? `color:#${hex(span.colHex)}` : "", span.bg && TONES[span.bg] ? `background:#${TONES[span.bg]!.bg}` : hex(span.bgHex) ? `background:#${hex(span.bgHex)}` : ""].filter(Boolean).join(";");
    if (style) text = `<span style="${style}">${text}</span>`;
    if (span.href) text = `<a href="${esc(span.href)}">${text}</a>`;
    return text;
  }).join("");
}

const tableHtml = (table: Table) => `<table><thead><tr>${table.columns.map((column) => `<th>${esc(column)}</th>`).join("")}</tr></thead><tbody>${table.rows.map((row) => `<tr>${row.map((cell) => `<td>${esc(cell)}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
const embeddedHtml = (embedded: Embedded) => `<section class="db"><h4>${esc(embedded.name)}</h4>${tableHtml(embedded.table)}${[...embedded.agendas, ...embedded.boards].map((agenda) => `<div class="agenda"><p class="agenda-title">${esc(agenda.title)}</p>${agenda.groups.map((group) => `<div class="agenda-group"><strong>${esc(group.label)}</strong><ul>${group.items.map((item) => `<li>${esc(item)}</li>`).join("")}</ul></div>`).join("")}</div>`).join("")}</section>`;

function blocksHtml(blocks: Block[], doc: ExportDoc): string {
  let out = "";
  for (let i = 0; i < blocks.length; i += 1) {
    const block = blocks[i]!;
    const inner = spansHtml(block.text);
    const kids = block.children?.length ? blocksHtml(block.children, doc) : "";
    if (block.type === "bulleted" || block.type === "numbered" || block.type === "todo") {
      const tag = block.type === "numbered" ? "ol" : "ul";
      let items = "";
      while (i < blocks.length && (blocks[i]!.type === block.type)) {
        const entry = blocks[i]!;
        const box = entry.type === "todo" ? `<span class="box${entry.props?.checked ? " on" : ""}"></span>` : "";
        items += `<li class="${entry.type}">${box}${spansHtml(entry.text)}${entry.children?.length ? blocksHtml(entry.children, doc) : ""}</li>`;
        i += 1;
      }
      i -= 1;
      out += `<${tag}>${items}</${tag}>`;
      continue;
    }
    switch (block.type) {
      case "h1": case "toggle_h1": out += `<h2>${inner}</h2>${kids}`; break;
      case "h2": case "toggle_h2": out += `<h3>${inner}</h3>${kids}`; break;
      case "h3": case "toggle_h3": case "h4": out += `<h4>${inner}</h4>${kids}`; break;
      case "quote": out += `<blockquote>${inner}${kids}</blockquote>`; break;
      case "callout": { const tone = toneOf(block.props?.color); const icon = String(block.props?.icon ?? ""); out += `<div class="callout" style="background:#${tone.bg}">${icon ? `<span class="callout-icon">${esc(icon)}</span>` : ""}<div>${inner}${kids}</div></div>`; break; }
      case "divider": out += "<hr>"; break;
      case "code": out += `<pre><code>${esc(block.text.map((span) => span.t).join(""))}</code></pre>`; break;
      case "equation": out += `<p class="eq-block">${esc(block.text.map((span) => span.t).join(""))}</p>`; break;
      case "table": out += tableHtml({ columns: ((block.props?.rows as string[][]) || [[]])[0] ?? [], rows: ((block.props?.rows as string[][]) || []).slice(1) }); break;
      case "image": out += block.props?.url ? `<figure><img src="${esc(String(block.props.url))}" alt="">${block.props?.caption ? `<figcaption>${esc(String(block.props.caption))}</figcaption>` : ""}</figure>` : ""; break;
      case "bookmark": case "embed": case "video": case "audio": case "file": case "pdf": out += block.props?.url ? `<p><a href="${esc(String(block.props.url))}">${esc(String(block.props?.title || block.props?.caption || block.props.url))}</a></p>` : ""; break;
      case "database": { const found = doc.databases.get(String(block.props?.pageId)); out += found ? embeddedHtml(found) : ""; break; }
      case "columns": out += `<div class="columns">${(block.children ?? []).map((column) => `<div>${blocksHtml(column.children ?? [], doc)}</div>`).join("")}</div>`; break;
      case "tabs": out += (block.children ?? []).map((tab) => `<h4>${esc(String((tab.props as Record<string, unknown>)?.title || "Tab"))}</h4>${blocksHtml(tab.children ?? [], doc)}`).join(""); break;
      case "toggle": out += `<details open><summary>${inner}</summary>${kids}</details>`; break;
      case "key_term": out += `<p><strong>${esc(String(block.props?.term || ""))}</strong> — ${inner}</p>`; break;
      case "toc": case "breadcrumb": case "focus_timer": case "button": break;
      case "link_to_page": case "page": out += `<p class="mention">${esc(String(block.props?.title || "Untitled"))}</p>`; break;
      default: out += inner ? `<p>${inner}</p>${kids}` : kids || "<p>&nbsp;</p>";
    }
  }
  return out;
}

export function toHtml(doc: ExportDoc): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(doc.title)}</title><style>
@page { size: A4; margin: 22mm 20mm; }
* { box-sizing: border-box; }
body { margin: 0; color: #1f1f1d; font: 11pt/1.6 -apple-system, "Segoe UI", Inter, Helvetica, Arial, sans-serif; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
h1.title { margin: 0 0 14pt; font-size: 26pt; line-height: 1.15; letter-spacing: -.02em; }
h2 { margin: 20pt 0 6pt; font-size: 18pt; } h3 { margin: 16pt 0 5pt; font-size: 14pt; } h4 { margin: 12pt 0 4pt; font-size: 12pt; }
p { margin: 0 0 7pt; } ul, ol { margin: 0 0 8pt; padding-left: 18pt; } li { margin: 2pt 0; } li.todo { list-style: none; margin-left: -18pt; }
.box { display: inline-block; width: 9pt; height: 9pt; margin-right: 6pt; border: 1pt solid #8a8a85; border-radius: 2pt; vertical-align: -1pt; } .box.on { background: #2f6fed; border-color: #2f6fed; }
blockquote { margin: 8pt 0; padding: 2pt 0 2pt 12pt; border-left: 3pt solid #cfcfca; color: #4a4a46; }
.callout { display: flex; gap: 9pt; margin: 8pt 0; padding: 10pt 12pt; border-radius: 6pt; } .callout-icon { font-size: 13pt; }
pre { margin: 8pt 0; padding: 10pt 12pt; border-radius: 6pt; background: #f4f4f2; font: 9.5pt/1.5 ui-monospace, Menlo, Consolas, monospace; white-space: pre-wrap; }
code { font-family: ui-monospace, Menlo, Consolas, monospace; font-size: .92em; background: #f1f1ef; padding: 0 3pt; border-radius: 3pt; } pre code { background: none; padding: 0; }
table { width: 100%; margin: 8pt 0 12pt; border-collapse: collapse; font-size: 10pt; page-break-inside: auto; } tr { page-break-inside: avoid; }
th { background: #f1f1ef; text-align: left; font-weight: 600; } th, td { padding: 5pt 8pt; border: .75pt solid #d9d9d5; vertical-align: top; }
hr { margin: 14pt 0; border: 0; border-top: .75pt solid #d9d9d5; }
figure { margin: 10pt 0; } img { max-width: 100%; } figcaption { color: #777; font-size: 9.5pt; }
.columns { display: flex; gap: 16pt; } .columns > div { flex: 1; min-width: 0; }
.db h4 { margin-top: 10pt; } .agenda { margin: 6pt 0; } .agenda-title { color: #777; font-style: italic; margin: 0 0 3pt; } .agenda-group ul { margin: 0 0 4pt; }
a { color: #1a5fd0; } .eq, .eq-block { font-family: "Times New Roman", serif; font-style: italic; } .mention { color: #1a5fd0; }
details summary { font-weight: 600; }
</style></head><body><h1 class="title">${doc.icon ? `${esc(doc.icon)} ` : ""}${esc(doc.title)}</h1>${doc.self ? embeddedHtml(doc.self) : ""}${blocksHtml(doc.blocks, doc)}</body></html>`;
}

/* --------------------------------------------------------------------- PDF */

export async function toPdf(doc: ExportDoc): Promise<Buffer | null> {
  let chromium: { launch: (options: Record<string, unknown>) => Promise<any> } | null = null;
  try { chromium = ((await import("playwright")) as any).chromium; } catch { try { chromium = ((await import("playwright-core")) as any).chromium; } catch { chromium = null; } }
  if (!chromium) return null;
  let browser: any = null;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.setContent(toHtml(doc), { waitUntil: "load" });
    const pdf = await page.pdf({
      format: "A4", printBackground: true, displayHeaderFooter: true,
      margin: { top: "22mm", bottom: "22mm", left: "20mm", right: "20mm" },
      headerTemplate: "<span></span>",
      footerTemplate: `<div style="width:100%;font:8px -apple-system,Helvetica,sans-serif;color:#999;display:flex;justify-content:space-between;padding:0 20mm"><span>${esc(doc.title).slice(0, 60)}</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>`,
    });
    return Buffer.from(pdf);
  } catch { return null; } finally { await browser?.close().catch(() => {}); }
}

/* -------------------------------------------------------------------- DOCX */

const xml = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");

type Ctx = { rels: Array<{ id: string; url: string }>; lists: Array<{ ordered: boolean }>; media: Array<{ id: string; name: string; data: Buffer; ext: string }>; invert?: boolean; tone?: string };

/* The look of a designed template line, carried into Word. */
const ROLE_RPR: Record<string, string> = {
  "t-label": '<w:b/><w:caps/><w:spacing w:val="18"/><w:sz w:val="16"/><w:szCs w:val="16"/><w:color w:val="787774"/>',
  "t-kicker": '<w:b/><w:caps/><w:spacing w:val="16"/><w:sz w:val="17"/><w:szCs w:val="17"/><w:color w:val="5A5A56"/>',
  "t-big": '<w:b/><w:sz w:val="40"/><w:szCs w:val="40"/>',
  "t-mast": '<w:b/><w:sz w:val="46"/><w:szCs w:val="46"/>',
  "t-small": '<w:sz w:val="18"/><w:szCs w:val="18"/><w:color w:val="787774"/>',
  "t-lead": '<w:sz w:val="26"/><w:szCs w:val="26"/><w:color w:val="3A3A37"/>',
  "t-mono": '<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:cs="Consolas"/><w:sz w:val="18"/>',
  "t-right": '<w:sz w:val="18"/><w:color w:val="787774"/>',
};
const PANEL_FILL = "23252A", WASH_FILL = "F4F3F1";

/* Real image bytes for an image block: an uploaded file or a data URI. */
function imageBytes(url: string): { data: Buffer; ext: string } | null {
  try {
    if (url.startsWith("data:image/")) {
      const match = url.match(/^data:image\/(png|jpe?g|gif);base64,(.+)$/i);
      return match ? { data: Buffer.from(match[2]!, "base64"), ext: match[1]!.toLowerCase().replace("jpg", "jpeg") } : null;
    }
    const local = url.match(/^\/notes-files\/([^?#]+)/);
    if (!local) return null;
    const name = path.basename(decodeURIComponent(local[1]!));
    const data = readFileSync(path.join(process.cwd(), "data", "notes", "files", name));
    const ext = path.extname(name).slice(1).toLowerCase().replace("jpg", "jpeg");
    return ["png", "jpeg", "gif"].includes(ext) ? { data, ext } : null;
  } catch { return null; }
}
/* Pixel size from the PNG, GIF or JPEG header, so the picture keeps its shape. */
function imageSize(data: Buffer): { w: number; h: number } {
  if (data.readUInt32BE(0) === 0x89504e47) return { w: data.readUInt32BE(16), h: data.readUInt32BE(20) };
  if (data.toString("ascii", 0, 3) === "GIF") return { w: data.readUInt16LE(6), h: data.readUInt16LE(8) };
  for (let i = 2; i < data.length - 9;) {
    if (data[i] !== 0xff) { i += 1; continue; }
    const marker = data[i + 1]!;
    if (marker >= 0xc0 && marker <= 0xc3) return { w: data.readUInt16BE(i + 7), h: data.readUInt16BE(i + 5) };
    i += 2 + data.readUInt16BE(i + 2);
  }
  return { w: 800, h: 600 };
}
function imageXml(bytes: { data: Buffer; ext: string }, ctx: Ctx, alt: string, widthPct = 100): string {
  const id = `rIdImg${ctx.media.length + 1}`;
  const name = `image${ctx.media.length + 1}.${bytes.ext === "jpeg" ? "jpeg" : bytes.ext}`;
  ctx.media.push({ id, name, data: bytes.data, ext: bytes.ext });
  const { w, h } = imageSize(bytes.data);
  const maxEmu = Math.round(5_900_000 * Math.min(100, Math.max(10, widthPct)) / 100);
  const cx = Math.min(maxEmu, w * 9525), cy = Math.round(cx * (h / Math.max(1, w)));
  const n = ctx.media.length;
  return para(`<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${n}" name="Picture ${n}" descr="${xml(alt)}"/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="${n}" name="${name}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${id}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`, '<w:spacing w:before="80" w:after="120"/>');
}

function runsXml(spans: Span[] | undefined, ctx: Ctx, base = ""): string {
  const list = spans && spans.length ? spans : [];
  return list.map((span) => {
    const props = [
      base,
      ctx.invert && !span.href ? '<w:color w:val="F4F3F0"/>' : "",
      span.b ? "<w:b/>" : "", span.i || span.eq ? "<w:i/>" : "", span.u ? '<w:u w:val="single"/>' : "", span.s ? "<w:strike/>" : "",
      span.c ? '<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:cs="Consolas"/><w:sz w:val="20"/><w:shd w:val="clear" w:color="auto" w:fill="F1F1EF"/>' : "",
      span.href || span.page ? '<w:color w:val="1A5FD0"/><w:u w:val="single"/>' : "",
      (span.col && TONES[span.col] && !span.href) ? `<w:color w:val="${TONES[span.col]!.fg}"/>` : hex(span.colHex) ? `<w:color w:val="${hex(span.colHex)}"/>` : "",
      span.bg && TONES[span.bg] ? `<w:shd w:val="clear" w:color="auto" w:fill="${TONES[span.bg]!.bg}"/>` : hex(span.bgHex) ? `<w:shd w:val="clear" w:color="auto" w:fill="${hex(span.bgHex)}"/>` : "",
    ].join("");
    const text = span.eq ? span.eq : span.t ?? "";
    const parts = text.split("\n").map((line) => `<w:t xml:space="preserve">${xml(line)}</w:t>`).join("<w:br/>");
    const run = `<w:r>${props ? `<w:rPr>${props}</w:rPr>` : ""}${parts}</w:r>`;
    if (span.href) {
      const id = `rIdL${ctx.rels.length + 1}`;
      ctx.rels.push({ id, url: span.href });
      return `<w:hyperlink r:id="${id}" w:history="1">${run}</w:hyperlink>`;
    }
    return run;
  }).join("");
}

const para = (inner: string, pPr = "") => `<w:p>${pPr ? `<w:pPr>${pPr}</w:pPr>` : ""}${inner}</w:p>`;
const textRun = (text: string, rPr = "") => `<w:r>${rPr ? `<w:rPr>${rPr}</w:rPr>` : ""}<w:t xml:space="preserve">${xml(text)}</w:t></w:r>`;
const BORDER = (color = "D9D9D5", size = 4) => ["top", "left", "bottom", "right", "insideH", "insideV"].map((side) => `<w:${side} w:val="single" w:sz="${size}" w:space="0" w:color="${color}"/>`).join("");
const NO_BORDER = ["top", "left", "bottom", "right", "insideH", "insideV"].map((side) => `<w:${side} w:val="nil"/>`).join("");

function tableXml(table: Table, ctx: Ctx, header = true): string {
  const width = Math.max(1, table.columns.length || (table.rows[0]?.length ?? 1));
  const cell = (value: string, head: boolean) => `<w:tc><w:tcPr><w:tcW w:w="${Math.floor(5000 / width)}" w:type="pct"/>${head ? '<w:shd w:val="clear" w:color="auto" w:fill="F1F1EF"/>' : ""}<w:tcMar><w:top w:w="70" w:type="dxa"/><w:left w:w="110" w:type="dxa"/><w:bottom w:w="70" w:type="dxa"/><w:right w:w="110" w:type="dxa"/></w:tcMar></w:tcPr>${para(textRun(value, head ? "<w:b/>" : ""), '<w:spacing w:after="0"/>')}</w:tc>`;
  const rows = [
    ...(header && table.columns.length ? [`<w:tr><w:trPr><w:tblHeader/><w:cantSplit/></w:trPr>${table.columns.map((column) => cell(column, true)).join("")}</w:tr>`] : []),
    ...table.rows.map((row) => `<w:tr><w:trPr><w:cantSplit/></w:trPr>${Array.from({ length: width }, (_, index) => cell(row[index] ?? "", false)).join("")}</w:tr>`),
  ].join("");
  return `<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"/><w:tblBorders>${BORDER()}</w:tblBorders><w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid>${Array.from({ length: width }, () => `<w:gridCol w:w="${Math.floor(9412 / width)}"/>`).join("")}</w:tblGrid>${rows}</w:tbl>${para("", '<w:spacing w:after="80"/>')}`;
}

function embeddedXml(embedded: Embedded, ctx: Ctx): string {
  const extra = [...embedded.agendas, ...embedded.boards].map((agenda) =>
    para(textRun(agenda.title, "<w:i/><w:color w:val=\"787774\"/>"), '<w:spacing w:before="120" w:after="40"/>') + agenda.groups.map((group) =>
      para(textRun(group.label, "<w:b/>"), '<w:keepNext/><w:spacing w:after="0"/>') + group.items.map((item) => para(textRun(item), '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr><w:spacing w:after="0"/>')).join("")).join("")).join("");
  return para(textRun(embedded.name, "<w:b/>"), '<w:keepNext/><w:spacing w:before="160" w:after="60"/>') + tableXml(embedded.table, ctx) + extra;
}

function blocksXml(blocks: Block[], doc: ExportDoc, ctx: Ctx, level = 0): string {
  let out = "";
  const indent = level ? `<w:ind w:left="${level * 360}"/>` : "";
  for (let i = 0; i < blocks.length; i += 1) {
    const block = blocks[i]!;
    const kids = () => (block.children?.length ? blocksXml(block.children, doc, ctx, level + 1) : "");
    if (block.type === "bulleted" || block.type === "numbered" || block.type === "todo") {
      /* One numbering instance per run of numbered items, so each list restarts at 1. */
      let numId = 1;
      if (block.type === "numbered") { ctx.lists.push({ ordered: true }); numId = 100 + ctx.lists.length; }
      while (i < blocks.length && blocks[i]!.type === block.type) {
        const entry = blocks[i]!;
        const ilvl = Math.min(level, 3);
        if (entry.type === "todo") out += para(textRun(entry.props?.checked ? "☑ " : "☐ ", "<w:rFonts w:ascii=\"Segoe UI Symbol\" w:hAnsi=\"Segoe UI Symbol\"/>") + runsXml(entry.text, ctx, entry.props?.checked ? "<w:color w:val=\"787774\"/><w:strike/>" : ""), `<w:spacing w:after="40"/>${indent || '<w:ind w:left="0"/>'}`);
        else out += para(runsXml(entry.text, ctx), `<w:numPr><w:ilvl w:val="${ilvl}"/><w:numId w:val="${entry.type === "numbered" ? numId : 1}"/></w:numPr><w:spacing w:after="40"/>`);
        if (entry.children?.length) out += blocksXml(entry.children, doc, ctx, level + 1);
        i += 1;
      }
      i -= 1;
      continue;
    }
    switch (block.type) {
      case "h1": case "toggle_h1": out += para(runsXml(block.text, ctx), '<w:pStyle w:val="Heading1"/>') + kids(); break;
      case "h2": case "toggle_h2": out += para(runsXml(block.text, ctx), '<w:pStyle w:val="Heading2"/>') + kids(); break;
      case "h3": case "toggle_h3": out += para(runsXml(block.text, ctx), '<w:pStyle w:val="Heading3"/>') + kids(); break;
      case "h4": out += para(runsXml(block.text, ctx), '<w:pStyle w:val="Heading4"/>') + kids(); break;
      case "quote": out += para(runsXml(block.text, ctx, "<w:i/>"), '<w:pStyle w:val="Quote"/>') + kids(); break;
      case "callout": {
        const tone = toneOf(block.props?.color); const icon = String(block.props?.icon ?? "");
        const lead = icon ? textRun(`${icon}  `) : "";
        const children = block.children?.length ? blocksXml(block.children, doc, ctx, 0) : "";
        out += `<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"/><w:tblBorders>${NO_BORDER}</w:tblBorders><w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid><w:gridCol w:w="9412"/></w:tblGrid><w:tr><w:tc><w:tcPr><w:tcW w:w="5000" w:type="pct"/><w:shd w:val="clear" w:color="auto" w:fill="${tone.bg}"/><w:tcMar><w:top w:w="110" w:type="dxa"/><w:left w:w="170" w:type="dxa"/><w:bottom w:w="110" w:type="dxa"/><w:right w:w="170" w:type="dxa"/></w:tcMar></w:tcPr>${para(lead + runsXml(block.text, ctx), '<w:spacing w:after="0"/>')}${children}</w:tc></w:tr></w:tbl>${para("", '<w:spacing w:after="60"/>')}`;
        break;
      }
      case "divider": out += para("", '<w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="D9D9D5"/></w:pBdr><w:spacing w:before="120" w:after="120"/>'); break;
      case "code": out += block.text.map((span) => span.t).join("").split("\n").map((line, index, all) => para(textRun(line || " ", '<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:cs="Consolas"/><w:sz w:val="19"/>'), `<w:pStyle w:val="Code"/>${index === 0 ? "<w:spacing w:before=\"80\" w:after=\"0\"/>" : index === all.length - 1 ? "<w:spacing w:after=\"120\"/>" : "<w:spacing w:after=\"0\"/>"}`)).join(""); break;
      case "equation": out += para(textRun(block.text.map((span) => span.t).join(""), '<w:rFonts w:ascii="Cambria Math" w:hAnsi="Cambria Math"/><w:i/>'), '<w:jc w:val="center"/>'); break;
      case "table": { const rows = (block.props?.rows as string[][]) || []; if (rows.length) out += tableXml({ columns: rows[0]!, rows: rows.slice(1) }, ctx, block.props?.hasHeader !== false); break; }
      case "image": case "video": case "audio": case "file": case "pdf": case "bookmark": case "embed": {
        const url = String(block.props?.url || "");
        if (block.type === "image" && url) {
          const bytes = imageBytes(url);
          if (bytes) {
            out += imageXml(bytes, ctx, String(block.props?.caption || block.props?.alt || "Image"), Number(block.props?.width) || 100);
            if (block.props?.caption) out += para(textRun(String(block.props.caption), '<w:i/><w:sz w:val="18"/><w:color w:val="787774"/>'), '<w:jc w:val="center"/><w:spacing w:after="120"/>');
            break;
          }
        }
        const label = String(block.props?.title || block.props?.caption || (block.type === "image" ? "Image" : block.props?.name || url || block.type));
        if (url) out += para(runsXml([{ t: label, href: url.startsWith("/") ? `http://127.0.0.1:31415${url}` : url }], ctx), indent);
        break;
      }
      case "database": { const found = doc.databases.get(String(block.props?.pageId)); if (found) out += embeddedXml(found, ctx); break; }
      case "columns": {
        const cols = block.children ?? [];
        const styleName = String(block.props?.templateStyle || "");
        const has = (name: string) => styleName.split(/\s+/).includes(name);
        if (block.props?.templateTone) ctx.tone = String(block.props.templateTone);
        const dark = ctx.tone && TONES[ctx.tone] && ctx.tone !== "gray" ? TONES[ctx.tone]!.fg : PANEL_FILL;
        const wash = ctx.tone && TONES[ctx.tone] ? TONES[ctx.tone]!.bg : WASH_FILL;
        /* A one-column wrapper is layout, not a table: write its contents straight out — unless it is a shaded panel. */
        if (cols.length === 1 && !has("r-panel")) { out += blocksXml(cols[0]!.children ?? [], doc, ctx, level); break; }
        const fillFor = (index: number): { fill?: string; invert?: boolean } => {
          if (has("r-side") && index === 0) return { fill: dark, invert: true };
          if (has("r-panel")) return { fill: wash };
          if (has("r-cards") || has("r-week") || has("r-wall")) return { fill: wash };
          if (has("hub") && index === 1) return { fill: dark, invert: true };
          return {};
        };
        const topRule = has("r-kpi") || has("r-facts") || has("r-masthead") ? '<w:tblBorders><w:top w:val="single" w:sz="8" w:space="0" w:color="1F1F1D"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="D9D9D5"/><w:left w:val="nil"/><w:right w:val="nil"/><w:insideH w:val="nil"/><w:insideV w:val="nil"/></w:tblBorders>' : `<w:tblBorders>${NO_BORDER}</w:tblBorders>`;
        const widths = has("r-side") ? [30, 70] : has("r-cue") ? [28, 72] : has("r-dated") || has("r-num") ? [18, 82] : has("r-totals") ? [55, 45] : cols.map(() => 100 / cols.length);
        out += `<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"/>${topRule}<w:tblLayout w:type="fixed"/><w:tblCellSpacing w:w="${has("r-cards") || has("r-week") || has("r-wall") ? 60 : 0}" w:type="dxa"/></w:tblPr><w:tblGrid>${cols.map((_, index) => `<w:gridCol w:w="${Math.round(94.12 * (widths[index] ?? 100 / cols.length))}"/>`).join("")}</w:tblGrid><w:tr><w:trPr><w:cantSplit/></w:trPr>${cols.map((column, index) => {
          const look = fillFor(index);
          const before = ctx.invert;
          if (look.invert) ctx.invert = true;
          const inner = blocksXml(column.children ?? [], doc, ctx, 0) || para("");
          ctx.invert = before;
          const pad = look.fill ? 160 : 90;
          return `<w:tc><w:tcPr><w:tcW w:w="${Math.round(50 * (widths[index] ?? 100 / cols.length))}" w:type="pct"/>${look.fill ? `<w:shd w:val="clear" w:color="auto" w:fill="${look.fill}"/>` : ""}<w:tcMar><w:top w:w="${look.fill ? 140 : 60}" w:type="dxa"/><w:left w:w="${pad}" w:type="dxa"/><w:bottom w:w="${look.fill ? 140 : 60}" w:type="dxa"/><w:right w:w="${pad}" w:type="dxa"/></w:tcMar></w:tcPr>${inner}</w:tc>`;
        }).join("")}</w:tr></w:tbl>${para("", '<w:spacing w:after="60"/>')}`;
        break;
      }
      case "tabs": out += (block.children ?? []).map((tab) => para(textRun(String((tab.props as Record<string, unknown>)?.title || "Tab")), '<w:pStyle w:val="Heading3"/>') + blocksXml(tab.children ?? [], doc, ctx, level)).join(""); break;
      case "toggle": out += para(runsXml(block.text, ctx, "<w:b/>"), '<w:keepNext/><w:spacing w:after="40"/>') + kids(); break;
      case "key_term": out += para(textRun(String(block.props?.term || ""), "<w:b/>") + textRun(" — ") + runsXml(block.text, ctx), indent); break;
      case "toc": case "breadcrumb": case "focus_timer": case "button": break;
      case "link_to_page": case "page": out += para(textRun(String(block.props?.title || "Untitled"), '<w:color w:val="1A5FD0"/><w:u w:val="single"/>'), indent); break;
      default: {
        const role = String(block.props?.templateRole || "");
        const rPr = ROLE_RPR[role] ?? "";
        const pPr = role === "t-right" ? '<w:jc w:val="right"/>' : "";
        const spacing = role === "t-label" || role === "t-kicker" ? '<w:spacing w:before="60" w:after="20"/>' : role === "t-big" || role === "t-mast" ? '<w:spacing w:after="20"/>' : '<w:spacing w:after="100"/>';
        out += para(runsXml(block.text, ctx, rPr), `${indent}${pPr}${spacing}`) + kids();
      }
    }
  }
  return out;
}

/* A minimal ZIP writer: stored directory plus deflated entries. */
const CRC_TABLE = (() => { const table = new Uint32Array(256); for (let n = 0; n < 256; n += 1) { let c = n; for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; table[n] = c >>> 0; } return table; })();
const crc32 = (buffer: Buffer) => { let c = 0xffffffff; for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff]! ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function zip(files: Array<{ name: string; data: Buffer }>): Buffer {
  const chunks: Buffer[] = []; const central: Buffer[] = []; let offset = 0;
  for (const file of files) {
    const name = Buffer.from(file.name); const packed = deflateRawSync(file.data); const crc = crc32(file.data);
    const header = Buffer.alloc(30); header.writeUInt32LE(0x04034b50, 0); header.writeUInt16LE(20, 4); header.writeUInt16LE(0x0800, 6); header.writeUInt16LE(8, 8); header.writeUInt16LE(0, 10); header.writeUInt16LE(0x21, 12);
    header.writeUInt32LE(crc, 14); header.writeUInt32LE(packed.length, 18); header.writeUInt32LE(file.data.length, 22); header.writeUInt16LE(name.length, 26);
    chunks.push(header, name, packed);
    const entry = Buffer.alloc(46); entry.writeUInt32LE(0x02014b50, 0); entry.writeUInt16LE(20, 4); entry.writeUInt16LE(20, 6); entry.writeUInt16LE(0x0800, 8); entry.writeUInt16LE(8, 10); entry.writeUInt16LE(0, 12); entry.writeUInt16LE(0x21, 14);
    entry.writeUInt32LE(crc, 16); entry.writeUInt32LE(packed.length, 20); entry.writeUInt32LE(file.data.length, 24); entry.writeUInt16LE(name.length, 28); entry.writeUInt32LE(offset, 42);
    central.push(entry, name);
    offset += header.length + name.length + packed.length;
  }
  const centralBuffer = Buffer.concat(central);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(centralBuffer.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...chunks, centralBuffer, end]);
}

const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"';
const FONT = '<w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Calibri" w:cs="Calibri"/>';
const style = (id: string, name: string, pPr: string, rPr: string, extra = "") => `<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${name}"/><w:basedOn w:val="Normal"/>${extra}<w:qFormat/><w:pPr>${pPr}</w:pPr><w:rPr>${rPr}</w:rPr></w:style>`;

export function toDocx(doc: ExportDoc): Buffer {
  const ctx: Ctx = { rels: [], lists: [], media: [] };
  const title = para(textRun(`${doc.icon ? `${doc.icon}  ` : ""}${doc.title}`), '<w:pStyle w:val="Title"/>');
  const body = (doc.self ? embeddedXml(doc.self, ctx) : "") + blocksXml(doc.blocks, doc, ctx);
  const sect = '<w:sectPr><w:footerReference w:type="default" r:id="rIdFooter"/><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1304" w:right="1247" w:bottom="1304" w:left="1247" w:header="708" w:footer="567" w:gutter="0"/></w:sectPr>';
  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${NS}><w:body>${title}${body}${sect}</w:body></w:document>`;
  const footer = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:ftr ${NS}><w:p><w:pPr><w:pBdr><w:top w:val="single" w:sz="4" w:space="6" w:color="D9D9D5"/></w:pBdr><w:tabs><w:tab w:val="right" w:pos="9400"/></w:tabs></w:pPr>${textRun(doc.title.slice(0, 70), '<w:color w:val="8A8A85"/><w:sz w:val="16"/>')}<w:r><w:rPr><w:color w:val="8A8A85"/><w:sz w:val="16"/></w:rPr><w:tab/></w:r><w:r><w:rPr><w:color w:val="8A8A85"/><w:sz w:val="16"/></w:rPr><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:rPr><w:color w:val="8A8A85"/><w:sz w:val="16"/></w:rPr><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r><w:r><w:rPr><w:color w:val="8A8A85"/><w:sz w:val="16"/></w:rPr><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:rPr><w:color w:val="8A8A85"/><w:sz w:val="16"/></w:rPr><w:t>1</w:t></w:r><w:r><w:rPr><w:color w:val="8A8A85"/><w:sz w:val="16"/></w:rPr><w:fldChar w:fldCharType="end"/></w:r></w:p></w:ftr>`;
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles ${NS}><w:docDefaults><w:rPrDefault><w:rPr>${FONT}<w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="en-GB"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="100" w:line="300" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>
${style("Title", "Title", '<w:spacing w:before="0" w:after="240"/>', '<w:b/><w:sz w:val="52"/><w:szCs w:val="52"/><w:color w:val="1F1F1D"/>')}
${style("Heading1", "heading 1", '<w:keepNext/><w:spacing w:before="360" w:after="100"/><w:outlineLvl w:val="0"/>', '<w:b/><w:sz w:val="36"/><w:szCs w:val="36"/><w:color w:val="1F1F1D"/>', '<w:next w:val="Normal"/>')}
${style("Heading2", "heading 2", '<w:keepNext/><w:spacing w:before="300" w:after="80"/><w:outlineLvl w:val="1"/>', '<w:b/><w:sz w:val="30"/><w:szCs w:val="30"/><w:color w:val="1F1F1D"/>', '<w:next w:val="Normal"/>')}
${style("Heading3", "heading 3", '<w:keepNext/><w:spacing w:before="240" w:after="60"/><w:outlineLvl w:val="2"/>', '<w:b/><w:sz w:val="26"/><w:szCs w:val="26"/><w:color w:val="2B2B28"/>', '<w:next w:val="Normal"/>')}
${style("Heading4", "heading 4", '<w:keepNext/><w:spacing w:before="200" w:after="40"/><w:outlineLvl w:val="3"/>', '<w:b/><w:sz w:val="23"/><w:szCs w:val="23"/><w:color w:val="4A4A46"/>', '<w:next w:val="Normal"/>')}
${style("Quote", "Quote", '<w:pBdr><w:left w:val="single" w:sz="18" w:space="10" w:color="CFCFCA"/></w:pBdr><w:spacing w:before="80" w:after="80"/><w:ind w:left="320"/>', '<w:color w:val="4A4A46"/>')}
${style("Code", "Code", '<w:shd w:val="clear" w:color="auto" w:fill="F4F4F2"/><w:ind w:left="120" w:right="120"/>', '<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:cs="Consolas"/><w:sz w:val="19"/>')}
</w:styles>`;
  const levels = (format: "bullet" | "decimal") => Array.from({ length: 4 }, (_, level) => `<w:lvl w:ilvl="${level}"><w:start w:val="1"/><w:numFmt w:val="${format}"/><w:lvlText w:val="${format === "bullet" ? ["•", "◦", "▪", "•"][level] : `%${level + 1}.`}"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="${540 + level * 360}" w:hanging="300"/></w:pPr></w:lvl>`).join("");
  const numbering = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:numbering ${NS}><w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="hybridMultilevel"/>${levels("bullet")}</w:abstractNum><w:abstractNum w:abstractNumId="1"><w:multiLevelType w:val="hybridMultilevel"/>${levels("decimal")}</w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>${ctx.lists.map((_, index) => `<w:num w:numId="${101 + index}"><w:abstractNumId w:val="1"/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="1"/></w:lvlOverride></w:num>`).join("")}</w:numbering>`;
  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rIdNum" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/><Relationship Id="rIdFooter" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/>${ctx.rels.map((rel) => `<Relationship Id="${rel.id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="${xml(rel.url)}" TargetMode="External"/>`).join("")}${ctx.media.map((m) => `<Relationship Id="${m.id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${m.name}"/>`).join("")}</Relationships>`;
  const now = new Date().toISOString();
  const files = [
    { name: "[Content_Types].xml", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Default Extension="jpeg" ContentType="image/jpeg"/><Default Extension="gif" ContentType="image/gif"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/><Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>` },
    { name: "_rels/.rels", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>` },
    { name: "docProps/core.xml", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${xml(doc.title)}</dc:title><dc:creator>Clyra Notes</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>` },
    { name: "word/document.xml", data: document }, { name: "word/styles.xml", data: styles }, { name: "word/numbering.xml", data: numbering }, { name: "word/footer1.xml", data: footer }, { name: "word/_rels/document.xml.rels", data: rels },
  ].map((file) => ({ name: file.name, data: Buffer.from(file.data, "utf8") }));
  for (const media of ctx.media) files.push({ name: `word/media/${media.name}`, data: media.data });
  return zip(files);
}

export type ExportFormat = "docx" | "md" | "pdf" | "html";
export const EXPORT_TYPES: Record<ExportFormat, string> = {
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", md: "text/markdown; charset=utf-8", pdf: "application/pdf", html: "text/html; charset=utf-8",
};

export async function exportPage(pageId: string, format: ExportFormat): Promise<{ body: Buffer; type: string; filename: string } | { error: string; status: number }> {
  const doc = loadDoc(pageId);
  if (!doc) return { error: "That note cannot be exported (missing or locked).", status: 404 };
  if (format === "docx") return { body: toDocx(doc), type: EXPORT_TYPES.docx, filename: exportFileName(doc, "docx") };
  if (format === "md") return { body: Buffer.from(toMarkdown(doc), "utf8"), type: EXPORT_TYPES.md, filename: exportFileName(doc, "md") };
  if (format === "html") return { body: Buffer.from(toHtml(doc), "utf8"), type: EXPORT_TYPES.html, filename: exportFileName(doc, "html") };
  const pdf = await toPdf(doc);
  if (!pdf) return { error: "PDF rendering is not available here; use the print dialog.", status: 501 };
  return { body: pdf, type: EXPORT_TYPES.pdf, filename: exportFileName(doc, "pdf") };
}
export { spansToMarkdown };
