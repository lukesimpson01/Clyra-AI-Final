/**
 * Clyra Maps — full-application Playwright test.
 *
 * Runs the real React application (served by dist/server.js) and verifies the
 * Maps workspace end-to-end: the map must actually render OpenFreeMap vector
 * features (detected via water/road/label colours in the screenshot, which is
 * far more reliable than `queryRenderedFeatures` under software WebGL), the
 * camera must zoom/pitch, search must resolve, routing must draw, and console
 * stays clean.
 *
 * Prereq: server running (e.g. `node dist/server.js`). Override URL with
 * CLYRA_MAPS_TEST_URL. Run with:  npm run test:map:app
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Page } from "playwright";
import sharp from "sharp";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const OUT = join(HERE, "..", "qa-artifacts", "maps-app");
const BASE = process.env.CLYRA_MAPS_TEST_URL || "http://127.0.0.1:3999";

let passed = 0;
let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
  ok ? (passed += 1) : (failed += 1);
}

async function getDebug(page: Page) {
  return page.evaluate("window.__CLYRA_MAP_DEBUG__ || null");
}

/** Analyse a screenshot: colour variance + whether cartographic colours exist. */
async function analyzeScreenshot(path: string): Promise<{ stddev: number; water: number; green: number }> {
  const { data, info } = await sharp(path).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const ch = info.channels;
  let n = 0;
  let sum = 0;
  let water = 0;
  let green = 0;
  for (let i = 0; i < data.length; i += ch * 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    sum += 0.2126 * r + 0.7152 * g + 0.0722 * b;
    n += 1;
    if (r >= 150 && r <= 190 && g >= 205 && g <= 235 && b >= 228 && b <= 252) water += 1;
    if (g > r + 12 && g > b + 10 && g >= 195 && g <= 245) green += 1;
  }
  const mean = sum / Math.max(1, n);
  let variance = 0;
  for (let i = 0; i < data.length; i += ch * 4) {
    const lum = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
    variance += (lum - mean) ** 2;
  }
  variance /= Math.max(1, n);
  return { stddev: Math.sqrt(variance), water, green };
}

