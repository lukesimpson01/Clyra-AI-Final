import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
import { promises as fs } from "node:fs";
import path from "node:path";
import type {
  PreviewLogLine,
  PreviewSession,
  PreviewStatus,
} from "../../../types/vibe-preview";
import { createProcessEnvironment, sanitizeToolOutputForModel } from "../../clyra-code/security/environment";
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
  const candidates = [
    path.join(projectPath, "node_modules", ".bin", "vite"),
    clyraResourcePath("node_modules", ".bin", "vite"),
  ];
  return candidates.find((candidate) => existsSync(candidate));
}

async function waitForReady(state: RunnerState, port: number, timeoutMs = 45000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (state.session.status === "server_crashed" || state.session.status === "build_failed") return;
    // Frameworks can report a different bound port after startup.
    const candidateUrls = [state.session.url, `http://127.0.0.1:${port}`, `http://localhost:${port}`].filter(Boolean) as string[];
    for (const candidate of candidateUrls) {
      const health = await checkPreviewHealth(candidate);
      if (health.ok) {
        state.session = {
          ...state.session,
          status: "ready",
          url: candidate,
          port: Number(new URL(candidate).port) || port,
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

/** On explicit Open only: install source dependencies without running lifecycle scripts. */
async function prepareSourceDependencies(state: RunnerState, projectPath: string, manager: ReturnType<typeof detectPackageManager>) {
  if (existsSync(path.join(projectPath, "node_modules"))) return;
  updateStatus(state, "installing");
  addLog(state, "info", `Installing ${manager} dependencies (lifecycle scripts disabled).`);
  const args = manager === "npm" ? ["install", "--ignore-scripts", "--no-audit", "--no-fund", "--package-lock=false"]
    : manager === "pnpm" ? ["install", "--ignore-scripts", "--no-frozen-lockfile"]
    : ["install", "--ignore-scripts"];
  const binary = process.platform === "win32" ? `${manager}.cmd` : manager;
  await new Promise<void>((resolve, reject) => {
    const installer = spawn(binary, args, {
      cwd: projectPath,
      env: { ...createProcessEnvironment(), CI: "1", BROWSER: "none", FORCE_COLOR: "0" },
      stdio: ["ignore", "pipe", "pipe"],
      shell: process.platform === "win32",
    });
    let settled = false;
    const timer = setTimeout(() => finish(new Error("Dependency installation timed out after 180 seconds.")), 180_000);
    function finish(error?: Error) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) { installer.kill(); reject(error); } else resolve();
    }
    const capture = (level: PreviewLogLine["level"], raw: string) => {
      for (const line of raw.split(/\r?\n/)) if (line.trim()) addLog(state, level, sanitizeToolOutputForModel(line));
    };
    installer.stdout.on("data", (chunk) => capture("info", String(chunk)));
    installer.stderr.on("data", (chunk) => capture("warn", String(chunk)));
    installer.once("error", (error) => finish(error));
    installer.once("close", (code) => finish(code === 0 ? undefined : new Error(`${manager} install exited with code ${code ?? "unknown"}; see Preview logs.`)));
  });
  addLog(state, "info", "Dependencies installed. Launching the source dev script.");
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
  const hasIndexHtml = existsSync(path.join(projectPath, "index.html"));
  // OpenDesign-style prototypes land as a single named .html file (e.g.
  // lumen-landing.html). Any HTML file is a valid static entry: vite serves
  // it at its path, and the preview URL below points straight at it.
  let entryFile = hasIndexHtml ? "index.html" : "";
  if (!entryFile) {
    try {
      const names = await fs.readdir(projectPath);
      entryFile = names
        .filter((name) => name.toLowerCase().endsWith(".html"))
        .sort((a, b) => a.localeCompare(b))[0] ?? "";
    } catch {
      entryFile = "";
    }
  }
  const hasHtmlEntry = entryFile !== "";
  const packageManager = hasPackageJson ? detectPackageManager(projectPath) : "npm";
  const script = hasPackageJson ? await detectDevScript(projectPath) : null;
  // Next.js, Nuxt, SvelteKit, etc. do not require a root index.html file.
  if (!hasHtmlEntry && !script) {
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
        message: "The checkout has no index.html entry point or recognised dev/start/preview script. See the upstream README for runtime requirements.",
      },
    };
    const state = { session, logs: priorLogs };
    if (!priorLogs.some((line) => /index\.html entry point/i.test(line.message))) {
      addLog(state, "error", session.lastError!.message);
    }
    sessions.set(projectId, state);
    return session;
  }
  // A package.json without a recognized dev/start/preview script is only a
  // hard failure when there is no HTML entry to fall back to serving
  // statically (vite handles plain HTML + relative-path ES modules with no
  // config and no node_modules install). That fallback already exists below
  // — it was previously unreachable for exactly this case, which is common
  // for agent-generated dependency-free web apps that declare a package.json
  // for metadata but never add a script.

  const port = await findPreviewPort(projectId);
  const viteBinary = getViteBinary(projectPath);
  const session: PreviewSession = {
    projectId,
    projectPath,
    packageManager,
    devCommand: script ? `${packageManager} run ${script.scriptName}: ${script.command}` : "static HTML: vite",
    port,
    url: `http://127.0.0.1:${port}${!script && entryFile !== "index.html" ? `/${entryFile}` : ""}`,
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
  if (script) {
    try {
      await prepareSourceDependencies(state, projectPath, packageManager);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not install source dependencies.";
      state.session = { ...state.session, status: "build_failed", lastError: { title: "Source setup failed", message } };
      addLog(state, "error", message);
      return serialise(state);
    }
  }
  updateStatus(state, "starting");
  // Run the cloned project's own script; do not generate files or ask the AI
  // to make the source resemble a generic Vite project.
  const child = spawn(
    script ? (process.platform === "win32" ? `${packageManager}.cmd` : packageManager) : (viteBinary || "python3"),
    script ? ["run", script.scriptName]
      : viteBinary ? ["--host", "127.0.0.1", "--port", String(port), "--strictPort"]
      : ["-m", "http.server", String(port), "--bind", "127.0.0.1"],
    {
      cwd: projectPath,
      env: { ...createProcessEnvironment(), BROWSER: "none", FORCE_COLOR: "0", HOST: "127.0.0.1", PORT: String(port) },
      stdio: ["pipe", "pipe", "pipe"],
      shell: Boolean(script) && process.platform === "win32",
    },
  );
  state.process = child;
  state.session.processId = String(child.pid ?? "");
  updateStatus(state, "compiling");

  const handleOutput = (level: PreviewLogLine["level"], text: string) => {
    for (const raw of text.split(/\r?\n/)) {
      // Preview logs reach the UI and the agent, so they are redacted first.
      const line = sanitizeToolOutputForModel(raw);
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
  child.on("error", (error) => {
    state.session = { ...state.session, status: "build_failed", lastError: { title: "Source dev server could not launch", message: error.message } };
    addLog(state, "error", error.message);
  });
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

/**
 * Launches the project's real Electron app. The native process runs on the host, so
 * the window and its main-process errors are the source of truth, not a web page.
 * It reuses this runner's session map, logs and stop path. Nothing is written to the
 * project. A missing local Electron install is reported, not replaced.
 */
export async function startElectronApp({
  projectId,
  projectPath,
  projectName,
}: {
  projectId: string;
  projectPath: string;
  projectName: string;
}) {
  const existing = sessions.get(projectId);
  if (existing?.process && existing.process.exitCode == null) existing.process.kill();

  const session: PreviewSession = {
    projectId,
    projectPath,
    packageManager: "npm",
    devCommand: "electron .",
    status: "starting",
    startedAt: Date.now(),
  };
  const state: RunnerState = { session, logs: existing?.logs ?? [] };
  sessions.set(projectId, state);

  const binary = path.join(projectPath, "node_modules", ".bin", process.platform === "win32" ? "electron.cmd" : "electron");
  if (!existsSync(binary)) {
    state.session = {
      ...state.session,
      status: "build_failed",
      lastError: {
        title: "Electron is not installed in this project",
        message: `${projectName} has no local Electron. Install its dependencies with npm install, then start the preview again.`,
      },
    };
    addLog(state, "error", state.session.lastError!.message);
    return serialise(state);
  }

  addLog(state, "info", "Launching the Electron app from the project's local Electron install.");
  const child = spawn(binary, ["."], {
    cwd: projectPath,
    env: { ...createProcessEnvironment(), ELECTRON_ENABLE_LOGGING: "1" },
    stdio: ["pipe", "pipe", "pipe"],
  });
  state.process = child;
  state.session.processId = String(child.pid ?? "");

  const handleOutput = (level: PreviewLogLine["level"], text: string) => {
    for (const raw of text.split(/\r?\n/)) {
      if (!raw.trim()) continue;
      addLog(state, level, sanitizeToolOutputForModel(raw));
    }
  };
  child.stdout.on("data", (chunk) => handleOutput("info", chunk.toString()));
  child.stderr.on("data", (chunk) => handleOutput("error", chunk.toString()));
  child.on("error", (error) => {
    state.session = {
      ...state.session,
      status: "build_failed",
      lastError: { title: "Electron could not start", message: error.message },
    };
    addLog(state, "error", error.message);
  });
  child.on("close", (code) => {
    if (state.session.status === "stopped") return;
    state.session = {
      ...state.session,
      status: code === 0 ? "stopped" : "server_crashed",
      lastError: code === 0 ? undefined : { title: "Electron app exited", message: `The app exited with code ${code ?? "unknown"}.` },
    };
    addLog(state, code === 0 ? "info" : "error", `Electron app exited with code ${code ?? "unknown"}.`);
  });

  updateStatus(state, "running");
  return serialise(state);
}

/**
 * Records an honest preview state for a project whose runtime is not available here.
 * It starts no process and writes no file, so an iOS project never gains an HTML page.
 */
export function setUnavailablePreview({
  projectId,
  projectPath,
  title,
  message,
}: {
  projectId: string;
  projectPath: string;
  title: string;
  message: string;
}) {
  const existing = sessions.get(projectId);
  if (existing?.process && existing.process.exitCode == null) existing.process.kill();
  const session: PreviewSession = {
    projectId,
    projectPath,
    packageManager: "npm",
    devCommand: "none",
    status: "build_failed",
    lastError: { title, message },
  };
  const state: RunnerState = { session, logs: existing?.logs ?? [] };
  addLog(state, "info", message);
  sessions.set(projectId, state);
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
