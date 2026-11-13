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
  const response = await request.get(`${API}/api/clyra-code/library?limit=250`);
  expect(response.ok()).toBeTruthy();
  const catalogue = (await response.json()) as {
    entries: Array<{ id: string; status: string; sourceScreenshots: Array<{ url: string }>; pinnedCommit: string | null }>;
    total: number;
  };
  expect(catalogue.total).toBe(131);
  expect(catalogue.entries.length).toBe(131);
  expect(new Set(catalogue.entries.map((entry) => entry.id)).size).toBe(131);
  for (const id of ["astrofy", "excalidraw", "bolt-diy", "browseros", "facilmap", "supoclip"]) {
    expect(catalogue.entries.some((entry) => entry.id === id)).toBeTruthy();
  }
  expect(catalogue.entries.every((entry) => entry.status !== "runnable-now" && entry.pinnedCommit === null)).toBeTruthy();
  expect(catalogue.entries.find((entry) => entry.id === "astrofy")?.sourceScreenshots.length).toBeGreaterThan(0);
  expect(catalogue.entries.find((entry) => entry.id === "bolt-diy")?.sourceScreenshots).toHaveLength(0);
  const landings = catalogue.entries.filter((entry) => entry.id.startsWith("landing-"));
  expect(landings.length).toBe(75);
  expect(landings.every((entry) => entry.sourceScreenshots.length === 4)).toBeTruthy();

});

