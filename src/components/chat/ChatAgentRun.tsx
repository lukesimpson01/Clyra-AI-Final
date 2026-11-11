import { useEffect, useRef, useState } from "react";
import { ChevronDown, FilePlus, FileText, Globe, Link2, Search, FolderOpen, GitBranch, TerminalSquare, Compass, BookOpen, Brain, ListChecks, Music2, Plug, ShieldCheck, FileCode2 } from "lucide-react";
import { SourceStrip } from "./assistant";
import { ShimmerText } from "./assistant";
import type { AgentStepView, ChatAgentRun as Run, TodoItem } from "../../lib/chatAgentClient";

/** While a run grows, keep the newest row in view — but only if the person was already at the bottom (never fight their scroll). */
export function useFollowGrowth(ref: React.RefObject<HTMLElement | null>, signal: number, active: boolean) {
  useEffect(() => {
    if (!active) return;
    const scroller = ref.current?.closest<HTMLElement>("#chat-container") ?? null;
    if (!scroller) return;
    const distance = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
    if (distance < 300) scroller.scrollTo({ top: scroller.scrollHeight, behavior: "smooth" });
  }, [ref, signal, active]);
}

const TOOL_ICONS = {
  web_search: Globe,
  web_open: FileText,
  web_find: Search,
  web_follow_links: Link2,
  create_note: FilePlus,
  notes_search: Search,
  notes_read: BookOpen,
  notes_insert: FileText,
  notes_edit: FileText,
  notes_link_page: Link2,
  show_map: Compass,
} as const;

/** One consistent activity row for all verified Chat and native MCP tools.
 * An unknown registered tool gets a neutral capability icon, never a fake
 * browser globe implying a web search took place. */
function toolIcon(tool: string) {
  const known = TOOL_ICONS[tool as keyof typeof TOOL_ICONS];
  if (known) return known;
  if (tool.startsWith("git.")) return GitBranch;
  if (tool.startsWith("files.")) return FolderOpen;
  if (tool.startsWith("terminal.")) return TerminalSquare;
  if (tool.startsWith("browser.")) return Compass;
  if (tool.startsWith("notes.")) return BookOpen;
  if (tool.startsWith("memory.") || tool.startsWith("project.memory.") || tool.startsWith("session.")) return Brain;
  if (tool.startsWith("skill.")) return BookOpen;
  if (tool.startsWith("spotify.")) return Music2;
  if (tool.startsWith("vibe.")) return FileCode2;
  if (tool.startsWith("computer.")) return ShieldCheck;
  if (tool.startsWith("media.")) return FileText;
  if (tool.startsWith("email.")) return FileText;
  if (tool.startsWith("todo.")) return ListChecks;
  return Plug;
}

/**
 * The agent's plan, as in the Clyra agent-UI kit: a compact pill (a spinning activity ring while work continues, the
 * readable title, N/M, a chevron). Pointing at it peeks it open; clicking pins it open until you click again or
 * elsewhere; keyboard and touch use the click. When the last task completes it folds itself away unless pinned.
 * The count dissolves into its next value, finished rows are struck through with a left-to-right sweep, and the
 * circle that completes gives one small confirming bounce. The tasks and their states are the agent's real plan.
 */
