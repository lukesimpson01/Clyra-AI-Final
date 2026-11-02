/* Workspace AI chat.

   The surface deliberately mirrors Clyra's launcher chat: the same one-line
   composer with a circular send action, the same user bubble, the same
   gradient reveal on the assistant's reply, and the same shimmer-with-mark
   treatment for work in progress. Answers stay grounded in the pages the
   student attaches with @. */
import { el, clear, icon, iconButton, bloub, toast, append, menu, modal, confirmDialog } from "../dom.js";
import { api } from "../api.js";
import { state, withError, refreshPages } from "../state.js";
import { formatRelative } from "../app.js";
import { renderMarkdown } from "../ai-composer.js";
import { openSearch } from "../search.js";
import { streamAgent, renderAgentRun } from "../agent-run.js";
import { instructionsFor, listAgents, getAgent, deleteAgent, openPersonalize, openAgentEditor, isPinned, togglePin } from "../chat-extras.js";

/* Quick actions under the composer, as Notion's chat has them: each is a real task for the agent, which can read the
   notes, create pages and answer with sources, not a canned reply. */
const ACTIONS = [
  { icon: "cards", label: "Make flashcards", prompt: "Make flashcards from my most recently edited note and save them as a new deck." },
  { icon: "check_square", label: "Practice test", prompt: "Write a 10 question practice test from my most recently edited note, with an answer key at the end, and save it as a new page." },
  { icon: "book", label: "Study guide", prompt: "Create a study guide page from my most recently edited note: key terms, the main ideas and likely exam questions." },
  { icon: "search", label: "Research", prompt: "Research this on the web and write it up as a new note with sources: " },
  { icon: "calendar", label: "Plan my week", prompt: "Look at my notes and build a realistic study plan for the next 7 days as a new page." },
];
const SUGGESTIONS = ACTIONS.map((a) => a.prompt);

/* The panel's starting points, as Notion's AI panel lists them: each is a real task for the agent on the open page. */
const PAGE_TASKS = [
  { icon: "align_left", label: "Summarize this page", prompt: "Summarize this page: the main points in a few short bullets." },
  { icon: "translate", label: "Translate this page", prompt: "Translate this page into Spanish and keep its structure. Put the translation in a new page." },
  { icon: "search", label: "Analyze for insights", prompt: "Analyze this page for insights: what stands out, what is missing and what I should do next." },
  { icon: "check_square", label: "Create a task tracker", prompt: "Create a task tracker page from the action items in this page, with To do, Doing and Done columns." },
];

/* What the picker offers. Clyra runs on DeepSeek, so these are its real speeds, not renamed copies of one model. */
const MODELS = [
  { id: "auto", label: "Auto", hint: "Balances speed, effort and cost.", model: undefined },
  { id: "fast", label: "Fast", hint: "Quickest answers for simple questions.", model: "deepseek-v4-flash" },
  { id: "thorough", label: "Thorough", hint: "More careful on long notes and hard questions.", model: "deepseek-v4-pro" },
];
const MODEL_KEY = "clyra-notes:chat-model";
const REVIEW_NOTE = "Review mode is on. Before you create a page or change a note, show the person exactly what you plan to write and wait for their go-ahead. Reading, searching and answering questions need no approval.";
const AUTOPAGE_KEY = "clyra-notes:chat-autopage";
export const autoPageOn = () => { try { return localStorage.getItem(AUTOPAGE_KEY) !== "0"; } catch { return true; } };
const clock = (when) => new Date(when).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

/* `compact` is the rail's chat: same thread, same composer, no history
   column and no room for one. Everything else behaves identically, so there
   is one chat implementation rather than two that drift. */
