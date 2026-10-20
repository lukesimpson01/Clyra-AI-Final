/**
 * Agent activity in the Codex desktop language: consecutive tool calls collapse into one quiet group whose header
 * summarises the work ("Edited files, read files, ran commands"), and each call is a single 14px line —
 * `[icon] Verb file +a −d` — in 60% ink that sharpens to full ink on hover. Diffs and command output stay out of the
 * way until a row is opened. Only the newest running row moves (a shimmer on its verb); nothing else animates
 * except the gentle fade-in of rows as they arrive and the group's height when it opens or closes.
 */
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  BookOpen,
  ChevronDown,
  Download,
  FolderTree,
  Globe,
  Hammer,
  ListChecks,
  Pencil,
  Play,
  Search,
  ShieldCheck,
  SquareTerminal,
  Trash2,
  Wrench,
} from "lucide-react";
import { cn } from "../../lib/utils";
import type { AgentAction } from "./store";
import { InlineDiffCard, TerminalCard } from "./harness";
import { computeLineDiff, linesFromPatch } from "./diff";
import { AGENT_EASE } from "./motion";

const VERBS: Record<string, { active: string; done: string; failed: string }> = {
  read: { active: "Reading", done: "Read", failed: "Couldn’t read" },
  edit: { active: "Editing", done: "Edited", failed: "Edit failed" },
  create: { active: "Creating", done: "Created", failed: "Create failed" },
  delete: { active: "Deleting", done: "Deleted", failed: "Delete failed" },
  search: { active: "Searching for", done: "Searched for", failed: "Search failed" },
  research: { active: "Searching the web for", done: "Searched the web for", failed: "Web search failed" },
  list: { active: "Exploring", done: "Explored", failed: "Couldn’t explore" },
  command: { active: "Running", done: "Ran", failed: "Failed" },
  build: { active: "Building", done: "Built", failed: "Build failed" },
  check: { active: "Checking", done: "Checked", failed: "Check failed" },
  test: { active: "Testing", done: "Tested", failed: "Tests failed" },
  preview: { active: "Opening preview", done: "Opened preview", failed: "Preview failed" },
  fetch: { active: "Fetching", done: "Fetched", failed: "Fetch failed" },
  todo: { active: "Planning", done: "Updated plan", failed: "Planning failed" },
  generic: { active: "Working", done: "Done", failed: "Failed" },
};

const ICONS: Record<string, typeof BookOpen> = {
  read: BookOpen, edit: Pencil, create: Pencil, delete: Trash2, search: Search, research: Globe, list: FolderTree,
  command: SquareTerminal, build: Hammer, check: ShieldCheck, test: Play, preview: Globe, fetch: Download, todo: ListChecks,
  generic: Wrench,
};

const FILE_KINDS = /^(edit|create|delete)$/;
const TERMINAL_KINDS = /^(command|build|check|test|preview)$/;

function isRunning(action: AgentAction) {
  return action.status === "active" || action.status === "queued";
}

