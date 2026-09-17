import { Component, useCallback, useEffect, useRef, useState, type ComponentProps, type ReactNode } from "react";
import { motion } from "motion/react";
import { LoaderCircle, PanelBottomClose, PanelBottomOpen, Pencil, Plus, Terminal as TerminalIcon, X } from "lucide-react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { AGENT_EASE } from "./motion";
import { createTerminalBridge, type TerminalBridge } from "../../lib/terminalBridge";

type SessionTab = {
  id: string;
  label: string;
  /** A problem reported by the coding workspace, rendered in the shell itself. */
  error?: string;
  /** The terminal transport itself could not start or exited unexpectedly. */
  connectionFailed?: boolean;
  busy?: boolean;
};

function shellLabel() {
  if (navigator.userAgent.includes("Windows")) return "PowerShell";
  if (navigator.userAgent.includes("Linux")) return "bash";
  return "zsh";
}

const TERM_THEME = { background: "#FFFFFF", foreground: "#282B2F", cursor: "#3977F6", cursorAccent: "#FFFFFF", selectionBackground: "rgba(57,119,246,0.16)", black: "#3F4347", red: "#C24949", green: "#268A50", yellow: "#B87918", blue: "#3977F6", magenta: "#9A5CC9", cyan: "#1F8A9A", white: "#B7B9BD", brightBlack: "#96989D", brightRed: "#E07B7B", brightGreen: "#4FAE74", brightYellow: "#D9A04C", brightBlue: "#7CA6F8", brightMagenta: "#BC8FDF", brightCyan: "#57B6C4", brightWhite: "#FFFFFF" };

class TerminalErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? <div className="h-8 border-t border-black/[0.06] bg-white px-3 py-2 text-[11px] text-[#B94B4B]">Terminal unavailable in this view</div> : this.props.children; }
}

