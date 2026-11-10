/* The Notes chat's tool run, drawn the way Clyra's chat draws it: a plan pill, then one row per real step.
   Every row is a tool call that ran (a search, a page read, an insert); nothing here is scripted or timed. */
import { el, icon, append } from "./dom.js";

/* Streams /api/chat/agent. Resolves when the stream ends. */
export async function streamAgent({ messages, notes, model, instructions, signal, onEvent }) {
  const response = await fetch("/api/chat/agent", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify({ messages, notes, model, instructions }),
    signal,
  });
  if (!response.ok || !response.body) throw new Error(`Chat API error: ${response.status}`);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let split;
    while ((split = buffer.indexOf("\n\n")) >= 0) {
      const frame = buffer.slice(0, split);
      buffer = buffer.slice(split + 2);
      const data = frame.split("\n").filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim()).join("");
      if (!data) continue;
      try { onEvent(JSON.parse(data)); } catch { /* a damaged frame */ }
    }
  }
}

const TOOL_ICON = {
  review_work: "check", web_search: "search", web_open: "page", web_find: "search", web_follow_links: "link",
  create_note: "plus", notes_organize: "pencil", notes_create_database: "table", delegate_agents: "users", board_post: "comment", templates_get: "template", templates_use: "template", notes_create_flashcards: "cards", notes_duplicate: "copy", notes_search: "search", notes_read: "page", notes_insert: "plus", notes_edit: "pencil",
};

const todoGlyph = (status) => {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 14 14");
  svg.setAttribute("width", "14");
  svg.setAttribute("height", "14");
  svg.setAttribute("class", `ag-glyph ag-glyph-${status}`);
  svg.setAttribute("aria-hidden", "true");
  const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  circle.setAttribute("cx", "7"); circle.setAttribute("cy", "7"); circle.setAttribute("r", "6.2");
  circle.setAttribute("fill", "none"); circle.setAttribute("stroke", "currentColor"); circle.setAttribute("stroke-width", "1.2");
  if (status === "pending") circle.setAttribute("stroke-dasharray", "2.4 2.4");
  svg.append(circle);
  if (status === "completed") {
    const tick = document.createElementNS("http://www.w3.org/2000/svg", "path");
    tick.setAttribute("d", "m4.5 7.2 1.8 1.8 3.3-3.6");
    tick.setAttribute("fill", "none"); tick.setAttribute("stroke", "currentColor"); tick.setAttribute("stroke-width", "1.3");
    tick.setAttribute("stroke-linecap", "round"); tick.setAttribute("stroke-linejoin", "round");
    svg.append(tick);
  }
  return svg;
};

/* The plan: a white pill (current step, N/M) that opens to the checklist. Done = hollow ring with a thin tick. */

const stateGlyph = (status) => {
  if (status === "running") return el("span", { class: "ag-spinner", "aria-hidden": "true" });
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 14 14"); svg.setAttribute("width", "13"); svg.setAttribute("height", "13"); svg.setAttribute("class", `ag-state ag-state-${status}`); svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", status === "failed" ? "m4 4 6 6m0-6-6 6" : "m3.5 7.3 2.3 2.3 4.7-5");
  path.setAttribute("fill", "none"); path.setAttribute("stroke", "currentColor"); path.setAttribute("stroke-width", "1.5"); path.setAttribute("stroke-linecap", "round"); path.setAttribute("stroke-linejoin", "round");
  svg.append(path);
  return svg;
};

/* "Working" with a running clock. One ticker updates every visible clock
   once a second, so a redraw of the run never resets or doubles it. */
export const clock = (ms) => { const total = Math.max(0, Math.floor(ms / 1000)); const m = Math.floor(total / 60), sec = total % 60; return m ? `${m}m ${String(sec).padStart(2, "0")}s` : `${sec}s`; };
let ticker = 0;
const tick = () => {
  const nodes = document.querySelectorAll(".ag-timer[data-since]");
  if (!nodes.length) { clearInterval(ticker); ticker = 0; return; }
  nodes.forEach((node) => { node.textContent = clock(Date.now() - Number(node.dataset.since)); });
};
const ensureTicker = () => { if (!ticker) ticker = setInterval(tick, 1000); };
export function workingLine(since, label = "Working") {
  ensureTicker();
  return el("div", { class: "ag-working", role: "status", "aria-live": "off" },
    el("span", { class: "ag-spinner", "aria-hidden": "true" }),
    el("span", { class: "ag-working-label shimmer-text", text: label }),
    el("span", { class: "ag-timer", dataset: { since: String(since) }, text: clock(Date.now() - since) }));
}