export function AgentTodo({ todos, live }: { todos: TodoItem[]; live: boolean; defaultOpen?: boolean }) {
  const [pinned, setPinned] = useState(false);
  const [peek, setPeek] = useState(false);
  const rootRef = useRef<HTMLElement | null>(null);
  const done = todos.filter((t) => t.status === "completed").length;
  const allDone = todos.length > 0 && done === todos.length;
  const [settled, setSettled] = useState(false);
  // finished: fold away shortly after, unless the person pinned it open
  useEffect(() => {
    if (!allDone) { setSettled(false); return; }
    const timer = window.setTimeout(() => setSettled(true), 880);
    return () => window.clearTimeout(timer);
  }, [allDone]);
  useEffect(() => {
    if (!pinned) return;
    const away = (event: PointerEvent) => { if (rootRef.current && !rootRef.current.contains(event.target as Node)) setPinned(false); };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [pinned]);
  if (!todos.length) return null;
  const open = pinned || (peek && !settled) || (allDone && !settled);
  const current = todos.find((t) => t.status === "in_progress") ?? todos.find((t) => t.status === "pending");
  const working = live && !allDone;
  return (
    <section
      ref={rootRef}
      className={`clyra-plan${open ? " is-open" : ""}`}
      aria-label="Agent task list"
      onPointerEnter={(event) => { if (event.pointerType === "mouse" || event.pointerType === "pen") setPeek(true); }}
      onPointerLeave={() => setPeek(false)}
    >
      <button type="button" className="clyra-plan__trigger" aria-expanded={open} onClick={() => setPinned((v) => !v)}>
        <span className={`clyra-plan__ring${working ? " is-working" : ""}${allDone ? " is-done" : ""}`} aria-hidden>
          <svg viewBox="0 0 28 28"><circle className="clyra-plan__track" cx="14" cy="14" r="11" /><circle className="clyra-plan__value" cx="14" cy="14" r="11" /></svg>
          <svg className="clyra-plan__list" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="16" rx="2" /><path d="m7 10 1.5 1.5L11 9M13 10h4M7 16h10" /></svg>
        </span>
        <span className="clyra-plan__title">{allDone ? "All tasks done" : current?.content ?? "To-dos"}</span>
        <span className="clyra-plan__counter" key={done}>{done}/{todos.length}</span>
        <ChevronDown className="clyra-plan__chevron" aria-hidden />
      </button>
      <div className="clyra-plan__disclosure" data-open={open}>
        <div className="clyra-plan__inner" inert={!open}>
          <ol className="clyra-plan__list-body">
            {todos.map((item, index) => (
              <li key={item.id} className={`clyra-plan__item is-${item.status === "completed" ? "done" : item.status === "in_progress" ? "current" : "pending"}`} style={{ ["--row-index" as string]: index }}>
                <span className="clyra-plan__status" aria-hidden>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12 4 4L19 6" /></svg>
                </span>
                <span className="clyra-plan__text">{item.content}</span>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}

function StepRow({ step, onOpenNote }: { step: AgentStepView; onOpenNote?: (id: string) => void }) {
  const Icon = toolIcon(step.tool);
  const running = step.state === "running";
  return (
    <li className={`clyra-ai-row clyra-ai-row--${running ? "running" : step.state}`}>
      <span className="clyra-ai-row__icon" aria-hidden><Icon /></span>
      <span className="clyra-ai-row__label">{running ? <ShimmerText>{step.label}</ShimmerText> : step.label}</span>
      {step.tool === "web_search" && step.sources?.length ? (
        <SourceStrip sources={step.sources.map((s, i) => ({ id: `${step.id}-${i}`, url: s.url, host: s.host, title: s.title }))} />
      ) : null}
      {step.state === "failed" && step.error ? <span className="clyra-agent-meta" title={step.error}>{step.error}</span> : step.detail && step.tool !== "web_search" ? <span className="clyra-agent-meta" title={step.detail}>{step.detail}</span> : null}
      {step.document && onOpenNote ? (
        <button type="button" className="clyra-agent-open" onClick={() => onOpenNote(step.document!.id)}>Open note</button>
      ) : null}
    </li>
  );
}

/** Every real step the agent took, in order, with the plan above it. Nothing here is decorative: each row is a tool call. */
export function ChatAgentRunView({ run, live, onOpenNote, showTodo = true }: { run: Run; live: boolean; onOpenNote?: (id: string) => void; showTodo?: boolean }) {
  const ref = useRef<HTMLDivElement | null>(null);
  useFollowGrowth(ref, run.steps.length, live);
  if (!run.todos.length && !run.steps.length) return null;
  return (
    <div className="clyra-agent-run" ref={ref}>
      {showTodo ? <AgentTodo todos={run.todos} live={live} /> : null}
      {run.steps.length ? (
        <ul className="clyra-ai-activity" aria-label="What Clyra did">
          {run.steps.map((step) => <StepRow key={step.id} step={step} onOpenNote={onOpenNote} />)}
        </ul>
      ) : null}
    </div>
  );
}
