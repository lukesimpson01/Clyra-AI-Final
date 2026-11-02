import type { RunItem } from "./browserRunFeed";
import { setToolAgent } from "./toolAgentStore";

/* Operating Clyra's own apps from chat. The app is already mounted in the workspace; the agent looks at what is on its
   screen through the app's bridge (public/clyra-agent-bridge.js), asks the server for one next action, carries it out,
   and repeats until the task is visibly done. The person watches the app itself do it, with the pointer and the blue field. */
export type ToolId = "shorts";
export type ToolDef = { id: ToolId; name: string; hints: string };

const SHORTS_HINTS = `Shorts is a short-video studio inside Clyra. A left menu has Home, Projects, Tools.
- Fake Text (a text-message story over gameplay): steps along the top are Script, Theme, Video, Audio. On Script, the "AI Writer" button opens a small dialog: a "Story idea" box, a Tone menu, a Messages count and a Write button. Fill the idea, choose a tone that fits, press Write, and the chat appears in the script. Then use Next through Theme, Video and Audio; on the last step the main button generates the video. Wait for the "Your MP4 is ready" message.
- Would You Rather: add questions and options, then generate.
- AutoClip: paste a YouTube link in the link box, wait for the video to be read, press Continue, choose a moment, captions and framing with Next, then press the Generate button on the last step and wait for the clips.
The page title above the content tells you which tool you are in.`;

export const TOOLS: Record<ToolId, ToolDef> = { shorts: { id: "shorts", name: "Shorts", hints: SHORTS_HINTS } };

/** Which workspace of the app to open for a request, or null when the request is not a job for one of our tools. */
export function matchToolTask(text: string): { tool: ToolDef; workspace: "fake-text" | "would-rather" | "clip" } | null {
  const t = text.trim();
  if (t.length < 12 || t.startsWith("/")) return null;
  const make = /\b(make|create|write|generate|build|produce|turn|draft)\b/i;
  if (make.test(t) && /\b(fake[- ]?text|texting|text(?:-| )message (?:story|video)|text story|chat story)\b/i.test(t)) return { tool: TOOLS.shorts, workspace: "fake-text" };
  if (make.test(t) && /\bwould you rather\b/i.test(t)) return { tool: TOOLS.shorts, workspace: "would-rather" };
  if (/\b(auto ?clip|ai clipp?er|clip this|clips? from|make (?:\d+ |some |a few )?(?:short )?clips?)\b/i.test(t) || (/https?:\/\/\S*(youtu|vimeo)/i.test(t) && /\b(clip|clips|shorts|moments)\b/i.test(t))) return { tool: TOOLS.shorts, workspace: "clip" };
  if (/\b(?:in|using|use|with|open)\s+(?:the\s+)?(?:clyra\s+)?shorts(?:\s+app)?\b/i.test(t)) return { tool: TOOLS.shorts, workspace: "clip" };
  return null;
}

/** The visible window of an app, among any copies mounted (one per workspace tab). */
export function findToolFrame(tool: ToolId): HTMLIFrameElement | null {
  const title = tool === "shorts" ? "Shorts" : tool;
  const frames = [...document.querySelectorAll<HTMLIFrameElement>(`iframe[title="${title}"]`)];
  return frames.find((frame) => { const r = frame.getBoundingClientRect(); return r.width > 80 && r.height > 80 && getComputedStyle(frame).visibility !== "hidden"; }) ?? frames[0] ?? null;
}

let sequence = 0;
function call(frame: HTMLIFrameElement, op: string, payload: Record<string, unknown> = {}, timeout = 6000): Promise<Record<string, any>> {
  return new Promise((resolve, reject) => {
    const id = `ta${Date.now().toString(36)}${sequence++}`;
    const timer = window.setTimeout(() => { window.removeEventListener("message", on); reject(new Error("The app did not answer.")); }, timeout);
    const on = (event: MessageEvent) => {
      const m = event.data;
      if (event.source !== frame.contentWindow || !m || m.clyra !== "agent-reply" || m.id !== id) return;
      window.clearTimeout(timer); window.removeEventListener("message", on);
      m.ok ? resolve(m) : reject(new Error(String(m.error || "That action failed.")));
    };
    window.addEventListener("message", on);
    frame.contentWindow?.postMessage({ clyra: "agent", id, op, ...payload }, "*");
  });
}
const sleep = (ms: number, signal?: AbortSignal) => new Promise<void>((resolve) => { const t = window.setTimeout(resolve, ms); signal?.addEventListener("abort", () => { window.clearTimeout(t); resolve(); }, { once: true }); });

