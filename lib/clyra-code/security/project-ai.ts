/**
 * Clyra AI for apps built or imported in Vibe Coder.
 *
 * The real model key lives only in the server process. An app that needs an AI API gets a project-scoped
 * token and the address of Clyra's OpenAI-compatible proxy, never the key itself. The token can be revoked
 * by rotating CLYRA_AI_PROXY_SECRET, only works against the proxy, and is written to `.env.local`, which is
 * masked in the UI, excluded from exports and redacted from tool output.
 */
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

const TOKEN_PREFIX = "clyra_ai_";
/** Models an app may request through Clyra AI. Anything else is replaced by the default. */
export const CLYRA_AI_MODELS = ["deepseek-v4-flash", "deepseek-v4-pro"] as const;
export const CLYRA_AI_DEFAULT_MODEL = "deepseek-v4-flash";

function signingSecret(env: NodeJS.ProcessEnv = process.env): string | null {
  return env.CLYRA_AI_PROXY_SECRET || env.DEEPSEEK_API_KEY || env.MY_LLM_API_KEY || null;
}

export function clyraAiAvailable(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.DEEPSEEK_API_KEY || env.MY_LLM_API_KEY);
}

export function createProjectAiToken(projectId: string, env: NodeJS.ProcessEnv = process.env): string | null {
  const secret = signingSecret(env);
  if (!secret) return null;
  const sig = crypto.createHmac("sha256", secret).update(`clyra-ai:${projectId}`).digest("base64url").slice(0, 32);
  return `${TOKEN_PREFIX}${projectId}.${sig}`;
}

/** Returns the project id when the token is genuine, otherwise null. Comparison is constant-time. */
export function verifyProjectAiToken(token: string, env: NodeJS.ProcessEnv = process.env): string | null {
  if (!token.startsWith(TOKEN_PREFIX)) return null;
  const body = token.slice(TOKEN_PREFIX.length);
  const dot = body.lastIndexOf(".");
  if (dot < 1) return null;
  const projectId = body.slice(0, dot);
  const expected = createProjectAiToken(projectId, env);
  if (!expected) return null;
  const a = Buffer.from(expected);
  const b = Buffer.from(token);
  return a.length === b.length && crypto.timingSafeEqual(a, b) ? projectId : null;
}

/** Merge entries into `.env.local`, keeping every other line. Values are written verbatim and never logged. */
export async function writeProjectEnv(filesDir: string, entries: Record<string, string>): Promise<void> {
  const target = path.join(filesDir, ".env.local");
  let existing = "";
  try { existing = await fs.readFile(target, "utf8"); } catch { existing = ""; }
  const lines = existing.split(/\r?\n/);
  const remaining = new Map(Object.entries(entries));
  const out = lines.map((line) => {
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line);
    if (match && remaining.has(match[1])) {
      const value = remaining.get(match[1])!;
      remaining.delete(match[1]);
      return `${match[1]}=${value}`;
    }
    return line;
  }).filter((line, index, all) => !(line === "" && index === all.length - 1));
  for (const [key, value] of remaining) out.push(`${key}=${value}`);
  await fs.mkdir(filesDir, { recursive: true });
  await fs.writeFile(target, `${out.join("\n")}\n`, { encoding: "utf8", mode: 0o600 });
}

export function isDotenvPath(relativePath: string): boolean {
  const name = relativePath.split("/").pop() ?? "";
  return name === ".env" || name.startsWith(".env.");
}

/**
 * The Files workbench shows masked content. When it saves a dotenv file back, any value still masked is
 * restored from what is on disk so a harmless edit never overwrites a secret with its placeholder.
 */
export function restoreMaskedDotenv(existing: string, incoming: string, placeholder = "[REDACTED_SECRET]"): string {
  const known = new Map<string, string>();
  for (const line of existing.split(/\r?\n/)) {
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/.exec(line);
    if (match) known.set(match[1], match[2]);
  }
  return incoming.split(/\r?\n/).map((line) => {
    const match = /^(\s*(?:export\s+)?)([A-Za-z_][A-Za-z0-9_]*)(\s*=\s*)(.*)$/.exec(line);
    if (!match) return line;
    return match[4].includes(placeholder) && known.has(match[2]) ? `${match[1]}${match[2]}=${known.get(match[2])}` : line;
  }).join("\n");
}

export type ProjectAiConfig = { mode: "clyra" | "own" | null; hasKey: boolean };

/** What the UI may know: which mode is set and whether a key exists. Never a value. */
export async function readProjectAiConfig(filesDir: string, env: NodeJS.ProcessEnv = process.env): Promise<ProjectAiConfig> {
  let text = "";
  try { text = await fs.readFile(path.join(filesDir, ".env.local"), "utf8"); } catch { return { mode: null, hasKey: false }; }
  const key = /^\s*OPENAI_API_KEY\s*=\s*(.*)$/m.exec(text)?.[1]?.trim() ?? "";
  if (!key) return { mode: null, hasKey: false };
  void env;
  return { mode: key.startsWith(TOKEN_PREFIX) ? "clyra" : "own", hasKey: true };
}
