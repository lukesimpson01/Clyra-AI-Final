import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { Context } from "@deepseek-ai/cordis";
import LlmRuntime, { createUserMessage, ReasoningEffortId } from "@deepseek-ai/dsh-llm";
import SessionStore, { SessionId } from "@deepseek-ai/dsh-session";
import SystemPrompt from "@deepseek-ai/dsh-system-prompt";
import ToolRuntime from "@deepseek-ai/dsh-tools";
import AgentRegistry from "@deepseek-ai/dsh-agent";
import AgentLoop from "@deepseek-ai/dsh-agent-loop";
import SandboxedFileSystem from "@deepseek-ai/dsh-fs-sandbox";
import * as FsObservationPolicy from "@deepseek-ai/dsh-fs-observation-policy";
import * as ToolFs from "@deepseek-ai/dsh-tool-fs";
import LocalSubprocessRuntime from "@deepseek-ai/dsh-subprocess-local";
import * as ToolFsSearch from "@deepseek-ai/dsh-tool-fs-search";
import SandboxBashExecutor from "@deepseek-ai/dsh-bash-sandbox";
import LocalSandboxProvider from "@deepseek-ai/dsh-sandbox-local";
import SandboxPolicyService from "@deepseek-ai/dsh-sandbox-policy";
import * as ToolBash from "@deepseek-ai/dsh-tool-bash";
import * as ToolTodo from "@deepseek-ai/dsh-tool-todo";
import { CheckpointService, type CheckpointManifest } from "./checkpoint-service";
import { ExistingLLMAdapter, ExistingLLMProvider, existingModelStatus } from "./existing-llm-provider";
import { PermissionService } from "./permission-service";
import { AgentStateMachine } from "./state-machine";
import type { AgentEvent, AgentRunState } from "./types";

const execFileAsync = promisify(execFile);

const PERSONA = `You are Clyra's autonomous software engineer running inside DeepSeek Harness.
Act like a developer in the repository: inspect before editing, use targeted search and reads, maintain a compact todo plan for non-trivial work, make focused edits, and run the cheapest relevant validation before completion.
Never invent file changes, command output, diagnostics, previews, or successful tests. Treat failures as observations and repair them. Do not expose private chain-of-thought; provide only concise operational updates and a factual final summary.
Do not read secrets or leave {{cwd}}. Prefer existing architecture and dependencies. For iOS projects, follow the Apple skills stored in .agent/skills and build real SwiftUI source; an "iOS theme/style/look" request alone is visual direction and must not change a web or desktop project's platform.`;

type Listener = (event: AgentEvent) => void;
type SessionRecord = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  runId?: string;
  checkpoint?: CheckpointManifest;
  events: AgentEvent[];
  handle?: { agent: any; dispose(): Promise<void> };
  machine: AgentStateMachine;
  toolStarts: Map<string, { startedAt: number; tool: string; input: Record<string, unknown> }>;
};

function stateForTool(name: string): AgentRunState {
  if (/^(glob|grep|search)/.test(name)) return "SEARCHING";
  if (/^(read|read_image)/.test(name)) return "READING";
  if (/^(write|edit|str_replace)/.test(name)) return "EDITING";
  if (/^(bash|terminal)/.test(name)) return "EXECUTING";
  if (/todo|plan/.test(name)) return "PLANNING";
  return "OBSERVING";
}

function stateLabel(state: AgentRunState) {
  return ({
    PREPARING: "Preparing workspace…", OBSERVING: "Inspecting project…", PLANNING: "Updating plan…",
    SEARCHING: "Searching relevant files…", READING: "Reading implementation…", EDITING: "Editing files…",
    EXECUTING: "Running command…", VERIFYING: "Verifying changes…", WAITING_FOR_APPROVAL: "Waiting for approval…",
    WAITING_FOR_USER: "Waiting for input…", RECOVERING: "Fixing a failure…", COMPLETED: "Completed",
    FAILED: "Failed", CANCELLED: "Cancelled", IDLE: "Idle",
  } satisfies Record<AgentRunState, string>)[state];
}

function textFromToolResult(data: any) {
  const result = data?.message?.content?.find((block: any) => block.type === "tool-result");
  const text = result?.content?.filter((block: any) => block.type === "text").map((block: any) => block.text).join("\n") ?? "";
  return { text, isError: Boolean(result?.isError) };
}

export class HarnessWorkspaceRuntime {
  private ctx?: Context;
  private provider = new ExistingLLMProvider();
  private sessions = new Map<string, SessionRecord>();
  private listeners = new Set<Listener>();
  private recentCalls = new Map<string, number>();
  private checkpointService: CheckpointService;
  private permissionService: PermissionService;

