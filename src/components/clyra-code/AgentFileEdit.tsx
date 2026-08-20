import { memo, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ChevronRight } from "lucide-react";
import { cn } from "../../lib/utils";
import type { AgentAction } from "./store";
import { ShimmerText } from "./Shimmer";
import { DiffCounters } from "./AnimatedCounter";
import { computeLineDiff, linesFromPatch, type DiffLine } from "./diff";
import { AGENT_EASE, LABEL_MORPH, enterProps } from "./motion";

/**
 * Lifecycle-driven streaming edit box.
 *
 * One persistent component morphs through its phases exactly once:
 *   header enters → real harness lines resolve as a compact diff → the body
 *   settles and closes. The UI never simulates typed source code: every line
 *   comes from an actual tool payload.
 *
 * Historical rows (restored sessions) render settled and never replay.
 */

type Phase = "header" | "open" | "closed" | "failed";

/**
 * The rhythm of a single edit box:
 *
 *   row appears → 1s → opens → code prints → 1s → closes → 1s → next action
 *
 * One second is long enough to read each beat as a deliberate step rather
 * than a stack of panels flickering past.
 */
const EXPAND_DELAY_MS = 1000;
/** How long the finished diff is held open before it closes. */
const DWELL_MS = 1000;
/** Cadence of the line reveal, and the tick budget that keeps a huge patch
 *  from holding the transcript hostage. */
const REVEAL_TICK_MS = 150;
const REVEAL_MAX_TICKS = 24;
/**
 * The open/close travel. Long enough to read as a movement rather than a pop;
 * the transcript is released only after it has finished, so the next action
 * never starts on top of a box that is still moving.
 */
const COLLAPSE_MS = 280;

function linesFor(action: AgentAction): DiffLine[] {
  if (action.patch) return linesFromPatch(action.patch);
  if (action.before || action.after) {
    return computeLineDiff(action.before ?? "", action.after ?? "");
  }
  if (action.kind === "create" && action.contentAfter) {
    return action.contentAfter.split("\n").map((text, index) => ({
      kind: "add" as const,
      text,
      afterLine: index + 1,
    }));
  }
  return [];
}

/** A diff panel is useful only when the harness supplied real changed lines. */
export function hasRenderableActionDiff(action: AgentAction) {
  return linesFor(action).some((line) => line.kind !== "context" && line.text.trim().length > 0);
}

const LINE_CLASSES: Record<DiffLine["kind"], { row: string; text: string }> = {
  add: { row: "bg-[color:var(--addition-bg)]", text: "text-[color:var(--addition-green-strong)]" },
  del: { row: "bg-[color:var(--deletion-bg)]", text: "text-[color:var(--deletion-red-strong)]" },
  context: { row: "", text: "text-[color:var(--text-secondary)]" },
};

/** A real diff line. Source content always arrives directly from the harness. */
const DiffBodyLine = memo(function DiffBodyLine({ line }: { line: DiffLine }) {
  const styles = LINE_CLASSES[line.kind];
  const prefix = line.kind === "add" ? "+ " : line.kind === "del" ? "− " : "  ";

  return (
    <div className={cn("flex items-start", styles.row)}>
      <span className="w-7 shrink-0 select-none pr-1.5 text-right text-[9px] leading-[1.65] text-[color:var(--text-disabled)]">
        {line.beforeLine ?? ""}
      </span>
      <span className="w-7 shrink-0 select-none pr-1.5 text-right text-[9px] leading-[1.65] text-[color:var(--text-disabled)]">
        {line.afterLine ?? ""}
      </span>
      <span
        className={cn(
          "cc-mono min-w-0 flex-1 whitespace-pre-wrap break-words text-[10.75px] leading-[1.55]",
          styles.text,
        )}
      >
        {prefix}
        {line.text}
      </span>
    </div>
  );
});

