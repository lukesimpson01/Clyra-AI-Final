import { EventEmitter } from "node:events";
import fs from "node:fs";
import path from "node:path";
import {
  openMemoryDb,
  closeMemoryDb,
  newId,
  nowIso,
  skillsDir,
  DEFAULT_POLICIES,
  type MemoryEntry,
  type MemoryKind,
  type MemoryCategory,
  type MemoryPolicies,
  type MemorySession,
  type MemoryVersion,
  type PendingChange,
  type Sensitivity,
  type SkillRecord,
  type SkillVersion,
  type AuditEventRow,
  type LearningJob,
} from "./store";
import { syncIdentityFiles, setSoulPersona, getSoulDoc, renderUserDoc, renderMemoryDoc } from "./soul";

export type MemoryAddInput = {
  kind?: MemoryKind;
  scope?: string;
  category?: MemoryCategory;
  content: string;
  source?: string;
  confidence?: number;
  sensitivity?: Sensitivity;
  pinned?: boolean;
  expiresAt?: string | null;
  projectRef?: string | null;
  sessionRef?: string | null;
  /** Skip the durable-content gate (used by tools with explicit user intent). */
  explicit?: boolean;
  /** When set, an existing entry matching this id is updated instead of duplicated. */
  id?: string;
  reason?: string;
};

export type MemorySearchFilters = {
  kind?: MemoryKind;
  scope?: string;
  category?: MemoryCategory;
  state?: string;
  projectRef?: string;
  minConfidence?: number;
  limit?: number;
};

export type SearchHit = MemoryEntry & { rank: number; snippet: string };

const SECRET_PATTERNS = [
  /\b(sk|rk|pk)-(live|test)-[a-zA-Z0-9]{8,}\b/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bgh[pousr]_[a-zA-Z0-9]{20,}\b/g,
  /\bxox[baprs]-[a-zA-Z0-9-]{10,}\b/g,
  /\bBearer\s+[a-zA-Z0-9._~+/=-]{16,}\b/gi,
  /\beyJ[a-zA-Z0-9_-]{8,}\.[a-zA-Z0-9_-]{8,}\.[a-zA-Z0-9_-]{8,}\b/g,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
];

/** Patterns that keep the field name and redact only the value. */
const SECRET_VALUE_PATTERNS = [
  /\b(password|passwd|secret|token|api[_-]?key)(\s*[:=]\s*)\S{4,}/gi,
];

export function redactSecrets(text: string): string {
  let out = String(text);
  for (const pattern of SECRET_PATTERNS) out = out.replace(pattern, "[redacted]");
  for (const pattern of SECRET_VALUE_PATTERNS) out = out.replace(pattern, "$1$2[redacted]");
  return out;
}

function isDurableStatement(text: string): boolean {
  return /\b(remember|prefers?|always|never|my name is|i use|i work|i like|i dislike|i am|i'm|favourite|favorite|don'?t|stop)\b/i.test(text);
}

export function clampConfidence(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0.5;
  return Math.max(0, Math.min(1, n));
}

export class MemoryService extends EventEmitter {
  private db = openMemoryDb();
  private policiesCache: MemoryPolicies | null = null;

  // ---------------------------------------------------------------- policies
  getPolicies(): MemoryPolicies {
    if (!this.policiesCache) {
      const rows = this.db.prepare("SELECT key, value FROM memory_settings").all() as Array<{ key: string; value: string }>;
      this.policiesCache = { ...DEFAULT_POLICIES };
      for (const row of rows) this.policiesCache[row.key] = row.value;
    }
    return { ...this.policiesCache };
  }

  setPolicy(key: string, value: string) {
    this.db.prepare("INSERT INTO memory_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=datetime('now')").run(key, String(value));
    this.policiesCache = null;
    this.audit("memory.policy.updated", "policy", key, JSON.stringify({ value: String(value) }));
  }

  // ------------------------------------------------------------------- audit
  audit(event: string, entityType?: string, entityId?: string, detail?: unknown) {
    try {
      this.db.prepare("INSERT INTO audit_events (event, entity_type, entity_id, detail) VALUES (?, ?, ?, ?)").run(
        event,
        entityType || null,
        entityId || null,
        detail === undefined ? null : redactSecrets(JSON.stringify(detail)),
      );
    } catch {
      /* audit must never break the operation it records */
    }
    this.emit("memory.event", { event, entityType, entityId });
  }

  recentAudit(limit = 100): AuditEventRow[] {
    return this.db.prepare("SELECT * FROM audit_events ORDER BY id DESC LIMIT ?").all(limit) as AuditEventRow[];
  }

  // ------------------------------------------------------------ entry access
  private rowToEntry(row: Record<string, unknown>): MemoryEntry {
    return {
      id: String(row.id),
      kind: row.kind as MemoryKind,
      scope: String(row.scope),
      category: row.category as MemoryCategory,
      content: String(row.content),
      source: String(row.source),
      confidence: Number(row.confidence),
      sensitivity: row.sensitivity as Sensitivity,
      state: row.state as MemoryEntry["state"],
      pinned: Number(row.pinned),
      expiresAt: row.expires_at ? String(row.expires_at) : null,
      projectRef: row.project_ref ? String(row.project_ref) : null,
      sessionRef: row.session_ref ? String(row.session_ref) : null,
      supersededBy: row.superseded_by ? String(row.superseded_by) : null,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
      revision: Number(row.revision),
    };
  }

