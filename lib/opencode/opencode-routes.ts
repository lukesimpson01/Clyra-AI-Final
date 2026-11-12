import type { Application } from "express";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { clyraDataPath } from "../runtime-paths";
import { codingBackend, codingBackendModelStatus, codingBackendVersion, codingRuntimeManager } from "../coding-backend";
import { getVibeUsageAnalytics, type UsageRange } from "../vibe-agent-v3/usage-analytics";
import { ensureComponentMcpConfig } from "../clyra-code/component-library";
import { publicRuntimeDiagnostic, publicRuntimeEvent, publicRuntimeMessages } from "./public-runtime-view";

const execFileAsync = promisify(execFile);

/**
 * Project workspaces live inside Clyra's data dir, which the parent repo
 * gitignores. OpenCode's snapshot/diff system needs a git worktree, so give
 * each project its own repo with a baseline commit. Without this, session
 * diffs are always empty and the UI cannot show real +/− statistics.
 */
async function ensureProjectGitRepo(root: string) {
  const git = (...args: string[]) =>
    execFileAsync("git", ["-C", root, ...args], { timeout: 15_000 });
  try {
    await fs.access(path.join(root, ".git"));
  } catch {
    await git("init", "--initial-branch=main").catch(() => git("init"));
    await git("config", "user.email", "agent@clyra.local");
    await git("config", "user.name", "Clyra Agent");
  }
  try {
    await git("rev-parse", "HEAD");
  } catch {
    // No commits yet: snapshot whatever already exists as the baseline.
    await git("add", "-A");
    await git("commit", "--allow-empty", "-m", "Clyra project baseline").catch(() => undefined);
  }
}

const MAX_PROMPT_LENGTH = 20_000;
// The request body is JSON/base64, so keep the decoded total safely inside
// Express's 16 MB body limit.
const MAX_ATTACHMENT_BYTES = 6 * 1024 * 1024;
const MAX_ATTACHMENT_TOTAL_BYTES = 10 * 1024 * 1024;
const subscriptions = new Map<string, () => void>();

function safeProjectId(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 96);
}

function projectPath(projectId: string) {
  return path.join(clyraDataPath("projects"), safeProjectId(projectId), "files");
}

function titleFor(prompt: string) {
  return prompt.replace(/\s+/g, " ").trim().slice(0, 72) || "New Clyra task";
}

function sendSse(res: import("express").Response, event: unknown) {
  res.write(`data: ${JSON.stringify(event)}\n\n`);
}

