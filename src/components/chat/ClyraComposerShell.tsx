/**
 * Clyra "Composer" chat shell — ported from the Claude Design Canvas artboard
 * `Clyra Composer (standalone).html` (sidebar, welcome header, composer bar,
 * "/" source palette, effort menu, file chips, dictation waveform, Connections
 * panel). Visual chrome only: every piece of data/behavior is supplied by the
 * caller (src/App.tsx) via props, wired to Clyra's real backend. The message
 * transcript itself is rendered by the caller (AnimatedMessage etc.) and
 * passed in as `transcript` — this component only supplies the surrounding
 * scroll container, welcome state and bubble-entrance animation hook.
 */
import React, {
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ArrowUp } from "lucide-react";
import { VoiceWaveIcon } from "../voice/VoiceWaveIcon";
import { ClyraFace } from "../../voice/ClyraFace";
import { setOrbAnchor } from "../../voice/orbAnchor";
import { FlowComposerOverlay, type FlowSession } from "./FlowComposerOverlay";
import { EffortSlider } from "./EffortSlider";
import {
  canStartDictation,
  formatDictationElapsed,
  isDictationHold,
  isDictationSessionOpen,
  type ComposerDictationPhase,
} from "../../lib/composerDictation";

export type ChatEffortLevel = "light" | "medium" | "high" | "max";

export interface ComposerEffortOption {
  value: ChatEffortLevel;
  label: string;
  hint: string;
  icon: ReactNode;
  onPick: () => void;
}

export interface ComposerFileItem {
  id: string;
  name: string;
  meta: string;
  thumb?: ReactNode;
  onOpen?: () => void;
  onRemove: () => void;
}

export interface ComposerSource {
  id: string;
  name: string;
  short: string;
  icon: ReactNode;
  disabled?: boolean;
}

export interface ComposerPaletteItem {
  id: string;
  label: string;
  desc: string;
  icon: ReactNode;
  added?: boolean;
  onPick: () => void;
}

/** A command or agent that has been placed in the composer for this turn. */
export interface ComposerSelection {
  id: string;
  label: string;
  icon: ReactNode;
  onRemove: () => void;
}

/** A clickable quick-start on the welcome screen — fills the composer, doesn't send. */
export interface ComposerSuggestion {
  id: string;
  label: string;
  /** A concrete outcome makes the welcome surface useful before a
   * conversation exists. The action still only fills the composer. */
  description?: string;
  icon: ReactNode;
  onPick: () => void;
}

export interface ComposerChatRow {
  id: string;
  group: "Today" | "Previous 7 days" | "Earlier";
  title: string;
  when: string;
  /** Last message in the conversation, trimmed for a one-line preview. */
  preview?: string;
}

export interface ComposerConnectionScope {
  id: string;
  name: string;
  icon: ReactNode;
  enabled: boolean;
  onToggle: () => void;
}

export interface ComposerConnectionsState {
  /** True when either the Electron desktop bridge or the server's real web
   *  OAuth (CLYRA_GOOGLE_CLIENT_ID/SECRET configured) can sign the user in. */
  signInAvailable: boolean;
  connected: boolean;
  connecting: boolean;
  /** Shown under the row while connecting — e.g. "A new browser tab was
   *  opened for Google sign-in" for the web OAuth flow. */
  connectNote?: string | null;
  email: string | null;
  onConnect: () => void;
  onDisconnect: () => void;
  scopes: ComposerConnectionScope[];
  webSearchEnabled: boolean;
  onToggleWebSearch: () => void;
}

export interface ComposerDictationState {
  phase: ComposerDictationPhase;
  level: number; // 0..1, real microphone level
  elapsedSeconds: number; // real recording clock, supplied by the capture session
  /** Latest real status or error message from the capture session. */
  detail?: string;
  /** Starts recording (tap, or press-and-hold). */
  onStart: () => void;
  /** Ends recording and transcribes it; the transcript fills the composer. */
  onStop: () => void;
  /** Discards the audio and any partial text; the existing draft is kept. */
  onCancel?: () => void;
  /** Present while the desktop app's Flow engine is driving this dictation (live words, edits, final text). */
  flow?: FlowSession | null;
}

export interface ClyraComposerShellProps {
  userName: string;
  accentColor?: string;

  text: string;
  onTextChange: (value: string) => void;
  onKeyDown: (e: KeyboardEvent<HTMLTextAreaElement>) => void;
  onSend: () => void;
  /** Controls pinned over the visible transcript, outside its scroll content. */
  transcriptOverlay?: ReactNode;
  /** True while a reply streams; the send control then becomes Stop. */
  isResponding?: boolean;
  /** Cancels the reply in progress (the Stop control and Escape). */
  onStop?: () => void;
  /** Enters the full Clyra Voice Call using the same conversation context. */
  onStartVoiceCall?: () => void;
  canSend?: boolean;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  placeholder?: string;

  sent: boolean;
  temp: boolean;
  onToggleTemp: () => void;

  efforts: ComposerEffortOption[];
  currentEffort: ChatEffortLevel;

  sources: ComposerSource[];
  activeSourceIds: string[];
  onToggleSource: (id: string) => void;

  paletteOpen: boolean;
  paletteItems: ComposerPaletteItem[];
  paletteQuery: string;
  /** Keyboard-selected (ArrowUp/ArrowDown) palette row; also updated on hover
   *  so the two stay in sync — matches Spotlight/VSCode-style palettes. */
  paletteActiveIndex?: number;
  onPaletteHoverIndex?: (index: number) => void;

  /** Persistent selections live above the input, so multiple agents remain
   * visible, ordered, and individually removable before send. */
  selections?: ComposerSelection[];

  /** Welcome-screen quick-starts, shown under the composer bar until a
   * conversation starts. Each click fills the draft; it never sends. */
  suggestions?: ComposerSuggestion[];

  files: ComposerFileItem[];
  onPickFiles: () => void;
  fileInputRef: RefObject<HTMLInputElement | null>;
  onFilesSelected: (event: React.ChangeEvent<HTMLInputElement>) => void;

  dictation: ComposerDictationState;

  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  /** false hides the shell's own "Chats" drawer and its toggle (Chat uses the app-level sidebar instead). */
  historyPanel?: boolean;
  /** Opens the app-wide settings sheet from the persistent sidebar footer. */
  onOpenSettings: () => void;
  chats: ComposerChatRow[];
  onNewChat: () => void;
  onOpenChat: (id: string) => void;
  onRenameChat: (id: string, title: string) => void;
  onDeleteChat: (id: string) => void;
  sideQuery: string;
  onSideQueryChange: (v: string) => void;

  usage: { count: string; label: string; pct: number } | null;

  connections: ComposerConnectionsState;

  transcript: ReactNode;
  /** Applied to the transcript scroll container so existing
   *  `document.getElementById("chat-container")` scroll-tracking code keeps working unchanged. */
  transcriptContainerId?: string;
  transcriptContainerRef?: RefObject<HTMLDivElement | null>;
}

const EASE = "cubic-bezier(.2,.8,.3,1)";
const SHELL_EASE = "cubic-bezier(.32,.72,0,1)";

/**
 * The Composer artboard's two easings, exported so other Clyra surfaces move
 * the same way as chat rather than inventing their own curves. `COMPOSER_EASE`
 * is the bar/control curve; `COMPOSER_SHELL_EASE` is the slower shell curve
 * used for panel growth and reply entrances.
 */
export const COMPOSER_EASE = EASE;
export const COMPOSER_SHELL_EASE = SHELL_EASE;

function px(n: number) {
  return `${n}px`;
}

export function chatBubbleStyle(role: "user" | "assistant"): CSSProperties {
  if (role === "user") {
    // Matches the artboard's t.rowStyle exactly — only the user row itself
    // is animated (clyraBubbleIn); the bubble inside just sits still.
    return {
      display: "flex",
      justifyContent: "flex-end",
      width: "100%",
      animation: "clyraBubbleIn 1.15s cubic-bezier(.16,.86,.2,1) both",
    };
  }
  // The artboard's reply row is a PLAIN, un-animated flex row — the
  // animation (clyraReplyIn) lives only on the inner reply content div
  // (see assistantBubbleInnerStyle usage in App.tsx). Animating both here
  // and there doubles the motion, which is exactly what looked "off".
  return {
    display: "flex",
    justifyContent: "flex-start",
    width: "100%",
  };
}

export const userBubbleInnerStyle: CSSProperties = {
  maxWidth: "72%",
  padding: "11px 16px",
  borderRadius: 20,
  background: "rgba(16,18,24,0.055)",
  color: "#15171C",
  fontSize: 14.5,
  lineHeight: 1.5,
  letterSpacing: "-0.01em",
  // Matches the reference artboard's bubbleStyle exactly (`text-wrap:pretty`).
  textWrap: "pretty" as CSSProperties["textWrap"],
};

export const assistantBubbleInnerStyle: CSSProperties = {
  maxWidth: "78%",
  padding: "2px 4px",
  fontSize: 14.5,
  lineHeight: 1.55,
  letterSpacing: "-0.01em",
  color: "#15171C",
};

/**
 * The small, transportable centre of the Clyra Chat composer.  Surfaces such
 * as Cowork use this rather than redrawing a message input: it keeps the same
 * resize behaviour, motion curve, keyboard contract and focus treatment as
 * the full Clyra Chat shell without importing the shell's own sidebar.
 */
export interface ClyraChatComposerBarProps {
  text: string;
  onTextChange: (text: string) => void;
  onSubmit: () => void;
  onKeyDown?: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  placeholder?: string;
  disabled?: boolean;
  textareaRef?: RefObject<HTMLTextAreaElement | null>;
  leading?: ReactNode;
  popover?: ReactNode;
}

export function ClyraChatComposerBar({
  text,
  onTextChange,
  onSubmit,
  onKeyDown,
  placeholder = "Message Clyra",
  disabled = false,
  textareaRef,
  leading,
  popover,
}: ClyraChatComposerBarProps) {
  const internalRef = useRef<HTMLTextAreaElement | null>(null);
  const ref = textareaRef || internalRef;
  const reduceMotion = useReducedMotion();
  useLayoutEffect(() => {
    const textarea = ref.current;
    if (!textarea) return;
    textarea.style.height = "0px";
    textarea.style.height = `${Math.min(136, Math.max(24, textarea.scrollHeight))}px`;
  }, [ref, text]);
  return (
    <div className="cc-shared-composer-wrap">
      {popover}
      <motion.div
        className="cc-shared-composer"
        layout
        transition={
          reduceMotion
            ? { duration: 0 }
            : { duration: 0.2, ease: [0.2, 0.8, 0.3, 1] }
        }
      >
        {leading}
        <textarea
          ref={ref}
          rows={1}
          value={text}
          disabled={disabled}
          placeholder={placeholder}
          onChange={(event) => onTextChange(event.target.value)}
          onKeyDown={onKeyDown}
        />
        <button
          type="button"
          className="cc-shared-composer-send"
          aria-label="Send message"
          disabled={disabled || !text.trim()}
          onClick={onSubmit}
        >
          <ArrowUp size={15} strokeWidth={2.2} />
        </button>
      </motion.div>
    </div>
  );
}