  constructor(readonly projectId: string, readonly workspace: string) {
    this.checkpointService = new CheckpointService(workspace);
    this.permissionService = new PermissionService(workspace);
  }

  async start() {
    if (this.ctx) return;
    const ctx = new Context();
    await ctx.plugin(LlmRuntime);
    await ctx.plugin(SessionStore);
    await ctx.plugin(SystemPrompt, { persona: PERSONA });
    await ctx.plugin(ToolRuntime, { mode: "native" });
    await ctx.plugin(AgentRegistry);
    await ctx.plugin(AgentLoop, { agents: [] });
    ctx.llm.registerAdapter(["existing"], new ExistingLLMAdapter(this.provider));

    await ctx.plugin(LocalSubprocessRuntime);
    await ctx.plugin(LocalSandboxProvider, {});
    await ctx.plugin(SandboxPolicyService, { mode: "workspace-write", workspaceRoot: this.workspace });
    await ctx.plugin(SandboxedFileSystem, { cwd: this.workspace });
    await ctx.plugin(FsObservationPolicy);
    await ctx.plugin(ToolFs, {});
    await ctx.plugin(ToolFsSearch, { sampleOverCapGlobResults: true });
    await ctx.plugin(SandboxBashExecutor, { cwd: this.workspace, timeoutMs: 60_000, maxTimeoutMs: 300_000 });
    await ctx.plugin(ToolBash, { enableRunInBackground: false });
    await ctx.plugin(ToolTodo, { allowParallelInProgress: false });

    ctx.on("tools/pre-execute", async (exec, _next) => {
      const fingerprint = `${exec.name}:${JSON.stringify(exec.arguments)}`;
      const count = (this.recentCalls.get(fingerprint) ?? 0) + 1;
      this.recentCalls.set(fingerprint, count);
      if (count > 3) return { kind: "deny", reason: "Repeated identical tool call stopped by Clyra's runaway-loop safeguard." };
      return this.permissionService.decide(exec);
    });
    ctx.on("session/event", (session: any, event: any) => this.onSessionEvent(String(session.id), event));
    ctx.on("agent/status", ({ agent, status }: any) => {
      const record = this.sessions.get(String(agent.session.id));
      if (!record) return;
      if (status === "running") this.move(record, "OBSERVING");
      if (status === "idle" && record.machine.state !== "COMPLETED" && record.machine.state !== "FAILED" && record.machine.state !== "CANCELLED") {
        this.move(record, "VERIFYING");
        this.move(record, "COMPLETED");
        this.emit(record, { type: "run.completed", runId: record.runId ?? record.id });
      }
    });
    ctx.on("agent/error", ({ agent, error }: any) => {
      const record = this.sessions.get(String(agent.session.id));
      if (!record) return;
      this.forceTerminal(record, "FAILED");
      this.emit(record, { type: "run.failed", runId: record.runId ?? record.id, error: error instanceof Error ? error.message : String(error) });
    });
    this.ctx = ctx;
    await this.restoreMetadata();
  }

  status() { return { ...existingModelStatus(), harness: "deepseek-harness", version: "0.1.0-rc.8", status: this.ctx ? "healthy" : "stopped" }; }

  async createSession(title: string) {
    await this.start();
    const id = randomUUID();
    const record: SessionRecord = { id, title, createdAt: Date.now(), updatedAt: Date.now(), events: [], machine: new AgentStateMachine(), toolStarts: new Map() };
    record.handle = await this.ctx!.agents.create({
      sessionId: SessionId(id),
      meta: { cwd: this.workspace },
      agentOptions: { provider: "existing", model: existingModelStatus().available ? existingModelStatus().model : "deepseek-v4-flash" },
    });
    this.sessions.set(id, record);
    await this.persist();
    return { id, title, time: { created: record.createdAt, updated: record.updatedAt } };
  }

  listSessions() {
    return [...this.sessions.values()].sort((a, b) => b.updatedAt - a.updatedAt).map((record) => ({ id: record.id, title: record.title, time: { created: record.createdAt, updated: record.updatedAt } }));
  }

  async renameSession(id: string, title: string) {
    const record = this.required(id); record.title = title; record.updatedAt = Date.now(); await this.persist();
    return { id, title, time: { created: record.createdAt, updated: record.updatedAt } };
  }

  async deleteSession(id: string) { const record = this.required(id); await record.handle?.dispose(); this.sessions.delete(id); await this.persist(); }

