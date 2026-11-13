import { useEffect, useRef, useState } from "react";
import { ChevronDown, FilePlus, FileText, Globe, Github, Images, Link2, MapPin, PencilLine, Search } from "lucide-react";
import { SourceStrip } from "./assistant";
import { ShimmerText } from "./assistant";
import { ChatResearchResults } from "./ChatResearchResults";
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

const ICON = { web_search: Globe, web_open: FileText, web_find: Search, web_follow_links: Link2, image_search: Images, github_repo_search: Github, github_repo_inspect: Github, show_map: MapPin, create_note: FilePlus, notes_search: Search, notes_read: FileText, notes_insert: PencilLine, notes_edit: PencilLine, notes_link_page: Link2 } as const;

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
  const Icon = ICON[step.tool as keyof typeof ICON] ?? Globe;
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
  const [expanded, setExpanded] = useState(false);
  const showSteps = live || expanded;
  const stepCount = run.steps.filter((step) => step.state !== "running").length;
  const running = run.steps.some((step) => step.state === "running");
  const failed = run.steps.some((step) => step.state === "failed");
  const SummaryIcon = ICON[run.steps[run.steps.length - 1]?.tool as keyof typeof ICON] ?? Globe;
  const growthSignal = run.steps.reduce((total, step) =>
    total + (step.state === "done" ? 1 : 0) + (step.images?.length || 0) + (step.repositories?.length || 0), run.steps.length);
  useFollowGrowth(ref, growthSignal, live);
  if (!run.todos.length && !run.steps.length) return null;
  return (
    <div className="clyra-agent-run" ref={ref}>
      {showTodo ? <AgentTodo todos={run.todos} live={live} /> : null}
      {run.steps.length ? (
        <>
          {!live ? (
            <button type="button" className="clyra-agent-run__summary" aria-expanded={showSteps} onClick={() => setExpanded((value) => !value)}>
              <span className="clyra-agent-run__summary-icon" aria-hidden><SummaryIcon size={15} strokeWidth={1.7} /></span>
              <span>{running ? "Working" : failed ? "Tool activity" : "Completed"} {stepCount} tool {stepCount === 1 ? "step" : "steps"}</span>
              <ChevronDown size={14} className={showSteps ? "is-open" : ""} aria-hidden />
            </button>
          ) : null}
          {showSteps ? (
            <ul className="clyra-ai-activity" aria-label="What Clyra did">
              {run.steps.map((step) => <StepRow key={step.id} step={step} onOpenNote={onOpenNote} />)}
            </ul>
          ) : null}
          <ChatResearchResults steps={run.steps} />
        </>
      ) : null}
    </div>
  );
}
