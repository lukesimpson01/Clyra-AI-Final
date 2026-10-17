/**
 * Runs one real Clyra Code build from a basic request and records what the agent did.
 *
 * It follows the same calls the Clyra Code UI makes: create the project, start the
 * runtime, create a session, send the platform-expanded prompt, then watch the
 * project's event stream until the session goes idle or fails. Every event is written
 * to a log as it arrives, so a run can be followed while it happens.
 *
 *   npx tsx tools/clyra-code-eval.ts <web|desktop|ios> "<label>" "<basic request>"
 *
 * Environment:
 *   CLYRA_BASE     server origin (default http://localhost:3000)
 *   CLYRA_EVAL_OUT directory for logs and the result file
 *   CLYRA_EVAL_TIMEOUT_MIN maximum wait for the run (default 90)
 */
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { platformDirective, isBriefPlatform, type BriefPlatform } from "../src/components/clyra-code/appBrief";

const BASE = process.env.CLYRA_BASE ?? "http://localhost:3000";
const OUT = process.env.CLYRA_EVAL_OUT ?? path.join(process.cwd(), "eval-runs");
const TIMEOUT_MS = Number(process.env.CLYRA_EVAL_TIMEOUT_MIN ?? 90) * 60_000;

const [platformArg, label, ...requestParts] = process.argv.slice(2);
if (!platformArg || !isBriefPlatform(platformArg) || !label || requestParts.length === 0) {
  console.error('usage: tsx tools/clyra-code-eval.ts <web|desktop|ios> "<label>" "<basic request>"');
  process.exit(2);
}
const platform: BriefPlatform = platformArg;
const request = requestParts.join(" ");
const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, "-");

mkdirSync(OUT, { recursive: true });
const logPath = path.join(OUT, `${slug}.log`);
const resultPath = path.join(OUT, `${slug}.result.json`);
writeFileSync(logPath, "");
const log = (line: string) => {
  const stamp = new Date().toISOString().slice(11, 19);
  appendFileSync(logPath, `${stamp} ${line}\n`);
};

async function call<T>(method: string, route: string, body?: unknown): Promise<T> {
  const response = await fetch(`${BASE}${route}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${method} ${route} -> ${response.status}: ${text.slice(0, 300)}`);
  return (text ? JSON.parse(text) : {}) as T;
}

/** A short, human line for one stream event, so the log reads like the UI timeline. */
function describe(type: string, properties: Record<string, unknown>): string | null {
  const part = (properties.part ?? {}) as Record<string, unknown>;
  const state = (part.state ?? {}) as Record<string, unknown>;
  if (type === "message.part.updated") {
    if (part.type === "tool" && (state.status === "completed" || state.status === "error")) {
      const input = (state.input ?? {}) as Record<string, unknown>;
      const hint = String(input.command ?? input.filePath ?? input.path ?? input.pattern ?? input.description ?? "").slice(0, 160);
      return `tool ${String(part.tool ?? "?")} ${String(state.status)} ${hint}`.trim();
    }
    const time = (part.time ?? {}) as { end?: unknown };
    if (part.type === "text" && time.end && typeof part.text === "string" && part.text.trim()) {
      return `agent: ${part.text.trim().replace(/\s+/g, " ").slice(0, 400)}`;
    }
    return null;
  }
  if (type === "session.error") return `ERROR ${JSON.stringify(properties.error ?? {}).slice(0, 400)}`;
  if (type === "session.idle") return "session idle";
  if (type === "session.status") return `status ${JSON.stringify(properties.status ?? {}).slice(0, 120)}`;
  return null;
}

async function main() {
  const started = Date.now();
  log(`start platform=${platform} label="${label}"`);

  const { project } = await call<{ project: { id: string } }>("POST", "/api/vibe/projects", { name: label, prompt: request });
  const projectId = project.id;
  log(`project ${projectId}`);

  await call("POST", "/api/opencode/runtime/start", { projectId });
  const session = await call<{ id: string }>("POST", "/api/opencode/sessions", { projectId, title: label });
  const sessionId = session.id;
  log(`session ${sessionId}`);

  // CLYRA_EVAL_RAW=1 sends the request exactly as written, for focused checks.
  const directive = process.env.CLYRA_EVAL_RAW ? "" : platformDirective(platform);
  const prompt = `${directive}${request}`;

  // Open the stream before sending, so no early event is missed.
  const outcome = await new Promise<"idle" | "error" | "timeout">((resolve) => {
    const controller = new AbortController();
    const timer = setTimeout(() => { log("timeout reached"); controller.abort(); resolve("timeout"); }, TIMEOUT_MS);
    let settled = false;
    const settle = (value: "idle" | "error") => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      controller.abort();
      resolve(value);
    };

    (async () => {
      try {
        const response = await fetch(`${BASE}/api/opencode/events/${projectId}`, { signal: controller.signal, headers: { accept: "text/event-stream" } });
        if (!response.body) throw new Error("event stream has no body");
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let boundary: number;
          while ((boundary = buffer.indexOf("\n\n")) !== -1) {
            const frame = buffer.slice(0, boundary);
            buffer = buffer.slice(boundary + 2);
            const data = frame.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim()).join("");
            if (!data) continue;
            let event: { payload?: { type?: string; properties?: Record<string, unknown> } };
            try { event = JSON.parse(data); } catch { continue; }
            const type = event.payload?.type;
            const properties = event.payload?.properties ?? {};
            if (!type) continue;
            const part = (properties.part ?? {}) as { sessionID?: string };
            const eventSession = String(part.sessionID ?? properties.sessionID ?? "");
            if (eventSession && eventSession !== sessionId) continue;
            const line = describe(type, properties);
            if (line) log(line);
            if (type === "session.idle") settle("idle");
            if (type === "session.error") settle("error");
          }
        }
      } catch (error) {
        if (!settled) log(`stream ended: ${error instanceof Error ? error.message : String(error)}`);
      }
    })();

    call("POST", `/api/opencode/sessions/${projectId}/${sessionId}/prompt`, { text: prompt, effort: "high" })
      .then(() => log(`prompt sent (${prompt.length} chars, effort high)`))
      .catch((error) => { log(`prompt failed: ${error instanceof Error ? error.message : String(error)}`); settle("error"); });
  });

  const seconds = Math.round((Date.now() - started) / 1000);
  log(`finished outcome=${outcome} after ${seconds}s`);
  writeFileSync(resultPath, JSON.stringify({ label, platform, request, projectId, sessionId, outcome, seconds, finishedAt: new Date().toISOString() }, null, 2));
  process.exit(outcome === "idle" ? 0 : 1);
}

main().catch((error) => {
  log(`fatal: ${error instanceof Error ? error.message : String(error)}`);
  writeFileSync(resultPath, JSON.stringify({ label, platform, request, outcome: "fatal", error: String(error) }, null, 2));
  process.exit(1);
});
