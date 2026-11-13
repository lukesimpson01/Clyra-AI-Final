import type { ReactNode } from "react";
import { motion, useReducedMotion } from "motion/react";
import { Blocks, LibraryBig, PenTool, SquareTerminal } from "lucide-react";
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

/**
 * The app rail, as in Codex: a slim column of icons at the far left that moves
 * between the workspace's surfaces (Code, Design) and opens the Library. The
 * selected surface sits on a soft rounded tile; everything else is a bare icon
 * that only tints on hover.
 */
/** Width of the app rail, which the workspace subtracts when it sizes its panes. */
export const APP_RAIL_WIDTH = 52;

export function AppRail({ mode, onChange, onOpenLibrary, onOpenComponents }: { mode: WorkspaceMode; onChange: (mode: WorkspaceMode) => void; onOpenLibrary: () => void; onOpenComponents?: () => void }) {
  const item = (label: string, icon: ReactNode, selected: boolean, onClick: () => void) => (
    <button
      key={label}
      type="button"
      aria-label={label}
      title={label}
      aria-current={selected ? "page" : undefined}
      onClick={onClick}
      className={cn(
        "flex h-[34px] w-[34px] items-center justify-center rounded-[10px] transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3977F6]/40",
        selected ? "bg-black/[0.06] text-[#0D0D0D]" : "text-[#8F8F8F] hover:bg-black/[0.05] hover:text-[#0D0D0D]",
      )}
    >
      {icon}
    </button>
  );
  return (
    <nav aria-label="Workspace" className="cc-app-rail flex h-full w-[52px] shrink-0 flex-col items-center gap-1 border-r border-black/[0.05] bg-[#F9F9F9] pt-2.5">
      {item("Code", <SquareTerminal className="h-[18px] w-[18px]" strokeWidth={1.7} />, mode === "code", () => onChange("code"))}
      {item("Design", <PenTool className="h-[17px] w-[17px]" strokeWidth={1.7} />, mode === "design", () => onChange("design"))}
      <span className="my-1 h-px w-5 bg-black/[0.07]" aria-hidden />
      {onOpenComponents ? item("Components", <Blocks className="h-[17px] w-[17px]" strokeWidth={1.7} />, false, onOpenComponents) : null}
      {item("Library", <LibraryBig className="h-[17px] w-[17px]" strokeWidth={1.7} />, false, onOpenLibrary)}
    </nav>
  );
}
