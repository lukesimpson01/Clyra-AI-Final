/** Stateful DeepSeek execution loop for one Cowork task. */
import type { Bot } from "./store";
import type { Capability, ToolPermissions } from "./permissions";
import type { CapabilityGateway } from "./capability-gateway";
import type { CoworkTask, CoworkTaskStore } from "./tasks";

type AgentDecision = {
  action: "tool" | "delegate" | "ask_user" | "finish";
  reasoningSummary: string;
  expectedResult?: string;
  tool?: Capability;
  arguments?: Record<string, unknown>;
  delegateTo?: string;
  task?: string;
  acceptanceEvidence?: string;
};

const TOOL_NAMES: Capability[] = ["web_search", "research", "browser", "terminal", "files", "google_workspace", "clyra_tools"];
const MAX_STEPS = 18;
const terse = (value: unknown, max = 1200) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);

function validDecision(value: unknown): AgentDecision | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  if (!['tool', 'delegate', 'ask_user', 'finish'].includes(String(item.action))) return null;
  const reasoningSummary = terse(item.reasoningSummary, 500);
  if (!reasoningSummary) return null;
  if (item.action === "tool" && (!TOOL_NAMES.includes(item.tool as Capability) || !item.arguments || typeof item.arguments !== "object" || Array.isArray(item.arguments))) return null;
  return {
    action: item.action as AgentDecision["action"], reasoningSummary,
    expectedResult: terse(item.expectedResult, 500) || undefined,
    tool: item.tool as Capability | undefined,
    arguments: item.arguments as Record<string, unknown> | undefined,
    delegateTo: terse(item.delegateTo, 80) || undefined,
    task: terse(item.task, 4000) || undefined,
    acceptanceEvidence: terse(item.acceptanceEvidence, 1400) || undefined,
  };
}