function baseName(path: string) {
  const clean = path.replace(/^file:\/\//, "").replace(/\/+$/, "");
  return clean.split("/").pop() || clean;
}

/** The agent's current step as a short phrase ("Editing App.tsx"), or null when nothing is running. */
export function liveStepLabel(actions: AgentAction[]) {
  for (let index = actions.length - 1; index >= 0; index -= 1) {
    const action = actions[index];
    if (action.kind === "permission" || !isRunning(action)) continue;
    const verb = (VERBS[action.kind] ?? VERBS.generic).active;
    const target = FILE_KINDS.test(action.kind) || action.kind === "read" ? baseName(action.target) : action.target;
    const short = target.length > 44 ? `${target.slice(0, 43)}…` : target;
    return short ? `${verb} ${short}` : `${verb}…`;
  }
  return null;
}

/** The header line for a finished group, in Codex's plain-sentence form. */
export function activitySummary(actions: AgentAction[]) {
  const edits = actions.filter((a) => FILE_KINDS.test(a.kind));
  const reads = actions.filter((a) => a.kind === "read" || a.kind === "list");
  const searches = actions.filter((a) => a.kind === "search" || a.kind === "research");
  const commands = actions.filter((a) => TERMINAL_KINDS.test(a.kind));
  const parts = [
    edits.length ? (edits.every((a) => a.kind === "create") ? "created files" : "edited files") : "",
    reads.length ? "read files" : "",
    searches.length ? "searched" : "",
    commands.length ? "ran commands" : "",
  ].filter(Boolean);
  if (!parts.length) return "Worked";
  const sentence = parts.join(", ");
  return sentence[0].toUpperCase() + sentence.slice(1);
}

function Stats({ additions, deletions }: { additions?: number; deletions?: number }) {
  if (additions === undefined && deletions === undefined) return null;
  return (
    <span className="cxa-stats">
      {additions !== undefined ? <span className="cxa-add">+{additions}</span> : null}
      {deletions !== undefined ? <span className="cxa-del">-{deletions}</span> : null}
    </span>
  );
}

/** Glides its own height to fit its content, so rows arriving or opening never make the transcript jump. */
function SmoothHeight({ children }: { children: React.ReactNode }) {
  const inner = useRef<HTMLDivElement | null>(null);
  const [height, setHeight] = useState<number | null>(null);
  useLayoutEffect(() => {
    const node = inner.current;
    if (!node) return;
    const measure = () => setHeight(node.offsetHeight);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return (
    <div className="cxa-smooth" style={height === null ? undefined : { height }}>
      <div ref={inner}>{children}</div>
    </div>
  );
}

export const ActivityRow = memo(function ActivityRow({
  action,
  live,
  fresh,
  onOpenFile,
  onRetry,
  onOpenTerminal,
}: {
  action: AgentAction;
  /** The single row currently doing work: only it shimmers. */
  live: boolean;
  /** Arrived during this session (fades in, shows the unseen dot on edits). */
  fresh: boolean;
  onOpenFile?: (path: string) => void;
  onRetry?: (action: AgentAction) => void;
  onOpenTerminal?: () => void;
}) {
  const reduced = useReducedMotion();
  const [open, setOpen] = useState(false);
  const [seen, setSeen] = useState(!fresh);
  const verbs = VERBS[action.kind] ?? VERBS.generic;
  const Icon = ICONS[action.kind] ?? ICONS.generic;
  const running = isRunning(action);
  const failed = action.status === "error";
  const isFile = FILE_KINDS.test(action.kind);
  const isTerminal = TERMINAL_KINDS.test(action.kind);
  const verb = running ? verbs.active : failed ? verbs.failed : action.status === "cancelled" ? "Stopped" : verbs.done;
  const target = isFile || action.kind === "read" ? baseName(action.target) : action.target;

  const diffLines = useMemo(() => {
    if (!isFile) return [];
    if (action.patch?.trim()) return linesFromPatch(action.patch);
    if (action.before !== undefined || action.after !== undefined) return computeLineDiff(action.before ?? "", action.after ?? "");
    if (action.contentAfter) return action.contentAfter.split("\n").slice(0, 400).map((text) => ({ kind: "add" as const, text }));
    return [];
  }, [isFile, action.patch, action.before, action.after, action.contentAfter]);
  const output = [action.output?.trim(), action.error?.trim()].filter(Boolean).join("\n");
  const hasBody = (isFile && diffLines.length > 0) || isTerminal || Boolean(output);

  return (
    <motion.div
      className="cxa-item"
      data-state={live ? "running" : failed ? "error" : "ok"}
      initial={fresh && !reduced ? { opacity: 0, y: 4 } : false}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease: AGENT_EASE }}
    >
      <button
        type="button"
        className="cxa-row"
        aria-expanded={hasBody ? open : undefined}
        onClick={() => { if (hasBody) setOpen((value) => !value); setSeen(true); }}
      >
        <Icon className="cxa-icon" strokeWidth={1.75} aria-hidden />
        <span className="cxa-text">
          <span className={cn("cxa-verb", live && !reduced && "cx-shine")}>{verb}</span>
          {target ? (
            isFile && onOpenFile && !failed ? (
              <span
                role="link"
                tabIndex={0}
                className="cxa-file"
                onClick={(event) => { event.stopPropagation(); setSeen(true); onOpenFile(action.target); }}
                onKeyDown={(event) => { if (event.key === "Enter") { event.stopPropagation(); onOpenFile(action.target); } }}
                title={action.target}
              >
                {target}
              </span>
            ) : (
              <span className={cn("cxa-target", (isTerminal || action.kind === "search") && "cxa-target--code")} title={action.target}>{target}</span>
            )
          ) : null}
        </span>
        {isFile && !failed ? <Stats additions={action.kind === "delete" ? undefined : action.additions} deletions={action.kind === "create" ? undefined : action.deletions} /> : null}
        {isFile && !seen && !running && !failed ? <span className="cxa-unseen" aria-label="New change" /> : null}
        {failed ? <span className="cxa-failed">failed</span> : null}
      </button>
      <AnimatePresence initial={false}>
        {open && hasBody ? (
          <motion.div
            key="body"
            className="cxa-body"
            initial={reduced ? { opacity: 0 } : { opacity: 0, height: 0 }}
            animate={reduced ? { opacity: 1 } : { opacity: 1, height: "auto" }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, height: 0 }}
            transition={{ duration: 0.24, ease: AGENT_EASE }}
          >
            <div className="cxa-body-inner">
              {isFile && diffLines.length ? (
                <InlineDiffCard path={action.target} lines={diffLines} additions={action.additions} deletions={action.deletions} onOpen={onOpenFile ? () => onOpenFile(action.target) : undefined} />
              ) : isTerminal ? (
                <TerminalCard command={action.target} output={output} error={failed} running={running} passed={action.status === "success" && /\b(passed|succeeded|exit(?:\s+code)?\s*[:=]?\s*0)\b/i.test(output)} duration={null} />
              ) : (
                <pre className="cxa-output">{output}</pre>
              )}
              {failed && (onRetry || onOpenTerminal) ? (
                <div className="cxa-actions">
                  {onRetry ? <button type="button" className="cxa-pill" onClick={() => onRetry(action)}>Ask Clyra to fix</button> : null}
                  {onOpenTerminal && isTerminal ? <button type="button" className="cxa-pill" onClick={onOpenTerminal}>Open terminal</button> : null}
                </div>
              ) : null}
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </motion.div>
  );
});

/**
 * A run of consecutive actions. While any of them is working the group is open and follows the newest row; once the
 * phase settles it folds to its one-line summary (the latest group of a fresh run stays open so the work just done
 * stays visible). Long groups scroll inside a 224px window with soft fading edges.
 */
export function ActivityGroup({
  actions,
  liveId,
  fresh,
  defaultOpen,
  onOpenFile,
  onRetry,
  onOpenTerminal,
}: {
  actions: AgentAction[];
  liveId?: string;
  fresh: boolean;
  defaultOpen: boolean;
  onOpenFile?: (path: string) => void;
  onRetry?: (action: AgentAction) => void;
  onOpenTerminal?: () => void;
}) {
  const reduced = useReducedMotion();
  const working = actions.some(isRunning);
  const [userChoice, setUserChoice] = useState<boolean | null>(null);
  const open = userChoice ?? (working || defaultOpen);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [edges, setEdges] = useState({ top: false, bottom: false });
  const live = actions.find((action) => action.id === liveId);
  // New actions are revealed one at a time (~140 ms apart) so a burst of tool calls reads as a sequence rather than
  // a block popping in; anything already finished on first render (history) shows immediately.
  const [revealed, setRevealed] = useState(() => (fresh && !reduced ? Math.min(1, actions.length) : actions.length));
  useEffect(() => {
    if (!fresh || reduced) { setRevealed(actions.length); return; }
    if (revealed >= actions.length) return;
    const timer = window.setTimeout(() => setRevealed((count) => Math.min(actions.length, count + 1)), revealed === 0 ? 0 : 140);
    return () => window.clearTimeout(timer);
  }, [actions.length, fresh, reduced, revealed]);
  const shown = actions.slice(0, Math.max(revealed, Math.min(actions.length, 1)));

  const updateEdges = () => {
    const node = scrollRef.current;
    if (!node) return;
    const top = node.scrollTop > 2;
    const bottom = node.scrollHeight - node.clientHeight - node.scrollTop > 2;
    setEdges((prev) => (prev.top === top && prev.bottom === bottom ? prev : { top, bottom }));
  };
  // Follow the newest row while the group is working, the way a live log does.
  useLayoutEffect(() => {
    const node = scrollRef.current;
    if (!node || !open) return;
    if (working) node.scrollTop = node.scrollHeight;
    updateEdges();
  }, [shown.length, open, working]);
  useEffect(() => {
    const node = scrollRef.current;
    if (!node) return;
    const observer = new ResizeObserver(updateEdges);
    observer.observe(node);
    return () => observer.disconnect();
  }, [open]);

  const header = working && live
    ? null
    : activitySummary(actions);
  // The header names the step in progress by its icon (the live row below carries the words); once done, a pencil
  // when files changed, otherwise the first action's kind.
  const HeadIcon = working && live
    ? ICONS[live.kind] ?? Wrench
    : actions.some((action) => FILE_KINDS.test(action.kind)) ? Pencil : ICONS[actions[0]?.kind ?? "generic"] ?? Wrench;

  return (
    <div className="cxa-group" data-open={open || undefined}>
      <button type="button" className="cxa-head" aria-expanded={open} onClick={() => setUserChoice(!open)}>
        <HeadIcon className="cxa-icon" strokeWidth={1.75} aria-hidden />
        {header === null ? (
          <span className={cn("cxa-head-text", !reduced && "cx-shine")}>Working…</span>
        ) : (
          <span className="cxa-head-text">{header}</span>
        )}
        <motion.span className="cxa-chevron" animate={{ rotate: open ? 0 : -90 }} transition={{ duration: 0.2, ease: AGENT_EASE }} aria-hidden>
          <ChevronDown className="h-[14px] w-[14px]" strokeWidth={1.8} />
        </motion.span>
      </button>
      <AnimatePresence initial={false}>
        {open ? (
          <motion.div
            key="rows"
            initial={reduced ? { opacity: 0 } : { opacity: 0, height: 0 }}
            animate={reduced ? { opacity: 1 } : { opacity: 1, height: "auto" }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, height: 0 }}
            transition={{ duration: 0.26, ease: AGENT_EASE }}
            className="cxa-rows-clip"
          >
            <div ref={scrollRef} onScroll={updateEdges} className="cxa-rows" data-fade-top={edges.top || undefined} data-fade-bottom={edges.bottom || undefined}>
              <SmoothHeight>
                {shown.map((action) => (
                  <ActivityRow key={action.id} action={action} live={action.id === liveId} fresh={fresh} onOpenFile={onOpenFile} onRetry={onRetry} onOpenTerminal={onOpenTerminal} />
                ))}
              </SmoothHeight>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
