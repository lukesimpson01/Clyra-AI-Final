import { useEffect, useRef, useState } from "react";
import { useFollowGrowth } from "./ChatAgentRun";
import {
  AppWindow, ArrowLeft, ArrowRight, Brain, CircleHelp, Clock, Download, Eye, Globe, Keyboard, MousePointerClick, Navigation, RefreshCw, Search, SquareArrowOutUpRight, Square, TextCursorInput, TriangleAlert,
} from "lucide-react";
import { motion } from "motion/react";
import { AgentCursorGlyph } from "../agent/AgentCursorGlyph";
import { ActivityDisclosure, ShimmerText } from "./assistant";
import type { ActionIconKey, AgentStatus, RunItem } from "../../lib/browserRunFeed";

export type ChatBrowserRunState = {
  task: string;
  items: RunItem[];
  status: AgentStatus;
  /** the page the agent is on, from the browser's own state */
  url?: string;
  title?: string;
  /** a step the agent could not take is reported here, never hidden */
  note?: string;
  /** where the agent's pointer is, in the page's own pixels, and the page size those pixels belong to */
  cursor?: { x: number; y: number; kind?: string; id: number } | null;
  viewport?: { width: number; height: number };
  /** one of Clyra's own apps being operated (not the web): its name is shown in place of any address */
  tool?: { id: string; name: string; workspace?: string };
};

const ICONS: Record<ActionIconKey, typeof Globe> = {
  click: MousePointerClick, keyboard: Keyboard, navigate: Navigation, search: Search, scrollDown: ArrowRight, scrollUp: ArrowLeft, back: ArrowLeft, forward: ArrowRight,
  reload: RefreshCw, tab: AppWindow, wait: Clock, read: Eye, check: TextCursorInput, hover: MousePointerClick, done: Globe, ask: CircleHelp, generic: Download,
};

/** The managed browser's own live frame, the way the Browser app shows it: refreshed while the agent works, frozen when it stops. */
function useLiveFrame(active: boolean) {
  const [src, setSrc] = useState<string | null>(null);
  const current = useRef<string | null>(null);
  useEffect(() => {
    if (!active) return;
    let stopped = false;
    let timer = 0;
    const tick = async () => {
      try {
        const response = await fetch(`/api/openbrowser/frame?fresh=1&t=${Date.now()}`, { cache: "no-store" });
        if (response.ok) {
          const url = URL.createObjectURL(await response.blob());
          if (stopped) { URL.revokeObjectURL(url); return; }
          const previous = current.current;
          current.current = url;
          setSrc(url);
          if (previous) window.setTimeout(() => URL.revokeObjectURL(previous), 1500);
        }
      } catch { /* the next tick tries again */ }
      if (!stopped) timer = window.setTimeout(tick, 750);
    };
    void tick();
    return () => { stopped = true; window.clearTimeout(timer); };
  }, [active]);
  useEffect(() => () => { if (current.current) URL.revokeObjectURL(current.current); }, []);
  return src;
}

const hostOf = (url?: string) => { try { return url ? new URL(url).hostname.replace(/^www\./, "") : ""; } catch { return url ?? ""; } };

function Row({ item }: { item: RunItem }) {
  if (item.kind === "action") {
    const Icon = ICONS[item.icon] ?? Globe;
    const running = item.status === "running";
    return (
      <li className={`clyra-ai-row clyra-ai-row--${running ? "running" : item.status === "error" ? "failed" : "done"}`}>
        <span className="clyra-ai-row__icon" aria-hidden><Icon /></span>
        <span className="clyra-ai-row__label">{running ? <ShimmerText>{item.label}</ShimmerText> : item.label}</span>
        {item.status === "error" && item.result ? <span className="clyra-agent-meta" title={item.result}>{item.result}</span> : null}
      </li>
    );
  }
  if (item.kind === "reasoning") {
    return (
      <li className="clyra-ai-row clyra-ai-row--done">
        <span className="clyra-ai-row__icon" aria-hidden><Brain /></span>
        <span className="clyra-ai-row__label">{item.nextGoal}</span>
      </li>
    );
  }
  if (item.kind === "recovery" || item.kind === "strategy") {
    return (
      <li className="clyra-ai-row clyra-ai-row--done">
        <span className="clyra-ai-row__icon" aria-hidden><TriangleAlert /></span>
        <span className="clyra-ai-row__label">{item.message}</span>
      </li>
    );
  }
  if (item.kind === "ask") {
    return (
      <li className="clyra-ai-row clyra-ai-row--running">
        <span className="clyra-ai-row__icon" aria-hidden><CircleHelp /></span>
        <span className="clyra-ai-row__label">{item.question}</span>
      </li>
    );
  }
  return null;
}

