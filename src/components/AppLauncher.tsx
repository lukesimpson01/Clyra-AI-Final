import {
  ArrowUpRight,
  Clapperboard,
  Code2,
  Drama,
  Globe2,
  Gamepad2,
  Grid2X2,
  Heart,
  Library,
  MessageCircle,
  MessagesSquare,
  Minus,
  SlidersHorizontal,
  ShieldCheck,
} from "lucide-react";
import { AnimatePresence, motion, useMotionValue, useReducedMotion, useSpring } from "motion/react";
import { type PointerEvent, useCallback, useEffect, useMemo, useRef, useState, type ComponentType } from "react";
import { cn } from "../lib/utils";
import { MIN_LAUNCHER_TOOLS, PINNED_LAUNCHER_TOOLS, useLauncherTools, type LauncherToolId } from "../lib/launcher-tools";

export type { LauncherToolId };

interface AppLauncherProps {
  onOpenTool: (tool: LauncherToolId) => void;
  onClose: () => void;
}

interface LauncherTool {
  id: LauncherToolId;
  label: string;
  shortLabel: string;
  detail: string;
  icon: ComponentType<{ className?: string }>;
  accent: string;
}

const ALL_TOOLS: LauncherTool[] = [
  { id: "vibe", label: "Vibe Coder", shortLabel: "Vibe Coder", detail: "Build and preview production applications", icon: Code2, accent: "#0f172a" },
  { id: "chat", label: "Chat", shortLabel: "Chat", detail: "Think, write and reason with Clyra", icon: MessageCircle, accent: "#1e293b" },
  { id: "clip", label: "AI Clipper", shortLabel: "Clip", detail: "Turn long videos into polished social clips", icon: Clapperboard, accent: "#334155" },
  { id: "forge", label: "Game Maker", shortLabel: "Games", detail: "Describe a game and build, play and publish it in the browser", icon: Gamepad2, accent: "#0f172a" },
  { id: "would-rather", label: "Would You Rather", shortLabel: "Would You Rather", detail: "Make narrated choice and poll videos", icon: Heart, accent: "#334155" },
  { id: "fake-text", label: "Text Story", shortLabel: "Text Story", detail: "Generate narrated iMessage-style stories", icon: MessagesSquare, accent: "#334155" },
  { id: "browser", label: "AI Browser", shortLabel: "Browser", detail: "Research and act across live websites", icon: Globe2, accent: "#1e293b" },
  { id: "roleplay", label: "AI Roleplay", shortLabel: "Roleplay", detail: "Chat with persistent, web-researched characters", icon: Drama, accent: "#334155" },
  { id: "tools", label: "Tool Library", shortLabel: "Tools", detail: "Discover, install and create native Clyra capabilities", icon: Library, accent: "#1e293b" },
  { id: "system-care", label: "Clyra System Care", shortLabel: "System Care", detail: "Understand device health, storage and performance", icon: ShieldCheck, accent: "#1e293b" },
];

const CENTER = 320;
const OUTER_RADIUS = 294;
const INNER_RADIUS = 124;
/** Snappy open: ~220ms, springy but not bouncy. */
const LAUNCHER_OPEN = { duration: 0.22, ease: [0.22, 1, 0.36, 1] as const };
const LAUNCHER_CLOSE = { duration: 0.18, ease: [0.4, 0, 1, 1] as const };
/** Cascade only the first visible arc (~top row of the wheel). */
const CASCADE_COUNT = 4;
const CASCADE_STEP = 0.04;
const barActions = ["marketplace", "manage", "open", "chat"] as const;
type BarAction = (typeof barActions)[number];

function point(radius: number, degrees: number) {
  const radians = (degrees - 90) * Math.PI / 180;
  return [CENTER + radius * Math.cos(radians), CENTER + radius * Math.sin(radians)];
}

function normalizeDegrees(degrees: number) {
  return ((degrees % 360) + 360) % 360;
}

function closestRotation(current: number, target: number) {
  const normalized = normalizeDegrees(current);
  let delta = target - normalized;
  if (delta > 180) delta -= 360;
  if (delta < -180) delta += 360;
  return current + delta;
}

