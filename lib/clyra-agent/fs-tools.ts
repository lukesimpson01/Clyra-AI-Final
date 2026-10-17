/**
 * Real, jailed local filesystem tools for the Mission Runtime / Hermes tool
 * catalog. The path-resolution logic below is ported from the (removed)
 * `lib/bots/host-files.ts` — it is the one audited route to the signed-in
 * user's files: everything is resolved against and confined to the user's
 * home directory, never an operating-system root such as /etc or /System.
 */
import { homedir } from "node:os";
import { realpathSync, constants as fsConstants } from "node:fs";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { Json, ToolExecutionContext, ToolResult } from "./core";

export class FileAccessViolationError extends Error {
  constructor(message: string, public readonly path: string) {
    super(message);
  }
}

const MAX_READ_BYTES = 750_000;
const MAX_LIST_ENTRIES = 500;

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

export function userFilesRoot() {
  return realpathIfPossible(homedir());
}

/** Resolve a caller-supplied path against the user's home directory and
 * reject anything that would escape it (`..`, an absolute OS path outside
 * the root, or a null byte). */
export function resolveInUserFiles(candidate: string): string {
  const root = userFilesRoot();
  const raw = String(candidate ?? "").trim();
  if (raw.includes("\0")) throw new FileAccessViolationError("Path contains a null byte.", raw);

  const expanded = raw === "~" ? root : raw.startsWith("~/") ? path.join(root, raw.slice(2)) : raw;
  const joined = !expanded
    ? root
    : path.isAbsolute(expanded)
      ? path.normalize(expanded)
      : path.resolve(root, expanded);
  const resolved = realpathIfPossible(joined);
  const relative = path.relative(root, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new FileAccessViolationError("That path is outside the signed-in user's files.", raw);
  }
  return resolved;
}

function violation(error: unknown): ToolResult | null {
  if (error instanceof FileAccessViolationError) {
    return { ok: false, error: { code: "PERMISSION_REQUIRED", message: error.message } };
  }
  return null;
}

export async function filesList(args: Json): Promise<ToolResult> {
  const input = args as { path?: string };
  try {
    const target = resolveInUserFiles(input.path || "~");
    const stat = await fs.stat(target);
    if (!stat.isDirectory()) {
      return { ok: false, error: { code: "INVALID_ARGUMENTS", message: "That path is not a directory." } };
    }
    const names = (await fs.readdir(target)).slice(0, MAX_LIST_ENTRIES);
    const entries = await Promise.all(names.map(async (name) => {
      const entryPath = path.join(target, name);
      try {
        const entryStat = await fs.stat(entryPath);
        return { name, type: entryStat.isDirectory() ? "dir" : "file", size: entryStat.size, modifiedAt: entryStat.mtimeMs };
      } catch {
        return { name, type: "unknown", size: 0, modifiedAt: 0 };
      }
    }));
    return {
      ok: true,
      data: { path: target, entries: entries as unknown as Json },
      evidence: [{ kind: "record", value: target }],
    };
  } catch (error) {
    return violation(error) || { ok: false, error: { code: "FILE_NOT_FOUND", message: error instanceof Error ? error.message : "The directory could not be listed." } };
  }
}

export async function filesRead(args: Json): Promise<ToolResult> {
  const input = args as { path?: string };
  try {
    const target = resolveInUserFiles(String(input.path || ""));
    const stat = await fs.stat(target);
    if (!stat.isFile()) return { ok: false, error: { code: "INVALID_ARGUMENTS", message: "That path is not a file." } };
    const truncated = stat.size > MAX_READ_BYTES;
    const handle = await fs.open(target, "r");
    let content: string;
    try {
      const buffer = Buffer.alloc(Math.min(stat.size, MAX_READ_BYTES));
      await handle.read(buffer, 0, buffer.length, 0);
      content = buffer.toString("utf8");
    } finally {
      await handle.close();
    }
    return {
      ok: true,
      data: { path: target, content, size: stat.size, truncated },
      evidence: [{ kind: "file", value: target }],
    };
  } catch (error) {
    return violation(error) || { ok: false, error: { code: "FILE_NOT_FOUND", message: error instanceof Error ? error.message : "The file could not be read." } };
  }
}

export async function filesWrite(args: Json): Promise<ToolResult> {
  const input = args as { path?: string; content?: string; mode?: "overwrite" | "append" };
  try {
    const target = resolveInUserFiles(String(input.path || ""));
    await fs.mkdir(path.dirname(target), { recursive: true });
    const content = String(input.content ?? "");
    if (input.mode === "append") await fs.appendFile(target, content, "utf8");
    else await fs.writeFile(target, content, "utf8");
    const stat = await fs.stat(target);
    return {
      ok: true,
      data: { path: target, bytesWritten: stat.size },
      evidence: [{ kind: "file", value: target }],
    };
  } catch (error) {
    return violation(error) || { ok: false, error: { code: "TOOL_CRASH", message: error instanceof Error ? error.message : "The file could not be written." } };
  }
}

export async function filesMove(args: Json): Promise<ToolResult> {
  const input = args as { from?: string; to?: string };
  try {
    const from = resolveInUserFiles(String(input.from || ""));
    // The destination need not exist yet, so resolve its parent directory
    // and rejoin the basename rather than resolving the (possibly missing)
    // target itself.
    const toRaw = String(input.to || "");
    const toParent = resolveInUserFiles(path.dirname(toRaw) || "~");
    const to = path.join(toParent, path.basename(toRaw));
    await fs.rename(from, to);
    return { ok: true, data: { from, to }, evidence: [{ kind: "file", value: to }] };
  } catch (error) {
    return violation(error) || { ok: false, error: { code: "TOOL_CRASH", message: error instanceof Error ? error.message : "The file could not be moved." } };
  }
}

export async function filesDelete(args: Json): Promise<ToolResult> {
  const input = args as { path?: string };
  try {
    const target = resolveInUserFiles(String(input.path || ""));
    if (target === userFilesRoot()) {
      return { ok: false, error: { code: "PERMISSION_REQUIRED", message: "Clyra will not delete the entire home directory." } };
    }
    const stat = await fs.stat(target);
    if (stat.isDirectory()) await fs.rm(target, { recursive: true });
    else await fs.unlink(target);
    return { ok: true, data: { path: target, deleted: true }, evidence: [{ kind: "record", value: target }] };
  } catch (error) {
    return violation(error) || { ok: false, error: { code: "FILE_NOT_FOUND", message: error instanceof Error ? error.message : "The file could not be deleted." } };
  }
}

/** Used by ServerMissionService's verifier: confirms the evidence path still
 * (or no longer, for a delete) exists on disk rather than trusting the
 * adapter's own return value. */
export async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.access(target, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export type { ToolExecutionContext };
