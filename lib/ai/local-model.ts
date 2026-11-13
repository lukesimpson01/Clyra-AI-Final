/**
 * Local model fallback. When Ollama is running, Clyra finds a small, capable
 * instruct model on its own and uses it whenever the cloud account is out of
 * credits or unreachable, for chat, notes, tools and voice. Nothing to set up:
 * an explicit CLYRA_OLLAMA_MODEL still wins, and CLYRA_LOCAL_LLM_ENABLED=false turns it off.
 */
const HOST = () => String(process.env.OLLAMA_HOST || "http://127.0.0.1:11434").replace(/\/$/, "");

/** Best first. Small instruct models that answer quickly on a laptop; vision-only and embedding models are skipped. */
const PREFERENCE: RegExp[] = [
  /^qwen3:(?:4b|8b)/, /^qwen2\.5:(?:3b|7b)(?!.*coder)/, /^llama3\.[123]:(?:3b|8b)/, /^gemma3:(?:4b|12b)/,
  /^phi4-mini/, /^phi4/, /^mistral/, /^gemma3/, /^llama3/, /^qwen/, /^phi3(?!.*llava)/, /^deepseek-r1:(?:7b|8b)/,
];
const SKIP = /llava|embed|vision|clip|rerank|whisper|tts|moondream|bakllava/i;

export function pickLocalModel(names: string[]): string | null {
  const usable = names.filter((name) => !SKIP.test(name));
  for (const pattern of PREFERENCE) {
    const hit = usable.find((name) => pattern.test(name));
    if (hit) return hit;
  }
  return usable[0] ?? null;
}

let detected: string | null = null;
let checkedAt = 0;
let inFlight: Promise<void> | null = null;

/** Refreshes in the background (at most every 45 s); callers read the last answer synchronously. */
export function refreshLocalModel(): Promise<void> {
  if (process.env.CLYRA_LOCAL_LLM_ENABLED === "false") { detected = null; return Promise.resolve(); }
  if (inFlight || Date.now() - checkedAt < 45_000) return inFlight ?? Promise.resolve();
  checkedAt = Date.now();
  inFlight = fetch(`${HOST()}/api/tags`, { signal: AbortSignal.timeout(1500) })
    .then(async (response) => {
      if (!response.ok) { detected = null; return; }
      const data = await response.json() as { models?: Array<{ name?: string }> };
      detected = pickLocalModel((data.models ?? []).map((model) => String(model.name || "")).filter(Boolean));
    })
    .catch(() => { detected = null; })
    .finally(() => { inFlight = null; });
  return inFlight;
}

/** The model Clyra can fall back to right now, or null. Cheap enough to call on every request. */
export function detectedLocalModel(): string | null {
  void refreshLocalModel();
  return detected;
}

void refreshLocalModel();
