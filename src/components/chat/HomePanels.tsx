import { useCallback, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import {
  clearFinishedActivity,
  dismissActivity,
  timeAgo,
  todos as todoActions,
  useActivity,
  useTodos,
  type ActivityApp,
  type ActivityEntry,
  type TodoItem,
} from "../../lib/clyraHome";

/* ─────────────────────────────  shared bits  ───────────────────────────── */

const EASE = "cubic-bezier(.32,.72,0,1)";
const stroke = { fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round" } as const;

function Svg({ children, size = 15 }: { children: ReactNode; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" {...stroke} aria-hidden="true">{children}</svg>;
}

const PILL_ICONS: Record<string, ReactNode> = {
  write: <Svg><path d="M4 20h4L19 9l-4-4L4 16z" /><path d="M13.5 6.5l4 4" /></Svg>,
  research: <Svg><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c2.6 2.7 3.9 5.7 3.9 9s-1.3 6.3-3.9 9c-2.6-2.7-3.9-5.7-3.9-9S9.4 5.7 12 3z" /></Svg>,
  code: <Svg><path d="M8 7l-5 5 5 5M16 7l5 5-5 5M14 4l-4 16" /></Svg>,
  plan: <Svg><path d="M9 6h11M9 12h11M9 18h11" /><path d="M3.5 6l1 1 2-2M3.5 12l1 1 2-2M3.5 18l1 1 2-2" /></Svg>,
  mail: <Svg><rect x="3" y="5" width="18" height="14" rx="3" /><path d="M3.5 7.5l8.5 6 8.5-6" /></Svg>,
  calendar: <Svg><rect x="3.5" y="5" width="17" height="15.5" rx="3" /><path d="M3.5 10h17M8 3v4M16 3v4" /></Svg>,
  file: <Svg><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5" /></Svg>,
  idea: <Svg><path d="M9 18h6M10 21h4" /><path d="M12 3a6 6 0 0 0-3.6 10.8c.6.5 1 1.2 1 2V16h5.2v-.2c0-.8.4-1.5 1-2A6 6 0 0 0 12 3z" /></Svg>,
  learn: <Svg><path d="M3 9l9-5 9 5-9 5z" /><path d="M7 11.5V16c0 1 2.2 2.5 5 2.5s5-1.5 5-2.5v-4.5" /></Svg>,
  music: <Svg><path d="M9 18V6l11-2v12" /><circle cx="6.5" cy="18" r="2.5" /><circle cx="17.5" cy="16" r="2.5" /></Svg>,
  clip: <Svg><rect x="3" y="5" width="18" height="14" rx="3" /><path d="M10 9.5v5l4.5-2.5z" /></Svg>,
  check: <Svg><path d="M5 12.5l4.5 4.5L19 7.5" /></Svg>,
};
export const pillIcon = (key: string): ReactNode => PILL_ICONS[key] ?? PILL_ICONS.idea;

const APP_ICON: Record<ActivityApp, ReactNode> = {
  shorts: PILL_ICONS.clip,
  vibe: PILL_ICONS.code,
  chat: PILL_ICONS.idea,
  notes: PILL_ICONS.write,
  browser: PILL_ICONS.research,
  study: PILL_ICONS.learn,
  agents: PILL_ICONS.plan,
  automation: <Svg><circle cx="12" cy="13" r="8" /><path d="M12 9v4l2.5 1.5M9.5 3h5" /></Svg>,
};
const APP_NAME: Record<ActivityApp, string> = { shorts: "Shorts", vibe: "Vibe Coder", chat: "Chat", notes: "Notes", browser: "Browser", study: "Study", agents: "Agents", automation: "Automation" };

/* ─────────────────────────  automations (server)  ───────────────────────── */

export type HomeAutomation = {
  id: string;
  name: string;
  trigger: string;
  state: "ACTIVE" | "PAUSED" | "COMPLETED" | "FAILED";
  nextRunAt: number | null;
  lastResult?: { state: string; message: string; at: number };
};

function useAutomations() {
  const [items, setItems] = useState<HomeAutomation[]>([]);
  const [online, setOnline] = useState(true);
  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/agent/automations");
      const payload = (await response.json()) as { automations?: HomeAutomation[] };
      if (Array.isArray(payload.automations)) { setItems(payload.automations); setOnline(true); }
    } catch { setOnline(false); }
  }, []);
  useEffect(() => {
    void refresh();
    const id = window.setInterval(() => { if (!document.hidden) void refresh(); }, 15000);
    return () => window.clearInterval(id);
  }, [refresh]);
  return { items, online, refresh };
}

