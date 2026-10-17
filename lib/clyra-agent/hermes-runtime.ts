import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import crypto from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync, promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { clyraDataPath } from "../runtime-paths";

export type ClyraAgentEventType =
  | "thinking"
  | "planning"
  | "tool_start"
  | "tool_complete"
  | "agent_start"
  | "agent_complete"
  | "approval"
  | "error"
  | "complete";

/** The renderer only consumes this Clyra-owned event shape. Hermes event
 * names stay inside this adapter so the runtime can be upgraded or replaced
 * without leaking an implementation-specific protocol through Chat. */
export type ClyraAgentEvent = {
  runId: string;
  agentId?: string;
  type: ClyraAgentEventType;
  app?: string;
  label?: string;
  progress?: number;
  timestamp: number;
};

export type HermesRuntimeStatus = {
  configured: boolean;
  connected: boolean;
  starting: boolean;
  endpoint: string;
  reason?: string;
  capabilities?: Record<string, unknown>;
};

type HermesRuntimeOptions = {
  endpoint?: string;
  binary?: string;
  port?: number;
  fetchImpl?: typeof fetch;
  environment?: NodeJS.ProcessEnv;
  nativeToolBridge?: { url: string; token: string; scriptPath: string };
};

type RunInput = {
  input: string;
  sessionId: string;
  instructions?: string;
  model?: string;
  idempotencyKey?: string;
};

function isLoopbackUrl(value: string): URL | null {
  if (!value.trim()) return null;
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    if (!/^https?:$/.test(url.protocol) || !new Set(["localhost", "127.0.0.1", "::1"]).has(hostname) || url.username || url.password) return null;
    url.pathname = url.pathname.replace(/\/$/, "");
    return url;
  } catch {
    return null;
  }
}

function platformBinary(runtimeRoot: string) {
  const executable = process.platform === "win32" ? "hermes.exe" : "hermes";
  const scripts = process.platform === "win32" ? "Scripts" : "bin";
  return path.join(runtimeRoot, "venv", scripts, executable);
}

function binaryOnPath(environment: NodeJS.ProcessEnv) {
  const executable = process.platform === "win32" ? "hermes.exe" : "hermes";
  const entries = String(environment.PATH || "").split(path.delimiter).filter(Boolean);
  return entries.map((entry) => path.join(entry, executable)).find((candidate) => existsSync(candidate)) || null;
}

function safeText(value: unknown, max = 500) {
  return typeof value === "string" ? value.replace(/[\r\n]+/g, " ").trim().slice(0, max) : "";
}

function localServiceKey() {
  const keyPath = clyraDataPath(".clyra", "hermes", "api-server.key");
  try {
    const saved = readFileSync(keyPath, "utf8").trim();
    if (saved.length >= 32) return saved;
  } catch {
    // First launch: create Clyra's local loopback credential below.
  }
  const key = crypto.randomBytes(32).toString("base64url");
  mkdirSync(path.dirname(keyPath), { recursive: true, mode: 0o700 });
  writeFileSync(keyPath, `${key}\n`, { encoding: "utf8", mode: 0o600 });
  return key;
}

function hermesProfileHome(environment: NodeJS.ProcessEnv) {
  const configured = String(environment.CLYRA_HERMES_HOME || "").trim();
  if (configured) return path.resolve(configured);

  const projectScoped = clyraDataPath(".clyra", "hermes", "data");
  // Hermes uses a POSIX Unix-domain socket below HERMES_HOME for its gateway
  // liveness probe. The project path can exceed macOS's 104-byte socket limit
  // (especially in a checked-out workspace with spaces), which leaves a
  // healthy agent running without its watchdog. Keep normal data roots as-is,
  // but place only those overlong profiles in a short, stable user-local path.
  const projectedSocketLength = path.join(projectScoped, "state", "gateway.loop-tick.999999.sock").length;
  if (process.platform !== "win32" && projectedSocketLength > 96) {
    const profileId = crypto.createHash("sha256").update(clyraDataPath()).digest("hex").slice(0, 16);
    return path.join(os.homedir(), ".clyra", "agent-profiles", profileId);
  }
  return projectScoped;
}