export default function ClyraComposerShell(props: ClyraComposerShellProps) {
  const {
    userName,
    accentColor = "#1E6FFF",
    text,
    onTextChange,
    onKeyDown,
    onSend,
    transcriptOverlay,
    isResponding = false,
    onStop,
    onStartVoiceCall,
    canSend = Boolean(text.trim()),
    textareaRef,
    placeholder = "Message Clyra",
    sent,
    temp,
    onToggleTemp,
    efforts,
    currentEffort,
    sources,
    activeSourceIds,
    onToggleSource,
    paletteOpen,
    paletteItems,
    paletteQuery,
    paletteActiveIndex = -1,
    onPaletteHoverIndex,
    selections = [],
    suggestions = [],
    files,
    onPickFiles,
    fileInputRef,
    onFilesSelected,
    dictation,
    sidebarOpen,
    historyPanel = true,
    onToggleSidebar,
    onOpenSettings,
    chats,
    onNewChat,
    onOpenChat,
    onRenameChat,
    onDeleteChat,
    sideQuery,
    onSideQueryChange,
    usage,
    connections,
    transcript,
    transcriptContainerId,
    transcriptContainerRef,
  } = props;
  const reduceMotion = useReducedMotion();

  // Plays once, the first time the shell ever paints: the welcome heading,
  // composer bar and source dock rise/fade in with a short stagger instead of
  // snapping straight to their resting state. Stays true for the life of the
  // component afterward, so it never replays when `sent`/`mg` later toggle
  // the welcome block back into view — that transition already has its own
  // choreography (see `backDelay` below).
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const raf = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(raf);
  }, []);
  const entrance = (delay: number, distance = 10): CSSProperties =>
    reduceMotion
      ? {}
      : {
          opacity: mounted ? 1 : 0,
          transform: `translateY(${mounted ? 0 : distance}px)`,
          transition: `opacity .6s ${SHELL_EASE} ${delay}s, transform .6s ${SHELL_EASE} ${delay}s`,
        };

  // Microphone intent: a tap toggles recording, a press-and-hold records until release.
  // A press that starts recording sets micIgnoreClickRef so its own click cannot stop it.
  const micPressRef = useRef<{ downAt: number; startedHere: boolean } | null>(null);
  const micIgnoreClickRef = useRef(false);
  const dictationPhase = dictation.phase;
  const dictationBusy = dictationPhase === "starting" || dictationPhase === "listening" || dictationPhase === "transcribing";

  useEffect(() => {
    if (!isDictationSessionOpen(dictationPhase)) return;
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") dictation.onCancel?.();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // dictation.onCancel is recreated each render; the phase alone scopes the listener.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dictationPhase]);

  const onMicPointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    const startsRecording = canStartDictation(dictationPhase);
    micPressRef.current = { downAt: performance.now(), startedHere: startsRecording };
    micIgnoreClickRef.current = startsRecording;
    if (startsRecording) dictation.onStart();
  };

  const endMicPress = (fromPointerLeave: boolean) => {
    const press = micPressRef.current;
    micPressRef.current = null;
    if (!press?.startedHere) return;
    if (isDictationHold(press.downAt, performance.now())) {
      dictation.onStop();
      // Leaving the button means no click follows, so the guard must not linger.
      if (fromPointerLeave) micIgnoreClickRef.current = false;
    }
  };

  const onMicClick = () => {
    if (micIgnoreClickRef.current) {
      micIgnoreClickRef.current = false;
      return;
    }
    // Keyboard activation (Enter/Space) and the second tap of a tap-to-toggle.
    if (dictationPhase === "listening") dictation.onStop();
    else if (dictationPhase === "starting") dictation.onCancel?.();
    else if (canStartDictation(dictationPhase)) dictation.onStart();
  };

  const [effortMenuOpen, setEffortMenuOpen] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  // Mirrors the artboard's `collapsing` state: for 1.75s after Manage closes,
  // the surrounding content's grow-back transitions (welcome text, transcript,
  // stage padding) carry a .7s delay so the composer bar finishes shrinking
  // FIRST, then everything else reflows into the freed space — matches the
  // artboard's `closeManage()` sequencing exactly instead of animating both
  // at once.
  const [collapsing, setCollapsing] = useState(false);
  const collapseTimerRef = useRef<number | null>(null);
  const [connectionsStep, setConnectionsStep] = useState<null | "detail">(null);
  const [hoverPill, setHoverPill] = useState<string | null>(null);
  const [hoverChatId, setHoverChatId] = useState<string | null>(null);
  const [editChatId, setEditChatId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [tempNote, setTempNote] = useState(false);
  // Keep the home pill mounted just long enough to play its reference exit,
  // but never leave a visually hidden control in the keyboard tab order.
  const [tempPillMounted, setTempPillMounted] = useState(temp);
  const hasMountedTempToggleRef = useRef(false);
  const [headroom, setHeadroom] = useState(260);
  const barRef = useRef<HTMLDivElement | null>(null);
  const composerRootRef = useRef<HTMLDivElement | null>(null);

  const effortMenuRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (
        effortMenuOpen &&
        effortMenuRef.current &&
        !effortMenuRef.current.contains(e.target as Node)
      ) {
        setEffortMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [effortMenuOpen]);

  useEffect(() => {
    const measure = () => {
      if (!barRef.current) return;
      const r = barRef.current.getBoundingClientRect();
      const above = Math.round(r.top - 16);
      if (Math.abs(above - headroom) > 2) setHeadroom(above);
    };
    measure();
    window.addEventListener("resize", measure);
    const id = window.setInterval(measure, 260);
    return () => {
      window.removeEventListener("resize", measure);
      window.clearInterval(id);
    };
  }, [headroom]);

  useEffect(() => {
    // Mirror the Composer artboard: either direction briefly confirms the
    // privacy state ("Temporary" when on, "Saved" when it is turned off).
    // Suppress the initial render so a new chat never announces itself.
    if (!hasMountedTempToggleRef.current) {
      hasMountedTempToggleRef.current = true;
      return;
    }
    setTempNote(true);
    const t = window.setTimeout(() => setTempNote(false), 2800);
    return () => window.clearTimeout(t);
  }, [temp]);

  useEffect(() => {
    if (temp) {
      setTempPillMounted(true);
      return;
    }
    const timer = window.setTimeout(() => setTempPillMounted(false), 500);
    return () => window.clearTimeout(timer);
  }, [temp]);

  const chosenSources = useMemo(
    () => sources.filter((s) => activeSourceIds.includes(s.id)),
    [sources, activeSourceIds],
  );
  const shownPills = chosenSources.slice(0, 3);
  const overflowCount = chosenSources.length - shownPills.length;

  const currentEffortOption =
    efforts.find((e) => e.value === currentEffort) ?? efforts[0];
  const mg = manageOpen;
  const dt = connectionsStep === "detail";
  const webOff = !connections.webSearchEnabled;
  // Matches the artboard's step==="connected" height (384) exactly — the
  // real detail view (email + scope rows) is the same shape as that step.
  const selectionRows = selections.length;
  // While Flow dictation covers the card, give it room for live words / edits (more when a selection header shows).
  // The composer keeps its normal size while Flow dictation covers it.
  const barHeight = dt
    ? 384
    : mg
      ? webOff
        ? 292
        : 226
      : 118 + Math.ceil(files.length / 2) * 48 + selectionRows * 36;
  const backDelay = !mg && collapsing ? ".7s" : "0s";

  const closeManage = () => {
    setManageOpen(false);
    setConnectionsStep(null);
    setCollapsing(true);
    if (collapseTimerRef.current != null)
      window.clearTimeout(collapseTimerRef.current);
    collapseTimerRef.current = window.setTimeout(
      () => setCollapsing(false),
      1750,
    );
  };
  useEffect(() => {
    return () => {
      if (collapseTimerRef.current != null)
        window.clearTimeout(collapseTimerRef.current);
    };
  }, []);

  // Manage/detail panels are mounted only while visible (rather than always
  // mounted + opacity-toggled): this environment's compositor reliably fails
  // to paint an always-mounted, position:absolute sibling whose opacity
  // transitions after a long delay inside a border-radius+overflow:hidden
  // parent that's also animating height — a real, reproducible blank-panel
  // bug, not just a timing illusion. Conditional mounting sidesteps it
  // entirely. To still get the artboard's "fade out → expand → fade in"
  // sequence: on open, wait for the compose face's fade-out + the bar's full
  // grow (which itself only STARTS after a .7s delay, then takes another
  // .7s — see the barStyle height transition below) before mounting the new
  // panel; on close, play a brief fade-out animation before unmounting.
  // The artboard's own `faceDelay` for content fading in while `mg` is true
  // is .95s (not the .7s it is while closing) — that governs BOTH "opening
  // from compose" and "switching manage <-> detail", since `mg` stays true
  // across that sub-switch too and the bar's height transition carries the
  // same .7s delay every time it moves while mg is true. So both cases use
  // the same 950ms mount delay here, not a quick one for the sub-switch.
  type PanelKind = "manage" | "detail" | null;
  const targetPanel: PanelKind = dt ? "detail" : mg ? "manage" : null;
  const [mountedPanel, setMountedPanel] = useState<PanelKind>(null);
  const [exitingPanel, setExitingPanel] = useState<PanelKind>(null);
  const panelTimerRef = useRef<number | null>(null);
  useEffect(() => {
    if (panelTimerRef.current != null)
      window.clearTimeout(panelTimerRef.current);
    if (targetPanel === mountedPanel) {
      setExitingPanel(null);
      return;
    }
    if (targetPanel) {
      if (mountedPanel) setExitingPanel(mountedPanel);
      panelTimerRef.current = window.setTimeout(() => {
        setMountedPanel(targetPanel);
        setExitingPanel(null);
      }, 950);
    } else {
      setExitingPanel(mountedPanel);
      panelTimerRef.current = window.setTimeout(() => {
        setMountedPanel(null);
        setExitingPanel(null);
      }, 200);
    }
    return () => {
      if (panelTimerRef.current != null)
        window.clearTimeout(panelTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetPanel]);

  // Cross-fading "faces" — exact match to the artboard's face()/slide()
  // helpers. All three panels (compose/manage/detail) stay mounted; only
  // opacity, transform and visibility change. Sequence when opening:
  // current face fades out immediately (.2s/.18s, no delay) while the bar
  // starts growing (.7s) in parallel, then the incoming face fades in
  // (faceDelay) once the bar has finished growing — one surface morphing
  // rather than a hard cut. (The earlier "blank panel" bug was NOT this
  // timing — it was ConnectionsPanel/ConnectionsDetail's own root being
  // double-wrapped with duplicate absolute-position + padding, clipping
  // the rows out of view. That's fixed at the call sites below, so the
  // original artboard timing is restored here unaltered.)
  const faceDelay = mg ? ".95s" : ".7s";
  const faceStyle = (
    on: boolean,
    y: number,
    hidden?: boolean,
  ): CSSProperties => ({
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    display: "flex",
    flexDirection: "column",
    opacity: on ? 1 : 0,
    transform: `translateY(${on ? 0 : y}px) scale(${on ? 1 : 0.985})`,
    visibility: on ? "visible" : "hidden",
    height: on ? "auto" : 0,
    overflow: on ? (hidden ? "hidden" : "visible") : "hidden",
    pointerEvents: on ? "auto" : "none",
    willChange: "opacity, transform",
    transition: `opacity ${on ? `.3s ease ${faceDelay}` : ".2s ease"}, transform .5s ${SHELL_EASE}, height 0s linear ${on ? "0s" : ".24s"}`,
  });
  const slideStyle = (on: boolean, x: number): CSSProperties => ({
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    display: "flex",
    flexDirection: "column",
    opacity: on ? 1 : 0,
    transform: `translateX(${on ? 0 : x}px)`,
    visibility: on ? "visible" : "hidden",
    height: on ? "auto" : 0,
    overflow: "hidden",
    pointerEvents: on ? "auto" : "none",
    willChange: "opacity, transform",
    transition: `opacity ${on ? `.28s ease ${faceDelay}` : ".18s ease"}, transform .48s ${SHELL_EASE}, height 0s linear ${on ? "0s" : ".24s"}`,
  });

  const dockRef = useRef<HTMLDivElement | null>(null);
  const dockRaf = useRef<number | null>(null);
  const handleDockMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const dockEl = dockRef.current;
    const clientX = e.clientX;
    if (dockRaf.current != null) return;
    dockRaf.current = requestAnimationFrame(() => {
      dockRaf.current = null;
      if (!dockEl) return;
      const kids = dockEl.querySelectorAll<HTMLElement>("[data-dock]");
      kids.forEach((kid) => {
        const r = kid.getBoundingClientRect();
        const t = Math.max(
          0,
          1 - Math.abs(clientX - (r.left + r.width / 2)) / 118,
        );
        const eased = t * t * (3 - 2 * t);
        kid.style.transform = `translateY(${(-7 * eased).toFixed(2)}px) scale(${(1 + 0.46 * eased).toFixed(3)})`;
      });
    });
  };
  const handleDockLeave = () => {
    const kids = dockRef.current?.querySelectorAll<HTMLElement>("[data-dock]");
    kids?.forEach((kid) => {
      kid.style.transform = "translateY(0px) scale(1)";
    });
  };

  const N = 46;
  const wave = useMemo(
    () =>
      Array.from({ length: N }, (_, i) => {
        const t = i / (N - 1);
        const env = Math.pow(Math.sin(Math.PI * t), 0.7);
        const detail = 0.5 + 0.5 * Math.sin(i * 0.9) * Math.sin(i * 0.31 + 1.1);
        const h = 4 + 28 * env * (0.42 + 0.58 * detail);
        return { h, t, env };
      }),
    [],
  );

  const commitRename = (id: string) => {
    const t = editDraft.trim();
    if (t) onRenameChat(id, t);
    setEditChatId(null);
  };

  const groupLabels: ComposerChatRow["group"][] = [
    "Today",
    "Previous 7 days",
    "Earlier",
  ];
  const filteredChats = useMemo(() => {
    const q = sideQuery.trim().toLowerCase();
    return chats.filter((c) => !q || c.title.toLowerCase().includes(q));
  }, [chats, sideQuery]);

  return (
    <div
      ref={composerRootRef}
      className="clyra-composer-shell"
      style={{
        position: "relative",
        height: "100%",
        width: "100%",
        display: "flex",
        alignItems: "stretch",
        justifyContent: "center",
        background:
          "radial-gradient(120% 90% at 50% 0%, #FCFCFD 0%, #F5F6F8 58%, #EEF0F3 100%)",
        fontFamily:
          "'Instrument Sans', -apple-system, BlinkMacSystemFont, 'SF Pro Text', system-ui, sans-serif",
        WebkitFontSmoothing: "antialiased",
        overflow: "hidden",
      }}
    >
      {/* Sidebar toggle */}
      <button
        type="button"
        onClick={onToggleSidebar}
        title="Chat history"
        style={{
          position: "absolute",
          top: 18,
          left: 18,
          zIndex: 48,
          display: historyPanel ? "flex" : "none",
          alignItems: "center",
          justifyContent: "center",
          width: 38,
          height: 38,
          borderRadius: 999,
          border: "none",
          cursor: "pointer",
          color: "#5C6069",
          background: "transparent",
          opacity: sidebarOpen ? 0 : 1,
          transform: sidebarOpen ? "translateX(-10px)" : "translateX(0)",
          pointerEvents: sidebarOpen ? "none" : "auto",
          transition: `background .24s ${EASE}, color .24s ease, opacity .3s ease, transform .5s ${SHELL_EASE}`,
        }}
      >
        <svg
          key={sidebarOpen ? "open" : "closed"}
          style={{
            animation: "clyraTempTick .46s cubic-bezier(.32,.72,0,1) both",
          }}
          width={17}
          height={17}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.8}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path
            d={
              sidebarOpen
                ? "M15 6l-6 6 6 6"
                : "M3.5 6.5h17M3.5 12h17M3.5 17.5h11"
            }
          />
        </svg>
      </button>

      {/* Temporary chat toggle (top-right) */}
      <button
        type="button"
        onClick={onToggleTemp}
        title={temp ? "Temporary chat on" : "Start a temporary chat"}
        className="clyra-composer-temp-toggle"
        style={{
          // This is deliberately viewport-anchored, like the Composer
          // reference: it never rides with the transcript or the composer.
          position: "fixed",
          top: 18,
          right: 18,
          zIndex: 48,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: 38,
          height: 38,
          borderRadius: 999,
          border: "none",
          cursor: "pointer",
          color: temp ? "#15171C" : "#5C6069",
          background: "transparent",
          transition: `background .28s ${EASE}, color .28s ease`,
        }}
      >
        <svg
          key={temp ? "temporary-on" : "temporary-off"}
          style={{
            animation: "clyraTempTick .5s cubic-bezier(.32,.72,0,1) both",
          }}
          width={17}
          height={17}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.7}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M20.6 11.2a8.7 8.7 0 1 1-7.9-8.6" />
          <path d="M12 7.6V12l3.1 1.9" opacity={0.55} />
          <path d="M18.4 3.6 21.8 7" opacity={0.9} />
        </svg>
      </button>

      <div
        onClick={onToggleSidebar}
        style={{
          position: "absolute",
          inset: 0,
          zIndex: 44,
          display: historyPanel ? "block" : "none",
          background: "transparent",
          pointerEvents: sidebarOpen ? "auto" : "none",
        }}
      />

      {/* Sidebar panel */}
      <aside
        style={{
          position: "absolute",
          top: 16,
          left: 16,
          bottom: 16,
          zIndex: 46,
          display: historyPanel ? "flex" : "none",
          flexDirection: "column",
          width: 290,
          borderRadius: 24,
          background: "#FFFFFF",
          overflow: "hidden",
          boxShadow:
            "0 24px 60px -26px rgba(16,18,24,0.22), inset 0 0 0 1px rgba(16,18,24,0.05)",
          visibility: sidebarOpen ? "visible" : "hidden",
          transform: `translateX(${sidebarOpen ? 0 : -322}px)`,
          pointerEvents: sidebarOpen ? "auto" : "none",
          transition: `visibility 0s linear ${sidebarOpen ? "0s" : ".72s"}, transform .72s cubic-bezier(.14,.96,.18,1)`,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "18px 14px 10px 18px",
          }}
        >
          <span
            style={{
              flex: 1,
              fontSize: 13.5,
              fontWeight: 600,
              letterSpacing: "-0.011em",
              color: "#15171C",
            }}
          >
            Chats
          </span>
          <button
            type="button"
            onClick={onToggleSidebar}
            title="Hide"
            style={iconGhostButtonStyle(30)}
          >
            <svg
              width={14}
              height={14}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2.1}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M15 6l-6 6 6 6" />
            </svg>
          </button>
        </div>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 1,
            padding: "0 10px 10px",
          }}
        >
          <button
            type="button"
            onClick={onNewChat}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 9,
              width: "100%",
              height: 36,
              padding: "0 11px",
              borderRadius: 12,
              border: "none",
              background: "transparent",
              cursor: "pointer",
              fontFamily: "inherit",
              fontSize: 13,
              fontWeight: 500,
              letterSpacing: "-0.008em",
              color: "#15171C",
            }}
            onMouseEnter={(e) =>
              (e.currentTarget.style.background = "rgba(16,18,24,0.035)")
            }
            onMouseLeave={(e) =>
              (e.currentTarget.style.background = "transparent")
            }
          >
            <svg
              width={15}
              height={15}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.8}
              strokeLinecap="round"
            >
              <path d="M12 5v14M5 12h14" />
            </svg>
            New chat
          </button>
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: 9,
              height: 36,
              padding: "0 11px",
              borderRadius: 12,
              background: "transparent",
              cursor: "text",
            }}
          >
            <svg
              width={15}
              height={15}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.8}
              strokeLinecap="round"
              style={{ color: "#7A7E87", flexShrink: 0 }}
            >
              <circle cx={11} cy={11} r={6.6} />
              <path d="M16 16l4 4" />
            </svg>
            <input
              type="text"
              placeholder="Search chats"
              value={sideQuery}
              onChange={(e) => onSideQueryChange(e.target.value)}
              style={{
                flex: 1,
                minWidth: 0,
                border: "none",
                background: "transparent",
                outline: "none",
                fontFamily: "inherit",
                fontSize: 13,
                letterSpacing: "-0.008em",
                color: "#15171C",
              }}
            />
          </label>
        </div>
        <div
          className="clyra-composer-scroll"
          style={{
            flex: 1,
            minHeight: 0,
            overflowY: "auto",
            overscrollBehavior: "contain",
            padding: "0 6px 12px 8px",
          }}
        >
          {sideQuery.trim() && filteredChats.length === 0 ? (
            <span
              style={{
                display: "block",
                padding: "14px 10px",
                fontSize: 12.5,
                color: "#63676F",
              }}
            >
              No chats match that search.
            </span>
          ) : null}
          {groupLabels.map((label) => {
            const items = filteredChats.filter((c) => c.group === label);
            if (!items.length) return null;
            return (
              <div
                key={label}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  marginBottom: 4,
                }}
              >
                <span
                  style={{
                    display: "block",
                    padding: "10px 10px 5px",
                    fontSize: 10,
                    fontWeight: 600,
                    letterSpacing: "0.06em",
                    textTransform: "uppercase",
                    color: "#5F636B",
                  }}
                >
                  {label}
                </span>
                {items.map((c) => {
                  const hov = hoverChatId === c.id;
                  const editing = editChatId === c.id;
                  return (
                    <div
                      key={c.id}
                      onMouseEnter={() => setHoverChatId(c.id)}
                      onMouseLeave={() =>
                        setHoverChatId((v) => (v === c.id ? null : v))
                      }
                      onClick={() => !editing && onOpenChat(c.id)}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        width: "100%",
                        boxSizing: "border-box",
                        minWidth: 0,
                        padding: "9px 6px 9px 10px",
                        borderRadius: 13,
                        background: hov
                          ? "rgba(16,18,24,0.035)"
                          : "transparent",
                        cursor: "pointer",
                        transition: `background .26s ${EASE}`,
                      }}
                    >
                      {editing ? (
                        <input
                          autoFocus
                          type="text"
                          value={editDraft}
                          onChange={(e) => setEditDraft(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              commitRename(c.id);
                            }
                            if (e.key === "Escape") setEditChatId(null);
                          }}
                          onBlur={() => commitRename(c.id)}
                          onClick={(e) => e.stopPropagation()}
                          style={{
                            flex: 1,
                            minWidth: 0,
                            height: 26,
                            padding: "0 8px",
                            border: "none",
                            borderRadius: 8,
                            background: "#FFFFFF",
                            outline: "none",
                            boxShadow:
                              "inset 0 0 0 1.5px rgba(30,111,255,0.55)",
                            fontFamily: "inherit",
                            fontSize: 13,
                            fontWeight: 500,
                            color: "#15171C",
                          }}
                        />
                      ) : (
                        <span
                          style={{
                            flex: 1,
                            minWidth: 0,
                            textAlign: "left",
                            whiteSpace: "nowrap",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            fontSize: 13,
                            fontWeight: 500,
                            letterSpacing: "-0.008em",
                            color: "#15171C",
                          }}
                        >
                          {c.title}
                        </span>
                      )}
                      <span
                        style={{
                          fontSize: 10.5,
                          color: "#63676F",
                          flexShrink: 0,
                          opacity: hov || editing ? 0 : 1,
                          transition: "opacity .2s ease",
                        }}
                      >
                        {c.when}
                      </span>
                      <span
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 2,
                          flexShrink: 0,
                          overflow: "hidden",
                          width: hov && !editing ? 58 : 0,
                          opacity: hov && !editing ? 1 : 0,
                          transition: "width .34s ease, opacity .26s ease",
                        }}
                      >
                        <button
                          type="button"
                          title="Rename"
                          onClick={(e) => {
                            e.stopPropagation();
                            setEditChatId(c.id);
                            setEditDraft(c.title);
                          }}
                          style={iconGhostButtonStyle(26)}
                        >
                          <svg
                            width={13}
                            height={13}
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth={1.55}
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <path d="M4 20h4.2L20 8.2a2.1 2.1 0 0 0 0-3l-1.2-1.2a2.1 2.1 0 0 0-3 0L4 15.8z" />
                          </svg>
                        </button>
                        <button
                          type="button"
                          title="Delete"
                          onClick={(e) => {
                            e.stopPropagation();
                            onDeleteChat(c.id);
                          }}
                          style={iconGhostButtonStyle(26)}
                        >
                          <svg
                            width={13}
                            height={13}
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth={1.55}
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <path d="M4.6 7.2h14.8M9.8 4.4h4.4a1 1 0 0 1 1 1v1.8H8.8V5.4a1 1 0 0 1 1-1z" />
                            <path d="M6.9 7.2l.8 11.5a1.6 1.6 0 0 0 1.6 1.5h5.4a1.6 1.6 0 0 0 1.6-1.5l.8-11.5" />
                          </svg>
                        </button>
                      </span>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
        {usage ? (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 8,
              padding: "14px 16px 12px",
              margin: "0 4px",
              borderTop: "1px solid rgba(16,18,24,0.05)",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "baseline",
                justifyContent: "space-between",
                gap: 10,
              }}
            >
              <span
                style={{ fontSize: 11.5, fontWeight: 500, color: "#15171C" }}
              >
                {usage.count}
              </span>
              <span style={{ fontSize: 11, color: "#63676F" }}>
                {usage.label}
              </span>
            </div>
            <span
              style={{
                display: "block",
                width: "100%",
                height: 3,
                borderRadius: 999,
                background: "rgba(16,18,24,0.07)",
                overflow: "hidden",
              }}
            >
              <span
                style={{
                  display: "block",
                  height: "100%",
                  width: `${Math.round(usage.pct * 100)}%`,
                  borderRadius: 999,
                  background: "rgba(16,18,24,0.42)",
                  transition: "width 1s cubic-bezier(.32,.72,0,1) .16s",
                }}
              />
            </span>
          </div>
        ) : null}
        <button
          type="button"
          className="clyra-composer-settings-button"
          onClick={onOpenSettings}
          title="Open settings"
        >
          <span className="clyra-composer-settings-button__icon" aria-hidden>
            <svg
              width={15}
              height={15}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.75}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx={12} cy={12} r={3.1} />
              <path d="M19.3 13.5a1.7 1.7 0 0 0 .34 1.88l.06.06-2.2 2.2-.06-.06a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1.03 1.55V19h-3.1v-.09a1.7 1.7 0 0 0-1.03-1.55 1.7 1.7 0 0 0-1.88.34l-.06.06-2.2-2.2.06-.06a1.7 1.7 0 0 0 .34-1.88 1.7 1.7 0 0 0-1.55-1.03H5v-3.1h.09a1.7 1.7 0 0 0 1.55-1.03 1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.2-2.2.06.06a1.7 1.7 0 0 0 1.88.34 1.7 1.7 0 0 0 1.03-1.55V5h3.1v.09a1.7 1.7 0 0 0 1.03 1.55 1.7 1.7 0 0 0 1.88-.34l.06-.06 2.2 2.2-.06.06a1.7 1.7 0 0 0-.34 1.88 1.7 1.7 0 0 0 1.55 1.03H19v3.1h-.09a1.7 1.7 0 0 0-1.55 1.03Z" />
            </svg>
          </span>
          <span>Settings</span>
          <svg
            className="clyra-composer-settings-button__arrow"
            width={13}
            height={13}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.8}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <path d="m9 6 6 6-6 6" />
          </svg>
        </button>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "8px 12px 12px",
          }}
        >
          <span
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 30,
              height: 30,
              borderRadius: 999,
              background: accentColor,
              color: "#FFFFFF",
              fontSize: 12,
              fontWeight: 600,
              flexShrink: 0,
            }}
          >
            {userName.charAt(0).toUpperCase()}
          </span>
          <span
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 1,
              flex: 1,
              minWidth: 0,
            }}
          >
            <span style={{ fontSize: 12.5, fontWeight: 500, color: "#15171C" }}>
              {userName}
            </span>
            <span style={{ fontSize: 11, color: "#63676F" }}>Clyra</span>
          </span>
        </div>
      </aside>

      {/* Temp-chat pill (top center, shown briefly) */}
      <div
        style={{
          position: "absolute",
          top: 20,
          left: "50%",
          zIndex: 47,
          display: "flex",
          justifyContent: "center",
          pointerEvents: "none",
          transform: `translate(-50%, ${sent && !mg && tempNote ? 0 : -10}px)`,
          opacity: sent && !mg && tempNote ? 1 : 0,
          transition:
            "opacity .45s ease, transform .55s cubic-bezier(.32,.72,0,1)",
        }}
      >
        <span
          style={{
            display: "flex",
            alignItems: "center",
            gap: 9,
            padding: "8px 15px 8px 13px",
            borderRadius: 999,
            background: "rgba(255,255,255,0.82)",
            backdropFilter: "blur(20px) saturate(180%)",
            WebkitBackdropFilter: "blur(20px) saturate(180%)",
            boxShadow:
              "0 8px 24px -12px rgba(16,18,24,0.28), inset 0 0 0 1px rgba(16,18,24,0.06)",
            fontSize: 12,
            fontWeight: 500,
            color: "#15171C",
            whiteSpace: "nowrap",
            transition: `width .42s ${SHELL_EASE}`,
          }}
        >
          <span
            key={temp ? "temporary-status" : "saved-status"}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 9,
              animation: "clyraSwap .42s ease both",
            }}
          >
            <span
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#63676F",
                flexShrink: 0,
              }}
            >
              {temp ? (
                <svg
                  width={13}
                  height={13}
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.8}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M20.6 11.2a8.7 8.7 0 1 1-7.9-8.6" />
                  <path d="M12 7.6V12l3.1 1.9" opacity={0.55} />
                  <path d="M18.4 3.6 21.8 7" />
                </svg>
              ) : (
                <svg
                  width={13}
                  height={13}
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.8}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M20 6.5 9.4 17.1l-5.4-5.4" />
                </svg>
              )}
            </span>
            {temp
              ? "Temporary — this chat won't be saved"
              : "Saved to your history"}
          </span>
        </span>
      </div>

      {/* Stage */}
      <div
        className="clyra-composer-shell__stage"
        style={{
          width: "100%",
          // The home composition is a centred 640px column. Once a
          // conversation starts, the stage widens to a comfortable reading
          // column instead of stretching edge-to-edge on wide windows.
          maxWidth: sent && !mg ? 820 : 640,
          margin: "0 auto",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: sent && !mg ? 0 : 12,
          height: "100%",
          padding:
            sent && !mg
              ? tempNote
                ? "76px 32px 14px"
                : "40px 32px 14px"
              : "0 32px",
          boxSizing: "border-box",
          justifyContent: sent && !mg ? "flex-end" : "center",
          transition: `padding 1.15s ${SHELL_EASE} ${backDelay}, gap 1.15s ${SHELL_EASE} ${backDelay}`,
        }}
      >
        {/* The frame owns the transcript's layout box and is the containing
            block for overlays, so overlays stay pinned to the visible area
            instead of scrolling with the messages. */}
        <div
          className="clyra-composer-scroll-frame"
          style={{
            position: "relative",
            display: "flex",
            flexDirection: "column",
            width: "100%",
            flex: sent && !mg ? "1 1 auto" : "0 0 auto",
            minHeight: 0,
            maxHeight: sent && !mg ? "none" : 0,
            marginBottom: sent && !mg ? 18 : 0,
            opacity: sent && !mg ? 1 : 0,
            transition: `margin-bottom 1.15s ${SHELL_EASE} ${backDelay}, flex-grow 1.15s ${SHELL_EASE} ${backDelay}, opacity .6s ease ${mg ? "0s" : ".5s"}`,
          }}
        >
          <div
            id={transcriptContainerId}
            ref={transcriptContainerRef}
            className="clyra-composer-scroll"
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 12,
              width: "100%",
              padding: "0 2px",
              overflowY: "auto",
              overflowX: "hidden",
              overscrollBehavior: "contain",
              flex: "1 1 auto",
              minHeight: 0,
              position: "relative",
            }}
          >
            {transcript}
          </div>
          {transcriptOverlay}
        </div>

        {!sent ? (
          <div
            className="clyra-composer-shell__welcome"
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              textAlign: "center",
              width: "100%",
              overflow: "hidden",
              padding: "0 8px",
              maxHeight: mg ? 0 : 380,
              marginBottom: mg ? 0 : 26,
              opacity: mg ? 0 : 1,
              transform: `translateY(${mg ? -12 : 0}px)`,
              pointerEvents: mg ? "none" : "auto",
              transition: `max-height .95s ${SHELL_EASE} ${backDelay}, margin-bottom .95s ${SHELL_EASE} ${backDelay}, opacity .6s ease ${backDelay}, transform .95s ${SHELL_EASE} ${backDelay}`,
            }}
          >
            {/* Clyra's orb: the same living face the voice call uses. It is the
                shared element the call flies out of / back into (see orbAnchor). */}
            <div
              id="clyra-bloub-home-target"
              ref={setOrbAnchor}
              className="clyra-composer-shell__orb"
              style={{
                position: "relative",
                width: 104,
                height: 104,
                marginBottom: 22,
                flexShrink: 0,
                opacity: reduceMotion ? 1 : mounted ? 1 : 0,
                transform: reduceMotion ? "none" : `scale(${mounted ? 1 : 0.55})`,
                transition: `opacity .7s ${SHELL_EASE} .05s, transform 1.05s ${SHELL_EASE} .05s`,
                pointerEvents: "none",
              }}
            >
              <ClyraFace state="ready" muted={false} />
            </div>
            {tempPillMounted ? (
              <button
                type="button"
                onClick={onToggleTemp}
                title="Turn off temporary chat"
                className="clyra-composer-temp-pill"
                aria-hidden={!temp}
                tabIndex={temp ? 0 : -1}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  overflow: "hidden",
                  whiteSpace: "nowrap",
                  borderRadius: 999,
                  fontFamily: "inherit",
                  fontSize: 12,
                  fontWeight: 500,
                  letterSpacing: "-0.004em",
                  color: "#63676F",
                  background: "transparent",
                  border: "none",
                  cursor: "pointer",
                  maxHeight: temp ? 28 : 0,
                  padding: temp ? "5px 11px 5px 9px" : "0 11px 0 9px",
                  marginBottom: temp ? 20 : 0,
                  opacity: temp ? 1 : 0,
                  transform: `translateY(${temp ? 0 : -5}px)`,
                  pointerEvents: temp ? "auto" : "none",
                  transition: `max-height .48s ${SHELL_EASE}, padding .48s ${SHELL_EASE}, margin-bottom .48s ${SHELL_EASE}, opacity .3s ease, transform .48s ${SHELL_EASE}, background .24s ${EASE}`,
                }}
              >
                <svg
                  width={13}
                  height={13}
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.7}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  style={{ flexShrink: 0, opacity: 0.75 }}
                >
                  <path d="M20.6 11.2a8.7 8.7 0 1 1-7.9-8.6" />
                  <path d="M12 7.6V12l3.1 1.9" opacity={0.55} />
                  <path d="M18.4 3.6 21.8 7" />
                </svg>
                Temporary chat
                <span
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    marginLeft: 2,
                    marginRight: -2,
                    opacity: 0.6,
                  }}
                >
                  <svg
                    width={10}
                    height={10}
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2.6}
                    strokeLinecap="round"
                  >
                    <path d="M6 6l12 12M18 6 6 18" />
                  </svg>
                </span>
              </button>
            ) : null}
            <span
              className="clyra-composer-shell__heading"
              style={{
                display: "block",
                marginTop: 0,
                fontSize: 38,
                fontWeight: 600,
                letterSpacing: "-0.034em",
                lineHeight: 1.08,
                color: "#15171C",
                ...entrance(0.18),
              }}
            >
              Where should we start, <span style={{ color: accentColor }}>{userName}</span>?
            </span>
            <span
              className="clyra-composer-shell__subtitle"
              style={{
                display: "block",
                marginTop: 11,
                maxWidth: 420,
                fontSize: 14.5,
                lineHeight: 1.55,
                letterSpacing: "-0.008em",
                color: "#63676F",
                ...entrance(0.26),
              }}
            >
              Type <span style={{ color: "#0B54D6", fontWeight: 600 }}>/</span>{" "}
              to bring in Drive, Gmail or the live web — or just ask.
            </span>
          </div>
        ) : null}

        {/* Composer bar */}
        <div
          ref={barRef}
          className="clyra-composer-shell__bar"
          style={{
            position: "relative",
            width: "min(640px, 100%)",
            borderRadius: 32,
            background: "#FFFFFF",
            overflow: mg || dt ? "hidden" : "visible",
            height: barHeight,
            boxShadow:
              "0 1px 1px rgba(16,18,24,0.03), 0 8px 20px -8px rgba(16,18,24,0.10), 0 30px 60px -28px rgba(16,18,24,0.20), inset 0 0 0 1px rgba(16,18,24,0.055)",
            // The artboard's own barStyle carries a delay on this transition
            // too — height .7s ${shell} + (mg ? ".7s" : "0s") — meaning the
            // bar visibly PAUSES for .7s before it starts growing whenever
            // mg is true (opening Manage, or switching manage <-> detail),
            // and shrinks immediately (no delay) when mg goes false. Without
            // this the bar used to start growing at the same instant the
            // compose face began fading out, which read as abrupt/too fast
            // next to the fade — this was missing from the port entirely.
            // The opacity/transform clauses only ever animate once, for the
            // shell's first-mount entrance (see `mounted` above); once that
            // finishes they're static no-ops that don't touch the height
            // choreography above.
            transition: reduceMotion
              ? `height .7s ${SHELL_EASE} ${mg ? ".7s" : "0s"}, max-width .5s ${SHELL_EASE}`
              : `height .7s ${SHELL_EASE} ${mg ? ".7s" : "0s"}, max-width .5s ${SHELL_EASE}, opacity .6s ${SHELL_EASE} .1s, transform .6s ${SHELL_EASE} .1s`,
            opacity: reduceMotion ? 1 : mounted ? 1 : 0,
            // Forces a stable compositing layer for this rounded, clipped,
            // height-animating box — mitigates a known Chromium paint glitch
            // where rounded-corner overflow:hidden clipping fails to
            // recomposite newly-mounted absolutely-positioned children.
            transform:
              !reduceMotion && !mounted
                ? "translateZ(0) translateY(14px)"
                : "translateZ(0)",
            WebkitTransform: "translateZ(0)",
            isolation: "isolate",
          }}
        >
          {/* Flow dictation: covers the whole composer card (same shape), the controls underneath soften away. */}
          {dictation.flow ? (
            <FlowComposerOverlay flow={dictation.flow} onStop={dictation.onStop} onCancel={() => dictation.onCancel?.()} />
          ) : null}
          {/* Compose face */}
          <div
            className="clyra-composer-shell__face"
            style={{
              ...faceStyle(!mg && !dt, -14, mg || dt),
              flexDirection: "column",
              gap: 8,
              padding: "16px 14px 12px 18px",
              zIndex: 5,
              overflow: mg || dt ? "hidden" : "visible",
            }}
          >
            {/* "/" palette */}
            <div
              style={{
                position: "absolute",
                left: -4,
                right: -4,
                bottom: "calc(100% + 12px)",
                padding: 4,
                borderRadius: 22,
                background: "#FFFFFF",
                zIndex: 22,
                boxShadow:
                  "0 1px 1px rgba(16,18,24,0.04), 0 24px 56px -16px rgba(16,18,24,0.28), inset 0 0 0 1px rgba(16,18,24,0.07)",
                opacity: paletteOpen ? 1 : 0,
                transform: `translateY(${paletteOpen ? 0 : 14}px) scale(${paletteOpen ? 1 : 0.97})`,
                pointerEvents: paletteOpen ? "auto" : "none",
                visibility: paletteOpen ? "visible" : "hidden",
                maxHeight: paletteOpen ? Math.max(64, headroom - 46) : 0,
                overflow: paletteOpen ? "auto" : "hidden",
                transition: `opacity .22s ease, transform .3s ${SHELL_EASE}`,
              }}
            >
              <span
                style={{
                  display: "block",
                  padding: "9px 12px 6px",
                  fontSize: 10.5,
                  fontWeight: 600,
                  letterSpacing: "0.05em",
                  textTransform: "uppercase",
                  color: "#5F636B",
                }}
              >
                {paletteQuery
                  ? `Matching “${paletteQuery}”`
                  : "Sources and modes"}
              </span>
              <div
                style={{ display: "flex", flexDirection: "column" }}
                className="clyra-composer-scroll"
              >
                {paletteItems.map((it, index) => (
                  <button
                    key={it.id}
                    type="button"
                    onClick={it.onPick}
                    onMouseEnter={() => onPaletteHoverIndex?.(index)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 11,
                      width: "100%",
                      padding: "9px 10px",
                      borderRadius: 16,
                      border: "none",
                      cursor: "pointer",
                      fontFamily: "inherit",
                      textAlign: "left",
                      background:
                        index === paletteActiveIndex
                          ? "rgba(16,18,24,0.055)"
                          : "transparent",
                      transition: "background .12s ease",
                    }}
                  >
                    <span
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        width: 20,
                        flexShrink: 0,
                      }}
                    >
                      {it.icon}
                    </span>
                    <span
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 1,
                        flex: 1,
                        textAlign: "left",
                        minWidth: 0,
                      }}
                    >
                      <span
                        style={{
                          fontSize: 13,
                          fontWeight: 500,
                          color: "#15171C",
                          letterSpacing: "-0.008em",
                        }}
                      >
                        {it.label}
                      </span>
                      <span
                        style={{
                          fontSize: 11,
                          color: "#63676F",
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                      >
                        {it.desc}
                      </span>
                    </span>
                    {it.added ? (
                      <span
                        style={{
                          flexShrink: 0,
                          fontSize: 11,
                          fontWeight: 500,
                          color: "#0B54D6",
                        }}
                      >
                        Added
                      </span>
                    ) : null}
                  </button>
                ))}
                {!paletteItems.length ? (
                  <span
                    style={{
                      display: "block",
                      padding: "14px 10px",
                      fontSize: 12.5,
                      color: "#63676F",
                    }}
                  >
                    No matches.
                  </span>
                ) : null}
              </div>
            </div>

            <AnimatePresence initial={false}>
              {selections.length ? (
                <motion.div
                  layout
                  initial={
                    reduceMotion
                      ? { opacity: 0 }
                      : { opacity: 0, height: 0, y: -5 }
                  }
                  animate={
                    reduceMotion
                      ? { opacity: 1 }
                      : { opacity: 1, height: "auto", y: 0 }
                  }
                  exit={
                    reduceMotion
                      ? { opacity: 0 }
                      : { opacity: 0, height: 0, y: -5 }
                  }
                  transition={{ type: "spring", duration: 0.34, bounce: 0 }}
                  aria-label="Selected commands"
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "flex-start",
                    gap: 6,
                    overflow: "hidden",
                    padding: "0 2px 2px",
                  }}
                >
                  <AnimatePresence initial={false}>
                    {selections.map((selection) => (
                      <motion.span
                        layout
                        key={selection.id}
                        initial={
                          reduceMotion
                            ? { opacity: 0 }
                            : { opacity: 0, scale: 0.9, y: -6 }
                        }
                        animate={
                          reduceMotion
                            ? { opacity: 1 }
                            : { opacity: 1, scale: 1, y: 0 }
                        }
                        exit={
                          reduceMotion
                            ? { opacity: 0 }
                            : { opacity: 0, scale: 0.9, y: -6 }
                        }
                        transition={{
                          type: "spring",
                          duration: 0.3,
                          bounce: 0,
                        }}
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 6,
                          height: 29,
                          maxWidth: "100%",
                          padding: "0 5px 0 9px",
                          borderRadius: 999,
                          color: "#174ea6",
                          background: "rgba(11,84,214,0.09)",
                          boxShadow: "inset 0 0 0 1px rgba(11,84,214,0.13)",
                        }}
                      >
                        <span
                          style={{
                            display: "flex",
                            flexShrink: 0,
                            alignItems: "center",
                          }}
                        >
                          {selection.icon}
                        </span>
                        <span
                          style={{
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                            fontSize: 12,
                            fontWeight: 600,
                            letterSpacing: "-0.005em",
                          }}
                        >
                          {selection.label}
                        </span>
                        <button
                          type="button"
                          onClick={selection.onRemove}
                          aria-label={`Remove ${selection.label}`}
                          title={`Remove ${selection.label}`}
                          style={{
                            display: "grid",
                            width: 19,
                            height: 19,
                            flexShrink: 0,
                            placeItems: "center",
                            border: "none",
                            borderRadius: 999,
                            color: "#2867bd",
                            background: "transparent",
                            cursor: "pointer",
                          }}
                        >
                          <svg
                            width={10}
                            height={10}
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth={2.5}
                            strokeLinecap="round"
                          >
                            <path d="M6 6l12 12M18 6 6 18" />
                          </svg>
                        </button>
                      </motion.span>
                    ))}
                  </AnimatePresence>
                </motion.div>
              ) : null}
            </AnimatePresence>

            {files.length > 0 ? (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  flexWrap: "wrap",
                  padding: "0 2px 2px",
                }}
              >
                {files.map((fl) => (
                  <span
                    key={fl.id}
                    style={{
                      position: "relative",
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      padding: "5px 9px 5px 5px",
                      borderRadius: 15,
                      background: "rgba(16,18,24,0.045)",
                      maxWidth: 236,
                      animation: "clyraRise .3s cubic-bezier(.16,1,.3,1) both",
                    }}
                  >
                    {fl.onOpen ? (
                      <button
                        type="button"
                        onClick={fl.onOpen}
                        title="Preview"
                        style={{
                          position: "absolute",
                          inset: 0,
                          width: "100%",
                          height: "100%",
                          border: "none",
                          background: "transparent",
                          cursor: "pointer",
                          padding: 0,
                        }}
                      />
                    ) : null}
                    <span
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        width: 34,
                        height: 34,
                        borderRadius: 11,
                        overflow: "hidden",
                        flexShrink: 0,
                        fontSize: 10,
                        fontWeight: 600,
                        letterSpacing: "0.02em",
                        color: "#5F636B",
                        background: "#FFFFFF",
                        boxShadow: "inset 0 0 0 1px rgba(16,18,24,0.07)",
                      }}
                    >
                      {fl.thumb ??
                        fl.name.split(".").pop()?.toUpperCase().slice(0, 4)}
                    </span>
                    <span
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 1,
                        minWidth: 0,
                      }}
                    >
                      <span
                        style={{
                          fontSize: 12,
                          fontWeight: 500,
                          color: "#15171C",
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          maxWidth: 118,
                        }}
                      >
                        {fl.name}
                      </span>
                      <span style={{ fontSize: 10.5, color: "#63676F" }}>
                        {fl.meta}
                      </span>
                    </span>
                    <button
                      type="button"
                      onClick={fl.onRemove}
                      title="Remove"
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        position: "relative",
                        zIndex: 2,
                        width: 17,
                        height: 17,
                        borderRadius: 999,
                        border: "none",
                        background: "rgba(16,18,24,0.07)",
                        cursor: "pointer",
                        color: "#5F636B",
                        flexShrink: 0,
                      }}
                    >
                      <svg
                        width={9}
                        height={9}
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth={2.6}
                        strokeLinecap="round"
                      >
                        <path d="M6 6l12 12M18 6L6 18" />
                      </svg>
                    </button>
                  </span>
                ))}
              </div>
            ) : null}

            {!dictationBusy || dictation.flow ? (
              <textarea
                className={dictation.flow?.phase === "closing" ? "clyra-flow-land" : undefined}
                ref={textareaRef}
                rows={2}
                placeholder={placeholder}
                value={text}
                onChange={(e) => onTextChange(e.target.value)}
                onKeyDown={onKeyDown}
                style={{
                  width: "100%",
                  border: "none",
                  outline: "none",
                  boxShadow: "none",
                  background: "transparent",
                  resize: "none",
                  fontFamily: "inherit",
                  fontSize: 15.5,
                  lineHeight: "24px",
                  height: 48,
                  color: "#15171C",
                  letterSpacing: "-0.011em",
                  padding: "0 4px",
                  boxSizing: "border-box",
                  visibility: dictation.flow && dictation.flow.phase !== "closing" ? "hidden" : "visible",
                }}
              />
            ) : (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 16,
                  height: 48,
                  padding: "0 4px",
                  animation: "clyraVoiceIn .42s cubic-bezier(.16,1,.3,1) both",
                }}
              >
                <span
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    fontSize: 12.5,
                    fontWeight: 500,
                    color: "#5F636B",
                    flexShrink: 0,
                  }}
                >
                  <span
                    style={{
                      position: "relative",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      width: 8,
                      height: 8,
                    }}
                  >
                    <span
                      style={{
                        position: "absolute",
                        inset: 0,
                        borderRadius: "50%",
                        background: dictationPhase === "listening" ? "#E0483A" : accentColor,
                        opacity: 0.35,
                        animation:
                          dictationPhase === "listening" ? "clyraPulse 1.9s cubic-bezier(.2,.8,.3,1) infinite" : "none",
                      }}
                    />
                    <span
                      style={{
                        position: "relative",
                        display: "block",
                        width: 7,
                        height: 7,
                        borderRadius: "50%",
                        background: dictationPhase === "listening" ? "#E0483A" : accentColor,
                      }}
                    />
                  </span>
                  {dictationPhase === "transcribing"
                    ? "Transcribing…"
                    : dictationPhase === "starting"
                      ? "Starting microphone…"
                      : "Listening…"}
                </span>
                <div
                  style={{
                    position: "relative",
                    flex: 1,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    height: 36,
                  }}
                >
                  <div
                    style={{
                      position: "relative",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 3,
                      width: "100%",
                      height: 36,
                      overflow: "hidden",
                    }}
                  >
                    {dictationPhase === "listening" && wave.map((b, i) => (
                      <span
                        key={i}
                        style={{
                          display: "block",
                          width: 3,
                          borderRadius: 2,
                          flexShrink: 0,
                          height: b.h * (0.6 + dictation.level * 0.6),
                          background: accentColor,
                          opacity: 0.28 + 0.55 * b.env,
                          transition: "height .12s ease",
                        }}
                      />
                    ))}
                  </div>
                </div>
                <span
                  style={{
                    fontSize: 12.5,
                    fontWeight: 500,
                    color: "#5F636B",
                    flexShrink: 0,
                    minWidth: 30,
                    textAlign: "right",
                  }}
                >
                  {dictationPhase === "listening" ? formatDictationElapsed(dictation.elapsedSeconds) : ""}
                </span>
                {isDictationSessionOpen(dictationPhase) && dictation.onCancel ? (
                  <button
                    type="button"
                    onClick={dictation.onCancel}
                    title="Cancel dictation (Esc)"
                    aria-label="Cancel dictation"
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      height: 28,
                      padding: "0 10px",
                      borderRadius: 999,
                      border: "none",
                      background: "rgba(16,18,24,0.06)",
                      color: "#3B3F47",
                      fontSize: 12.5,
                      fontWeight: 500,
                      fontFamily: "inherit",
                      cursor: "pointer",
                      flexShrink: 0,
                    }}
                  >
                    <svg width={9} height={9} viewBox="0 0 10 10" aria-hidden="true">
                      <rect width={10} height={10} rx={2} fill="currentColor" />
                    </svg>
                    Cancel
                  </button>
                ) : null}
              </div>
            )}

            {dictation.phase === "error" && dictation.detail ? (
              <div
                role="alert"
                style={{ fontSize: 12.5, color: "#B42318", padding: "0 4px 6px", lineHeight: 1.4 }}
              >
                {dictation.detail}
              </div>
            ) : null}

            <div
              className="clyra-composer-shell__controls"
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 10,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <input
                  type="file"
                  multiple
                  ref={fileInputRef}
                  onChange={onFilesSelected}
                  style={{ display: "none" }}
                />
                <button
                  type="button"
                  title="Add files"
                  onClick={onPickFiles}
                  style={roundIconButtonStyle(34, "#5C6069")}
                >
                  <svg
                    width={17}
                    height={17}
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={1.7}
                    strokeLinecap="round"
                  >
                    <path d="M12 5v14M5 12h14" />
                  </svg>
                </button>

                <div ref={effortMenuRef} style={{ position: "relative" }}>
                  <button
                    type="button"
                    onClick={() => setEffortMenuOpen((v) => !v)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 7,
                      height: 34,
                      padding: "0 11px",
                      borderRadius: 999,
                      border: "none",
                      fontFamily: "inherit",
                      fontSize: 13,
                      fontWeight: 500,
                      letterSpacing: "-0.006em",
                      cursor: "pointer",
                      color: "#15171C",
                      background: effortMenuOpen ? "#F1F2F4" : "transparent",
                    }}
                  >
                    <span
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        width: 18,
                        height: 18,
                      }}
                    >
                      {currentEffortOption?.icon}
                    </span>
                    {currentEffortOption?.label}
                    <svg
                      width={11}
                      height={11}
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={2.2}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      style={{ opacity: 0.45, marginLeft: 1 }}
                    >
                      <path d="M6 9l6 6 6-6" />
                    </svg>
                  </button>
                  <EffortSlider efforts={efforts} current={currentEffort} accentColor={accentColor} open={effortMenuOpen} defaultValue="medium" />
                </div>

                {shownPills.map((s) => {
                  const hov = hoverPill === s.id;
                  return (
                    <span
                      key={s.id}
                      onMouseEnter={() => setHoverPill(s.id)}
                      onMouseLeave={() => setHoverPill(null)}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                        height: 30,
                        borderRadius: 999,
                        fontFamily: "inherit",
                        fontSize: 12.5,
                        fontWeight: 500,
                        letterSpacing: "-0.005em",
                        color: "#15171C",
                        whiteSpace: "nowrap",
                        background: hov ? "rgba(16,18,24,0.06)" : "transparent",
                        padding: "0 4px 0 8px",
                      }}
                    >
                      <span
                        style={{
                          display: "flex",
                          alignItems: "center",
                          flexShrink: 0,
                        }}
                      >
                        {s.icon}
                      </span>
                      {s.short}
                      <button
                        type="button"
                        onClick={() => onToggleSource(s.id)}
                        title="Remove"
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          height: 18,
                          borderRadius: 999,
                          border: "none",
                          cursor: "pointer",
                          flexShrink: 0,
                          color: "#5F636B",
                          overflow: "hidden",
                          padding: 0,
                          background: hov
                            ? "rgba(16,18,24,0.07)"
                            : "transparent",
                          width: hov ? 18 : 0,
                          opacity: hov ? 1 : 0,
                        }}
                      >
                        <svg
                          width={9.5}
                          height={9}
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth={2.6}
                          strokeLinecap="round"
                        >
                          <path d="M6 6l12 12M18 6L6 18" />
                        </svg>
                      </button>
                    </span>
                  );
                })}
                {overflowCount > 0 ? (
                  <span
                    style={{
                      display: "flex",
                      alignItems: "center",
                      height: 30,
                      padding: "0 10px",
                      borderRadius: 999,
                      background: "rgba(16,18,24,0.05)",
                      fontSize: 12.5,
                      fontWeight: 500,
                      color: "#5F636B",
                    }}
                  >
                    +{overflowCount}
                  </span>
                ) : null}
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <button
                  type="button"
                  className="clyra-dictation-btn"
                  aria-label={
                    dictationPhase === "listening"
                      ? "Stop dictation"
                      : dictationPhase === "starting"
                        ? "Cancel starting dictation"
                        : "Dictate"
                  }
                  aria-pressed={dictationPhase === "listening"}
                  aria-busy={dictationPhase === "transcribing"}
                  title={
                    dictationPhase === "listening"
                      ? "Tap to stop and transcribe"
                      : dictationPhase === "transcribing"
                        ? "Transcribing…"
                        : "Dictate: tap to start, or hold to talk"
                  }
                  onPointerDown={onMicPointerDown}
                  onPointerUp={() => endMicPress(false)}
                  onPointerLeave={() => endMicPress(true)}
                  onPointerCancel={() => endMicPress(true)}
                  onClick={onMicClick}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: 34,
                    height: 34,
                    padding: 0,
                    borderRadius: 999,
                    border: "none",
                    background: dictationPhase === "listening" ? accentColor : "transparent",
                    color: dictationPhase === "listening" ? "#FFFFFF" : "#5F636B",
                    cursor: dictationPhase === "transcribing" ? "progress" : "pointer",
                    fontFamily: "inherit",
                    transform: dictationPhase === "listening" ? "scale(1.06)" : "scale(1)",
                    transition: "transform .16s ease, background .16s ease, color .16s ease",
                    touchAction: "none",
                    userSelect: "none",
                  }}
                >
                  <svg
                    width={17}
                    height={17}
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                    style={{ opacity: dictationPhase === "transcribing" ? 0.45 : 1 }}
                  >
                    <rect x={9} y={3} width={6} height={12} rx={3} />
                    <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
                  </svg>
                </button>
                <ComposerVoiceSendSlot
                  canSend={canSend}
                  accentColor={accentColor}
                  onSend={onSend}
                  onStartVoiceCall={onStartVoiceCall}
                  isResponding={isResponding}
                  onStop={onStop}
                />
              </div>
            </div>
          </div>

          {/* Connections (manage) face — mounted only while visible or
              mid-exit-fade (see mountedPanel/exitingPanel above). No extra
              padding/inset styling here — ConnectionsPanel/ConnectionsDetail
              already provide their own position:absolute + padding root;
              adding it again here was the earlier "blank panel" bug,
              doubling the inset and clipping the rows out of the bar. */}
          {mountedPanel === "manage" || exitingPanel === "manage" ? (
            <div
              style={{
                animation:
                  exitingPanel === "manage"
                    ? "clyraFade .2s ease reverse both"
                    : `clyraFade .28s ${SHELL_EASE} both`,
              }}
            >
              <ConnectionsPanel
                connections={connections}
                webOff={webOff}
                onClose={closeManage}
                onOpenDetail={() => setConnectionsStep("detail")}
              />
            </div>
          ) : null}

          {/* Connection detail face */}
          {mountedPanel === "detail" || exitingPanel === "detail" ? (
            <div
              style={{
                animation:
                  exitingPanel === "detail"
                    ? "clyraFade .2s ease reverse both"
                    : `clyraFade .28s ${SHELL_EASE} both`,
              }}
            >
              <ConnectionsDetail
                connections={connections}
                onBack={() => setConnectionsStep(null)}
              />
            </div>
          ) : null}
        </div>

        {/* Source dock — hover-magnifies like a macOS dock, cursor-proximity
            based. Always mounted (never conditionally unmounted): matches the
            artboard's railStyle exactly, which animates max-height/opacity/
            translateY to collapse the dock when Manage opens rather than
            yanking it out of the DOM with no transition. */}
        <div
          className="clyra-composer-shell__source-dock"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            overflow: mg || sent ? "hidden" : "visible",
            marginTop: mg || sent ? 0 : 20,
            maxHeight: mg || sent ? 0 : 76,
            opacity: mg || sent ? 0 : 1,
            transform: `translateY(${mg || sent ? -6 : 0}px)`,
            pointerEvents: mg || sent ? "none" : "auto",
            transition: `opacity .3s ease, transform .4s ${SHELL_EASE}`,
          }}
        >
          <div
            ref={dockRef}
            className="clyra-composer-shell__source-dock-items"
            onMouseMove={handleDockMove}
            onMouseLeave={handleDockLeave}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "12px 14px",
              borderRadius: 999,
              background: "transparent",
              ...entrance(0.12),
            }}
          >
            {sources.map((s) => {
              const on = activeSourceIds.includes(s.id);
              return (
                <button
                  key={s.id}
                  type="button"
                  data-dock="1"
                  title={s.name}
                  onClick={() => onToggleSource(s.id)}
                  style={{
                    position: "relative",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: 32,
                    height: 32,
                    border: "none",
                    borderRadius: 999,
                    background: "transparent",
                    cursor: "pointer",
                    opacity: on ? 1 : activeSourceIds.length ? 0.6 : 0.82,
                    willChange: "transform",
                    transition: "opacity .28s ease, background .26s ease",
                  }}
                >
                  {s.icon}
                  <span
                    style={{
                      position: "absolute",
                      left: "50%",
                      bottom: -1,
                      width: 4,
                      height: 4,
                      marginLeft: -2,
                      borderRadius: "50%",
                      background: accentColor,
                      opacity: on ? 1 : 0,
                      transform: `scale(${on ? 1 : 0.2})`,
                      transition:
                        "opacity .24s ease, transform .34s cubic-bezier(.16,1,.3,1)",
                    }}
                  />
                </button>
              );
            })}
            <div
              style={{
                width: 1,
                height: 16,
                background: "rgba(16,18,24,0.09)",
                margin: "0 5px",
              }}
            />
            <button
              type="button"
              onClick={() => setManageOpen(true)}
              style={{
                height: 30,
                padding: "0 12px",
                borderRadius: 999,
                border: "none",
                background: "transparent",
                cursor: "pointer",
                fontFamily: "inherit",
                fontSize: 12.5,
                fontWeight: 500,
                letterSpacing: "-0.005em",
                color: "#5F636B",
              }}
            >
              Manage
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}