const ICON: Record<string, RunItem extends { icon: infer I } ? I : never> = { click: "click", type: "keyboard", select: "click", press: "keyboard", scroll: "scrollDown", wait: "wait", done: "done", ask: "ask" } as never;

export type ToolRunResult = { ok: boolean; summary: string; asked?: string };

export async function runToolAgent(options: {
  tool: ToolDef; task: string; signal: AbortSignal; maxSteps?: number;
  onItems: (items: RunItem[], status: "planning" | "executing" | "completed" | "failed" | "cancelled" | "waiting_for_user") => void;
}): Promise<ToolRunResult> {
  const { tool, task, signal } = options;
  const items: RunItem[] = [];
  const history: Array<{ goal?: string; label?: string; action?: Record<string, unknown>; result?: string }> = [];
  const push = (status: Parameters<typeof options.onItems>[1]) => options.onItems([...items], status);
  let cursorId = 0;
  setToolAgent({ busy: true, tool: tool.id, label: "Getting started", cursor: null });
  try {
    /* wait for the app's window to be ready: it may have only just been opened */
    let frame: HTMLIFrameElement | null = null;
    const started = Date.now();
    while (!signal.aborted && Date.now() - started < 25_000) {
      frame = findToolFrame(tool.id);
      if (frame) { try { await call(frame, "ping", {}, 800); break; } catch { frame = null; } }
      await sleep(350, signal);
    }
    if (signal.aborted) { push("cancelled"); return { ok: false, summary: "Stopped." }; }
    if (!frame) throw new Error(`${tool.name} did not open in time.`);
    push("planning");

    const limit = options.maxSteps ?? 28;
    for (let step = 1; step <= limit && !signal.aborted; step += 1) {
      const { snapshot } = await call(frame, "snapshot");
      const response = await fetch("/api/tool-agent/step", { method: "POST", headers: { "Content-Type": "application/json" }, signal, body: JSON.stringify({ task, tool: { id: tool.id, name: tool.name, hints: tool.hints }, snapshot, history, step }) });
      const decided = await response.json();
      if (!response.ok || !decided.ok) throw new Error(decided?.error?.message || "The tool agent could not decide the next step.");
      const { action, label, goal } = decided as { action: Record<string, any>; label: string; goal: string };

      if (goal && (!items.length || (items[items.length - 1] as any).nextGoal !== goal)) items.push({ id: `g${step}`, kind: "reasoning", step, nextGoal: goal });
      setToolAgent({ label });

      if (action.type === "done") { items.push({ id: `c${step}`, kind: "complete", success: true, message: action.summary }); push("completed"); return { ok: true, summary: action.summary }; }
      if (action.type === "ask") { items.push({ id: `q${step}`, kind: "ask", question: action.question }); push("waiting_for_user"); return { ok: false, summary: action.question, asked: action.question }; }

      const row: RunItem = { id: `a${step}`, kind: "action", step, actionType: action.type, label, icon: ICON[action.type] ?? "generic", status: "running", detail: "" };
      items.push(row); push("executing");
      let result = "ok";
      try {
        if (action.type === "wait") await sleep(1600, signal);
        else {
          const reply = await call(frame, action.type === "select" ? "select" : action.type, action);
          if (reply.cursor) {
            cursorId += 1;
            /* the pointer is drawn inside the app's own window, in that window's own pixels */
            setToolAgent({ cursor: { x: Number(reply.cursor.x), y: Number(reply.cursor.y), kind: reply.cursor.kind, id: cursorId } });
          }
          await sleep(action.type === "type" ? 500 : 650, signal);
        }
        (row as any).status = "success";
      } catch (error) {
        result = error instanceof Error ? error.message : "failed";
        (row as any).status = "error"; (row as any).result = result;
      }
      history.push({ goal, label, action, result });
      push("executing");
    }
    if (signal.aborted) { push("cancelled"); return { ok: false, summary: "Stopped." }; }
    push("failed");
    return { ok: false, summary: `I didn't finish this in ${options.maxSteps ?? 28} steps. ${tool.name} is open where I left off.` };
  } catch (error) {
    if (signal.aborted) { push("cancelled"); return { ok: false, summary: "Stopped." }; }
    push("failed");
    return { ok: false, summary: error instanceof Error ? error.message : "The task failed." };
  } finally {
    setToolAgent({ busy: false, label: "", cursor: null, finishedAt: Date.now() });
  }
}
