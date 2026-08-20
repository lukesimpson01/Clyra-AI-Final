/**
 * Server storage for Game Maker projects (spec §140).
 *
 * Project documents are JSON on disk under the Clyra data root, one file per
 * project, written atomically. The browser keeps an IndexedDB cache and
 * write-throughs land here, so a reload or a second machine gets the same
 * project. Asset blobs would live in object storage; today every asset is
 * procedural and lives inside the document, which is why there is no blob
 * store yet.
 */
import type { Application } from "express";
import express from "express";
import { promises as fs } from "node:fs";
import path from "node:path";
import { clyraDataPath } from "../runtime-paths";

const MAX_PROJECT_BYTES = 64 * 1024 * 1024;

function projectsRoot() {
  return clyraDataPath("game-maker", "projects");
}

function safeId(value: string) {
  return value.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 96);
}

function projectPath(projectId: string) {
  return path.join(projectsRoot(), `${safeId(projectId)}.json`);
}

interface StoredProject {
  projectId: string;
  metadata?: { name?: string; updatedAt?: number };
  runtime?: { mode?: string };
}

export function registerGameMakerRoutes(app: Application) {
  // The project document is large; the default 100kb JSON limit would reject it.
  const parseLargeJson = express.json({ limit: "64mb" });

  app.get("/api/game-maker/projects", async (_request, response) => {
    try {
      const root = projectsRoot();
      await fs.mkdir(root, { recursive: true });
      const files = (await fs.readdir(root)).filter((name) => name.endsWith(".json"));
      const projects = await Promise.all(
        files.map(async (name) => {
          try {
            const raw = await fs.readFile(path.join(root, name), "utf8");
            const parsed = JSON.parse(raw) as StoredProject;
            return {
              id: parsed.projectId ?? name.replace(/\.json$/, ""),
              name: parsed.metadata?.name ?? "Untitled game",
              updatedAt: parsed.metadata?.updatedAt ?? 0,
              mode: parsed.runtime?.mode ?? "3d",
            };
          } catch {
            return null;
          }
        }),
      );
      response.json(projects.filter(Boolean).sort((a, b) => (b!.updatedAt ?? 0) - (a!.updatedAt ?? 0)));
    } catch (error) {
      response.status(500).json({ error: error instanceof Error ? error.message : "Could not list projects." });
    }
  });

  app.get("/api/game-maker/projects/:id", async (request, response) => {
    try {
      const raw = await fs.readFile(projectPath(request.params.id), "utf8");
      response.type("application/json").send(raw);
    } catch {
      response.status(404).json({ error: `No saved game project "${request.params.id}".` });
    }
  });

  app.put("/api/game-maker/projects/:id", parseLargeJson, async (request, response) => {
    const body = request.body as StoredProject | undefined;
    if (!body || typeof body !== "object" || typeof body.projectId !== "string") {
      response.status(400).json({ error: "The request body must be a game project document." });
      return;
    }
    const serialised = JSON.stringify(body);
    if (serialised.length > MAX_PROJECT_BYTES) {
      response.status(413).json({ error: "This project is too large to save. Reduce generated content or split it across scenes." });
      return;
    }
    try {
      const target = projectPath(request.params.id);
      await fs.mkdir(path.dirname(target), { recursive: true });
      // Atomic write: a crash mid-save must never leave a truncated project.
      const temporary = `${target}.${process.pid}.tmp`;
      await fs.writeFile(temporary, serialised, "utf8");
      await fs.rename(temporary, target);
      response.json({ ok: true, bytes: serialised.length, savedAt: Date.now() });
    } catch (error) {
      response.status(500).json({ error: error instanceof Error ? error.message : "Could not save the project." });
    }
  });

  app.delete("/api/game-maker/projects/:id", async (request, response) => {
    try {
      await fs.rm(projectPath(request.params.id), { force: true });
      response.json({ ok: true });
    } catch (error) {
      response.status(500).json({ error: error instanceof Error ? error.message : "Could not delete the project." });
    }
  });

  /**
   * Publish (spec §164, §165). Produces a standalone web build: the runtime
   * document, the project JSON, and a manifest. The runtime bundle itself is
   * the app's own hashed build output, so a published game is served from
   * the same immutable assets the editor already uses.
   */
  app.post("/api/game-maker/projects/:id/publish", parseLargeJson, async (request, response) => {
    const body = request.body as StoredProject | undefined;
    if (!body || typeof body.projectId !== "string") {
      response.status(400).json({ error: "Publishing needs the project document." });
      return;
    }
    try {
      const id = safeId(request.params.id);
      const target = clyraDataPath("game-maker", "published", id);
      await fs.mkdir(target, { recursive: true });
      await fs.writeFile(path.join(target, "project.json"), JSON.stringify(body), "utf8");
      await fs.writeFile(
        path.join(target, "manifest.json"),
        JSON.stringify(
          {
            id,
            name: body.metadata?.name ?? "Untitled game",
            mode: body.runtime?.mode ?? "3d",
            publishedAt: Date.now(),
            runtime: "/game-runtime.html",
            project: `./project.json`,
          },
          null,
          2,
        ),
        "utf8",
      );
      response.json({ ok: true, url: `/api/game-maker/published/${id}`, publishedAt: Date.now() });
    } catch (error) {
      response.status(500).json({ error: error instanceof Error ? error.message : "Publishing failed." });
    }
  });

  app.get("/api/game-maker/published/:id/project.json", async (request, response) => {
    try {
      const raw = await fs.readFile(path.join(clyraDataPath("game-maker", "published", safeId(request.params.id)), "project.json"), "utf8");
      response.type("application/json").send(raw);
    } catch {
      response.status(404).json({ error: "That published game does not exist." });
    }
  });
}
