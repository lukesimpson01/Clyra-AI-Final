import { spawn } from "node:child_process";
import net from "node:net";
import path from "node:path";
import { patchClyraElectron } from "./patch-electron-macos-privacy.mjs";

// Unique macOS TCC identity so Privacy → Microphone lists "Clyra".
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
const child = spawn(electronBinary, ["."], {
  cwd: process.cwd(),
  env,
  stdio: "inherit",
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    if (!child.killed) child.kill(signal);
  });
}

child.once("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
});
