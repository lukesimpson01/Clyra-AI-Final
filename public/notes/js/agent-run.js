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
  web_search: "search", web_open: "page", web_find: "search", web_follow_links: "link",
  create_note: "plus", notes_search: "search", notes_read: "page", notes_insert: "plus", notes_edit: "pencil",
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
function renderTodo(todos, live, state) {
  const done = todos.filter((t) => t.status === "completed").length;
  const current = todos.find((t) => t.status === "in_progress") || todos.find((t) => t.status === "pending");
  const finished = done === todos.length;
  const root = el("section", { class: `ag-todo${state.open ? " is-open" : ""}`, "aria-label": "Task list" });
  const head = el("button", { class: "ag-todo-head", type: "button", "aria-expanded": String(state.open), onclick: () => { state.open = !state.open; root.classList.toggle("is-open", state.open); head.setAttribute("aria-expanded", String(state.open)); } },
    finished ? todoGlyph("completed") : live ? el("span", { class: "ag-spinner", "aria-hidden": "true" }) : todoGlyph("pending"),
    el("span", { class: "ag-todo-title", text: finished ? "All tasks done" : current?.content || "Tasks" }),
    el("span", { class: "ag-todo-count", text: `${done}/${todos.length}` }),
    icon("chevron_down", 13));
  const list = el("ul", { class: "ag-todo-list" }, todos.map((item) =>
    el("li", { class: "ag-todo-item", dataset: { status: item.status } }, todoGlyph(item.status), el("span", { class: "ag-todo-text", text: item.content }))));
  append(root, head, el("div", { class: "ag-todo-collapse" }, list));
  return root;
}

function renderStep(step, { onOpenNote, enter = false }) {
  const running = step.state === "running";
  const row = el("li", { class: `ag-row ${running ? "running" : step.state}${enter ? " enter" : ""}` },
    el("span", { class: "ag-row-icon" }, icon(TOOL_ICON[step.tool] || "sparkle", 15)),
    el("span", { class: `ag-row-label${running ? " shimmer-text" : ""}`, text: step.label }));
  if (step.state === "failed" && step.error) row.append(el("span", { class: "ag-row-meta", title: step.error, text: step.error }));
  else if (step.detail && step.tool !== "web_search") row.append(el("span", { class: "ag-row-meta", title: step.detail, text: step.detail }));
  if (step.tool === "web_search" && step.sources?.length) {
    row.append(el("span", { class: "ag-favicons" }, step.sources.slice(0, 6).map((source) =>
      el("a", { class: "ag-favicon", href: source.url, target: "_blank", rel: "noopener noreferrer", title: source.host },
        el("img", { src: `https://www.google.com/s2/favicons?domain_url=${encodeURIComponent(`https://${source.host}`)}&sz=64`, alt: "", width: 18, height: 18, referrerpolicy: "no-referrer" })))));
  }
  /* The document name is already shown in the action detail; a repeated Open
     pill created visual noise and was mistaken for unfinished work. */
  return row;
}

export function renderAgentRun(run, { live, onOpenNote, state = {} } = {}) {
  if (!run || (!run.todos.length && !run.steps.length)) return null;
  if (state.open === undefined) state.open = true;
  state.seenSteps ||= new Set();
  const steps = run.steps.map((step) => {
    const enter = !state.seenSteps.has(step.id);
    state.seenSteps.add(step.id);
    return renderStep(step, { onOpenNote, enter });
  });
  return el("div", { class: "ag-run" },
    run.todos.length ? renderTodo(run.todos, live, state) : null,
    run.steps.length ? el("ul", { class: "ag-steps", "aria-label": "What Clyra did" }, steps) : null);
}
