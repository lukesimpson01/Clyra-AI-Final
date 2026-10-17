/**
 * Real terminal and git execution for the Mission Runtime / Hermes tool
 * catalog. The forbidden/destructive command patterns are ported from the
 * (removed) `lib/bots/routes.ts` — they are Clyra's existing, previously
 * audited command-safety gate, not a new policy invented for this file.
 */
import { execFile } from "node:child_process";
import type { Json, ToolResult } from "./core";
import { resolveInUserFiles, FileAccessViolationError, userFilesRoot } from "./fs-tools";

/** Commands refused outright — the damage is not worth an approval prompt. */
const FORBIDDEN_COMMAND = /(^|\s|;|&&|\|\|)(rm\s+-rf\s+\/(\s|$)|mkfs|dd\s+if=|shutdown|reboot|:\(\)\s*\{)/i;

const MAX_OUTPUT = 200_000;
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_MS = 120_000;

function clip(value: string) {
  return value.length > MAX_OUTPUT ? `${value.slice(0, MAX_OUTPUT)}\n…(truncated)` : value;
}

function resolveCwd(candidate: unknown): string {
  const raw = typeof candidate === "string" && candidate.trim() ? candidate : "~";
  return resolveInUserFiles(raw);
}

export async function terminalRun(args: Json): Promise<ToolResult> {
  const input = args as { command?: string; cwd?: string; timeoutMs?: number };
  const command = String(input.command || "").trim();
  if (!command) return { ok: false, error: { code: "INVALID_ARGUMENTS", message: "No command was provided." } };
  if (FORBIDDEN_COMMAND.test(command)) {
    return { ok: false, error: { code: "PERMISSION_REQUIRED", message: "This command is blocked outright — it is destructive enough that no approval can authorize it." } };
  }
  let cwd: string;
  try {
    cwd = resolveCwd(input.cwd);
  } catch (error) {
    if (error instanceof FileAccessViolationError) return { ok: false, error: { code: "PERMISSION_REQUIRED", message: error.message } };
    throw error;
  }
  const timeoutMs = Math.min(MAX_TIMEOUT_MS, Math.max(1_000, Number(input.timeoutMs) || DEFAULT_TIMEOUT_MS));
  return new Promise<ToolResult>((resolve) => {
    const shell = process.platform === "win32" ? "cmd.exe" : "/bin/sh";
    const shellArgs = process.platform === "win32" ? ["/d", "/s", "/c", command] : ["-c", command];
    execFile(shell, shellArgs, { cwd, timeout: timeoutMs, maxBuffer: MAX_OUTPUT * 2 }, (error, stdout, stderr) => {
      const exitCode = error && "code" in error && typeof error.code === "number" ? error.code : error ? 1 : 0;
      const timedOut = Boolean(error && "killed" in error && error.killed);
      resolve({
        ok: !error || exitCode === 0,
        data: {
          command,
          cwd,
          exitCode,
          stdout: clip(stdout || ""),
          stderr: clip(stderr || ""),
          timedOut,
        },
        evidence: [{ kind: "log", value: `${command} (exit ${exitCode})` }],
        ...(error && exitCode !== 0
          ? { error: { code: timedOut ? "TOOL_TIMEOUT" as const : "TOOL_CRASH" as const, message: timedOut ? "The command timed out." : `Command exited with code ${exitCode}.`, retryable: false } }
          : {}),
      });
    });
  });
}

function runGit(argv: string[], cwd: string): Promise<{ ok: boolean; stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve) => {
    execFile("git", argv, { cwd, timeout: DEFAULT_TIMEOUT_MS, maxBuffer: MAX_OUTPUT * 2 }, (error, stdout, stderr) => {
      const exitCode = error && "code" in error && typeof error.code === "number" ? error.code : error ? 1 : 0;
      resolve({ ok: !error, stdout: clip(stdout || ""), stderr: clip(stderr || ""), exitCode });
    });
  });
}

async function gitCwd(input: { path?: string }): Promise<string | ToolResult> {
  try {
    return resolveCwd(input.path);
  } catch (error) {
    if (error instanceof FileAccessViolationError) return { ok: false, error: { code: "PERMISSION_REQUIRED", message: error.message } };
    throw error;
  }
}

export async function gitStatus(args: Json): Promise<ToolResult> {
  const input = args as { path?: string };
  const cwd = await gitCwd(input);
  if (typeof cwd !== "string") return cwd;
  const result = await runGit(["status", "--short", "--branch"], cwd);
  return {
    ok: result.ok,
    data: { cwd, output: result.stdout, exitCode: result.exitCode },
    evidence: [{ kind: "log", value: `git status in ${cwd}` }],
    ...(result.ok ? {} : { error: { code: "TOOL_CRASH" as const, message: result.stderr || "git status failed." } }),
  };
}

export async function gitDiff(args: Json): Promise<ToolResult> {
  const input = args as { path?: string; staged?: boolean };
  const cwd = await gitCwd(input);
  if (typeof cwd !== "string") return cwd;
  const result = await runGit(input.staged ? ["diff", "--staged"] : ["diff"], cwd);
  return {
    ok: result.ok,
    data: { cwd, diff: result.stdout, exitCode: result.exitCode },
    evidence: [{ kind: "log", value: `git diff in ${cwd}` }],
    ...(result.ok ? {} : { error: { code: "TOOL_CRASH" as const, message: result.stderr || "git diff failed." } }),
  };
}

export async function gitCommit(args: Json): Promise<ToolResult> {
  const input = args as { path?: string; message?: string };
  const message = String(input.message || "").trim();
  if (!message) return { ok: false, error: { code: "INVALID_ARGUMENTS", message: "A commit message is required." } };
  const cwd = await gitCwd(input);
  if (typeof cwd !== "string") return cwd;
  const result = await runGit(["commit", "-m", message], cwd);
  return {
    ok: result.ok,
    data: { cwd, output: result.stdout, exitCode: result.exitCode },
    evidence: result.ok ? [{ kind: "log", value: `git commit in ${cwd}: ${message}` }] : undefined,
    ...(result.ok ? {} : { error: { code: "TOOL_CRASH" as const, message: result.stderr || "git commit failed." } }),
  };
}

export { userFilesRoot };