function iconGhostButtonStyle(size: number): CSSProperties {
  return {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: size,
    height: size,
    borderRadius: 999,
    border: "none",
    background: "transparent",
    cursor: "pointer",
    color: "#5F636B",
  };
}

/**
 * One control, two states. Empty composer: the voice-call wave. Typed text:
 * the same slot morphs into the send arrow. Both icons stay mounted and
 * cross-fade (opacity + scale + slight rotation), so the change reads as one
 * control transforming rather than a button being swapped out.
 */
function ComposerVoiceSendSlot({
  canSend,
  accentColor,
  onSend,
  onStartVoiceCall,
  isResponding = false,
  onStop,
}: {
  canSend: boolean;
  accentColor: string;
  onSend: () => void;
  onStartVoiceCall?: () => void;
  isResponding?: boolean;
  onStop?: () => void;
}) {
  const canCall = Boolean(onStartVoiceCall);
  // While a reply streams the same control becomes Stop, so cancelling is one
  // press away. With no voice handler and no text there is nothing to call, so
  // the disabled send arrow stays.
  const mode: "stop" | "send" | "voice" = isResponding ? "stop" : canSend || !canCall ? "send" : "voice";
  const disabled = mode === "send" && !canSend;
  const label = mode === "stop" ? "Stop response" : mode === "send" ? "Send message" : "Start a voice call with Clyra";
  const layer = (on: boolean): CSSProperties => ({
    position: "absolute",
    inset: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    opacity: on ? 1 : 0,
    transform: `scale(${on ? 1 : 0.6}) rotate(${on ? 0 : -35}deg)`,
    transition: "opacity 220ms ease, transform 320ms cubic-bezier(.16,1,.3,1)",
  });
  const background =
    mode === "stop" ? "#15171C" : mode === "send" ? (canSend ? accentColor : "#EDEEF1") : accentColor;
  const color = mode === "stop" ? "#FFFFFF" : mode === "send" ? (canSend ? "#FFFFFF" : "#AFB3BB") : "#FFFFFF";

  return (
    <button
      type="button"
      className="clyra-voice-send-slot"
      data-mode={mode}
      title={mode === "stop" ? "Stop response (Esc)" : label}
      aria-label={label}
      disabled={disabled}
      onClick={() => {
        if (mode === "stop") onStop?.();
        else if (mode === "send") onSend();
        else onStartVoiceCall?.();
      }}
      style={{
        position: "relative",
        width: 34,
        height: 34,
        padding: 0,
        marginLeft: 2,
        borderRadius: 999,
        border: "none",
        flexShrink: 0,
        cursor: disabled ? "not-allowed" : "pointer",
        background,
        color,
        boxShadow: mode === "voice" || (mode === "send" && canSend) ? "0 2px 10px -2px rgba(30,111,255,0.55)" : "none",
        transition: "background 240ms cubic-bezier(.2,.8,.3,1), color 240ms ease, box-shadow 240ms ease",
      }}
    >
      <span aria-hidden="true" style={layer(mode === "voice")}>
        <VoiceWaveIcon />
      </span>
      <span aria-hidden="true" style={layer(mode === "send")}>
        <svg width={17} height={17} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.1} strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 19V6M6 12l6-6 6 6" />
        </svg>
      </span>
      <span aria-hidden="true" style={layer(mode === "stop")}>
        <svg width={13} height={13} viewBox="0 0 24 24" fill="currentColor">
          <rect x={5} y={5} width={14} height={14} rx={3} />
        </svg>
      </span>
    </button>
  );
}

