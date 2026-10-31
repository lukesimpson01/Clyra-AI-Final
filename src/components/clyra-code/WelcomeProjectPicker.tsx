import { useCallback, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Check, ChevronDown, FolderOpen, Plus } from "lucide-react";
import { cn } from "../../lib/utils";
import { useClickAway } from "./useClickAway";
import type { VibeProject } from "./api";

/** Compact relative time for project rows ("3h ago"). */
export function formatRecentTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const minutes = Math.max(0, Math.floor((Date.now() - then) / 60_000));
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

type WelcomeProjectPickerProps = {
  /** Projects for the active mode, unhidden. */
  projects: VibeProject[];
  activeProjectId: string | null;
  onSelectProject: (projectId: string) => void;
  /** Clears the selection so the next prompt starts a brand-new project. */
  onNewProject: () => void;
  newProjectLabel?: string;
  /** When provided, the menu is controlled by the parent (for tandem open/close with the effort menu). */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
};

/**
 * The welcome screen's project switcher: one calm pill that names the
 * workspace the next task will land in, opening into a menu of recent
 * projects plus a "new project" action. Selecting anything keeps the user on
 * the welcome screen — the dropdown decides where the task goes, the composer
 * decides what it is.
 */
export function WelcomeProjectPicker({
  projects,
  activeProjectId,
  onSelectProject,
  onNewProject,
  newProjectLabel = "New project",
  open: controlledOpen,
  onOpenChange,
}: WelcomeProjectPickerProps) {
  const reduceMotion = useReducedMotion();
  const controlled = controlledOpen !== undefined;
  const [openInternal, setOpenInternal] = useState(false);
  const open = controlled ? (controlledOpen ?? false) : openInternal;
  const setOpen = useCallback((next: boolean) => {
    if (!controlled) setOpenInternal(next);
    onOpenChange?.(next);
  }, [controlled, onOpenChange]);
  const rootRef = useRef<HTMLDivElement | null>(null);
  useClickAway(rootRef, open, () => setOpen(false));

  const active = projects.find((project) => project.id === activeProjectId) ?? null;
  const ordered = useMemo(
    () => [...projects].sort((a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt)),
    [projects],
  );
  const activeName = active ? active.displayName || active.name || active.id : "";

  const menuMotion = reduceMotion
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 }, transition: { duration: 0 } }
    : {
        initial: { opacity: 0, y: -6, scale: 0.98 },
        animate: { opacity: 1, y: 0, scale: 1 },
        exit: { opacity: 0, y: -4, scale: 0.98 },
        transition: { duration: 0.18, ease: [0.22, 1, 0.36, 1] as const },
      };

  return (
    <div ref={rootRef} className="relative flex justify-center">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        title={active ? `Working in ${activeName}` : newProjectLabel}
        onClick={() => setOpen(!open)}
        className={cn(
          "flex h-[34px] max-w-[340px] items-center gap-2 rounded-full border-0 bg-transparent pl-3 pr-2 text-[12.5px] font-medium text-[var(--text-primary)] transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3977F6]/30",
          "hover:bg-[#F1F2F4]",
          open && "bg-[#F1F2F4]",
        )}
      >
        {active ? (
          <FolderOpen className="h-[15px] w-[15px] shrink-0 text-[var(--accent-blue)]" strokeWidth={1.7} aria-hidden />
        ) : (
          <Plus className="h-[14px] w-[14px] shrink-0 text-[var(--text-tertiary)]" strokeWidth={1.9} aria-hidden />
        )}
        <span className="min-w-0 flex-1 truncate">
          {active ? <><span className="text-[var(--text-tertiary)]">Working in </span>{activeName}</> : newProjectLabel}
        </span>
        <ChevronDown
          className={cn("h-3.5 w-3.5 shrink-0 text-[var(--text-tertiary)] transition-transform duration-200", open && "rotate-180")}
          strokeWidth={2}
          aria-hidden
        />
      </button>

      <AnimatePresence>
        {open ? (
          <div className="absolute left-1/2 top-[calc(100%+8px)] z-50 -translate-x-1/2">
            <motion.div
              key="menu"
              role="menu"
              aria-label={newProjectLabel}
              style={{ transformOrigin: "top center" }}
              {...menuMotion}
              className="cc-scroll flex max-h-[324px] w-[288px] flex-col overflow-y-auto rounded-[14px] border border-[var(--border-subtle)] bg-[var(--composer-surface)] p-1.5 shadow-[0_2px_8px_rgba(15,23,42,0.06),0_18px_44px_rgba(15,23,42,0.16)]"
            >
              <button
                type="button"
                role="menuitem"
                onClick={() => { setOpen(false); onNewProject(); }}
                className="flex w-full items-center gap-2.5 rounded-[9px] px-2 py-[7px] text-left outline-none transition-colors hover:bg-[var(--surface-hover)] focus-visible:bg-[var(--surface-hover)]"
              >
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[6px]">
                  <Plus className="h-3.5 w-3.5 text-[var(--accent-blue)]" strokeWidth={1.9} aria-hidden />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium leading-[18px] text-[var(--text-primary)]">{newProjectLabel}</span>
                  <span className="block truncate text-[11px] leading-[15px] text-[var(--text-tertiary)]">Start fresh in a blank workspace</span>
                </span>
                {!active ? <Check className="h-3.5 w-3.5 shrink-0 text-[var(--accent-blue)]" strokeWidth={2.2} aria-hidden /> : null}
              </button>

              {ordered.length ? (
                <>
                  <p className="px-2 pb-1 pt-2.5 text-[10.5px] font-medium uppercase tracking-[0.06em] text-[var(--text-tertiary)]">Recent</p>
                  {ordered.map((project) => {
                    const name = project.displayName || project.name || project.id;
                    const selected = project.id === activeProjectId;
                    return (
                      <button
                        key={project.id}
                        type="button"
                        role="menuitemradio"
                        aria-checked={selected}
                        title={name}
                        onClick={() => { setOpen(false); onSelectProject(project.id); }}
                        className="flex w-full items-center gap-2.5 rounded-[9px] px-2 py-[7px] text-left outline-none transition-colors hover:bg-[var(--surface-hover)] focus-visible:bg-[var(--surface-hover)]"
                      >
                        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[6px]">
                          <FolderOpen className={cn("h-3.5 w-3.5", selected ? "text-[var(--accent-blue)]" : "text-[var(--text-tertiary)]")} strokeWidth={1.7} aria-hidden />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13px] font-medium leading-[18px] text-[var(--text-primary)]">{name}</span>
                          <span className="block text-[11px] leading-[15px] text-[var(--text-tertiary)]">{formatRecentTime(project.updatedAt)}</span>
                        </span>
                        {selected ? <Check className="h-3.5 w-3.5 shrink-0 text-[var(--accent-blue)]" strokeWidth={2.2} aria-hidden /> : null}
                      </button>
                    );
                  })}
                </>
              ) : (
                <p className="px-2 pb-1 pt-2 text-[11.5px] leading-[1.45] text-[var(--text-tertiary)]">Your projects will appear here.</p>
              )}
            </motion.div>
          </div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
