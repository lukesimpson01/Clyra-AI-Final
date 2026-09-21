/**
 * Clyra's shared, deterministic mission runtime.
 *
 * This module deliberately contains no model calls. A planner may propose a
 * plan, but only this runtime can advance it and it does so from validated
 * tool results and verifier evidence. Keeping that boundary explicit prevents
 * an LLM sentence from ever becoming a completion signal.
 */

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type JsonSchema = {
  type?: "object" | "array" | "string" | "number" | "integer" | "boolean" | "null";
  properties?: Record<string, JsonSchema>;
  required?: string[];
  additionalProperties?: boolean;
  items?: JsonSchema;
  enum?: Json[];
  minLength?: number;
  minItems?: number;
  anyOf?: JsonSchema[];
};

export type MissionState =
  | "IDLE" | "UNDERSTANDING" | "PLANNING" | "READY" | "EXECUTING"
  | "OBSERVING" | "VERIFYING" | "REPLANNING" | "WAITING_FOR_APPROVAL"
  | "WAITING_FOR_USER" | "PAUSED" | "RECOVERING" | "COMPLETED" | "FAILED" | "CANCELLED";
export type ToolRisk = "safe" | "review" | "sensitive";
export type ToolPermission = "read" | "write" | "external-send" | "delete" | "computer-control" | "credential";
export type ClyraErrorCode =
  | "TOOL_NOT_FOUND" | "INVALID_ARGUMENTS" | "TOOL_TIMEOUT" | "TOOL_CRASH" | "NETWORK_ERROR"
  | "RATE_LIMIT" | "AUTH_REQUIRED" | "PERMISSION_REQUIRED" | "ELEMENT_NOT_FOUND" | "WINDOW_CHANGED"
  | "BUILD_FAILED" | "TEST_FAILED" | "FILE_NOT_FOUND" | "USER_INPUT_REQUIRED" | "APP_NOT_INSTALLED"
  | "UNSUPPORTED_ACTION" | "VERIFICATION_FAILED" | "UNKNOWN_STATE" | "POSSIBLE_STUCK_LOOP" | "CANCELLED";

export class ClyraAgentError extends Error {
  constructor(public code: ClyraErrorCode, message: string, public retryable = false, public details?: Json) {
    super(message);
  }
}

export type ToolResult = {
  ok: boolean;
  data?: Json;
  evidence?: Array<{ kind: "url" | "file" | "record" | "observation" | "log"; value: string }>;
  error?: { code: ClyraErrorCode; message: string; retryable?: boolean };
};
export type ToolExecutionContext = { missionId: string; projectId?: string; signal: AbortSignal; attempt: number };
export type ToolAvailability = "available" | "unavailable" | "requires-auth" | "unsupported-os";
export type ToolRetryPolicy = { maxAttempts: number; retryableCodes: ClyraErrorCode[]; fallbackOrder?: string[] };
export type ToolVerification = { method: "evidence" | "reopen" | "read-back" | "reload" | "process-exit" | "external-id"; description: string };
export type ClyraTool = {
  id: string;
  name: string;
  description: string;
  category: string;
  inputSchema: JsonSchema;
  permissions: ToolPermission[];
  riskLevel: ToolRisk;
  timeoutMs: number;
  supportsCancellation: boolean;
  /** Machine-readable contract used by planners and progress UI. Optional
   * only for compatibility with third-party adapters; Clyra's catalog always
   * supplies it and validation reports omissions for surfaced tools. */
  capabilities?: string[];
  outputSchema?: JsonSchema;
  availability?: ToolAvailability;
  operatingSystems?: Array<"darwin" | "win32" | "linux" | "web">;
  requiresApproval?: boolean;
  canRunConcurrently?: boolean;
  retryPolicy?: ToolRetryPolicy;
  verification?: ToolVerification;
  execute(args: Json, context: ToolExecutionContext): Promise<ToolResult>;
};

