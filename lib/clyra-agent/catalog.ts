import type { ClyraTool, Json, JsonSchema, ToolExecutionContext, ToolResult } from "./core";

/**
 * The catalog is intentionally assembled from live adapters. A descriptor is
 * never advertised simply because a product surface exists: if its adapter is
 * unavailable it is omitted, allowing the planner to choose a real fallback.
 */
export type ToolAdapter = (args: Json, context: ToolExecutionContext) => Promise<ToolResult>;
export type ClyraToolBindings = Partial<Record<
  | "chat.ask" | "notes.search" | "notes.create" | "notes.read"
  | "browser.navigate" | "browser.inspect" | "browser.action" | "browser.search"
  | "vibe.createProject" | "vibe.modifyFiles" | "vibe.build" | "vibe.preview"
  | "media.create" | "media.render" | "computer.observe" | "computer.action"
  | "spotify.search" | "spotify.control" | "email.search" | "email.draft" | "email.send"
  | "project.memory.get" | "project.memory.update"
  | "files.list" | "files.read" | "files.write" | "files.move" | "files.delete"
  | "terminal.run" | "git.status" | "git.diff" | "git.commit", ToolAdapter>>;

const object = (properties: Record<string, JsonSchema>, required: string[] = []): JsonSchema => ({ type: "object", properties, required, additionalProperties: false });
const string = (minLength = 1): JsonSchema => ({ type: "string", minLength });
const optional = (schema: JsonSchema): JsonSchema => ({ anyOf: [schema, { type: "null" }] });
type Spec = Omit<ClyraTool, "execute"> & { binding: keyof ClyraToolBindings };
const specs: readonly Spec[] = [
  { binding: "chat.ask", id: "chat.ask", name: "Ask Clyra", description: "Generate a grounded Clyra response.", category: "chat", inputSchema: object({ prompt: string() }, ["prompt"]), permissions: ["read"], riskLevel: "safe", timeoutMs: 45_000, supportsCancellation: true },
  { binding: "notes.search", id: "notes.search", name: "Search Notes", description: "Search saved Clyra Notes.", category: "notes", inputSchema: object({ query: string() }, ["query"]), permissions: ["read"], riskLevel: "safe", timeoutMs: 8_000, supportsCancellation: true },
  { binding: "notes.read", id: "notes.read", name: "Read Note", description: "Read a saved Clyra Note by ID.", category: "notes", inputSchema: object({ pageId: string() }, ["pageId"]), permissions: ["read"], riskLevel: "safe", timeoutMs: 8_000, supportsCancellation: true },
  { binding: "notes.create", id: "notes.create", name: "Create Note", description: "Create a Clyra Note and return its record ID.", category: "notes", inputSchema: object({ title: string(), markdown: string() }, ["title", "markdown"]), permissions: ["write"], riskLevel: "safe", timeoutMs: 12_000, supportsCancellation: true },
  { binding: "browser.search", id: "browser.search", name: "Search the web", description: "Research public sources through Clyra's structured research backend.", category: "browser", inputSchema: object({ query: string() }, ["query"]), permissions: ["read"], riskLevel: "safe", timeoutMs: 45_000, supportsCancellation: true },
  { binding: "browser.navigate", id: "browser.navigate", name: "Navigate browser", description: "Navigate Clyra's managed browser to a URL.", category: "browser", inputSchema: object({ url: string() }, ["url"]), permissions: ["read"], riskLevel: "safe", timeoutMs: 30_000, supportsCancellation: true },
  { binding: "browser.inspect", id: "browser.inspect", name: "Inspect browser", description: "Read the current browser accessibility and page state.", category: "browser", inputSchema: object({}, []), permissions: ["read"], riskLevel: "safe", timeoutMs: 15_000, supportsCancellation: true },
  // `action` is intentionally not locked to `{ type }` only: `BrowserAction`
  // (lib/openbrowser/browser-runtime.ts) is a discriminated union whose real
  // shapes carry a `target`/`x`/`y`/`text`/`key`/`url` etc. depending on
  // `type` — this schema's job is only to require a `type` string; the
  // runtime's own `validateBrowserAction` enforces the real per-type shape.
  { binding: "browser.action", id: "browser.action", name: "Browser action", description: "Perform an authorised browser action (click, type, scroll, navigate within the page, etc.) against a fresh observation.", category: "browser", inputSchema: object({ action: { type: "object", properties: { type: string() }, required: ["type"], additionalProperties: true }, observationId: optional(string()) }, ["action"]), permissions: ["write"], riskLevel: "review", timeoutMs: 30_000, supportsCancellation: true },
  { binding: "vibe.createProject", id: "vibe.createProject", name: "Create Vibe project", description: "Create a Clyra Vibe project.", category: "vibe", inputSchema: object({ name: string(), prompt: string() }, ["name", "prompt"]), permissions: ["write"], riskLevel: "review", timeoutMs: 30_000, supportsCancellation: true },
  { binding: "vibe.modifyFiles", id: "vibe.modifyFiles", name: "Modify Vibe files", description: "Write validated files inside a Vibe project workspace.", category: "vibe", inputSchema: object({ projectId: string(), files: { type: "array", minItems: 1, items: object({ path: string(), content: string() }, ["path", "content"]) } }, ["projectId", "files"]), permissions: ["write"], riskLevel: "review", timeoutMs: 45_000, supportsCancellation: true },
  { binding: "vibe.build", id: "vibe.build", name: "Build Vibe project", description: "Run the project's build validation in the Vibe sandbox.", category: "vibe", inputSchema: object({ projectId: string() }, ["projectId"]), permissions: ["write"], riskLevel: "review", timeoutMs: 180_000, supportsCancellation: true },
  { binding: "vibe.preview", id: "vibe.preview", name: "Preview Vibe project", description: "Start or inspect a Vibe preview.", category: "vibe", inputSchema: object({ projectId: string() }, ["projectId"]), permissions: ["read"], riskLevel: "safe", timeoutMs: 45_000, supportsCancellation: true },
  { binding: "media.create", id: "media.create", name: "Create media draft", description: "Create a draft in Clyra Shorts Studio.", category: "media", inputSchema: object({ source: string() }, ["source"]), permissions: ["write"], riskLevel: "review", timeoutMs: 120_000, supportsCancellation: true },
  { binding: "media.render", id: "media.render", name: "Render media", description: "Render a Clyra Shorts Studio artifact.", category: "media", inputSchema: object({ jobId: string() }, ["jobId"]), permissions: ["write"], riskLevel: "review", timeoutMs: 300_000, supportsCancellation: true },
  { binding: "computer.observe", id: "computer.observe", name: "Observe computer", description: "Read structured accessibility, window, and screen state without interpreting screenshots as authority.", category: "computer", inputSchema: object({}, []), permissions: ["read", "computer-control"], riskLevel: "safe", timeoutMs: 20_000, supportsCancellation: true },
  { binding: "computer.action", id: "computer.action", name: "Control computer", description: "Perform a bounded computer-use action after a fresh structured observation.", category: "computer", inputSchema: object({ action: object({ type: string() }, ["type"]), observationId: string() }, ["action", "observationId"]), permissions: ["computer-control"], riskLevel: "sensitive", timeoutMs: 30_000, supportsCancellation: true },
  { binding: "spotify.search", id: "spotify.search", name: "Search Spotify", description: "Search Spotify through the connected structured integration.", category: "spotify", inputSchema: object({ query: string() }, ["query"]), permissions: ["read"], riskLevel: "safe", timeoutMs: 20_000, supportsCancellation: true },
  { binding: "spotify.control", id: "spotify.control", name: "Control Spotify", description: "Control connected Spotify playback and verify playback state.", category: "spotify", inputSchema: object({ action: string(), contextUri: optional(string()) }, ["action"]), permissions: ["write"], riskLevel: "review", timeoutMs: 20_000, supportsCancellation: true },
  { binding: "email.search", id: "email.search", name: "Search email", description: "Search the connected email account.", category: "email", inputSchema: object({ query: string() }, ["query"]), permissions: ["read"], riskLevel: "safe", timeoutMs: 30_000, supportsCancellation: true },
  { binding: "email.draft", id: "email.draft", name: "Draft email", description: "Create an email draft without sending it.", category: "email", inputSchema: object({ to: string(), subject: string(), body: string() }, ["to", "subject", "body"]), permissions: ["write"], riskLevel: "review", timeoutMs: 30_000, supportsCancellation: true },
  { binding: "email.send", id: "email.send", name: "Send email", description: "Send a specific reviewed email.", category: "email", inputSchema: object({ draftId: string() }, ["draftId"]), permissions: ["external-send"], riskLevel: "sensitive", timeoutMs: 30_000, supportsCancellation: false },
  { binding: "project.memory.get", id: "project.memory.get", name: "Get project memory", description: "Retrieve memory scoped to the active project only.", category: "memory", inputSchema: object({ query: string() }, ["query"]), permissions: ["read"], riskLevel: "safe", timeoutMs: 8_000, supportsCancellation: true },
  { binding: "project.memory.update", id: "project.memory.update", name: "Update project memory", description: "Store an explicit memory in the active project only.", category: "memory", inputSchema: object({ text: string() }, ["text"]), permissions: ["write"], riskLevel: "review", timeoutMs: 8_000, supportsCancellation: true },
  { binding: "files.list", id: "files.list", name: "List files", description: "List a directory inside the signed-in user's files.", category: "files", inputSchema: object({ path: optional(string()) }, []), permissions: ["read"], riskLevel: "safe", timeoutMs: 10_000, supportsCancellation: true },
  { binding: "files.read", id: "files.read", name: "Read file", description: "Read a file inside the signed-in user's files.", category: "files", inputSchema: object({ path: string() }, ["path"]), permissions: ["read"], riskLevel: "safe", timeoutMs: 10_000, supportsCancellation: true },
  { binding: "files.write", id: "files.write", name: "Write file", description: "Create or overwrite a file inside the signed-in user's files.", category: "files", inputSchema: object({ path: string(), content: string(0), mode: optional(string()) }, ["path", "content"]), permissions: ["write"], riskLevel: "review", timeoutMs: 15_000, supportsCancellation: true },
  { binding: "files.move", id: "files.move", name: "Move file", description: "Move or rename a file inside the signed-in user's files.", category: "files", inputSchema: object({ from: string(), to: string() }, ["from", "to"]), permissions: ["write"], riskLevel: "review", timeoutMs: 10_000, supportsCancellation: true },
  { binding: "files.delete", id: "files.delete", name: "Delete file", description: "Permanently delete a file or folder inside the signed-in user's files.", category: "files", inputSchema: object({ path: string() }, ["path"]), permissions: ["write", "delete"], riskLevel: "sensitive", timeoutMs: 10_000, supportsCancellation: true },
  { binding: "terminal.run", id: "terminal.run", name: "Run terminal command", description: "Run a shell command scoped to the signed-in user's files.", category: "terminal", inputSchema: object({ command: string(), cwd: optional(string()), timeoutMs: optional({ type: "number" }) }, ["command"]), permissions: ["write"], riskLevel: "review", timeoutMs: 130_000, supportsCancellation: true },
  { binding: "git.status", id: "git.status", name: "Git status", description: "Read the working-tree status of a project.", category: "git", inputSchema: object({ path: optional(string()) }, []), permissions: ["read"], riskLevel: "safe", timeoutMs: 15_000, supportsCancellation: true },
  { binding: "git.diff", id: "git.diff", name: "Git diff", description: "Read the current diff of a project.", category: "git", inputSchema: object({ path: optional(string()), staged: optional({ type: "boolean" }) }, []), permissions: ["read"], riskLevel: "safe", timeoutMs: 15_000, supportsCancellation: true },
  { binding: "git.commit", id: "git.commit", name: "Git commit", description: "Commit currently staged changes in a project.", category: "git", inputSchema: object({ path: optional(string()), message: string() }, ["message"]), permissions: ["write"], riskLevel: "review", timeoutMs: 15_000, supportsCancellation: true },
] as const;

