import { motion, useReducedMotion } from "motion/react";
import { cn } from "../../lib/utils";
import { AGENT_EASE } from "./motion";

export type WorkspaceMode = "code" | "design";

const MODES: Array<{ id: WorkspaceMode; label: string }> = [
  { id: "code", label: "Code" },
  { id: "design", label: "Design" },
];

/**
 * Switches the workspace between Code (projects that build software) and Design
 * (visual screens). The selected pill slides between the two, the same shared
 * highlight the sidebar uses for the selected project and task.
 */
export function ModeTabs({ mode, onChange }: { mode: WorkspaceMode; onChange: (mode: WorkspaceMode) => void }) {
  const reduced = useReducedMotion();
  return (
    <div role="tablist" aria-label="Workspace" className="relative flex h-[28px] shrink-0 items-center rounded-[9px] bg-black/[0.045] p-[2px]">
      {MODES.map((item) => {
        const selected = mode === item.id;
        return (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => onChange(item.id)}
            className={cn(
              "relative isolate h-full rounded-[7px] px-3 text-[12px] font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3977F6]/40",
              selected ? "text-[#1F2024]" : "text-[#7A7C81] hover:text-[#4B4D52]",
            )}
          >
            {selected ? (
              <motion.span
                layoutId={reduced ? undefined : "clyra-workspace-mode"}
                aria-hidden
                transition={{ duration: 0.28, ease: AGENT_EASE }}
                className="pointer-events-none absolute inset-0 -z-10 rounded-[7px] bg-white shadow-[0_1px_2px_rgba(15,23,42,0.08)]"
              />
            ) : null}
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
