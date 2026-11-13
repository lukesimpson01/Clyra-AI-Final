import type { MissionPlan, MissionRecord } from "./core";

/** Safe mid-task replanning: verified evidence survives only when the entire
 * tool request and its already-verified dependency chain are unchanged. */
export function replanVoiceMission(saved: MissionRecord, planned: MissionPlan, instruction: string): MissionRecord {
  const preserved = new Set<string>();
  const steps = planned.steps.map((step) => {
    const previous = saved.plan.steps.find((candidate) => candidate.id === step.id);
    const same = previous?.toolId === step.toolId
      && JSON.stringify(previous.args) === JSON.stringify(step.args)
      && JSON.stringify(previous.dependsOn) === JSON.stringify(step.dependsOn);
    if (same && previous?.status === "completed" && previous.verification?.status === "verified"
      && step.dependsOn.every((id) => preserved.has(id))) {
      preserved.add(step.id);
      return structuredClone(previous);
    }
    return step;
  });
  const now = Date.now();
  return {
    ...structuredClone(saved),
    state: "PAUSED",
    plan: { objective: planned.objective, steps },
    outputs: Object.fromEntries(Object.entries(saved.outputs).filter(([id]) => preserved.has(id))),
    approval: undefined,
    error: undefined,
    updatedAt: now,
    traces: [...saved.traces, { at: now, state: "PAUSED", event: `Voice correction accepted: ${instruction.slice(0, 200)}` }],
  };
}
