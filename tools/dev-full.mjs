import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";

// The OpenDesign daemon serves the embedded Design tab UI. It is optional:
// when the vendored build is missing the Design tab shows a setup prompt
// instead, and the rest of the app runs normally. Its launcher exits 0 when
// a daemon is already serving the port (e.g. the desktop app owns it), so
// its exit never tears down the rest of the dev stack.
const openDesignReady = existsSync(
  path.join(process.cwd(), "third_party", "open-design", "apps", "daemon", "dist", "cli.js"),
) && existsSync(
  path.join(process.cwd(), "third_party", "open-design", "apps", "web", "out", "index.html"),
);

const fatalChildren = [
  spawn("npm", ["run", "dev:source"], { stdio: "inherit", env: process.env }),
  spawn("npm", ["run", "dev:openpencil"], { stdio: "inherit", env: process.env }),
];
const optionalChildren = openDesignReady
  ? [spawn("node", ["tools/open-design-daemon.mjs"], { stdio: "inherit", env: process.env })]
  : [];

let stopping = false;
const stopAll = (signal = "SIGTERM") => {
  if (stopping) return;
  stopping = true;
  for (const child of [...fatalChildren, ...optionalChildren]) {
    if (!child.killed) child.kill(signal);
  }
};

process.on("SIGINT", () => stopAll("SIGINT"));
process.on("SIGTERM", () => stopAll("SIGTERM"));

for (const child of fatalChildren) {
  child.once("exit", (code, signal) => {
    if (stopping) return;
    stopAll(signal || "SIGTERM");
    process.exitCode = code ?? 1;
  });
}
for (const child of optionalChildren) {
  child.once("exit", (code, signal) => {
    // The Design tab embeds this daemon; if it dies mid-session the tab
    // shows its own reconnect fallback, so the rest of dev keeps running.
    if (!stopping && code !== 0 && !signal) {
      console.warn("[dev] OpenDesign daemon stopped (exit " + code + "); the Design tab will offer to reconnect.");
    }
  });
}
