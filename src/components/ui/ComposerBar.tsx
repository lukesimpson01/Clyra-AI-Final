import { useRef, type KeyboardEvent, type ReactNode } from "react";
import { ArrowUp, Mic, Plus, Square } from "lucide-react";
import { cn } from "../../lib/utils";

export type ComposerPermissionLevel = "full" | "ask" | "read-only";

const PERMISSION_LABEL: Record<ComposerPermissionLevel, string> = {
  full: "Full access",
  ask: "Ask each time",
  "read-only": "Read only",
};

const PERMISSION_DOT: Record<ComposerPermissionLevel, string> = {
  full: "bg-[var(--clyra-color-danger)]",
  ask: "bg-[var(--clyra-color-warning)]",
  "read-only": "bg-[var(--clyra-color-success)]",
};

export type ComposerBarProps = {
  value: string;
  onValueChange: (value: string) => void;
  onSubmit: () => void;
  onStop?: () => void;
  running?: boolean;
  placeholder?: string;
  onAttach?: () => void;
  onVoice?: () => void;
  permission?: ComposerPermissionLevel;
  onPermissionClick?: () => void;
  /** Model / reasoning-effort selector, rendered as a small chip left of send. */
  modelChip?: ReactNode;
  disabled?: boolean;
  autoFocus?: boolean;
  className?: string;
};

/**
 * The universal composer bar (Platform-Wide UI/UX Overhaul, Section 3.7).
 * Every surface where a user gives the AI an instruction should render
 * through this one component - rounded pill, leading attach, trailing mic,
 * a send button that morphs into stop while a task runs, and an optional
 * permission-level chip - so "asking the AI to do something" is the same
 * gesture everywhere in the product.
 *
 * This ships as the reusable foundation piece; existing composer instances
 * in Chat/Clyra Code/Browser keep their own tested implementations for now
 * and migrate onto this in the later platform-wide sweep, per the
 * directive's own phased rollout (Section 7) - swapping them out today
 * would be a functional-risk change, not a foundation one.
 */
export function ComposerBar({
  value,
  onValueChange,
  onSubmit,
  onStop,
  running = false,
  placeholder = "Do anything",
  onAttach,
  onVoice,
  permission,
  onPermissionClick,
  modelChip,
  disabled,
  autoFocus,
  className,
}: ComposerBarProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const canSend = value.trim().length > 0;

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      if (canSend && !running) onSubmit();
    }
  };

  return (
    <div
      className={cn(
        "glass-surface flex w-full flex-col gap-1.5 rounded-[var(--clyra-radius-lg)] px-3 py-2.5",
        className,
      )}
    >
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(event) => onValueChange(event.target.value)}
        onKeyDown={handleKeyDown}
        rows={1}
        placeholder={placeholder}
        disabled={disabled}
        autoFocus={autoFocus}
        className="max-h-40 min-h-[24px] w-full resize-none bg-transparent text-[15px] leading-[1.45] text-[var(--clyra-color-label)] outline-none placeholder:text-[var(--clyra-color-label-tertiary)]"
      />
      <div className="flex items-center gap-1.5">
        {onAttach ? (
          <button
            type="button"
            aria-label="Attach"
            onClick={onAttach}
            className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-[var(--clyra-color-label-tertiary)] transition-colors hover:bg-[var(--clyra-color-surface-muted)] hover:text-[var(--clyra-color-label)]"
          >
            <Plus className="h-4 w-4" strokeWidth={1.8} />
          </button>
        ) : null}
        {permission ? (
          <button
            type="button"
            onClick={onPermissionClick}
            className="flex h-7 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-[11.5px] font-medium text-[var(--clyra-color-label-secondary)] transition-colors hover:bg-[var(--clyra-color-surface-muted)]"
          >
            <span className={cn("h-[6px] w-[6px] rounded-full", PERMISSION_DOT[permission])} />
            {PERMISSION_LABEL[permission]}
          </button>
        ) : null}
        {modelChip}
        <span className="flex-1" />
        {onVoice ? (
          <button
            type="button"
            aria-label="Voice input"
            onClick={onVoice}
            className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-[var(--clyra-color-label-tertiary)] transition-colors hover:bg-[var(--clyra-color-surface-muted)] hover:text-[var(--clyra-color-label)]"
          >
            <Mic className="h-4 w-4" strokeWidth={1.8} />
          </button>
        ) : null}
        {running ? (
          <button
            type="button"
            onClick={onStop}
            aria-label="Stop"
            className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[var(--clyra-color-label)] text-[var(--clyra-color-background)] transition-transform duration-150 hover:opacity-90 active:scale-[var(--clyra-press-scale)]"
          >
            <Square className="h-[11px] w-[11px]" fill="currentColor" />
          </button>
        ) : (
          <button
            type="button"
            onClick={onSubmit}
            disabled={!canSend || disabled}
            aria-label="Send"
            className={cn(
              "grid h-8 w-8 shrink-0 place-items-center rounded-full transition-[background-color,transform] duration-150 active:scale-[var(--clyra-press-scale)]",
              canSend
                ? "bg-[var(--clyra-color-accent)] text-white hover:opacity-90"
                : "bg-[var(--clyra-color-surface-muted)] text-[var(--clyra-color-label-tertiary)]",
            )}
          >
            <ArrowUp className="h-4 w-4" strokeWidth={2} />
          </button>
        )}
      </div>
    </div>
  );
}