function wedgePath(start: number, end: number) {
  const [outerStartX, outerStartY] = point(OUTER_RADIUS, start);
  const [outerEndX, outerEndY] = point(OUTER_RADIUS, end);
  const [innerEndX, innerEndY] = point(INNER_RADIUS, end);
  const [innerStartX, innerStartY] = point(INNER_RADIUS, start);
  const largeArc = end - start > 180 ? 1 : 0;
  return [
    `M ${outerStartX} ${outerStartY}`,
    `A ${OUTER_RADIUS} ${OUTER_RADIUS} 0 ${largeArc} 1 ${outerEndX} ${outerEndY}`,
    `L ${innerEndX} ${innerEndY}`,
    `A ${INNER_RADIUS} ${INNER_RADIUS} 0 ${largeArc} 0 ${innerStartX} ${innerStartY}`,
    "Z",
  ].join(" ");
}

function tileDelay(index: number) {
  if (index >= CASCADE_COUNT) return CASCADE_COUNT * CASCADE_STEP;
  return index * CASCADE_STEP;
}

function readLastTool(): LauncherToolId {
  const stored = localStorage.getItem("clyra-launcher-last-tool") as LauncherToolId | null;
  return ALL_TOOLS.some((tool) => tool.id === stored) ? stored! : "chat";
}