  getEntry(id: string): MemoryEntry | null {
    const row = this.db.prepare("SELECT * FROM memory_entries WHERE id = ?").get(id) as Record<string, unknown> | undefined;
    return row ? this.rowToEntry(row) : null;
  }

  listEntries(filters: MemorySearchFilters = {}): MemoryEntry[] {
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (filters.kind) { clauses.push("kind = ?"); params.push(filters.kind); }
    if (filters.scope) { clauses.push("scope = ?"); params.push(filters.scope); }
    if (filters.category) { clauses.push("category = ?"); params.push(filters.category); }
    if (filters.state) { clauses.push("state = ?"); params.push(filters.state); }
    if (filters.projectRef) { clauses.push("project_ref = ?"); params.push(filters.projectRef); }
    if (filters.minConfidence !== undefined) { clauses.push("confidence >= ?"); params.push(filters.minConfidence); }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const limit = Math.max(1, Math.min(500, filters.limit || 200));
    const rows = this.db.prepare(`SELECT * FROM memory_entries ${where} ORDER BY pinned DESC, updated_at DESC LIMIT ?`).all(...params, limit) as Array<Record<string, unknown>>;
    return rows.map((row) => this.rowToEntry(row));
  }

  // ------------------------------------------------------------------- add
  add(input: MemoryAddInput): { ok: boolean; entry?: MemoryEntry; error?: string; duplicate?: boolean } {
    const content = redactSecrets(String(input.content || "").trim()).slice(0, 4000);
    if (!content) return { ok: false, error: "Memory content is empty." };
    if (!input.explicit && !isDurableStatement(content)) {
      return { ok: false, error: "Not saved: this does not look like durable information. Use \"remember\" phrasing for explicit saves." };
    }
    const kind = input.kind || "user";
    const scope = input.scope || (kind === "project" && input.projectRef ? `project:${input.projectRef}` : kind === "agent" ? "agent" : "user");
    const category = input.category || "fact";
    const confidence = clampConfidence(input.confidence ?? 0.7);
    const sensitivity = input.sensitivity || "low";

    const save = this.db.transaction((entryId: string): { ok: boolean; entry?: MemoryEntry; error?: string; duplicate?: boolean } => {
      const existing = entryId
        ? this.db.prepare("SELECT * FROM memory_entries WHERE id = ?").get(entryId) as Record<string, unknown> | undefined
        : undefined;
      const now = nowIso();
      if (existing) {
        const nextRevision = Number(existing.revision) + 1;
        this.db.prepare("INSERT INTO memory_versions (entry_id, revision, content, category, kind, scope, confidence, reason) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(
          entryId, Number(existing.revision), String(existing.content), String(existing.category), String(existing.kind), String(existing.scope), Number(existing.confidence), "update",
        );
        this.db.prepare(`UPDATE memory_entries SET content=?, category=?, kind=?, scope=?, confidence=?, sensitivity=?, state='active', pinned=?, expires_at=?, project_ref=?, session_ref=?, source=?, updated_at=?, revision=? WHERE id=?`).run(
          content, category, kind, scope, confidence, sensitivity, input.pinned ? 1 : 0, input.expiresAt || null, input.projectRef || null, input.sessionRef || null, input.source || "conversation", now, nextRevision, entryId,
        );
        this.ftsDelete(entryId);
        this.ftsInsert(entryId, content, category, kind, scope);
        this.audit("memory.entry.updated", "memory", entryId, { category, kind, scope, revision: nextRevision });
        this.syncDocs();
        return { ok: true, entry: this.getEntry(entryId) || undefined };
      }

      const id = newId("mem");
      this.db.prepare(`INSERT INTO memory_entries (id, kind, scope, category, content, source, confidence, sensitivity, state, pinned, expires_at, project_ref, session_ref) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)`).run(
        id, kind, scope, category, content, input.source || "conversation", confidence, sensitivity, input.pinned ? 1 : 0, input.expiresAt || null, input.projectRef || null, input.sessionRef || null,
      );
      this.db.prepare("INSERT INTO memory_versions (entry_id, revision, content, category, kind, scope, confidence, reason) VALUES (?, 1, ?, ?, ?, ?, ?, ?)").run(id, content, category, kind, scope, confidence, input.reason || "create");
      this.ftsInsert(id, content, category, kind, scope);
      this.audit("memory.entry.created", "memory", id, { category, kind, scope });
      this.syncDocs();
      return { ok: true, entry: this.getEntry(id) || undefined };
    });

    const result = save(input.id);
    this.emit("memory.changed");
    return result;
  }

  /** Store a fact if no sufficiently similar entry exists; otherwise update
   * the best match (preference reinforcement instead of duplicates). */
  upsertPreference(input: MemoryAddInput & { similarity?: number }): { ok: boolean; entry?: MemoryEntry; error?: string; updated?: boolean } {
    const content = String(input.content || "").trim();
    const similar = this.similarEntries(content, { kind: input.kind, category: input.category, scope: input.scope }, 1);
    if (similar.length && similar[0]!.similarity >= (input.similarity ?? 0.72)) {
      const result = this.add({ ...input, id: similar[0]!.entry.id });
      return result.ok ? { ok: true, entry: result.entry, updated: true } : result;
    }
    const result = this.add(input);
    return { ok: result.ok, entry: result.entry, error: result.error, updated: false };
  }