export type MissionStep = {
  id: string;
  description: string;
  toolId: string;
  args: Json;
  dependsOn: string[];
  status: "pending" | "running" | "completed" | "failed" | "blocked" | "cancelled";
  retries?: number;
};
export type MissionPlan = { objective: string; steps: MissionStep[] };
export type MissionLimits = { maxSteps: number; maxRetriesPerStep: number; maxRecoveryAttempts: number; maxRuntimeMs: number; maxConsecutiveToolFailures: number };
// A long-horizon task may legitimately require one hundred bounded actions.
// The watchdog still limits retries and overall runtime, so this is not an
// invitation to run unbounded background work.
export const DEFAULT_MISSION_LIMITS: MissionLimits = Object.freeze({ maxSteps: 200, maxRetriesPerStep: 3, maxRecoveryAttempts: 3, maxRuntimeMs: 60 * 60_000, maxConsecutiveToolFailures: 3 });

const terminal = new Set<MissionState>(["COMPLETED", "FAILED", "CANCELLED"]);
const transitions: Record<MissionState, readonly MissionState[]> = {
  IDLE: ["UNDERSTANDING", "CANCELLED"], UNDERSTANDING: ["PLANNING", "COMPLETED", "FAILED", "CANCELLED"],
  PLANNING: ["READY", "WAITING_FOR_USER", "FAILED", "CANCELLED"], READY: ["EXECUTING", "RECOVERING", "WAITING_FOR_APPROVAL", "PAUSED", "CANCELLED"],
  EXECUTING: ["OBSERVING", "VERIFYING", "RECOVERING", "REPLANNING", "WAITING_FOR_APPROVAL", "WAITING_FOR_USER", "PAUSED", "COMPLETED", "FAILED", "CANCELLED"],
  OBSERVING: ["READY", "VERIFYING", "RECOVERING", "REPLANNING", "FAILED", "PAUSED", "CANCELLED"],
  VERIFYING: ["EXECUTING", "RECOVERING", "REPLANNING", "COMPLETED", "FAILED", "PAUSED", "CANCELLED"],
  REPLANNING: ["READY", "EXECUTING", "WAITING_FOR_USER", "FAILED", "CANCELLED"],
  WAITING_FOR_APPROVAL: ["READY", "CANCELLED", "FAILED"], WAITING_FOR_USER: ["READY", "CANCELLED", "FAILED"],
  PAUSED: ["OBSERVING", "READY", "CANCELLED", "FAILED"], RECOVERING: ["READY", "EXECUTING", "OBSERVING", "REPLANNING", "WAITING_FOR_USER", "FAILED", "CANCELLED"],
  COMPLETED: [], FAILED: [], CANCELLED: [],
};

export function assertTransition(from: MissionState, to: MissionState) {
  if (!transitions[from]?.includes(to)) throw new ClyraAgentError("UNKNOWN_STATE", `Invalid mission transition: ${from} → ${to}`);
}
export function isTerminal(state: MissionState) { return terminal.has(state); }

function isObject(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }
export function validateJson(schema: JsonSchema, value: unknown, at = "arguments"): string[] {
  if (schema.anyOf && !schema.anyOf.some((candidate) => validateJson(candidate, value, at).length === 0)) return [`${at} does not match an allowed schema`];
  if (schema.enum && !schema.enum.some((item) => JSON.stringify(item) === JSON.stringify(value))) return [`${at} must be one of the allowed values`];
  if (!schema.type) return [];
  const typeOk = schema.type === "array" ? Array.isArray(value) : schema.type === "null" ? value === null : schema.type === "integer" ? Number.isInteger(value) : typeof value === schema.type;
  if (!typeOk) return [`${at} must be ${schema.type}`];
  if (schema.type === "string" && schema.minLength && String(value).length < schema.minLength) return [`${at} is too short`];
  if (schema.type === "array") {
    if (schema.minItems && (value as unknown[]).length < schema.minItems) return [`${at} needs at least ${schema.minItems} items`];
    return (value as unknown[]).flatMap((item, index) => schema.items ? validateJson(schema.items, item, `${at}[${index}]`) : []);
  }
  if (schema.type === "object") {
    if (!isObject(value)) return [`${at} must be an object`];
    const errors = (schema.required || []).filter((key) => !(key in value)).map((key) => `${at}.${key} is required`);
    if (schema.additionalProperties === false) errors.push(...Object.keys(value).filter((key) => !schema.properties?.[key]).map((key) => `${at}.${key} is not allowed`));
    for (const [key, child] of Object.entries(schema.properties || {})) if (key in value) errors.push(...validateJson(child, value[key], `${at}.${key}`));
    return errors;
  }
  return [];
}

