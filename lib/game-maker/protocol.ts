/**
 * The full-duplex AI protocol (spec §64).
 *
 * Tools run in the BROWSER (they touch the live editor scene and the
 * sandboxed runtime), while the model runs on the SERVER (where the API key
 * is). So the server must be able to call back into the browser mid-turn,
 * which is why this is a WebSocket and not a request/response endpoint.
 *
 *   browser --task.start-->  server
 *   browser <--tool.request-- server
 *   browser --tool.result-->  server
 *   browser <--task.status--- server   (repeats)
 *   browser <--task.complete-- server
 */

export type AgentState =
  | "IDLE"
  | "RECEIVING"
  | "GROUNDING"
  | "RETRIEVING"
  | "PLANNING"
  | "PLAN_VALIDATION"
  | "CHECKPOINTING"
  | "EXECUTING"
  | "BUILDING"
  | "VALIDATING"
  | "PLAYTESTING"
  | "PROFILING"
  | "VERIFYING"
  | "REPAIRING"
  | "COMMITTING"
  | "COMPLETE"
  | "FAILED"
  | "CANCELLED"
  | "PAUSED"
  | "WAITING_APPROVAL";

export type EffortLevel = "FAST" | "STANDARD" | "DEEP";

export interface ChangePlanStep {
  id: string;
  tool: string;
  intent: string;
  arguments?: Record<string, unknown>;
}

export interface ChangePlan {
  goal: string;
  successCriteria: string[];
  steps: ChangePlanStep[];
}

/* ---------------- browser → server ---------------- */

export type ClientMessage =
  | {
      type: "task.start";
      taskId: string;
      projectId: string;
      request: string;
      effort?: EffortLevel;
      /** The frozen ContextFrame plus a compact project brief. */
      context: Record<string, unknown>;
    }
  | { type: "task.cancel"; taskId: string }
  | { type: "task.pause"; taskId: string }
  | { type: "task.resume"; taskId: string }
  | { type: "tool.result"; taskId: string; requestId: string; ok: boolean; result?: unknown; error?: { code: string; message: string; retryable: boolean; hint?: string } }
  | { type: "approval.result"; taskId: string; requestId: string; approved: boolean };

/* ---------------- server → browser ---------------- */

export type ServerMessage =
  | { type: "task.accepted"; taskId: string; effort: EffortLevel }
  | { type: "task.state"; taskId: string; state: AgentState; detail?: string }
  | { type: "plan.created"; taskId: string; plan: ChangePlan }
  | { type: "tool.request"; taskId: string; requestId: string; tool: string; arguments: Record<string, unknown>; intent?: string }
  | { type: "approval.request"; taskId: string; requestId: string; tool: string; summary: string }
  | { type: "task.message"; taskId: string; text: string }
  | { type: "task.complete"; taskId: string; summary: string; verified: boolean; toolCalls: number; repairs: number }
  | { type: "task.failed"; taskId: string; error: string; recoverable: boolean }
  | { type: "task.cancelled"; taskId: string };