  // ------------------------------------------------------------------ patch
  /**
   * Patch semantics: the caller provides either an unambiguous entry id, or a
   * `match` sentence that must resolve to exactly one entry. Ambiguous or
   * empty matches are rejected — unrelated content is never rewritten.
   */
  patch(input: { id?: string; match?: string; content?: string; category?: MemoryCategory; confidence?: number; reason?: string }): { ok: boolean; entry?: MemoryEntry; error?: string } {
    let entry: MemoryEntry | null = null;
    if (input.id) entry = this.getEntry(input.id);
    else if (input.match) {
      const matches = this.search(input.match, { limit: 3, includeInactive: true }).filter((hit) => hit.state === "active" || hit.state === "archived");
      if (matches.length === 0) return { ok: false, error: "No matching entry found to patch." };
      if (matches.length > 1 && matches[0]!.rank > 0 && matches[1]!.rank > 0 && Math.abs(matches[0]!.rank - matches[1]!.rank) < 0.15) {
        return { ok: false, error: "Patch target is ambiguous. Provide the exact entry id from memory_list." };
      }
      entry = matches[0]!;
    }
    if (!entry) return { ok: false, error: "Patch target not found." };
    if (entry.scope === "identity") return { ok: false, error: "Protected identity cannot be patched through memory." };
    const content = input.content !== undefined ? redactSecrets(String(input.content).trim()).slice(0, 4000) : entry.content;
    if (!content) return { ok: false, error: "Patched content is empty." };
    const next = {
      ...input,
      id: entry.id,
      content,
      category: input.category || entry.category,
      confidence: input.confidence !== undefined ? clampConfidence(input.confidence) : entry.confidence,
      reason: input.reason || "patch",
    };
    return this.add(next);
  }

  // --------------------------------------------------------------- versions
  history(entryId: string): MemoryVersion[] {
    return this.db.prepare("SELECT * FROM memory_versions WHERE entry_id = ? ORDER BY revision DESC").all(entryId) as MemoryVersion[];
  }

  restore(entryId: string, revision: number): { ok: boolean; entry?: MemoryEntry; error?: string } {
    const version = this.db.prepare("SELECT * FROM memory_versions WHERE entry_id = ? AND revision = ?").get(entryId, revision) as MemoryVersion | undefined;
    if (!version) return { ok: false, error: "Revision not found." };
    return this.add({
      id: entryId,
      content: version.content,
      category: version.category,
      kind: version.kind,
      scope: version.scope,
      confidence: version.confidence,
      reason: `restore revision ${revision}`,
    });
  }

  // ---------------------------------------------------------------- remove
  remove(entryId: string): { ok: boolean; error?: string } {
    const entry = this.getEntry(entryId);
    if (!entry) return { ok: false, error: "Entry not found." };
    if (entry.state === "deleted") return { ok: true };
    const save = this.db.transaction(() => {
      const nextRevision = entry.revision + 1;
      this.db.prepare("INSERT INTO memory_versions (entry_id, revision, content, category, kind, scope, confidence, reason) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(
        entryId, entry.revision, entry.content, entry.category, entry.kind, entry.scope, entry.confidence, "delete",
      );
      this.db.prepare("UPDATE memory_entries SET state='deleted', updated_at=?, revision=? WHERE id=?").run(nowIso(), nextRevision, entryId);
      this.ftsDelete(entryId);
      this.audit("memory.entry.deleted", "memory", entryId, { category: entry.category });
      this.syncDocs();
    });
    save();
    this.emit("memory.changed");
    return { ok: true };
  }

  /** Hard delete: remove rows, versions and FTS content (used by forget-all). */
  purgeEntry(entryId: string) {
    const entry = this.getEntry(entryId);
    this.db.prepare("DELETE FROM memory_versions WHERE entry_id = ?").run(entryId);
    this.db.prepare("DELETE FROM memory_entries WHERE id = ?").run(entryId);
    this.ftsDelete(entryId);
    if (entry) this.audit("memory.entry.purged", "memory", entryId, { category: entry.category, content: "[content purged]" });
  }

  // ------------------------------------------------------------------ search
  private ftsInsert(id: string, content: string, category: string, kind: string, scope: string) {
    this.db.prepare("INSERT INTO memory_fts (id, content, category, kind, scope) VALUES (?, ?, ?, ?, ?)").run(id, content, category, kind, scope);
  }

  private ftsDelete(id: string) {
    this.db.prepare("DELETE FROM memory_fts WHERE id = ?").run(id);
  }

