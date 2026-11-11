/**
 * Real browser proof for the existing Clyra Code Library (NOT upstream app screenshots).
 * Captures UI at requested widths. The test exits non-zero if the actual Library
 * cannot open or its navigation behaves incorrectly.
 */
import { chromium } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";
const url = process.env.CLYRA_URL || "http://127.0.0.1:3000";
const output = process.env.CLYRA_SCREENSHOT_DIR || "/tmp/clyra-code-ui-shots";
await fs.mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  for (const width of [320, 375, 768, 1024, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: 900 }, reducedMotion: "reduce" });
    page.setDefaultTimeout(60_000);
    try {
      await page.goto(url, { waitUntil: "domcontentloaded" });
      await page.locator(".clyra-boot-overlay").waitFor({ state: "hidden", timeout: 45_000 });
      await page.locator("#clyra-preboot-surface").waitFor({ state: "detached", timeout: 5_000 });
      await page.getByText("Vibe Coder", { exact: true }).first().click();
      await page.getByRole("heading", { name: "What do you want to build?" }).waitFor();
      await page.getByRole("button", { name: "Library", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "Clyra Library" });
      await dialog.waitFor();
      await dialog.getByRole("button", { name: "Next featured app" }).click();
      // The carousel's text/capture cross-fade lasts 400ms. A still image of
      // the intermediate frame is not evidence of the final, readable UI.
      await page.waitForTimeout(550);
      await page.screenshot({ path: path.join(output, `library-discover-${width}.png`), animations: "allow" });
      // Verify the curated Featured Apps chart really appears beneath the
      // editorial banner, including the AI tools and creative alternatives.
      const featuredApps = dialog.getByRole("region", { name: "Featured Apps" });
      await featuredApps.waitFor();
      await featuredApps.getByRole("button", { name: "View OpenCluely details" }).waitFor();
      await featuredApps.getByRole("button", { name: "View OpenFilm details" }).waitFor();
      await featuredApps.scrollIntoViewIfNeeded();
      await page.waitForTimeout(320);
      await page.screenshot({ path: path.join(output, `library-featured-apps-${width}.png`), animations: "allow" });


      const input = dialog.getByRole("textbox", { name: "Search the library" });
      await input.fill("bolt.diy");
      await dialog.getByRole("button", { name: "View bolt.diy details" }).last().click();
      await dialog.getByRole("heading", { name: "bolt.diy", exact: true }).waitFor();
      await dialog.getByText("Preview not captured").first().waitFor();
      // Motion keeps the previous Results screen mounted while the new detail
      // view fades in. Wait for its computed opacity and old-screen removal.
      await page.waitForFunction(() => {
        const title = [...document.querySelectorAll('[role="dialog"] h2')]
          .find((node) => node.textContent?.trim() === "bolt.diy");
        const detail = title?.closest(".cc-scroll");
        const previous = [...document.querySelectorAll('[role="dialog"] h2')]
          .some((node) => node.textContent?.trim() === "Results");
        return !!detail && Number(getComputedStyle(detail).opacity) >= 0.99 && !previous;
      }, null, { timeout: 10_000 });
      await page.screenshot({ path: path.join(output, `library-detail-${width}.png`), animations: "allow" });

      // Capture the actual Landing Pages gallery and one business-type filter,
      // not a faded intermediate screen or an invented thumbnail.
      await dialog.getByRole("button", { name: "Discover", exact: true }).first().click();
      await input.fill("");
      await dialog.getByRole("button", { name: "See All", exact: true }).first().click();
      await dialog.getByText("75 designs across 17 industries").waitFor();
      await page.waitForTimeout(400);
      await page.screenshot({ path: path.join(output, `landing-pages-all-${width}.png`), animations: "allow" });
      await dialog.getByRole("button", { name: "SaaS & AI", exact: true }).click();
      await dialog.getByText("8 SaaS & AI designs").waitFor();
      await page.waitForTimeout(300);
      await page.screenshot({ path: path.join(output, `landing-pages-saas-${width}.png`), animations: "allow" });
      await dialog.getByRole("button", { name: "View KORVA — AI Studio details" }).first().click();
      await dialog.getByRole("heading", { name: "KORVA — AI Studio" }).waitFor();
      await page.waitForTimeout(400);
      await page.screenshot({ path: path.join(output, `landing-pages-detail-${width}.png`), animations: "allow" });
      console.log(`PASS Clyra Library renders and navigates at ${width}px`);
    } finally {
      await page.close();
    }
  }
} finally {
  await browser.close();
}
