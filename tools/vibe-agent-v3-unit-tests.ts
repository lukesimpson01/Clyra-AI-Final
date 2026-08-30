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

/* Recovery nudges are real user turns to the model, so they must be
   identifiable — otherwise they surface in the transcript as if the person
   had typed the agent's own scaffolding. */
const { internalPrompt, isInternalPrompt, INTERNAL_PROMPT_MARK } =
  await import("../lib/vibe-agent-v3/internal-prompt.ts");
const nudge = internalPrompt("Continue this exact task from the persisted project state.");
assert.ok(isInternalPrompt(nudge));
assert.ok(nudge.startsWith(INTERNAL_PROMPT_MARK));
assert.ok(nudge.includes("Continue this exact task"));
assert.equal(isInternalPrompt("Build a Pomodoro focus timer"), false);
assert.equal(isInternalPrompt(""), false);
assert.equal(isInternalPrompt(undefined), false);
/* The marker is invisible, so a leak would not be obvious in the UI. */
assert.equal(INTERNAL_PROMPT_MARK.trim().replace(/[\u2060-\u206f\u200b-\u200f]/g, ""), "clyra-internal");

/* The seeded agent guide has to carry the shipped-quality rules, and the
   upgrade marker must match them so existing projects adopt the revision. */
const runtimeSource = await fs.readFile(
  new URL("../lib/opencode/OpenCodeRuntimeManager.ts", import.meta.url), "utf8");
assert.ok(runtimeSource.includes("Finished-product quality"));
assert.ok(runtimeSource.includes("0.6666666666666666m"));
assert.ok(runtimeSource.includes("!/Finished-product quality/.test(existing)"));
assert.ok(runtimeSource.includes("internalPrompt("));
assert.equal(/text: "Continue this exact task/.test(runtimeSource), false);

console.log(JSON.stringify({ ok: true, assertions: 27 }, null, 2));
