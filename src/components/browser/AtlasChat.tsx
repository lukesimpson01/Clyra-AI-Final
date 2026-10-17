import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Check,
  ChevronDown,
  Clock3,
  Copy,
  Globe2,
  Keyboard,
  MousePointer2,
  MousePointerClick,
  PencilLine,
  RefreshCw,
  Search,
  SquareStack,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";

/* ---------------------------------------------------------------------------
 * Shared run-feed types. The workspace reduces streamed agent events into
 * these and persists a finished run on the assistant message, so the action
 * log stays in the conversation (collapsed) after the task completes.
 * ------------------------------------------------------------------------- */

export type RunRowKind =
  | "click" | "keyboard" | "navigate" | "search" | "scroll" | "back" | "forward" | "reload"
  | "tab" | "wait" | "read" | "hover" | "done" | "ask" | "recover" | "generic";

export type RunRow = {
  id: string;
  kind: RunRowKind;
  verb: string;
  target?: string;
  status: "running" | "done" | "failed";
  detail?: string;
  goal?: string;
};

export type FinishedRun = {
  rows: RunRow[];
  durationMs: number;
  outcome: "completed" | "failed" | "stopped";
};

const ROW_ICONS: Record<RunRowKind, LucideIcon> = {
  click: MousePointerClick,
  keyboard: Keyboard,
  navigate: Globe2,
  search: Search,
  scroll: ChevronDown,
  back: ArrowLeft,
  forward: ArrowRight,
  reload: RefreshCw,
  tab: SquareStack,
  wait: Clock3,
  read: BookOpen,
  hover: MousePointer2,
  done: Check,
  ask: PencilLine,
  recover: TriangleAlert,
  generic: PencilLine,
};

const BRAIN = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M12 18V5.3a3 3 0 0 0-5.7-1.2 3.7 3.7 0 0 0-2.4 5.2A4 4 0 0 0 4.4 16a3.7 3.7 0 0 0 6 3.8L12 18Zm0 0V5.3a3 3 0 0 1 5.7-1.2 3.7 3.7 0 0 1 2.4 5.2A4 4 0 0 1 19.6 16a3.7 3.7 0 0 1-6 3.8L12 18Z" />
    <path d="M8 7.5c1.4.1 2.2 1 2.2 2.3M6.6 14.1c1.5-.3 2.8.3 3.1 1.8M16 7.5c-1.4.1-2.2 1-2.2 2.3M17.4 14.1c-1.5-.3-2.8.3-3.1 1.8" />
  </svg>
);

export function ThinkingRow({ label = "Thinking" }: { label?: string }) {
  return (
    <div className="ab-thinking" role="status">
      {BRAIN}
      <span className="ab-shine">{label}</span>
    </div>
  );
}