export const AgentFileEdit = memo(function AgentFileEdit({
  action,
  onOpenFile,
  onClosed,
  settled = false,
}: {
  action: AgentAction;
  onOpenFile?: (path: string) => void;
  /** Fires once when this box's lifecycle is complete (collapsed/failed). */
  onClosed?: (id: string) => void;
  /** Expanded historical/complete phase: show static, never replay a diff. */
  settled?: boolean;
}) {
  const reducedMotion = useReducedMotion();
  const lines = useMemo(
    () => linesFor(action),
    [action.patch, action.kind, action.contentAfter, action.before, action.after],
  );
  const changeCount = useMemo(() => lines.filter((l) => l.kind !== "context").length, [lines]);
  const lineCount = lines.length;

  const active = action.status === "active" || action.status === "queued";
  const completed = action.status === "success";
  const failed = action.status === "error" || action.status === "cancelled";
  const hasLines = lines.length > 0;

  // Historical rows (restored sessions / reopened tabs) render settled.
  const [historical] = useState(() => {
    if (settled) return true;
    if (active) return false;
    const ended = action.endedAt ?? action.startedAt;
    return Date.now() - ended > 4000;
  });

  const [phase, setPhase] = useState<Phase>(() => {
    if (failed) return "failed";
    if (active) return "header";
    if (completed && !historical) return "header";
    return "closed";
  });
  const [manualOpen, setManualOpen] = useState<boolean | null>(null);
  const open = manualOpen ?? phase === "open";

  // A completion phase is held briefly so the real diff can be scanned before
  // it settles back into its compact row.
  const [typedCount, setTypedCount] = useState(0);
  const closedRef = useRef(false);

  const notifyClosed = () => {
    if (!closedRef.current) {
      closedRef.current = true;
      onClosed?.(action.id);
    }
  };

  /* ---------------- one-shot lifecycle ---------------- */

  // Hold the compact action row for a beat, then expand. This creates a calm,
  // legible sequencing rhythm without inventing source that the harness did
  // not return.
  useEffect(() => {
    if (failed || manualOpen !== null) return;
    if (phase !== "header") return;
    if (!hasLines) return;
    const delay = reducedMotion ? 0 : EXPAND_DELAY_MS;
    const timer = window.setTimeout(() => setPhase("open"), delay);
    return () => window.clearTimeout(timer);
  }, [failed, manualOpen, phase, hasLines, reducedMotion]);

  // Once every real line is visible the diff holds for a readable beat, then
  // collapses. There is no simulated code typing.
  useEffect(() => {
    if (!completed || manualOpen !== null) return;
    if (phase !== "open" || typedCount < lineCount) return;
    const timer = window.setTimeout(() => setPhase("closed"), reducedMotion ? 0 : DWELL_MS);
    return () => window.clearTimeout(timer);
  }, [completed, manualOpen, phase, typedCount, lineCount, action.id, reducedMotion]);

  // The transcript gate opens only after the collapse has finished playing.
  // Releasing on the first frame of the collapse would start the next action
  // on top of a box that is still visibly closing.
  useEffect(() => {
    if (phase !== "closed" || closedRef.current) return;
    const timer = window.setTimeout(notifyClosed, reducedMotion ? 0 : COLLAPSE_MS);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, reducedMotion, action.id]);

  // Failures collapse the body and keep the failed header.
  useEffect(() => {
    if (failed && phase !== "failed") {
      setPhase("failed");
      const timer = window.setTimeout(notifyClosed, 400);
      return () => window.clearTimeout(timer);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [failed, phase, action.id]);

  // Line-less completed edits release the transcript gate shortly after.
  useEffect(() => {
    if (historical) {
      notifyClosed();
      return;
    }
    if (completed && !hasLines && phase !== "closed" && phase !== "failed") {
      const timer = window.setTimeout(() => {
        setPhase("closed");
        notifyClosed();
      }, reducedMotion ? 0 : 500);
      return () => window.clearTimeout(timer);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [historical, completed, hasLines, phase, action.id]);

  // Reveal genuine changed lines at a readable pace. This is a presentation
  // of the returned patch, never simulated typing or fabricated source.
  // The patch is still arriving while the box is open, so the line count grows
  // underneath the reveal. Read it through a ref: restarting the reveal every
  // time a line lands makes code that is already on screen blink out and
  // retype itself.
  const lineCountRef = useRef(lineCount);
  lineCountRef.current = lineCount;

  useEffect(() => {
    if (!open) {
      if (phase !== "header") setTypedCount(0);
      return;
    }
    if (reducedMotion) {
      setTypedCount(lineCountRef.current);
      return;
    }
    setTypedCount(0);
    // A calm, readable cadence for a normal patch. Very large patches reveal
    // several lines per tick instead of slowing to a crawl, so the pace stays
    // legible without stalling the rest of the run.
    let next = 0;
    const advance = () => {
      const total = lineCountRef.current;
      const step = Math.max(1, Math.ceil(total / REVEAL_MAX_TICKS));
      next = Math.min(total, next + step);
      setTypedCount(next);
    };
    const start = window.setTimeout(advance, REVEAL_TICK_MS);
    const timer = window.setInterval(advance, REVEAL_TICK_MS);
    return () => {
      window.clearTimeout(start);
      window.clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, reducedMotion]);

  /* ---------------- internal auto-follow ---------------- */
  const bodyScrollRef = useRef<HTMLDivElement | null>(null);
  const userScrolledRef = useRef(false);

  useEffect(() => {
    userScrolledRef.current = false;
  }, [open]);

  useEffect(() => {
    const node = bodyScrollRef.current;
    if (!node) return;
    const frame = requestAnimationFrame(() => {
      if (!userScrolledRef.current) {
        node.scrollTo({ top: node.scrollHeight, behavior: reducedMotion ? "auto" : "smooth" });
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [open, lines.length, reducedMotion]);

  /* ---------------- header ---------------- */

  const verb = active
    ? "Editing"
    : failed
      ? action.status === "cancelled"
        ? "Cancelled"
        : "Failed editing"
      : "Edited";
  const verbClass = failed
    ? "text-[color:var(--deletion-red)]"
    : active
      ? "text-[color:var(--text-secondary)]"
      : "text-[color:var(--text-secondary)]";

  const additions = action.additions ?? 0;
  const deletions = action.deletions ?? 0;

  // Every line is in the DOM as soon as the body opens; only its ink fades in.
  //
  // Mounting lines one at a time made the panel grow in a dozen little steps
  // as the code printed — a stutter rather than an opening. Now the box makes
  // one smooth height movement to the size of the patch, and the code prints
  // inside a surface that has already settled.
  const renderedLines = lines.map((line, index) => (
    <div
      key={index}
      className="cc-diff-line"
      data-revealed={index < typedCount ? "true" : "false"}
      aria-hidden={index < typedCount ? undefined : true}
    >
      <DiffBodyLine line={line} />
    </div>
  ));

  const toggle = () => {
    if (hasLines) {
      const next = manualOpen === null ? !open : !manualOpen;
      if (next === false && phase === "open") {
        // A manual collapse finishes this box's lifecycle so the transcript
        // gate can move on to the next action.
        notifyClosed();
      }
      setManualOpen(next);
      return;
    }
    if (completed && onOpenFile && action.target !== "…") {
      onOpenFile(action.target);
    }
  };

  return (
    <motion.div
      layout
      initial={historical ? false : { opacity: 0, y: 2 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        opacity: { duration: 0.14, ease: AGENT_EASE },
        y: { duration: 0.15, ease: AGENT_EASE },
        layout: { duration: 0.19, ease: AGENT_EASE },
      }}
      className="group min-w-0"
    >
      <motion.div
        layout
        transition={{ layout: { duration: 0.19, ease: AGENT_EASE } }}
        className={cn("overflow-visible", completed && "opacity-[0.8] transition-opacity duration-200")}
      >
      <div
        className={cn(
          "flex min-h-[23px] items-center gap-1.5 px-[3px] py-[2px]",
          (hasLines || (completed && onOpenFile)) && "cursor-pointer",
          "rounded-[5px] transition-colors hover:bg-black/[0.025]",
        )}
        onClick={toggle}
        role={(hasLines || (completed && onOpenFile)) ? "button" : undefined}
        aria-expanded={hasLines ? open : undefined}
      >
        <AnimatePresence mode="popLayout" initial={historical}>
          <motion.span
            key={verb}
            {...enterProps(LABEL_MORPH, !historical)} exit={LABEL_MORPH.exit}
            className={cn(
              "inline-block shrink-0 text-left text-[12px] font-medium leading-none",
              verbClass,
            )}
          >
            {verb}
          </motion.span>
        </AnimatePresence>
        <AnimatePresence initial={false}>
          {action.target !== "…" ? (
            <motion.span
              key="target"
              initial={historical ? false : { opacity: 0, x: -2 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.3, ease: AGENT_EASE }}
              className="flex min-w-0"
            >
              <ShimmerText
                text={action.target}
                active={active}
                tone="blue"
                mono
                className="min-w-0 text-[12px] text-[color:var(--text-secondary)]"
              />
            </motion.span>
          ) : null}
        </AnimatePresence>
        <span className="ml-auto flex shrink-0 items-center gap-1.5">
          <DiffCounters
            additions={additions}
            deletions={deletions}
            showZero
            animate={!historical}
            className="text-[10.75px] font-medium"
          />
          {hasLines ? (
            <motion.span
              initial={historical ? { rotate: open ? 90 : 0 } : false}
              animate={{ rotate: open ? 90 : 0 }}
              transition={{ duration: 0.18, ease: AGENT_EASE }}
            className="flex h-[18px] w-[18px] items-center justify-center rounded-[5px] text-[color:var(--text-tertiary)] transition-colors hover:bg-black/[0.04]"
            >
              <ChevronRight className="h-3.5 w-3.5" strokeWidth={1.65} />
            </motion.span>
          ) : null}
        </span>
      </div>

      {failed && action.error ? (
        <div className={cn(!historical && "cc-rise", "ml-1 mt-[3px] max-w-[600px] text-[11.75px] leading-[1.5] text-[color:var(--text-secondary)]")}>
          <span className="mr-1 font-medium text-[color:var(--deletion-red)]">×</span>
          {action.error}
        </div>
      ) : null}

      <AnimatePresence initial={false}>
        {open && hasLines && !failed ? (
          <motion.div
            key="body"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{
              height: { duration: COLLAPSE_MS / 1000, ease: AGENT_EASE },
              opacity: { duration: 0.16, ease: AGENT_EASE },
            }}
            className="mx-[1px] mb-1 mt-[2px] overflow-hidden rounded-[7px] border border-black/[0.07] bg-[color:var(--surface-muted)]"
          >
            <div
              ref={bodyScrollRef}
              onScroll={(event) => {
                const node = event.currentTarget;
                userScrolledRef.current =
                  node.scrollHeight - node.scrollTop - node.clientHeight > 24;
              }}
              className="cc-scroll max-h-[168px] overflow-y-auto px-1 py-1"
            >
              {renderedLines}
            </div>
            {completed && onOpenFile && action.target !== "…" ? (
              <button
                type="button"
                onClick={() => onOpenFile(action.target)}
                className="m-1 rounded-[6px] px-2 py-[2px] text-[12px] text-[color:var(--text-secondary)] transition-colors hover:bg-black/[0.035]"
              >
                Open diff
              </button>
            ) : null}
          </motion.div>
        ) : null}
      </AnimatePresence>
      </motion.div>
    </motion.div>
  );
});
