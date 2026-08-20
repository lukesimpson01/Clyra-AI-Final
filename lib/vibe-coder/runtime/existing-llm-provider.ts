import {
  CallId,
  LlmAdapter,
  LlmError,
  ReasoningEffortId,
  type GenerateOptions,
  type LlmResolvedModelInfo,
  type StreamChunk,
} from "@deepseek-ai/dsh-llm";
import type { ModelEvent, ModelProvider, ModelRequest } from "./types";

type WireToolCall = { index?: number; id?: string; function?: { name?: string; arguments?: string } };
type WireChunk = {
  choices?: Array<{ delta?: { content?: string; reasoning_content?: string; tool_calls?: WireToolCall[] }; finish_reason?: string | null }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number; reasoning_tokens?: number };
  error?: { message?: string; code?: string };
};

function configuredModel() {
  return String(process.env.MY_LLM_MODEL || process.env.DEEPSEEK_MODEL || "deepseek-v4-flash").trim();
}

function connection() {
  const apiKey = String(process.env.MY_LLM_API_KEY || process.env.DEEPSEEK_API_KEY || "").trim();
  const baseUrl = String(process.env.MY_LLM_BASE_URL || process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com").replace(/\/$/, "");
  if (!apiKey) throw new LlmError("Clyra's existing model API is not configured.", "AUTH");
  return { apiKey, baseUrl };
}

function wireMessages(messages: unknown[]) {
  const result: Array<Record<string, unknown>> = [];
  for (const candidate of messages) {
    const message = candidate as { role?: string; content?: Array<Record<string, unknown>> };
    const blocks = Array.isArray(message.content) ? message.content : [];
    const toolResults = blocks.filter((block) => block.type === "tool-result");
    if (toolResults.length) {
      for (const block of toolResults) {
        const content = Array.isArray(block.content)
          ? block.content.map((item) => item.type === "text" ? String(item.text ?? "") : "").join("\n")
          : "";
        result.push({ role: "tool", tool_call_id: String(block.toolCallId ?? ""), content });
      }
      continue;
    }
    const content = blocks
      .filter((block) => block.type === "text")
      .map((block) => String(block.text ?? ""))
      .join("\n");
    const calls = blocks
      .filter((block) => block.type === "tool-call")
      .map((block) => ({
        id: String(block.id ?? ""),
        type: "function",
        function: { name: String(block.name ?? ""), arguments: String(block.arguments ?? "{}") },
      }));
    result.push({ role: message.role === "assistant" ? "assistant" : "user", content: content || null, ...(calls.length ? { tool_calls: calls } : {}) });
  }
  return result;
}

function finishReason(reason: string | null | undefined): ModelEvent & { type: "finish" } {
  if (reason === "tool_calls") return { type: "finish", reason: "tool_calls" };
  if (reason === "length") return { type: "finish", reason: "length" };
  return { type: "finish", reason: "stop" };
}

export class ExistingLLMProvider implements ModelProvider {
  private controllers = new Map<string, AbortController>();

  async *stream(request: ModelRequest): AsyncIterable<ModelEvent> {
    const { apiKey, baseUrl } = connection();
    const controller = new AbortController();
    this.controllers.set(request.requestId, controller);
    const signal = request.signal ? AbortSignal.any([request.signal, controller.signal]) : controller.signal;
    try {
      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        signal,
        body: JSON.stringify({
          model: request.model || configuredModel(),
          stream: true,
          stream_options: { include_usage: true },
          messages: [...(request.system ? [{ role: "system", content: request.system }] : []), ...wireMessages(request.messages)],
          tools: Array.isArray(request.tools) && request.tools.length
            ? request.tools.map((tool) => ({ type: "function", function: tool }))
            : undefined,
          reasoning_effort: request.reasoningEffort === "off" ? undefined : request.reasoningEffort,
        }),
      });
      if (!response.ok || !response.body) {
        const detail = await response.text().catch(() => "");
        throw new LlmError(`Model request failed (${response.status}): ${detail.slice(0, 500)}`, response.status === 401 ? "AUTH" : "TRANSPORT");
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        buffer += decoder.decode(value, { stream: !done });
        const frames = buffer.split(/\r?\n\r?\n/);
        buffer = frames.pop() ?? "";
        for (const frame of frames) {
          const data = frame.split(/\r?\n/).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim()).join("");
          if (!data || data === "[DONE]") continue;
          const payload = JSON.parse(data) as WireChunk;
          if (payload.error) throw new LlmError(payload.error.message || "Model stream failed.", payload.error.code || "PROVIDER");
          const delta = payload.choices?.[0]?.delta;
          if (delta?.reasoning_content) yield { type: "reasoning", delta: delta.reasoning_content };
          if (delta?.content) yield { type: "text", delta: delta.content };
          for (const call of delta?.tool_calls ?? []) {
            yield {
              type: "tool",
              index: call.index ?? 0,
              id: call.id ?? "",
              name: call.function?.name,
              argumentsDelta: call.function?.arguments ?? "",
            };
          }
          if (payload.usage) yield {
            type: "usage",
            inputTokens: payload.usage.prompt_tokens ?? 0,
            outputTokens: payload.usage.completion_tokens ?? 0,
            reasoningTokens: payload.usage.reasoning_tokens,
          };
          const finish = payload.choices?.[0]?.finish_reason;
          if (finish) yield finishReason(finish);
        }
        if (done) break;
      }
    } finally {
      this.controllers.delete(request.requestId);
    }
  }

  async complete(request: ModelRequest) {
    const events: ModelEvent[] = [];
    let text = "";
    for await (const event of this.stream(request)) {
      events.push(event);
      if (event.type === "text") text += event.delta;
    }
    return { text, events };
  }

  async countTokens(input: unknown) {
    return Math.ceil(JSON.stringify(input).length / 4);
  }

  async abort(requestId: string) {
    this.controllers.get(requestId)?.abort("user-cancelled");
  }
}

