/* Captures the template gallery previews.

   Every card in the templates modal shows a real screenshot of the page that
   template builds, taken from the same editor and stylesheet the workspace
   uses. Generating them here rather than drawing an approximation means a
   preview cannot describe a page the template does not actually produce.

   Usage:  node tools/notes-template-shots.mjs [--url http://localhost:3000] [--only id,id]
   The dev server must already be running (npm run dev). */
import { chromium } from "playwright";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "public", "notes", "img", "templates");

const arg = (name, fallback) => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
};
const base = (arg("url", process.env.NOTES_URL || "http://localhost:3000")).replace(/\/$/, "");

/* Every template in the library is active. Read the source rather than import
   it: the browser editor module graph has an import cycle Node cannot
   initialise on its own. */
async function templateIds() {
  const source = await readFile(path.join(root, "public", "notes", "js", "template-library-v3.js"), "utf8");
  return [...source.matchAll(/\badd\(\s*[A-Z]+,\s*"([a-z0-9-]+)"/g)].map((match) => match[1]);
}

const FRAME = { width: 720, height: 500 };
/* The gallery is a set of real viewports into the same rendered template:
   opening context, the next useful section, and the working area further
   down. These are captures of the actual page, never drawn stand-ins. */
const VIEWS = [
  { suffix: "", offset: 0 },
  { suffix: "-detail", offset: 260 },
  { suffix: "-workflow", offset: 520 },
];

async function main() {
  const only = arg("only", "");
  const wanted = only ? new Set(only.split(",").map((id) => id.trim()).filter(Boolean)) : null;
  const ids = (await templateIds()).filter((id) => !wanted || wanted.has(id));
  if (!ids.length) throw new Error("No template ids found in templates-data.js");
  await mkdir(outDir, { recursive: true });

  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1000, height: 900 },
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();
  const failures = [];

  for (const id of ids) {
    for (const theme of ["light", "dark"]) {
      const url = `${base}/notes/template-preview.html?id=${encodeURIComponent(id)}&theme=${theme}`;
      try {
        await page.goto(url, { waitUntil: "networkidle" });
        await page.waitForSelector("body[data-ready='true']", { timeout: 10_000 });
        const height = await page.evaluate(() => Math.max(document.body.scrollHeight, document.documentElement.scrollHeight));
        for (const view of VIEWS) {
          /* Clamp short pages so their later gallery images remain truthful
             captures rather than blank panels below the document. */
          const y = Math.max(0, Math.min(view.offset, height - FRAME.height));
          const buffer = await page.screenshot({
            clip: { x: 0, y, width: FRAME.width, height: FRAME.height },
            type: "png",
          });
          const file = path.join(outDir, `${id}${view.suffix}${theme === "dark" ? "-dark" : ""}.png`);
          await writeFile(file, buffer);
          process.stdout.write(`  ${path.relative(root, file)}  ${(buffer.length / 1024).toFixed(0)} KB\n`);
        }
      } catch (error) {
        failures.push(`${id} (${theme}): ${error.message}`);
      }
    }
  }

  await browser.close();
  if (failures.length) {
    console.error(`\n${failures.length} preview(s) failed:`);
    for (const line of failures) console.error(`  ${line}`);
    process.exitCode = 1;
    return;
  }
  console.log(`\nCaptured ${ids.length * 2 * VIEWS.length} real views for ${ids.length} templates.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
