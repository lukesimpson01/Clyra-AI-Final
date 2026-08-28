/** Clyra-native lifecycle envelopes: stable item IDs update in place. */
export type ClyraV3EventType = "run.started" | "run.completed" | "run.failed" | "run.interrupted" | "phase.started" | "phase.completed" | "tool.started" | "tool.progress" | "tool.completed" | "tool.failed" | "diff.updated" | "usage.updated" | "user.question" | "approval.requested";
export type ClyraV3Event<T extends Record<string, unknown> = Record<string, unknown>> = {
  id: string;
  runId: string;
  itemId?: string;
  type: ClyraV3EventType;
  timestamp: number;
  payload: T;
};

export function v3Event<T extends Record<string, unknown>>(input: Omit<ClyraV3Event<T>, "timestamp"> & { timestamp?: number }): ClyraV3Event<T> {
  return { ...input, timestamp: input.timestamp ?? Date.now() };
}
