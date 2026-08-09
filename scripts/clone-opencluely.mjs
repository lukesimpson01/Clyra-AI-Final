#!/usr/bin/env node
/**
 * Cross-platform OpenCluely clone + Clyra bridge apply (macOS / Windows / Linux).
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isWin } from "./lib/platform.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const DEST = path.join(ROOT, "apps", "opencluely");
const BRIDGE = path.join(ROOT, "scripts", "opencluely-bridge");
const REPO = "https://github.com/TechyCSR/OpenCluely.git";

function run(cmd, args, opts = {}) {
  const result = spawnSync(cmd, args, {
    stdio: "inherit",
    shell: isWin(),
    windowsHide: true,
    ...opts,
  });
  if (result.status !== 0) {
    throw new Error(`${cmd} ${args.join(" ")} failed with code ${result.status}`);
  }
}

function copyFile(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

function copyDirFiles(srcDir, destDir, filter = () => true) {
  if (!fs.existsSync(srcDir)) return;
  fs.mkdirSync(destDir, { recursive: true });
  for (const name of fs.readdirSync(srcDir)) {
    const from = path.join(srcDir, name);
    if (!fs.statSync(from).isFile() || !filter(name)) continue;
    fs.copyFileSync(from, path.join(destDir, name));
  }
}

function patchOpencluelyPackageJson() {
  const pkgPath = path.join(DEST, "package.json");
  if (!fs.existsSync(pkgPath)) return;
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
  pkg.scripts = pkg.scripts || {};
  // Cross-platform Electron start (avoids env -u / bash).
  pkg.scripts.start = "node ../../scripts/start-opencluely-electron.mjs";
  pkg.scripts.dev = "node ../../scripts/start-opencluely-electron.mjs";
  pkg.scripts.clean = "node -e \"require('fs').rmSync('dist',{recursive:true,force:true})\"";
  pkg.build = pkg.build || {};
  pkg.build.mac = pkg.build.mac || {};
  pkg.build.mac.hardenedRuntime = true;
  pkg.build.mac.entitlements = path.join(ROOT, "resources", "entitlements.mac.plist");
  pkg.build.mac.entitlementsInherit = path.join(ROOT, "resources", "entitlements.mac.plist");
  pkg.build.mac.extendInfo = {
    ...(pkg.build.mac.extendInfo || {}),
    NSMicrophoneUsageDescription:
      "OpenCluely uses the microphone for Async speech-to-text and local Whisper fallback.",
    NSCameraUsageDescription:
      "OpenCluely does not record video; this entitlement is only present for media-capture compatibility.",
    NSScreenCaptureUsageDescription:
      "OpenCluely captures the screen to read on-screen content for AI assistance.",
    NSAppleEventsUsageDescription:
      "OpenCluely needs Accessibility / Apple Events access for Take Control typing and clicks.",
  };
  fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
}

console.log("==> Removing previous OpenCluely");
fs.rmSync(DEST, { recursive: true, force: true });
fs.mkdirSync(path.join(ROOT, "apps"), { recursive: true });

console.log(`==> Cloning ${REPO}`);
run("git", ["clone", "--depth", "1", REPO, DEST]);

if (fs.existsSync(BRIDGE)) {
  console.log("==> Applying Clyra + Gemini/Async bridge");
  copyFile(path.join(BRIDGE, "llm.service.js"), path.join(DEST, "src/services/llm.service.js"));
  copyFile(path.join(BRIDGE, "capture.service.js"), path.join(DEST, "src/services/capture.service.js"));
  copyFile(
    path.join(BRIDGE, "desktop-control.service.js"),
    path.join(DEST, "src/services/desktop-control.service.js"),
  );
  copyFile(path.join(BRIDGE, "control-safety.js"), path.join(DEST, "src/services/control-safety.js"));
  for (const name of ["async-stt.service.js", "speech.service.js", "macos-input.py"]) {
    const src = path.join(BRIDGE, name);
    if (fs.existsSync(src)) copyFile(src, path.join(DEST, "src/services", name));
  }
  if (fs.existsSync(path.join(BRIDGE, "visual-scan"))) {
    copyDirFiles(path.join(BRIDGE, "visual-scan"), path.join(DEST, "src/services/visual-scan"));
  }
  copyFile(path.join(BRIDGE, "config.js"), path.join(DEST, "src/core/config.js"));
  copyFile(path.join(BRIDGE, "main.js"), path.join(DEST, "main.js"));
  copyFile(path.join(BRIDGE, "window.manager.js"), path.join(DEST, "src/managers/window.manager.js"));
  copyFile(path.join(BRIDGE, "prompt-loader.js"), path.join(DEST, "prompt-loader.js"));
  if (fs.existsSync(path.join(BRIDGE, "preload.js"))) {
    copyFile(path.join(BRIDGE, "preload.js"), path.join(DEST, "preload.js"));
  }
  copyDirFiles(path.join(BRIDGE, "prompts"), path.join(DEST, "prompts"), (n) => n.endsWith(".md"));
  copyDirFiles(path.join(BRIDGE, "html"), DEST, (n) => n.endsWith(".html"));
  copyDirFiles(path.join(BRIDGE, "ui"), path.join(DEST, "src/ui"), (n) => n.endsWith(".js"));
  if (fs.existsSync(path.join(BRIDGE, "env"))) {
    copyFile(path.join(BRIDGE, "env"), path.join(DEST, ".env"));
  }
  // Shared resize helper for vision (Windows-safe magick path)
  const resizeBridge = path.join(BRIDGE, "image-resize.cjs");
  const resizeLib = path.join(ROOT, "scripts/lib/image-resize.cjs");
  if (fs.existsSync(resizeBridge)) {
    copyFile(resizeBridge, path.join(DEST, "src/services/image-resize.cjs"));
  } else if (fs.existsSync(resizeLib)) {
    copyFile(resizeLib, path.join(DEST, "src/services/image-resize.cjs"));
  }
  fs.writeFileSync(path.join(DEST, ".opencluely-firstrun-completed"), "");
  patchOpencluelyPackageJson();
}

console.log("==> npm install");
run("npm", ["install", "--omit=optional"], { cwd: DEST });
run("npm", ["install", "ws", "--save", "--omit=optional"], { cwd: DEST });

console.log("Ready. Vision=Gemini  Speech=Async (when ASYNC_API_KEY set)  Text=Clyra");
console.log("Set GEMINI_API_KEY + ASYNC_API_KEY in apps/opencluely/.env (or repo .env.local).");
console.log("Start: npm run opencluely:start");
