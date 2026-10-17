import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { AutomationEngine, parseAutomationPrompt } from "../lib/clyra-agent/automation-engine";
import type { MissionPlan, MissionRecord } from "../lib/clyra-agent/core";

let assertions = 0;
const equal = (actual: unknown, expected: unknown, message?: string) => { assertions += 1; assert.equal(actual, expected, message); };
const check = (value: unknown, message?: string): asserts value => { assertions += 1; assert.ok(value, message); };

const now = Date.UTC(2026, 8, 22, 8, 30, 0);
const plan: MissionPlan = {
  objective: "Create a note called Daily plan",
  steps: [{ id: "note", description: "Create a note", toolId: "notes.create", args: { title: "Daily plan", markdown: "# Daily plan" }, dependsOn: [], status: "pending" }],
};
const completed = (missionId: string, projectId: string, source: MissionPlan): MissionRecord => ({
  id: missionId,
  projectId,
  state: "COMPLETED",
  plan: { ...source, steps: source.steps.map((step) => ({ ...step, status: "completed" })) },
  traces: [],
  outputs: {},
  startedAt: now,
  updatedAt: now,
});

const every = parseAutomationPrompt("every 2 hours create a note called Daily plan", now);
check(every, "numeric interval schedule should parse");
equal(every.schedule.kind, "interval");
if (every.schedule.kind === "interval") equal(every.schedule.everyMs, 2 * 60 * 60_000);
equal(every.objective, "create a note called Daily plan");
const once = parseAutomationPrompt("in 10 minutes create a note called Reminder", now);
check(once, "one-time schedule should parse");
equal(once.schedule.kind, "once");
if (once.schedule.kind === "once") equal(once.schedule.at, now + 10 * 60_000);
const morning = parseAutomationPrompt("every morning create a note called Daily plan", now);
check(morning && morning.schedule.kind === "interval" && (morning.schedule.startsAt || 0) > now, "morning stores a concrete next local run");
const sunday = parseAutomationPrompt("every Sunday create a note called Weekly review", now);
check(sunday && sunday.schedule.kind === "interval" && (sunday.schedule.startsAt || 0) > now, "weekday stores a concrete next local run");
equal(parseAutomationPrompt("every now create a note", now), null, "ambiguous schedules are rejected");

const directory = mkdtempSync(path.join(tmpdir(), "clyra-automations-"));
try {
  let clock = now;
  let calls = 0;
  const engine = new AutomationEngine(
    path.join(directory, "automations.sqlite"),
    async ({ missionId, projectId, plan: missionPlan }) => {
      calls += 1;
      return completed(missionId, projectId, missionPlan);
    },
    () => clock,
  );

  const recurring = engine.create({
    name: "Daily plan",
    objective: plan.objective,
    plan,
    schedule: { kind: "interval", everyMs: 2 * 60_000 },
    trigger: "Every 2 minutes",
    connectedCapabilities: ["notes"],
  });
  equal(recurring.nextRunAt, now + 2 * 60_000, "interval stores its next run durably");
  const executed = await engine.runNow(recurring.id);
  equal(calls, 1, "run now dispatches the verified mission executor exactly once");
  equal(executed?.state, "ACTIVE", "a recurring task remains active after a successful run");
  equal(executed?.lastResult?.state, "COMPLETED");
  equal(executed?.nextRunAt, clock + 2 * 60_000, "next interval is calculated after actual completion");

  const paused = engine.pause(recurring.id);
  equal(paused?.state, "PAUSED");
  equal(paused?.nextRunAt, null, "pausing removes a future launch rather than fabricating a date");
  clock += 15 * 60_000;
  const resumed = engine.resume(recurring.id);
  equal(resumed?.state, "ACTIVE");
  equal(resumed?.nextRunAt, clock + 2 * 60_000, "resuming computes a fresh future run");

  const oneShot = engine.create({
    name: "Reminder",
    objective: plan.objective,
    plan,
    schedule: { kind: "once", at: clock + 10 * 60_000 },
    trigger: "In 10 minutes",
    connectedCapabilities: ["notes"],
  });
  const finished = await engine.runNow(oneShot.id);
  equal(finished?.state, "COMPLETED", "verified one-time task becomes completed");
  equal(finished?.nextRunAt, null);
  engine.close();

  let releaseMission!: () => void;
  const pausedEngine = new AutomationEngine(
    path.join(directory, "paused.sqlite"),
    async ({ missionId, projectId, plan: missionPlan }) => await new Promise<MissionRecord>((resolve) => {
      releaseMission = () => resolve(completed(missionId, projectId, missionPlan));
    }),
    () => clock,
  );
  const inFlight = pausedEngine.create({
    name: "Safe pause",
    objective: plan.objective,
    plan,
    schedule: { kind: "interval", everyMs: 60_000 },
    trigger: "Every minute",
    connectedCapabilities: ["notes"],
  });
  const pending = pausedEngine.runNow(inFlight.id);
  await new Promise((resolve) => setTimeout(resolve, 0));
  pausedEngine.pause(inFlight.id);
  releaseMission();
  const pausedDuringRun = await pending;
  equal(pausedDuringRun?.state, "PAUSED", "a late mission result cannot reactivate a paused schedule");
  equal(pausedDuringRun?.nextRunAt, null);
  equal(pausedDuringRun?.lastResult?.state, "COMPLETED", "the actual run evidence is retained while the schedule stays paused");
  pausedEngine.close();
} finally {
  rmSync(directory, { recursive: true, force: true });
}

console.log(`Clyra automation engine: ${assertions} assertions passed.`);
