/* Workspace AI chat.

   The surface deliberately mirrors Clyra's launcher chat: the same one-line
   composer with a circular send action, the same user bubble, the same
   gradient reveal on the assistant's reply, and the same shimmer-with-mark
   treatment for work in progress. Answers stay grounded in the pages the
   student attaches with @. */
import { el, clear, icon, iconButton, bloub, toast, append, menu, modal, confirmDialog } from "../dom.js";
import { api } from "../api.js";
import { state, withError, refreshPages, activeTab } from "../state.js";
import { formatRelative } from "../app.js";
import { renderMarkdown } from "../ai-composer.js";
import { openSearch } from "../search.js";
import { streamAgent, renderAgentRun } from "../agent-run.js";
import { registerEdit, settleEdit, setAiWorking } from "../ai-live.js";
import { openVersions } from "../version-history.js";
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

/* There is one chat. The full-screen view and the sidebar both show this
   same instance: opening one moves it there, so a reply streaming in full
   screen keeps streaming, with the same messages, tool runs and animations,
   when it moves to the sidebar, and the two can never both be open. */
let shared = null;
export function renderChat(host, app, options = {}) {
  const compact = Boolean(options.compact);
  if (shared && shared.builtWithAi !== state.aiConfigured && !shared.isBusy()) { shared.dispose(); shared = null; }
  if (!shared) { shared = buildChat(app, { compact }); shared.builtWithAi = state.aiConfigured; }
  shared.mount(host, compact);
  const me = shared;
  return {
    setPage: (id) => me.setPage(id),
    toggleHistory: () => me.toggleHistory(),
    focus: () => me.focus(),
    setSources: (next) => me.setSources(next),
    isIn: (node) => node.contains(me.root),
    /* Leaving a view takes the chat out of it, nothing more: a running reply carries on. */
    destroy() { if (host.contains(me.root)) me.root.remove(); },
  };
}

/* `compact` is the sidebar's layout of the chat: same thread, same composer,
   no history column. It changes as the chat moves between the two places. */
