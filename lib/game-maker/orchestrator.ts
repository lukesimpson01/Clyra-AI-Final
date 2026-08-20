/**
 * The AI orchestrator (spec §62, §63, §72, §134, §202).
 *
 * Runs server-side so the model key never reaches the browser. Implements an
 * explicit state machine — ground → plan → execute → verify → repair →
 * commit — rather than an unbounded reasoning loop, and dispatches every
 * tool call back to the browser over the socket.
 *
 * The design assumption is a *modest* model: the reliability comes from the
 * small tool surface, hard validation, deterministic generators and the
 * repair loop, not from the model being clever.
 */
import type { Server } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import { prepareDeepseekChatBody } from "../deepseek-models";
import type { AgentState, ChangePlan, ClientMessage, EffortLevel, ServerMessage } from "./protocol";

const WS_OPEN = 1;
const MAX_TOOL_CALLS: Record<EffortLevel, number> = { FAST: 6, STANDARD: 22, DEEP: 60 };
const MAX_REPAIRS = 3; // spec §134
const TOOL_TIMEOUT_MS = 180_000;

interface PendingTool {
  resolve: (value: { ok: boolean; result?: unknown; error?: { code: string; message: string; hint?: string } }) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string } }[];
  tool_call_id?: string;
}

interface ToolSchema {
  type: "function";
  function: { name: string; description: string; parameters: unknown };
}

class Task {
  state: AgentState = "RECEIVING";
  cancelled = false;
  paused = false;
  toolCalls = 0;
  repairs = 0;
  plan: ChangePlan | null = null;
  runtimeBooted = false;
  smokeTestPassed = false;
  noCriticalRuntimeErrors = false;
  readonly requiresPlayableCompletion: boolean;
  readonly pending = new Map<string, PendingTool>();

  constructor(
    readonly id: string,
    readonly projectId: string,
    readonly request: string,
    readonly effort: EffortLevel,
    readonly context: Record<string, unknown>,
  ) {
    this.requiresPlayableCompletion = /\b(make|create|build|generate)\b[\s\S]*\b(game|world|level|platformer|adventure|rpg|sandbox|shooter)\b/i.test(request);
  }
}

/* ---------------- prompts ---------------- */

const SYSTEM_PROMPT = `You are the engine agent for Clyra Game Maker, a browser-native game editor. You operate a real, live game project through tools.

HARD RULES
1. You cannot see. There is no screenshot and no vision. Never say you "looked at" or "can see" anything. Everything you know comes from tool results — read them and quote what they actually returned.
2. Never invent coordinates, entity ids, generator names, component names or parameter names. Get ids from scene.query or editor.getContext; get schemas from tool.discover; let scene.place compute positions from anchors.
3. When the user says "here", "this", "there", "to the left" or "where I'm looking", call editor.getContext first and then use scene.place with the matching anchor. The engine resolves those words, not you.
4. Prefer generators over hand-placement. "Build a village" is ONE scene.generate call, not four hundred scene.applyPatch operations. If a patch would create more than ~20 entities, you are using the wrong tool.
5. Prefer existing components over new code. Check gameplay.configure and tool.discover before ever reaching for code.edit.
6. When a tool fails, read its "hint" field — it tells you exactly what to do next. Fix and retry once; do not repeat the same failing call.
7. Before you say a change works, prove it: project.validate for structure, and runtime.start + test.run for anything that involves gameplay, movement or interaction.

STYLE
Reply to the user in plain language, briefly, about what changed and what they can now do. Do not narrate your reasoning, list your tool calls, or use headings. If something could not be done, say so plainly and say why.`;

function effortGuidance(effort: EffortLevel): string {
  if (effort === "FAST") {
    return `This is a small, direct change. Use the fewest tools that will do it — typically editor.getContext, then one edit. Do not plan, do not run a playtest, do not validate the whole project.`;
  }
  if (effort === "DEEP") {
    return `This is substantial work. Take a checkpoint first (history.checkpoint). Build it in stages, verifying as you go: generate content, build navigation, start the runtime, run a playtest that walks the route a player would actually take, profile performance, and repair anything that fails. Do not try to produce a finished 100-hour game — produce one coherent, playable slice and say what you built.`;
  }
  return `Plan briefly, make the change, then verify it: project.validate always, plus runtime.start and test.run whenever the change affects gameplay, movement or interaction.`;
}

