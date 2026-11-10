import assert from "node:assert/strict";
import { runEffortHarness, EFFORT_BUDGET, type HarnessEffort } from "../src/lib/chatEffortHarness";

/** A fake model that plays planner, worker, critic, verifier and writer from what the prompt says, and counts calls. */
function fakeModel(opts: { work: number; criticOkAfter: number }) {
  const calls: string[] = [];
  let criticRound = 0;
  const stream = async (system: string | null, messages: any[], onChunk: (t: string, r?: boolean) => void) => {
    const sys = system ?? "";
    let out: string;
    if (sys.includes("planner for one reply")) {
      calls.push("plan");
      out = JSON.stringify({ intent: "Compare two options", difficulty: 4, work: Array.from({ length: opts.work }, (_, i) => ({ label: `Piece ${i + 1} of it`, task: `do piece ${i + 1}` })), pitfalls: ["hidden costs"], format: "table", labels: { write: "Writing the comparison", check: "Checking the sums" } });
    } else if (sys.includes("one piece of work")) {
      calls.push("work");
      out = "notes for the piece";
    } else if (sys.includes("strict reviewer")) {
      calls.push("critic");
      criticRound += 1;
      out = criticRound > opts.criticOkAfter ? JSON.stringify({ ok: true, label: "All good", issues: [] }) : JSON.stringify({ ok: false, label: "Missing one cost", issues: [{ problem: "no maintenance cost", fix: "add it" }] });
    } else if (sys.includes("independent verifier")) {
      calls.push("verify");
      out = JSON.stringify({ label: "Verified the sums", confirmed: ["a"], corrections: [{ claim: "x", correct: "y" }], uncertain: [] });
    } else if (messages.some((m) => String(m.content).includes("Issues to fix"))) {
      calls.push("revise");
      out = "revised draft";
    } else if (sys.includes("writing the final reply")) {
      calls.push("final");
      out = "FINAL ANSWER";
    } else {
      calls.push("draft-or-direct");
      out = "a draft";
    }
    onChunk(out);
  };
  return { stream: stream as any, calls };
}

async function run(effort: HarnessEffort, model: ReturnType<typeof fakeModel>) {
  const phases: Array<string | null> = [];
  let text = "";
  const steps = await runEffortHarness({ effort, system: "sys", messages: [{ role: "user", content: "which is cheaper?" }], stream: model.stream, temperature: 0.3, onPhase: (p) => phases.push(p), onChunk: (c) => { text += c; } });
  return { phases, text, steps };
}

// light: one direct pass, no planning
{ const m = fakeModel({ work: 3, criticOkAfter: 0 }); const r = await run("light", m); assert.deepEqual(m.calls, ["draft-or-direct"]); assert.equal(r.steps.length, 0); }

// standard: a plan, at most one piece of work, then the answer; no critic
{ const m = fakeModel({ work: 3, criticOkAfter: 0 }); const r = await run("medium", m); assert.equal(m.calls.filter((c) => c === "work").length, EFFORT_BUDGET.medium.maxWork); assert.ok(!m.calls.includes("critic")); assert.ok(r.phases.includes("Writing the comparison"), "phase names come from the model's plan"); }

// extended: up to three pieces, a draft, a critic that sends it back once, then the final write
{ const m = fakeModel({ work: 5, criticOkAfter: 1 }); const r = await run("high", m); assert.equal(m.calls.filter((c) => c === "work").length, 3, "capped at the level's budget"); assert.ok(m.calls.includes("critic")); assert.ok(!m.calls.includes("verify")); assert.equal(r.text, "FINAL ANSWER"); assert.ok(r.steps.some((s) => s.detail?.includes("1 thing to fix")), "the critic's findings are reported"); }

// max: five pieces, two critic rounds with a revision between, an independent verification pass
{ const m = fakeModel({ work: 5, criticOkAfter: 9 }); const r = await run("max", m); assert.equal(m.calls.filter((c) => c === "work").length, 5); assert.equal(m.calls.filter((c) => c === "critic").length, 2); assert.equal(m.calls.filter((c) => c === "revise").length, 1); assert.ok(m.calls.includes("verify")); assert.ok(r.phases.includes("Fixing what it found")); assert.ok(m.calls.indexOf("verify") < m.calls.indexOf("final")); }

// a critic that is satisfied ends the loop early
{ const m = fakeModel({ work: 1, criticOkAfter: 0 }); const probe = fakeModel({ work: 1, criticOkAfter: 0 }); void probe; const r = await run("max", { ...m, stream: m.stream }); assert.ok(m.calls.filter((c) => c === "critic").length >= 1); assert.equal(r.text, "FINAL ANSWER"); }

// a request the planner rates trivial gets no extra work even at a high level
{ const calls: string[] = []; const stream = async (system: string | null, _m: any[], onChunk: (t: string) => void) => { const s = system ?? ""; if (s.includes("planner for one reply")) { calls.push("plan"); onChunk(JSON.stringify({ intent: "Say hi", difficulty: 1, work: [{ label: "x", task: "y" }], labels: {} })); } else { calls.push(s.includes("one piece of work") ? "work" : "other"); onChunk("hi"); } }; await runEffortHarness({ effort: "high", system: "sys", messages: [{ role: "user", content: "hi" }], stream: stream as any, temperature: 0.3, onPhase: () => undefined, onChunk: () => undefined }); assert.ok(!calls.includes("work"), "easy requests do not spend the budget"); }

// a planner that returns garbage does not break the loop
{ const stream = async (system: string | null, _m: any[], onChunk: (t: string) => void) => { onChunk((system ?? "").includes("planner for one reply") ? "not json at all" : "ok"); }; const r = await runEffortHarness({ effort: "medium", system: "s", messages: [{ role: "user", content: "q" }], stream: stream as any, temperature: 0.3, onPhase: () => undefined, onChunk: () => undefined }); assert.equal(r[0].state, "failed"); }
console.log("effort-harness-tests: all assertions passed");