  async prompt(id: string, text: string, effort = "high") {
    const record = this.required(id);
    const priorContext = !record.handle ? this.replayContext(record) : "";
    record.runId = randomUUID();
    record.machine = new AgentStateMachine();
    record.toolStarts.clear();
    this.recentCalls.clear();
    record.checkpoint = await this.checkpointService.create(record.runId);
    this.emit(record, { type: "user.message", id: `user-${record.runId}`, text, timestamp: Date.now() });
    this.move(record, "PREPARING");
    this.emit(record, { type: "run.started", runId: record.runId, sessionId: id, state: record.machine.state });
    const model = existingModelStatus();
    if (!record.handle && this.ctx) {
      record.handle = await this.ctx.agents.create({ sessionId: SessionId(id), meta: { cwd: this.workspace }, agentOptions: { provider: "existing", model: model.available ? model.model : "deepseek-v4-flash", reasoningEffort: ReasoningEffortId(effort) } });
    }
    const content = priorContext
      ? `<previous_session_context>\n${priorContext}\n</previous_session_context>\n\n${text}`
      : text;
    record.handle!.agent.followup(createUserMessage({ content: [{ type: "text", text: content }], source: { kind: "user" } }));
    await this.persist();
  }

  async abort(id: string) {
    const record = this.required(id);
    record.handle?.agent.cancel({ kind: "user" });
    this.forceTerminal(record, "CANCELLED");
    this.emit(record, { type: "run.cancelled", runId: record.runId ?? id });
  }

