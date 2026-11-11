import { expect, test, type Page } from "@playwright/test";

const API = process.env.CLYRA_URL || "http://localhost:3000";

async function openWorkspace(page: Page) {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(API + "/");
  await page.getByText("Vibe Coder", { exact: true }).first().click();
  await expect(page.getByRole("heading", { name: "What do you want to build?" })).toBeVisible({ timeout: 60_000 });
}

test("the source-library API exposes the curated inventory without promising unverified apps run", async ({ request }) => {
  const response = await request.get(API + "/api/clyra-code/library?limit=100");
  expect(response.ok()).toBeTruthy();
  const catalogue = (await response.json()) as {
    entries: Array<{ id: string; status: string; sourceScreenshots: unknown[]; pinnedCommit: string | null }>;
    total: number;
  };
  expect(catalogue.total).toBeGreaterThanOrEqual(83);
  const exemplar = catalogue.entries.find((entry) => entry.id === "purffle-shorts");
  expect(exemplar).toMatchObject({ status: "unverified", pinnedCommit: null });
  expect(exemplar?.sourceScreenshots).toHaveLength(0);
});

test("search, App Store-style details, requirements and honest screenshot state", async ({ page }) => {
  await openWorkspace(page);
  await page.getByRole("button", { name: "Library", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Clyra Library" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("heading", { name: "Discover", exact: true })).toBeVisible();
  await dialog.getByRole("textbox", { name: "Search the library" }).fill("Excalidraw");
  await dialog.getByRole("button", { name: /Excalidraw/ }).first().click();

  await expect(dialog.getByRole("heading", { name: "Excalidraw", exact: true })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Get", exact: true }).first()).toBeVisible();
  await expect(dialog.getByRole("heading", { name: "Preview" })).toBeVisible();
  await expect(dialog.getByRole("button", { name: /Enlarge screenshot 1/ })).toBeVisible();
  await dialog.getByRole("button", { name: /Enlarge screenshot 1/ }).click();
  await expect(page.getByRole("dialog", { name: /Screenshot 1 of 1/ })).toBeVisible();
  await page.getByRole("button", { name: "Close screenshot" }).click();
  await expect(dialog.getByRole("heading", { name: "Features" })).toBeVisible();
  await expect(dialog.getByRole("heading", { name: "Technical requirements" })).toBeVisible();
  await expect(dialog.getByText("API keys / secrets")).toBeVisible();
  await expect(dialog.getByRole("heading", { name: "Ratings & Reviews" })).toBeVisible();
  await expect(dialog.getByText(/Illustrative example reviews only/)).toBeVisible();
  await expect(dialog.getByText("3 illustrative sample ratings")).toBeVisible();

  await dialog.getByText("Advanced import options").click();
  await expect(dialog.getByRole("button", { name: "Verify repository" })).toBeVisible();
});

test("a review is editable, saved locally and does not invent a community rating", async ({ page }) => {
  await openWorkspace(page);
  await page.getByRole("button", { name: "Library", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Clyra Library" });
  await dialog.getByRole("textbox", { name: "Search the library" }).fill("Excalidraw");
  await dialog.getByRole("button", { name: /Excalidraw/ }).first().click();

  await expect(dialog.getByRole("button", { name: "Write a Review" })).toHaveCount(0);
  await expect(dialog.getByText("Download this source with Get to unlock your review.")).toBeVisible();
  // Mock source checkout to test Get -> installed -> reviews without executing third-party scripts.
  await page.route("**/api/clyra-code/library/excalidraw/import-plan", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ plan: { verification: { commit: "a".repeat(40), verifiedAt: new Date().toISOString() } } }) });
  });
  await page.route("**/api/clyra-code/library/excalidraw/import", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ project: { id: "qa-import-" + Date.now(), name: "Excalidraw" }, importedIntoExisting: false, sourcePath: "/qa/excalidraw", message: "Mocked checkout for UI regression" }) });
  });
  await dialog.getByRole("button", { name: "Get", exact: true }).first().click();
  await expect(dialog.getByRole("button", { name: "Open", exact: true }).first()).toBeVisible({ timeout: 20_000 });
  await expect(dialog.getByRole("button", { name: "Rate Excalidraw" })).toBeVisible();
  await dialog.getByRole("button", { name: "Write a Review" }).click();
  await dialog.getByRole("button", { name: "Rate 4 stars" }).click();
  await dialog.getByPlaceholder("Summarise your experience").fill("Useful drawing source");
  await dialog.getByPlaceholder("What worked well? What would you improve?").fill("Good source to study and customise.");
  await dialog.getByRole("button", { name: "Save review" }).click();

  await expect(dialog.getByText("Useful drawing source")).toBeVisible();
  await expect(dialog.getByText("Your rating")).toBeVisible();
  await expect(dialog.getByText(/Your rating: 4\/5/)).toBeVisible();
  await dialog.getByRole("button", { name: "Edit your review" }).click();
  await expect(dialog.getByPlaceholder("Summarise your experience")).toHaveValue("Useful drawing source");
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();

  await page.reload();
  await page.getByText("Vibe Coder", { exact: true }).first().click();
  await page.getByRole("button", { name: "Library", exact: true }).click();
  const reloaded = page.getByRole("dialog", { name: "Clyra Library" });
  await reloaded.getByRole("textbox", { name: "Search the library" }).fill("Excalidraw");
  await reloaded.getByRole("button", { name: /Excalidraw/ }).first().click();
  await expect(reloaded.getByText("Useful drawing source")).toBeVisible();
  await expect(reloaded.getByText(/Your rating: 4\/5/)).toBeVisible();
  await expect(reloaded.getByText(/Illustrative example reviews only/)).toBeVisible();
});
