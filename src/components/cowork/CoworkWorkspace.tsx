import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type MutableRefObject } from "react";
import "./mockup/mockup.css";
import { MockupMarkup } from "./mockup/MockupMarkup";
import { AGENT_SHAPES, AGENT_SWATCHES, decodeAgentAvatar, encodeAgentAvatar, type AgentShape } from "./AgentAvatar";
import { AGENT_TEMPLATES, templateToBotInput } from "./agentTemplates";
import { coworkApi, type Bot, type ConversationSummary, type Conversation, type CoworkMessage, type CoworkTask } from "./coworkApi";

const SHELL = "cubic-bezier(.32,.72,0,1)";
const EASE = "cubic-bezier(.2,.8,.3,1)";
const SIDE_W = "clamp(240px, 24vw, 292px)";
const PANE_W = "clamp(320px, 34vw, 440px)";
const HIDDEN_OVERLAY = "position:absolute;inset:0;opacity:0;visibility:hidden;pointer-events:none;";
const HIDDEN_CARD = "opacity:0;visibility:hidden;";

const STARTERS = [
  { label: "Triage my inbox", text: "Sort my inbox each morning, flag anything urgent and draft short replies." },
  { label: "Track competitors", text: "Watch competitor sites and pricing pages and tell me when something changes." },
  { label: "Chase invoices", text: "Find unpaid invoices and send polite reminders after 14 days." },
  { label: "Plan my week", text: "Build my week from my calendar and to-dos and protect two focus blocks a day." },
];

interface UiState {
  current: string | null;
  view: "market" | null;
  toMode: boolean;
  draft: string[];
  toQuery: string;
  toFocus: boolean;
  sugIdx: number;
  homeTo: string | null;
  homeMenu: boolean;
  newMenu: boolean;
  create: boolean;
  editId: string | null;
  dName: string;
  dPrompt: string;
  dColor: string;
  dShape: AgentShape;
  dKey: number;
  sideQuery: string;
  text: string;
  caret: number | null;
  palIdx: number;
  palDismiss: boolean;
  side: boolean;
  pane: boolean;
  paneHome: boolean;
  rowMenu: { id: string; top: number; right: number } | null;
  renaming: string | null;
  renameVal: string;
  hoverRow: string | null;
  mq: string;
  mcat: string;
  viewAgent: string | null;
  sending: boolean;
  sendError: string | null;
}

const INITIAL: UiState = {
  current: null, view: null, toMode: false, draft: [], toQuery: "", toFocus: false, sugIdx: 0, homeTo: null,
  homeMenu: false, newMenu: false, create: false, editId: null, dName: "", dPrompt: "", dColor: "bleu", dShape: "cercle",
  dKey: 0, sideQuery: "", text: "", caret: null, palIdx: 0, palDismiss: false, side: true, pane: true, paneHome: false,
  rowMenu: null, renaming: null, renameVal: "", hoverRow: null, mq: "", mcat: "All", viewAgent: null, sending: false,
  sendError: null,
};

interface Agent {
  id: string;
  name: string;
  color: string;
  shape: AgentShape;
  prompt: string;
  busy: boolean;
}

interface Thread {
  conversation: Conversation;
  messages: CoworkMessage[];
  participants: Bot[];
}

const PALETTE_NAMES = new Map(AGENT_SWATCHES.map(([name, hex]) => [hex.toUpperCase(), name] as const));
const PALETTE_HEX = new Map(AGENT_SWATCHES.map(([name, hex]) => [name, hex] as const));

function colorNameOf(hex: string): string {
  return PALETTE_NAMES.get(hex.toUpperCase()) ?? "gris";
}

function hexOfName(name: string): string {
  return PALETTE_HEX.get(name) ?? "A3A3A3";
}

function clock(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (d.toDateString() === new Date().toDateString()) return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return d.toLocaleDateString(undefined, { weekday: "long" });
}

function relative(iso: string): string {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  return m < 1 ? "Now" : m < 60 ? `${m}m` : `${Math.round(m / 60)}h`;
}

function stepKind(state: CoworkTask["state"]): "active" | "paused" | "done" | "queued" {
  if (state === "running" || state === "retrying") return "active";
  if (state === "blocked" || state === "awaiting_approval" || state === "paused") return "paused";
  if (state === "completed") return "done";
  return "queued";
}

type Patch = Partial<UiState> | ((s: UiState) => Partial<UiState>);

