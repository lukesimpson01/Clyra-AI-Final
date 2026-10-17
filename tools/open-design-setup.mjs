/**
 * One-time setup for the OpenDesign Design tab integration.
 *
 * Vendors nexu-io/open-design into `third_party/open-design`, installs its
 * pnpm workspace (preferring the Node 24 the repo requires), and builds the
 * daemon plus the static export of the web UI. Runs once; `npm run dev`
 * only launches the prebuilt daemon afterwards.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const UPSTREAM = "https://github.com/nexu-io/open-design.git";
const PINNED_COMMIT = "53231d40b778d88eba23f35547bf99485d3ae9fc";

const root = process.cwd();
const repoRoot = path.join(root, "third_party", "open-design");

function findNode24() {
  if (process.env.OD_NODE && existsSync(process.env.OD_NODE)) return process.env.OD_NODE;
  const nvmRoot = path.join(process.env.HOME || "", ".nvm", "versions", "node");
  try {
    const versions = readdirSync(nvmRoot).filter((name) => /^v24\./.test(name)).sort().reverse();
    for (const version of versions) {
      const binary = path.join(nvmRoot, version, "bin", "node");
      if (existsSync(binary)) return binary;
    }
  } catch {
    /* no nvm */
  }
  return process.execPath;
}

const nodeBinary = findNode24();
const nodeDir = path.dirname(nodeBinary);
const run = (command, args, options = {}) => {
  const env = {
    ...process.env,
    PATH: [nodeDir, process.env.PATH].filter(Boolean).join(path.delimiter),
    ...(options.env ?? {}),
  };
  return spawnSync(command, args, { cwd: repoRoot, stdio: "inherit", env, ...options.spawn ?? {} });
};

console.log(`[open-design] node: ${nodeBinary}`);

if (!existsSync(path.join(repoRoot, "package.json"))) {
  console.log(`[open-design] cloning ${UPSTREAM} ...`);
  run("git", ["clone", "--quiet", UPSTREAM, repoRoot]);
  if (!existsSync(path.join(repoRoot, "package.json"))) {
    console.error("[open-design] clone failed");
    process.exit(1);
  }
}

const current = spawnSync("git", ["-C", repoRoot, "rev-parse", "HEAD"], { encoding: "utf8" }).stdout.trim();
if (current !== PINNED_COMMIT) {
  console.log(`[open-design] pinning to ${PINNED_COMMIT} ...`);
  run("git", ["-C", repoRoot, "fetch", "--quiet", "origin", PINNED_COMMIT]);
  run("git", ["-C", repoRoot, "checkout", "--quiet", PINNED_COMMIT]);
}

// pnpm 10 blocks postinstall scripts unless a package is listed in
// `onlyBuiltDependencies`. The terminal and media pipelines need node-pty
// and the platform ffmpeg installers to have their builds approved.
{
  const workspaceFile = path.join(repoRoot, "pnpm-workspace.yaml");
  const fs = await import("node:fs/promises");
  const raw = await fs.readFile(workspaceFile, "utf8");
  const extra = ["node-pty", '"@ffmpeg-installer/darwin-x64"', '"@ffprobe-installer/darwin-x64"', '"@google/genai"'];
  const missing = extra.filter((name) => !raw.includes(name));
  if (missing.length) {
    const lines = raw.split("\n");
    const anchor = lines.findIndex((line) => line.trim() === "onlyBuiltDependencies:");
    if (anchor < 0) {
      console.error("[open-design] could not find onlyBuiltDependencies in pnpm-workspace.yaml");
      process.exit(1);
    }
    lines.splice(anchor + 1, 0, ...missing.map((name) => `  - ${name}`));
    await fs.writeFile(workspaceFile, lines.join("\n"));
    console.log(`[open-design] approved builds for: ${missing.join(", ")}`);
  }
}

// Clyra embeds OpenDesign as its Design tab: the vendored tree carries small
// patches (provider bootstrap, onboarding/sign-in removal, agent default).
// Apply them after any checkout so a fresh clone behaves identically.
{
  const patchFile = path.join(root, "tools", "open-design-clyra.patch");
  const fs = await import("node:fs/promises");
  if (await fs.access(patchFile).then(() => true).catch(() => false)) {
    const applied = spawnSync("git", ["-C", repoRoot, "apply", "--check", "--reverse", patchFile], { stdio: "ignore" });
    const alreadyApplied = applied.status === 0;
    if (!alreadyApplied) {
      const result = run("git", ["-C", repoRoot, "apply", patchFile]);
      if (result.status !== 0) {
        console.error("[open-design] could not apply tools/open-design-clyra.patch");
        process.exit(1);
      }
      console.log("[open-design] applied the Clyra Design-tab patch");
    }
  }
}

const pnpm = path.join(nodeDir, "pnpm");
if (!existsSync(pnpm)) {
  console.error(`[open-design] pnpm not found next to ${nodeBinary}. Install it (corepack enable / npm i -g pnpm) and retry.`);
  process.exit(1);
}

console.log("[open-design] installing workspace dependencies ...");
run(pnpm, ["install"], { env: { CI: "1" } });

console.log("[open-design] building workspace packages ...");
run(pnpm, ["--filter", "@open-design/contracts", "build"]);
run(pnpm, ["--filter", "@open-design/registry-protocol", "build"]);

console.log("[open-design] building daemon ...");
run(pnpm, ["--filter", "@open-design/daemon", "build"]);

console.log("[open-design] building web static export ...");
run(pnpm, ["--filter", "@open-design/web", "build"]);

const daemonEntry = path.join(repoRoot, "apps", "daemon", "dist", "cli.js");
const webIndex = path.join(repoRoot, "apps", "web", "out", "index.html");
if (!existsSync(daemonEntry) || !existsSync(webIndex)) {
  console.error("[open-design] build did not produce the expected artifacts.");
  process.exit(1);
}

console.log("[open-design] ready. `npm run dev` will now start the daemon for the Design tab.");