/* ─────────────────────────  quick-start pills (local)  ─────────────────────────
 * The pills under the composer come from a local preset library — a model never writes them. Each preset
 * carries keywords and app affinities; the four best matches win based on what the person is doing
 * (open to-dos), uses most (recent activity) and has spoken about (recent chat titles). */

export type PersonalPill = { id: string; label: string; prompt: string; icon: string };

type PillPreset = {
  id: string;
  label: string;
  prompt: string;
  icon: string;
  /** Words that make this pill a fit when they appear in chat titles or to-dos. */
  topics: string[];
  /** Apps whose recent activity makes this pill a fit. */
  apps: ActivityApp[];
};

const PILL_PRESETS: PillPreset[] = [
  { id: "research", label: "Research", prompt: "Research this topic with current sources and cite them: ", icon: "research", topics: ["research", "search", "find", "source", "sources", "paper", "article", "facts", "history", "compare"], apps: ["browser", "study"] },
  { id: "write", label: "Write", prompt: "Help me write ", icon: "write", topics: ["write", "draft", "essay", "email", "letter", "story", "blog", "post", "report", "notes", "outline"], apps: ["notes"] },
  { id: "build", label: "Build", prompt: "Build a ", icon: "code", topics: ["build", "code", "app", "website", "script", "component", "bug", "debug", "fix", "api", "design"], apps: ["vibe"] },
  { id: "plan", label: "Plan", prompt: "Help me plan ", icon: "plan", topics: ["plan", "calendar", "schedule", "week", "trip", "holiday", "project", "roadmap", "organise", "organize"], apps: ["agents", "automation"] },
  { id: "analyze", label: "Analyze", prompt: "Analyze the file I attach and help me ", icon: "file", topics: ["analyze", "analysis", "file", "document", "pdf", "image", "review", "summary", "summarise", "summarize", "understand"], apps: ["notes"] },
  { id: "mail", label: "Email", prompt: "Draft an email to ", icon: "mail", topics: ["email", "mail", "inbox", "gmail", "message", "reply", "follow up"], apps: [] },
  { id: "learn", label: "Learn", prompt: "Explain ", icon: "learn", topics: ["learn", "explain", "teach", "tutorial", "course", "study", "flashcards", "quiz"], apps: ["study"] },
  { id: "clip", label: "Make a video", prompt: "Help me make a video about ", icon: "clip", topics: ["video", "clip", "shorts", "edit", "film", "footage", "youtube"], apps: ["shorts"] },
  { id: "music", label: "Music", prompt: "Play some music for ", icon: "music", topics: ["music", "song", "playlist", "spotify", "album", "artist", "mix"], apps: [] },
  { id: "idea", label: "Brainstorm", prompt: "Brainstorm ideas for ", icon: "idea", topics: ["idea", "ideas", "brainstorm", "concept", "creative", "name", "start"], apps: ["chat"] },
  { id: "automate", label: "Automate", prompt: "/automate ", icon: "plan", topics: ["automate", "automation", "routine", "repeat", "every morning", "every day", "weekly"], apps: ["automation", "agents"] },
];

/** Preset order for a blank account — the same steady fallbacks the welcome screen always had. */
const DEFAULT_PILL_IDS = ["research", "write", "build", "analyze"];

