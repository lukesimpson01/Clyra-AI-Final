/* Writes public/notes/templates-catalog.json: every template as data (its
   blocks, databases, layout), so the assistant can know what each template is
   for and how it looks, and create pages from them on the server.

   Usage: node tools/notes-templates-catalog.mjs [--url http://127.0.0.1:31415] */
import { chromium } from "playwright";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const index = process.argv.indexOf("--url");
const base = (index >= 0 ? process.argv[index + 1] : process.env.NOTES_URL || "http://localhost:3000").replace(/\/$/, "");
const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(`${base}/notes/template-preview.html?id=blank`, { waitUntil: "networkidle" });
const data = await page.evaluate(async () => {
  const { TEMPLATES, templateBlocks } = await import("/notes/js/templates-data.js");
  return TEMPLATES.map((t) => ({ id: t.id, name: t.name, category: t.category || t.subject, description: t.desc, layout: t.layout || "page", look: t.look || "", emoji: t.emoji || "", cover: t.cover || null, blocks: JSON.parse(JSON.stringify(templateBlocks(t))), databases: JSON.parse(JSON.stringify(t.databases || [])) }));
});
await browser.close();
await writeFile(path.join(root, "public", "notes", "templates-catalog.json"), JSON.stringify(data));
console.log(`Wrote ${data.length} templates`);
