import type { MemoryService } from "./service";
import type { Json, ToolResult } from "../clyra-agent/core";
import type { MemoryCategory, MemoryKind } from "./store";

/**
 * Memory capabilities exposed to the Clyra agent runtime (Missions, MCP
 * bridge). These are typed tools backed by the validated MemoryService —
 * the model can never write arbitrary paths or run unvalidated SQL.
 */

const KIND_SET: MemoryKind[] = ["user", "agent", "project", "session"];
const CATEGORY_SET: MemoryCategory[] = ["profile", "preference", "fact", "goal", "lesson", "decision", "workflow", "technical", "correction", "recovery"];

function str(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

export function memoryToolBindings(service: MemoryService): Record<string, (args: Json) => Promise<ToolResult>> {
  return {
    "memory.search": async (args: Json): Promise<ToolResult> => {
      const record = args as Record<string, unknown>;
      const kind = KIND_SET.includes(record.kind as MemoryKind) ? (record.kind as MemoryKind) : undefined;
      const scope = str(record.scope);
      const hits = service.search(str(record.query), { kind, scope: scope || undefined, limit: 10 });
      return {
        ok: true,
        data: { hits: hits.map((hit) => ({ id: hit.id, kind: hit.kind, category: hit.category, scope: hit.scope, content: hit.content, rank: Math.round(hit.rank * 100) / 100 })) as unknown as Json },
        evidence: hits.map((hit) => ({ kind: "record" as const, value: hit.id })),
      };
    },
    "memory.list": async (args: Json): Promise<ToolResult> => {
      const record = args as Record<string, unknown>;
      const kind = KIND_SET.includes(record.kind as MemoryKind) ? (record.kind as MemoryKind) : undefined;
      const category = CATEGORY_SET.includes(record.category as MemoryCategory) ? (record.category as MemoryCategory) : undefined;
      const entries = service.listEntries({ kind, category, scope: str(record.scope) || undefined, limit: 50 });
      return {
        ok: true,
        data: { entries: entries.map((entry) => ({ id: entry.id, kind: entry.kind, category: entry.category, scope: entry.scope, content: entry.content })) as unknown as Json },
        evidence: entries.map((entry) => ({ kind: "record" as const, value: entry.id })),
      };
    },
    "memory.add": async (args: Json): Promise<ToolResult> => {
      const record = args as Record<string, unknown>;
      const kind = KIND_SET.includes(record.kind as MemoryKind) ? (record.kind as MemoryKind) : "user";
      const category = CATEGORY_SET.includes(record.category as MemoryCategory) ? (record.category as MemoryCategory) : "fact";
      const result = service.add({
        kind,
        category,
        scope: str(record.scope) || undefined,
        content: str(record.content),
        source: "agent-tool",
        explicit: true,
        projectRef: str(record.projectRef) || null,
        reason: "agent memory.add",
      });
      if (!result.ok) return { ok: false, error: { code: "INVALID_ARGUMENTS", message: result.error || "Memory write failed." } };
      return { ok: true, data: { id: result.entry!.id } as unknown as Json, evidence: [{ kind: "record" as const, value: result.entry!.id }] };
    },
    "memory.patch": async (args: Json): Promise<ToolResult> => {
      const record = args as Record<string, unknown>;
      const result = service.patch({ id: str(record.id) || undefined, match: str(record.match) || undefined, content: str(record.content) || undefined });
      if (!result.ok) return { ok: false, error: { code: "INVALID_ARGUMENTS", message: result.error || "Patch failed." } };
      return { ok: true, data: { id: result.entry!.id, content: result.entry!.content } as unknown as Json, evidence: [{ kind: "record" as const, value: result.entry!.id }] };
    },
    "memory.remove": async (args: Json): Promise<ToolResult> => {
      const result = service.remove(str((args as Record<string, unknown>).id));
      if (!result.ok) return { ok: false, error: { code: "FILE_NOT_FOUND", message: result.error || "Entry not found." } };
      return { ok: true, data: { removed: true } as unknown as Json, evidence: [{ kind: "record" as const, value: str((args as Record<string, unknown>).id) }] };
    },
    "memory.inspect": async (args: Json): Promise<ToolResult> => {
      const entry = service.getEntry(str((args as Record<string, unknown>).id));
      if (!entry) return { ok: false, error: { code: "FILE_NOT_FOUND", message: "Entry not found." } };
      return { ok: true, data: entry as unknown as Json, evidence: [{ kind: "record" as const, value: entry.id }] };
    },
    "memory.history": async (args: Json): Promise<ToolResult> => {
      const versions = service.history(str((args as Record<string, unknown>).id));
      return { ok: true, data: { versions: versions.map((v) => ({ revision: v.revision, content: v.content, reason: v.reason, createdAt: v.createdAt })) as unknown as Json }, evidence: [] };
    },
    "memory.restore": async (args: Json): Promise<ToolResult> => {
      const record = args as Record<string, unknown>;
      const result = service.restore(str(record.id), Number(record.revision));
      if (!result.ok) return { ok: false, error: { code: "FILE_NOT_FOUND", message: result.error || "Restore failed." } };
      return { ok: true, data: { id: result.entry!.id } as unknown as Json, evidence: [{ kind: "record" as const, value: result.entry!.id }] };
    },
    "memory.propose": async (args: Json): Promise<ToolResult> => {
      const record = args as Record<string, unknown>;
      const id = service.proposeChange({
        targetType: "memory",
        action: "create",
        proposed: { kind: "user", category: "fact", content: str(record.content), scope: "user", source: "agent-tool" },
        rationale: str(record.rationale) || "Proposed by the agent.",
        source: "agent",
      });
      return { ok: true, data: { pendingId: id } as unknown as Json, evidence: [{ kind: "record" as const, value: id }] };
    },
    "skill.list": async (args: Json): Promise<ToolResult> => {
      const skills = service.listSkills({ status: "active", query: str((args as Record<string, unknown>).query) || undefined });
      return { ok: true, data: { skills: skills.map((skill) => ({ id: skill.id, description: skill.description, version: skill.version })) as unknown as Json }, evidence: skills.map((skill) => ({ kind: "record" as const, value: skill.id })) };
    },
    "skill.read": async (args: Json): Promise<ToolResult> => {
      const record = args as Record<string, unknown>;
      const result = service.readSkill(str(record.name));
      if (!result.skill) return { ok: false, error: { code: "FILE_NOT_FOUND", message: result.error || "Skill not found." } };
      return { ok: true, data: { name: result.skill.id, description: result.skill.description, content: result.content } as unknown as Json, evidence: [{ kind: "record" as const, value: result.skill.id }] };
    },
    "skill.create": async (args: Json): Promise<ToolResult> => {
      const record = args as Record<string, unknown>;
      const result = service.createSkill({ name: str(record.name), description: str(record.description), content: str(record.content), source: "agent-tool" });
      if (!result.ok && !result.pendingId) return { ok: false, error: { code: "INVALID_ARGUMENTS", message: result.error || "Skill create failed." } };
      return { ok: true, data: { id: result.skill?.id || null, pendingId: result.pendingId || null } as unknown as Json, evidence: result.skill ? [{ kind: "record" as const, value: result.skill.id }] : [] };
    },
    "skill.update": async (args: Json): Promise<ToolResult> => {
      const record = args as Record<string, unknown>;
      const result = service.updateSkill(str(record.name), { description: str(record.description) || undefined, content: str(record.content) || undefined, reason: "agent-tool" });
      if (!result.ok && !result.pendingId) return { ok: false, error: { code: "INVALID_ARGUMENTS", message: result.error || "Skill update failed." } };
      return { ok: true, data: { id: result.skill?.id || null, pendingId: result.pendingId || null } as unknown as Json, evidence: result.skill ? [{ kind: "record" as const, value: result.skill.id }] : [] };
    },
    "skill.archive": async (args: Json): Promise<ToolResult> => {
      const result = service.archiveSkill(str((args as Record<string, unknown>).name));
      if (!result.ok) return { ok: false, error: { code: "FILE_NOT_FOUND", message: result.error || "Skill not found." } };
      return { ok: true, data: { archived: true } as unknown as Json, evidence: [] };
    },
    "session.search": async (args: Json): Promise<ToolResult> => {
      const record = args as Record<string, unknown>;
      const hits = service.searchSessions(str(record.query), 5);
      return {
        ok: true,
        data: { sessions: hits.map((hit) => ({ id: hit.session.id, title: hit.session.title, summary: hit.session.summary, snippet: hit.snippet })) as unknown as Json },
        evidence: hits.map((hit) => ({ kind: "record" as const, value: hit.session.id })),
      };
    },
  };
}
