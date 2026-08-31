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
const { internalPrompt, isInternalPrompt, stripInternalMark, INTERNAL_PROMPT_MARK } =
  await import("../lib/vibe-agent-v3/internal-prompt.ts");
const nudge = internalPrompt("Continue this exact task from the persisted project state.");
assert.ok(isInternalPrompt(nudge));
assert.ok(nudge.startsWith(INTERNAL_PROMPT_MARK));
assert.ok(nudge.includes("Continue this exact task"));
assert.equal(isInternalPrompt("Build a Pomodoro focus timer"), false);
assert.equal(isInternalPrompt(""), false);
assert.equal(isInternalPrompt(undefined), false);

/* The mark must be plain ASCII. The first version wrapped it in U+2063 so a
   leak would at least be invisible; the provider round-trip normalised those
   away, which both broke the prefix test and printed the bare word
   "clyra-internal" at the top of a real reply. Nothing in the detection path
   may depend on a character a transport is free to strip. */
assert.equal(INTERNAL_PROMPT_MARK, "[clyra:internal]");
assert.match(INTERNAL_PROMPT_MARK, /^[\x20-\x7e]+$/);

/* Detection survives a transport that pads, trims or re-encodes the head. */
assert.ok(isInternalPrompt(`  ${nudge}`));
assert.ok(isInternalPrompt(`\n\t${nudge}`));
assert.ok(isInternalPrompt(`\u200b\ufeff${nudge}`));
/* Sessions written before the change still filter. */
assert.ok(isInternalPrompt("clyra-internalContinue this exact task from the persisted state."));
assert.ok(isInternalPrompt("\u2063clyra-internal\u2063Continue this exact task."));

/* A render path that forgets to ask must still never print the mark. */
assert.equal(stripInternalMark(nudge), "Continue this exact task from the persisted project state.");
assert.equal(stripInternalMark("Build a Pomodoro focus timer"), "Build a Pomodoro focus timer");

/* The seeded agent guide has to carry the shipped-quality rules, and the
   upgrade marker must match them so existing projects adopt the revision. */
const runtimeSource = await fs.readFile(
  new URL("../lib/opencode/OpenCodeRuntimeManager.ts", import.meta.url), "utf8");
assert.ok(runtimeSource.includes("Finished-product quality"));
assert.ok(runtimeSource.includes("0.6666666666666666m"));
assert.ok(runtimeSource.includes("!/Finished-product quality/.test(existing)"));
assert.ok(runtimeSource.includes("internalPrompt("));
assert.equal(/text: "Continue this exact task/.test(runtimeSource), false);

/* The completed-work card once reported "Edited 1 file" for a run that wrote
   six: the tool-payload fallback only ran when the diff endpoint returned
   NOTHING, so a run whose endpoint saw one tracked file dropped every
   untracked one it also wrote. */
const { mergeFileDiffs } = await import("../src/components/clyra-code/store.ts");

const action = (target: string, extra: Record<string, unknown> = {}) => ({
  id: target, kind: "create", tool: "write", target, status: "success",
  startedAt: 0, endedAt: 1, ...extra,
}) as never;

// The reported case: one file from the endpoint, five more written by tools.
const endpoint = [{ file: "/x/projects/p/files/index.html", before: "", after: "a", additions: 10, deletions: 0 }];
const wrote = ["index.html", "css/styles.css", "js/app.js", "js/heatmap.js", "js/storage.js", "js/streak.js"];
const merged = mergeFileDiffs(endpoint, wrote.map((f) => action(f, { additions: 4, deletions: 1 })));
assert.equal(merged.length, 6);
// The endpoint's own entry is preserved untouched — its counts are the real ones.
const html = merged.find((d) => d.file.endsWith("index.html"));
assert.equal(html?.additions, 10);
assert.equal(html?.deletions, 0);
assert.equal(html?.after, "a");

// An empty endpoint still synthesises from the payloads (the old behaviour).
assert.equal(mergeFileDiffs([], wrote.map((f) => action(f))).length, 6);
// No file actions at all: the endpoint's report passes through untouched.
assert.equal(mergeFileDiffs(endpoint, []), endpoint);
// Failed and placeholder actions never become rows.
assert.equal(mergeFileDiffs([], [action("a.js", { status: "error" }), action("…")]).length, 0);
// Repeated writes to one file collapse into a single row with summed counts.
const twice = mergeFileDiffs([], [action("a.js", { additions: 3 }), action("a.js", { additions: 2 })]);
assert.equal(twice.length, 1);
assert.equal(twice[0].additions, 5);

console.log(JSON.stringify({ ok: true, assertions: 45 }, null, 2));
