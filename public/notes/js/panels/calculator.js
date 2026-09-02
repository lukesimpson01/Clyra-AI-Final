/* The calculator panel: a basic keypad that expands into a scientific one.

   Evaluation goes through the same local parser the editor's inline maths
   uses, so a sum typed here and a sum typed in a note give the same answer,
   and nothing is sent anywhere to work it out. */
import { el, clear, icon, append, toast } from "../dom.js";
import { solveMath } from "../smart-input.js";

const HISTORY_KEY = "clyra-notes:calc-history";
const MODE_KEY = "clyra-notes:calc-mode";

const readHistory = () => {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]").slice(0, 40); } catch { return []; }
};
const writeHistory = (list) => {
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify(list.slice(0, 40))); } catch { /* storage may be full */ }
};

/* Keys are declared, not hand-placed: the scientific pad is the basic pad
   with two extra columns, so both grids stay aligned to the same rhythm. */
const BASIC = [
  ["AC", "clear"], ["(", "text"], [")", "text"], ["÷", "op", "/"],
  ["7", "num"], ["8", "num"], ["9", "num"], ["×", "op", "*"],
  ["4", "num"], ["5", "num"], ["6", "num"], ["−", "op", "-"],
  ["1", "num"], ["2", "num"], ["3", "num"], ["+", "op", "+"],
  ["0", "num"], [".", "num"], ["⌫", "back"], ["=", "equals"],
];

const SCIENTIFIC = [
  ["sin", "fn", "sin("], ["cos", "fn", "cos("], ["tan", "fn", "tan("],
  ["ln", "fn", "ln("], ["log", "fn", "log("], ["√", "fn", "sqrt("],
  ["xʸ", "text", "^"], ["x²", "text", "^2"], ["π", "text", "pi"],
  ["e", "text", "e"], ["!", "text", "!"], ["%", "text", "%"],
];

export function calculatorPanel(app) {
  let expression = "";
  let history = readHistory();
  let scientific = localStorage.getItem(MODE_KEY) === "scientific";

  const display = el("div", { class: "calc-display" });
  const entry = el("input", {
    class: "calc-entry", type: "text", inputmode: "text", spellcheck: "false",
    "aria-label": "Calculation", placeholder: "0",
  });
  const preview = el("div", { class: "calc-preview" });
  const historyList = el("div", { class: "calc-history scroll" });
  const pad = el("div", { class: "calc-pad" });
  const sciPad = el("div", { class: "calc-pad scientific" });

  /* The running answer is shown while you type rather than only on "=", so
     the panel is useful for checking a figure without committing to it. */
  const evaluate = (source) => {
    const text = String(source || "").trim();
    if (!text) return null;
    /* The display uses the typographic operators; the solver wants the
       ASCII ones. */
    return solveMath(text.replace(/\u00d7/g, "*").replace(/\u00f7/g, "/").replace(/\u2212/g, "-")) || null;
  };

  const paintPreview = () => {
    const result = evaluate(expression);
    preview.textContent = result ? (result.kind === "equation" ? result.answer : `= ${result.answer}`) : "";
    preview.classList.toggle("visible", Boolean(result));
  };

  const setExpression = (next) => {
    expression = next;
    entry.value = next;
    paintPreview();
  };

  const commit = () => {
    const result = evaluate(expression);
    if (!result) { if (expression.trim()) toast("That is not something I can work out", "error"); return; }
    const answer = String(result.answer);
    history = [{ expression: expression.trim(), answer }, ...history].slice(0, 40);
    writeHistory(history);
    paintHistory();
    /* A solved equation is a statement, not a number, so it is kept in the
       history but does not replace what you typed. */
    if (result.kind !== "equation") setExpression(answer);
  };

  const press = (label, kind, insert) => {
    if (kind === "clear") { setExpression(""); return; }
    if (kind === "back") { setExpression(expression.slice(0, -1)); return; }
    if (kind === "equals") { commit(); return; }
    setExpression(expression + (insert ?? label));
  };

  const buildPad = (host, keys, className) => {
    clear(host);
    for (const [label, kind, insert] of keys) {
      host.append(el("button", {
        class: `calc-key ${kind}${className ? ` ${className}` : ""}`, type: "button",
        onclick: () => { press(label, kind, insert); entry.focus(); },
      }, label));
    }
  };

  const paintHistory = () => {
    clear(historyList);
    if (!history.length) {
      historyList.append(el("div", { class: "calc-history-empty", text: "Nothing worked out yet." }));
      return;
    }
    for (const item of history) {
      historyList.append(el("button", {
        class: "calc-history-row", type: "button",
        title: "Use this answer",
        onclick: () => { setExpression(item.answer); entry.focus(); },
      },
        el("span", { class: "calc-history-expression", text: item.expression }),
        el("span", { class: "calc-history-answer", text: item.answer })));
    }
  };

  entry.addEventListener("input", () => { expression = entry.value; paintPreview(); });
  entry.addEventListener("keydown", (event) => {
    if (event.key === "Enter") { event.preventDefault(); commit(); }
    if (event.key === "Escape") { event.preventDefault(); setExpression(""); }
  });

  const modeToggle = el("button", {
    class: "calc-mode", type: "button",
    onclick: () => {
      scientific = !scientific;
      localStorage.setItem(MODE_KEY, scientific ? "scientific" : "basic");
      sciPad.hidden = !scientific;
      modeToggle.classList.toggle("on", scientific);
      modeToggle.querySelector("span").textContent = scientific ? "Scientific" : "Basic";
    },
  }, icon("equation", 13), el("span", { text: scientific ? "Scientific" : "Basic" }));
  modeToggle.classList.toggle("on", scientific);

  const insertIntoNote = el("button", {
    class: "calc-insert", type: "button",
    title: "Put the calculation and its answer into the page you are on",
    onclick: async () => {
      /* After "=" the entry holds the answer, so inserting what is on screen
         would write "21 = 21". The last committed calculation is what the
         reader means by "this one". */
      const typed = expression.trim();
      const recent = history[0];
      const useRecent = recent && typed === recent.answer;
      const source = useRecent ? recent.expression : typed;
      const result = useRecent ? { kind: "calculation", answer: recent.answer } : evaluate(typed);
      if (!result || !source) { toast("Nothing to insert yet", "error"); return; }
      const line = result.kind === "equation" ? `${source}  \u2192  ${result.answer}` : `${source} = ${result.answer}`;
      const inserted = await app.insertTextIntoCurrentPage?.(line);
      toast(inserted ? "Added to the page" : "Open a note to insert into it", inserted ? undefined : "error");
    },
  }, icon("plus", 13), "Insert into note");

  append(display, entry, preview);
  buildPad(pad, BASIC);
  buildPad(sciPad, SCIENTIFIC, "sci");
  sciPad.hidden = !scientific;
  paintHistory();
  paintPreview();

  const node = el("div", { class: "calc-panel" },
    el("div", { class: "calc-head" }, modeToggle, insertIntoNote),
    display,
    sciPad,
    pad,
    el("div", { class: "calc-history-head" },
      el("span", { text: "History" }),
      el("button", {
        class: "text-button", type: "button",
        onclick: () => { history = []; writeHistory(history); paintHistory(); },
      }, "Clear")),
    historyList);

  return { node, focus: () => entry.focus() };
}
