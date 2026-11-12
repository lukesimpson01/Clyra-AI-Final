import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { TEMPLATE_LIBRARY, getTemplateManifest, searchTemplateLibrary } from "../lib/clyra-code/library/registry";
import { inspectTemplateCheckout, isolatedCheckoutName } from "../lib/clyra-code/library/service";
import { displayNameFor, htmlTitleOf } from "../lib/clyra-code/projects/display-name";
import { sampleTemplateReviews, sampleTemplateRating } from "../src/components/clyra-code/templateReviewSamples";
import { describeCodeError } from "../src/components/clyra-code/codeErrorPresentation";
import { shouldShowWorkspaceFile } from "../src/components/clyra-code/workspaceFileVisibility";

let passed = 0;
async function test(name: string, run: () => void | Promise<void>) {
  await run();
  passed += 1;
  console.log(`PASS  ${name}`);
}

await test("the file explorer never exposes internal agent instructions", () => {
  for (const hidden of ["AGENTS.md", ".agent/AGENTS.md", ".agent/skills/anything.md", ".clyra/runtime.json", ".opencode/config.json", "src/CLAUDE.md", "node_modules/react/index.js", "folder\\AGENTS.md", "docs/SOUL.md"]) {
    assert.equal(shouldShowWorkspaceFile(hidden), false, hidden);
  }
  for (const visible of ["src/App.tsx", "README.md", "src/components/Welcome.tsx", "public/index.html", "package.json"]) {
    assert.equal(shouldShowWorkspaceFile(visible), true, visible);
  }
});

await test("coding errors are categorized from actual diagnostics rather than a generic error", () => {
  const cases = [
    ["401 unauthorized API key", "auth"],
    ["429 rate limit exceeded", "rate-limit"],
    ["connect ECONNREFUSED 127.0.0.1", "network"],
    ["npm ERR missing package", "dependencies"],
    ["src/App.tsx(8): error TS2322", "typescript"],
    ["EACCES permission denied", "permission"],
    ["EADDRINUSE: address already in use", "port"],
    ["ENOENT no such file or directory", "missing"],
    ["Build failed: Unexpected token", "build"],
    ["An unexpected operation failed", "runtime"],
  ] as const;
  for (const [message, kind] of cases) {
    const issue = describeCodeError(message);
    assert.equal(issue.kind, kind, message);
    assert.ok(issue.title.length > 4 && issue.nextStep.length > 12);
  }
});

await test("the curated source library is a real 50+ inventory with stable identities", () => {
  assert.ok(TEMPLATE_LIBRARY.length >= 50);
  assert.equal(new Set(TEMPLATE_LIBRARY.map((entry) => entry.id)).size, TEMPLATE_LIBRARY.length);
  assert.equal(new Set(TEMPLATE_LIBRARY.map((entry) => entry.repositoryUrl)).size, TEMPLATE_LIBRARY.length);
  assert.ok(TEMPLATE_LIBRARY.every((entry) => entry.repositoryUrl.startsWith("https://github.com/")));
});

await test("unverified records do not claim runnable builds or invented screenshots", () => {
  const entry = getTemplateManifest("purffle-shorts");
  assert.ok(entry);
  assert.equal(entry?.pinnedCommit, null);
  assert.equal(entry?.lastVerifiedAt, null);
  assert.equal(entry?.capabilitiesVerified.length, 0);
  assert.equal(entry?.sourceScreenshots.length, 0);
  assert.equal(entry?.status, "unverified");
});