/**
 * Owns a private, loopback-only Hermes process for Clyra. No browser receives
 * the Hermes key: Clyra's server proxies every call. The spawned process gets
 * Clyra's existing provider environment, so this layer never writes or copies
 * a DeepSeek/API credential into a second config store.
 */
export class HermesRuntime {
  private readonly fetchImpl: typeof fetch;
  private readonly endpoint: URL;
  private readonly binary: string | null;
  private readonly environment: NodeJS.ProcessEnv;
  private readonly apiKey: string;
  private readonly nativeToolBridge?: HermesRuntimeOptions["nativeToolBridge"];
  private child: ChildProcessWithoutNullStreams | null = null;
  private startPromise: Promise<HermesRuntimeStatus> | null = null;
  private lastError = "";
  private lastOutput = "";

  constructor(options: HermesRuntimeOptions = {}) {
    this.environment = options.environment ?? process.env;
    const port = Number.isInteger(options.port) && Number(options.port) > 0 ? Number(options.port) : Number(this.environment.CLYRA_HERMES_PORT || 8642);
    this.endpoint = isLoopbackUrl(options.endpoint ?? this.environment.CLYRA_HERMES_URL ?? "") ?? new URL(`http://127.0.0.1:${port}`);
    const dataRoot = clyraDataPath(".clyra", "hermes", "runtime");
    const configured = String(options.binary ?? this.environment.CLYRA_HERMES_BIN ?? "").trim();
    const bundled = platformBinary(dataRoot);
    // The official installer places `hermes` on PATH. Prefer Clyra's bundled
    // runtime when present, but accept that supported official installation
    // without requiring a second key or a user-facing configuration step.
    this.binary = configured
      ? (existsSync(configured) ? configured : null)
      : (existsSync(bundled) ? bundled : binaryOnPath(this.environment));
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.nativeToolBridge = options.nativeToolBridge;
    // The key is Clyra's local API credential—not a model/provider secret.
    // Persisting it with user-only permissions lets a relaunched Clyra reuse
    // its already-warm loopback service rather than leaking an orphaned child.
    this.apiKey = String(this.environment.CLYRA_HERMES_API_KEY || "").trim() || localServiceKey();
  }

  async status(): Promise<HermesRuntimeStatus> {
    const capabilities = await this.capabilities();
    if (capabilities) return { configured: true, connected: true, starting: Boolean(this.startPromise), endpoint: this.endpoint.origin, capabilities };
    const reason = this.lastError || (this.binary ? "The local agent service is not running." : "Hermes is not installed for this Clyra profile.");
    return { configured: Boolean(this.binary), connected: false, starting: Boolean(this.startPromise), endpoint: this.endpoint.origin, reason };
  }

  async ensureStarted() {
    const online = await this.capabilities();
    if (online) return { configured: true, connected: true, starting: false, endpoint: this.endpoint.origin, capabilities: online } satisfies HermesRuntimeStatus;
    if (!this.binary) return this.status();
    if (!this.startPromise) this.startPromise = this.start();
    try {
      return await this.startPromise;
    } finally {
      this.startPromise = null;
    }
  }

  async createRun(input: RunInput) {
    const runtime = await this.ensureStarted();
    if (!runtime.connected) throw new Error(runtime.reason || "Clyra's local agent runtime is unavailable.");
    const model = input.model
      || String(this.environment.CLYRA_HERMES_MODEL || this.environment.DEEPSEEK_MODEL || this.environment.MY_LLM_MODEL || "deepseek-v4-flash").trim();
    const provider = /deepseek/i.test(model) ? "deepseek" : undefined;
    const response = await this.request("/v1/runs", {
      method: "POST",
      headers: input.idempotencyKey ? { "Idempotency-Key": input.idempotencyKey } : undefined,
      body: JSON.stringify({
        model,
        ...(provider ? { provider } : {}),
        input: input.input,
        session_id: input.sessionId,
        instructions: input.instructions || "You are Clyra's autonomous runtime. Use Clyra-native tools when available. For Vibe projects, inspect the relevant files before editing, moving, or creating files; validate each requested change with the project build or preview before reporting success. Ask for approval before destructive, external, credential, or security-sensitive actions. Keep emitting concise progress while work is active.",
      }),
    });
    return this.readJson(response);
  }

