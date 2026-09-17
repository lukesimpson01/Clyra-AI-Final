/**
 * Durable execution records for Clyra Cowork.
 *
 * This is intentionally a small, dependency-free state graph rather than a
 * second agent framework.  It sits beside the existing BotStore and the
 * CapabilityGateway: models may propose work, but only the host can change a
 * task's state after a tool result or an approval decision.
 */
import crypto from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { clyraDataPath } from "../runtime-paths";

export type CoworkTaskState =
  | "planned" | "running" | "blocked" | "awaiting_approval" | "paused"
  | "completed" | "failed" | "cancelled" | "retrying";

export type CoworkActivityKind =
  | "plan" | "thinking" | "browser" | "terminal" | "files" | "research"
  | "delegation" | "approval" | "verification" | "error" | "complete";

export interface CoworkTaskEvent {
  id: string;
  at: string;
  kind: CoworkActivityKind;
  label: string;
  detail?: string;
  state?: CoworkTaskState;
}

export interface CoworkTask {
  id: string;
  projectId: string;
  conversationId: string;
  parentId: string | null;
  dependsOn: string[];
  botId: string;
  title: string;
  objective: string;
  acceptanceCriteria: string[];
  state: CoworkTaskState;
  currentStep: string;
  retries: number;
  maxRetries: number;
  tool: string | null;
  artifacts: string[];
  filesTouched: string[];
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  error: string | null;
  /** A gateway-validated operation held at the approval checkpoint. */
  pendingAction?: { capability: string; action?: string; input: Record<string, unknown> } | null;
  events: CoworkTaskEvent[];
}

export class CoworkTaskError extends Error {}

const TERMINAL: CoworkTaskState[] = ["completed", "failed", "cancelled"];
const allowed: Record<CoworkTaskState, CoworkTaskState[]> = {
  planned: ["running", "paused", "cancelled", "failed"],
  running: ["blocked", "awaiting_approval", "paused", "completed", "failed", "retrying", "cancelled"],
  blocked: ["running", "paused", "failed", "cancelled"],
  awaiting_approval: ["running", "paused", "cancelled", "failed"],
  paused: ["planned", "running", "cancelled", "failed"],
  retrying: ["running", "paused", "failed", "cancelled"],
  completed: [], failed: ["retrying"], cancelled: [],
};

export class CoworkTaskStore {
  private readonly file: string;
  constructor(root = clyraDataPath(".clyra", "cowork")) { this.file = path.join(root, "tasks.json"); }
  private async read(): Promise<CoworkTask[]> {
    try { const parsed = JSON.parse(await fs.readFile(this.file, "utf8")); return Array.isArray(parsed) ? parsed : []; } catch { return []; }
  }
  private async write(tasks: CoworkTask[]) {
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    const temp = `${this.file}.${crypto.randomUUID()}.tmp`;
    await fs.writeFile(temp, JSON.stringify(tasks, null, 2), "utf8");
    await fs.rename(temp, this.file);
  }
  async create(input: Pick<CoworkTask, "conversationId" | "botId" | "title" | "objective"> & Partial<Pick<CoworkTask, "projectId" | "parentId" | "dependsOn" | "acceptanceCriteria">>) {
    const now = new Date().toISOString();
    const task: CoworkTask = {
      id: crypto.randomUUID(), projectId: input.projectId || input.conversationId,
      conversationId: input.conversationId, parentId: input.parentId || null,
      dependsOn: [...new Set(input.dependsOn || [])], botId: input.botId,
      title: input.title.trim().slice(0, 160) || "Untitled task",
      objective: input.objective.trim().slice(0, 12_000),
      acceptanceCriteria: (input.acceptanceCriteria || ["Verify the requested result before completion."]).map((item) => item.slice(0, 600)).slice(0, 12),
      state: "planned", currentStep: "Preparing a working plan", retries: 0, maxRetries: 3, tool: null,
      artifacts: [], filesTouched: [], createdAt: now, updatedAt: now, completedAt: null, error: null, pendingAction: null,
      events: [{ id: crypto.randomUUID(), at: now, kind: "plan", label: "Task created", state: "planned" }],
    };
    const tasks = await this.read(); await this.write([...tasks, task]); return task;
  }
  async get(id: string) { return (await this.read()).find((task) => task.id === id) || null; }
  async list(input: { conversationId?: string; botId?: string; limit?: number } = {}) {
    let tasks = await this.read();
    if (input.conversationId) tasks = tasks.filter((task) => task.conversationId === input.conversationId);
    if (input.botId) tasks = tasks.filter((task) => task.botId === input.botId);
    return tasks.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, input.limit || 200);
  }
  async transition(id: string, state: CoworkTaskState, patch: Partial<Pick<CoworkTask, "currentStep" | "tool" | "error" | "artifacts" | "filesTouched" | "pendingAction">> = {}, event?: Omit<CoworkTaskEvent, "id" | "at" | "state">) {
    const tasks = await this.read(); const task = tasks.find((item) => item.id === id);
    if (!task) throw new CoworkTaskError("That task no longer exists.");
    if (task.state !== state && !allowed[task.state].includes(state)) throw new CoworkTaskError(`Cannot move task from ${task.state} to ${state}.`);
    const now = new Date().toISOString();
    const next: CoworkTask = { ...task, ...patch, state, updatedAt: now,
      completedAt: TERMINAL.includes(state) ? now : task.completedAt,
      events: [...task.events, { id: crypto.randomUUID(), at: now, state, kind: event?.kind || (state === "failed" ? "error" : state === "completed" ? "complete" : "thinking"), label: event?.label || patch.currentStep || state, detail: event?.detail }].slice(-300),
    };
    await this.write(tasks.map((item) => item.id === id ? next : item)); return next;
  }
  async retry(id: string) {
    const task = await this.get(id); if (!task) throw new CoworkTaskError("That task no longer exists.");
    if (!['failed', 'paused', 'blocked'].includes(task.state)) throw new CoworkTaskError("Only paused, blocked, or failed tasks can be retried.");
    const tasks = await this.read(); const now = new Date().toISOString();
    const next = { ...task, state: "retrying" as const, retries: task.retries + 1, error: null, updatedAt: now, completedAt: null,
      events: [...task.events, { id: crypto.randomUUID(), at: now, kind: "thinking" as const, label: "Retry requested", state: "retrying" as const }].slice(-300) };
    await this.write(tasks.map((item) => item.id === id ? next : item)); return next;
  }
}
