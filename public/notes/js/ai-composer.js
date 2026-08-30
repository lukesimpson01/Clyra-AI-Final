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

export function runAiComposer({ editor, block, action, selection, seedText, mount, suggestions }) {
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

  const input = el("input", {
    type: "text",
    placeholder: action ? LABELS[action] || "Working…" : selection ? "Tell AI how to change this" : "Edit with AI",
    "aria-label": "Ask AI",
    oninput: () => syncSend(),
    onkeydown: (event) => {
      if (event.key === "Enter") { event.preventDefault(); submit(input.value.trim()); }
      if (event.key === "Escape") { event.preventDefault(); dismiss(); }
    },
  });
  const send = el("button", {
    class: "ai-send", type: "button", "aria-label": "Send", disabled: true,
    onclick: () => submit(input.value.trim()),
  }, icon("arrow_up", 14));
  const syncSend = () => { send.disabled = !input.value.trim(); };
  const inputRow = el("div", { class: `ai-composer-input${selection ? " has-selection" : ""}` },
    el("span", { class: "ai-avatar" }, bloub(20)),
    input,
    send,
    iconButton("close", "Close", () => dismiss(), { size: 14, className: "ai-close" }),
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
        for (const [key, label] of matched) {
          shown += 1;
          presets.append(el("button", {
            class: "ai-preset", type: "button",
            onclick: () => { presets.hidden = true; submit("", key); },
          }, label));
        }
      }
      presets.hidden = shown === 0;
    };
    input.addEventListener("input", () => paintPresets(input.value));
    paintPresets();
  }
  host.append(inputRow, presets, body, actions);
  if (!action) queueMicrotask(() => input.focus());

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
    clear(actions);
    actions.hidden = true;
    body.hidden = false;
    clear(body);
    body.append(el("div", { class: "ai-thinking" },
      el("div", { class: "ai-thinking-label" }, el("span", { class: "shimmer-text", text: label }),
        el("button", { class: "ai-cancel", type: "button", onclick: () => { controller?.abort(); showError("Generation cancelled."); } }, "Cancel")),
      el("div", { class: "shimmer-line w1" }),
      el("div", { class: "shimmer-line w2" }),
      el("div", { class: "shimmer-line w3" }),
    ));
  };

  const showError = (message) => {
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
    clear(actions);
    actions.hidden = false;
    const quiet = (label, onClick) => el("button", { class: "ai-action", type: "button", onclick: onClick }, label);
    actions.append(
      el("button", { class: "ai-action primary", type: "button", onclick: () => (selection ? replaceSelection() : insert("replace")) },
        selection ? "Replace" : "Accept"),
      quiet("Insert below", () => insert("below")),
      quiet("Retry", () => retry()),
      selection ? null : quiet("Continue", () => submit("Continue from where you stopped.")),
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

  async function submit(prompt, forcedAction) {
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
    inputRow.hidden = Boolean(useAction);
    setBusy(useAction ? LABELS[useAction] || "Working…" : "Writing…");
    controller = new AbortController();
    const sources = [{ pageId: editor.page.id }];
    const text = seedText || spansText(block.text) || documentText(editor);
    try {
      const result = useAction
        ? await api.post("/api/notes/ai/inline", { action: useAction, text, instruction: prompt || undefined, sources })
        : await api.post("/api/notes/ai/ask", { question: prompt, sources });
      output = String(result.text || "").trim();
      if (!output) { showError("AI returned an empty response."); return; }
      clear(body);
      body.innerHTML = renderMarkdown(output);
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
