import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ClyraAgentActivity } from "../src/shared/clyra/ClyraAgentActivity";
import type { AgentEvent } from "../lib/agent-events/agent-event";

let assertions = 0;
const check = (condition: unknown, message: string) => {
  assertions += 1;
  assert.ok(condition, message);
};

const started: AgentEvent = { type: "tool.started", runId: "r", taskId: "s1", label: "Reading sources" };
const approval: AgentEvent = { type: "approval.required", runId: "r", taskId: "s2" };

const running = renderToStaticMarkup(<ClyraAgentActivity events={[started]} missionState="EXECUTING" />);
check(running.includes("Reading sources") && running.includes('role="status"'), "A running step shows its real label in a status region");
check(running.includes("clyra-thinking-wave--shimmer"), "The running label uses the existing shimmer treatment");

const waiting = renderToStaticMarkup(<ClyraAgentActivity events={[started, approval]} missionState="WAITING_FOR_APPROVAL" />);
check(waiting.includes("Waiting for your approval") && !waiting.includes("Reading sources"), "Approval replaces the step line while waiting");

for (const state of ["COMPLETED", "FAILED", "CANCELLED"]) {
  check(renderToStaticMarkup(<ClyraAgentActivity events={[started]} missionState={state} />) === "", `No activity line once the run is ${state}`);
}
check(renderToStaticMarkup(<ClyraAgentActivity events={[]} missionState="EXECUTING" />) === "", "No activity line without any events");

console.log(`Agent activity render: ${assertions}/${assertions} PASS`);
