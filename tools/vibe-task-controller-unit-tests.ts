import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { CodingTaskController } from "../lib/vibe-runtime/task-controller";

const root = await mkdtemp(path.join(tmpdir(), "clyra-task-controller-"));
try {
  const controller = new CodingTaskController(root, "session-safe-id");
  await controller.begin("Repair the broken save button", [{ id: "inspect", objective: "Inspect save flow", files: ["src/save.ts"], validation: ["unit test"], status: "active" }]);
  await controller.phase("EXPLORING", "Finding the event handler");
  await controller.recordTool("read", "src/save.ts", "completed");
  await controller.recordTool("npm test save", "save", "failed", "expected true, got false");
  await controller.recordTool("npm test save", "save", "failed", "expected true, got false");
  const stuck = await controller.shouldChangeStrategy();
  assert.equal(stuck.stuck, true);
  await controller.recordRecovery(stuck.reason);
  await controller.update((ledger) => {
    ledger.changedFiles.push("src/save.ts");
    ledger.tests.push({ name: "save test", status: "passed" });
    ledger.completed.push("Inspect save flow");
  });
  const first = await controller.get();
  assert.equal(first.phase, "DEBUGGING");
  assert.equal(first.recoveryCount, 1);
  assert.deepEqual(first.changedFiles, ["src/save.ts"]);
  assert.equal(first.tests[0]?.status, "passed");

  // State survives a fresh controller just as it must after a desktop restart.
  const restored = await new CodingTaskController(root, "session-safe-id").get();
  assert.equal(restored.objective, "Repair the broken save button");
  await controller.requestPause();
  assert.equal((await controller.get()).phase, "PAUSED");
  assert.equal(await controller.canRecover(), false);
  console.log(JSON.stringify({ ok: true, assertions: 10 }, null, 2));
} finally {
  await rm(root, { recursive: true, force: true });
}
