/** Stable model contract. Harness orchestration stays independent of DeepSeek. */
export interface CodingModelProvider<TRequest = unknown, TResult = unknown> {
  readonly id: string;
  readonly supportsToolCalling: boolean;
  readonly supportsReasoning: boolean;
  readonly contextWindow?: number;
  readonly maxOutputTokens?: number;
  stream(request: TRequest, signal?: AbortSignal): AsyncIterable<TResult>;
  complete?(request: TRequest, signal?: AbortSignal): Promise<TResult>;
}
