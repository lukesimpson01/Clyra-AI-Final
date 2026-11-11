/**
 * Typed Swift Package Manager execution. Every command is a fixed argument array
 * run without a shell. Callers choose a command and validated options; they never
 * supply a shell string. Output is parsed into structured results, and the raw log
 * is kept only as a short tail.
 */
import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { parseBuildDiagnostics, summarizeDiagnostics, type BuildDiagnostic } from "../diagnostics/parse-diagnostics";
import { createProcessEnvironment, sanitizeToolOutputForModel } from "../security/environment";

const execFileAsync = promisify(execFile);

export type SwiftPackageCommand = "resolve" | "build" | "test" | "run" | "show-dependencies";

export type SwiftPackageOptions = {
  configuration?: "debug" | "release";
  /** Test filter, e.g. "MyTests.testAdd". Validated before use. */
  filter?: string;
  /** Executable product for `run`. Validated before use. */
  product?: string;
  timeoutMs?: number;
};

export type SwiftTestSummary = {
  framework: "xctest" | "swift-testing";
  total: number;
  failed: number;
  passed: number;
  durationSeconds: number;
};

export type SwiftCommandResult = {
  command: SwiftPackageCommand;
  ok: boolean;
  exitCode: number | null;
  timedOut: boolean;
  durationMs: number;
  /** Seconds reported by `swift build` when it completes. */
  buildSeconds?: number;
  tests?: SwiftTestSummary;
  diagnostics: BuildDiagnostic[];
  diagnosticCounts: { errors: number; warnings: number };
  /** Last lines of combined output, for display. The full log stays out of model context. */
  tail: string;
  /** Parsed JSON for `show-dependencies`. */
  dependencies?: unknown;
  error?: string;
};

