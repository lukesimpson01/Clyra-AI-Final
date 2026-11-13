/**
 * How much thinking an ordinary chat turn gets, by effort level. This is a conductor, not a script: a fast model reads
 * the request and writes the plan for THIS turn (how hard it is, which pieces of work it needs, what could go wrong),
 * the pieces are carried out by the strong model, a critic reads the draft and decides whether it is good enough, and
 * the loop goes round again if it is not. Every phase name the person sees was written by the model for this request.
 * The level only sets the budget the loop may spend:
 *
 *  - light    one direct pass, no planning.
 *  - standard a short plan; the answer follows it. Extra work only if the plan says the request needs it.
 *  - extended up to 3 pieces of work, each reasoned through on its own and run side by side, a private draft, one critic round.
 *  - max      up to 5 pieces of work, a stronger critic with up to two revision rounds, and an independent verification pass.
 *
 * Plans, notes, drafts and critiques are working material: they never reach the transcript, only the phase names do.
 */

export type HarnessEffort = "light" | "medium" | "high" | "max";
export type HarnessStep = { id: string; label: string; detail?: string; state: "done" | "failed" };

type Stream = (
  system: string | null,
  messages: any[],
  onChunk: (text: string, isReasoning?: boolean) => void,
  temperature: number,
  maxTokens: number,
  model: string,
  signal: AbortSignal | undefined,
  thinking: boolean,
  timeoutMs: number,
  reasoning?: "high" | "max",
) => Promise<void>;

const FAST = "deepseek-v4-flash";
const PRO = "deepseek-v4-pro";

/** What each level may spend. The model decides how much of it a given request actually needs. */
export const EFFORT_BUDGET: Record<HarnessEffort, { plan: boolean; maxWork: number; minWorkWhenHard: number; critic: number; verify: boolean; reasoning?: "high" | "max"; criticModel: string; workTokens: number; workMs: number }> = {
  light: { plan: false, maxWork: 0, minWorkWhenHard: 0, critic: 0, verify: false, criticModel: FAST, workTokens: 2500, workMs: 60_000 },
  medium: { plan: true, maxWork: 1, minWorkWhenHard: 0, critic: 0, verify: false, criticModel: FAST, workTokens: 2500, workMs: 60_000 },
  high: { plan: true, maxWork: 3, minWorkWhenHard: 1, critic: 1, verify: false, reasoning: "high", criticModel: FAST, workTokens: 4000, workMs: 80_000 },
  max: { plan: true, maxWork: 5, minWorkWhenHard: 2, critic: 2, verify: true, reasoning: "max", criticModel: PRO, workTokens: 7000, workMs: 150_000 },
};

const PLAN_PROMPT = `You are the planner for one reply; you do not write it. Read the conversation and decide how this particular request should be handled.
Return ONLY a JSON object:
{
  "intent": "what the person actually needs, one line",
  "difficulty": 1-5,   // 1 = chat or a simple fact, 3 = needs real reasoning, 5 = hard, multi-part or high-stakes
  "work": [ { "label": "2-5 words, shown to the person, in your own words", "task": "exactly what to work out, in one or two sentences" } ],
  "pitfalls": ["what could make the reply wrong, thin or misleading"],
  "format": "the shape the reply should take (length, list, table, code…)",
  "labels": { "write": "2-4 words for writing the reply", "check": "2-4 words for checking it" }
}
Rules: "work" lists only the pieces of thinking this request genuinely needs, in order (none for easy requests). Labels are specific to this request ("Working out the monthly cost"), never generic ("Planning"). No text outside the JSON.`;

const WORK_PROMPT = `You are doing one piece of work toward a reply, privately. Do exactly the task below, using the earlier notes. Write compact, concrete working notes (facts, steps, numbers, decisions) the writer can use. Do not write the reply.
If doing this reveals a sub-problem that must be solved before the reply can be right, end with one final line:
FOLLOW_UP: <2-5 word label> | <the task>
Otherwise end without it.`;

const CRITIC_PROMPT = `You are a strict reviewer of a draft reply. You are given the request, the plan and its pitfalls, the notes, and the draft.
Judge whether the draft fully and correctly serves the request. Look for: errors, missing parts, unsupported claims, wrong math or code, vagueness, padding, wrong format or tone.
Return ONLY JSON:
{ "ok": true|false, "label": "2-5 words naming what you checked or what needs fixing, specific to this draft", "issues": [ { "problem": "...", "fix": "what the draft should say or do instead" } ] }
"ok" is true only when nothing material needs changing. No text outside the JSON.`;

