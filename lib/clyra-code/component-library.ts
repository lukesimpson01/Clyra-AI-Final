/**
 * Real shadcn registry and 21st.dev MCP discovery for Clyra Code.
 * Secret-bearing requests run in the local Node process, never the renderer.
 * No component code is executed by browsing or referencing a library item.
 */
import type { Application } from "express";
import { promises as fs } from "node:fs";
import path from "node:path";

export type ComponentSource = "shadcn" | "21st";
export type CatalogComponent = {
  id: string; source: ComponentSource; name: string; title: string;
  description: string; category: string; previewUrl?: string; docsUrl?: string;
  registryId: string;
};

const SHADCN_INDEX = "https://ui.shadcn.com/r/index.json";
const TWENTY_FIRST_MCP = "https://21st.dev/api/mcp";
let shadcnCache: { until: number; items: CatalogComponent[] } | null = null;

function label(name: string): string {
  return name.split(/[-_]/g).filter(Boolean).map(word => word[0].toUpperCase() + word.slice(1)).join(" ");
}
function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function safeUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  try { const url = new URL(value); return url.protocol === "https:" ? url.href : undefined; }
  catch { return undefined; }
}
function apiKey(): string {
  return (process.env.API_KEY_21ST || process.env.TWENTY_FIRST_API_KEY || "").trim();
}

/** Supports OpenCode V2's per-project MCP configuration; never stores the API key. */
export async function ensureComponentMcpConfig(projectPath: string): Promise<void> {
  const destination = path.join(projectPath, "opencode.json");
  const content = await fs.readFile(destination, "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return "{}";
    throw error;
  });
  // Fail rather than overwrite invalid user-authored settings.
  const config = asObject(JSON.parse(content));
  const mcp = asObject(config.mcp);
  const servers = asObject(mcp.servers);
  if (process.env.TWENTY_FIRST_API_KEY && !process.env.API_KEY_21ST) {
    process.env.API_KEY_21ST = process.env.TWENTY_FIRST_API_KEY;
  }
  config.$schema ??= "https://opencode.ai/config.json";
  config.mcp = {
    ...mcp,
    servers: {
      ...servers,
      shadcn: {
        type: "local", command: ["npx", "-y", "shadcn@latest", "mcp"],
        timeout: 20_000, codemode: false,
      },
      "21st": {
        type: "remote", url: TWENTY_FIRST_MCP, oauth: false,
        headers: { "x-api-key": "{env:API_KEY_21ST}" },
        disabled: !apiKey(), timeout: 20_000, codemode: false,
      },
    },
  };
  const next = JSON.stringify(config, null, 2) + "\n";
  if (content !== next) await fs.writeFile(destination, next, "utf8");
}

async function shadcnComponents(): Promise<CatalogComponent[]> {
  if (shadcnCache && shadcnCache.until > Date.now()) return shadcnCache.items;
  const response = await fetch(SHADCN_INDEX, { signal: AbortSignal.timeout(12_000) });
  if (!response.ok) throw new Error("shadcn registry is unavailable (" + response.status + ").");
  const data: unknown = await response.json();
  if (!Array.isArray(data)) throw new Error("Unexpected shadcn registry response.");
  const items = data.flatMap((raw): CatalogComponent[] => {
    const item = asObject(raw);
    const name = typeof item.name === "string" ? item.name : "";
    if (!/^[a-z0-9-]+$/.test(name)) return [];
    const links = asObject(asObject(item.meta).links);
    const radix = asObject(links.radix);
    const base = asObject(links.base);
    const aria = asObject(links.aria);
    return [{
      id: "shadcn:" + name, source: "shadcn", registryId: name,
      name, title: typeof item.title === "string" ? item.title : label(name),
      description: typeof item.description === "string" ? item.description : "Reusable " + label(name) + " component.",
      category: typeof item.type === "string" ? item.type.replace(/^registry:/, "") : "component",
      docsUrl: safeUrl(radix.docs) || safeUrl(base.docs) || safeUrl(aria.docs) || "https://ui.shadcn.com/docs/components/" + name,
    }];
  });
  shadcnCache = { until: Date.now() + 10 * 60_000, items };
  return items;
}