export function createClyraToolRegistry(bindings: ClyraToolBindings): ClyraTool[] {
  return specs.flatMap((spec) => {
    const execute = bindings[spec.binding];
    if (!execute) return [];
    const browserOrComputer = spec.category === "browser" || spec.category === "computer";
    return [{
      ...spec,
      // Every live Clyra adapter exposes this same contract. It lets the
      // planner choose native/structured/browser/computer paths without
      // guessing from labels and keeps unavailable integrations out of the
      // registry entirely.
      capabilities: [spec.category, spec.binding.split(".")[1]],
      outputSchema: { type: "object" },
      availability: "available",
      operatingSystems: browserOrComputer ? ["darwin", "win32", "linux", "web"] : ["darwin", "win32", "linux", "web"],
      requiresApproval: spec.riskLevel !== "safe",
      canRunConcurrently: spec.riskLevel === "safe" && !["browser.inspect", "browser.action", "computer.observe", "computer.action"].includes(spec.id),
      retryPolicy: {
        maxAttempts: 3,
        retryableCodes: ["NETWORK_ERROR", "RATE_LIMIT", "TOOL_TIMEOUT", "ELEMENT_NOT_FOUND", "WINDOW_CHANGED"],
        fallbackOrder: browserOrComputer ? ["native", "structured-api", "browser", "computer"] : ["native", "structured-api", "browser", "computer"],
      },
      verification: {
        method: spec.id === "notes.create" ? "reopen" : spec.id.includes("build") ? "process-exit" : "evidence",
        description: spec.id === "notes.create" ? "Reopen the created note by returned ID." : "Require fresh evidence from the adapter before marking the step complete.",
      },
      execute,
    }];
  });
}

