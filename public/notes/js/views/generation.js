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

/* A checklist, not a percentage. The real progress of a generation is
   unknowable, so rather than a bar that lies, each named step reports its own
   state: pending, running, or done. While a long request is in flight the
   steps move on at a reading pace (never past the last one — that only
   completes when the result is really back), an elapsed timer keeps ticking,
   and a small illustration of what is being made works away above them. */
const ART = {
  cards: () => el("div", { class: "gen-art gen-art--cards", "aria-hidden": "true" },
    el("span", { class: "gen-card c1" }, el("i"), el("i")),
    el("span", { class: "gen-card c2" }, el("i"), el("i")),
    el("span", { class: "gen-card c3" }, el("i"), el("i"))),
  test: () => el("div", { class: "gen-art gen-art--test", "aria-hidden": "true" },
    el("span", { class: "gen-sheet" },
      ...[0, 1, 2, 3].map((n) => el("span", { class: `gen-q q${n}` }, el("b"), el("i"))))),
  doc: () => el("div", { class: "gen-art gen-art--doc", "aria-hidden": "true" },
    el("span", { class: "gen-sheet" }, el("span", { class: "gen-h" }), ...[0, 1, 2, 3, 4].map((n) => el("span", { class: `gen-l l${n}` })))),
};
const artFor = (title) => (/flashcard|deck|card/i.test(title) ? "cards" : /test|quiz|question/i.test(title) ? "test" : "doc");

/* How long each step may plausibly take before the next one starts. */
const DWELL_MS = [1400, 4200, 9000, 12000];

export function progressLoader({ title, stages, art }) {
  const rows = stages.map((stage) => {
    const text = el("span", { class: "check-text", text: stage });
    /* An icon for what is being done, not a tick: the running step shimmers, finished ones go quiet. */
    const kind = /read|transcript/i.test(stage) ? "page" : /writ|laying|adding/i.test(stage) ? "pencil" : /check|mark|duplicate|tidy/i.test(stage) ? "search" : "sparkle";
    const row = el("li", { class: "check-step", "data-state": "pending" },
      el("span", { class: "check-icon", "aria-hidden": "true" }, icon(kind, 16)),
      text);
    return { row, text };
  });

  const list = el("ol", { class: "check-steps" }, rows.map((entry) => entry.row));
  const note = el("p", { class: "check-note", text: "" });
  const elapsed = el("span", { class: "check-elapsed" });
  const actions = el("div", { class: "check-actions", hidden: true });
  const node = el("div", { class: "check-loader" },
    (ART[art || artFor(title)] || ART.doc)(),
    el("div", { class: "check-head" },
      el("span", { class: "check-title", text: title }),
      elapsed),
    list, note, actions);

  let index = 0;
  let stepStartedAt = Date.now();
  const startedAt = Date.now();
  /* A step is only ever set once, and always through here: setting the state
     as a data attribute lets the stylesheet own every transition between the
     three looks instead of the script toggling three class names. */
  const paint = () => {
    rows.forEach((entry, position) => {
      const stateName = position < index ? "done" : position === index ? "running" : "pending";
      entry.row.dataset.state = stateName;
      entry.text.classList.toggle("check-shine", stateName === "running");
      entry.text.classList.toggle("shimmer-text", stateName === "running");
    });
  };
  paint();

  const setIndex = (next) => {
    if (next === index) return;
    index = next;
    stepStartedAt = Date.now();
    paint();
  };

  return {
    node,
    advance(stageIndex) {
      setIndex(Math.max(index, Math.min(stageIndex, stages.length - 1)));
    },
    /* Called on a short timer while the request is in flight. */
    creep() {
      const seconds = Math.floor((Date.now() - startedAt) / 1000);
      elapsed.textContent = seconds >= 3 ? `${seconds}s` : "";
      const dwell = DWELL_MS[Math.min(index, DWELL_MS.length - 1)];
      if (index < stages.length - 2 && Date.now() - stepStartedAt > dwell) setIndex(index + 1);
    },
    finish(message) {
      index = stages.length;
      paint();
      node.classList.add("complete");
      note.textContent = message || "Done";
    },
    fail(message, { onRetry, onClose } = {}) {
      rows[Math.min(index, rows.length - 1)]?.row.setAttribute("data-state", "failed");
      rows.forEach((entry) => { entry.text.classList.remove("check-shine"); entry.text.classList.remove("shimmer-text"); });
      note.textContent = message;
      node.classList.add("failed");
      clear(actions);
      actions.hidden = !(onRetry || onClose);
      if (onClose) actions.append(el("button", { class: "button", type: "button", onclick: onClose }, "Close"));
      if (onRetry) actions.append(el("button", { class: "button primary", type: "button", onclick: onRetry }, "Try again"));
    },
  };
}

/* Runs `work` behind the loader. The setup fades out and the loader rises in
   its place; a finished run holds its ticks for a beat before handing over;
   a failed run stays on screen with the reason and a way to try again. */
export async function withProgress(bodyHost, { title, stages, run, art }) {
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const previous = [...bodyHost.children];
  if (previous.length && !reduced) {
    previous.forEach((child) => child.classList.add("gen-leaving"));
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  for (;;) {
    const loader = progressLoader({ title, stages, art });
    clear(bodyHost);
    bodyHost.append(loader.node);
    const timer = setInterval(() => loader.creep(), 250);
    try {
      const result = await run(loader);
      clearInterval(timer);
      loader.finish();
      await new Promise((resolve) => setTimeout(resolve, reduced ? 150 : 650));
      return result;
    } catch (error) {
      clearInterval(timer);
      const message = error instanceof Error ? error.message : "Generation failed";
      const retry = await new Promise((resolve) => loader.fail(message, { onRetry: () => resolve(true), onClose: () => resolve(false) }));
      if (!retry) {
        const failure = error instanceof Error ? error : new Error(message);
        failure.shown = true;
        throw failure;
      }
    }
  }
}
