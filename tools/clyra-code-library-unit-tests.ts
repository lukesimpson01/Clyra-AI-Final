import assert from "node:assert/strict";
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { TEMPLATE_LIBRARY, getTemplateManifest, searchTemplateLibrary } from "../lib/clyra-code/library/registry";
import { inspectTemplateCheckout, isolatedCheckoutName } from "../lib/clyra-code/library/service";

let passed = 0;
async function test(name: string, run: () => void | Promise<void>) {
  await run();
  passed += 1;
  console.log(`PASS  ${name}`);
}

const originalForty = [
  "librechat", "vercel-chatbot", "perplexica", "openhands", "bolt-diy",
  "code-server", "gitea", "hoppscotch", "nocodb", "uptime-kuma",
  "appflowy", "plane", "wekan", "onlyoffice", "cal-diy", "penpot",
  "hycanvas", "minipaint", "opencut", "cap", "medusa", "twenty",
  "chatwoot", "invoiceninja", "formbricks", "stoat", "pixelfed",
  "peertube", "mastodon", "navidrome", "saas-starter", "astrofy",
  "medusa-dtc", "ghost", "docusaurus", "activepieces", "umami",
  "actual", "metabase", "excalidraw",
] as const;
const additionalTen = [
  "facilmap", "photon-selfhost", "valhalla-router", "supoclip",
  "browseros", "karakeep", "coolify", "appwrite", "jellyfin",
  "libretranslate",
] as const;

await test("the active catalogue preserves fifty source apps and adds 75 distinct landing pages", () => {
  assert.equal(TEMPLATE_LIBRARY.length, 125);
  const ids = new Set(TEMPLATE_LIBRARY.map((item) => item.id));
  const repositories = TEMPLATE_LIBRARY.map((item) => item.repositoryUrl.toLowerCase().replace(/\.git$/, ""));
  assert.equal(ids.size, 125);
  assert.equal(new Set(repositories).size, 125);
  for (const id of [...originalForty, ...additionalTen]) assert.ok(ids.has(id), `Missing ${id}`);
  const landing = TEMPLATE_LIBRARY.filter((item) => item.category === "Landing Pages");
  assert.equal(landing.length, 75);
  assert.equal(new Set(landing.map((entry) => entry.landingPageType)).size, 17);
  assert.ok(landing.every((entry) => entry.livePreviewUrl?.startsWith("https://uiuxlabz.github.io/")));
  assert.ok(landing.every((entry) => entry.sourceScreenshots.length === 1));
  assert.ok(landing.every((entry) => entry.status === "unverified" && entry.capabilitiesVerified.length === 0));
  assert.ok(TEMPLATE_LIBRARY.every((item) => item.repositoryUrl.startsWith("https://github.com/")));
});

await test("categories are derived from live entries, and search finds relevant comparisons", () => {
  assert.ok(new Set(TEMPLATE_LIBRARY.map((item) => item.category)).size >= 10);
  assert.ok(searchTemplateLibrary({ query: "OpusClip" }).some((item) => item.id === "supoclip"));
  assert.ok(searchTemplateLibrary({ query: "Perplexity Comet" }).some((item) => item.id === "browseros"));
  assert.ok(searchTemplateLibrary({ query: "Google Maps" }).some((item) => item.id === "facilmap"));
  assert.ok(searchTemplateLibrary({ query: "Lovable" }).some((item) => item.id === "bolt-diy"));
  assert.equal(searchTemplateLibrary({ category: "Landing Pages" }).length, 75);
  assert.ok(searchTemplateLibrary({ query: "KORVA" }).some((item) => item.id === "landing-ai-studio"));
  assert.ok(searchTemplateLibrary({ query: "Coffee" }).some((item) => item.id === "landing-coffee-shop"));
  assert.equal(searchTemplateLibrary({ query: "this will not match" }).length, 0);
});

