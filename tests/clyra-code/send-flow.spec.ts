import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

/**
 * The send path of the real Clyra Code workspace: the composer's height, opening
 * a project's task, and the moment a message lands. Every project made here is
 * removed afterwards. The send test stops its own run straight away, so no
 * model work is left running.
 */

const API = process.env.CLYRA_URL || "http://localhost:3000";
const STAMP = Date.now();
const STARTED = new Date(STAMP).toISOString();
const PROJECT_NAME = `Send Check ${STAMP}`;
const THREAD_TITLE = `Send thread ${STAMP}`;
const WELCOME_INPUT = /Ask Clyra to build, fix, or change something/;

let projectId = "";

async function openWorkspace(page: Page) {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`${API}/`);
  await page.getByText("Vibe Coder", { exact: true }).first().click();
  await expect(page.getByRole("heading", { name: "What do you want to build?" })).toBeVisible({ timeout: 60_000 });
}

test.beforeAll(async ({ request }) => {
  const created = await request.post(`${API}/api/vibe/projects`, { data: { name: PROJECT_NAME, prompt: "send test" } });
  expect(created.ok()).toBeTruthy();
  projectId = ((await created.json()) as { project: { id: string } }).project.id;
  // Project and session navigation must work even if the model runtime has not
  // been installed; actual model execution is covered by separate runtime tests.
  const session = await request.post(`${API}/api/opencode/sessions`, { data: { projectId, title: THREAD_TITLE } });
  expect(session.ok()).toBeTruthy();
});

test.afterAll(async ({ request }) => {
  if (projectId) await request.delete(`${API}/api/vibe/projects/${projectId}`);
  // Projects that the "New project" test created during this run, and nothing older.
  const body = (await (await request.get(`${API}/api/vibe/projects`)).json()) as { projects: Array<{ id: string; name: string; createdAt: string }> };
  for (const project of body.projects) {
    if (project.id !== projectId && project.createdAt >= STARTED && /^untitled project$/i.test(project.name)) {
      await request.delete(`${API}/api/vibe/projects/${project.id}`);
    }
  }
});

async function listThreads(request: APIRequestContext) {
  const response = await request.get(`${API}/api/opencode/sessions/${projectId}`);
  return (await response.json()) as Array<{ id: string; title: string }>;
}

test("the composer grows with its text and returns to one line when cleared", async ({ page }) => {
  await openWorkspace(page);
  const input = page.getByPlaceholder(WELCOME_INPUT);
  const oneLine = await input.evaluate((element) => element.getBoundingClientRect().height);
  // Ten explicit lines take the field well past the welcome minimum (two lines already fit inside it).
  await input.fill(Array.from({ length: 10 }, (_, index) => `Brief line ${index + 1}`).join("\n"));
  await expect.poll(() => input.evaluate((element) => element.getBoundingClientRect().height)).toBeGreaterThan(oneLine + 10);
  // Growth is capped, so a long draft scrolls rather than pushing the page apart.
  expect(await input.evaluate((element) => element.getBoundingClientRect().height)).toBeLessThanOrEqual(141);
  await input.fill("");
  await expect.poll(() => input.evaluate((element) => element.getBoundingClientRect().height)).toBeLessThanOrEqual(oneLine + 1);
});

test("a project opens its existing task and its messages area, not the welcome screen", async ({ page }) => {
  await openWorkspace(page);
  await page.locator(`[data-project-row="${projectId}"]`).click();
  await expect(page.locator(`[data-nav-row][title="${THREAD_TITLE}"]`)).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole("heading", { name: "What do you want to build?" })).toHaveCount(0);
  // The task is open: its empty-state copy is shown in the conversation column.
  await expect(page.getByText("No messages in this task yet")).toBeVisible({ timeout: 60_000 });
});

test("a send lands in the transcript at once, shows working, and can be stopped", async ({ page }) => {
  await openWorkspace(page);
  await page.getByRole("button", { name: "Add project" }).click();
  await page.getByRole("menuitem", { name: "New project" }).click();
  const input = page.getByPlaceholder(WELCOME_INPUT);
  await expect(input).toBeVisible({ timeout: 30_000 });
  const prompt = "hello, reply in one short sentence";
  await input.fill(prompt);
  await input.press("Enter");
  // The bubble and the working line must not wait for project creation or the runtime.
  await expect(page.locator(".cc-user-prompt", { hasText: prompt })).toBeVisible({ timeout: 3_000 });
  await expect(page.getByRole("status").filter({ hasText: "Working" })).toBeVisible({ timeout: 3_000 });
  await expect(page.getByRole("heading", { name: "What do you want to build?" })).toHaveCount(0);
  await page.getByRole("button", { name: "Stop" }).click();
  await expect(page.getByText("Cancelled by user")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole("status").filter({ hasText: "Working" })).toHaveCount(0);
});

test("the test thread is still listed under its project", async ({ request }) => {
  const threads = await listThreads(request);
  expect(threads.some((thread) => thread.title === THREAD_TITLE)).toBeTruthy();
});
