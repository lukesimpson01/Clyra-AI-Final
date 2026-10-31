import {
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { X } from "lucide-react";
import { cn } from "../lib/utils";
import { BloubPauseContext } from "./bloub/BloubPauseContext";

/** @deprecated: retained temporarily for Electron's native BrowserView bridge. */
export type TaskViewPreview = { src: string; width: number; height: number; nativeLayer?: unknown };

export type TaskViewTab = {
  id: string;
  label: string;
  /** The real mounted Clyra application. Never a re-rendered thumbnail. */
  content: ReactNode;
};

type Rect = { left: number; top: number; width: number; height: number };
type Phase = "closed" | "opening" | "open" | "closing";
type ExitingTab = { tab: TaskViewTab; target: Rect; scale: number };
type Drag = { id: string; pointerId: number; startX: number; startY: number; origin: Rect; dx: number; dy: number; moved: boolean };

/*
 * Task View is one light surface that rearranges itself around what you do. Every window is the real, mounted app
 * at its full size; a single compositor transform places it (index.css, "Task View · light spatial overview"). The
 * zoom out, the reflow after a window closes, drag-to-reorder and the zoom back in all move that one property, so
 * windows travel from where they are to where they go instead of disappearing and reappearing.
 */

// Keep in step with the transform transitions in index.css (open 300 ms, close 280 ms, tab close 160 ms fade).
const OPEN_MS = 320;
const CLOSE_MS = 300;
const TAB_CLOSE_MS = 240;
// Switching apps outside Task View: the whole workspace slides as one surface.
// Outgoing travels to -direction×W, incoming from +direction×W, sharing one ease.
const SWITCH_MS = 500;
// A long, weightless macOS-style ease: a gentle ease-in, a steady flowing
// middle and a gradual ease-out, with no snap at either end. Both windows share
// the one curve so they stay in perfect lockstep.
const SWITCH_EASE = "cubic-bezier(0.22, 1, 0.36, 1)";
const GAP = 36;
const PAD_X = 48;
const PAD_Y = 52;
const PAD_TOP = 48;
const LABEL_H = 28;
const DRAG_THRESHOLD = 5;
const emptyRect: Rect = { left: 0, top: 0, width: 1, height: 1 };

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

/** Chooses the grid with the largest live-window scale, retaining its ratio. */
export function computeTaskViewCards(count: number, source: Rect, viewport: Rect): Rect[] {
  if (!count) return [];
  const availableW = Math.max(240, viewport.width - PAD_X * 2);
  const availableH = Math.max(180, viewport.height - PAD_TOP - PAD_Y);
  let best: { columns: number; scale: number } | null = null;
  for (let columns = 1; columns <= Math.min(count, 6); columns += 1) {
    const rows = Math.ceil(count / columns);
    const cellW = (availableW - GAP * (columns - 1)) / columns;
    const cellH = (availableH - GAP * (rows - 1)) / rows - LABEL_H;
    const scale = Math.min(cellW / source.width, cellH / source.height, 1);
    if (!best || scale > best.scale) best = { columns, scale };
  }
  const columns = best?.columns ?? 1;
  const rows = Math.ceil(count / columns);
  const scale = Math.max(0.08, best?.scale ?? 1);
  const width = source.width * scale;
  const height = source.height * scale;
  const cellW = (availableW - GAP * (columns - 1)) / columns;
  const usedH = rows * (height + LABEL_H) + GAP * (rows - 1);
  const top0 = viewport.top + PAD_TOP + Math.max(0, (availableH - usedH) / 2);
  return Array.from({ length: count }, (_, index) => {
    const row = Math.floor(index / columns);
    const col = index % columns;
    // A short last row is centred, the way Mission Control balances an uneven set of windows.
    const inRow = row === rows - 1 ? count - row * columns : columns;
    const rowW = inRow * cellW + GAP * (inRow - 1);
    const left0 = viewport.left + PAD_X + (availableW - rowW) / 2;
    return {
      left: left0 + col * (cellW + GAP) + (cellW - width) / 2,
      top: top0 + row * (height + LABEL_H + GAP),
      width,
      height,
    };
  });
}

const placed = (rect: Rect, scale: number) => `translate3d(${rect.left}px, ${rect.top}px, 0) scale(${scale})`;
/** A slightly smaller pose about the window's own centre: where a window fades in from and back out to. */
const recessed = (rect: Rect, scale: number) => {
  const shrink = 0.965;
  return `translate3d(${rect.left + (rect.width * (1 - shrink)) / 2}px, ${rect.top + (rect.height * (1 - shrink)) / 2}px, 0) scale(${scale * shrink})`;
};
const FULL = "translate3d(0px, 0px, 0) scale(1)";

export type TaskViewHandle = { closeToActive: () => void; toggle: () => void };

export const WorkspaceTaskView = memo(forwardRef<TaskViewHandle, {
  open: boolean;
  tabs: TaskViewTab[];
  activeId: string;
  /** Slide direction for a normal tab-bar switch: 1 = enter from right, -1 = enter from left, 0 = no slide. */
  switchDirection?: number;
  onSelect: (id: string) => void;
  onClose: () => void;
  onCloseTab: (id: string) => void;
  /** Fires when the user drags a window to a new slot. */
  onReorder?: (orderedIds: string[]) => void;
}>(function WorkspaceTaskView({ open, tabs, activeId, switchDirection = 0, onSelect, onClose, onCloseTab, onReorder }, ref) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [source, setSource] = useState<Rect>(emptyRect);
  // Mounts "closed" (the active app exactly as it was on screen), then flips to "opening" once that frame is
  // painted, so the zoom always starts from the real window rather than a blank or pre-placed frame.
  const [phase, setPhase] = useState<Phase>("closed");
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [selectingId, setSelectingId] = useState<string | null>(null);
  const [exitingTab, setExitingTab] = useState<ExitingTab | null>(null);
  const [liveOrder, setLiveOrder] = useState<string[] | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const completionRef = useRef<number | null>(null);
  const tabCloseTimerRef = useRef<number | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const suppressClickRef = useRef(false);
  const windowEls = useRef(new Map<string, HTMLDivElement>());
  const domOrderRef = useRef<string[]>([]);
  useEffect(() => { if (phase === "closed") setHoveredId(null); }, [phase]);
  const [leavingId, setLeavingId] = useState<string | null>(null);
  // The in-flight workspace slide: which window is outgoing, which way it
  // travels, and whether the incoming window has been placed at its off-screen
  // start (entering=false) or is now gliding toward 0 (entering=true).
  const [switchAnim, setSwitchAnim] = useState<{ from: string; direction: -1 | 1; entering: boolean } | null>(null);
  const switchDirectionRef = useRef(switchDirection);
  switchDirectionRef.current = switchDirection;
  const previousActiveRef = useRef(activeId);

  // Detect the switch during render (not in an effect) so the outgoing window is
  // committed as "leaving" in the SAME render that changes the active app. An
  // effect runs after paint, which would let the outgoing app flash to its
  // hidden recessed pose for a frame before the slide starts.
  if (previousActiveRef.current !== activeId) {
    const outgoing = previousActiveRef.current;
    previousActiveRef.current = activeId;
    // A selection from Task View has already zoomed the new app to full size; only a normal switch slides.
    if (outgoing !== activeId && phaseRef.current === "closed") {
      const direction = switchDirectionRef.current;
      if (direction === 0) {
        // No slide (Task-View selection): keep the outgoing window a beat so the
        // hand-off is never a blank frame, then release it.
        setLeavingId(outgoing);
      } else {
        setSwitchAnim({ from: outgoing, direction: direction > 0 ? 1 : -1, entering: false });
      }
    }
  }

  // Start the slide on this very frame. The incoming window is already committed
  // off-screen with its transition disabled; force a synchronous layout flush so
  // the browser records that pose, then flip both windows to their targets in the
  // same commit. The browser sees the two poses in separate style passes and runs
  // the transition immediately — no rAF wait, no dead frame before motion.
  useLayoutEffect(() => {
    if (!switchAnim || switchAnim.entering) return;
    if (hostRef.current) void hostRef.current.getBoundingClientRect();
    setSwitchAnim((current) => (current && !current.entering ? { ...current, entering: true } : current));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [switchAnim]);

  // Release the switch once the slide has finished so the outgoing window can
  // drop back to its recessed pose and the windows' CSS transitions return to
  // `none` (the latter keeps the compositor layer count and per-frame cost down
  // between switches, instead of leaving the slide transition hot forever).
  useEffect(() => {
    if (!switchAnim?.entering) return;
    const timer = window.setTimeout(() => setSwitchAnim(null), SWITCH_MS + 60);
    return () => window.clearTimeout(timer);
  }, [switchAnim?.entering]);

  useEffect(() => {
    if (!leavingId) return;
    const timer = window.setTimeout(() => setLeavingId(null), 80);
    return () => window.clearTimeout(timer);
  }, [leavingId]);

  const measure = useCallback(() => {
    const rect = hostRef.current?.getBoundingClientRect();
    if (!rect || rect.width < 2 || rect.height < 2) return;
    setSource((current) => (current.width === rect.width && current.height === rect.height ? current : { left: 0, top: 0, width: rect.width, height: rect.height }));
  }, []);
  useLayoutEffect(() => {
    measure();
    const observer = new ResizeObserver(measure);
    if (hostRef.current) observer.observe(hostRef.current);
    return () => observer.disconnect();
  }, [measure]);

  // While dragging, neighbours reflow to the in-progress order before the drop.
  const orderedTabs = useMemo(() => {
    if (!liveOrder) return tabs;
    const byId = new Map(tabs.map((tab) => [tab.id, tab]));
    const next = liveOrder.map((id) => byId.get(id)).filter((tab): tab is TaskViewTab => Boolean(tab));
    return next.length === tabs.length ? next : tabs;
  }, [liveOrder, tabs]);
  const cards = useMemo(() => computeTaskViewCards(orderedTabs.length, source, source), [orderedTabs.length, source]);
  const scale = cards[0] ? cards[0].width / Math.max(1, source.width) : 1;

  const settle = useCallback((next: Phase, duration: number, complete?: () => void) => {
    if (completionRef.current != null) window.clearTimeout(completionRef.current);
    setPhase(next);
    completionRef.current = window.setTimeout(() => {
      completionRef.current = null;
      complete?.();
    }, duration);
  }, []);

  useEffect(() => {
    if (open) {
      let raf2 = 0;
      const raf1 = requestAnimationFrame(() => {
        raf2 = requestAnimationFrame(() => settle("opening", OPEN_MS, () => setPhase("open")));
      });
      return () => { cancelAnimationFrame(raf1); if (raf2) cancelAnimationFrame(raf2); };
    }
    if (phaseRef.current !== "closed") settle("closing", CLOSE_MS, () => setPhase("closed"));
    return undefined;
  }, [open, settle]);
  useEffect(() => () => {
    if (completionRef.current != null) window.clearTimeout(completionRef.current);
    if (tabCloseTimerRef.current != null) window.clearTimeout(tabCloseTimerRef.current);
  }, []);

  const closeToActive = useCallback(() => {
    if (phaseRef.current === "closed" || phaseRef.current === "closing") return;
    if (!tabs.length) return;
    settle("closing", CLOSE_MS, () => { setPhase("closed"); onClose(); });
  }, [onClose, settle, tabs.length]);

  const select = useCallback((id: string) => {
    if (phaseRef.current === "closing" || selectingId) return;
    setSelectingId(id);
    settle("closing", CLOSE_MS, () => { setPhase("closed"); setSelectingId(null); onSelect(id); });
  }, [onSelect, selectingId, settle]);

  const toggle = useCallback(() => {
    // Interruptible: pressing again mid-close sends the windows straight back out from wherever they are.
    if (phaseRef.current === "closing") {
      setSelectingId(null);
      settle("opening", OPEN_MS, () => setPhase("open"));
      return;
    }
    closeToActive();
  }, [closeToActive, settle]);
  useImperativeHandle(ref, () => ({ closeToActive, toggle }), [closeToActive, toggle]);

  const closeTab = useCallback((id: string) => {
    if (phaseRef.current !== "open" || exitingTab) return;
    const index = orderedTabs.findIndex((tab) => tab.id === id);
    const tab = orderedTabs[index];
    const target = cards[index];
    if (!tab || !target) return;
    // The window fades where it stands while its neighbours glide into the space it leaves.
    setExitingTab({ tab, target, scale });
    onCloseTab(id);
    if (tabCloseTimerRef.current != null) window.clearTimeout(tabCloseTimerRef.current);
    tabCloseTimerRef.current = window.setTimeout(() => {
      tabCloseTimerRef.current = null;
      setExitingTab(null);
    }, TAB_CLOSE_MS);
  }, [cards, exitingTab, onCloseTab, orderedTabs, scale]);

  // Keyboard: arrows walk the grid, Enter opens, Escape returns to the active app.
  useEffect(() => {
    if (phase === "closed") return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); closeToActive(); return; }
      if (phaseRef.current !== "open" || !orderedTabs.length) return;
      const columns = Math.max(1, cards.filter((card) => Math.abs(card.top - (cards[0]?.top ?? 0)) < 1).length);
      const current = Math.max(0, orderedTabs.findIndex((tab) => tab.id === (hoveredId ?? activeId)));
      const moves: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -columns, ArrowDown: columns };
      if (event.key in moves) {
        event.preventDefault();
        setHoveredId(orderedTabs[clamp(current + moves[event.key], 0, orderedTabs.length - 1)]?.id ?? null);
      } else if (event.key === "Enter") {
        const tab = orderedTabs[current];
        if (tab) { event.preventDefault(); select(tab.id); }
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [activeId, cards, closeToActive, hoveredId, orderedTabs, phase, select]);

  // Drag to reorder. The dragged window follows the pointer 1:1 (its transform is written straight to the element,
  // no transition, no re-render per move); React only re-renders when the slot under it changes, which slides the
  // neighbours aside. On release it eases into its slot.
  const cardsRef = useRef(cards);
  cardsRef.current = cards;
  const scaleRef = useRef(scale);
  scaleRef.current = scale;
  const onDragMove = useCallback((event: PointerEvent) => {
    const drag = dragRef.current;
    if (!drag || event.pointerId !== drag.pointerId) return;
    drag.dx = event.clientX - drag.startX;
    drag.dy = event.clientY - drag.startY;
    if (!drag.moved) {
      if (Math.hypot(drag.dx, drag.dy) < DRAG_THRESHOLD) return;
      drag.moved = true;
      setDraggingId(drag.id);
    }
    const el = windowEls.current.get(drag.id);
    el?.style.setProperty("--tv-t", placed({ ...drag.origin, left: drag.origin.left + drag.dx, top: drag.origin.top + drag.dy }, scaleRef.current));
    const cx = drag.origin.left + drag.dx + drag.origin.width / 2;
    const cy = drag.origin.top + drag.dy + drag.origin.height / 2;
    let nearest = 0;
    let best = Infinity;
    cardsRef.current.forEach((card, index) => {
      const distance = Math.hypot(card.left + card.width / 2 - cx, card.top + card.height / 2 - cy);
      if (distance < best) { best = distance; nearest = index; }
    });
    setLiveOrder((current) => {
      const base = current ?? tabs.map((tab) => tab.id);
      const from = base.indexOf(drag.id);
      if (from === -1 || from === nearest) return current ?? base;
      const next = base.slice();
      next.splice(from, 1);
      next.splice(nearest, 0, drag.id);
      return next;
    });
  }, [tabs]);
  const liveOrderRef = useRef(liveOrder);
  liveOrderRef.current = liveOrder;
  const onDragEnd = useCallback(() => {
    const drag = dragRef.current;
    dragRef.current = null;
    window.removeEventListener("pointermove", onDragMove);
    window.removeEventListener("pointerup", onDragEnd);
    window.removeEventListener("pointercancel", onDragEnd);
    if (!drag?.moved) return;
    suppressClickRef.current = true;
    window.setTimeout(() => { suppressClickRef.current = false; }, 0);
    const order = liveOrderRef.current;
    setDraggingId(null);
    setLiveOrder(null);
    if (order && onReorder && order.join("|") !== tabs.map((tab) => tab.id).join("|")) onReorder(order);
  }, [onDragMove, onReorder, tabs]);
  useEffect(() => () => {
    window.removeEventListener("pointermove", onDragMove);
    window.removeEventListener("pointerup", onDragEnd);
    window.removeEventListener("pointercancel", onDragEnd);
  }, [onDragEnd, onDragMove]);
  const startDrag = useCallback((tab: TaskViewTab, index: number, event: ReactPointerEvent<HTMLButtonElement>) => {
    if (phaseRef.current !== "open" || selectingId || exitingTab || event.button !== 0) return;
    const origin = cards[index];
    if (!origin) return;
    dragRef.current = { id: tab.id, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, origin, dx: 0, dy: 0, moved: false };
    window.addEventListener("pointermove", onDragMove);
    window.addEventListener("pointerup", onDragEnd);
    window.addEventListener("pointercancel", onDragEnd);
  }, [cards, exitingTab, onDragEnd, onDragMove, selectingId]);

  const overview = phase === "opening" || phase === "open";
  const frontId = selectingId ?? activeId;
  const visibleTabs = exitingTab ? [...orderedTabs, exitingTab.tab] : orderedTabs;
  // Windows stay in the DOM in the order they first appeared; the visible order is only ever a transform. A keyed
  // reorder would physically move an app's subtree, cancelling its running animations and restyling all of it.
  const domOrder = domOrderRef.current;
  for (const tab of visibleTabs) if (!domOrder.includes(tab.id)) domOrder.push(tab.id);
  for (let i = domOrder.length - 1; i >= 0; i -= 1) if (!visibleTabs.some((tab) => tab.id === domOrder[i])) domOrder.splice(i, 1);
  const slotOf = new Map(visibleTabs.map((tab, index) => [tab.id, index]));
  const stableTabs = domOrder.map((id) => visibleTabs[slotOf.get(id)!]);

  return <div ref={hostRef} className={cn("clyra-task-view", overview && "clyra-task-view--open", phase === "closing" && "clyra-task-view--closing")} data-task-view-phase={phase} data-task-view-selecting={selectingId ? "true" : "false"} data-switching={switchAnim ? "true" : "false"}>
    {/* The backdrop, dismiss layer and close buttons are always in the tree. Inserting them on open would change the
        windows' sibling positions (:last-child and friends), which restyles every element of every app. */}
    <div className="clyra-task-view__backdrop" aria-hidden />
    <button type="button" aria-label="Close Task View" className="clyra-task-view__dismiss" onClick={closeToActive} tabIndex={-1} />
    {!tabs.length ? <div className="clyra-task-view__empty">No open apps · Press ⌘K to open one</div> : null}
    {stableTabs.map((tab) => {
      const index = slotOf.get(tab.id)!;
      const isExiting = exitingTab?.tab.id === tab.id;
      const target = isExiting ? exitingTab.target : cards[index] ?? source;
      const cardScale = isExiting ? exitingTab.scale : scale;
      const isActive = tab.id === activeId;
      const isFront = tab.id === frontId && !isExiting;
      const isDragging = draggingId === tab.id;
      const isLeaving = phase === "closed" && (leavingId === tab.id || switchAnim?.from === tab.id) && !isFront;
      // Unseen windows stay fully rendered at opacity 0. Hiding them with visibility or content-visibility looks
      // cheaper but costs far more when Task View reveals them (a full restyle of the app, measured at 0.1–1 s).
      const drag = isDragging ? dragRef.current : null;
      const openTransform = drag
        ? placed({ ...drag.origin, left: drag.origin.left + drag.dx, top: drag.origin.top + drag.dy }, cardScale)
        : placed(target, cardScale);
      const contentInteractive = !isExiting && phase === "closed" && isFront;
      const hitAreaInteractive = !isExiting && overview && !selectingId;

      // The two-workspace slide. Both windows travel the full viewport width in
      // opposite directions from one shared eased progress: outgoing goes to
      // -dir×W, incoming arrives from +dir×W. Everything else stays recessed.
      const width = Math.max(1, source.width);
      const sliding = phase === "closed" && switchAnim != null;
      let closedTransform: string;
      let closedTransition: string | undefined;
      let closedWillChange: string | undefined;
      if (sliding && isFront) {
        closedWillChange = "transform";
        if (switchAnim.entering) {
          closedTransform = FULL;
        } else {
          // First frame: park the incoming window off-screen with the
          // transition disabled so it never animates from its old recessed pose.
          closedTransform = `translate3d(${switchAnim.direction * width}px, 0, 0)`;
          closedTransition = "none";
        }
      } else if (sliding && isLeaving) {
        closedWillChange = "transform";
        closedTransform = switchAnim.entering ? `translate3d(${-switchAnim.direction * width}px, 0, 0)` : FULL;
      } else {
        closedTransform = isFront || isLeaving ? FULL : recessed(target, cardScale);
      }
      const style = {
        width: source.width,
        height: source.height,
        zIndex: isDragging ? 8 : selectingId === tab.id ? 6 : isFront ? 3 : isLeaving ? 2 : 1,
        "--tv-t": openTransform,
        "--tv-closed": closedTransform,
        "--task-view-target-scale": String(cardScale),
        transition: closedTransition,
        willChange: closedWillChange,
        // Both sliding windows stay fully opaque — a clean spatial pass with no
        // cross-fade. The outgoing window is off-screen by the time it snaps to
        // its recessed pose, so the later opacity drop is invisible.
        opacity: isFront || overview || isLeaving ? undefined : 0,
      } as CSSProperties;
      return (
        <div
          key={tab.id}
          ref={(el) => { if (el) windowEls.current.set(tab.id, el); else windowEls.current.delete(tab.id); }}
          className={cn("clyra-task-view__window", isActive && "is-active", isFront && "is-front", isLeaving && "is-leaving", hoveredId === tab.id && "is-hovered", selectingId === tab.id && "is-selected", isExiting && "is-closing-tab", isDragging && "is-dragging")}
          style={style}
          onPointerEnter={overview && !isExiting ? () => setHoveredId(tab.id) : undefined}
          onPointerLeave={overview && !isExiting ? () => setHoveredId((current) => (current === tab.id ? null : current)) : undefined}
        >
          <button
            type="button"
            aria-label={`Switch to ${tab.label}`}
            aria-current={isActive ? "true" : undefined}
            className="clyra-task-view__hit-area"
            style={{ pointerEvents: hitAreaInteractive ? "auto" : "none" }}
            tabIndex={hitAreaInteractive ? 0 : -1}
            onPointerDown={(event) => hitAreaInteractive && startDrag(tab, index, event)}
            onClick={() => { if (!suppressClickRef.current) select(tab.id); }}
          />
          {/* inert keeps keyboard focus out of apps you can't see. It follows the front app only (not the Task View
              phase), so opening Task View never flips it — flipping it restyles the whole app. */}
          <div className="clyra-task-view__surface" style={{ pointerEvents: contentInteractive ? "auto" : "none" }} inert={!isFront && !isLeaving ? true : undefined}>
            <BloubPauseContext.Provider value={!isActive}>{tab.content}</BloubPauseContext.Provider>
          </div>
          <div className="clyra-task-view__label" aria-hidden>{tab.label}</div>
        </div>
      );
    })}
    <div className="clyra-task-view__chrome">
      {orderedTabs.map((tab, index) => {
        const target = cards[index] ?? source;
        const closeInteractive = phase === "open" && !selectingId && !exitingTab;
        return (
          <button
            key={tab.id}
            type="button"
            className={cn("clyra-task-view__tab-close", hoveredId === tab.id && draggingId !== tab.id && "is-visible")}
            aria-label={`Close ${tab.label}`}
            title={`Close ${tab.label}`}
            style={{ "--tv-close-t": `translate3d(${target.left - 9}px, ${target.top - 9}px, 0)` } as CSSProperties}
            tabIndex={closeInteractive ? 0 : -1}
            onPointerEnter={closeInteractive ? () => setHoveredId(tab.id) : undefined}
            onPointerLeave={closeInteractive ? () => setHoveredId((current) => (current === tab.id ? null : current)) : undefined}
            onClick={(event) => { event.preventDefault(); event.stopPropagation(); closeTab(tab.id); }}
          >
            <X aria-hidden strokeWidth={2.4} />
          </button>
        );
      })}
    </div>
  </div>;
}));
