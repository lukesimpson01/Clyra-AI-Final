/**
 * macOS Seatbelt (sandbox-exec) process confinement.
 *
 * Ported from DeepSeek Harness's dsh-sandbox-local, whose Seatbelt profile
 * (third_party/deepseek-harness/packages/sandbox/sandbox-local/src/profiles.ts,
 * commit 99f6f02fecdb7dff40c3fbc9470f5907c29f74ca) is deliberately narrow:
 * `(allow default)` leaves reads, network, and process execution untouched,
 * and only file WRITES outside an explicit allow-list are denied. That's
 * the shape kept here — it closes Clyra's real gap (agent shell/tool
 * execution had no confinement at all: a raw, unrestricted host shell) while
 * staying unlikely to break legitimate agent workflows.
 *
 * Availability is probed once and cached. If Seatbelt is unavailable or its
 * probe fails, callers fall back to today's unconfined spawn rather than
 * refusing to run: this is a defense-in-depth addition to a consumer product,
 * not the sole safeguard, so a probe failure degrades the product instead of
 * breaking it outright. `sandboxStatus()` surfaces which path is active.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clyraDataPath } from "../runtime-paths";

const SEATBELT_EXEC = "sandbox-exec";

function sbplString(value: string): string {
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

/**
 * Seatbelt's `subpath` matches the kernel's resolved path, not whatever
 * string a caller passes — macOS resolves `/var` to `/private/var` (and
 * `/tmp` to `/private/tmp`) at the syscall level, so an unresolved
 * `os.tmpdir()` string silently never matches and every write under it gets
 * denied. Every root must be canonicalized before it goes in the profile.
 * Falls back to the given path if it doesn't exist yet (nothing can be
 * written there under that exact path anyway until it's created).
 */
function realRoot(root: string): string {
  try { return fs.realpathSync(root); } catch { return root; }
}

/** Package-manager and OS temp directories an agent-run install can legitimately need to write to, beyond the project itself. */
export function sharedCacheRoots(): string[] {
  const home = os.homedir();
  return [
    path.join(home, ".npm"),
    path.join(home, ".cache"),
    path.join(home, ".yarn"),
    path.join(home, ".pnpm-store"),
    path.join(home, ".cargo"),
    path.join(home, ".bun"),
    os.tmpdir(),
  ].map(realRoot);
}

/**
 * OpenCode's own operational data directory (session DB, logs, provider
 * auth) — the same path `OpenCodeRuntimeManager.readRecentProviderAuthError`
 * already reads. The confined process is the OpenCode server itself, so it
 * needs to keep writing here or it never finishes booting.
 */
export function opencodeDataRoot(): string {
  return realRoot(path.join(
    process.platform === "win32" ? path.join(os.homedir(), "AppData", "Local", "opencode") : path.join(os.homedir(), ".local", "share", "opencode"),
  ));
}

/**
 * Same shape as dsh's seatbeltProfileArgs: allow everything, deny writes
 * except an explicit allow-list. Also allows pty allocation (`/dev/ptmx`
 * plus the dynamically-numbered `/dev/ttysNNN` slave device it opens) —
 * confirmed by direct testing that `deny file-write*` otherwise blocks it
 * outright ("no more ptys"), which breaks any pty-based tool execution
 * (the terminal panel, and very likely OpenCode's own bash/terminal tool —
 * it has its own pty subsystem at packages/core/src/pty.ts upstream).
 * Deliberately narrower than allowing all of `/dev`: that would also permit
 * writes to raw disk device nodes (`/dev/disk0` etc.), which is a real
 * regression, not a safe compromise.
 */
export function seatbeltProfileArgs(writableRoots: string[]): string[] {
  const forms = [
    "(version 1)",
    "(allow default)",
    "(deny file-write*)",
    `(allow file-write* (literal ${sbplString("/dev/null")}))`,
    `(allow file-write* (literal ${sbplString("/dev/ptmx")}))`,
    `(allow file-write* (regex #"^/dev/ttys[0-9]+$"))`,
  ];
  const roots = writableRoots.map(realRoot);
  if (roots.length > 0) {
    forms.push(`(allow file-write* ${roots.map((root) => `(subpath ${sbplString(root)})`).join(" ")})`);
  }
  return ["-p", forms.join(" ")];
}

let probed: boolean | null = null;

/**
 * Functional probe: apply a real profile and run `true` under it — exit 0
 * means the kernel accepted and enforced it (mirrors dsh's own probe, which
 * notes sandbox-exec is deprecated but still shipped on every macOS).
 */
export function seatbeltAvailable(): boolean {
  if (process.platform !== "darwin") return false;
  if (probed !== null) return probed;
  try {
    const result = spawnSync(SEATBELT_EXEC, [...seatbeltProfileArgs([os.tmpdir()]), "--", "true"], {
      timeout: 5_000,
      stdio: "ignore",
    });
    probed = result.status === 0;
  } catch {
    probed = false;
  }
  return probed;
}

/** Wrap one argv under Seatbelt confinement for the given writable roots. */
export function confineArgv(command: string, args: string[], writableRoots: string[]): { command: string; args: string[] } {
  return { command: SEATBELT_EXEC, args: [...seatbeltProfileArgs(writableRoots), "--", command, ...args] };
}

/** Resolve the real `opencode` binary's absolute path using the current (unmodified) PATH, before any wrapper directory is prepended. */
function resolveRealOpencodeBinary(): string | null {
  const result = spawnSync(process.platform === "win32" ? "where" : "which", ["opencode"], { encoding: "utf8" });
  if (result.status !== 0) return null;
  const first = result.stdout.split(/\r?\n/).find((line) => line.trim());
  return first ? first.trim() : null;
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

let wrapperDirCache: string | null | undefined;

/**
 * Generates a wrapper script also named `opencode` that re-execs the real
 * binary under Seatbelt, and returns its containing directory. The caller
 * prepends this directory to `process.env.PATH` ONCE at server startup —
 * `@opencode-ai/sdk`'s `createOpencodeServer` resolves the literal string
 * "opencode" via `cross-spawn` with no command-override hook exposed
 * (confirmed against `node_modules/@opencode-ai/sdk/dist/server.d.ts`), so a
 * PATH shim is the only non-invasive interception point available. Scoped to
 * `writableRoots` rather than one project directory: Clyra runs a single
 * shared OpenCode server process across every open project, not one per
 * project, so the confinement has to cover all of them at once.
 */
export function installOpencodeSandboxWrapper(writableRoots: string[]): string | null {
  if (wrapperDirCache !== undefined) return wrapperDirCache;
  if (!seatbeltAvailable()) return (wrapperDirCache = null);
  const realBinary = resolveRealOpencodeBinary();
  if (!realBinary) return (wrapperDirCache = null);
  try {
    const wrapperDir = clyraDataPath("sandbox", "bin");
    fs.mkdirSync(wrapperDir, { recursive: true });
    const wrapperPath = path.join(wrapperDir, "opencode");
    const profileArgs = seatbeltProfileArgs(writableRoots).map(shellQuote).join(" ");
    fs.writeFileSync(
      wrapperPath,
      `#!/bin/sh\nexec ${SEATBELT_EXEC} ${profileArgs} -- ${shellQuote(realBinary)} "$@"\n`,
      { mode: 0o755 },
    );
    return (wrapperDirCache = wrapperDir);
  } catch {
    return (wrapperDirCache = null);
  }
}

export function sandboxStatus(): { platform: string; available: boolean; active: boolean } {
  return { platform: process.platform, available: seatbeltAvailable(), active: wrapperDirCache !== null && wrapperDirCache !== undefined };
}
