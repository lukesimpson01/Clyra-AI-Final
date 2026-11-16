import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { patchClyraElectron, CLYRA_DEV_APP } from "./patch-electron-macos-privacy.mjs";

// Unique macOS TCC identity so Privacy → Microphone lists "Clyra". The renamed app has to be ad-hoc signed too: unsigned,
// macOS ignores the new identity and Clyra never shows up in the Privacy lists. Opt out with CLYRA_ELECTRON_CODESIGN=0.
if (process.platform === "darwin" && process.env.CLYRA_ELECTRON_CODESIGN !== "0") process.env.CLYRA_ELECTRON_CODESIGN = "1";
try {
  const patched = patchClyraElectron();
  if (patched?.ok) {
    const signNote =
      process.env.CLYRA_ELECTRON_CODESIGN === "1"
        ? ` signed=${patched.signed ? "yes" : "no"}`
        : " (plist identity only; set CLYRA_ELECTRON_CODESIGN=1 to ad-hoc resign)";
    console.log(
      `[electron-dev] macOS privacy identity → ${patched.bundleName} (${patched.bundleId})` +
        ` helpers=${patched.helpers ?? 0}${signNote}`,
    );
    if (patched.signError && process.env.CLYRA_ELECTRON_CODESIGN === "1") {
      console.warn(`[electron-dev] codesign warning: ${patched.signError}`);
    }
  }
} catch (error) {
  console.warn("[electron-dev] could not patch Electron Info.plist:", error?.message || error);
}

// A leftover Clyra from an earlier run keeps the Notch bridge and DevTools ports and answers instead of this one (buttons that do
// nothing, "port busy"): stop it before anything else.
if (process.platform === "darwin" && process.env.CLYRA_LAUNCH_VIA_OPEN !== "0") {
  const patterns = [`${CLYRA_DEV_APP}/Contents/MacOS/Clyra`, "Clyra’s Notch.app/Contents/MacOS"];
  const running = () => patterns.some((pattern) => spawnSync("pgrep", ["-f", pattern]).status === 0);
  try {
    for (const pattern of patterns) spawnSync("pkill", ["-f", pattern]);
    // Give them a moment to quit cleanly, then make sure: a survivor keeps the ports and answers instead of this run.
    for (let waited = 0; waited < 20 && running(); waited += 1) spawnSync("sleep", ["0.3"]);
    if (running()) { for (const pattern of patterns) spawnSync("pkill", ["-9", "-f", pattern]); spawnSync("sleep", ["0.8"]); }
  } catch { /* nothing running */ }
}

const electronBinary = path.resolve("node_modules", ".bin", process.platform === "win32" ? "electron.cmd" : "electron");
// Load the ABI-correct better-sqlite3 build for Electron's Node so the
// desktop service can run alongside the web dev server (tools/sqlite-abi).
const sqlitePreload = path.resolve("tools", "sqlite-abi-preload.cjs");

/* A background Electron process can legitimately still own the normal CDP
   port (for example while an OS-level shortcut remains enabled). Find a free
   local port for this development window instead of emitting Chromium's
   distracting "address already in use" error. An explicit port remains an
   explicit request, which keeps focused desktop smoke tests deterministic. */
const canListen = (port) => new Promise((resolve) => {
  const probe = net.createServer();
  probe.once("error", () => resolve(false));
  probe.listen({ host: "127.0.0.1", port }, () => probe.close(() => resolve(true)));
});
const configuredCdpPort = Number(process.env.CLYRA_CDP_PORT || 9_223);
let cdpPort = configuredCdpPort;
if (!process.env.CLYRA_CDP_PORT) {
  for (let candidate = configuredCdpPort; candidate < configuredCdpPort + 20; candidate += 1) {
    if (await canListen(candidate)) { cdpPort = candidate; break; }
  }
}
if (cdpPort !== configuredCdpPort) console.log(`[electron-dev] DevTools port ${configuredCdpPort} is busy; using ${cdpPort}.`);
const env = {
  ...process.env,
  CLYRA_ELECTRON_DEV: "1",
  CLYRA_CDP_PORT: String(cdpPort),
  NODE_OPTIONS: [`--require "${sqlitePreload}"`, process.env.NODE_OPTIONS].filter(Boolean).join(" "),
};
// Cursor/agent shells can inherit ELECTRON_RUN_AS_NODE from helper processes.
// That forces Electron to behave like plain Node and breaks `import from "electron"`.
delete env.ELECTRON_RUN_AS_NODE;
// macOS decides who a permission request belongs to by the *responsible process*: an Electron started as a child of `npm`
// in a terminal (or another app's shell) asks for the camera and screen as that terminal, so Clyra never gets a pop-up and
// never appears in the Privacy lists. Starting it through LaunchServices (`open`) makes Clyra its own responsible process.
// Opt out with CLYRA_LAUNCH_VIA_OPEN=0 to keep it a direct child.
let child;
let followLog = null;
if (process.platform === "darwin" && process.env.CLYRA_LAUNCH_VIA_OPEN !== "0") {
  const appBundle = CLYRA_DEV_APP;
  const logFile = process.env.CLYRA_DEV_LOG || path.join(os.homedir(), "Library", "Logs", "clyra-electron.log");
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  fs.writeFileSync(logFile, "");
  const envArgs = Object.entries(env)
    .filter(([key, value]) => value !== undefined && !/[\n\r]/.test(String(value)) && /^[A-Za-z_][A-Za-z0-9_]*$/.test(key))
    .flatMap(([key, value]) => ["--env", `${key}=${value}`]);
  child = spawn("open", ["-n", "-W", "--stdout", logFile, "--stderr", logFile, ...envArgs, "-a", appBundle, "--args", process.cwd()], { stdio: "inherit" });
  followLog = spawn("tail", ["-n", "+1", "-F", logFile], { stdio: "inherit" });
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => { try { spawn("pkill", ["-f", `${appBundle}/Contents/MacOS/Clyra`]); } catch { /* already gone */ } });
  }
  child.once("exit", () => { try { followLog?.kill(); } catch { /* done */ } });
} else {
  child = spawn(electronBinary, ["."], {
    cwd: process.cwd(),
    env,
    stdio: "inherit",
  });
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    if (!child.killed) child.kill(signal);
  });
}

child.once("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
});
