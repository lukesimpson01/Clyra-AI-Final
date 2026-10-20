import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ArrowDown, FilePlus2, Sparkle, Undo2 } from "lucide-react";
import { cn } from "../../lib/utils";
import { MarkdownMessageContent } from "../MarkdownMessageContent";
import { ShiningText } from "../ShiningText";
import type { AgentAction, ClyraCodeState, LogEntry } from "./store";
import { AgentActionRow } from "./ActionRow";
import { ActivityGroup, ActivityRow } from "./CodexActivity";
import { DisclosureRow, StateDot } from "./harness";
import { DiffCounters } from "./AnimatedCounter";
import { stripFilePrefix } from "./format";
import { AGENT_EASE, ROW_ENTER, SUBTLE_ENTER } from "./motion";

/**
 * One reasoning phase, in the same row language as every tool call: the think
 * text is the row's summary while it streams (clipped, not ellipsized, so the
 * moving tail reads), the running sweep marks it live, and the full text is
 * the expanded body.  Extracted from deepseek-harness `ui-chat/ReasoningRow`.
 */
function ThinkingEvent({ entry }: { entry: Extract<LogEntry, { type: "reasoning" }> }) {
  const completed = Boolean(entry.endedAt);
  const [expanded, setExpanded] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (completed) return;
    const interval = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(interval);
  }, [completed]);
  const seconds = Math.max(1, Math.round(((entry.endedAt ?? now) - entry.ts) / 1000));
  const text = entry.text?.trim() ?? "";
  // While it streams the tail is the interesting part; once settled the head
  // reads as a summary of what the phase was about.
  const summary = completed ? text.replace(/\s+/g, " ") : text.replace(/\s+/g, " ").slice(-220);

  return (
    <motion.div layout className="dsh-row-root" data-state={completed ? "ok" : "running"}>
      <DisclosureRow
        icon={<Sparkle />}
        title={completed ? "Thought" : <ShiningText text="Thinking" play duration={2} />}
        open={expanded && text !== ""}
        expandable={text !== ""}
        expandOnRowClick
        keepContentWhenOpen
        onToggle={() => setExpanded((v) => !v)}
        collapsedContent={
          <>
            <span className="dsh-sep" aria-hidden />
            <span className="dsh-summary" data-follow-end={!completed || undefined}>
              {summary}
            </span>
            {completed || seconds >= 3 ? <span className="dsh-suffix dsh-suffix-stat">{seconds}s</span> : null}
          </>
        }
      >
        <div className="dsh-think-body">{text}</div>
      </DisclosureRow>
    </motion.div>
  );
}

/**
 * The live line shown while a run is busy but no action row is moving yet
 * (right after send, or between tool calls). It keeps the elapsed time
 * ticking so a long silent phase still reads as progress.
 */
function WorkingStatus({ since }: { since: number }) {
  const reduced = useReducedMotion();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(interval);
  }, []);
  const seconds = Math.max(0, Math.round((now - since) / 1000));
  return (
    <motion.div
      role="status"
      aria-live="polite"
      {...(reduced ? {} : { initial: { opacity: 0, y: 4 }, animate: { opacity: 1, y: 0 }, exit: { opacity: 0, y: -2 } })}
      transition={{ duration: 0.22, ease: AGENT_EASE }}
      className="mt-3 flex h-6 items-center gap-2 text-[13px] text-[#73757A]"
    >
      <span className="cc-running-dot cc-running-dot--inline" aria-hidden />
      <ShiningText text="Working…" play={!reduced} duration={2} className="text-[13px] font-normal text-[#73757A]" />
      <span className="cc-counter text-[11.5px] text-[#A0A2A6]">{seconds}s</span>
    </motion.div>
  );
}

