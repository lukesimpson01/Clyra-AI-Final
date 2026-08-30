/**
 * Single source of truth for which AI providers/models are actually
 * configured and what they can do. Every provider block in server.ts
 * currently re-reads `process.env.DEEPSEEK_MODEL || "deepseek-v4-flash"`
 * (or the Gemini equivalent) independently — this consolidates that
 * resolution so routing decisions are based on real, current configuration
 * rather than assumptions, and so a missing key produces one clear error
 * instead of N slightly different ones.
 *
 * Only Gemini and DeepSeek are modeled — Clyra does not assume other paid
 * providers are available.
 */

export type ModelCapability =
  | "fast-text"
  | "deep-reasoning"
  | "coding"
  | "image-understanding"
  | "audio"
  | "long-context"
  | "tool-calling";

export type ProviderId = "deepseek" | "gemini";

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
    capabilities: DEEPSEEK_CAPABILITIES,
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

/** What's actually configured right now — read fresh each call, never cached,
 * since env vars can change between a dev server restart and this process. */
export function getConfiguredProviders(): ProviderConfig[] {
  return [deepseekConfig(), geminiConfig()].filter((config): config is ProviderConfig => config !== null);
}

export class NoProviderAvailableError extends Error {
  constructor(capability: ModelCapability) {
    super(
      `No configured provider supports "${capability}". Clyra only routes to Gemini and DeepSeek — ` +
        `check that DEEPSEEK_API_KEY or GEMINI_API_KEY is set in .env.local.`,
    );
    this.name = "NoProviderAvailableError";
  }
}

/**
 * Pick a provider for the requested capability. DeepSeek is preferred for
 * everything it supports (cheaper, and it's Clyra's primary text/coding
 * provider) — Gemini is only selected for capabilities DeepSeek doesn't
 * have configured here (image/audio understanding), matching the intended
 * routing philosophy: don't pay for Gemini on plain text DeepSeek can do.
 */
export function selectProvider(capability: ModelCapability): ProviderConfig {
  const configured = getConfiguredProviders();
  const deepseek = configured.find((config) => config.provider === "deepseek" && config.capabilities.includes(capability));
  if (deepseek) return deepseek;
  const gemini = configured.find((config) => config.provider === "gemini" && config.capabilities.includes(capability));
  if (gemini) return gemini;
  throw new NoProviderAvailableError(capability);
}
