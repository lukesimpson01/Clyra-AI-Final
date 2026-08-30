import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { motion } from "motion/react";
import { ChevronDown, TerminalSquare, X } from "lucide-react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { createTerminalBridge, type TerminalBridge } from "../../lib/terminalBridge";
import { buildRunScript, getLanguageDisplayName } from "../../lib/runnableLanguages";
import { AGENT_EASE } from "../../lib/motion";
import { cn } from "../../lib/utils";

const TAB_ID = "chat-run";
const MIN_HEIGHT = 160;
const MAX_HEIGHT = 560;
const DEFAULT_HEIGHT = 300;

const TERM_THEME = {
  background: "#1E1E1E",
  foreground: "#E4E4E4",
  cursor: "#3977F6",
  cursorAccent: "#1E1E1E",
  selectionBackground: "rgba(57,119,246,0.28)",
  black: "#1E1E1E",
  red: "#E06C75",
  green: "#4FAE74",
  yellow: "#D9A04C",
  blue: "#61AFEF",
  magenta: "#C678DD",
  cyan: "#56B6C2",
  white: "#ABB2BF",
  brightBlack: "#5C6370",
  brightRed: "#E88B92",
  brightGreen: "#7FCC9C",
  brightYellow: "#E6B673",
  brightBlue: "#8EC3F4",
  brightMagenta: "#D6A6E9",
  brightCyan: "#80C6D0",
  brightWhite: "#FFFFFF",
};

type TerminalRunnerContextValue = {
  runInTerminal: (code: string, language: string) => void;
};

const TerminalRunnerContext = createContext<TerminalRunnerContextValue | null>(null);

export function useTerminalRunner(): TerminalRunnerContextValue {
  const ctx = useContext(TerminalRunnerContext);
  if (!ctx) {
    // Code blocks can render outside the provider in isolated previews; degrade
    // to a no-op rather than crashing the whole message.
    return { runInTerminal: () => undefined };
  }
  return ctx;
}