type RpcResponse = { result?: unknown; error?: { message?: string } };
function parseRpc(text: string, expectedId: number): RpcResponse {
  const candidates: unknown[] = [];
  try { candidates.push(JSON.parse(text)); } catch { /* Server may use SSE. */ }
  for (const line of text.split("\n")) {
    if (!line.startsWith("data:")) continue;
    try { candidates.push(JSON.parse(line.slice(5).trim())); } catch { /* keep looking */ }
  }
  const reply = candidates.map(asObject).find(item => item.id === expectedId)
    ?? candidates.map(asObject).find(item => "result" in item || "error" in item);
  if (!reply) throw new Error("21st MCP returned an unsupported response.");
  return reply as RpcResponse;
}
async function callRpc(
  method: string, params: Record<string, unknown>, id: number, key: string, session?: string,
): Promise<{ data: RpcResponse; session?: string }> {
  const response = await fetch(TWENTY_FIRST_MCP, {
    method: "POST",
    headers: {
      "Content-Type": "application/json", Accept: "application/json, text/event-stream",
      "x-api-key": key, ...(session ? { "Mcp-Session-Id": session } : {}),
    },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(
    response.status === 401 || response.status === 403
      ? "21st.dev API key was rejected." : "21st MCP request failed (" + response.status + ")."
  );
  const data = parseRpc(await response.text(), id);
  if (data.error) throw new Error(data.error.message || "21st MCP returned an error.");
  return { data, session: response.headers.get("mcp-session-id") || session };
}
async function notifyInitialized(key: string, session?: string) {
  await fetch(TWENTY_FIRST_MCP, {
    method: "POST",
    headers: {
      "Content-Type": "application/json", Accept: "application/json, text/event-stream",
      "x-api-key": key, ...(session ? { "Mcp-Session-Id": session } : {}),
    },
    body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
    signal: AbortSignal.timeout(8_000),
  }).catch(() => undefined);
}
function unwrapTools(value: unknown): Array<Record<string, unknown>> {
  const root = asObject(value);
  return Array.isArray(root.tools) ? root.tools.map(asObject) : [];
}
function parseContent(result: unknown): unknown {
  const root = asObject(result);
  if (root.structuredContent) return root.structuredContent;
  if (Array.isArray(root.content)) {
    const texts = root.content.map(asObject).filter(item => item.type === "text" && typeof item.text === "string");
    for (const item of texts) {
      try { return JSON.parse(item.text as string); } catch { /* some tools emit plain text */ }
    }
  }
  return result;
}
function collectRecords(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.map(asObject);
  const root = asObject(value);
  for (const key of ["components", "results", "items", "data", "hits"]) {
    const child = root[key];
    if (Array.isArray(child)) return child.map(asObject);
    if (child && typeof child === "object") {
      const nested = collectRecords(child);
      if (nested.length) return nested;
    }
  }
  return [];
}
async function twentyFirstComponents(query: string): Promise<CatalogComponent[]> {
  const key = apiKey();
  if (!key) return [];
  const initialized = await callRpc("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "clyra-vibe-component-library", version: "1.0.0" },
  }, 1, key);
  await notifyInitialized(key, initialized.session);
  const tools = await callRpc("tools/list", {}, 2, key, initialized.session);
  const search = unwrapTools(tools.data.result).find(t => t.name === "search");
  if (!search) throw new Error("The connected 21st MCP did not advertise a search tool.");
  const properties = asObject(asObject(search.inputSchema).properties);
  const params: Record<string, unknown> = {};
  if ("query" in properties) params.query = query || "popular";
  else if ("search_query" in properties) params.search_query = query || "popular";
  else if ("prompt" in properties) params.prompt = query || "popular";
  else throw new Error("21st MCP search schema is not supported by this client.");
  if ("limit" in properties) params.limit = 30;
  if ("type" in properties && Array.isArray(asObject(properties.type).enum)
      && (asObject(properties.type).enum as unknown[]).includes("component")) params.type = "component";
  const found = await callRpc("tools/call", { name: "search", arguments: params }, 3, key, initialized.session);
  const response = asObject(found.data.result);
  if (response.isError) throw new Error("21st MCP component search failed.");
  return collectRecords(parseContent(found.data.result)).flatMap((component): CatalogComponent[] => {
    const name = String(component.name || component.title || component.slug || "").trim().slice(0, 100);
    const registryId = String(component.slug || component.id || component.name || "").trim().slice(0, 180);
    if (!name || !registryId) return [];
    const image = component.previewUrl || component.preview_url || component.thumbnailUrl
      || component.thumbnail_url || component.imageUrl || component.image_url || component.image;
    return [{
      id: "21st:" + registryId, source: "21st", registryId, name,
      title: String(component.title || name).slice(0, 100),
      description: String(component.description || "").slice(0, 260),
      category: String(component.category || component.type || "component").slice(0, 50),
      previewUrl: safeUrl(image),
      docsUrl: safeUrl(component.url) || safeUrl(component.link) || "https://21st.dev",
    }];
  });
}

export function registerComponentLibraryRoutes(app: Application): void {
  app.get("/api/clyra-code/components/status", (_req, res) => {
    res.json({
      sources: [
        { id: "shadcn", available: true, detail: "Public registry · no account required" },
        { id: "21st", available: !!apiKey(), detail: apiKey()
          ? "API key configured · live MCP catalog" : "Connect API_KEY_21ST to browse and install" },
      ],
    });
  });
  app.get("/api/clyra-code/components", async (req, res) => {
    const source = String(req.query.source || "all");
    if (!["all", "shadcn", "21st"].includes(source)) {
      res.status(400).json({ error: "Unknown component source." }); return;
    }
    const q = String(req.query.q || "").slice(0, 100).trim();
    try {
      const result = await Promise.allSettled([
        source !== "21st" ? shadcnComponents() : Promise.resolve([]),
        source !== "shadcn" ? twentyFirstComponents(q) : Promise.resolve([]),
      ]);
      const failures = result.map((entry, index) => entry.status === "rejected"
        ? { source: index === 0 ? "shadcn" : "21st", message: entry.reason instanceof Error ? entry.reason.message : "Connection failed" }
        : null).filter(Boolean);
      const items = result.flatMap(entry => entry.status === "fulfilled" ? entry.value : [])
        .filter(item => item.source === "21st" || !q
          || (item.title + " " + item.name + " " + item.description).toLowerCase().includes(q.toLowerCase()));
      res.json({ items: items.slice(0, 240), errors: failures });
    } catch (error) {
      res.status(502).json({ error: error instanceof Error ? error.message : "Component discovery failed." });
    }
  });
}
