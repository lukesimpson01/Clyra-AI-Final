/**
 * Bot workspace isolation for Clyra Cowork.
 *
 * Each bot owns a directory under `Clyra/Bots/<slug>/`, and this module is the
 * only sanctioned way to turn a bot-supplied path into a real filesystem path.
 *
 * The security model is deliberately *not* "set cwd and hope". A working
 * directory is a convenience, not a boundary: `../`, an absolute path, or a
 * symlink pointing outward all escape it trivially, and an agent writing paths
 * from model output will eventually produce all three. Every filesystem and
 * terminal entry point must therefore resolve through `resolveInWorkspace`,
 * which fails closed.
 *
 * Symlinks are the subtle case. A path is checked *after* resolving symlinks
 * on the parts that already exist, so a bot cannot plant `notes -> /etc` inside
 * its own workspace and then read `notes/passwd` through it.
 */
import { realpathSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { clyraDataPath } from "../runtime-paths";

export class WorkspaceViolationError extends Error {
  constructor(message: string, readonly attemptedPath: string) {
    super(message);
    this.name = "WorkspaceViolationError";
  }
}

/** Root holding every bot's workspace. */
export function botsRoot() {
  return clyraDataPath("Clyra", "Bots");
}

/**
 * Filesystem-safe slug for a bot name.
 *
 * Rejects rather than silently mangles anything that would leave the root:
 * a bot literally named ".." must not become a directory traversal.
 */
export function botSlug(name: string): string {
  const slug = String(name || "")
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
  if (!slug || slug === "." || slug === "..") {
    throw new WorkspaceViolationError("That bot name cannot be used as a folder name.", name);
  }
  return slug;
}

/** Absolute path to one bot's workspace root. */
export function workspaceRoot(slug: string) {
  return path.join(botsRoot(), botSlug(slug));
}

export async function ensureWorkspace(slug: string) {
  const root = workspaceRoot(slug);
  // The sub-layout every bot gets: its own files, artifacts and logs, kept
  // apart so an "clear artifacts" action can never touch the bot's memory.
  await mkdir(path.join(root, "files"), { recursive: true });
  await mkdir(path.join(root, "artifacts"), { recursive: true });
  await mkdir(path.join(root, "logs"), { recursive: true });
  return root;
}

/**
 * Resolve `candidate` inside a bot's workspace, or throw.
 *
 * Returns an absolute path guaranteed to sit within the workspace, with
 * symlinks on existing path segments already resolved.
 */
export function resolveInWorkspace(slug: string, candidate: string): string {
  const root = workspaceRoot(slug);
  const realRoot = realpathIfPossible(root);

  const raw = String(candidate ?? "");
  if (raw.includes("\0")) {
    throw new WorkspaceViolationError("Path contains a null byte.", raw);
  }

  // An absolute path is only acceptable if it is already inside the workspace;
  // it is never reinterpreted as relative, which would silently "fix" a path
  // that was meant to escape and hide the attempt.
  const joined = path.isAbsolute(raw) ? path.normalize(raw) : path.resolve(root, raw);
  const resolved = realpathIfPossible(joined);

  if (!isInside(realRoot, resolved)) {
    throw new WorkspaceViolationError(
      "That path is outside this bot's workspace.",
      raw,
    );
  }
  return resolved;
}

/** True when `child` is `parent` itself or sits beneath it. */
function isInside(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  // "" means the paths are equal; a leading ".." or an absolute result means
  // the child sits outside. Checking the relative path this way is correct on
  // Windows too, where a naive `startsWith` breaks across drive letters.
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

/**
 * realpath the deepest existing ancestor, then re-append the rest.
 *
 * A path being created does not exist yet, so plain realpath would throw. This
 * still defeats a symlinked *parent*, which is the direction that matters:
 * the escape has to go through a component that already exists.
 */
function realpathIfPossible(target: string): string {
  let current = path.normalize(target);
  const tail: string[] = [];
  for (let depth = 0; depth < 64; depth += 1) {
    try {
      return path.join(realpathSync(current), ...tail);
    } catch {
      const parent = path.dirname(current);
      if (parent === current) return path.normalize(target);
      tail.unshift(path.basename(current));
      current = parent;
    }
  }
  return path.normalize(target);
}
