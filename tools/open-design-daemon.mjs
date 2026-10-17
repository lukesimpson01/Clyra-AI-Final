/**
 * OpenDesign daemon launcher for the Clyra Design tab.
 *
 * The Design tab embeds the OpenDesign frontend (nexu-io/open-design), and
 * that UI is served by its own local daemon (Express + static export of the
 * Next.js web app). This script finds the vendored repo under
 * `third_party/open-design`, verifies the build artifacts exist, and starts
 * the daemon bound to loopback.
 *
 * Usage: node tools/open-design-daemon.mjs [--port <n>]
 *   OD_PORT env wins over the default (7456), matching the daemon itself.
 */
import { spawn } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const repoRoot = path.join(root, "third_party", "open-design");
const daemonEntry = path.join(repoRoot, "apps", "daemon", "dist", "cli.js");
const webOut = path.join(repoRoot, "apps", "web", "out");
const port = Number(process.env.OD_PORT) || 7456;

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

function fail(message) {
  console.error(`[open-design] ${message}`);
  process.exit(1);
}

if (!existsSync(repoRoot)) {
  fail(`vendored repo not found at ${repoRoot}. Run "npm run setup:open-design" first.`);
}
if (!existsSync(daemonEntry)) {
  fail(`daemon build missing at ${daemonEntry}. Run "npm run setup:open-design" first.`);
}
if (!existsSync(path.join(webOut, "index.html"))) {
  fail(`web build missing at ${webOut}. Run "npm run setup:open-design" first.`);
}

const nodeBinary = findNode24();
if (nodeBinary !== process.execPath) {
  console.log(`[open-design] using node ${nodeBinary}`);
}

// The daemon preconfigures its embedded UI with Clyra's DeepSeek credentials
// (see apps/daemon/src/clyra-bootstrap.ts). Those values live in Clyra's env
// files, not the shell environment, so load them here first.
if (typeof process.loadEnvFile === "function") {
  for (const file of [path.join(root, ".env.local"), path.join(root, ".env")]) {
    try { process.loadEnvFile(file); } catch { /* optional file */ }
  }
  const shared = process.env.CLYRA_SHARED_ENV_FILE;
  if (shared) {
    try { process.loadEnvFile(path.resolve(root, shared)); } catch { /* optional file */ }
  }
}

const child = spawn(nodeBinary, [daemonEntry, "--no-open", "--port", String(port)], {
  cwd: repoRoot,
  stdio: "inherit",
  env: {
    ...process.env,
    OD_PORT: String(port),
    NODE_ENV: process.env.NODE_ENV || "production",
    // The OpenDesign agent runs the OpenCode CLI (byok-opencode); make sure
    // the daemon can find it regardless of the parent shell's PATH.
    PATH: [
      path.join(process.env.HOME || "", ".opencode", "bin"),
      path.dirname(nodeBinary),
      process.env.PATH,
    ].filter(Boolean).join(path.delimiter),
  },
});

// A daemon is already serving this port (e.g. started by an earlier `npm run
// dev` or the desktop app). Reuse it instead of failing to bind and tearing
// down the rest of the dev stack.
async function portInUse() {
  const { default: net } = await import("node:net");
  return new Promise((resolve) => {
    const socket = net.connect({ host: "127.0.0.1", port }, () => {
      socket.destroy();
      resolve(true);
    });
    socket.on("error", () => resolve(false));
    socket.setTimeout(800, () => {
      socket.destroy();
      resolve(false);
    });
  });
}

child.on("error", (error) => {
  const code = String(error?.code ?? "");
  if (code === "EADDRINUSE") {
    console.log(`[open-design] a daemon is already serving port ${port}; reusing it.`);
    process.exit(0);
    return;
  }
  console.error(`[open-design] could not start daemon: ${error.message}`);
});

child.on("exit", (code, signal) => {
  console.log(`[open-design] daemon exited (${signal || (code ?? 0)})`);
  // The daemon exits when the port is already owned (a sibling launcher or
  // the desktop app is serving it). Reuse it rather than tearing down the
  // dev stack; a genuinely dead daemon still propagates its exit code.
  portInUse().then((inUse) => {
    if (inUse) {
      console.log(`[open-design] port ${port} is still served; reusing the running daemon.`);
      process.exit(0);
    } else {
      process.exit(code ?? 1);
    }
  });
});
