/* AI generators. Every generator shows what it produced and lets the student
   edit or drop items before anything is saved. */
import { el, clear, icon, modal, toast, append } from "../dom.js";
import { api } from "../api.js";
import { state, refreshPages, loadWorkspace, withError } from "../state.js";
import { notePicker, withProgress } from "./generation.js";
import { openSearch } from "../search.js";

export async function runGenerator(app, kind, target = {}) {
  if (kind === "lecture") return startLecture(app, target);
  if (kind === "cards-from-mistakes") return saveMistakeCards(app, target.cards || []);
  if (!state.aiConfigured) {
    toast("AI is not configured. Add DEEPSEEK_API_KEY to .env.local and restart the server.", "error");
    return;
  }
  /* Flashcards and tests choose their notes inside their own setup dialog,
     so they no longer ask twice. A study guide still needs one page. */
  const preset = target.pageId ? [{ pageId: String(target.pageId), blockIds: target.blockIds }] : [];
  if (kind === "flashcards") return generateCards(app, preset, target);
  if (kind === "questions") return generateTest(app, preset);
  if (kind === "study-guide") {
    const sources = preset.length ? preset : await resolveSources(target);
    if (!sources) return;
    return generateStudyGuide(app, sources);
  }
}

/* A generator with no page in hand asks which page to work from rather than
   guessing, so nothing is generated against the wrong material. */
function resolveSources(target) {
  if (target.pageId) return Promise.resolve([{ pageId: target.pageId, blockIds: target.blockIds }]);
  return new Promise((resolve) => {
    let picked = false;
    openSearch({
      title: "Generate from which page?",
      onSelect: (page) => { picked = true; resolve([{ pageId: String(page.page_id || page.id) }]); },
      onClose: () => { if (!picked) resolve(null); },
    });
  });
}

async function generateCards(app, sources, target) {
  const preset = new Set((sources || []).map((source) => String(source.pageId)).filter(Boolean));
  const picker = notePicker({ selected: preset, onChange: () => syncPrimary() });
  const countField = el("input", { class: "input", type: "number", min: "1", max: "40", value: "12" });
  const difficulty = el("select", { class: "select" },
    ["mixed difficulty", "easier recall", "harder application"].map((value) => el("option", { value, text: value })));
  const style = el("select", { class: "select" },
    [["", "Mixed types"], ["question and answer", "Question & answer"], ["term and definition", "Term & definition"], ["cloze deletion", "Cloze deletion"]]
      .map(([value, label]) => el("option", { value, text: label })));

  const body = el("div", { class: "gen-setup" },
    el("div", { class: "gen-field" }, el("span", { class: "field-label", text: "Notes to use" }), picker.node),
    el("div", { class: "gen-grid" },
      el("label", { class: "field" }, el("span", { class: "field-label", text: "Cards" }), countField),
      el("label", { class: "field" }, el("span", { class: "field-label", text: "Difficulty" }), difficulty),
      el("label", { class: "field" }, el("span", { class: "field-label", text: "Style" }), style)));

  const cancel = el("button", { class: "button", type: "button", onclick: () => entry.close("cancel") }, "Cancel");
  const primary = el("button", { class: "button primary", type: "button", onclick: () => run() }, "Generate");
  const syncPrimary = () => { primary.disabled = picker.selected.size === 0; };
  let entry;

  const run = async () => {
    const chosen = [...picker.selected].map((pageId) => ({ pageId }));
    if (!chosen.length) return;
    cancel.disabled = true;
    primary.disabled = true;
    entry.node.querySelector(".modal-footer").hidden = true;
    const result = await withProgress(entry.node.querySelector(".modal-body"), {
      title: "Making your flashcards",
      stages: ["Reading your notes", "Choosing what to test", "Writing the cards", "Checking for duplicates"],
      run: async (loader) => {
        loader.advance(1);
        const response = await api.post("/api/notes/ai/flashcards", {
          sources: chosen, deckId: target.deckId || null,
          count: Number(countField.value) || 12,
          difficulty: difficulty.value, style: style.value || undefined,
        });
        loader.advance(3);
        return response;
      },
    }).catch(() => null);
    if (!result?.cards?.length) {
      if (result) toast("No cards were generated. Try notes with more content.", "error");
      entry.close("failed");
      return;
    }
    entry.close("generated");
    reviewCards(app, result.cards, target.deckId || null, chosen);
  };

  entry = modal({ title: "Generate flashcards", width: 520, body, footer: [cancel, primary] });
  syncPrimary();
  queueMicrotask(() => picker.focus());
}