test("source library has featured carousel arrows, real previews and honest missing-preview states", async ({ page }) => {
  await openWorkspace(page);
  await page.getByRole("button", { name: "Library", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Clyra Library" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("heading", { name: "Discover", exact: true })).toBeVisible();
  await expect(dialog.getByRole("heading", { name: "Templates with previews" })).toBeVisible();
  await expect(dialog.getByRole("heading", { name: "Explore source projects" })).toBeVisible();
  await expect(dialog.getByRole("tab", { name: "Show Astrofy" })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "View LibreChat details" }).first()).toBeVisible();
  // Screenshotless records are text-and-icon rows; the home page must never
  // be 47 giant repeated empty grey image panels.
  await expect(dialog.getByText("Preview not captured")).toHaveCount(0);
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

test("Landing Pages has 75 real preview cards and 17 business-type filters", async ({ page, request }) => {
  const response = await request.get(`${API}/api/clyra-code/library?category=Landing%20Pages&limit=250`);
  expect(response.ok()).toBeTruthy();
  const body = (await response.json()) as { total: number; entries: Array<{ landingPageType: string; id: string; livePreviewUrl: string; sourceScreenshots: Array<{ url: string }> }> };
  expect(body.total).toBe(75);
  expect(new Set(body.entries.map((entry) => entry.landingPageType)).size).toBe(17);
  for (const entry of body.entries) {
    expect(entry.sourceScreenshots[0].url).toBe(`/library-shots/${entry.id}.jpg`);
    expect(entry.sourceScreenshots.map((shot) => shot.url)).toEqual([
      `/library-shots/${entry.id}.jpg`,
      `/library-shots/${entry.id}-section-1.jpg`,
      `/library-shots/${entry.id}-section-2.jpg`,
      `/library-shots/${entry.id}-section-3.jpg`,
    ]);
    expect(entry.livePreviewUrl).toMatch(/^https:\/\/uiuxlabz\.github\.io\//);
  }
  const image = await request.get(`${API}/library-shots/landing-ai-studio.jpg`);
  expect(image.ok()).toBeTruthy();
  expect(image.headers()["content-type"]).toContain("image/jpeg");
  expect((await image.body()).length).toBeGreaterThan(8000);
  const sectionImage = await request.get(`${API}/library-shots/landing-ai-studio-section-2.jpg`);
  expect(sectionImage.ok()).toBeTruthy();
  expect(sectionImage.headers()["content-type"]).toContain("image/jpeg");

  await openWorkspace(page);
  await page.getByRole("button", { name: "Library", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Clyra Library" });
  await expect(dialog.getByRole("heading", { name: "Landing Pages" })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "View KORVA — AI Studio details" }).first()).toBeVisible();
  await expect(dialog.getByRole("button", { name: "View VitalApp — Mobile App details" }).first()).toBeVisible();

  await dialog.getByRole("button", { name: "Landing Pages", exact: true }).first().click();
  await expect(dialog.getByRole("heading", { name: "Landing Pages" })).toBeVisible();
  await expect(dialog.getByText("75 designs across 17 industries")).toBeVisible();
  await expect(dialog.getByRole("group", { name: "Filter landing pages by type" })).toBeVisible();
  await dialog.getByRole("button", { name: "SaaS & AI", exact: true }).click();
  await expect(dialog.getByText("8 SaaS & AI designs")).toBeVisible();

  await dialog.getByRole("button", { name: "View KORVA — AI Studio details" }).first().click();
  await expect(dialog.getByRole("heading", { name: "KORVA — AI Studio", exact: true })).toBeVisible();
  await expect(dialog.getByRole("link", { name: "Live demo" })).toHaveAttribute("href", "https://uiuxlabz.github.io/ai-studio-html-template/");
  await expect(dialog.getByText(/Original homepage preview from uiuxlabz\/ai-studio-html-template/)).toBeVisible();
  await expect(dialog.locator('img[src^="/library-shots/landing-ai-studio"]')).toHaveCount(4);
  const previews = dialog.getByLabel("Template screenshot gallery");
  const nextImage = dialog.getByRole("button", { name: "Next preview screenshot" });
  await expect(dialog.getByText("4 real screenshots")).toBeVisible();
  await expect(nextImage).toBeVisible();
  const beforeScroll = await previews.evaluate((node) => node.scrollLeft);
  await nextImage.click();
  await expect.poll(async () => previews.evaluate((node) => node.scrollLeft), { timeout: 5_000 }).toBeGreaterThan(beforeScroll + 50);
  const shot = dialog.locator('img[src="/library-shots/landing-ai-studio.jpg"]').first();
  await expect(shot).toBeVisible();
  expect(await shot.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 500)).toBeTruthy();
});

test("Featured Apps highlights OpenCluely, OpenHands, OpenFilm and Adobe alternatives", async ({ page, request }) => {
  const response = await request.get(`${API}/api/clyra-code/library?limit=250`);
  expect(response.ok()).toBeTruthy();
  const data = (await response.json()) as { entries: Array<{ id: string; name: string; repositoryUrl: string; status: string }> };
  const featuredIds = ["opencluely", "openhands", "openfilm", "minipaint", "krita", "svgedit", "kdenlive", "natron", "penpot"];
  expect(new Set(featuredIds).size).toBe(9);
  for (const id of featuredIds) expect(data.entries.filter((entry) => entry.id === id)).toHaveLength(1);
  for (const id of ["krita", "natron", "kdenlive"]) {
    expect(data.entries.find((entry) => entry.id === id)?.status).toBe("reference-only");
  }

  await openWorkspace(page);
  await page.getByRole("button", { name: "Library", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Clyra Library" });
  const featured = dialog.getByRole("region", { name: "Featured Apps" });
  await expect(featured).toBeVisible();
  for (const name of ["OpenCluely", "OpenHands", "OpenFilm", "miniPaint", "Krita", "SVGEdit", "Kdenlive", "Natron", "Penpot"]) {
    await expect(featured.getByRole("button", { name: `View ${name} details` })).toHaveCount(1);
  }
  await expect(featured.getByRole("button", { name: "Get", exact: true })).toHaveCount(9);
  await featured.getByRole("button", { name: "View OpenFilm details" }).click();
  await expect(dialog.getByRole("heading", { name: "OpenFilm", exact: true })).toBeVisible();
  await expect(dialog.getByText(/Requires Node 22, pnpm, FFmpeg/).first()).toBeVisible();
  await expect(dialog.locator('img[src^="/library-shots/app-openfilm-source-"]')).toHaveCount(3);
  await expect(dialog.getByText("source downloaded", { exact: false })).toHaveCount(0);
});