function roundIconButtonStyle(size: number, color: string): CSSProperties {
  return {
    width: size,
    height: size,
    borderRadius: 999,
    border: "1px solid transparent",
    background: "transparent",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: "pointer",
    color,
  };
}

function ConnectionsPanel({
  connections,
  webOff,
  onClose,
  onOpenDetail,
}: {
  connections: ComposerConnectionsState;
  webOff: boolean;
  onClose: () => void;
  onOpenDetail: () => void;
}) {
  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        top: 0,
        padding: "18px 16px 16px 18px",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "2px 2px 14px 6px",
        }}
      >
        <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <span
            style={{
              fontSize: 14,
              fontWeight: 600,
              letterSpacing: "-0.012em",
              color: "#15171C",
            }}
          >
            Connections
          </span>
          <span style={{ fontSize: 11.5, color: "#63676F" }}>
            {connections.connected
              ? "Google Workspace connected"
              : "No apps connected"}
            {webOff ? " · web search off" : ""}
          </span>
        </span>
        <button
          type="button"
          onClick={onClose}
          title="Collapse"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            height: 30,
            padding: "0 11px",
            borderRadius: 999,
            border: "none",
            background: "rgba(16,18,24,0.05)",
            cursor: "pointer",
            fontFamily: "inherit",
            fontSize: 12.5,
            fontWeight: 500,
            color: "#15171C",
          }}
        >
          Done
          <svg
            width={11}
            height={11}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2.3}
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ opacity: 0.5 }}
          >
            <path d="M6 15l6-6 6 6" />
          </svg>
        </button>
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 13,
          padding: "11px 12px 11px 11px",
          borderRadius: 18,
        }}
      >
        <span
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 32,
            height: 32,
            borderRadius: 11,
            background: "#FFFFFF",
            boxShadow: "inset 0 0 0 1px rgba(16,18,24,0.07)",
          }}
        >
          <img
            src="https://www.gstatic.com/images/branding/product/2x/drive_48dp.png"
            alt=""
            style={{ width: 18, height: 18, objectFit: "contain" }}
          />
        </span>
        <span
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 2,
            flex: 1,
            minWidth: 0,
          }}
        >
          <span style={{ fontSize: 13.5, fontWeight: 500, color: "#15171C" }}>
            Google Workspace
          </span>
          <span
            style={{
              fontSize: 11.5,
              color: "#63676F",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {connections.connecting
              ? connections.connectNote || "Connecting…"
              : !connections.signInAvailable
                ? "Google sign-in isn't configured"
                : connections.connected
                  ? `${connections.email ?? ""}`
                  : "Sign in with Google to use Drive, Gmail, Docs and more"}
          </span>
        </span>
        <button
          type="button"
          onClick={() => {
            if (connections.connected) {
              onOpenDetail();
              return;
            }
            connections.onConnect();
          }}
          disabled={!connections.signInAvailable || connections.connecting}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 2,
            height: 29,
            padding: "0 12px",
            borderRadius: 999,
            border: "none",
            cursor: connections.signInAvailable ? "pointer" : "not-allowed",
            fontFamily: "inherit",
            fontSize: 12.5,
            fontWeight: 500,
            flexShrink: 0,
            background: connections.connected
              ? "rgba(16,18,24,0.06)"
              : "rgba(30,111,255,0.10)",
            color: connections.connected ? "#15171C" : "#0B54D6",
            opacity: connections.signInAvailable ? 1 : 0.55,
          }}
        >
          {connections.connecting
            ? "Connecting…"
            : connections.connected
              ? "Configure"
              : "Sign in"}
        </button>
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 13,
          marginTop: 2,
          padding: "11px 12px 11px 11px",
          borderRadius: 18,
        }}
      >
        <span
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 32,
            height: 32,
            borderRadius: 11,
            background: "#FFFFFF",
            boxShadow: "inset 0 0 0 1px rgba(16,18,24,0.07)",
          }}
        >
          <svg
            width={16}
            height={16}
            viewBox="0 0 24 24"
            fill="none"
            stroke="#5F636B"
            strokeWidth={1.7}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx={12} cy={12} r={8.5} />
            <path d="M3.5 12h17M12 3.5c2.4 2.5 3.7 5.3 3.7 8.5S14.4 18 12 20.5c-2.4-2.5-3.7-5.3-3.7-8.5S9.6 6 12 3.5z" />
          </svg>
        </span>
        <span
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 2,
            flex: 1,
            minWidth: 0,
          }}
        >
          <span style={{ fontSize: 13.5, fontWeight: 500, color: "#15171C" }}>
            Web search
          </span>
          <span style={{ fontSize: 11.5, color: "#63676F" }}>
            {webOff ? "Disabled" : "Live results from the web"}
          </span>
        </span>
        <button
          type="button"
          onClick={connections.onToggleWebSearch}
          title="Toggle web search"
          style={{
            display: "flex",
            alignItems: "center",
            width: 38,
            height: 23,
            borderRadius: 999,
            padding: 2,
            flexShrink: 0,
            boxSizing: "border-box",
            border: "none",
            cursor: "pointer",
            background: webOff ? "rgba(16,18,24,0.16)" : "#1E6FFF",
            justifyContent: webOff ? "flex-start" : "flex-end",
          }}
        >
          <span
            style={{
              display: "block",
              width: 19,
              height: 19,
              borderRadius: 999,
              background: "#FFFFFF",
              boxShadow: "0 1px 3px rgba(16,18,24,0.30)",
            }}
          />
        </button>
      </div>

      {webOff ? (
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 8,
            marginTop: 10,
            borderRadius: 14,
            background: "rgba(214,158,32,0.10)",
            padding: "11px 12px",
          }}
        >
          <svg
            width={14}
            height={14}
            viewBox="0 0 24 24"
            fill="none"
            stroke="#9A6B12"
            strokeWidth={1.8}
            strokeLinecap="round"
            style={{ flexShrink: 0, marginTop: 1 }}
          >
            <path d="M12 8.5v5M12 16.8v.2" />
            <circle cx={12} cy={12} r={9} />
          </svg>
          <span style={{ fontSize: 11.5, lineHeight: 1.45, color: "#7A5A12" }}>
            Web search is off. Clyra's information will be very limited and may
            be out of date.
          </span>
        </div>
      ) : null}
    </div>
  );
}