export type RouteKind = "DIRECT_RESPONSE" | "SINGLE_TOOL" | "SHORT_WORKFLOW" | "MISSION";
export type ToolStrategy = "native" | "structured-api" | "browser" | "computer";
export type RouteDecision = { kind: RouteKind; category: string; strategy: ToolStrategy; reason: string };
/** Deterministic first-pass routing. The model can refine a plan, never bypass this priority order. */
export function routeObjective(prompt: string, available = new Set<string>()): RouteDecision {
  const text = prompt.toLowerCase().trim();
  if (/^(what is|calculate|solve|explain|define)\b/.test(text) && !/\b(open|use|create|save|play)\b/.test(text)) return { kind: "DIRECT_RESPONSE", category: "chat", strategy: "native", reason: "Answer does not need an external side effect." };
  if (/\b(play|pause|next|previous)\b.*\b(spotify|playlist|music)\b|\bspotify\b.*\b(play|pause)\b/.test(text) && available.has("spotify.control")) return { kind: "SINGLE_TOOL", category: "spotify", strategy: "native", reason: "Connected Spotify is preferred over UI control." };
  if (/\b(create|write|save)\b.*\b(note|report|comparison)\b/.test(text) && /\b(find|research|compare|caf(?:e|é)s?|business)\b/.test(text)) return { kind: "SHORT_WORKFLOW", category: "browser", strategy: "structured-api", reason: "Research and a saved artifact need a verified multi-tool workflow." };
  // Artifact intent outranks incidental words inside a title (for example,
  // “Route QA”). A plain Note request must not turn into a browser task.
  if (/\b(?:make|create|write|save)\b.*\b(?:clyra\s+)?note\b/.test(text) && available.has("notes.create")) return { kind: "SINGLE_TOOL", category: "notes", strategy: "native", reason: "Create the requested Note, then reopen it to verify the artifact." };
  if (/\b(caf(?:e|é)s?|restaurant|eat|nearby|route|directions)\b/.test(text)) return { kind: "SINGLE_TOOL", category: "browser", strategy: "structured-api", reason: "This installation has no verified category/nearby-places backend; use structured research rather than pretending the geocoder can rank businesses." };
  if (/\b(build|landing page|website|dashboard|prototype)\b/.test(text)) return { kind: "MISSION", category: "vibe", strategy: "native", reason: "A build needs files, validation, preview, and verification." };
  if (/\b(research|compare|competitor|business)\b/.test(text)) return { kind: "SHORT_WORKFLOW", category: "browser", strategy: available.has("browser.search") ? "structured-api" : "browser", reason: "Research begins with structured source retrieval." };
  if (/\b(open calculator|open .* app|computer use)\b/.test(text)) return { kind: "SINGLE_TOOL", category: "computer", strategy: "computer", reason: "No native integration is available for the requested app." };
  return { kind: "DIRECT_RESPONSE", category: "chat", strategy: "native", reason: "No verified tool action is required." };
}
