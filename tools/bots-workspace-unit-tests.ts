/**
 * Workspace isolation tests for Clyra Cowork.
 *
 * These are security tests, not unit-coverage box-ticking: every case here is
 * a real way an agent-supplied path escapes a directory, including the ones
 * that defeat naive `startsWith` and plain-`cwd` sandboxing.
 */
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const root = await mkdtemp(path.join(tmpdir(), "clyra-bots-"));
process.env.CLYRA_DATA_ROOT = root;

const {
  WorkspaceViolationError, botSlug, botsRoot, ensureWorkspace, resolveInWorkspace, workspaceRoot,
} = await import("../lib/bots/workspace");

let assertions = 0;
const check = (value: unknown, message: string) => { assert.ok(value, message); assertions += 1; };
const rejects = (fn: () => unknown, message: string) => {
  assert.throws(fn, WorkspaceViolationError, message);
  assertions += 1;
};

try {
  // ── Slugs ───────────────────────────────────────────────────────────
  check(botSlug("Sales Agent") === "Sales-Agent", "spaces become hyphens");
  check(botSlug("  Coder!!  ") === "Coder", "punctuation and padding are stripped");
  check(botSlug("a/../../b") === "ab", "path separators cannot survive a slug");
  rejects(() => botSlug(".."), "a bot named '..' is refused outright");
  rejects(() => botSlug("///"), "a slug that reduces to nothing is refused");
  rejects(() => botSlug(""), "an empty name is refused");

  await ensureWorkspace("Researcher");
  const wsRoot = workspaceRoot("Researcher");
  check(wsRoot.startsWith(botsRoot()), "a workspace lives under the bots root");

  // ── Ordinary paths resolve ──────────────────────────────────────────
  const notes = resolveInWorkspace("Researcher", "files/notes.md");
  check(notes.startsWith(await realish(wsRoot)), "a relative path stays inside");
  check(resolveInWorkspace("Researcher", "./a/../b.txt").endsWith("b.txt"),
    "internal '..' that stays inside is fine");
  check(resolveInWorkspace("Researcher", "") === await realish(wsRoot),
    "an empty path resolves to the workspace root itself");

  // ── Traversal ───────────────────────────────────────────────────────
  rejects(() => resolveInWorkspace("Researcher", "../Coder/secret.txt"), "sibling bot is out of reach");
  rejects(() => resolveInWorkspace("Researcher", "../../../../etc/passwd"), "deep traversal is refused");
  rejects(() => resolveInWorkspace("Researcher", "files/../../../etc/passwd"), "traversal mid-path is refused");

  // ── Absolute paths ──────────────────────────────────────────────────
  rejects(() => resolveInWorkspace("Researcher", "/etc/passwd"), "an absolute outside path is refused");
  check(resolveInWorkspace("Researcher", path.join(wsRoot, "files", "ok.txt")).endsWith("ok.txt"),
    "an absolute path already inside the workspace is allowed");

  // ── Null byte ───────────────────────────────────────────────────────
  rejects(() => resolveInWorkspace("Researcher", "files/ok\0.txt"), "a null byte is refused");

  // ── Symlink escape: the case cwd-based sandboxing misses ────────────
  const outside = path.join(root, "outside-secrets");
  await mkdir(outside, { recursive: true });
  await writeFile(path.join(outside, "secret.txt"), "top secret", "utf8");
  await symlink(outside, path.join(wsRoot, "files", "escape-link"), "dir");
  rejects(
    () => resolveInWorkspace("Researcher", "files/escape-link/secret.txt"),
    "reading through a symlink that points outside is refused",
  );
  rejects(
    () => resolveInWorkspace("Researcher", "files/escape-link/new-file.txt"),
    "writing through an outward symlink is refused even for a new file",
  );

  // A symlink that stays inside the workspace must still work.
  await mkdir(path.join(wsRoot, "files", "real-dir"), { recursive: true });
  await symlink(path.join(wsRoot, "files", "real-dir"), path.join(wsRoot, "files", "inner-link"), "dir");
  check(
    resolveInWorkspace("Researcher", "files/inner-link/note.txt").includes("real-dir"),
    "an internal symlink resolves to its real location and is allowed",
  );

  // ── Prefix confusion: "Researcher-2" must not count as inside "Researcher"
  await ensureWorkspace("Researcher-2");
  rejects(
    () => resolveInWorkspace("Researcher", path.join(botsRoot(), "Researcher-2", "files", "x.txt")),
    "a sibling whose name shares a prefix is still outside",
  );

  // ── One bot cannot reach another through its own resolver ───────────
  rejects(
    () => resolveInWorkspace("Researcher-2", path.join(wsRoot, "files", "notes.md")),
    "a bot cannot resolve into another bot's workspace",
  );

  console.log(`bots-workspace-unit-tests: ${assertions} assertions passed`);
} finally {
  await rm(root, { recursive: true, force: true });
}

/** realpath for comparison, tolerating a not-yet-created path. */
async function realish(target: string) {
  const { realpath } = await import("node:fs/promises");
  try { return await realpath(target); } catch { return target; }
}
