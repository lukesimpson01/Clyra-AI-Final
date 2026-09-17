import path from "node:path";
import { clyraDataPath } from "../runtime-paths";
import { ensureEarthHost } from "../earth/host";
import * as notes from "../notes/store";
import { runWebSearchResearch } from "../research/research-handlers";
import { createClyraToolRegistry, routeObjective } from "./catalog";
import { MissionRuntime, type Json, type MissionPlan, type ToolResult } from "./core";
import { MissionStore } from "./mission-store";

/** Convert a user objective into the literal place name the Earth geocoder
 * understands. Category search stays out of this path because the installed
 * provider is an exact-place geocoder, not a nearby-business API. */
function geocodeQuery(objective: string) {
  return objective
    .replace(/^\s*(?:where\s+is|locate|find\s+the\s+(?:address|coordinates?)\s+(?:for|of)|get\s+(?:the\s+)?(?:address|coordinates?)\s+(?:for|of)|directions?\s+to)\s+/i, "")
    .replace(/[?!.]+\s*$/, "")
    .trim()
    .slice(0, 200);
}

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
  route(prompt: string) {
    const tools = createClyraToolRegistry(this.bindings());
    return { decision: routeObjective(prompt, new Set(tools.map((tool) => tool.id))), tools: tools.map(({ id, name, category, riskLevel, permissions }) => ({ id, name, category, riskLevel, permissions })) };
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
    if (noteArtifact) {
      const title = note ? (note[1].replace(/[.?!]+$/, "").slice(0, 180) || "Untitled note") : requestedArtifactTitle(text);
      const body = note ? (text.slice(note[0].length).replace(/^add\s+/i, "").trim() || text) : text;
      return { objective: text, steps: [{ id: "note", description: "Create the requested note", toolId: "notes.create", args: { title, markdown: body }, dependsOn: [], status: "pending" }] };
    }
    if (/\b(?:where is|locate|coordinates?|address|directions? to)\b/i.test(text)) {
      const query = geocodeQuery(text);
      if (!query) return null;
      return { objective: text, steps: [{ id: "places", description: "Find verified places", toolId: "maps.search", args: { query }, dependsOn: [], status: "pending" }] };
    }
    return null;
  }
  async execute(input: { missionId?: string; projectId?: string; plan: MissionPlan; approvedStepIds?: string[] }) {
    const approved = new Set(input.approvedStepIds || []);
    const runtime = new MissionRuntime(input.plan, {
      tools: createClyraToolRegistry(this.bindings()),
      requestApproval: async (step) => approved.has(step.id),
      verify: async (step, result) => this.verify(step.toolId, result),
      recover: async ({ error }) => error.code === "NETWORK_ERROR" || error.code === "RATE_LIMIT" || error.code === "TOOL_TIMEOUT" ? "retry" : "fail",
    }, input.missionId, input.projectId);
    const record = await runtime.run();
    this.store.save(record);
    return record;
  }
  interrupted() { return this.store.interrupted(); }
  private bindings() {
    return {
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
      "maps.search": async (args: Json, context): Promise<ToolResult> => {
        const query = String((args as { query?: string }).query || "").trim().slice(0, 200);
        const earth = await ensureEarthHost();
        if (!earth.ok || !earth.url) {
          return { ok: false, error: { code: "NETWORK_ERROR", message: earth.reason || "Clyra Earth is unavailable.", retryable: true } };
        }
        const target = new URL("/api/geocode", earth.url);
        target.searchParams.set("q", query);
        const response = await fetch(target, { headers: { Accept: "application/json" }, signal: context.signal });
        if (!response.ok) {
          return { ok: false, error: { code: response.status === 429 ? "RATE_LIMIT" : "NETWORK_ERROR", message: `Clyra Earth place search failed (${response.status}).`, retryable: response.status >= 500 || response.status === 429 } };
        }
        const payload = await response.json() as { results?: unknown[] };
        const places = (Array.isArray(payload.results) ? payload.results : []).flatMap((candidate) => {
          const item = candidate as { formatted_address?: unknown; types?: unknown; geometry?: { location?: { lat?: unknown; lng?: unknown } }; address_components?: Array<{ long_name?: unknown }> };
          const lat = Number(item.geometry?.location?.lat);
          const lng = Number(item.geometry?.location?.lng);
          const name = typeof item.address_components?.[0]?.long_name === "string"
            ? item.address_components[0].long_name.trim()
            : typeof item.formatted_address === "string" ? item.formatted_address.trim() : "";
          if (!name || !Number.isFinite(lat) || !Number.isFinite(lng)) return [];
          return [{ name, address: typeof item.formatted_address === "string" ? item.formatted_address : name, lat, lng, types: Array.isArray(item.types) ? item.types.filter((type): type is string => typeof type === "string").slice(0, 6) : [] }];
        }).slice(0, 12);
        return places.length
          ? { ok: true, data: { places }, evidence: places.map((place) => ({ kind: "observation" as const, value: `earth:${place.lat},${place.lng}:${place.name}` })) }
          : { ok: false, error: { code: "FILE_NOT_FOUND", message: "Clyra Earth returned no verifiable places for that query." } };
      },
      "browser.search": async (args: Json): Promise<ToolResult> => {
        const outcome = await runWebSearchResearch({ query: String((args as { query?: string }).query || ""), maxResults: 6, fetchTop: 3 });
        const urls = outcome.ok ? outcome.urls.filter((url): url is string => typeof url === "string") : [];
        return outcome.ok ? { ok: true, data: { urls }, evidence: urls.map((value) => ({ kind: "url" as const, value })) } : { ok: false, error: { code: "NETWORK_ERROR", message: outcome.error?.message || "Search failed.", retryable: true } };
      },
    };
  }
  private async verify(toolId: string, result: ToolResult) {
    if (!result.evidence?.length) return { ok: false, reason: "The tool returned no independently checkable evidence." };
    if (toolId === "notes.create" || toolId === "notes.read") {
      const id = result.evidence.find((item) => item.kind === "record")?.value;
      return { ok: Boolean(id && notes.getPage(id)), evidence: result.evidence, reason: "The note could not be reopened after the operation." };
    }
    if (toolId === "browser.search") return { ok: result.evidence.some((item) => item.kind === "url" && /^https?:\/\//.test(item.value)), evidence: result.evidence, reason: "Search returned no valid source URL." };
    if (toolId === "maps.search") {
      const places = (result.data as { places?: Array<{ lat?: number; lng?: number }> } | undefined)?.places || [];
      return { ok: places.length > 0 && places.every((place) => Number.isFinite(place.lat) && Number.isFinite(place.lng)), evidence: result.evidence, reason: "Clyra Earth returned no places with valid coordinates." };
    }
    return { ok: true, evidence: result.evidence };
  }
}