  async getRun(runId: string) {
    return this.readJson(await this.request(`/v1/runs/${encodeURIComponent(runId)}`));
  }

  async steerRun(runId: string, input: string) {
    return this.readJson(await this.request(`/v1/runs/${encodeURIComponent(runId)}/steer`, { method: "POST", body: JSON.stringify({ input }) }));
  }

  async stopRun(runId: string) {
    return this.readJson(await this.request(`/v1/runs/${encodeURIComponent(runId)}/stop`, { method: "POST", body: "{}" }));
  }

  async resolveApproval(runId: string, choice: "once" | "deny", requestId?: string) {
    return this.readJson(await this.request(`/v1/runs/${encodeURIComponent(runId)}/approval`, { method: "POST", body: JSON.stringify({ choice, ...(requestId ? { request_id: requestId } : {}) }) }));
  }

  async events(runId: string) {
    const runtime = await this.ensureStarted();
    if (!runtime.connected) throw new Error(runtime.reason || "Clyra's local agent runtime is unavailable.");
    return this.request(`/v1/runs/${encodeURIComponent(runId)}/events`, { headers: { Accept: "text/event-stream" } });
  }

  stopService() {
    if (!this.child || this.child.exitCode !== null) return;
    this.child.kill(process.platform === "win32" ? undefined : "SIGTERM");
  }

