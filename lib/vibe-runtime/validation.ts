import { spawn } from "node:child_process";
import { existsSync, promises as fs } from "node:fs";
import * as path from "node:path";
import type { ValidationEvidence } from "./runtime";

type PackageJson = { scripts?: Record<string, string> };

async function collectJavaScriptFiles(directory: string): Promise<string[]> {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory() && !entry.name.startsWith(".")) {
      files.push(...await collectJavaScriptFiles(fullPath));
    } else if (entry.isFile() && /\.(?:js|mjs|cjs)$/.test(entry.name)) {
      files.push(fullPath);
    }
  }
  return files;
}

function run(command: string, args: string[], cwd: string, timeoutMs = 120_000) {
  return new Promise<{ exitCode: number; output: string }>((resolve) => {
    const child = spawn(command, args, { cwd, shell: false, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    const push = (value: Buffer) => { output = `${output}${value.toString()}`.slice(-24_000); };
    child.stdout.on("data", push);
    child.stderr.on("data", push);
    const timer = setTimeout(() => child.kill("SIGTERM"), timeoutMs);
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ exitCode: typeof code === "number" ? code : 1, output });
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ exitCode: 1, output: error.message });
    });
  });
}

/**
 * Native Swift packages are checked with the real toolchain. A Swift project is
 * never judged as a static HTML site, and an Xcode project without the Xcode
 * toolchain is reported as skipped with its reason, not as passed.
 */
async function nativeEvidence(workspacePath: string): Promise<ValidationEvidence[] | null> {
  const hasSwiftPackage = existsSync(path.join(workspacePath, "Package.swift"));
  const entries = await fs.readdir(workspacePath).catch(() => [] as string[]);
  const hasXcodeProject = entries.some((name) => name.endsWith(".xcodeproj") || name.endsWith(".xcworkspace"));
  if (!hasSwiftPackage && !hasXcodeProject) return null;

  if (!hasSwiftPackage) {
    const at = new Date().toISOString();
    return [{
      name: "native iOS runtime",
      status: "skipped",
      output: "Xcode project found. Native build and simulator checks need full Xcode on macOS; they were not run.",
      startedAt: at,
      completedAt: at,
    }];
  }

  const { runSwiftPackage } = await import("../clyra-code/swift/swift-package");
  const evidence: ValidationEvidence[] = [];
  for (const command of ["build", "test"] as const) {
    const startedAt = new Date().toISOString();
    const result = await runSwiftPackage(workspacePath, command, { timeoutMs: 15 * 60 * 1000 }).catch((error: unknown) => ({
      ok: false,
      exitCode: null,
      tail: error instanceof Error ? error.message : String(error),
    }));
    evidence.push({
      name: `swift ${command}`,
      command: `swift ${command}`,
      status: result.ok ? "passed" : "failed",
      exitCode: result.exitCode ?? undefined,
      output: result.tail?.slice(-4000),
      startedAt,
      completedAt: new Date().toISOString(),
    });
  }
  return evidence;
}

export async function runWorkspaceValidation(workspacePath: string): Promise<ValidationEvidence[]> {
  const startedAt = new Date().toISOString();
  const packagePath = path.join(workspacePath, "package.json");
  const native = await nativeEvidence(workspacePath);
  if (native) return native;
  if (!existsSync(packagePath)) {
    const indexPath = path.join(workspacePath, "index.html");
    if (!existsSync(indexPath)) {
      // No recognised target means nothing can be validated yet. Reporting that as a
      // failure would push the agent to create an HTML page to satisfy the check.
      return [{ name: "project target", status: "skipped", output: "No project target was detected, so there is nothing to validate yet.", startedAt, completedAt: new Date().toISOString() }];
    }

    const evidence: ValidationEvidence[] = [{
      name: "static HTML entry",
      command: "index.html",
      status: "passed",
      startedAt,
      completedAt: new Date().toISOString(),
    }];
    const sourceFiles = await collectJavaScriptFiles(workspacePath);
    for (const sourceFile of sourceFiles) {
      const checkStarted = new Date().toISOString();
      const relativePath = path.relative(workspacePath, sourceFile);
      const result = await run("node", ["--check", relativePath], workspacePath);
      evidence.push({
        name: `syntax ${relativePath}`,
        command: `node --check ${relativePath}`,
        status: result.exitCode === 0 ? "passed" : "failed",
        exitCode: result.exitCode,
        output: result.output,
        startedAt: checkStarted,
        completedAt: new Date().toISOString(),
      });
      if (result.exitCode !== 0) break;
    }
    return evidence;
  }
  const pkg = JSON.parse(await fs.readFile(packagePath, "utf8")) as PackageJson;
  const names = ["lint", "typecheck", "test", "build"].filter((name) => Boolean(pkg.scripts?.[name]));
  if (!names.length) {
    return [{ name: "package scripts", status: "skipped", output: "No lint, typecheck, test, or build scripts were declared.", startedAt, completedAt: new Date().toISOString() }];
  }
  const evidence: ValidationEvidence[] = [];
  for (const name of names) {
    const checkStarted = new Date().toISOString();
    const result = await run("npm", ["run", name], workspacePath);
    evidence.push({
      name,
      command: `npm run ${name}`,
      status: result.exitCode === 0 ? "passed" : "failed",
      exitCode: result.exitCode,
      output: result.output,
      startedAt: checkStarted,
      completedAt: new Date().toISOString(),
    });
    if (result.exitCode !== 0) break;
  }
  return evidence;
}