/** Codex-style centred day stamp: "Today 17:50", "Wednesday 17:50", or a date for older turns. */
function formatStamp(ts: number) {
  const date = new Date(ts);
  const now = new Date();
  const time = date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  if (date.toDateString() === now.toDateString()) return `Today ${time}`;
  const days = Math.floor((now.getTime() - date.getTime()) / 86_400_000);
  if (days < 7) return `${date.toLocaleDateString(undefined, { weekday: "long" })} ${time}`;
  return `${date.toLocaleDateString(undefined, { day: "numeric", month: "short" })} ${time}`;
}

/** Consecutive identical assistant chunks are transport retries, not user-visible prose. */
function dedupeConsecutiveAssistantEntries(entries: LogEntry[]) {
  return entries.filter((entry, index) => {
    if (entry.type !== "assistant") return true;
    const previous = entries[index - 1];
    return previous?.type !== "assistant" || previous.text.trim() !== entry.text.trim();
  });
}

/** Tiny transport-level reasoning bridges add no useful structure once their
 * real tool phase is present. Keep meaningful completed thoughts expandable,
 * but suppress one-second noise so a run never becomes a column of repeats. */
function suppressBriefThoughts(entries: LogEntry[]) {
  // Providers can emit several small reasoning summaries before any tool has
  // actually started. They are one continuous thought, not three separate UI
  // events. Keep a single row using the first timestamp and latest summary.
  const compacted: LogEntry[] = [];
  for (const entry of entries) {
    if (entry.type !== "reasoning") {
      compacted.push(entry);
      continue;
    }
    const previous = compacted.at(-1);
    if (previous?.type === "reasoning") {
      compacted[compacted.length - 1] = {
        ...entry,
        id: `${previous.id}:${entry.id}`,
        ts: previous.ts,
        text: entry.text?.trim() || previous.text,
        endedAt: entry.endedAt ?? previous.endedAt,
      };
      continue;
    }
    compacted.push(entry);
  }
  return compacted;
}

