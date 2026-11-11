/**
 * Capture REAL, distinct sections of existing landing-page demo sites.
 * The author's original screenshot (`landing-ID.jpg`) is immutable and first.
 * This script ONLY creates missing section-1/2/3 captures for one-image
 * listings; existing galleries of 3+ are never touched.
 *
 * No invented/mock screenshots, no screenshots of Clyra's template browser.
 * Never execute scripts from cloned repositories; view their public demos.
 */
import { chromium } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const inventory = await fs.readFile(path.join(root, "lib/clyra-code/library/landing-pages.ts"), "utf8");
const assets = path.join(root, "public/library-shots");
const outFile = path.join(root, "lib/clyra-code/library/landing-page-section-captures.ts");
const entries = [...inventory.matchAll(/\{ id: "(landing-[^"]+)", slug: "([^"]+)", title: "([^"]+)", kind: "[^"]+", description: "[^"]+", repository: "([^"]+)", previewUrl: "(https:\/\/[^"]+)"/g)]
  .map((m) => ({ id: m[1], slug: m[2], title: m[3], repo: m[4], url: m[5] }));
if (entries.length !== 75 || new Set(entries.map((e) => e.id)).size !== 75) {
  throw new Error(`Expected 75 unique entries, got ${entries.length}; avoid incomplete screenshot claims`);
}
const total = 3;
const expected = (id, i) => path.join(assets, `${id}-section-${i}.jpg`);
const present = async (p) => (await fs.stat(p).catch(() => null))?.size > 8000;
const results = {};
const failed = [];
await fs.mkdir(assets, { recursive: true });
const browser = await chromium.launch({ headless: true });
const workers = Number(process.env.SCREENSHOT_WORKERS || 3);
let cursor = 0;

async function takeOne(item) {
  // Do not replace the existing upstream-supplied original or existing multi-image galleries.
  const original = path.join(assets, `${item.id}.jpg`);
  if (!await present(original)) throw new Error(`Missing upstream first screenshot: ${item.id}`);
  const presentIndexes = [];
  for (let i = 1; i <= total; i++) if (await present(expected(item.id, i))) presentIndexes.push(i);

  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1,
    reducedMotion: "reduce", colorScheme: "light", ignoreHTTPSErrors: false });
  const page = await context.newPage();
  page.setDefaultTimeout(20000);
  try {
    const response = await page.goto(item.url, { waitUntil: "domcontentloaded", timeout: 35000 });
    if (!response || response.status() >= 400) throw new Error(`Site returned HTTP ${response?.status()}`);
    await page.evaluate(() => { document.documentElement.style.scrollBehavior = "auto"; });
    await page.waitForTimeout(700);
    const candidates = await page.evaluate(() => {
      const elements = [...document.querySelectorAll("main section, body > section, body section")];
      const unique = [...new Set(elements)].filter((el) => !el.parentElement?.closest("section"));
      const height = Math.max(document.documentElement.scrollHeight, document.body.scrollHeight);
      return { height, sections: unique.map((el, index) => {
        const rect = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        const heading = el.querySelector("h2, h3, h1")?.textContent?.replace(/\s+/g, " ").trim() || "";
        const text = (el.innerText || "").replace(/\s+/g, " ").trim();
        const top = rect.top + window.scrollY;
        const imgs = el.querySelectorAll("img, video, picture, svg").length;
        return { index, top, height: rect.height, width: rect.width, heading,
          textLen: text.length, media: imgs,
          display: cs.display, visibility: cs.visibility };
      }).filter((x) => x.display !== "none" && x.visibility !== "hidden"
        && x.width >= 580 && x.height >= 150 && x.textLen >= 50
        && x.top >= 440 && x.top < height - 180).sort((a,b) => a.top - b.top) };
    });
    if (candidates.sections.length < total) throw new Error(
      `Only ${candidates.sections.length} substantial semantic sections at ${item.url}; not inventing alternatives`);
    const pool = candidates.sections;
    // Spread shots through the actual page instead of taking 3 snapshots of a
    // header or of the same "Features" card. One early, middle and late section.
    const targets = [0.05, 0.48, 0.88].map((frac) => Math.min(pool.length - 1, Math.floor(frac * pool.length)));
    const picks = [];
    for (let k = 0; k < total; k++) {
      const desired = targets[k];
      const sorted = pool.map((v, i) => ({ ...v, pos: i })).sort((a,b) =>
        (Math.abs(a.pos - desired) * 100 - Math.min(a.media, 8) * 3 - (a.heading ? 2 : 0))
        - (Math.abs(b.pos - desired) * 100 - Math.min(b.media, 8) * 3 - (b.heading ? 2 : 0)));
      const chosen = sorted.find((section) => !picks.some((old) => Math.abs(old.top - section.top) < 410));
      if (!chosen) throw new Error(`No third distinct screenshot region for ${item.id}`);
      picks.push(chosen);
    }
    picks.sort((a,b) => a.top-b.top);
    const captures = [];
    for (let i = 0; i < total; i++) {
      const shot = picks[i];
      const file = expected(item.id, i+1);
      const proposedScroll = Math.max(0, Math.min(candidates.height - 800, shot.top - 90));
      if (!presentIndexes.includes(i+1)) {
        await page.evaluate((y) => window.scrollTo({ top: y, behavior: "instant" }), proposedScroll);
        await page.waitForTimeout(450);
        // Force only images within the visible window to load; do not
        // generate any artificial page content.
        await page.evaluate(async () => {
          const imgs = [...document.querySelectorAll("img")].filter((im) => {
            const r=im.getBoundingClientRect();return r.width>40 && r.height>40 && r.top<850 && r.bottom>-60;
          });
          await Promise.race([Promise.allSettled(imgs.map((im) => {
            if (im.loading === "lazy") im.loading = "eager";
            return im.decode?.().catch(()=>{}) ?? Promise.resolve();
          })), new Promise((resolve) => setTimeout(resolve, 1600))]);
        });
        await page.screenshot({ path: file, type: "jpeg", quality: 83, animations: "disabled", timeout: 15000 });
      }
      if (!await present(file)) throw new Error(`Capture unexpectedly small or absent: ${file}`);
      captures.push({
        file: path.basename(file), label: shot.heading || `Section ${i + 1}`,
        url: item.url, top: Math.round(shot.top), textLen: shot.textLen,
      });
    }
    results[item.id] = captures;
    console.log(`PASS ${item.id}: ${captures.map((c)=> c.label).join(" | ")}`);
  } finally {
    await context.close();
  }
}

