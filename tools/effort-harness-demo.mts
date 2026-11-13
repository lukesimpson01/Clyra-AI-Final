/** Runs one request through the effort conductor at a level against a running Clyra server and prints every phase.
 *  npx tsx tools/effort-harness-demo.mts <light|medium|high|max> "request" [serverUrl] */
import { runEffortHarness, type HarnessEffort } from "../src/lib/chatEffortHarness";

const [effort, request, server = "http://localhost:3000"] = process.argv.slice(2);
if (!effort || !request) { console.error('usage: effort-harness-demo <level> "request" [serverUrl]'); process.exit(1); }

async function stream(system: string | null, messages: any[], onChunk: (t: string, r?: boolean) => void, temperature: number, maxTokens: number, model: string, signal: AbortSignal | undefined, thinking: boolean, timeoutMs: number, reasoning?: "high" | "max") {
  const res = await fetch(`${server}/api/deepseek/chat`, {
    method: "POST", headers: { "Content-Type": "application/json" }, signal: AbortSignal.timeout(timeoutMs),
    body: JSON.stringify({ model, messages: system ? [{ role: "system", content: system }, ...messages] : messages, temperature, stream: true, max_tokens: maxTokens, thinking: { type: thinking ? "enabled" : "disabled" }, ...(thinking && reasoning ? { reasoning_effort: reasoning } : {}) }),
  });
  if (!res.ok || !res.body) throw new Error(`model ${res.status}`);
  const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = "";
  for (;;) {
    const { done, value } = await reader.read(); if (done) break;
    buf += dec.decode(value, { stream: true }); const lines = buf.split("\n"); buf = lines.pop() || "";
    for (const raw of lines) { const l = raw.trim(); if (!l.startsWith("data: ") || l === "data: [DONE]") continue; try { const d = JSON.parse(l.slice(6)).choices?.[0]?.delta; if (d?.reasoning_content) onChunk(d.reasoning_content, true); if (d?.content) onChunk(d.content, false); } catch { /* partial frame */ } }
  }
}

const t0 = Date.now(); let text = ""; let firstAt = 0;
const at = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`;
const steps = await runEffortHarness({
  effort: effort as HarnessEffort, system: "You are Clyra, a precise assistant. Today is a normal day.", messages: [{ role: "user", content: request }], stream, temperature: 0.3,
  onPhase: (p) => console.log(`[${at()}] phase: ${p ?? "(answer streaming)"}`),
  onChunk: (c) => { if (!firstAt) firstAt = Date.now() - t0; text += c; },
});
console.log(`\n[${at()}] done. first answer token at ${(firstAt / 1000).toFixed(1)}s, ${text.length} chars`);
console.log("steps:", JSON.stringify(steps));
console.log("\n" + text.slice(0, 900));
process.exit(0);