export function AppLauncher({ onOpenTool, onClose }: AppLauncherProps) {
  const reduceMotion = useReducedMotion();
  const { ids: wheelIds, remove: removeFromWheel, reset: resetWheel, canRemove } = useLauncherTools();
  // The wheel is whatever the user has kept on it, in their order. Geometry
  // follows the data rather than a fixed nine-slice assumption.
  const tools = useMemo(
    () => wheelIds.flatMap((id) => { const tool = ALL_TOOLS.find((item) => item.id === id); return tool ? [tool] : []; }),
    [wheelIds],
  );
  const SLICE_ANGLE = 360 / Math.max(1, tools.length);
  const [manageMode, setManageMode] = useState(false);
  const initialToolIndex = Math.max(0, tools.findIndex((tool) => tool.id === readLastTool()));
  const [activeIndex, setActiveIndex] = useState(initialToolIndex);
  const highlightTarget = useMotionValue(initialToolIndex * SLICE_ANGLE);
  const highlightRotation = useSpring(highlightTarget, { stiffness: 980, damping: 58, mass: 0.06 });
  const [hoveredBarAction, setHoveredBarAction] = useState<BarAction | null>(null);
  const activeIndexRef = useRef(initialToolIndex);
  const pointerFrameRef = useRef<number | null>(null);
  const pendingPointerRef = useRef<{ x: number; y: number; width: number } | null>(null);
  const activeTool = tools[Math.min(activeIndex, tools.length - 1)] ?? ALL_TOOLS[0];
  const quickTool =
    tools.find((tool) => tool.id === (activeTool.id === "chat" ? "browser" : "chat"))
    ?? tools.find((tool) => tool.id !== activeTool.id)
    ?? activeTool;
  const QuickToolIcon = quickTool.icon;
  const highlightPath = useMemo(() => wedgePath(-SLICE_ANGLE / 2, SLICE_ANGLE / 2), [SLICE_ANGLE]);
  const motionOff = reduceMotion ? { duration: 0 } : undefined;

  const selectTool = useCallback((index: number, rotation = index * SLICE_ANGLE) => {
    if (activeIndexRef.current !== index) {
      activeIndexRef.current = index;
      setActiveIndex(index);
    }
    highlightTarget.set(closestRotation(highlightTarget.get(), rotation));
  }, [highlightTarget]);

  const followPointer = (event: PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    pendingPointerRef.current = {
      x: event.clientX - rect.left - rect.width / 2,
      y: event.clientY - rect.top - rect.height / 2,
      width: rect.width,
    };
    if (pointerFrameRef.current != null) return;
    pointerFrameRef.current = requestAnimationFrame(() => {
      pointerFrameRef.current = null;
      const pointer = pendingPointerRef.current;
      if (!pointer || Math.hypot(pointer.x, pointer.y) < pointer.width * 0.18) return;
      const angle = normalizeDegrees(Math.atan2(pointer.y, pointer.x) * 180 / Math.PI + 90);
      const index = Math.floor(normalizeDegrees(angle + SLICE_ANGLE / 2) / SLICE_ANGLE) % tools.length;
      // The wedge rotates to the live pointer angle while the selected icon
      // changes only when crossing a wedge boundary. This stays responsive
      // without causing React work on every physical mouse event.
      selectTool(index, angle);
    });
  };

  const openTool = (tool: LauncherTool) => {
    localStorage.setItem("clyra-launcher-last-tool", tool.id);
    onOpenTool(tool.id);
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      if (pointerFrameRef.current != null) cancelAnimationFrame(pointerFrameRef.current);
    };
  }, [onClose]);

  return (
    <motion.div
      className="fixed inset-0 z-[260] overflow-hidden bg-slate-50/95 text-slate-950"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={motionOff ?? LAUNCHER_OPEN}
      role="dialog"
      aria-modal="true"
      aria-label="Clyra app launcher"
      onClick={onClose}
    >
      {/* Light grid — opacity only, not animated */}
      <div className="pointer-events-none absolute inset-0 opacity-[0.28] [background-image:linear-gradient(rgba(15,23,42,.035)_1px,transparent_1px),linear-gradient(90deg,rgba(15,23,42,.035)_1px,transparent_1px)] [background-size:40px_40px]" />

      <div
        className="relative z-10 mx-auto flex h-dvh max-w-[1080px] flex-col items-center px-4 pb-4 pt-6 sm:pt-7"
        onClick={(event) => event.stopPropagation()}
      >
        <motion.header
          initial={{ opacity: 0, y: -4, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -3, transition: motionOff ?? LAUNCHER_CLOSE }}
          transition={motionOff ?? LAUNCHER_OPEN}
          className="shrink-0 text-center"
        >
          <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">Clyra workspace</p>
          <h1
            className={
              reduceMotion
                ? "mt-1.5 text-[28px] font-semibold leading-none tracking-tight text-slate-950 sm:text-[36px]"
                : "clyra-launcher-title-wash mt-1.5 text-[28px] font-semibold leading-none tracking-tight sm:text-[36px]"
            }
          >
            Launch your tools
          </h1>
          <p className="mt-1.5 text-[12px] text-slate-500 sm:text-[13px]">
            Smart AI tools to build, create and solve, all in one place.
          </p>
        </motion.header>

        <div className="relative flex min-h-0 flex-1 items-center justify-center">
          <motion.div
            className="relative aspect-square w-[min(68vh,660px,92vw)]"
            onPointerMove={followPointer}
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.98, transition: motionOff ?? LAUNCHER_CLOSE }}
            transition={motionOff ?? LAUNCHER_OPEN}
          >
            <svg
              viewBox="0 0 640 640"
              className="absolute inset-0 h-full w-full overflow-visible"
              aria-hidden="true"
            >
              <circle cx="320" cy="320" r="302" fill="#ffffff" stroke="rgba(148,163,184,.28)" strokeWidth="1" />
              <circle cx="320" cy="320" r={OUTER_RADIUS} fill="rgba(248,250,252,.9)" />
              {tools.map((tool, index) => {
                const start = index * SLICE_ANGLE - SLICE_ANGLE / 2;
                const end = (index + 1) * SLICE_ANGLE - SLICE_ANGLE / 2;
                return (
                  <path
                    key={tool.id}
                    d={wedgePath(start, end)}
                    fill="rgba(255,255,255,.001)"
                    stroke="transparent"
                    strokeWidth="0"
                    onClick={() => { if (!manageMode) openTool(tool); }}
                    className={manageMode ? "cursor-default" : "cursor-pointer"}
                  />
                );
              })}
              <motion.g
                initial={false}
                style={{ transformBox: "view-box", transformOrigin: "center", pointerEvents: "none", rotate: highlightRotation }}
              >
                <path
                  d={highlightPath}
                  fill="rgba(226,232,240,.55)"
                  stroke="#cbd5e1"
                  strokeWidth="1"
                />
              </motion.g>
              <circle cx="320" cy="320" r="124" fill="#ffffff" stroke="rgba(148,163,184,.22)" strokeWidth="1" />
            </svg>

            {tools.map((tool, index) => {
              const Icon = tool.icon;
              const angle = index * SLICE_ANGLE;
              const [x, y] = point(212, angle);
              const selected = index === activeIndex;
              return (
                <motion.button
                  key={tool.id}
                  type="button"
                  onFocus={() => selectTool(index)}
                  onClick={() => { if (!manageMode) openTool(tool); }}
                  initial={{ opacity: 0, scale: 0.92, y: 6 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{
                    opacity: 0,
                    scale: 0.96,
                    transition: motionOff ?? { ...LAUNCHER_CLOSE, delay: Math.min(index, CASCADE_COUNT - 1) * 0.02 },
                  }}
                  transition={
                    motionOff ?? {
                      ...LAUNCHER_OPEN,
                      delay: 0.06 + tileDelay(index),
                    }
                  }
                  className="absolute z-10 flex w-[110px] -translate-x-1/2 -translate-y-1/2 flex-col items-center text-center outline-none"
                  style={{ left: `${x / 6.4}%`, top: `${y / 6.4}%` }}
                  aria-label={manageMode ? `${tool.label} — on the launcher` : `Open ${tool.label}`}
                >
                  {/* Removal lives on the tile it removes, so there is no
                      separate list to reconcile against the wheel you can see. */}
                  {manageMode ? (
                    <motion.button
                      type="button"
                      initial={{ opacity: 0, scale: 0.86 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.86 }}
                      transition={motionOff ?? { duration: 0.14, ease: [0.22, 1, 0.36, 1] }}
                      disabled={!canRemove(tool.id)}
                      onClick={(event) => { event.stopPropagation(); removeFromWheel(tool.id); }}
                      aria-label={
                        PINNED_LAUNCHER_TOOLS.includes(tool.id)
                          ? `${tool.label} stays on the launcher`
                          : `Remove ${tool.label} from the launcher`
                      }
                      title={
                        PINNED_LAUNCHER_TOOLS.includes(tool.id)
                          ? "Marketplace stays on the launcher"
                          : tools.length <= MIN_LAUNCHER_TOOLS
                            ? "Keep at least two tools on the launcher"
                            : `Remove ${tool.label}`
                      }
                      className={cn(
                        "absolute -top-1 right-2 z-20 grid h-[18px] w-[18px] place-items-center rounded-full border transition-colors duration-150",
                        canRemove(tool.id)
                          ? "border-slate-300 bg-white text-slate-500 hover:border-rose-300 hover:bg-rose-50 hover:text-rose-600"
                          : "cursor-not-allowed border-slate-200 bg-slate-50 text-slate-300",
                      )}
                    >
                      <Minus className="h-3 w-3" strokeWidth={2.4} />
                    </motion.button>
                  ) : null}
                  <span
                    className={
                      selected
                        ? "relative grid h-9 w-9 place-items-center text-slate-950 transition-[color,transform] duration-200 ease-out"
                        : "relative grid h-9 w-9 place-items-center text-slate-500 transition-[color,transform] duration-200 ease-out"
                    }
                  >
                    <Icon
                      className={
                        selected
                          ? "h-6 w-6 scale-[1.04] stroke-[2.05] text-slate-900 transition-transform duration-200 ease-out"
                          : "h-6 w-6 stroke-[1.65] transition-transform duration-200 ease-out"
                      }
                    />
                  </span>
                  <span
                    className={
                      selected
                        ? "mt-1 text-[11px] font-bold leading-tight text-slate-950 transition-colors duration-200 sm:text-[12px]"
                        : "mt-1 text-[11px] font-semibold leading-tight text-slate-700 transition-colors duration-200 sm:text-[12px]"
                    }
                  >
                    {tool.shortLabel}
                  </span>
                </motion.button>
              );
            })}

            <div className="absolute left-1/2 top-1/2 z-20 flex h-[24%] w-[24%] -translate-x-1/2 -translate-y-1/2 flex-col items-center justify-center">
              <motion.div
                initial={{ opacity: 0, scale: 0.96 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.96, transition: motionOff ?? LAUNCHER_CLOSE }}
                transition={motionOff ?? { ...LAUNCHER_OPEN, delay: 0.1 }}
                className="flex flex-col items-center gap-1"
              >
                <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">Clyra</span>
                {manageMode ? (
                  <>
                    <span className="max-w-[120px] text-center text-[9px] font-medium leading-[1.35] text-slate-400">
                      Remove tools from the wheel, or add more from the Marketplace.
                    </span>
                    <button
                      type="button"
                      onClick={resetWheel}
                      className="mt-0.5 text-[9px] font-semibold text-slate-500 underline-offset-2 transition-colors hover:text-slate-900 hover:underline"
                    >
                      Reset
                    </button>
                  </>
                ) : (
                  <span className="text-[9px] font-medium text-slate-400">{activeTool.shortLabel}</span>
                )}
              </motion.div>
            </div>
          </motion.div>
        </div>

        <motion.div
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 3, transition: motionOff ?? LAUNCHER_CLOSE }}
          transition={motionOff ?? { ...LAUNCHER_OPEN, delay: 0.08 }}
          className="mb-2 flex shrink-0 items-center justify-center px-2 py-0.5 text-[10px] font-medium text-slate-400"
        >
          Press{" "}
          <kbd className="mx-1 rounded border border-slate-200/90 bg-white px-1.5 py-0.5 text-[9px] text-slate-600">
            Ctrl/⌘K
          </kbd>{" "}
          to close
        </motion.div>

        <motion.nav
          initial={{ opacity: 0, y: 6, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 4, scale: 0.98, transition: motionOff ?? LAUNCHER_CLOSE }}
          transition={motionOff ?? { ...LAUNCHER_OPEN, delay: 0.1 }}
          onPointerMove={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            const index = Math.max(
              0,
              Math.min(barActions.length - 1, Math.floor(((event.clientX - rect.left) / rect.width) * barActions.length)),
            );
            setHoveredBarAction(barActions[index]);
          }}
          onPointerLeave={() => setHoveredBarAction(null)}
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setHoveredBarAction(null);
          }}
          // Column count follows the action list rather than a literal, so adding a
          // bar action can never silently wrap it onto a second row.
          style={{ gridTemplateColumns: `repeat(${barActions.length}, minmax(0, 1fr))` }}
          className="relative grid w-full max-w-[680px] shrink-0 items-center overflow-hidden rounded-full border border-slate-200/90 bg-white p-1 shadow-[0_8px_24px_rgba(15,23,42,.06)]"
        >
          <AnimatePresence>
            {hoveredBarAction ? (
              <motion.div
                className="clyra-workflow-tab__hover pointer-events-none absolute bottom-1 top-1 rounded-full"
                initial={{ opacity: 0, scale: 0.92 }}
                animate={{ opacity: 1, scale: 1, x: `calc(${barActions.indexOf(hoveredBarAction)} * 100%)` }}
                exit={{ opacity: 0, scale: 0.96, transition: { duration: 0.12 } }}
                transition={
                  reduceMotion
                    ? { duration: 0 }
                    : { type: "spring", stiffness: 780, damping: 44, mass: 0.1 }
                }
                style={{
                  left: 4,
                  top: 4,
                  bottom: 4,
                  height: "auto",
                  width: "calc((100% - 8px) / 4)",
                  zIndex: 0,
                  translate: "none",
                }}
              />
            ) : null}
          </AnimatePresence>
          <button
            type="button"
            onMouseEnter={() => setHoveredBarAction("marketplace")}
            onFocus={() => setHoveredBarAction("marketplace")}
            onClick={() => openTool(tools.find((tool) => tool.id === "tools")!)}
            className="relative z-10 flex h-10 items-center justify-center gap-2 rounded-full text-[10px] font-semibold text-slate-500 transition-[color,transform] duration-200 hover:text-slate-950 active:scale-[.98]"
          >
            <Library className="h-4 w-4" />
            Marketplace
          </button>
          <button
            type="button"
            onMouseEnter={() => setHoveredBarAction("manage")}
            onFocus={() => setHoveredBarAction("manage")}
            onClick={() => setManageMode((value) => !value)}
            aria-pressed={manageMode}
            className={cn(
              "relative z-10 flex h-10 items-center justify-center gap-2 rounded-full text-[10px] font-semibold transition-[color,transform] duration-200 active:scale-[.98]",
              manageMode ? "text-slate-950" : "text-slate-500 hover:text-slate-950",
            )}
          >
            <SlidersHorizontal className="h-4 w-4" />
            {manageMode ? "Done" : "Manage"}
          </button>
          <button
            type="button"
            onMouseEnter={() => setHoveredBarAction("open")}
            onFocus={() => setHoveredBarAction("open")}
            onClick={() => openTool(activeTool)}
            className="relative z-10 flex h-10 items-center justify-center gap-2 rounded-full text-[10px] font-semibold text-slate-600 transition-[color,transform] duration-200 hover:text-slate-950 active:scale-[.98]"
          >
            <Grid2X2 className="h-4 w-4" />
            Open {activeTool.shortLabel}
            <ArrowUpRight className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onMouseEnter={() => setHoveredBarAction("chat")}
            onFocus={() => setHoveredBarAction("chat")}
            onClick={() => openTool(quickTool)}
            className="relative z-10 flex h-10 items-center justify-center gap-2 rounded-full text-[10px] font-semibold text-slate-500 transition-[color,transform] duration-200 hover:text-slate-950 active:scale-[.98]"
          >
            <QuickToolIcon className="h-4 w-4" />
            Open {quickTool.shortLabel}
          </button>
        </motion.nav>
      </div>
    </motion.div>
  );
}
