/**
 * DeepSeek Harness runtime for Clyra Code.
 *
 * This is the second implementation of the coding-runtime contract the Clyra
 * Code renderer already speaks (see `lib/opencode/OpenCodeRuntimeManager.ts`).
 * It drives `deepseek-ai/deepseek-harness` through its published SDK client:
 * one `dsh --profile sdk` subprocess per project, spoken to over stdio
 * JSON-RPC, with the harness session log streamed back as notifications.
 *
 * The harness session log is a different vocabulary from OpenCode's message
 * parts, so this module owns the translation: `assistant/chunk` blocks become
 * text/reasoning parts, `tool/call` + `tool/result` become one tool part with
 * a lifecycle, and `turn/end` becomes idle or an error. The renderer therefore
 * needs no knowledge of which backend produced a transcript.
 *
 * The SDK protocol is deliberately small — initialize, prompt, shutdown, and
 * four notifications. It has no wire-level cancel and no history read, so
 * cancellation closes the runtime and the transcript is owned here and
 * persisted next to the project workspace.
 */

import { HarnessClient } from "@deepseek-ai/dsh-sdk-client";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { clyraDataPath } from "../runtime-paths";
import { createVibePreflight, normalizeEffort, type VibeEffort, type VibePreflight } from "../vibe-agent-v3/preflight";
import { recordVibeUsage, type ModelUsageEvent } from "../vibe-agent-v3/usage-analytics";

const execFileAsync = promisify(execFile);

/** Transcript event delivered to the renderer over SSE. */
export type ClyraAgentEvent = {
  id: string;
  projectId: string;
  sessionId?: string;
  messageId?: string;
  partId?: string;
  sequence: number;
  timestamp: number;
  type: string;
  status?: string;
  payload: Record<string, unknown>;
};

export type HarnessModelStatus =
  | { available: true; providerID: string; modelID: string }
  | { available: false; error: string };

/**
 * Resolve the harness route from server-only configuration. Credentials never
 * leave this process; only the model identity is ever reported outward.
 */
export function harnessModelStatus(): HarnessModelStatus {
  const provider = String(process.env.CLYRA_DSH_PROVIDER || "deepseek-official").trim();
  const requested = String(process.env.CLYRA_DSH_MODEL || process.env.DEEPSEEK_MODEL || "").trim();
  // The harness only routes the v4 model family; legacy aliases were retired.
  const model = requested === "deepseek-v4-pro" || requested === "pro"
    ? "deepseek-v4-pro"
    : requested === "deepseek-v4-flash-vision-exp"
      ? "deepseek-v4-flash-vision-exp"
      : "deepseek-v4-flash";

  const key = String(process.env.DEEPSEEK_API_KEY || "").trim();
  if (key.length >= 16 && !/test|dummy|example|placeholder/i.test(key)) {
    return { available: true, providerID: provider, modelID: model };
  }
  return {
    available: false,
    error: "DEEPSEEK_API_KEY is not configured for the DeepSeek Harness runtime. Set it in the Clyra server environment and retry.",
  };
}

/** The harness rejects session ids outside its own `session-<hex>` shape. */
function newSessionId() {
  return `session-${randomUUID().replace(/-/g, "")}`;
}

type PartState = {
  status: "pending" | "running" | "completed" | "error";
  input?: Record<string, unknown>;
  output?: string;
  title?: string;
  error?: string;
  metadata?: Record<string, unknown>;
  time?: { start?: number; end?: number };
};

type StoredPart = {
  id: string;
  sessionID: string;
  messageID: string;
  type: "text" | "reasoning" | "tool" | "step-finish";
  text?: string;
  tool?: string;
  callID?: string;
  state?: PartState;
  tokens?: { input?: number; output?: number; reasoning?: number };
};

type StoredMessage = {
  info: { id: string; role: "user" | "assistant"; time: { created: number } };
  parts: StoredPart[];
};