const seconds = (ms) => (ms < 950 ? "<1s" : ms < 60000 ? `${Math.round(ms / 1000)}s` : `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`);

/* What a tool call actually did, one line per action, under its row. New
   rows reveal their actions one after another; a run being redrawn shows them
   at once, so the list never replays. */
const ACTION_ICON = { read: "page", find: "search", write: "pencil", add: "plus", remove: "trash", check: "check", open: "arrow_right", wait: "eye" };
const ACTIONS_SHOWN = 8;
function renderActions(actions, { enter, live }) {
  const shown = actions.slice(0, ACTIONS_SHOWN);
  const list = el("ol", { class: `ag-acts${enter ? " enter" : ""}${live ? " live" : ""}`, "aria-label": "What it did" },
    shown.map((action, index) => el("li", { class: `ag-act kind-${action.kind}`, style: { "--i": String(index) } },
      el("span", { class: "ag-act-icon", "aria-hidden": "true" }, icon(action.icon || ACTION_ICON[action.kind] || "check", 13)),
      el("span", { class: "ag-act-label", text: action.label }),
      action.meta ? el("span", { class: "ag-act-meta", text: action.meta }) : null)));
  if (actions.length > ACTIONS_SHOWN) {
    const rest = actions.slice(ACTIONS_SHOWN);
    const more = el("li", { class: "ag-act ag-act-more" }, el("button", { type: "button", text: `${rest.length} more`, onclick: () => {
      more.replaceWith(...rest.map((action) => el("li", { class: `ag-act kind-${action.kind}` },
        el("span", { class: "ag-act-icon", "aria-hidden": "true" }, icon(action.icon || ACTION_ICON[action.kind] || "check", 13)),
        el("span", { class: "ag-act-label", text: action.label }),
        action.meta ? el("span", { class: "ag-act-meta", text: action.meta }) : null)));
    } }));
    list.append(more);
  }
  return list;
}

/* One tool call: its own tile, a label that shimmers while it runs, a state
   mark that resolves to a tick, the time it took, and a hairline that sweeps
   underneath until it is done. Clicking opens what it was given. */