/** SDK-backed local API. The renderer only sees project/session-scoped data. */
export function registerOpenCodeRoutes(app: Application) {
  // Local-only coding analytics. The response intentionally excludes prompts,
  // file paths and source content.
  app.get("/api/vibe/v3/usage", async (req, res) => {
    const range = req.query.range === "7d" || req.query.range === "30d" || req.query.range === "all"
      ? req.query.range as UsageRange
      : "all";
    try { res.json(await getVibeUsageAnalytics(range)); }
    catch (error) { res.status(500).json({ error: error instanceof Error ? error.message : "Usage analytics are unavailable." }); }
  });

  app.get("/api/opencode/status", async (_req, res) => {
    const runtime = codingRuntimeManager();
    const health = await runtime.health();
    const configuredModel = codingBackendModelStatus();
    const version = codingBackendVersion();
    res.json({
      backend: codingBackend(),
      sdk: version.sdk,
      sdkVersion: version.version,
      executableVersion: version.version,
      // Model identity is safe to show. Credentials remain exclusively in the
      // service process and are never emitted in this response.
      model: configuredModel.available ? `${configuredModel.providerID}/${configuredModel.modelID}` : undefined,
      providerConfigured: configuredModel.available,
      providerError: configuredModel.available ? undefined : configuredModel.error,
      ...health,
    });
  });

  app.post("/api/opencode/runtime/start", async (req, res) => {
    const projectId = safeProjectId(String(req.body?.projectId || ""));
    if (!projectId) return res.status(400).json({ error: "A valid project ID is required." });
    try {
      const root = projectPath(projectId);
      await fs.mkdir(root, { recursive: true });
      await ensureProjectGitRepo(root).catch(() => undefined);
      await ensureComponentMcpConfig(root);
      // Seed adaptive web and desktop development guidance when missing.
      try {
        await fs.access(path.join(root, "AGENTS.md"));
      } catch {
        await fs.writeFile(
          path.join(root, "AGENTS.md"),
          `# Clyra Code Agent

Be an adaptive expert coding agent like Cursor or Codex. Understand intent → investigate → plan across files → act → inspect → adapt → validate until complete.
No fixed tool-call quota. Scale effort to the request. Read before editing. Prefer production-quality work. Fix failures after checks.

Research-before-build policy:
- When a request names or links a current public product, website, framework, library, API, repository, brand, or versioned design system, research authoritative public sources before implementation. Prefer the official site, docs, organisation/repository and release notes; do not build from stale memory or random screenshots.
- When web research is needed, use Clyra's own local research capability rather than inventing sources: POST a focused query to http://127.0.0.1:3000/api/research/web-search, read its returned source material, and carry only relevant evidence into the implementation. Never run it for a purely local change.
- Then inspect this project, plan the adaptation, implement, run the relevant checks, open the preview, compare and correct visible issues. Keep research out of simple local refactors where external context adds no value.

Project architecture rules — for every coding request:
- Inspect the existing project structure first (list files, read configs) and match its framework and conventions.
- Split code naturally across components, pages, styles, hooks, utilities, APIs, config, assets, and tests. Never cram everything into a single index.html unless a single-file deliverable is genuinely requested.
- For React/Next/Vite projects create proper files: components, styles, hooks, utilities, routes, and config.
- Reuse existing components instead of rebuilding them. Revisit and edit multiple files during the run when needed.
- Run the project's build/typecheck/tests after changes and fix every error before finishing.
- For web apps only, put index.html at the project root so the live preview can start, and keep it as a thin shell that loads the real source files. Native iOS and macOS projects (Swift, SwiftUI, Xcode, Package.swift) never get an index.html or any HTML preview page: their verification is native build and test, and runtime checks only where a real simulator or device run is available.
- Never run commands that list the environment (env, printenv, export -p, set, Get-ChildItem Env:, dir env:). For machine facts, call GET /api/clyra-code/runtime-info. To check whether a variable is set, call GET /api/clyra-code/env-status?names=PATH,HOME. Those return presence and platform facts only; no secret values are ever returned.
- Never navigate to a file: URL, start a separate preview server, or kill background processes. Clyra owns the local preview; finish the implementation and use the approved preview surface.
- For desktop/Electron requests, build the product first as a responsive web application that runs in the live development preview. Then add a minimal Electron main/preload wrapper, safe BrowserWindow configuration, and package scripts around that same web app. Do not make the live preview depend on Electron or native-only APIs; it must remain usable in Chromium at every responsive preview size.

Design quality:
- Do not produce generic AI-dashboard styling. Build one restrained, product-specific visual system with clear hierarchy, intentional type, semantic colour, responsive layouts, honest empty/loading/error states, accessible interactions, and motion only when it explains a state change.
- Avoid decorative gradients, glow, auroras, glass-card piles, fake metrics, placeholder content, oversized rounded controls, generic icon mosaics, and controls that do not work. Inspect the rendered preview and repair visible quality or interaction issues before finishing.
`,
          "utf8",
        ).catch(() => undefined);
      }
      res.json(await codingRuntimeManager().start(projectId, root));
    } catch (error) {
      res.status(503).json({ error: error instanceof Error ? error.message : "The Clyra Code runtime could not start." });
    }
  });

  app.post("/api/opencode/runtime/stop", async (_req, res) => {
    await codingRuntimeManager().stop();
    res.json({ ok: true });
  });

  app.get("/api/opencode/diagnostic/:projectId", (req, res) => {
    try { res.json(publicRuntimeDiagnostic(codingRuntimeManager().inspect(safeProjectId(req.params.projectId)))); }
    catch (error) { res.status(404).json({ error: error instanceof Error ? error.message : "Project not found." }); }
  });

  app.post("/api/opencode/sessions", async (req, res) => {
    const projectId = safeProjectId(String(req.body?.projectId || ""));
    try { res.json(await codingRuntimeManager().createSession(projectId, String(req.body?.title || "").slice(0, 160))); }
    catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : "Could not create session." }); }
  });

  app.get("/api/opencode/sessions/:projectId", async (req, res) => {
    const projectId = safeProjectId(req.params.projectId);
    try { res.json(await codingRuntimeManager().listSessions(projectId, projectPath(projectId))); }
    catch { res.json([]); }
  });

  app.patch("/api/opencode/sessions/:projectId/:sessionId", async (req, res) => {
    const title = String(req.body?.title || "").trim().slice(0, 160);
    if (!title) return res.status(400).json({ error: "A chat title is required." });
    try { res.json(await codingRuntimeManager().renameSession(safeProjectId(req.params.projectId), req.params.sessionId, title)); }
    catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : "Could not rename chat." }); }
  });

  app.delete("/api/opencode/sessions/:projectId/:sessionId", async (req, res) => {
    try {
      await codingRuntimeManager().deleteSession(safeProjectId(req.params.projectId), req.params.sessionId);
      res.json({ ok: true });
    } catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : "Could not delete chat." }); }
  });

  app.get("/api/opencode/sessions/:projectId/:sessionId/messages", async (req, res) => {
    try { res.json(publicRuntimeMessages(await codingRuntimeManager().messages(safeProjectId(req.params.projectId), req.params.sessionId))); }
    catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : "Could not fetch history." }); }
  });

  app.get("/api/opencode/sessions/:projectId/:sessionId/diff", async (req, res) => {
    try { res.json(await codingRuntimeManager().diff(safeProjectId(req.params.projectId), req.params.sessionId)); }
    catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : "Could not fetch changes." }); }
  });

  app.post("/api/opencode/projects/:projectId/checkpoints/undo", async (req, res) => {
    try { res.json(await codingRuntimeManager().undoLastCheckpoint(safeProjectId(req.params.projectId))); }
    catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : "Could not restore the last checkpoint." }); }
  });

  app.post("/api/opencode/sessions/:projectId/:sessionId/prompt", async (req, res) => {
    const text = String(req.body?.text || "").trim();
    if (!text || text.length > MAX_PROMPT_LENGTH) return res.status(400).json({ error: "Enter a coding request up to 20,000 characters." });
    try {
      await codingRuntimeManager().prompt(
        safeProjectId(req.params.projectId),
        req.params.sessionId,
        text,
        typeof req.body?.agent === "string" ? req.body.agent : undefined,
        undefined,
        req.body?.effort,
      );
      res.json({ ok: true });
    } catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : "Prompt could not be sent." }); }
  });

  // Persist attachments inside the selected workspace. OpenCode can then read
  // the exact files named in the prompt instead of receiving mock metadata.
  app.post("/api/opencode/projects/:projectId/attachments", async (req, res) => {
    const projectId = safeProjectId(req.params.projectId);
    const files = Array.isArray(req.body?.files) ? req.body.files : [];
    if (!projectId || !files.length) return res.status(400).json({ error: "Choose one or more files to attach." });
    if (files.length > 12) return res.status(400).json({ error: "Attach up to 12 files at a time." });
    const root = path.join(projectPath(projectId), ".clyra-attachments");
    let total = 0;
    const saved: Array<{ name: string; path: string; type: string }> = [];
    try {
      await fs.mkdir(root, { recursive: true });
      for (const [index, entry] of files.entries()) {
        const encoded = typeof entry?.data === "string" ? entry.data : "";
        const buffer = Buffer.from(encoded, "base64");
        const name = path.basename(String(entry?.name || "attachment")).replace(/[^a-zA-Z0-9._ -]/g, "_").slice(0, 120) || "attachment";
        if (!encoded || !buffer.length || buffer.length > MAX_ATTACHMENT_BYTES || total + buffer.length > MAX_ATTACHMENT_TOTAL_BYTES) {
          return res.status(413).json({ error: "Attachments are limited to 6 MB each and 10 MB total." });
        }
        total += buffer.length;
        const filename = `${Date.now()}-${index + 1}-${name}`;
        await fs.writeFile(path.join(root, filename), buffer);
        saved.push({ name, path: `.clyra-attachments/${filename}`, type: String(entry?.type || "application/octet-stream").slice(0, 100) });
      }
      res.json({ attachments: saved });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : "Could not attach the selected files." });
    }
  });

  app.post("/api/opencode/sessions/:projectId/:sessionId/abort", async (req, res) => {
    try { await codingRuntimeManager().abort(safeProjectId(req.params.projectId), req.params.sessionId); res.json({ ok: true }); }
    catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : "Could not abort session." }); }
  });

  app.post("/api/opencode/sessions/:projectId/:sessionId/pause", async (req, res) => {
    const runtime = codingRuntimeManager();
    if (!runtime.pause) return res.status(501).json({ error: "Pause is unavailable in the selected coding backend." });
    try { await runtime.pause(safeProjectId(req.params.projectId), req.params.sessionId); res.json({ ok: true }); }
    catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : "Could not pause session." }); }
  });

  app.post("/api/opencode/sessions/:projectId/:sessionId/resume", async (req, res) => {
    const runtime = codingRuntimeManager();
    if (!runtime.resume) return res.status(501).json({ error: "Resume is unavailable in the selected coding backend." });
    try { await runtime.resume(safeProjectId(req.params.projectId), req.params.sessionId); res.json({ ok: true }); }
    catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : "Could not resume session." }); }
  });

  app.post("/api/opencode/sessions/:projectId/:sessionId/permissions/:permissionId", async (req, res) => {
    const response = String(req.body?.response || "deny");
    if (!["allow", "always", "deny"].includes(response)) return res.status(400).json({ error: "Invalid permission response." });
    try { await codingRuntimeManager().respondPermission(safeProjectId(req.params.projectId), req.params.sessionId, req.params.permissionId, response); res.json({ ok: true }); }
    catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : "Could not answer permission." }); }
  });

  app.get("/api/opencode/events/:projectId", (req, res) => {
    const projectId = safeProjectId(req.params.projectId);
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    const id = randomUUID();
    try {
      subscriptions.set(id, codingRuntimeManager().subscribe(projectId, (event) => {
        const safe = publicRuntimeEvent(event as unknown as Record<string, unknown>);
        if (safe) sendSse(res, safe);
      }));
      req.on("close", () => { subscriptions.get(id)?.(); subscriptions.delete(id); });
    } catch (error) { sendSse(res, { type: "runtime.error", error: error instanceof Error ? error.message : String(error) }); res.end(); }
  });

  // Compatibility endpoint used by the current renderer while it is migrated.
  app.post("/api/opencode/start", async (req, res) => {
    const prompt = String(req.body?.prompt || "").trim();
    if (!prompt || prompt.length > MAX_PROMPT_LENGTH) return res.status(400).json({ error: "Enter a coding request up to 20,000 characters." });
    const projectId = safeProjectId(String(req.body?.projectId || "")) || `clyra-${randomUUID().slice(0, 8)}`;
    try {
      const root = projectPath(projectId);
      await fs.mkdir(root, { recursive: true });
      await ensureProjectGitRepo(root).catch(() => undefined);
      await codingRuntimeManager().start(projectId, root);
      const session = await codingRuntimeManager().createSession(projectId, titleFor(prompt));
      await codingRuntimeManager().prompt(projectId, session.id, prompt, Boolean(req.body?.planMode) ? "plan" : undefined);
      res.json({ taskId: session.id, sessionId: session.id, projectId, provider: codingBackend(), sdkVersion: codingBackendVersion().version });
    } catch (error) { res.status(503).json({ error: error instanceof Error ? error.message : "The Clyra Code runtime could not start." }); }
  });

  app.post("/api/opencode/cancel/:sessionId", async (req, res) => {
    const projectId = safeProjectId(String(req.body?.projectId || ""));
    try { await codingRuntimeManager().abort(projectId, req.params.sessionId); res.json({ ok: true }); }
    catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : "Could not cancel task." }); }
  });
}
