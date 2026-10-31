import path from "node:path";
import crypto from "node:crypto";
import { clyraDataPath } from "../runtime-paths";
import * as notes from "../notes/store";
import { runWebSearchResearch } from "../research/research-handlers";
import { createClyraToolRegistry, routeObjective } from "./catalog";
import { MissionRuntime, validateJson, type Json, type MissionPlan, type MissionRecord, type ToolResult } from "./core";
import { MissionStore } from "./mission-store";
import { filesList, filesRead, filesWrite, filesMove, filesDelete, pathExists } from "./fs-tools";
import { terminalRun, gitStatus, gitDiff, gitCommit } from "./terminal-tools";
import { getManagedBrowserObservation, navigateManagedBrowser, actOnManagedBrowser, type BrowserAction } from "../openbrowser/browser-runtime";
import type { MemoryService } from "../memory/service";
import { memoryToolBindings } from "../memory/tools";

function requestedArtifactTitle(objective: string) {
  const explicit = objective.match(/\b(?:note|report|comparison)\s+(?:called|titled)\s+["“]?(.+?)["”]?(?:\s+(?:in|to)\s+(?:clyra\s+)?notes?|\s+and\s+|$)/i)
    || objective.match(/\b(?:create|make|write|save)\s+(?:a\s+)?(?:note|report|comparison)\s+(?:in|to)\s+(?:clyra\s+)?notes?\s*(?:about|on|for)?\s*(.+)?$/i);
  const candidate = explicit?.[1]?.replace(/[.?!]+$/, "").trim();
  return (candidate || "Research report").slice(0, 180);
}

function wantsNoteArtifact(objective: string) {
  return /\b(?:create|make|write|save)\s+(?:a\s+)?(?:clyra\s+)?(?:note|report|comparison)\b/i.test(objective)
    && /\b(?:note|report|comparison|notes?)\b/i.test(objective);
}

function wantsResearch(objective: string) {
  return /\b(?:find|research|compare|read|competitor|competitors|pricing|documentation|caf(?:e|é)s?|business(?:es)?)\b/i.test(objective);
}

/**
 * Server-side bindings for the subset of cross-surface actions that genuinely
 * exist in the web service today. Desktop-only integrations are registered by
 * Electron, not fabricated here. This is deliberately small and additive.
 */
export class ServerMissionService {
  private store = new MissionStore(path.join(clyraDataPath("data"), "clyra-missions.sqlite"));
  /** Active runtimes remain in-memory only; their complete checkpoint is
   * persisted after every state boundary. A restart therefore never silently
   * resumes work, while Pause and Stop can still interrupt an active tool. */
  private active = new Map<string, MissionRuntime>();
  private memoryService: MemoryService | null;

