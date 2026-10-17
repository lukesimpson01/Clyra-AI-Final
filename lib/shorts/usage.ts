// Real, locally-computed Shorts storage usage. There is no subscription or
// metered quota in Clyra Shorts, so the dashboard's "Usage" card measures
// something true instead: disk space used by projects, exports and the media
// library, against the ~3 GB working-set budget this build targets (see the
// Shorts memory/storage guidance). No fabricated plan, no fake reset date.

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { projectsRoot } from "./store";
import { libraryDir } from "./library";

/** The soft local-storage target this build is designed around. A real, documented number, not a sales quota. */
export const SHORTS_STORAGE_BUDGET_BYTES = 3 * 1024 * 1024 * 1024;

function dirBytes(dir: string): number {
  if (!existsSync(dir)) return 0;
  let total = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    try {
      if (entry.isDirectory()) total += dirBytes(full);
      else total += statSync(full).size;
    } catch {
      // A file removed mid-scan is simply not counted.
    }
  }
  return total;
}

export type ShortsUsage = {
  totalBytes: number;
  projectsBytes: number;
  libraryBytes: number;
  budgetBytes: number;
  fraction: number;
  projectCount: number;
  exportMinutes: number;
};

export async function shortsDiskUsage(): Promise<ShortsUsage> {
  const projectsBytes = dirBytes(projectsRoot());
  const libraryBytes = dirBytes(libraryDir("music")) + dirBytes(libraryDir("sfx"));
  const totalBytes = projectsBytes + libraryBytes;
  let projectCount = 0;
  let exportMs = 0;
  const root = projectsRoot();
  if (existsSync(root)) {
    for (const id of readdirSync(root)) {
      const file = path.join(root, id, "project.json");
      if (!existsSync(file)) continue;
      projectCount += 1;
      try {
        const data = JSON.parse(readFileSync(file, "utf8")) as { exports?: Array<{ durationMs?: number }> };
        for (const record of data.exports || []) exportMs += Number(record.durationMs) || 0;
      } catch {
        // A damaged project file just doesn't contribute to the export total.
      }
    }
  }
  return {
    totalBytes,
    projectsBytes,
    libraryBytes,
    budgetBytes: SHORTS_STORAGE_BUDGET_BYTES,
    fraction: Math.min(1, totalBytes / SHORTS_STORAGE_BUDGET_BYTES),
    projectCount,
    exportMinutes: Math.round(exportMs / 60000),
  };
}