/** Type into the search field and wait for results (retries for robustness). */
async function searchFor(page: Page, query: string, resultCount = 1): Promise<number> {
  const input = page.getByRole("textbox", { name: "Search places" });
  await input.click();
  await input.fill("");
  await input.pressSequentially(query, { delay: 40 });
  await page.waitForFunction(
    (n) => document.querySelectorAll('.clyra-map__search-results [role="option"]').length >= n,
    resultCount,
    { timeout: 20000 },
  ).catch(() => {});
  return page.locator('.clyra-map__search-results [role="option"]').count();
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ channel: "chrome", headless: process.env.CLYRA_MAPS_TEST_HEADLESS === "1" })
    .catch(() => chromium.launch({ headless: true }));
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
  await page.route(/geist/, (route) => route.fulfill({ body: "", contentType: "text/css" }));
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on("pageerror", (e) => pageErrors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });

  await page.goto(`${BASE}/?workspace=maps`, { waitUntil: "domcontentloaded" });

  // 1. Wait for a real READY signal (style + tiles + idle).
  const ready = await page.waitForFunction(
    '() => { const d = window.__CLYRA_MAP_DEBUG__; return d && d.state === "READY"; }',
    null,
    { timeout: 45000 },
  ).then(() => true).catch(() => false);
  check("map reaches READY", ready);

  const dbg = await (async () => {
    let last = null;
    for (let i = 0; i < 40; i++) {
      last = await getDebug(page);
      if (last && last.state === "READY") return last;
      await page.waitForTimeout(200);
    }
    return last;
  })();
  check("style loaded", Boolean(dbg?.styleLoaded));
  check("tiles loaded", Boolean(dbg?.tilesLoaded));
  check("vector source present", Boolean(dbg?.sources?.includes("clyra-vector")));
  check("no fatal map error", (dbg?.lastError ?? null) === null, dbg?.lastError ?? "none");

  // 2. Screenshot the map region and prove cartography is on screen via colour.
  await page.waitForTimeout(1500);
  const overview = join(OUT, "sydney-overview.png");
  const shotOk = await page.locator(".clyra-map").screenshot({ path: overview, timeout: 15000 }).then(() => true).catch(() => false);
  if (shotOk) {
    const a = await analyzeScreenshot(overview);
    check("map is not blank (variance)", a.stddev > 8, `stddev ${a.stddev.toFixed(1)}`);
    check("water renders (cyan pixels)", a.water > 200, `${a.water} water px`);
    check("green space renders", a.green > 50, `${a.green} green px`);
  } else {
    check("map screenshot captured", false, "screenshot failed");
  }

  // 3. Camera interactions.
  const zoomBefore = await page.evaluate("window.__CLYRA_MAP__ ? window.__CLYRA_MAP__.getZoom() : 0");
  await page.getByRole("button", { name: "Zoom in" }).click();
  await page.waitForTimeout(500);
  const zoomAfter = await page.evaluate("window.__CLYRA_MAP__ ? window.__CLYRA_MAP__.getZoom() : 0");
  check("zoom in works", zoomAfter > zoomBefore, `${zoomBefore.toFixed(1)} → ${zoomAfter.toFixed(1)}`);

  await page.getByRole("button", { name: "Switch to 3D" }).click();
  await page.waitForTimeout(900);
  const pitch = await page.evaluate("window.__CLYRA_MAP__ ? window.__CLYRA_MAP__.getPitch() : 0");
  check("3D pitch works", pitch > 20, `pitch ${pitch.toFixed(1)}`);
  await page.getByRole("button", { name: "Switch to 2D" }).click();
  await page.waitForTimeout(700);

  // 4. Search — click a result to fly.
  const hornCount = await searchFor(page, "Hornsby");
  check("search returns results", hornCount > 0, `${hornCount} results`);
  if (hornCount > 0) {
    await page.locator('.clyra-map__search-results [role="option"]').first().click();
    await page.waitForTimeout(1600);
    const latAfter = await page.evaluate("window.__CLYRA_MAP__ ? window.__CLYRA_MAP__.getCenter().lat : null");
    check("search click flies to result", latAfter !== null && latAfter < -33.65, `lat ${latAfter}`);
    await page.locator(".clyra-map").screenshot({ path: join(OUT, "search-fly.png"), timeout: 15000 }).catch(() => {});
  }

  // 5. Search — Enter key flies to the first result.
  await searchFor(page, "Chatswood");
  await page.getByRole("textbox", { name: "Search places" }).press("Enter");
  await page.waitForTimeout(1600);
  const latEnter = await page.evaluate("window.__CLYRA_MAP__ ? window.__CLYRA_MAP__.getCenter().lat : null");
  check("enter key flies to first result", latEnter !== null && latEnter < -33.7, `lat ${latEnter}`);

  // 6. Route (directions) — driving only.
  const parCount = await searchFor(page, "Parramatta");
  const dirButton = page.locator('.clyra-map__search-results [role="option"]').first().getByRole("button", { name: "Directions" });
  if (parCount > 0 && (await dirButton.count()) > 0) {
    await dirButton.click();
    await page.waitForTimeout(3000);
    check("directions panel appears", (await page.locator('.clyra-map__panel').count()) > 0);
    const steps = await page.locator('.clyra-map__steps li').count();
    check("directions steps listed", steps > 0, `${steps} steps`);
    const modeTabs = await page.locator('.clyra-map__transport [role="tab"]').count();
    check("driving is the only mode", modeTabs === 0, `${modeTabs} mode selector tabs`);
    await page.locator(".clyra-map").screenshot({ path: join(OUT, "route-overview.png"), timeout: 15000 }).catch(() => {});

    // 7. Start navigation → next-turn card at top-center.
    await page.getByRole("button", { name: "Start" }).click();
    await page.waitForTimeout(1200);
    const hud = page.locator('.clyra-map__hud');
    check("navigation HUD appears", (await hud.count()) > 0);
    if ((await hud.count()) > 0) {
      const box = await hud.boundingBox();
      const mapBox = await page.locator(".clyra-map").boundingBox();
      if (box && mapBox) {
        const center = box.x + box.width / 2;
        const mapCenter = mapBox.x + mapBox.width / 2;
        check("next-turn card is top-centered", Math.abs(center - mapCenter) < 20, `offset ${Math.abs(center - mapCenter).toFixed(0)}px`);
      }
      await page.locator(".clyra-map").screenshot({ path: join(OUT, "navigation-hud.png"), timeout: 15000 }).catch(() => {});
    }
  } else {
    check("directions available", false);
  }

  // 8. Console / network failures. Real JS exceptions always fail; benign
  //    resource noise (remote Geist font block, rare OpenFreeMap glyph ranges
  //    that fall back to local rendering) is ignored.
  const realErrors = pageErrors.concat(consoleErrors.filter((e) =>
    !e.includes("Failed to load resource")
    && !e.includes("ERR_BLOCKED_BY_ORB")
    && !e.includes("ERR_FAILED"),
  ));
  check("no console errors", realErrors.length === 0, realErrors.slice(0, 3).join(" | ") || "clean");

  console.log(`\nMAPS APP E2E: ${passed} passed, ${failed} failed`);
  console.log(`Screenshots → ${OUT}`);
  await browser.close();
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => { console.error("FATAL", e); process.exit(1); });
