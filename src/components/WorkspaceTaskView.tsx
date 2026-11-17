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
import { ArrowLeftRight, Bookmark, Check, PanelRightClose, PictureInPicture2, Plus, Trash2, X } from "lucide-react";
import { applyWorkspace, clampFloat, deleteWorkspace, detach, dockApp, floatApp, loadLayout, resolveRoles, saveLayout, saveWorkspace, type Layout, type Role } from "../lib/taskViewLayout";
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
type Drag = {
  id: string; pointerId: number; startX: number; startY: number; origin: Rect; dx: number; dy: number; moved: boolean;
  /** 3D lift: the grabbed card's arc position and scale, the pointer velocity and the eased tilt it produces. */
  mode3d?: boolean; cx: number; cy: number; s: number; lastX: number; lastY: number; lastT: number; vx: number; vy: number; tx: number; ty: number; tz: number; raf: number;
};
/** Velocity-driven tilt limits (degrees) and the lift above the arc. Subtle: the card stays readable. */
const TILT_Y = 7;
const TILT_X = 5;
const TILT_Z = 2;
const LIFT_Z = 48;
const dragPose3d = (d: Drag, w: number, h: number) => poseTransform({ x: d.cx + d.dx, y: d.cy + d.dy, z: LIFT_Z, rx: d.tx, ry: d.ty, rz: d.tz, s: d.s * 1.04 }, w, h);

/*
 * Task View is one light surface that rearranges itself around what you do. Every window is the real, mounted app
 * at its full size; a single compositor transform places it (index.css, "Task View · light spatial overview"). The
 * zoom out, the reflow after a window closes, drag-to-reorder and the zoom back in all move that one property, so
 * windows travel from where they are to where they go instead of disappearing and reappearing.
 */

// Keep in step with the transform transitions in index.css (open 620 ms spring + up to 154 ms stagger, close 480 ms, tab close 220 ms fade).
const OPEN_MS = 780;
const CLOSE_MS = 520;
const TAB_CLOSE_MS = 260;
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
const MODE_KEY = "clyra.taskview.mode";
const KNOWN_APPS = ["chat", "vibe", "clip", "browser", "companion", "study", "notes", "spotify", "maps", "fake-text", "would-rather", "reddit-story"];
type ViewMode = "2d" | "3d";

/**
 * The 3D arrangement: the focused app faces you at the centre of a shallow arc and its neighbours recede to either
 * side, turned toward the centre. Each pose is one transform about the window's own centre, so the same real mounted
 * app moves between 2D, 3D and full screen without ever being re-rendered.
 */
export type Pose3D = { transform: string; scale: number; depth: number; x: number; y: number; z: number; angle: number };
type PoseParts = { x: number; y: number; z: number; rx?: number; ry?: number; rz?: number; s: number };
/** One fixed function list for every 3D pose, so any two poses (closed, arc, lifted) interpolate part by part. */
const poseTransform = (p: PoseParts, w: number, h: number) =>
  `translate3d(${p.x}px, ${p.y}px, ${p.z}px) rotateX(${p.rx ?? 0}deg) rotateY(${p.ry ?? 0}deg) rotateZ(${p.rz ?? 0}deg) scale(${p.s}) translate3d(${-w / 2}px, ${-h / 2}px, 0px)`;
