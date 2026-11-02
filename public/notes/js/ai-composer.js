/* The inline AI composer: a compact prompt that streams a result into the
   page and always ends in an explicit choice — accept, replace, insert,
   retry or discard. Nothing is written into the document without one. */
import { el, clear, icon, iconButton, bloub, toast, append } from "./dom.js";
import { api } from "./api.js";
import { parseMarkdownBlocks, makeBlock, newBlockId } from "./editor.js";
import { plain, spansText } from "./richtext.js";

const LABELS = {
  improve: "Improving writing", fix: "Fixing spelling and grammar", shorter: "Making it shorter",
  longer: "Expanding", simplify: "Simplifying", explain: "Explaining", summarize: "Summarising",
  continue: "Continuing", tone: "Changing tone", translate: "Translating",
  key_points: "Extracting key points", action_items: "Extracting action items",
  table: "Building a table", outline: "Building an outline", eli5: "Explaining simply",
  example: "Finding an example", define: "Defining terms", memorize: "Finding what to memorise",
  weak_concepts: "Finding weak concepts", mnemonic: "Writing a mnemonic",
  compare: "Comparing concepts", exam_answer: "Writing an exam answer",
  custom: "Editing your selection",
};

/* What Notion offers on a blank line when you press space: things to draft from nothing, and tools that work on the page
   already written. An entry is [key, label, extra]: no extra runs the inline action named by key; { prefill } puts the
   start of a request in the box for you to finish; { prompt } asks for the whole thing at once. */
export const BLANK_SUGGESTIONS = [
  { group: "Draft with AI", items: [
    ["blog", "Blog post", { prefill: "Write a blog post about " }],
    ["brainstorm", "Brainstorm ideas", { prefill: "Brainstorm ideas for " }],
    ["outline_new", "Outline", { prefill: "Write an outline for " }],
    ["agenda", "Meeting agenda", { prompt: "Write a clear meeting agenda with a purpose, timed items and owners, as a checklist where it helps." }],
    ["proscons", "Pros and cons list", { prefill: "Write a pros and cons list for " }],
    ["social", "Social media post", { prefill: "Write a social media post about " }],
    ["essay", "Essay", { prefill: "Write an essay about " }],
    ["story", "Creative story", { prefill: "Write a short creative story about " }],
    ["poem", "Poem", { prefill: "Write a poem about " }],
    ["email", "Email", { prefill: "Write an email to " }],
    ["jobdesc", "Job description", { prefill: "Write a job description for " }],
    ["press", "Press release", { prefill: "Write a press release about " }],
  ] },
  { group: "Work with this page", items: [
    ["continue", "Continue writing"],
    ["summarize", "Summarize page"],
    ["action_items", "Find action items"],
    ["key_points", "List the key points"],
    ["explain", "Explain this page"],
    ["table", "Turn into a table"],
    ["translate_to", "Translate\u2026", { prefill: "Translate this page into " }],
  ] },
];

