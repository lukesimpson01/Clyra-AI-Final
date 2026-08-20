export type AgentRunState =
  | "IDLE"
  | "PREPARING"
  | "OBSERVING"
  | "PLANNING"
  | "SEARCHING"
  | "READING"
  | "EDITING"
  | "EXECUTING"
  | "VERIFYING"
  | "WAITING_FOR_APPROVAL"
  | "WAITING_FOR_USER"
  | "RECOVERING"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED";

export type AgentEvent =
  | { type: "user.message"; id: string; text: string; timestamp: number }
  | { type: "run.started"; runId: string; sessionId: string; state: AgentRunState }
  | { type: "run.state"; runId: string; state: AgentRunState; label: string }
  | { type: "thinking.started"; id: string; summary: string }
  | { type: "thinking.delta"; id: string; delta: string }
  | { type: "thinking.completed"; id: string }
  | { type: "tool.started"; tool: string; callId: string; input: unknown }
  | { type: "tool.progress"; callId: string; data: unknown }
  | { type: "tool.completed"; callId: string; output: unknown; durationMs?: number }
  | { type: "tool.failed"; callId: string; error: string; durationMs?: number }
  | { type: "file.change.started"; path: string; callId: string }
  | { type: "file.change.completed"; path: string; callId: string }
  | { type: "command.started"; command: string; callId: string }
  | { type: "command.output"; callId: string; stream: "stdout" | "stderr"; text: string }
  | { type: "command.completed"; callId: string; exitCode: number }
  | { type: "plan.updated"; items: Array<{ id: string; title: string; status: string }> }
  | { type: "message.delta"; delta: string }
  | { type: "message.completed" }
  | { type: "run.completed"; runId: string }
  | { type: "run.failed"; runId: string; error: string }
  | { type: "run.cancelled"; runId: string };

export interface ToolResult<T> {
  success: boolean;
  data?: T;
  error?: { code: string; message: string };
  durationMs: number;
}

export interface ModelRequest {
  requestId: string;
  model: string;
  system?: string;
  messages: unknown[];
  tools?: unknown[];
  reasoningEffort?: string;
  signal?: AbortSignal;
}

export type ModelEvent =
  | { type: "text"; delta: string }
  | { type: "reasoning"; delta: string }
  | { type: "tool"; index: number; id: string; name?: string; argumentsDelta: string }
  | { type: "usage"; inputTokens: number; outputTokens: number; reasoningTokens?: number }
  | { type: "finish"; reason: "stop" | "tool_calls" | "length" | "error" };

export interface ModelProvider {
  stream(request: ModelRequest): AsyncIterable<ModelEvent>;
  complete(request: ModelRequest): Promise<{ text: string; events: ModelEvent[] }>;
  countTokens?(input: unknown): Promise<number>;
  abort(requestId: string): Promise<void>;
}
