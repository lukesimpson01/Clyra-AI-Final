import { expect, test, type Page } from "@playwright/test";

const API = process.env.CLYRA_URL || "http://localhost:3000";

async function openWorkspace(page: Page) {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`${API}/`);
  // The app renders an interactive DOM beneath its initial loading cover.
  // Wait for the actual visible UI, not just clickability through that cover.
  await page.locator(".clyra-boot-overlay").waitFor({ state: "hidden", timeout: 45_000 });
  await page.locator("#clyra-preboot-surface").waitFor({ state: "detached", timeout: 5_000 });
  await page.getByText("Vibe Coder", { exact: true }).first().click();
  await expect(page.getByRole("heading", { name: "What do you want to build?" })).toBeVisible({ timeout: 60_000 });
}

test("source-library API returns unique active entries without claiming unverified apps run", async ({ request }) => {
  const response = await request.get(`${API}/api/clyra-code/library?limit=100`);
  expect(response.ok()).toBeTruthy();
  const catalogue = (await response.json()) as {
    entries: Array<{ id: string; status: string; sourceScreenshots: Array<{ url: string }>; pinnedCommit: string | null }>;
    total: number;
  };
  expect(catalogue.total).toBe(50);
  expect(catalogue.entries.length).toBe(50);
  expect(new Set(catalogue.entries.map((entry) => entry.id)).size).toBe(50);
  for (const id of ["astrofy", "excalidraw", "bolt-diy", "browseros", "facilmap", "supoclip"]) {
    expect(catalogue.entries.some((entry) => entry.id === id)).toBeTruthy();
  }
  expect(catalogue.entries.every((entry) => entry.status !== "runnable-now" && entry.pinnedCommit === null)).toBeTruthy();
  expect(catalogue.entries.find((entry) => entry.id === "astrofy")?.sourceScreenshots.length).toBeGreaterThan(0);
  expect(catalogue.entries.find((entry) => entry.id === "bolt-diy")?.sourceScreenshots).toHaveLength(0);
});

test("source library has featured carousel arrows, real previews and honest missing-preview states", async ({ page }) => {
  await openWorkspace(page);
  await page.getByRole("button", { name: "Library", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Clyra Library" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("heading", { name: "Discover", exact: true })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Next featured app" })).toBeVisible();
  await dialog.getByRole("button", { name: "Next featured app" }).click();
  await dialog.getByRole("button", { name: "Previous featured app" }).click();
  await dialog.getByRole("textbox", { name: "Search the library" }).fill("bolt.diy");
  await dialog.getByRole("button", { name: "View bolt.diy details" }).last().click();
  await expect(dialog.getByRole("heading", { name: "bolt.diy", exact: true })).toBeVisible();
  await expect(dialog.getByText("Preview not captured").first()).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Get", exact: true }).first()).toBeVisible();
  await expect(dialog.getByText("source downloaded", { exact: false })).toHaveCount(0);
  await dialog.getByText("Advanced import options").click();
  await expect(dialog.getByRole("button", { name: "Verify repository" })).toBeVisible();
  await expect(dialog.getByText(/Review setup/).first()).toBeVisible();
});

test("featured template details open without executing or downloading any source", async ({ page }) => {
  await openWorkspace(page);
  await page.getByRole("button", { name: "Library", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Clyra Library" });
  const featured = dialog.getByRole("button", { name: /^View featured .+ details$/ }).first();
  await expect(featured).toBeVisible();
  const label = (await featured.getAttribute("aria-label")) || "";
  const appName = label.replace(/^View featured /, "").replace(/ details$/, "");
  await featured.click();
  await expect(dialog.getByRole("heading", { name: appName, exact: true }).first()).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Get", exact: true }).first()).toBeVisible();
  await expect(dialog.getByText("source downloaded", { exact: false })).toHaveCount(0);
});
