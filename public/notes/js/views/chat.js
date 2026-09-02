/* Workspace AI chat.

   The surface deliberately mirrors Clyra's launcher chat: the same one-line
   composer with a circular send action, the same user bubble, the same
   gradient reveal on the assistant's reply, and the same shimmer-with-mark
   treatment for work in progress. Answers stay grounded in the pages the
   student attaches with @. */
import { el, clear, icon, iconButton, bloub, toast, append, menu, confirmDialog } from "../dom.js";
import { api } from "../api.js";
import { state, withError, refreshPages } from "../state.js";
import { formatRelative } from "../app.js";
import { renderMarkdown } from "../ai-composer.js";
import { openSearch } from "../search.js";

const SUGGESTIONS = [
  "Summarise what I wrote this week",
  "Which topics have I not revised recently?",
  "Explain the hardest idea in my notes",
];

/* `compact` is the rail's chat: same thread, same composer, no history
   column and no room for one. Everything else behaves identically, so there
   is one chat implementation rather than two that drift. */
export function renderChat(host, app, options = {}) {
  const compact = Boolean(options.compact);
  let messages = [];
  let sources = [];
  let busy = false;
  let chatId = null;
  let chats = [];
  let historyOpen = !compact && localStorage.getItem("clyra-notes:chat-history") !== "0";

  const thread = el("div", { class: "chat-thread scroll" });
  const historyList = el("div", { class: "chat-history-list scroll" });
  const chips = el("div", { class: "chat-sources" });
  /* The placeholder teaches the one thing the composer can do that a plain
     chat box cannot: attach notes. Naming the key is what makes it
     discoverable — there is nothing else on the bar that says so. */
  const PLACEHOLDER = "Ask about your notes\u2026  Type @ to reference a note, or several";
  const input = el("textarea", {
    class: "chat-input", rows: "1", placeholder: PLACEHOLDER, "aria-label": "Ask Clyra",
  });
  const send = el("button", { class: "chat-send", type: "button", "aria-label": "Send message", disabled: true }, icon("arrow_up", 18));

  const composer = el("div", { class: "chat-composer" },
    chips,
    el("div", { class: "chat-bar" },
      el("span", { class: "chat-bar-mark" }, bloub(20)),
      input,
      iconButton("at", "Add a page as context", () => addSource(), { size: 16, className: "chat-at" }),
      send));
  /* History sits on the right, like any chat client: the thread you are in
     stays where your eye already is. */
  const history = el("aside", { class: "chat-history", "aria-label": "Chat history" },
    el("div", { class: "chat-history-head" },
      el("span", { class: "chat-history-title", text: "Chats" }),
      iconButton("plus", "New chat", () => startChat(), { size: 15 })),
    historyList);

  const layout = el("div", { class: `chat-layout${historyOpen ? "" : " history-hidden"}${compact ? " compact" : ""}` },
    el("div", { class: "chat-view" }, thread, composer),
    compact ? null : history);
  host.append(layout);

  const toggleHistory = () => {
    if (compact) return;
    historyOpen = !historyOpen;
    layout.classList.toggle("history-hidden", !historyOpen);
    localStorage.setItem("clyra-notes:chat-history", historyOpen ? "1" : "0");
  };

  const loadChats = async () => {
    if (compact) return;
    chats = (await withError(() => api.get("/api/notes/chats"), "Could not load your chats")) || [];
    paintHistory();
  };

  const paintHistory = () => {
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
  };

  const startChat = () => {
    chatId = null;
    messages = [];
    sources = [];
    paintSources();
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

  const syncSend = () => { send.disabled = busy || !input.value.trim(); };
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
    clear(thread);
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
        el("h1", { class: "chat-title", text: "Ask about your notes" }),
        el("p", { class: "chat-lead" },
          el("span", { text: "Type " }),
          el("kbd", { class: "chat-lead-key", text: "@" }),
          el("span", { text: " to reference one note or several, so answers stay grounded in your own material." })),
        el("div", { class: "chat-suggestions" }, SUGGESTIONS.map((suggestion) =>
          el("button", { class: "chip", type: "button", onclick: () => { input.value = suggestion; grow(); syncSend(); ask(); } }, suggestion)))));
      return;
    }
    for (const message of messages) {
      if (message.role === "user") {
        /* What a question was grounded in belongs with the question. Listing
           the pages under the bubble means scrolling back through a thread
           still tells you which notes each answer was read from. */
        thread.append(el("div", { class: "chat-column chat-row user" },
          el("div", { class: "chat-bubble", text: message.text }),
          message.sources?.length
            ? el("ul", { class: "chat-bubble-sources" }, message.sources.map((source) =>
                el("li", { class: "chat-bubble-source" },
                  el("span", { class: "chat-bubble-bullet" }, icon("page", 11)),
                  el("button", {
                    class: "chat-bubble-source-name", type: "button",
                    onclick: () => source.pageId && app.openPage(source.pageId),
                  }, source.title || "Note"))))
            : null));
        continue;
      }
      const body = el("div", { class: "chat-answer" });
      const wrapper = el("div", { class: "chat-assistant" },
        el("span", { class: "chat-assistant-mark" }, bloub(22)),
        el("div", { class: "chat-assistant-body" }, body));

      if (message.error) {
        append(body, el("div", { class: "ai-error", text: message.error }),
          el("button", { class: "ai-action", type: "button", onclick: () => ask(message) }, "Retry"));
      } else if (message.pending) {
        append(body,
          message.steps ? actionList(message.steps, message.stepIndex ?? 0) : null,
          message.searching ? workRow(`Searching the web for "${message.searching}"`, "search") : null,
          !message.steps && !message.searching ? workRow("Reading your notes", "think") : null);
      } else {
        revealAnswer(body, message.text, !message.restored);
        if (message.searched) {
          body.append(el("div", { class: "ai-searched" }, icon("search", 12), `Searched the web for "${message.searched}"`));
        }
        body.append(el("div", { class: "chat-actions" },
          el("button", { class: "ai-action", type: "button", onclick: () => insertIntoPage(message) }, icon("plus", 14), "Insert into page"),
          el("button", { class: "ai-action", type: "button", onclick: () => createPageFrom(message) }, icon("page", 14), "Create page")));
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
        body.innerHTML = linkCitations(body.innerHTML, message.citations || []);
      }
      thread.append(el("div", { class: "chat-column chat-row assistant" }, wrapper));
    }
    thread.scrollTop = thread.scrollHeight;
  };

  const ask = async (retryOf) => {
    if (busy) return;
    const question = retryOf?.question ?? input.value.trim();
    if (!question) return;
    const attachedNow = sources.map((source) => ({ pageId: source.pageId, title: source.title }));
    if (!retryOf) { messages.push({ role: "user", text: question, sources: attachedNow }); input.value = ""; grow(); }
    await ensureChat();
    if (!retryOf) await remember({ role: "user", text: question, sources: attachedNow });
    const answer = retryOf || { role: "assistant", question, sources: [...sources] };
    if (!retryOf) messages.push(answer);
    Object.assign(answer, { pending: true, error: null, steps: null, searching: null, stepIndex: 0 });
    busy = true;
    syncSend();
    paint();

    /* The step list is driven by what actually happens: it only claims to be
       searching once the server says it searched. */
    const stages = sources.length
      ? ["Reading the pages you attached", "Working out the answer", "Writing it up"]
      : ["Reading your notes", "Working out the answer", "Writing it up"];
    answer.steps = stages;
    paint();
    const ticker = setInterval(() => {
      if (answer.stepIndex < stages.length - 1) { answer.stepIndex += 1; paint(); }
    }, 1600);

    try {
      const attached = sources.map((source) => ({ pageId: source.pageId }));
      const result = await api.post("/api/notes/ai/ask", { question, sources: attached });
      clearInterval(ticker);
      answer.pending = false;
      answer.text = result.text;
      answer.sources = result.sources || [];
      answer.citations = result.citations || [];
      answer.searched = result.searched || null;
      await remember({ role: "assistant", text: answer.text, sources: answer.sources, citations: answer.citations, searched: answer.searched });
      loadChats();
    } catch (error) {
      clearInterval(ticker);
      answer.pending = false;
      answer.error = error.message;
    } finally {
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
    destroy() { window.removeEventListener("clyra:new-chat", onNewChat); },
  };
}

/* Turns the model's [S12] markers into controls that open the exact block
   they came from, and drops any marker with no matching citation. */
function linkCitations(html, citations) {
  const known = new Set(citations.map((entry) => String(entry.index)));
  return html.replace(/\[S(\d+)\]/g, (match, index) =>
    known.has(index) ? `<button class="cite" type="button" data-index="${index}" title="Show source">${index}</button>` : "");
}
