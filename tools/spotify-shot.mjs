/**
 * Visual QA for Clyra Music: drives the mock harness (spotify-harness.html)
 * with headless Chromium and writes screenshots. Dev-only.
 *
 *   node tools/spotify-shot.mjs <outDir> [baseUrl] [scenes...]
 *
 * Scenes: home, search, searching, library, liked, playlist, album, artist,
 * lyrics, right-now, right-queue, menu, fullscreen, empty-playlist, narrow,
 * disconnected, collapsed.
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright-core";

const [out = "./spotify-shots", base = "http://localhost:5191", ...requested] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const SCENES = {
  async home(page) { /* default */ },
  async search(page) { await page.getByRole("button", { name: "Browse" }).click(); },
  async searching(page) { await page.getByPlaceholder("What do you want to play?").fill("blue"); await page.waitForTimeout(700); },
  async library(page) { await page.getByRole("button", { name: "Open your library" }).click(); },
  async liked(page) { await page.getByRole("button", { name: "Open Liked Songs" }).first().click(); await page.waitForTimeout(300); },
  async playlist(page) { await page.getByRole("button", { name: "Open Focus Flow" }).first().click(); await page.waitForTimeout(500); },
  async "empty-playlist"(page) { await page.getByRole("button", { name: "Open Daily Mix 1" }).first().click(); await page.waitForTimeout(500); },
  async album(page) { await page.getByRole("button", { name: "Open Midnight Radio" }).first().click(); await page.waitForTimeout(700); },
  async artist(page) { await page.getByRole("button", { name: "Open artist Lumen Vale" }).first().click(); await page.waitForTimeout(800); },
  async lyrics(page) { await page.getByRole("button", { name: "Lyrics" }).click(); await page.waitForTimeout(500); },
  async "right-now"(page) { await page.getByRole("button", { name: "Now playing view" }).click(); await page.waitForTimeout(500); },
  async "right-queue"(page) { await page.getByRole("button", { name: "Queue" }).click(); await page.waitForTimeout(400); },
  async menu(page) { await page.getByRole("button", { name: "Open Focus Flow" }).first().click(); await page.waitForTimeout(500); await page.locator(".sp-tr").nth(2).click({ button: "right" }); await page.waitForTimeout(200); await page.getByRole("menuitem", { name: "Add to playlist" }).hover(); await page.waitForTimeout(250); },
  async fullscreen(page) { await page.locator(".sp-player__right").getByRole("button", { name: "Full screen" }).click(); await page.waitForTimeout(600); },
  async "new-playlist"(page) { await page.getByRole("button", { name: "Create" }).click(); await page.getByRole("menuitem", { name: "Create a new playlist" }).click(); await page.getByLabel("Playlist name").fill("Road Trip 2026"); await page.waitForTimeout(250); },
  async "created"(page) { await page.getByRole("button", { name: "Create" }).click(); await page.getByRole("menuitem", { name: "Create a new playlist" }).click(); await page.getByLabel("Playlist name").fill("Road Trip 2026"); await page.getByRole("button", { name: "Create", exact: true }).last().click(); await page.waitForTimeout(700); },
  async devices(page) { await page.getByRole("button", { name: "Connect to a device" }).click(); await page.waitForTimeout(250); },
  async profile(page) { await page.getByRole("button", { name: "Account" }).click(); await page.waitForTimeout(250); },
  async sort(page) { await page.getByRole("button", { name: "Sort and view options" }).click(); await page.waitForTimeout(250); },
  async "lib-grid"(page) { await page.getByRole("button", { name: "Sort and view options" }).click(); await page.getByRole("menuitem", { name: "Grid" }).click(); await page.waitForTimeout(300); },
  async "chip-artists"(page) { await page.getByRole("button", { name: "Artists", exact: true }).first().click(); await page.waitForTimeout(300); },
  async collapsed(page) { await page.getByRole("button", { name: "Collapse Your Library" }).click(); await page.waitForTimeout(400); },
};
const names = requested.length ? requested : Object.keys(SCENES);
const browser = await chromium.launch();
for (const name of names) {
  const narrow = name === "narrow";
  const disconnected = name === "disconnected";
  const context = await browser.newContext({ viewport: narrow ? { width: 720, height: 800 } : { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => { if (message.type() === "error") errors.push(`console: ${message.text()}`); });
  await page.goto(`${base}/spotify-harness.html${disconnected ? "?state=disconnected" : ""}`);
  await page.waitForSelector(".sp", { timeout: 20000 });
  await page.waitForTimeout(500);
  try {
    await (SCENES[name] ?? (async () => {}))(page);
  } catch (error) {
    errors.push(`scene: ${String(error).split("\n")[0]}`);
  }
  await page.waitForTimeout(250);
  await page.screenshot({ path: join(out, `${name}.png`) });
  console.log(name, errors.length ? `\n  ${errors.join("\n  ")}` : "ok");
  await context.close();
}
await browser.close();