export function CompletionSummary({
  diffs,
  actions,
  onOpenChanges,
  onOpenFile,
  onUndo,
  restored = false,
}: {
  diffs: ClyraCodeState["diffs"];
  actions: AgentAction[];
  onOpenChanges: () => void;
  onOpenFile: (path: string) => void;
  onUndo?: () => void;
  restored?: boolean;
}) {
  const totals = useMemo(
    () => ({
      additions: diffs.reduce((sum, d) => sum + (d.additions ?? 0), 0),
      deletions: diffs.reduce((sum, d) => sum + (d.deletions ?? 0), 0),
    }),
    [diffs],
  );
  const successfulValidation = actions.filter(
    (action) => /^(build|check|test|preview)$/.test(action.kind) && action.status === "success",
  );
  const validationLabels = [...new Set(successfulValidation.map((action) => {
    if (action.kind === "build") return "Build passed";
    if (action.kind === "test") return "Tests passed";
    if (action.kind === "check") return "Checks passed";
    return "Preview checked";
  }))];
  if (!diffs.length && !validationLabels.length) return null;
  if (!diffs.length) return <p className="mt-3 text-[12px] leading-[1.5] text-[#686A70]">Completed the requested validation.</p>;
  return (
    <motion.section {...(restored ? {} : SUBTLE_ENTER)} aria-label="Completed work summary" className="mt-5 overflow-hidden rounded-[17px] border border-black/[0.09] bg-white text-[12px] shadow-[0_1px_1px_rgba(15,23,42,0.015)]">
      <div className="flex items-center gap-3 px-4 py-3.5">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[12px] bg-[#F5F5F5] text-[#686A70]"><FilePlus2 className="h-[19px] w-[19px]" strokeWidth={1.8} /></div>
        <div className="min-w-0">
          <p className="text-[16px] font-medium tracking-[-0.02em] text-[#25262A]">Edited {diffs.length} file{diffs.length === 1 ? "" : "s"}</p>
          <DiffCounters additions={totals.additions} deletions={totals.deletions} animate={false} className="mt-0.5 text-[13px] font-medium" />
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          {onUndo ? <button type="button" onClick={onUndo} title="Restore the state before the last agent checkpoint" className="inline-flex h-8 items-center gap-1 rounded-[9px] px-2.5 text-[12px] font-medium text-[#414348] transition-colors hover:bg-black/[0.045]">Undo <Undo2 className="h-[14px] w-[14px]" strokeWidth={1.8} /></button> : null}
          <button type="button" onClick={onOpenChanges} className="h-8 rounded-[10px] border border-black/[0.09] bg-white px-3 text-[12px] font-medium text-[#303237] transition-colors hover:bg-[#FAFAFA]">Review</button>
        </div>
      </div>
      <div className="border-t border-black/[0.075] px-4 py-2">
        {diffs.map((diff) => {
          const path = stripFilePrefix(diff.file);
          return <button key={diff.file} type="button" onClick={() => onOpenFile(path)} title={`Review ${path}`} className="grid min-h-8 w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-[7px] px-1 text-left transition-colors hover:bg-black/[0.025]"><span className="cc-mono truncate text-[11.5px] text-[#5E6065]">{path}</span><DiffCounters additions={diff.additions} deletions={diff.deletions} animate={false} className="text-[11.5px] font-medium" /></button>;
        })}
      </div>
      {validationLabels.length ? <p className="border-t border-black/[0.055] px-4 py-2 text-[11px] text-[#6C806E]">{validationLabels.map((label) => `✓ ${label}`).join(" · ")}</p> : null}
    </motion.section>
  );
}

type VisibleLogEntry = Exclude<LogEntry, { type: "reasoning" }>;
type TranscriptItem = { type: "entry"; entry: VisibleLogEntry; id: string };

/**
 * Keeps the activity stream readable during a busy OpenCode phase. A later
 * action is not mounted until the prior action has finished its visible
 * lifecycle; streaming edit boxes explicitly release this queue after their
 * own smooth collapse. The 500ms hand-off makes each real event legible.
 */
function SequencedActionRows({
  actions,
  thoughts,
  onOpenFile,
  revisitedActionIds,
  instant = false,
}: {
  actions: AgentAction[];
  thoughts: Extract<LogEntry, { type: "reasoning" }>[];
  onOpenFile: (path: string) => void;
  revisitedActionIds: Set<string>;
  instant?: boolean;
}) {
  const reduced = useReducedMotion();
  const [revealed, setRevealed] = useState(() => (instant ? actions.length : Math.min(1, actions.length)));
  const releaseTimer = useRef<number | null>(null);
  const releasing = useRef(false);
  const current = actions[Math.max(0, revealed - 1)];

  useEffect(() => {
    setRevealed((value) => instant ? actions.length : Math.min(Math.max(value, actions.length ? 1 : 0), actions.length));
  }, [actions.length, instant]);
  useEffect(() => () => { if (releaseTimer.current) window.clearTimeout(releaseTimer.current); }, []);

  const releaseNext = () => {
    if (instant || releasing.current || revealed >= actions.length) return;
    releasing.current = true;
      releaseTimer.current = window.setTimeout(() => {
        releasing.current = false;
        setRevealed((value) => Math.min(actions.length, value + 1));
    }, reduced ? 0 : 180);
  };

  useEffect(() => {
    if (instant || !current || revealed >= actions.length) return;
    const running = current.status === "active" || current.status === "queued";
    if (!running) releaseNext();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id, current?.status, revealed, actions.length, instant]);

  // Thoughts are compacted by phase too: the latest provider summary is the
  // useful one, and it appears only after the final visible action.
  const latestThought = thoughts.at(-1);
  return (
    <>
      {actions.slice(0, revealed).map((action) => (
        <AgentActionRow
          key={action.id}
          action={action}
          onOpenFile={onOpenFile}
          revisiting={revisitedActionIds.has(action.id)}
          settled={instant}
        />
      ))}
      {revealed >= actions.length && latestThought ? <ThinkingEvent key={latestThought.id} entry={latestThought} /> : null}
    </>
  );
}

function phaseLabel(actions: AgentAction[]) {
  const reads = actions.filter((action) => action.kind === "read").length;
  const searches = actions.filter((action) => action.kind === "search").length;
  const research = actions.filter((action) => action.kind === "research").length;
  const lists = actions.filter((action) => action.kind === "list").length;
  const edits = actions.filter((action) => /^(edit|create|delete)$/.test(action.kind));
  const commands = actions.filter((action) => /^(command|build|check|test|preview)$/.test(action.kind));
  const additions = edits.reduce((total, action) => total + (action.additions ?? 0), 0);
  const deletions = edits.reduce((total, action) => total + (action.deletions ?? 0), 0);
  if (edits.length && !reads && !searches && !lists && !commands.length) {
    return { text: `Edited ${new Set(edits.map((action) => action.target)).size} file${new Set(edits.map((action) => action.target)).size === 1 ? "" : "s"}`, additions, deletions };
  }
  if (commands.length && !edits.length && !reads && !searches && !lists) {
    const validation = commands.some((action) => /^(build|check|test)$/.test(action.kind));
    return { text: validation ? "Ran validation" : `Ran ${commands.length} command${commands.length === 1 ? "" : "s"}`, additions, deletions };
  }
  if ((reads || searches || research || lists) && !edits.length && !commands.length) {
    const parts = [
      research ? `${research} web source${research === 1 ? "" : "s"}` : "",
      reads ? `${reads} file${reads === 1 ? "" : "s"}` : "",
      searches ? `${searches} codebase search${searches === 1 ? "" : "es"}` : "",
      lists ? `${lists} folder${lists === 1 ? "" : "s"}` : "",
    ].filter(Boolean);
    return { text: research ? `Researched ${parts.join(" and ")}` : `Explored ${parts.join(" and ")}`, additions, deletions };
  }
  const parts = [edits.length ? "edited files" : "", reads || searches || lists ? "read files" : "", commands.length ? "ran commands" : ""].filter(Boolean);
  return { text: parts.length ? `${parts[0][0].toUpperCase()}${parts[0].slice(1)}${parts.length > 1 ? `, ${parts.slice(1).join(", ")}` : ""}` : "Completed agent work", additions, deletions };
}

function PhaseGroup({
  actions,
  thoughts,
  onOpenFile,
  revisitedActionIds,
  historical,
  defaultExpanded,
}: {
  actions: AgentAction[];
  thoughts: Extract<LogEntry, { type: "reasoning" }>[];
  onOpenFile: (path: string) => void;
  revisitedActionIds: Set<string>;
  historical?: boolean;
  defaultExpanded?: boolean;
}) {
  const [manuallyExpanded, setManuallyExpanded] = useState(false);
  const active = actions.some((action) => action.status === "active" || action.status === "queued") || thoughts.some((thought) => !thought.endedAt);
  const [expanded, setExpanded] = useState(Boolean(defaultExpanded) || active);
  // A run must read as a live stream first.  Only after every action in this
  // contiguous phase has settled do we replace the individual rows with its
  // compact summary.  This avoids the old behaviour where "Explored…" was
  // rendered before the user had actually seen the final read/command.
  const [summaryVisible, setSummaryVisible] = useState(Boolean(defaultExpanded) || historical);
  const reduced = useReducedMotion();
  const label = phaseLabel(actions);
  useEffect(() => {
    if (active) {
      setSummaryVisible(false);
      setExpanded(true);
      return;
    }
    if (manuallyExpanded) return;
    // Let the final row (and its completed Thought) remain visible long
    // enough to be read, then compact the entire finished phase together.
    const timer = window.setTimeout(() => {
      setSummaryVisible(true);
      setExpanded(Boolean(defaultExpanded));
    }, reduced ? 0 : 560);
    return () => window.clearTimeout(timer);
  }, [active, defaultExpanded, manuallyExpanded, reduced]);

  if (!summaryVisible) {
    return (
      <motion.div {...(reduced || historical ? {} : ROW_ENTER)} layout className="py-[2px]">
        <SequencedActionRows actions={actions} thoughts={thoughts} onOpenFile={onOpenFile} revisitedActionIds={revisitedActionIds} />
      </motion.div>
    );
  }
  return (
    <motion.div
      {...(reduced || historical ? {} : ROW_ENTER)}
      layout
      className="py-[2px] text-[14px] leading-5 text-[#73757A] opacity-[0.84] transition-opacity duration-200"
    >
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => { setManuallyExpanded(true); setExpanded((current) => !current); }}
        className="flex h-6 items-center gap-1 rounded-[5px] pr-1 text-left transition-colors hover:bg-black/[0.025] hover:text-[#505257]"
      >
        <motion.span
          aria-hidden
          animate={{ rotate: expanded ? 90 : 0 }}
          transition={{ duration: 0.18, ease: AGENT_EASE }}
          className="inline-block w-2 text-[9px]"
        >
          ›
        </motion.span>
        <span>{label.text}</span>
        {(label.additions || label.deletions) ? <DiffCounters additions={label.additions} deletions={label.deletions} animate={false} className="text-[13px] font-medium" /> : null}
      </button>
      <AnimatePresence initial={false}>
        {expanded ? (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.22, ease: AGENT_EASE }}
            className="ml-4 overflow-hidden"
          >
            <SequencedActionRows actions={actions} thoughts={thoughts} onOpenFile={onOpenFile} revisitedActionIds={revisitedActionIds} instant />
          </motion.div>
        ) : null}
      </AnimatePresence>
    </motion.div>
  );
}