/**
 * A browser task run from chat, with the real browser in view: a small live window onto the managed browser (the
 * same one the Browser app drives, same agent loop) and, under it, every action the agent takes as it takes it.
 * When the run ends the window freezes on its last frame and the actions fold into "Used the browser · N actions".
 */
export function ChatBrowserRunView({ run, live, onStop, onOpenTool }: { run: ChatBrowserRunState; live: boolean; onStop?: () => void; onOpenTool?: () => void }) {
  const frame = useLiveFrame(live && !run.tool);
  const rootRef = useRef<HTMLElement | null>(null);
  useFollowGrowth(rootRef, run.items.length, live);
  const rows = run.items.filter((item) => item.kind !== "complete");
  const actions = run.items.filter((item) => item.kind === "action").length;
  const toolName = run.tool?.name;
  const host = toolName ?? hostOf(run.url);
  const subject = toolName ?? "the browser";
  const title = live ? `Using ${subject}` : run.status === "failed" ? `${toolName ? `${toolName} task` : "The browser task"} didn’t finish` : run.status === "cancelled" ? `${toolName ? `${toolName} task` : "Browser task"} stopped` : `Used ${subject} · ${actions} action${actions === 1 ? "" : "s"}`;
  const lastAction = [...rows].reverse().find((item) => item.kind === "action") as Extract<RunItem, { kind: "action" }> | undefined;
  const visible = live ? rows.slice(-8) : rows;
  return (
    <section className="clyra-browserrun" aria-label="Browser activity" ref={rootRef}>
      <div className="clyra-browserrun__head">
        <span className="clyra-ai-row__icon" aria-hidden><Globe /></span>
        <span className="clyra-browserrun__title">{live ? <ShimmerText>{title}</ShimmerText> : title}</span>
        {live && onStop ? <button type="button" className="clyra-browserrun__stop" onClick={onStop}><Square /> Stop</button> : null}
      </div>
      {frame || live || toolName ? (
        <div className={`clyra-browserrun__window${live ? " is-live" : ""}`}>
          <div className="clyra-browserrun__bar" aria-hidden>
            <i /><i /><i />
            <span className="clyra-browserrun__url">{host || "Opening the browser…"}</span>
          </div>
          <div className="clyra-browserrun__view">
            {toolName
              ? <div className="clyra-browserrun__tool"><AppWindow aria-hidden /><strong>{toolName}</strong><span>{live ? (lastAction?.label ?? "Getting started") : run.status === "completed" ? "Done" : "Stopped"}</span></div>
              : frame ? <img src={frame} alt={host ? `The browser on ${host}` : "The browser"} draggable={false} /> : <div className="clyra-browserrun__wait">Starting the browser…</div>}
            {/* The Clyra agent-UI kit's working state: a soft blue field with a slow drifting glow over the page, and its
                pointer. The pointer goes where the agent's real cursor events say, and ripples when it clicks. */}
            <span className={`clyra-bf${live ? " is-working" : ""}`} aria-hidden />
            {live && run.cursor && !toolName ? (
              <motion.div
                className="clyra-pointer"
                initial={false}
                animate={{
                  left: `${Math.min(100, Math.max(0, (run.cursor.x / (run.viewport?.width || 1440)) * 100))}%`,
                  top: `${Math.min(100, Math.max(0, (run.cursor.y / (run.viewport?.height || 900)) * 100))}%`,
                }}
                transition={{ type: "spring", stiffness: 430, damping: 38, mass: 0.38, restDelta: 0.1 }}
                aria-hidden
              >
                <span className="clyra-pointer__halo" />
                <AgentCursorGlyph pressed={run.cursor.kind === "click" || run.cursor.kind === "double_click" || run.cursor.kind === "right_click"} />
                {run.cursor.kind === "click" || run.cursor.kind === "double_click" ? <span key={`w${run.cursor.id}`} className="clyra-pointer__wave" aria-hidden><i className="clyra-pointer__flash" />{[0, 1].map((n) => <i key={n} className="clyra-pointer__ripple" style={{ "--n": n } as React.CSSProperties} />)}</span> : null}
              </motion.div>
            ) : null}
          </div>
        </div>
      ) : null}
      {live ? (
        visible.length ? <ul className="clyra-ai-activity" aria-label="Browser actions">{visible.map((item) => <Row key={item.id} item={item} />)}</ul> : null
      ) : rows.length ? (
        <ActivityDisclosure icon={<SquareArrowOutUpRight />} label={`${actions} action${actions === 1 ? "" : "s"} taken`}>
          <ul className="clyra-ai-activity" aria-label="Browser actions">{rows.map((item) => <Row key={item.id} item={item} />)}</ul>
        </ActivityDisclosure>
      ) : null}
      {run.note ? <p className="clyra-ai-status__detail">{run.note}</p> : null}
      {toolName && onOpenTool ? <button type="button" className="clyra-browserrun__open" onClick={onOpenTool}>Open {toolName}</button> : null}
    </section>
  );
}