export class ExistingLLMAdapter extends LlmAdapter {
  constructor(private readonly provider: ExistingLLMProvider) { super(); }

  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({
      provider,
      id: model,
      name: model,
      context: { contextWindow: 128_000 },
      defaultMaxTokens: 16_384,
      reasoning: {
        efforts: ["off", "low", "high", "max"].map((id) => ({ id: ReasoningEffortId(id), name: id[0]!.toUpperCase() + id.slice(1) })),
        defaultEffort: ReasoningEffortId("high"),
      },
    });
  }

  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const requestId = `${String(options.sessionId ?? "request")}:${Date.now()}`;
    const blocks = new Map<number, { type: "text" | "reasoning" | "tool-call"; text: string; id?: string; name?: string }>();
    let usage: Extract<ModelEvent, { type: "usage" }> | undefined;
    let finish: Extract<ModelEvent, { type: "finish" }> | undefined;
    for await (const event of this.provider.stream({
      requestId,
      model: options.model,
      system: options.system,
      messages: options.messages,
      tools: options.tools,
      reasoningEffort: options.reasoningEffort,
      signal: options.signal,
    })) {
      if (event.type === "text" || event.type === "reasoning") {
        const index = event.type === "reasoning" ? 0 : blocks.has(0) && blocks.get(0)?.type === "reasoning" ? 1 : 0;
        if (!blocks.has(index)) {
          blocks.set(index, { type: event.type, text: "" });
          yield { type: "block-start", index, blockType: event.type };
        }
        blocks.get(index)!.text += event.delta;
        yield event.type === "text"
          ? { type: "text-delta", index, text: event.delta }
          : { type: "reasoning-delta", index, text: event.delta };
      } else if (event.type === "tool") {
        const index = 2 + event.index;
        if (!blocks.has(index)) {
          blocks.set(index, { type: "tool-call", text: "", id: event.id, name: event.name });
          yield { type: "block-start", index, blockType: "tool-call" };
        }
        const block = blocks.get(index)!;
        if (event.id) block.id = event.id;
        if (event.name) block.name = event.name;
        block.text += event.argumentsDelta;
        yield { type: "tool-call-delta", index, id: CallId(block.id || `call-${index}`), name: event.name, argumentsDelta: event.argumentsDelta };
      } else if (event.type === "usage") usage = event;
      else if (event.type === "finish") finish = event;
    }
    for (const [index, block] of [...blocks].sort(([a], [b]) => a - b)) {
      if (block.type === "tool-call") {
        yield { type: "block-end", index, block: { type: "tool-call", id: CallId(block.id || `call-${index}`), name: block.name || "unknown_tool", arguments: block.text || "{}" } };
      } else {
        yield { type: "block-end", index, block: { type: block.type, text: block.text } };
      }
    }
    yield { type: "usage", usage: { inputTokens: usage?.inputTokens ?? 0, outputTokens: usage?.outputTokens ?? 0, ...(usage?.reasoningTokens === undefined ? {} : { reasoningTokens: usage.reasoningTokens }) } };
    yield { type: "finish", reason: finish?.reason === "tool_calls" ? { kind: "tool-calls" } : finish?.reason === "length" ? { kind: "max-tokens" } : { kind: "stop" } };
  }
}

export function existingModelStatus() {
  try {
    connection();
    return { available: true as const, provider: "existing", model: configuredModel() };
  } catch (error) {
    return { available: false as const, error: error instanceof Error ? error.message : String(error) };
  }
}