  constructor(memoryService?: MemoryService) {
    this.memoryService = memoryService || null;
  }
  route(prompt: string) {
    const tools = createClyraToolRegistry(this.bindings());
    return { decision: routeObjective(prompt, new Set(tools.map((tool) => tool.id))), tools: tools.map(({ id, name, category, riskLevel, permissions }) => ({ id, name, category, riskLevel, permissions })) };
  }
  /**
   * The native tool surface used by the local agent bridge. It is derived
   * from the same registry as deterministic Missions, so a tool is never
   * advertised just because a Clyra tab happens to exist.
   */
  nativeTools() {
    return createClyraToolRegistry(this.bindings()).map((tool) => ({
      id: tool.id,
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
      permissions: tool.permissions,
      riskLevel: tool.riskLevel,
      availability: tool.availability || "available",
    }));
  }
  /** Execute a Clyra-owned adapter for the MCP bridge. Review/sensitive
   * mutations deliberately stay out of this unattended bridge until Chat has
   * rendered an exact approval request for the action. */
  async executeNativeTool(toolId: string, args: Json, signal?: AbortSignal): Promise<ToolResult> {
    const tool = createClyraToolRegistry(this.bindings()).find((candidate) => candidate.id === toolId);
    if (!tool) return { ok: false, error: { code: "TOOL_NOT_FOUND", message: `Clyra tool ${toolId} is not available in this host.` } };
    if (tool.riskLevel !== "safe") return { ok: false, error: { code: "PERMISSION_REQUIRED", message: `${tool.name} requires an in-chat Clyra approval before it can run.` } };
    const errors = validateJson(tool.inputSchema, args);
    if (errors.length) return { ok: false, error: { code: "INVALID_ARGUMENTS", message: errors.join("; ") } };
    try {
      const result = await tool.execute(args, {
        missionId: `hermes-${crypto.randomUUID()}`,
        signal: signal || AbortSignal.timeout(tool.timeoutMs),
        attempt: 1,
      });
      if (!result.ok) return result;
      const verified = await this.verify(tool.id, result);
      return verified.ok
        ? result
        : { ok: false, data: result.data, evidence: result.evidence, error: { code: "VERIFICATION_FAILED", message: verified.reason || "Clyra could not verify this action." } };
    } catch (error) {
      return { ok: false, error: { code: "TOOL_CRASH", message: error instanceof Error ? error.message : "The Clyra tool stopped unexpectedly.", retryable: true } };
    }
  }
  /** A conservative first planner for server-owned capabilities. It creates
   * explicit data dependencies; richer desktop plans are supplied by the
   * Electron capability host, never guessed by this web-only service. */
  plan(prompt: string): MissionPlan | null {
    const text = prompt.trim();
    const note = text.match(/\b(?:make|create|write)\s+(?:a\s+)?note\s+(?:called|titled)\s+(.+?)(?:\s+and\s+|$)/i);
    const needsResearch = wantsResearch(text);
    const noteArtifact = wantsNoteArtifact(text);
    if (noteArtifact && needsResearch) {
      const title = requestedArtifactTitle(text);
      return { objective: text, steps: [
        { id: "research", description: "Collect verified public sources", toolId: "browser.search", args: { query: text }, dependsOn: [], status: "pending" },
        { id: "note", description: "Create the requested source-backed Note", toolId: "notes.create", args: { title, markdown: `# ${title}\n\n## Verified sources\n\n$steps.research.data.urls\n\n_Source list retrieved and verified by Clyra. Open the sources before treating an excerpt as a final conclusion._` }, dependsOn: ["research"], status: "pending" },
      ] };
    }
    // A research-only Mission is still useful: it returns a durable,
    // evidence-backed source set that Chat and Cowork can present while a
    // user decides what artifact should be created next. Do not pretend to
    // have performed analysis that no installed adapter can verify.
    if (needsResearch) {
      return { objective: text, steps: [
        { id: "research", description: "Collect verified public sources", toolId: "browser.search", args: { query: text }, dependsOn: [], status: "pending" },
      ] };
    }
    if (noteArtifact) {
      const title = note ? (note[1].replace(/[.?!]+$/, "").slice(0, 180) || "Untitled note") : requestedArtifactTitle(text);
      const body = note ? (text.slice(note[0].length).replace(/^add\s+/i, "").trim() || text) : text;
      return { objective: text, steps: [{ id: "note", description: "Create the requested note", toolId: "notes.create", args: { title, markdown: body }, dependsOn: [], status: "pending" }] };
    }
    return null;
  }
  async execute(input: { missionId?: string; projectId?: string; plan: MissionPlan; approvedStepIds?: string[] }) {
    const runtime = this.createRuntime(input.plan, input.missionId, input.projectId, input.approvedStepIds);
    // Save before the first action, then on every runtime checkpoint. A host
    // restart can therefore return the caller to the last safe boundary.
    this.store.save(runtime.snapshot());
    const id = runtime.snapshot().id;
    this.active.set(id, runtime);
    try {
      const record = await runtime.run();
      this.store.save(record);
      return record;
    } finally {
      this.active.delete(id);
    }
  }
  /** Start a durable task without holding the HTTP response open. Chat can
   * render the persisted plan immediately, poll its real state, and issue a
   * pause or stop command while an adapter is active. */
  start(input: { missionId?: string; projectId?: string; plan: MissionPlan; approvedStepIds?: string[] }) {
    const runtime = this.createRuntime(input.plan, input.missionId, input.projectId, input.approvedStepIds);
    const initial = runtime.snapshot();
    this.store.save(initial);
    this.active.set(initial.id, runtime);
    void runtime.run()
      .then((record) => this.store.save(record))
      .catch((error) => {
        // The runtime normally records tool failures itself. This final guard
        // retains a safe checkpoint if an adapter unexpectedly rejects.
        const record = runtime.snapshot();
        this.store.save(record);
        console.warn("[clyra-agent] background mission stopped unexpectedly", error instanceof Error ? error.message : error);
      })
      .finally(() => this.active.delete(initial.id));
    return runtime.snapshot();
  }
  get(missionId: string) { return this.store.get(missionId); }
  pause(missionId: string) {
    const runtime = this.active.get(missionId);
    if (runtime) {
      runtime.pause();
      const record = runtime.snapshot();
      this.store.save(record);
      return record;
    }
    return this.store.get(missionId);
  }
  cancel(missionId: string) {
    const runtime = this.active.get(missionId);
    if (runtime) {
      runtime.cancel();
      const record = runtime.snapshot();
      this.store.save(record);
      return record;
    }
    const saved = this.store.get(missionId);
    if (!saved || ["COMPLETED", "FAILED", "CANCELLED"].includes(saved.state)) return saved;
    const runtimeFromCheckpoint = this.createRuntime(saved.plan, saved.id, saved.projectId, [], saved);
    runtimeFromCheckpoint.cancel();
    const record = runtimeFromCheckpoint.snapshot();
    this.store.save(record);
    return record;
  }
  async resume(input: { missionId: string; approvedStepIds?: string[] }) {
    const saved = this.store.get(input.missionId);
    if (!saved) return null;
    const approved = new Set(input.approvedStepIds || []);
    const runtime = this.createRuntime(saved.plan, saved.id, saved.projectId, input.approvedStepIds, saved);
    const record = saved.state === "WAITING_FOR_APPROVAL" && saved.approval && approved.has(saved.approval.stepId)
      ? await runtime.approveAndResume(saved.approval.stepId)
      : await runtime.resumePersisted();
    this.store.save(record);
    return record;
  }
  interrupted() { return this.store.interrupted(); }
  private createRuntime(plan: MissionPlan, missionId?: string, projectId?: string, approvedStepIds?: string[], initialRecord?: MissionRecord) {
    const approved = new Set(approvedStepIds || []);
    return new MissionRuntime(plan, {
      tools: createClyraToolRegistry(this.bindings()),
      requestApproval: async (step) => approved.has(step.id),
      verify: async (step, result) => this.verify(step.toolId, result),
      recover: async ({ error }) => error.code === "NETWORK_ERROR" || error.code === "RATE_LIMIT" || error.code === "TOOL_TIMEOUT" ? "retry" : "fail",
      checkpoint: (record) => this.store.save(record),
      initialRecord,
    }, missionId, projectId);
  }
  private bindings() {
    const memory = this.memoryService ? memoryToolBindings(this.memoryService) : {};
    return {
      ...memory,
      "notes.search": async (args: Json): Promise<ToolResult> => {
        const query = String((args as { query?: string }).query || "");
        const hits = notes.search(query).slice(0, 12) as Array<{ page_id?: string }>;
        return { ok: true, data: { hits: hits as unknown as Json[] }, evidence: hits.flatMap((hit) => hit.page_id ? [{ kind: "record" as const, value: hit.page_id }] : []) };
      },
      "notes.read": async (args: Json): Promise<ToolResult> => {
        const pageId = String((args as { pageId?: string }).pageId || ""); const page = notes.getPage(pageId);
        return page ? { ok: true, data: { pageId, title: String(page.title || "") }, evidence: [{ kind: "record", value: pageId }] } : { ok: false, error: { code: "FILE_NOT_FOUND", message: "The requested note no longer exists." } };
      },
      "notes.create": async (args: Json): Promise<ToolResult> => {
        const payload = args as { title: string; markdown: string };
        const page = notes.createPage({ title: payload.title, markdown: payload.markdown });
        return { ok: Boolean(page?.id), data: { pageId: String(page?.id || "") }, evidence: page?.id ? [{ kind: "record", value: String(page.id) }] : [] };
      },
      "browser.search": async (args: Json): Promise<ToolResult> => {
        const outcome = await runWebSearchResearch({ query: String((args as { query?: string }).query || ""), maxResults: 6, fetchTop: 3 });
        const urls = outcome.ok ? outcome.urls.filter((url): url is string => typeof url === "string") : [];
        return outcome.ok ? { ok: true, data: { urls }, evidence: urls.map((value) => ({ kind: "url" as const, value })) } : { ok: false, error: { code: "NETWORK_ERROR", message: outcome.error?.message || "Search failed.", retryable: true } };
      },
      "browser.inspect": async (): Promise<ToolResult> => {
        try {
          const observation = await getManagedBrowserObservation();
          const fingerprint = (observation as { page?: { fingerprint?: string; url?: string } })?.page?.fingerprint
            || (observation as { page?: { url?: string } })?.page?.url || "observation";
          return { ok: true, data: observation as unknown as Json, evidence: [{ kind: "observation", value: fingerprint }] };
        } catch (error) {
          return { ok: false, error: { code: "NETWORK_ERROR", message: error instanceof Error ? error.message : "The browser could not be observed.", retryable: true } };
        }
      },
      "browser.navigate": async (args: Json): Promise<ToolResult> => {
        const url = String((args as { url?: string }).url || "");
        try {
          const state = await navigateManagedBrowser(url);
          const finalUrl = (state as { url?: string })?.url || url;
          return { ok: true, data: state as unknown as Json, evidence: [{ kind: "url", value: finalUrl }] };
        } catch (error) {
          return { ok: false, error: { code: "NETWORK_ERROR", message: error instanceof Error ? error.message : "Navigation failed.", retryable: true } };
        }
      },
      "browser.action": async (args: Json): Promise<ToolResult> => {
        const action = (args as { action?: BrowserAction }).action;
        if (!action || typeof action !== "object" || !("type" in action)) {
          return { ok: false, error: { code: "INVALID_ARGUMENTS", message: "A browser action requires a type." } };
        }
        try {
          const result = await actOnManagedBrowser(action);
          const verified = Boolean((result as { verification?: { verified?: boolean } })?.verification?.verified ?? true);
          return {
            ok: verified,
            data: result as unknown as Json,
            evidence: [{ kind: "observation", value: `${action.type}:${Date.now()}` }],
            ...(verified ? {} : { error: { code: "VERIFICATION_FAILED", message: "The browser did not reach the expected state after this action." } }),
          };
        } catch (error) {
          return { ok: false, error: { code: "ELEMENT_NOT_FOUND", message: error instanceof Error ? error.message : "The browser action failed.", retryable: true } };
        }
      },
      "files.list": filesList,
      "files.read": filesRead,
      "files.write": filesWrite,
      "files.move": filesMove,
      "files.delete": filesDelete,
      "terminal.run": terminalRun,
      "git.status": gitStatus,
      "git.diff": gitDiff,
      "git.commit": gitCommit,
    };
  }
  private async verify(toolId: string, result: ToolResult) {
    if (!result.evidence?.length) return { ok: false, reason: "The tool returned no independently checkable evidence." };
    if (toolId === "notes.create" || toolId === "notes.read") {
      const id = result.evidence.find((item) => item.kind === "record")?.value;
      return { ok: Boolean(id && notes.getPage(id)), evidence: result.evidence, reason: "The note could not be reopened after the operation." };
    }
    if (toolId === "browser.search") return { ok: result.evidence.some((item) => item.kind === "url" && /^https?:\/\//.test(item.value)), evidence: result.evidence, reason: "Search returned no valid source URL." };
    if (toolId === "files.write" || toolId === "files.move") {
      const target = result.evidence.find((item) => item.kind === "file")?.value;
      return { ok: Boolean(target && await pathExists(target)), evidence: result.evidence, reason: "The file was not present after the operation." };
    }
    if (toolId === "files.delete") {
      const target = result.evidence.find((item) => item.kind === "record")?.value;
      return { ok: Boolean(target && !(await pathExists(target))), evidence: result.evidence, reason: "The file still exists after the delete." };
    }
    return { ok: true, evidence: result.evidence };
  }
}
