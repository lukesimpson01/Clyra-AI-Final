/* Courses and workspace settings. */
import { el, clear, icon, modal, toast, confirmDialog } from "../dom.js";
import { api } from "../api.js";
import { state, loadWorkspace, refreshPages, withError, saveSession } from "../state.js";
import { empty } from "./home.js";

export function openCourses(app) {
  const list = el("div", { class: "course-list" });
  const nameField = el("input", { class: "input", placeholder: "Add a course…" });
  let entry;

  const paint = () => {
    clear(list);
    if (!state.classes.length) { list.append(empty("No courses yet. Courses group pages in the sidebar.")); return; }
    for (const course of state.classes) {
      const count = state.pages.filter((page) => page.class_id === course.id).length;
      list.append(el("div", { class: "course-row" },
        el("span", { class: "course-dot", style: { background: course.color || "var(--accent)" } }),
        el("span", { class: "view-row-title", text: course.name }),
        el("span", { class: "view-row-meta", text: `${count} page${count === 1 ? "" : "s"}` }),
        el("button", { class: "button danger", type: "button", onclick: async () => {
          const ok = await confirmDialog({
            title: "Delete course",
            message: `"${course.name}" is removed. Its ${count} page${count === 1 ? " stays" : "s stay"} in Private.`,
            confirmLabel: "Delete course",
          });
          if (!ok) return;
          await withError(() => api.del(`/api/notes/classes/${course.id}`), "Could not delete the course");
          await loadWorkspace();
          await refreshPages();
          paint();
        } }, "Delete")));
    }
  };

  const add = async () => {
    const name = nameField.value.trim();
    if (!name) return;
    await withError(() => api.post("/api/notes/classes", { name }), "Could not add the course");
    nameField.value = "";
    await loadWorkspace();
    paint();
  };
  nameField.addEventListener("keydown", (event) => { if (event.key === "Enter") { event.preventDefault(); add(); } });

  entry = modal({
    title: "Courses", width: 520,
    body: el("div", {}, list, el("div", { class: "course-add" }, nameField,
      el("button", { class: "button primary", type: "button", onclick: add }, "Add"))),
  });
  paint();
  return entry;
}

export function openSettings(app) {
  const body = el("div", {});
  const aiRow = el("div", { class: "setting-row" },
    el("div", {},
      el("div", { class: "setting-label", text: "Clyra AI" }),
      el("div", { class: "setting-hint", text: state.aiConfigured
        ? "Connected through Clyra's existing model provider."
        : "Not configured. Add DEEPSEEK_API_KEY to .env.local and restart the server." })),
    el("span", { class: `setting-status ${state.aiConfigured ? "on" : "off"}`, text: state.aiConfigured ? "Connected" : "Off" }));

  const storageRow = el("div", { class: "setting-row" },
    el("div", {},
      el("div", { class: "setting-label", text: "Storage" }),
      el("div", { class: "setting-hint", text: "Notes, attachments and study data live in data/notes on this machine. Nothing is uploaded." })),
    el("button", { class: "button", type: "button", onclick: () => app.exportAll() }, "Export all"));

  const motionKey = "clyra-notes:reduce-motion";
  const reduced = localStorage.getItem(motionKey) === "1";
  const motionRow = el("div", { class: "setting-row" },
    el("div", {},
      el("div", { class: "setting-label", text: "Reduce motion" }),
      el("div", { class: "setting-hint", text: "Turn off transitions and animated panels." })),
    el("input", {
      type: "checkbox", checked: reduced,
      onchange: (event) => {
        localStorage.setItem(motionKey, event.target.checked ? "1" : "0");
        document.documentElement.classList.toggle("reduce-motion", event.target.checked);
      },
    }));

  body.append(aiRow, storageRow, motionRow);
  return modal({ title: "Settings", width: 560, body });
}

if (localStorage.getItem("clyra-notes:reduce-motion") === "1") {
  document.documentElement.classList.add("reduce-motion");
}