function classifyEffort(request: string): EffortLevel {
  const text = request.toLowerCase();
  if (/\b(make|create|build|generate)\b.*\b(game|world|village|city|town|castle|dungeon|level|island|continent|rpg|platformer|sandbox|shooter)\b/.test(text)) return "DEEP";
  if (/\b(whole|entire|full|complete|from scratch)\b/.test(text)) return "DEEP";
  if (/^\s*(move|rotate|scale|rename|delete|hide|show|colou?r|tint|resize|set)\b/.test(text)) return "FAST";
  if (text.split(/\s+/).length <= 6 && !/\b(and|then|also)\b/.test(text)) return "FAST";
  return "STANDARD";
}

/* ---------------- model client ---------------- */

interface ModelChoice {
  message: { content: string | null; tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string } }[] };
  finish_reason: string;
}

/**
 * Provider abstraction (spec §249). One implementation today (the app's
 * DeepSeek proxy), but nothing above this line knows the vendor.
 */
export interface ModelProvider {
  generate(input: { messages: ChatMessage[]; tools?: ToolSchema[]; temperature?: number; maxTokens?: number }): Promise<ModelChoice>;
}

class DeepseekProvider implements ModelProvider {
  async generate(input: { messages: ChatMessage[]; tools?: ToolSchema[]; temperature?: number; maxTokens?: number }): Promise<ModelChoice> {
    const apiKey = process.env.DEEPSEEK_API_KEY;
    if (!apiKey) {
      throw new Error("Clyra's model API is not configured. Add DEEPSEEK_API_KEY to .env or .env.local and restart the server.");
    }
    const baseUrl = String(process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com").replace(/\/$/, "");
    const body = prepareDeepseekChatBody({
      messages: input.messages,
      tools: input.tools,
      tool_choice: input.tools?.length ? "auto" : undefined,
      temperature: input.temperature ?? 0.2,
      max_tokens: input.maxTokens ?? 2400,
    } as Record<string, unknown>);

    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`The model API returned ${response.status}. ${text.slice(0, 400)}`);
    }
    const payload = (await response.json()) as { choices?: ModelChoice[] };
    const choice = payload.choices?.[0];
    if (!choice) throw new Error("The model returned no response.");
    return choice;
  }
}

/** Parse JSON that a model may have wrapped in prose or a code fence (§250). */
export function parseModelJson<T>(raw: string): T | null {
  const trimmed = raw.trim();
  const candidates = [trimmed];
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced?.[1]) candidates.unshift(fenced[1].trim());
  const braced = trimmed.match(/\{[\s\S]*\}/);
  if (braced?.[0]) candidates.push(braced[0]);
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate) as T;
    } catch {
      continue;
    }
  }
  return null;
}

/* ---------------- the orchestrator ---------------- */

export interface OrchestratorOptions {
  provider?: ModelProvider;
  path?: string;
}

