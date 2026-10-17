/**
 * ABI-correct better-sqlite3 loader for mixed Node/Electron dev sessions.
 *
 * The dev server runs under plain Node while the desktop app's local service
 * runs under Electron's Node (ELECTRON_RUN_AS_NODE). Both live in the same
 * node_modules, so the single `better_sqlite3.node` on disk can only match one
 * ABI at a time. tools/sqlite-abi.mjs keeps a cached build per runtime; this
 * preload intercepts the native module load and hands each runtime its own
 * binary, so both processes can run simultaneously.
 *
 * Wired in through NODE_OPTIONS=--require in tools/dev-source.mjs and
 * tools/electron-dev.mjs. Harmless anywhere else: when no cached binary
 * matches, the default resolution runs unchanged.
 */
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");

const cacheDir = path.join(__dirname, "..", ".cache", "sqlite-abi");

function cachedBinaryFor(target) {
  return path.join(cacheDir, `better_sqlite3-${target}.node`);
}

const runtimeTarget = process.versions.electron ? "electron" : "node";
const candidates = [
  cachedBinaryFor(runtimeTarget),
  cachedBinaryFor(runtimeTarget === "electron" ? "node" : "electron"),
].filter((file) => {
  try {
    return fs.existsSync(file);
  } catch {
    return false;
  }
});

if (candidates.length) {
  const originalLoad = Module._load;
  Module._load = function (request, parent, isMain) {
    if (typeof request === "string" && /better_sqlite3\.node$/.test(request)) {
      for (const file of candidates) {
        try {
          return originalLoad(file, parent, isMain);
        } catch {
          /* wrong ABI for this runtime — try the other cached build */
        }
      }
    }
    return originalLoad(request, parent, isMain);
  };
}