const SAFE_NAME = /^[A-Za-z0-9_.-]+$/;
const SAFE_FILTER = /^[A-Za-z0-9_.\-/*]+$/;
const TAIL_LINES = 60;
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;

export class SwiftPackageError extends Error {}

export function validateSwiftOptions(command: SwiftPackageCommand, options: SwiftPackageOptions) {
  if (options.configuration && options.configuration !== "debug" && options.configuration !== "release") {
    throw new SwiftPackageError(`Unsupported configuration: ${String(options.configuration)}`);
  }
  if (options.filter !== undefined && !SAFE_FILTER.test(options.filter)) {
    throw new SwiftPackageError("Test filter contains characters that are not allowed.");
  }
  if (options.product !== undefined && !SAFE_NAME.test(options.product)) {
    throw new SwiftPackageError("Product name contains characters that are not allowed.");
  }
  if (options.product !== undefined && command !== "run") {
    throw new SwiftPackageError("A product can only be given to `run`.");
  }
  if (options.filter !== undefined && command !== "test") {
    throw new SwiftPackageError("A filter can only be given to `test`.");
  }
}

/** Builds the argument array for a command. Exported so tests can check the mapping. */
export function swiftArgs(command: SwiftPackageCommand, options: SwiftPackageOptions = {}): string[] {
  validateSwiftOptions(command, options);
  const config = options.configuration ? ["--configuration", options.configuration] : [];
  switch (command) {
    case "resolve":
      return ["package", "resolve"];
    case "show-dependencies":
      return ["package", "show-dependencies", "--format", "json"];
    case "build":
      return ["build", ...config];
    case "test":
      return ["test", ...config, ...(options.filter ? ["--filter", options.filter] : [])];
    case "run":
      return ["run", ...config, ...(options.product ? [options.product] : [])];
  }
}

/** Parses the build time reported by `swift build`, e.g. "Build complete! (3.71s)". */
export function parseSwiftBuildSeconds(output: string): number | undefined {
  const match = /Build complete! \(([\d.]+)s\)/.exec(output);
  return match ? Number(match[1]) : undefined;
}

/**
 * Parses test totals from XCTest and Swift Testing output.
 * XCTest: "Executed 42 tests, with 1 failure (0 unexpected) in 0.012 (0.015) seconds"
 * Swift Testing: "Test run with 84 tests in 12 suites passed after 0.042 seconds."
 */
export function parseSwiftTests(output: string): SwiftTestSummary | undefined {
  const xctest = /Executed (\d+) tests?, with (\d+) failures? \(\d+ unexpected\) in [\d.]+ \([\d.]+\) seconds/g;
  let lastXCTest: RegExpExecArray | null = null;
  for (let m = xctest.exec(output); m; m = xctest.exec(output)) lastXCTest = m;
  // Swift 6 on Linux often prints an XCTest preamble saying "Executed 0
  // tests" before reporting its real Swift Testing cases. Do not take that
  // empty preamble as the final result.
  const xctestSummary: SwiftTestSummary | undefined = lastXCTest ? (() => {
    const total = Number(lastXCTest[1]);
    const failed = Number(lastXCTest[2]);
    const seconds = /Executed \d+ tests?.* in ([\d.]+) \(/.exec(lastXCTest[0]);
    return { framework: "xctest", total, failed, passed: total - failed, durationSeconds: seconds ? Number(seconds[1]) : 0 };
  })() : undefined;

  const testing = /Test run with (\d+) tests? (?:in \d+ suites? )?(passed|failed) after ([\d.]+) seconds/g;
  let lastTesting: RegExpExecArray | null = null;
  for (let m = testing.exec(output); m; m = testing.exec(output)) lastTesting = m;
  if (lastTesting && (!xctestSummary || xctestSummary.total === 0)) {
    const total = Number(lastTesting[1]);
    const failed = lastTesting[2] === "failed" ? total : 0;
    return { framework: "swift-testing", total, failed, passed: total - failed, durationSeconds: Number(lastTesting[3]) };
  }
  return xctestSummary;
}

function tailOf(output: string) {
  const lines = output.split(/\r?\n/).filter((line) => line.length > 0);
  return lines.slice(-TAIL_LINES).join("\n");
}

export async function assertSwiftPackage(root: string) {
  try {
    await fs.access(path.join(root, "Package.swift"));
  } catch {
    throw new SwiftPackageError("No Package.swift found in this directory.");
  }
}

export async function runSwiftPackage(
  root: string,
  command: SwiftPackageCommand,
  options: SwiftPackageOptions = {},
): Promise<SwiftCommandResult> {
  const args = swiftArgs(command, options);
  await assertSwiftPackage(root);

  const started = Date.now();
  let stdout = "";
  let stderr = "";
  let exitCode: number | null = 0;
  let timedOut = false;
  let error: string | undefined;

  try {
    const result = await execFileAsync("swift", args, {
      cwd: root,
      timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      maxBuffer: 16 * 1024 * 1024,
      // Swift needs PATH and the toolchain variables, not credentials.
      env: { ...createProcessEnvironment(), NO_COLOR: "1" },
    });
    stdout = result.stdout;
    stderr = result.stderr;
  } catch (caught) {
    const failure = caught as NodeJS.ErrnoException & { stdout?: string; stderr?: string; killed?: boolean; signal?: string };
    stdout = failure.stdout ?? "";
    stderr = failure.stderr ?? "";
    if (failure.killed || failure.signal === "SIGTERM") {
      timedOut = true;
      exitCode = null;
      error = "The command was stopped after exceeding its time limit.";
    } else if (typeof failure.code === "number") {
      exitCode = failure.code;
    } else {
      // ENOENT here means the swift binary is not on PATH.
      exitCode = null;
      error = failure.code === "ENOENT"
        ? "The swift command was not found. Install the Swift toolchain."
        : failure.message;
    }
  }

  // Output is redacted before parsing, display or persistence.
  const output = sanitizeToolOutputForModel(`${stdout}\n${stderr}`);
  const diagnostics = parseBuildDiagnostics(output);
  const counts = summarizeDiagnostics(diagnostics);
  const ok = !timedOut && exitCode === 0;

  const result: SwiftCommandResult = {
    command,
    ok,
    exitCode,
    timedOut,
    durationMs: Date.now() - started,
    diagnostics,
    diagnosticCounts: counts,
    tail: tailOf(output),
    error,
  };

  if (command === "build") result.buildSeconds = parseSwiftBuildSeconds(output);
  if (command === "test") result.tests = parseSwiftTests(output);
  if (command === "show-dependencies" && ok) {
    try {
      result.dependencies = JSON.parse(stdout);
    } catch {
      result.error = "show-dependencies did not return JSON.";
    }
  }
  return result;
}
