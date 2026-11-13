import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";

// Runs against the real `git clone`s in external/ (npm run setup:component-sources).
const data = await mkdtemp(path.join(tmpdir(), "clyra-components-"));
process.env.CLYRA_DATA_ROOT = data;
try {
  const library = await import("../lib/clyra-code/offline-component-library");
  const status = await library.localSourceStatus();
  assert.ok(status.every((entry) => entry.available), "run npm run setup:component-sources first");

  const all = await library.listLocalComponents();
  assert.ok(all.length >= 100, "expected the full shadcn library plus 21st components, got " + all.length);
  const ids = new Set(all.map((item) => item.id));
  for (const id of ["shadcn:button", "shadcn:accordion", "shadcn:sidebar", "shadcn:chart-area-default", "21st:aurora-background", "21st:text-shimmer"]) {
    assert.ok(ids.has(id), "missing " + id);
  }
  // Categories are the usual component categories, never the source library.
  const categories = new Set(all.map((item) => item.category));
  assert.ok(!categories.has("shadcn" as never) && !categories.has("21st" as never));
  for (const name of ["Buttons", "Forms & Inputs", "Overlays", "Charts", "Chat & Composer", "Text"]) assert.ok(categories.has(name as never), "no " + name);
  assert.ok(all.every((item) => item.previewUrl.startsWith("/api/clyra-code/components/frame/")));

  // Real source, not a mock.
  const button = await library.readLocalComponent("shadcn", "button");
  assert.equal(button.files[0].path, "components/ui/button.tsx");
  assert.ok(button.files[0].content.includes("buttonVariants"));
  assert.ok(button.dependencies.includes("class-variance-authority"));

  // Real previews: bundled, themed and runnable.
  const { frameHtml } = await import("../lib/clyra-code/component-frames");
  const frame = await frameHtml({ source: "shadcn", entry: "button-demo" });
  assert.ok(frame.includes("<script>") && frame.includes("bg-primary") || frame.includes(".bg-primary"));
  assert.ok((await frameHtml({ source: "21st", entry: "shimmer-button" })).includes("shimmer-slide"));

  // Add copies real source and its local dependencies with portable imports.
  const project = path.join(data, "projects", "sample", "files");
  await mkdir(path.join(project, "src"), { recursive: true });
  await writeFile(path.join(project, "package.json"), JSON.stringify({ name: "sample", dependencies: { react: "^19.0.0" } }));
  const added = await library.installLocalComponent("sample", "shadcn", "alert-dialog");
  assert.equal(added.ok, true);
  assert.ok(added.files.includes("src/components/ui/alert-dialog.tsx") && added.files.includes("src/components/ui/button.tsx"), "button dependency is added with alert-dialog");
  const code = await readFile(path.join(project, "src", "components", "ui", "alert-dialog.tsx"), "utf8");
  assert.ok(code.includes('from "./button"') && code.includes('from "../../lib/utils"'), "imports must be portable without @ aliases");
  assert.ok((await readFile(path.join(project, "src", "lib", "utils.ts"), "utf8")).includes("twMerge"));
  const again = await library.installLocalComponent("sample", "shadcn", "alert-dialog");
  assert.deepEqual(again.files, [], "re-adding identical files changes nothing");
  // A different upstream button already exists, so 21st's banner is refused rather than overwriting it.
  await assert.rejects(() => library.installLocalComponent("sample", "21st", "banner"), /different file already exists/);
  const other = path.join(data, "projects", "other", "files");
  await mkdir(other, { recursive: true });
  await writeFile(path.join(other, "package.json"), JSON.stringify({ name: "other", dependencies: { react: "^19.0.0" } }));
  assert.equal((await library.installLocalComponent("other", "21st", "banner")).ok, true);

  // Full-page blocks install with their own components and data files.
  const blockProject = path.join(data, "projects", "blk", "files");
  await mkdir(blockProject, { recursive: true });
  await writeFile(path.join(blockProject, "package.json"), JSON.stringify({ name: "blk", dependencies: { react: "^19.0.0" } }));
  const block = await library.installLocalComponent("blk", "shadcn", "block-dashboard-01");
  assert.ok(block.files.some((file) => file === "blocks/dashboard-01/page.tsx") && block.files.some((file) => file.endsWith("data.json")), "dashboard block brings its page and data");
  assert.ok(all.filter((item) => item.source === "21st").length >= 30, "21st catalogue is the full set of reusable components");
  assert.ok(all.filter((item) => item.name.startsWith("block-")).length >= 25, "shadcn blocks are included");
  await assert.rejects(() => library.installLocalComponent("../escape", "shadcn", "button"));
  await assert.rejects(() => library.readLocalComponent("shadcn", "../../etc/passwd"));
  console.log("component library: real clones, categories, live frames and add PASS");
} finally {
  await rm(data, { recursive: true, force: true });
}
