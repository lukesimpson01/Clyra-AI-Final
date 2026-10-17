// Project persistence for Shorts. Each project lives in its own folder:
//   shorts/projects/<id>/project.json   the saved project (atomic writes)
//   shorts/projects/<id>/assets/        media copied in or generated for it
//   shorts/projects/<id>/exports/       rendered outputs
//   shorts/projects/<id>/temp/          scratch space, cleaned when stale
// Originals a user imported are never modified: uploads are copied into the
// project before use, so deleting a project only removes Shorts' own copies.

import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { clyraDataPath } from "../runtime-paths";
import { isAssetPath, migrateProject, safeId, type ShortsProject } from "./schema";

const STALE_TEMP_MS = 24 * 60 * 60 * 1000;

export function shortsRoot() {
  return clyraDataPath(".clyra", "shorts");
}

export function projectsRoot() {
  return path.join(shortsRoot(), "projects");
}

export function projectDir(id: string) {
  const safe = safeId(id);
  return path.join(projectsRoot(), safe);
}

export function ensureProjectDirs(id: string) {
  const dir = projectDir(id);
  for (const sub of ["assets", "exports", "temp", "tts-cache"]) mkdirSync(path.join(dir, sub), { recursive: true });
  return dir;
}

/** Resolve a project-relative asset path to an absolute file that must stay inside the project. */
export function resolveAssetFile(projectId: string, assetFile: string): string | null {
  if (!isAssetPath(assetFile)) return null;
  const root = ensureProjectDirs(projectId);
  const candidate = path.join(root, assetFile);
  if (!existsSync(candidate)) return null;
  const real = realpathSync(candidate);
  const realRoot = realpathSync(root);
  return real.startsWith(realRoot + path.sep) ? real : null;
}

export function readProjectFile(id: string): ShortsProject | null {
  const file = path.join(projectDir(id), "project.json");
  if (!existsSync(file)) return null;
  return migrateProject(JSON.parse(readFileSync(file, "utf8")));
}

/**
 * Atomic save: write a sibling temp file, then rename over the target. A crash
 * mid-write leaves the previous complete file in place rather than a truncated one.
 */
export function writeProjectFile(project: ShortsProject) {
  const dir = ensureProjectDirs(project.id);
  const target = path.join(dir, "project.json");
  const temp = path.join(dir, `project.json.${randomBytes(6).toString("hex")}.tmp`);
  const body = JSON.stringify(migrateProject(project), null, 2);
  writeFileSync(temp, body, "utf8");
  renameSync(temp, target);
  return target;
}

export type ProjectSummary = {
  id: string;
  kind: ShortsProject["kind"];
  title: string;
  updatedAt: string;
  createdAt: string;
  aspect: ShortsProject["aspect"];
  durationMs: number;
  thumbnail: string | null;
  exportCount: number;
  itemCount: number;
  origin: "youtube" | "upload" | "generated" | null;
};

export function listProjects(): ProjectSummary[] {
  const root = projectsRoot();
  if (!existsSync(root)) return [];
  const summaries: ProjectSummary[] = [];
  for (const entry of readdirSync(root)) {
    try {
      const project = readProjectFile(entry);
      if (!project) continue;
      summaries.push({
        id: project.id,
        kind: project.kind,
        title: project.title,
        updatedAt: project.updatedAt,
        createdAt: project.createdAt,
        aspect: project.aspect,
        durationMs: project.durationMs ?? 0,
        thumbnail: project.source?.thumbnail ? `/api/shorts/projects/${project.id}/${project.source.thumbnail}` : null,
        exportCount: project.exports.length,
        itemCount: project.items.length,
        origin: project.source?.origin ?? null,
      });
    } catch (error) {
      // A damaged project is skipped rather than failing the whole library.
      console.warn(`[shorts] skipping unreadable project ${entry}:`, error instanceof Error ? error.message : error);
    }
  }
  return summaries.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
}

export function deleteProjectDir(id: string) {
  const dir = projectDir(id);
  if (!existsSync(dir)) return false;
  rmSync(dir, { recursive: true, force: true });
  return true;
}

/** Removes scratch files left behind by interrupted renders. Never touches assets or exports. */
export function cleanStaleTemp(now = Date.now()) {
  const root = projectsRoot();
  if (!existsSync(root)) return 0;
  let removed = 0;
  for (const id of readdirSync(root)) {
    const tempDir = path.join(root, id, "temp");
    if (!existsSync(tempDir)) continue;
    for (const entry of readdirSync(tempDir)) {
      const file = path.join(tempDir, entry);
      try {
        if (now - statSync(file).mtimeMs > STALE_TEMP_MS) {
          rmSync(file, { recursive: true, force: true });
          removed += 1;
        }
      } catch {
        // A file vanished between listing and stat; nothing to clean.
      }
    }
    for (const entry of readdirSync(path.join(root, id))) {
      if (entry.endsWith(".tmp") && now - statSync(path.join(root, id, entry)).mtimeMs > STALE_TEMP_MS) {
        unlinkSync(path.join(root, id, entry));
        removed += 1;
      }
    }
  }
  return removed;
}

export function newProjectId() {
  return `p-${Date.now().toString(36)}-${randomBytes(4).toString("hex")}`;
}

export function presetsFile() {
  return path.join(shortsRoot(), "caption-presets.json");
}