export function TerminalRunnerProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  // Stays true for the rest of the session once the drawer has opened once,
  // so collapsing it (unlike closing it) never unmounts the xterm instance —
  // xterm attaches to a specific DOM node and can't be re-parented.
  const [everOpened, setEverOpened] = useState(false);
  const [height, setHeight] = useState(DEFAULT_HEIGHT);
  const [status, setStatus] = useState<"idle" | "starting" | "ready" | "failed">("idle");
  const [runningLabel, setRunningLabel] = useState<string | null>(null);
  const [hostReady, setHostReady] = useState(false);

  const mountRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const bridgeRef = useRef<TerminalBridge | null>(null);
  const connectedRef = useRef<Promise<void> | null>(null);

  const fit = useCallback(() => {
    const node = mountRef.current;
    const term = termRef.current;
    const fitAddon = fitAddonRef.current;
    if (!node || !term || !fitAddon || node.clientWidth < 8 || node.clientHeight < 8) return;
    fitAddon.fit();
    bridgeRef.current?.resize(TAB_ID, term.cols, term.rows);
  }, []);

  const ensureConnected = useCallback(() => {
    if (!bridgeRef.current) bridgeRef.current = createTerminalBridge();
    if (!connectedRef.current) {
      setStatus("starting");
      connectedRef.current = bridgeRef.current
        .open("", TAB_ID)
        .then(() => {
          setStatus("ready");
          requestAnimationFrame(fit);
        })
        .catch(() => {
          setStatus("failed");
          connectedRef.current = null;
        });
    }
    return connectedRef.current;
  }, [fit]);

  // Mount xterm as soon as the drawer host exists, so the shell is already
  // warm by the time the first Run is pressed after opening.
  useEffect(() => {
    if (!hostReady || termRef.current || !mountRef.current) return;
    const term = new Terminal({
      convertEol: false,
      cursorBlink: true,
      cursorStyle: "bar",
      cursorWidth: 1,
      scrollback: 8_000,
      fontFamily: '"SFMono-Regular", "SF Mono", Menlo, Monaco, Consolas, monospace',
      fontSize: 12.5,
      lineHeight: 1.4,
      theme: TERM_THEME,
      allowProposedApi: true,
    });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(mountRef.current);
    mountRef.current.addEventListener("pointerdown", () => term.focus());
    term.onData((data) => bridgeRef.current?.write(TAB_ID, data));
    termRef.current = term;
    fitAddonRef.current = fitAddon;

    const bridge = bridgeRef.current ?? (bridgeRef.current = createTerminalBridge());
    const offData = bridge.onData((tabId, data) => {
      if (tabId !== TAB_ID) return;
      term.write(data);
    });
    const offExit = bridge.onExit((tabId) => {
      if (tabId !== TAB_ID) return;
      setStatus("failed");
      connectedRef.current = null;
    });
    return () => {
      offData();
      offExit();
    };
  }, [hostReady]);

  useEffect(() => {
    if (!open) return;
    void ensureConnected();
    requestAnimationFrame(() => {
      fit();
      termRef.current?.focus();
    });
  }, [open, ensureConnected, fit]);

  useEffect(() => {
    if (!open) return;
    const node = mountRef.current;
    if (!node) return;
    const observer = new ResizeObserver(() => requestAnimationFrame(fit));
    observer.observe(node);
    return () => observer.disconnect();
  }, [open, fit, height]);

  const runInTerminal = useCallback(
    (code: string, language: string) => {
      const script = buildRunScript(language, code);
      if (!script) return;
      setRunningLabel(getLanguageDisplayName(language));
      setEverOpened(true);
      setOpen(true);
      void ensureConnected().then(() => bridgeRef.current?.write(TAB_ID, script));
    },
    [ensureConnected],
  );

  const onDragStart = (event: React.PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    const startY = event.clientY;
    const startHeight = height;
    const move = (moveEvent: PointerEvent) => {
      setHeight(Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, startHeight + startY - moveEvent.clientY)));
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const contextValue = useMemo(() => ({ runInTerminal }), [runInTerminal]);

  return (
    <TerminalRunnerContext.Provider value={contextValue}>
      {children}
      {typeof document !== "undefined" && everOpened
        ? createPortal(
            <div
              className="fixed inset-x-0 bottom-0 z-[70] flex justify-center px-3 pb-3 sm:px-6"
              style={{ pointerEvents: open ? "auto" : "none" }}
            >
              <motion.div
                initial={{ height: 0, opacity: 0, y: 16 }}
                animate={{ height: open ? height : 0, opacity: open ? 1 : 0, y: open ? 0 : 16 }}
                transition={{ duration: 0.22, ease: AGENT_EASE }}
                className="flex w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-black/[0.08] bg-[#1E1E1E] shadow-[0_24px_60px_rgba(15,23,42,0.35)]"
              >
                <div
                  className="h-1.5 shrink-0 cursor-row-resize"
                  onPointerDown={onDragStart}
                  aria-hidden
                />
                <div className="flex h-9 shrink-0 items-center justify-between border-b border-white/[0.08] px-3">
                  <div className="flex items-center gap-2 text-[12px] font-medium text-white/85">
                    <TerminalSquare className="h-3.5 w-3.5" strokeWidth={1.7} />
                    <span>Terminal</span>
                    {runningLabel ? (
                      <span className="text-[11px] font-normal text-white/50">Running {runningLabel}</span>
                    ) : null}
                    {status === "failed" ? (
                      <span className="text-[11px] font-normal text-[#E06C75]">Shell unavailable</span>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      aria-label="Collapse terminal"
                      onClick={() => setOpen(false)}
                      className="flex h-6 w-6 items-center justify-center rounded-md text-white/60 transition-colors hover:bg-white/10 hover:text-white"
                    >
                      <ChevronDown className="h-4 w-4" strokeWidth={1.8} />
                    </button>
                    <button
                      type="button"
                      aria-label="Close terminal"
                      onClick={() => {
                        setOpen(false);
                        bridgeRef.current?.kill(TAB_ID);
                        connectedRef.current = null;
                        setStatus("idle");
                        setRunningLabel(null);
                        termRef.current?.reset();
                      }}
                      className="flex h-6 w-6 items-center justify-center rounded-md text-white/60 transition-colors hover:bg-white/10 hover:text-white"
                    >
                      <X className="h-3.5 w-3.5" strokeWidth={1.8} />
                    </button>
                  </div>
                </div>
                <div
                  ref={(node) => {
                    mountRef.current = node;
                    if (node) setHostReady(true);
                  }}
                  className={cn("min-h-0 flex-1 bg-[#1E1E1E] px-2.5 pb-2 pt-1.5")}
                />
              </motion.div>
            </div>,
            document.body,
          )
        : null}
    </TerminalRunnerContext.Provider>
  );
}