await test("official upstream previews are attributed and never represented as tested Clyra screenshots", () => {
  const supplied = ["excalidraw", "actual-budget", "open-webui", "appflowy", "n8n", "penpot", "chatwoot"];
  for (const id of supplied) {
    const entry = getTemplateManifest(id);
    assert.ok(entry?.sourceScreenshots.length, "Missing upstream preview for " + id);
    for (const shot of entry!.sourceScreenshots) {
      assert.match(shot.url, /^https:\/\//);
      assert.ok(shot.alt.length > 8);
      assert.match(shot.provenance, /Upstream project README/);
      assert.match(shot.provenance, /Not a screenshot of a running Clyra template/);
    }
    assert.equal(entry?.capabilitiesVerified.length, 0);
    assert.equal(entry?.pinnedCommit, null);
  }
  assert.ok(getTemplateManifest("appflowy")!.sourceScreenshots.length >= 5);
  const openhands = getTemplateManifest("openhands");
  assert.ok(openhands && openhands.sourceScreenshots.length >= 6);
  assert.match(openhands!.sourceScreenshots[0].alt, /welcome screen/);
  assert.match(openhands!.sourceScreenshots[1].alt, /composer/);
  assert.equal(getTemplateManifest("purffle-shorts")?.sourceScreenshots.length, 0);
});

await test("missing project-name helper restores safe display labels without changing stored names", () => {
  assert.equal(htmlTitleOf("<html><title>Acme Dashboard &amp; Reports</title></html>"), "Acme Dashboard & Reports");
  assert.equal(htmlTitleOf("<html><body>No title</body></html>"), undefined);
  assert.equal(displayNameFor({ name: "Untitled project", htmlTitle: "Acme Dashboard" }), "Acme Dashboard");
  assert.equal(displayNameFor({ name: "Build me a dashboard", htmlTitle: "Vite + React", packageName: "@org/sales-panel" }), "Sales Panel");
  assert.equal(displayNameFor({ name: "My Custom Project", htmlTitle: "Other Name", renamedByUser: true }), "My Custom Project");
});

await test("all catalogue entries have eight clearly synthetic, distinctive, accurate 4–5-star sample previews", () => {
  for (const entry of TEMPLATE_LIBRARY) {
    const reviews = sampleTemplateReviews(entry);
    const score = sampleTemplateRating(entry);
    assert.equal(reviews.length, 8, entry.id);
    assert.equal(new Set(reviews.map((r) => r.id)).size, 8, entry.id);
    assert.equal(new Set(reviews.map((r) => r.title)).size, 8, entry.id);
    assert.ok(reviews.every((r) => r.isSample && r.author === "Sample review" && [4, 5].includes(r.rating)), entry.id);
    assert.ok(reviews.every((r) => r.title.includes(entry.name) || r.title.includes(entry.category)), entry.id);
    assert.ok(reviews.every((r) => r.body.length > 38), entry.id);
    assert.ok(reviews.some((r) => r.body.includes(entry.name) || r.body.includes(entry.name.split(" ")[0]) || r.body.includes(entry.description.split(" ")[0])), entry.id);
    assert.ok(score.average >= 4 && score.average <= 5, entry.id);
    assert.equal(score.count, 8);
    assert.equal(score.distribution[4] + score.distribution[5], 8);
    assert.equal(score.distribution[1] + score.distribution[2] + score.distribution[3], 0);
    assert.equal(Number((reviews.reduce((sum, r) => sum + r.rating, 0) / 8).toFixed(6)), Number(score.average.toFixed(6)));
  }
  assert.match(sampleTemplateReviews(getTemplateManifest("excalidraw")!)[0].body, /hand-drawn/);
  assert.match(sampleTemplateReviews(getTemplateManifest("appflowy")!)[0].body, /docs, tasks and database/);
  assert.match(sampleTemplateReviews(getTemplateManifest("bolt-diy")!)[0].body, /Prompt-to-app/);
});

await test("source search matches independent comparison labels and capabilities", () => {
  assert.ok(searchTemplateLibrary({ query: "OpusClip" }).some((entry) => entry.id === "chopify"));
  assert.ok(searchTemplateLibrary({ category: "Maps" }).some((entry) => entry.id === "maplibre"));
  assert.equal(searchTemplateLibrary({ query: "this will not match" }).length, 0);
});

await test("the expanded catalogue includes unique missing app types without duplicating existing sources", () => {
  const added = [
    "facilmap", "photon-self-hosted", "valhalla", "browseros", "doory",
    "karakeep", "actual-budget", "bolt-diy", "coolify", "pocketbase",
    "cryptpad", "jellyfin", "navidrome", "libretranslate", "gitea",
  ];
  assert.ok(TEMPLATE_LIBRARY.length >= 83);
  for (const id of added) assert.ok(getTemplateManifest(id), `Missing source template: ${id}`);
  for (const id of ["appflowy", "affine", "maplibre", "cutawan"]) {
    assert.equal(TEMPLATE_LIBRARY.filter((entry) => entry.id === id).length, 1);
  }
  const repositorySlugs = TEMPLATE_LIBRARY.map((entry) => entry.repositoryUrl.toLowerCase().replace(/\.git$/, ""));
  assert.equal(new Set(repositorySlugs).size, repositorySlugs.length);
});

await test("map services are explicit self-hosted sources and browser source is reference-only", () => {
  const photon = getTemplateManifest("photon-self-hosted");
  const valhalla = getTemplateManifest("valhalla");
  const browseros = getTemplateManifest("browseros");
  assert.equal(photon?.mode, "engine");
  assert.equal(valhalla?.mode, "engine");
  assert.equal(browseros?.mode, "reference-only");
  assert.match(photon?.warnings.join(" ") ?? "", /public Photon is not an unlimited/);
  assert.match(valhalla?.warnings.join(" ") ?? "", /OSM extracts/);
  assert.equal(browseros?.capabilitiesVerified.length, 0);
  assert.equal(browseros?.pinnedCommit, null);
});

await test("the bounded checkout scan discovers notices and scripts without executing them", async () => {
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

await test("isolated source paths embed a resolved revision and never use a user-supplied path", () => {
  const entry = getTemplateManifest("excalidraw");
  assert.ok(entry);
  assert.equal(isolatedCheckoutName(entry!, { commit: "abcdef0123456789abcdef0123456789abcdef01", verifiedAt: "2026-10-17T00:00:00.000Z" }), "excalidraw-abcdef01");
});

console.log(`\n${passed} Clyra Code library checks passed.`);