async function worker() {
  while (cursor < entries.length) {
    const item = entries[cursor++];
    try { await takeOne(item); }
    catch (err) {
      failed.push({ id: item.id, error: err instanceof Error ? err.message : String(err) });
      console.error(`FAIL ${item.id}: ${failed.at(-1).error}`);
    }
  }
}
try { await Promise.all(Array.from({ length: Math.min(workers, 6) }, worker)); }
finally { await browser.close(); }
if (failed.length) {
  await fs.writeFile("landing-page-capture-failures.json", JSON.stringify(failed, null, 2) + "\n");
  throw new Error(`${failed.length} of 75 websites failed real multi-section capture. No metadata will be published.`);
}
// Generated manifest contains only verified local screenshot filenames and
// the real, site-derived section headings in the same order as the capture.
const content = `/**
 * GENERATED by tools/capture-landing-page-sections.mjs.
 * Additional REAL browser captures of public upstream demo sections.
 * The upstream first screenshot is intentionally not stored in this file.
 */
export const LANDING_PAGE_SECTION_CAPTURES: Record<string, Array<{ file: string; alt: string; pageUrl: string }>> = ${JSON.stringify(Object.fromEntries(entries.map((item) =>
  [item.id, results[item.id].map((s) => ({
    file: s.file,
    alt: `${item.title}: ${s.label} section, actual live demo capture`,
    pageUrl: s.url,
  }))])), null, 2)};
`;
await fs.writeFile(outFile, content);
console.log(`PASS: 75/75 sites with 3 real distinct sections each; kept all original author previews as the first image.`);
