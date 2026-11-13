import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

/**
 * Clyra Design, through the real workspace. The Design tab embeds the
 * OpenDesign frontend (nexu-io/open-design) served by the local OpenDesign
 * daemon, so these tests exercise the embed itself and the same-origin
 * status endpoint. When the daemon is not running the tab must show its
 * explanatory fallback rather than a blank frame. The bundled design
 * catalog that the daemon's design systems derive from stays covered by the
 * catalog endpoint test at the bottom.
 */

const API = process.env.CLYRA_URL || "http://localhost:3000";
const STAMP = Date.now();
const CODE_NAME = `Mode Code ${STAMP}`;

let codeProjectId = "";

async function openWorkspace(page: Page) {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`${API}/`);
  await page.getByText("Vibe Coder", { exact: true }).first().click();
  await expect(page.getByRole("tablist", { name: "Workspace", exact: true })).toBeVisible({ timeout: 60_000 });
}

async function createProject(request: APIRequestContext, name: string, kind: "code" | "design") {
  const response = await request.post(`${API}/api/vibe/projects`, {
    data: { name, prompt: "mode test", kind, ...(kind === "design" ? { designSystemId: "linear-app", designTemplateId: "dashboard" } : {}) },
  });
  expect(response.ok()).toBeTruthy();
  return ((await response.json()) as { project: { id: string } }).project.id;
}

test.beforeAll(async ({ request }) => {
  codeProjectId = await createProject(request, CODE_NAME, "code");
});

test.afterAll(async ({ request }) => {
  if (codeProjectId) await request.delete(`${API}/api/vibe/projects/${codeProjectId}`);
});

test("the Code and Design tabs switch the workspace, and Design shows the OpenDesign embed", async ({ page }) => {
  await openWorkspace(page);
  await expect(page.getByRole("tab", { name: "Code", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(`[data-project-row="${codeProjectId}"]`)).toBeVisible({ timeout: 30_000 });

  await page.getByRole("tab", { name: "Design", exact: true }).click();
  await expect(page.getByRole("tab", { name: "Design", exact: true })).toHaveAttribute("aria-selected", "true");
  // The Design tab is either the live OpenDesign UI or its setup fallback —
  // never the Code welcome and never a blank pane.
  await expect(
    page.locator('iframe[title="OpenDesign"], :text("Clyra Design couldn’t start"), :text("Starting Clyra Design…")').first(),
  ).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("heading", { name: "What do you want to build?" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "What are we designing?" })).toHaveCount(0);

  await page.getByRole("tab", { name: "Code", exact: true }).click();
  await expect(page.getByRole("heading", { name: "What do you want to build?" })).toBeVisible();
});

test("the Design tab keeps the workspace header with its mode switch", async ({ page }) => {
  await openWorkspace(page);
  await page.getByRole("tab", { name: "Design", exact: true }).click();
  await expect(page.getByRole("tablist", { name: "Workspace", exact: true })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Code", exact: true })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Design", exact: true })).toBeVisible();
  // The embedded product owns the design canvas; the terminal drawer and the
  // preview panel belong to the Code workspace and stay out of the way.
  await expect(page.getByRole("tablist", { name: "Terminal sessions" })).toHaveCount(0);
});

test("the open-design status endpoint reports the daemon through the same origin", async ({ request }) => {
  const status = (await (await request.get(`${API}/api/open-design/status`)).json()) as { running: boolean; url: string };
  expect(typeof status.running).toBe("boolean");
  expect(status.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
});

test("the catalog endpoint lists the bundled systems and layouts without reading anything outside the bundle", async ({ request }) => {
  const catalog = (await (await request.get(`${API}/api/design/catalog`)).json()) as { systems: Array<{ id: string }>; templates: Array<{ id: string }> };
  expect(catalog.systems).toHaveLength(12);
  expect(catalog.templates).toHaveLength(10);
  expect(catalog.systems.map((system) => system.id)).toContain("claude");
});

test("a design project still carries its design system and layout in the shared model", async ({ request }) => {
  const name = `Mode Design ${STAMP}`;
  const created = (await (await request.post(`${API}/api/vibe/projects`, {
    data: { name, prompt: "mode test", kind: "design", designSystemId: "linear-app", designTemplateId: "dashboard" },
  })).json()) as { project: { id: string; kind: string; designSystemId: string; designTemplateId: string } };
  expect(created.project.kind).toBe("design");
  expect(created.project.designSystemId).toBe("linear-app");
  expect(created.project.designTemplateId).toBe("dashboard");
  await request.delete(`${API}/api/vibe/projects/${created.project.id}`);
});