type StoredSession = {
  id: string;
  title: string;
  time: { created: number; updated: number };
  /** Commit the workspace sat on when this chat first ran, for real diffs. */
  baseline?: string;
  messages: StoredMessage[];
};

/** Per-session assembly state for the harness chunk stream. */
type StreamState = {
  turn: number;
  messageId: string;
  /** `${step}:${index}` → the part accumulating that streamed block. */
  blocks: Map<string, StoredPart>;
  /** Tool call id → the part representing that call. */
  tools: Map<string, StoredPart>;
};

type ActiveRun = {
  id: string;
  sessionId: string;
  projectId: string;
  provider: string;
  model: string;
  startedAt: number;
  preflight: VibePreflight;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  toolCallIds: Set<string>;
  messageCount: number;
};

type ProjectRuntime = {
  projectId: string;
  projectPath: string;
  client: HarnessClient | null;
  starting: Promise<HarnessClient> | null;
  sessions: Map<string, StoredSession>;
  streams: Map<string, StreamState>;
  runs: Map<string, ActiveRun>;
  listeners: Set<(event: ClyraAgentEvent) => void>;
  events: ClyraAgentEvent[];
  checkpointQueue?: Promise<void>;
  saveQueue?: Promise<void>;
};

function textOfBlocks(blocks: unknown): string {
  if (!Array.isArray(blocks)) return "";
  return blocks
    .map((block) => {
      const row = block as { type?: string; text?: string; content?: unknown };
      if (row?.type === "text" || row?.type === "reasoning") return String(row.text ?? "");
      if (Array.isArray(row?.content)) return textOfBlocks(row.content);
      return "";
    })
    .join("");
}