function clock(ms: number) {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function readable(ms: number) {
  const seconds = Math.max(1, Math.round(ms / 1000));
  const minutes = Math.floor(seconds / 60);
  return minutes ? `${minutes}m ${seconds % 60}s` : `${seconds}s`;
}

/** Codex-style connected action log. Live while running; collapses when finished. */
export function ActionStream({
  rows,
  live,
  startedAt,
  finished,
}: {
  rows: RunRow[];
  live: boolean;
  startedAt?: number;
  finished?: FinishedRun;
}) {
  const [collapsed, setCollapsed] = useState(Boolean(finished));
  const [openRow, setOpenRow] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!live) return;
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [live]);

  // A run that just finished folds itself away after a beat, like Codex.
  useEffect(() => {
    if (!finished || live) return;
    const timer = window.setTimeout(() => setCollapsed(true), 720);
    return () => window.clearTimeout(timer);
  }, [finished, live]);

  if (!rows.length) return null;
  const state = live
    ? "Working"
    : finished?.outcome === "stopped"
      ? `Stopped after ${readable(finished.durationMs)}`
      : finished?.outcome === "failed"
        ? `Needs attention · ${readable(finished?.durationMs || 0)}`
        : `Worked for ${readable(finished?.durationMs || 0)}`;

  return (
    <section className={`ab-actions ${collapsed ? "is-collapsed" : ""}`}>
      <button type="button" className="ab-actions-head" aria-expanded={!collapsed} onClick={() => setCollapsed((v) => !v)}>
        <PencilLine />
        <span className="ab-actions-name">Actions</span>
        <span className="ab-actions-state">{state}</span>
        {live && startedAt ? <span className="ab-actions-time">{clock(now - startedAt)}</span> : null}
        <ChevronDown className="ab-actions-chev" />
      </button>
      <div className="ab-actions-items">
        <div>
          {rows.map((row) => {
            const Icon = ROW_ICONS[row.kind] || PencilLine;
            const open = openRow === row.id;
            return (
              <div key={row.id} className={`ab-row is-${row.status === "running" ? "running" : row.status === "failed" ? "failed" : "done"} ${open ? "is-open" : ""}`}>
                <button type="button" className="ab-row-btn" aria-expanded={open} onClick={() => setOpenRow(open ? null : row.id)}>
                  <span className="ab-row-icon"><Icon /></span>
                  <span className={`ab-row-label ${row.status === "running" && live ? "ab-shine" : ""}`}>
                    {row.verb}{row.target ? <> {row.target}</> : null}
                  </span>
                  {row.detail || row.goal ? <span className="ab-row-more">⌄</span> : null}
                </button>
                {row.detail || row.goal ? (
                  <div className="ab-row-detail">{[row.goal, row.detail].filter(Boolean).join("\n\n")}</div>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

/* ---------------------------- Markdown-lite ----------------------------- */

function inline(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  const pattern = /(\[[^\]]+\]\(https?:\/\/[^\s)]+\)|\*\*[^*]+\*\*|`[^`]+`|https?:\/\/[^\s)]+)/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let index = 0;
  while ((match = pattern.exec(text))) {
    if (match.index > last) out.push(text.slice(last, match.index));
    const token = match[0];
    const key = `${keyBase}-${index++}`;
    if (token.startsWith("[")) {
      const link = token.match(/^\[([^\]]+)\]\((https?:\/\/[^)]+)\)$/);
      out.push(link ? <a key={key} href={link[2]} target="_blank" rel="noreferrer">{link[1]}</a> : token);
    } else if (token.startsWith("**")) out.push(<strong key={key}>{token.slice(2, -2)}</strong>);
    else if (token.startsWith("`")) out.push(<code key={key}>{token.slice(1, -1)}</code>);
    else out.push(<a key={key} href={token} target="_blank" rel="noreferrer">{token}</a>);
    last = pattern.lastIndex;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function Markdown({ text }: { text: string }) {
  const blocks = useMemo(() => text.replace(/\r/g, "").split(/\n{2,}/).filter((block) => block.trim()), [text]);
  return (
    <>
      {blocks.map((block, blockIndex) => {
        const lines = block.split("\n");
        if (lines.every((line) => /^\s*(?:[-*•]|\d+[.)])\s+/.test(line))) {
          const ordered = /^\s*\d/.test(lines[0] || "");
          const items = lines.map((line, i) => <li key={i}>{inline(line.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, ""), `${blockIndex}-${i}`)}</li>);
          return ordered ? <ol key={blockIndex}>{items}</ol> : <ul key={blockIndex}>{items}</ul>;
        }
        const heading = block.match(/^#{1,4}\s+(.*)$/);
        if (heading && lines.length === 1) return <p key={blockIndex}><strong>{heading[1]}</strong></p>;
        return (
          <p key={blockIndex}>
            {lines.map((line, i) => (
              <span key={i}>{i ? <br /> : null}{inline(line, `${blockIndex}-${i}`)}</span>
            ))}
          </p>
        );
      })}
    </>
  );
}

function hostOf(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

export function AssistantMessage({
  content,
  sources,
  error,
  onCopied,
}: {
  content: string;
  sources?: Array<{ sourceUrl: string }>;
  error?: boolean;
  onCopied?: () => void;
}) {
  const uniqueSources = useMemo(() => {
    const seen = new Map<string, string>();
    for (const source of sources || []) {
      const host = hostOf(source.sourceUrl);
      if (host && !seen.has(host)) seen.set(host, source.sourceUrl);
    }
    return [...seen.entries()].slice(0, 8);
  }, [sources]);
  return (
    <>
      <div className={`ab-msg ${error ? "is-error" : ""}`}>
        <Markdown text={content} />
        {uniqueSources.length ? (
          <div className="ab-sources" aria-label="Sources">
            {uniqueSources.map(([host, url]) => (
              <a key={url} className="ab-source" href={url} target="_blank" rel="noreferrer" title={url}>
                <img src={`https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=32`} alt="" />
                <span>{host}</span>
              </a>
            ))}
          </div>
        ) : null}
      </div>
      <div className="ab-msg-tools">
        <button
          type="button"
          title="Copy response"
          aria-label="Copy response"
          onClick={() => {
            void navigator.clipboard?.writeText(content).then(() => onCopied?.()).catch(() => undefined);
          }}
        >
          <Copy />
        </button>
      </div>
    </>
  );
}

export function ChatEmpty({ onPick }: { onPick: (prompt: string) => void }) {
  return (
    <div className="ab-empty">
      <div className="ab-empty-art">
        <svg viewBox="0 0 30 30" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="m15 3 2.5 9.5L27 15l-9.5 2.5L15 27l-2.5-9.5L3 15l9.5-2.5L15 3Z" /></svg>
      </div>
      <h2>What can I help with?</h2>
      <p>Ask about the page you're on, or describe a task and I'll do it in the browser.</p>
      <div className="ab-empty-options">
        {[
          ["Summarise this page", "Summarise the current page and cite the most important details."],
          ["Find something on this page", "Find the most relevant information on the current page."],
          ["Research a topic", "Research the best options for "],
          ["Compare prices", "Compare prices for "],
        ].map(([label, prompt]) => (
          <button key={label} type="button" onClick={() => onPick(prompt)}>
            {label} <span>↗</span>
          </button>
        ))}
      </div>
    </div>
  );
}
