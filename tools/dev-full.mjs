import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import net from "node:net";
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

/* Development services are deliberately reusable. This avoids the noisy
   EADDRINUSE crash path when `npm run dev` is used as the everyday “open
   Clyra” command while another Clyra window is already running. */
const portOpen = (port) => new Promise((resolve) => {
  const socket = net.connect({ host: "127.0.0.1", port }, () => {
    socket.destroy();
    resolve(true);
  });
  socket.once("error", () => resolve(false));
  socket.setTimeout(350, () => { socket.destroy(); resolve(false); });
});

/* `npm run dev` is the one local entry point: it starts the browser source
   server and the desktop shell. If a Clyra desktop service is already live,
   do not launch a competing Electron instance (and do not print port errors). */
const desktopAlreadyRunning = await fetch("http://127.0.0.1:31415/notes", { signal: AbortSignal.timeout(450) })
  .then((response) => response.ok)
  .catch(() => false);
const sourceAlreadyRunning = await fetch("http://127.0.0.1:3000/notes", { signal: AbortSignal.timeout(450) })
  .then((response) => response.ok)
  .catch(() => false);
const openPencilAlreadyRunning = await portOpen(Number(process.env.OPENPENCIL_PORT) || 3100);
const openDesignAlreadyRunning = await portOpen(Number(process.env.OD_PORT) || 7456);
const fatalChildren = [
  ...(sourceAlreadyRunning
    ? (console.log("[dev] Clyra source server is already running — reusing it."), [])
    : [spawn("npm", ["run", "dev:source"], {
      stdio: "inherit",
      /* The desktop service owns the local voice worker in the combined
         launcher. The web source server stays fully functional, but does not
         race it for port 8787 during a normal `npm run dev` boot. */
      env: { ...process.env, VOICE_PIPELINE_AUTOSTART: "false" },
    })]),
  ...(openPencilAlreadyRunning
    ? (console.log("[dev] OpenPencil is already running — reusing it."), [])
    : [spawn("npm", ["run", "dev:openpencil"], { stdio: "inherit", env: process.env })]),
  ...(desktopAlreadyRunning
    ? (console.log("[dev] Clyra desktop is already running — reusing it."), [])
    : [spawn("npm", ["run", "desktop:dev"], { stdio: "inherit", env: process.env })]),
];
const optionalChildren = openDesignReady
  && !openDesignAlreadyRunning
  ? [spawn("node", ["tools/open-design-daemon.mjs"], { stdio: "inherit", env: process.env })]
  : [];
if (openDesignReady && openDesignAlreadyRunning) console.log("[dev] Clyra Design is already running — reusing it.");

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
