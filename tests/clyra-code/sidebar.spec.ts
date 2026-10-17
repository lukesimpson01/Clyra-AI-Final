import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

/**
 * Sidebar behaviour against the live Clyra Code workspace. Each run creates its own
 * project and removes it afterwards. Only the sidebar's own API calls are made, so
 * no model call and no repository work is triggered by these tests.
 */

const API = process.env.CLYRA_URL || "http://localhost:3000";
const STAMP = Date.now();
const PROJECT_NAME = `Sidebar Check ${STAMP}`;
const THREAD_TITLE = `Sidebar Search ${STAMP}`;

let projectId = "";
let threadId = "";

async function listThreads(request: APIRequestContext, id: string) {
  const response = await request.get(`${API}/api/opencode/sessions/${id}`);
  expect(response.ok()).toBeTruthy();
  return (await response.json()) as Array<{ id: string; title: string }>;
}

async function openWorkspace(page: Page) {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`${API}/`);
  await page.getByText("Vibe Coder", { exact: true }).first().click();
  await expect(page.getByRole("heading", { name: "What do you want to build?" })).toBeVisible({ timeout: 60_000 });
}

test.beforeAll(async ({ request }) => {
  const created = await request.post(`${API}/api/vibe/projects`, { data: { name: PROJECT_NAME, prompt: "sidebar test" } });
  expect(created.ok()).toBeTruthy();
  projectId = ((await created.json()) as { project: { id: string } }).project.id;
  // The UI starts the runtime before it creates a session, so the test does the same.
  const runtime = await request.post(`${API}/api/opencode/runtime/start`, { data: { projectId } });
  expect(runtime.ok()).toBeTruthy();
  const session = await request.post(`${API}/api/opencode/sessions`, { data: { projectId, title: THREAD_TITLE } });
  expect(session.ok()).toBeTruthy();
  threadId = ((await session.json()) as { id: string }).id;
});

test.afterAll(async ({ request }) => {
  if (projectId) await request.delete(`${API}/api/vibe/projects/${projectId}`);
});

test("the sidebar search opens and its results are grouped into Projects and Threads", async ({ page }) => {
  // Ctrl+K belongs to the app-wide launcher, so search is opened from its own button.
  await openWorkspace(page);
  await page.getByRole("button", { name: "Search", exact: true }).click();
  const search = page.getByLabel("Search projects and tasks");
  await expect(search).toBeFocused();
  await search.fill(THREAD_TITLE);
  const results = page.getByLabel("Search results");
  await expect(results).toBeVisible();
  await expect(results.getByLabel("Matching threads")).toContainText(THREAD_TITLE);
  await expect(results.getByRole("heading", { name: "Threads" })).toBeVisible();
  await page.keyboard.press("Escape");
});

test("the + beside Projects offers only real project actions", async ({ page }) => {
  await openWorkspace(page);
  await page.getByRole("button", { name: "Add project" }).click();
  await expect(page.getByRole("menuitem", { name: "New project" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Open existing project" })).toBeVisible();
  await expect(page.getByRole("menuitem")).toHaveCount(2);
});

test("New task starts a thread in the selected project without creating a project", async ({ page, request }) => {
  await openWorkspace(page);
  await page.locator(`[data-project-row="${projectId}"]`).click();
  const before = await listThreads(request, projectId);
  await page.getByRole("button", { name: "New task", exact: true }).click();
  await expect.poll(async () => (await listThreads(request, projectId)).length, { timeout: 30_000 }).toBe(before.length + 1);
  const projects = (await (await request.get(`${API}/api/vibe/projects`)).json()) as { projects: Array<{ id: string }> };
  expect(projects.projects.filter((project) => project.id === projectId)).toHaveLength(1);
});

test("a task can be renamed from its menu and the name is kept", async ({ page, request }) => {
  await openWorkspace(page);
  await page.locator(`[data-project-row="${projectId}"]`).click();
  const row = page.locator(`[data-nav-row][title="${THREAD_TITLE}"]`);
  await expect(row).toBeVisible({ timeout: 30_000 });
  await row.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Rename" }).click();
  const input = page.getByLabel("Task name");
  await input.fill(`Renamed ${STAMP}`);
  await input.press("Enter");
  await expect.poll(async () => (await listThreads(request, projectId)).find((item) => item.id === threadId)?.title).toBe(`Renamed ${STAMP}`);
});

test("a project can be renamed from its menu, and the stored name changes", async ({ page, request }) => {
  await openWorkspace(page);
  await page.locator(`[data-project-row="${projectId}"]`).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Rename" }).click();
  const input = page.getByLabel("Task name");
  await input.fill(`Renamed Project ${STAMP}`);
  await input.press("Enter");
  await expect.poll(async () => {
    const body = (await (await request.get(`${API}/api/vibe/projects`)).json()) as { projects: Array<{ id: string; name: string; nameSource?: string }> };
    const project = body.projects.find((item) => item.id === projectId);
    return project ? `${project.name}|${project.nameSource ?? ""}` : "";
  }).toBe(`Renamed Project ${STAMP}|user`);
});
