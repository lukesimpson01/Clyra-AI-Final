/**
 * Typed client for the Clyra persistent-memory API. All calls are
 * best-effort and additive: a memory failure must never block chat.
 */

export type MemoryContextResponse = {
  ok: boolean;
  block: string;
  activity: string[];
  skills: Array<{ name: string; description: string }>;
};

export type LearnResponse = {
  ok: boolean;
  learned: Array<{
    kind: string;
    field?: string;
    value?: string;
    content?: string;
    status: "saved" | "updated" | "proposed" | "skipped";
  }>;
  profile: Record<string, string>;
};

export type MemoryProfile = Record<string, string>;

async function jsonFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) throw new Error(`Memory API ${response.status}`);
  return (await response.json()) as T;
}

export async function fetchMemoryContext(
  query: string,
  sessionId?: string | null,
  projectRef?: string | null,
): Promise<MemoryContextResponse | null> {
  const params = new URLSearchParams();
  if (query) params.set("query", query.slice(0, 800));
  if (sessionId) params.set("sessionId", sessionId);
  if (projectRef) params.set("projectRef", projectRef);
  const url = `/api/memory/context?${params.toString()}`;
  const response = await fetch(url, { signal: AbortSignal.timeout(4000) });
  if (!response.ok) return null;
  return (await response.json()) as MemoryContextResponse;
}

export async function fetchMemoryProfile(): Promise<MemoryProfile | null> {
  try {
    const result = await jsonFetch<{ ok: boolean; profile: MemoryProfile }>("/api/memory/profile", { signal: AbortSignal.timeout(4000) });
    return result.ok ? result.profile : null;
  } catch {
    return null;
  }
}

/**
 * Deterministic learning for one exchange plus an async curation job
 * server-side. Resolves quickly; the response carries anything saved
 * synchronously so the UI can apply personalization immediately.
 */
export async function learnFromExchange(payload: {
  userText: string;
  assistantText: string;
  sessionId?: string | null;
  sessionTitle?: string | null;
  projectRef?: string | null;
}): Promise<LearnResponse | null> {
  try {
    return await jsonFetch<LearnResponse>("/api/memory/learn", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    return null;
  }
}

/** Record the raw exchange into the searchable session store. */
export async function recordSessionExchange(payload: {
  id: string;
  title?: string | null;
  projectRef?: string | null;
  messages: Array<{ role: "user" | "assistant"; text: string }>;
}): Promise<void> {
  try {
    await jsonFetch("/api/memory/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(6000),
    });
  } catch {
    /* non-fatal */
  }
}

export type MemoryEntryDTO = {
  id: string;
  kind: string;
  scope: string;
  category: string;
  content: string;
  source: string;
  confidence: number;
  sensitivity: string;
  state: string;
  pinned: number;
  projectRef: string | null;
  sessionRef: string | null;
  createdAt: string;
  updatedAt: string;
  revision: number;
};

export type SkillDTO = {
  id: string;
  name: string;
  description: string;
  version: number;
  status: "active" | "archived";
  createdAt: string;
  updatedAt: string;
};

export type PendingChangeDTO = {
  id: string;
  targetType: "memory" | "skill" | "identity";
  targetId: string | null;
  action: "create" | "update" | "delete" | "archive";
  proposed: string;
  beforeSnapshot: string | null;
  rationale: string | null;
  source: string;
  status: "pending" | "approved" | "rejected";
  createdAt: string;
  resolvedAt: string | null;
};

export async function listMemoryEntries(filters: { q?: string; kind?: string; category?: string; state?: string } = {}): Promise<MemoryEntryDTO[]> {
  const params = new URLSearchParams();
  if (filters.q) params.set("q", filters.q);
  if (filters.kind) params.set("kind", filters.kind);
  if (filters.category) params.set("category", filters.category);
  if (filters.state) params.set("state", filters.state);
  const result = await jsonFetch<{ ok: boolean; entries: MemoryEntryDTO[] }>(`/api/memory/entries?${params.toString()}`);
  return result.entries;
}