  messages(id: string) { return this.required(id).events; }
  subscribe(listener: Listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  checkpoints() { return this.checkpointService.list(); }
  revertCheckpoint(id: string) { return this.checkpointService.revert(id); }
  async revertRun(id: string) {
    const checkpoint = this.required(id).checkpoint;
    if (!checkpoint) throw new Error("This run has no checkpoint to restore.");
    return this.checkpointService.revert(checkpoint.id);
  }

  async diff(_id: string) {
    const names = await execFileAsync("git", ["-C", this.workspace, "status", "--porcelain=v1"], { maxBuffer: 2 * 1024 * 1024 }).then((result) => result.stdout).catch(() => "");
    const files = names.split(/\r?\n/).filter(Boolean).map((line) => line.slice(3).trim());
    return Promise.all(files.map(async (file) => {
      const after = await fs.readFile(path.join(this.workspace, file), "utf8").catch(() => "");
      const before = await execFileAsync("git", ["-C", this.workspace, "show", `HEAD:${file}`], { maxBuffer: 8 * 1024 * 1024 }).then((result) => result.stdout).catch(() => "");
      const additions = after.split("\n").filter((line) => !before.split("\n").includes(line)).length;
      const deletions = before.split("\n").filter((line) => !after.split("\n").includes(line)).length;
      return { file, before, after, additions, deletions };
    }));
  }

  async stop() { for (const record of this.sessions.values()) await record.handle?.dispose(); await this.ctx?.fiber.dispose(); this.ctx = undefined; }

  private onSessionEvent(sessionId: string, event: any) {
    const record = this.sessions.get(sessionId);
    if (!record) return;
    const data = event.data ?? {};
    if (event.type === "assistant/chunk") {
      const chunk = data.chunk ?? {};
      const id = `thought-${data.turn ?? 0}-${data.step ?? 0}`;
      if (chunk.type === "block-start" && chunk.blockType === "reasoning") this.emit(record, { type: "thinking.started", id, summary: "Working through the next step…" });
      // Provider reasoning deltas are deliberately never bridged to the UI.
      // The renderer receives operational status summaries, not hidden chain-of-thought.
      if (chunk.type === "block-end" && chunk.block?.type === "reasoning") this.emit(record, { type: "thinking.completed", id });
      if (chunk.type === "text-delta") this.emit(record, { type: "message.delta", delta: String(chunk.text ?? "") });
      if (chunk.type === "block-end" && chunk.block?.type === "text") this.emit(record, { type: "message.completed" });
      return;
    }
    if (event.type === "tool/call") {
      const callId = String(data.callId);
      const tool = String(data.name);
      const input = typeof data.arguments === "string" ? JSON.parse(data.arguments || "{}") : data.arguments;
      record.toolStarts.set(callId, { startedAt: Date.now(), tool, input });
      this.move(record, stateForTool(tool));
      this.emit(record, { type: "tool.started", tool, callId, input });
      if (/^(write|edit|str_replace)/.test(tool)) this.emit(record, { type: "file.change.started", path: String(input?.path ?? input?.file_path ?? ""), callId });
      if (tool === "bash") this.emit(record, { type: "command.started", command: String(input?.command ?? ""), callId });
      return;
    }
    if (event.type === "tool/result") {
      const callId = String(data.message?.source?.callId ?? "");
      const result = textFromToolResult(data);
      const started = record.toolStarts.get(callId);
      const durationMs = Date.now() - (started?.startedAt ?? Date.now());
      if (result.isError) {
        this.move(record, "RECOVERING");
        this.emit(record, { type: "tool.failed", callId, error: result.text, durationMs });
      } else {
        this.emit(record, { type: "tool.completed", callId, output: result.text, durationMs });
        if (/^(write|edit|str_replace)/.test(started?.tool ?? "")) {
          this.emit(record, { type: "file.change.completed", path: String(started?.input.path ?? started?.input.file_path ?? ""), callId });
        }
        if (started?.tool === "bash") {
          const stderrMarker = "\n[stderr]\n";
          const stderrAt = result.text.indexOf(stderrMarker);
          const stdout = stderrAt >= 0 ? result.text.slice(0, stderrAt) : result.text.replace(/\n?\[exit code: \d+\]\s*$/, "");
          const stderr = stderrAt >= 0 ? result.text.slice(stderrAt + stderrMarker.length).replace(/\n?\[exit code: \d+\]\s*$/, "") : "";
          if (stdout && stdout !== "(no output)") this.emit(record, { type: "command.output", callId, stream: "stdout", text: stdout });
          if (stderr) this.emit(record, { type: "command.output", callId, stream: "stderr", text: stderr });
          const exitCode = Number(result.text.match(/\[exit code: (\d+)\]/)?.[1] ?? 0);
          this.emit(record, { type: "command.completed", callId, exitCode });
        }
      }
      return;
    }
    if (event.type === "todo/write") this.emit(record, { type: "plan.updated", items: data.items ?? data.todos ?? [] });
    void this.persist();
  }

  private move(record: SessionRecord, state: AgentRunState) {
    try { record.machine.transition(state); } catch { return; }
    this.emit(record, { type: "run.state", runId: record.runId ?? record.id, state, label: stateLabel(state) });
  }

  private forceTerminal(record: SessionRecord, state: "FAILED" | "CANCELLED") {
    try { record.machine.transition(state); } catch { record.machine = new AgentStateMachine(); record.machine.transition("PREPARING"); record.machine.transition(state); }
  }

  private emit(record: SessionRecord, event: AgentEvent) {
    record.events.push(event);
    if (record.events.length > 4_000) record.events.splice(0, record.events.length - 4_000);
    record.updatedAt = Date.now();
    for (const listener of this.listeners) listener(event);
  }

  private required(id: string) { const record = this.sessions.get(id); if (!record) throw new Error("Unknown Clyra session."); return record; }

  private replayContext(record: SessionRecord) {
    const lines: string[] = [];
    let assistant = "";
    for (const event of record.events) {
      if (event.type === "user.message") lines.push(`User: ${event.text}`);
      if (event.type === "message.delta") assistant += event.delta;
      if (event.type === "message.completed" && assistant.trim()) {
        lines.push(`Assistant: ${assistant.trim()}`);
        assistant = "";
      }
    }
    if (assistant.trim()) lines.push(`Assistant: ${assistant.trim()}`);
    return lines.slice(-12).join("\n").slice(-12_000);
  }

  private metadataPath() { return path.join(this.workspace, ".clyra", "runtime", "sessions.json"); }
  private async persist() {
    await fs.mkdir(path.dirname(this.metadataPath()), { recursive: true });
    const sessions = [...this.sessions.values()].map(({ handle: _handle, machine, toolStarts: _starts, ...record }) => ({ ...record, state: machine.state }));
    await fs.writeFile(this.metadataPath(), `${JSON.stringify({ sessions }, null, 2)}\n`, "utf8");
  }
  private async restoreMetadata() {
    const stored = await fs.readFile(this.metadataPath(), "utf8").then((value) => JSON.parse(value) as { sessions?: any[] }).catch(() => ({}));
    for (const raw of stored.sessions ?? []) {
      this.sessions.set(raw.id, { ...raw, events: raw.events ?? [], machine: new AgentStateMachine(), toolStarts: new Map() });
    }
  }
}

export class HarnessService {
  private runtimes = new Map<string, HarnessWorkspaceRuntime>();
  async start(projectId: string, workspace: string) {
    const existing = this.runtimes.get(projectId);
    if (existing) return existing;
    const runtime = new HarnessWorkspaceRuntime(projectId, workspace);
    await runtime.start();
    this.runtimes.set(projectId, runtime);
    return runtime;
  }
  get(projectId: string) { const runtime = this.runtimes.get(projectId); if (!runtime) throw new Error("Project runtime is not active."); return runtime; }
  status() { return { ...existingModelStatus(), harness: "deepseek-harness", version: "0.1.0-rc.8" }; }
  async stopAll() { await Promise.all([...this.runtimes.values()].map((runtime) => runtime.stop())); this.runtimes.clear(); }
}

export const harnessService = new HarnessService();
