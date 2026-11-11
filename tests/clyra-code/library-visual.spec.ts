/**
 * Real, unedited screenshot tour of the Clyra Code template store.
 *
 * Usage:
 *   npm run dev
 *   npx playwright test -c playwright.clyra-code.config.ts library-visual.spec.ts
 *
 * Screenshots are saved under qa-screenshots/clyra-code-template-store/.
 * Captures only a running app; never generates decorative mock screenshots.
 */
import { expect, test, type Page } from "@playwright/test";
import path from "node:path";

const root = path.join(process.cwd(), "qa-screenshots", "clyra-code-template-store");
const API = process.env.CLYRA_URL || "http://localhost:3000";

async function openLibrary(page: Page) {
  await page.goto(API + "/");
  await page.getByText("Vibe Coder", { exact: true }).first().click();
  await expect(page.getByRole("heading", { name: "What do you want to build?" })).toBeVisible({ timeout: 60_000 });
  await page.getByRole("button", { name: "Library", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Clyra Library" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("heading", { name: "Discover", exact: true })).toBeVisible();
  // The Clyra boot overlay remains visible after the underlying app becomes interactive.
  // Wait for its actual disappearance; otherwise every screenshot is a loading bar.
  await expect(page.locator(".clyra-boot-overlay")).toBeHidden({ timeout: 45_000 });
  return dialog;
}

test("capture real Discover scroll states and app detail on desktop and mobile", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const dialog = await openLibrary(page);
  const shot = async (name: string) => {
    await expect(page.locator(".clyra-boot-overlay")).toBeHidden();
    await page.screenshot({ path: path.join(root, name + ".png"), fullPage: false });
  };

  await shot("01-discover-top-desktop");
  const main = dialog.locator("main > .cc-scroll").first();
  await main.evaluate((element) => { element.scrollTop = 560; });
  await shot("02-discover-mid-desktop");
  await main.evaluate((element) => { element.scrollTop = 1360; });
  await shot("03-discover-lower-desktop");
  await main.evaluate((element) => { element.scrollTop = element.scrollHeight; });
  await shot("04-discover-bottom-desktop");

  await dialog.getByRole("textbox", { name: "Search the library" }).fill("Excalidraw");
  await expect(dialog.getByRole("button", { name: /Excalidraw/ }).first()).toBeVisible();
  await shot("05-search-results-desktop");
  await dialog.getByRole("button", { name: /Excalidraw/ }).first().click();
  await expect(dialog.getByRole("heading", { name: "Excalidraw" })).toBeVisible();
  await shot("06-app-detail-header-desktop");

  const detail = dialog.locator("main > .cc-scroll").first();
  await detail.getByRole("heading", { name: "Features", exact: true }).scrollIntoViewIfNeeded();
  await shot("07-app-detail-features-desktop");
  await detail.getByRole("heading", { name: "Technical requirements" }).scrollIntoViewIfNeeded();
  await shot("08-app-detail-technical-desktop");
  await detail.getByRole("heading", { name: "Ratings & Reviews" }).scrollIntoViewIfNeeded();
  await shot("09-app-detail-reviews-desktop");
  await dialog.getByRole("button", { name: "Write a Review" }).click();
  await shot("10-app-detail-review-editor-desktop");
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();

  await page.setViewportSize({ width: 390, height: 844 });
  await shot("11-app-detail-mobile");
  await dialog.getByRole("button", { name: /Discover/ }).first().click();
  await dialog.getByRole("textbox", { name: "Search the library" }).fill("");
  await expect(dialog.getByRole("heading", { name: "Discover", exact: true })).toBeVisible();
  await shot("12-discover-mobile");
});
