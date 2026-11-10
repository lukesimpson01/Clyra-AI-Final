import { expect, test, type Page } from "@playwright/test";

const API = process.env.CLYRA_URL || "http://localhost:3000";

async function openWorkspace(page: Page) {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`${API}/`);
  await page.getByText("Vibe Coder", { exact: true }).first().click();
  await expect(page.getByRole("heading", { name: "What are we building today?" })).toBeVisible({ timeout: 60_000 });
}

test("the source-library API exposes the curated inventory without promising unverified apps run", async ({ request }) => {
  const catalogue = (await (await request.get(`${API}/api/clyra-code/library?limit=100`)).json()) as {
    entries: Array<{ id: string; status: string; sourceScreenshots: unknown[]; pinnedCommit: string | null }>;
    total: number;
  };
  expect(catalogue.total).toBeGreaterThanOrEqual(50);
  const exemplar = catalogue.entries.find((entry) => entry.id === "purffle-shorts");
  expect(exemplar).toMatchObject({ status: "unverified", pinnedCommit: null });
  expect(exemplar?.sourceScreenshots).toHaveLength(0);
});

test("the workspace opens a searchable source library with an explicit verification gate", async ({ page }) => {
  await openWorkspace(page);
  await page.getByRole("button", { name: "Library", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Clyra Library" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("heading", { name: "Discover", exact: true })).toBeVisible();
  await dialog.getByRole("searchbox").or(dialog.getByPlaceholder(/Search apps/)).fill("Excalidraw");
  await dialog.getByRole("button", { name: /Excalidraw/ }).first().click();
  await expect(dialog.getByText("Like Miro & FigJam").first()).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Get", exact: true }).first()).toBeVisible();
  await dialog.getByText("Advanced import options").click();
  await expect(dialog.getByRole("button", { name: "Verify repository" })).toBeVisible();
});
