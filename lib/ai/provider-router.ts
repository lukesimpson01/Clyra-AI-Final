/**
 * Provider-agnostic, non-streaming chat completion with real retries,
 * exponential backoff, timeouts, a circuit breaker, and cancellation.
 *
 * Scope: single-shot JSON completions (study answers, script generation,
 * scoring, extraction) — anywhere that currently does a bare `await
 * fetch(...)` to DeepSeek with no retry logic at all. This intentionally
 * does NOT wrap the streaming chat proxy (/api/deepseek/chat and friends):
 * those stream raw SSE bytes straight through to a client that parses them
 * incrementally, and retrying a partially-streamed response transparently
 * isn't a sound operation — an interrupted stream is better retried by the
 * user (Clyra's chat composer already supports stopping and resending).
 */
import { selectProviders, type ModelCapability, type ProviderConfig } from "./model-capability-registry";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatCompletionRequest {
  capability: ModelCapability;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  responseFormat?: "json_object";
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface ChatCompletionResult {
  text: string;
  provider: ProviderConfig["provider"];
  model: string;
  usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number };
  attempts: number;
}

const MAX_ATTEMPTS = 3;
const BASE_BACKOFF_MS = 500;

// One breaker per provider, shared across requests in this process. Not
// persisted — a process restart resets it, which is the right behavior for
// a transient upstream-health signal.
const breakers = new Map<string, { openUntil: number; consecutiveFailures: number }>();
const BREAKER_TRIP_THRESHOLD = 4;
const BREAKER_OPEN_MS = 30_000;

class CircuitOpenError extends Error {
  constructor(provider: string) {
    super(`${provider} has failed repeatedly and is temporarily paused. Try again shortly.`);
    this.name = "CircuitOpenError";
  }
}

function breakerFor(key: string) {
  let state = breakers.get(key);
  if (!state) {
    state = { openUntil: 0, consecutiveFailures: 0 };
    breakers.set(key, state);
  }
  return state;
}

function recordSuccess(key: string) {
  const state = breakerFor(key);
  state.consecutiveFailures = 0;
  state.openUntil = 0;
}

function recordFailure(key: string) {
  const state = breakerFor(key);
  state.consecutiveFailures += 1;
  if (state.consecutiveFailures >= BREAKER_TRIP_THRESHOLD) {
    state.openUntil = Date.now() + BREAKER_OPEN_MS;
  }
}

function assertBreakerClosed(key: string) {
  const state = breakerFor(key);
  if (state.openUntil > Date.now()) throw new CircuitOpenError(key);
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

async function sleep(ms: number, signal?: AbortSignal) {
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    }, { once: true });
  });
}