function TerminalPanelInner({ projectId, open, height, onHeightChange, onToggle, reportedError = null, agentActivityCount: _agentActivityCount = 0 }: { projectId: string | null; open: boolean; height: number; onHeightChange: (height: number) => void; onToggle: () => void; reportedError?: { id: string; message: string } | null; agentActivityCount?: number }) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const bridgeRef = useRef<TerminalBridge | null>(null);
  const activeRef = useRef("terminal-1");
  const outputRef = useRef(new Map<string, string>());
  const sequenceRef = useRef(1);
  const startupTimersRef = useRef(new Map<string, number>());
  const followOutputRef = useRef(true);
  const followFrameRef = useRef<number | null>(null);
  const reportedErrorRef = useRef<string | null>(null);
  const [hostReady, setHostReady] = useState(false);
  const [tabs, setTabs] = useState<SessionTab[]>([{ id: "terminal-1", label: shellLabel() }]);
  const [activeTab, setActiveTab] = useState("terminal-1");
  const [editingTab, setEditingTab] = useState<string | null>(null);
  const [tabLabel, setTabLabel] = useState("");
  const tabInputRef = useRef<HTMLInputElement | null>(null);

  const fit = useCallback((tabId = activeRef.current) => {
    const node = mountRef.current;
    const term = termRef.current;
    const fitAddon = fitAddonRef.current;
    if (!node || !term || !fitAddon || node.clientWidth < 8 || node.clientHeight < 8) return;
    fitAddon.fit();
    bridgeRef.current?.resize(tabId, term.cols, term.rows);
  }, []);

  const followLatest = useCallback((force = false) => {
    const term = termRef.current;
    if (!term || (!force && !followOutputRef.current) || followFrameRef.current !== null) return;
    followFrameRef.current = requestAnimationFrame(() => {
      followFrameRef.current = null;
      if (force || followOutputRef.current) termRef.current?.scrollToBottom();
    });
  }, []);

  const connect = useCallback((tabId: string) => {
    if (!termRef.current) return;
    const bridge = bridgeRef.current ?? (bridgeRef.current = createTerminalBridge());
    const hasLiveOutput = Boolean(outputRef.current.get(tabId));
    // A collapsed/reselected tab already has a real shell and scrollback.
    // Don't turn it back into a "starting" session or arm a stale timeout.
    if (hasLiveOutput) {
      setTabs((items) => items.map((item) => item.id === tabId ? { ...item, connectionFailed: false, busy: false } : item));
      fit(tabId);
      return;
    }
    setTabs((items) => items.map((item) => item.id === tabId ? { ...item, connectionFailed: false, busy: true } : item));
    // A fresh workspace has no project yet.  Still give the user a working
    // shell immediately, rooted in Clyra's projects directory, rather than
    // leaving a permanently blank terminal until their first prompt.
    void bridge.open(projectId ?? "", tabId).then(() => {
      // Socket connection is enough to make the panel usable. The first PTY
      // output clears the tiny starting marker; it is not a prerequisite for
      // rendering or focusing xterm.
      fit(tabId);
    }).catch(() => setTabs((items) => items.map((item) => item.id === tabId ? { ...item, connectionFailed: true, busy: false } : item)));
    const existingTimer = startupTimersRef.current.get(tabId);
    if (existingTimer) window.clearTimeout(existingTimer);
    startupTimersRef.current.set(tabId, window.setTimeout(() => {
      // A prompt can arrive on the first socket tick while a reconnect timer
      // from a preceding project selection is still pending. Never paint a
      // failure over a terminal that has received real shell output.
      if (outputRef.current.get(tabId)) return;
      setTabs((items) => items.map((item) => item.id === tabId && item.busy ? { ...item, connectionFailed: true, busy: false } : item));
    }, 2000));
  }, [fit, projectId]);

  useEffect(() => {
    if (!hostReady) return;
    if (!termRef.current && mountRef.current) {
      const term = new Terminal({
        convertEol: false,
        cursorBlink: true,
        // A terminal cursor belongs on the character baseline. An underline
        // reads like a broken input field in a light shell, while this thin
        // bar is the familiar native zsh / PowerShell insertion point.
        cursorStyle: "bar",
        cursorWidth: 1,
        scrollback: 10_000,
        fontFamily: '"SFMono-Regular", "SF Mono", Menlo, Monaco, Consolas, monospace',
        fontSize: 12.5,
        lineHeight: 1.4,
        theme: TERM_THEME,
        allowProposedApi: true,
      });
      const fitAddon = new FitAddon();
      term.loadAddon(fitAddon);
      term.open(mountRef.current);
      // Make the whole shell surface reliably editable after a click, rather
      // than requiring users to hunt for xterm's hidden textarea.
      mountRef.current.addEventListener("pointerdown", () => term.focus());
      term.onData((data) => bridgeRef.current?.write(activeRef.current, data));
      term.onScroll((viewportY) => {
        const buffer = term.buffer.active;
        followOutputRef.current = buffer.baseY - viewportY <= 2;
      });
      termRef.current = term;
      fitAddonRef.current = fitAddon;
    }
    const bridge = bridgeRef.current ?? (bridgeRef.current = createTerminalBridge());
    const offData = bridge.onData((tabId, data) => {
      const timer = startupTimersRef.current.get(tabId);
      if (timer) {
        window.clearTimeout(timer);
        startupTimersRef.current.delete(tabId);
      }
      setTabs((items) => items.map((item) => item.id === tabId ? { ...item, busy: false, connectionFailed: false } : item));
      outputRef.current.set(tabId, (outputRef.current.get(tabId) || "") + data);
      if (tabId === activeRef.current) {
        const term = termRef.current;
        const buffer = term?.buffer.active;
        if (buffer && buffer.baseY - buffer.viewportY <= 2) followOutputRef.current = true;
        term?.write(data, () => followLatest());
      }
    });
    const offExit = bridge.onExit((tabId) => {
      const timer = startupTimersRef.current.get(tabId);
      if (timer) {
        window.clearTimeout(timer);
        startupTimersRef.current.delete(tabId);
      }
      setTabs((items) => items.map((item) => item.id === tabId ? { ...item, busy: false, connectionFailed: true } : item));
    });
    connect(activeRef.current);
    return () => {
      offData();
      offExit();
      for (const timer of startupTimersRef.current.values()) window.clearTimeout(timer);
      startupTimersRef.current.clear();
    };
  }, [connect, followLatest, hostReady, projectId]);

  useEffect(() => {
    activeRef.current = activeTab;
    const term = termRef.current;
    if (!term) return;
    term.reset();
    const saved = outputRef.current.get(activeTab);
    if (saved) term.write(saved);
    followOutputRef.current = true;
    connect(activeTab);
    requestAnimationFrame(() => { fit(activeTab); followLatest(true); term.focus(); });
  }, [activeTab, connect, fit, followLatest, projectId]);

  useEffect(() => {
    const node = mountRef.current;
    if (!node || !open) return;
    const observer = new ResizeObserver(() => {
      requestAnimationFrame(() => { fit(); followLatest(); });
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [fit, followLatest, height, open]);

  useEffect(() => {
    if (editingTab) requestAnimationFrame(() => { tabInputRef.current?.focus(); tabInputRef.current?.select(); });
  }, [editingTab]);

  useEffect(() => {
    if (!reportedError || reportedErrorRef.current === reportedError.id) return;
    const message = reportedError.message.trim();
    if (!message) return;
    reportedErrorRef.current = reportedError.id;

    // Keep coding errors in a terminal-shaped place. When the user is already
    // looking at a shell, append there; otherwise leave a distinct failed tab
    // waiting in the tab strip without unexpectedly expanding the drawer.
    const tabId = open ? activeRef.current : `terminal-${++sequenceRef.current}`;
    const output = `\r\n\x1b[1;31m✕ Clyra error\x1b[0m\r\n\x1b[31m${message}\x1b[0m\r\n`;
    outputRef.current.set(tabId, `${outputRef.current.get(tabId) || ""}${output}`);
    setTabs((items) => {
      const exists = items.some((item) => item.id === tabId);
      if (!exists) return [...items, { id: tabId, label: "Error", error: message }];
      return items.map((item) => item.id === tabId ? { ...item, error: message, busy: false } : item);
    });
    if (!open) {
      setActiveTab(tabId);
      // The error tab is still a real shell session, not a dead-end log. Its
      // diagnostic is written first, then its prompt joins the scrollback.
      const bridge = bridgeRef.current ?? (bridgeRef.current = createTerminalBridge());
      void bridge.open(projectId ?? "", tabId)
        .then(() => fit(tabId))
        .catch(() => setTabs((items) => items.map((item) => item.id === tabId ? { ...item, connectionFailed: true } : item)));
    }
    if (tabId === activeRef.current) {
      termRef.current?.write(output, () => followLatest(true));
    }
  }, [fit, followLatest, open, projectId, reportedError]);

  const addTab = () => {
    const id = `terminal-${++sequenceRef.current}`;
    outputRef.current.set(id, "");
    setTabs((items) => [...items, { id, label: shellLabel() }]);
    setActiveTab(id);
  };
  const closeTab = (tabId: string) => {
    if (tabs.length === 1) return;
    bridgeRef.current?.kill(tabId);
    outputRef.current.delete(tabId);
    setTabs((items) => {
      const index = items.findIndex((item) => item.id === tabId);
      const next = items.filter((item) => item.id !== tabId);
      if (tabId === activeRef.current) setActiveTab(next[Math.max(0, index - 1)]?.id || next[0].id);
      return next;
    });
  };
  const restart = (tabId = activeTab) => {
    bridgeRef.current?.kill(tabId);
    outputRef.current.set(tabId, "");
    termRef.current?.reset();
    setTabs((items) => items.map((item) => item.id === tabId ? { ...item, error: undefined, connectionFailed: false } : item));
    window.setTimeout(() => connect(tabId), 24);
  };
  const renameTab = (tabId: string) => {
    const label = tabLabel.trim();
    if (label) setTabs((items) => items.map((item) => item.id === tabId ? { ...item, label } : item));
    setEditingTab(null);
  };
  const onDragStart = (event: React.PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    const startY = event.clientY; const startHeight = height;
    const move = (moveEvent: PointerEvent) => onHeightChange(Math.min(520, Math.max(120, startHeight + startY - moveEvent.clientY)));
    const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", up);
  };

  const active = tabs.find((item) => item.id === activeTab);
  const activeFailed = Boolean(active?.error || active?.connectionFailed);
  return <div className="shrink-0 border-t border-black/[0.07] bg-white">
    <div className="flex h-8 items-center gap-1 border-b border-black/[0.055] px-2.5" role="tablist" aria-label="Terminal sessions">
      <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto [scrollbar-width:none]">
        {tabs.map((tab) => <button key={tab.id} type="button" role="tab" aria-selected={tab.id === activeTab} onClick={() => { setActiveTab(tab.id); if (!open) onToggle(); }} className={`group relative flex h-7 min-w-[120px] max-w-[220px] items-center gap-1.5 rounded-[7px] px-2.5 text-left text-[11.5px] transition-colors duration-150 ${tab.id === activeTab ? "bg-black/[0.055] text-[#292B30]" : "text-[#85878C] hover:bg-black/[0.03] hover:text-[#4D4F54]"}`}>
          {tab.busy ? <LoaderCircle className="h-3.5 w-3.5 shrink-0 animate-spin" strokeWidth={1.7} /> : <TerminalIcon className="h-3.5 w-3.5 shrink-0" strokeWidth={1.7} />}
          {editingTab === tab.id ? <input ref={tabInputRef} value={tabLabel} aria-label="Rename terminal" onClick={(event) => event.stopPropagation()} onChange={(event) => setTabLabel(event.target.value)} onBlur={() => renameTab(tab.id)} onKeyDown={(event) => { if (event.key === "Enter") renameTab(tab.id); if (event.key === "Escape") setEditingTab(null); }} className="min-w-0 flex-1 bg-transparent text-[11.5px] outline-none" /> : <span className="min-w-0 flex-1 truncate">{tab.label}</span>}{tab.error || tab.connectionFailed ? <span aria-label="Terminal error" className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#C24949]" /> : null}
          <span className="ml-auto flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity duration-100 group-hover:opacity-100">
            <span role="button" aria-label={`Rename ${tab.label}`} onClick={(event) => { event.stopPropagation(); setTabLabel(tab.label); setEditingTab(tab.id); }} className="flex h-4 w-4 items-center justify-center rounded text-[#92949A] hover:bg-black/[0.07]"><Pencil className="h-2.5 w-2.5" /></span>
            {tabs.length > 1 ? <span role="button" aria-label={`Close ${tab.label}`} onClick={(event) => { event.stopPropagation(); closeTab(tab.id); }} className="flex h-4 w-4 items-center justify-center rounded text-[#92949A] hover:bg-black/[0.07]"><X className="h-3 w-3" /></span> : null}
          </span>
        </button>)}
        <button type="button" aria-label="New terminal tab" title="New terminal tab" onClick={addTab} className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[7px] text-[#77797E] transition-colors hover:bg-black/[0.045] hover:text-[#222428]"><Plus className="h-4 w-4" strokeWidth={1.7} /></button>
      </div>
      <button type="button" aria-label={open ? "Collapse terminal" : "Expand terminal"} title={open ? "Collapse terminal" : "Open terminal"} onClick={onToggle} className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] text-[#5F6368] transition-colors duration-150 hover:bg-black/[0.045]">{open ? <PanelBottomClose className="h-[16px] w-[16px]" strokeWidth={1.6} /> : <PanelBottomOpen className="h-[16px] w-[16px]" strokeWidth={1.6} />}</button>
    </div>
    <motion.div initial={false} animate={{ height: open ? height : 0, opacity: open ? 1 : 0 }} transition={{ height: { duration: 0.27, ease: AGENT_EASE }, opacity: { duration: 0.16 } }} className="relative overflow-hidden">
      <div className="absolute left-0 right-0 top-0 z-10 h-1.5 cursor-row-resize" onPointerDown={onDragStart} aria-hidden />
      {active?.busy ? <div className="pointer-events-none absolute right-2 top-1 z-10 text-[10.5px] text-[#96989D]">Starting shell…</div> : null}
      {activeFailed ? <div className="absolute right-2 top-1 z-10 flex items-center gap-1.5 text-[10.5px] text-[#B94B4B]"><span>{active?.error ? "Error reported" : "Shell failed to start"}</span>{active?.connectionFailed ? <button type="button" onClick={() => restart()} className="rounded px-1 py-0.5 text-[#55575C] hover:bg-black/[0.04]">Restart</button> : null}</div> : null}
      <div ref={(node) => { mountRef.current = node; if (node) setHostReady(true); }} className="h-full w-full bg-white px-2 pb-1.5 pt-1" />
    </motion.div>
  </div>;
}

export function TerminalPanel(props: ComponentProps<typeof TerminalPanelInner>) { return <TerminalErrorBoundary><TerminalPanelInner {...props} /></TerminalErrorBoundary>; }