export function CoworkWorkspace() {
  const [st, setSt] = useState<UiState>(INITIAL);
  const [bots, setBots] = useState<Bot[]>([]);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [thread, setThread] = useState<Thread | null>(null);
  const [tasks, setTasks] = useState<CoworkTask[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const patch = useCallback((next: Patch) => {
    setSt((prev) => ({ ...prev, ...(typeof next === "function" ? next(prev) : next) }));
  }, []);

  const refreshAll = useCallback(async () => {
    try {
      const [b, c] = await Promise.all([coworkApi.listBots(), coworkApi.listConversations()]);
      setBots(b.bots);
      setConversations(c.conversations);
      setLoadError(null);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Could not load agents.");
    }
  }, []);

  useEffect(() => {
    void refreshAll();
    const id = window.setInterval(() => void refreshAll(), 6000);
    return () => window.clearInterval(id);
  }, [refreshAll]);

  const openId = st.current;
  useEffect(() => {
    if (!openId) {
      setThread(null);
      setTasks([]);
      return;
    }
    let alive = true;
    const load = async () => {
      try {
        const [t, k] = await Promise.all([coworkApi.getConversation(openId), coworkApi.listTasks({ conversationId: openId })]);
        if (!alive) return;
        setThread({ conversation: t.conversation, messages: t.messages, participants: t.participants });
        setTasks(k.tasks);
      } catch {
        // The next poll or list refresh recovers if the conversation was removed or the server restarted.
      }
    };
    void load();
    const id = window.setInterval(load, 2500);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [openId]);

  const runningBotIds = useMemo(
    () => new Set(tasks.filter((t) => t.state === "running" || t.state === "retrying").map((t) => t.botId)),
    [tasks],
  );
  const agents: Agent[] = useMemo(
    () => bots.map((b) => {
      const d = decodeAgentAvatar(b.avatar, b.id);
      return { id: b.id, name: b.name, color: colorNameOf(d.hex), shape: d.shape, prompt: b.instructions || b.role, busy: runningBotIds.has(b.id) };
    }),
    [bots, runningBotIds],
  );
  const agentById = useMemo(() => new Map(agents.map((a) => [a.id, a])), [agents]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [thread?.messages.length, openId]);

  const avOf = (a: Agent | undefined, size: number, busy = false, extra = "") => ({
    shape: a?.shape ?? "cercle",
    color: a?.color ?? "gris",
    size: String(size),
    busy: busy || a?.busy ? "true" : "false",
    wrap: `display:flex;flex-shrink:0;${extra}`,
  });

  const convMembers = (c: { botIds: string[] }) => c.botIds.map((id) => agentById.get(id)).filter(Boolean) as Agent[];

  const openConversation = (id: string) => patch({ current: id, toMode: false, view: null, rowMenu: null });

  const refreshTasks = async (id: string) => {
    try {
      setTasks((await coworkApi.listTasks({ conversationId: id })).tasks);
    } catch {
      // Polling already retries.
    }
  };

  const sendText = async () => {
    const q = st.text.trim();
    if (!q || st.sending) return;
    if (!bots.length) {
      patch({ create: true, editId: null, dName: "", dPrompt: "" });
      return;
    }
    patch({ sending: true, sendError: null });
    try {
      let target: string | null = st.current;
      if (!target && st.toMode && st.draft.length) {
        target = (await coworkApi.createConversation({ botIds: st.draft })).conversation.id;
      } else if (!target) {
        target = st.homeTo ?? (await coworkApi.createConversation({ botIds: [bots[0].id] })).conversation.id;
      }
      if (!target) throw new Error("Choose an agent first.");
      await coworkApi.sendMessage(target, q);
      patch({ text: "", current: target, toMode: false, draft: [], homeTo: null, sending: false });
      await refreshAll();
      await refreshTasks(target);
    } catch (error) {
      patch({ sending: false, sendError: error instanceof Error ? error.message : "Could not send." });
    }
  };

  const commitDraft = async () => {
    if (!st.draft.length) return;
    try {
      const created = await coworkApi.createConversation({ botIds: st.draft });
      await refreshAll();
      patch({ toMode: false, toQuery: "", current: created.conversation.id, draft: [] });
    } catch (error) {
      patch({ sendError: error instanceof Error ? error.message : "Could not start chat." });
    }
  };

  const saveAgent = async () => {
    const name = st.dName.trim();
    const prompt = st.dPrompt.trim();
    if (!name || !prompt) return;
    const avatar = encodeAgentAvatar(hexOfName(st.dColor), st.dShape);
    try {
      if (st.editId) {
        await coworkApi.updateBot(st.editId, { name, instructions: prompt, avatar });
      } else {
        const created = await coworkApi.createBot({ name, role: name, instructions: prompt, avatar });
        await coworkApi.createConversation({ botIds: [created.bot.id] });
      }
      await refreshAll();
      patch({ create: false, editId: null });
    } catch (error) {
      patch({ sendError: error instanceof Error ? error.message : "Could not save agent." });
    }
  };

  const deleteConversation = async (id: string) => {
    const conv = conversations.find((c) => c.id === id);
    if (!conv) return;
    try {
      if (conv.botIds.length === 1) await coworkApi.deleteBot(conv.botIds[0]);
      else await coworkApi.deleteConversation(id);
      patch({ rowMenu: null, current: st.current === id ? null : st.current });
      await refreshAll();
    } catch (error) {
      patch({ sendError: error instanceof Error ? error.message : "Could not delete." });
    }
  };

  const commitRename = async () => {
    const id = st.renaming;
    const value = st.renameVal.trim();
    patch({ renaming: null });
    const conv = id ? conversations.find((c) => c.id === id) : undefined;
    if (!conv || !value) return;
    try {
      if (conv.botIds.length === 1) await coworkApi.updateBot(conv.botIds[0], { name: value });
      else await coworkApi.renameConversation(conv.id, value);
      await refreshAll();
    } catch (error) {
      patch({ sendError: error instanceof Error ? error.message : "Could not rename." });
    }
  };

  const taskOp = async (task: CoworkTask, op: "pause" | "resume") => {
    try {
      await coworkApi.taskOperation(task.id, op);
      if (openId) await refreshTasks(openId);
    } catch (error) {
      patch({ sendError: error instanceof Error ? error.message : "Could not update task." });
    }
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (st.toMode && st.draft.length && !st.text.trim()) void commitDraft();
      else void sendText();
    }
  };

  const vm = buildViewModel({
    st, patch, agents, agentById, conversations, thread, tasks, avOf, convMembers, openConversation,
    sendText, commitDraft, saveAgent, deleteConversation, commitRename, taskOp, onKey, loadError,
    inputRef, scrollRef, refreshAll,
  });

  return <MockupMarkup vm={vm} />;
}

interface Ctx {
  st: UiState;
  patch: (next: Patch) => void;
  agents: Agent[];
  agentById: Map<string, Agent>;
  conversations: ConversationSummary[];
  thread: Thread | null;
  tasks: CoworkTask[];
  avOf: (a: Agent | undefined, size: number, busy?: boolean, extra?: string) => Record<string, string>;
  convMembers: (c: { botIds: string[] }) => Agent[];
  openConversation: (id: string) => void;
  sendText: () => Promise<void>;
  commitDraft: () => Promise<void>;
  saveAgent: () => Promise<void>;
  deleteConversation: (id: string) => Promise<void>;
  commitRename: () => Promise<void>;
  taskOp: (task: CoworkTask, op: "pause" | "resume") => Promise<void>;
  onKey: (e: KeyboardEvent<HTMLTextAreaElement>) => void;
  loadError: string | null;
  inputRef: MutableRefObject<HTMLTextAreaElement | null>;
  scrollRef: MutableRefObject<HTMLDivElement | null>;
  refreshAll: () => Promise<void>;
}

function buildViewModel(c: Ctx): Record<string, any> {
  const { st, patch, agents, agentById, conversations, thread, tasks } = c;
  const sq = st.sideQuery.trim().toLowerCase();
  const cur = st.current ? conversations.find((x) => x.id === st.current) ?? null : null;
  const curMembers = cur ? c.convMembers(cur) : [];
  const homeConv = st.homeTo ? conversations.find((x) => x.id === st.homeTo) ?? null : null;
  const hasAgents = agents.length > 0;
  const isGroup = curMembers.length > 1;
  const cr = st.create;

  const chatRows = conversations
    .filter((x) => !sq || x.title.toLowerCase().includes(sq))
    .map((x) => {
      const mem = c.convMembers(x);
      const on = x.id === st.current && !st.toMode;
      const typingHere = tasks.some((t) => t.state === "running" && x.botIds.includes(t.botId));
      const hovered = st.hoverRow === x.id || st.rowMenu?.id === x.id;
      const avs = mem.length === 1
        ? [c.avOf(mem[0], 32)]
        : [c.avOf(mem[0], 23, false, "position:absolute;left:0;top:0"), c.avOf(mem[1], 23, false, "position:absolute;right:0;bottom:0")];
      return {
        title: x.title,
        time: clock(x.lastMessageAt || x.updatedAt),
        avs,
        unread: x.unread > 0 && !on,
        renaming: st.renaming === x.id,
        notRenaming: st.renaming !== x.id,
        onEnter: () => { if (st.hoverRow !== x.id) patch({ hoverRow: x.id }); },
        onLeave: () => { if (st.hoverRow === x.id) patch({ hoverRow: null }); },
        onDots: (e: { stopPropagation: () => void; currentTarget: HTMLElement }) => {
          e.stopPropagation();
          if (st.rowMenu?.id === x.id) { patch({ rowMenu: null }); return; }
          const br = e.currentTarget.getBoundingClientRect();
          patch({ rowMenu: { id: x.id, top: br.bottom + 6, right: 12 } });
        },
        dotsStyle: ["position:absolute", "right:10px", "top:8px", "z-index:2", "display:flex", "align-items:center", "justify-content:center", "width:26px", "height:26px", "border-radius:999px", "border:none", "cursor:pointer", "color:#5F636B", `background:${st.rowMenu?.id === x.id ? "rgba(16,18,24,0.07)" : "transparent"}`, `opacity:${hovered && st.renaming !== x.id ? "1" : "0"}`, `transform:scale(${hovered ? "1" : ".85"})`, `pointer-events:${hovered ? "auto" : "none"}`, "transition:opacity .18s ease, transform .22s cubic-bezier(.16,1,.3,1), background .18s ease"].join(";"),
        timeStyle: ["font-size:11.5px", "color:#7A7E87", "flex-shrink:0", "transition:opacity .18s ease", `opacity:${hovered && st.renaming !== x.id ? "0" : "1"}`].join(";"),
        preview: typingHere ? (mem.length > 1 ? "Working…" : `${mem[0]?.name ?? ""} is working…`) : x.lastMessage || "No messages yet",
        previewStyle: ["flex:1", "min-width:0", "font-size:13px", "white-space:nowrap", "overflow:hidden", "text-overflow:ellipsis", "color:#6B6F77"].join(";"),
        style: ["position:relative", "display:flex", "align-items:center", "gap:11px", "padding:8px 10px", "border-radius:10px", "cursor:pointer", "transition:background .28s cubic-bezier(.32,.72,0,1)", `background:${on ? "#E4E5E9" : st.hoverRow === x.id ? "rgba(16,18,24,0.045)" : "transparent"}`].join(";"),
        onOpen: () => c.openConversation(x.id),
      };
    });

  const headAgents = st.toMode ? (st.draft.map((id) => agentById.get(id)).filter(Boolean) as Agent[]) : curMembers;
  const headAvs = headAgents.slice(0, 3).map((m, i) => c.avOf(m, headAgents.length > 1 ? 28 : 32, false, i ? "margin-left:-10px" : ""));
  const names = headAgents.map((m) => m.name);

  const tq = st.toQuery.trim().toLowerCase();
  const pool = agents.filter((a) => !st.draft.includes(a.id) && (!tq || a.name.toLowerCase().includes(tq) || a.prompt.toLowerCase().includes(tq)));
  const sugIdx = Math.min(st.sugIdx, Math.max(0, pool.length - 1));
  const toOpen = st.toMode && st.toFocus && !!tq;
  const suggestions = pool.map((a, i) => ({
    name: a.name,
    role: a.prompt,
    av: c.avOf(a, 28),
    onPick: (e: { preventDefault: () => void }) => { e.preventDefault(); patch((s) => ({ draft: [...s.draft, a.id], toQuery: "", sugIdx: 0 })); },
    style: ["display:flex", "align-items:center", "gap:10px", "width:100%", "padding:7px 12px 7px 8px", "border-radius:999px", "border:none", "cursor:pointer", "font-family:inherit", "transition:background .28s cubic-bezier(.32,.72,0,1)", `background:${i === sugIdx ? "rgba(16,18,24,0.05)" : "transparent"}`].join(";"),
    hintStyle: `font-size:12px;color:#7A7E87;opacity:${i === sugIdx ? "1" : "0"}`,
  }));
  const suggestStyle = ["position:absolute", "top:calc(100% + 4px)", "left:44px", "width:320px", "padding:5px", "border-radius:22px", "background:#FFFFFF", "z-index:30", "transform-origin:top left", "box-shadow:0 1px 1px rgba(16,18,24,0.04), 0 20px 48px -14px rgba(16,18,24,0.26), inset 0 0 0 1px rgba(16,18,24,0.07)", `opacity:${toOpen ? "1" : "0"}`, `transform:translateY(${toOpen ? "0" : "-6px"}) scale(${toOpen ? "1" : ".96"})`, `pointer-events:${toOpen ? "auto" : "none"}`, `visibility:${toOpen ? "visible" : "hidden"}`, "transition:opacity .2s ease, transform .36s cubic-bezier(.16,1,.3,1)"].join(";");

  const msgs = thread ? thread.messages : [];
  const messages = msgs.map((m, i) => {
    const me = m.author === "user";
    const a = !me && m.botId ? agentById.get(m.botId) : undefined;
    const prev = msgs[i - 1];
    const first = !prev || prev.author !== m.author || prev.botId !== m.botId;
    const anim = me ? "clyraBubbleIn 1.15s cubic-bezier(.16,.86,.2,1) both" : "clyraReplyIn 1.15s cubic-bezier(.32,.72,0,1) both";
    return {
      hasImgs: false, imgs: [], hasDocs: false, docs: [], hasText: !!m.text,
      parts: [{ isTok: false, isText: true, text: m.text }],
      isMe: me, isAgent: !me, hasTools: false, tools: [], text: m.text, isText: true, isFile: false, fileName: "", fileMeta: "",
      hasLink: false, link: "", post: "",
      name: me ? "" : a?.name ?? m.botName ?? "System",
      showName: !me && first && isGroup,
      av: c.avOf(a, 18),
      rowStyle: ["display:flex", "width:100%", `justify-content:${me ? "flex-end" : "flex-start"}`, `margin-top:${first && i ? "6px" : "0"}`, `animation:${anim}`].join(";"),
    };
  });

  const typingTask = tasks.find((t) => t.state === "running");
  const typingAgent = typingTask ? agentById.get(typingTask.botId) : undefined;
  const typingHere = !!typingAgent && !!cur && cur.botIds.includes(typingAgent.id);
  const viewId = st.viewAgent && curMembers.some((m) => m.id === st.viewAgent) ? st.viewAgent : curMembers[0]?.id;
  const viewAgent = viewId ? agentById.get(viewId) : undefined;
  const acts = tasks.filter((t) => t.botId === viewId).flatMap((t) => t.events.filter((ev) => ev.label.trim()).slice(-6).map((ev) => ({ ev, state: t.state })));
  const actions = acts.map((x, ai) => {
    const s = stepKind(x.state);
    return {
      hasLine: ai < acts.length - 1,
      label: x.ev.label,
      done: s === "done",
      active: s === "active",
      queued: s === "queued",
      paused: s === "paused",
      activeAttr: s === "active" ? "1" : "0",
      labelStyle: s === "active"
        ? "flex:1;min-width:0;font-size:13px;line-height:19px;letter-spacing:-0.008em;font-weight:500;color:transparent;background-image:linear-gradient(100deg,#15171C 0%,#15171C 36%,#D2D5DA 50%,#15171C 64%,#15171C 100%);background-size:250% 100%;-webkit-background-clip:text;background-clip:text;animation:clyraSweep 1.9s cubic-bezier(.45,0,.55,1) infinite"
        : ["flex:1", "min-width:0", "font-size:13px", "line-height:19px", "letter-spacing:-0.008em", "transition:color .24s ease", `color:${s === "done" ? "#50545C" : s === "paused" ? "#8A8E96" : "#B4B8BF"}`].join(";"),
    };
  });

  const tabs = curMembers.map((m) => {
    const on = m.id === viewId;
    return {
      name: m.name, shape: m.shape, color: m.color, busy: m.busy ? "true" : "false", onPick: () => patch({ viewAgent: m.id }),
      style: ["flex:1", "min-width:0", "height:26px", "padding:0 10px", "border-radius:999px", "border:none", "cursor:pointer", "font-family:inherit", "font-size:12.5px", `font-weight:${on ? "700" : "400"}`, "white-space:nowrap", "overflow:hidden", "text-overflow:ellipsis", "transition:background .24s ease, color .24s ease, box-shadow .24s ease", `background:${on ? "#FFFFFF" : "transparent"}`, `box-shadow:${on ? "0 1px 2px rgba(16,18,24,0.08), 0 0 0 0.5px rgba(16,18,24,0.06)" : "none"}`, `color:${on ? "#15171C" : "#6B6F77"}`].join(";"),
    };
  });

  const ready = !!st.dName.trim() && !!st.dPrompt.trim();
  const swatches = AGENT_SWATCHES.map(([id, hex]) => {
    const on = id === st.dColor;
    return {
      name: id,
      onPick: () => patch((s) => ({ dColor: id, dKey: s.dKey + 1 })),
      style: ["width:28px", "height:28px", "border-radius:999px", "border:none", "cursor:pointer", "padding:0", `background:#${hex}`, `box-shadow:${on ? `0 0 0 2px #FFFFFF, 0 0 0 3.5px ${id === "creme" ? "#C9C6BD" : `#${hex}`}` : "inset 0 0 0 1px rgba(0,0,0,0.08)"}`, `transform:scale(${on ? "1" : ".9"})`, "transition:box-shadow .2s ease, transform .25s cubic-bezier(.16,1,.3,1)"].join(";"),
    };
  });
  const shapes = AGENT_SHAPES.map(([s, , label]) => {
    const on = s === st.dShape;
    return {
      shape: s,
      name: label,
      onPick: () => patch((x) => ({ dShape: s, dKey: x.dKey + 1 })),
      style: ["display:flex", "align-items:center", "justify-content:center", "width:44px", "height:44px", "border-radius:12px", "border:none", "cursor:pointer", `background:${on ? "#F0F0F2" : "transparent"}`, `box-shadow:${on ? "inset 0 0 0 1.5px #15171C" : "inset 0 0 0 1px rgba(16,18,24,0.08)"}`, "transition:background .28s cubic-bezier(.32,.72,0,1), box-shadow .2s ease"].join(";"),
    };
  });

  const caret = st.caret == null ? st.text.length : Math.min(st.caret, st.text.length);
  const slash = /(^|\s)\/([^\s/]*)$/.exec(st.text.slice(0, caret));
  const paletteOpen = !!slash && !st.palDismiss;
  const pq = paletteOpen && slash ? slash[2].toLowerCase() : "";
  const hasText = st.text.trim().length > 0 && !paletteOpen;
  const toolDefs = [
    { label: "Web search", desc: "Search the live web" },
    { label: "Deep research", desc: "Multi-step search with cited sources" },
    { label: "Code", desc: "Write and run code in a sandbox" },
  ];
  const palItems = toolDefs.filter((d) => !pq || d.label.toLowerCase().includes(pq) || d.desc.toLowerCase().includes(pq));
  const palIdx = Math.min(st.palIdx, Math.max(0, palItems.length - 1));
  const paletteItems = palItems.map((d, i) => ({
    label: d.label,
    desc: d.desc,
    icon: "",
    onPick: (e: { preventDefault: () => void }) => { e.preventDefault(); patch({ text: st.text.replace(/\s*\/[^\s/]*$/, " ").trimStart() }); },
    onEnter: () => { if (st.palIdx !== i) patch({ palIdx: i }); },
    style: ["display:flex", "align-items:center", "gap:11px", "width:100%", "padding:8px 12px 8px 8px", "border-radius:999px", "border:none", "cursor:pointer", "font-family:inherit", `background:${i === palIdx ? "rgba(16,18,24,0.055)" : "transparent"}`, `transition:background .24s ${SHELL}`].join(";"),
    hintStyle: "flex-shrink:0;font-size:11px;font-weight:500;color:#0B54D6;opacity:0;transition:opacity .2s ease",
  }));

  const paneOn = st.current ? st.pane : st.paneHome;
  const iconA = (on: boolean) => ["position:absolute", "left:6.5px", "top:6.5px", `opacity:${on ? "0" : "1"}`, `transform:rotate(${on ? "-90deg" : "0deg"}) scale(${on ? ".55" : "1"})`, "transition:opacity .24s ease, transform .4s cubic-bezier(.25,1,.35,1)"].join(";");
  const iconB = (on: boolean, dir: number) => ["position:absolute", "left:6.5px", "top:6.5px", `opacity:${on ? "1" : "0"}`, `transform:rotate(${on ? "0deg" : `${dir * 90}deg`}) scale(${on ? "1" : ".55"})`, "transition:opacity .24s ease, transform .4s cubic-bezier(.25,1,.35,1)"].join(";");
  const sideOn = st.side;
  const rm = st.rowMenu;
  const rmConv = rm ? conversations.find((x) => x.id === rm.id) ?? null : null;
  const rmBot = !!rmConv && rmConv.botIds.length === 1;

  const lineupAgents = agents.slice(0, 7);
  const lineup = lineupAgents.length
    ? lineupAgents.map((a, i) => ({
        name: a.name,
        color: a.color,
        size: String(Math.max(28, Math.round(46 - Math.abs(i - (lineupAgents.length - 1) / 2) * 5))),
        busy: a.busy ? "true" : "false",
        onOpen: () => {
          const conv = conversations.find((x) => x.botIds.length === 1 && x.botIds[0] === a.id);
          if (conv) c.openConversation(conv.id);
        },
        style: `display:flex;padding:3px;border:none;background:transparent;cursor:pointer;transition:transform .4s cubic-bezier(.16,1,.3,1);animation:clyraRise .6s cubic-bezier(.16,1,.3,1) ${(i * 0.05).toFixed(2)}s both`,
      }))
    : [{ name: "New agent", color: "gris", size: "60", busy: "false", onOpen: () => patch({ create: true, editId: null, dName: "", dPrompt: "" }), style: "display:flex;padding:3px;border:none;background:transparent;cursor:pointer;animation:clyraRise .6s cubic-bezier(.16,1,.3,1) both" }];

  const feed = tasks
    .flatMap((t) => t.events.slice(-1).map((ev) => ({ t, ev })))
    .slice(-4)
    .reverse()
    .map(({ t, ev }) => {
      const a = agentById.get(t.botId);
      const pct = t.state === "completed" ? 100 : t.state === "running" ? 50 : 10;
      return {
        name: a?.name ?? "Agent",
        label: ev.label,
        color: a?.color ?? "gris",
        busy: t.state === "running" ? "true" : "false",
        time: relative(ev.at),
        progress: t.state,
        onOpen: () => {
          const conv = conversations.find((x) => x.botIds.includes(t.botId));
          if (conv) c.openConversation(conv.id);
        },
        barStyle: `display:block;height:100%;border-radius:999px;transition:width .6s cubic-bezier(.32,.72,0,1);width:${pct}%;background:${t.state === "running" ? "#1E6FFF" : "#15171C"}`,
        labelStyle: "display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;min-height:37px;font-size:13.5px;line-height:1.4;color:#3A3D44",
      };
    });

  const needs = conversations.filter((x) => x.unread > 0).slice(0, 4).map((x) => ({
    title: x.title,
    sub: x.lastMessage || "New message",
    color: c.convMembers(x)[0]?.color ?? "gris",
    tag: "Unread",
    onOpen: () => c.openConversation(x.id),
    tagStyle: "flex-shrink:0;height:22px;padding:0 9px;display:flex;align-items:center;border-radius:999px;font-size:11.5px;font-weight:700;background:rgba(30,111,255,0.08);color:#0B54D6",
  }));

  const homeTitle = st.view === "market" && !st.current ? "Marketplace" : !st.current && !st.toMode ? "Home" : cur && isGroup ? cur.title : names.join(", ");
  const today = new Date();
  const runningCount = agents.filter((a) => a.busy).length;

  const starters = STARTERS.map((s) => ({ label: s.label, onPick: () => patch((x) => ({ dPrompt: s.text, dName: x.dName || s.label })) }));
  const firstStarters = STARTERS.map((p, i) => {
    const color = ["bleu", "vert", "orange", "violet"][i % 4];
    return { label: p.label, color, onPick: () => patch({ create: true, editId: null, dName: p.label, dPrompt: p.text, dColor: color }) };
  });

  const mq = st.mq.trim().toLowerCase();
  const templates = AGENT_TEMPLATES.map((t) => ({
    id: t.id, name: t.name, cat: t.category, tagline: t.blurb, job: t.instructions, color: colorNameOf(t.color), caps: t.permissions, featured: t.pick,
  }));
  const categories = Array.from(new Set(AGENT_TEMPLATES.map((t) => t.category)));
  const matches = (t: { name: string; cat: string; tagline: string; job: string }) => !mq || [t.name, t.cat, t.tagline, t.job].join(" ").toLowerCase().includes(mq);
  const pooled = templates.filter(matches);
  const shown = pooled.filter((t) => st.mcat === "All" || t.cat === st.mcat);
  const marketItem = (t: (typeof templates)[number]) => {
    const added = agents.some((a) => a.name === t.name);
    const tpl = AGENT_TEMPLATES.find((x) => x.id === t.id);
    const prefill = () => patch({ create: true, editId: null, dName: t.name, dPrompt: t.job, dColor: t.color, dShape: "cercle" });
    return {
      name: t.name,
      cat: t.cat,
      color: t.color,
      tagline: t.tagline,
      caps: t.caps,
      added,
      getLabel: added ? "Open" : "Get",
      getStyle: `flex-shrink:0;height:28px;min-width:58px;padding:0 14px;border-radius:999px;border:none;cursor:pointer;font-family:inherit;font-size:13px;font-weight:700;background:${added ? "rgba(16,18,24,0.06)" : "rgba(30,111,255,0.1)"};color:${added ? "#5F636B" : "#1E6FFF"}`,
      heroGet: "",
      idle: true,
      installing: false,
      tileStyle: `display:flex;align-items:center;justify-content:center;width:52px;height:52px;border-radius:16px;flex-shrink:0;background:color-mix(in oklch, #${hexOfName(t.color)} 13%, #FFFFFF)`,
      onPrefill: prefill,
      onOpen: prefill,
      onAdd: (e: { stopPropagation: () => void }) => {
        e.stopPropagation();
        if (!tpl || added) return;
        void coworkApi.createBot(templateToBotInput(tpl)).then(() => c.refreshAll());
      },
      addStyle: `flex-shrink:0;height:28px;padding:0 12px;border-radius:999px;border:none;cursor:pointer;font-family:inherit;font-size:12.5px;font-weight:700;background:${added ? "rgba(16,18,24,0.05)" : "#15171C"};color:${added ? "#15171C" : "#FFFFFF"}`,
    };
  };

  return {
    goHome: () => patch({ view: null, current: null, toMode: false, paneHome: false }),
    openMarket: () => patch({ view: "market", current: null, toMode: false, homeMenu: false }),
    openTemplates: () => patch({ view: "market" }),
    sideQuery: st.sideQuery,
    onSideQuery: (e: { target: { value: string } }) => patch({ sideQuery: e.target.value }),
    chatRows,
    noChats: conversations.length === 0 && !sq,
    toggleNewMenu: () => patch((s) => ({ newMenu: !s.newMenu })),
    newMenuStyle: ["position:absolute", "top:44px", "right:8px", "width:230px", "padding:5px", "border-radius:22px", "background:#FFFFFF", "z-index:40", "transform-origin:top right", "box-shadow:0 1px 1px rgba(16,18,24,0.04), 0 20px 48px -14px rgba(16,18,24,0.28), inset 0 0 0 1px rgba(16,18,24,0.07)", `opacity:${st.newMenu ? "1" : "0"}`, `transform:translateY(${st.newMenu ? "0" : "-6px"}) scale(${st.newMenu ? "1" : ".95"})`, `pointer-events:${st.newMenu ? "auto" : "none"}`, `visibility:${st.newMenu ? "visible" : "hidden"}`, "transition:opacity .18s ease, transform .34s cubic-bezier(.16,1,.3,1)"].join(";"),
    plusBtnStyle: ["display:flex", "align-items:center", "justify-content:center", "width:30px", "height:30px", "border-radius:999px", "border:none", "cursor:pointer", "color:#5F636B", "transition:background .28s cubic-bezier(.32,.72,0,1), transform .22s cubic-bezier(.32,.72,0,1)", `background:${st.newMenu ? "rgba(16,18,24,0.07)" : "transparent"}`].join(";"),
    openCreate: () => patch({ newMenu: false, create: true, editId: null, dName: "", dPrompt: "", dColor: AGENT_SWATCHES[(agents.length * 5) % 12][0], dShape: "cercle" }),
    startGroup: () => patch({ newMenu: false, toMode: true, draft: [], toQuery: "" }),
    toggleSide: () => patch((s) => ({ side: !s.side, rowMenu: null })),
    sideTitle: sideOn ? "Collapse sidebar" : "Show sidebar",
    sideIconA: iconA(sideOn),
    sideIconB: iconB(sideOn, 1),
    mainSideIconA: iconA(false),
    mainSideIconB: iconB(false, 1),
    mainPaneIconA: iconA(false),
    mainPaneIconB: iconB(false, -1),
    paneIconA: iconA(paneOn),
    paneIconB: iconB(paneOn, -1),
    sideSlotMain: ["display:flex", "flex-shrink:0", "overflow:hidden", `width:${sideOn ? "0px" : "30px"}`, `margin-right:${sideOn ? "-10px" : "0px"}`, `opacity:${sideOn ? "0" : "1"}`, `transform:scale(${sideOn ? ".8" : "1"})`, `pointer-events:${sideOn ? "none" : "auto"}`, "transition:width .3s cubic-bezier(.25,1,.35,1)"].join(";"),
    sideWrapStyle: ["display:flex", "flex-shrink:0", "min-height:0", "overflow:hidden", `width:${sideOn ? SIDE_W : "0px"}`, "will-change:width", "contain:layout paint", "transition:width .4s cubic-bezier(.25,1,.35,1)"].join(";"),
    sideInnerStyle: ["position:relative", `flex:0 0 ${SIDE_W}`, `width:${SIDE_W}`, "display:flex", "flex-direction:column", "min-height:0", "background:#F4F4F6", "border-right:1px solid rgba(16,18,24,0.07)", `opacity:${sideOn ? "1" : "0"}`, `transform:translate3d(${sideOn ? "0" : "-24px"},0,0)`, "will-change:transform, opacity", "backface-visibility:hidden", `transition:opacity ${sideOn ? ".32s ease .04s" : ".2s ease"}, transform .4s cubic-bezier(.25,1,.35,1)`].join(";"),
    rowMenuStyle: ["position:absolute", `right:${rm ? rm.right : 20}px`, `top:${rm ? rm.top : 0}px`, "width:188px", "padding:5px", "border-radius:20px", "background:#FFFFFF", "z-index:50", "transform-origin:top right", "box-shadow:0 1px 1px rgba(16,18,24,0.04), 0 18px 44px -14px rgba(16,18,24,0.28), inset 0 0 0 1px rgba(16,18,24,0.07)", `opacity:${rm ? "1" : "0"}`, `transform:translateY(${rm ? "0" : "-6px"}) scale(${rm ? "1" : ".94"})`, `pointer-events:${rm ? "auto" : "none"}`, `visibility:${rm ? "visible" : "hidden"}`, "transition:opacity .18s ease, transform .32s cubic-bezier(.16,1,.3,1)"].join(";"),
    renameLabel: rmBot ? "Rename agent" : "Rename group",
    deleteLabel: rmBot ? "Delete agent" : "Delete group chat",
    menuIsBot: rmBot,
    menuRename: () => { if (rmConv) patch({ renaming: rmConv.id, renameVal: rmConv.title, rowMenu: null }); },
    menuEdit: () => {
      if (!rmConv || !rmBot) return;
      const a = agentById.get(rmConv.botIds[0]);
      if (a) patch({ rowMenu: null, create: true, editId: a.id, dName: a.name, dPrompt: a.prompt, dColor: a.color, dShape: a.shape });
    },
    menuDelete: () => { if (rmConv) void c.deleteConversation(rmConv.id); },
    renameRef: (el: HTMLInputElement | null) => { if (el && document.activeElement !== el) { el.focus(); el.select(); } },
    renameVal: st.renameVal,
    onRenameVal: (e: { target: { value: string } }) => patch({ renameVal: e.target.value }),
    onRenameKey: (e: { key: string; preventDefault: () => void }) => {
      if (e.key === "Enter") { e.preventDefault(); void c.commitRename(); }
      else if (e.key === "Escape") patch({ renaming: null });
    },
    commitRename: () => { void c.commitRename(); },
    stop: (e: { stopPropagation: () => void }) => e.stopPropagation(),
    asideRef: () => {},

    headKey: st.view || st.current || "home",
    headIsChat: !!st.current && !st.view && !st.toMode,
    headIsPage: !(st.current && !st.view) && !st.toMode,
    headerMode: !st.toMode,
    headAvs,
    headTitle: homeTitle,
    memberCount: `${names.length} agents`,
    headClickTitle: isGroup ? "Edit group" : "Edit agent",
    headClick: () => {
      if (isGroup || !cur) { patch({ toMode: true, draft: cur ? [...cur.botIds] : [], toQuery: "" }); return; }
      const a = agentById.get(cur.botIds[0]);
      if (a) patch({ create: true, editId: a.id, dName: a.name, dPrompt: a.prompt, dColor: a.color, dShape: a.shape });
    },
    enterTo: () => patch({ toMode: true, draft: cur ? [...cur.botIds] : [], toQuery: "" }),
    exitTo: () => { if (st.draft.length) void c.commitDraft(); else patch({ toMode: false }); },
    toMode: st.toMode,
    isGroup,
    togglePane: () => patch((s) => (!s.current ? { paneHome: !s.paneHome } : { pane: !s.pane })),
    paneTitle: paneOn ? "Collapse agent screen" : "Show agent screen",
    paneSlotMain: ["display:flex", "flex-shrink:0", "overflow:hidden", "margin-left:auto", `width:${paneOn ? "0px" : "30px"}`, `opacity:${paneOn ? "0" : "1"}`, `transform:scale(${paneOn ? ".8" : "1"})`, `pointer-events:${paneOn ? "none" : "auto"}`].join(";"),
    paneWrapStyle: ["display:flex", "flex-shrink:0", "min-height:0", "overflow:hidden", `width:${paneOn ? PANE_W : "0px"}`, "will-change:width", "contain:layout paint", "transition:width .4s cubic-bezier(.25,1,.35,1)"].join(";"),
    paneInnerStyle: [`flex:0 0 ${PANE_W}`, `width:${PANE_W}`, "display:flex", "flex-direction:column", "min-height:0", "background:#FFFFFF", "border-left:1px solid rgba(16,18,24,0.07)", "overflow:hidden", `opacity:${paneOn ? "1" : "0"}`, `transform:translate3d(${paneOn ? "0" : "24px"},0,0)`, "transition:opacity .32s ease .04s, transform .4s cubic-bezier(.25,1,.35,1)"].join(";"),
    paneScrollRef: () => {},
    paneTitle2: viewAgent ? viewAgent.name : "Agent",
    tabs,
    multiTabs: curMembers.length > 1,
    actions,
    noActions: actions.length === 0,
    actionCount: acts.length ? `${acts.filter((x) => stepKind(x.state) === "done").length} of ${acts.length}` : "",
    viewLive: !!viewAgent?.busy,
    vpMode: viewAgent?.busy ? "thinking" : "idle",
    vpCursors: "[]",
    vpStatus: viewAgent ? (viewAgent.busy ? "Working" : "Idle") : "Idle",
    vpTitle: viewAgent ? `${viewAgent.name}'s activity` : "Agent activity",
    vpAvs: viewAgent ? [c.avOf(viewAgent, 26)] : [],
    takeoverLabel: "Pause",
    toggleTakeover: () => {
      const t = tasks.find((x) => x.botId === viewId && x.state === "running");
      if (t) void c.taskOp(t, "pause");
    },
    canTakeover: !!viewAgent?.busy,

    greeting: (() => {
      const h = today.getHours();
      if (!hasAgents) return "Welcome";
      return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
    })(),
    homeTitle,
    dateDay: today.toLocaleDateString(undefined, { weekday: "long" }),
    dateLine: `${today.toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" })}${runningCount ? ` · ${runningCount} working` : ""}`,
    homeSub: hasAgents
      ? `${agents.length === 1 ? "Your agent is ready." : `Your ${agents.length} agents are ready.`} Choose who to message and what to work on.`
      : "You don't have any agents yet. Create one, give it a job, and it gets to work.",
    lineup,
    feed,
    feedEmpty: feed.length === 0,
    feedCount: runningCount ? `${runningCount} working now` : "All caught up",
    needs,
    hasNeeds: needs.length > 0,
    needsCount: `${needs.length} ${needs.length === 1 ? "item" : "items"}`,
    noAgents: !hasAgents,
    hasAgents,
    hasAgentOpts: hasAgents,
    firstStarters,
    starters,
    showStarters: false,
    homeAgentOpts: agents.map((a) => {
      const conv = conversations.find((x) => x.botIds.length === 1 && x.botIds[0] === a.id);
      const on = !!conv && conv.id === st.homeTo;
      return {
        name: a.name,
        sub: a.prompt,
        color: a.color,
        busy: a.busy ? "true" : "false",
        on,
        onPick: () => { if (conv) patch({ homeTo: conv.id, homeMenu: false }); },
        style: ["display:flex", "align-items:center", "gap:10px", "width:100%", "padding:7px 12px 7px 8px", "border-radius:999px", "border:none", "cursor:pointer", "font-family:inherit", "transition:background .26s cubic-bezier(.32,.72,0,1)", `background:${on ? "rgba(30,111,255,0.06)" : "transparent"}`].join(";"),
      };
    }),
    homeGroupOpts: conversations.filter((x) => x.botIds.length > 1).map((x) => {
      const ms = c.convMembers(x);
      const on = x.id === st.homeTo;
      return {
        name: x.title,
        sub: `${ms.length} agents`,
        c1: ms[0]?.color ?? "gris",
        c2: ms[1]?.color ?? "gris",
        on,
        onPick: () => patch({ homeTo: x.id, homeMenu: false }),
        style: ["display:flex", "align-items:center", "gap:10px", "width:100%", "padding:7px 12px 7px 8px", "border-radius:999px", "border:none", "cursor:pointer", "font-family:inherit", "transition:background .26s cubic-bezier(.32,.72,0,1)", `background:${on ? "rgba(30,111,255,0.06)" : "transparent"}`].join(";"),
      };
    }),
    hasGroupOpts: conversations.some((x) => x.botIds.length > 1),
    homeToAvs: homeConv ? c.convMembers(homeConv).slice(0, 3).map((m, k) => c.avOf(m, 20, false, k ? "margin-left:-7px;" : "")) : [],
    homeToName: homeConv ? homeConv.title : hasAgents ? "Choose agent" : "Create an agent",
    homePlaceholder: !hasAgents
      ? "Create an agent to start chatting"
      : !homeConv
        ? "Choose an agent, then type your message"
        : `Message ${homeConv.title}, or type / for tools`,
    toggleHomeMenu: () => patch((s) => ({ homeMenu: !s.homeMenu })),
    homeMenuStyle: ["position:absolute", "left:0", "top:calc(100% + 8px)", "width:300px", "padding:5px", "border-radius:22px", "background:#FFFFFF", "z-index:40", "transform-origin:top left", "box-shadow:0 1px 1px rgba(16,18,24,0.04), 0 24px 56px -16px rgba(16,18,24,0.28), inset 0 0 0 1px rgba(16,18,24,0.07)", `opacity:${st.homeMenu ? "1" : "0"}`, `transform:translateY(${st.homeMenu ? "0" : "-8px"}) scale(${st.homeMenu ? "1" : ".96"})`, `pointer-events:${st.homeMenu ? "auto" : "none"}`, `visibility:${st.homeMenu ? "visible" : "hidden"}`, "transition:opacity .2s ease, transform .4s cubic-bezier(.16,1,.3,1)"].join(";"),
    toBtnStyle: ["display:flex", "align-items:center", "gap:7px", "height:30px", "padding:0 10px 0 5px", "border-radius:999px", "border:none", "cursor:pointer", "font-family:inherit", "font-size:13px", "font-weight:700", "color:#15171C", "transition:background .28s cubic-bezier(.32,.72,0,1), transform .22s cubic-bezier(.32,.72,0,1)", `background:${st.homeMenu ? "rgba(16,18,24,0.08)" : "rgba(16,18,24,0.05)"}`].join(";"),
    toChevStyle: `color:#7A7E87;transition:transform .3s cubic-bezier(.32,.72,0,1);transform:rotate(${st.homeMenu ? "180deg" : "0deg"})`,
    homeRowStyle: ["display:flex", "align-items:center", "gap:10px", "width:100%", "height:36px", "padding:0 12px", "border-radius:10px", "border:none", "cursor:pointer", "font-family:inherit", "font-size:14px", "font-weight:700", "text-align:left", "transition:background .24s ease, color .24s ease", "background:transparent", `color:${!st.current && !st.toMode ? "#15171C" : "#3A3D44"}`].join(";"),
    homeNewGroup: (e: { preventDefault: () => void }) => { e.preventDefault(); patch({ homeMenu: false, toMode: true, draft: [], toQuery: "" }); },
    homeMenuActionLabel: hasAgents ? "New group chat" : "New agent",
    homeIdeas: [],
    chatIdeas: [],

    chatKey: st.toMode ? "new" : st.current || "home",
    inChat: (!!st.current || st.toMode) && !st.view,
    inMarket: st.view === "market",
    onHome: !st.current && !st.toMode && !st.view,
    scrollRef: (el: HTMLDivElement | null) => { c.scrollRef.current = el; },
    messages,
    hasStamp: msgs.length > 0,
    stamp: cur ? clock(cur.updatedAt) : "Today",
    empty: msgs.length === 0 && !typingHere,
    emptyTitle: st.toMode && !st.draft.length ? "Who's in this chat?" : "Start the conversation",
    emptySub: st.toMode && !st.draft.length ? "Type agent names in the To: field. Add as many as you need." : "Everyone here picks up their part. Watch each agent work on the right.",
    typing: typingHere,
    soloTyping: typingHere && !isGroup,
    groupTyping: typingHere && isGroup,
    groupTypingLabel: typingHere && typingAgent ? `${typingAgent.name} is working…` : "",
    typingAvs: typingHere && typingAgent ? [c.avOf(typingAgent, 20)] : [],
    typingLabel: typingHere && typingAgent ? `${typingAgent.name} · ${typingTask?.currentStep || "Thinking"}` : "",
    freshChat: msgs.length === 0 && !!cur && !st.toMode,
    freshAvs: curMembers.slice(0, 4).map((m, k) => c.avOf(m, 56, false, k ? "margin-left:-14px;" : "")),
    freshTitle: curMembers.length > 1 ? cur?.title ?? names.join(", ") : curMembers[0]?.name ?? "",
    freshSub: curMembers.length > 1 ? "Everyone here picks up their part." : curMembers[0]?.prompt ?? "",
    chips: st.draft.map((id) => ({
      name: agentById.get(id)?.name ?? "",
      av: c.avOf(agentById.get(id), 18),
      onRemove: (e: { stopPropagation: () => void }) => { e.stopPropagation(); patch((s) => ({ draft: s.draft.filter((x) => x !== id) })); },
    })),
    toRef: () => {},
    focusTo: () => {},
    toQuery: st.toQuery,
    toPlaceholder: st.draft.length ? "" : "Type an agent's name",
    onToQuery: (e: { target: { value: string } }) => patch({ toQuery: e.target.value, sugIdx: 0 }),
    onToFocus: () => patch({ toFocus: true }),
    onToBlur: () => patch({ toFocus: false }),
    onToKey: (e: { key: string; preventDefault: () => void; currentTarget: HTMLElement }) => {
      if (e.key === "Backspace" && !st.toQuery && st.draft.length) patch((s) => ({ draft: s.draft.slice(0, -1) }));
      else if (e.key === "ArrowDown") { e.preventDefault(); patch({ sugIdx: Math.min(sugIdx + 1, pool.length - 1) }); }
      else if (e.key === "ArrowUp") { e.preventDefault(); patch({ sugIdx: Math.max(sugIdx - 1, 0) }); }
      else if ((e.key === "Enter" || e.key === "Tab") && pool[sugIdx] && tq) {
        e.preventDefault();
        const pick = pool[sugIdx];
        patch((s) => ({ draft: [...s.draft, pick.id], toQuery: "", sugIdx: 0 }));
      } else if (e.key === "Enter" && !tq && st.draft.length) { e.preventDefault(); void c.commitDraft(); }
      else if (e.key === "Escape") e.currentTarget.blur();
    },
    suggestStyle,
    suggestions,
    noSuggest: pool.length === 0,
    suggestHeading: tq ? "Matching agents" : "Agents",

    placeholder: names.length ? "Message, or type / for tools" : "Add agents to start",
    text: st.text,
    onText: (e: { target: HTMLTextAreaElement }) => patch({ text: e.target.value, caret: e.target.selectionStart, palIdx: 0, palDismiss: false }),
    onCaret: (e: { target: HTMLTextAreaElement }) => { const p = e.target.selectionStart; if (p !== st.caret) patch({ caret: p }); },
    inputRef: (el: HTMLTextAreaElement | null) => { c.inputRef.current = el; },
    mirrorRef: () => {},
    onTaScroll: () => {},
    inputParts: [{ isTok: false, isText: true, text: st.text, key: "t" }, { isTok: false, isText: true, text: "​", key: "end" }],
    onKey: c.onKey,
    onSend: () => { void c.sendText(); },
    sendStyle: ["width:34px", "height:34px", "border-radius:999px", "border:none", "display:flex", "align-items:center", "justify-content:center", "cursor:pointer", "margin-left:2px", `background:${hasText ? "#1E6FFF" : "#EDEEF1"}`, `color:${hasText ? "#FFFFFF" : "#AFB3BB"}`, `box-shadow:${hasText ? "0 2px 10px -2px rgba(30,111,255,0.55)" : "none"}`, `transition:background .22s ${EASE}, color .22s ${EASE}, box-shadow .22s ${EASE}, transform .13s ${EASE}`].join(";"),
    paletteStyle: ["position:absolute", "left:-4px", "right:-4px", "bottom:calc(100% + 12px)", "padding:5px", "border-radius:24px", "background:#FFFFFF", "z-index:22", "transform-origin:bottom center", "box-shadow:0 1px 1px rgba(16,18,24,0.04), 0 24px 56px -16px rgba(16,18,24,0.28), inset 0 0 0 1px rgba(16,18,24,0.07)", `opacity:${paletteOpen ? "1" : "0"}`, `transform:translateY(${paletteOpen ? "0" : "14px"}) scale(${paletteOpen ? "1" : ".97"})`, `pointer-events:${paletteOpen ? "auto" : "none"}`, `visibility:${paletteOpen ? "visible" : "hidden"}`, "transition:opacity .2s ease, transform .4s cubic-bezier(.16,1,.3,1)"].join(";"),
    paletteHeading: pq ? `Matching “${pq}”` : "Tools and sources",
    noPal: palItems.length === 0,
    paletteItems,
    pickMode: st.toMode,
    pickTitle: st.draft.length ? (st.draft.length === 1 ? `Chat with ${agentById.get(st.draft[0])?.name ?? ""}` : `Group of ${st.draft.length}`) : "Start a new chat",
    pickSub: st.draft.length ? "Add more agents to make a group, or just start typing below." : "Pick one agent, or several to make a group.",
    pickAgents: agents.map((a) => {
      const on = st.draft.includes(a.id);
      return {
        name: a.name,
        prompt: a.prompt,
        color: a.color,
        busy: a.busy ? "true" : "false",
        onToggle: (e: { preventDefault: () => void }) => { e.preventDefault(); patch((s) => ({ draft: s.draft.includes(a.id) ? s.draft.filter((x) => x !== a.id) : [...s.draft, a.id] })); },
        style: ["display:flex", "flex-direction:column", "align-items:flex-start", "gap:12px", "padding:14px", "border-radius:22px", "border:none", "cursor:pointer", "font-family:inherit", "text-align:left", "min-width:0", `background:${on ? "rgba(30,111,255,0.05)" : "#FFFFFF"}`, `box-shadow:${on ? "inset 0 0 0 1.5px rgba(30,111,255,0.6)" : "inset 0 0 0 1px rgba(16,18,24,0.07)"}`, "transition:background .25s ease, box-shadow .25s ease"].join(";"),
        checkStyle: ["display:flex", "align-items:center", "justify-content:center", "width:20px", "height:20px", "border-radius:999px", `background:${on ? "#1E6FFF" : "transparent"}`, `box-shadow:${on ? "none" : "inset 0 0 0 1.5px rgba(16,18,24,0.14)"}`].join(";"),
      };
    }),

    scrimStyle: ["position:absolute", "inset:0", "z-index:100", "display:flex", "align-items:center", "justify-content:center", "padding:24px", `background:rgba(20,20,24,${cr ? "0.28" : "0"})`, `pointer-events:${cr ? "auto" : "none"}`, `visibility:${cr ? "visible" : "hidden"}`, "transition:background .3s ease"].join(";"),
    sheetStyle: ["width:100%", "max-width:460px", "max-height:100%", "overflow-y:auto", "border-radius:24px", "background:#FFFFFF", "box-shadow:0 30px 80px -20px rgba(16,18,24,0.4), inset 0 0 0 1px rgba(16,18,24,0.06)", `opacity:${cr ? "1" : "0"}`, `transform:translateY(${cr ? "0" : "14px"}) scale(${cr ? "1" : ".96"})`, "transition:opacity .22s ease, transform .45s cubic-bezier(.16,1,.3,1)"].join(";"),
    scrimDown: (e: { target: HTMLElement }) => { if (!e.target.closest("[data-sheet]")) patch({ create: false }); },
    closeCreate: () => patch({ create: false }),
    dShape: st.dShape,
    dColor: st.dColor,
    draftTitle: st.dName.trim() || "New agent",
    sheetSub: st.editId ? "Change its name, job or color." : "Name it, tell it what to do, pick a color.",
    draftName: st.dName,
    onDraftName: (e: { target: { value: string } }) => patch({ dName: e.target.value }),
    draftPrompt: st.dPrompt,
    onDraftPrompt: (e: { target: { value: string } }) => patch({ dPrompt: e.target.value }),
    promptRows: st.dPrompt.length > 220 ? 12 : 3,
    promptCount: st.dPrompt.length > 220
      ? `${st.dPrompt.split("\n").filter(Boolean).length} lines · ${st.dPrompt.length.toLocaleString()} chars`
      : `${st.dPrompt.length} / 160`,
    countStyle: `font-size:11.5px;font-variant-numeric:tabular-nums;color:${st.dPrompt.length > 140 && st.dPrompt.length <= 220 ? "#C4372B" : "#9DA1A9"}`,
    nameRef: () => {},
    swatches,
    shapes,
    saveAgent: () => { void c.saveAgent(); },
    saveLabel: st.editId ? "Save" : "Create agent",
    createBtnStyle: ["height:38px", "padding:0 18px", "border-radius:999px", "border:none", "font-family:inherit", "font-size:13.5px", "font-weight:500", "transition:background .28s cubic-bezier(.32,.72,0,1), color .28s cubic-bezier(.32,.72,0,1)", `cursor:${ready ? "pointer" : "default"}`, `background:${ready ? "#1E6FFF" : "#EDEEF1"}`, `color:${ready ? "#FFFFFF" : "#AFB3BB"}`].join(";"),

    tplOverlayStyle: HIDDEN_OVERLAY,
    tplCardStyle: HIDDEN_CARD,
    previewOverlayStyle: HIDDEN_OVERLAY,
    previewCardStyle: HIDDEN_CARD,
    tplAsk: [],
    tplQuality: [],
    tplTone: "",
    tplCaps: [],
    tplGoals: [],
    tplRules: [],
    tplExtra: [],
    tplSteps: [],
    tplIdle: true,
    tplInstalling: false,
    tplName: "",
    tplCat: "",
    tplColor: "gris",
    tplTagline: "",
    tplJob: "",
    tplRole: "",
    tplOutput: "",
    tplAddLabel: "",
    tplAddStyle: "",
    tplAdd: () => {},
    closeTpl: () => {},
    closePreview: () => {},
    hasFiles: false,
    files: [],
    pickFiles: () => {},
    onFiles: () => {},
    fileRef: () => {},
    previewKey: `p${st.dKey}`,
    mq: st.mq,
    onMq: (e: { target: { value: string } }) => patch({ mq: e.target.value }),
    clearMq: () => patch({ mq: "" }),
    mHasQ: !!mq,
    mBrowse: st.view === "market" && st.mcat === "All" && !mq,
    mFiltered: st.view === "market" && !(st.mcat === "All" && !mq),
    mEyebrow: `${agents.length} added · ${templates.length} available`,
    mFilterTitle: mq ? `Results for “${st.mq.trim()}”` : st.mcat,
    mHero: st.view === "market" ? templates.filter((t) => t.featured).slice(0, 3).map(marketItem) : [],
    mShelves: st.view !== "market" ? [] : categories
      .map((cat) => ({
        title: cat,
        sub: `${templates.filter((t) => t.cat === cat).length} agents`,
        onSeeAll: () => patch({ mcat: cat }),
        items: templates.filter((t) => t.cat === cat && !t.featured).slice(0, 4).map(marketItem),
      }))
      .filter((x) => x.items.length),
    mcats: ["All", ...categories].map((cat) => {
      const on = st.mcat === cat;
      const n = cat === "All" ? pooled.length : pooled.filter((t) => t.cat === cat).length;
      return {
        label: cat,
        count: String(n),
        onPick: () => patch({ mcat: cat }),
        style: ["display:flex", "align-items:center", "flex-shrink:0", "height:32px", "padding:0 13px", "border-radius:999px", "border:none", "cursor:pointer", "font-family:inherit", "font-size:13.5px", "font-weight:700", "white-space:nowrap", "transition:background .3s cubic-bezier(.32,.72,0,1), color .3s cubic-bezier(.32,.72,0,1)", `background:${on ? "rgba(16,18,24,0.07)" : "transparent"}`, `color:${on ? "#15171C" : "#8A8E96"}`].join(";"),
        countStyle: `font-size:11.5px;font-weight:400;font-variant-numeric:tabular-nums;color:${on ? "rgba(16,18,24,0.5)" : "#A8ACB4"}`,
      };
    }),
    mResultLabel: `${shown.length} ${shown.length === 1 ? "agent" : "agents"}`,
    mEmpty: shown.length === 0,
    mItems: shown.map(marketItem),
    marketRowStyle: ["display:flex", "align-items:center", "gap:10px", "width:100%", "height:36px", "padding:0 12px", "border-radius:10px", "border:none", "cursor:pointer", "font-family:inherit", "font-size:14px", "font-weight:700", "background:transparent", `color:${st.view === "market" ? "#15171C" : "#3A3D44"}`].join(";"),

    loadError: c.loadError,
    sendError: st.sendError,
    sending: st.sending,
    tplCount: templates.length,
  };
}