const VERIFY_PROMPT = `You are an independent verifier. Re-derive the key facts, numbers, logic and any code in the draft from scratch, without trusting it.
Return ONLY JSON: { "label": "2-5 words naming what you verified", "confirmed": ["..."], "corrections": [ { "claim": "...", "correct": "..." } ], "uncertain": ["claims that cannot be established and should be hedged or dropped"] }`;

const REVISE_PROMPT = `Revise the draft reply to fix every issue listed, keeping everything that is already right. Write the full revised draft only.`;

const FINAL_PROMPT = `You are writing the final reply to the person. You are given their latest request, a private plan, working notes, a draft, and any review findings.
Write ONLY the reply they will read: correct, complete, well-shaped, in the right tone, with every review finding resolved. Never mention the plan, notes, draft, review or this process.`;

function lastUserText(messages: any[]): string {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i];
    if (m?.role === "user") return typeof m.content === "string" ? m.content : JSON.stringify(m.content);
  }
  return "";
}

/** The first JSON object in a model reply, tolerating fences and stray text. */
function parseJson<T>(text: string): T | null {
  const cleaned = text.replace(/```(?:json)?/gi, "");
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(cleaned.slice(start, end + 1)) as T; } catch { return null; }
}
const short = (value: unknown, fallback: string, max = 44) => {
  const text = typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
  return (text || fallback).slice(0, max);
};

async function collect(stream: Stream, system: string, messages: any[], model: string, maxTokens: number, signal: AbortSignal | undefined, timeoutMs: number, thinking = false, reasoning?: "high" | "max") {
  let text = "";
  await stream(system, messages, (chunk, isReasoning) => { if (!isReasoning) text += chunk; }, 0.3, maxTokens, model, signal, thinking, timeoutMs, reasoning);
  return text.trim();
}

type Plan = { intent?: string; difficulty?: number; work?: Array<{ label?: string; task?: string }>; pitfalls?: string[]; format?: string; labels?: { write?: string; check?: string } };
type Critique = { ok?: boolean; label?: string; issues?: Array<{ problem?: string; fix?: string }> };
type Verification = { label?: string; confirmed?: string[]; corrections?: Array<{ claim?: string; correct?: string }>; uncertain?: string[] };

export async function runEffortHarness({
  effort,
  system,
  messages,
  stream,
  onChunk,
  onPhase,
  signal,
  temperature,
}: {
  effort: HarnessEffort;
  system: string;
  messages: any[];
  stream: Stream;
  /** the user-facing answer, as it streams */
  onChunk: (text: string) => void;
  /** the phase now running (named by the model for this request), or null once the answer starts */
  onPhase: (phase: string | null) => void;
  signal?: AbortSignal;
  temperature: number;
}): Promise<HarnessStep[]> {
  const budget = EFFORT_BUDGET[effort];
  const steps: HarnessStep[] = [];
  const request = lastUserText(messages);
  const answer = (sys: string, msgs: any[], model: string, maxTokens: number, timeoutMs: number, thinking = false, reasoning?: "high" | "max") => {
    let started = false;
    return stream(sys, msgs, (chunk, isReasoning) => {
      if (isReasoning) return;
      if (!started) { started = true; onPhase(null); }
      onChunk(chunk);
    }, temperature, maxTokens, model, signal, thinking, timeoutMs, reasoning);
  };

  if (!budget.plan) {
    await answer(system, messages, FAST, 8000, 60_000);
    return steps;
  }

  /* 1. the plan for this turn, written by the model */
  onPhase("Reading the request");
  let plan: Plan | null = null;
  try {
    plan = parseJson<Plan>(await collect(stream, `${system}\n\n${PLAN_PROMPT}`, messages, FAST, 700, signal, 30_000));
    steps.push({ id: "plan", label: short(plan?.intent, "Planned the reply", 56), detail: plan?.difficulty ? `difficulty ${Math.max(1, Math.min(5, Math.round(plan.difficulty)))}/5` : undefined, state: plan ? "done" : "failed" });
  } catch (error) {
    if (signal?.aborted) throw error;
    steps.push({ id: "plan", label: "Planned the reply", detail: "skipped", state: "failed" });
  }
  const difficulty = Math.max(1, Math.min(5, Math.round(plan?.difficulty ?? 3)));
  const writeLabel = short(plan?.labels?.write, "Writing the reply");
  const checkLabel = short(plan?.labels?.check, "Checking the reply");
  const planBlock = plan
    ? `Intent: ${plan.intent ?? ""}\nFormat: ${plan.format ?? ""}\nPitfalls: ${(plan.pitfalls ?? []).join("; ") || "none"}`
    : "(no plan)";

  /* 2. the work the plan asked for, capped by the level; each step may add a follow-up the model found it needed */
  const queue = (plan?.work ?? []).filter((w) => w?.task).map((w) => ({ label: short(w.label, "Working it through"), task: String(w.task) }));
  const easy = difficulty <= 1;
  const wanted = easy ? 0 : Math.max(queue.length, difficulty >= 3 ? budget.minWorkWhenHard : 0);
  const cap = Math.min(budget.maxWork, wanted || (easy ? 0 : queue.length));
  // a hard request at a high level that the plan left without work still gets its open question worked through
  if (!easy && cap > 0 && queue.length === 0) queue.push({ label: "Working it through", task: `Work out the substance of the answer to: ${request.slice(0, 400)}` });
  const notes: string[] = [];
  let done = 0;
  /* One piece of work: notes from the strong model. At the higher levels each piece is reasoned through on its own, and the
     pieces run side by side, so deep thinking costs the time of the slowest piece rather than the sum. */
  const runWork = async (item: { label: string; task: string }, index: number, earlier: string) => {
    onPhase(item.label);
    try {
      const out = await collect(stream, `${system}\n\n${WORK_PROMPT}`, [...messages, { role: "user", content: `Plan:\n${planBlock}\n\nEarlier notes:\n${earlier || "(none)"}\n\nYour task: ${item.task}` }], PRO, budget.workTokens, signal, budget.workMs, Boolean(budget.reasoning), "high");
      steps.push({ id: `work-${index}`, label: item.label, state: "done" });
      return { label: item.label, out };
    } catch (error) {
      if (signal?.aborted) throw error;
      steps.push({ id: `work-${index}`, label: item.label, detail: "skipped", state: "failed" });
      return null;
    }
  };
  /* The pieces the plan listed are independent by construction, so they run side by side; a piece that discovers
     a missing sub-problem asks for a follow-up, and those run after, in order. */
  const firstBatch = queue.splice(0, Math.min(cap, queue.length, 3));
  if (firstBatch.length) {
    onPhase(firstBatch.length > 1 ? `${firstBatch[0].label} and ${firstBatch.length - 1} more` : firstBatch[0].label);
    const results = await Promise.all(firstBatch.map((item, i) => runWork(item, i, "")));
    done = firstBatch.length;
    results.forEach((r, i) => {
      if (!r) return;
      const follow = r.out.match(/FOLLOW_UP:\s*(.+?)\s*\|\s*(.+)$/im);
      notes.push(`## ${r.label}\n${r.out.replace(/FOLLOW_UP:.*$/im, "").trim()}`);
      if (follow && done + queue.length < cap) queue.push({ label: short(follow[1], "Following up"), task: follow[2].trim() });
      void i;
    });
  }
  while (queue.length && done < cap) {
    const item = queue.shift()!;
    const r = await runWork(item, done, notes.join("\n---\n"));
    if (r) {
      const follow = r.out.match(/FOLLOW_UP:\s*(.+?)\s*\|\s*(.+)$/im);
      notes.push(`## ${r.label}\n${r.out.replace(/FOLLOW_UP:.*$/im, "").trim()}`);
      if (follow && done + queue.length + 1 < cap) queue.push({ label: short(follow[1], "Following up"), task: follow[2].trim() });
    }
    done += 1;
  }

  const context = (extra = "") => `${system}\n\nPrivate working material for this reply (use it; never mention it):\nPLAN\n${planBlock}${notes.length ? `\n\nNOTES\n${notes.join("\n\n")}` : ""}${extra}`;

  /* standard: nothing more to run: write the reply, following the plan */
  if (!budget.critic && !budget.verify) {
    onPhase(writeLabel);
    await answer(context(), messages, PRO, 8000, 90_000);
    return steps;
  }

  /* 3. a private draft, written from the worked-out notes */
  onPhase(writeLabel);
  let draft = "";
  try {
    draft = await collect(stream, context(), messages, PRO, 8000, signal, 120_000);
    steps.push({ id: "draft", label: "Drafted from the worked-out notes", state: "done" });
  } catch (error) {
    if (signal?.aborted) throw error;
    steps.push({ id: "draft", label: "Drafted from the worked-out notes", detail: "failed", state: "failed" });
  }
  if (!draft) {
    // the reasoned draft did not arrive in time: write the reply directly instead of waiting on another slow pass
    onPhase(writeLabel);
    await answer(context(), messages, PRO, 8000, 90_000);
    return steps;
  }

  /* 4. the critic decides whether it is good enough; if not it says what to fix and the loop goes round again */
  let findings = "";
  for (let round = 0; round < budget.critic; round += 1) {
    onPhase(checkLabel);
    let verdict: Critique | null = null;
    try {
      verdict = parseJson<Critique>(await collect(stream, CRITIC_PROMPT, [{ role: "user", content: `Request:\n${request}\n\nPlan and pitfalls:\n${planBlock}\n\nNotes:\n${notes.join("\n\n") || "(none)"}\n\nDraft:\n${draft}` }], budget.criticModel, 1800, signal, 120_000));
    } catch (error) {
      if (signal?.aborted) throw error;
    }
    const issues = (verdict?.issues ?? []).filter((i) => i?.problem);
    const label = short(verdict?.label, checkLabel);
    if (!verdict || verdict.ok !== false || !issues.length) {
      steps.push({ id: `critic-${round}`, label, detail: verdict ? "nothing to change" : "skipped", state: verdict ? "done" : "failed" });
      break;
    }
    steps.push({ id: `critic-${round}`, label, detail: `${issues.length} thing${issues.length === 1 ? "" : "s"} to fix`, state: "done" });
    findings = issues.map((i, n) => `${n + 1}. ${i.problem}${i.fix ? ` -> ${i.fix}` : ""}`).join("\n");
    if (round === budget.critic - 1) break; // the last round's findings go straight into the final write
    onPhase("Fixing what it found");
    try {
      const revised = await collect(stream, `${context()}\n\n${REVISE_PROMPT}`, [{ role: "user", content: `Request:\n${request}\n\nDraft:\n${draft}\n\nIssues to fix:\n${findings}` }], PRO, 8000, signal, 120_000);
      if (revised) { draft = revised; findings = ""; steps.push({ id: `revise-${round}`, label: "Revised it", state: "done" }); }
    } catch (error) {
      if (signal?.aborted) throw error;
    }
  }

  /* 5. an independent verification pass (Max): re-derive the facts and numbers from scratch */
  let verification = "";
  if (budget.verify) {
    onPhase("Verifying the details");
    try {
      const v = parseJson<Verification>(await collect(stream, VERIFY_PROMPT, [{ role: "user", content: `Request:\n${request}\n\nDraft:\n${draft}` }], PRO, 5000, signal, 120_000, true, "high"));
      if (v) {
        const fixes = (v.corrections ?? []).filter((c) => c?.claim && c?.correct);
        const doubts = (v.uncertain ?? []).filter(Boolean);
        steps.push({ id: "verify", label: short(v.label, "Verified the details"), detail: fixes.length || doubts.length ? `${fixes.length} correction${fixes.length === 1 ? "" : "s"}, ${doubts.length} hedged` : "all confirmed", state: "done" });
        if (fixes.length || doubts.length) verification = `\n\nVERIFICATION\nCorrections (apply these):\n${fixes.map((c) => `- ${c.claim} -> ${c.correct}`).join("\n") || "none"}\nCould not be established (hedge or drop):\n${doubts.map((d) => `- ${d}`).join("\n") || "none"}`;
      }
    } catch (error) {
      if (signal?.aborted) throw error;
      steps.push({ id: "verify", label: "Verified the details", detail: "skipped", state: "failed" });
    }
  }

  /* 6. the final reply, written once with everything resolved */
  onPhase(short(plan?.labels?.write, "Writing the final reply"));
  const review = [
    { role: "user", content: `Request:\n${request}\n\nDraft:\n${draft}${findings ? `\n\nReview findings to resolve:\n${findings}` : ""}${verification}` },
  ];
  await answer(`${context()}\n\n${FINAL_PROMPT}`, review, PRO, 16_000, 180_000);
  steps.push({ id: "final", label: "Wrote the final reply", state: "done" });
  return steps;
}
