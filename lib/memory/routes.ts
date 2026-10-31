import type { Express, Request, Response } from "express";
import type { MemoryService } from "./service";
import { redactSecrets } from "./service";
import { assembleMemoryContext } from "./context";
import { learnFromExchange, startLearningWorker, type CurationDeps } from "./learn";
import { setSoulPersona } from "./soul";
import type { MemoryKind, MemoryCategory } from "./store";

export type MemoryRouteDeps = {
  service: MemoryService;
  /** Non-streaming model access for the async curation pass. */
  runModel?: (messages: Array<{ role: string; content: string }>) => Promise<string>;
  /** Whether LLM curation is enabled by policy/environment. */
  curationEnabled?: () => boolean;
};

function bodyOf(req: Request): Record<string, unknown> {
  return req.body && typeof req.body === "object" ? (req.body as Record<string, unknown>) : {};
}

function str(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

const KINDS: MemoryKind[] = ["user", "agent", "project", "session"];
const CATEGORIES: MemoryCategory[] = ["profile", "preference", "fact", "goal", "lesson", "decision", "workflow", "technical", "correction", "recovery"];

export function registerMemoryRoutes(app: Express, deps: MemoryRouteDeps) {
  const { service } = deps;

  // ------------------------------------------------------------- profile
  app.get("/api/memory/profile", (_req: Request, res: Response) => {
    res.json({ ok: true, profile: service.getProfile() });
  });

  app.put("/api/memory/profile", (req: Request, res: Response) => {
    const field = str(bodyOf(req).field);
    const value = str(bodyOf(req).value);
    const result = service.setProfileField(field, value);
    res.json({ ok: result.ok, profile: service.getProfile(), ...(result.ok ? {} : { error: result.error }) });
  });

  // -------------------------------------------------------------- context
  app.get("/api/memory/context", (req: Request, res: Response) => {
    const query = str(req.query.query);
    const sessionId = req.query.sessionId ? str(req.query.sessionId) : null;
    const projectRef = req.query.projectRef ? str(req.query.projectRef) : null;
    const budgetTokens = req.query.budget ? Number(req.query.budget) : undefined;
    try {
      const result = assembleMemoryContext(service, { query, sessionId, projectRef, budgetTokens: budgetTokens || undefined });
      service.audit("memory.retrieval.completed", "context", null, { query: query.slice(0, 120), sections: result.block ? result.block.length : 0 });
      res.json({ ok: true, ...result });
    } catch (error) {
      res.status(500).json({ ok: false, error: error instanceof Error ? error.message : "Context assembly failed." });
    }
  });

  // -------------------------------------------------------------- entries
  app.get("/api/memory/entries", (req: Request, res: Response) => {
    const kind = KINDS.includes(req.query.kind as MemoryKind) ? (req.query.kind as MemoryKind) : undefined;
    const category = CATEGORIES.includes(req.query.category as MemoryCategory) ? (req.query.category as MemoryCategory) : undefined;
    const state = str(req.query.state) || "active";
    const q = str(req.query.q);
    const entries = q
      ? service.search(q, { kind, category, limit: 50 }).filter((hit) => (state === "all" ? true : hit.state === state))
      : service.listEntries({ kind, category, state: state === "all" ? undefined : state, limit: 200 });
    res.json({ ok: true, entries });
  });

  app.post("/api/memory/entries", (req: Request, res: Response) => {
    const body = bodyOf(req);
    const kind = KINDS.includes(body.kind as MemoryKind) ? (body.kind as MemoryKind) : "user";
    const category = CATEGORIES.includes(body.category as MemoryCategory) ? (body.category as MemoryCategory) : "fact";
    const result = service.add({
      kind,
      category,
      scope: str(body.scope) || undefined,
      content: str(body.content),
      source: str(body.source) || "settings",
      confidence: Number(body.confidence) || undefined,
      sensitivity: body.sensitivity === "sensitive" || body.sensitivity === "personal" ? body.sensitivity : "low",
      pinned: Boolean(body.pinned),
      projectRef: str(body.projectRef) || null,
      explicit: Boolean(body.explicit),
    });
    res.json({ ok: result.ok, entry: result.entry, ...(result.ok ? {} : { error: result.error }) });
  });

  app.patch("/api/memory/entries/:id", (req: Request, res: Response) => {
    const body = bodyOf(req);
    const category = CATEGORIES.includes(body.category as MemoryCategory) ? (body.category as MemoryCategory) : undefined;
    const result = service.patch({
      id: String(req.params.id),
      content: body.content !== undefined ? str(body.content) : undefined,
      category,
      confidence: body.confidence !== undefined ? Number(body.confidence) : undefined,
      reason: str(body.reason) || "manual edit",
    });
    res.json({ ok: result.ok, entry: result.entry, ...(result.ok ? {} : { error: result.error }) });
  });

  app.delete("/api/memory/entries/:id", (req: Request, res: Response) => {
    const result = service.remove(String(req.params.id));
    res.json({ ok: result.ok, ...(result.ok ? {} : { error: result.error }) });
  });

  app.get("/api/memory/entries/:id/history", (req: Request, res: Response) => {
    res.json({ ok: true, versions: service.history(String(req.params.id)) });
  });

  app.post("/api/memory/entries/:id/restore", (req: Request, res: Response) => {
    const result = service.restore(String(req.params.id), Number(bodyOf(req).revision));
    res.json({ ok: result.ok, entry: result.entry, ...(result.ok ? {} : { error: result.error }) });
  });

  // ------------------------------------------------------------- learning
  app.post("/api/memory/learn", (req: Request, res: Response) => {
    const body = bodyOf(req);
    const userText = redactSecrets(str(body.userText)).slice(0, 8000);
    if (!userText.trim()) {
      res.json({ ok: false, error: "Empty exchange." });
      return;
    }
    const exchange = {
      userText,
      assistantText: redactSecrets(str(body.assistantText)).slice(0, 8000),
      sessionId: str(body.sessionId) || null,
      sessionTitle: str(body.sessionTitle) || null,
      projectRef: str(body.projectRef) || null,
    };
    const result = learnFromExchange(service, exchange);
    // Record the exchange into the session store so later turns and future
    // sessions can search it (session continuity, not just memory entries).
    if (exchange.sessionId) {
      service.recordSession({
        id: exchange.sessionId,
        title: exchange.sessionTitle || undefined,
        projectRef: exchange.projectRef,
        messages: [
          { role: "user", text: exchange.userText },
          ...(exchange.assistantText.trim() ? [{ role: "assistant" as const, text: exchange.assistantText }] : []),
        ],
      });
    }
    // Async curation pass — bounded, never blocks the chat response.
    if (deps.runModel && (deps.curationEnabled?.() ?? true)) {
      service.enqueueJob("curation", { ...exchange, policies: service.getPolicies() }, exchange.sessionId || undefined);
    }
    res.json({ ok: true, ...result });
  });

  // ------------------------------------------------------------- sessions
  app.post("/api/memory/sessions", (req: Request, res: Response) => {
    const body = bodyOf(req);
    const messages = Array.isArray(body.messages)
      ? body.messages.slice(-20).map((item) => ({ role: String((item as Record<string, unknown>).role) === "assistant" ? "assistant" as const : "user" as const, text: str((item as Record<string, unknown>).text).slice(0, 6000) }))
      : [];
    const result = service.recordSession({
      id: str(body.id),
      title: str(body.title) || undefined,
      projectRef: str(body.projectRef) || null,
      summary: str(body.summary) || null,
      messages,
    });
    res.json({ ok: result.ok, session: result.session });
  });

  app.get("/api/memory/sessions/search", (req: Request, res: Response) => {
    const hits = service.searchSessions(str(req.query.q), 8);
    res.json({ ok: true, hits });
  });

  app.get("/api/memory/sessions", (_req: Request, res: Response) => {
    res.json({ ok: true, sessions: service.listSessions(100) });
  });

  app.get("/api/memory/sessions/:id", (req: Request, res: Response) => {
    const session = service.getSession(String(req.params.id));
    if (!session) {
      res.status(404).json({ ok: false, error: "Session not found." });
      return;
    }
    res.json({ ok: true, session, messages: service.sessionMessages(session.id, 200) });
  });

  // --------------------------------------------------------------- skills
  app.get("/api/memory/skills", (req: Request, res: Response) => {
    res.json({ ok: true, skills: service.listSkills({ status: str(req.query.status) || "active", query: str(req.query.q) || undefined }) });
  });

  app.post("/api/memory/skills", (req: Request, res: Response) => {
    const body = bodyOf(req);
    const result = service.createSkill({
      name: str(body.name),
      description: str(body.description),
      content: str(body.content),
      source: "manual",
    });
    res.json({ ok: result.ok, skill: result.skill, pendingId: result.pendingId, ...(result.ok ? {} : { error: result.error }) });
  });

  app.get("/api/memory/skills/:name", (req: Request, res: Response) => {
    const result = service.readSkill(String(req.params.name));
    if (!result.skill) {
      res.status(404).json({ ok: false, error: result.error || "Skill not found." });
      return;
    }
    res.json({ ok: true, skill: result.skill, content: result.content });
  });

  app.put("/api/memory/skills/:name", (req: Request, res: Response) => {
    const body = bodyOf(req);
    const result = service.updateSkill(String(req.params.name), {
      description: body.description !== undefined ? str(body.description) : undefined,
      content: body.content !== undefined ? str(body.content) : undefined,
      reason: str(body.reason) || "manual edit",
    });
    res.json({ ok: result.ok, skill: result.skill, pendingId: result.pendingId, ...(result.ok ? {} : { error: result.error }) });
  });

  app.post("/api/memory/skills/:name/archive", (req: Request, res: Response) => {
    const result = service.archiveSkill(String(req.params.name));
    res.json({ ok: result.ok, ...(result.ok ? {} : { error: result.error }) });
  });

  app.get("/api/memory/skills/:name/versions", (req: Request, res: Response) => {
    res.json({ ok: true, versions: service.skillVersions(String(req.params.name)) });
  });

  app.post("/api/memory/skills/:name/restore-version", (req: Request, res: Response) => {
    const result = service.restoreSkillVersion(String(req.params.name), Number(bodyOf(req).version));
    res.json({ ok: result.ok, ...(result.ok ? {} : { error: result.error }) });
  });

  app.delete("/api/memory/skills/:name", (req: Request, res: Response) => {
    const result = service.deleteSkill(String(req.params.name));
    res.json({ ok: result.ok, ...(result.ok ? {} : { error: result.error }) });
  });

  // ------------------------------------------------------ pending changes
  app.get("/api/memory/pending", (req: Request, res: Response) => {
    res.json({ ok: true, changes: service.listPending(str(req.query.status) as "pending" | "approved" | "rejected" | "all" || "pending") });
  });

  app.post("/api/memory/pending/:id/approve", (req: Request, res: Response) => {
    const result = service.approvePending(String(req.params.id));
    res.json({ ok: result.ok, entry: result.entry, skill: result.skill, ...(result.ok ? {} : { error: result.error }) });
  });

  app.post("/api/memory/pending/:id/reject", (req: Request, res: Response) => {
    const result = service.rejectPending(String(req.params.id));
    res.json({ ok: result.ok, ...(result.ok ? {} : { error: result.error }) });
  });

  // ----------------------------------------------------------- documents
  app.get("/api/memory/documents", (_req: Request, res: Response) => {
    const documents = service.documents();
    res.json({
      ok: true,
      documents: Object.entries(documents).map(([name, doc]) => ({ name, editable: doc.editable })),
    });
  });

  app.get("/api/memory/documents/:name", (req: Request, res: Response) => {
    const name = String(req.params.name);
    if (!/^[A-Z_]+\.md$/.test(name)) {
      res.status(400).json({ ok: false, error: "Invalid document name." });
      return;
    }
    const documents = service.documents();
    const doc = documents[name];
    if (!doc) {
      res.status(404).json({ ok: false, error: "Document not found." });
      return;
    }
    res.json({ ok: true, name, content: doc.content, editable: doc.editable });
  });

  app.put("/api/memory/documents/:name", (req: Request, res: Response) => {
    const name = String(req.params.name);
    if (name !== "SOUL.md") {
      res.status(400).json({ ok: false, error: "Only SOUL.md is directly editable; manage entries through their own views." });
      return;
    }
    const content = str(bodyOf(req).content);
    const result = setSoulPersona(content);
    if (!result.ok) {
      res.status(400).json({ ok: false, error: result.error });
      return;
    }
    service.audit("identity.updated", "soul", "SOUL.md", { personaLength: content.length });
    res.json({ ok: true, content: service.documents()["SOUL.md"]?.content });
  });

  // ------------------------------------------------------------- settings
  app.get("/api/memory/settings", (_req: Request, res: Response) => {
    res.json({ ok: true, policies: service.getPolicies(), counts: {
      entries: service.listEntries({ limit: 500 }).length,
      sessions: service.listSessions(1000).length,
      skills: service.listSkills({ status: "active" }).length,
      pending: service.listPending().length,
    } });
  });

  app.put("/api/memory/settings", (req: Request, res: Response) => {
    const body = bodyOf(req);
    const key = str(body.key);
    if (!/^[a-zA-Z]{1,40}$/.test(key)) {
      res.status(400).json({ ok: false, error: "Invalid policy key." });
      return;
    }
    const allowedValues: Record<string, string[]> = {
      autoMemoryWrites: ["auto", "review", "off"],
      autoSkillWrites: ["auto", "review", "off"],
      autoIdentityChanges: ["review", "off"],
      sensitiveApproval: ["review", "off"],
      llmCuration: ["on", "off"],
    };
    if (allowedValues[key] && !allowedValues[key]!.includes(str(body.value))) {
      res.status(400).json({ ok: false, error: `Invalid value for ${key}.` });
      return;
    }
    service.setPolicy(key, str(body.value));
    res.json({ ok: true, policies: service.getPolicies() });
  });

  // ---------------------------------------------------------------- events
  app.get("/api/memory/events", (req: Request, res: Response) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();
    res.write(": connected\n\n");
    const listener = (payload: { event: string; entityType?: string; entityId?: string }) => {
      try { res.write(`data: ${JSON.stringify(payload)}\n\n`); } catch { /* client gone */ }
    };
    service.on("memory.event", listener);
    const heartbeat = setInterval(() => { try { res.write(": ping\n\n"); } catch { /* ignore */ } }, 20_000);
    req.on("close", () => {
      clearInterval(heartbeat);
      service.off("memory.event", listener);
    });
  });

  // --------------------------------------------------------------- journey
  app.get("/api/memory/journey", (_req: Request, res: Response) => {
    const nodes: Array<{ id: string; type: string; label: string; detail: string }> = [];
    const edges: Array<{ from: string; to: string; kind: string }> = [];
    const entries = service.listEntries({ limit: 300 });
    for (const entry of entries) {
      nodes.push({ id: `memory:${entry.id}`, type: entry.kind, label: entry.content.slice(0, 80), detail: entry.category });
      if (entry.sessionRef) edges.push({ from: `session:${entry.sessionRef}`, to: `memory:${entry.id}`, kind: "learned-during" });
      if (entry.supersededBy) edges.push({ from: `memory:${entry.id}`, to: `memory:${entry.supersededBy}`, kind: "superseded-by" });
    }
    for (const session of service.listSessions(60)) {
      nodes.push({ id: `session:${session.id}`, type: "session", label: session.title || session.id, detail: session.summary ? session.summary.slice(0, 120) : "" });
    }
    for (const skill of service.listSkills({ status: "active" })) {
      nodes.push({ id: `skill:${skill.id}`, type: "skill", label: skill.name, detail: skill.description.slice(0, 120) });
    }
    res.json({ ok: true, nodes, edges });
  });

  // ------------------------------------------------------ export / forget
  app.get("/api/memory/export", (_req: Request, res: Response) => {
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Content-Disposition", 'attachment; filename="clyra-memory.json"');
    res.send(service.exportAll());
  });

  app.delete("/api/memory/all", (_req: Request, res: Response) => {
    const result = service.forgetEverything();
    res.json({ ok: result.ok, purged: result.purged });
  });

  app.get("/api/memory/audit", (_req: Request, res: Response) => {
    res.json({ ok: true, events: service.recentAudit(200) });
  });

  // Background worker for the async curation queue.
  if (deps.runModel) {
    startLearningWorker(service, {
      runModel: deps.runModel,
      enabled: () => deps.curationEnabled?.() ?? true,
    } as CurationDeps);
  }
}