function buildDeepseekBody(config: ProviderConfig, request: ChatCompletionRequest) {
  // Reasoning consumes max_tokens before any visible content is emitted —
  // a low token budget on a "deep-reasoning" request can starve the model
  // out before it reaches an answer, exactly like the raw fetch calls this
  // module replaces used to. Only enable it when actually requested.
  const thinkingEnabled = request.capability === "deep-reasoning";
  return {
    url: `${config.baseUrl}/chat/completions`,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.apiKey}` },
    body: JSON.stringify({
      model: config.model,
      messages: request.messages,
      temperature: request.temperature ?? 0.5,
      max_tokens: request.maxTokens ?? 2_000,
      thinking: { type: thinkingEnabled ? "enabled" : "disabled" },
      ...(request.responseFormat ? { response_format: { type: request.responseFormat } } : {}),
    }),
  };
}

function parseDeepseekResponse(payload: any): { text: string; usage?: ChatCompletionResult["usage"] } {
  const message = payload?.choices?.[0]?.message;
  // Defensive fallback for a reasoning-capable model that emits its answer
  // in reasoning_content when content ends up empty (e.g. cut off by
  // max_tokens before it reached the final answer segment).
  const text = String(message?.content || message?.reasoning_content || "");
  const usage = payload?.usage
    ? {
        promptTokens: payload.usage.prompt_tokens,
        completionTokens: payload.usage.completion_tokens,
        totalTokens: payload.usage.total_tokens,
      }
    : undefined;
  return { text, usage };
}

function buildGeminiBody(config: ProviderConfig, request: ChatCompletionRequest) {
  const systemMessages = request.messages.filter((message) => message.role === "system");
  const turnMessages = request.messages.filter((message) => message.role !== "system");
  return {
    url: `${config.baseUrl}/models/${config.model}:generateContent?key=${config.apiKey}`,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...(systemMessages.length ? { systemInstruction: { parts: [{ text: systemMessages.map((message) => message.content).join("\n\n") }] } } : {}),
      contents: turnMessages.map((message) => ({
        role: message.role === "assistant" ? "model" : "user",
        parts: [{ text: message.content }],
      })),
      generationConfig: {
        temperature: request.temperature ?? 0.5,
        maxOutputTokens: request.maxTokens ?? 2_000,
        ...(request.responseFormat === "json_object" ? { responseMimeType: "application/json" } : {}),
      },
    }),
  };
}

function parseGeminiResponse(payload: any): { text: string; usage?: ChatCompletionResult["usage"] } {
  const text = String(payload?.candidates?.[0]?.content?.parts?.map((part: any) => part.text).join("") || "");
  const usage = payload?.usageMetadata
    ? {
        promptTokens: payload.usageMetadata.promptTokenCount,
        completionTokens: payload.usageMetadata.candidatesTokenCount,
        totalTokens: payload.usageMetadata.totalTokenCount,
      }
    : undefined;
  return { text, usage };
}

function buildOllamaBody(config: ProviderConfig, request: ChatCompletionRequest) {
  return {
    url: `${config.baseUrl}/api/chat`,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: config.model,
      messages: request.messages,
      stream: false,
      options: {
        temperature: request.temperature ?? 0.5,
        num_predict: request.maxTokens ?? 2_000,
      },
      ...(request.responseFormat === "json_object" ? { format: "json" } : {}),
    }),
  };
}

function parseOllamaResponse(payload: any): { text: string; usage?: ChatCompletionResult["usage"] } {
  const promptTokens = Number(payload?.prompt_eval_count);
  const completionTokens = Number(payload?.eval_count);
  const hasUsage = Number.isFinite(promptTokens) || Number.isFinite(completionTokens);
  return {
    text: String(payload?.message?.content || ""),
    usage: hasUsage
      ? {
          ...(Number.isFinite(promptTokens) ? { promptTokens } : {}),
          ...(Number.isFinite(completionTokens) ? { completionTokens } : {}),
          totalTokens: (Number.isFinite(promptTokens) ? promptTokens : 0) + (Number.isFinite(completionTokens) ? completionTokens : 0),
        }
      : undefined,
  };
}

function requestForProvider(config: ProviderConfig, request: ChatCompletionRequest) {
  if (config.provider === "deepseek") return buildDeepseekBody(config, request);
  if (config.provider === "gemini") return buildGeminiBody(config, request);
  return buildOllamaBody(config, request);
}

function parseProviderResponse(config: ProviderConfig, payload: any) {
  if (config.provider === "deepseek") return parseDeepseekResponse(payload);
  if (config.provider === "gemini") return parseGeminiResponse(payload);
  return parseOllamaResponse(payload);
}

/**
 * Run a single-shot chat completion against one configured provider, with
 * retries/backoff/timeout/circuit breaking. The outer router may then try a
 * configured provider with the same capability; it never substitutes an
 * unrelated modality.
 */
async function completeWithProvider(config: ProviderConfig, request: ChatCompletionRequest): Promise<ChatCompletionResult> {
  const breakerKey = `${config.provider}:${config.model}`;
  assertBreakerClosed(breakerKey);
  const { url, headers, body } = requestForProvider(config, request);

  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    if (request.signal?.aborted) throw new DOMException("Aborted", "AbortError");
    const timeoutController = new AbortController();
    const timeout = setTimeout(() => timeoutController.abort(), request.timeoutMs ?? 20_000);
    const onOuterAbort = () => timeoutController.abort();
    request.signal?.addEventListener("abort", onOuterAbort, { once: true });

    try {
      const response = await fetch(url, { method: "POST", headers, body, signal: timeoutController.signal });
      if (!response.ok) {
        const detail = await response.text().catch(() => response.statusText);
        if (isRetryableStatus(response.status) && attempt < MAX_ATTEMPTS) {
          lastError = new Error(`${config.provider} returned ${response.status}: ${detail.slice(0, 300)}`);
          await sleep(BASE_BACKOFF_MS * 2 ** (attempt - 1), request.signal);
          continue;
        }
        recordFailure(breakerKey);
        throw new Error(`${config.provider} returned ${response.status}: ${detail.slice(0, 300)}`);
      }
      const payload = await response.json();
      const parsed = parseProviderResponse(config, payload);
      if (!parsed.text.trim()) throw new Error(`${config.provider} returned an empty completion`);
      recordSuccess(breakerKey);
      return { ...parsed, provider: config.provider, model: config.model, attempts: attempt };
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError" && request.signal?.aborted) {
        throw error; // user-initiated cancellation — never retry
      }
      lastError = error;
      if (attempt < MAX_ATTEMPTS) {
        await sleep(BASE_BACKOFF_MS * 2 ** (attempt - 1), request.signal);
        continue;
      }
      recordFailure(breakerKey);
    } finally {
      clearTimeout(timeout);
      request.signal?.removeEventListener("abort", onOuterAbort);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`${config.provider} request failed after ${MAX_ATTEMPTS} attempts`);
}

/**
 * Complete with the best configured provider, then use another *configured*
 * provider only when the first one genuinely fails. Local Ollama is opt-in;
 * no install, model pull, or cloud-to-local data transfer happens implicitly.
 */
export async function chatComplete(request: ChatCompletionRequest): Promise<ChatCompletionResult> {
  const candidates = selectProviders(request.capability);
  const failures: string[] = [];
  for (const config of candidates) {
    if (request.signal?.aborted) throw new DOMException("Aborted", "AbortError");
    try {
      return await completeWithProvider(config, request);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError" && request.signal?.aborted) throw error;
      failures.push(`${config.provider}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  throw new Error(`All configured providers failed for ${request.capability}. ${failures.join(" | ")}`);
}
