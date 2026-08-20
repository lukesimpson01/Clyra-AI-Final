import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
import { promises as fs } from "node:fs";
import path from "node:path";
import type {
  PreviewLogLine,
  PreviewSession,
  PreviewStatus,
} from "../../../types/vibe-preview";
import { detectPackageManager } from "../terminal/package-manager";
import { detectDevScript } from "../terminal/script-detector";
import { checkPreviewHealth } from "./preview-health";
import { findPreviewPort, parsePreviewUrl, probePreviewPort } from "./port-detector";
import { parsePreviewError } from "./preview-errors";
import { clyraResourcePath } from "../../runtime-paths";

type RunnerState = {
  process?: ChildProcessWithoutNullStreams;
  session: PreviewSession;
  logs: PreviewLogLine[];
};

const sessions = new Map<string, RunnerState>();

/**
 * Where an `index.html` entry may live, in preference order ("" is the
 * project root). Desktop/Electron projects conventionally keep their web
 * layer in `src/`, so a root-only check reported "preview files are
 * incomplete" for an otherwise complete app. Every entry is joined with
 * `path.join`, so this resolves identically on POSIX and Windows.
 */
const HTML_ENTRY_DIRS = ["", "src", "public", "app", "www", "renderer"] as const;

/** Resolve the project's HTML entry point, or undefined when none exists yet. */
export function findHtmlEntry(projectPath: string): string | undefined {
  for (const dir of HTML_ENTRY_DIRS) {
    const candidate = path.join(projectPath, dir, "index.html");
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

function addLog(state: RunnerState, level: PreviewLogLine["level"], message: string) {
  const clean = message.trim();
  if (!clean) return;
  state.logs.push({
    id: `${Date.now()}-${state.logs.length}`,
    time: new Date().toISOString(),
    level,
    message: clean,
  });
  if (state.logs.length > 600) state.logs.splice(0, state.logs.length - 600);
}

function updateStatus(state: RunnerState, status: PreviewStatus) {
  state.session = {
    ...state.session,
    status,
    lastHealthCheckAt:
      status === "ready" || status === "running" ? Date.now() : state.session.lastHealthCheckAt,
  };
}

function serialise(state: RunnerState): PreviewSession {
  return { ...state.session };
}

function getViteBinary(projectPath: string) {
  // npm installs shell shims on POSIX but `.cmd` wrappers on Windows, so the
  // bare name only resolves on macOS/Linux. Probe both spellings.
  const names = process.platform === "win32" ? ["vite.cmd", "vite.exe", "vite"] : ["vite"];
  const candidates = names.flatMap((name) => [
    path.join(projectPath, "node_modules", ".bin", name),
    clyraResourcePath("node_modules", ".bin", name),
  ]);
  return candidates.find((candidate) => existsSync(candidate));
}

/**
 * Static file server for dependency-free projects, run through Node itself.
 *
 * This previously shelled out to `python3`, which is absent on a default
 * Windows install (and on Windows the name resolves to a Store stub that
 * never serves), so static previews could only work on macOS/Linux. Node is
 * already running Clyra, so `process.execPath` is guaranteed present and
 * identical on both platforms. Passed via `node -e`, and because `spawn` is
 * called without a shell the source needs no cross-platform quoting.
 */
const STATIC_SERVER_SOURCE = `
const http = require('node:http'), fs = require('node:fs'), path = require('node:path');
const root = process.argv[1], port = Number(process.argv[2]);
const TYPES = { '.html':'text/html', '.js':'text/javascript', '.mjs':'text/javascript', '.css':'text/css', '.json':'application/json', '.svg':'image/svg+xml', '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.gif':'image/gif', '.webp':'image/webp', '.ico':'image/x-icon', '.woff':'font/woff', '.woff2':'font/woff2', '.wasm':'application/wasm' };
http.createServer((req, res) => {
  const url = decodeURIComponent((req.url || '/').split('?')[0]);
  let file = path.join(root, url);
  // The preview serves real project files on localhost; keep requests inside root.
  if (!path.resolve(file).startsWith(path.resolve(root))) { res.writeHead(403); return res.end('Forbidden'); }
  try { if (fs.statSync(file).isDirectory()) file = path.join(file, 'index.html'); } catch {}
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404, { 'content-type': 'text/plain' }); return res.end('Not found'); }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(buf);
  });
}).listen(port, '127.0.0.1', () => console.log('Serving ' + root + ' on http://127.0.0.1:' + port));
`;

async function waitForReady(state: RunnerState, port: number, timeoutMs = 20000) {
  const started = Date.now();
  const candidateUrls = [
    state.session.url,
    `http://127.0.0.1:${port}`,
    `http://localhost:${port}`,
  ].filter(Boolean) as string[];

  while (Date.now() - started < timeoutMs) {
    for (const candidate of candidateUrls) {
      const health = await checkPreviewHealth(candidate);
      if (health.ok) {
        state.session = {
          ...state.session,
          status: "ready",
          url: candidate,
          port,
          lastHealthCheckAt: Date.now(),
          lastError: undefined,
        };
        addLog(state, "info", `Preview ready at ${candidate}`);
        return;
      }
      if (health.error) state.session.lastError = health.error;
    }
    await new Promise((resolve) => setTimeout(resolve, 550));
  }

  state.session = {
    ...state.session,
    status: "build_failed",
    lastHealthCheckAt: Date.now(),
    lastError: state.session.lastError ?? {
      title: "Preview did not become ready",
      message: "The dev server started, but the health check did not pass in time.",
    },
  };
  addLog(state, "error", state.session.lastError.message);
}

export async function startDevServer({
  projectId,
  projectPath,
  projectName,
}: {
  projectId: string;
  projectPath: string;
  projectName: string;
}) {
  const existing = sessions.get(projectId);
  if (existing?.process && existing.process.exitCode == null && existing.session.url) {
    const health = await checkPreviewHealth(existing.session.url);
    if (health.ok) {
      existing.session = {
        ...existing.session,
        status: "ready",
        lastHealthCheckAt: Date.now(),
      };
      return serialise(existing);
    }
  }

  if (existing?.process && existing.process.exitCode == null) {
    existing.process.kill();
  }

  const hasPackageJson = existsSync(path.join(projectPath, "package.json"));
  const hasHtmlEntry = Boolean(findHtmlEntry(projectPath));
  if (!hasHtmlEntry) {
    // Preserve prior log lines when we re-probe during an agent run so the
    // terminal panel does not flash empty between missing-entry checks.
    const priorLogs = existing?.logs ?? [];
    const session: PreviewSession = {
      projectId,
      projectPath,
      packageManager: "npm",
      devCommand: "missing",
      status: "build_failed",
      lastError: {
        title: "Preview files are incomplete",
        message: `The agent has not yet created an index.html entry point, so Clyra cannot start a preview. Clyra looks in the project root and in ${HTML_ENTRY_DIRS.filter(Boolean).join(", ")}.`,
      },
    };
    const state = { session, logs: priorLogs };
    if (!priorLogs.some((line) => /index\.html entry point/i.test(line.message))) {
      addLog(state, "error", session.lastError!.message);
    }
    sessions.set(projectId, state);
    return session;
  }
  const packageManager = hasPackageJson ? detectPackageManager(projectPath) : "npm";
  const script = hasPackageJson ? await detectDevScript(projectPath) : null;
  // A package.json may exist only to define tests or metadata. When the
  // project has a real HTML entry but no dev/start/preview script, use Clyra's
  // bundled Vite static server instead of rejecting an otherwise runnable
  // website. This also makes generated dependency-free sites survive a clean
  // Clyra restart, rather than relying on a preview process that happened to
  // start before package.json was written.

  const port = await findPreviewPort(projectId);
  const viteBinary = getViteBinary(projectPath);
  const useVite = Boolean(script && viteBinary);
  const session: PreviewSession = {
    projectId,
    projectPath,
    packageManager,
    devCommand: script ? `${script.scriptName}: ${script.command}` : "static HTML: local server",
    port,
    url: `http://127.0.0.1:${port}`,
    status: "starting",
    startedAt: Date.now(),
  };
  const state: RunnerState = { session, logs: [] };
  sessions.set(projectId, state);
  addLog(
    state,
    "info",
    script
      ? `Detected ${packageManager} and script "${script.scriptName}".`
      : "Detected a dependency-free static HTML project.",
  );
  addLog(state, "info", `Starting preview on port ${port}.`);

  // Serve from the directory that actually holds index.html. Desktop/Electron
  // projects keep their web layer in src/, and serving the project root there
  // would return a directory listing instead of the app.
  const staticRoot = path.dirname(findHtmlEntry(projectPath) ?? path.join(projectPath, "index.html"));
  const child = spawn(
    useVite ? viteBinary! : process.execPath,
    useVite
      ? ["--host", "127.0.0.1", "--port", String(port), "--strictPort"]
      : ["-e", STATIC_SERVER_SOURCE, staticRoot, String(port)],
    {
      cwd: projectPath,
      env: { ...process.env, BROWSER: "none", FORCE_COLOR: "0" },
      stdio: ["pipe", "pipe", "pipe"],
      // .cmd shims on Windows are not directly executable by CreateProcess.
      shell: useVite && process.platform === "win32",
    },
  );
  state.process = child;
  state.session.processId = String(child.pid ?? "");
  updateStatus(state, "compiling");

  const handleOutput = (level: PreviewLogLine["level"], text: string) => {
    for (const line of text.split(/\r?\n/)) {
      addLog(state, level, line);
      const url = parsePreviewUrl(line);
      if (url) {
        state.session = { ...state.session, url, port: Number(new URL(url).port) };
      }
      const parsedError = parsePreviewError(line);
      if (parsedError) {
        state.session = {
          ...state.session,
          status: "runtime_error",
          lastError: parsedError,
        };
      }
    }
  };

  child.stdout.on("data", (chunk) => handleOutput("info", chunk.toString()));
  child.stderr.on("data", (chunk) => handleOutput("error", chunk.toString()));
  child.on("close", (code) => {
    if (state.session.status !== "stopped") {
      state.session = {
        ...state.session,
        status: "server_crashed",
        lastError: {
          title: "Preview server stopped",
          message: `The preview process exited with code ${code ?? "unknown"}.`,
        },
      };
      addLog(state, "error", state.session.lastError.message);
    }
  });

  const probed = await probePreviewPort(port);
  if (probed) {
    state.session = { ...state.session, url: probed, status: "ready" };
    addLog(state, "info", `Preview ready at ${probed}`);
    return serialise(state);
  }

  await waitForReady(state, port);
  return serialise(state);
}

export async function restartDevServer(args: {
  projectId: string;
  projectPath: string;
  projectName: string;
}) {
  await stopDevServer(args.projectId);
  const session = await startDevServer(args);
  const state = sessions.get(args.projectId);
  if (state) updateStatus(state, session.status === "ready" ? "ready" : "restarting");
  return session;
}

export async function stopDevServer(projectId: string) {
  const state = sessions.get(projectId);
  if (!state) return null;
  state.session = { ...state.session, status: "stopped" };
  if (state.process && state.process.exitCode == null) {
    state.process.kill();
  }
  addLog(state, "info", "Preview server stopped.");
  return serialise(state);
}

export async function stopAllDevServers() {
  await Promise.all([...sessions.keys()].map((projectId) => stopDevServer(projectId)));
  sessions.clear();
}

export async function refreshPreview(projectId: string) {
  const state = sessions.get(projectId);
  if (!state) return null;
  state.session = { ...state.session, status: "refreshing" };
  if (state.session.url) {
    const health = await checkPreviewHealth(state.session.url);
    state.session = {
      ...state.session,
      status: health.ok ? "ready" : "runtime_error",
      lastHealthCheckAt: Date.now(),
      lastError: health.error,
    };
    addLog(
      state,
      health.ok ? "info" : "error",
      health.ok ? "Preview refresh passed health check." : health.error?.message ?? "Preview refresh failed.",
    );
  }
  return serialise(state);
}

export function getPreviewSession(projectId: string) {
  const state = sessions.get(projectId);
  return state ? serialise(state) : null;
}

/** Live vite port for the preview proxy (Visual Edit inspection). */
export function getPreviewTargetPort(projectId: string) {
  const state = sessions.get(projectId);
  if (!state || !state.process || state.process.exitCode != null) return null;
  return state.session.port ?? null;
}

export function getPreviewLogs(projectId: string) {
  return sessions.get(projectId)?.logs ?? [];
}
