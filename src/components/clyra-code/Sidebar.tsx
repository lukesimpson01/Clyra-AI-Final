import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  AlertCircle,
  ChevronDown,
  ChevronRight,
  FilePlus2,
  Folder,
  FolderOpen,
  FolderPlus,
  MoreHorizontal,
  Pencil,
  Pin,
  PanelLeftClose,
  Plus,
  Search,
  Settings2,
  Trash2,
  X,
  type LucideIcon,
} from "lucide-react";
import { cn } from "../../lib/utils";
import type { VibeProject } from "./api";

export type ChatThread = {
  id: string;
  title: string;
  time?: { created?: number; updated?: number };
};

export const SIDEBAR_DEFAULT_WIDTH = 280;
export const SIDEBAR_MIN_WIDTH = 238;
export const SIDEBAR_MAX_WIDTH = 344;
export type SidebarSort = "recent" | "name";

export function clampSidebarWidth(width: number) {
  return Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, Math.round(width)));
}

export function ClyraMark({ compact = false, size = 18 }: { compact?: boolean; size?: number }) {
  return (
    <span className={cn("flex shrink-0 items-center justify-center rounded-full bg-[#3977F6]", compact && "h-6 w-6")} style={compact ? undefined : { width: size, height: size }} aria-hidden>
      <svg width={Math.round(size * 0.62)} height={Math.round(size * 0.62)} viewBox="0 0 20 20" fill="none">
        <rect x="2.75" y="3.5" width="14.5" height="12.5" rx="2.2" stroke="white" strokeWidth="1.45" />
        <path d="m6.2 7.15 2.55 2.35-2.55 2.35M10.9 12.25h2.85" stroke="white" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}

type MenuTarget = { kind: "project"; projectId: string } | { kind: "chat"; projectId: string; chatId: string };
type MenuState = (MenuTarget & { x: number; y: number }) | null;

type SidebarProps = {
  projects: VibeProject[];
  threadsByProject: Record<string, ChatThread[]>;
  activeProjectId: string | null;
  activeSessionId: string | null;
  /** The thread whose agent is working right now. Only the active run is known to the client. */
  runningSessionId?: string | null;
  /** The thread whose last run failed. Shown with a restrained error glyph, never a red badge. */
  failedSessionId?: string | null;
  /** The thread waiting for the user to answer a question. */
  waitingSessionId?: string | null;
  onSelectProject: (id: string) => void;
  onSelectChat: (projectId: string, chatId: string) => void;
  onNewProject: () => void;
  /** "New project" in Code, "New design" in Design. */
  newProjectLabel?: string;
  /** What the list holds: "Projects" in Code, "Designs" in Design. */
  noun?: "Projects" | "Designs";
  onNewChat: (projectId: string) => void;
  onOpenExisting?: () => void;
  onRenameChat: (projectId: string, chatId: string, title: string) => void;
  onDeleteChat: (projectId: string, chatId: string) => void;
  onRemoveProject: (projectId: string) => void;
  onOpenProjectFolder: (projectId: string) => void;
  onRenameProject?: (projectId: string, name: string) => void;
  onSetProjectPinned?: (projectId: string, pinned: boolean) => void;
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
  /** Expanded width in px. The rail uses it directly; the drawer ignores it and uses its own width. */
  width?: number;
  onResizeWidth?: (width: number) => void;
  /** `drawer` is the off-canvas navigation used below 720px. */
  variant?: "rail" | "drawer";
  /** macOS hidden title bar: reserve space for the traffic lights and make the header draggable. */
  macInset?: boolean;
  sort?: SidebarSort;
  onSortChange?: (sort: SidebarSort) => void;
};

const SORT_LABEL: Record<SidebarSort, string> = { recent: "Recent", name: "Name" };

export function Sidebar({
  projects, threadsByProject, activeProjectId, activeSessionId, runningSessionId = null,
  failedSessionId = null, waitingSessionId = null,
  onSelectProject, onSelectChat, onNewProject, onNewChat, onOpenExisting, newProjectLabel = "New project", noun = "Projects",
  onRenameChat, onDeleteChat, onRemoveProject, onOpenProjectFolder, onRenameProject, onSetProjectPinned,
  collapsed = false, onToggleCollapsed, width = SIDEBAR_DEFAULT_WIDTH, onResizeWidth,
  variant = "rail", macInset = false, sort = "recent", onSortChange,
}: SidebarProps) {
  const reduceMotion = useReducedMotion();
  const drawer = variant === "drawer";
  const expandedWidth = drawer ? Math.min(320, typeof window !== "undefined" ? Math.round(window.innerWidth * 0.88) : 320) : clampSidebarWidth(width);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(activeProjectId ? [activeProjectId] : []));
  const [menu, setMenu] = useState<MenuState>(null);
  const [addMenu, setAddMenu] = useState<{ x: number; y: number } | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<{ kind: "project" | "chat"; projectId: string; chatId?: string; value: string } | null>(null);
  const editRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const asideRef = useRef<HTMLElement | null>(null);

  useEffect(() => { if (activeProjectId) setExpanded((old) => new Set([...old, activeProjectId])); }, [activeProjectId]);
  useEffect(() => { editRef.current?.focus(); editRef.current?.select(); }, [editing]);

  // Escape closes an open menu, and the drawer closes on Escape too.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (menu || addMenu) { setMenu(null); setAddMenu(null); return; }
      if (drawer && !collapsed) onToggleCollapsed?.();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menu, addMenu, drawer, collapsed, onToggleCollapsed]);

  // Focus is trapped inside the open drawer and returned to the opener on close.
  useEffect(() => {
    if (!drawer || collapsed) return;
    const aside = asideRef.current;
    const focusable = () => Array.from(aside?.querySelectorAll<HTMLElement>("button,[href],input,[tabindex]:not([tabindex='-1'])") ?? []).filter((el) => !el.hasAttribute("disabled"));
    focusable()[0]?.focus();
    const trap = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const items = focusable();
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", trap);
    return () => window.removeEventListener("keydown", trap);
  }, [drawer, collapsed]);

  const isRunningThread = (chatId: string) => runningSessionId === chatId;

  const projectRank = (project: VibeProject) => (sort === "name" ? (project.name || project.id).toLocaleLowerCase() : "");
  const ordered = useMemo(() => {
    const visible = projects.filter((project) => !project.archivedAt);
    return [...visible].sort((a, b) => {
      if (sort === "name") return projectRank(a).localeCompare(projectRank(b));
      return +new Date(b.updatedAt) - +new Date(a.updatedAt);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projects, sort]);

  const needle = query.trim().toLocaleLowerCase();
  const matches = (project: VibeProject) => {
    if (!needle) return true;
    const threads = threadsByProject[project.id] ?? [];
    return (project.name || "").toLocaleLowerCase().includes(needle) || threads.some((thread) => thread.title.toLocaleLowerCase().includes(needle));
  };
  const pinned = ordered.filter((project) => project.pinned && matches(project));
  const unpinned = ordered.filter((project) => !project.pinned && matches(project));

  useEffect(() => {
    if (!needle) return;
    setExpanded(new Set([...pinned, ...unpinned].map((project) => project.id)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needle]);

  const highlight = (value: string) => {
    const term = query.trim();
    const start = term ? value.toLocaleLowerCase().indexOf(term.toLocaleLowerCase()) : -1;
    if (start < 0) return value;
    return <>{value.slice(0, start)}<span className="text-[#3977F6]">{value.slice(start, start + term.length)}</span>{value.slice(start + term.length)}</>;
  };

  const commitEdit = () => {
    if (!editing) return;
    const value = editing.value.trim();
    if (value) {
      if (editing.kind === "chat" && editing.chatId) onRenameChat(editing.projectId, editing.chatId, value);
      if (editing.kind === "project") onRenameProject?.(editing.projectId, value);
    }
    setEditing(null);
  };

  const toggleExpanded = (projectId: string) => {
    setExpanded((old) => {
      const next = new Set(old);
      if (next.has(projectId)) next.delete(projectId); else next.add(projectId);
      return next;
    });
  };

  const openMenu = (event: ReactMouseEvent, target: MenuTarget) => {
    event.stopPropagation();
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    setMenu({ ...target, x: Math.max(8, Math.min(rect.right - 4, window.innerWidth - 204)), y: rect.bottom + 5 });
  };

  // Arrow keys move through the visible rows, Right and Left expand and collapse a project,
  // and Enter opens the focused row. Basic navigation never calls the model.
  const onListKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const rows = Array.from(listRef.current?.querySelectorAll<HTMLElement>("[data-nav-row]") ?? []);
    const index = rows.indexOf(document.activeElement as HTMLElement);
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (!rows.length) return;
      event.preventDefault();
      const next = event.key === "ArrowDown" ? Math.min(rows.length - 1, index + 1) : Math.max(0, index - 1);
      rows[next]?.focus();
      return;
    }
    const row = document.activeElement as HTMLElement | null;
    const projectId = row?.dataset.projectRow;
    if (!projectId) return;
    if (event.key === "ArrowRight" && !expanded.has(projectId)) { event.preventDefault(); toggleExpanded(projectId); }
    if (event.key === "ArrowLeft" && expanded.has(projectId)) { event.preventDefault(); toggleExpanded(projectId); }
  };

  // `isolate` keeps the shared selection surface below each row's content. The
  // neutral fill is intentionally quiet: hierarchy comes from space and type.
  const rowBase = "group/row isolate relative flex w-full min-w-0 cursor-pointer select-none items-center gap-1 rounded-[10px] text-left outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-[#3977F6]/35";
  /** The shared id lets the active surface move between rows without a flash. */
  const selectionHighlight = (layoutId: string) => (
    <motion.span
      layoutId={reduceMotion ? undefined : layoutId}
      aria-hidden
      transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
      className="pointer-events-none absolute inset-0 -z-10 rounded-[10px] bg-[#E8E9E8]"
    />
  );

  const renderProject = (project: VibeProject) => {
    const projectThreads = threadsByProject[project.id] ?? [];
    const isExpanded = expanded.has(project.id) || Boolean(needle);
    const selected = project.id === activeProjectId;
    const running = project.id === activeProjectId && Boolean(runningSessionId);
    const displayName = project.displayName || project.name || project.id;
    return (
      <div key={project.id} className="group/project mb-px">
        <div
          role="button"
          tabIndex={0}
          data-nav-row
          data-project-row={project.id}
          aria-expanded={isExpanded}
          title={displayName}
          onClick={() => { toggleExpanded(project.id); onSelectProject(project.id); }}
          onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); onSelectProject(project.id); } }}
          onContextMenu={(event) => { event.preventDefault(); openMenu(event, { kind: "project", projectId: project.id }); }}
          className={cn(rowBase, "h-[40px] px-2", selected ? "text-[#222327]" : "text-[#45474C] hover:bg-black/[0.035]")}
        >
          {selected ? selectionHighlight("sidebar-project-selection") : null}
          <button
            type="button"
            tabIndex={-1}
            aria-label={isExpanded ? `Collapse ${displayName}` : `Expand ${displayName}`}
            onClick={(event) => { event.stopPropagation(); toggleExpanded(project.id); }}
            className="flex h-6 w-4 shrink-0 items-center justify-center rounded-[5px] text-[#A0A2A6] transition-colors duration-150 hover:text-[#5F6368]"
          >
            <ChevronRight className={cn("h-3 w-3 transition-transform duration-200 ease-[cubic-bezier(0.22,1,0.36,1)]", isExpanded && "rotate-90")} strokeWidth={1.8} />
          </button>
          <Folder className="h-[17px] w-[17px] shrink-0 text-[#55585D]" strokeWidth={1.65} aria-hidden />
          {editing?.kind === "project" && editing.projectId === project.id ? (
            <input
              ref={editRef}
              value={editing.value}
              onChange={(event) => setEditing({ ...editing, value: event.target.value })}
              onBlur={commitEdit}
              onKeyDown={(event) => { event.stopPropagation(); if (event.key === "Enter") commitEdit(); if (event.key === "Escape") setEditing(null); }}
              onClick={(event) => event.stopPropagation()}
              aria-label="Task name"
              className="min-w-0 flex-1 rounded-[4px] bg-white px-1 text-[12.5px] text-[#303136] outline-none ring-1 ring-[#3977F6]/35"
            />
          ) : (
            <motion.span
              key={displayName}
              initial={reduceMotion ? false : { opacity: 0, y: 2 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
              className={cn("min-w-0 flex-1 truncate text-[13px] tracking-[-0.008em]", selected ? "font-medium" : "font-normal")}
            >
              {highlight(displayName)}
            </motion.span>
          )}
          {running ? <span className="cc-running-dot" role="img" aria-label="Agent working" title="Agent working" /> : null}
          {project.pinned ? <Pin className="h-[11px] w-[11px] shrink-0 text-[#A0A2A6] group-hover/project:hidden" strokeWidth={1.7} aria-hidden /> : null}
          <button
            type="button"
            tabIndex={-1}
            aria-label={`New task in ${displayName}`}
            title="New task"
            onClick={(event) => { event.stopPropagation(); onNewChat(project.id); }}
            className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-[6px] text-[#76787D] opacity-0 transition-opacity duration-100 hover:bg-black/[0.05] focus-visible:opacity-100 group-hover/project:opacity-100"
          >
            <Plus className="h-3 w-3" strokeWidth={1.8} />
          </button>
          <button
            type="button"
            tabIndex={-1}
            aria-label={`Project menu for ${displayName}`}
            title="More"
            onClick={(event) => openMenu(event, { kind: "project", projectId: project.id })}
            className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-[6px] text-[#76787D] opacity-0 transition-opacity duration-100 hover:bg-black/[0.05] focus-visible:opacity-100 group-hover/project:opacity-100"
          >
            <MoreHorizontal className="h-3 w-3" strokeWidth={1.8} />
          </button>
        </div>
        <AnimatePresence initial={false}>
          {isExpanded ? (
            <motion.div
              key="threads"
              initial={reduceMotion ? false : { height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={reduceMotion ? { opacity: 0 } : { height: 0, opacity: 0 }}
              transition={reduceMotion ? { duration: 0 } : { duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
              className="overflow-hidden"
            >
              <div className="ml-[21px] border-l border-black/[0.06] py-1 pl-[8px]">
                {projectThreads.length ? projectThreads.map((thread, index) => {
                  const threadSelected = project.id === activeProjectId && thread.id === activeSessionId;
                  const chatEditing = editing?.kind === "chat" && editing.projectId === project.id && editing.chatId === thread.id;
                  const threadTitle = thread.title || "New task";
                  return (
                    <motion.div
                      key={thread.id}
                      initial={reduceMotion ? false : { opacity: 0, x: -4 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ duration: 0.22, delay: reduceMotion ? 0 : Math.min(index, 8) * 0.03, ease: [0.22, 1, 0.36, 1] }}
                      role="button"
                      tabIndex={0}
                      data-nav-row
                      title={threadTitle}
                      onClick={() => onSelectChat(project.id, thread.id)}
                      onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); onSelectChat(project.id, thread.id); } }}
                      onContextMenu={(event) => { event.preventDefault(); openMenu(event, { kind: "chat", projectId: project.id, chatId: thread.id }); }}
                      className={cn(rowBase, "h-[38px] pl-2.5 pr-1", threadSelected ? "text-[#222327]" : "text-[#5B5D62] hover:bg-black/[0.035]")}
                    >
                      {threadSelected ? selectionHighlight("sidebar-thread-selection") : null}
                      {chatEditing ? (
                        <input
                          ref={editRef}
                          value={editing.value}
                          onChange={(event) => setEditing({ ...editing, value: event.target.value })}
                          onBlur={commitEdit}
                          onKeyDown={(event) => { event.stopPropagation(); if (event.key === "Enter") commitEdit(); if (event.key === "Escape") setEditing(null); }}
                          onClick={(event) => event.stopPropagation()}
                          aria-label="Task name"
                          className="min-w-0 flex-1 rounded-[4px] bg-white px-1 text-[12px] text-[#303136] outline-none ring-1 ring-[#3977F6]/35"
                        />
                      ) : (
                        <span className={cn("min-w-0 flex-1 truncate text-[12.5px] tracking-[-0.006em]", threadSelected && "font-medium")}>{highlight(threadTitle)}</span>
                      )}
                      {/* One state per thread. Each state has a text label, so colour is never the only signal. */}
                      {failedSessionId === thread.id ? (
                        <AlertCircle className="h-[12px] w-[12px] shrink-0 text-[#B5651D]" strokeWidth={1.8} role="img" aria-label="Last run failed" />
                      ) : waitingSessionId === thread.id ? (
                        <span className="h-[5px] w-[5px] shrink-0 rounded-full bg-[#B8BABE]" role="img" aria-label="Waiting for your reply" title="Waiting for your reply" />
                      ) : isRunningThread(thread.id) ? (
                        <span className="cc-running-dot" role="img" aria-label="Working" title="Working" />
                      ) : null}
                      <button
                        type="button"
                        tabIndex={-1}
                        aria-label={`Task menu for ${threadTitle}`}
                        onClick={(event) => openMenu(event, { kind: "chat", projectId: project.id, chatId: thread.id })}
                        className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-[6px] text-[#76787D] opacity-0 transition-opacity duration-100 hover:bg-black/[0.05] focus-visible:opacity-100 group-hover/row:opacity-100"
                      >
                        <MoreHorizontal className="h-3 w-3" strokeWidth={1.8} />
                      </button>
                    </motion.div>
                  );
                }) : (
                  <button
                    type="button"
                    onClick={() => onNewChat(project.id)}
                    className="flex h-[34px] w-full items-center gap-1.5 rounded-[8px] px-2.5 text-left text-[11.5px] text-[#85878C] transition-colors duration-150 hover:bg-black/[0.04] hover:text-[#45474C]"
                  >
                    <Plus className="h-3 w-3" strokeWidth={1.8} aria-hidden />
                    Start a new task
                  </button>
                )}
              </div>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>
    );
  };

  // Search is local and instant: it matches project names and task titles already in memory.
  const renderSearchResults = () => {
    const projectHits = ordered.filter((project) => (project.name || project.id).toLocaleLowerCase().includes(needle));
    const threadHits = ordered.flatMap((project) =>
      (threadsByProject[project.id] ?? [])
        .filter((thread) => (thread.title || "").toLocaleLowerCase().includes(needle))
        .map((thread) => ({ project, thread })),
    );
    if (!projectHits.length && !threadHits.length) {
      return <div className="px-1.5 py-2 text-[11.5px] text-[#96989D]">No matching projects or tasks.</div>;
    }
    return (
      <div aria-label="Search results" className="flex flex-col gap-2">
        {projectHits.length ? (
          <section aria-label="Matching projects">
            <h2 className="px-1.5 pb-1 pt-1 text-[10.5px] font-medium tracking-[0.02em] text-[#9A9CA0]">Projects</h2>
            {projectHits.map((project) => (
              <button key={project.id} type="button" title={project.name} onClick={() => { onSelectProject(project.id); setSearchOpen(false); setQuery(""); }} className="flex h-[30px] w-full items-center gap-2 rounded-[7px] px-2 text-left text-[12.5px] text-[#45474C] transition-colors hover:bg-black/[0.03] focus-visible:ring-2 focus-visible:ring-[#3977F6]/35">
                <Folder className="h-[13px] w-[13px] shrink-0 text-[#8A8C91]" strokeWidth={1.6} aria-hidden />
                <span className="min-w-0 flex-1 truncate">{highlight(project.displayName || project.name || project.id)}</span>
              </button>
            ))}
          </section>
        ) : null}
        {threadHits.length ? (
          <section aria-label="Matching threads">
            <h2 className="px-1.5 pb-1 pt-1 text-[10.5px] font-medium tracking-[0.02em] text-[#9A9CA0]">Threads</h2>
            {threadHits.map(({ project, thread }) => (
              <button key={`${project.id}:${thread.id}`} type="button" title={`${thread.title} · ${project.displayName || project.name}`} onClick={() => { onSelectChat(project.id, thread.id); setSearchOpen(false); setQuery(""); }} className="flex min-h-[34px] w-full flex-col justify-center rounded-[7px] px-2 py-0.5 text-left transition-colors hover:bg-black/[0.03] focus-visible:ring-2 focus-visible:ring-[#3977F6]/35">
                <span className="min-w-0 truncate text-[12px] text-[#4B4D52]">{highlight(thread.title || "New task")}</span>
                <span className="min-w-0 truncate text-[10.5px] text-[#9A9CA0]">{project.displayName || project.name}</span>
              </button>
            ))}
          </section>
        ) : null}
      </div>
    );
  };

  const runningCount = runningSessionId ? 1 : 0;
  const hasAnyProject = ordered.length > 0;
  const menuProject = menu ? projects.find((project) => project.id === menu.projectId) : undefined;

  return (
    <motion.aside
      ref={asideRef}
      aria-label="Projects"
      aria-hidden={collapsed || undefined}
      initial={false}
      animate={{ width: collapsed ? 0 : expandedWidth, opacity: collapsed ? 0 : 1 }}
      transition={reduceMotion ? { duration: 0 } : { duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
      className={cn(
        "relative flex h-full min-w-0 shrink-0 flex-col overflow-hidden border-r border-black/[0.07] bg-[#FAFAF9] font-[-apple-system,BlinkMacSystemFont,Inter,Segoe_UI,sans-serif]",
        drawer && "fixed inset-y-0 left-0 z-50 border-r-black/[0.08] shadow-[0_18px_40px_rgba(15,23,42,0.14)]",
        collapsed && "pointer-events-none border-r-0",
      )}
    >
      {/* Spacious product header with only controls that perform real actions. */}
      <div
        className={cn("shrink-0 border-b border-black/[0.07] px-3 pb-2.5 pt-3", macInset && "pl-[78px]")}
        style={macInset ? ({ WebkitAppRegion: "drag" } as CSSProperties) : undefined}
      >
        <div className="flex h-[36px] items-center gap-1.5">
          {searchOpen ? (
            <div className="flex h-[34px] min-w-0 flex-1 items-center gap-1.5 rounded-[9px] bg-white px-2.5 shadow-[0_1px_2px_rgba(0,0,0,0.04)] ring-1 ring-black/[0.08]" style={{ WebkitAppRegion: "no-drag" } as CSSProperties}>
              <Search className="h-3.5 w-3.5 shrink-0 text-[#77797E]" strokeWidth={1.7} aria-hidden />
              <input
                autoFocus
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); setQuery(""); setSearchOpen(false); } }}
                placeholder="Search projects and tasks"
                aria-label="Search projects and tasks"
                className="min-w-0 flex-1 bg-transparent text-[12px] text-[#34363A] outline-none placeholder:text-[#A0A2A6]"
              />
              <button type="button" aria-label="Clear search" onClick={() => { setQuery(""); setSearchOpen(false); }} className="flex h-5 w-5 items-center justify-center rounded-[5px] text-[#96989D] hover:text-[#505258]">
                <X className="h-3 w-3" strokeWidth={1.8} />
              </button>
            </div>
          ) : (
            <>
              <span className="flex min-w-0 flex-1 items-center gap-1 truncate text-[18px] font-semibold tracking-[-0.035em] text-[#34363A]">Clyra <ChevronDown className="h-4 w-4 shrink-0 text-[#85878C]" strokeWidth={1.9} aria-hidden /></span>
              <div className="flex shrink-0 items-center gap-0.5" style={{ WebkitAppRegion: "no-drag" } as CSSProperties}>
                <button type="button" aria-label="Search" title="Search projects and tasks" onClick={() => setSearchOpen(true)} className="flex h-[32px] w-[32px] items-center justify-center rounded-[9px] text-[#686A6F] transition-colors duration-150 hover:bg-black/[0.045] hover:text-[#34363A] focus-visible:ring-2 focus-visible:ring-[#3977F6]/35">
                  <Search className="h-[18px] w-[18px]" strokeWidth={1.75} />
                </button>
                {onToggleCollapsed ? (
                  <button type="button" aria-label="Collapse sidebar" title="Collapse sidebar" onClick={onToggleCollapsed} className="flex h-[32px] w-[32px] items-center justify-center rounded-[9px] text-[#686A6F] transition-colors duration-150 hover:bg-black/[0.045] hover:text-[#34363A] focus-visible:ring-2 focus-visible:ring-[#3977F6]/35">
                    <PanelLeftClose className="h-[17px] w-[17px]" strokeWidth={1.75} />
                  </button>
                ) : null}
              </div>
            </>
          )}
        </div>
        {/* A calm, single-row action: the hierarchy comes from placement, not blue. */}
        <button
          type="button"
          onClick={() => (activeProjectId ? onNewChat(activeProjectId) : onNewProject())}
          aria-label={activeProjectId ? "New task" : newProjectLabel}
          className="group mt-2 flex h-[42px] w-full items-center gap-3 rounded-[10px] px-3 text-left text-[15px] font-medium tracking-[-0.012em] text-[#3E4045] transition-[background-color,transform] duration-150 hover:bg-[#F0F0EF] active:scale-[0.992] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3977F6]/35"
          style={{ WebkitAppRegion: "no-drag" } as CSSProperties}
        >
          <span className="flex h-[22px] w-[22px] shrink-0 items-center justify-center" aria-hidden>
            <FilePlus2 className="h-[21px] w-[21px]" strokeWidth={1.85} />
          </span>
          <span className="min-w-0 flex-1 truncate">{activeProjectId ? "New task" : newProjectLabel}</span>
          {activeProjectId ? null : <kbd className="rounded-[5px] bg-[#EEEEED] px-1.5 py-[1px] font-sans text-[10px] font-medium text-[#7A7C80]">⌘N</kbd>}
        </button>
      </div>

      {/* Scrolling body. The footer below stays anchored. */}
      <div ref={listRef} onKeyDown={onListKeyDown} onClick={() => { setMenu(null); setAddMenu(null); }} className="cc-scroll mt-3 min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {!needle && pinned.length ? (
          <section aria-label="Pinned projects" className="mb-3">
            <h2 className="px-2 pb-1.5 pt-2 text-[10.5px] font-medium uppercase tracking-[0.09em] text-[#9A9CA0]">Pinned</h2>
            {pinned.map(renderProject)}
          </section>
        ) : null}

        {needle ? renderSearchResults() : null}
        {!needle ? <section aria-label="Projects">
          <div className="flex h-[34px] items-center gap-1 px-2 pb-1 pt-2">
            <h2 className="min-w-0 flex-1 truncate text-[10.5px] font-medium uppercase tracking-[0.09em] text-[#9A9CA0]">{noun}</h2>
            {runningCount ? (
              <span className="flex items-center gap-1 rounded-full bg-[#3977F6]/[0.08] px-1.5 py-[1px] text-[10.5px] font-medium text-[#3977F6]" title={`${runningCount} agent${runningCount === 1 ? "" : "s"} working`}>
                <span className="cc-running-dot cc-running-dot--inline" aria-hidden /> {runningCount}
              </span>
            ) : null}
            {onSortChange ? (
              <button
                type="button"
                onClick={() => onSortChange(sort === "recent" ? "name" : "recent")}
                title={`Sort: ${SORT_LABEL[sort]}. Click to change.`}
                className="rounded-[5px] px-1.5 py-[2px] text-[10.5px] font-medium text-[#9A9CA0] transition-colors duration-150 hover:bg-black/[0.04] hover:text-[#5F6368]"
              >
                {SORT_LABEL[sort]}
              </button>
            ) : null}
            <button type="button" aria-label="Add project" aria-haspopup="menu" title="Add project" onClick={(event) => { event.stopPropagation(); const rect = event.currentTarget.getBoundingClientRect(); setAddMenu({ x: Math.max(8, Math.min(rect.right - 198, window.innerWidth - 204)), y: rect.bottom + 5 }); }} className="flex h-[22px] w-[22px] items-center justify-center rounded-[6px] text-[#76787D] transition-all duration-150 hover:bg-black/[0.05] hover:text-[#34363A] active:scale-95">
              <Plus className="h-3.5 w-3.5" strokeWidth={1.8} />
            </button>
          </div>

          {!hasAnyProject ? (
            <div className="px-1.5 py-3">
              <p className="text-[12px] font-medium text-[#45474C]">{noun === "Designs" ? "No designs yet" : "No projects yet"}</p>
              <p className="mt-0.5 text-[11.5px] leading-[1.45] text-[#96989D]">{noun === "Designs" ? "Start a design, and it will be listed here." : "Open a folder or create a project to start coding."}</p>
              <div className="mt-2 flex gap-1.5">
                {onOpenExisting ? (
                  <button type="button" onClick={onOpenExisting} className="h-[26px] rounded-[7px] border border-black/[0.07] bg-white px-2.5 text-[11.5px] text-[#45474C] hover:bg-[#FBFBFA]">Open project</button>
                ) : null}
                <button type="button" onClick={onNewProject} className="h-[26px] rounded-[7px] px-2.5 text-[11.5px] text-[#3977F6] hover:bg-[#3977F6]/[0.06]">New project</button>
              </div>
            </div>
          ) : null}
          {hasAnyProject && !pinned.length && !unpinned.length ? <div className="px-1.5 py-2 text-[11.5px] text-[#96989D]">No matching projects or tasks.</div> : null}
          {unpinned.map(renderProject)}
        </section> : null}

        {menu || addMenu ? (
          <div
            aria-hidden
            onClick={() => { setMenu(null); setAddMenu(null); }}
            className="fixed inset-0 z-[59]"
          />
        ) : null}
        {addMenu ? (
          <Menu x={addMenu.x} y={addMenu.y} items={[
            { label: newProjectLabel, icon: FolderPlus, action: () => { setAddMenu(null); onNewProject(); } },
            ...(onOpenExisting ? [{ label: "Open existing project", icon: FolderOpen, action: () => { setAddMenu(null); onOpenExisting(); } }] : []),
          ]} />
        ) : null}
        {menu?.kind === "project" && menuProject ? (
          <Menu x={menu.x} y={menu.y} items={[
            { label: "New task", icon: FilePlus2, action: () => { setMenu(null); onNewChat(menu.projectId); } },
            ...(onSetProjectPinned ? [{ label: menuProject.pinned ? "Unpin" : "Pin to top", icon: Pin, action: () => { setMenu(null); onSetProjectPinned(menu.projectId, !menuProject.pinned); } }] : []),
            ...(onRenameProject ? [{ label: "Rename", icon: Pencil, action: () => { setMenu(null); setEditing({ kind: "project", projectId: menu.projectId, value: menuProject.name || "" }); } }] : []),
            { label: "Open folder", icon: FolderOpen, action: () => { setMenu(null); onOpenProjectFolder(menu.projectId); } },
            { label: "Remove from sidebar", icon: Trash2, action: () => { setMenu(null); onRemoveProject(menu.projectId); }, destructive: true },
          ]} />
        ) : null}
        {menu?.kind === "chat" ? (
          <Menu x={menu.x} y={menu.y} items={[
            { label: "Rename", icon: Pencil, action: () => {
              const thread = (threadsByProject[menu.projectId] ?? []).find((item) => item.id === menu.chatId);
              setMenu(null);
              setEditing({ kind: "chat", projectId: menu.projectId, chatId: menu.chatId, value: thread?.title || "" });
            } },
            { label: "Delete", icon: Trash2, action: () => { setMenu(null); onDeleteChat(menu.projectId, menu.chatId); }, destructive: true },
          ]} />
        ) : null}
      </div>

      {/* Footer: one restrained row. Settings has a tooltip; the account is not a large card. */}
      <div className={cn("flex h-[42px] shrink-0 items-center border-t border-black/[0.05]", collapsed ? "justify-center px-1" : "gap-2 px-2.5")}>
        <span className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full bg-[#E8E8E7] text-[10px] font-semibold text-[#505258]" aria-hidden>L</span>
        {!collapsed ? (
          <>
            <span className="min-w-0 flex-1 truncate text-[12px] text-[#505258]">Luke</span>
            <button type="button" aria-label="Settings" title="Settings" className="flex h-[26px] w-[26px] items-center justify-center rounded-[7px] text-[#8A8C91] transition-colors hover:bg-black/[0.04] hover:text-[#34363A]">
              <Settings2 className="h-[14px] w-[14px]" strokeWidth={1.7} />
            </button>
          </>
        ) : null}
      </div>

      {/* Resize handle on the rail. Double-click returns to the default width. */}
      {!drawer && !collapsed && onResizeWidth ? (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize sidebar"
          aria-valuenow={clampSidebarWidth(width)}
          aria-valuemin={SIDEBAR_MIN_WIDTH}
          aria-valuemax={SIDEBAR_MAX_WIDTH}
          tabIndex={0}
          onDoubleClick={() => onResizeWidth(SIDEBAR_DEFAULT_WIDTH)}
          onPointerDown={(event: ReactPointerEvent<HTMLDivElement>) => {
            event.preventDefault();
            const startX = event.clientX;
            const startWidth = clampSidebarWidth(width);
            const move = (moveEvent: PointerEvent) => onResizeWidth(clampSidebarWidth(startWidth + moveEvent.clientX - startX));
            const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
            window.addEventListener("pointermove", move);
            window.addEventListener("pointerup", up);
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowLeft") onResizeWidth(clampSidebarWidth(width - 8));
            if (event.key === "ArrowRight") onResizeWidth(clampSidebarWidth(width + 8));
          }}
          className="absolute inset-y-0 right-0 z-10 w-[5px] cursor-col-resize hover:bg-[#3977F6]/[0.12] focus-visible:bg-[#3977F6]/[0.18]"
        />
      ) : null}
    </motion.aside>
  );
}

function Menu({ x, y, items }: { x: number; y: number; items: Array<{ label: string; icon: LucideIcon; action: () => void; destructive?: boolean }> }) {
  return (
    <div
      role="menu"
      style={{ left: x, top: y }}
      className="fixed z-[60] w-[196px] overflow-hidden rounded-[11px] border border-black/[0.09] bg-white p-1.5 shadow-[0_14px_32px_rgba(20,25,30,0.14)]"
      onClick={(event) => event.stopPropagation()}
    >
      {items.map((item) => {
        const Icon = item.icon;
        return <button
          key={item.label}
          type="button"
          role="menuitem"
          onClick={item.action}
          className={cn("flex h-8 w-full items-center gap-2 rounded-[7px] px-2.5 text-left text-[11.5px] font-medium outline-none transition-colors hover:bg-[#F2F3F2] focus-visible:bg-[#EDF4FF]", item.destructive ? "text-[#B64A4A] hover:bg-[#FCEEEE] focus-visible:bg-[#FCEEEE]" : "text-[#45484D]")}
        >
          <span className={cn("flex h-5 w-5 items-center justify-center rounded-[5px]", item.destructive ? "bg-[#F9E5E5]" : "bg-[#F0F1F1]")}><Icon className="h-3 w-3" strokeWidth={1.9} /></span>
          {item.label}
        </button>;
      })}
    </div>
  );
}
