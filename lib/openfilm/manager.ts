// Runs the Clyra Editor (a vendored, re-themed build of the MIT-licensed OpenFilm Studio, see vendor/openfilm) as a
// child process of Clyra's server, and talks to its HTTP API. The editor keeps its own state under
// <data>/openfilm (home, projects, exports) so nothing touches a person's ~/.openfilm or ~/Movies.

import { spawn, type ChildProcess } from "node:child_process";
import crypto from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import { clyraDataPath, clyraResourcePath } from "../runtime-paths";

export const EDITOR_PREFERRED_PORT = Number(process.env.CLYRA_EDITOR_PORT) || 4848;

/** The token the editor presents to Clyra's bridge routes. Minted per Clyra launch, never written to disk. */
export const editorBridgeToken = crypto.randomBytes(24).toString("hex");

export function editorDir() {
  return process.env.CLYRA_EDITOR_DIR || clyraResourcePath("vendor", "openfilm");
}

export function editorPaths() {
  const root = clyraDataPath("openfilm");
  return { root, home: path.join(root, "home"), library: path.join(root, "projects"), exports: path.join(root, "exports") };
}

export function editorBuilt() {
  return existsSync(path.join(editorDir(), "studio", "ui", "dist", "index.html")) && existsSync(path.join(editorDir(), "node_modules", "playwright-core"));
}

type RunInfo = { origin: string; filmOrigin: string; key: string };

let child: ChildProcess | null = null;
let starting: Promise<RunInfo> | null = null;
let lastError = "";

function readRun(): RunInfo | null {
  try {
    const raw = JSON.parse(readFileSync(path.join(editorPaths().home, "run.json"), "utf8"));
    return typeof raw?.origin === "string" && typeof raw?.key === "string" ? { origin: raw.origin, filmOrigin: String(raw.filmOrigin || ""), key: raw.key } : null;
  } catch {
    return null;
  }
}

async function healthy(origin: string) {
  try {
    const res = await fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(1500) });
    return res.ok && (await res.json())?.product === "openfilm-studio";
  } catch {
    return false;
  }
}

function portFree(port: number) {
  return new Promise<boolean>((resolve) => {
    const probe = net.createServer();
    probe.once("error", () => resolve(false));
    probe.once("listening", () => probe.close(() => resolve(true)));
    probe.listen(port, "127.0.0.1");
  });
}

async function pickPort() {
  for (let port = EDITOR_PREFERRED_PORT; port < EDITOR_PREFERRED_PORT + 20; port++) {
    // Studio takes the next port up for film pages, so both must be free.
    if ((await portFree(port)) && (await portFree(port + 1))) return port;
  }
  return 0;
}

function nodeCommand() {
  if (process.env.CLYRA_NODE) return { command: process.env.CLYRA_NODE, env: {} as Record<string, string> };
  // Inside Electron, process.execPath is the app binary: run it as plain Node.
  return process.versions.electron
    ? { command: process.execPath, env: { ELECTRON_RUN_AS_NODE: "1" } }
    : { command: process.execPath, env: {} as Record<string, string> };
}

/** Films are drawn in Playwright's headless Chromium. Fetched once (about 100 MB) the first time the editor runs. */
async function ensureBrowser() {
  const marker = path.join(editorPaths().home, "browser-ready");
  if (existsSync(marker)) return;
  const cli = path.join(editorDir(), "node_modules", "playwright-core", "cli.js");
  const { command, env } = nodeCommand();
  const code = await new Promise<number | null>((resolve) => {
    const installer = spawn(command, [cli, "install", "chromium-headless-shell"], { stdio: "ignore", env: { ...process.env, ...env } });
    installer.once("error", () => resolve(1));
    installer.once("exit", resolve);
  });
  if (code !== 0) throw new Error("The editor could not download its rendering browser. Check your connection and try again.");
  writeFileSync(marker, new Date().toISOString());
}

async function start(clyraPort: number): Promise<RunInfo> {
  if (!editorBuilt()) {
    throw new Error("The Clyra Editor is not built yet. Run `npm run editor:setup` once, then try again.");
  }
  const existing = readRun();
  if (existing && (await healthy(existing.origin)) && child && !child.killed) return existing;

  const paths = editorPaths();
  for (const dir of [paths.home, paths.library, paths.exports]) mkdirSync(dir, { recursive: true });
  await ensureBrowser();
  const port = await pickPort();
  const { command, env } = nodeCommand();
  lastError = "";
  const proc = spawn(command, [path.join(editorDir(), "studio", "server", "main.mjs")], {
    cwd: editorDir(),
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      ...env,
      OPENFILM_HOME: paths.home,
      OPENFILM_SHARED_HOME: paths.home,
      OPENFILM_LIBRARY: paths.library,
      OPENFILM_EXPORTS: paths.exports,
      OPENFILM_STUDIO_PORT: String(port),
      OPENFILM_STUDIO_WORKER: "1",
      OPENFILM_NO_UPDATE_CHECK: "1",
      OPENFILM_NO_BROWSER: "1",
      CLYRA_EDITOR_KEY: editorBridgeToken,
      OPENFILM_CLYRA_URL: `http://127.0.0.1:${clyraPort}`,
    },
  });
  child = proc;
  const tail: string[] = [];
  const keep = (chunk: Buffer) => { tail.push(...chunk.toString().split("\n").filter(Boolean)); tail.splice(0, Math.max(0, tail.length - 20)); };
  proc.stdout?.on("data", keep);
  proc.stderr?.on("data", keep);
  proc.once("exit", (code) => {
    if (child === proc) child = null;
    if (code) lastError = tail.slice(-4).join(" ").slice(0, 400) || `The editor stopped (exit ${code}).`;
  });

  const deadline = Date.now() + 25_000;
  while (Date.now() < deadline) {
    if (!child || child !== proc) throw new Error(lastError || "The editor stopped while starting.");
    const run = readRun();
    if (run && (await healthy(run.origin))) return run;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  proc.kill();
  throw new Error("The editor did not start in time.");
}

/** Start the editor if it is not running; resolves with where it listens and its launch key. */
export function ensureEditor(clyraPort: number): Promise<RunInfo> {
  if (!starting) starting = start(clyraPort).finally(() => { starting = null; });
  return starting;
}

export async function editorStatus() {
  const run = readRun();
  const running = Boolean(child && !child.killed && run && (await healthy(run.origin)));
  return { built: editorBuilt(), running, error: lastError || null };
}

export function stopEditor() {
  if (child && !child.killed) child.kill();
  child = null;
}

process.on("exit", stopEditor);

/** The editor's own HTTP API, as its CLI calls it: the launch key in a header. */
export async function editorApi<T = any>(clyraPort: number, route: string, init: { method?: string; json?: unknown } = {}): Promise<T> {
  const run = await ensureEditor(clyraPort);
  const res = await fetch(`${run.origin}/api/${route}`, {
    method: init.method ?? (init.json === undefined ? "GET" : "POST"),
    headers: { "x-studio-key": run.key, ...(init.json === undefined ? {} : { "content-type": "application/json" }) },
    body: init.json === undefined ? undefined : JSON.stringify(init.json),
    signal: AbortSignal.timeout(60_000),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(String((body as { error?: string }).error || `The editor answered ${res.status}.`));
  return body as T;
}

export function editorAddress(run: RunInfo, to = "/") {
  return `${run.origin}/open?key=${run.key}&to=${encodeURIComponent(to)}`;
}