export function runAiComposer({ editor, block, action, selection, seedText, mount, suggestions, prefill }) {
  if (suggestions === undefined && !action && !selection && !seedText) suggestions = BLANK_SUGGESTIONS;
  const node = editor.nodes.get(block.id);
  if (!node && !mount) return;
  const host = el("div", { class: "ai-composer" });
  /* When the composer is opened from the quick-start row it takes that row's
     place: the chips step aside rather than the bar appearing beneath them. */
  if (mount) {
    mount.classList.add("ai-open");
    mount.append(host);
  } else {
    node.after(host);
  }
  requestAnimationFrame(() => host.classList.add("in"));

  let output = "";
  let controller = null;
  let lastAction = action || null;
  let lastPrompt = "";

  /* Same shape as Chat's composer: the prompt on top, a control row beneath with the send button at the right. */
  const input = el("textarea", {
    rows: 1,
    placeholder: action ? LABELS[action] || "Working…" : selection ? "Tell AI how to change this…" : "Ask AI to write, edit or explain…",
    "aria-label": "Ask AI",
    oninput: () => { syncSend(); autosize(); },
    onkeydown: (event) => {
      if (event.key === "Enter" && !event.shiftKey && !event.isComposing) { event.preventDefault(); submit(input.value.trim()); }
      if (event.key === "Escape") { event.preventDefault(); dismiss(); }
    },
  });
  const autosize = () => { input.style.height = "auto"; input.style.height = `${Math.min(160, input.scrollHeight)}px`; };
  const send = el("button", {
    class: "ai-send", type: "button", "aria-label": "Send", disabled: true,
    onclick: () => submit(input.value.trim()),
  }, el("span", { class: "ai-send-icon", "aria-hidden": "true", html: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V6M6 12l6-6 6 6"/></svg>' }));
  const syncSend = () => { send.disabled = !input.value.trim(); host.classList.toggle("has-text", Boolean(input.value.trim())); };
  const context = selection
    ? el("span", { class: "ai-context" }, icon("text", 12), "Selection")
    : el("span", { class: "ai-context" }, icon("page", 12), editor.page?.title ? String(editor.page.title).slice(0, 28) : "This page");
  const inputRow = el("div", { class: `ai-composer-input${selection ? " has-selection" : ""}` },
    el("div", { class: "ai-field" }, el("span", { class: "ai-avatar" }, bloub(18)), input),
    el("div", { class: "ai-controls" },
      context,
      el("span", { class: "ai-action-spacer" }),
      el("span", { class: "ai-hint", text: "esc to close" }),
      send),
  );
  const body = el("div", { class: "ai-output", hidden: true });
  const actions = el("div", { class: "ai-actions", hidden: true });
  /* Presets live under the input as a quiet, filterable list: the free-text
     field stays the primary way in, and the common edits are one click. */
  const presets = el("div", { class: "ai-presets", hidden: !suggestions });
  if (suggestions) {
    const paintPresets = (term = "") => {
      clear(presets);
      const needle = term.trim().toLowerCase();
      let shown = 0;
      for (const group of suggestions) {
        const matched = group.items.filter(([, label]) => !needle || label.toLowerCase().includes(needle));
        if (!matched.length) continue;
        presets.append(el("div", { class: "ai-preset-group", text: group.group }));
        for (const [key, label, extra] of matched) {
          shown += 1;
          presets.append(el("button", {
            class: "ai-preset", type: "button",
            onclick: () => {
              presets.hidden = true;
              if (extra?.prefill) { input.value = extra.prefill; syncSend(); autosize(); input.focus(); input.setSelectionRange(input.value.length, input.value.length); }
              else if (extra?.prompt) submit(extra.prompt);
              else submit("", key);
            },
          }, label));
        }
      }
      presets.hidden = shown === 0;
    };
    input.addEventListener("input", () => paintPresets(input.value));
    paintPresets();
  }
  host.append(inputRow, presets, body, actions);
  /* Like Notion's inline AI: clicking elsewhere closes an untouched composer (never one holding a draft or a result). */
  const onOutside = (event) => {
    if (!host.isConnected) { document.removeEventListener("pointerdown", onOutside, true); return; }
    if (host.contains(event.target) || input.value.trim() || output || controller) return;
    document.removeEventListener("pointerdown", onOutside, true);
    dismiss();
  };
  setTimeout(() => document.addEventListener("pointerdown", onOutside, true), 0);
  if (prefill) { input.value = prefill; }
  if (!action) queueMicrotask(() => { input.focus(); if (prefill) { syncSend(); input.setSelectionRange(prefill.length, prefill.length); } });

  /* Closing plays the reverse of the entrance so the chips come back in the
     same motion rather than popping. */
  const dismiss = () => {
    controller?.abort();
    host.classList.remove("in");
    mount?.classList.remove("ai-open");
    const done = () => { host.remove(); if (!mount) editor.focus(block.id, "end"); };
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches
      || document.documentElement.classList.contains("reduce-motion");
    if (reduced) { done(); return; }
    host.addEventListener("transitionend", done, { once: true });
    setTimeout(done, 300);
  };

  /* A shimmering skeleton rather than a spinner: it occupies the shape the
     answer will take, so the bar does not jump when the text arrives. */
  const setBusy = (label) => {
    host.classList.add("busy");
    clear(actions);
    actions.hidden = true;
    body.hidden = false;
    clear(body);
    body.append(el("div", { class: "ai-thinking" },
      el("div", { class: "ai-thinking-label" }, el("span", { class: "ai-shine", text: label }),
        el("button", { class: "ai-cancel", type: "button", onclick: () => { controller?.abort(); showError("Generation cancelled."); } }, "Cancel")),
      el("div", { class: "shimmer-line w1" }),
      el("div", { class: "shimmer-line w2" }),
      el("div", { class: "shimmer-line w3" }),
    ));
  };

  const showError = (message) => {
    host.classList.remove("busy");
    clear(actions);
    actions.hidden = false;
    if (!output) { clear(body); body.hidden = true; }
    actions.append(
      el("span", { class: "ai-error", text: message }),
      el("span", { class: "ai-action-spacer" }),
      el("button", { class: "ai-action", type: "button", onclick: () => retry() }, "Retry"),
      el("button", { class: "ai-action", type: "button", onclick: dismiss }, "Discard"),
    );
  };

  /* One primary verb and quiet text buttons for the rest — the row under the
     bar should read as a decision, not a toolbar. */
  const showResult = () => {
    host.classList.remove("busy");
    clear(actions);
    actions.hidden = false;
    const quiet = (label, onClick) => el("button", { class: "ai-action", type: "button", onclick: onClick }, label);
    actions.append(
      el("button", { class: "ai-action primary", type: "button", onclick: () => (selection ? replaceSelection() : insert("replace")) },
        selection ? "Replace" : "Accept"),
      quiet("Insert below", () => insert("below")),
      quiet("Retry", () => retry()),
      selection ? null : quiet("Continue", () => submit("Continue from where you stopped.")),
      quiet("Make longer", () => submit("", "longer", output)),
      quiet("Make shorter", () => submit("", "shorter", output)),
      el("span", { class: "ai-action-spacer" }),
      quiet("Discard", dismiss),
    );
  };

  const asBlocks = () => parseMarkdownBlocks(output).map((draft) => {
    const created = makeBlock(draft.type, draft.text, draft.props);
    created.children = [];
    return created;
  });

  const insert = (mode) => {
    const blocks = asBlocks();
    if (mode === "replace" && !spansText(block.text)) {
      editor.push();
      const list = editor.siblingsOf(block.id);
      list.splice(list.indexOf(block), 1, ...blocks);
      editor.nodes.delete(block.id);
      host.remove();
      editor.render({ id: blocks[blocks.length - 1].id, offset: "end" });
      editor.commit("ai-insert", true);
      return;
    }
    editor.push();
    const list = editor.siblingsOf(block.id);
    list.splice(list.indexOf(block) + 1, 0, ...blocks);
    host.remove();
    editor.render({ id: blocks[blocks.length - 1].id, offset: "end" });
    editor.commit("ai-insert", true);
  };

  const replaceSelection = () => {
    host.remove();
    mount?.classList.remove("ai-open");
    editor.replaceSelection(block, selection.line, plain(output.trim()), selection.range);
  };

  const retry = () => (lastAction ? submit(lastPrompt, lastAction) : submit(lastPrompt));

  async function submit(prompt, forcedAction, textOverride) {
    /* With a selection in hand, a typed instruction is an edit of that text
       rather than a question about the page. */
    const useAction = forcedAction ?? action ?? (selection && prompt ? "custom" : null);
    lastAction = useAction;
    lastPrompt = prompt || "";
    if (!useAction && !prompt) { toast("Tell AI what to write", "error"); return; }
    output = "";
    presets.hidden = true;
    body.hidden = false;
    body.textContent = "";
    inputRow.hidden = Boolean(useAction) && !textOverride;
    setBusy(useAction ? LABELS[useAction] || "Working…" : "Writing…");
    controller = new AbortController();
    const sources = [{ pageId: editor.page.id }];
    const text = textOverride || seedText || spansText(block.text) || documentText(editor);
    try {
      const result = useAction
        ? await api.post("/api/notes/ai/inline", { action: useAction, text, instruction: prompt || undefined, sources })
        : await api.post("/api/notes/ai/ask", { question: prompt, sources });
      output = String(result.text || "").trim();
      if (!output) { showError("AI returned an empty response."); return; }
      clear(body);
      body.innerHTML = renderMarkdown(output);
      /* the draft arrives a line at a time, the way the chat's replies do, rather than all at once */
      if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        [...body.children].forEach((node, index) => { node.classList.add("chat-stream-line"); node.style.animationDelay = `${Math.min(index, 14) * 55}ms`; });
      }
      if (result.searched) {
        body.append(el("div", { class: "ai-searched" }, icon("search", 12), `Searched the web for "${result.searched}"`));
      }
      showResult();
    } catch (error) {
      showError(error?.message || "AI request failed.");
    } finally {
      controller = null;
    }
  }

  if (action) submit("", action);
}

const documentText = (editor) =>
  editor.flat().map((entry) => spansText(entry.block.text)).filter(Boolean).join("\n").slice(0, 8000);

const escapeHtml = (value) =>
  String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));

