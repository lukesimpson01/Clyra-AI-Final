/**
 * Single source of truth for which AI providers/models are actually
 * configured and what they can do. Every provider block in server.ts
 * currently re-reads `process.env.DEEPSEEK_MODEL || "deepseek-v4-flash"`
 * (or the Gemini equivalent) independently — this consolidates that
 * resolution so routing decisions are based on real, current configuration
 * rather than assumptions, and so a missing key produces one clear error
 * instead of N slightly different ones.
 *
 * Cloud providers are optional. A locally-running Ollama instance can be
 * registered explicitly as a small, open-source fallback; Clyra never
 * downloads a model or starts a heavyweight runtime on a user's behalf.
 */

export type ModelCapability =
  | "fast-text"
  | "deep-reasoning"
  | "coding"
  | "image-understanding"
  | "audio"
  | "long-context"
  | "tool-calling";

export type ProviderId = "deepseek" | "gemini" | "ollama";

export interface ProviderConfig {
  provider: ProviderId;
  model: string;
  apiKey: string;
  baseUrl: string;
  capabilities: ModelCapability[];
}

const DEEPSEEK_CAPABILITIES: ModelCapability[] = [
  "fast-text",
  "deep-reasoning",
  "coding",
  "long-context",
  "tool-calling",
];

/**
 * DeepSeek Flash accepts image_url content in Chat Completions. Keep that
 * capability model-specific: a user may intentionally configure a text-only
 * DeepSeek model under the same provider key, and routing an image there
 * would create a misleading "vision" feature that cannot actually run.
 */
function deepseekCapabilities(model: string): ModelCapability[] {
  return /(?:^|[-_/])flash(?:$|[-_/])/i.test(model.trim())
    ? [...DEEPSEEK_CAPABILITIES, "image-understanding"]
    : DEEPSEEK_CAPABILITIES;
}

const GEMINI_TEXT_CAPABILITIES: ModelCapability[] = [
  "fast-text",
  "deep-reasoning",
  "long-context",
  "tool-calling",
];

const GEMINI_VISION_CAPABILITIES: ModelCapability[] = [
  ...GEMINI_TEXT_CAPABILITIES,
  "image-understanding",
  "audio",
];

const OLLAMA_CAPABILITIES: ModelCapability[] = [
  "fast-text",
  "deep-reasoning",
  "coding",
  "long-context",
];

function looksLikeRealKey(key: string | undefined): key is string {
  return Boolean(key) && key!.length >= 16 && !/test|dummy|example|placeholder/i.test(key!);
}

function deepseekConfig(): ProviderConfig | null {
  const apiKey = process.env.DEEPSEEK_API_KEY || process.env.MY_LLM_API_KEY;
  if (!looksLikeRealKey(apiKey)) return null;
  return {
    provider: "deepseek",
    model: process.env.DEEPSEEK_MODEL || process.env.MY_LLM_MODEL || "deepseek-v4-flash",
    apiKey,
    baseUrl: String(process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com").replace(/\/$/, ""),
    capabilities: deepseekCapabilities(process.env.DEEPSEEK_MODEL || process.env.MY_LLM_MODEL || "deepseek-v4-flash"),
  };
}

function geminiConfig(): ProviderConfig | null {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!looksLikeRealKey(apiKey)) return null;
  const visionModel = process.env.GEMINI_VISION_MODEL;
  return {
    provider: "gemini",
    model: visionModel || process.env.GEMINI_MODEL || "gemini-2.0-flash",
    apiKey,
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    capabilities: visionModel ? GEMINI_VISION_CAPABILITIES : GEMINI_TEXT_CAPABILITIES,
  };
}

/**
 * Opt-in local model support. Requiring an explicit model name avoids a
 * misleading "local fallback" that fails because no model was ever pulled.
 * Ollama's native API needs no API key and keeps prompts on this machine.
 */
function ollamaConfig(): ProviderConfig | null {
  const model = String(process.env.CLYRA_OLLAMA_MODEL || process.env.CLYRA_LOCAL_MODEL || "").trim();
  if (!model || process.env.CLYRA_LOCAL_LLM_ENABLED === "false") return null;
  return {
    provider: "ollama",
    model,
    apiKey: "",
    baseUrl: String(process.env.OLLAMA_HOST || "http://127.0.0.1:11434").replace(/\/$/, ""),
    capabilities: OLLAMA_CAPABILITIES,
  };
}

/** What's actually configured right now — read fresh each call, never cached,
 * since env vars can change between a dev server restart and this process. */
export function getConfiguredProviders(): ProviderConfig[] {
  return [deepseekConfig(), geminiConfig(), ollamaConfig()].filter((config): config is ProviderConfig => config !== null);
}

export class NoProviderAvailableError extends Error {
  constructor(capability: ModelCapability) {
    super(
      `No configured provider supports "${capability}". Set DEEPSEEK_API_KEY, GEMINI_API_KEY, ` +
        `or run Ollama locally and set CLYRA_OLLAMA_MODEL in .env.local.`,
    );
    this.name = "NoProviderAvailableError";
  }
}

/**
 * Pick the first provider for the requested capability. DeepSeek remains the
 * normal text/coding route and DeepSeek Flash covers image understanding;
 * Gemini remains a configured vision/audio fallback. An explicitly configured
 * local model may be preferred for privacy or cost with
 * CLYRA_PREFER_LOCAL_LLM=true.
 */
export function selectProvider(capability: ModelCapability): ProviderConfig {
  return selectProviders(capability)[0];
}

/** Ordered usable providers. The router can move to the next one after a
 * genuine upstream failure instead of claiming that one provider is Clyra. */
export function selectProviders(capability: ModelCapability): ProviderConfig[] {
  const configured = getConfiguredProviders().filter((config) => config.capabilities.includes(capability));
  const preferredLocal = process.env.CLYRA_PREFER_LOCAL_LLM === "true";
  const order: ProviderId[] = preferredLocal ? ["ollama", "deepseek", "gemini"] : ["deepseek", "gemini", "ollama"];
  const candidates = order.flatMap((provider) => configured.filter((config) => config.provider === provider));
  if (!candidates.length) throw new NoProviderAvailableError(capability);
  return candidates;
}