const TOPIC_RX = new RegExp(PILL_PRESETS.flatMap((p) => p.topics).map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"), "i");
function matchedTopics(text: string): string[] {
  const words = text.toLowerCase().match(TOPIC_RX);
  return words ? [...new Set(words)] : [];
}

function pickPills(chatTitles: string[], todoList: TodoItem[], activity: ActivityEntry[], recentUserRequest?: string): PersonalPill[] {
  const spoken: Array<{ text: string; weight: number }> = [
    ...chatTitles.slice(0, 4).map((text, i) => ({ text, weight: 4 - i })),
    ...todoList.filter((t) => !t.done).map((t) => ({ text: t.text, weight: 2 })),
  ];
  // What is used most often: app frequency across the recent activity feed.
  const appFreq = new Map<ActivityApp, number>();
  for (const entry of activity.slice(0, 12)) appFreq.set(entry.app, (appFreq.get(entry.app) ?? 0) + 1);
  const topicOf = (text: string) => matchedTopics(text);

  const scored = PILL_PRESETS.map((preset, index) => {
    let score = 0;
    for (const { text, weight } of spoken) if (topicOf(text).some((t) => preset.topics.includes(t))) score += weight;
    for (const app of preset.apps) score += (appFreq.get(app) ?? 0) * 2;
    return { preset, index, score };
  }).sort((a, b) => b.score - a.score || a.index - b.index);

  const chosen = scored.filter((s) => s.score > 0).slice(0, 4).map((s) => s.preset);
  const ids = new Set(chosen.map((p) => p.id));
  const pills = [...chosen, ...DEFAULT_PILL_IDS.map((id) => PILL_PRESETS.find((p) => p.id === id)!).filter((p) => !ids.has(p.id))]
    .slice(0, 4)
    .map((p) => ({ id: p.id, label: p.label, prompt: p.prompt, icon: p.icon }));

  if (recentUserRequest) {
    return [{ id: "continue", label: "Continue", prompt: `Continue helping me with: ${recentUserRequest}\n\nNext, `, icon: "check" }, ...pills].slice(0, 4);
  }
  return pills;
}

export function usePersonalPills(chatTitles: string[], recentUserRequest?: string): PersonalPill[] {
  const todoList = useTodos();
  const activity = useActivity();
  return useMemo(() => pickPills(chatTitles, todoList, activity, recentUserRequest), [chatTitles, todoList, activity, recentUserRequest]);
}

function contextBody(chatTitles: string[], extra: Record<string, unknown> = {}) {
  const now = new Date();
  return {
    hour: now.getHours(),
    weekday: now.toLocaleDateString("en-GB", { weekday: "long" }),
    chats: chatTitles.slice(0, 8),
    ...extra,
  };
}

/* ─────────────────────────────  the panels  ───────────────────────────── */

export type HomePanelsProps = {
  accentColor: string;
  chatTitles: string[];
  onOpenApp: (app: ActivityApp) => void;
  onFillComposer: (text: string) => void;
  hidden?: boolean;
  style?: CSSProperties;
};

export function HomePanels({ accentColor, chatTitles, onOpenApp, onFillComposer, hidden, style }: HomePanelsProps) {
  const [tab, setTab] = useState<"activity" | "automations">("activity");
  const automations = useAutomations();
  const activity = useActivity();
  const [, tick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => tick((n) => n + 1), 30000);
    return () => window.clearInterval(id);
  }, []);

  // Automation runs are real server events: fold the latest result of each into the same feed.
  const feed = useMemo(() => {
    const fromAutomations: ActivityEntry[] = automations.items
      .filter((a) => a.lastResult)
      .map((a) => ({
        key: `automation:${a.id}:${a.lastResult!.at}`,
        app: "automation" as const,
        title: a.name,
        detail: a.lastResult!.state === "COMPLETED" ? "Ran in the background" : a.lastResult!.message || "Needs attention",
        status: a.lastResult!.state === "COMPLETED" ? ("done" as const) : ("failed" as const),
        startedAt: a.lastResult!.at,
        updatedAt: a.lastResult!.at,
      }));
    return [...activity, ...fromAutomations].sort((a, b) => (a.status === "running" ? 1 : 0) !== (b.status === "running" ? 1 : 0) ? (a.status === "running" ? -1 : 1) : b.updatedAt - a.updatedAt);
  }, [activity, automations.items]);

  const runningCount = feed.filter((e) => e.status === "running").length;

  return (
    <div className="chp-root" aria-hidden={hidden} style={style}>
      <TodoCard accentColor={accentColor} chatTitles={chatTitles} activity={feed} automations={automations.items} hidden={hidden} />
      <section className="chp-card" aria-label="Activity and automations">
        <header className="chp-head">
          <div className="chp-tabs" role="tablist">
            <button role="tab" aria-selected={tab === "activity"} className={tab === "activity" ? "is-on" : ""} onClick={() => setTab("activity")} tabIndex={hidden ? -1 : 0}>
              Activity{runningCount > 0 ? <span className="chp-live" style={{ "--accent": accentColor } as CSSProperties}>{runningCount}</span> : null}
            </button>
            <button role="tab" aria-selected={tab === "automations"} className={tab === "automations" ? "is-on" : ""} onClick={() => setTab("automations")} tabIndex={hidden ? -1 : 0}>
              Automations
            </button>
          </div>
          {tab === "activity" && feed.some((e) => e.status !== "running") ? (
            <button className="chp-ghost" onClick={clearFinishedActivity} tabIndex={hidden ? -1 : 0}>Clear</button>
          ) : null}
        </header>
        <div className="chp-body">
          {tab === "activity" ? (
            <ActivityList feed={feed} accentColor={accentColor} onOpenApp={onOpenApp} hidden={hidden} />
          ) : (
            <AutomationList automations={automations} onFillComposer={onFillComposer} hidden={hidden} />
          )}
        </div>
      </section>
      <style>{PANEL_CSS}</style>
    </div>
  );
}