export function attachGameMakerOrchestrator(server: Server, options: OrchestratorOptions = {}) {
  const provider = options.provider ?? new DeepseekProvider();
  const path = options.path ?? "/api/game-maker/agent";
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (request, socket, head) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    if (url.pathname !== path) return;
    wss.handleUpgrade(request, socket, head, (ws) => wss.emit("connection", ws, request));
  });

  wss.on("connection", (ws: WebSocket) => {
    const tasks = new Map<string, Task>();

    const send = (message: ServerMessage) => {
      if (ws.readyState === WS_OPEN) ws.send(JSON.stringify(message));
    };

    const setState = (task: Task, state: AgentState, detail?: string) => {
      task.state = state;
      send({ type: "task.state", taskId: task.id, state, detail });
    };

    /** Ask the browser to run a tool and wait for its result. */
    const callTool = (task: Task, tool: string, args: Record<string, unknown>, intent?: string) =>
      new Promise<{ ok: boolean; result?: unknown; error?: { code: string; message: string; hint?: string } }>((resolve) => {
        const requestId = `tr-${task.id}-${task.toolCalls}-${Date.now().toString(36)}`;
        const timer = setTimeout(() => {
          task.pending.delete(requestId);
          resolve({ ok: false, error: { code: "TOOL_TIMEOUT", message: `The editor did not finish "${tool}" within ${TOOL_TIMEOUT_MS / 1000}s.`, hint: "Try a smaller operation, or check the editor console for a runtime error." } });
        }, TOOL_TIMEOUT_MS);
        task.pending.set(requestId, { resolve, timer });
        send({ type: "tool.request", taskId: task.id, requestId, tool, arguments: args, intent });
      });

    const waitWhilePaused = async (task: Task) => {
      while (task.paused && !task.cancelled) {
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    };

    async function runTask(task: Task) {
      try {
        setState(task, "GROUNDING", "Reading the editor context");

        // The browser sends its own tool catalogue so the two can never drift.
        const tools = (task.context.tools as ToolSchema[] | undefined) ?? [];
        if (!tools.length) throw new Error("The editor did not send its tool catalogue; cannot start.");

        const brief = String(task.context.brief ?? "");
        const messages: ChatMessage[] = [
          { role: "system", content: `${SYSTEM_PROMPT}\n\n${effortGuidance(task.effort)}` },
          { role: "user", content: `${brief}\n\n---\nUser request: ${task.request}` },
        ];

        if (task.effort !== "FAST") {
          setState(task, "PLANNING", "Working out the steps");
          const plan = await makePlan(task, messages);
          if (plan) {
            task.plan = plan;
            send({ type: "plan.created", taskId: task.id, plan });
            messages.push({
              role: "assistant",
              content: `Plan: ${plan.goal}\nSteps: ${plan.steps.map((step, index) => `${index + 1}. ${step.tool} — ${step.intent}`).join("; ")}\nSuccess criteria: ${plan.successCriteria.join("; ")}`,
            });
          }
        }

        if (task.effort === "DEEP") {
          setState(task, "CHECKPOINTING", "Saving a restore point");
          await callTool(task, "history.checkpoint", { action: "create", label: task.request.slice(0, 100) }, "Restore point before major work");
        }

        setState(task, "EXECUTING", "Making the changes");
        const budget = MAX_TOOL_CALLS[task.effort];
        let finalText = "";
        let lastFailure: { tool: string; message: string } | null = null;

        while (task.toolCalls < budget) {
          if (task.cancelled) return void send({ type: "task.cancelled", taskId: task.id });
          await waitWhilePaused(task);
          if (task.cancelled) return void send({ type: "task.cancelled", taskId: task.id });

          const choice = await provider.generate({ messages, tools });
          const calls = choice.message.tool_calls ?? [];
          const text = choice.message.content?.trim() ?? "";

          if (!calls.length) {
            finalText = text;
            break;
          }

          messages.push({ role: "assistant", content: text || null, tool_calls: calls });

          for (const call of calls) {
            if (task.cancelled) return void send({ type: "task.cancelled", taskId: task.id });
            task.toolCalls += 1;

            let args: Record<string, unknown> = {};
            const rawArguments = call.function.arguments ?? "{}";
            const parsed = parseModelJson<Record<string, unknown>>(rawArguments);
            if (parsed && typeof parsed === "object") {
              args = parsed;
            } else {
              // One repair pass on malformed JSON, then refuse (spec §250).
              messages.push({
                role: "tool",
                tool_call_id: call.id,
                content: JSON.stringify({ ok: false, error: { code: "MALFORMED_ARGUMENTS", message: "Your tool arguments were not valid JSON.", hint: "Resend this call with a single valid JSON object." } }),
              });
              continue;
            }

            const toolName = call.function.name;
            if (toolName.includes("test") || toolName.includes("runtime")) setState(task, "PLAYTESTING", `Running ${toolName}`);
            else if (toolName.includes("validate")) setState(task, "VALIDATING", "Checking the project");
            else if (toolName.includes("profile")) setState(task, "PROFILING", "Measuring performance");
            else setState(task, "EXECUTING", `Running ${toolName}`);

            const outcome = await callTool(task, toolName, args);
            const toolData = (outcome.result as { data?: Record<string, unknown> } | undefined)?.data;
            if (outcome.ok && toolName === "runtime.start") task.runtimeBooted = true;
            if (outcome.ok && toolName === "test.run") {
              task.smokeTestPassed ||= toolData?.passed === true;
              task.noCriticalRuntimeErrors ||= Number(toolData?.runtimeErrors ?? 1) === 0;
            }
            if (!outcome.ok) {
              lastFailure = { tool: toolName, message: outcome.error?.message ?? "unknown" };
              task.repairs += 1;
              if (task.repairs > MAX_REPAIRS) {
                setState(task, "FAILED");
                send({
                  type: "task.failed",
                  taskId: task.id,
                  error: `Stopped after ${MAX_REPAIRS} failed attempts. The last failure was ${toolName}: ${outcome.error?.message ?? "unknown"}`,
                  recoverable: true,
                });
                return;
              }
              setState(task, "REPAIRING", `Recovering from a failed ${toolName}`);
            }

            messages.push({
              role: "tool",
              tool_call_id: call.id,
              content: JSON.stringify(outcome).slice(0, 24_000),
            });
          }
        }

        if (task.toolCalls >= budget && !finalText) {
          setState(task, "FAILED");
          send({
            type: "task.failed",
            taskId: task.id,
            error: `This task used its whole budget of ${budget} tool calls without finishing. The work done so far is kept — undo it in one step if you want to start over.`,
            recoverable: true,
          });
          return;
        }

        setState(task, "VERIFYING", "Checking the result");
        // Evidence-based verification (spec §133): the agent's own claim is
        // not enough — structure is re-checked independently at the end.
        const validationArguments = {
          includeLicenses: false,
          requireSubstance: task.requiresPlayableCompletion,
          ...(task.requiresPlayableCompletion ? {
            completionEvidence: {
              runtimeBooted: task.runtimeBooted,
              smokeTestPassed: task.smokeTestPassed,
              noCriticalRuntimeErrors: task.noCriticalRuntimeErrors,
            },
          } : {}),
        };
        let validation = await callTool(task, "project.validate", validationArguments, "Final structural and playability check");
        let validationData = validation.result as { data?: { valid?: boolean; errors?: { message: string }[]; completionGate?: { complete?: boolean; missing?: string[] } } } | undefined;
        let structuralErrors = validationData?.data?.errors ?? [];
        let completionGate = validationData?.data?.completionGate;
        let verified = validation.ok && structuralErrors.length === 0 && (!task.requiresPlayableCompletion || completionGate?.complete === true);

        if (!verified && structuralErrors.length && task.effort !== "FAST" && task.repairs < MAX_REPAIRS) {
          setState(task, "REPAIRING", "Fixing what validation found");
          messages.push({
            role: "user",
            content: `The final validation found problems that must be fixed before this is done:\n${structuralErrors.slice(0, 8).map((issue) => `- ${issue.message}`).join("\n")}\nFix them now, then reply with a short summary.`,
          });
          task.repairs += 1;
          const repair = await provider.generate({ messages, tools });
          for (const call of repair.message.tool_calls ?? []) {
            task.toolCalls += 1;
            const args = parseModelJson<Record<string, unknown>>(call.function.arguments ?? "{}") ?? {};
            const outcome = await callTool(task, call.function.name, args);
            messages.push({ role: "assistant", content: null, tool_calls: [call] });
            messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(outcome).slice(0, 12_000) });
          }
          finalText = repair.message.content?.trim() || finalText;
          validation = await callTool(task, "project.validate", validationArguments, "Re-check after repair");
          validationData = validation.result as { data?: { valid?: boolean; errors?: { message: string }[]; completionGate?: { complete?: boolean; missing?: string[] } } } | undefined;
          structuralErrors = validationData?.data?.errors ?? [];
          completionGate = validationData?.data?.completionGate;
          verified = validation.ok && structuralErrors.length === 0 && (!task.requiresPlayableCompletion || completionGate?.complete === true);
        }

        if (!verified) {
          const missing = completionGate?.missing?.length ? ` Missing: ${completionGate.missing.join("; ")}.` : "";
          setState(task, "FAILED");
          send({
            type: "task.failed",
            taskId: task.id,
            error: `The task was not marked complete because independent verification failed.${missing}`,
            recoverable: true,
          });
          return;
        }

        if (!finalText) {
          const closing = await provider.generate({
            messages: [...messages, { role: "user", content: "Summarise in two sentences what you changed and what the player can now do. No headings, no tool names." }],
          });
          finalText = closing.message.content?.trim() ?? "The requested changes were applied.";
        }

        setState(task, "COMMITTING");
        setState(task, "COMPLETE");
        send({
          type: "task.complete",
          taskId: task.id,
          summary: finalText || (lastFailure ? `Finished with one unresolved problem in ${lastFailure.tool}: ${lastFailure.message}` : "Done."),
          verified,
          toolCalls: task.toolCalls,
          repairs: task.repairs,
        });
      } catch (error) {
        setState(task, "FAILED");
        send({
          type: "task.failed",
          taskId: task.id,
          error: error instanceof Error ? error.message : String(error),
          recoverable: true,
        });
      } finally {
        for (const pending of task.pending.values()) clearTimeout(pending.timer);
        task.pending.clear();
        tasks.delete(task.id);
      }
    }

    /** Ask the model for a structured plan; a bad plan is skipped, not fatal. */
    async function makePlan(task: Task, messages: ChatMessage[]): Promise<ChangePlan | null> {
      try {
        const choice = await provider.generate({
          messages: [
            ...messages,
            {
              role: "user",
              content: `Before touching anything, output ONLY a JSON object planning this work:
{"goal":"...","successCriteria":["..."],"steps":[{"tool":"scene.generate","intent":"..."}]}
Use real tool names from your tool list. Keep it to at most ${task.effort === "DEEP" ? 10 : 5} steps. No prose.`,
            },
          ],
          temperature: 0.1,
          maxTokens: 800,
        });
        const raw = choice.message.content ?? "";
        const parsed = parseModelJson<ChangePlan>(raw);
        if (!parsed || !Array.isArray(parsed.steps) || !parsed.steps.length) return null;
        return {
          goal: String(parsed.goal ?? task.request).slice(0, 300),
          successCriteria: (parsed.successCriteria ?? []).slice(0, 10).map((entry) => String(entry).slice(0, 200)),
          steps: parsed.steps.slice(0, 12).map((step, index) => ({
            id: `step-${index + 1}`,
            tool: String(step.tool ?? "unknown"),
            intent: String(step.intent ?? "").slice(0, 200),
          })),
        };
      } catch {
        // Planning is an optimisation. If it fails, execute directly.
        return null;
      }
    }

    ws.on("message", (raw) => {
      let message: ClientMessage;
      try {
        message = JSON.parse(String(raw)) as ClientMessage;
      } catch {
        return;
      }

      switch (message.type) {
        case "task.start": {
          if (tasks.has(message.taskId)) return;
          const effort = message.effort ?? classifyEffort(message.request);
          const task = new Task(message.taskId, message.projectId, message.request, effort, message.context ?? {});
          tasks.set(task.id, task);
          send({ type: "task.accepted", taskId: task.id, effort });
          void runTask(task);
          break;
        }
        case "task.cancel": {
          const task = tasks.get(message.taskId);
          if (!task) return;
          task.cancelled = true;
          for (const [requestId, pending] of task.pending) {
            clearTimeout(pending.timer);
            pending.resolve({ ok: false, error: { code: "CANCELLED", message: "The task was cancelled." } });
            task.pending.delete(requestId);
          }
          break;
        }
        case "task.pause": {
          const task = tasks.get(message.taskId);
          if (task) {
            task.paused = true;
            send({ type: "task.state", taskId: task.id, state: "PAUSED" });
          }
          break;
        }
        case "task.resume": {
          const task = tasks.get(message.taskId);
          if (task) task.paused = false;
          break;
        }
        case "tool.result": {
          const task = tasks.get(message.taskId);
          const pending = task?.pending.get(message.requestId);
          if (!task || !pending) return;
          clearTimeout(pending.timer);
          task.pending.delete(message.requestId);
          pending.resolve({ ok: message.ok, result: message.result, error: message.error });
          break;
        }
        default:
          break;
      }
    });

    ws.on("close", () => {
      for (const task of tasks.values()) {
        task.cancelled = true;
        for (const pending of task.pending.values()) clearTimeout(pending.timer);
        task.pending.clear();
      }
      tasks.clear();
    });
  });

  return wss;
}

export { classifyEffort };