export function Conversation({
  state,
  running,
  onReplyPermission,
  onRetry,
  onOpenTerminal,
  onOpenFile,
  onOpenChanges,
  onUndoCheckpoint,
}: {
  state: ClyraCodeState;
  running: boolean;
  onReplyPermission: (permissionId: string, response: "allow" | "always" | "deny") => void;
  onRetry: (action: AgentAction) => void;
  onOpenTerminal: () => void;
  onOpenFile: (path: string) => void;
  onOpenChanges: () => void;
  onUndoCheckpoint?: () => void;
}) {
  const reduced = useReducedMotion();
  const [density] = useState<"compact" | "balanced" | "detailed">(() => {
    try {
      const saved = localStorage.getItem("clyra-code:density");
      if (saved === "compact" || saved === "detailed") return saved;
    } catch { /* storage unavailable */ }
    return "balanced";
  });
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const pinnedRef = useRef(true);
  const scrollFrameRef = useRef<number | null>(null);
  const contentHeightRef = useRef(0);
  const [pinned, setPinned] = useState(true);

  useEffect(() => {
    const node = scrollRef.current;
    if (!node) return;
    const onScroll = () => {
      const isPinned = node.scrollHeight - node.scrollTop - node.clientHeight < 96;
      pinnedRef.current = isPinned;
      // Only re-render when the pin state actually flips so scrolling itself
      // never churns the transcript.
      setPinned((prev) => (prev === isPinned ? prev : isPinned));
    };
    node.addEventListener("scroll", onScroll, { passive: true });
    return () => node.removeEventListener("scroll", onScroll);
  }, []);

  // Follow layout transitions instead of snapping: rAF-throttled, only while
  // the user is near the bottom. Framer's height animation drives the motion;
  // we simply keep the viewport glued to the moving bottom edge.
  useEffect(() => {
    const node = scrollRef.current;
    if (!node) return;
    const content = node.firstElementChild;
    if (!content) return;
    const observer = new ResizeObserver(() => {
      if (!pinnedRef.current) return;
      if (scrollFrameRef.current) return;
      scrollFrameRef.current = requestAnimationFrame(() => {
        scrollFrameRef.current = null;
        if (pinnedRef.current) {
          // Pin to the actual bottom once all resize work from this animation
          // frame has landed. Delta-based scrolling can fall behind when a
          // streamed edit and an action row resize together.
          node.scrollTop = node.scrollHeight;
          contentHeightRef.current = node.scrollHeight;
        }
      });
    });
    observer.observe(content);
    contentHeightRef.current = node.scrollHeight;
    return () => {
      observer.disconnect();
      if (scrollFrameRef.current) cancelAnimationFrame(scrollFrameRef.current);
    };
  }, []);

  const jumpToLatest = () => {
    pinnedRef.current = true;
    setPinned(true);
    const node = scrollRef.current;
    if (node) {
      node.scrollTo({ top: node.scrollHeight, behavior: reduced ? "auto" : "smooth" });
    }
  };

  const showCompletion = state.runState === "complete" && (
    state.diffs.length > 0 || Object.values(state.actions).some(
      (action) => /^(build|check|test|preview)$/.test(action.kind) && action.status === "success",
    )
  );
  const revisitedActionIds = useMemo(() => {
    const editedFiles = new Set<string>();
    const revisited = new Set<string>();

    state.log.forEach((entry) => {
      if (entry.type !== "action") return;
      const action = state.actions[entry.actionId];
      if (!action) return;
      if (/^(edit|create|delete)$/.test(action.kind)) editedFiles.add(action.target);
      if (action.kind === "read" && editedFiles.has(action.target)) revisited.add(action.id);
    });

    return revisited;
  }, [state.actions, state.log]);
  const transcriptItems = useMemo<TranscriptItem[]>(() => {
    // Keep the user-visible stream limited to prompts, assistant responses,
    // and concrete tool actions. Reasoning parts may contain verbose internal
    // planning and are neither an answer nor an action the user needs to
    // review. Unknown tool kinds remain visible as real work records.
    const log = dedupeConsecutiveAssistantEntries(state.log)
      .filter((entry): entry is VisibleLogEntry => entry.type !== "reasoning");
    return log.map((entry) => ({ type: "entry" as const, entry, id: entry.id }));
  }, [state.actions, state.log, density]);

  // Render immediately from the real OpenCode event stream. Earlier versions
  // artificially delayed rows, which made scroll position lag behind the
  // changing transcript and looked like a raw, staged command log.
  const visibleItems = transcriptItems;
  const lastPromptTs = useMemo(() => {
    for (let index = state.log.length - 1; index >= 0; index -= 1) {
      const entry = state.log[index];
      if (entry.type === "user") return entry.ts;
    }
    return null;
  }, [state.log]);
  // The newest reasoning phase that has not finished yet, if any. Its text is
  // what the user is watching stream, so it takes the status slot.
  const openThought = useMemo(() => {
    for (let index = state.log.length - 1; index >= 0; index -= 1) {
      const entry = state.log[index];
      if (entry.type === "reasoning" && !entry.endedAt) return entry;
      if (entry.type === "user") return null;
    }
    return null;
  }, [state.log]);
  // Tool providers can report overlapping calls. Keep their real state, but
  // reserve the moving treatment for the newest one so the user always has a
  // single obvious answer to “what is the agent doing right now?”.
  const primaryActiveAction = [...visibleItems].reverse().find((item) => {
    if (item.entry.type !== "action") return false;
    const action = state.actions[item.entry.actionId];
    return action?.status === "active" || action?.status === "queued";
  });
  const primaryActiveActionId = primaryActiveAction?.entry.type === "action"
    ? primaryActiveAction.entry.actionId
    : undefined;

  // Codex groups consecutive tool calls into one activity block; approvals stay standalone because they need a
  // decision, and user / assistant messages break a run.
  type Block =
    | { type: "group"; id: string; actionIds: string[] }
    | { type: "entry"; id: string; entry: VisibleLogEntry; previousUserTs: number | null };
  const blocks = useMemo<Block[]>(() => {
    const out: Block[] = [];
    let lastUserTs: number | null = null;
    for (const item of visibleItems) {
      const entry = item.entry;
      if (entry.type === "action") {
        const action = state.actions[entry.actionId];
        if (action && action.kind !== "permission") {
          const last = out[out.length - 1];
          if (last?.type === "group") last.actionIds.push(action.id);
          else out.push({ type: "group", id: `group:${entry.id}`, actionIds: [action.id] });
          continue;
        }
      }
      out.push({ type: "entry", id: item.id, entry, previousUserTs: entry.type === "user" ? lastUserTs : null });
      if (entry.type === "user") lastUserTs = entry.ts;
    }
    return out;
  }, [visibleItems, state.actions]);
  const lastGroupId = useMemo(() => {
    for (let index = blocks.length - 1; index >= 0; index -= 1) if (blocks[index].type === "group") return blocks[index].id;
    return null;
  }, [blocks]);

  return (
    <div className="relative min-h-0 flex-1">
      <div ref={scrollRef} className="cc-scroll absolute inset-0 overflow-y-auto px-6 pb-4 pt-3 sm:px-7">
        <div className="mx-auto flex w-full max-w-[760px] flex-col">
          {blocks.map((block, index) => {
            const prevBlock = blocks[index - 1];
            if (block.type === "group") {
              const groupActions = block.actionIds.map((id) => state.actions[id]).filter(Boolean) as AgentAction[];
              if (!groupActions.length) return null;
              const fresh = !state.restored && Date.now() - (groupActions[0].startedAt || 0) < 10 * 60_000;
              const spacing = prevBlock?.type === "group" ? "mt-1" : "mt-2.5";
              if (groupActions.length === 1) {
                return (
                  <div key={block.id} className={spacing}>
                    <ActivityRow action={groupActions[0]} live={groupActions[0].id === primaryActiveActionId} fresh={fresh} onOpenFile={onOpenFile} onRetry={onRetry} onOpenTerminal={onOpenTerminal} />
                  </div>
                );
              }
              return (
                <div key={block.id} className={spacing}>
                  <ActivityGroup
                    actions={groupActions}
                    liveId={primaryActiveActionId}
                    fresh={fresh}
                    defaultOpen={fresh && block.id === lastGroupId}
                    onOpenFile={onOpenFile}
                    onRetry={onRetry}
                    onOpenTerminal={onOpenTerminal}
                  />
                </div>
              );
            }
            const entry = block.entry;
            const prev = prevBlock?.type === "entry" ? prevBlock.entry : prevBlock?.type === "group" ? ({ type: "action" } as const) : undefined;
            const nextKindGap =
              prev &&
              ((prev.type === "action" && entry.type === "assistant") ||
                (prev.type === "assistant" && entry.type === "action") ||
                (prev.type === "user" && entry.type !== "user"));
            // Historical entries (restored sessions) render settled.
            const fresh = Date.now() - entry.ts < 4000;

            if (entry.type === "user") {
              const previousUserTs = block.previousUserTs;
              const showStamp = previousUserTs === null || entry.ts - previousUserTs > 30 * 60_000;
              return (
                <div key={entry.id}>
                  {showStamp ? <div className="cxa-stamp">{formatStamp(entry.ts)}</div> : null}
                  <motion.div
                    {...(reduced || !fresh
                      ? {}
                      : { initial: { opacity: 0, y: 4 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.28, ease: AGENT_EASE } })}
                    className="mb-2.5 mt-[14px] flex w-full justify-end first:mt-2"
                  >
                    <div
                      data-invert-ignore="true"
                      className="cc-user-prompt max-w-[82%] px-[14px] py-[8px] text-[14px] leading-[21px] text-[#1A1C1F]"
                    >
                      {entry.answers?.length ? (
                        <div className="mb-1.5 flex flex-col gap-[3px] rounded-[10px] bg-white/60 px-2 py-1.5">
                          {entry.answers.map((row) => (
                            <div key={row.question} className="flex items-center gap-2">
                              <span className="min-w-0 flex-1 truncate text-[11px] text-[#8B8D92]">{row.question}</span>
                              <span className="shrink-0 text-[12px] font-medium text-[#303136]">{row.answer}</span>
                            </div>
                          ))}
                        </div>
                      ) : null}
                      <span className="whitespace-pre-wrap">{entry.text}</span>
                    </div>
                  </motion.div>
                </div>
              );
            }
            if (entry.type === "assistant") {
              return (
                <div
                  key={entry.id}
                  className={cn(
                    "dsh-assistant-message",
                    nextKindGap ? "mt-2.5" : "mt-1.5",
                  )}
                >
                  <MarkdownMessageContent content={entry.text} />
                </div>
              );
            }
            const action = state.actions[entry.actionId];
            if (!action) return null;
            return (
              <div key={entry.id} className={nextKindGap ? "mt-2" : "mt-1"}>
                <AgentActionRow
                  action={action}
                  onReplyPermission={onReplyPermission}
                  onRetry={onRetry}
                  onOpenTerminal={onOpenTerminal}
                  onOpenFile={onOpenFile}
                  revisiting={revisitedActionIds.has(action.id)}
                  primaryActive={action.id === primaryActiveActionId}
                />
              </div>
            );
          })}

          <AnimatePresence initial={false}>
            {running && !primaryActiveActionId ? (
              openThought ? (
                <motion.div key="thinking" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -2 }} transition={{ duration: 0.22, ease: AGENT_EASE }} className="mt-2">
                  <ThinkingEvent entry={openThought} />
                </motion.div>
              ) : (
                <WorkingStatus key="working" since={lastPromptTs ?? Date.now()} />
              )
            ) : null}
          </AnimatePresence>

          {state.runState === "failed" ? (
            <div className="dsh-row-root mt-2" data-state="error" role="status" aria-label="Run failed">
              <div className="dsh-row">
                <span className="dsh-leading"><StateDot state="error" /></span>
                <span className="dsh-title">Run failed</span>
                <span className="dsh-sep" aria-hidden />
                <span className="dsh-summary">Open the failed action for details</span>
              </div>
            </div>
          ) : null}

          {state.runState === "cancelled" ? (
            <div className="mt-2 text-[11.5px] text-[#96989D]">
              Cancelled by user
            </div>
          ) : null}

          {state.runState === "complete" && state.runStartedAt && state.runEndedAt && state.runEndedAt - state.runStartedAt > 2000 ? (
            <div className="cx-worked" role="separator">Worked for {(() => { const s = Math.round((state.runEndedAt - state.runStartedAt) / 1000); return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`; })()}</div>
          ) : null}
          {showCompletion ? (
            <CompletionSummary
              diffs={state.diffs}
              actions={Object.values(state.actions)}
              onOpenChanges={onOpenChanges}
              onOpenFile={onOpenFile}
              onUndo={onUndoCheckpoint}
              restored={state.restored}
            />
          ) : null}
        </div>
      </div>

      <AnimatePresence>
        {!pinned ? (
          <motion.button
            key="jump-to-latest"
            type="button"
            initial={{ opacity: 0, y: 3 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 3 }}
            transition={{ duration: 0.18, ease: AGENT_EASE }}
            onClick={jumpToLatest}
            aria-label="Jump to latest"
            title="Jump to latest"
            className="absolute bottom-4 left-1/2 z-10 flex h-7 -translate-x-1/2 items-center gap-1 rounded-full border border-black/[0.08] bg-white px-2.5 text-[12px] font-medium text-[#5F6368] shadow-[0_4px_14px_rgba(15,23,42,0.1)] transition-colors hover:text-[#171717]"
          >
            <ArrowDown className="h-3 w-3" strokeWidth={2} />
            Jump to latest
          </motion.button>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
