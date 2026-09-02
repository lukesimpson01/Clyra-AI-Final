/**
 * One agent action in the transcript.
 *
 * The row language is extracted from deepseek-ai/deepseek-harness (MIT) —
 * `ui-tool/tool/components/ToolRow`: a 24px single line reading
 * `[glyph] Title · summary   suffix`, expanding into an IN/OUT card, with a
 * running row marked by a sweep of glare rather than animated glyphs, and a
 * failure marked by a state dot whose summary is replaced by the error's
 * first line.  Clyra's own action model, permission rows and streaming file
 * edits are kept; the harness's cordis/i18n plumbing is not.
 */

import { memo, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import {
  Braces,
  CheckCircle2,
  Download,
  FileText,
  FolderTree,
  Globe,
  Hammer,
  ListChecks,
  Pencil,
  Play,
  Search,
  ShieldQuestion,
  Terminal,
  Trash2,
} from "lucide-react";
import { cn } from "../../lib/utils";
import type { AgentAction } from "./store";
import { DiffCounters } from "./AnimatedCounter";
import { DisclosureRow, IoCard, StateDot } from "./harness";
import { AGENT_EASE, ROW_ENTER } from "./motion";

/** Title verb per phase. The harness row keeps the title short and constant
 *  in width, letting the summary carry everything variable. */
const VERBS: Record<string, { active: string; done: string; failed: string }> = {
  read: { active: "Reading", done: "Read", failed: "Read failed" },
  edit: { active: "Editing", done: "Edited", failed: "Edit failed" },
  create: { active: "Creating", done: "Created", failed: "Create failed" },
  delete: { active: "Deleting", done: "Deleted", failed: "Delete failed" },
  search: { active: "Searching", done: "Searched", failed: "Search failed" },
  research: { active: "Researching", done: "Researched", failed: "Research failed" },
  list: { active: "Exploring", done: "Explored", failed: "Explore failed" },
  command: { active: "Running", done: "Ran", failed: "Command failed" },
  build: { active: "Building", done: "Built", failed: "Build failed" },
  check: { active: "Checking", done: "Checked", failed: "Check failed" },
  test: { active: "Testing", done: "Tested", failed: "Tests failed" },
  preview: { active: "Previewing", done: "Previewed", failed: "Preview failed" },
  fetch: { active: "Fetching", done: "Fetched", failed: "Fetch failed" },
  todo: { active: "Planning", done: "Planned", failed: "Planning failed" },
  permission: { active: "Awaiting approval", done: "Approved", failed: "Denied" },
  generic: { active: "Working", done: "Done", failed: "Failed" },
};

const ICONS: Record<string, typeof FileText> = {
  read: FileText,
  edit: Pencil,
  create: Pencil,
  delete: Trash2,
  search: Search,
  research: Globe,
  list: FolderTree,
  command: Terminal,
  build: Hammer,
  check: CheckCircle2,
  test: Play,
  preview: Globe,
  fetch: Download,
  todo: ListChecks,
  permission: ShieldQuestion,
  generic: Braces,
};

function formatDuration(ms: number) {
  if (ms < 1000) return `${Math.max(0, Math.round(ms / 100) / 10)}s`;
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

/** The failure's first line — the harness replaces, never supplements, the
 *  normal summary with it, so a broken row reads as one statement. */
function firstLine(text: string | undefined | null): string | null {
  if (!text) return null;
  const line = text.trim().split("\n", 1)[0]?.trim();
  return line ? line : null;
}

export const AgentActionRow = memo(function AgentActionRow({
  action,
  onReplyPermission,
  onRetry,
  onOpenTerminal,
  onOpenFile,
  revisiting = false,
  settled = false,
  primaryActive = true,
}: {
  action: AgentAction;
  onReplyPermission?: (permissionId: string, response: "allow" | "always" | "deny") => void;
  onRetry?: (action: AgentAction) => void;
  onOpenTerminal?: () => void;
  onOpenFile?: (path: string) => void;
  /** A real read that follows an edit to the same file. */
  revisiting?: boolean;
  /** Render an expanded completed phase without replaying its animation. */
  settled?: boolean;
  /** Only the current live action gets the running treatment. */
  primaryActive?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const reduced = useReducedMotion();
  const verbs = VERBS[action.kind] ?? VERBS.generic;
  const Icon = ICONS[action.kind] ?? ICONS.generic;
  const isActive = action.status === "active" || action.status === "queued";
  const isPrimaryActive = isActive && primaryActive;
  const isError = action.status === "error";
  const isCancelled = action.status === "cancelled";

  // Historical rows (restored sessions / reopened tabs) render settled.
  const [historical] = useState(() => {
    if (settled) return true;
    if (isActive) return false;
    const ended = action.endedAt ?? action.startedAt;
    return Date.now() - ended > 4000;
  });
  const enterProps = reduced || historical ? {} : ROW_ENTER;

  // Permission rows are a decision, not a report: they keep their own inline
  // control set rather than the disclosure chrome.
  if (action.kind === "permission") {
    return (
      <motion.div {...enterProps} className="dsh-row-root" data-state={action.status === "active" ? "running" : undefined}>
        <div className="dsh-row">
          <span className="dsh-leading" style={{ color: "var(--warning-amber)" }}>
            <ShieldQuestion />
          </span>
          <span className="dsh-title" style={{ color: "var(--warning-amber)", fontWeight: 500 }}>
            {action.status === "active" ? "Approval needed" : "Approval"}
          </span>
          <span className="dsh-sep" aria-hidden />
          <span className="dsh-summary dsh-summary-mono">{action.target}</span>
          {action.status === "active" && action.permissionId && onReplyPermission ? (
            <span className="ml-auto flex shrink-0 items-center gap-1.5 pl-2">
              {(["allow", "always", "deny"] as const).map((response) => (
                <button
                  key={response}
                  type="button"
                  onClick={() => onReplyPermission(action.permissionId!, response)}
                  className="dsh-pill"
                  style={response === "deny" ? { color: "var(--deletion-red)" } : undefined}
                >
                  {response === "allow" ? "Allow" : response === "always" ? "Always" : "Deny"}
                </button>
              ))}
            </span>
          ) : action.permissionResolved ? (
            <span className="dsh-suffix">{action.permissionResolved}</span>
          ) : null}
        </div>
      </motion.div>
    );
  }

  const isFileAction = /^(edit|create|delete)$/.test(action.kind);
  const isTerminalAction = /^(command|build|check|test|preview)$/.test(action.kind);
  const isMonoTarget = isFileAction || isTerminalAction || /^(read|list)$/.test(action.kind);

  const title =
    revisiting && action.kind === "read"
      ? isActive
        ? "Revisiting"
        : isError
          ? verbs.failed
          : isCancelled
            ? "Cancelled"
            : "Revisited"
      : isActive
        ? verbs.active
        : isError
          ? verbs.failed
          : isCancelled
            ? "Cancelled"
            : verbs.done;

  const rowState = isPrimaryActive ? "running" : isError ? "error" : isCancelled ? "stopped" : "ok";
  const failureLine = isError ? firstLine(action.error) ?? firstLine(action.output) : null;
  const summaryText = failureLine ?? action.target;

  // A tool's completed transport state is not proof that its build or test
  // passed: shell pipelines can intentionally return zero after a failing
  // compiler.  Only claim a pass when the real output proves it.
  const terminalEvidence = `${action.output ?? ""}\n${action.error ?? ""}`;
  const passConfirmed =
    /\b(?:exit(?:\s+code)?\s*[:=]?\s*0|tests?\s+passed|build\s+(?:passed|succeeded)|checks?\s+passed|typecheck\s+passed)\b/i.test(
      terminalEvidence,
    );

  const duration = action.endedAt && action.startedAt ? action.endedAt - action.startedAt : null;
  const changeDetails =
    action.patch?.trim() ||
    (action.before !== undefined || action.after !== undefined
      ? `${action.before ?? ""}\n--- after ---\n${action.after ?? ""}`.trim()
      : action.contentAfter?.trim()) ||
    null;
  // A file action's raw tool output is protocol status text ("Created file"),
  // not content — once there is a real diff/content to show, that is the
  // whole story and the status text would only repeat or contradict it.
  const detailOutput = [
    action.error?.trim(),
    isFileAction && changeDetails ? null : action.output?.trim(),
    changeDetails,
  ]
    .filter((value, index, values): value is string => Boolean(value) && values.indexOf(value) === index)
    .join("\n\n");
  const hasDetails = Boolean(detailOutput);
  const canOpenFile = isFileAction && Boolean(onOpenFile) && !isError;

  // The trailing fragment, kept outside the summary's ellipsis so it survives
  // a narrow row: a confirmed pass, else a duration worth reading.
  const suffix =
    failureLine !== null
      ? null
      : isTerminalAction && !isActive && !isCancelled && passConfirmed
        ? "passed"
        : duration !== null && duration > 900
          ? formatDuration(duration)
          : null;

  const leading = isError ? <StateDot state="error" /> : isCancelled ? <StateDot state="warning" /> : <Icon />;

  return (
    <motion.div
      {...enterProps}
      layout
      transition={
        reduced || historical
          ? { layout: { duration: 0.28, ease: AGENT_EASE } }
          : { ...ROW_ENTER.transition, layout: { duration: 0.28, ease: AGENT_EASE } }
      }
      className="dsh-row-root"
      data-state={rowState}
    >
      {/* The state dot and the sweep are colour-only, so assistive technology
          needs this text to know a row is running, failed or interrupted. */}
      {rowState !== "ok" && (
        <span className="dsh-visually-hidden">
          {rowState === "running" ? "Running" : rowState === "error" ? "Failed" : "Stopped"}
        </span>
      )}
      <DisclosureRow
        icon={leading}
        title={title}
        open={expanded && hasDetails}
        expandable={hasDetails}
        expandOnRowClick
        keepContentWhenOpen
        onToggle={() => setExpanded((v) => !v)}
        collapsedContent={
          summaryText ? (
            <>
              <span className="dsh-sep" aria-hidden />
              {canOpenFile ? (
                <button
                  type="button"
                  className="dsh-file-link"
                  title="Open file changes"
                  onClick={(event) => {
                    event.stopPropagation();
                    onOpenFile?.(action.target);
                  }}
                  onKeyDown={(event) => {
                    // Enter/Space on the focused link must not bubble to the
                    // row, which would preventDefault and expand instead.
                    if (event.key === "Enter" || event.key === " ") event.stopPropagation();
                  }}
                >
                  {summaryText}
                </button>
              ) : (
                <span
                  className={cn(
                    "dsh-summary",
                    isMonoTarget && failureLine === null && "dsh-summary-mono",
                    failureLine !== null && "dsh-summary-error",
                  )}
                >
                  {summaryText}
                </span>
              )}
              {isFileAction && failureLine === null ? (
                <DiffCounters
                  additions={action.kind === "delete" ? undefined : action.additions ?? (action.kind === "create" ? undefined : 0)}
                  deletions={action.kind === "create" ? undefined : action.deletions ?? (action.kind === "delete" ? undefined : 0)}
                  showZero={action.kind !== "create" && action.kind !== "delete"}
                  animate={!historical}
                  className="dsh-suffix dsh-suffix-stat"
                />
              ) : null}
              {suffix !== null ? <span className="dsh-suffix dsh-suffix-stat">{suffix}</span> : null}
            </>
          ) : null
        }
      >
        <div className="dsh-body">
          <IoCard
            input={isTerminalAction ? action.target : null}
            output={detailOutput}
            error={isError}
            outputLabel={isFileAction && changeDetails ? "DIFF" : "OUT"}
          />
          {isError || canOpenFile || (onOpenTerminal && isTerminalAction) ? (
            <div className="dsh-row-actions">
              {isError && onRetry ? (
                <button type="button" className="dsh-pill" onClick={() => onRetry(action)}>
                  Ask agent to fix
                </button>
              ) : null}
              {onOpenTerminal && isTerminalAction ? (
                <button type="button" className="dsh-pill" onClick={onOpenTerminal}>
                  Open terminal
                </button>
              ) : null}
              {canOpenFile ? (
                <button type="button" className="dsh-pill" onClick={() => onOpenFile?.(action.target)}>
                  View diff
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      </DisclosureRow>

    </motion.div>
  );
});