  /** Token-overlap + FTS hybrid search with deterministic ranking. */
  search(query: string, filters: MemorySearchFilters & { includeInactive?: boolean } = {}): SearchHit[] {
    const q = String(query || "").trim().slice(0, 400);
    const limit = Math.max(1, Math.min(100, filters.limit || 10));
    const clauses: string[] = ["state = 'active'"];
    const params: unknown[] = [];
    if (!filters.includeInactive) { /* state clause already added */ }
    if (filters.kind) { clauses.push("kind = ?"); params.push(filters.kind); }
    if (filters.scope) { clauses.push("scope = ?"); params.push(filters.scope); }
    if (filters.category) { clauses.push("category = ?"); params.push(filters.category); }
    if (filters.projectRef) { clauses.push("project_ref = ?"); params.push(filters.projectRef); }
    const rows = this.db.prepare(`SELECT * FROM memory_entries WHERE ${clauses.join(" AND ")} ORDER BY pinned DESC, updated_at DESC LIMIT 400`).all(...params) as Array<Record<string, unknown>>;

    const queryTokens = new Set(q.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 2));
    const ranked = rows.map((row) => {
      const entry = this.rowToEntry(row);
      const text = entry.content.toLowerCase();
      let rank = 0;
      if (q && text.includes(q.toLowerCase())) rank += 2;
      for (const token of queryTokens) if (text.includes(token)) rank += 0.4;
      if (entry.pinned) rank += 0.5;
      rank += entry.confidence * 0.2;
      const recency = Math.max(0, 1 - (Date.now() - Date.parse(entry.updatedAt)) / (1000 * 60 * 60 * 24 * 90));
      rank += recency * 0.2;
      return { ...entry, rank, snippet: entry.content.slice(0, 220) };
    });
    return ranked
      .filter((hit) => q ? hit.rank > 0.3 : true)
      .sort((a, b) => b.rank - a.rank)
      .slice(0, limit);
  }

  /** Find entries whose content is similar enough to be considered the same fact. */
  similarEntries(text: string, filters: MemorySearchFilters = {}, limit = 5): Array<{ entry: MemoryEntry; similarity: number }> {
    const a = new Set(text.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 3));
    if (!a.size) return [];
    const scored: Array<{ entry: MemoryEntry; similarity: number }> = [];
    for (const entry of this.listEntries({ ...filters, limit: 300 })) {
      if (entry.state !== "active") continue;
      const b = new Set(entry.content.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 3));
      const intersection = [...a].filter((t) => b.has(t)).length;
      const similarity = intersection / Math.max(1, Math.min(a.size, b.size));
      if (similarity >= 0.5) scored.push({ entry, similarity });
    }
    return scored.sort((x, y) => y.similarity - x.similarity).slice(0, limit);
  }

  // ------------------------------------------------------------- profile
  /** Derived profile: canonical = active user entries with category 'profile'. */
  getProfile(): Record<string, string> {
    const profile: Record<string, string> = {};
    for (const entry of this.listEntries({ kind: "user", category: "profile", limit: 200 })) {
      const match = entry.content.match(/^([a-z_]+)\s*[:=]\s*(.+)$/i);
      if (!match) continue;
      profile[match[1]!.toLowerCase()] = redactSecrets(match[2]!.trim());
    }
    return profile;
  }

  setProfileField(field: string, value: string) {
    const raw = String(field || "").trim();
    if (!/^[a-zA-Z_][a-zA-Z0-9_]{0,39}$/.test(raw)) return { ok: false, error: "Invalid profile field." };
    const key = raw.toLowerCase();
    const clean = redactSecrets(String(value).trim()).slice(0, 300);
    const existing = this.listEntries({ kind: "user", category: "profile", limit: 200 }).find((entry) => entry.content.toLowerCase().startsWith(`${key}:`) || entry.content.toLowerCase().startsWith(`${key} =`));
    const content = `${key}: ${clean}`;
    const result = existing
      ? this.add({ id: existing.id, kind: "user", category: "profile", content, source: "settings", confidence: 1, reason: `profile field ${key}` })
      : this.add({ kind: "user", category: "profile", content, source: "settings", confidence: 1, reason: `profile field ${key}`, explicit: true });
    return result;
  }

  // ------------------------------------------------------------- sessions
  recordSession(input: { id: string; title?: string; projectRef?: string | null; messages?: Array<{ role: "user" | "assistant"; text: string }>; summary?: string | null }): { ok: boolean; session?: MemorySession } {
    const id = String(input.id || "").slice(0, 120);
    if (!id) return { ok: false };
    const save = this.db.transaction(() => {
      const existing = this.db.prepare("SELECT * FROM memory_sessions WHERE id = ?").get(id) as Record<string, unknown> | undefined;
      const now = nowIso();
      if (existing) {
        this.db.prepare("UPDATE memory_sessions SET title = COALESCE(?, title), project_ref = COALESCE(?, project_ref), summary = COALESCE(?, summary), updated_at = ? WHERE id = ?").run(
          input.title ? String(input.title).slice(0, 200) : null, input.projectRef || null, input.summary ? String(input.summary).slice(0, 4000) : null, now, id,
        );
      } else {
        this.db.prepare("INSERT INTO memory_sessions (id, title, project_ref, summary) VALUES (?, ?, ?, ?)").run(
          id, input.title ? String(input.title).slice(0, 200) : null, input.projectRef || null, input.summary ? String(input.summary).slice(0, 4000) : null,
        );
      }
      const insertMessage = this.db.prepare("INSERT INTO session_messages (session_id, role, text) VALUES (?, ?, ?)");
      const insertFts = this.db.prepare("INSERT INTO session_fts (session_id, text, role) VALUES (?, ?, ?)");
      for (const message of input.messages || []) {
        const text = redactSecrets(String(message.text || "")).slice(0, 6000);
        if (!text.trim()) continue;
        insertMessage.run(id, message.role, text);
        insertFts.run(id, text, message.role);
      }
    });
    save();
    this.emit("session.recorded");
    return { ok: true, session: this.getSession(id) || undefined };
  }

  getSession(id: string): MemorySession | null {
    const row = this.db.prepare("SELECT * FROM memory_sessions WHERE id = ?").get(id) as Record<string, unknown> | undefined;
    if (!row) return null;
    return { id: String(row.id), title: row.title ? String(row.title) : null, projectRef: row.project_ref ? String(row.project_ref) : null, summary: row.summary ? String(row.summary) : null, createdAt: String(row.created_at), updatedAt: String(row.updated_at) };
  }

  searchSessions(query: string, limit = 5): Array<{ session: MemorySession; snippet: string; rank: number }> {
    const q = String(query || "").trim().slice(0, 400);
    if (!q) return [];
    const tokens = q.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 2 && !/^(the|and|from|for|with|what|when|where|were|was|issue|problem|please|could|would|should)$/.test(t)).slice(0, 8);
    let hits: Array<{ session_id: string; text: string }> = [];
    try {
      const ftsQuery = tokens.map((t) => `"${t.replace(/"/g, '""')}"*`).join(" OR ");
      hits = this.db.prepare(`SELECT session_id, text FROM session_fts WHERE session_fts MATCH ? ORDER BY rank LIMIT 40`).all(ftsQuery) as Array<{ session_id: string; text: string }>;
    } catch {
      return [];
    }
    const bySession = new Map<string, { count: number; snippet: string }>();
    for (const hit of hits) {
      const current = bySession.get(hit.session_id) || { count: 0, snippet: "" };
      current.count += 1;
      if (!current.snippet) current.snippet = hit.text.slice(0, 200);
      bySession.set(hit.session_id, current);
    }
    const results: Array<{ session: MemorySession; snippet: string; rank: number }> = [];
    for (const [sessionId, meta] of bySession) {
      const session = this.getSession(sessionId);
      if (session) results.push({ session, snippet: meta.snippet, rank: meta.count });
    }
    return results.sort((a, b) => b.rank - a.rank).slice(0, limit);
  }

  sessionMessages(sessionId: string, limit = 40): Array<{ role: string; text: string; createdAt: string }> {
    const rows = this.db.prepare("SELECT role, text, created_at FROM session_messages WHERE session_id = ? ORDER BY id DESC LIMIT ?").all(sessionId, limit) as Array<{ role: string; text: string; created_at: string }>;
    return rows.map((row) => ({ role: row.role, text: row.text, createdAt: row.created_at })).reverse();
  }

  listSessions(limit = 50): MemorySession[] {
    const rows = this.db.prepare("SELECT * FROM memory_sessions ORDER BY updated_at DESC LIMIT ?").all(Math.max(1, Math.min(200, limit))) as Array<Record<string, unknown>>;
    return rows.map((row) => ({ id: String(row.id), title: row.title ? String(row.title) : null, projectRef: row.project_ref ? String(row.project_ref) : null, summary: row.summary ? String(row.summary) : null, createdAt: String(row.created_at), updatedAt: String(row.updated_at) }));
  }

  // ---------------------------------------------------------------- skills
  private skillDir(name: string) {
    return path.join(skillsDir(), name);
  }

  private writeSkillFile(skillId: string, content: string) {
    const dir = this.skillDir(skillId);
    fs.mkdirSync(dir, { recursive: true });
    const tmp = path.join(dir, "SKILL.md.tmp");
    fs.writeFileSync(tmp, content, "utf8");
    fs.renameSync(tmp, path.join(dir, "SKILL.md"));
  }

  listSkills(filters: { status?: string; query?: string } = {}): SkillRecord[] {
    let rows: Array<Record<string, unknown>>;
    if (filters.query) {
      const q = `%${String(filters.query).toLowerCase()}%`;
      rows = this.db.prepare("SELECT * FROM skills WHERE (name LIKE ? OR description LIKE ?) AND (? IS NULL OR status = ?) ORDER BY name LIMIT 100").all(q, q, filters.status || null, filters.status || null) as Array<Record<string, unknown>>;
    } else {
      rows = this.db.prepare("SELECT * FROM skills WHERE (? IS NULL OR status = ?) ORDER BY name LIMIT 100").all(filters.status || null, filters.status || null) as Array<Record<string, unknown>>;
    }
    return rows.map((row) => ({ id: String(row.id), name: String(row.name), description: String(row.description), version: Number(row.version), status: row.status as SkillRecord["status"], createdAt: String(row.created_at), updatedAt: String(row.updated_at) }));
  }

  getSkill(name: string): SkillRecord | null {
    const row = this.db.prepare("SELECT * FROM skills WHERE id = ?").get(name) as Record<string, unknown> | undefined;
    return row ? { id: String(row.id), name: String(row.name), description: String(row.description), version: Number(row.version), status: row.status as SkillRecord["status"], createdAt: String(row.created_at), updatedAt: String(row.updated_at) } : null;
  }

  readSkill(name: string): { skill?: SkillRecord; content?: string; error?: string } {
    const skill = this.getSkill(name);
    if (!skill) return { error: "Skill not found." };
    const version = this.db.prepare("SELECT * FROM skill_versions WHERE skill_id = ? ORDER BY version DESC LIMIT 1").get(name) as SkillVersion | undefined;
    if (!version) return { error: "Skill content is missing." };
    return { skill, content: version.content };
  }

  createSkill(input: { name: string; description: string; content: string; source?: string; apply?: boolean }): { ok: boolean; skill?: SkillRecord; pendingId?: string; error?: string } {
    const name = String(input.name || "").trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").slice(0, 60);
    if (!/^[a-z0-9][a-z0-9_-]{1,59}$/.test(name)) return { ok: false, error: "Skill name must be a safe slug (a-z, 0-9, - and _)." };
    if (this.getSkill(name)) return { ok: false, error: `A skill named "${name}" already exists. Update it instead.` };
    const content = redactSecrets(String(input.content || "").trim()).slice(0, 60_000);
    if (!content) return { ok: false, error: "Skill content is empty." };
    const description = redactSecrets(String(input.description || "")).slice(0, 400);
    const policy = this.getPolicies().autoSkillWrites;
    if (policy === "review" && !input.apply) {
      const pendingId = this.proposeChange({
        targetType: "skill",
        action: "create",
        proposed: { name, description, content },
        rationale: input.source || "Learning pass proposed a reusable procedure.",
        source: "learning",
      });
      return { ok: true, pendingId };
    }
    const save = this.db.transaction(() => {
      this.db.prepare("INSERT INTO skills (id, name, description, version, status) VALUES (?, ?, ?, 1, 'active')").run(name, name, description);
      this.db.prepare("INSERT INTO skill_versions (skill_id, version, content, description, reason) VALUES (?, 1, ?, ?, ?)").run(name, content, description, input.source || "create");
    });
    save();
    this.writeSkillFile(name, content);
    this.audit("skill.created", "skill", name, { description });
    this.emit("memory.changed");
    return { ok: true, skill: this.getSkill(name) || undefined };
  }

  updateSkill(name: string, changes: { description?: string; content?: string; reason?: string; apply?: boolean }): { ok: boolean; skill?: SkillRecord; pendingId?: string; error?: string } {
    const skill = this.getSkill(name);
    if (!skill) return { ok: false, error: "Skill not found." };
    const nextContent = changes.content !== undefined ? redactSecrets(String(changes.content).trim()).slice(0, 60_000) : undefined;
    if (nextContent !== undefined && !nextContent) return { ok: false, error: "Skill content is empty." };
    const nextDescription = changes.description !== undefined ? redactSecrets(String(changes.description)).slice(0, 400) : undefined;
    const policy = this.getPolicies().autoSkillWrites;
    if (policy === "review" && !changes.apply) {
      const pendingId = this.proposeChange({
        targetType: "skill",
        targetId: name,
        action: "update",
        proposed: { description: nextDescription ?? skill.description, content: nextContent ?? this.readSkill(name).content },
        beforeSnapshot: this.readSkill(name).content ? JSON.stringify({ description: skill.description, content: this.readSkill(name).content }) : null,
        rationale: changes.reason || "Proposed skill update.",
        source: "learning",
      });
      return { ok: true, pendingId };
    }
    const save = this.db.transaction(() => {
      const nextVersion = skill.version + 1;
      const current = this.db.prepare("SELECT content, description FROM skill_versions WHERE skill_id = ? ORDER BY version DESC LIMIT 1").get(name) as { content: string; description: string } | undefined;
      const finalContent = nextContent ?? current?.content ?? "";
      const finalDescription = nextDescription ?? current?.description ?? skill.description;
      this.db.prepare("UPDATE skills SET description = ?, version = ?, updated_at = ? WHERE id = ?").run(finalDescription, nextVersion, nowIso(), name);
      this.db.prepare("INSERT INTO skill_versions (skill_id, version, content, description, reason) VALUES (?, ?, ?, ?, ?)").run(name, nextVersion, finalContent, finalDescription, changes.reason || "update");
    });
    save();
    this.writeSkillFile(name, this.readSkill(name).content || "");
    this.audit("skill.updated", "skill", name, { version: skill.version + 1 });
    this.emit("memory.changed");
    return { ok: true, skill: this.getSkill(name) || undefined };
  }

  archiveSkill(name: string): { ok: boolean; error?: string } {
    const skill = this.getSkill(name);
    if (!skill) return { ok: false, error: "Skill not found." };
    const status = skill.status === "active" ? "archived" : "active";
    this.db.prepare("UPDATE skills SET status = ?, updated_at = ? WHERE id = ?").run(status, nowIso(), name);
    this.audit(status === "archived" ? "skill.archived" : "skill.restored", "skill", name);
    this.emit("memory.changed");
    return { ok: true };
  }

  skillVersions(name: string): SkillVersion[] {
    return this.db.prepare("SELECT * FROM skill_versions WHERE skill_id = ? ORDER BY version DESC").all(name) as SkillVersion[];
  }

  restoreSkillVersion(name: string, version: number): { ok: boolean; error?: string } {
    const versionRow = this.db.prepare("SELECT * FROM skill_versions WHERE skill_id = ? AND version = ?").get(name, version) as SkillVersion | undefined;
    if (!versionRow) return { ok: false, error: "Skill version not found." };
    return this.updateSkill(name, { content: versionRow.content, description: versionRow.description, reason: `restore version ${version}`, apply: true });
  }

  deleteSkill(name: string): { ok: boolean; error?: string } {
    const skill = this.getSkill(name);
    if (!skill) return { ok: false, error: "Skill not found." };
    const save = this.db.transaction(() => {
      this.db.prepare("DELETE FROM skill_versions WHERE skill_id = ?").run(name);
      this.db.prepare("DELETE FROM skills WHERE id = ?").run(name);
    });
    save();
    try { fs.rmSync(this.skillDir(name), { recursive: true, force: true }); } catch { /* non-fatal */ }
    this.audit("skill.deleted", "skill", name);
    this.emit("memory.changed");
    return { ok: true };
  }

  // --------------------------------------------------------- pending changes
  proposeChange(input: { targetType: "memory" | "skill" | "identity"; targetId?: string | null; action: "create" | "update" | "delete" | "archive"; proposed: unknown; rationale?: string; source?: string; beforeSnapshot?: unknown }): string {
    const id = newId("pnd");
    this.db.prepare("INSERT INTO pending_changes (id, target_type, target_id, action, proposed, before_snapshot, rationale, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(
      id,
      input.targetType,
      input.targetId || null,
      input.action,
      JSON.stringify(input.proposed),
      input.beforeSnapshot === undefined ? null : JSON.stringify(input.beforeSnapshot),
      input.rationale ? String(input.rationale).slice(0, 2000) : null,
      input.source || "learning",
    );
    this.audit("memory.change.proposed", input.targetType, id, { action: input.action, targetId: input.targetId });
    this.emit("memory.changed");
    return id;
  }

  listPending(status: "pending" | "approved" | "rejected" | "all" = "pending"): PendingChange[] {
    const rows = status === "all"
      ? this.db.prepare("SELECT * FROM pending_changes ORDER BY created_at DESC LIMIT 200").all()
      : this.db.prepare("SELECT * FROM pending_changes WHERE status = ? ORDER BY created_at DESC LIMIT 200").all(status);
    return (rows as Array<Record<string, unknown>>).map((row) => ({
      id: String(row.id),
      targetType: row.target_type as PendingChange["targetType"],
      targetId: row.target_id ? String(row.target_id) : null,
      action: row.action as PendingChange["action"],
      proposed: String(row.proposed),
      beforeSnapshot: row.before_snapshot ? String(row.before_snapshot) : null,
      rationale: row.rationale ? String(row.rationale) : null,
      source: String(row.source),
      status: row.status as PendingChange["status"],
      createdAt: String(row.created_at),
      resolvedAt: row.resolved_at ? String(row.resolved_at) : null,
    }));
  }

  getPending(id: string): PendingChange | null {
    const row = this.db.prepare("SELECT * FROM pending_changes WHERE id = ?").get(id) as Record<string, unknown> | undefined;
    if (!row) return null;
    return { id: String(row.id), targetType: row.target_type as PendingChange["targetType"], targetId: row.target_id ? String(row.target_id) : null, action: row.action as PendingChange["action"], proposed: String(row.proposed), beforeSnapshot: row.before_snapshot ? String(row.before_snapshot) : null, rationale: row.rationale ? String(row.rationale) : null, source: String(row.source), status: row.status as PendingChange["status"], createdAt: String(row.created_at), resolvedAt: row.resolved_at ? String(row.resolved_at) : null };
  }

  approvePending(id: string): { ok: boolean; error?: string; entry?: MemoryEntry; skill?: SkillRecord } {
    const change = this.getPending(id);
    if (!change) return { ok: false, error: "Pending change not found." };
    if (change.status !== "pending") return { ok: false, error: `Change is already ${change.status}.` };
    let outcome: { ok: boolean; entry?: MemoryEntry; skill?: SkillRecord; error?: string } = { ok: true };
    try {
      const proposed = JSON.parse(change.proposed) as Record<string, unknown>;
      if (change.targetType === "skill") {
        if (change.action === "create") {
          outcome = this.createSkill({ name: String(proposed.name), description: String(proposed.description || ""), content: String(proposed.content || ""), apply: true });
        } else if (change.targetId) {
          outcome = this.updateSkill(change.targetId, {
            description: proposed.description !== undefined ? String(proposed.description) : undefined,
            content: proposed.content !== undefined ? String(proposed.content) : undefined,
            reason: change.rationale || "Approved pending change",
            apply: true,
          });
        }
      } else if (change.targetType === "memory") {
        if (change.action === "create") {
          const result = this.add({ kind: proposed.kind as MemoryKind, scope: proposed.scope as string, category: proposed.category as MemoryCategory, content: String(proposed.content), source: proposed.source as string || "learning", confidence: clampConfidence(proposed.confidence), reason: change.rationale || "Approved pending change" });
          outcome = result.ok ? { ok: true, entry: result.entry } : result;
        } else if (change.action === "update" && change.targetId) {
          const result = this.patch({ id: change.targetId, content: String(proposed.content), category: proposed.category as MemoryCategory, confidence: clampConfidence(proposed.confidence), reason: change.rationale || "Approved pending change" });
          outcome = result.ok ? { ok: true, entry: result.entry } : result;
        } else if (change.action === "delete" && change.targetId) {
          outcome = this.remove(change.targetId);
        }
      } else if (change.targetType === "identity") {
        return { ok: false, error: "Identity changes must be reviewed manually and cannot be auto-approved." };
      }
    } catch (error) {
      outcome = { ok: false, error: error instanceof Error ? error.message : "Failed to apply the change." };
    }
    this.db.prepare("UPDATE pending_changes SET status = ?, resolved_at = ? WHERE id = ?").run(outcome.ok ? "approved" : "rejected", nowIso(), id);
    this.audit(outcome.ok ? "memory.change.approved" : "memory.change.failed", "pending_change", id);
    this.emit("memory.changed");
    return outcome.ok ? { ok: true, entry: outcome.entry, skill: outcome.skill } : { ok: false, error: outcome.error };
  }

  rejectPending(id: string): { ok: boolean; error?: string } {
    const change = this.getPending(id);
    if (!change) return { ok: false, error: "Pending change not found." };
    if (change.status !== "pending") return { ok: false, error: `Change is already ${change.status}.` };
    this.db.prepare("UPDATE pending_changes SET status = 'rejected', resolved_at = ? WHERE id = ?").run(nowIso(), id);
    this.audit("memory.change.rejected", "pending_change", id);
    this.emit("memory.changed");
    return { ok: true };
  }

  // ------------------------------------------------------------ consistency
  private syncDocs() {
    try {
      const user = this.listEntries({ kind: "user", scope: "user", limit: 400 });
      const agent = this.listEntries({ kind: "agent", limit: 400 });
      const project = this.listEntries({ kind: "project", limit: 400 });
      syncIdentityFiles(user, agent, project);
    } catch {
      /* projection failures are non-fatal */
    }
  }

  documents(): Record<string, { content: string; editable: boolean }> {
    const { protectedCore, persona } = getSoulDoc();
    const user = this.listEntries({ kind: "user", scope: "user", limit: 400 });
    const agent = this.listEntries({ kind: "agent", limit: 400 });
    const project = this.listEntries({ kind: "project", limit: 400 });
    return {
      "SOUL.md": { content: `${protectedCore}\n\n${persona}`, editable: true },
      "USER.md": { content: renderUserDoc(user), editable: false },
      "MEMORY.md": { content: renderMemoryDoc(agent, project), editable: false },
      "AGENTS.md": { content: agentsDoc(), editable: false },
    };
  }

  // --------------------------------------------------------------- learning
  enqueueJob(kind: string, payload: unknown, dedupeKey?: string): string {
    if (dedupeKey) {
      const existing = this.db.prepare("SELECT id FROM learning_jobs WHERE kind = ? AND state IN ('queued','running') AND payload LIKE ? LIMIT 1").get(kind, `%${dedupeKey}%`) as { id: string } | undefined;
      if (existing) return existing.id;
    }
    const id = newId("job");
    this.db.prepare("INSERT INTO learning_jobs (id, kind, payload) VALUES (?, ?, ?)").run(id, kind, JSON.stringify(payload));
    this.emit("learning.job.queued");
    return id;
  }

  claimNextJob(): LearningJob | null {
    const claim = this.db.transaction((): LearningJob | null => {
      const row = this.db.prepare("SELECT * FROM learning_jobs WHERE state = 'queued' ORDER BY created_at LIMIT 1").get() as Record<string, unknown> | undefined;
      if (!row) return null;
      this.db.prepare("UPDATE learning_jobs SET state = 'running', attempts = attempts + 1, updated_at = ? WHERE id = ?").run(nowIso(), String(row.id));
      return { id: String(row.id), kind: String(row.kind), payload: String(row.payload), state: "running", attempts: Number(row.attempts) + 1, error: row.error ? String(row.error) : null, createdAt: String(row.created_at), updatedAt: nowIso() };
    });
    return claim();
  }

  finishJob(id: string, ok: boolean, error?: string) {
    this.db.prepare("UPDATE learning_jobs SET state = ?, error = ?, updated_at = ? WHERE id = ?").run(ok ? "done" : "failed", error ? String(error).slice(0, 1000) : null, nowIso(), id);
    if (!ok) this.emit("learning.job.failed");
  }

  requeueJob(id: string, error: string) {
    this.db.prepare("UPDATE learning_jobs SET state = 'queued', error = ?, updated_at = ? WHERE id = ?").run(String(error).slice(0, 1000), nowIso(), id);
  }

  // -------------------------------------------------------------- lifecycle
  forgetEverything(): { ok: boolean; purged: number } {
    const count = this.db.prepare("SELECT COUNT(*) AS n FROM memory_entries").get() as { n: number };
    const save = this.db.transaction(() => {
      this.db.prepare("DELETE FROM memory_versions").run();
      this.db.prepare("DELETE FROM memory_fts").run();
      this.db.prepare("DELETE FROM memory_entries").run();
      this.db.prepare("DELETE FROM session_fts").run();
      this.db.prepare("DELETE FROM session_messages").run();
      this.db.prepare("DELETE FROM memory_sessions").run();
      this.db.prepare("DELETE FROM pending_changes").run();
    });
    save();
    this.audit("memory.forget.all", "memory", "all", { purged: count.n });
    this.syncDocs();
    this.emit("memory.changed");
    return { ok: true, purged: count.n };
  }

  exportAll(): string {
    const payload = {
      version: 1,
      exportedAt: nowIso(),
      profile: this.getProfile(),
      soul: this.documents()["SOUL.md"],
      entries: this.listEntries({ limit: 500 }),
      sessions: this.listSessions(200),
      skills: this.listSkills().map((skill) => ({ ...skill, ...this.readSkill(skill.id) })),
      pending: this.listPending("all"),
    };
    return JSON.stringify(payload, null, 2);
  }

  close() {
    this.emit("memory.closed");
    closeMemoryDb();
  }
}

function agentsDoc() {
  return `# AGENTS.md — project instructions
Clyra respects the AGENTS.md of each workspace (Vibe projects, opened folders).
Project instructions are never mixed with the global identity; conflicts are
resolved with system instructions first, then AGENTS.md, then memory.
`;
}

export const memoryService = new MemoryService();