/* ───────────────────────────────  to-do  ─────────────────────────────── */

function TodoCard({ accentColor, chatTitles, activity, automations, hidden }: { accentColor: string; chatTitles: string[]; activity: ActivityEntry[]; automations: HomeAutomation[]; hidden?: boolean }) {
  const list = useTodos();
  const [draft, setDraft] = useState("");
  const [thinking, setThinking] = useState(false);
  const [ideas, setIdeas] = useState<string[]>([]);
  const open = list.filter((t) => !t.done);
  const done = list.filter((t) => t.done);
  const shown = [...open, ...done.slice(0, Math.max(0, 4 - open.length))].slice(0, 4);
  const hiddenCount = list.length - shown.length;

  const suggest = async () => {
    if (thinking) return;
    setThinking(true);
    try {
      const response = await fetch("/api/home/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "todos",
          ...contextBody(chatTitles, {
            todos: list.map((t) => t.text),
            activity: activity.slice(0, 6).map((a) => `${APP_NAME[a.app]}: ${a.title} (${a.status})`),
            automations: automations.map((a) => a.name),
          }),
        }),
      });
      const payload = (await response.json()) as { todos?: Array<{ text: string }> };
      setIdeas((payload.todos ?? []).map((t) => t.text).filter((t) => !list.some((x) => x.text.toLowerCase() === t.toLowerCase())).slice(0, 3));
    } catch { setIdeas([]); }
    setThinking(false);
  };

  const add = () => { if (draft.trim()) { todoActions.add(draft); setDraft(""); } };

  return (
    <section className="chp-card" aria-label="To-do">
      <header className="chp-head">
        <div className="chp-title">
          To-do
          {list.length > 0 ? <span className="chp-count">{done.length}/{list.length}</span> : null}
        </div>
        <button className={`chp-ghost chp-ai${thinking ? " is-busy" : ""}`} onClick={suggest} disabled={thinking} tabIndex={hidden ? -1 : 0} title="Let Clyra suggest what to do next">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2.5l2.1 6.4 6.4 2.1-6.4 2.1L12 19.5l-2.1-6.4-6.4-2.1 6.4-2.1zM19 15.5l.9 2.6 2.6.9-2.6.9L19 22.5l-.9-2.6-2.6-.9 2.6-.9z" /></svg>
          {thinking ? "Thinking" : "Suggest"}
        </button>
      </header>
      {list.length > 0 ? (
        <div className="chp-progress" aria-hidden="true"><span style={{ width: `${(done.length / list.length) * 100}%`, background: accentColor }} /></div>
      ) : null}
      <ul className="chp-list">
        {shown.map((t) => (
          <li key={t.id} className={`chp-row${t.done ? " is-done" : ""}`}>
            <button className="chp-check" aria-label={t.done ? "Mark as not done" : "Mark as done"} aria-pressed={t.done} onClick={() => todoActions.toggle(t.id)} tabIndex={hidden ? -1 : 0}>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
            </button>
            <span className="chp-text">{t.text}</span>
            {t.ai && !t.done ? <span className="chp-tag">AI</span> : null}
            <button className="chp-x" aria-label="Delete" onClick={() => todoActions.remove(t.id)} tabIndex={hidden ? -1 : 0}><Svg size={11}><path d="M6 6l12 12M18 6L6 18" /></Svg></button>
          </li>
        ))}
        {ideas.map((text) => (
          <li key={`idea-${text}`} className="chp-row chp-idea">
            <button className="chp-add" aria-label={`Add “${text}”`} onClick={() => { todoActions.add(text, true); setIdeas((cur) => cur.filter((i) => i !== text)); }} tabIndex={hidden ? -1 : 0}>
              <Svg size={11}><path d="M12 5v14M5 12h14" /></Svg>
            </button>
            <span className="chp-text">{text}</span>
            <button className="chp-x" aria-label="Dismiss suggestion" onClick={() => setIdeas((cur) => cur.filter((i) => i !== text))} tabIndex={hidden ? -1 : 0}><Svg size={11}><path d="M6 6l12 12M18 6L6 18" /></Svg></button>
          </li>
        ))}
        {list.length === 0 && ideas.length === 0 ? <li className="chp-empty">Nothing yet. Add a task, or let Clyra suggest where to start.</li> : null}
      </ul>
      {hiddenCount > 0 ? <div className="chp-more">+{hiddenCount} more</div> : null}
      <form className="chp-input" onSubmit={(e) => { e.preventDefault(); add(); }}>
        <Svg size={13}><path d="M12 5v14M5 12h14" /></Svg>
        <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Add a task" maxLength={140} tabIndex={hidden ? -1 : 0} aria-label="Add a task" />
        {done.length > 0 ? <button type="button" className="chp-ghost" onClick={todoActions.clearDone} tabIndex={hidden ? -1 : 0}>Clear done</button> : null}
      </form>
    </section>
  );
}

