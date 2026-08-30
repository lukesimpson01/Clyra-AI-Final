/* Practice tests: the list, the editable question set, the exam surface and
   the review screen with per-topic breakdown and links back to the source. */
import { el, clear, icon, iconButton, menu, modal, toast, confirmDialog, append } from "../dom.js";
import { api } from "../api.js";
import { state, withError } from "../state.js";
import { section, row, empty } from "./home.js";
import { formatRelative } from "../app.js";

const TYPE_LABELS = {
  multiple_choice: "Multiple choice", multiple_response: "Multiple response",
  true_false: "True / false", short_answer: "Short answer", fill_blank: "Fill in the blank",
  matching: "Matching", definition: "Definition", essay: "Extended response",
};

export function renderTests(host, app) {
  let timer = null;
  const view = { destroy() { clearInterval(timer); } };

  const draw = async () => {
    clearInterval(timer);
    clear(host);
    const scroll = el("div", { class: "page-scroll scroll" });
    const column = el("div", { class: "page-column view-column" });
    scroll.append(column);
    host.append(scroll);

    const tests = await withError(() => api.get("/api/notes/tests"), "Could not load tests");
    if (!tests) return;

    append(column, el("div", { class: "view-header" },
      el("h1", { class: "view-title", text: "Practice tests" }),
      state.aiConfigured
        ? el("button", { class: "button primary", type: "button", onclick: () => app.generate("questions", {}) }, "Generate a test")
        : null));

    append(column, section("Your tests", tests.length
      ? tests.map((test) => row({
          icon: "check_square",
          title: test.title,
          badge: test.best_ratio != null ? `${Math.round(test.best_ratio * 100)}%` : null,
          meta: `${test.question_count} question${test.question_count === 1 ? "" : "s"}${test.attempt_count ? ` · ${test.attempt_count} attempt${test.attempt_count === 1 ? "" : "s"}` : ""}`,
          onClick: () => openTest(test.id),
        }))
      : [empty("No practice tests yet.", state.aiConfigured
          ? [{ label: "Generate from a page", primary: true, onClick: () => app.generate("questions", {}) }]
          : [])]));
  };

  const openTest = async (testId) => {
    const test = await withError(() => api.get(`/api/notes/tests/${testId}`), "Could not load the test");
    if (!test) return;
    clear(host);
    const scroll = el("div", { class: "page-scroll scroll" });
    const column = el("div", { class: "page-column view-column" });
    scroll.append(column);
    host.append(scroll);

    append(column, 
      el("button", { class: "text-button back-link", type: "button", onclick: draw }, icon("chevron_left", 14), "Practice tests"),
      el("div", { class: "view-header" },
        el("h1", { class: "view-title", text: test.title }),
        el("div", { class: "view-header-actions" },
          el("button", { class: "button primary", type: "button", disabled: !test.questions.length, onclick: () => takeTest(test) }, "Start test"),
          iconButton("dots", "Test actions", (event) => menu(event.currentTarget, [
            { label: "Delete test", icon: "trash", danger: true, onSelect: async () => {
              const ok = await confirmDialog({ title: "Delete test", message: `"${test.title}" and its attempts are deleted permanently.`, confirmLabel: "Delete" });
              if (!ok) return;
              await withError(() => api.del(`/api/notes/tests/${testId}`), "Could not delete");
              draw();
            } },
          ], { align: "end" })))),
    );

    append(column, section("Questions", test.questions.map((question, index) =>
      el("div", { class: "question-row" },
        el("span", { class: "question-index", text: `${index + 1}` }),
        el("div", { class: "question-body" },
          el("div", { class: "question-prompt", text: question.prompt }),
          el("div", { class: "question-meta" },
            el("span", { text: TYPE_LABELS[question.type] || question.type }),
            question.topic ? el("span", { text: question.topic }) : null)),
        iconButton("text", "Edit question", () => editQuestion(test, index))))));

    if (test.attempts.filter((attempt) => attempt.finished_at).length) {
      append(column, section("Attempts", test.attempts.filter((attempt) => attempt.finished_at).map((attempt) => row({
        icon: "history",
        title: `${Math.round((attempt.score / (attempt.max_score || 1)) * 100)}%  ·  ${attempt.score} / ${attempt.max_score}`,
        meta: formatRelative(attempt.finished_at),
        onClick: () => reviewAttempt(attempt.id, test),
      }))));
    }
  };

  const editQuestion = (test, index) => {
    const question = test.questions[index];
    const prompt = el("textarea", { class: "textarea" });
    prompt.value = question.prompt;
    const explanation = el("textarea", { class: "textarea" });
    explanation.value = question.explanation || "";
    const choicesField = el("textarea", { class: "textarea", placeholder: "One choice per line" });
    choicesField.value = (question.choices || []).join("\n");
    const answerField = el("input", { class: "input" });
    answerField.value = Array.isArray(question.answer) ? question.answer.join(" | ") : typeof question.answer === "object" && question.answer ? JSON.stringify(question.answer) : String(question.answer ?? "");
    const hasChoices = ["multiple_choice", "multiple_response"].includes(question.type);
    let entry;
    entry = modal({
      title: "Edit question", width: 560,
      body: el("div", {},
        el("label", { class: "field" }, el("span", { class: "field-label", text: "Question" }), prompt),
        hasChoices ? el("label", { class: "field" }, el("span", { class: "field-label", text: "Choices" }), choicesField) : null,
        el("label", { class: "field" }, el("span", { class: "field-label", text: "Answer — separate acceptable answers with |" }), answerField),
        el("label", { class: "field" }, el("span", { class: "field-label", text: "Explanation" }), explanation)),
      footer: [
        el("button", { class: "button danger", type: "button", onclick: async () => {
          const questions = test.questions.filter((_, position) => position !== index);
          await withError(() => api.put(`/api/notes/tests/${test.id}/questions`, { questions: questions.map(serializeQuestion) }), "Could not save");
          entry.close("deleted");
          openTest(test.id);
        } }, "Delete"),
        el("button", { class: "button", type: "button", onclick: () => entry.close("cancel") }, "Cancel"),
        el("button", { class: "button primary", type: "button", onclick: async () => {
          const raw = answerField.value.trim();
          question.prompt = prompt.value.trim();
          question.explanation = explanation.value.trim() || null;
          if (hasChoices) question.choices = choicesField.value.split("\n").map((line) => line.trim()).filter(Boolean);
          question.answer = ["short_answer", "fill_blank", "definition", "multiple_response"].includes(question.type)
            ? raw.split("|").map((part) => part.trim()).filter(Boolean)
            : raw;
          await withError(() => api.put(`/api/notes/tests/${test.id}/questions`, { questions: test.questions.map(serializeQuestion) }), "Could not save");
          entry.close("saved");
          openTest(test.id);
        } }, "Save"),
      ],
    });
  };

  const serializeQuestion = (question) => ({
    id: question.id, type: question.type, prompt: question.prompt, choices: question.choices,
    answer: question.answer, explanation: question.explanation, topic: question.topic,
    points: question.points, sourcePageId: question.source_page_id, sourceBlockId: question.source_block_id,
  });

  /* ---- taking a test ---- */

  const takeTest = async (test) => {
    const attempt = await withError(() => api.post(`/api/notes/tests/${test.id}/attempts`), "Could not start the test");
    if (!attempt) return;
    const responses = {};
    let index = 0;
    const limitSeconds = Number(test.config?.timeLimitMinutes || 0) * 60;
    let remaining = limitSeconds;

    clear(host);
    const stage = el("div", { class: "exam-stage" });
    host.append(stage);

    if (limitSeconds) {
      timer = setInterval(() => {
        remaining -= 1;
        const label = stage.querySelector(".exam-timer");
        if (label) label.textContent = `${Math.floor(remaining / 60)}:${String(Math.max(0, remaining % 60)).padStart(2, "0")}`;
        if (remaining <= 0) { clearInterval(timer); submit(); }
      }, 1000);
    }

    const submit = async () => {
      clearInterval(timer);
      const busy = el("div", { class: "exam-submitting" }, el("span", { class: "spinner" }), "Marking your answers…");
      clear(stage);
      append(stage, busy);
      const result = await withError(() => api.post(`/api/notes/attempts/${attempt.id}/submit`, { responses }), "Could not submit the test");
      if (!result) { openTest(test.id); return; }
      reviewAttempt(attempt.id, test);
    };

    const paint = () => {
      const question = test.questions[index];
      clear(stage);
      append(stage, 
        el("div", { class: "exam-top" },
          el("span", { class: "exam-title", text: test.title }),
          el("span", { class: "exam-progress", text: `Question ${index + 1} of ${test.questions.length}` }),
          limitSeconds ? el("span", { class: "exam-timer", text: `${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, "0")}` }) : null,
          el("button", { class: "button primary", type: "button", onclick: () => confirmSubmit() }, "Finish")),
        el("div", { class: "exam-body" },
          el("div", { class: "exam-prompt", text: question.prompt }),
          questionInput(question, responses)),
        el("div", { class: "exam-nav" },
          el("button", { class: "button", type: "button", disabled: index === 0, onclick: () => { index -= 1; paint(); } }, "Previous"),
          el("span", { class: "exam-dots" }, test.questions.map((_, position) =>
            el("button", {
              class: `exam-dot${position === index ? " current" : ""}${responses[test.questions[position].id] !== undefined ? " answered" : ""}`,
              type: "button", "aria-label": `Question ${position + 1}`,
              onclick: () => { index = position; paint(); },
            }))),
          index === test.questions.length - 1
            ? el("button", { class: "button primary", type: "button", onclick: () => confirmSubmit() }, "Submit")
            : el("button", { class: "button", type: "button", onclick: () => { index += 1; paint(); } }, "Next")),
      );
    };

    const confirmSubmit = async () => {
      const unanswered = test.questions.filter((question) => responses[question.id] === undefined).length;
      if (unanswered) {
        const ok = await confirmDialog({
          title: "Submit test",
          message: `${unanswered} question${unanswered === 1 ? " is" : "s are"} unanswered. Submit anyway?`,
          confirmLabel: "Submit", danger: false,
        });
        if (!ok) return;
      }
      submit();
    };

    paint();
  };

  const questionInput = (question, responses) => {
    const wrapper = el("div", { class: "exam-input" });
    const set = (value) => { responses[question.id] = value; };
    if (question.type === "multiple_choice" || question.type === "true_false") {
      const choices = question.type === "true_false" ? ["True", "False"] : question.choices;
      for (const choice of choices) {
        const id = `c${Math.random().toString(36).slice(2)}`;
        append(wrapper, el("label", { class: "exam-choice", for: id },
          el("input", {
            type: "radio", name: `q${question.id}`, id,
            checked: String(responses[question.id] ?? "").toLowerCase() === String(choice).toLowerCase(),
            onchange: () => set(question.type === "true_false" ? choice.toLowerCase() : choice),
          }),
          el("span", { text: choice })));
      }
      return wrapper;
    }
    if (question.type === "multiple_response") {
      const selected = new Set(responses[question.id] || []);
      for (const choice of question.choices) {
        const id = `c${Math.random().toString(36).slice(2)}`;
        append(wrapper, el("label", { class: "exam-choice", for: id },
          el("input", {
            type: "checkbox", id, checked: selected.has(choice),
            onchange: (event) => {
              event.target.checked ? selected.add(choice) : selected.delete(choice);
              set([...selected]);
            },
          }),
          el("span", { text: choice })));
      }
      return wrapper;
    }
    if (question.type === "matching") {
      const pairs = Object.keys(question.answer || {});
      const options = Object.values(question.answer || {});
      const current = responses[question.id] || {};
      for (const left of pairs) {
        append(wrapper, el("div", { class: "exam-match" },
          el("span", { class: "exam-match-left", text: left }),
          el("select", {
            class: "select",
            onchange: (event) => { current[left] = event.target.value; set({ ...current }); },
          }, el("option", { value: "", text: "Choose…" }), options.map((option) =>
            el("option", { value: option, text: option, selected: current[left] === option })))));
      }
      return wrapper;
    }
    const field = question.type === "essay"
      ? el("textarea", { class: "textarea", style: { minHeight: "180px" }, placeholder: "Write your answer" })
      : el("input", { class: "input", placeholder: "Your answer" });
    field.value = responses[question.id] || "";
    field.addEventListener("input", () => set(field.value));
    append(wrapper, field);
    return wrapper;
  };

  /* ---- reviewing an attempt ---- */

  const reviewAttempt = async (attemptId, test) => {
    const attempt = await withError(() => api.get(`/api/notes/attempts/${attemptId}`), "Could not load the result");
    if (!attempt) return;
    clear(host);
    const scroll = el("div", { class: "page-scroll scroll" });
    const column = el("div", { class: "page-column view-column" });
    scroll.append(column);
    host.append(scroll);

    const percent = Math.round((attempt.score / (attempt.max_score || 1)) * 100);
    const wrong = attempt.answers.filter((answer) => answer.correct === 0);

    append(column, 
      el("button", { class: "text-button back-link", type: "button", onclick: () => openTest(test.id) }, icon("chevron_left", 14), test.title),
      el("h1", { class: "view-title", text: `${percent}%` }),
      el("p", { class: "view-lead", text: `${attempt.score} of ${attempt.max_score} marks · ${attempt.answers.length - wrong.length} of ${attempt.answers.length} correct` }),
    );

    if (attempt.topics.length > 1) {
      append(column, section("By topic", attempt.topics.map((topic) =>
        el("div", { class: "topic-row" },
          el("span", { class: "topic-name", text: topic.topic }),
          el("span", { class: "topic-bar" }, el("span", { class: "topic-fill", style: { width: `${Math.round(topic.ratio * 100)}%` } })),
          el("span", { class: "topic-value", text: `${Math.round(topic.ratio * 100)}%` })))));
    }

    const actions = el("div", { class: "view-header-actions" });
    if (wrong.length) append(actions, el("button", { class: "button", type: "button", onclick: () => retryWrong(test, wrong) }, "Retry incorrect"));
    if (wrong.length && state.aiConfigured) {
      append(actions, el("button", { class: "button", type: "button", onclick: () => cardsFromMistakes(wrong) }, "Flashcards from mistakes"));
    }
    append(actions, el("button", { class: "button", type: "button", onclick: () => takeTest(test) }, "Retake test"));
    append(column, actions);

    append(column, section("Answers", attempt.answers.map((answer, index) => {
      const feedback = parseFeedback(answer.feedback);
      const correct = answer.correct === 1;
      return el("div", { class: `answer-row ${answer.correct === null ? "ungraded" : correct ? "correct" : "incorrect"}` },
        el("div", { class: "answer-head" },
          el("span", { class: "question-index", text: `${index + 1}` }),
          el("span", { class: "answer-prompt", text: answer.prompt }),
          el("span", { class: "answer-score", text: `${round(answer.score)} / ${answer.points}` })),
        el("div", { class: "answer-detail" },
          el("div", {}, el("span", { class: "answer-label", text: "Your answer" }), el("span", { text: displayAnswer(answer.response) || "No answer" })),
          !correct ? el("div", {}, el("span", { class: "answer-label", text: "Correct answer" }), el("span", { text: displayAnswer(answer.expected) })) : null,
          answer.explanation ? el("div", { class: "answer-explanation", text: answer.explanation }) : null,
          feedback?.feedback ? el("div", { class: "answer-explanation", text: feedback.feedback }) : null,
          feedback?.missing_points?.length
            ? el("div", { class: "answer-missing" }, el("span", { class: "answer-label", text: "Missing" }), feedback.missing_points.join("; "))
            : null,
          feedback?.error ? el("div", { class: "ai-error", text: `Could not grade automatically: ${feedback.error}` }) : null,
          answer.source_page_id
            ? el("button", { class: "text-button", type: "button", onclick: () => app.openPage(answer.source_page_id, { blockId: answer.source_block_id }) }, icon("link", 13), "Show source")
            : null));
    })));
  };

  const retryWrong = async (test, wrong) => {
    const ids = new Set(wrong.map((answer) => answer.question_id));
    const subset = { ...test, questions: test.questions.filter((question) => ids.has(question.id)) };
    takeTest(subset);
  };

  const cardsFromMistakes = async (wrong) => {
    const cards = wrong.map((answer) => ({
      front: answer.prompt,
      back: displayAnswer(answer.expected),
      explanation: answer.explanation || null,
      sourcePageId: answer.source_page_id || null,
      sourceBlockId: answer.source_block_id || null,
    }));
    app.generate("cards-from-mistakes", { cards });
  };

  draw();
  return view;
}

const round = (value) => Math.round(Number(value || 0) * 10) / 10;

const displayAnswer = (value) => {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "object") return Object.entries(value).map(([key, item]) => `${key} → ${item}`).join(", ");
  return String(value);
};

const parseFeedback = (raw) => {
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return { feedback: raw }; }
};
