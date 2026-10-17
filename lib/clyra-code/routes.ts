/**
 * HTTP surface for the platform layer. Every route is read-only except the Swift
 * command route, which runs a fixed `swift` subcommand inside one project's files.
 * Project ids are sanitised the same way as the OpenCode routes, so a request
 * cannot leave the project sandbox.
 */
import type { Application, Request, Response } from "express";
import path from "node:path";
import { clyraDataPath } from "../runtime-paths";
import { probePlatformCapabilities, type PlatformCapabilityMatrix } from "./platform/capabilities";
import { environmentVariableStatus } from "./security/environment";
import { detectProjectTargets, primaryTarget } from "./targets/detect";
import os from "node:os";
import { execFile } from "node:child_process";
import { listSimulators } from "./ios/simulators";
import { runSwiftPackage, SwiftPackageError, type SwiftPackageCommand } from "./swift/swift-package";

const SWIFT_COMMANDS: SwiftPackageCommand[] = ["resolve", "build", "test", "run", "show-dependencies"];

function safeProjectId(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 96);
}

function projectFilesPath(projectId: string) {
  const id = safeProjectId(projectId);
  if (!id) throw new SwiftPackageError("Project id is invalid.");
  return path.join(clyraDataPath("projects"), id, "files");
}

// Probing spawns short host commands, so the result is reused for a short window.
let matrixCache: { at: number; matrix: PlatformCapabilityMatrix } | null = null;
const MATRIX_TTL_MS = 30_000;

export async function currentCapabilityMatrix(force = false): Promise<PlatformCapabilityMatrix> {
  if (!force && matrixCache && Date.now() - matrixCache.at < MATRIX_TTL_MS) return matrixCache.matrix;
  const matrix = await probePlatformCapabilities();
  matrixCache = { at: Date.now(), matrix };
  return matrix;
}

function sendError(res: Response, error: unknown, status = 500) {
  const message = error instanceof Error ? error.message : "Request failed.";
  res.status(error instanceof SwiftPackageError ? 400 : status).json({ error: message });
}

export function registerClyraCodePlatformRoutes(app: Application) {
  app.get("/api/clyra-code/platform", async (req: Request, res: Response) => {
    try {
      const matrix = await currentCapabilityMatrix(req.query.refresh === "1");
      // Only query simctl when the matrix confirms it is available; otherwise say why.
      const simulators = await listSimulators(matrix);
      res.json({ matrix, simulators, checkedAt: new Date().toISOString() });
    } catch (error) {
      sendError(res, error);
    }
  });

  // Machine facts the agent may use in place of listing the environment. Values
  // are never returned: only presence, platform and tool availability.
  app.get("/api/clyra-code/runtime-info", async (_req: Request, res: Response) => {
    try {
      const matrix = await currentCapabilityMatrix();
      const git = await new Promise<boolean>((resolve) => {
        execFile("git", ["--version"], { timeout: 5000 }, (error) => resolve(!error));
      });
      res.json({
        platform: process.platform,
        architecture: process.arch,
        shell: process.platform === "win32" ? "powershell-or-cmd" : path.basename(process.env.SHELL || "sh"),
        homeAvailable: Boolean(os.homedir()),
        tempDirectoryAvailable: Boolean(os.tmpdir()),
        nodeVersion: process.version,
        gitAvailable: git,
        swiftAvailable: matrix.swift.toolchain.state === "available",
        xcodeAvailable: matrix.apple.xcode.state === "available",
        iosSimulatorAvailable: matrix.apple.iosSimulator.state === "available",
      });
    } catch (error) {
      sendError(res, error);
    }
  });

  app.get("/api/clyra-code/env-status", (req: Request, res: Response) => {
    const raw = typeof req.query.names === "string" ? req.query.names : "";
    const names = raw.split(",").map((name) => name.trim()).filter(Boolean).slice(0, 64);
    if (names.length === 0) {
      res.status(400).json({ error: "Provide one or more variable names in ?names=." });
      return;
    }
    res.json({ status: environmentVariableStatus(names) });
  });

  app.get("/api/clyra-code/projects/:projectId/targets", async (req: Request, res: Response) => {
    try {
      const targets = await detectProjectTargets(projectFilesPath(req.params.projectId));
      res.json({ targets, primary: primaryTarget(targets) ?? null });
    } catch (error) {
      sendError(res, error);
    }
  });

  app.post("/api/clyra-code/projects/:projectId/swift/:command", async (req: Request, res: Response) => {
    const command = req.params.command as SwiftPackageCommand;
    if (!SWIFT_COMMANDS.includes(command)) {
      res.status(400).json({ error: "Unsupported Swift command." });
      return;
    }
    try {
      const body = (req.body ?? {}) as { configuration?: unknown; filter?: unknown; product?: unknown };
      const matrix = await currentCapabilityMatrix();
      if (matrix.swift.toolchain.state !== "available") {
        res.status(409).json({ error: matrix.swift.toolchain.reason });
        return;
      }
      const result = await runSwiftPackage(projectFilesPath(req.params.projectId), command, {
        configuration: body.configuration as "debug" | "release" | undefined,
        filter: typeof body.filter === "string" ? body.filter : undefined,
        product: typeof body.product === "string" ? body.product : undefined,
      });
      res.json(result);
    } catch (error) {
      sendError(res, error);
    }
  });
}
