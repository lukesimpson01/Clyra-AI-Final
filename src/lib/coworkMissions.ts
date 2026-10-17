/**
 * Thin client for Cowork's structured, single-step tool calls. This talks to
 * the same `/api/agent/missions*` endpoints as the rest of Clyra's agent
 * runtime (`lib/clyra-agent/server-mission-service.ts`) — a `safe` tool
 * (files.list, files.read, git.status, git.diff) completes synchronously; a
 * `review`/`sensitive` tool (files.write, terminal.run, git.commit) returns
 * `WAITING_FOR_APPROVAL` and must be confirmed via `approveMissionStep`
 * before Clyra actually performs it. Nothing here bypasses that gate.
 */

export type ToolCallEvidence = { kind: "url" | "file" | "record" | "observation" | "log"; value: string };
export type ToolCallOutput = { ok: boolean; data?: unknown; evidence?: ToolCallEvidence[]; error?: { code: string; message: string } };
export type MissionRunResult = {
  ok: boolean;
  mission: {
    id: string;
    state: string;
    approval?: { stepId: string; toolId: string };
    outputs: Record<string, ToolCallOutput>;
    error?: { message: string };
  };
  error?: string;
};

/** Runs a single named tool step through the deterministic Mission Runtime.
 * `stepId` defaults to "step" — pass a distinct id if you need to read a
 * specific key out of `mission.outputs`. */
export async function runToolStep(toolId: string, args: Record<string, unknown>, stepId = "step"): Promise<MissionRunResult> {
  const response = await fetch("/api/agent/missions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      plan: {
        objective: `Cowork: ${toolId}`,
        steps: [{ id: stepId, description: toolId, toolId, args, dependsOn: [], status: "pending" }],
      },
    }),
  });
  const payload = await response.json().catch(() => null) as MissionRunResult | null;
  if (!payload) throw new Error("Clyra could not reach the agent runtime.");
  return payload;
}

export async function approveMissionStep(missionId: string, stepId: string): Promise<MissionRunResult> {
  const response = await fetch(`/api/agent/missions/${encodeURIComponent(missionId)}/resume`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ approvedStepIds: [stepId] }),
  });
  const payload = await response.json().catch(() => null) as MissionRunResult | null;
  if (!payload) throw new Error("Clyra could not reach the agent runtime.");
  return payload;
}
