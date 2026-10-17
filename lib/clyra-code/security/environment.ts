/**
 * Environment security for Clyra Code.
 *
 * Two different questions are kept apart:
 *   - PROCESS MAY NEED A VALUE: a child process can legitimately receive a
 *     variable, such as PATH for a compiler or a key for the model runtime.
 *   - MODEL MAY SEE A VALUE: the model and the transcript should never receive a
 *     secret value or a DSH_* runtime fact.
 *
 * `createProcessEnvironment` answers the first question. `sanitizeToolOutputForModel`
 * answers the second, and every tool result must pass through it before it is stored,
 * published or sent back to a model.
 */

export type EnvClassification = "public" | "sensitive" | "harness-internal";

/** Name fragments treated as sensitive by default. Project-defined patterns extend this list. */
const SENSITIVE_NAME = [
  /TOKEN/i,
  /SECRET/i,
  /PASSWORD/i,
  /PASSWD/i,
  /API_?KEY/i,
  /ACCESS_?KEY/i,
  /CLIENT_?SECRET/i,
  /AUTH/i,
  /CREDENTIAL/i,
  /PRIVATE/i,
  /CERT/i,
  /SIGNING/i,
  /COOKIE/i,
  /SESSION/i,
  /(^|_)KEYS?($|_)/i,
];

/** Runtime facts owned by the DeepSeek harness. Never model-visible, even when the value looks harmless. */
const HARNESS_PREFIX = /^DSH_/i;

/**
 * `PWD` is the shell's working directory, not a credential. It matches no
 * sensitive pattern, so it is listed here only to document the deliberate exception.
 */
const NOT_SENSITIVE = new Set(["PWD", "OLDPWD"]);

/** Shortest value that is redacted. Shorter values would redact ordinary text. */
const MIN_SENSITIVE_VALUE = 6;
const MIN_HARNESS_VALUE = 4;

export const REDACTED_SECRET = "[REDACTED_SECRET]";
export const REDACTED_RUNTIME_FACT = "[REDACTED_RUNTIME_FACT]";

export function classifyEnvKey(name: string, extraPatterns: RegExp[] = []): EnvClassification {
  if (HARNESS_PREFIX.test(name)) return "harness-internal";
  if (NOT_SENSITIVE.has(name.toUpperCase())) return "public";
  if (SENSITIVE_NAME.some((pattern) => pattern.test(name)) || extraPatterns.some((pattern) => pattern.test(name))) {
    return "sensitive";
  }
  return "public";
}

export function isSensitiveEnvKey(name: string, extraPatterns: RegExp[] = []): boolean {
  return classifyEnvKey(name, extraPatterns) !== "public";
}

export type ProcessEnvironmentPolicy = {
  /** The environment to start from. Defaults to the live process environment. */
  base?: NodeJS.ProcessEnv;
  /** Names a process is allowed to receive even though they are sensitive, such as the model key for the runtime. */
  forward?: readonly string[];
  /** Project-defined sensitive name patterns. */
  extraPatterns?: RegExp[];
};

/**
 * Builds the environment a child process receives. Sensitive and harness-internal
 * variables are removed unless the policy forwards them by name. Everything else,
 * including PATH, HOME, TMPDIR, LANG and SHELL, is kept so builds keep working.
 */
export function createProcessEnvironment(policy: ProcessEnvironmentPolicy = {}): NodeJS.ProcessEnv {
  const base = policy.base ?? process.env;
  const forward = new Set((policy.forward ?? []).map((name) => name.toUpperCase()));
  const env: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(base)) {
    if (value === undefined) continue;
    if (forward.has(name.toUpperCase())) {
      env[name] = value;
      continue;
    }
    if (isSensitiveEnvKey(name, policy.extraPatterns) || HARNESS_PREFIX.test(name)) continue;
    env[name] = value;
  }
  return env;
}

/**
 * The local registry of values that must never reach a model or a transcript.
 * It is derived from the live environment on every call, so variables set after
 * startup are covered too. The registry is never sent to the renderer or a model.
 */
