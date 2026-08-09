#!/usr/bin/env node
/**
 * Cross-platform OpenCluely Electron launcher (macOS / Windows / Linux).
 * Prefer this over the .sh script: npm run opencluely:start
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnvFile, spawnElectron, isMac, isWin, isLinux } from "./lib/platform.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const APP = path.join(ROOT, "apps", "opencluely");

loadEnvFile(path.join(ROOT, ".env"));
loadEnvFile(path.join(ROOT, ".env.local"), { override: true });
loadEnvFile(path.join(APP, ".env"), { override: true });

process.env.CLYRA_API_BASE ||= "http://127.0.0.1:31415";
process.env.CLYRA_CONTROL_PORT ||= "3847";
process.env.OPENCLUELY_VISION_PROVIDER ||= "gemini";
process.env.OPENCLUELY_VISION_MODEL ||= process.env.GEMINI_VISION_MODEL || "gemini-2.0-flash";
process.env.GEMINI_VISION_MODEL ||= "gemini-2.0-flash";
process.env.SPEECH_PROVIDER ||= process.env.ASYNC_API_KEY ? "async" : "whisper";
process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = "1";

if (!fs.existsSync(APP)) {
  console.error("OpenCluely missing. Run: npm run opencluely:clone");
  process.exit(1);
}

const electronCli = path.join(APP, "node_modules", ".bin", isWin() ? "electron.cmd" : "electron");
const electronDist = isWin()
  ? path.join(APP, "node_modules", "electron", "dist", "electron.exe")
  : path.join(APP, "node_modules", "electron", "dist", "Electron.app");
if (!fs.existsSync(electronCli) && !fs.existsSync(electronDist)) {
  console.error("electron binary missing — run: npm run opencluely:clone");
  process.exit(1);
}

if (!process.env.GEMINI_API_KEY) {
  console.warn("WARN: GEMINI_API_KEY is empty — image analysis will fail until set in .env.local or apps/opencluely/.env");
}

if (isMac()) {
  try {
    const { spawnSync } = await import("node:child_process");
    spawnSync(process.execPath, [path.join(ROOT, "tools", "patch-electron-macos-privacy.mjs"), "opencluely"], {
      stdio: "ignore",
    });
  } catch {
    /* optional */
  }
}

const extra = [];
if (isLinux()) {
  extra.push("--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage");
}
// On Windows / macOS keep GPU enabled for a native overlay feel.

console.log(
  `Starting OpenCluely (${process.platform})  vision=${process.env.OPENCLUELY_VISION_PROVIDER}/${process.env.OPENCLUELY_VISION_MODEL}  speech=${process.env.SPEECH_PROVIDER}`,
);

const child = spawnElectron(APP, [...extra, ...process.argv.slice(2)]);
child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 0);
});