/* Generated cards are reviewed before they enter a deck — the difference
   between a study aid and a pile of unchecked AI output. */
function reviewCards(app, cards, deckId, sources) {
  const kept = new Map(cards.map((card, index) => [index, { ...card }]));
  const list = el("div", { class: "review-list" });
  let entry;

  const paint = () => {
    clear(list);
    for (const [index, card] of kept) {
      const front = el("textarea", { class: "textarea review-field" });
      const back = el("textarea", { class: "textarea review-field" });
      front.value = card.front;
      back.value = card.back;
      front.addEventListener("input", () => { card.front = front.value; });
      back.addEventListener("input", () => { card.back = back.value; });
      append(list, el("div", { class: "review-card" },
        el("div", { class: "review-card-head" },
          el("span", { class: "review-index", text: `${index + 1}` }),
          card.sourcePageId
            ? el("button", { class: "text-button", type: "button", onclick: () => app.openPage(card.sourcePageId, { blockId: card.sourceBlockId }) }, icon("link", 13), "Source")
            : null,
          el("button", { class: "icon-button", type: "button", "aria-label": "Remove card", onclick: () => { kept.delete(index); paint(); } }, icon("close", 14))),
        front, back));
    }
    if (!kept.size) append(list, el("div", { class: "empty-state", text: "No cards left to add." }));
  };

  const deckSelect = el("select", { class: "select" });
  const buildDecks = async () => {
    const decks = (await withError(() => api.get("/api/notes/decks"), "Could not load decks")) || [];
    clear(deckSelect);
    deckSelect.append(el("option", { value: "", text: "New deck…" }));
    for (const deck of decks) deckSelect.append(el("option", { value: deck.id, text: deck.name, selected: deck.id === deckId }));
  };

  const nameField = el("input", { class: "input", placeholder: "New deck name" });
  const sync = () => { nameField.hidden = Boolean(deckSelect.value); };
  deckSelect.addEventListener("change", sync);

  entry = modal({
    title: `Review ${cards.length} generated card${cards.length === 1 ? "" : "s"}`,
    width: 660,
    body: el("div", {},
      el("div", { class: "review-deck" },
        el("label", { class: "field" }, el("span", { class: "field-label", text: "Add to deck" }), deckSelect),
        el("label", { class: "field" }, nameField)),
      list),
    footer: [
      el("button", { class: "button", type: "button", onclick: () => entry.close("discard") }, "Discard"),
      el("button", { class: "button primary", type: "button", onclick: async (event) => {
        const chosen = [...kept.values()].filter((card) => card.front.trim() && card.back.trim());
        if (!chosen.length) { toast("Nothing to add", "error"); return; }
        let deck = deckSelect.value;
        if (!deck) {
          const created = await withError(() => api.post("/api/notes/decks", { name: nameField.value.trim() || "Generated deck" }), "Could not create the deck");
          if (!created) return;
          deck = created.id;
        }
        const result = await withError(() => api.post(`/api/notes/decks/${deck}/cards`, { cards: chosen }), "Could not save the cards");
        if (!result) return;
        entry.close("saved");
        await loadWorkspace();
        toast(`Added ${result.added} card${result.added === 1 ? "" : "s"}`);
        app.openView({ kind: "flashcards" });
      } }, "Add to deck"),
    ],
  });
  buildDecks().then(sync);
  paint();
}

async function saveMistakeCards(app, cards) {
  if (!cards.length) return;
  reviewCards(app, cards, null, []);
}