function buildChat(app, options = {}) {
  let compact = Boolean(options.compact);
  let messages = [];
  let sources = [];
  let busy = false;
  let askAbort = null;
  let quotes = [];
  let files = [];
  let chatId = null;
  let agentId = null;
  let reviewMode = false;
  let chats = [];
  /* The note this thread belongs to. In the side panel that is the page you are on: its chat is saved with it and comes back
     when you return. In the full-screen chat a thread can be attached to a note too, once it has been started from one. */
  let boundId = null;
  let wantedId;
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
    el("span", { class: "chat-stop-icon", "aria-hidden": "true" }),
    el("span", { class: "chat-send-icon", "aria-hidden": "true", html: '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V6M6 12l6-6 6 6"/></svg>' }));

  const modelButton = el("button", { class: "chat-model", type: "button", "aria-haspopup": "menu", "aria-label": "Choose how Clyra answers" });
  const paintModel = () => { clear(modelButton); modelButton.append(el("span", { text: MODELS.find((m) => m.id === modelId).label }), icon("chevron_down", 11)); };
  paintModel();
  modelButton.addEventListener("click", () => menu(modelButton, [
    ...MODELS.map((m) => ({ label: m.label, hint: m.hint, checked: m.id === modelId, class: "model-row", onSelect: () => { modelId = m.id; try { localStorage.setItem(MODEL_KEY, m.id); } catch { /* storage off */ } paintModel(); } })),
  ], { class: "model-menu", side: "top", align: "end" }));
  const plusButton = iconButton("plus", "Add context", () => menu(plusButton, [
    { label: "Add photos & files", icon: "file", hint: "Text, Markdown, CSV, code", onSelect: () => pickFiles() },
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
  /* Under the chips, three things worth asking right now, drawn from the
     workspace itself: the note you last touched, and what is due. */
  const suggested = el("div", { class: "chat-suggested", role: "group", "aria-label": "Suggested" });
  const paintSuggested = () => {
    clear(suggested);
    const latest = [...state.pages].filter((page) => page.kind !== "record" && page.title).sort((a, b) => String(b.updated_at || "").localeCompare(String(a.updated_at || "")))[0];
    const rows = [];
    if (latest) {
      rows.push(["text", `Summarise “${latest.title}”`, `Summarise my note “${latest.title}” into the key points and open questions.`]);
      rows.push(["cards", `Turn “${latest.title}” into flashcards`, `Read my note “${latest.title}”, then create a flashcard deck from it.`]);
    }
    rows.push(["target", state.study?.due ? `Plan my ${state.study.due} due cards` : "Plan a revision week", state.study?.due ? "I have flashcards due. Make me a short plan to get through them today." : "Plan a realistic revision week from my notes and put it in a new note."]);
    rows.slice(0, 3).forEach(([glyph, label, prompt]) => suggested.append(el("button", { class: "chat-suggested-row", type: "button", onclick: () => { input.value = prompt; grow(); syncSend(); ask(); } }, icon(glyph, 15), el("span", { text: label }), icon("chevron_right", 12))));
  };
  actionRow.append(suggested);
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
    paintAttached();
  };
  const pageInfo = (id) => { const meta = id ? state.pageById?.get(String(id)) : null; return meta ? { id: String(id), title: meta.title || "Untitled", icon: meta.icon } : null; };
  /* Which note this chat is attached to, always visible: the note, or all of them. */
  const paintAttached = () => {
    clear(attached);
    const chat = currentChat();
    const id = compact ? boundId : (boundId || chat?.page_id || null);
    const info = pageInfo(id) || (id && chat ? { id, title: chat.page_title || "Untitled", icon: chat.page_icon } : null);
    attached.classList.toggle("on", Boolean(info));
    if (info) {
      const glyph = info.icon && !/^https?:|^\//.test(info.icon) ? el("span", { class: "chat-attached-emoji", text: info.icon }) : icon("page", 14);
      attached.append(el("button", { class: "chat-attached-link", type: "button", title: "Open this note", onclick: () => app.openPage(info.id) }, glyph,
        el("span", { class: "chat-attached-text" }, el("span", { class: "chat-attached-label", text: compact ? "Chatting about" : "Attached to" }), el("b", { text: info.title })),
        icon("chevron_right", 12)),
        el("span", { class: "chat-attached-hint", text: "Saved with this note · reads all your notes" }));
    } else {
      attached.append(el("span", { class: "chat-attached-all" }, icon("book", 14), el("span", { text: "Reads across all your notes" })));
    }
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
  /* Full screen and the sidebar swap places with one click; the conversation goes with it. */
  const modeButton = iconButton("expand", "Open full screen", () => { if (compact) app.openView({ kind: "chat" }); else app.openChatSidebar?.(); }, { size: 15, className: "chat-mode" });
  const paintMode = () => {
    const label = compact ? "Open full screen" : "Move to the sidebar";
    modeButton.setAttribute("aria-label", label);
    modeButton.title = label;
    modeButton.replaceChildren(icon(compact ? "expand" : "panel", 15));
  };
  const panelHead = el("div", { class: "chat-panel-head" },
    el("span", { class: "chat-head-crumb" }, el("span", { class: "chat-head-mark" }, bloub(16)), el("span", { class: "chat-head-brand", text: "Clyra" }), el("span", { class: "chat-head-sep", text: "/" })),
    headTitle,
    el("span", { class: "chat-head-spacer" }),
    modeButton,
    iconButton("plus", "New chat", () => startChat(), { size: 15 }),
    exportButton,
    pinButton,
    moreButton);
  const attached = el("div", { class: "chat-attached" });
  const chatView = el("div", { class: "chat-view" }, panelHead, attached, thread, composer, actionRow);
  historyOpen = false;
  const layout = el("div", { class: `chat-layout history-hidden${compact ? " compact" : ""}` },
    chatView,
    history);

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
    chats = (await withError(() => api.get(compact && boundId ? `/api/notes/chats?pageId=${encodeURIComponent(boundId)}` : "/api/notes/chats"), "Could not load your chats")) || [];
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
          el("span", { class: "chat-history-meta", text: `${chat.page_title ? `${chat.page_title} \u00B7 ` : ""}${formatRelative(chat.updated_at)}` })),
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
    if (!chats.some((entry) => entry.id === id)) chats = [chat, ...chats];
    messages = (chat.messages || []).map((row) => ({
      role: row.role,
      text: row.text,
      question: row.role === "assistant" ? null : row.text,
      sources: row.sources || [],
      citations: row.citations || [],
      searched: row.searched || null,
      restored: true,
      savedId: row.id,
      ...(row.run ? { run: { todos: row.run.todos || [], steps: row.run.steps || [], agents: row.run.agents || [], board: row.run.board || [], phases: row.run.phases || [], elapsedMs: row.run.elapsedMs || 0 }, runState: {}, prelude: row.run.prelude || "", edits: (row.run.edits || []).map((edit) => ({ ...edit, chatId: id })) } : {}),
    }));
    messages.forEach((message) => (message.edits || []).forEach((edit) => { edit.owner = message; }));
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
    const created = await withError(() => api.post("/api/notes/chats", { pageId: boundId || null }), "Could not start a chat");
    chatId = created?.id ?? null;
    return chatId;
  };

  /* What of a reply's run is worth keeping: the plan, every step with its
     actions, the agents, and each proposed change with its outcome. */
  const runRecord = (message) => (message.run || message.edits?.length ? {
    todos: message.run?.todos || [], steps: message.run?.steps || [], agents: message.run?.agents || [], board: message.run?.board || [], phases: message.run?.phases || [], elapsedMs: message.run?.elapsedMs || 0,
    prelude: message.prelude || "",
    edits: (message.edits || []).map(({ id, pageId, title, kind, markdown, position, afterText, find, replace, status, messageId }) => ({ id, pageId, title, kind, markdown, position, afterText, find, replace, status: status || "pending", messageId })),
  } : null);
  const remember = async (message) => {
    if (!chatId) return null;
    return api.post(`/api/notes/chats/${chatId}/messages`, {
      role: message.role,
      text: message.text ?? "",
      sources: message.sources || [],
      citations: message.citations || [],
      searched: message.searched || null,
      run: runRecord(message),
    }).catch(() => null);
  };
  /* Accepting or dismissing a change later is kept with the reply it came from. */
  const persistRun = (message) => {
    const record = message && runRecord(message);
    if (!record || !message.savedId || !(message.chatId || chatId)) return;
    api.patch(`/api/notes/chats/${message.chatId || chatId}/messages/${message.savedId}`, { run: record }).catch(() => {});
  };

  /* While a reply runs the send button is a Stop button. */
  const syncSend = () => {
    send.disabled = !busy && !input.value.trim();
    send.classList.toggle("is-stop", busy);
    send.setAttribute("aria-label", busy ? "Stop" : "Send message");
    send.title = busy ? "Stop (Esc)" : "";
    composer.classList.toggle("has-text", Boolean(input.value.trim()));
  };
  const grow = () => { input.style.height = "auto"; input.style.height = `${Math.min(140, input.scrollHeight)}px`; };
  const addMention = (page) => {
    const id = String(page.page_id || page.id);
    if (sources.some((source) => source.pageId === id)) return;
    sources.push({ pageId: id, title: page.title || "New page", manual: true });
    paintSources();
    input.focus();
  };
  /* @ is a quick local picker, not a second full-screen search flow. It is
     deliberately short, anchored to the composer, and keeps the question in
     place while someone adds one or two notes as context. */
  const openMentionMenu = () => {
    const candidates = state.pages.filter((page) => page.kind !== "record").slice(0, 9);
    menu(input, candidates.length ? candidates.map((page) => ({
      label: page.title || "Untitled note", icon: page.icon && !/^https?:|^\//.test(page.icon) ? page.icon : "page",
      hint: page.parent_id ? "Subpage" : "Note", onSelect: () => addMention(page),
    })) : [{ label: "No notes yet", disabled: true }], { side: "top", align: "start", class: "chat-mention-menu" });
  };
  input.addEventListener("input", () => {
    grow();
    syncSend();
    if (input.value.endsWith("@")) { input.value = input.value.slice(0, -1); grow(); syncSend(); openMentionMenu(); }
  });
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); ask(); }
  });
  send.addEventListener("click", () => { if (busy) askAbort?.abort(); else ask(); });
  input.addEventListener("keydown", (event) => { if (event.key === "Escape" && busy) { event.preventDefault(); askAbort?.abort(); } });

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
  /* A command-palette query opens the full chat deliberately.  The event
     carries the note that was visible before the view changed, so the new
     chat is genuinely attached to that note rather than losing its context. */
  const onPrefill = (event) => {
    if (compact) return;
    const { prompt = "", pageId = null, sendNow = false } = event.detail || {};
    boundId = pageId ? String(pageId) : null;
    if (prompt) { input.value = prompt; grow(); syncSend(); }
    paintAttached();
    if (sendNow && prompt) queueMicrotask(() => ask());
    else input.focus();
  };
  window.addEventListener("clyra:prefill-chat", onPrefill);
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

  /* Files are read in the browser and sent as context; only text-like files can be read by the model. */
  const pickFiles = () => {
    const input_ = el("input", { type: "file", multiple: "true", accept: ".txt,.md,.markdown,.csv,.tsv,.json,.html,.xml,.yaml,.yml,.js,.ts,.py,.java,.c,.cpp,.go,.rs,.sql,.css,text/*,image/*", style: { display: "none" } });
    input_.addEventListener("change", async () => {
      for (const file of [...input_.files]) {
        if (file.type.startsWith("image/")) { toast("Clyra reads text files. Pictures need a model that can see them."); continue; }
        if (file.size > 300_000) { toast(`${file.name} is too large (limit 300 KB)`); continue; }
        try { files.push({ name: file.name, text: (await file.text()).slice(0, 12_000) }); } catch { toast(`Could not read ${file.name}`); }
      }
      paintSources();
      input.focus();
      input_.remove();
    });
    document.body.append(input_);
    input_.click();
  };

  const addSource = () => openSearch({
    title: "Add context",
    onSelect: (page) => {
      addMention(page);
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
    for (const file of files) {
      chips.append(el("span", { class: "chat-chip chat-chip-file", title: file.name }, icon("file", 13), file.name.length > 26 ? `${file.name.slice(0, 24)}\u2026` : file.name,
        el("button", { class: "chat-chip-remove", type: "button", "aria-label": `Remove ${file.name}`, onclick: () => { files = files.filter((candidate) => candidate !== file); paintSources(); } }, icon("close", 10))));
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

  /* The reply streams into one element that is kept between repaints: text already on screen is never rebuilt, and each new
     block (paragraph, list, heading) settles in once, as in the chat app. */
  const liveText = (message) => {
    const host_ = message.liveEl || (message.liveEl = el("div", { class: "chat-stream chat-live" }));
    if (message.liveFor === message.text) return host_;
    message.liveFor = message.text;
    message.streamedLive = true;
    const next = document.createElement("div");
    next.innerHTML = renderMarkdown(message.text);
    const have = [...host_.children], want = [...next.children];
    want.forEach((node, i) => {
      if (!have[i]) { node.classList.add("chat-live-in"); host_.append(node); }
      else if (have[i].tagName !== node.tagName) have[i].replaceWith(node);
      else if (have[i].innerHTML !== node.innerHTML) have[i].innerHTML = node.innerHTML;
    });
    while (host_.children.length > want.length) host_.lastElementChild.remove();
    return host_;
  };
  /* Network chunks are irregular: rendering each one immediately makes prose
     jump in bursts. A tiny local queue makes every reply read as typing while
     still keeping up with a fast model. */
  const queueText = (message, chunk) => {
    message.targetText = `${message.targetText || message.text || ""}${chunk}`;
    if (message.typingTimer) return;
    const tick = () => {
      const target = message.targetText || "";
      const visible = message.text || "";
      if (visible.length >= target.length) {
        message.typingTimer = 0;
        const waiters = message.typingWaiters || [];
        message.typingWaiters = [];
        waiters.forEach((resolve) => resolve());
        return;
      }
      /* A very short phrase per frame keeps long answers responsive without
         presenting whole paragraphs at once. */
      message.text = target.slice(0, Math.min(target.length, visible.length + 2));
      if (message.liveEl?.isConnected) liveText(message); else paintSoon();
      message.typingTimer = window.setTimeout(tick, 18);
    };
    tick();
  };
  const waitForTyping = (message) => new Promise((resolve) => {
    if (!message.typingTimer && (message.text || "").length >= (message.targetText || "").length) resolve();
    else (message.typingWaiters ||= []).push(resolve);
  });
  let paintQueued = 0;
  const paintSoon = () => { if (paintQueued) return; paintQueued = requestAnimationFrame(() => { paintQueued = 0; paint(); }); };
  /* A tool run can emit several state updates at once. Rendering each one by
     itself used to repeatedly rebuild the surrounding thread. Keep live prose
     immediate, while giving structural updates a calm half-second cadence. */
  let structuralPaintAt = 0;
  let structuralPaintTimer = 0;
  const paintStructural = () => {
    const wait = Math.max(0, 700 - (Date.now() - structuralPaintAt));
    if (structuralPaintTimer) return;
    structuralPaintTimer = window.setTimeout(() => {
      structuralPaintTimer = 0;
      structuralPaintAt = Date.now();
      paint();
    }, wait);
  };

  /* Server-sent events can arrive in one network packet even though the work
     completed one action at a time. Release structural events in a short,
     steady sequence so the checklist, research and note actions feel causal
     rather than suddenly materialising as a completed wall of UI. */
  const actionQueue = [];
  let actionTimer = 0;
  let actionFlushing = false;
  let actionDrain = [];
  const settleActionDrain = () => {
    if (actionQueue.length || actionTimer || actionFlushing) return;
    const waiting = actionDrain; actionDrain = [];
    waiting.forEach((resolve) => resolve());
  };
  /* Agents working together: each has a lane with its own steps, and they share a board. */
  const lane = (answer, id) => {
    answer.run.agents ||= [];
    let found = answer.run.agents.find((agent) => agent.id === id);
    if (!found) { found = { id, name: "Agent", goal: "", state: "running", steps: [], todos: [], summary: "" }; answer.run.agents.push(found); }
    return found;
  };
  const applyActionEvent = (answer, event) => {
    if (event.type === "agent") Object.assign(lane(answer, event.id), { name: event.name, goal: event.goal, state: event.state, summary: event.summary || "" });
    else if (event.type === "board") (answer.run.board ||= []).push({ from: event.from, text: event.text });
    else if (event.type === "phase" && !event.agent) {
      answer.run.phases ||= [];
      if (answer.run.phases[answer.run.phases.length - 1] !== event.phase) answer.run.phases.push(event.phase);
      answer.run.phaseLabel = event.label;
    }
    else if (event.type === "todos" && event.agent) lane(answer, event.agent).todos = event.items;
    else if (event.type === "step" && event.agent) {
      const mine = lane(answer, event.agent);
      const at = mine.steps.findIndex((step) => step.id === event.id);
      if (at >= 0) mine.steps[at] = event; else mine.steps.push(event);
    }
    else if (event.type === "todos") answer.run.todos = event.items;
    else if (event.type === "step") {
      const index = answer.run.steps.findIndex((step) => step.id === event.id);
      if (index >= 0) answer.run.steps[index] = event; else answer.run.steps.push(event);
    } else if (event.type === "edit") {
      answer.edits = answer.edits || [];
      /* A newer proposal for the same place replaces the older one, in the chat and in the note. */
      if (event.edit.supersedes) {
        const old = answer.edits.find((edit) => edit.id === event.edit.supersedes);
        if (old && (!old.status || old.status === "pending")) {
          answer.edits = answer.edits.filter((edit) => edit !== old);
          settleEdit(old.id, "declined");
        }
      }
      const index = answer.edits.findIndex((edit) => edit.id === event.edit.id);
      if (index >= 0) answer.edits[index] = { ...answer.edits[index], ...event.edit };
      else {
        const created = { ...event.edit, status: "pending", messageId: (answer.msgId ||= `msg-${Date.now().toString(36)}`), chatId: chatId || null };
        Object.defineProperty(created, "owner", { value: answer, enumerable: false, writable: true });
        answer.edits.push(created);
        /* The note shows the change the moment it is proposed; accepting or dismissing happens here or on the note. */
        registerEdit(created, { accept: () => applyEdit(created), decline: () => declineEdit(created) });
        markWorking(answer, created.pageId);
      }
    }
    if (event.type === "step" && event.document?.id) markWorking(answer, event.document.id);
    paintStructural();
  };
  const pumpActions = () => {
    if (actionTimer || actionFlushing) return;
    const next = actionQueue.shift();
    if (!next) { settleActionDrain(); return; }
    actionFlushing = true;
    applyActionEvent(next.answer, next.event);
    actionFlushing = false;
    /* Tool events can arrive as one packet. A measured cadence lets each
       completed action land before the next one changes the run. */
    actionTimer = window.setTimeout(() => { actionTimer = 0; pumpActions(); }, next.event.type === "todos" ? 620 : 740);
  };
  const queueAction = (answer, event) => { actionQueue.push({ answer, event }); pumpActions(); };
  const waitForActions = () => new Promise((resolve) => {
    if (!actionQueue.length && !actionTimer && !actionFlushing) resolve();
    else actionDrain.push(resolve);
  });

  /* A set of steps stacks with a tick landing on each as it completes. */
  const actionList = (steps, activeIndex) =>
    el("ol", { class: "chat-actions-list" }, steps.map((step, index) =>
      el("li", { class: `chat-action${index < activeIndex ? " done" : index === activeIndex ? " current" : ""}` },
        el("span", { class: "chat-action-tick" }, icon("check_square", 12)),
        el("span", { class: index === activeIndex ? "shimmer-text" : "", text: step }))));

  /* A page glows blue while the assistant is working on it, and stops when the run does. */
  const markWorking = (answer, pageId) => {
    if (!pageId) return;
    answer.workPages ||= new Set();
    if (answer.workPages.has(String(pageId))) return;
    answer.workPages.add(String(pageId));
    setAiWorking(pageId, true);
  };
  const stopWorking = (answer) => { (answer.workPages || []).forEach((pageId) => setAiWorking(pageId, false)); answer.workPages = new Set(); };

  const applyEdit = async (edit) => {
    if ((edit.status && edit.status !== "pending") || edit.applying) return;
    edit.applying = true; paint();
    const result = await withError(() => api.post(`/api/notes/pages/${encodeURIComponent(edit.pageId)}/agent-edit`, {
      kind: edit.kind, markdown: edit.markdown, position: edit.position, afterText: edit.afterText, find: edit.find, replace: edit.replace,
      messageId: edit.messageId, chatId: edit.chatId, editId: edit.id, summary: edit.title,
    }), "Could not apply that change");
    edit.applying = false;
    if (!result?.ok) { edit.error = result?.error || "The note changed before this could be applied."; paint(); return; }
    edit.status = "accepted";
    edit.version = result.version || null;
    persistRun(edit.owner);
    settleEdit(edit.id, "accepted");
    await refreshPages();
    /* An accepted edit must reload an open page, or a second edit appears to do nothing. */
    if (String(app.currentPageId?.() || "") === String(edit.pageId)) app.reloadView?.();
    else app.openPage(edit.pageId);
    toast(`Applied to ${result.title || edit.title}`);
    paint();
  };
  const declineEdit = (edit) => { if (edit.status && edit.status !== "pending") return; edit.status = "declined"; settleEdit(edit.id, "declined"); persistRun(edit.owner); paint(); };

  /* A proposed change, shown the way it will read in the note: a formatted
     preview of what is added, what it replaces struck through, the size of
     the change, and long changes folded until asked for. */
  const countLines = (text) => (text || "").split("\n").filter((line) => line.trim()).length;
  const previewHtml = (markdown) => renderMarkdown(String(markdown || ""));
  const editProposal = (edit) => {
    const additions = edit.kind === "insert" ? edit.markdown : edit.replace;
    const removals = edit.kind === "replace" ? edit.find : "";
    const settled = edit.status && edit.status !== "pending";
    const added = countLines(additions), removed = countLines(removals);
    const showInNote = () => { app.openPage(edit.pageId); setTimeout(() => window.dispatchEvent(new CustomEvent("clyra:ai-edit", { detail: { edit } })), 400); };
    const body = el("div", { class: "chat-edit-body" },
      removals ? el("div", { class: "chat-edit-removed" }, el("span", { class: "chat-edit-tag", text: "Replaces" }), el("p", { text: removals.replace(/^#+\s*/gm, "").replace(/\*\*/g, "").trim() })) : null,
      additions ? el("div", { class: "chat-edit-preview chat-answer-text", html: previewHtml(additions) }) : null);
    const long = added > 10;
    const card = el("section", { class: `chat-edit-proposal${settled ? ` is-${edit.status}` : ""}${long ? " is-long" : ""}`, "aria-label": `Proposed change to ${edit.title}` },
      el("header", { class: "chat-edit-head" },
        el("span", { class: "chat-edit-icon" }, icon(edit.kind === "insert" ? "plus" : "pencil", 13)),
        el("span", { class: "chat-edit-title" }, el("b", { text: edit.title }), el("span", { text: edit.kind === "insert" ? (edit.position === "start" ? "Adds at the top" : edit.position === "after" ? "Adds after a passage" : "Adds at the end") : "Rewrites a passage" })),
        el("span", { class: "chat-edit-diff" }, added ? el("b", { class: "add", text: `+${added}` }) : null, removed ? el("b", { class: "del", text: `−${removed}` }) : null),
        settled ? el("span", { class: `chat-edit-state is-${edit.status}`, text: edit.status === "accepted" ? "Applied" : "Dismissed" })
          : el("button", { class: "chat-edit-peek", type: "button", onclick: showInNote }, "Show in note", icon("arrow_right", 11))),
      body,
      long ? el("button", { class: "chat-edit-more", type: "button", onclick: (event) => { card.classList.toggle("is-expanded"); event.currentTarget.textContent = card.classList.contains("is-expanded") ? "Show less" : "Show all"; } }, "Show all") : null,
      edit.error ? el("p", { class: "chat-edit-error", text: edit.error }) : null,
      !settled ? el("div", { class: "chat-edit-actions" },
        el("button", { class: "chat-edit-accept", type: "button", disabled: Boolean(edit.applying), onclick: () => applyEdit(edit) }, edit.applying ? "Applying…" : "Apply"),
        el("button", { class: "chat-edit-decline", type: "button", disabled: Boolean(edit.applying), onclick: () => declineEdit(edit) }, "Dismiss")) : null,
      edit.status === "accepted" ? el("button", { class: "chat-version", type: "button", onclick: () => openVersions(app, edit.pageId, { focus: edit.version, title: edit.title }) }, icon("refresh", 12), edit.version ? `Version ${String(edit.version).slice(0, 7)} · view, compare or restore` : "Version history") : null);
    return card;
  };
  /* A reply's changes: the bar to apply or dismiss them all, with each change
     folded above it until asked for. The bar is the last thing in the reply. */
  const changesBlock = (message) => {
    const edits = message.edits;
    const pending = edits.filter((edit) => !edit.status || edit.status === "pending");
    const notes = [...new Set(edits.map((edit) => edit.title))];
    const added = edits.reduce((sum, edit) => sum + countLines(edit.kind === "insert" ? edit.markdown : edit.replace), 0);
    const removed = edits.reduce((sum, edit) => sum + countLines(edit.kind === "replace" ? edit.find : ""), 0);
    const open = Boolean(message.changesOpen);
    const applied = edits.filter((edit) => edit.status === "accepted").length;
    const settledText = applied === edits.length ? "Applied" : applied ? `${applied} applied, ${edits.length - applied} dismissed` : "Dismissed";
    const toggle = () => { message.changesOpen = !message.changesOpen; paint(); };
    return el("div", { class: `chat-changes${open ? " is-open" : ""}` },
      open ? el("div", { class: "chat-changes-list" }, edits.map(editProposal)) : null,
      el("div", { class: "chat-edit-batch" },
        el("button", { class: "chat-changes-toggle", type: "button", "aria-expanded": String(open), onclick: toggle },
          icon("chevron_right", 12),
          el("b", { text: `${edits.length} change${edits.length === 1 ? "" : "s"}` }),
          el("span", { text: notes.length === 1 ? ` to ${notes[0]}` : ` across ${notes.length} notes` })),
        el("span", { class: "chat-edit-diff" }, added ? el("b", { class: "add", text: `+${added}` }) : null, removed ? el("b", { class: "del", text: `−${removed}` }) : null),
        pending.length ? el("span", { class: "chat-edit-batch-actions" },
          el("button", { class: "chat-edit-decline", type: "button", onclick: () => pending.forEach(declineEdit) }, pending.length > 1 ? "Dismiss all" : "Dismiss"),
          el("button", { class: "chat-edit-accept", type: "button", onclick: async () => { for (const edit of pending) await applyEdit(edit); } }, pending.length > 1 ? `Apply all ${pending.length}` : "Apply"))
          : el("span", { class: `chat-edit-state${applied ? " is-accepted" : ""}`, text: settledText })));
  };


  const paint = () => {
    const wasNearBottom = thread.scrollHeight - thread.scrollTop - thread.clientHeight < 52;
    const scrollBefore = thread.scrollTop;
    const wasLanding = chatView.classList.contains("landing");
    const composerBefore = wasLanding ? composer.getBoundingClientRect() : null;
    const viewBefore = wasLanding ? chatView.getBoundingClientRect() : null;
    const ghost = wasLanding ? thread.querySelector(".chat-intro")?.cloneNode(true) : null;
    const ghostRect = ghost ? thread.querySelector(".chat-intro").getBoundingClientRect() : null;
    clear(thread);
    /* an empty chat is a landing: the heading and the composer sit together in the middle, as in Notion */
    chatView.classList.toggle("landing", Boolean(state.aiConfigured) && !messages.length && !compact);
    actionRow.hidden = !chatView.classList.contains("landing");
    if (!actionRow.hidden) paintSuggested();
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
          message.sources?.length || message.fileNames?.length
            ? el("div", { class: "chat-ctx-chips" }, ...(message.fileNames || []).map((name) => el("span", { class: "chat-ctx-chip", title: name }, icon("file", 13), el("span", { text: name }))), ...(message.sources || []).map((source) =>
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
        /* The run leads: "Working for 12s" on top, the timeline under it. Once
           the answer starts streaming the work is over, so it folds away. */
        if (message.text && message.run && !message.run.elapsedMs) message.run.elapsedMs = Date.now() - (message.startedAt || Date.now());
        append(body,
          renderAgentRun(message.run || { todos: [], steps: [] }, { live: !message.text, since: message.startedAt || (message.startedAt = Date.now()), onOpenNote: (id) => app.openPage(id), format: renderMarkdown, state: message.runState }),
          /* Keep a stable live host in the document. Text chunks update it in
             place below the work that produced them, without rebuilding the
             surrounding thread (the source of the visible flicker). */
          message.liveEl || (message.liveEl = el("div", { class: "chat-stream chat-live" })));
        if (message.text) liveText(message);
      } else {
        if (message.prelude) {
          const intro = el("div", { class: "chat-answer-text chat-prelude" });
          revealAnswer(intro, message.prelude, !message.restored);
          body.append(intro);
        }
        if (message.run) {
          message.runState = message.runState || {};
          const view = renderAgentRun(message.run, { live: false, onOpenNote: (id) => app.openPage(id), format: renderMarkdown, state: message.runState });
          if (view) body.append(view);
        }
        const answerHost = el("div", { class: "chat-answer-text" });
        body.append(answerHost);
        revealAnswer(answerHost, message.text, !message.restored && !message.streamedLive);
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
        /* The reply ends with its changes: one bar to apply or dismiss them, and nothing under it. The individual changes fold above the bar. */
        if (message.edits?.length) body.append(changesBlock(message));
      }
      thread.append(el("div", { class: "chat-column chat-row assistant" }, wrapper));
    }
    thread.scrollTop = wasNearBottom ? thread.scrollHeight : scrollBefore;
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
    if (!retryOf) { messages.push({ role: "user", text: question, sources: attachedNow, fileNames: files.map((file) => file.name), at: Date.now() }); input.value = ""; grow(); }
    await ensureChat();
    if (!retryOf) await remember({ role: "user", text: question, sources: attachedNow });
    const answer = retryOf || { role: "assistant", question, sources: [...sources] };
    if (!retryOf) messages.push(answer);
    Object.assign(answer, { pending: true, error: null, steps: null, searching: null, stepIndex: 0, finishEvent: null });
    /* Only the agent's update_todos calls create a plan. A scripted generic
       row falsely implied that every request had been planned. */
    answer.run = { todos: [], steps: [] };
    answer.startedAt = Date.now();
    busy = true;
    syncSend();
    paint();

    const controller = new AbortController();
    askAbort = controller;
    answer.text = ""; answer.targetText = ""; answer.prelude = ""; answer.edits = [];
    answer.liveEl = null; answer.liveFor = null; answer.streamedLive = false;
    let roundText = "";
    let finished = false;
    const history = messages
      .filter((m) => m !== answer && (m.role === "user" || (m.role === "assistant" && m.text && !m.error)))
      .slice(-12)
      .map((m) => ({ role: m.role, content: String(m.text).slice(0, 6000) }));
    /* A retry re-sends the same question without duplicating it. */
    const last = history[history.length - 1];
    const quoted = (quotes.length ? `\n\nSelected text from the page:\n${quotes.map((q) => `> ${q}`).join("\n")}` : "")
      + files.map((file) => `\n\nAttached file "${file.name}":\n${file.text}`).join("");
    if (!(last && last.role === "user" && last.content === question)) history.push({ role: "user", content: question + quoted });
    else if (quoted) last.content = question + quoted;
    quotes = [];
    files = [];
    paintSources();
    /* The visible note wins over a historical chat attachment. That keeps an
       AI request made from a note pointed at that note, even after switching
       tabs or returning to an existing conversation. */
    const attachedId = compact ? boundId : (boundId || app.currentPageId?.() || currentChat()?.page_id || null);
    const pageIds = [...new Set([...sources.map((source) => source.pageId), ...(attachedId ? [String(attachedId)] : app.currentPageId?.() ? [String(app.currentPageId())] : [])])];
    try {
      await streamAgent({
        messages: history,
        model: MODELS.find((m) => m.id === modelId)?.model,
        instructions: [instructionsFor(agentId), reviewMode ? REVIEW_NOTE : ""].filter(Boolean).join("\n\n"),
        notes: { pageIds, currentPageId: attachedId ? String(attachedId) : app.currentPageId?.() ? String(app.currentPageId()) : null },
        signal: controller.signal,
        onEvent: (event) => {
          if (event.type === "todos" || event.type === "step" || event.type === "edit" || event.type === "agent" || event.type === "board" || event.type === "phase") {
            queueAction(answer, event);
          } else if (event.type === "text") {
            if (event.placement === "before") {
              /* What the model says between tool calls is part of the timeline, in order, like Codex's commentary. */
              const steps = (answer.run ||= { todos: [], steps: [] }).steps;
              if (event.text.trim()) steps.push({ id: `note-${steps.length}-${Date.now()}`, tool: "note", state: "done", text: event.text.trim() });
              paintSoon();
              return;
            }
            roundText += event.text;
            queueText(answer, event.text);
            /* Once the live host exists, update only its message. The rest of
               the chat stays painted and stable while the response arrives. */
            if (answer.liveEl?.isConnected) liveText(answer);
            else paintSoon();
            return;
          }
          else if (event.type === "done") {
            finished = true;
            answer.finishEvent = event;
          } else if (event.type === "error") {
            finished = true;
            answer.pending = false;
            answer.error = event.code === "credits" ? "Clyra's model account is out of credits. Add credits, then press Retry." : event.code === "cancelled" ? "Stopped." : event.message || "Clyra couldn't finish this reply.";
          }
          paintStructural();
        },
      });
      /* Do not collapse the final answer over actions still travelling from
         the event stream. The completion state is held until the visible run
         has caught up. */
      await waitForActions();
      await waitForTyping(answer);
      answer.searched = answer.run.steps.find((step) => step.tool === "web_search")?.query || answer.searched || null;
      if (answer.finishEvent) {
        answer.pending = false;
        answer.targetText = answer.finishEvent.text;
        if (answer.text !== answer.targetText) { queueText(answer, ""); await waitForTyping(answer); }
        answer.sources = (answer.finishEvent.citations || []).map((c) => ({ pageId: "", title: c.title || c.host, url: c.url }));
        answer.citations = [];
      }
      if (!finished) { answer.pending = false; if (!answer.text) answer.error = "Clyra couldn't finish this reply."; }
      if (answer.run && answer.startedAt) answer.run.elapsedMs = Date.now() - answer.startedAt;
      if (!answer.error) {
        const saved = await remember({ role: "assistant", text: answer.text, sources: answer.sources, citations: [], searched: answer.searched, run: answer.run, edits: answer.edits, prelude: answer.prelude });
        if (saved?.id) { answer.savedId = saved.id; answer.chatId = chatId; }
        loadChats();
        refreshPages?.();
      }
    } catch (error) {
      answer.pending = false;
      answer.error = controller.signal.aborted ? "Stopped." : error.message;
    } finally {
      stopWorking(answer);
      askAbort = null;
      busy = false;
      syncSend();
      if (structuralPaintTimer) { clearTimeout(structuralPaintTimer); structuralPaintTimer = 0; }
      paint();
      if (compact && wantedId !== undefined && wantedId !== boundId) setPage(wantedId);
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

  /* The side panel follows the page: each note has its own thread, and moving to another note brings its chat back. */
  const setPage = async (id) => {
    if (!compact) return;
    id = id ? String(id) : null;
    wantedId = id;
    if (busy || id === boundId) return;
    /* A conversation in progress follows you: it stays put and simply points at the new page. */
    if (messages.length) { boundId = id; paintAttached(); return; }
    boundId = id;
    chatId = null; messages = []; sources = []; quotes = []; files = [];
    paintSources(); paintAttached(); paint();
    const mine = await api.get(id ? `/api/notes/chats?pageId=${encodeURIComponent(id)}` : "/api/notes/chats").catch(() => []);
    if (wantedId !== id || busy) return;
    chats = id ? mine : chats;
    if (id && mine.length && mine[0].message_count) await openChat(mine[0].id);
    else { paintHead(); paintHistory(); }
  };

  /* Moves the chat into a view. Only one view can hold it, so opening the
     full-screen chat closes the sidebar's chat, and opening the sidebar's chat
     leaves the full-screen one. */
  const mount = (host, nextCompact) => {
    host.append(layout);
    const changed = nextCompact !== compact;
    compact = nextCompact;
    layout.classList.toggle("compact", compact);
    if (compact) layout.classList.add("history-hidden");
    paintMode();
    if (changed) { paintHead(); paintAttached(); paintHistory(); paint(); }
    if (!compact) publishChats();
    if (!compact) {
      if (app.railOpen?.() && app.rail?.current === "chat") app.toggleRail();
      queueMicrotask(() => input.focus());
    } else if (activeTab()?.kind === "chat") app.leaveChatView?.();
    requestAnimationFrame(() => { thread.scrollTop = thread.scrollHeight; });
  };

  paint();
  paintMode();
  loadChats();
  if (!compact) api.post("/api/notes/chats/prune", {}).catch(() => {});
  return {
    root: layout,
    mount,
    isBusy: () => busy,
    dispose() { askAbort?.abort(); layout.remove(); window.removeEventListener("clyra:chat-action", onSidebar); window.removeEventListener("clyra:new-chat", onNewChat); window.removeEventListener("clyra:notes-quote", onQuote); window.removeEventListener("clyra:prefill-chat", onPrefill); },
    setPage,
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
  };
}

/* Turns the model's [S12] markers into controls that open the exact block
   they came from, and drops any marker with no matching citation. */
function linkCitations(html, citations) {
  const known = new Set(citations.map((entry) => String(entry.index)));
  return html.replace(/\[S(\d+)\]/g, (match, index) =>
    known.has(index) ? `<button class="cite" type="button" data-index="${index}" title="Show source">${index}</button>` : "");
}