export function validateToolRegistry(tools: readonly ClyraTool[]): string[] {
  const errors: string[] = []; const ids = new Set<string>();
  for (const tool of tools) {
    // Clyra's established public identifiers use lower camel case after the
    // namespace (for example `vibe.createProject`), so validate that contract
    // instead of forcing a second, incompatible spelling convention.
    if (!/^[a-z][A-Za-z0-9]*(\.[a-z][A-Za-z0-9]*)+$/.test(tool.id)) errors.push(`${tool.id || "<missing>"}: tool id must be namespaced`);
    if (ids.has(tool.id)) errors.push(`${tool.id}: duplicate tool id`); ids.add(tool.id);
    if (!tool.name?.trim()) errors.push(`${tool.id}: name is required`);
    if (!tool.description?.trim()) errors.push(`${tool.id}: description is required`);
    if (!tool.category?.trim()) errors.push(`${tool.id}: category is required`);
    if (!tool.inputSchema || typeof tool.inputSchema !== "object") errors.push(`${tool.id}: input schema is required`);
    if (!Array.isArray(tool.permissions) || !tool.permissions.length) errors.push(`${tool.id}: permissions are required`);
    if (!(["safe", "review", "sensitive"] as string[]).includes(tool.riskLevel)) errors.push(`${tool.id}: invalid risk level`);
    if (!Number.isFinite(tool.timeoutMs) || tool.timeoutMs < 100 || tool.timeoutMs > 30 * 60_000) errors.push(`${tool.id}: timeout must be bounded`);
    if (typeof tool.supportsCancellation !== "boolean") errors.push(`${tool.id}: supportsCancellation must be boolean`);
    if (typeof tool.execute !== "function") errors.push(`${tool.id}: missing execute binding`);
  }
  return errors;
}

export type Verification = { ok: boolean; evidence?: ToolResult["evidence"]; reason?: string };
export type MissionTrace = { at: number; state: MissionState; event: string; stepId?: string; toolId?: string; durationMs?: number; errorCode?: ClyraErrorCode };
export type MissionRecord = { id: string; projectId?: string; state: MissionState; plan: MissionPlan; traces: MissionTrace[]; outputs: Record<string, ToolResult>; startedAt: number; updatedAt: number; approval?: { stepId: string; toolId: string; requestedAt: number }; error?: { code: ClyraErrorCode; message: string } };

export type MissionRuntimeOptions = {
  tools: readonly ClyraTool[];
  verify: (step: MissionStep, result: ToolResult, context: ToolExecutionContext) => Promise<Verification>;
  requestApproval?: (step: MissionStep, tool: ClyraTool) => Promise<boolean>;
  recover?: (input: { record: MissionRecord; step: MissionStep; error: ClyraAgentError }) => Promise<"retry" | "replan" | "wait" | "fail">;
  /** Receives a complete, serialisable snapshot after every meaningful state
   * or step mutation. Persistence is deliberately outside the runtime so the
   * same deterministic loop can run in web, desktop and test hosts. */
  checkpoint?: (record: MissionRecord) => void;
  /** A previously persisted mission. It is never auto-run by construction;
   * callers must explicitly resume it after a process restart. */
  initialRecord?: MissionRecord;
  now?: () => number;
  limits?: Partial<MissionLimits>;
};

