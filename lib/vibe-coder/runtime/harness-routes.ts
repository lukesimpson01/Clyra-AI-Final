import type { Application, Response } from "express";
import { promises as fs } from "node:fs";
import path from "node:path";
import { clyraDataPath } from "../../runtime-paths";
import { prepareIosAgentWorkspace, seedIosStarterIfEmpty } from "../../opencode/opencode-routes";
import { requestsIosProject } from "./ios-intent";
import { harnessService } from "./harness-runtime";

const MAX_PROMPT_LENGTH = 20_000;
function safeProjectId(value: string) { return value.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 96); }
function workspace(projectId: string) { return path.join(clyraDataPath("projects"), safeProjectId(projectId), "files"); }
function sendSse(res: Response, event: unknown) { res.write(`data: ${JSON.stringify(event)}\n\n`); }

export function registerHarnessRoutes(app: Application) {
  app.get("/api/opencode/status", (_req, res) => {
    const status = harnessService.status();
    res.json({
      status: status.available ? "healthy" : "unavailable",
      model: status.available ? status.model : undefined,
      providerConfigured: status.available,
      providerError: status.available ? undefined : status.error,
      effort: { levels: ["off", "low", "high", "max"], defaultEffort: "high", ready: status.available },
      harness: { activeBackend: "deepseek-harness", version: status.version, orchestration: "cordis-plugin-runtime" },
    });
  });

  app.post("/api/opencode/runtime/start", async (req, res) => {
    const projectId = safeProjectId(String(req.body?.projectId ?? ""));
    if (!projectId) return res.status(400).json({ error: "A valid project ID is required." });
    const root = workspace(projectId);
    await fs.mkdir(root, { recursive: true });
    try { await harnessService.start(projectId, root); res.json({ projectId, serverUrl: "cordis://local", status: "healthy" }); }
    catch (error) { res.status(503).json({ error: error instanceof Error ? error.message : "Harness could not start." }); }
  });

  app.post("/api/opencode/sessions", async (req, res) => {
    const projectId = safeProjectId(String(req.body?.projectId ?? ""));
    try { const runtime = await harnessService.start(projectId, workspace(projectId)); res.json(await runtime.createSession(String(req.body?.title ?? "New task").slice(0, 120))); }
    catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : "Could not create session." }); }
  });

  app.get("/api/opencode/sessions/:projectId", async (req, res) => {
    try { const runtime = await harnessService.start(safeProjectId(req.params.projectId), workspace(req.params.projectId)); res.json(runtime.listSessions()); }
    catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : "Could not list sessions." }); }
  });

  app.patch("/api/opencode/sessions/:projectId/:sessionId", async (req, res) => {
    try { res.json(await harnessService.get(safeProjectId(req.params.projectId)).renameSession(req.params.sessionId, String(req.body?.title ?? "New task").slice(0, 120))); }
    catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : "Could not rename session." }); }
  });

  app.delete("/api/opencode/sessions/:projectId/:sessionId", async (req, res) => {
    try { await harnessService.get(safeProjectId(req.params.projectId)).deleteSession(req.params.sessionId); res.json({ ok: true }); }
    catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : "Could not delete session." }); }
  });

  app.post("/api/opencode/sessions/:projectId/:sessionId/prompt", async (req, res) => {
    const projectId = safeProjectId(req.params.projectId);
    const text = String(req.body?.text ?? "").trim();
    if (!text || text.length > MAX_PROMPT_LENGTH) return res.status(400).json({ error: "Enter a coding request up to 20,000 characters." });
    try {
      const root = workspace(projectId);
      if (requestsIosProject(text)) {
        await prepareIosAgentWorkspace(root);
        await seedIosStarterIfEmpty(root, text);
      }
      await harnessService.get(projectId).prompt(req.params.sessionId, text, String(req.body?.effort ?? "high"));
      res.json({ ok: true });
    } catch (error) { res.status(503).json({ error: error instanceof Error ? error.message : "Could not start agent run." }); }
  });

  app.post("/api/opencode/sessions/:projectId/:sessionId/abort", async (req, res) => {
    try { await harnessService.get(safeProjectId(req.params.projectId)).abort(req.params.sessionId); res.json({ ok: true }); }
    catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : "Could not cancel run." }); }
  });

  app.get("/api/opencode/sessions/:projectId/:sessionId/messages", (req, res) => {
    try { res.json(harnessService.get(safeProjectId(req.params.projectId)).messages(req.params.sessionId)); }
    catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : "Could not load messages." }); }
  });
  app.get("/api/opencode/sessions/:projectId/:sessionId/diff", async (req, res) => {
    try { res.json(await harnessService.get(safeProjectId(req.params.projectId)).diff(req.params.sessionId)); }
    catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : "Could not load diff." }); }
  });
  app.post("/api/opencode/sessions/:projectId/:sessionId/revert", async (req, res) => {
    try { res.json({ ok: true, ...(await harnessService.get(safeProjectId(req.params.projectId)).revertRun(req.params.sessionId)) }); }
    catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : "Could not revert run." }); }
  });

  app.get("/api/opencode/events/:projectId", async (req, res) => {
    res.setHeader("Content-Type", "text/event-stream"); res.setHeader("Cache-Control", "no-cache, no-transform"); res.setHeader("Connection", "keep-alive");
    try {
      const runtime = await harnessService.start(safeProjectId(req.params.projectId), workspace(req.params.projectId));
      const dispose = runtime.subscribe((event) => sendSse(res, event));
      req.on("close", dispose);
    } catch (error) { sendSse(res, { type: "run.failed", runId: "startup", error: error instanceof Error ? error.message : String(error) }); res.end(); }
  });

  app.get("/api/opencode/projects/:projectId/checkpoints", async (req, res) => {
    try { res.json({ checkpoints: await harnessService.get(safeProjectId(req.params.projectId)).checkpoints() }); }
    catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : "Could not list checkpoints." }); }
  });
  app.post("/api/opencode/projects/:projectId/checkpoints/:checkpointId/revert", async (req, res) => {
    try { res.json({ ok: true, ...(await harnessService.get(safeProjectId(req.params.projectId)).revertCheckpoint(req.params.checkpointId)) }); }
    catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : "Could not revert checkpoint." }); }
  });

  app.post("/api/opencode/projects/:projectId/attachments", async (req, res) => {
    const projectId = safeProjectId(req.params.projectId); const root = path.join(workspace(projectId), ".clyra", "attachments");
    try {
      await fs.mkdir(root, { recursive: true });
      const attachments = [] as Array<{ name: string; path: string; type: string }>;
      for (const file of Array.isArray(req.body?.files) ? req.body.files : []) {
        const name = path.basename(String(file.name ?? "attachment")); const target = path.join(root, name);
        await fs.writeFile(target, Buffer.from(String(file.data ?? ""), "base64"));
        attachments.push({ name, path: path.relative(workspace(projectId), target), type: String(file.type ?? "application/octet-stream") });
      }
      res.json({ attachments });
    } catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : "Could not store attachments." }); }
  });

  app.post("/api/opencode/sessions/:projectId/:sessionId/permissions/:permissionId", (_req, res) => {
    res.status(409).json({ error: "This Harness run denied the dangerous action. Retry with a safer command or explicitly perform the operation in the user terminal." });
  });
}