function ConnectionsDetail({
  connections,
  onBack,
}: {
  connections: ComposerConnectionsState;
  onBack: () => void;
}) {
  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        top: 0,
        padding: "18px 16px 16px 18px",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "0 2px 12px 2px",
        }}
      >
        <button
          type="button"
          onClick={onBack}
          title="Back"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 30,
            height: 30,
            borderRadius: 999,
            border: "none",
            background: "rgba(16,18,24,0.05)",
            cursor: "pointer",
            color: "#15171C",
          }}
        >
          <svg
            width={13}
            height={13}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2.3}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M15 6l-6 6 6 6" />
          </svg>
        </button>
        <span
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 1,
            flex: 1,
            minWidth: 0,
          }}
        >
          <span
            style={{
              fontSize: 14,
              fontWeight: 600,
              letterSpacing: "-0.012em",
              color: "#15171C",
            }}
          >
            Google Workspace
          </span>
          <span
            style={{
              fontSize: 11.5,
              color: "#63676F",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {connections.email ?? ""}
          </span>
        </span>
        <button
          type="button"
          onClick={() => {
            connections.onDisconnect();
            onBack();
          }}
          style={{
            height: 28,
            padding: "0 12px",
            borderRadius: 999,
            border: "none",
            background: "transparent",
            cursor: "pointer",
            fontFamily: "inherit",
            fontSize: 12.5,
            fontWeight: 500,
            color: "#A03A2C",
          }}
        >
          Disconnect
        </button>
      </div>
      <span
        style={{
          display: "block",
          padding: "0 6px 6px",
          fontSize: 10.5,
          fontWeight: 600,
          letterSpacing: "0.05em",
          textTransform: "uppercase",
          color: "#5F636B",
        }}
      >
        Clyra can access
      </span>
      <div style={{ display: "flex", flexDirection: "column" }}>
        {connections.scopes.map((sc) => (
          <div
            key={sc.id}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              width: "100%",
              height: 36,
              padding: "0 8px 0 6px",
              borderRadius: 12,
              opacity: sc.enabled ? 1 : 0.62,
            }}
          >
            <span
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                width: 20,
                flexShrink: 0,
              }}
            >
              {sc.icon}
            </span>
            <span
              style={{
                flex: 1,
                textAlign: "left",
                fontSize: 13,
                fontWeight: 500,
                color: "#15171C",
              }}
            >
              {sc.name}
            </span>
            <span style={{ fontSize: 11.5, color: "#63676F", marginRight: 4 }}>
              {sc.enabled ? "Read" : "No access"}
            </span>
            <button
              type="button"
              onClick={sc.onToggle}
              title="Toggle"
              style={{
                display: "flex",
                alignItems: "center",
                width: 38,
                height: 23,
                borderRadius: 999,
                padding: 2,
                flexShrink: 0,
                boxSizing: "border-box",
                border: "none",
                cursor: "pointer",
                background: sc.enabled ? "#1E6FFF" : "rgba(16,18,24,0.16)",
                justifyContent: sc.enabled ? "flex-end" : "flex-start",
              }}
            >
              <span
                style={{
                  display: "block",
                  width: 19,
                  height: 19,
                  borderRadius: 999,
                  background: "#FFFFFF",
                  boxShadow: "0 1px 3px rgba(16,18,24,0.30)",
                }}
              />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
