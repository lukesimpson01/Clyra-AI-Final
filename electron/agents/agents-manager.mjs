/**
 * Clyra Agents runs Rakazo (https://github.com/elie222/rakazo, Apache-2.0) as a local Docker stack, the same way
 * Rakazo's own desktop app runs its "app-managed local instance": published images, Postgres, api/worker/web on
 * loopback. This manager owns that stack for Clyra — it starts the container engine if needed (Colima), writes the
 * compose project and a private .env with generated secrets, pulls, starts, waits for health, and reports progress.
 *
 * Model access: the stack's local OpenAI-compatible provider points at Clyra's own relay on the host
 * (server.ts → /api/agents-model/<token>/v1), so Rakazo uses Clyra's configured model and no key is copied here.
 */
import { execFileSync, spawn } from "node:child_process";
import crypto from "node:crypto";
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, userInfo } from "node:os";
import path from "node:path";

export const AGENTS_WEB_PORT = 47660;
export const AGENTS_API_PORT = 47661;
const PROJECT = "clyra-agents";
/** The first agent every install starts with, so its opening message is a real hello rather than a blank-slate note. */
export const FIRST_AGENT = {
  name: "Clyra",
  title: "Personal agent",
  description: "Your always-on agent inside Clyra.",
  instructions: "You are Clyra, the user's personal agent inside the Clyra app on their Mac. Be warm, brief and capable. Do real work with your tools — research, writing, planning, files and follow-ups — and only ask a short question when something genuinely needs their call. Keep replies tidy: lead with the answer, then the detail.",
};
const HEALTH_TIMEOUT_MS = 240_000;

