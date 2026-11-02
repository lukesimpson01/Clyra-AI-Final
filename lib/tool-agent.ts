/* The Clyra tool agent's brain: given what is on screen in one of Clyra's own apps (a numbered list of controls and the
   visible text) and what the person asked for, choose the single next action. The browser sends one step at a time and
   carries out the answer through the app's agent bridge, so the model never touches the page itself. */
import { prepareDeepseekChatBody } from "./deepseek-models";

export type ToolSnapshot = {
  title?: string;
  path?: string;
  size?: { w: number; h: number };
  elements: Array<{ i: number; tag: string; role?: string; text: string; value?: string; checked?: boolean; state?: string }>;
  text?: string;
};
export type ToolAction =
  | { type: "click"; i: number }
  | { type: "type"; i: number; text: string; submit?: boolean }
  | { type: "select"; i: number; value: string }
  | { type: "press"; key: string }
  | { type: "scroll"; dy: number }
  | { type: "wait" }
  | { type: "done"; summary: string }
  | { type: "ask"; question: string };
export type ToolStep = { thought: string; goal: string; label: string; action: ToolAction };
export type ToolHistory = Array<{ goal?: string; label?: string; action?: Record<string, unknown>; result?: string }>;

const SYSTEM = (name: string, hints: string) => `You operate the "${name}" app for the person, the way they would: by looking at what is on screen and clicking or typing, one action at a time. The app is already open; stay inside it.

You are shown the controls currently on screen, each with a number ("i"), what it is, and its value, followed by the visible text. Reply with ONE JSON object and nothing else:
{"thought": string, "goal": string, "label": string, "action": {"type": "click"|"type"|"select"|"press"|"scroll"|"wait"|"done"|"ask", ...}}
- "goal": the next thing you are trying to achieve, in a few plain words.
- "label": what you are doing, as a short present-tense phrase shown to the person ("Opening the AI writer", "Typing the story idea"). Never mention element numbers, URLs, addresses or "localhost".
- click: {"type":"click","i":N}. type: {"type":"type","i":N,"text":"...","submit":false}. select: {"type":"select","i":N,"value":"..."}. press: {"type":"press","key":"Enter"}. scroll: {"type":"scroll","dy":400}. wait: {"type":"wait"} when something is still loading or generating.
- done: {"type":"done","summary":"..."} ONLY when the visible page shows the task is complete (the result exists on screen). The summary is plain language: what was made or done and where it is.
- ask: {"type":"ask","question":"..."} when you genuinely cannot continue (a file or a login is needed, or the request is ambiguous in a way you cannot decide).
Rules: use only element numbers from the latest list; do one action per reply; do not repeat an action that already failed or changed nothing, try another route; fill text boxes with real, well-written content that fits the request; prefer the app's own controls to guessing; if a generation or render is running, wait and check the visible text for progress.
${hints ? `\nAbout this app:\n${hints}` : ""}`;

function firstJson(text: string): Record<string, unknown> {
  const body = text.replace(/```(?:json)?/gi, "");
  const start = body.indexOf("{"), end = body.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("The tool agent did not return an action.");
  return JSON.parse(body.slice(start, end + 1)) as Record<string, unknown>;
}

function cleanAction(raw: Record<string, unknown>, elements: number): ToolAction {
  const type = String(raw.type || "");
  const index = Number(raw.i);
  const valid = Number.isInteger(index) && index >= 1 && index <= elements;
  switch (type) {
    case "click": if (valid) return { type, i: index }; break;
    case "type": if (valid) return { type, i: index, text: String(raw.text ?? "").slice(0, 4000), submit: Boolean(raw.submit) }; break;
    case "select": if (valid) return { type, i: index, value: String(raw.value ?? "") }; break;
    case "press": return { type, key: String(raw.key || "Enter").slice(0, 20) };
    case "scroll": return { type, dy: Math.max(-1600, Math.min(1600, Number(raw.dy) || 400)) };
    case "done": return { type, summary: String(raw.summary || "Done.").slice(0, 600) };
    case "ask": return { type, question: String(raw.question || "What should I do next?").slice(0, 400) };
    case "wait": return { type: "wait" };
  }
  /* an action that points at nothing is a wait, not a guess at some other control */
  return { type: "wait" };
}

export async function decideToolStep(input: { task: string; tool: { id: string; name: string; hints?: string }; snapshot: ToolSnapshot; history: ToolHistory; step: number }): Promise<ToolStep> {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) throw new Error("Tool control needs a DeepSeek API key. Add DEEPSEEK_API_KEY to Clyra's .env.local file, then restart Clyra.");
  const { snapshot } = input;
  const controls = snapshot.elements.map((e) => `${e.i}. [${e.tag}${e.role ? `:${e.role}` : ""}] ${e.text || "(no label)"}${e.value ? ` = "${e.value}"` : ""}${e.checked !== undefined ? ` (${e.checked ? "checked" : "unchecked"})` : ""}${e.state ? ` (${e.state})` : ""}`).join("\n");
  const history = input.history.slice(-8).map((h, n) => `${n + 1}. ${h.label || h.goal || "step"}${h.result ? ` -> ${h.result}` : ""}`).join("\n");
  const user = `Task: ${input.task}\nStep ${input.step}.\n\nPage: ${snapshot.title || ""}\n\nControls on screen:\n${controls || "(none)"}\n\nVisible text:\n${snapshot.text || ""}\n\n${history ? `What you have already done:\n${history}\n\n` : ""}Choose the next action.`;
  const body = prepareDeepseekChatBody({
    model: "deepseek-v4-pro", stream: false, max_tokens: 700, temperature: 0.2, thinking: { type: "disabled" },
    messages: [{ role: "system", content: SYSTEM(input.tool.name, input.tool.hints || "") }, { role: "user", content: user }],
  } as Record<string, unknown>);
  const base = String(process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com").replace(/\/$/, "");
  const response = await fetch(`${base}/chat/completions`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` }, body: JSON.stringify(body), signal: AbortSignal.timeout(45_000) });
  if (!response.ok) throw new Error(`The tool agent's model did not answer (${response.status}).`);
  const payload = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const parsed = firstJson(String(payload.choices?.[0]?.message?.content || ""));
  const action = cleanAction((parsed.action || {}) as Record<string, unknown>, snapshot.elements.length);
  return {
    thought: String(parsed.thought || "").slice(0, 300),
    goal: String(parsed.goal || "").slice(0, 120),
    label: String(parsed.label || "").replace(/https?:\/\/\S+|localhost\S*|127\.0\.0\.1\S*/gi, "").slice(0, 120) || "Working",
    action,
  };
}
