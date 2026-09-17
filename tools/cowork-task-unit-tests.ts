import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const root = await mkdtemp(path.join(tmpdir(), "clyra-cowork-tasks-"));
process.env.CLYRA_DATA_ROOT = root;
const { CoworkTaskStore, CoworkTaskError } = await import("../lib/bots/tasks");
let assertions = 0;
const check = (value: unknown, message: string) => { assert.ok(value, message); assertions += 1; };

try {
  const store = new CoworkTaskStore();
  const rootTask = await store.create({ conversationId: "thread-1", botId: "alex", title: "Build a page", objective: "Build and verify a landing page" });
  check(rootTask.state === "planned", "new tasks are planned");
  check(rootTask.events[0].kind === "plan", "task creation is an activity event");
  const running = await store.transition(rootTask.id, "running", { currentStep: "Inspecting repository" });
  check(running.state === "running" && running.currentStep === "Inspecting repository", "running state persists");
  const approval = await store.transition(rootTask.id, "awaiting_approval", { pendingAction: { capability: "terminal", action: "destructive_command", input: { command: "git push" } } });
  check(approval.pendingAction?.action === "destructive_command", "the exact held action is checkpointed");
  const resumed = await store.transition(rootTask.id, "running", { pendingAction: null });
  const complete = await store.transition(rootTask.id, "completed", { currentStep: "Verified complete" });
  check(Boolean(complete.completedAt), "completion is timestamped");
  await assert.rejects(() => store.transition(rootTask.id, "running"), CoworkTaskError, "terminal tasks cannot resume silently"); assertions += 1;
  const child = await store.create({ conversationId: "thread-1", parentId: rootTask.id, botId: "maya", title: "Research", objective: "Research competitors", dependsOn: [rootTask.id] });
  check((await store.list({ conversationId: "thread-1" })).length === 2, "tasks persist and can be listed by conversation");
  check(child.parentId === rootTask.id && child.dependsOn.includes(rootTask.id), "parent and dependency edges persist");
  const paused = await store.create({ conversationId: "thread-2", botId: "alex", title: "Paused task", objective: "test" });
  await store.transition(paused.id, "paused");
  const retrying = await store.retry(paused.id);
  check(retrying.state === "retrying" && retrying.retries === 1, "retry creates a durable retry checkpoint");
  console.log(`cowork-task-unit-tests: ${assertions} assertions passed`);
} finally { await rm(root, { recursive: true, force: true }); }