export function localSecretRegistry(env: NodeJS.ProcessEnv = process.env, extraPatterns: RegExp[] = []) {
  const sensitive: string[] = [];
  const harness: string[] = [];
  for (const [name, value] of Object.entries(env)) {
    if (!value) continue;
    if (HARNESS_PREFIX.test(name)) {
      if (value.length >= MIN_HARNESS_VALUE) harness.push(value);
    } else if (isSensitiveEnvKey(name, extraPatterns) && value.length >= MIN_SENSITIVE_VALUE) {
      // A path, socket or directory is not a credential. Matching it as a secret
      // would redact ordinary paths wherever they appear in output.
      if (isPathLike(value)) continue;
      sensitive.push(value);
    }
  }
  // Longest first, so a value that contains another is replaced whole.
  sensitive.sort((a, b) => b.length - a.length);
  harness.sort((a, b) => b.length - a.length);
  return { sensitive, harness };
}

// A runtime-fact assignment runs to the end of its line, because the value of
// DSH_SESSION_JSONL can contain spaces. Otherwise a fragment of the path leaks.
const ASSIGNMENT_HARNESS = /\b(DSH_[A-Z0-9_]+)=[^\r\n]*/gi;
// The lookahead keeps an already-redacted placeholder from being matched again,
// since a placeholder's name can itself contain a sensitive fragment.
const ASSIGNMENT_SECRET = /\b([A-Z][A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|PASSWD|APIKEY|API_KEY|ACCESS_KEY|CREDENTIAL|PRIVATE|CERT|SIGNING|COOKIE|SESSION|AUTH|KEY)[A-Z0-9_]*)=(?!\[REDACTED_)(?:"[^"\n]*"|'[^'\n]*'|[^\s"']+)/g;
const KEY_SHAPED = /\b(?:sk|rk|pk)[-_][A-Za-z0-9_-]{12,}/g;

function isPathLike(value: string): boolean {
  return value.startsWith("/") || value.startsWith("\\\\") || /^[A-Za-z]:[\\/]/.test(value);
}

/**
 * Redacts a string before it is shown to a model or stored. Values are removed
 * first, then assignments with sensitive names, then key-shaped literals.
 * Variable names remain visible, because "present" or "missing" is a safe answer.
 */
export function sanitizeToolOutputForModel(text: string, env: NodeJS.ProcessEnv = process.env, extraPatterns: RegExp[] = []): string {
  if (!text) return text;
  const registry = localSecretRegistry(env, extraPatterns);
  let out = text;
  for (const value of registry.sensitive) out = out.split(value).join(REDACTED_SECRET);
  for (const value of registry.harness) out = out.split(value).join(REDACTED_RUNTIME_FACT);
  out = out.replace(ASSIGNMENT_HARNESS, (_match, name: string) => `${name}=${REDACTED_RUNTIME_FACT}`);
  out = out.replace(ASSIGNMENT_SECRET, (_match, name: string) => `${name}=${REDACTED_SECRET}`);
  out = out.replace(KEY_SHAPED, REDACTED_SECRET);
  return out;
}

/** Sanitises every string inside a structured tool payload. Keys and structure are kept. */
export function sanitizeToolPayloadForModel<T>(value: T, env: NodeJS.ProcessEnv = process.env, extraPatterns: RegExp[] = []): T {
  if (typeof value === "string") return sanitizeToolOutputForModel(value, env, extraPatterns) as T;
  if (Array.isArray(value)) return value.map((item) => sanitizeToolPayloadForModel(item, env, extraPatterns)) as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      out[key] = sanitizeToolPayloadForModel(item, env, extraPatterns);
    }
    return out as T;
  }
  return value;
}

export type EnvPresence = "present" | "missing";

/**
 * Safe answer to "is this variable set?". Returns presence only, never the value.
 * This is the capability the agent uses instead of listing the environment.
 */
export function environmentVariableStatus(names: readonly string[], env: NodeJS.ProcessEnv = process.env): Record<string, EnvPresence> {
  const status: Record<string, EnvPresence> = {};
  for (const name of names) {
    if (!/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(name)) continue;
    status[name] = env[name] !== undefined && env[name] !== "" ? "present" : "missing";
  }
  return status;
}
