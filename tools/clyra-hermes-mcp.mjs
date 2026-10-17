#!/usr/bin/env node
/**
 * Minimal, dependency-free stdio MCP adapter for Clyra's native capability
 * registry. Hermes launches it as a child process; the bearer token is
 * process-local and all actual work remains in the Clyra server.
 */
import readline from "node:readline";

const baseUrl = String(process.env.CLYRA_AGENT_BRIDGE_URL || "").replace(/\/$/, "");
const token = String(process.env.CLYRA_AGENT_BRIDGE_TOKEN || "");

function send(payload) {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

function error(id, code, message) {
  send({ jsonrpc: "2.0", id, error: { code, message } });
}

async function clyra(path, init = {}) {
  if (!baseUrl || !token) throw new Error("Clyra native tool bridge is not configured.");
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const response = await fetch(`${baseUrl}${path}`, { ...init, headers, signal: AbortSignal.timeout(60_000) });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(String(payload?.error || `Clyra native tool bridge returned HTTP ${response.status}.`));
  return payload;
}

function mcpTool(tool) {
  return {
    name: tool.id,
    title: tool.name,
    description: `${tool.description} This is a Clyra-native capability; use it instead of generic filesystem/database access when applicable.`,
    inputSchema: tool.inputSchema,
    annotations: {
      readOnlyHint: !tool.permissions?.includes("write"),
      destructiveHint: tool.permissions?.includes("delete") || false,
      openWorldHint: tool.id.startsWith("browser.") || tool.id.startsWith("maps."),
    },
  };
}

async function handle(message) {
  const id = message?.id;
  const method = message?.method;
  if (!method) return;
  if (method === "notifications/initialized") return;
  if (method === "initialize") {
    send({ jsonrpc: "2.0", id, result: { protocolVersion: "2025-03-26", capabilities: { tools: { listChanged: false } }, serverInfo: { name: "clyra-native", version: "1.0.0" } } });
    return;
  }
  if (method === "tools/list") {
    const payload = await clyra("/api/agent/native-tools");
    send({ jsonrpc: "2.0", id, result: { tools: Array.isArray(payload?.tools) ? payload.tools.map(mcpTool) : [] } });
    return;
  }
  if (method === "tools/call") {
    const toolId = String(message?.params?.name || "");
    const args = message?.params?.arguments;
    const payload = await clyra("/api/agent/native-tools/call", { method: "POST", body: JSON.stringify({ toolId, args }) });
    const result = payload?.result;
    const text = JSON.stringify(result ?? { ok: false, error: { message: "Clyra returned no tool result." } });
    send({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text }], isError: result?.ok !== true } });
    return;
  }
  error(id, -32601, `Method not found: ${method}`);
}

const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
input.on("line", (line) => {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    error(null, -32700, "Parse error");
    return;
  }
  void handle(message).catch((reason) => error(message?.id ?? null, -32000, reason instanceof Error ? reason.message : "Clyra native tool bridge failed."));
});