  private async start(): Promise<HermesRuntimeStatus> {
    if (!this.binary) return this.status();
    this.lastError = "";
    const home = hermesProfileHome(this.environment);
    await this.writeClyraConfig(home);
    // Current Hermes separates its dashboard backend (`serve`) from the
    // OpenAI-compatible agent API. Clyra deliberately uses the latter: the
    // foreground gateway hosts the authenticated `/v1/runs` API, SSE event
    // stream, steering, and approval endpoints without ever exposing the
    // Hermes dashboard or requiring a second UI in Clyra.
    const child = spawn(this.binary, ["gateway", "run"], {
      // Give generic filesystem/terminal tools the same project root that
      // Clyra's Vibe workspaces use. App-native operations still prefer the
      // authenticated Clyra MCP bridge written below.
      cwd: clyraDataPath("projects"),
      env: {
        ...this.environment,
        HERMES_HOME: home,
        API_SERVER_ENABLED: "true",
        API_SERVER_HOST: this.endpoint.hostname,
        API_SERVER_PORT: this.endpoint.port || "8642",
        API_SERVER_KEY: this.apiKey,
        ...(this.nativeToolBridge ? { CLYRA_AGENT_BRIDGE_TOKEN: this.nativeToolBridge.token } : {}),
      },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    this.child = child;
    const recordOutput = (chunk: Buffer) => {
      this.lastOutput = `${this.lastOutput}${String(chunk)}`.slice(-2_000);
    };
    child.stdout.on("data", recordOutput);
    child.stderr.on("data", recordOutput);
    child.once("error", (error) => { this.lastError = `Clyra could not start Hermes: ${safeText(error.message)}.`; });
    child.once("exit", (code, signal) => {
      if (this.child === child) this.child = null;
      if (code && code !== 0) this.lastError = `Hermes stopped before it was ready (${signal || `exit ${code}`}). ${safeText(this.lastOutput)}`;
    });
    // Hermes warms its tool registry before exposing the API. On a cold disk
    // that can take 15–25 seconds, so do not mistake a healthy first launch
    // for a crash after an arbitrary ten-second cutoff.
    for (let attempt = 0; attempt < 120; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      const capabilities = await this.capabilities();
      if (capabilities) return { configured: true, connected: true, starting: false, endpoint: this.endpoint.origin, capabilities };
      if (child.exitCode !== null) break;
    }
    return this.status();
  }

  private async capabilities() {
    try {
      const response = await this.request("/v1/capabilities", { signal: AbortSignal.timeout(1_500) });
      if (!response.ok) return null;
      const payload = await response.json();
      return payload && typeof payload === "object" ? payload as Record<string, unknown> : null;
    } catch {
      return null;
    }
  }

  private async writeClyraConfig(home: string) {
    if (!this.nativeToolBridge) return;
    // This is a Clyra-private Hermes profile, not the user's global Hermes
    // setup. It contains only an MCP declaration and references the token via
    // the child process environment; no provider key is ever written here.
    const quote = (value: string) => JSON.stringify(value);
    const config = [
      "mcp_servers:",
      "  clyra_native:",
      `    command: ${quote(process.execPath)}`,
      "    args:",
      `      - ${quote(this.nativeToolBridge.scriptPath)}`,
      "    env:",
      `      CLYRA_AGENT_BRIDGE_URL: ${quote(this.nativeToolBridge.url)}`,
      '      CLYRA_AGENT_BRIDGE_TOKEN: "${CLYRA_AGENT_BRIDGE_TOKEN}"',
      "",
    ].join("\n");
    await fs.mkdir(home, { recursive: true });
    await fs.writeFile(path.join(home, "config.yaml"), config, { encoding: "utf8", mode: 0o600 });
  }

  private request(pathname: string, init: RequestInit = {}) {
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${this.apiKey}`);
    if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
    return this.fetchImpl(new URL(pathname, this.endpoint), { ...init, headers });
  }

  private async readJson(response: Response) {
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      const message = safeText((payload as { error?: { message?: unknown } } | null)?.error?.message) || `Hermes returned HTTP ${response.status}.`;
      throw new Error(message);
    }
    return payload as Record<string, unknown>;
  }
}

/** Map the stable lifecycle events from Hermes into the compact Clyra event
 * vocabulary. Unknown events stay observable without being mistaken for a
 * completed action. */
export function normalizeHermesEvent(runId: string, eventName: string, payload: Record<string, unknown> = {}): ClyraAgentEvent {
  const payloadEvent = safeText(payload.event ?? payload.event_type ?? payload.type, 120);
  const name = (payloadEvent || eventName).toLowerCase();
  const app = safeText(payload.app ?? payload.tool ?? payload.tool_name, 120) || undefined;
  const type: ClyraAgentEventType = name.includes("approval") ? "approval"
    : /tool\.(start|started)|tool_start/.test(name) ? "tool_start"
      : /tool\.(complete|completed|end)|tool_complete/.test(name) ? "tool_complete"
        : /delegate|subagent.*start|agent.*start/.test(name) ? "agent_start"
          : /delegate.*(end|complete)|agent.*complete/.test(name) ? "agent_complete"
            : /error|failed|interrupted/.test(name) ? "error"
              : /complete|finished|cancelled/.test(name) ? "complete"
                : /plan/.test(name) ? "planning"
                  // Hermes uses a compact `progress` event for live tool
                  // activity on several tool transports. Present it as an
                  // active Clyra tool, never as an invented completion.
                  : app && /progress|tool/.test(name) ? "tool_start" : "thinking";
  return {
    runId,
    type,
    // Hermes's public runs API names delegated children `subagent_id`; keep
    // that protocol detail at this boundary and present a Clyra agent ID to
    // the renderer.
    agentId: safeText(payload.agent_id ?? payload.agentId ?? payload.subagent_id ?? payload.child_session_id, 120) || undefined,
    app,
    label: safeText(payload.label ?? payload.message ?? payload.goal ?? payload.preview ?? payload.summary ?? payload.status ?? (app ? `Using ${app}` : payloadEvent || eventName), 280) || undefined,
    progress: typeof payload.progress === "number" && Number.isFinite(payload.progress) ? Math.max(0, Math.min(1, payload.progress)) : undefined,
    timestamp: typeof payload.timestamp === "number"
      ? (payload.timestamp < 100_000_000_000 ? payload.timestamp * 1_000 : payload.timestamp)
      : Date.now(),
  };
}
