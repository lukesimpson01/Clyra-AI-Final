/* Shared generation UI: a note picker and a progress-ring loader that the
   flashcard and test flows both transition into, so "set it up" and "watch it
   build" look like one continuous action rather than two dialogs. */
import { el, clear, icon, bloub, append } from "../dom.js";
import { state } from "../state.js";

/* A checkbox list of pages — generation reads from as many notes as you pick,
   which is the whole point of a deck that spans a topic. */
export function notePicker({ selected = new Set(), onChange } = {}) {
  const host = el("div", { class: "note-picker" });
  const search = el("input", { class: "input note-picker-search", placeholder: "Filter notes…", type: "search" });
  const list = el("div", { class: "note-picker-list scroll" });
  const summary = el("div", { class: "note-picker-summary" });

  const pages = () => state.pages
    .filter((page) => page.kind !== "record")
    .sort((a, b) => String(b.updated_at || "").localeCompare(String(a.updated_at || "")));

  /* The initial paint does not notify: callers wire onChange to a handler
     declared after the picker, so firing during construction would reach it
     before it exists. */
  const paintSummary = (notify = true) => {
    summary.textContent = selected.size
      ? `${selected.size} note${selected.size === 1 ? "" : "s"} selected`
      : "Pick at least one note";
    summary.classList.toggle("empty", !selected.size);
    if (notify) onChange?.(selected);
  };

  const paint = () => {
    clear(list);
    const term = search.value.trim().toLowerCase();
    const matches = pages().filter((page) => !term || String(page.title || "").toLowerCase().includes(term));
    if (!matches.length) {
      list.append(el("div", { class: "note-picker-empty", text: term ? "No notes match." : "No notes yet." }));
      return;
    }
    for (const page of matches) {
      const id = String(page.id);
      const course = state.classes.find((entry) => entry.id === page.class_id);
      const box = el("input", {
        type: "checkbox", checked: selected.has(id),
        onchange: (event) => {
          event.target.checked ? selected.add(id) : selected.delete(id);
          row.classList.toggle("checked", event.target.checked);
          paintSummary();
        },
      });
      const row = el("label", { class: `note-pick${selected.has(id) ? " checked" : ""}` },
        box,
        el("span", { class: "note-pick-icon", text: page.icon && !/^https?:|^\//.test(page.icon) ? page.icon : "" },
          page.icon ? null : icon("page", 15)),
        el("span", { class: "note-pick-title", text: page.title || "New page" }),
        course ? el("span", { class: "note-pick-course", text: course.name }) : null);
      list.append(row);
    }
  };

  search.addEventListener("input", paint);
  append(host, search, list, summary);
  paint();
  paintSummary(false);
  return { node: host, selected, focus: () => search.focus() };
}

/* A determinate-looking ring for work whose real progress is unknowable: it
   advances through the named stages and only completes when the work does,
   so it never claims to be finished early. */
export function progressLoader({ title, stages }) {
  const RADIUS = 26;
  const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 64 64");
  svg.setAttribute("class", "progress-ring");
  const track = document.createElementNS(ns, "circle");
  const arc = document.createElementNS(ns, "circle");
  for (const [node, cls] of [[track, "ring-track"], [arc, "ring-arc"]]) {
    node.setAttribute("cx", "32");
    node.setAttribute("cy", "32");
    node.setAttribute("r", String(RADIUS));
    node.setAttribute("fill", "none");
    node.setAttribute("class", cls);
    svg.append(node);
  }
  arc.style.strokeDasharray = String(CIRCUMFERENCE);
  arc.style.strokeDashoffset = String(CIRCUMFERENCE);

  const mark = el("span", { class: "progress-mark" }, bloub(22));
  const label = el("div", { class: "progress-label shimmer-text", text: stages[0] });
  const steps = el("ol", { class: "progress-steps" },
    stages.map((stage) => el("li", { class: "progress-step" },
      el("span", { class: "progress-tick" }, icon("check_square", 12)),
      el("span", { text: stage }))));

  const node = el("div", { class: "progress-loader" },
    el("div", { class: "progress-ring-wrap" }, svg, mark),
    el("div", { class: "progress-title", text: title }),
    label, steps);

  let index = 0;
  let value = 0;
  const setValue = (next) => {
    value = Math.max(0, Math.min(1, next));
    arc.style.strokeDashoffset = String(CIRCUMFERENCE * (1 - value));
  };
  const markDone = (upto) => {
    [...steps.children].forEach((step, position) => step.classList.toggle("done", position < upto));
    [...steps.children].forEach((step, position) => step.classList.toggle("current", position === upto));
  };
  markDone(0);
  setValue(0.06);

  return {
    node,
    /* Each stage claims its share of the ring and creeps within it, so the
       ring keeps moving during a long step without ever reaching the end. */
    advance(stageIndex) {
      index = Math.min(stageIndex, stages.length - 1);
      label.textContent = stages[index];
      markDone(index);
      setValue((index + 0.35) / stages.length);
    },
    creep() {
      const ceiling = (index + 0.9) / stages.length;
      if (value < ceiling) setValue(value + (ceiling - value) * 0.12);
    },
    finish(message = "Done") {
      index = stages.length;
      label.textContent = message;
      label.classList.remove("shimmer-text");
      markDone(stages.length);
      setValue(1);
      node.classList.add("complete");
    },
    fail(message) {
      label.textContent = message;
      label.classList.remove("shimmer-text");
      node.classList.add("failed");
    },
  };
}

/* Runs `work` behind the loader, creeping the ring while it waits. */
export async function withProgress(bodyHost, { title, stages, run }) {
  const loader = progressLoader({ title, stages });
  clear(bodyHost);
  bodyHost.append(loader.node);
  const timer = setInterval(() => loader.creep(), 220);
  try {
    const result = await run(loader);
    clearInterval(timer);
    loader.finish();
    await new Promise((resolve) => setTimeout(resolve, 420));
    return result;
  } catch (error) {
    clearInterval(timer);
    loader.fail(error instanceof Error ? error.message : "Generation failed");
    throw error;
  }
}
