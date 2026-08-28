import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createVibePreflight } from "../lib/vibe-agent-v3/preflight";
import { getVibeUsageAnalytics, recordVibeUsage } from "../lib/vibe-agent-v3/usage-analytics";

const usageTestFile = path.join(os.tmpdir(), `clyra-vibe-usage-${process.pid}.json`);
process.env.CLYRA_VIBE_USAGE_FILE = usageTestFile;
await fs.rm(usageTestFile, { force: true });

const ambiguous = createVibePreflight("Build me an app for managing personal tasks");
assert.equal(ambiguous.effort, "medium");
assert.equal(ambiguous.question?.id, "platform");
assert.equal(ambiguous.mode, "build");

const desktop = createVibePreflight("Build a desktop notes app in Electron", "high");
assert.equal(desktop.projectType, "desktop");
assert.equal(desktop.question, null);
assert.equal(desktop.effort, "high");

const now = Date.now();
await recordVibeUsage({
  id: "v3-test-1", sessionId: "session-a", projectId: "project-a", runId: "run-a", model: "deepseek-v4-flash", provider: "deepseek", timestamp: now,
  inputTokens: 800, outputTokens: 200, totalTokens: 1000, latencyMs: 1200, status: "success", toolCallCount: 3, messageCount: 2, taskType: "build", effort: "medium",
});
await recordVibeUsage({
  id: "v3-test-2", sessionId: "session-b", projectId: "project-a", runId: "run-b", model: "deepseek-v4-pro", provider: "deepseek", timestamp: now - 86_400_000,
  inputTokens: 300, outputTokens: 100, totalTokens: 400, latencyMs: 800, status: "error", toolCallCount: 1, messageCount: 1, taskType: "debug", effort: "high",
});

const all = await getVibeUsageAnalytics("all", now);
assert.equal(all.sessions, 2);
assert.equal(all.messages, 3);
assert.equal(all.totalTokens, 1400);
assert.equal(all.models.length, 2);
assert.equal(all.favoriteModel, "deepseek-v4-flash");
assert.ok(all.activeDays >= 1);
assert.ok(all.heatmap.some((cell) => cell.level > 0));
assert.ok(all.heatmap.every((cell, index, cells) => index === 0 || cell.date > cells[index - 1].date));
const sevenDays = await getVibeUsageAnalytics("7d", now);
const thirtyDays = await getVibeUsageAnalytics("30d", now);
assert.equal(sevenDays.heatmap.length, 7);
assert.equal(thirtyDays.heatmap.length, 30);
assert.ok(sevenDays.heatmap.some((cell) => cell.level === 0));

await fs.rm(usageTestFile, { force: true });

console.log(JSON.stringify({ ok: true, assertions: 16 }, null, 2));
