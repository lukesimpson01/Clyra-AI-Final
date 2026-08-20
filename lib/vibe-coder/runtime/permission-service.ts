import path from "node:path";
import { promises as fs } from "node:fs";
import type { ToolExecution, PreToolDecision } from "@deepseek-ai/dsh-tools";

export type Risk = "safe" | "moderate" | "dangerous";

const DESTRUCTIVE = /(?:^|\s)(?:sudo\b|git\s+reset\s+--hard|git\s+clean\s+-[a-z]*f|rm\s+-rf\s+(?:\.|\/|~)|mkfs\b|dd\s+if=|force\s+push|drop\s+(?:database|table))/i;
const MODERATE_COMMAND = /\b(?:npm|pnpm|yarn|bun|swift|xcodebuild|git)\b/i;

export function classifyCommand(command: string): Risk {
  if (DESTRUCTIVE.test(command)) return "dangerous";
  if (MODERATE_COMMAND.test(command)) return "moderate";
  return "safe";
}

async function contained(workspace: string, candidate: string) {
  const workspaceReal = await fs.realpath(workspace);
  const resolved = path.resolve(workspace, candidate);
  let cursor = resolved;
  const suffix: string[] = [];
  let candidateReal = "";
  while (!candidateReal) {
    candidateReal = await fs.realpath(cursor).catch(() => "");
    if (candidateReal) break;
    const parent = path.dirname(cursor);
    if (parent === cursor) return false;
    suffix.unshift(path.basename(cursor));
    cursor = parent;
  }
  candidateReal = path.join(candidateReal, ...suffix);
  return candidateReal === workspaceReal || candidateReal.startsWith(`${workspaceReal}${path.sep}`);
}

export class PermissionService {
  constructor(private readonly workspace: string) {}

  async decide(exec: Readonly<ToolExecution>): Promise<PreToolDecision> {
    const args = (exec.arguments ?? {}) as Record<string, unknown>;
    for (const key of ["path", "file_path", "workdir", "cwd"]) {
      const candidate = args[key];
      if (typeof candidate === "string" && !await contained(this.workspace, candidate)) {
        return { kind: "deny", reason: `Path escapes the active workspace: ${candidate}` };
      }
    }
    if (exec.name === "bash") {
      const command = String(args.command ?? "");
      if (classifyCommand(command) === "dangerous") {
        return { kind: "ask", reason: "This command may permanently remove data or change system state." };
      }
    }
    return { kind: "allow" };
  }
}