/** Every card on the track, the centred one included, is turned the same way: a strip of tilted panels. */
const TRACK_YAW = -45;
/** Where one card sits on the 3D track at a (fractional) distance from the centre. Continuous, so a swipe is just pos changing. */
export function poseAtOffset(offset: number, source: Rect): Pose3D {
  const availH = Math.max(180, source.height - PAD_TOP - PAD_Y - LABEL_H);
  const focusScale = clamp(Math.min(0.5, availH / source.height), 0.18, 0.72);
  const distance = Math.abs(offset);
  const near = source.width * focusScale * 0.66;
  // Adjacent cards are a full step apart; further ones bunch up so the strip fits the screen.
  // Past the second card the rest fan out a sliver each at the screen edge: always on screen (so always painted), never crowding.
  const travel = Math.min(distance, 1) + 0.5 * Math.min(Math.max(0, distance - 1), 1) + 0.07 * Math.min(Math.max(0, distance - 2), 5);
  const x = source.width / 2 + Math.sign(offset) * near * travel;
  const y = PAD_TOP + (availH + LABEL_H) / 2 + 6;
  const z = -Math.min(distance, 3) * 80;
  const s = focusScale * (1 - 0.06 * Math.min(distance, 3));
  const angle = TRACK_YAW;
  return { transform: "", scale: s, depth: 100 - Math.round(distance * 10), x, y, z, angle };
}
export function computeTaskViewPoses3D(count: number, pos: number, source: Rect): Pose3D[] {
  return Array.from({ length: count }, (_, index) => {
    const pose = poseAtOffset(index - pos, source);
    return { ...pose, transform: poseTransform({ x: pose.x, y: pose.y, z: pose.z, ry: pose.angle, s: pose.scale }, source.width, source.height) };
  });
}

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
  /** Every app that can be opened from the side dock, and whether it is open now. */
  launchable?: Array<{ id: string; label: string; open: boolean }>;
  onOpenApp?: (id: string) => void;
  /** The apps the layout keeps on screen (panes, floats, docked peeks), so the shell keeps them mounted and live. */
  onPinnedChange?: (ids: string[]) => void;
}>(function WorkspaceTaskView({ open, tabs, activeId, switchDirection = 0, onSelect, onClose, onCloseTab, onReorder, launchable = [], onOpenApp, onPinnedChange }, ref) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [source, setSource] = useState<Rect>(emptyRect);
  const [mode, setMode] = useState<ViewMode>(() => {
    try { return window.localStorage.getItem(MODE_KEY) === "3d" ? "3d" : "2d"; } catch { return "2d"; }
  });
  const changeMode = useCallback((next: ViewMode) => {
    setMode(next);
    try { window.localStorage.setItem(MODE_KEY, next); } catch { /* private window */ }
  }, []);
  const is3d = mode === "3d";
  const [focusIndex, setFocusIndex] = useState(0);
  // The workspace arrangement (split, floating windows, side dock, saved workspaces): one persisted source of truth.
  const [layout, setLayout] = useState<Layout>(() => loadLayout(KNOWN_APPS));
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  const [layoutMotion, setLayoutMotion] = useState(false);
  const layoutMotionTimer = useRef<number | null>(null);
  /** Applies a layout change, easing apps to their new sizes unless the change is a live drag. */
  const commitLayout = useCallback((update: (current: Layout) => Layout, animate = true) => {
    if (animate) {
      setLayoutMotion(true);
      if (layoutMotionTimer.current != null) window.clearTimeout(layoutMotionTimer.current);
      layoutMotionTimer.current = window.setTimeout(() => setLayoutMotion(false), 520);
    }
    setLayout(update);
  }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => saveLayout(layout), 250);
    return () => window.clearTimeout(timer);
  }, [layout]);
  const [dockOpen, setDockOpen] = useState(false);
  const [workspaceMenu, setWorkspaceMenu] = useState(false);
  const [floatOrder, setFloatOrder] = useState<string[]>([]);
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
  const activeIndex = Math.max(0, orderedTabs.findIndex((tab) => tab.id === activeId));
  // Opening Task View in 3D always starts centred on the app you were using.
  const safeFocus = clamp(focusIndex, 0, Math.max(0, orderedTabs.length - 1));

  // The 3D track: one fractional position, moved by a spring. Frames are written straight to the windows (no
  // re-render per frame); React only learns which card is centred. Critically damped, so it eases in and out and
  // never overshoots; light enough to run on every frame with live apps on the track.
  const track = useRef({ pos: 0, vel: 0, target: 0, raf: 0, last: 0, holding: false });
  const sizesRef = useRef(new Map<string, { w: number; h: number }>());
  const orderedIdsRef = useRef<string[]>([]);
  orderedIdsRef.current = orderedTabs.map((tab) => tab.id);
  const centredRef = useRef(0);
  const written = useRef(new Map<string, string>());
  const maxIndex = () => Math.max(0, orderedIdsRef.current.length - 1);
  /** Past either end the track resists, like a rubber band, instead of stopping dead. */
  const rubber = (value: number) => (value < 0 ? value * 0.35 : value > maxIndex() ? maxIndex() + (value - maxIndex()) * 0.35 : value);
  const writeTrack = useCallback(() => {
    const t = track.current;
    orderedIdsRef.current.forEach((id, index) => {
      const el = windowEls.current.get(id);
      if (!el || (dragRef.current?.mode3d && dragRef.current.id === id)) return;
      const pose = poseAtOffset(index - t.pos, sourceRef.current);
      const size = sizesRef.current.get(id) ?? { w: sourceRef.current.width, h: sourceRef.current.height };
      const next = poseTransform({ x: pose.x, y: pose.y, z: pose.z, ry: pose.angle, s: pose.scale }, size.w, size.h);
      // Far cards share one resting place, so most frames only the few near the centre actually change.
      if (written.current.get(id) !== next) { written.current.set(id, next); el.style.setProperty("--tv-t", next); el.style.zIndex = String(pose.depth); }
      // Cards well off the track are not drawn at all, so a crowd of open apps costs the same as a handful. They fade in
      // before they arrive, which also gets them painted in time.
      const distance = Math.abs(index - t.pos);
      const alpha = distance < 3.2 ? "" : distance > 4.2 ? "0" : String(Math.round((1 - (distance - 3.2)) * 100) / 100);
      if (el.style.opacity !== alpha) el.style.opacity = alpha;
    });
    const nearest = clamp(Math.round(t.pos), 0, maxIndex());
    if (nearest !== centredRef.current) { centredRef.current = nearest; setFocusIndex(nearest); }
  }, []);
  // While the track moves, the apps on it hold their CSS animations still (pausing the running animation objects restyles
  // nothing). Every animated layer would otherwise be repainted at full size on every frame, for every open app.
  const frozen = useRef<Animation[]>([]);
  const freezeApps = useCallback(() => {
    if (frozen.current.length || typeof document.getAnimations !== "function") return;
    frozen.current = document.getAnimations().filter((animation) => animation.playState === "running" && (animation.effect as KeyframeEffect | null)?.target?.closest?.(".clyra-task-view__surface"));
    frozen.current.forEach((animation) => animation.pause());
  }, []);
  const thawApps = useCallback(() => {
    frozen.current.forEach((animation) => { try { animation.play(); } catch { /* the element is gone */ } });
    frozen.current = [];
  }, []);
  const stopTrack = useCallback(() => {
    thawApps();
    const t = track.current;
    if (t.raf) cancelAnimationFrame(t.raf);
    t.raf = 0;
    hostRef.current?.setAttribute("data-swiping", "false");
  }, [thawApps]);
  const tick = useCallback((now: number) => {
    const t = track.current;
    const dt = clamp((now - t.last) / 1000, 0.001, 0.034);
    t.last = now;
    if (!t.holding) {
      const stiffness = 64;
      const damping = 2 * Math.sqrt(stiffness);
      t.vel += (-stiffness * (t.pos - t.target) - damping * t.vel) * dt;
      t.pos += t.vel * dt;
      if (Math.abs(t.pos - t.target) < 0.0006 && Math.abs(t.vel) < 0.008) {
        t.pos = t.target;
        t.vel = 0;
        writeTrack();
        stopTrack();
        return;
      }
    }
    writeTrack();
    t.raf = requestAnimationFrame(tick);
  }, [stopTrack, writeTrack]);
  const kickTrack = useCallback(() => {
    const t = track.current;
    // Cards sliding under a still pointer must not churn hover state: one clear, then hover is ignored until it settles.
    if (hostRef.current?.dataset.swiping !== "true") { setHoveredId(null); freezeApps(); }
    hostRef.current?.setAttribute("data-swiping", "true");
    if (!t.raf) { t.last = performance.now(); t.raf = requestAnimationFrame(tick); }
  }, [freezeApps, tick]);
  const goTo = useCallback((index: number) => {
    track.current.holding = false;
    track.current.target = clamp(Math.round(index), 0, maxIndex());
    kickTrack();
  }, [kickTrack]);
  // Opening in 3D always starts centred on the app you were using.
  useEffect(() => {
    if (!open) return;
    track.current.pos = track.current.target = activeIndex;
    track.current.vel = 0;
    centredRef.current = activeIndex;
    setFocusIndex(activeIndex);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => stopTrack(), [stopTrack]);
  // React wrote every window's transform in this render, so the frame writer must not trust what it wrote before.
  written.current.clear();
  // The track's culling (opacity) only applies while the 3D overview is open; every other state gets CSS back in charge.
  useEffect(() => {
    if (is3d && phase === "open") { writeTrack(); return; }
    windowEls.current.forEach((el) => { if (el.style.opacity) el.style.opacity = ""; });
  }, [is3d, phase, writeTrack]);
  const trackPos = track.current.pos;
  const poses3d = is3d ? computeTaskViewPoses3D(orderedTabs.length, trackPos, source) : [];
  /** One card is this many pixels of finger travel. */
  const stepPx = () => Math.max(160, sourceRef.current.width * 0.5 * 0.66 * 0.8);

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
      if (is3d) {
        if (event.key === "ArrowLeft" || event.key === "ArrowUp") { event.preventDefault(); goTo(Math.round(track.current.target) - 1); }
        else if (event.key === "ArrowRight" || event.key === "ArrowDown") { event.preventDefault(); goTo(Math.round(track.current.target) + 1); }
        else if (event.key === "Enter") { const tab = orderedTabs[clamp(Math.round(track.current.target), 0, maxIndex())]; if (tab) { event.preventDefault(); select(tab.id); } }
        return;
      }
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
  }, [activeId, cards, closeToActive, goTo, hoveredId, is3d, orderedTabs, phase, select]);

  // Trackpad and wheel: the track follows the fingers one to one, then eases to the nearest card when they lift (the
  // trackpad's own momentum keeps the idle timer waiting, so the glide stays continuous).
  useEffect(() => {
    if (!is3d || phase !== "open") return;
    const node = hostRef.current;
    if (!node) return;
    let idle = 0;
    let lastT = performance.now();
    const onWheel = (event: WheelEvent) => {
      if ((event.target as Element | null)?.closest?.(".clyra-tv-menu, .clyra-tv-dock")) return;
      event.preventDefault();
      const t = track.current;
      const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
      const now = performance.now();
      const step = delta / stepPx();
      t.holding = true;
      t.pos = rubber(t.pos + step);
      t.vel = t.vel * 0.7 + (step / Math.max(8, now - lastT)) * 1000 * 0.3;
      lastT = now;
      kickTrack();
      window.clearTimeout(idle);
      idle = window.setTimeout(() => { t.holding = false; t.target = clamp(Math.round(t.pos + t.vel * 0.12), 0, maxIndex()); kickTrack(); }, 90);
    };
    node.addEventListener("wheel", onWheel, { passive: false });
    return () => { node.removeEventListener("wheel", onWheel); window.clearTimeout(idle); };
  }, [is3d, kickTrack, phase]);

  // Drag to reorder. The dragged window follows the pointer 1:1 (its transform is written straight to the element,
  // no transition, no re-render per move); React only re-renders when the slot under it changes, which slides the
  // neighbours aside. On release it eases into its slot.
  const cardsRef = useRef(cards);
  cardsRef.current = cards;
  const posesRef = useRef(poses3d);
  posesRef.current = poses3d;
  const sourceRef = useRef(source);
  sourceRef.current = source;
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
    if (drag.mode3d) {
      const now = performance.now();
      const dt = Math.max(8, now - drag.lastT);
      drag.vx += ((event.clientX - drag.lastX) / dt * 1000 - drag.vx) * 0.35;
      drag.vy += ((event.clientY - drag.lastY) / dt * 1000 - drag.vy) * 0.35;
      drag.lastX = event.clientX; drag.lastY = event.clientY; drag.lastT = now;
      // The arc slot whose centre is nearest the card decides where it will land; the arc follows it.
      const centreX = drag.cx + drag.dx;
      const centreY = drag.cy + drag.dy;
      const ids = orderedIdsRef.current;
      let slot = 0;
      let nearestGap = Infinity;
      posesRef.current.forEach((pose, index) => { const gap = Math.abs(pose.x - centreX); if (gap < nearestGap) { nearestGap = gap; slot = index; } });
      setLiveOrder((current) => {
        const base = current ?? tabs.map((tab) => tab.id);
        const from = base.indexOf(drag.id);
        if (from === -1 || from === slot) return current ?? base;
        const next = base.slice();
        next.splice(from, 1);
        next.splice(slot, 0, drag.id);
        return next;
      });
      goTo(slot);
      return;
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
  }, [goTo, tabs]);
  const liveOrderRef = useRef(liveOrder);
  liveOrderRef.current = liveOrder;
  const onDragEnd = useCallback(() => {
    const drag = dragRef.current;
    dragRef.current = null;
    window.removeEventListener("pointermove", onDragMove);
    window.removeEventListener("pointerup", onDragEnd);
    window.removeEventListener("pointercancel", onDragEnd);
    if (drag?.raf) cancelAnimationFrame(drag.raf);
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
    const pose = is3d ? poses3d[index] : undefined;
    const origin = is3d ? { left: 0, top: 0, width: sourceRef.current.width, height: sourceRef.current.height } : cards[index];
    if (!origin || (is3d && !pose)) return;
    const drag: Drag = { id: tab.id, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, origin, dx: 0, dy: 0, moved: false, mode3d: is3d, cx: pose?.x ?? 0, cy: pose?.y ?? 0, s: pose?.scale ?? 1, lastX: event.clientX, lastY: event.clientY, lastT: performance.now(), vx: 0, vy: 0, tx: 0, ty: 0, tz: 0, raf: 0 };
    dragRef.current = drag;
    if (is3d) {
      // The pointer position is written straight to the card; only the tilt is eased, towards what the velocity asks for.
      const tick = () => {
        if (dragRef.current !== drag) return;
        if (performance.now() - drag.lastT > 40) { drag.vx *= 0.86; drag.vy *= 0.86; }
        const clampTo = (value: number, limit: number) => Math.max(-limit, Math.min(limit, value));
        drag.ty += (clampTo(drag.vx * 0.016, TILT_Y) - drag.ty) * 0.16;
        drag.tx += (clampTo(-drag.vy * 0.012, TILT_X) - drag.tx) * 0.16;
        drag.tz += (clampTo(drag.vx * 0.003, TILT_Z) - drag.tz) * 0.16;
        if (drag.moved) windowEls.current.get(drag.id)?.style.setProperty("--tv-t", dragPose3d(drag, sourceRef.current.width, sourceRef.current.height));
        drag.raf = requestAnimationFrame(tick);
      };
      drag.raf = requestAnimationFrame(tick);
    }
    window.addEventListener("pointermove", onDragMove);
    window.addEventListener("pointerup", onDragEnd);
    window.addEventListener("pointercancel", onDragEnd);
  }, [cards, exitingTab, is3d, onDragEnd, onDragMove, poses3d, selectingId]);

  /** Press on the track: drag sideways to swipe through the apps, or hold a card to lift it for reordering or splitting. */
  const startGesture = useCallback((event: ReactPointerEvent<HTMLElement>, tab?: TaskViewTab, index?: number) => {
    if (!is3d || phaseRef.current !== "open" || selectingId || exitingTab || event.button !== 0) return;
    const t = track.current;
    const startX = event.clientX;
    const startY = event.clientY;
    const startPos = t.pos;
    let mode: "pending" | "swipe" | "lift" = "pending";
    let lastX = startX;
    let lastT = performance.now();
    const detach = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
    const hold = tab && index != null
      ? window.setTimeout(() => { if (mode === "pending") { mode = "lift"; detach(); startDrag(tab, index, event as ReactPointerEvent<HTMLButtonElement>); } }, 320)
      : 0;
    function move(e: PointerEvent) {
      if (mode === "lift") return;
      if (mode === "pending") {
        if (Math.abs(e.clientX - startX) < 6 && Math.abs(e.clientY - startY) < 6) return;
        mode = "swipe";
        window.clearTimeout(hold);
        t.holding = true;
        t.vel = 0;
        kickTrack();
      }
      const now = performance.now();
      const dt = Math.max(8, now - lastT);
      t.vel = t.vel * 0.6 + (-(e.clientX - lastX) / stepPx() / dt * 1000) * 0.4;
      t.pos = rubber(startPos - (e.clientX - startX) / stepPx());
      lastX = e.clientX;
      lastT = now;
    }
    function up() {
      detach();
      window.clearTimeout(hold);
      if (mode !== "swipe") return;
      t.holding = false;
      t.target = clamp(Math.round(t.pos + t.vel * 0.2), 0, maxIndex());
      suppressClickRef.current = true;
      window.setTimeout(() => { suppressClickRef.current = false; }, 0);
      kickTrack();
    }
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  }, [exitingTab, is3d, kickTrack, selectingId, startDrag]);

  const overview = phase === "opening" || phase === "open";
  const frontId = selectingId ?? activeId;
  const tabIds = useMemo(() => tabs.map((tab) => tab.id), [tabs]);
  const roles = useMemo(() => resolveRoles(layout, tabIds, frontId, source), [frontId, layout, source, tabIds]);
  // Apps the layout keeps on screen stay mounted and live for the shell.
  useEffect(() => {
    const ids = tabIds.filter((id) => { const kind = roles.get(id)?.kind; return kind === "float" || kind === "dock"; });
    onPinnedChange?.(ids);
  }, [onPinnedChange, roles, tabIds]);
  const stageW = Math.max(1, source.width);
  const stageH = Math.max(1, source.height);
  const raiseFloat = useCallback((id: string) => setFloatOrder((order) => [...order.filter((entry) => entry !== id), id]), []);
  const trackPointer = useCallback((move: (event: PointerEvent) => void, done?: (event: PointerEvent) => void) => {
    const up = (event: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      done?.(event);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  }, []);
  /** Drag a floating window by its bar. Releasing it against the right edge tucks it into the dock. */
  const startFloatMove = useCallback((id: string, event: ReactPointerEvent<HTMLElement>) => {
    const start = layoutRef.current.floats[id];
    if (!start || event.button !== 0) return;
    event.preventDefault();
    raiseFloat(id);
    const originX = event.clientX;
    const originY = event.clientY;
    trackPointer(
      (move) => commitLayout((current) => (current.floats[id] ? { ...current, floats: { ...current.floats, [id]: clampFloat({ ...start, x: start.x + (move.clientX - originX) / stageW, y: start.y + (move.clientY - originY) / stageH }) } } : current), false),
      (end) => { if (end.clientX > (hostRef.current?.getBoundingClientRect().right ?? Infinity) - 20) commitLayout((current) => dockApp(current, id)); },
    );
  }, [commitLayout, raiseFloat, stageH, stageW, trackPointer]);
  const startFloatResize = useCallback((id: string, event: ReactPointerEvent<HTMLElement>) => {
    const start = layoutRef.current.floats[id];
    if (!start || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    raiseFloat(id);
    const originX = event.clientX;
    const originY = event.clientY;
    trackPointer((move) => commitLayout((current) => (current.floats[id] ? { ...current, floats: { ...current.floats, [id]: clampFloat({ ...start, w: start.w + (move.clientX - originX) / stageW, h: start.h + (move.clientY - originY) / stageH }) } } : current), false));
  }, [commitLayout, raiseFloat, stageH, stageW, trackPointer]);
  // The overview toolbar acts on one app: the centred one in 3D, the hovered one in 2D.
  const targetId = is3d ? orderedTabs[safeFocus]?.id : hoveredId ?? activeId;
  const targetState = targetId ? (layout.floats[targetId] ? "float" : layout.docked.includes(targetId) ? "dock" : "free") : "free";
  const toggleFloat = useCallback(() => { if (targetId) commitLayout((current) => (current.floats[targetId] ? detach(current, targetId) : floatApp(current, targetId))); }, [commitLayout, targetId]);
  const toggleDock = useCallback(() => { if (targetId) commitLayout((current) => (current.docked.includes(targetId) ? detach(current, targetId) : dockApp(current, targetId))); }, [commitLayout, targetId]);
  const [workspaceName, setWorkspaceName] = useState("");
  const [ghost, setGhost] = useState<{ label: string; x: number; y: number } | null>(null);
  /** Drag an app out of the side dock: dropped on the stage it opens as a floating window right there. */
  const startDockDrag = useCallback((item: { id: string; label: string; open: boolean }, event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    const originX = event.clientX;
    const originY = event.clientY;
    let moved = false;
    trackPointer(
      (move) => {
        if (!moved && Math.hypot(move.clientX - originX, move.clientY - originY) < 5) return;
        moved = true;
        setGhost({ label: item.label, x: move.clientX, y: move.clientY });
      },
      (end) => {
        setGhost(null);
        const rect = hostRef.current?.getBoundingClientRect();
        if (!moved || !rect || end.clientX - rect.left < 260) {
          // A plain click: bring an open app forward, or open a closed one beside the rest.
          if (!moved) { if (item.open) select(item.id); else { onOpenApp?.(item.id); commitLayout((current) => floatApp(current, item.id)); } }
          return;
        }
        if (!item.open) onOpenApp?.(item.id);
        commitLayout((current) => floatApp(current, item.id, clampFloat({ x: (end.clientX - rect.left) / rect.width - 0.18, y: (end.clientY - rect.top) / rect.height - 0.05, w: 0.36, h: 0.46 })));
      },
    );
  }, [commitLayout, onOpenApp, select, trackPointer]);
  const savedNames = Object.keys(layout.saved);
  const visibleTabs = exitingTab ? [...orderedTabs, exitingTab.tab] : orderedTabs;
  // Windows stay in the DOM in the order they first appeared; the visible order is only ever a transform. A keyed
  // reorder would physically move an app's subtree, cancelling its running animations and restyling all of it.
  const domOrder = domOrderRef.current;
  for (const tab of visibleTabs) if (!domOrder.includes(tab.id)) domOrder.push(tab.id);
  for (let i = domOrder.length - 1; i >= 0; i -= 1) if (!visibleTabs.some((tab) => tab.id === domOrder[i])) domOrder.splice(i, 1);
  const slotOf = new Map(visibleTabs.map((tab, index) => [tab.id, index]));
  const stableTabs = domOrder.map((id) => visibleTabs[slotOf.get(id)!]);

  return <div ref={hostRef} className={cn("clyra-task-view", overview && "clyra-task-view--open", phase === "closing" && "clyra-task-view--closing")} data-task-view-phase={phase} data-mode={mode} data-task-view-selecting={selectingId ? "true" : "false"} data-switching={switchAnim ? "true" : "false"} data-layout-motion={layoutMotion ? "true" : "false"} data-swiping="false">
    {/* The backdrop, dismiss layer and close buttons are always in the tree. Inserting them on open would change the
        windows' sibling positions (:last-child and friends), which restyles every element of every app. */}
    <div className="clyra-task-view__backdrop" aria-hidden />
    <button type="button" aria-label="Close Task View" className="clyra-task-view__dismiss" onClick={() => { if (!suppressClickRef.current) closeToActive(); }} onPointerDown={(event) => startGesture(event)} tabIndex={-1} />
    {!tabs.length ? <div className="clyra-task-view__empty">No open apps · Press ⌘K to open one</div> : null}
    {stableTabs.map((tab) => {
      const index = slotOf.get(tab.id)!;
      const isExiting = exitingTab?.tab.id === tab.id;
      const target = isExiting ? exitingTab.target : cards[index] ?? source;
      const cardScale = isExiting ? exitingTab.scale : is3d ? poses3d[index]?.scale ?? scale : scale;
      const isActive = tab.id === activeId;
      const role: Role = roles.get(tab.id) ?? { kind: "hidden" };
      const isLead = tab.id === frontId && !isExiting;
      // Shown in the working view: the active app, a pane of the split, or a floating window.
      const isFront = !isExiting && (role.kind === "full" || role.kind === "float");
      const isPeek = role.kind === "dock";
      const own = role.kind === "float" ? role.rect : null;
      const winW = own?.width ?? source.width;
      const winH = own?.height ?? source.height;
      sizesRef.current.set(tab.id, { w: winW, h: winH });
      const isDragging = draggingId === tab.id;
      const isLeaving = phase === "closed" && (leavingId === tab.id || switchAnim?.from === tab.id) && !isFront;
      // Unseen windows stay fully rendered at opacity 0. Hiding them with visibility or content-visibility looks
      // cheaper but costs far more when Task View reveals them (a full restyle of the app, measured at 0.1–1 s).
      const drag = isDragging ? dragRef.current : null;
      const pose = is3d ? poses3d[index] : undefined;
      // A window with its own size (a pane or float) sits centred in its overview cell.
      const cell = own && !pose ? { ...target, left: target.left + (target.width - winW * cardScale) / 2, top: target.top + (target.height - winH * cardScale) / 2 } : target;
      const openTransform = drag?.mode3d
        ? dragPose3d(drag, winW, winH)
        : pose
        ? poseTransform({ x: pose.x, y: pose.y, z: pose.z, ry: pose.angle, s: pose.scale }, winW, winH)
        : drag
        ? placed({ ...drag.origin, left: drag.origin.left + drag.dx, top: drag.origin.top + drag.dy }, cardScale)
        : placed(cell, cardScale);
      const contentInteractive = !isExiting && phase === "closed" && isFront;
      const hitAreaInteractive = (!isExiting && overview && !selectingId) || (phase === "closed" && isPeek);

      // The two-workspace slide. Both windows travel the full viewport width in
      // opposite directions from one shared eased progress: outgoing goes to
      // -dir×W, incoming arrives from +dir×W. Everything else stays recessed.
      const width = Math.max(1, source.width);
      const sliding = phase === "closed" && switchAnim != null;
      let closedTransform: string;
      let closedTransition: string | undefined;
      let closedWillChange: string | undefined;
      if (sliding && isLead && role.kind === "full") {
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
        const at = own ?? { left: 0, top: 0, width: source.width, height: source.height };
        const flat = poseTransform({ x: at.left + at.width / 2, y: at.top + at.height / 2, z: 0, s: 1 }, winW, winH);
        const sunk = poseTransform({ x: source.width / 2, y: source.height / 2, z: -60, s: 0.965 }, winW, winH);
        if (isPeek) {
          // Docked: a slim sliver of the live app at the right edge, stacked, turned slightly toward the screen.
          const peekScale = 0.2;
          const left = source.width - 26;
          const top = 96 + (role.kind === "dock" ? role.order : 0) * (source.height * peekScale + 16);
          closedTransform = is3d ? poseTransform({ x: left + (winW * peekScale) / 2, y: top + (winH * peekScale) / 2, z: 40, ry: -14, s: peekScale }, winW, winH) : `translate3d(${left}px, ${top}px, 0) scale(${peekScale})`;
        } else if (own) {
          closedTransform = is3d ? flat : `translate3d(${own.left}px, ${own.top}px, 0) scale(1)`;
        } else {
          closedTransform = is3d ? (isFront || isLeaving ? flat : sunk) : isFront || isLeaving ? FULL : recessed(target, cardScale);
        }
      }
      const style = {
        width: winW,
        height: winH,
        zIndex: is3d && overview && poses3d[index] ? poses3d[index].depth : isDragging ? 8 : selectingId === tab.id ? 6 : role.kind === "float" ? 20 + Math.max(0, floatOrder.indexOf(tab.id)) : isPeek ? 30 : isFront ? 3 : isLeaving ? 2 : 1,
        "--tv-i": index,
        "--tv-t": openTransform,
        "--tv-closed": closedTransform,
        "--task-view-target-scale": String(cardScale),
        transition: closedTransition,
        willChange: closedWillChange,
        // Both sliding windows stay fully opaque — a clean spatial pass with no
        // cross-fade. The outgoing window is off-screen by the time it snaps to
        // its recessed pose, so the later opacity drop is invisible.
        opacity: isFront || overview || isLeaving || isPeek ? undefined : 0,
      } as CSSProperties;
      return (
        <div
          key={tab.id}
          ref={(el) => { if (el) windowEls.current.set(tab.id, el); else windowEls.current.delete(tab.id); }}
          className={cn("clyra-task-view__window", isActive && "is-active", isFront && "is-front", role.kind === "float" && "is-float", isPeek && "is-peek", isLeaving && "is-leaving", hoveredId === tab.id && "is-hovered", selectingId === tab.id && "is-selected", isExiting && "is-closing-tab", isDragging && "is-dragging")}
          style={style}
          onPointerDownCapture={role.kind === "float" && phase === "closed" ? () => raiseFloat(tab.id) : undefined}
          onPointerEnter={overview && !isExiting ? () => { if (hostRef.current?.dataset.swiping !== "true") setHoveredId(tab.id); } : undefined}
          onPointerLeave={overview && !isExiting ? () => setHoveredId((current) => (current === tab.id ? null : current)) : undefined}
        >
          <button
            type="button"
            aria-label={`Switch to ${tab.label}`}
            aria-current={isActive ? "true" : undefined}
            className="clyra-task-view__hit-area"
            style={{ pointerEvents: hitAreaInteractive ? "auto" : "none" }}
            tabIndex={hitAreaInteractive ? 0 : -1}
            onPointerDown={(event) => { if (hitAreaInteractive && windowEls.current.get(tab.id)?.style.opacity !== "0") { if (is3d) startGesture(event, tab, index); else startDrag(tab, index, event); } }}
            onClick={() => {
              if (suppressClickRef.current || windowEls.current.get(tab.id)?.style.opacity === "0") return;
              if (isPeek && phase === "closed") { commitLayout((current) => floatApp(current, tab.id)); raiseFloat(tab.id); return; }
              if (is3d && index !== clamp(Math.round(track.current.target), 0, maxIndex())) goTo(index);
              else select(tab.id);
            }}
          />
          {/* inert keeps keyboard focus out of apps you can't see. It follows the front app only (not the Task View
              phase), so opening Task View never flips it — flipping it restyles the whole app. */}
          <div className="clyra-task-view__surface" style={{ pointerEvents: contentInteractive ? "auto" : "none" }} inert={!isFront && !isLeaving ? true : undefined}>
            <BloubPauseContext.Provider value={!isActive}>{tab.content}</BloubPauseContext.Provider>
          </div>
          <div className="clyra-task-view__label" aria-hidden>{tab.label}{layout.floats[tab.id] ? " · Floating" : layout.docked.includes(tab.id) ? " · Docked" : ""}</div>
          {role.kind === "float" && phase === "closed" ? (
            <>
              <div className="clyra-tv-float-bar" onPointerDown={(event) => startFloatMove(tab.id, event)}>
                <span className="clyra-tv-float-bar__grip" aria-hidden />
                <button type="button" aria-label={`Open ${tab.label} full size`} title="Full size" onPointerDown={(event) => event.stopPropagation()} onClick={() => { commitLayout((current) => detach(current, tab.id)); select(tab.id); }}><ArrowLeftRight aria-hidden /></button>
                <button type="button" aria-label={`Dock ${tab.label}`} title="Tuck into the edge" onPointerDown={(event) => event.stopPropagation()} onClick={() => commitLayout((current) => dockApp(current, tab.id))}><PanelRightClose aria-hidden /></button>
                <button type="button" aria-label={`Stop floating ${tab.label}`} title="Back to the stage" onPointerDown={(event) => event.stopPropagation()} onClick={() => commitLayout((current) => detach(current, tab.id))}><X aria-hidden /></button>
              </div>
              <div className="clyra-tv-float-resize" onPointerDown={(event) => startFloatResize(tab.id, event)} aria-hidden />
            </>
          ) : null}
        </div>
      );
    })}
    <div className="clyra-task-view__chrome">
      <div className="clyra-task-view__mode" role="radiogroup" aria-label="Task View layout" data-open={overview ? "true" : "false"}>
        {(["2d", "3d"] as const).map((value) => (
          <button key={value} type="button" role="radio" aria-checked={mode === value} data-active={mode === value} tabIndex={phase === "open" ? 0 : -1} onClick={() => changeMode(value)}>{value.toUpperCase()}</button>
        ))}
      </div>
      <div className="clyra-tv-toolbar" data-open={phase === "open" ? "true" : "false"} role="toolbar" aria-label="Arrange the selected app">
        <button type="button" data-on={targetState === "float"} onClick={toggleFloat} tabIndex={phase === "open" ? 0 : -1} title="Float above the others"><PictureInPicture2 aria-hidden /><span>{targetState === "float" ? "Unfloat" : "Float"}</span></button>
        <button type="button" data-on={targetState === "dock"} onClick={toggleDock} tabIndex={phase === "open" ? 0 : -1} title="Tuck into the edge"><PanelRightClose aria-hidden /><span>{targetState === "dock" ? "Restore" : "Dock"}</span></button>
        <span className="clyra-tv-toolbar__rule" aria-hidden />
        <button type="button" data-on={workspaceMenu} onClick={() => setWorkspaceMenu((value) => !value)} tabIndex={phase === "open" ? 0 : -1} title="Saved workspaces"><Bookmark aria-hidden /><span>Workspaces</span></button>
        {workspaceMenu && phase === "open" ? (
          <div className="clyra-tv-menu" role="menu">
            {savedNames.length ? savedNames.map((name) => (
              <div key={name} className="clyra-tv-menu__row">
                <button type="button" role="menuitem" onClick={() => { commitLayout((current) => applyWorkspace(current, name, KNOWN_APPS)); setWorkspaceMenu(false); }}>{name}</button>
                <button type="button" aria-label={`Delete ${name}`} onClick={() => commitLayout((current) => deleteWorkspace(current, name), false)}><Trash2 aria-hidden /></button>
              </div>
            )) : <p className="clyra-tv-menu__empty">No saved workspaces yet.</p>}
            <form className="clyra-tv-menu__save" onSubmit={(event) => { event.preventDefault(); if (workspaceName.trim()) { commitLayout((current) => saveWorkspace(current, workspaceName), false); setWorkspaceName(""); } }}>
              <input value={workspaceName} onChange={(event) => setWorkspaceName(event.target.value)} placeholder="Name this arrangement" maxLength={40} aria-label="Workspace name" />
              <button type="submit" aria-label="Save workspace" disabled={!workspaceName.trim()}><Check aria-hidden /></button>
            </form>
          </div>
        ) : null}
      </div>
      <div className="clyra-tv-dock-zone" data-open={dockOpen ? "true" : "false"} onPointerEnter={phase === "open" ? () => setDockOpen(true) : undefined} onPointerLeave={() => setDockOpen(false)}>
        <span className="clyra-tv-dock-zone__handle" aria-hidden />
        <div className="clyra-tv-dock" aria-label="Apps">
          {launchable.map((item) => {
            const state = layout.floats[item.id] ? "floating" : layout.docked.includes(item.id) ? "docked" : item.open ? "open" : "";
            return (
              <button key={item.id} type="button" className="clyra-tv-dock__item" data-open={item.open} onPointerDown={(event) => startDockDrag(item, event)} tabIndex={dockOpen ? 0 : -1}>
                <span className="clyra-tv-dock__dot" aria-hidden />
                <span className="clyra-tv-dock__label">{item.label}</span>
                {state ? <span className="clyra-tv-dock__state">{state}</span> : null}
              </button>
            );
          })}
        </div>
      </div>
      {ghost ? <div className="clyra-tv-ghost" style={{ left: ghost.x, top: ghost.y }}>{ghost.label}</div> : null}
      {is3d ? null : orderedTabs.map((tab, index) => {
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