function renderStep(step, { onOpenNote, enter = false, elapsed = null, open = false, onToggle }) {
  const running = step.state === "running";
  const detail = step.state === "failed" ? step.error : (step.detail && step.tool !== "web_search" ? step.detail : "");
  const expandable = Boolean(step.query || detail || step.sources?.length || step.document);
  const row = el("li", { class: `ag-row ${running ? "running" : step.state}${enter ? " enter" : ""}${open ? " open" : ""}`, dataset: { tool: step.tool } });
  const head = el("button", { class: "ag-row-head", type: "button", disabled: !expandable, "aria-expanded": String(open), onclick: () => { onToggle?.(step.id); row.classList.toggle("open"); head.setAttribute("aria-expanded", String(row.classList.contains("open"))); } },
    el("span", { class: "ag-row-icon" }, icon(TOOL_ICON[step.tool] || "sparkle", 14)),
    el("span", { class: `ag-row-label${running ? " shimmer-text" : ""}`, text: step.label }),
    step.tool === "web_search" && step.sources?.length ? el("span", { class: "ag-favicons" }, step.sources.slice(0, 5).map((source) =>
      el("span", { class: "ag-favicon", title: source.host },
        el("img", { src: `https://www.google.com/s2/favicons?domain_url=${encodeURIComponent(`https://${source.host}`)}&sz=64`, alt: "", width: 18, height: 18, referrerpolicy: "no-referrer" })))) : null,
    el("span", { class: "ag-row-end" },
      step.changes && (step.changes.added || step.changes.removed) ? el("span", { class: "ag-row-diff", "aria-label": `${step.changes.added} lines added, ${step.changes.removed} removed` },
        step.changes.added ? el("b", { class: "add", text: `+${step.changes.added}` }) : null,
        step.changes.removed ? el("b", { class: "del", text: `−${step.changes.removed}` }) : null) : null,
      elapsed != null && !running ? el("span", { class: "ag-row-time", text: seconds(elapsed) }) : null,
      stateGlyph(step.state)),
    expandable ? icon("chevron_down", 12) : null);
  row.append(head);
  if (step.actions?.length) row.append(renderActions(step.actions, { enter, live: running }));
  if (running) row.append(el("span", { class: "ag-row-sweep", "aria-hidden": "true" }));
  if (expandable) {
    const lines = [];
    if (step.query) lines.push(el("div", { class: "ag-detail-line" }, el("span", { text: "Query" }), el("code", { text: step.query })));
    if (detail) lines.push(el("div", { class: "ag-detail-line" }, el("span", { text: step.state === "failed" ? "Problem" : "Result" }), el("p", { text: detail })));
    if (step.sources?.length) lines.push(el("div", { class: "ag-detail-sources" }, step.sources.slice(0, 8).map((source) =>
      el("a", { class: "ag-source", href: source.url, target: "_blank", rel: "noopener noreferrer" }, el("span", { text: source.host })))));
    if (step.document?.id && onOpenNote) lines.push(el("button", { class: "ag-open", type: "button", onclick: () => onOpenNote(step.document.id) }, `Open ${step.document.title || "note"}`, icon("chevron_right", 12)));
    row.append(el("div", { class: "ag-detail-wrap" }, el("div", { class: "ag-detail" }, lines)));
  }
  return row;
}

/* Agents that work at the same time: one lane each, with its own steps and report, and the board they share. */
function renderAgents(run, { live, onOpenNote, state }) {
  if (!run.agents?.length) return null;
  state.agentOpen ||= new Set();
  const lanes = run.agents.map((agent) => {
    const running = agent.state === "running";
    const open = state.agentOpen.has(agent.id) || (running && !state.agentOpen.has(`-${agent.id}`));
    const head = el("button", { class: "ag-lane-head", type: "button", "aria-expanded": String(open), onclick: (event) => {
      const card = event.currentTarget.parentElement; const now = !card.classList.contains("is-open");
      card.classList.toggle("is-open", now); event.currentTarget.setAttribute("aria-expanded", String(now));
      state.agentOpen.delete(agent.id); state.agentOpen.delete(`-${agent.id}`); state.agentOpen.add(now ? agent.id : `-${agent.id}`);
    } },
      running ? el("span", { class: "ag-spinner", "aria-hidden": "true" }) : stateGlyph(agent.state === "failed" ? "failed" : "done"),
      el("span", { class: "ag-lane-text" }, el("b", { class: running ? "shimmer-text" : "", text: agent.name }), el("span", { text: agent.goal.length > 90 ? `${agent.goal.slice(0, 88)}…` : agent.goal })),
      el("span", { class: "ag-lane-count", text: `${agent.steps.filter((step) => step.state !== "running").length}/${agent.steps.length || "…"}` }),
      icon("chevron_down", 12));
    const steps = agent.steps.map((step) => renderStep(step, { onOpenNote, enter: !(state.seenSteps ||= new Set()).has(step.id) && !!state.seenSteps.add(step.id), elapsed: step.ms ?? null, open: false, onToggle: () => {} }));
    return el("section", { class: `ag-lane${open ? " is-open" : ""}${running ? " running" : ""}`, dataset: { agent: agent.id } }, head,
      el("div", { class: "ag-lane-body" }, el("div", { class: "ag-lane-inner" },
        steps.length ? el("ul", { class: "ag-steps" }, steps) : el("p", { class: "ag-lane-wait", text: "Getting started…" }),
        agent.summary ? el("p", { class: "ag-lane-summary", text: agent.summary }) : null)));
  });
  const board = run.board?.length ? el("section", { class: "ag-board", "aria-label": "Shared board" }, el("h4", { text: "Shared board" }),
    el("ul", {}, run.board.slice(-6).map((post) => el("li", {}, el("b", { text: post.from }), el("span", { text: post.text }))))) : null;
  return el("div", { class: "ag-agents" }, el("div", { class: "ag-agents-title" }, icon("users", 13), el("span", { text: `${run.agents.length} agent${run.agents.length === 1 ? "" : "s"} working together` })), ...lanes, board);
}


/* The run, drawn the way Codex draws one: a header that reads "Working for
   12s" while it runs, a hairline under it, then the timeline — what the
   model said it would do, each tool call with its actions, and the plan — in
   the order it happened. When the run ends the header becomes "Worked for
   1m 02s" and the whole timeline folds away behind it, so the answer leads. */
function renderPlan(todos) {
  const done = todos.filter((t) => t.status === "completed").length;
  return el("section", { class: "ag-plan", "aria-label": "Plan" },
    el("div", { class: "ag-plan-head" }, el("span", { text: "Plan" }), el("span", { class: "ag-plan-count", text: `${done} of ${todos.length}` })),
    el("ul", { class: "ag-plan-list" }, todos.map((item) =>
      el("li", { class: "ag-plan-item", dataset: { status: item.status } }, todoGlyph(item.status), el("span", { text: item.content })))));
}

export function renderAgentRun(run, { live, onOpenNote, state = {}, since = null, format = null } = {}) {
  if (!run) return null;
  run.todos ||= []; run.steps ||= [];
  if (!live && !run.todos.length && !run.steps.length && !run.agents?.length) return null;
  state.seenSteps ||= new Set();
  state.times ||= new Map();
  state.openSteps ||= new Set();
  state.started ||= since || Date.now();
  const now = Date.now();
  const tools = run.steps.filter((step) => step.tool !== "note");
  for (const step of tools) {
    const entry = state.times.get(step.id) || { start: now, end: null };
    if (step.state !== "running" && entry.end == null) entry.end = now;
    state.times.set(step.id, entry);
  }
  const failed = tools.filter((step) => step.state === "failed").length;
  const measured = state.times.size ? Math.max(...[...state.times.values()].map((entry) => entry.end ?? now)) - state.started : 0;
  const elapsed = run.elapsedMs || measured;
  const open = state.userToggled ? state.bodyOpen : live;
  const toggleStep = (id) => { state.openSteps.has(id) ? state.openSteps.delete(id) : state.openSteps.add(id); };

  const timeline = run.steps.map((step) => {
    const enter = !state.seenSteps.has(step.id);
    state.seenSteps.add(step.id);
    if (step.tool === "note") return format
      ? el("li", { class: `ag-note chat-answer-text${enter ? " enter" : ""}`, html: format(step.text) })
      : el("li", { class: `ag-note${enter ? " enter" : ""}`, text: step.text });
    const timing = state.times.get(step.id);
    return renderStep(step, { onOpenNote, enter, elapsed: step.ms ?? (timing?.end != null ? timing.end - timing.start : null), open: state.openSteps.has(step.id), onToggle: toggleStep });
  });

  const root = el("section", { class: `ag-run${live ? " live" : ""}${open ? " is-open" : ""}` });
  const toggle = () => {
    state.userToggled = true; state.bodyOpen = !root.classList.contains("is-open");
    root.classList.toggle("is-open", state.bodyOpen);
    head.setAttribute("aria-expanded", String(state.bodyOpen));
  };
  const head = el("button", { class: "ag-head", type: "button", "aria-expanded": String(open), onclick: toggle },
    live
      ? [el("span", { class: "ag-head-label shimmer-text", text: "Working for" }), el("span", { class: "ag-timer", dataset: { since: String(state.started) }, text: clock(now - state.started) })]
      : [el("span", { class: "ag-head-label", text: `Worked for ${clock(elapsed)}` }),
        el("span", { class: "ag-head-meta", text: `${tools.length} action${tools.length === 1 ? "" : "s"}${failed ? `, ${failed} retried` : ""}` })],
    icon("chevron_right", 13));
  if (live) ensureTicker();
  /* While it runs the header and its line stay pinned to the top of the thread. */
  append(root, el("div", { class: "ag-top" }, head, el("div", { class: "ag-rule", "aria-hidden": "true" })),
    el("div", { class: "ag-body" }, el("div", { class: "ag-body-inner" },
      run.todos.length ? renderPlan(run.todos) : null,
      renderAgents(run, { live, onOpenNote, state }),
      timeline.length ? el("ul", { class: "ag-steps ag-timeline", "aria-label": "What Clyra did" }, timeline) : null)));
  return root;
}
