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
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
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

/* Nothing to do when the binary in place is already the one we want and the
   cache agrees — this runs before every start, so it has to be near-free. */
if (active === target && existsSync(live)) process.exit(0);

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
  execFileSync(target === "electron" ? bin : "npm", args, { cwd: root, stdio: "inherit" });
}

try {
  /* Keep whatever is currently in place so switching back does not rebuild. */
  if (active && active !== target) stash(active);

  if (existsSync(cached)) {
    copyFileSync(cached, live);
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
