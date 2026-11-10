import assert from "node:assert/strict";
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { TEMPLATE_LIBRARY, getTemplateManifest, searchTemplateLibrary, templateLibraryCategories } from "../lib/clyra-code/library/registry";
import { inspectTemplateCheckout, isolatedCheckoutName } from "../lib/clyra-code/library/service";

let passed = 0;
async function test(name: string, run: () => void | Promise<void>) {
  await run();
  passed += 1;
  console.log(`PASS  ${name}`);
}

const ORIGINAL_CATEGORIES = [
  "AI Chats & Agents",
  "Automation & Data",
  "Business & SaaS",
  "Design, Video & Creative",
  "Developer Tools",
  "Productivity & Collaboration",
  "Social & Entertainment",
  "Websites & Publishing",
];
const ADDED_CATEGORIES = ["AI Agents & Automation", "AI App Builders", "AI Clippers", "AI Coding", "AI Tools", "Adobe alternatives", "Microsoft Office alternatives", "Notes, Docs & Presentations"];

await test("the catalogue holds the 40 starter templates plus the added entries with unique identities", () => {
  assert.ok(TEMPLATE_LIBRARY.length >= 40);
  assert.equal(new Set(TEMPLATE_LIBRARY.map((entry) => entry.id)).size, TEMPLATE_LIBRARY.length);
  assert.equal(new Set(TEMPLATE_LIBRARY.map((entry) => entry.repositoryUrl)).size, TEMPLATE_LIBRARY.length);
  const original = TEMPLATE_LIBRARY.filter((entry) => ORIGINAL_CATEGORIES.includes(entry.category));
  assert.ok(original.length >= 40);
});

await test("categories are the eight originals plus the added ones, and every record has a GitHub URL", () => {
  assert.deepEqual(templateLibraryCategories(), [...ORIGINAL_CATEGORIES, ...ADDED_CATEGORIES].sort((a, b) => a.localeCompare(b)));
  assert.ok(TEMPLATE_LIBRARY.every((entry) => /^https:\/\/github\.com\/[^/]+\/[^/]+$/.test(entry.repositoryUrl)));
});

await test("every declared screenshot file exists on disk and is served from /library-shots", async () => {
  for (const entry of TEMPLATE_LIBRARY) {
    for (const shot of entry.sourceScreenshots) {
      assert.ok(shot.url.startsWith("/library-shots/"), `${entry.id}: ${shot.url}`);
      assert.ok(shot.alt.length > 3, `${entry.id}: missing alt text`);
      await access(path.join(process.cwd(), "public", shot.url));
    }
  }
});

await test("records without launch-testing make no runnable or screenshot claims", () => {
  for (const entry of TEMPLATE_LIBRARY.filter((item) => item.lastVerifiedAt === null)) {
    assert.equal(entry.sourceScreenshots.length, 0, entry.id);
    assert.equal(entry.capabilitiesVerified.length, 0, entry.id);
    assert.notEqual(entry.status, "runnable-now", entry.id);
  }
});

await test("launch-tested records carry captures, a date and a non-empty note list", () => {
  const verified = TEMPLATE_LIBRARY.filter((item) => item.lastVerifiedAt !== null);
  assert.ok(verified.length >= 25);
  for (const entry of verified) {
    assert.ok(entry.capabilitiesVerified.length > 0, entry.id);
    assert.ok(entry.warnings.length > 0, entry.id);
  }
  const captured = TEMPLATE_LIBRARY.filter((item) => item.sourceScreenshots.length > 0);
  assert.ok(captured.length >= 25);
  assert.ok(captured.every((entry) => entry.sourceScreenshots.length >= 3), "every captured app has at least three screenshots");
});

await test("licences found in the repository files replace the generic review placeholders", () => {
  assert.equal(getTemplateManifest("vercel-chatbot")?.licenseSpdxOrReview, "Apache-2.0");
  assert.equal(getTemplateManifest("minipaint")?.licenseSpdxOrReview, "MIT");
  assert.equal(getTemplateManifest("nocodb")?.licenseSpdxOrReview, "License review");
  assert.ok(getTemplateManifest("nocodb")?.warnings.some((warning) => /Sustainable Use License/.test(warning)));
});

await test("source search matches names, categories and comparison labels", () => {
  assert.ok(searchTemplateLibrary({ query: "Photoshop" }).some((entry) => entry.id === "svgedit" || entry.id === "filerobot-image-editor" || entry.id === "minipaint"));
  assert.ok(searchTemplateLibrary({ category: "Adobe alternatives" }).some((entry) => entry.id === "stirling-pdf"));
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