await test("no seed pretends its third-party source is fully installed or already verified", () => {
  for (const item of TEMPLATE_LIBRARY) {
    assert.equal(item.pinnedCommit, null);
    assert.equal(item.lastVerifiedAt, null);
    assert.equal(item.capabilitiesVerified.length, 0);
    assert.notEqual(item.status, "runnable-now");
    if (item.mode === "reference-only") assert.equal(item.status, "reference-only");
  }
});

await test("real capture entries reference existing screenshots with alt text and provenance", async () => {
  const missing = TEMPLATE_LIBRARY.filter((item) => !item.sourceScreenshots.length);
  assert.ok(missing.length > 0, "Do not invent image captures for untested apps");
  assert.equal(TEMPLATE_LIBRARY.filter((item) => item.category === "Landing Pages" && item.sourceScreenshots.length === 1).length, 75);
  for (const item of TEMPLATE_LIBRARY) {
    for (const shot of item.sourceScreenshots) {
      assert.match(shot.url, /^\/library-shots\/[a-z0-9-]+\.jpg$/);
      assert.ok(shot.alt.trim().length > 8);
      if (item.category === "Landing Pages") {
        assert.match(shot.provenance, /Author-provided screenshot\.png/);
        assert.ok(!shot.provenance.includes("local run"));
      } else {
        assert.ok(shot.provenance.includes("local run"));
      }
      const file = path.join(process.cwd(), "public", shot.url.slice(1));
      await access(file);
      if (item.category === "Landing Pages") {
        const { stat, readFile } = await import("node:fs/promises");
        assert.ok((await stat(file)).size >= 8_000, `Thumbnail too small: ${file}`);
        const jpeg = await readFile(file);
        assert.equal(jpeg[0], 0xff);
        assert.equal(jpeg[1], 0xd8);
      }
    }
  }
});

await test("self-hosted maps and third-party browser preserve source-only warnings", () => {
  assert.equal(getTemplateManifest("photon-selfhost")?.mode, "engine");
  assert.equal(getTemplateManifest("valhalla-router")?.mode, "engine");
  assert.equal(getTemplateManifest("browseros")?.mode, "reference-only");
  assert.match(getTemplateManifest("photon-selfhost")!.warnings.join(" "), /not an unlimited/);
  assert.match(getTemplateManifest("valhalla-router")!.warnings.join(" "), /OSM extracts/);
});

await test("bounded checkout scanning reads manifests and licences but never executes scripts", async () => {
  const fixture = await mkdtemp(path.join(os.tmpdir(), "clyra-library-test-"));
  try {
    await writeFile(path.join(fixture, "LICENSE"), "MIT License\n\nPermission is hereby granted", "utf8");
    await writeFile(path.join(fixture, "package.json"), JSON.stringify({
      scripts: { build: "node dangerous-but-not-run.js", test: "node test.js" },
      dependencies: { react: "19.0.0" },
      devDependencies: { vite: "6.0.0" },
    }), "utf8");
    await writeFile(path.join(fixture, "package-lock.json"), "{}", "utf8");
    const scan = await inspectTemplateCheckout(fixture);
    assert.deepEqual(scan.license.files, ["LICENSE"]);
    assert.ok(scan.license.detected.includes("MIT"));
    assert.deepEqual(scan.scripts, ["build", "test"]);
    assert.deepEqual(scan.dependencies, ["react", "vite"]);
    assert.equal(scan.packageManager, "npm");
    assert.deepEqual(scan.lockfiles, ["package-lock.json"]);
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
});

await test("isolated source paths embed the verified Git revision", () => {
  const item = getTemplateManifest("excalidraw");
  assert.ok(item);
  assert.equal(isolatedCheckoutName(item!, {
    commit: "abcdef0123456789abcdef0123456789abcdef01",
    verifiedAt: "2026-11-11T00:00:00.000Z",
  }), "excalidraw-abcdef01");
});

console.log(`\n${passed} Clyra Code source-library contract checks passed.`);
