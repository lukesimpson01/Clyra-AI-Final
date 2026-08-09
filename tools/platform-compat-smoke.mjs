/**
 * Offline smoke checks for macOS/Windows/Linux compatibility helpers.
 * Does not launch Electron GUIs.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import {
  isWin,
  isMac,
  isLinux,
  loadEnvFile,
  electronBin,
  whichBin,
  resolvePython,
} from "../scripts/lib/platform.mjs";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const results = [];
const record = (name, ok, detail = "") => {
  results.push({ name, ok: Boolean(ok), detail: String(detail || "").slice(0, 200) });
  console.log(ok ? "PASS" : "FAIL", name, detail ? `— ${detail}` : "");
};

record("platform-detected", true, process.platform);
record("helper:isWin/isMac/isLinux", [isWin(), isMac(), isLinux()].filter(Boolean).length === 1);

const resize = require("../scripts/lib/image-resize.cjs");
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
const out = resize.resizeImageBuffer(png);
record("image-resize:returns-buffer", Buffer.isBuffer(out) && out.length > 0, `bytes=${out.length}`);

record("files:start-opencluely-electron.mjs", fs.existsSync(path.join(ROOT, "scripts/start-opencluely-electron.mjs")));
record("files:clone-opencluely.mjs", fs.existsSync(path.join(ROOT, "scripts/clone-opencluely.mjs")));
record("files:entitlements.mac.plist", fs.existsSync(path.join(ROOT, "build/entitlements.mac.plist")));
record("files:platform-support-doc", fs.existsSync(path.join(ROOT, "docs/PLATFORM-SUPPORT.md")));
record("files:desktop-control.mjs", fs.existsSync(path.join(ROOT, "electron/desktop-control.mjs")));

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
record("npm:opencluely:start-is-node", String(pkg.scripts["opencluely:start"] || "").startsWith("node "));
record("npm:opencluely:clone-is-node", String(pkg.scripts["opencluely:clone"] || "").startsWith("node "));
record("npm:clean-is-node", String(pkg.scripts.clean || "").includes("rmSync"));
record("npm:mac-entitlements", pkg.build?.mac?.entitlements === "build/entitlements.mac.plist");

loadEnvFile(path.join(ROOT, ".env.example"));
record("loadEnvFile:env-example", true);

const py = await resolvePython();
record("resolvePython", Boolean(py.command), JSON.stringify(py));

const nodeBin = await whichBin(process.platform === "win32" ? "node.exe" : "node");
record("whichBin:node", Boolean(nodeBin), nodeBin || "missing");

const ocApp = path.join(ROOT, "apps/opencluely");
if (fs.existsSync(ocApp)) {
  const bin = electronBin(ocApp);
  record("electronBin:opencluely", fs.existsSync(bin) || bin.includes("electron"), bin);
  const ocPkg = JSON.parse(fs.readFileSync(path.join(ocApp, "package.json"), "utf8"));
  record(
    "opencluely:start-cross-platform",
    String(ocPkg.scripts?.start || "").includes("start-opencluely-electron.mjs"),
  );
  record(
    "opencluely:apple-events-usage",
    Boolean(ocPkg.build?.mac?.extendInfo?.NSAppleEventsUsageDescription),
  );
} else {
  record("electronBin:opencluely", true, "skipped (not cloned)");
}

// Ensure desktop-control source mentions win32 PowerShell
const dc = fs.readFileSync(path.join(ROOT, "electron/desktop-control.mjs"), "utf8");
record("desktop-control:win32", dc.includes("win32") && dc.includes("powershell"));
record("desktop-control:darwin", dc.includes("darwin"));
record("desktop-control:xdotool", dc.includes("xdotool"));

const llm = fs.readFileSync(path.join(ROOT, "scripts/opencluely-bridge/llm.service.js"), "utf8");
record("llm:no-bare-convert-call", !llm.includes("execFileSync('convert'") && !llm.includes('execFileSync("convert"'));

const vision = fs.readFileSync(path.join(ROOT, "tools/ollama-vision.mjs"), "utf8");
record("vision:magick-first", vision.includes('"magick"') && vision.includes("win32"));

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) {
  console.error("FAILURES", failed);
  process.exitCode = 1;
}
