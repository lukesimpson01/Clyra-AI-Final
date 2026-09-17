import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { cn } from "../lib/utils";

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

// Must match the `transform` transition duration on .clyra-task-view__window
// in index.css (520ms). SETTLE_BUFFER_MS is a small margin so the phase flip
// that re-enables clicks / calls onSelect/onClose never preempts the visual
// animation. That small margin prevents the phase change from clipping the
// tail of the zoom with a visible snap as the window settles.
const TRANSFORM_MS = 520;
const SETTLE_BUFFER_MS = 30;
// Card entrances are offset by at most six 18ms beats. Keep the opening
// phase through that final beat so a card never becomes interactive midway
// through its arrival.
const OPEN_MS = TRANSFORM_MS + 6 * 18 + SETTLE_BUFFER_MS;
const CLOSE_MS = TRANSFORM_MS + SETTLE_BUFFER_MS;
const TAB_CLOSE_MS = 260;
const GAP = 26;
const PAD_X = 44;
const PAD_Y = 42;
const LABEL_H = 25;
const emptyRect: Rect = { left: 0, top: 0, width: 1, height: 1 };

function aspectOf(source: Rect) {
  return Math.max(0.45, Math.min(3.2, source.width / Math.max(1, source.height)));
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
}>(function WorkspaceTaskView({ open, tabs, activeId, onSelect, onClose, onCloseTab }, ref) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [source, setSource] = useState<Rect>(emptyRect);
  const [viewport, setViewport] = useState<Rect>(emptyRect);
  const [phase, setPhase] = useState<Phase>(open ? "opening" : "closed");
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [selectingId, setSelectingId] = useState<string | null>(null);
  const [closingTabId, setClosingTabId] = useState<string | null>(null);
  const phaseRef = useRef(phase);
  const completionRef = useRef<number | null>(null);
  const tabCloseTimerRef = useRef<number | null>(null);
  phaseRef.current = phase;

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

  const cards = useMemo(() => computeTaskViewCards(tabs.length, source, viewport), [source, tabs.length, viewport]);
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
    settle("closing", CLOSE_MS, () => { setPhase("closed"); onClose(); });
  }, [onClose, settle]);
  const closeTab = useCallback((id: string) => {
    // Keep one window available as an anchor for Task View. A close control on
    // the final card would promise an action that cannot leave a usable view.
    if (phaseRef.current !== "open" || closingTabId || tabs.length < 2) return;
    setClosingTabId(id);
    if (tabCloseTimerRef.current != null) window.clearTimeout(tabCloseTimerRef.current);
    tabCloseTimerRef.current = window.setTimeout(() => {
      tabCloseTimerRef.current = null;
      setClosingTabId(null);
      onCloseTab(id);
    }, TAB_CLOSE_MS);
  }, [closingTabId, onCloseTab, tabs.length]);
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

  useEffect(() => {
    if (phase === "closed") return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); closeToActive(); }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [closeToActive, phase]);
  useEffect(() => () => {
    if (tabCloseTimerRef.current != null) window.clearTimeout(tabCloseTimerRef.current);
  }, []);
  useImperativeHandle(ref, () => ({ closeToActive, toggle }), [closeToActive, toggle]);

  const overview = phase === "opening" || phase === "open";
  const transitioning = phase !== "closed";
  return <div ref={hostRef} className={cn("clyra-task-view", overview && "clyra-task-view--open", phase === "closing" && "clyra-task-view--closing")} data-task-view-phase={phase} data-task-view-selecting={selectingId ? "true" : "false"}>
    <div className="clyra-task-view__backdrop" aria-hidden />
    {tabs.map((tab, index) => {
      const target = cards[index] ?? source;
      const isActive = tab.id === activeId;
      const isSelected = selectingId === tab.id;
      const isClosing = closingTabId === tab.id;
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
      const contentInteractive = overview ? false : isActive;
      const hitAreaInteractive = overview && !selectingId && !closingTabId;
      const tabCloseInteractive = phase === "open" && tabs.length > 1 && !selectingId && !closingTabId;
      const scale = Math.min(target.width / Math.max(1, source.width), target.height / Math.max(1, source.height));
      return <div key={tab.id} className={cn("clyra-task-view__window", isActive && "is-active", hoveredId === tab.id && "is-hovered", isSelected && "is-selected", isClosing && "is-closing-tab")} style={{ left: target.left, top: target.top, width: source.width, height: source.height, zIndex: isClosing || isSelected ? 5 : isActive ? 3 : 2, ...transformFor(source, target), "--task-view-target-scale": String(scale), "--task-view-order": String(Math.min(index, 6)) } as CSSProperties} onPointerEnter={() => setHoveredId(tab.id)} onPointerLeave={() => setHoveredId((current) => current === tab.id ? null : current)}>
        <button type="button" aria-label={`Switch to ${tab.label}`} aria-current={isActive ? "true" : undefined} className="clyra-task-view__hit-area" style={{ pointerEvents: hitAreaInteractive ? "auto" : "none" }} tabIndex={hitAreaInteractive ? 0 : -1} onClick={() => select(tab.id)} />
        <div className="clyra-task-view__surface" style={{ pointerEvents: contentInteractive ? "auto" : "none" }}>{tab.content}</div>
        <div className="clyra-task-view__label" aria-hidden>{tab.label}</div>
        <button type="button" className="clyra-task-view__tab-close" aria-label={`Close ${tab.label}`} title={`Close ${tab.label}`} tabIndex={tabCloseInteractive ? 0 : -1} onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.preventDefault(); event.stopPropagation(); closeTab(tab.id); }}>
          <span aria-hidden>×</span>
        </button>
      </div>;
    })}
    {transitioning ? <button type="button" aria-label="Close Task View" className="clyra-task-view__dismiss" onClick={closeToActive} tabIndex={-1} /> : null}
  </div>;
});
