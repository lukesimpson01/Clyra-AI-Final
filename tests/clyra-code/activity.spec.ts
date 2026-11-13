import { expect, test } from "@playwright/test";

/* The Working timeline, plan card and change pill, on the dev fixture page (/__dev/agent-actions). It checks that the
   new outside works, and that the existing diff and terminal viewers still open from it unchanged. */
test.describe("Working timeline", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/__dev/agent-actions");
    await page.locator(".clyra-code-root .cxa-group").first().waitFor();
  });
  const root = (page: import("@playwright/test").Page) => page.locator(".clyra-code-root").first();

  test("groups are named by what they did and open independently", async ({ page }) => {
    const heads = root(page).locator(".cxa-head");
    await expect(heads.nth(0)).toHaveText("Explored 3 files");
    await expect(heads.nth(1)).toHaveText("Edited 2 files · Created 2 files");
    await expect(heads.nth(2)).toContainText("Ran 1 command · 2 checks");
    await expect(heads.nth(0)).toHaveAttribute("aria-expanded", "false");
    await heads.nth(0).click();
    await expect(heads.nth(0)).toHaveAttribute("aria-expanded", "true");
    await expect(heads.nth(1)).toHaveAttribute("aria-expanded", "true");
    await heads.nth(0).click();
    await expect(heads.nth(0)).toHaveAttribute("aria-expanded", "false");
    await expect(heads.nth(1)).toHaveAttribute("aria-expanded", "true");
  });

  test("a file row opens the existing diff card, and a command row the existing terminal card", async ({ page }) => {
    const rows = root(page).locator(".cxa-row");
    await rows.filter({ hasText: "AgentUI.tsx" }).click();
    await expect(root(page).locator(".cxa-body").first()).toContainText("src/components/AgentUI.tsx");
    await expect(root(page).locator(".cxa-body").first()).toContainText("+43");
    await rows.filter({ hasText: "npm run build" }).click();
    await expect(root(page).locator(".cxa-body").filter({ hasText: "built in" })).toHaveCount(1);
  });

  test("every file-edit and command row has its own chevron that opens and turns down", async ({ page }) => {
    const rows = root(page).locator(".cxa-row");
    const edit = rows.filter({ hasText: "AgentUI.tsx" });
    const command = rows.filter({ hasText: "npm run typecheck" });
    for (const row of [edit, command]) {
      await expect(row.locator(".cxr-row-chevron, .cxa-row-chevron")).toHaveCount(1);
      await expect(row).toHaveAttribute("aria-expanded", "false");
      await row.click();
      await expect(row).toHaveAttribute("aria-expanded", "true");
      await expect(row.locator(".cxa-row-chevron")).toHaveAttribute("data-open", "true");
      await row.click();
      await expect(row).toHaveAttribute("aria-expanded", "false");
    }
  });

  test("the working line moves only while working, and the header never reflows", async ({ page }) => {
    const header = root(page).locator(".cxr[data-phase=running]").first();
    await expect(header.locator(".cxr-line")).toBeVisible();
    const before = await header.locator(".cxr-toggle").boundingBox();
    await page.waitForTimeout(1300);
    const after = await header.locator(".cxr-toggle").boundingBox();
    expect(after!.x).toBe(before!.x);
    await expect(root(page).locator(".cxr[data-phase=complete] .cxr-line").first()).toBeHidden();
  });

  test("the plan card rests folded, opens while hovered, and reports honest progress", async ({ page }) => {
    const plans = page.locator(".pl:not(.pl--panel)");
    await expect(plans.nth(0).locator(".pl-toggle")).toHaveAttribute("aria-expanded", "false");
    await plans.nth(0).hover();
    await expect(plans.nth(0).locator(".pl-toggle")).toHaveAttribute("aria-expanded", "true");
    await expect(plans.nth(0).locator(".pl-count")).toHaveText("Step 2 / 5");
    await expect(plans.nth(0).locator(".pl-step")).toHaveCount(5);
    await page.mouse.move(5, 5);
    await expect(plans.nth(0).locator(".pl-toggle")).toHaveAttribute("aria-expanded", "false");
    await plans.nth(1).hover();
    await expect(plans.nth(1).locator(".pl-count")).toHaveText("3 / 5 completed");
    await expect(plans.nth(1).locator('.pl-step[data-status="blocked"]')).toHaveCount(1);
    await plans.nth(2).hover();
    await expect(plans.nth(2).locator(".pl-count")).toHaveText("4 / 4 completed");
  });

  test("out-of-order work is shown as a count, never as a step number", async ({ page }) => {
    await expect(page.locator(".pl--panel .pl-count")).toHaveText("2 / 4 completed");
  });

  test("the change pill shows real totals and is keyboard reachable", async ({ page }) => {
    const pill = page.locator(".cc-change-pill").first();
    await expect(pill).toContainText("6 files");
    await expect(pill).toContainText("253");
    await expect(pill).toContainText("32");
    await pill.focus();
    await expect(pill).toBeFocused();
  });

  test("git, browser, image, subagent and connector calls get their own groups and wording", async ({ page }) => {
    const kinds = page.locator("#tool-kinds");
    const heads = kinds.locator(".cxa-head");
    await expect(heads.nth(0)).toHaveText("Ran 2 Git commands");
    await expect(heads.nth(1)).toHaveText("Inspected the website");
    await expect(heads.nth(2)).toHaveText("Viewed an image");
    await expect(heads.nth(3)).toHaveText("Ran 2 subagents · Used 1 connector tool…");
    /* a group with work still running is open by itself */
    await expect(heads.nth(3)).toHaveAttribute("aria-expanded", "true");
    await expect(kinds.locator(".cxa-row").filter({ hasText: "create_issue · github" })).toHaveCount(1);
    await expect(kinds.locator(".cxa-row").filter({ hasText: "Running a subagent" })).toHaveCount(1);
    await heads.nth(0).click();
    await expect(kinds.locator(".cxa-row").filter({ hasText: "Checked Git status" })).toHaveCount(1);
    await kinds.locator(".cxa-row").filter({ hasText: "Checked Git status" }).click();
    await expect(kinds.locator(".cxa-body").first()).toContainText("M src/App.tsx");
  });

  test("repeated group toggles stay responsive", async ({ page }) => {
    const ms = await page.evaluate(async () => {
      const head = document.querySelector<HTMLButtonElement>(".clyra-code-root .cxa-head")!;
      const start = performance.now();
      for (let i = 0; i < 20; i += 1) { head.click(); await new Promise((r) => requestAnimationFrame(() => r(null))); }
      return performance.now() - start;
    });
    expect(ms).toBeLessThan(6000);
  });
});
