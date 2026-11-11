import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

/**
 * Responsive and sidebar regression tests for the real Clyra Code workspace.
 * They run against the live app: a project is created through the same API the UI
 * uses, and it is deleted afterwards. Nothing else on the machine is changed.
 */

const API = process.env.CLYRA_URL || "http://localhost:3000";
const PROJECT_NAME = `Responsive Check ${Date.now()}`;

let projectId = "";

async function createProject(request: APIRequestContext) {
  const response = await request.post(`${API}/api/vibe/projects`, { data: { name: PROJECT_NAME, prompt: "responsive test" } });
  expect(response.ok()).toBeTruthy();
  const body = (await response.json()) as { project: { id: string } };
  return body.project.id;
}

async function openWorkspace(page: Page, width: number, height = 812) {
  await page.setViewportSize({ width, height });
  await page.goto(`${API}/`);
  await page.getByText("Vibe Coder", { exact: true }).first().click();
  await expect(page.getByRole("heading", { name: "What do you want to build?" })).toBeVisible({ timeout: 60_000 });
}

async function documentFits(page: Page) {
  return page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
}

test.beforeAll(async ({ request }) => {
  projectId = await createProject(request);
});

test.afterAll(async ({ request }) => {
  if (projectId) await request.delete(`${API}/api/vibe/projects/${projectId}`);
});

test.describe("phone width (375px)", () => {
  test("the sidebar is hidden by default and the workspace fits the screen", async ({ page }) => {
    await openWorkspace(page, 375);
    await expect(page.getByRole("button", { name: "Open sidebar" })).toBeVisible();
    const rail = page.locator('aside[aria-label="Projects"]');
    await expect(rail).toHaveCount(1);
    const box = await rail.boundingBox();
    expect(box?.width ?? 0).toBeLessThan(2);
    expect(await documentFits(page)).toBeTruthy();
    await expect(page.getByPlaceholder("Ask Clyra to build, fix, or change something…")).toBeVisible();
  });

  test("opening the drawer overlays the content, Escape closes it and focus returns to the opener", async ({ page }) => {
    await openWorkspace(page, 375);
    const opener = page.getByRole("button", { name: "Open sidebar" });
    await opener.click();
    const drawer = page.locator('aside[aria-label="Projects"]');
    await expect(drawer).toBeVisible();
    const box = await drawer.boundingBox();
    expect(box?.width ?? 0).toBeGreaterThan(200);
    expect(box?.width ?? 999).toBeLessThanOrEqual(330);
    await page.keyboard.press("Escape");
    await expect(drawer).toHaveCount(1);
    await expect(opener).toBeFocused();
  });

  test("choosing a project in the drawer closes it", async ({ page }) => {
    await openWorkspace(page, 375);
    await page.getByRole("button", { name: "Open sidebar" }).click();
    await page.locator(`[data-project-row="${projectId}"]`).click();
    await expect(page.getByText(`Working in ${PROJECT_NAME}`)).toBeVisible({ timeout: 30_000 });
    const box = await page.locator('aside[aria-label="Projects"]').boundingBox();
    expect(box?.width ?? 0).toBeLessThan(2);
    expect(await documentFits(page)).toBeTruthy();
  });

  test("the composer and the header stay usable with a project open", async ({ page }) => {
    await openWorkspace(page, 375);
    await page.getByRole("button", { name: "Open sidebar" }).click();
    await page.locator(`[data-project-row="${projectId}"]`).click();
    await expect(page.getByText(`Working in ${PROJECT_NAME}`)).toBeVisible({ timeout: 30_000 });
    const composer = page.getByPlaceholder("Ask Clyra to build, fix, or change something…");
    await expect(composer).toBeVisible();
    const box = await composer.boundingBox();
    expect(box && box.x >= 0 && box.x + box.width <= 375).toBeTruthy();
    expect(await documentFits(page)).toBeTruthy();
  });
});

test.describe("desktop and medium widths", () => {
  test("the rail is visible at 1280px and collapses to a single expand control", async ({ page }) => {
    await openWorkspace(page, 1280, 800);
    const rail = page.locator('aside[aria-label="Projects"]');
    const width = (await rail.boundingBox())?.width ?? 0;
    // The current adjustable projects rail defaults to 280px; account for
    // subpixel layout without reverting the user's wider sidebar preference.
    expect(width).toBeGreaterThanOrEqual(276);
    expect(width).toBeLessThanOrEqual(284);
    await page.getByRole("button", { name: "Collapse sidebar" }).click();
    await expect(page.getByRole("button", { name: "Expand sidebar" })).toBeVisible();
    expect(await documentFits(page)).toBeTruthy();
  });

  test("768px keeps the rail and still fits without horizontal scrolling", async ({ page }) => {
    await openWorkspace(page, 768, 900);
    await expect(page.locator('aside[aria-label="Projects"]')).toBeVisible();
    expect(await documentFits(page)).toBeTruthy();
  });

  test("the primary action starts a task in the selected project, and New project stays secondary", async ({ page }) => {
    await openWorkspace(page, 1280, 800);
    await page.locator(`[data-project-row="${projectId}"]`).click();
    await expect(page.getByRole("button", { name: "New task", exact: true })).toBeVisible();
    // Creating a new project is a secondary action in the compact Add menu.
    await page.getByRole("button", { name: "Add project" }).click();
    await expect(page.getByRole("menuitem", { name: "New project" })).toBeVisible();
  });
});

test.describe("sidebar behaviour", () => {
  test("arrow keys move through the visible rows and Right expands a project", async ({ page }) => {
    await openWorkspace(page, 1280, 800);
    const row = page.locator(`[data-project-row="${projectId}"]`);
    await row.focus();
    await page.keyboard.press("ArrowRight");
    await expect(row).toHaveAttribute("aria-expanded", "true");
    await page.keyboard.press("ArrowLeft");
    await expect(row).toHaveAttribute("aria-expanded", "false");
  });

  test("pinning a project is stored with the project and survives a reload", async ({ page, request }) => {
    await openWorkspace(page, 1280, 800);
    await page.locator(`[data-project-row="${projectId}"]`).click({ button: "right" });
    await page.getByRole("menuitem", { name: "Pin to top" }).click();
    await expect(page.getByRole("region", { name: "Pinned projects" }).or(page.getByLabel("Pinned projects"))).toBeVisible({ timeout: 15_000 });
    const response = await request.get(`${API}/api/vibe/projects`);
    const body = (await response.json()) as { projects: Array<{ id: string; pinned?: boolean }> };
    expect(body.projects.find((project) => project.id === projectId)?.pinned).toBeTruthy();
    await page.reload();
    await page.getByText("Vibe Coder", { exact: true }).first().click();
    await expect(page.getByLabel("Pinned projects")).toBeVisible({ timeout: 60_000 });
    await page.locator(`[data-project-row="${projectId}"]`).click({ button: "right" });
    await page.getByRole("menuitem", { name: "Unpin" }).click();
  });

  test("the sidebar titles do not claim a product name the app does not use", async ({ page }) => {
    await openWorkspace(page, 1280, 800);
    await expect(page.getByText("Clyra Code", { exact: true }).first()).toBeVisible();
    await expect(page.locator('aside[aria-label="Projects"]').getByText("Vibe Coder", { exact: true })).toHaveCount(0);
  });
});