function parseArguments(raw: unknown): Record<string, unknown> {
  if (typeof raw !== "string" || !raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

/** Never let a provider error carrying a key reach the renderer. */
function redact(value: string) {
  return value.replace(/(?:sk|rk|pk|key)[-_][A-Za-z0-9_-]{8,}/gi, "[redacted credential]").slice(0, 1_500);
}

/**
 * Owns one DeepSeek Harness subprocess per Clyra project. Every session, part
 * and checkpoint is scoped to that project's workspace directory, which is the
 * only directory the harness is ever initialized against.
 */
export class DeepSeekHarnessRuntimeManager {
  private projects = new Map<string, ProjectRuntime>();
  private sequence = 0;
  private lastError = "";

  async start(projectId: string, projectPath: string) {
    const project = this.ensureProject(projectId, projectPath);
    if (project.projectPath !== projectPath) {
      throw new Error("Project ID is already associated with a different workspace.");
    }
    const client = await this.client(project);
    void client;
    return {
      projectId,
      projectPath,
      runtime: "deepseek-harness" as const,
      currentProject: { directory: projectPath },
      status: "healthy" as const,
    };
  }

  async health(projectId?: string) {
    const model = harnessModelStatus();
    if (!model.available) return { status: "failed", error: model.error };
    const project = projectId ? this.projects.get(projectId) : undefined;
    if (projectId && !project) return { status: "stopped", error: this.lastError || undefined };
    if (project && !project.client) return { status: "stopped", projectPath: project.projectPath, error: this.lastError || undefined };
    return { status: "healthy" as const, projectPath: project?.projectPath, runtime: "deepseek-harness" as const };
  }

  async createSession(projectId: string, title?: string) {
    const project = this.requiredProject(projectId);
    const now = Date.now();
    const session: StoredSession = {
      id: newSessionId(),
      title: (title || "").trim() || "New chat",
      time: { created: now, updated: now },
      messages: [],
    };
    project.sessions.set(session.id, session);
    this.persist(project);
    return { id: session.id, title: session.title, time: session.time };
  }

  async listSessions(projectId: string, projectPath?: string) {
    const project = projectPath ? this.ensureProject(projectId, projectPath) : this.projects.get(projectId);
    if (!project) return [];
    return [...project.sessions.values()]
      .sort((a, b) => b.time.updated - a.time.updated)
      .map((session) => ({ id: session.id, title: session.title, time: session.time }));
  }

  async renameSession(projectId: string, sessionId: string, title: string) {
    const project = this.requiredProject(projectId);
    const session = project.sessions.get(sessionId);
    if (!session) throw new Error("That chat no longer exists.");
    session.title = title;
    session.time.updated = Date.now();
    this.persist(project);
    return { id: session.id, title: session.title };
  }

  async deleteSession(projectId: string, sessionId: string) {
    const project = this.requiredProject(projectId);
    project.sessions.delete(sessionId);
    project.streams.delete(sessionId);
    project.runs.delete(sessionId);
    this.persist(project);
    return { ok: true };
  }

  async messages(projectId: string, sessionId: string) {
    const project = this.requiredProject(projectId);
    return project.sessions.get(sessionId)?.messages ?? [];
  }

  /**
   * Real file-level changes for a chat, derived from the workspace repository
   * between the chat's baseline commit and the current worktree.
   */
  async diff(projectId: string, sessionId: string) {
    const project = this.requiredProject(projectId);
    const session = project.sessions.get(sessionId);
    const baseline = session?.baseline;
    if (!baseline) return [];
    const git = (...args: string[]) => execFileAsync("git", ["-C", project.projectPath, ...args], { timeout: 20_000, maxBuffer: 32 * 1024 * 1024 });

    const numstat = await git("diff", "--numstat", baseline, "--").then((r) => r.stdout).catch(() => "");
    const counts = new Map<string, { additions: number; deletions: number }>();
    for (const line of numstat.split("\n")) {
      const [added, removed, file] = line.split("\t");
      if (!file) continue;
      counts.set(file.trim(), {
        additions: Number.parseInt(added, 10) || 0,
        deletions: Number.parseInt(removed, 10) || 0,
      });
    }
    const untracked = await git("ls-files", "--others", "--exclude-standard").then((r) => r.stdout).catch(() => "");
    for (const file of untracked.split("\n").map((row) => row.trim()).filter(Boolean)) {
      if (!counts.has(file)) counts.set(file, { additions: 0, deletions: 0 });
    }

    const diffs: Array<{ file: string; before: string; after: string; additions: number; deletions: number }> = [];
    for (const [file, count] of counts) {
      if (file.startsWith(".clyra")) continue;
      const before = await git("show", `${baseline}:${file}`).then((r) => r.stdout).catch(() => "");
      const after = await fs.promises.readFile(path.join(project.projectPath, file), "utf8").catch(() => "");
      let { additions, deletions } = count;
      if (!additions && !deletions) {
        additions = after ? after.split("\n").length : 0;
        deletions = before ? before.split("\n").length : 0;
      }
      diffs.push({ file, before, after, additions, deletions });
    }
    return diffs;
  }

  /**
   * Revert the latest agent checkpoint with `git revert`, preserving the
   * complete local history — never a reset and never a user commit.
   */
  async undoLastCheckpoint(projectId: string) {
    const project = this.requiredProject(projectId);
    await project.checkpointQueue?.catch(() => undefined);
    const git = (...args: string[]) => execFileAsync("git", ["-C", project.projectPath, ...args], { timeout: 20_000 });
    const status = await git("status", "--porcelain");
    if (status.stdout.trim()) {
      throw new Error("Save or commit local changes before undoing the last Clyra checkpoint.");
    }
    const subject = (await git("log", "-1", "--format=%s")).stdout.trim();
    if (!subject.startsWith("Clyra checkpoint:")) {
      throw new Error("There is no Clyra agent checkpoint to undo.");
    }
    await git("revert", "--no-edit", "HEAD");
    const checkpointId = (await git("rev-parse", "--short", "HEAD")).stdout.trim();
    return { ok: true, checkpointId, message: "Restored the state before the last Clyra agent action." };
  }

  async prompt(
    projectId: string,
    sessionId: string,
    text: string,
    _agent?: string,
    _model?: { providerID: string; modelID: string },
    requestedEffort: VibeEffort = "medium",
  ) {
    const project = this.requiredProject(projectId);
    const session = project.sessions.get(sessionId) ?? this.adoptSession(project, sessionId);
    const route = harnessModelStatus();
    if (!route.available) throw new Error(route.error);

    const client = await this.client(project);
    if (!session.baseline) {
      session.baseline = await execFileAsync("git", ["-C", project.projectPath, "rev-parse", "HEAD"], { timeout: 15_000 })
        .then((r) => r.stdout.trim())
        .catch(() => undefined);
    }

    const preflight = createVibePreflight(text, normalizeEffort(requestedEffort));
    project.runs.set(sessionId, {
      id: randomUUID(),
      sessionId,
      projectId,
      provider: route.providerID,
      model: route.modelID,
      startedAt: Date.now(),
      preflight,
      inputTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
      toolCallIds: new Set<string>(),
      messageCount: 1,
    });

    const messageId = `user-${randomUUID().slice(0, 8)}`;
    session.messages.push({
      info: { id: messageId, role: "user", time: { created: Date.now() } },
      parts: [{ id: `${messageId}-text`, sessionID: sessionId, messageID: messageId, type: "text", text }],
    });
    session.time.updated = Date.now();
    if (session.title === "New chat") session.title = text.replace(/\s+/g, " ").trim().slice(0, 72) || session.title;
    this.persist(project);

    this.publish(project, { type: "session.status", properties: { sessionID: sessionId, status: { type: "busy" } } });
    await client.prompt(sessionId, [{ type: "text", text }]);
    return { ok: true };
  }

  /**
   * The SDK protocol has no mid-turn cancel, so stopping a run means ending
   * the runtime the turn lives in. The next prompt starts a fresh subprocess
   * against the same workspace, and the transcript recorded so far is kept.
   */
  async abort(projectId: string, sessionId: string) {
    const project = this.projects.get(projectId);
    if (!project) return { ok: true };
    const client = project.client;
    project.client = null;
    project.starting = null;
    await client?.close().catch(() => undefined);
    project.streams.delete(sessionId);
    await this.finalizeUsage(project, sessionId, "cancelled");
    this.publish(project, { type: "session.idle", properties: { sessionID: sessionId } });
    return { ok: true };
  }

  /**
   * The harness SDK profile decides tool permissions inside the runtime and
   * the wire carries no approval round-trip, so there is nothing to answer.
   */
  async respondPermission(_projectId: string, _sessionId: string, _permissionId: string, _response: string) {
    return { ok: true };
  }

  subscribe(projectId: string, listener: (event: ClyraAgentEvent) => void) {
    const project = this.requiredProject(projectId);
    project.listeners.add(listener);
    for (const event of project.events) listener(event);
    return () => project.listeners.delete(listener);
  }

  inspect(projectId: string) {
    const project = this.requiredProject(projectId);
    return {
      projectId,
      projectPath: project.projectPath,
      runtime: "deepseek-harness",
      running: Boolean(project.client),
      sessions: [...project.sessions.keys()],
      activeRuns: [...project.runs.keys()],
      events: project.events.slice(-80),
      lastError: this.lastError || undefined,
    };
  }

  async stop() {
    for (const project of this.projects.values()) {
      const client = project.client;
      project.client = null;
      project.starting = null;
      await client?.close().catch(() => undefined);
    }
    return { ok: true };
  }

  // ---------------------------------------------------------------- internals

  private ensureProject(projectId: string, projectPath: string) {
    const existing = this.projects.get(projectId);
    if (existing) return existing;
    const project: ProjectRuntime = {
      projectId,
      projectPath,
      client: null,
      starting: null,
      sessions: new Map(),
      streams: new Map(),
      runs: new Map(),
      listeners: new Set(),
      events: [],
    };
    this.projects.set(projectId, project);
    this.restore(project);
    return project;
  }

  private requiredProject(projectId: string) {
    const project = this.projects.get(projectId);
    if (!project) throw new Error("Start the Clyra Code runtime for this project first.");
    return project;
  }

  private adoptSession(project: ProjectRuntime, sessionId: string) {
    const now = Date.now();
    const session: StoredSession = { id: sessionId, title: "New chat", time: { created: now, updated: now }, messages: [] };
    project.sessions.set(sessionId, session);
    return session;
  }

  private storePath(project: ProjectRuntime) {
    return clyraDataPath("projects", project.projectId, "dsh-sessions.json");
  }

  private restore(project: ProjectRuntime) {
    try {
      const raw = fs.readFileSync(this.storePath(project), "utf8");
      const parsed = JSON.parse(raw) as { sessions?: StoredSession[] };
      for (const session of parsed.sessions ?? []) {
        if (session?.id) project.sessions.set(session.id, { messages: [], ...session });
      }
    } catch {
      /* first run for this project */
    }
  }

  /** Serialize transcript writes so a burst of stream events cannot interleave. */
  private persist(project: ProjectRuntime) {
    const write = async () => {
      const file = this.storePath(project);
      await fs.promises.mkdir(path.dirname(file), { recursive: true });
      const payload = JSON.stringify({ sessions: [...project.sessions.values()] });
      await fs.promises.writeFile(`${file}.tmp`, payload, "utf8");
      await fs.promises.rename(`${file}.tmp`, file);
    };
    project.saveQueue = (project.saveQueue ?? Promise.resolve())
      .catch(() => undefined)
      .then(write)
      .catch((error) => {
        this.lastError = error instanceof Error ? error.message : String(error);
      });
  }

  private client(project: ProjectRuntime): Promise<HarnessClient> {
    if (project.client) return Promise.resolve(project.client);
    if (project.starting) return project.starting;
    const route = harnessModelStatus();
    if (!route.available) return Promise.reject(new Error(route.error));

    const launch = (async () => {
      const client = new HarnessClient({
        profile: "sdk",
        processCwd: project.projectPath,
        dshHome: clyraDataPath("projects", project.projectId, "dsh-home"),
        initializeTimeoutMs: 30_000,
        // A single agent turn can legitimately run for many minutes; the SDK
        // has no wire cancel, so an unbounded request timeout is correct here
        // and cancellation stays an explicit runtime close in `abort()`.
        requestTimeoutMs: undefined,
      });
      client.start();
      await client.initialize({
        cwd: project.projectPath,
        provider: route.providerID,
        model: route.modelID,
      });
      project.client = client;
      void this.streamNotifications(project, client);
      return client;
    })();

    project.starting = launch;
    return launch.catch((error) => {
      project.starting = null;
      this.lastError = error instanceof Error ? error.message : String(error);
      throw error;
    });
  }

  /** Fan the runtime's notification stream into renderer transcript events. */
  private async streamNotifications(project: ProjectRuntime, client: HarnessClient) {
    const subscription = client.subscribe();
    try {
      for await (const notification of subscription) {
        try {
          this.handleNotification(project, notification.method, notification.params);
        } catch (error) {
          this.lastError = error instanceof Error ? error.message : String(error);
        }
      }
    } catch {
      // The runtime is gone (shutdown, abort, or crash). A later prompt spawns
      // a fresh one; anything mid-flight is settled below.
    } finally {
      subscription.close();
      if (project.client === client) {
        project.client = null;
        project.starting = null;
        for (const sessionId of [...project.runs.keys()]) {
          this.publish(project, { type: "session.idle", properties: { sessionID: sessionId } });
          await this.finalizeUsage(project, sessionId, "error");
        }
      }
    }
  }

  private handleNotification(project: ProjectRuntime, method: string, params: Record<string, unknown>) {
    if (method === "session.status") {
      const sessionId = String(params.sessionId || "");
      if (!sessionId) return;
      if (params.status === "idle") {
        void this.settleTurn(project, sessionId, "success");
      } else {
        this.publish(project, { type: "session.status", properties: { sessionID: sessionId, status: { type: "busy" } } });
      }
      return;
    }
    if (method !== "session.event") return;

    const sessionId = String(params.sessionId || "");
    const event = params.event as { type?: string; data?: Record<string, unknown> } | undefined;
    if (!sessionId || !event?.type) return;
    const data = (event.data ?? {}) as Record<string, unknown>;

    switch (event.type) {
      case "turn/start":
        this.openTurn(project, sessionId, Number(data.turn) || 1);
        this.publish(project, { type: "session.status", properties: { sessionID: sessionId, status: { type: "busy" } } });
        return;
      case "assistant/chunk":
        this.handleChunk(project, sessionId, data);
        return;
      case "tool/call":
        this.handleToolCall(project, sessionId, data);
        return;
      case "tool/result":
        this.handleToolResult(project, sessionId, data);
        return;
      case "turn/end":
        this.handleTurnEnd(project, sessionId, data);
        return;
      default:
        return;
    }
  }

  private openTurn(project: ProjectRuntime, sessionId: string, turn: number) {
    const stream = project.streams.get(sessionId);
    if (stream && stream.turn === turn) return stream;
    const next: StreamState = {
      turn,
      messageId: `asst-${sessionId.slice(-8)}-${turn}`,
      blocks: new Map(),
      tools: new Map(),
    };
    project.streams.set(sessionId, next);
    return next;
  }

  private stream(project: ProjectRuntime, sessionId: string, turn: unknown) {
    return project.streams.get(sessionId) ?? this.openTurn(project, sessionId, Number(turn) || 1);
  }

  /**
   * Attach a part to its assistant message, replacing the previous revision so
   * a streamed block ends up stored exactly once.
   */
  private record(project: ProjectRuntime, sessionId: string, part: StoredPart) {
    const session = project.sessions.get(sessionId) ?? this.adoptSession(project, sessionId);
    let message = session.messages.find((entry) => entry.info.id === part.messageID);
    if (!message) {
      message = { info: { id: part.messageID, role: "assistant", time: { created: Date.now() } }, parts: [] };
      session.messages.push(message);
    }
    const index = message.parts.findIndex((entry) => entry.id === part.id);
    if (index >= 0) message.parts[index] = part;
    else message.parts.push(part);
    session.time.updated = Date.now();
    this.publish(project, { type: "message.part.updated", properties: { part } });
  }

  private handleChunk(project: ProjectRuntime, sessionId: string, data: Record<string, unknown>) {
    const stream = this.stream(project, sessionId, data.turn);
    const chunk = (data.chunk ?? {}) as Record<string, unknown>;
    const step = Number(data.step) || 0;
    const index = Number(chunk.index) || 0;
    const key = `${step}:${index}`;

    if (chunk.type === "block-start") {
      const blockType = chunk.blockType === "reasoning" ? "reasoning" : "text";
      if (blockType !== "text" && blockType !== "reasoning") return;
      stream.blocks.set(key, {
        id: `${stream.messageId}-${key.replace(":", "-")}`,
        sessionID: sessionId,
        messageID: stream.messageId,
        type: blockType,
        text: "",
      });
      return;
    }

    if (chunk.type === "text-delta" || chunk.type === "reasoning-delta") {
      const blockType = chunk.type === "reasoning-delta" ? "reasoning" : "text";
      const part = stream.blocks.get(key) ?? {
        id: `${stream.messageId}-${key.replace(":", "-")}`,
        sessionID: sessionId,
        messageID: stream.messageId,
        type: blockType,
        text: "",
      };
      part.type = blockType;
      part.text = `${part.text ?? ""}${String(chunk.text ?? "")}`;
      stream.blocks.set(key, part);
      this.record(project, sessionId, { ...part });
      return;
    }

    if (chunk.type === "block-end") {
      const block = (chunk.block ?? {}) as { type?: string; text?: string };
      if (block.type !== "text" && block.type !== "reasoning") return;
      const part: StoredPart = {
        id: `${stream.messageId}-${key.replace(":", "-")}`,
        sessionID: sessionId,
        messageID: stream.messageId,
        type: block.type,
        text: String(block.text ?? stream.blocks.get(key)?.text ?? ""),
      };
      stream.blocks.set(key, part);
      this.record(project, sessionId, { ...part });
      this.persist(project);
      return;
    }

    if (chunk.type === "usage") {
      const usage = (chunk.usage ?? {}) as Record<string, unknown>;
      const input = Number(usage.inputTokens) || 0;
      const output = Number(usage.outputTokens) || 0;
      const reasoning = Number(usage.reasoningTokens) || 0;
      const run = project.runs.get(sessionId);
      if (run) {
        run.inputTokens += input;
        run.outputTokens += output;
        run.reasoningTokens += reasoning;
        run.messageCount += 1;
      }
      this.record(project, sessionId, {
        id: `${stream.messageId}-step-${Number(data.step) || 0}`,
        sessionID: sessionId,
        messageID: stream.messageId,
        type: "step-finish",
        tokens: { input, output, reasoning },
      });
    }
  }

  private handleToolCall(project: ProjectRuntime, sessionId: string, data: Record<string, unknown>) {
    const stream = this.stream(project, sessionId, data.turn);
    const callId = String(data.callId || "");
    if (!callId) return;
    const part: StoredPart = {
      id: `tool-${callId}`,
      sessionID: sessionId,
      messageID: stream.messageId,
      type: "tool",
      tool: String(data.name || "tool"),
      callID: callId,
      state: {
        status: "running",
        input: parseArguments(data.arguments),
        time: { start: Date.now() },
      },
    };
    stream.tools.set(callId, part);
    project.runs.get(sessionId)?.toolCallIds.add(callId);
    this.record(project, sessionId, { ...part });
  }

  private handleToolResult(project: ProjectRuntime, sessionId: string, data: Record<string, unknown>) {
    const stream = this.stream(project, sessionId, data.turn);
    const message = (data.message ?? {}) as { content?: unknown };
    const block = (Array.isArray(message.content) ? message.content[0] : undefined) as
      | { toolCallId?: string; content?: unknown; isError?: boolean }
      | undefined;
    const callId = String(block?.toolCallId || "");
    if (!callId) return;

    const existing = stream.tools.get(callId);
    const failure = data.error as { name?: string; code?: string } | undefined;
    const isError = Boolean(block?.isError || failure);
    const output = textOfBlocks(block?.content);
    const part: StoredPart = {
      id: `tool-${callId}`,
      sessionID: sessionId,
      messageID: existing?.messageID ?? stream.messageId,
      type: "tool",
      tool: existing?.tool ?? "tool",
      callID: callId,
      state: {
        status: isError ? "error" : "completed",
        input: existing?.state?.input ?? {},
        output: output.slice(0, 200_000),
        error: isError ? redact(output || `${failure?.name ?? "Tool"} failed (${failure?.code ?? "unknown"}).`) : undefined,
        metadata: (data.meta && typeof data.meta === "object" ? data.meta : undefined) as Record<string, unknown> | undefined,
        time: { start: existing?.state?.time?.start, end: Date.now() },
      },
    };
    stream.tools.set(callId, part);
    this.record(project, sessionId, { ...part });
    this.persist(project);
    if (!isError) this.queueGitCheckpoint(project, sessionId, part.tool ?? "agent action");
  }

  private handleTurnEnd(project: ProjectRuntime, sessionId: string, data: Record<string, unknown>) {
    const reason = (data.reason ?? {}) as { kind?: string; error?: { message?: unknown }; reason?: unknown };
    if (reason.kind === "error") {
      const message = redact(String(reason.error?.message || "The DeepSeek Harness run failed."));
      this.lastError = message;
      this.publish(project, { type: "session.error", properties: { sessionID: sessionId, error: { message } } });
      void this.settleTurn(project, sessionId, "error");
      return;
    }
    if (reason.kind === "aborted" || reason.kind === "blocked") {
      void this.settleTurn(project, sessionId, "cancelled");
      return;
    }
    void this.settleTurn(project, sessionId, "success");
  }

  private async settleTurn(project: ProjectRuntime, sessionId: string, status: ModelUsageEvent["status"]) {
    if (!project.runs.has(sessionId)) return;
    this.persist(project);
    await this.finalizeUsage(project, sessionId, status);
    this.publish(project, { type: "session.idle", properties: { sessionID: sessionId } });
  }

  private async finalizeUsage(project: ProjectRuntime, sessionId: string, status: ModelUsageEvent["status"]) {
    const run = project.runs.get(sessionId);
    if (!run) return;
    project.runs.delete(sessionId);
    await recordVibeUsage({
      id: run.id,
      sessionId,
      projectId: run.projectId,
      runId: run.id,
      model: run.model,
      provider: run.provider,
      timestamp: run.startedAt,
      inputTokens: run.inputTokens,
      outputTokens: run.outputTokens,
      reasoningTokens: run.reasoningTokens,
      totalTokens: run.inputTokens + run.outputTokens + run.reasoningTokens,
      latencyMs: Math.max(0, Date.now() - run.startedAt),
      status,
      toolCallCount: run.toolCallIds.size,
      messageCount: run.messageCount,
      taskType: run.preflight.mode,
      effort: run.preflight.effort,
    }).catch((error) => {
      this.lastError = error instanceof Error ? error.message : String(error);
    });
  }

  /**
   * Snapshot the workspace after a completed tool action. A clean worktree
   * produces no commit, so reads and no-op commands stay free.
   */
  private queueGitCheckpoint(project: ProjectRuntime, sessionId: string, tool: string) {
    const label = tool.replace(/[\r\n]+/g, " ").trim().slice(0, 80) || "agent action";
    const create = async () => {
      const git = (...args: string[]) => execFileAsync("git", ["-C", project.projectPath, ...args], { timeout: 20_000 });
      const status = await git("status", "--porcelain");
      if (!status.stdout.trim()) return;
      await git("add", "-A");
      await git("commit", "-m", `Clyra checkpoint: ${label}`);
      const checkpointId = (await git("rev-parse", "--short", "HEAD")).stdout.trim();
      this.publish(project, {
        type: "checkpoint.created",
        properties: { sessionID: sessionId, checkpointID: checkpointId, tool: label },
      });
    };
    project.checkpointQueue = (project.checkpointQueue ?? Promise.resolve())
      .catch(() => undefined)
      .then(create)
      .catch((error) => {
        this.lastError = error instanceof Error ? error.message : String(error);
      });
  }

  private publish(project: ProjectRuntime, payload: { type: string; properties: Record<string, unknown> }) {
    const properties = payload.properties;
    const part = (properties.part ?? {}) as StoredPart;
    this.sequence += 1;
    const event: ClyraAgentEvent = {
      id: randomUUID(),
      projectId: project.projectId,
      sessionId: String(part.sessionID || properties.sessionID || "") || undefined,
      messageId: part.messageID || undefined,
      partId: part.id || undefined,
      sequence: this.sequence,
      timestamp: Date.now(),
      type: payload.type,
      status: (part.state as PartState | undefined)?.status,
      payload,
    };
    project.events.push(event);
    // Bounded replay buffer: a reconnecting renderer rebuilds the recent
    // transcript from here, and full history comes from the messages route.
    if (project.events.length > 600) project.events.splice(0, project.events.length - 600);
    for (const listener of project.listeners) {
      try {
        listener(event);
      } catch {
        /* a dead SSE listener must not break the stream */
      }
    }
  }
}

export const deepSeekHarnessRuntimeManager = new DeepSeekHarnessRuntimeManager();