export class MissionRuntime {
  private tools = new Map<string, ClyraTool>(); private controller = new AbortController(); private record: MissionRecord; private limits: MissionLimits; private failures = 0; private fingerprints: string[] = [];
  constructor(plan: MissionPlan, private options: MissionRuntimeOptions, id = `mission-${crypto.randomUUID()}`, projectId?: string) {
    const errors = validateToolRegistry(options.tools); if (errors.length) throw new Error(`Invalid Clyra tool registry:\n${errors.join("\n")}`);
    this.options.tools.forEach((tool) => this.tools.set(tool.id, tool)); this.limits = { ...DEFAULT_MISSION_LIMITS, ...options.limits };
    if (!plan.objective.trim() || plan.steps.length > this.limits.maxSteps) throw new ClyraAgentError("INVALID_ARGUMENTS", "Mission plan is empty or exceeds its step limit.");
    const restored = options.initialRecord;
    if (restored) {
      if (!restored.id || !restored.plan?.objective || !Array.isArray(restored.plan.steps)) throw new ClyraAgentError("INVALID_ARGUMENTS", "The stored mission checkpoint is invalid.");
      if (restored.plan.steps.length > this.limits.maxSteps) throw new ClyraAgentError("INVALID_ARGUMENTS", "The stored mission exceeds its step limit.");
      this.record = structuredClone(restored);
    } else {
      this.record = { id, projectId, state: "IDLE", plan: structuredClone(plan), traces: [], outputs: {}, startedAt: this.now(), updatedAt: this.now() };
    }
  }
  snapshot() { return structuredClone(this.record); }
  cancel() { this.controller.abort(); if (!isTerminal(this.record.state)) this.transition("CANCELLED", "cancelled"); }
  pause() { if (!isTerminal(this.record.state)) { this.controller.abort(); this.transition("PAUSED", "paused: active tools cancelled and a fresh observation is required before resume"); } }
  async resume() { if (this.record.state !== "PAUSED") throw new ClyraAgentError("UNKNOWN_STATE", "Only paused missions can resume."); this.controller = new AbortController(); this.transition("OBSERVING", "resume requires fresh observation"); this.transition("READY", "fresh observation required by adapter before its next action"); return this.run(); }
  /**
   * Restore an interrupted, non-terminal mission without trusting the action
   * that was in flight when the host stopped. A running step is returned to
   * pending and will cross a fresh observation and verification boundary on
   * the explicit resume request. Approval and user-input handoffs stay paused
   * rather than being replayed implicitly.
   */
  async resumePersisted() {
    if (isTerminal(this.record.state)) return this.snapshot();
    if (this.record.state === "WAITING_FOR_APPROVAL" || this.record.state === "WAITING_FOR_USER") return this.snapshot();
    const interrupted = this.record.plan.steps.filter((step) => step.status === "running");
    for (const step of interrupted) step.status = "pending";
    this.record.state = "PAUSED";
    this.record.updatedAt = this.now();
    this.record.traces.push({
      at: this.record.updatedAt,
      state: "PAUSED",
      event: interrupted.length
        ? "recovered after interruption: in-flight steps returned to pending for a fresh observation"
        : "recovered after interruption: explicit resume requires a fresh observation",
    });
    this.checkpoint();
    return this.resume();
  }
  /** Approvals are action-scoped even across a restart. This resumes only the
   * exact stored approval and re-runs the normal approval gate before action. */
  async approveAndResume(stepId: string) {
    if (this.record.state !== "WAITING_FOR_APPROVAL" || this.record.approval?.stepId !== stepId) throw new ClyraAgentError("UNKNOWN_STATE", "This mission is not waiting for approval for that action.");
    const step = this.record.plan.steps.find((candidate) => candidate.id === stepId);
    if (!step) throw new ClyraAgentError("UNKNOWN_STATE", "The approved mission step no longer exists.");
    delete this.record.approval;
    this.transition("READY", "approval granted after recovery", step, step.toolId);
    return this.run();
  }
  async continueAfterUser() {
    if (this.record.state !== "WAITING_FOR_USER") throw new ClyraAgentError("UNKNOWN_STATE", "Mission is not waiting for user input.");
    for (const step of this.record.plan.steps) if (step.status === "blocked") step.status = "pending";
    this.transition("READY", "user supplied required input");
    return this.run();
  }
  async run(): Promise<MissionRecord> {
    if (this.record.state === "IDLE") { this.transition("UNDERSTANDING", "objective accepted"); this.transition("PLANNING", "plan validated"); this.transition("READY", "plan ready"); }
    while (!isTerminal(this.record.state)) {
      if (this.record.state === "PAUSED" || this.record.state === "WAITING_FOR_USER" || this.record.state === "WAITING_FOR_APPROVAL") break;
      this.assertBudget();
      const step = this.nextStep();
      if (!step) {
        if (this.record.plan.steps.every((candidate) => candidate.status === "completed")) this.transition("COMPLETED", "all verified steps complete");
        else { this.record.error = { code: "UNKNOWN_STATE", message: "No runnable step remains; dependencies are unresolved." }; this.transition("FAILED", this.record.error.message, undefined, undefined, undefined, "UNKNOWN_STATE"); }
        break;
      }
      const tool = this.tools.get(step.toolId);
      if (!tool) { await this.handleFailure(step, new ClyraAgentError("TOOL_NOT_FOUND", `Tool ${step.toolId} is not registered.`)); continue; }
      const resolvedArgs = this.resolveArgs(step.args);
      const schemaErrors = validateJson(tool.inputSchema, resolvedArgs);
      if (schemaErrors.length) { await this.handleFailure(step, new ClyraAgentError("INVALID_ARGUMENTS", schemaErrors.join("; "))); continue; }
      if (tool.riskLevel !== "safe") {
        this.record.approval = { stepId: step.id, toolId: tool.id, requestedAt: this.now() };
        this.transition("WAITING_FOR_APPROVAL", `approval required for ${tool.id}`, step, tool.id);
        // A declined or absent approval is a durable handoff, not a failed
        // action. It must be explicitly resumed with this exact step ID.
        if (!(await this.options.requestApproval?.(step, tool))) break;
        delete this.record.approval; this.transition("READY", "approval granted", step, tool.id);
      }
      await this.execute(step, tool, resolvedArgs);
    }
    return this.snapshot();
  }
  private async execute(step: MissionStep, tool: ClyraTool, args: Json) {
    // A verified predecessor leaves the mission in EXECUTING. Starting the
    // next independent/ready step is an operational event, not an invalid
    // state transition back into the same state.
    if (this.record.state === "EXECUTING") this.trace("tool executing", step, tool.id);
    else this.transition("EXECUTING", "tool executing", step, tool.id);
    step.status = "running";
    this.checkpoint();
    const attempt = (step.retries || 0) + 1; const started = this.now();
    const fingerprint = `${tool.id}:${JSON.stringify(args)}`;
    this.fingerprints.push(fingerprint); this.fingerprints = this.fingerprints.slice(-3);
    if (this.fingerprints.length === 3 && this.fingerprints.every((item) => item === fingerprint)) { await this.handleFailure(step, new ClyraAgentError("POSSIBLE_STUCK_LOOP", `Repeated action detected for ${tool.id}.`)); return; }
    try {
      const result = await this.withTimeout(tool.execute(args, { missionId: this.record.id, projectId: this.record.projectId, signal: this.controller.signal, attempt }), tool.timeoutMs);
      if (!result.ok) throw new ClyraAgentError(result.error?.code || "TOOL_CRASH", result.error?.message || `${tool.id} failed.`, Boolean(result.error?.retryable));
      this.transition("OBSERVING", "tool result observed", step, tool.id, this.now() - started);
      this.transition("VERIFYING", "verifying actual outcome", step, tool.id);
      const verification = await this.options.verify(step, result, { missionId: this.record.id, projectId: this.record.projectId, signal: this.controller.signal, attempt });
      if (!verification.ok) throw new ClyraAgentError("VERIFICATION_FAILED", verification.reason || `${tool.id} did not produce verifiable evidence.`);
      step.status = "completed"; this.record.outputs[step.id] = { ...result, evidence: verification.evidence || result.evidence }; this.failures = 0; this.transition("EXECUTING", "step verified", step, tool.id, this.now() - started);
    } catch (error) { await this.handleFailure(step, this.normaliseError(error)); }
  }
  private async handleFailure(step: MissionStep, error: ClyraAgentError) {
    if (isTerminal(this.record.state)) return;
    // Pause aborts in-flight work to release mouse/keys and child processes,
    // but is deliberately not cancellation: retain the plan for a fresh,
    // post-resume observation.
    if (this.record.state === "PAUSED") { step.status = "pending"; this.checkpoint(); return; }
    if (error.code === "CANCELLED" || this.controller.signal.aborted) { step.status = "cancelled"; this.transition("CANCELLED", "cancelled", step); return; }
    this.failures += 1; step.retries = (step.retries || 0) + 1;
    this.transition("RECOVERING", error.message, step, undefined, undefined, error.code);
    const recovery = await this.options.recover?.({ record: this.snapshot(), step: structuredClone(step), error }) || (error.retryable && step.retries <= this.limits.maxRetriesPerStep ? "retry" : "fail");
    if (this.failures >= this.limits.maxConsecutiveToolFailures || recovery === "fail" || step.retries > this.limits.maxRetriesPerStep) {
      step.status = "failed"; this.record.error = { code: error.code, message: error.message }; this.transition("FAILED", error.message, step, undefined, undefined, error.code); return;
    }
    if (recovery === "wait") { step.status = "blocked"; this.transition("WAITING_FOR_USER", error.message, step, undefined, undefined, error.code); return; }
    if (recovery === "replan") { step.status = "pending"; this.transition("REPLANNING", error.message, step, undefined, undefined, error.code); this.transition("READY", "replanned", step); return; }
    step.status = "pending"; this.transition("READY", "retrying after recovery", step, undefined, undefined, error.code);
  }
  private nextStep() { return this.record.plan.steps.find((step) => step.status === "pending" && step.dependsOn.every((id) => this.record.plan.steps.find((candidate) => candidate.id === id)?.status === "completed")); }
  private resolveArgs(value: Json): Json {
    if (typeof value === "string") {
      const exact = value.match(/^\$steps\.([\w-]+)\.data\.([\w-]+)$/);
      if (exact) return this.record.outputs[exact[1]]?.data && typeof this.record.outputs[exact[1]]?.data === "object" ? ((this.record.outputs[exact[1]]?.data as Record<string, Json>)[exact[2]] ?? value) : value;
      return value.replace(/\$steps\.([\w-]+)\.data\.([\w-]+)/g, (_match, stepId, key) => {
        const data = this.record.outputs[stepId]?.data;
        return data && typeof data === "object" ? JSON.stringify((data as Record<string, Json>)[key] ?? "") : "";
      });
    }
    if (Array.isArray(value)) return value.map((item) => this.resolveArgs(item)) as Json;
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, this.resolveArgs(item)])) as Json;
    return value;
  }
  private transition(to: MissionState, event: string, step?: MissionStep, toolId?: string, durationMs?: number, errorCode?: ClyraErrorCode) { assertTransition(this.record.state, to); this.record.state = to; this.record.updatedAt = this.now(); this.record.traces.push({ at: this.record.updatedAt, state: to, event, stepId: step?.id, toolId, durationMs, errorCode }); this.checkpoint(); }
  private trace(event: string, step?: MissionStep, toolId?: string, durationMs?: number, errorCode?: ClyraErrorCode) { this.record.updatedAt = this.now(); this.record.traces.push({ at: this.record.updatedAt, state: this.record.state, event, stepId: step?.id, toolId, durationMs, errorCode }); this.checkpoint(); }
  private checkpoint() { this.options.checkpoint?.(this.snapshot()); }
  private now() { return this.options.now?.() || Date.now(); }
  private assertBudget() { if (this.now() - this.record.startedAt > this.limits.maxRuntimeMs) throw new ClyraAgentError("TOOL_TIMEOUT", "Mission runtime limit reached."); if (this.controller.signal.aborted) throw new ClyraAgentError("CANCELLED", "Mission cancelled."); }
  private async withTimeout<T>(value: Promise<T>, timeoutMs: number) { return await Promise.race([value, new Promise<T>((_, reject) => setTimeout(() => reject(new ClyraAgentError("TOOL_TIMEOUT", `Tool timed out after ${timeoutMs}ms.`, true)), timeoutMs))]); }
  private normaliseError(error: unknown) { if (error instanceof ClyraAgentError) return error; if (error instanceof Error && /abort/i.test(error.message)) return new ClyraAgentError("CANCELLED", error.message); return new ClyraAgentError("TOOL_CRASH", error instanceof Error ? error.message : "Tool crashed.", true); }
}
