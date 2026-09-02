/* Captures the template gallery previews.

   Every card in the templates modal shows a real screenshot of the page that
   template builds, taken from the same editor and stylesheet the workspace
   uses. Generating them here rather than drawing an approximation means a
   preview cannot describe a page the template does not actually produce.

   Usage:  node tools/notes-template-shots.mjs [--url http://localhost:3060]
   The dev server must already be running (npm run dev:source). */
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
const base = (arg("url", process.env.NOTES_URL || "http://localhost:3060")).replace(/\/$/, "");

/* The template list is the source of truth; reading the ids out of the module
   keeps the tool from drifting when a template is added. */
async function templateIds() {
  const source = await readFile(path.join(root, "public", "notes", "js", "templates-data.js"), "utf8");
  return [...source.matchAll(/^\s{4}id:\s*"([a-z0-9-]+)"/gm)].map((match) => match[1]);
}

const FRAME = { width: 720, height: 500 };

async function main() {
  const ids = await templateIds();
  if (!ids.length) throw new Error("No template ids found in templates-data.js");
  await mkdir(outDir, { recursive: true });

  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: FRAME.width, height: 900 },
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
        /* Clipped rather than full-page: the card only ever shows the top of
           the document, and a 3000px tall image would be wasted bytes. */
        const buffer = await page.screenshot({
          clip: { x: 0, y: 0, width: FRAME.width, height: FRAME.height },
          type: "png",
        });
        const file = path.join(outDir, `${id}${theme === "dark" ? "-dark" : ""}.png`);
        await writeFile(file, buffer);
        process.stdout.write(`  ${path.relative(root, file)}  ${(buffer.length / 1024).toFixed(0)} KB\n`);
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
  console.log(`\nCaptured ${ids.length * 2} previews for ${ids.length} templates.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
