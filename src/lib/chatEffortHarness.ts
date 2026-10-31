/**
 * How much work an ordinary chat turn does, by effort level. Each level is a real loop of model calls, and every
 * phase it reports is one that is actually running:
 *
 *  - light    one direct pass on the fast model.
 *  - medium   a short private plan on the fast model, then the answer on the pro model, following it.
 *  - high     plan → a reasoned draft (pro, reasoning on, kept private) → a check of that draft against the request
 *             and the plan, which writes the final answer the user sees.
 *
 * The plan and the draft are working notes: they never reach the transcript, only the steps' names do.
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

const PLAN_PROMPT = `You are planning a reply; you are not writing it. Read the conversation and write a private plan for the final message, in at most 6 short bullet lines:
- what the person actually needs (one line)
- the key points or steps the reply must cover, in order
- the format that fits (length, list, table, code) and any pitfall to avoid
No preamble, no answer text.`;

const CHECK_PROMPT = `You are the final pass of an answer. You are given the person's latest request, a plan, and a private draft.
Check the draft against the request and the plan: fix anything wrong, missing, unclear or padded, and keep what is good.
Then write ONLY the final reply to the person — never mention the plan, the draft or this check.`;

function lastUserText(messages: any[]): string {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i];
    if (m?.role === "user") return typeof m.content === "string" ? m.content : JSON.stringify(m.content);
  }
  return "";
}

async function collect(stream: Stream, system: string, messages: any[], model: string, maxTokens: number, signal: AbortSignal | undefined, timeoutMs: number, thinking = false, reasoning?: "high" | "max") {
  let text = "";
  await stream(system, messages, (chunk, isReasoning) => { if (!isReasoning) text += chunk; }, 0.3, maxTokens, model, signal, thinking, timeoutMs, reasoning);
  return text.trim();
}

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
  /** the phase now running ("Planning", "Drafting", …), or null once the answer starts */
  onPhase: (phase: string | null) => void;
  signal?: AbortSignal;
  temperature: number;
}): Promise<HarnessStep[]> {
  const steps: HarnessStep[] = [];
  const answer = (sys: string, msgs: any[], model: string, maxTokens: number, timeoutMs: number, thinking = false, reasoning?: "high" | "max") => {
    let started = false;
    return stream(sys, msgs, (chunk, isReasoning) => {
      if (isReasoning) return;
      if (!started) { started = true; onPhase(null); }
      onChunk(chunk);
    }, temperature, maxTokens, model, signal, thinking, timeoutMs, reasoning);
  };

  if (effort === "light") {
    await answer(system, messages, FAST, 8000, 60_000);
    return steps;
  }

  /* plan: a cheap, fast pass that the answer then follows */
  onPhase("Planning");
  let plan = "";
  try {
    plan = await collect(stream, `${system}\n\n${PLAN_PROMPT}`, messages, FAST, 600, signal, 30_000);
    steps.push({ id: "plan", label: "Planned the answer", state: "done" });
  } catch (error) {
    if (signal?.aborted) throw error;
    steps.push({ id: "plan", label: "Planned the answer", detail: "skipped", state: "failed" });
  }
  const planned = plan ? `${system}\n\nPrivate plan for this reply (follow it; never mention it):\n${plan}` : system;

  if (effort === "medium") {
    onPhase("Writing");
    await answer(planned, messages, PRO, 8000, 90_000);
    return steps;
  }

  /* extended: a reasoned draft, kept private, then a check that writes the final answer */
  onPhase("Thinking it through");
  let draft = "";
  try {
    draft = await collect(stream, planned, messages, PRO, effort === "max" ? 32_000 : 16_000, signal, effort === "max" ? 420_000 : 180_000, true, effort === "max" ? "max" : "high");
    steps.push({ id: "draft", label: "Drafted with reasoning", state: "done" });
  } catch (error) {
    if (signal?.aborted) throw error;
    steps.push({ id: "draft", label: "Drafted with reasoning", detail: "failed", state: "failed" });
  }
  if (!draft) {
    /* no draft to check: answer directly, still with reasoning */
    onPhase("Writing");
    await answer(planned, messages, PRO, 16_000, 180_000, true, "high");
    return steps;
  }

  onPhase("Checking the answer");
  const review = [
    { role: "user", content: `Request:\n${lastUserText(messages)}\n\nPlan:\n${plan || "(none)"}\n\nDraft:\n${draft}` },
  ];
  await answer(`${system}\n\n${CHECK_PROMPT}`, review, PRO, 16_000, 180_000);
  steps.push({ id: "check", label: "Checked and refined it", state: "done" });
  return steps;
}