export function renderChat(host, app, options = {}) {
  const compact = Boolean(options.compact);
  let messages = [];
  let sources = [];
  let busy = false;
  let askAbort = null;
  let quotes = [];
  let chatId = null;
  let agentId = null;
  let reviewMode = false;
  let chats = [];
  let modelId = (() => { try { const saved = localStorage.getItem(MODEL_KEY); return MODELS.some((m) => m.id === saved) ? saved : "auto"; } catch { return "auto"; } })();
  let historyOpen = !compact && localStorage.getItem("clyra-notes:chat-history") !== "0";

  const thread = el("div", { class: "chat-thread scroll" });
  const historyList = el("div", { class: "chat-history-list scroll" });
  const agentList = el("div", { class: "chat-agent-list" });
  const chips = el("div", { class: "chat-sources" });
  /* The placeholder teaches the one thing the composer can do that a plain
     chat box cannot: attach notes. Naming the key is what makes it
     discoverable — there is nothing else on the bar that says so. */
  const PLACEHOLDER = "Ask Clyra";
  const input = el("textarea", {
    class: "chat-input", rows: "1", placeholder: PLACEHOLDER, "aria-label": "Ask Clyra",
  });
  const send = el("button", { class: "chat-send", type: "button", "aria-label": "Send message", disabled: true },
    el("span", { class: "chat-send-icon", "aria-hidden": "true", html: '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V6M6 12l6-6 6 6"/></svg>' }));

  const modelButton = el("button", { class: "chat-model", type: "button", "aria-haspopup": "menu", "aria-label": "Choose how Clyra answers" });
  const paintModel = () => { clear(modelButton); modelButton.append(el("span", { text: MODELS.find((m) => m.id === modelId).label }), icon("chevron_down", 11)); };
  paintModel();
  modelButton.addEventListener("click", () => menu(modelButton, [
    ...MODELS.map((m) => ({ label: m.label, hint: m.hint, checked: m.id === modelId, class: "model-row", onSelect: () => { modelId = m.id; try { localStorage.setItem(MODEL_KEY, m.id); } catch { /* storage off */ } paintModel(); } })),
  ], { class: "model-menu", side: "top", align: "end" }));
  const plusButton = iconButton("plus", "Add context", () => menu(plusButton, [
    { label: "Add a note", icon: "page", onSelect: () => addSource() },
    { label: "Research the web", icon: "search", onSelect: () => { if (!input.value.trim()) input.value = "Research this on the web and write it up with sources: "; grow(); syncSend(); input.focus(); input.setSelectionRange(input.value.length, input.value.length); } },
    { label: "Web browser", icon: "embed", hint: "Open beside the page", onSelect: () => app.showRailPanel ? (app.railOpen?.() || app.toggleRail?.(), app.showRailPanel("browser")) : null },
    { label: "Ask about a selection", icon: "comment", hint: "Select text in a page first", onSelect: () => toast("Select text in a page, then choose Ask Clyra") },
    { type: "separator" },
    { type: "label", label: "Agents" },
    ...listAgents().map((agent) => ({ label: agent.name, icon: agent.emoji || "sparkle", checked: agent.id === agentId, onSelect: () => startChat(agent.id) })),
    { label: "New agent\u2026", icon: "plus", onSelect: () => openAgentEditor(null, (saved) => startChat(saved.id)) },
  ], { side: "top" }), { size: 16, className: "chat-at" });

  /* "Review for me": Clyra shows what it would write and waits, instead of acting. */
  const reviewChip = el("button", { class: "chat-review", type: "button", "aria-pressed": "false", title: "Clyra shows what it plans to write and waits for your go-ahead" }, icon("check_square", 14), el("span", { text: "Review for me" }));
  reviewChip.addEventListener("click", () => { reviewMode = !reviewMode; reviewChip.classList.toggle("on", reviewMode); reviewChip.setAttribute("aria-pressed", String(reviewMode)); });

  /* What Clyra may look at: a real switch for reading the open page, and a plain statement of what it can and cannot do. */
  const shieldButton = iconButton("shield", "What Clyra can use", () => menu(shieldButton, [
    { type: "label", label: "Clyra can use" },
    { label: "Read this page", icon: "page", switch: true, checked: autoPageOn(), keepOpen: true, onSelect: () => {
      const next = !autoPageOn();
      try { localStorage.setItem(AUTOPAGE_KEY, next ? "1" : "0"); } catch { /* storage off */ }
      if (!next) { sources = sources.filter((source) => source.manual); paintSources(); } else app.reattachChatContext?.();
    } },
    { label: "Search your notes", icon: "search", disabled: true, hint: "Always on" },
    { label: "Search the web", icon: "link", disabled: true, hint: "When a question needs it" },
    { type: "separator" },
    { label: "It never edits a page on its own", icon: "lock", disabled: true, hint: "You choose Insert or Create page" },
  ], { side: "top" }), { size: 16, className: "chat-at" });

  /* Chat's composer shape: the prompt on top, a control row beneath — add context on the left, the model and send on the right. */
  const composer = el("div", { class: "chat-composer" },
    el("div", { class: "chat-bar" },
      el("div", { class: "chat-bar-field" }, input),
      el("div", { class: "chat-bar-controls" },
        plusButton,
        shieldButton,
        reviewChip,
        chips,
        el("span", { class: "chat-bar-hint" }, "Type ", el("kbd", { text: "@" }), " to reference a note"),
        el("span", { class: "chat-bar-spacer" }),
        modelButton,
        send)));
  /* History sits on the right, like any chat client: the thread you are in
     stays where your eye already is. */
  const history = el("aside", { class: "chat-history", "aria-label": "Chat history" },
    el("div", { class: "chat-history-head" },
      el("span", { class: "chat-history-title", text: "Chats" }),
      iconButton("plus", "New chat", () => startChat(), { size: 15 })),
    historyList,
    el("div", { class: "chat-history-head chat-agents-head" }, el("span", { class: "chat-history-title", text: "Agents" }), iconButton("plus", "New agent", () => openAgentEditor(null, (saved) => startChat(saved.id)), { size: 15 })),
    agentList);
  /* Notion-style quick actions: one row of chips beneath the composer while the page is empty. */
  const actionRow = el("div", { class: "chat-actions-row", role: "group", "aria-label": "Quick actions" }, ACTIONS.map((action) =>
    el("button", {
      class: "chat-action-chip", type: "button",
      onclick: () => { input.value = action.prompt; grow(); syncSend(); if (action.prompt.endsWith(": ")) { input.focus(); input.setSelectionRange(input.value.length, input.value.length); } else ask(); },
    }, icon(action.icon, 15), action.label)));
  /* The header, as Notion's AI panel has it: the chat's name with a switcher for other chats and agents, then new chat,
     export and the more menu. */
  const headTitle = el("button", { class: "chat-head-title", type: "button", "aria-haspopup": "menu", "aria-label": "Switch chat or agent" });
  const currentChat = () => chats.find((chat) => chat.id === chatId) || null;
  const paintHead = () => {
    clear(headTitle);
    const agent = agentId ? getAgent(agentId) : null;
    const title = currentChat()?.title || agent?.name || "New AI chat";
    append(headTitle, ...[agent?.emoji ? el("span", { class: "chat-head-emoji", text: agent.emoji }) : compact ? bloub(18) : null, el("span", { class: "chat-head-name", text: title }), icon("chevron_down", 12)].filter(Boolean));
    pinButton.classList.toggle("on", Boolean(chatId) && isPinned(chatId));
  };
  const transcript = () => messages.filter((m) => m.text && !m.error).map((m) => `${m.role === "user" ? "You" : "Clyra"}: ${m.text}`).join("\n\n");
  const markdownFile = () => `# ${currentChat()?.title || "Chat with Clyra"}\n\n${messages.filter((m) => m.text && !m.error).map((m) => (m.role === "user" ? `**You**\n\n${m.text}` : `**Clyra**\n\n${m.text}`)).join("\n\n---\n\n")}\n`;
  const renameChatPrompt = (target) => {
    const chat = target && target.id ? target : currentChat();
    if (!chat) { toast("Send a message first"); return; }
    const input_ = el("input", { class: "extras-input", value: chat.title || "", "aria-label": "Chat name" });
    const save = el("button", { class: "button primary", type: "button" }, "Rename");
    const cancel = el("button", { class: "button", type: "button" }, "Cancel");
    const entry = modal({ title: "Rename chat", width: 420, body: el("div", { class: "extras-body" }, input_), footer: [cancel, save] });
    cancel.addEventListener("click", () => entry.close("cancel"));
    const commit = async () => { const value = input_.value.trim(); if (!value) return; entry.close("save"); chat.title = value; await withError(() => api.patch(`/api/notes/chats/${chat.id}`, { title: value }), "Could not rename"); loadChats(); };
    save.addEventListener("click", commit);
    input_.addEventListener("keydown", (event) => { if (event.key === "Enter") { event.preventDefault(); commit(); } });
    input_.select();
  };
  headTitle.addEventListener("click", () => {
    const agents = listAgents();
    menu(headTitle, [
      { type: "label", label: "Chats" },
      ...(chats.length ? chats.slice(0, 8).map((chat) => ({ label: chat.title || "New chat", icon: "comment", checked: chat.id === chatId, hint: formatRelative(chat.updated_at), onSelect: () => openChat(chat.id) })) : [{ label: "No chats yet", disabled: true }]),
      { type: "separator" },
      { type: "label", label: "Agents" },
      ...agents.map((agent) => ({ label: agent.name, icon: agent.emoji || "sparkle", checked: agent.id === agentId, onSelect: () => startChat(agent.id) })),
      { label: "New agent\u2026", icon: "plus", onSelect: () => openAgentEditor(null, (saved) => startChat(saved.id)) },
    ], { class: "chat-switch-menu" });
  });
  const exportButton = iconButton("export", "Export chat", () => menu(exportButton, [
    { label: "Copy as text", icon: "duplicate", onSelect: () => { if (!messages.length) { toast("Nothing to copy yet"); return; } navigator.clipboard.writeText(transcript()); toast("Chat copied"); } },
    { label: "Download as Markdown", icon: "export", onSelect: () => {
      if (!messages.length) { toast("Nothing to export yet"); return; }
      const url = URL.createObjectURL(new Blob([markdownFile()], { type: "text/markdown" }));
      const link = el("a", { href: url, download: `${(currentChat()?.title || "chat").replace(/[^\w -]+/g, "").trim() || "chat"}.md` });
      document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    } },
  ], { align: "end" }), { size: 15 });
  const moreButton = iconButton("dots", "More", () => {
    const chat = currentChat();
    const agent = agentId ? getAgent(agentId) : null;
    menu(moreButton, [
      { label: "Rename", icon: "pencil", disabled: !chat, onSelect: renameChatPrompt },
      { label: "Personalize", icon: "sparkle", onSelect: () => openPersonalize() },
      agent ? { label: `Edit ${agent.name}`, icon: "pencil", onSelect: () => openAgentEditor(agent, () => paintHead()) } : null,
      agent ? { label: `Delete ${agent.name}`, icon: "trash", danger: true, onSelect: async () => { if (await confirmDialog({ title: "Delete agent", message: `"${agent.name}" is removed from this device. Chats made with it stay.`, confirmLabel: "Delete agent" })) { deleteAgent(agent.id); agentId = null; paintHead(); paintHistory(); } } } : null,
      { type: "separator" },
      { label: "Delete chat", icon: "trash", danger: true, disabled: !chat, onSelect: () => chat && removeChat(chat) },
      chat ? { type: "separator" } : null,
      chat ? { label: `Last updated ${formatRelative(chat.updated_at)}`, disabled: true } : null,
    ].filter(Boolean), { align: "end" });
  }, { size: 15 });
  const pinButton = iconButton("pin", "Pin chat", () => { if (!chatId) { toast("Send a message first"); return; } togglePin(chatId); paintHead(); publishChats(); }, { size: 15, className: "chat-pin" });
  const panelHead = el("div", { class: "chat-panel-head" },
    compact ? null : el("span", { class: "chat-head-crumb" }, el("span", { class: "chat-head-mark" }, bloub(16)), el("span", { class: "chat-head-brand", text: "Clyra" }), el("span", { class: "chat-head-sep", text: "/" })),
    headTitle,
    el("span", { class: "chat-head-spacer" }),
    iconButton("plus", "New chat", () => startChat(), { size: 15 }),
    exportButton,
    pinButton,
    moreButton);
  const chatView = el("div", { class: "chat-view" }, panelHead, thread, composer, compact ? null : actionRow);
  historyOpen = false;
  const layout = el("div", { class: `chat-layout history-hidden${compact ? " compact" : ""}` },
    chatView,
    compact ? null : history);
  host.append(layout);

  const toggleHistory = () => {
    if (compact) return;
    historyOpen = !historyOpen;
    layout.classList.toggle("history-hidden", !historyOpen);
    localStorage.setItem("clyra-notes:chat-history", historyOpen ? "1" : "0");
  };

  /* The workspace sidebar shows the chat list in the full view, as Notion's does; this hands it the list and what is open. */
  const publishChats = () => {
    if (compact) return;
    state.chatList = chats; state.activeChatId = chatId;
    window.dispatchEvent(new CustomEvent("clyra:chats-changed"));
  };
  const loadChats = async () => {
    chats = (await withError(() => api.get("/api/notes/chats"), "Could not load your chats")) || [];
    paintHistory();
    paintHead();
    publishChats();
  };

  const paintAgents = () => {
    clear(agentList);
    const agents = listAgents();
    if (!agents.length) agentList.append(el("div", { class: "chat-history-empty", text: "Agents are chats with their own instructions." }));
    for (const agent of agents) {
      agentList.append(el("button", { class: `chat-agent-row${agent.id === agentId ? " active" : ""}`, type: "button", onclick: () => startChat(agent.id) },
        el("span", { class: "chat-agent-emoji", text: agent.emoji || "\u2728" }), el("span", { class: "chat-agent-name", text: agent.name })));
    }
  };

  const paintHistory = () => {
    paintAgents();
    if (compact) return;
    clear(historyList);
    if (!chats.length) {
      historyList.append(el("div", { class: "chat-history-empty", text: "No chats yet." }));
      return;
    }
    for (const chat of chats) {
      const row = el("div", { class: `chat-history-row${chat.id === chatId ? " active" : ""}` },
        el("button", { class: "chat-history-open", type: "button", onclick: () => openChat(chat.id) },
          el("span", { class: "chat-history-name", text: chat.title || "New chat" }),
          el("span", { class: "chat-history-meta", text: formatRelative(chat.updated_at) })),
        iconButton("dots", "Chat actions", (event) => {
          event.stopPropagation();
          menu(event.currentTarget, [
            { label: "Rename", icon: "pencil", onSelect: () => renameChat(chat) },
            { label: "Delete", icon: "trash", danger: true, onSelect: () => removeChat(chat) },
          ], { align: "end" });
        }));
      historyList.append(row);
    }
  };

  const renameChat = (chat) => {
    const row = [...historyList.querySelectorAll(".chat-history-row")].find((node) =>
      node.querySelector(".chat-history-name")?.textContent === (chat.title || "New chat"));
    const name = row?.querySelector(".chat-history-name");
    if (!name) return;
    const input = el("input", {
      class: "chat-history-rename", value: chat.title || "", "aria-label": "Chat name",
      onclick: (event) => event.stopPropagation(),
    });
    name.replaceWith(input);
    input.focus();
    input.select();
    let settled = false;
    const finish = async (commit) => {
      if (settled) return;
      settled = true;
      const value = input.value.trim();
      input.replaceWith(name);
      if (!commit || !value || value === chat.title) return;
      chat.title = value;
      name.textContent = value;
      await withError(() => api.patch(`/api/notes/chats/${chat.id}`, { title: value }), "Could not rename");
      loadChats();
    };
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") { event.preventDefault(); finish(true); }
      if (event.key === "Escape") { event.preventDefault(); finish(false); }
    });
    input.addEventListener("blur", () => finish(true));
  };

  const removeChat = async (chat) => {
    const ok = await confirmDialog({
      title: "Delete chat",
      message: `"${chat.title || "New chat"}" is removed. The notes it referenced are untouched.`,
      confirmLabel: "Delete chat",
    });
    if (!ok) return;
    await withError(() => api.del(`/api/notes/chats/${chat.id}`), "Could not delete that chat");
    if (chat.id === chatId) { chatId = null; messages = []; paint(); }
    loadChats();
  };

  const openChat = async (id) => {
    const chat = await withError(() => api.get(`/api/notes/chats/${id}`), "Could not open that chat");
    if (!chat) return;
    chatId = id;
    agentId = null;
    messages = (chat.messages || []).map((row) => ({
      role: row.role,
      text: row.text,
      question: row.role === "assistant" ? null : row.text,
      sources: row.sources || [],
      citations: row.citations || [],
      searched: row.searched || null,
      restored: true,
    }));
    /* A reopened thread should not replay its reveal animations. */
    paint();
    paintHistory();
    paintHead();
    publishChats();
  };

  const startChat = (withAgent = null) => {
    chatId = null;
    agentId = typeof withAgent === "string" ? withAgent : null;
    paintHead();
    publishChats();
    messages = [];
    sources = [];
    paintSources();
    if (compact && autoPageOn()) queueMicrotask(() => app.reattachChatContext?.());
    paint();
    paintHistory();
    input.focus();
  };

  /* The thread is only persisted once it has something in it, so opening the
     page does not litter the history with empty chats. */
  const ensureChat = async () => {
    if (chatId) return chatId;
    const created = await withError(() => api.post("/api/notes/chats"), "Could not start a chat");
    chatId = created?.id ?? null;
    return chatId;
  };

  const remember = async (message) => {
    if (!chatId) return;
    await api.post(`/api/notes/chats/${chatId}/messages`, {
      role: message.role,
      text: message.text ?? "",
      sources: message.sources || [],
      citations: message.citations || [],
      searched: message.searched || null,
    }).catch(() => {});
  };

  const syncSend = () => { send.disabled = busy || !input.value.trim(); composer.classList.toggle("has-text", Boolean(input.value.trim())); };
  const grow = () => { input.style.height = "auto"; input.style.height = `${Math.min(140, input.scrollHeight)}px`; };
  input.addEventListener("input", () => {
    grow();
    syncSend();
    if (input.value.endsWith("@")) { input.value = input.value.slice(0, -1); addSource(); }
  });
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); ask(); }
  });
  send.addEventListener("click", () => ask());

  const onNewChat = () => startChat();
  window.addEventListener("clyra:new-chat", onNewChat);
  const onSidebar = (event) => {
    if (compact) return;
    const { type, id } = event.detail || {};
    if (type === "open") openChat(id);
    else if (type === "agent") startChat(id);
    else if (type === "new-agent") openAgentEditor(null, (saved) => startChat(saved.id));
    else if (type === "rename") { const chat = chats.find((entry) => entry.id === id); if (chat) renameChatPrompt(chat); }
    else if (type === "delete") { const chat = chats.find((entry) => entry.id === id); if (chat) removeChat(chat); }
  };
  window.addEventListener("clyra:chat-action", onSidebar);
  /* Text selected in a page: "Add to chat" attaches it as context; "Ask Clyra" attaches it and starts the question. */
  const onQuote = (event) => {
    const { text, mode } = event.detail || {};
    if (!text?.trim()) return;
    const quote = text.trim().replace(/\s+/g, " ").slice(0, 1500);
    if (!quotes.includes(quote)) quotes.push(quote);
    paintSources();
    if (mode === "ask" && !input.value.trim()) { input.value = "Explain this: "; grow(); syncSend(); }
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  };
  window.addEventListener("clyra:notes-quote", onQuote);

  const addSource = () => openSearch({
    title: "Add context",
    onSelect: (page) => {
      const id = String(page.page_id || page.id);
      if (sources.some((source) => source.pageId === id)) return;
      sources.push({ pageId: id, title: page.title || "New page", manual: true });
      paintSources();
      input.focus();
    },
  });

  const paintSources = () => {
    clear(chips);
    for (const quote of quotes) {
      chips.append(el("span", { class: "chat-chip chat-chip-quote", title: quote }, icon("comment", 13), `\u201C${quote.slice(0, 38)}${quote.length > 38 ? "\u2026" : ""}\u201D`,
        el("button", {
          class: "chat-chip-remove", type: "button", "aria-label": "Remove selection",
          onclick: () => { quotes = quotes.filter((candidate) => candidate !== quote); paintSources(); },
        }, icon("close", 10))));
    }
    for (const source of sources) {
      chips.append(el("span", { class: "chat-chip" },
        icon("page", 13), source.title,
        el("button", {
          class: "chat-chip-remove", type: "button", "aria-label": `Remove ${source.title}`,
          onclick: () => { sources = sources.filter((candidate) => candidate !== source); paintSources(); },
        }, icon("close", 10))));
    }
  };

  /* The reply arrives a line at a time under a travelling gradient, which is
     the launcher's reveal rather than a cursor blinking at the end. */
  const revealAnswer = (host_, markdown, animate = true) => {
    host_.innerHTML = renderMarkdown(markdown);
    if (!animate) return;
    [...host_.children].forEach((node, index) => {
      node.classList.add("chat-stream-line");
      node.style.animationDelay = `${Math.min(index, 14) * 55}ms`;
    });
  };

  const workRow = (label, kind) =>
    el("div", { class: `chat-work ${kind}` },
      el("span", { class: "chat-work-mark" }, kind === "search" ? icon("search", 13) : bloub(18)),
      el("span", { class: "chat-work-label shimmer-text", text: label }));

  /* A set of steps stacks with a tick landing on each as it completes. */
  const actionList = (steps, activeIndex) =>
    el("ol", { class: "chat-actions-list" }, steps.map((step, index) =>
      el("li", { class: `chat-action${index < activeIndex ? " done" : index === activeIndex ? " current" : ""}` },
        el("span", { class: "chat-action-tick" }, icon("check_square", 12)),
        el("span", { class: index === activeIndex ? "shimmer-text" : "", text: step }))));

  const paint = () => {
    const wasLanding = chatView.classList.contains("landing");
    const composerBefore = wasLanding ? composer.getBoundingClientRect() : null;
    const viewBefore = wasLanding ? chatView.getBoundingClientRect() : null;
    const ghost = wasLanding ? thread.querySelector(".chat-intro")?.cloneNode(true) : null;
    const ghostRect = ghost ? thread.querySelector(".chat-intro").getBoundingClientRect() : null;
    clear(thread);
    /* an empty chat is a landing: the heading and the composer sit together in the middle, as in Notion */
    chatView.classList.toggle("landing", Boolean(state.aiConfigured) && !messages.length && !compact);
    actionRow.hidden = !chatView.classList.contains("landing");
    if (!state.aiConfigured) {
      thread.append(el("div", { class: "chat-column chat-intro" },
        el("h1", { class: "chat-title", text: "AI is not configured" }),
        el("p", { class: "chat-lead", text: "Add DEEPSEEK_API_KEY to .env.local and restart the server to use chat, generation and grading." })));
      composer.hidden = true;
      return;
    }
    if (!messages.length) {
      thread.append(el("div", { class: "chat-column chat-intro" },
        el("span", { class: "chat-intro-mark" }, bloub(34)),
        el("h1", { class: "chat-title", text: "How can I help you today?" }),
        compact ? el("p", { class: "chat-lead" },
          el("span", { text: "Type " }),
          el("kbd", { class: "chat-lead-key", text: "@" }),
          el("span", { text: " to reference one note or several, so answers stay grounded in your own material." })) : null,
        compact ? el("div", { class: "chat-suggest-list", role: "group", "aria-label": "Suggestions" }, PAGE_TASKS.map((task) =>
          el("button", { class: "chat-suggest-row", type: "button", onclick: () => { input.value = task.prompt; grow(); syncSend(); ask(); } }, icon(task.icon, 16), el("span", { text: task.label })))) : null));
      return;
    }
    thread.append(el("div", { class: "chat-stamp", text: `${agentId && getAgent(agentId) ? getAgent(agentId).name : "Clyra"} \u00B7 ${clock(messages[0].at || Date.now())}` }));
    for (const message of messages) {
      if (message.role === "user") {
        /* What a question was grounded in belongs with the question. Listing
           the pages under the bubble means scrolling back through a thread
           still tells you which notes each answer was read from. */
        thread.append(el("div", { class: "chat-column chat-row user" },
          message.sources?.length
            ? el("div", { class: "chat-ctx-chips" }, message.sources.map((source) =>
                el("button", {
                  class: "chat-ctx-chip", type: "button", title: source.title || "Note",
                  onclick: () => source.pageId && app.openPage(source.pageId),
                }, icon("page", 13), el("span", { text: source.title || "Note" }))))
            : null,
          el("div", { class: "chat-bubble", text: message.text })));
        continue;
      }
      const body = el("div", { class: "chat-answer" });
      const wrapper = el("div", { class: "chat-assistant" },
        el("div", { class: "chat-assistant-body" }, body));

      if (message.error) {
        append(body, el("div", { class: "ai-error", text: message.error }),
          el("button", { class: "ai-action", type: "button", onclick: () => ask(message) }, "Retry"));
      } else if (message.pending) {
        /* What is shown is what is happening: the plan and each tool call as it runs, then the answer as it streams. */
        message.runState = message.runState || {};
        append(body,
          renderAgentRun(message.run, { live: true, onOpenNote: (id) => app.openPage(id), state: message.runState }),
          message.text ? el("div", { class: "chat-stream", html: renderMarkdown(message.text) }) : null,
          !message.run?.todos.length && !message.run?.steps.length && !message.text ? workRow("Thinking", "think") : null);
      } else {
        if (message.run) {
          message.runState = message.runState || {};
          const view = renderAgentRun(message.run, { live: false, onOpenNote: (id) => app.openPage(id), state: message.runState });
          if (view) body.append(view);
        }
        const answerHost = el("div", { class: "chat-answer-text" });
        body.append(answerHost);
        revealAnswer(answerHost, message.text, !message.restored);
        if (message.searched) {
          body.append(el("div", { class: "ai-searched" }, icon("search", 12), `Searched the web for "${message.searched}"`));
        }
        const feedback = (value) => { message.feedback = message.feedback === value ? null : value; if (message.feedback) toast(value === "up" ? "Glad that helped" : "Thanks, noted"); paint(); };
        const tool = (name, label, onClick, on = false) => {
          const button = iconButton(name, label, onClick, { size: 15, className: `chat-tool${on ? " on" : ""}` });
          return button;
        };
        body.append(el("div", { class: "chat-actions", role: "group", "aria-label": "Reply actions" },
          tool("duplicate", "Copy", () => { navigator.clipboard.writeText(message.text); toast("Copied"); }),
          tool("plus", "Insert into page", () => insertIntoPage(message)),
          tool("page", "Create page", () => createPageFrom(message)),
          tool("thumb_up", "Good answer", () => feedback("up"), message.feedback === "up"),
          tool("thumb_down", "Not helpful", () => feedback("down"), message.feedback === "down"),
          tool("refresh", "Try again", () => ask(message))));
        if (message.sources?.length) {
          body.append(el("div", { class: "chat-refs" }, message.sources.map((source) =>
            el("button", { class: "chat-ref", type: "button", onclick: () => source.pageId && app.openPage(source.pageId) },
              icon(source.url ? "search" : "page", 13), source.title))));
        }
        body.addEventListener("click", (event) => {
          const cite = event.target.closest(".cite");
          if (!cite) return;
          const citation = (message.citations || []).find((entry) => String(entry.index) === cite.dataset.index);
          if (citation?.pageId) app.openPage(citation.pageId, { blockId: citation.blockId });
        });
        if (message.citations?.length) answerHost.innerHTML = linkCitations(answerHost.innerHTML, message.citations);
      }
      thread.append(el("div", { class: "chat-column chat-row assistant" }, wrapper));
    }
    thread.scrollTop = thread.scrollHeight;
    /* Entering the chat: the welcome lifts away and the composer glides down to the foot of the page. */
    if (wasLanding && messages.length && !compact && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
      const after = composer.getBoundingClientRect();
      const dy = composerBefore.top - after.top;
      if (Math.abs(dy) > 4) composer.animate([{ transform: `translateY(${dy}px)` }, { transform: "none" }], { duration: 460, easing: "cubic-bezier(0.22, 1, 0.36, 1)" });
      if (ghost) {
        Object.assign(ghost.style, { position: "absolute", left: `${ghostRect.left - viewBefore.left}px`, top: `${ghostRect.top - viewBefore.top}px`, width: `${ghostRect.width}px`, margin: "0", pointerEvents: "none" });
        chatView.append(ghost);
        ghost.animate([{ opacity: 1, transform: "none" }, { opacity: 0, transform: "translateY(-14px)" }], { duration: 240, easing: "ease-out", fill: "forwards" }).onfinish = () => ghost.remove();
      }
    }
  };

  const ask = async (retryOf) => {
    if (busy) return;
    const question = retryOf?.question ?? input.value.trim();
    if (!question) return;
    const attachedNow = sources.map((source) => ({ pageId: source.pageId, title: source.title }));
    if (!retryOf) { messages.push({ role: "user", text: question, sources: attachedNow, at: Date.now() }); input.value = ""; grow(); }
    await ensureChat();
    if (!retryOf) await remember({ role: "user", text: question, sources: attachedNow });
    const answer = retryOf || { role: "assistant", question, sources: [...sources] };
    if (!retryOf) messages.push(answer);
    Object.assign(answer, { pending: true, error: null, steps: null, searching: null, stepIndex: 0 });
    busy = true;
    syncSend();
    paint();

    const controller = new AbortController();
    askAbort = controller;
    answer.run = { todos: [], steps: [] };
    answer.text = "";
    let roundText = "";
    let finished = false;
    const history = messages
      .filter((m) => m !== answer && (m.role === "user" || (m.role === "assistant" && m.text && !m.error)))
      .slice(-12)
      .map((m) => ({ role: m.role, content: String(m.text).slice(0, 6000) }));
    /* A retry re-sends the same question without duplicating it. */
    const last = history[history.length - 1];
    const quoted = quotes.length ? `\n\nSelected text from the page:\n${quotes.map((q) => `> ${q}`).join("\n")}` : "";
    if (!(last && last.role === "user" && last.content === question)) history.push({ role: "user", content: question + quoted });
    else if (quoted) last.content = question + quoted;
    quotes = [];
    paintSources();
    const pageIds = [...new Set([...sources.map((source) => source.pageId), ...(app.currentPageId?.() ? [String(app.currentPageId())] : [])])];
    try {
      await streamAgent({
        messages: history,
        model: MODELS.find((m) => m.id === modelId)?.model,
        instructions: [instructionsFor(agentId), reviewMode ? REVIEW_NOTE : ""].filter(Boolean).join("\n\n"),
        notes: { pageIds, currentPageId: app.currentPageId?.() ? String(app.currentPageId()) : null },
        signal: controller.signal,
        onEvent: (event) => {
          if (event.type === "todos") answer.run.todos = event.items;
          else if (event.type === "step") {
            roundText = ""; answer.text = ""; // words before a tool call were commentary on that step
            const index = answer.run.steps.findIndex((step) => step.id === event.id);
            if (index >= 0) answer.run.steps[index] = event; else answer.run.steps.push(event);
          } else if (event.type === "text") { roundText += event.text; answer.text = roundText; }
          else if (event.type === "done") {
            finished = true;
            answer.pending = false;
            answer.text = event.text;
            answer.sources = (event.citations || []).map((c) => ({ pageId: "", title: c.title || c.host, url: c.url }));
            answer.citations = [];
            answer.searched = answer.run.steps.find((step) => step.tool === "web_search")?.query || null;
          } else if (event.type === "error") {
            finished = true;
            answer.pending = false;
            answer.error = event.code === "credits" ? "Clyra's model account is out of credits. Add credits, then press Retry." : event.code === "cancelled" ? "Stopped." : event.message || "Clyra couldn't finish this reply.";
          }
          paint();
        },
      });
      if (!finished) { answer.pending = false; if (!answer.text) answer.error = "Clyra couldn't finish this reply."; }
      if (!answer.error) {
        await remember({ role: "assistant", text: answer.text, sources: answer.sources, citations: [], searched: answer.searched });
        loadChats();
        refreshPages?.();
      }
    } catch (error) {
      answer.pending = false;
      answer.error = controller.signal.aborted ? "Stopped." : error.message;
    } finally {
      askAbort = null;
      busy = false;
      syncSend();
      paint();
    }
  };

  const insertIntoPage = (message) => openSearch({
    title: "Insert into page",
    onSelect: async (page) => {
      const id = String(page.page_id || page.id);
      const loaded = await withError(() => api.get(`/api/notes/pages/${id}`), "Could not open that page");
      if (!loaded) return;
      const { parseMarkdownBlocks, makeBlock } = await import("../editor.js");
      const blocks = parseMarkdownBlocks(message.text).map((draft) => ({ ...makeBlock(draft.type, draft.text, draft.props), children: [] }));
      await withError(() => api.put(`/api/notes/pages/${id}/blocks`, { blocks: [...loaded.blocks, ...blocks] }), "Could not insert");
      toast(`Added to ${page.title || "the page"}`);
    },
  });

  /* "Create page" runs the answer back through the document harness rather
     than dumping the reply's markdown into a page: the same words, but laid
     out as a document — callouts, tables, toggles, a summary — instead of a
     transcript of a chat message. */
  const createPageFrom = async (message) => {
    toast("Building the page\u2026");
    const built = await withError(
      () => api.post("/api/notes/ai/document", {
        instruction: `Turn this answer into a well-structured page. The reader asked: "${message.question}".\n\nThe answer to lay out:\n${message.text}`,
        sources: (message.sources || []).filter((source) => source.pageId).map((source) => ({ pageId: source.pageId })),
        title: message.question.slice(0, 80),
      }),
      "Could not create the page",
    );
    if (!built?.page) return;
    await refreshPages();
    app.openPage(built.page.id);
    toast("Page created");
  };

  paint();
  loadChats();
  if (!compact) api.post("/api/notes/chats/prune", {}).catch(() => {});
  queueMicrotask(() => { if (!compact) input.focus(); });
  return {
    toggleHistory,
    focus: () => input.focus(),
    /* The rail replaces the attached set whenever the page changes; the
       reader's own additions are kept, so pointing at another note does not
       silently drop the one they attached by hand. */
    setSources(next) {
      const manual = sources.filter((source) => source.manual);
      const seen = new Set();
      sources = [...next, ...manual].filter((source) =>
        source.pageId && !seen.has(source.pageId) && seen.add(source.pageId));
      paintSources();
    },
    destroy() { window.removeEventListener("clyra:chat-action", onSidebar); window.removeEventListener("clyra:new-chat", onNewChat); window.removeEventListener("clyra:notes-quote", onQuote); },
  };
}

/* Turns the model's [S12] markers into controls that open the exact block
   they came from, and drops any marker with no matching citation. */
function linkCitations(html, citations) {
  const known = new Set(citations.map((entry) => String(entry.index)));
  return html.replace(/\[S(\d+)\]/g, (match, index) =>
    known.has(index) ? `<button class="cite" type="button" data-index="${index}" title="Show source">${index}</button>` : "");
}
