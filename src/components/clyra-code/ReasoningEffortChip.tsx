import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Brain, Check } from "lucide-react";
import { cn } from "../../lib/utils";
import type { ReasoningEffort } from "./api";

const EFFORT_LABEL: Record<ReasoningEffort, string> = {
  off: "Off",
  low: "Low",
  high: "High",
  max: "Max",
};

const EFFORT_DESCRIPTION: Record<ReasoningEffort, string> = {
  off: "No extended thinking — fastest replies",
  low: "A little extended thinking",
  high: "More extended thinking before replying",
  max: "Maximum extended thinking for hard problems",
};

/**
 * Reasoning-effort selector chip for the composer bar. Built as its own
 * component (not inlined in Composer.tsx) so it can drop into the shared
 * ComposerBar's `modelChip` slot once that migration happens.
 */
export function ReasoningEffortChip({
  effort,
  levels,
  ready,
  onChange,
}: {
  effort: ReasoningEffort | null;
  levels: ReasoningEffort[];
  ready: boolean;
  onChange: (effort: ReasoningEffort) => void;
}) {
  const [open, setOpen] = useState(false);
  if (levels.length === 0) return null;
  const current = effort && levels.includes(effort) ? effort : levels[0];

  return (
    <div className="relative">
      <button
        type="button"
        aria-label="Reasoning effort"
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={!ready}
        title={ready ? undefined : "Reasoning effort will apply once the coding runtime finishes starting"}
        onClick={() => setOpen((value) => !value)}
        className={cn(
          "flex h-6 items-center gap-1 rounded-[7px] px-1.5 text-[10.5px] font-medium text-[color:var(--text-secondary)] transition-colors",
          ready ? "hover:bg-black/[0.045] hover:text-[color:var(--text-primary)]" : "opacity-50",
        )}
      >
        <Brain className="h-3 w-3" strokeWidth={1.7} />
        {EFFORT_LABEL[current]}
      </button>
      <AnimatePresence>
        {open ? (
          <motion.div
            role="listbox"
            initial={{ opacity: 0, y: 4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 3, scale: 0.98 }}
            transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
            className="absolute bottom-8 left-0 z-30 w-[210px] rounded-[10px] border border-black/[0.08] bg-white p-1 shadow-[0_10px_24px_rgba(15,23,42,0.11)]"
          >
            {levels.map((level) => (
              <button
                key={level}
                type="button"
                role="option"
                aria-selected={level === current}
                onClick={() => {
                  onChange(level);
                  setOpen(false);
                }}
                className="flex w-full items-start gap-2 rounded-[6px] px-2 py-1.5 text-left transition-colors hover:bg-black/[0.035]"
              >
                <span className="mt-[3px] flex h-3 w-3 shrink-0 items-center justify-center">
                  {level === current ? <Check className="h-3 w-3 text-[color:var(--accent-blue)]" strokeWidth={2} /> : null}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[11.5px] font-medium text-[color:var(--text-secondary)]">{EFFORT_LABEL[level]}</span>
                  <span className="block truncate text-[10px] text-[color:var(--text-tertiary)]">{EFFORT_DESCRIPTION[level]}</span>
                </span>
              </button>
            ))}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