/* A deliberately small markdown renderer for AI previews. Everything is
   escaped first, so model output can never inject markup into the page. */
export function renderMarkdown(source) {
  const lines = escapeHtml(source).split("\n");
  const out = [];
  let list = null;
  const closeList = () => { if (list) { out.push(`</${list}>`); list = null; } };
  let inCode = false;
  for (const line of lines) {
    if (/^```/.test(line.trim())) {
      closeList();
      out.push(inCode ? "</code></pre>" : "<pre><code>");
      inCode = !inCode;
      continue;
    }
    if (inCode) { out.push(line); continue; }
    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) { closeList(); out.push(`<h${Math.min(4, heading[1].length)}>${inline(heading[2])}</h${Math.min(4, heading[1].length)}>`); continue; }
    const bullet = line.match(/^\s*[-*+]\s+(.*)$/);
    if (bullet) {
      if (list !== "ul") { closeList(); out.push("<ul>"); list = "ul"; }
      out.push(`<li>${inline(bullet[1])}</li>`);
      continue;
    }
    const numbered = line.match(/^\s*(\d+)[.)]\s+(.*)$/);
    if (numbered) {
      /* A paragraph between two items closes the list, so the next one has
         to resume at its own number instead of restarting at 1. */
      if (list !== "ol") { closeList(); out.push(`<ol start="${Number(numbered[1]) || 1}">`); list = "ol"; }
      out.push(`<li>${inline(numbered[2])}</li>`);
      continue;
    }
    closeList();
    if (line.trim()) out.push(`<p>${inline(line)}</p>`);
  }
  closeList();
  if (inCode) out.push("</code></pre>");
  return out.join("");
}

const inline = (text) =>
  text
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|\W)\*([^*]+)\*/g, "$1<em>$2</em>")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer noopener">$1</a>');