export async function addMemoryEntry(input: Partial<MemoryEntryDTO> & { content: string; explicit?: boolean }): Promise<MemoryEntryDTO | null> {
  const result = await jsonFetch<{ ok: boolean; entry?: MemoryEntryDTO; error?: string }>("/api/memory/entries", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return result.ok && result.entry ? result.entry : null;
}

export async function patchMemoryEntry(id: string, changes: { content?: string; category?: string; pinned?: boolean }): Promise<MemoryEntryDTO | null> {
  const result = await jsonFetch<{ ok: boolean; entry?: MemoryEntryDTO; error?: string }>(`/api/memory/entries/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(changes),
  });
  return result.ok && result.entry ? result.entry : null;
}

export async function deleteMemoryEntry(id: string): Promise<boolean> {
  const result = await jsonFetch<{ ok: boolean }>(`/api/memory/entries/${id}`, { method: "DELETE" });
  return result.ok;
}

export async function listMemoryVersions(id: string): Promise<Array<{ id: number; revision: number; content: string; reason: string | null; createdAt: string }>> {
  const result = await jsonFetch<{ ok: boolean; versions: Array<{ id: number; revision: number; content: string; reason: string | null; createdAt: string }> }>(`/api/memory/entries/${id}/history`);
  return result.versions;
}

export async function restoreMemoryVersion(id: string, revision: number): Promise<boolean> {
  const result = await jsonFetch<{ ok: boolean }>(`/api/memory/entries/${id}/restore`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ revision }),
  });
  return result.ok;
}

export async function listSkills(filters: { status?: string; q?: string } = {}): Promise<SkillDTO[]> {
  const params = new URLSearchParams();
  if (filters.status) params.set("status", filters.status);
  if (filters.q) params.set("q", filters.q);
  const result = await jsonFetch<{ ok: boolean; skills: SkillDTO[] }>(`/api/memory/skills?${params.toString()}`);
  return result.skills;
}

export async function readSkill(name: string): Promise<{ skill: SkillDTO; content: string } | null> {
  const result = await jsonFetch<{ ok: boolean; skill?: SkillDTO; content?: string }>(`/api/memory/skills/${encodeURIComponent(name)}`);
  return result.ok && result.skill ? { skill: result.skill, content: result.content || "" } : null;
}

export async function createSkill(input: { name: string; description: string; content: string }): Promise<{ ok: boolean; error?: string; pendingId?: string }> {
  return jsonFetch("/api/memory/skills", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export async function updateSkill(name: string, changes: { description?: string; content?: string }): Promise<{ ok: boolean; error?: string; pendingId?: string }> {
  return jsonFetch(`/api/memory/skills/${encodeURIComponent(name)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(changes),
  });
}

export async function archiveSkill(name: string): Promise<boolean> {
  const result = await jsonFetch<{ ok: boolean }>(`/api/memory/skills/${encodeURIComponent(name)}/archive`, { method: "POST" });
  return result.ok;
}

export async function deleteSkill(name: string): Promise<boolean> {
  const result = await jsonFetch<{ ok: boolean }>(`/api/memory/skills/${encodeURIComponent(name)}`, { method: "DELETE" });
  return result.ok;
}

export async function listPending(status: string = "pending"): Promise<PendingChangeDTO[]> {
  const result = await jsonFetch<{ ok: boolean; changes: PendingChangeDTO[] }>(`/api/memory/pending?status=${status}`);
  return result.changes;
}

export async function resolvePending(id: string, approve: boolean): Promise<boolean> {
  const result = await jsonFetch<{ ok: boolean }>(`/api/memory/pending/${id}/${approve ? "approve" : "reject"}`, { method: "POST" });
  return result.ok;
}

export type MemoryPolicies = {
  autoMemoryWrites: string;
  autoSkillWrites: string;
  autoIdentityChanges: string;
  sensitiveApproval: string;
  retentionDays: string;
  memoryBudgetTokens: string;
  llmCuration: string;
};

export async function getMemorySettings(): Promise<{ policies: MemoryPolicies; counts: Record<string, number> } | null> {
  try {
    return await jsonFetch<{ ok: boolean; policies: MemoryPolicies; counts: Record<string, number> }>("/api/memory/settings");
  } catch {
    return null;
  }
}

export async function setMemoryPolicy(key: string, value: string): Promise<MemoryPolicies | null> {
  try {
    const result = await jsonFetch<{ ok: boolean; policies: MemoryPolicies }>("/api/memory/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, value }),
    });
    return result.policies;
  } catch {
    return null;
  }
}

export async function getMemoryDocument(name: string): Promise<{ content: string; editable: boolean } | null> {
  try {
    const result = await jsonFetch<{ ok: boolean; name: string; content: string; editable: boolean }>(`/api/memory/documents/${encodeURIComponent(name)}`);
    return { content: result.content, editable: result.editable };
  } catch {
    return null;
  }
}

export async function saveMemoryDocument(name: string, content: string): Promise<boolean> {
  const result = await jsonFetch<{ ok: boolean; error?: string }>(`/api/memory/documents/${encodeURIComponent(name)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content }),
  });
  return result.ok;
}

export async function forgetAllMemory(): Promise<{ ok: boolean; purged: number }> {
  return jsonFetch("/api/memory/all", { method: "DELETE" });
}

export async function fetchJourney(): Promise<{ nodes: Array<{ id: string; type: string; label: string; detail: string }>; edges: Array<{ from: string; to: string; kind: string }> }> {
  return jsonFetch("/api/memory/journey");
}

export async function searchSessions(query: string): Promise<Array<{ session: { id: string; title: string | null; summary: string | null }; snippet: string; rank: number }>> {
  const params = new URLSearchParams({ q: query });
  const result = await jsonFetch<{ ok: boolean; hits: Array<{ session: { id: string; title: string | null; summary: string | null }; snippet: string; rank: number }> }>(`/api/memory/sessions/search?${params.toString()}`);
  return result.hits;
}

/** Subscribe to live memory events (SSE). Returns an unsubscribe function. */
export function subscribeMemoryEvents(onEvent: (event: { event: string; entityType?: string; entityId?: string }) => void): () => void {
  const controller = new AbortController();
  void (async () => {
    try {
      const response = await fetch("/api/memory/events", { signal: controller.signal });
      if (!response.body) return;
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (!controller.signal.aborted) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (line.startsWith("data: ") && !line.startsWith("data: :")) {
            try { onEvent(JSON.parse(line.slice(6))); } catch { /* ignore */ }
          }
        }
      }
    } catch {
      /* disconnected */
    }
  })();
  return () => controller.abort();
}
