import {
  forwardRef,
  Fragment,
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
import { Boxes, Command, Square, X } from "lucide-react";
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
type TaskViewMode = "2d" | "3d";
/** Per-card spatial-fan transform, layered on top of a shared center Rect. */
type Fan3D = { fanX: number; fanY: number; fanZ: number; fanRot: number; opacity: number; scale: number; shadow: number };

// Must match the `transform` transition duration on .clyra-task-view__window
// in index.css (520ms). SETTLE_BUFFER_MS is a small margin so the phase flip
// that re-enables clicks / calls onSelect/onClose never preempts the visual
// animation. That small margin prevents the phase change from clipping the
// tail of the zoom with a visible snap as the window settles.
const TRANSFORM_MS = 640;
const SETTLE_BUFFER_MS = 30;
// Card entrances are offset by at most six 18ms beats. Keep the opening
// phase through that final beat so a card never becomes interactive midway
// through its arrival.
const OPEN_MS = TRANSFORM_MS + 6 * 18 + SETTLE_BUFFER_MS;
const CLOSE_MS = TRANSFORM_MS + SETTLE_BUFFER_MS;
// The outgoing card and the remaining grid move together as one gesture.
const TAB_CLOSE_MS = 320;
const GAP = 26;
const PAD_X = 44;
const PAD_Y = 42;
const LABEL_H = 25;
const emptyRect: Rect = { left: 0, top: 0, width: 1, height: 1 };

// Spacing between neighbouring cards in the 3D fan, in px, before the
// viewport-relative falloff below is applied. Kept as a constant (rather
// than derived from card width) so pointer-drag deltas and wheel deltas can
// convert to "index units" with the exact same ratio the layout uses.
// Layout constants are authored for a 640px-wide front card and scaled by
// the real card width, so the deck keeps its proportions at any window size.
const FAN_REF_CARD_W = 640;
const FAN_SPACING = 190;
const FAN_MAX_OFFSET = 8;
const DRAG_CLICK_THRESHOLD = 6;
// Every open tab keeps its real, live app mounted (so switching back is
// instant), and in 3D the whole fan shares one `perspective` context, so a
// card well off to either side still costs a full composite every frame even
// though it's barely visible. With 10+ tabs open that adds up to a severe,
// measured frame-rate hit (idle ~10fps). Cards beyond this many fan slots
// from the focused one are visually negligible already (opacity/scale are
// both near their floor out there), so hide them outright — `visibility`,
// not unmounting, so their app state is untouched and they reappear the
// instant the fan scrubs back within range.
const FAN_CULL_DISTANCE = Number.POSITIVE_INFINITY;
const MORPH_MS = 560;

function aspectOf(source: Rect) {
  return Math.max(0.45, Math.min(3.2, source.width / Math.max(1, source.height)));
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

/** Chooses the grid with the largest live-window scale, retaining its ratio. */
export function computeTaskViewCards(count: number, source: Rect, viewport: Rect): Rect[] {
  if (!count) return [];
  const availableW = Math.max(240, viewport.width - PAD_X * 2);
  const availableH = Math.max(180, viewport.height - PAD_Y * 2);
  aspectOf(source); // clamps pathological source measurements before solving.
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
  const cellW = (availableW - GAP * (columns - 1)) / columns;
  const cellH = (availableH - GAP * (rows - 1)) / rows;
  const scale = Math.max(0.08, best?.scale ?? 1);
  const width = source.width * scale;
  const height = source.height * scale;
  const usedH = rows * cellH + GAP * (rows - 1);
  const topOffset = Math.max(PAD_Y, (viewport.height - usedH) / 2);
  return Array.from({ length: count }, (_, index) => {
    const col = index % columns;
    const row = Math.floor(index / columns);
    return {
      left: viewport.left + PAD_X + col * (cellW + GAP) + (cellW - width) / 2,
      top: viewport.top + topOffset + row * (cellH + GAP) + Math.max(0, (cellH - LABEL_H - height) / 2),
      width,
      height,
    };
  });
}

/**
 * Lays every card over one shared, viewport-centered box. Horizontal
 * position, depth and rotation come entirely from the `fan*` transform the
 * caller layers on top of this rect (see the --task-view-fan-* CSS custom
 * properties), the same way `computeTaskViewCards` hands back a rect that
 * `transformFor` turns into a FLIP translate.
 */
export function computeTaskView3DCenterRect(source: Rect, viewport: Rect): Rect {
  const maxW = viewport.width * 0.5;
  const maxH = viewport.height * 0.58;
  const scale = clamp(Math.min(maxW / source.width, maxH / source.height, 1), 0.1, 1);
  const width = source.width * scale;
  const height = source.height * scale;
  return {
    left: viewport.left + (viewport.width - width) / 2,
    top: viewport.top + viewport.height * 0.47 - height / 2,
    width,
    height,
  };
}

/** A continuous spatial deck: every card's pose is a pure function of its
 *  distance from the focused position, so a fractional focus interpolates the
 *  whole deck together. Side cards step out, recede in depth, drop slightly
 *  and turn toward the centre, with the turn capped so the deck never reads as
 *  a classic cover-flow ring. */
export function computeTaskView3DFan(count: number, focus: number, unit: number, baseScale: number): Fan3D[] {
  return Array.from({ length: count }, (_, index) => {
    const offset = index - focus;
    const abs = Math.abs(offset);
    const side = Math.sign(offset);
    const capped = Math.min(abs, FAN_MAX_OFFSET);
    return {
      fanX: side * (FAN_SPACING + Math.max(0, abs - 1) * 105) * unit,
      fanY: abs * 7 * unit,
      fanZ: -abs * 125 * unit,
      fanRot: -side * Math.min(abs, 1) * 45,
      opacity: 1 - Math.min(abs * 0.05, 0.22),
      scale: baseScale * (1 - Math.min(capped * 0.055, 0.24)),
      shadow: Math.max(0.35, 1 - abs * 0.12),
    };
  });
}

function transformFor(source: Rect, target: Rect): CSSProperties {
  // First = source rect, Last = target rect. The child keeps source geometry;
  // only this outer compositor layer translates and uniformly scales. Scale
  // is computed by the caller (guarded against a zero-size source) and passed
  // in separately as --task-view-target-scale, which is the one CSS actually
  // reads — this function only owns the translate offset.
  const x = source.left - target.left;
  const y = source.top - target.top;
  return {
    "--task-view-x": `${x}px`,
    "--task-view-y": `${y}px`,
  } as CSSProperties;
}

export type TaskViewHandle = { closeToActive: () => void; toggle: () => void };

export const WorkspaceTaskView = forwardRef<TaskViewHandle, {
  open: boolean;
  tabs: TaskViewTab[];
  activeId: string;
  onSelect: (id: string) => void;
  onClose: () => void;
  onCloseTab: (id: string) => void;
  /** Fires when the user drags a card (2D grid or 3D fan) to a new slot. */
  onReorder?: (orderedIds: string[]) => void;
}>(function WorkspaceTaskView({ open, tabs, activeId, onSelect, onClose, onCloseTab, onReorder }, ref) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [source, setSource] = useState<Rect>(emptyRect);
  const [viewport, setViewport] = useState<Rect>(emptyRect);
  const [phase, setPhase] = useState<Phase>(open ? "opening" : "closed");
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [selectingId, setSelectingId] = useState<string | null>(null);
  const [closingTabId, setClosingTabId] = useState<string | null>(null);
  const [exitingTab, setExitingTab] = useState<ExitingTab | null>(null);
  // 3D mode. The 2D path above is untouched by any of this — it is wired in
  // only where a card's transform is actually computed, below.
  const [mode, setMode] = useState<TaskViewMode>("2d");
  const [focusIndex, setFocusIndex] = useState(0);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [navDragging, setNavDragging] = useState(false);
  const navDragRef = useRef<{ startX: number; startFocus: number; moved: boolean } | null>(null);
  const navSuppressClickRef = useRef(false);
  const [dragLiveOrder, setDragLiveOrder] = useState<string[] | null>(null);
  const [dragDeltaX, setDragDeltaX] = useState(0);
  const phaseRef = useRef(phase);
  const modeRef = useRef(mode);
  const completionRef = useRef<number | null>(null);
  const tabCloseTimerRef = useRef<number | null>(null);
  const dragRef = useRef<{ id: string; startX: number; startIndex: number; moved: boolean; pointerId: number } | null>(null);
  const dragFrameRef = useRef<number | null>(null);
  const pendingDeltaRef = useRef(0);
  // Mirrors `dragLiveOrder` so the pointerup handler can read the latest
  // live-reordered ids synchronously (the handler's own closure is fixed at
  // listener-registration time and would otherwise see a stale order).
  const dragLiveOrderRef = useRef<string[] | null>(null);
  phaseRef.current = phase;
  modeRef.current = mode;
  // Layout switches animate every card's box and transform together, so the
  // 2D grid and the 3D deck read as one morph rather than a swap. Scoped to
  // the switch itself: drag reorders stay on their direct, unanimated path.
  const [morphing, setMorphing] = useState(false);
  const morphTimerRef = useRef<number | null>(null);
  const switchMode = useCallback((next: TaskViewMode) => {
    if (next === modeRef.current) return;
    setMorphing(true);
    if (morphTimerRef.current != null) window.clearTimeout(morphTimerRef.current);
    morphTimerRef.current = window.setTimeout(() => {
      morphTimerRef.current = null;
      setMorphing(false);
    }, MORPH_MS);
    setMode(next);
  }, []);
  useEffect(() => () => {
    if (morphTimerRef.current != null) window.clearTimeout(morphTimerRef.current);
  }, []);

  const measure = useCallback(() => {
    const rect = hostRef.current?.getBoundingClientRect();
    if (!rect || rect.width < 2 || rect.height < 2) return;
    const next = { left: 0, top: 0, width: rect.width, height: rect.height };
    setViewport(next);
    setSource(next);
  }, []);

  useLayoutEffect(() => {
    measure();
    const observer = new ResizeObserver(measure);
    if (hostRef.current) observer.observe(hostRef.current);
    return () => observer.disconnect();
  }, [measure]);

  // While a drag is live, render the in-progress order instead of the
  // committed `tabs` prop so neighbours visibly reflow before the drop.
  const orderedTabs = useMemo(() => {
    if (!dragLiveOrder) return tabs;
    const byId = new Map(tabs.map((tab) => [tab.id, tab]));
    const next = dragLiveOrder.map((id) => byId.get(id)).filter((tab): tab is TaskViewTab => Boolean(tab));
    return next.length === tabs.length ? next : tabs;
  }, [dragLiveOrder, tabs]);

  const cards = useMemo(() => computeTaskViewCards(orderedTabs.length, source, viewport), [orderedTabs.length, source, viewport]);
  const fanCenterRect = useMemo(() => computeTaskView3DCenterRect(source, viewport), [source, viewport]);
  const fanBaseScale = useMemo(
    () => Math.min(fanCenterRect.width / Math.max(1, source.width), fanCenterRect.height / Math.max(1, source.height), 1),
    [fanCenterRect, source],
  );
  const fanUnit = fanCenterRect.width / FAN_REF_CARD_W;
  const fans = useMemo(
    () => computeTaskView3DFan(orderedTabs.length, focusIndex, fanUnit, fanBaseScale),
    [orderedTabs.length, focusIndex, fanUnit, fanBaseScale],
  );
  // Keep the focused card inside the current tab count whenever tabs close
  // or a reorder commits out from under the fan.
  useEffect(() => {
    setFocusIndex((current) => clamp(current, 0, Math.max(0, orderedTabs.length - 1)));
  }, [orderedTabs.length]);
  // Center the fan on the active app the moment 3D mode opens.
  useEffect(() => {
    if (mode !== "3d") return;
    const index = orderedTabs.findIndex((tab) => tab.id === activeId);
    if (index >= 0) setFocusIndex(index);
    // Only on entering 3D / opening, not on every active-id change while
    // already browsing the fan — the user's own navigation should win.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, open]);

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
      // Two rAFs, not one: the frame that just committed still renders the
      // "closed" transform (this effect runs after that paint), so a single
      // rAF can land in the same paint cycle the browser is still preparing
      // and get coalesced away — the class flip and the pre-flip state would
      // never both hit the screen, and the transition plays no differently
      // than a hard cut. A second rAF guarantees the browser has genuinely
      // painted the pre-flip frame before the transition-triggering class
      // change lands, so the transform reliably animates instead of
      // occasionally snapping straight to its end state.
      let raf2 = 0;
      const raf1 = requestAnimationFrame(() => {
        raf2 = requestAnimationFrame(() => settle("opening", OPEN_MS, () => setPhase("open")));
      });
      return () => { cancelAnimationFrame(raf1); if (raf2) cancelAnimationFrame(raf2); };
    }
    if (phaseRef.current !== "closed") settle("closing", CLOSE_MS, () => setPhase("closed"));
    return () => { if (completionRef.current != null) window.clearTimeout(completionRef.current); };
  }, [open, settle]);

  const closeToActive = useCallback(() => {
    if (phaseRef.current === "closed" || phaseRef.current === "closing") return;
    // An empty overview has no active workspace to return to. Keep its launch
    // state on screen until the user opens an app with Cmd+K.
    if (!tabs.length) return;
    settle("closing", CLOSE_MS, () => { setPhase("closed"); onClose(); });
  }, [onClose, settle, tabs.length]);
  const closeTab = useCallback((id: string) => {
    if (phaseRef.current !== "open" || closingTabId) return;
    const index = orderedTabs.findIndex((tab) => tab.id === id);
    const tab = orderedTabs[index];
    const target = mode === "3d" ? fanCenterRect : cards[index];
    if (!tab || !target) return;
    setClosingTabId(id);
    // Remove the live tab now so its neighbours can reflow immediately, while
    // preserving its keyed element long enough to complete the exit motion.
    setExitingTab({
      tab,
      target,
      scale: mode === "3d" ? fans[index]?.scale ?? fanBaseScale : Math.min(target.width / Math.max(1, source.width), target.height / Math.max(1, source.height)),
    });
    onCloseTab(id);
    if (tabCloseTimerRef.current != null) window.clearTimeout(tabCloseTimerRef.current);
    tabCloseTimerRef.current = window.setTimeout(() => {
      tabCloseTimerRef.current = null;
      setClosingTabId(null);
      setExitingTab(null);
    }, TAB_CLOSE_MS);
  }, [cards, closingTabId, fanBaseScale, fanCenterRect, fans, mode, onCloseTab, orderedTabs, source.height, source.width]);
  const select = useCallback((id: string) => {
    if (phaseRef.current === "closing" || selectingId) return;
    setSelectingId(id);
    settle("closing", CLOSE_MS, () => { setPhase("closed"); setSelectingId(null); onSelect(id); });
  }, [onSelect, selectingId, settle]);
  const toggle = useCallback(() => {
    if (phaseRef.current === "closing") {
      // Reversing mid-close: the window is already mid-flight on the CSS
      // transform, so re-applying the open transform target lets it animate
      // smoothly back out from wherever it currently is — no snap, no
      // restart from scratch.
      setSelectingId(null);
      settle("opening", OPEN_MS, () => setPhase("open"));
      return;
    }
    closeToActive();
  }, [closeToActive, settle]);

  // Arrow keys / Enter steer the 3D fan; Escape (below, unconditional) still
  // leaves Task View in either mode.
  useEffect(() => {
    if (phase === "closed") return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); closeToActive(); return; }
      if (modeRef.current !== "3d" || phaseRef.current !== "open") return;
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault();
        setFocusIndex((current) => clamp(Math.round(current) + (event.key === "ArrowLeft" ? -1 : 1), 0, Math.max(0, orderedTabs.length - 1)));
      } else if (event.key === "Enter") {
        const index = clamp(Math.round(focusIndex), 0, Math.max(0, orderedTabs.length - 1));
        const tab = orderedTabs[index];
        if (tab) { event.preventDefault(); select(tab.id); }
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [closeToActive, focusIndex, orderedTabs, phase, select]);

  // Trackpad / wheel: horizontal swipe (or shift+wheel) scrubs focus through
  // the fan. Fast swipes cover several cards; slow ones stay precise, since
  // this is a direct 1:1 px→index mapping rather than a snap-to-nearest.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const onWheel = (event: WheelEvent) => {
      if (modeRef.current !== "3d" || phaseRef.current !== "open" || !orderedTabs.length) return;
      const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.shiftKey ? event.deltaY : 0;
      if (!delta) return;
      event.preventDefault();
      setFocusIndex((current) => clamp(current + delta / FAN_SPACING, 0, Math.max(0, orderedTabs.length - 1)));
    };
    host.addEventListener("wheel", onWheel, { passive: false });
    return () => host.removeEventListener("wheel", onWheel);
  }, [orderedTabs.length]);

  useEffect(() => () => {
    if (tabCloseTimerRef.current != null) window.clearTimeout(tabCloseTimerRef.current);
    if (dragFrameRef.current != null) cancelAnimationFrame(dragFrameRef.current);
  }, []);
  useImperativeHandle(ref, () => ({ closeToActive, toggle }), [closeToActive, toggle]);

  // Drag-to-reorder, shared by both layouts. Pointer deltas convert to
  // "slots" using each mode's own spacing (grid cell width for 2D, the fan's
  // fixed FAN_SPACING for 3D); whichever slot the pointer currently sits over
  // is live-applied to `dragLiveOrder` so neighbours visibly move aside
  // before the drop, not just after mouse-up.
  const flushDrag = useCallback((clientX: number) => {
    const drag = dragRef.current;
    if (!drag) return;
    const deltaPx = clientX - drag.startX;
    if (!drag.moved && Math.abs(deltaPx) > DRAG_CLICK_THRESHOLD) drag.moved = true;
    setDragDeltaX(deltaPx);
    if (!drag.moved) return;
    const slotWidth = modeRef.current === "3d" ? FAN_SPACING : Math.max(1, (cards[1]?.left ?? cards[0]?.left ?? FAN_SPACING) - (cards[0]?.left ?? 0)) || FAN_SPACING;
    const deltaSlots = Math.round(deltaPx / slotWidth);
    const targetIndex = clamp(drag.startIndex + deltaSlots, 0, orderedTabs.length - 1);
    setDragLiveOrder((current) => {
      const base = current ?? tabs.map((tab) => tab.id);
      const fromIndex = base.indexOf(drag.id);
      const next = fromIndex === -1 || fromIndex === targetIndex ? (current ?? base) : (() => {
        const copy = base.slice();
        copy.splice(fromIndex, 1);
        copy.splice(targetIndex, 0, drag.id);
        return copy;
      })();
      dragLiveOrderRef.current = next;
      return next;
    });
  }, [cards, orderedTabs.length, tabs]);

  useEffect(() => {
    if (!draggingId) return;
    const onMove = (event: PointerEvent) => {
      pendingDeltaRef.current = event.clientX;
      if (dragFrameRef.current != null) return;
      dragFrameRef.current = requestAnimationFrame(() => {
        dragFrameRef.current = null;
        flushDrag(pendingDeltaRef.current);
      });
    };
    const onUp = () => {
      if (dragFrameRef.current != null) { cancelAnimationFrame(dragFrameRef.current); dragFrameRef.current = null; }
      const drag = dragRef.current;
      const finalOrder = dragLiveOrderRef.current;
      setDraggingId(null);
      setDragDeltaX(0);
      setDragLiveOrder(null);
      dragRef.current = null;
      dragLiveOrderRef.current = null;
      // Called as a plain function here, never from inside a setState
      // updater — React (rightly) flags a parent-state update triggered
      // from within this component's own render/update cycle.
      if (drag?.moved && finalOrder && onReorder) onReorder(finalOrder);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [draggingId, flushDrag, onReorder]);

  const handleCardPointerDown = useCallback((tab: TaskViewTab, index: number, event: ReactPointerEvent<HTMLButtonElement>) => {
    if (phaseRef.current !== "open" || selectingId || closingTabId || event.button !== 0) return;
    // In the 3D deck, pressing a card that isn't in front scrubs the deck; the
    // front card keeps the reorder drag, so both gestures stay available.
    if (modeRef.current === "3d" && index !== Math.round(focusIndex)) {
      navDragRef.current = { startX: event.clientX, startFocus: focusIndex, moved: false };
      setNavDragging(true);
      return;
    }
    dragRef.current = { id: tab.id, startX: event.clientX, startIndex: index, moved: false, pointerId: event.pointerId };
    setDraggingId(tab.id);
  }, [closingTabId, focusIndex, selectingId]);

  useEffect(() => {
    if (!navDragging) return;
    const onMove = (event: PointerEvent) => {
      const drag = navDragRef.current;
      if (!drag) return;
      const deltaPx = event.clientX - drag.startX;
      if (!drag.moved && Math.abs(deltaPx) > DRAG_CLICK_THRESHOLD) drag.moved = true;
      if (!drag.moved) return;
      const slotPx = FAN_SPACING * fanUnit;
      setFocusIndex(clamp(drag.startFocus - deltaPx / slotPx, 0, Math.max(0, orderedTabs.length - 1)));
    };
    const onUp = () => {
      const drag = navDragRef.current;
      navDragRef.current = null;
      setNavDragging(false);
      if (!drag?.moved) return;
      // The click that follows this release belongs to the drag, not a select.
      navSuppressClickRef.current = true;
      window.setTimeout(() => { navSuppressClickRef.current = false; }, 0);
      setFocusIndex((current) => clamp(Math.round(current), 0, Math.max(0, orderedTabs.length - 1)));
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [fanUnit, navDragging, orderedTabs.length]);

  const overview = phase === "opening" || phase === "open";
  const transitioning = phase !== "closed";
  // Preserve the departing app's key after the source tabs have shrunk. This
  // lets it slide out as its neighbours glide into their new grid positions.
  const visibleTabs = exitingTab ? [...orderedTabs, exitingTab.tab] : orderedTabs;
  return <div ref={hostRef} className={cn("clyra-task-view", overview && "clyra-task-view--open", phase === "closing" && "clyra-task-view--closing", mode === "3d" && "clyra-task-view--mode-3d", morphing && "clyra-task-view--morphing")} data-task-view-phase={phase} data-task-view-selecting={selectingId ? "true" : "false"} data-task-view-dragging={draggingId ? "true" : "false"}>
    <div className="clyra-task-view__backdrop" aria-hidden />
    {visibleTabs.map((tab, index) => {
      const isExiting = exitingTab?.tab.id === tab.id;
      const fan = fans[index];
      const fanScaleHere = mode === "3d" ? fan?.scale ?? fanBaseScale : 0;
      const fanW = source.width * fanScaleHere;
      const fanH = source.height * fanScaleHere;
      const fanRectHere = {
        left: fanCenterRect.left + (fanCenterRect.width - fanW) / 2,
        top: fanCenterRect.top + (fanCenterRect.height - fanH) / 2,
        width: fanW,
        height: fanH,
      };
      const target = isExiting ? exitingTab.target : (mode === "3d" ? fanRectHere : cards[index] ?? source);
      const isActive = tab.id === activeId;
      const isSelected = selectingId === tab.id;
      const isClosing = closingTabId === tab.id || isExiting;
      const isDraggingThis = draggingId === tab.id;
      // Two independent concerns that a single `isInteractive` flag used to
      // conflate, applied to the whole window: whether the real mounted app
      // (chat, browser, notes, ...) receives clicks, and whether the
      // transparent "select this window" overlay does. Folding both into one
      // flag driven by `overview` meant the ACTIVE window's own content went
      // pointer-events:none for the entire normal "closed" phase — the app's
      // default resting state — so no button or input in any workspace could
      // be reached by a real mouse click; only synthetic/dispatched events
      // (keyboard shortcuts, programmatic focus) still worked. Every
      // workspace mounts through this component, so this affected all of
      // them, not just one.
      const contentInteractive = !isExiting && (overview ? false : isActive);
      const hitAreaInteractive = !isExiting && overview && !selectingId && !closingTabId;
      const tabCloseInteractive = !isExiting && phase === "open" && !selectingId && !closingTabId;
      const scale = isExiting
        ? exitingTab.scale
        : mode === "3d" && !isClosing
          ? fan?.scale ?? fanBaseScale
          : Math.min(target.width / Math.max(1, source.width), target.height / Math.max(1, source.height));
      // Forced to 0 for anything mid-close or already selected: the shared
      // closing CSS rule only animates translate(x,y,0) scale(1), so a fan
      // offset left non-zero here would freeze mid-rotation instead of
      // diving straight ahead into fullscreen.
      const fanActive = mode === "3d" && !isClosing && phase === "open";
      const isCulled = fanActive && !isActive && !isDraggingThis && Math.abs(index - focusIndex) > FAN_CULL_DISTANCE;
      const fanDistance = Math.abs(index - focusIndex);
      const isHoveredFan = fanActive && hoveredId === tab.id && !isDraggingThis;
      const fanTransform = mode === "3d" && fanActive
        ? (() => {
            const x = (fan?.fanX ?? 0) + (isDraggingThis ? dragDeltaX : 0);
            const y = (fan?.fanY ?? 0) + (isHoveredFan ? -6 : 0);
            const z = (fan?.fanZ ?? 0) + (isHoveredFan ? 40 : 0);
            const rot = fan?.fanRot ?? 0;
            const cx = fanW / 2;
            const cy = fanH / 2;
            return `translate3d(${x}px, ${y}px, ${z}px) translate(${cx}px, ${cy}px) rotateY(${rot}deg) translate(${-cx}px, ${-cy}px) scale(${fanScaleHere})`;
          })()
        : undefined;
      const style = {
        left: target.left, top: target.top, width: source.width, height: source.height,
        zIndex: isClosing || isSelected ? 5 : fanActive ? 6 - Math.min(Math.round(fanDistance), 5) : isActive ? 3 : 2,
        visibility: isCulled ? "hidden" : undefined,
        ...transformFor(source, target),
        "--task-view-target-scale": String(scale),
        "--task-view-order": String(Math.min(index, 6)),
        "--task-view-fan-transform": fanTransform,
        "--task-view-shadow": String(fanActive ? fan?.shadow ?? 1 : 1),
        "--task-view-morph-delay": `${morphing ? Math.min(Math.round(Math.abs(index - focusIndex)), 4) * 28 : 0}ms`,
      } as CSSProperties;
      const cardOpacity = fanActive ? fan?.opacity ?? 1 : undefined;
      return <Fragment key={tab.id}><div className={cn("clyra-task-view__window", isActive && "is-active", hoveredId === tab.id && "is-hovered", isSelected && "is-selected", isClosing && "is-closing-tab", isDraggingThis && "is-dragging")} style={{ ...style, opacity: cardOpacity }} onPointerEnter={() => !isExiting && setHoveredId(tab.id)} onPointerLeave={() => !isExiting && setHoveredId((current) => current === tab.id ? null : current)}>
        <button type="button" aria-label={`Switch to ${tab.label}`} aria-current={isActive ? "true" : undefined} className="clyra-task-view__hit-area" style={{ pointerEvents: hitAreaInteractive ? "auto" : "none", cursor: mode === "3d" ? (isDraggingThis ? "grabbing" : "grab") : "pointer" }} tabIndex={hitAreaInteractive ? 0 : -1} onPointerDown={(event) => hitAreaInteractive && handleCardPointerDown(tab, index, event)} onClick={() => { if (navSuppressClickRef.current) return; if (dragRef.current?.moved && dragRef.current.id === tab.id) return; select(tab.id); }} />
        <div className="clyra-task-view__surface" style={{ pointerEvents: contentInteractive ? "auto" : "none" }}><BloubPauseContext.Provider value={mode === "3d" && !isActive}>{tab.content}</BloubPauseContext.Provider></div>
        <div className="clyra-task-view__label" aria-hidden style={mode === "3d" ? { opacity: fanActive ? Math.max(0.25, 1 - Math.min(Math.abs(index - focusIndex) * 0.25, 0.75)) : undefined } : undefined}>{tab.label}</div>
      </div>{!isExiting ? <button type="button" className="clyra-task-view__tab-close" aria-label={`Close ${tab.label}`} title={`Close ${tab.label}`} style={{ left: target.left + target.width - 38, top: target.top + 8, opacity: isClosing ? 0 : undefined, visibility: isCulled || (fanActive && fanDistance >= 0.5) ? "hidden" : undefined }} tabIndex={isCulled || (fanActive && fanDistance >= 0.5) ? -1 : tabCloseInteractive ? 0 : -1} onPointerEnter={() => setHoveredId(tab.id)} onPointerLeave={() => setHoveredId((current) => current === tab.id ? null : current)} onClick={(event) => { event.preventDefault(); event.stopPropagation(); closeTab(tab.id); }}>
        <X aria-hidden className="h-4 w-4" strokeWidth={2.15} />
      </button> : null}</Fragment>;
    })}
    {overview && tabs.length > 0 ? <div className="clyra-task-view__controls" aria-hidden={phase !== "open"}>
      <span><Command className="h-3.5 w-3.5" /> Task View</span>
      <div className="clyra-task-view__mode-toggle" role="radiogroup" aria-label="Task View layout">
        <button type="button" role="radio" aria-checked={mode === "2d"} className={cn(mode === "2d" && "is-active")} tabIndex={phase === "open" ? 0 : -1} onClick={() => switchMode("2d")}>
          <Square className="h-3 w-3" strokeWidth={2.3} /> 2D
        </button>
        <button type="button" role="radio" aria-checked={mode === "3d"} className={cn(mode === "3d" && "is-active")} tabIndex={phase === "open" ? 0 : -1} onClick={() => switchMode("3d")}>
          <Boxes className="h-3 w-3" strokeWidth={2.3} /> 3D
        </button>
      </div>
      <button type="button" onClick={closeToActive} tabIndex={phase === "open" ? 0 : -1}>Done <kbd>⌘ J</kbd></button>
    </div> : null}
    {transitioning ? <button type="button" aria-label="Close Task View" className="clyra-task-view__dismiss" onClick={closeToActive} tabIndex={-1} /> : null}
  </div>;
});