async function decide(bot: Bot, task: CoworkTask, observations: string[], signal: AbortSignal): Promise<AgentDecision> {
  const apiKey = process.env.MY_LLM_API_KEY || process.env.DEEPSEEK_API_KEY || "";
  if (!apiKey) throw new Error("DeepSeek is not configured for Cowork. Add DEEPSEEK_API_KEY and retry this task.");
  const base = String(process.env.MY_LLM_BASE_URL || process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com").replace(/\/$/, "");
  const model = process.env.MY_LLM_MODEL || process.env.DEEPSEEK_MODEL || "deepseek-v4-flash";
  const system = `You are ${bot.name}, a ${bot.role} working in Clyra Cowork. Execute a real task with bounded, verifiable steps. You never claim a result without tool evidence. Return ONLY one JSON object matching this schema: {"action":"tool|delegate|ask_user|finish","reasoningSummary":"short public status","expectedResult":"what you will verify","tool":"one of ${TOOL_NAMES.join(', ')}","arguments":{},"delegateTo":"optional coworker name","task":"optional task","acceptanceEvidence":"required when finish"}.\nRules: use browser with operation observe/navigate/action/assist; use terminal only in your workspace; use files only in your workspace. If a tool fails, use a different recovery action or ask the user; never repeat an identical failed operation. Finish only after the acceptance criteria have supporting evidence. Do not expose private reasoning.`;
  const prompt = `Objective: ${task.objective}\nAcceptance criteria:\n${task.acceptanceCriteria.map((item, index) => `${index + 1}. ${item}`).join("\n")}\nCurrent step: ${task.currentStep}\nRecent verified observations:\n${observations.slice(-5).map((item) => `- ${item}`).join("\n") || "- None yet; inspect the environment first."}`;
  const response = await fetch(`${base}/chat/completions`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` }, body: JSON.stringify({ model, temperature: 0.15, max_tokens: 650, response_format: { type: "json_object" }, messages: [{ role: "system", content: system }, { role: "user", content: prompt }] }), signal });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.error?.message || `DeepSeek request failed (${response.status}).`);
  const raw = String(payload?.choices?.[0]?.message?.content || "");
  let parsed: unknown; try { parsed = JSON.parse(raw); } catch { throw new Error("DeepSeek returned an invalid structured decision."); }
  const result = validDecision(parsed); if (!result) throw new Error("DeepSeek returned a decision outside the Cowork schema.");
  return result;
}

export interface TaskRuntimeDeps {
  tasks: CoworkTaskStore;
  gateway: CapabilityGateway;
  getBot: (id: string) => Promise<Bot | null>;
  delegate?: (from: Bot, task: CoworkTask, to: string, request: string) => Promise<string | null>;
}

/** One serialized task runner. It persists after every stateful action. */
export class CoworkTaskRuntime {
  private active = new Map<string, AbortController>();
  constructor(private readonly deps: TaskRuntimeDeps) {}
  isRunning(id: string) { return this.active.has(id); }
  pause(id: string) { this.active.get(id)?.abort(new DOMException("Task paused", "AbortError")); }
  stop(id: string) { this.active.get(id)?.abort(new DOMException("Task stopped", "AbortError")); }

  async run(id: string, approved = false): Promise<CoworkTask | null> {
    if (this.active.has(id)) return this.deps.tasks.get(id);
    const controller = new AbortController(); this.active.set(id, controller);
    try {
      let task = await this.deps.tasks.get(id); if (!task) return null;
      const bot = await this.deps.getBot(task.botId); if (!bot) throw new Error("The assigned coworker no longer exists.");
      if (["completed", "cancelled"].includes(task.state)) return task;
      if (task.state === "awaiting_approval" && !approved) return task;
      const held = task.pendingAction;
      task = await this.deps.tasks.transition(id, "running", { currentStep: approved ? "Resuming approved action" : "Inspecting task context", pendingAction: null }, { kind: "thinking", label: approved ? "Approval received; resuming" : "Starting durable task" });
      const observations: string[] = task.events.slice(-8).map((event) => `${event.label}${event.detail ? `: ${event.detail}` : ""}`);

      // An approval resumes the exact held gateway call before asking DeepSeek
      // for anything else. The model cannot replace an approved operation.
      if (approved && held) {
        const result = await this.deps.gateway.call({ capability: held.capability as Capability, action: held.action, input: held.input }, { botId: bot.id, slug: bot.slug, permissions: bot.permissions, approved: true });
        observations.push(`${held.capability}: ${result.ok ? "completed" : result.error}`);
        task = await this.deps.tasks.transition(id, result.ok ? "running" : "failed", { currentStep: result.ok ? "Approved action completed" : "Approved action failed", error: result.ok ? null : result.error, tool: held.capability, pendingAction: null }, { kind: result.ok ? "verification" : "error", label: result.ok ? "Approved action completed" : "Approved action failed", detail: terse(result.ok ? result.log.detail : result.error) });
        if (!result.ok) return task;
      }

      for (let step = 0; step < MAX_STEPS; step += 1) {
        if (controller.signal.aborted) {
          const latest = await this.deps.tasks.get(id);
          return this.deps.tasks.transition(id, "paused", { currentStep: "Paused — resume performs a fresh observation" }, { kind: "thinking", label: "Task paused" });
        }
        const decision = await decide(bot, task, observations, controller.signal);
        if (decision.action === "finish") {
          if (!decision.acceptanceEvidence) throw new Error("A task cannot finish without acceptance evidence.");
          return this.deps.tasks.transition(id, "completed", { currentStep: "Verified complete", error: null }, { kind: "complete", label: "Task complete", detail: decision.acceptanceEvidence });
        }
        if (decision.action === "ask_user") {
          return this.deps.tasks.transition(id, "blocked", { currentStep: decision.reasoningSummary, error: decision.task || "More information is needed." }, { kind: "approval", label: "Needs information", detail: decision.task || decision.reasoningSummary });
        }
        if (decision.action === "delegate") {
          const child = decision.delegateTo && decision.task && this.deps.delegate ? await this.deps.delegate(bot, task, decision.delegateTo, decision.task) : null;
          observations.push(child ? `Delegated a child task to ${decision.delegateTo}.` : "Delegation was unavailable; continue with the task yourself.");
          task = await this.deps.tasks.transition(id, "running", { currentStep: child ? `Waiting for ${decision.delegateTo}'s child task` : "Continuing without delegation" }, { kind: "delegation", label: child ? `Delegated to ${decision.delegateTo}` : "Delegation unavailable", detail: decision.task });
          continue;
        }
        const result = await this.deps.gateway.call({ capability: decision.tool!, input: decision.arguments! }, { botId: bot.id, slug: bot.slug, permissions: bot.permissions });
        const kind = decision.tool === "terminal" ? "terminal" : decision.tool === "browser" ? "browser" : decision.tool === "files" ? "files" : decision.tool === "research" || decision.tool === "web_search" ? "research" : "thinking";
        if (result.needsApproval) {
          return this.deps.tasks.transition(id, "awaiting_approval", { currentStep: decision.reasoningSummary, tool: decision.tool, pendingAction: { capability: decision.tool!, action: result.log.action || undefined, input: decision.arguments! }, error: null }, { kind: "approval", label: "Approval needed", detail: result.error });
        }
        const detail = result.ok ? terse(typeof result.output === "string" ? result.output : JSON.stringify(result.output)) : terse(result.error);
        observations.push(`${decision.tool}: ${detail}`);
        if (!result.ok) {
          const latest = await this.deps.tasks.get(id); const retry = (latest?.retries || 0) + 1;
          if (retry > (latest?.maxRetries || 3)) return this.deps.tasks.transition(id, "failed", { currentStep: "Recovery exhausted", error: result.error }, { kind: "error", label: "Task failed after bounded recovery", detail: result.error });
          task = await this.deps.tasks.transition(id, "retrying", { currentStep: "Inspecting failure and choosing a different recovery", error: result.error }, { kind: "error", label: "Tool failed; recovering", detail: result.error });
          task = await this.deps.tasks.transition(id, "running", { currentStep: "Recovery in progress" }, { kind: "thinking", label: "Trying a different recovery approach" });
          continue;
        }
        task = await this.deps.tasks.transition(id, "running", { currentStep: decision.expectedResult || decision.reasoningSummary, tool: decision.tool, error: null }, { kind, label: decision.reasoningSummary, detail });
      }
      return this.deps.tasks.transition(id, "failed", { currentStep: "Execution limit reached", error: "The task reached its bounded step limit before verification." }, { kind: "error", label: "Execution limit reached" });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Task execution failed.";
      const task = await this.deps.tasks.get(id);
      if (task && task.state !== "paused") return this.deps.tasks.transition(id, "failed", { currentStep: "Execution failed", error: message }, { kind: "error", label: "Task execution failed", detail: message });
      return task;
    } finally { this.active.delete(id); }
  }
}