async function generateTest(app, sources) {
  const preset = new Set((sources || []).map((source) => String(source.pageId)).filter(Boolean));
  const picker = notePicker({ selected: preset, onChange: () => syncPrimary() });
  const countField = el("input", { class: "input", type: "number", min: "1", max: "30", value: "10" });
  const difficulty = el("select", { class: "select" },
    ["mixed difficulty", "easier recall", "harder application"].map((value) => el("option", { value, text: value })));
  const timeField = el("input", { class: "input", type: "number", min: "0", max: "180", value: "0", placeholder: "0 = untimed" });
  const typeBoxes = [
    ["multiple_choice", "Multiple choice", true],
    ["true_false", "True / false", true],
    ["short_answer", "Short answer", true],
    ["fill_blank", "Fill in the blank", false],
    ["multiple_response", "Multiple response", false],
    ["matching", "Matching", false],
    ["essay", "Extended response", false],
  ].map(([value, label, checked]) => {
    const box = el("input", { type: "checkbox", checked, onchange: () => syncPrimary() });
    return { value, box, node: el("label", { class: "check-row" }, box, label) };
  });

  const body = el("div", { class: "gen-setup" },
    el("div", { class: "gen-field" }, el("span", { class: "field-label", text: "Notes to use" }), picker.node),
    el("div", { class: "gen-grid" },
      el("label", { class: "field" }, el("span", { class: "field-label", text: "Questions" }), countField),
      el("label", { class: "field" }, el("span", { class: "field-label", text: "Difficulty" }), difficulty),
      el("label", { class: "field" }, el("span", { class: "field-label", text: "Time limit (min)" }), timeField)),
    el("div", { class: "gen-field" },
      el("span", { class: "field-label", text: "Question types" }),
      el("div", { class: "check-grid" }, typeBoxes.map((row) => row.node))));

  const cancel = el("button", { class: "button", type: "button", onclick: () => entry.close("cancel") }, "Cancel");
  const primary = el("button", { class: "button primary", type: "button", onclick: () => run() }, "Generate");
  const syncPrimary = () => {
    primary.disabled = picker.selected.size === 0 || !typeBoxes.some((row) => row.box.checked);
  };
  let entry;

  const run = async () => {
    const chosen = [...picker.selected].map((pageId) => ({ pageId }));
    const types = typeBoxes.filter((row) => row.box.checked).map((row) => row.value);
    cancel.disabled = true;
    primary.disabled = true;
    entry.node.querySelector(".modal-footer").hidden = true;
    const result = await withProgress(entry.node.querySelector(".modal-body"), {
      title: "Building your test",
      stages: ["Reading your notes", "Picking topics", "Writing questions", "Marking the answers"],
      run: async (loader) => {
        loader.advance(1);
        const questions = await api.post("/api/notes/ai/questions", {
          sources: chosen, count: Number(countField.value) || 10, difficulty: difficulty.value, types,
        });
        if (!questions?.questions?.length) throw new Error("No questions were generated. Try notes with more content.");
        loader.advance(3);
        const sourcePage = state.pages.find((page) => String(page.id) === String(chosen[0].pageId));
        return api.post("/api/notes/tests", {
          title: sourcePage ? `${sourcePage.title || "Practice"} test` : "Practice test",
          pageId: chosen[0].pageId,
          config: { timeLimitMinutes: Number(timeField.value) || 0 },
          questions: questions.questions,
        });
      },
    }).catch((error) => { toast(error?.message || "Could not build the test", "error"); return null; });
    entry.close("generated");
    if (!result) return;
    await loadWorkspace();
    app.openView({ kind: "tests" });
    toast(`Created a test with ${(result.questions || []).length} questions`);
  };

  entry = modal({ title: "Generate a practice test", width: 540, body, footer: [cancel, primary] });
  syncPrimary();
  queueMicrotask(() => picker.focus());
}

async function generateStudyGuide(app, sources) {
  const busy = modal({
    title: null, width: 320,
    body: el("div", { class: "loading-row", style: { padding: "10px 4px" } }, el("span", { class: "spinner" }), "Writing your study guide…"),
  });
  const result = await withError(() => api.post("/api/notes/ai/study-guide", { sources, parentId: sources[0].pageId }), "Could not build the study guide");
  busy.close("done");
  if (!result?.page) return;
  await refreshPages();
  app.openPage(result.page.id);
}

async function startLecture(app, target) {
  const { openLectureRecorder } = await import("./lecture.js");
  openLectureRecorder(app, target);
}
