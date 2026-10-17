/* Keeps better-sqlite3 loadable from both runtimes this project uses.
 *
 * better-sqlite3 is a native addon, so one compiled binary only works for one
 * ABI. The dev server and the test suite run under plain Node; the desktop app
 * runs under Electron, which is a different Node version and therefore a
 * different NODE_MODULE_VERSION. Building for one used to silently break the
 * other — the desktop app would refuse to boot, or `npm test` would die with
 * ERR_DLOPEN_FAILED.
 *
 * Both builds are produced once and cached next to each other; switching
 * runtime after that is a file copy. Run it before whichever runtime is about
 * to start:
 *
 *   node tools/sqlite-abi.mjs node       # dev server, tests
 *   node tools/sqlite-abi.mjs electron   # desktop app
 */
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const live = path.join(root, "node_modules", "better-sqlite3", "build", "Release", "better_sqlite3.node");
const cacheDir = path.join(root, ".cache", "sqlite-abi");
const stamp = path.join(cacheDir, "active");

const target = (process.argv[2] || "node").toLowerCase();
if (!["node", "electron"].includes(target)) {
  console.error(`[sqlite-abi] unknown target "${target}" — use "node" or "electron"`);
  process.exit(1);
}

const cached = path.join(cacheDir, `better_sqlite3-${target}.node`);
const active = existsSync(stamp) ? readFileSync(stamp, "utf8").trim() : "";

/**
 * The cache can outlive `node_modules` changes or be produced by a manually
 * invoked rebuild.  A stamp alone is not proof that a native module belongs to
 * the requested runtime: an Electron binary copied into the Node slot still
 * has a perfectly valid filename.  Load it in the target runtime before
 * trusting it, so the next test/start repairs the cache instead of failing in
 * an unrelated suite.
 */
function isLoadable(binary) {
  if (!existsSync(binary)) return false;
  try {
    const executable = target === "electron"
      ? path.join(root, "node_modules", ".bin", "electron")
      : process.execPath;
    execFileSync(executable, ["-e", "require(process.argv[1])", binary], {
      cwd: root,
      stdio: "ignore",
      // Electron's normal CLI opens the application instead of evaluating
      // Node's `-e` payload.  Its Node mode retains Electron's ABI while
      // making the check finite and headless.
      env: target === "electron"
        ? { ...process.env, ELECTRON_RUN_AS_NODE: "1" }
        : process.env,
    });
    return true;
  } catch {
    return false;
  }
}

/* Nothing to do when the binary in place is already the one we want and the
   cache agrees — this runs before every start, so it has to be near-free. */
if (active === target && isLoadable(live)) process.exit(0);

mkdirSync(cacheDir, { recursive: true });

function stash(name) {
  if (existsSync(live)) copyFileSync(live, path.join(cacheDir, `better_sqlite3-${name}.node`));
}

function build() {
  const label = target === "electron" ? "Electron" : "Node";
  console.log(`[sqlite-abi] building better-sqlite3 for ${label}…`);
  const bin = path.join(root, "node_modules", ".bin", target === "electron" ? "electron-rebuild" : "npm");
  const args = target === "electron"
    ? ["-f", "-o", "better-sqlite3"]
    : ["rebuild", "better-sqlite3", "--build-from-source"];
  // node-gyp emits an unquoted libtool command on this host. When the checkout
  // itself contains spaces, a successful native compilation can still exit as
  // a failure while trying to clean its helper path. Build through a short,
  // private symlink so the toolchain sees a path without whitespace. The
  // symlink is temporary and all generated output remains in this checkout.
  const needsAlias = /\s/.test(root);
  const aliasParent = needsAlias ? mkdtempSync(path.join(os.tmpdir(), "clyra-sqlite-")) : null;
  const buildCwd = aliasParent ? path.join(aliasParent, "workspace") : root;
  try {
    if (aliasParent) symlinkSync(root, buildCwd, "dir");
    execFileSync(target === "electron" ? bin : "npm", args, { cwd: buildCwd, stdio: "inherit" });
  } finally {
    if (aliasParent) rmSync(aliasParent, { recursive: true, force: true });
  }
}

try {
  /* Keep whatever is currently in place so switching back does not rebuild. */
  if (active && active !== target) stash(active);

  if (isLoadable(cached)) {
    copyFileSync(cached, live);
  } else if (isLoadable(live)) {
    // The live build already matches this runtime (e.g. restored by
    // `npm install` / prebuild-install). Cache it instead of recompiling.
    stash(target);
  } else {
    build();
    stash(target);
  }
  writeFileSync(stamp, target);
  console.log(`[sqlite-abi] better-sqlite3 ready for ${target}`);
} catch (error) {
  console.error(`[sqlite-abi] could not prepare better-sqlite3 for ${target}:`, error?.message || error);
  process.exit(1);
}
