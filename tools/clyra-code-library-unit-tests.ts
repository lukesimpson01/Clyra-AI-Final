import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
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

await test("source search matches independent comparison labels and capabilities", () => {
  assert.ok(searchTemplateLibrary({ query: "OpusClip" }).some((entry) => entry.id === "chopify"));
  assert.ok(searchTemplateLibrary({ category: "Maps" }).some((entry) => entry.id === "maplibre"));
  assert.equal(searchTemplateLibrary({ query: "this will not match" }).length, 0);
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
