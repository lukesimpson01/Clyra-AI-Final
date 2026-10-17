/**
 * Agent-activity primitives for the Vibe Coder transcript.
 *
 * Structure and motion are extracted from deepseek-ai/deepseek-harness (MIT):
 * `ui-primitives/DisclosureRow`, `ui-primitives/StateDot` and the todo status
 * glyphs from `ui-conversation/skeleton/TodoPanel`.  The cordis DI wiring,
 * the i18n `t()` seams and the CSS-module plumbing are dropped; the markup
 * contract and the visual behaviour are kept as-is so the rows read exactly
 * like the reference.
 */

import { useId, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import { cn } from "../../lib/utils";
import "./harness.css";

/** 14px chevron on the harness artboard, used for every disclosure affordance. */
export function ChevronDown14({ className }: { className?: string }) {
  return (
    <svg width={14} height={14} viewBox="0 0 14 14" fill="none" aria-hidden className={className}>
      <path d="M3.5 5.25L7 8.75L10.5 5.25" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Check16({ className }: { className?: string }) {
  return (
    <svg width={16} height={16} viewBox="0 0 16 16" fill="none" aria-hidden className={className}>
      <path d="M3.5 8.5L6.25 11.25L12.5 5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Solid status mark: a 6/10-scale core inside a same-colour 10% halo. */
export function StateDot({ state }: { state: "done" | "warning" | "error" }) {
  return <span className="dsh-dot" data-state={state} aria-hidden />;
}

export type DisclosureRowProps = {
  icon: ReactNode;
  /** Text, or a node such as a shimmering label while the phase is still running. */
  title: ReactNode;
  open: boolean;
  expandable: boolean;
  onToggle: () => void;
  /** Makes the whole title row the disclosure target. */
  expandOnRowClick?: boolean;
  /** Replaces the collapsed icon with a chevron while the row is hovered. */
  previewChevron?: boolean;
  /** Keeps `collapsedContent` inline while open. */
  keepContentWhenOpen?: boolean;
  collapsedContent?: ReactNode;
  children?: ReactNode;
  rowClassName?: string;
};

/**
 * One 24px disclosure header and its controlled expanded content.
 *
 * The leading cell is a real button only when the row itself does not expand
 * on click — otherwise there would be two nested controls for one action.
 */
export function DisclosureRow({
  icon,
  title,
  open,
  expandable,
  onToggle,
  expandOnRowClick = false,
  previewChevron,
  keepContentWhenOpen = false,
  collapsedContent,
  children,
  rowClassName,
}: DisclosureRowProps) {
  const rowExpands = expandable && expandOnRowClick;
  const showPreviewChevron = previewChevron ?? expandable;
  const toggleFromLeading = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    onToggle();
  };
  const toggleFromKeyboard = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!rowExpands || (event.key !== "Enter" && event.key !== " ")) return;
    event.preventDefault();
    onToggle();
  };
  const collapsedLeading = showPreviewChevron ? (
    <>
      <span className="dsh-icon-idle">{icon}</span>
      <ChevronDown14 className="dsh-chevron-hover" />
    </>
  ) : (
    icon
  );
  const leading = open ? <ChevronDown14 /> : collapsedLeading;

  return (
    <>
      <div
        className={cn("dsh-row", rowClassName)}
        data-expandable={rowExpands || undefined}
        role={rowExpands ? "button" : undefined}
        tabIndex={rowExpands ? 0 : undefined}
        aria-expanded={rowExpands ? open : undefined}
        onClick={rowExpands ? onToggle : undefined}
        onKeyDown={rowExpands ? toggleFromKeyboard : undefined}
      >
        {expandable && !rowExpands ? (
          <button type="button" className="dsh-leading" aria-expanded={open} onClick={toggleFromLeading}>
            {leading}
          </button>
        ) : (
          <span className="dsh-leading">{leading}</span>
        )}
        <span className="dsh-title">{title}</span>
        {(keepContentWhenOpen || !open) && collapsedContent}
      </div>
      {open && children}
    </>
  );
}

/** The expanded input/output card: sticky gutter labels, sections that scroll alone. */
export function IoCard({
  input,
  output,
  error = false,
  inputLabel = "IN",
  outputLabel = "OUT",
}: {
  input?: string | null;
  output?: string | null;
  error?: boolean;
  inputLabel?: string;
  outputLabel?: string;
}) {
  const hasInput = Boolean(input && input.trim());
  const hasOutput = Boolean(output && output.trim());
  if (!hasInput && !hasOutput) return null;
  return (
    <div className="dsh-io-card">
      {hasInput ? (
        <div className="dsh-io-section">
          <span className="dsh-io-label">{inputLabel}</span>
          <span className="dsh-io-text">{input}</span>
        </div>
      ) : null}
      {hasInput && hasOutput ? <span className="dsh-io-divider" aria-hidden /> : null}
      {hasOutput ? (
        <div className="dsh-io-section">
          <span className="dsh-io-label">{outputLabel}</span>
          <span className="dsh-io-text" data-error={error || undefined}>
            {output}
          </span>
        </div>
      ) : null}
    </div>
  );
}

/* ============================================================
   Todo status glyphs — the 14×14 harness artboard.
   ============================================================ */

export function TodoCompletedGlyph() {
  return (
    <svg width={14} height={14} viewBox="0 0 14 14" fill="none" aria-hidden className="dsh-glyph-completed">
      <circle cx="7" cy="7" r="6.4" stroke="currentColor" strokeWidth="1.2" />
      <path
        d="M10.9631 5.71411L7.70154 8.97571C7.48011 9.19714 7.27736 9.40099 7.09229 9.54993C6.89742 9.70669 6.66314 9.85279 6.3634 9.90027C6.2049 9.92534 6.04339 9.92534 5.88489 9.90027C5.58515 9.85279 5.35087 9.70669 5.15601 9.54993C4.97093 9.40099 4.76818 9.19714 4.54675 8.97571L3.03516 7.46411L3.96313 6.53613L5.47473 8.04773C5.7169 8.28989 5.86196 8.43389 5.97888 8.52795C6.08597 8.61409 6.10875 8.60701 6.08997 8.604C6.11259 8.60758 6.13571 8.60758 6.15833 8.604C6.13954 8.60701 6.16232 8.61409 6.26941 8.52795C6.38633 8.43389 6.53139 8.28989 6.77356 8.04773L10.0352 4.78613L10.9631 5.71411Z"
        fill="currentColor"
      />
    </svg>
  );
}

/** In-progress: an accent ring fading out along its own arc; CSS spins it. */
export function TodoProgressGlyph() {
  const gradientId = useId();
  return (
    <svg width={14} height={14} viewBox="0 0 14 14" fill="none" aria-hidden className="dsh-glyph-progress">
      <defs>
        <linearGradient id={gradientId} x1="2.5" y1="12" x2="10.5" y2="3.5" gradientUnits="userSpaceOnUse">
          <stop stopColor="currentColor" />
          <stop offset="1" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
      </defs>
      <circle cx="7" cy="7" r="6.4" stroke={`url(#${gradientId})`} strokeWidth="1.2" />
    </svg>
  );
}

/** Pending: the dashed unstarted ring. */
export function TodoPendingGlyph() {
  return (
    <svg width={14} height={14} viewBox="0 0 14 14" fill="none" aria-hidden className="dsh-glyph-pending">
      <circle cx="7" cy="7" r="6.4" stroke="currentColor" strokeWidth="1.2" strokeDasharray="2.4 2.4" />
    </svg>
  );
}

export type TodoRow = { content: string; status: string; priority?: string };

function StatusGlyph({ status }: { status: string }) {
  if (status === "completed") return <TodoCompletedGlyph />;
  if (status === "in_progress") return <TodoProgressGlyph />;
  return <TodoPendingGlyph />;
}

/** "·"-joined per-status counts; a zero segment is dropped as noise. */
function progressLabel(todos: readonly TodoRow[]): string {
  const done = todos.filter((item) => item.status === "completed").length;
  const active = todos.filter((item) => item.status === "in_progress").length;
  const pending = todos.length - done - active;
  return [
    ...(done > 0 ? [`${done} done`] : []),
    ...(active > 0 ? [`${active} in progress`] : []),
    ...(pending > 0 ? [`${pending} to do`] : []),
    // En spaces: HTML collapses runs of ASCII spaces, so widening the
    // separator's breathing room needs the literal wide character.
  ].join(" · ");
}

/**
 * The agent's current plan, docked above the composer.
 *
 * Opens itself the first time a plan arrives — the checklist appearing is the
 * event worth seeing — and afterwards remembers whatever the user chose.
 */
export function TodoChecklist({ todos, className }: { todos: readonly TodoRow[]; className?: string }) {
  const [collapsed, setCollapsed] = useState(false);
  if (todos.length === 0) return null;
  return (
    <section className={cn("dsh-todo", className)} aria-label="Task list">
      <div className="dsh-todo-body">
        <button
          type="button"
          className="dsh-todo-header"
          aria-expanded={!collapsed}
          onClick={() => setCollapsed((v) => !v)}
        >
          <span className="dsh-todo-lead" aria-hidden>
            <svg width={14} height={14} viewBox="0 0 14 14" fill="none">
              <path d="M1.75 3.5L3 4.75L5.25 2.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M1.75 10.5L3 11.75L5.25 9.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M7.25 3.75H12.25M7.25 10.75H12.25" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
            </svg>
          </span>
          <span className="dsh-todo-title">Tasks</span>
          <span className="dsh-todo-progress">{progressLabel(todos)}</span>
          <span className="dsh-todo-chevron" data-open={!collapsed} aria-hidden>
            <ChevronDown14 />
          </span>
        </button>
        {!collapsed && (
          <ul className="dsh-todo-list">
            {todos.map((item, index) => (
              <li key={`${item.content}-${index}`} className="dsh-todo-item" data-status={item.status}>
                <span className="dsh-todo-glyph" aria-hidden>
                  <StatusGlyph status={item.status} />
                </span>
                <span className="dsh-todo-content" title={item.content}>
                  {item.content}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