function findBinary(name) {
  for (const dir of ["/usr/local/bin", "/opt/homebrew/bin", "/usr/bin", path.join(homedir(), ".docker", "bin")]) {
    const candidate = path.join(dir, name);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function randomSecret(bytes = 32) {
  return crypto.randomBytes(bytes).toString("hex");
}

export class AgentsManager {
  constructor({ projectRoot, log = console, sessionFetch = null }) {
    this.projectRoot = projectRoot;
    this.sessionFetch = sessionFetch;
    this.log = log;
    this.dir = path.join(homedir(), ".clyra", "agents");
    this.state = { phase: "idle", message: null, detail: null, progress: null, url: `http://127.0.0.1:${AGENTS_WEB_PORT}` };
    this.listeners = new Set();
    this.starting = null;
  }

  onState(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  set(patch) {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) {
      try { listener(this.state); } catch { /* a closed window */ }
    }
  }

  /** The relay token shared with server.ts. Created once, private to this user. */
  modelToken() {
    mkdirSync(this.dir, { recursive: true });
    const file = path.join(this.dir, "model-token");
    if (existsSync(file)) {
      const value = readFileSync(file, "utf8").trim();
      if (/^[A-Za-z0-9_-]{32,}$/.test(value)) return value;
    }
    const token = randomSecret(24);
    writeFileSync(file, token, { mode: 0o600 });
    return token;
  }

  writeProject() {
    mkdirSync(this.dir, { recursive: true });
    copyFileSync(path.join(this.projectRoot, "electron", "agents", "docker-compose.yml"), path.join(this.dir, "docker-compose.yml"));
    const envFile = path.join(this.dir, ".env");
    const existing = existsSync(envFile) ? Object.fromEntries(readFileSync(envFile, "utf8").split("\n").filter((line) => line.includes("=") && !line.startsWith("#")).map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)])) : {};
    const keep = (key, make) => existing[key] || make();
    const url = `http://127.0.0.1:${AGENTS_WEB_PORT}`;
    const values = {
      POSTGRES_USER: "rakazo",
      POSTGRES_PASSWORD: keep("POSTGRES_PASSWORD", () => randomSecret(16)),
      POSTGRES_DB: "rakazo",
      BETTER_AUTH_SECRET: keep("BETTER_AUTH_SECRET", () => randomSecret(32)),
      ENCRYPTION_KEY: keep("ENCRYPTION_KEY", () => randomSecret(32)),
      SCREEN_PROXY_SECRET: keep("SCREEN_PROXY_SECRET", () => randomSecret(32)),
      SANDBOX_SUPERVISOR_TOKEN: keep("SANDBOX_SUPERVISOR_TOKEN", () => randomSecret(32)),
      RAKAZO_DESKTOP_STACK_TOKEN: keep("RAKAZO_DESKTOP_STACK_TOKEN", () => randomSecret(32)),
      SECRET_STORE: "encrypted",
      BETTER_AUTH_URL: url,
      WEB_ORIGIN: url,
      API_URL: url,
      RAKAZO_HOST: "localhost",
      SIGNUPS_ENABLED: "true",
      AUTH_PASSWORD_ENABLED: "true",
      MAX_UPLOAD_SIZE_MB: "25",
      RAKAZO_IMAGE: "ghcr.io/elie222/rakazo/app",
      RAKAZO_IMAGE_TAG: "edge",
      RAKAZO_WEB_PORT: String(AGENTS_WEB_PORT),
      RAKAZO_API_PORT: String(AGENTS_API_PORT),
      // Clyra's model, through Clyra's relay on the host. Context and output limits match DeepSeek's chat models.
      RAKAZO_LOCAL_MODELS: "clyra",
      RAKAZO_LOCAL_MODELS_URL: `http://host.docker.internal:31415/api/agents-model/${this.modelToken()}/v1`,
      RAKAZO_LOCAL_CONTEXT_WINDOW: "65536",
      RAKAZO_LOCAL_MAX_TOKENS: "8192",
      PI_DEFAULT_PROVIDER: "openrouter",
      LOG_LEVEL: "info",
    };
    const text = `# Generated by Clyra for the local Agents (Rakazo) stack. Private to this user.\n${Object.entries(values).map(([key, value]) => `${key}=${value}`).join("\n")}\n`;
    writeFileSync(envFile, text, { mode: 0o600 });
    try { chmodSync(envFile, 0o600); } catch { /* best effort */ }
  }

  /**
   * Writes patches/ids.ts from the installed image's own copy, adding the "none" sandbox kind that upstream's schema
   * omits for installs without sandbox computers. If upstream already includes it, the file is copied unchanged.
   */
  async preparePatches(docker) {
    const read = await this.run(docker, ["run", "--rm", "--entrypoint", "cat", "ghcr.io/elie222/rakazo/app:edge", "/app/packages/contracts/src/ids.ts"], { timeoutMs: 60_000 });
    if (read.code !== 0 || !read.output.includes("SandboxKind")) return false;
    let source = read.output;
    if (!/"none"/.test(source.slice(source.indexOf("SandboxKind = z.enum(")))) {
      source = source.replace(/(export const SandboxKind = z\.enum\(\[[^\]]*?)(\s*\]\);)/, (_match, list, end) => `${list.replace(/,?\s*$/, ",")}\n  "none",${end}`);
    }
    mkdirSync(path.join(this.dir, "patches"), { recursive: true });
    writeFileSync(path.join(this.dir, "patches", "ids.ts"), source);
    return true;
  }

  run(command, args, { onLine, timeoutMs = 600_000 } = {}) {
    mkdirSync(this.dir, { recursive: true });
    return new Promise((resolve) => {
      const env = { ...process.env, PATH: ["/usr/local/bin", "/opt/homebrew/bin", process.env.PATH].filter(Boolean).join(":") };
      delete env.ELECTRON_RUN_AS_NODE;
      const child = spawn(command, args, { cwd: this.dir, env });
      let output = "";
      const feed = (chunk) => {
        const text = chunk.toString();
        output += text;
        if (output.length > 40_000) output = output.slice(-20_000);
        if (onLine) for (const line of text.split(/\r?\n/)) if (line.trim()) onLine(line.trim());
      };
      child.stdout.on("data", feed);
      child.stderr.on("data", feed);
      const timer = setTimeout(() => { try { child.kill(); } catch { /* gone */ } }, timeoutMs);
      child.on("close", (code) => { clearTimeout(timer); resolve({ code: code ?? 1, output }); });
      child.on("error", (error) => { clearTimeout(timer); resolve({ code: 1, output: String(error?.message || error) }); });
    });
  }

  async webReady() {
    try {
      const response = await fetch(`${this.state.url}/`, { signal: AbortSignal.timeout(2500) });
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Agents opens already signed in. Clyra keeps one private local account for this single-user install (random
   * password, stored only in ~/.clyra/agents/account.json) and signs in through the Agents view's own browser session
   * (`sessionFetch`), so the session cookie lands exactly where the embedded app reads it. If someone else's account
   * already owns this install, nothing is created and Rakazo's own sign-in stays visible.
   */
  async ensureSignedIn(sessionFetch) {
    if (typeof sessionFetch !== "function") return false;
    const origin = this.state.url;
    const json = async (route, body) => {
      try {
        const response = await sessionFetch(`${origin}${route}`, {
          method: body ? "POST" : "GET",
          headers: { "content-type": "application/json", origin },
          body: body ? JSON.stringify(body) : undefined,
          credentials: "include",
        });
        return { ok: response.ok, status: response.status, body: await response.json().catch(() => null) };
      } catch (error) {
        return { ok: false, status: 0, body: { message: String(error?.message || error) } };
      }
    };
    const current = await json("/api/auth/get-session");
    if (current.ok && current.body?.user) return true;
    const file = path.join(this.dir, "account.json");
    let account = null;
    try { account = JSON.parse(readFileSync(file, "utf8")); } catch { /* first run */ }
    if (!account?.email || !account?.password) {
      let name = "";
      try { name = execFileSync("/usr/bin/id", ["-F"], { encoding: "utf8" }).trim(); } catch { /* fall back below */ }
      account = { email: `owner@agents.clyra.local`, password: randomSecret(24), name: name || userInfo().username || "You" };
      writeFileSync(file, JSON.stringify(account), { mode: 0o600 });
    }
    const signIn = await json("/api/auth/sign-in/email", { email: account.email, password: account.password, rememberMe: true });
    if (signIn.ok) return true;
    const signUp = await json("/api/auth/sign-up/email", { email: account.email, password: account.password, name: account.name, rememberMe: true });
    if (signUp.ok) {
      const check = await json("/api/auth/get-session");
      if (check.ok && check.body?.user) return true;
      return (await json("/api/auth/sign-in/email", { email: account.email, password: account.password, rememberMe: true })).ok;
    }
    this.log.warn?.("[agents] automatic sign-in unavailable:", signUp.status, signUp.body?.message || signUp.body?.code || "");
    return false;
  }

  /**
   * Finishes Rakazo's first-run setup the way its onboarding would, so Agents opens straight into a conversation:
   * the account's model is Clyra's own (an OpenAI-compatible connection to Clyra's relay), and the first agent —
   * "Clyra" — exists and has greeted you. Each step only runs when it is still missing.
   */
  async ensureSetUp(sessionFetch) {
    const origin = this.state.url;
    const rpc = async (route, input) => {
      try {
        const response = await sessionFetch(`${origin}/rpc/${route}`, {
          method: "POST",
          headers: { "content-type": "application/json", origin },
          body: JSON.stringify(input === undefined ? {} : { json: input }),
          credentials: "include",
        });
        const body = await response.json().catch(() => null);
        return { ok: response.ok, data: body?.json };
      } catch {
        return { ok: false, data: null };
      }
    };
    const me = await rpc("me");
    if (!me.ok) return;
    if (me.data?.needsModel) {
      await rpc("models/connect", {
        provider: "openai-compatible",
        baseUrl: `http://host.docker.internal:31415/api/agents-model/${this.modelToken()}/v1`,
        modelId: "clyra",
        reasoning: true,
        maxTokens: 8192,
        contextWindow: 65536,
        supportsImages: false,
        maxImagesPerPrompt: null,
        label: "Clyra",
      });
    }
    const bots = await rpc("bots/list");
    if (bots.ok && Array.isArray(bots.data) && bots.data.length === 0) {
      const created = await rpc("bots/create", { ...FIRST_AGENT, notifyOnFinish: true, spawnKey: "onboarding:first" });
      const botId = created.data?.id;
      if (botId) {
        const started = await rpc("onboarding/start", { botId });
        if (started.ok) await rpc("onboarding/promptFocus", { botId });
      }
    }
  }

  /** Ready means the app is up and the embedded session is signed in and set up. */
  async markReady() {
    if (this.sessionFetch) {
      this.set({ phase: "starting", message: "Signing you in…", progress: null });
      if (await this.ensureSignedIn(this.sessionFetch)) await this.ensureSetUp(this.sessionFetch);
    }
    this.set({ phase: "ready", message: null, detail: null, progress: null });
    return this.state;
  }

  async status() {
    if (this.starting) return this.state;
    if (this.state.phase === "idle" || this.state.phase === "ready") {
      const ready = await this.webReady();
      if (ready && this.state.phase !== "ready") return this.start();
      if (!ready && this.state.phase === "ready") this.set({ phase: "idle" });
    }
    return this.state;
  }

  start() {
    if (!this.starting) {
      this.starting = this.startOnce().finally(() => { this.starting = null; });
    }
    return this.starting;
  }

  async startOnce() {
    if (await this.webReady()) return this.markReady();
    const docker = findBinary("docker");
    if (!docker) {
      this.set({ phase: "error", message: "Docker isn’t installed", detail: "Clyra Agents runs on Docker. Install Docker Desktop or Colima, then try again." });
      return this.state;
    }
    this.set({ phase: "engine", message: "Starting the agent engine…", detail: null, progress: null });
    let info = await this.run(docker, ["info", "--format", "{{.ServerVersion}}"], { timeoutMs: 20_000 });
    if (info.code !== 0) {
      const colima = findBinary("colima");
      if (colima) {
        await this.run(colima, ["start"], { timeoutMs: 300_000 });
        info = await this.run(docker, ["info", "--format", "{{.ServerVersion}}"], { timeoutMs: 20_000 });
      }
    }
    if (info.code !== 0) {
      this.set({ phase: "error", message: "The container engine isn’t running", detail: "Open Docker Desktop (or run colima start), then try again." });
      return this.state;
    }

    this.writeProject();
    const compose = ["compose", "-p", PROJECT, "--env-file", ".env", "-f", "docker-compose.yml"];

    // Download only when an image is actually missing (an existing install starts straight away; updates are a
    // separate, explicit step). Layer progress becomes one percentage that only moves forward.
    const images = ["ghcr.io/elie222/rakazo/app:edge", "postgres:16@sha256:e17e86066e5ef83e0952a9347f5c792b7ece00972e2aa787a6986f471b3dd3d5", "busybox:1"];
    const missing = [];
    for (const image of images) {
      const inspect = await this.run(docker, ["image", "inspect", "--format", "{{.Id}}", image], { timeoutMs: 20_000 });
      if (inspect.code !== 0) missing.push(image);
    }
    if (missing.length) {
      this.set({ phase: "pulling", message: "Downloading Rakazo…", progress: 0 });
      const layers = new Map();
      let shown = 0;
      for (const image of missing) {
        const pull = await this.run(docker, ["pull", image], {
          timeoutMs: 45 * 60_000,
          onLine: (line) => {
            const match = /^([0-9a-f]{12}):\s*(Pulling fs layer|Waiting|Downloading|Verifying Checksum|Download complete|Extracting|Pull complete|Already exists)/i.exec(line);
            if (!match) return;
            const weight = /pull complete|already exists/i.test(match[2]) ? 1 : /extracting|download complete|verifying/i.test(match[2]) ? 0.75 : /downloading/i.test(match[2]) ? 0.35 : 0.05;
            layers.set(match[1], Math.max(layers.get(match[1]) ?? 0, weight));
            const values = [...layers.values()];
            const next = values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
            if (next > shown) { shown = next; this.set({ progress: Math.min(0.99, shown) }); }
          },
        });
        if (pull.code !== 0) {
          this.set({ phase: "error", message: "Couldn’t download Rakazo", detail: pull.output.split("\n").filter(Boolean).slice(-3).join(" ") });
          return this.state;
        }
      }
    }

    if (!(await this.preparePatches(docker))) {
      this.set({ phase: "error", message: "Couldn’t prepare Rakazo", detail: "The installed image is missing a file Clyra expects. Try again after an update." });
      return this.state;
    }
    this.set({ phase: "starting", message: "Starting your agents…", progress: null });
    const up = await this.run(docker, [...compose, "up", "-d", "--remove-orphans", "--pull", "never"], { timeoutMs: 8 * 60_000 });
    if (up.code !== 0) {
      this.set({ phase: "error", message: "Rakazo didn’t start", detail: up.output.split("\n").filter(Boolean).slice(-4).join(" ") });
      return this.state;
    }
    const deadline = Date.now() + HEALTH_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (await this.webReady()) return this.markReady();
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
    const logs = await this.run(docker, [...compose, "logs", "--tail", "12", "api"], { timeoutMs: 20_000 });
    this.set({ phase: "error", message: "Rakazo is taking too long to start", detail: logs.output.split("\n").filter(Boolean).slice(-4).join(" ") });
    return this.state;
  }
}