/* ──────────────────────────────  activity  ────────────────────────────── */

function ActivityList({ feed, accentColor, onOpenApp, hidden }: { feed: ActivityEntry[]; accentColor: string; onOpenApp: (app: ActivityApp) => void; hidden?: boolean }) {
  if (feed.length === 0) {
    return <div className="chp-empty chp-empty--block">Nothing running. Clips, builds and background automations show up here as they happen.</div>;
  }
  return (
    <ul className="chp-list">
      {feed.slice(0, 4).map((e) => (
        <li key={e.key} className={`chp-act is-${e.status}`}>
          <button className="chp-act__main" onClick={() => onOpenApp(e.app)} tabIndex={hidden ? -1 : 0} title={`Open ${APP_NAME[e.app]}`}>
            <span className="chp-tile">{APP_ICON[e.app]}</span>
            <span className="chp-act__text">
              <span className="chp-act__title">{e.title}</span>
              <span className="chp-act__meta">
                {e.status === "running" ? (
                  <><span className="chp-pulse" style={{ background: accentColor }} />{e.detail || "Working"}</>
                ) : e.status === "failed" ? (
                  <><span className="chp-dot chp-dot--bad" />{e.detail || "Needs attention"}</>
                ) : (
                  <><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>{APP_NAME[e.app]}</>
                )}
                {e.status !== "running" ? <span className="chp-when">{timeAgo(e.updatedAt)}</span> : null}
              </span>
              {e.status === "running" ? (
                <span className="chp-bar" aria-hidden="true"><span className={typeof e.progress === "number" ? "" : "is-indeterminate"} style={{ width: typeof e.progress === "number" ? `${Math.max(4, Math.min(100, e.progress))}%` : undefined, background: accentColor }} /></span>
              ) : null}
            </span>
          </button>
          {e.status !== "running" && !e.key.startsWith("automation:") ? (
            <button className="chp-x" aria-label="Dismiss" onClick={() => dismissActivity(e.key)} tabIndex={hidden ? -1 : 0}><Svg size={11}><path d="M6 6l12 12M18 6L6 18" /></Svg></button>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

/* ────────────────────────────  automations  ──────────────────────────── */

const AUTOMATION_IDEAS = [
  "Every morning create a note called Daily plan",
  "Every Sunday create a note called Weekly review",
  "Every 2 hours create a note called Status check",
];

function nextLabel(a: HomeAutomation) {
  if (a.state === "PAUSED") return "Paused";
  if (a.state === "COMPLETED") return "Done";
  if (a.state === "FAILED") return "Needs attention";
  if (!a.nextRunAt) return "No upcoming run";
  const d = new Date(a.nextRunAt);
  const sameDay = d.toDateString() === new Date().toDateString();
  const tomorrow = d.toDateString() === new Date(Date.now() + 864e5).toDateString();
  const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return `Next ${sameDay ? "today" : tomorrow ? "tomorrow" : d.toLocaleDateString(undefined, { weekday: "short" })} · ${time}`;
}

function AutomationList({ automations, onFillComposer, hidden }: { automations: ReturnType<typeof useAutomations>; onFillComposer: (text: string) => void; hidden?: boolean }) {
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [idea, setIdea] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setIdea((n) => (n + 1) % AUTOMATION_IDEAS.length), 4500);
    return () => window.clearInterval(id);
  }, []);

  const control = async (a: HomeAutomation, command: "pause" | "resume" | "run") => {
    setBusy(a.id);
    try { await fetch(`/api/agent/automations/${encodeURIComponent(a.id)}/${command}`, { method: "POST" }); } catch { /* the list refresh shows the truth */ }
    await automations.refresh();
    setBusy(null);
  };

  const create = async () => {
    const prompt = draft.trim();
    if (!prompt || busy === "new") return;
    setBusy("new");
    setError(null);
    try {
      const response = await fetch("/api/agent/automations/start", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt }) });
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) throw new Error(response.status === 422 ? "Try a schedule like “every morning create a note called Daily plan”." : payload?.error || "Clyra couldn't schedule that.");
      setDraft("");
      await automations.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Clyra couldn't schedule that.");
    }
    setBusy(null);
  };

  const rows = automations.items.slice(0, 3);
  return (
    <>
      {rows.length > 0 ? (
        <ul className="chp-list">
          {rows.map((a) => (
            <li key={a.id} className="chp-act">
              <div className="chp-act__main" style={{ cursor: "default" }}>
                <span className="chp-tile">{APP_ICON.automation}</span>
                <span className="chp-act__text">
                  <span className="chp-act__title">{a.name}</span>
                  <span className="chp-act__meta">{a.trigger}<span className="chp-when">{nextLabel(a)}</span></span>
                </span>
              </div>
              <span className="chp-act__tools">
                {a.state === "ACTIVE" ? (
                  <button className="chp-icon" aria-label="Run now" title="Run now" disabled={busy === a.id} onClick={() => control(a, "run")} tabIndex={hidden ? -1 : 0}><Svg size={12}><path d="M7 5l12 7-12 7z" /></Svg></button>
                ) : null}
                {a.state === "ACTIVE" ? (
                  <button className="chp-icon" aria-label="Pause" title="Pause" disabled={busy === a.id} onClick={() => control(a, "pause")} tabIndex={hidden ? -1 : 0}><Svg size={12}><path d="M8 5v14M16 5v14" /></Svg></button>
                ) : a.state === "PAUSED" ? (
                  <button className="chp-icon" aria-label="Resume" title="Resume" disabled={busy === a.id} onClick={() => control(a, "resume")} tabIndex={hidden ? -1 : 0}><Svg size={12}><path d="M7 5l12 7-12 7z" /></Svg></button>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <div className="chp-empty chp-empty--block">
          {automations.online ? "Tell Clyra what to do and when. It runs in the background, even while you're elsewhere." : "Automations are offline right now."}
        </div>
      )}
      {error ? <div className="chp-error" role="alert">{error}</div> : null}
      <form className="chp-input" onSubmit={(e) => { e.preventDefault(); void create(); }}>
        <Svg size={13}><circle cx="12" cy="13" r="8" /><path d="M12 9v4l2.5 1.5" /></Svg>
        <input
          value={draft}
          onChange={(e) => { setDraft(e.target.value); if (error) setError(null); }}
          placeholder={AUTOMATION_IDEAS[idea]}
          maxLength={240}
          tabIndex={hidden ? -1 : 0}
          aria-label="Describe an automation"
        />
        {draft.trim() ? <button type="submit" className="chp-ghost" disabled={busy === "new"} tabIndex={hidden ? -1 : 0}>{busy === "new" ? "Saving" : "Schedule"}</button> : (
          <button type="button" className="chp-ghost" onClick={() => onFillComposer("/automate ")} tabIndex={hidden ? -1 : 0}>In chat</button>
        )}
      </form>
    </>
  );
}

/* ───────────────────────────────  styles  ─────────────────────────────── */

const PANEL_CSS = `
.chp-root { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; width: 100%; text-align: left; }
.chp-card { min-height: 158px; display: flex; flex-direction: column; min-width: 0; padding: 12px 12px 10px; border-radius: 22px; background: rgba(255,255,255,.78); box-shadow: 0 1px 1px rgba(16,18,24,.03), 0 14px 30px -22px rgba(16,18,24,.22), inset 0 0 0 1px rgba(16,18,24,.06); }
.chp-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-height: 26px; padding: 0 4px; }
.chp-title { display: flex; align-items: center; gap: 7px; font-size: 13px; font-weight: 600; letter-spacing: -.012em; color: #15171C; }
.chp-count { font-size: 11.5px; font-weight: 500; color: #98A0AB; font-variant-numeric: tabular-nums; }
.chp-ghost { display: inline-flex; align-items: center; gap: 5px; height: 24px; padding: 0 9px; border: none; border-radius: 999px; background: transparent; font-family: inherit; font-weight: 500; font-size: 12px; line-height: 1; color: #6B717C; cursor: pointer; transition: background .45s ${EASE}, color .3s ease, opacity .3s ease; }
.chp-ghost:hover:not(:disabled) { background: rgba(16,18,24,.06); color: #15171C; }
.chp-ghost:disabled { cursor: default; opacity: .6; }
.chp-ai svg { transition: transform .7s ${EASE}; }
.chp-ai:hover:not(:disabled) svg { transform: rotate(18deg) scale(1.08); }
.chp-ai.is-busy svg { animation: chpSpin 1.4s linear infinite; }
@keyframes chpSpin { to { transform: rotate(360deg); } }
.chp-progress { height: 2px; margin: 8px 4px 2px; border-radius: 2px; background: rgba(16,18,24,.06); overflow: hidden; }
.chp-progress span { display: block; height: 100%; border-radius: 2px; transition: width .8s ${EASE}; }
.chp-list { list-style: none; margin: 6px 0 0; padding: 0; display: flex; flex-direction: column; gap: 1px; }
.chp-row, .chp-act { position: relative; display: flex; align-items: center; gap: 9px; min-height: 34px; padding: 3px 4px; border-radius: 12px; transition: background .45s ${EASE}; animation: chpIn .6s ${EASE} both; }
.chp-row:hover, .chp-act:hover { background: rgba(16,18,24,.04); }
@keyframes chpIn { from { opacity: 0; transform: translateY(5px); } to { opacity: 1; transform: none; } }
.chp-check { flex: 0 0 18px; width: 18px; height: 18px; display: grid; place-items: center; padding: 0; border: none; border-radius: 50%; background: transparent; box-shadow: inset 0 0 0 1.5px #B4BAC4; cursor: pointer; transition: box-shadow .35s ease, background .35s ease, transform .4s ${EASE}; }
.chp-check svg { opacity: 0; transform: scale(.5); transition: opacity .3s ease, transform .5s ${EASE}; }
.chp-check:hover { box-shadow: inset 0 0 0 1.5px #15171C; }
.chp-check:active { transform: scale(.9); }
.is-done .chp-check { background: #15171C; box-shadow: inset 0 0 0 1.5px #15171C; }
.is-done .chp-check svg { opacity: 1; transform: none; }
.chp-text { flex: 1; min-width: 0; font-size: 13px; line-height: 1.3; letter-spacing: -.008em; color: #15171C; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; transition: color .4s ease; }
.is-done .chp-text { color: #A4ABB6; text-decoration: line-through; text-decoration-color: #C9CED6; }
.chp-tag { flex: 0 0 auto; padding: 2px 5px; border-radius: 6px; background: rgba(16,18,24,.06); font-size: 9.5px; font-weight: 600; letter-spacing: .04em; color: #6B717C; }
.chp-x { flex: 0 0 20px; width: 20px; height: 20px; display: grid; place-items: center; padding: 0; border: none; border-radius: 50%; background: transparent; color: #98A0AB; cursor: pointer; opacity: 0; transition: opacity .3s ease, background .3s ease; }
.chp-row:hover .chp-x, .chp-act:hover .chp-x, .chp-x:focus-visible { opacity: 1; }
.chp-x:hover { background: rgba(16,18,24,.07); color: #15171C; }
.chp-idea .chp-text { color: #6B717C; }
.chp-add { flex: 0 0 18px; width: 18px; height: 18px; display: grid; place-items: center; padding: 0; border: none; border-radius: 50%; background: transparent; color: #6B717C; box-shadow: inset 0 0 0 1.5px #D3D7DE; cursor: pointer; transition: background .35s ease, color .3s ease, box-shadow .3s ease; }
.chp-add:hover { background: #15171C; color: #fff; box-shadow: inset 0 0 0 1.5px #15171C; }
.chp-more { padding: 2px 6px 0 31px; font-size: 11.5px; color: #98A0AB; }
.chp-empty { padding: 8px 4px; font-size: 12.5px; line-height: 1.5; color: #8A919E; }
.chp-empty--block { padding: 10px 6px 8px; min-height: 68px; }
.chp-input { display: flex; align-items: center; gap: 8px; margin-top: auto; padding: 6px 4px 0 6px; color: #98A0AB; }
.chp-list + .chp-input, .chp-more + .chp-input, .chp-error + .chp-input, .chp-empty + .chp-input { margin-top: 6px; }
.chp-input input { flex: 1; min-width: 0; height: 28px; border: none; outline: none; background: transparent; font-family: inherit; font-weight: 400; font-size: 13px; line-height: 1; letter-spacing: -.008em; color: #15171C; }
.chp-input input::placeholder { color: #A4ABB6; }
.chp-input:focus-within { color: #15171C; }
.chp-tabs { position: relative; display: inline-flex; padding: 0; }
.chp-tabs button { position: relative; display: inline-flex; align-items: center; gap: 6px; height: 26px; padding: 0 12px 0 4px; border: none; background: transparent; font-family: inherit; font-weight: 600; font-size: 13px; line-height: 1; letter-spacing: -.012em; color: #A4ABB6; cursor: pointer; transition: color .4s ease; }
.chp-tabs button + button { padding-left: 12px; }
.chp-tabs button.is-on { color: #15171C; }
.chp-tabs button:not(.is-on):hover { color: #6B717C; }
.chp-live { display: inline-grid; place-items: center; min-width: 16px; height: 16px; padding: 0 4px; border-radius: 8px; background: color-mix(in srgb, var(--accent) 12%, #fff); color: var(--accent); font-size: 10.5px; font-weight: 700; font-variant-numeric: tabular-nums; }
.chp-body { display: flex; flex-direction: column; flex: 1; min-height: 0; }
.chp-act__main { flex: 1; min-width: 0; display: flex; align-items: center; gap: 10px; padding: 0; border: none; background: transparent; font-family: inherit; text-align: left; cursor: pointer; color: inherit; }
.chp-tile { flex: 0 0 26px; width: 26px; height: 26px; display: grid; place-items: center; border-radius: 9px; background: rgba(16,18,24,.05); color: #15171C; }
.chp-act__text { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1; }
.chp-act__title { font-size: 13px; font-weight: 500; letter-spacing: -.01em; color: #15171C; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.chp-act__meta { display: flex; align-items: center; gap: 5px; min-width: 0; font-size: 11.5px; color: #8A919E; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.chp-when { margin-left: auto; padding-left: 8px; flex: 0 0 auto; color: #A4ABB6; }
.chp-pulse { flex: 0 0 6px; width: 6px; height: 6px; border-radius: 50%; animation: chpPulse 1.8s ease-in-out infinite; }
@keyframes chpPulse { 0%, 100% { opacity: 1; transform: scale(1); } 50% { opacity: .35; transform: scale(.7); } }
.chp-dot { flex: 0 0 6px; width: 6px; height: 6px; border-radius: 50%; }
.chp-dot--bad { background: #E5484D; }
.chp-bar { display: block; height: 2px; margin-top: 3px; border-radius: 2px; background: rgba(16,18,24,.06); overflow: hidden; }
.chp-bar span { display: block; height: 100%; border-radius: 2px; transition: width .9s ${EASE}; }
.chp-bar .is-indeterminate { width: 38%; animation: chpSlide 1.6s ${EASE} infinite; }
@keyframes chpSlide { 0% { transform: translateX(-100%); } 100% { transform: translateX(270%); } }
.chp-act__tools { display: flex; gap: 2px; opacity: 0; transition: opacity .3s ease; }
.chp-act:hover .chp-act__tools, .chp-act__tools:focus-within { opacity: 1; }
.chp-icon { width: 24px; height: 24px; display: grid; place-items: center; padding: 0; border: none; border-radius: 50%; background: transparent; color: #6B717C; cursor: pointer; transition: background .3s ease, color .3s ease; }
.chp-icon:hover:not(:disabled) { background: rgba(16,18,24,.07); color: #15171C; }
.chp-icon:disabled { opacity: .4; cursor: default; }
.chp-error { margin: 6px 4px 0; font-size: 11.5px; line-height: 1.4; color: #C2363B; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.chp-card button:focus-visible { outline: 2px solid rgba(16,18,24,.35); outline-offset: 1px; }
@media (max-width: 640px) { .chp-root { grid-template-columns: 1fr; } }
@media (max-height: 860px) { .chp-root { display: none; } }
@media (prefers-reduced-motion: reduce) { .chp-row, .chp-act, .chp-pulse, .chp-bar .is-indeterminate { animation: none; } }
`;
