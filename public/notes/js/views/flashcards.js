/* Flashcards: deck list and the study screen.

   The study screen is deliberately plain — a question, an answer and four
   honest interval labels from the scheduler. No streaks, no confetti. */
import { el, clear, icon, iconButton, menu, modal, toast, confirmDialog, append } from "../dom.js";
import { api } from "../api.js";
import { state, withError, loadWorkspace } from "../state.js";
import { notePicker, withProgress } from "./generation.js";
import { section, row, empty } from "./home.js";
import { formatRelative } from "../app.js";

const RATINGS = [
  { rating: 1, label: "Again", key: "1" },
  { rating: 2, label: "Hard", key: "2" },
  { rating: 3, label: "Good", key: "3" },
  { rating: 4, label: "Easy", key: "4" },
];

const formatInterval = (days) => {
  if (!Number.isFinite(days)) return "";
  if (days < 1 / 24) return `${Math.max(1, Math.round(days * 24 * 60))} min`;
  if (days < 1) return `${Math.round(days * 24)} h`;
  if (days < 30) return `${Math.round(days)} d`;
  if (days < 365) return `${Math.round(days / 30)} mo`;
  return `${(days / 365).toFixed(1)} y`;
};

export function renderFlashcards(host, app) {
  const view = { destroy() { document.removeEventListener("keydown", onKey); } };
  let onKey = () => {};

  const draw = async () => {
    clear(host);
    const scroll = el("div", { class: "page-scroll scroll" });
    const column = el("div", { class: "page-column view-column" });
    scroll.append(column);
    host.append(scroll);

    const [decks, stats] = await Promise.all([
      withError(() => api.get("/api/notes/decks"), "Could not load decks"),
      withError(() => api.get("/api/notes/study/stats"), "Could not load study stats"),
    ]);
    if (!decks) return;
    state.study = stats || state.study;

    append(column, 
      el("div", { class: "view-header" },
        el("h1", { class: "view-title", text: "Flashcards" }),
        el("div", { class: "view-header-actions" },
          el("button", { class: "button", type: "button", onclick: () => newDeck() }, "New deck"),
          state.aiConfigured
            ? el("button", { class: "button primary", type: "button", onclick: () => app.generate("flashcards", {}) }, "Generate from notes")
            : null)),
    );

    const due = stats?.due || 0;
    append(column, section("Due today", due
      ? [row({ icon: "cards", title: `${due} card${due === 1 ? "" : "s"} ready to review`, meta: `${stats.reviewedToday} reviewed today`, onClick: () => study(null) })]
      : [empty("Nothing due right now. New cards are scheduled as you study.")]));

    append(column, section("Decks", decks.length
      ? decks.map((deck) => deckRow(deck))
      : [empty("No flashcards yet.", [
          { label: "Create deck", primary: true, onClick: () => newDeck() },
          state.aiConfigured ? { label: "Generate from notes", onClick: () => app.generate("flashcards", {}) } : null,
        ].filter(Boolean))]));
  };

  const deckRow = (deck) => {
    const node = row({
      icon: "cards",
      title: deck.name,
      badge: deck.due_count ? `${deck.due_count} due` : null,
      meta: `${deck.card_count} card${deck.card_count === 1 ? "" : "s"}${deck.last_reviewed ? ` · ${formatRelative(deck.last_reviewed)}` : ""}`,
      onClick: () => openDeck(deck),
    });
    return node;
  };

  /* Creating a deck asks what it should be built from: an empty deck is
     rarely what anyone wants, and the notes are already right there. */
  const newDeck = () => {
    const nameField = el("input", { class: "input", placeholder: "e.g. Osmosis", "aria-label": "Deck name" });
    const picker = notePicker({ onChange: () => syncPrimary() });
    const countField = el("input", { class: "input", type: "number", min: "1", max: "40", value: "12" });
    let entry;

    const body = el("div", { class: "gen-setup" },
      el("label", { class: "field" }, el("span", { class: "field-label", text: "Deck name" }), nameField),
      el("div", { class: "gen-field" },
        el("span", { class: "field-label", text: "Build from these notes" }),
        picker.node),
      state.aiConfigured
        ? el("label", { class: "field" }, el("span", { class: "field-label", text: "Cards to generate" }), countField)
        : null);

    const cancel = el("button", { class: "button", type: "button", onclick: () => entry.close("cancel") }, "Cancel");
    const empty_ = el("button", { class: "button", type: "button", onclick: () => create([]) }, "Create empty");
    const primary = el("button", { class: "button primary", type: "button", onclick: () => create([...picker.selected]) }, "Create deck");
    const syncPrimary = () => {
      primary.textContent = picker.selected.size && state.aiConfigured ? "Create and generate" : "Create deck";
      primary.disabled = !nameField.value.trim();
    };
    nameField.addEventListener("input", syncPrimary);

    const create = async (pageIds) => {
      const name = nameField.value.trim();
      if (!name) { toast("Give the deck a name", "error"); return; }
      cancel.disabled = true; empty_.disabled = true; primary.disabled = true;
      entry.node.querySelector(".modal-footer").hidden = true;
      const shouldGenerate = pageIds.length > 0 && state.aiConfigured;
      const stages = shouldGenerate
        ? ["Creating the deck", "Reading your notes", "Writing the cards", "Adding them to the deck"]
        : ["Creating the deck"];
      const result = await withProgress(entry.node.querySelector(".modal-body"), {
        title: shouldGenerate ? `Building ${name}` : `Creating ${name}`,
        stages,
        run: async (loader) => {
          const deck = await api.post("/api/notes/decks", { name });
          if (!shouldGenerate) return { deck, added: 0 };
          loader.advance(1);
          const generated = await api.post("/api/notes/ai/flashcards", {
            sources: pageIds.map((pageId) => ({ pageId })),
            deckId: deck.id,
            count: Number(countField.value) || 12,
          });
          loader.advance(2);
          if (!generated?.cards?.length) return { deck, added: 0 };
          const saved = await api.post(`/api/notes/decks/${deck.id}/cards`, { cards: generated.cards });
          loader.advance(3);
          return { deck, added: saved.added };
        },
      }).catch((error) => { toast(error?.message || "Could not create the deck", "error"); return null; });
      entry.close("created");
      if (!result) return;
      await loadWorkspace();
      if (result.added) toast(`Added ${result.added} card${result.added === 1 ? "" : "s"}`);
      openDeck(result.deck);
    };

    entry = modal({ title: "New deck", width: 500, body, footer: [cancel, empty_, primary] });
    syncPrimary();
    queueMicrotask(() => nameField.focus());
  };

  const openDeck = async (deck) => {
    const cards = await withError(() => api.get("/api/notes/cards", { deckId: deck.id }), "Could not load cards");
    if (!cards) return;
    clear(host);
    const scroll = el("div", { class: "page-scroll scroll" });
    const column = el("div", { class: "page-column view-column" });
    scroll.append(column);
    host.append(scroll);

    append(column, 
      el("button", { class: "text-button back-link", type: "button", onclick: draw }, icon("chevron_left", 14), "Flashcards"),
      el("div", { class: "view-header" },
        el("h1", { class: "view-title", text: deck.name }),
        el("div", { class: "view-header-actions" },
          el("button", { class: "button primary", type: "button", disabled: !cards.length, onclick: () => study(deck) }, "Study"),
          el("button", { class: "button", type: "button", onclick: () => editCard(deck, null) }, "Add card"),
          state.aiConfigured
            ? el("button", { class: "button", type: "button", onclick: () => app.generate("flashcards", { deckId: deck.id }) }, "Generate")
            : null,
          iconButton("dots", "Deck actions", (event) => menu(event.currentTarget, [
            { label: "Rename deck", icon: "text", onSelect: () => renameDeck(deck) },
            { label: "Delete deck", icon: "trash", danger: true, onSelect: async () => {
              const ok = await confirmDialog({ title: "Delete deck", message: `"${deck.name}" and its ${cards.length} cards are deleted permanently.`, confirmLabel: "Delete" });
              if (!ok) return;
              await withError(() => api.del(`/api/notes/decks/${deck.id}`), "Could not delete the deck");
              draw();
            } },
          ], { align: "end" })))),
    );

    append(column, el("div", { class: "card-list" }, cards.length
      ? cards.map((card) => el("div", { class: "card-row" },
          el("div", { class: "card-row-text" },
            el("div", { class: "card-front", text: card.front }),
            el("div", { class: "card-back", text: card.back })),
          el("div", { class: "card-row-meta" },
            card.source ? el("button", {
              class: "text-button", type: "button",
              onclick: () => app.openPage(card.source.pageId, { blockId: card.source.blockId }),
            }, icon("link", 13), "Source") : null,
            el("span", { class: "shortcut", text: card.state === 0 ? "New" : `Due ${formatRelative(card.due_at)}` }),
            iconButton("dots", "Card actions", (event) => menu(event.currentTarget, [
              { label: "Edit", icon: "text", onSelect: () => editCard(deck, card) },
              { label: "Delete", icon: "trash", danger: true, onSelect: async () => {
                await withError(() => api.del(`/api/notes/cards/${card.id}`), "Could not delete the card");
                openDeck(deck);
              } },
            ], { align: "end" })))))
      : [empty("This deck has no cards yet.", [
          { label: "Add a card", primary: true, onClick: () => editCard(deck, null) },
          state.aiConfigured ? { label: "Generate from notes", onClick: () => app.generate("flashcards", { deckId: deck.id }) } : null,
        ].filter(Boolean))]));
  };

  const renameDeck = (deck) => {
    const field = el("input", { class: "input", value: deck.name });
    let entry;
    entry = modal({
      title: "Rename deck", width: 400,
      body: el("label", { class: "field" }, field),
      footer: [
        el("button", { class: "button", type: "button", onclick: () => entry.close("cancel") }, "Cancel"),
        el("button", { class: "button primary", type: "button", onclick: async () => {
          const name = field.value.trim();
          if (!name) return;
          await withError(() => api.patch(`/api/notes/decks/${deck.id}`, { name }), "Could not rename");
          entry.close("saved");
          deck.name = name;
          openDeck(deck);
        } }, "Save"),
      ],
    });
  };

  const editCard = (deck, card) => {
    const front = el("textarea", { class: "textarea", placeholder: "Front — the question or prompt" });
    const back = el("textarea", { class: "textarea", placeholder: "Back — the answer" });
    const hint = el("input", { class: "input", placeholder: "Hint (optional)" });
    front.value = card?.front || "";
    back.value = card?.back || "";
    hint.value = card?.hint || "";
    let entry;
    entry = modal({
      title: card ? "Edit card" : "New card", width: 520,
      body: el("div", {},
        el("label", { class: "field" }, el("span", { class: "field-label", text: "Front" }), front),
        el("label", { class: "field" }, el("span", { class: "field-label", text: "Back" }), back),
        el("label", { class: "field" }, el("span", { class: "field-label", text: "Hint" }), hint)),
      footer: [
        el("button", { class: "button", type: "button", onclick: () => entry.close("cancel") }, "Cancel"),
        el("button", { class: "button primary", type: "button", onclick: async () => {
          if (!front.value.trim() || !back.value.trim()) { toast("A card needs a front and a back", "error"); return; }
          const payload = { front: front.value.trim(), back: back.value.trim(), hint: hint.value.trim() || null };
          const result = card
            ? await withError(() => api.patch(`/api/notes/cards/${card.id}`, payload), "Could not save the card")
            : await withError(() => api.post(`/api/notes/decks/${deck.id}/cards`, { cards: [payload] }), "Could not add the card");
          if (!result) return;
          entry.close("saved");
          openDeck(deck);
        } }, card ? "Save" : "Add card"),
      ],
    });
  };

  /* ---- study screen ---- */

  const study = async (deck) => {
    const queue = await withError(
      () => api.get("/api/notes/study/queue", deck ? { deckId: deck.id } : undefined),
      "Could not load the study queue",
    );
    if (!queue) return;
    if (!queue.length) { toast("Nothing is due in this deck yet"); return; }

    let index = 0;
    let revealed = false;
    let shownAt = Date.now();
    const total = queue.length;
    let done = 0;

    clear(host);
    const stage = el("div", { class: "study-stage" });
    host.append(stage);

    const finish = async () => {
      document.removeEventListener("keydown", onKey);
      await loadWorkspace();
      clear(host);
      const scroll = el("div", { class: "page-scroll scroll" });
      const column = el("div", { class: "page-column view-column" });
      scroll.append(column, el("div"));
      host.append(scroll);
      append(column, 
        el("h1", { class: "view-title", text: "Session complete" }),
        el("p", { class: "view-lead", text: `You reviewed ${done} card${done === 1 ? "" : "s"}.` }),
        el("div", { class: "view-header-actions" },
          el("button", { class: "button primary", type: "button", onclick: () => study(deck) }, "Study more"),
          el("button", { class: "button", type: "button", onclick: draw }, "Back to decks")),
      );
    };

    const rate = async (rating) => {
      const card = queue[index];
      if (!card) return;
      done += 1;
      await withError(() => api.post(`/api/notes/cards/${card.id}/review`, { rating, responseMs: Date.now() - shownAt }), "Could not save the review");
      index += 1;
      revealed = false;
      shownAt = Date.now();
      if (index >= queue.length) { finish(); return; }
      paint();
    };

    let reveal = () => {};
    onKey = (event) => {
      if (event.target?.closest?.("input, textarea")) return;
      if (event.key === " " || event.key === "Enter") { event.preventDefault(); reveal(); return; }
      if (event.key === "Escape") { event.preventDefault(); document.removeEventListener("keydown", onKey); draw(); return; }
      if (revealed && ["1", "2", "3", "4"].includes(event.key)) { event.preventDefault(); rate(Number(event.key)); }
    };
    document.addEventListener("keydown", onKey);

    /* A real card that turns over: the two faces share one 3D box, so the
       answer arrives by rotation rather than by swapping text in place. */
    const paint = () => {
      const card = queue[index];
      clear(stage);
      const flipper = el("div", { class: `study-flip${revealed ? " flipped" : ""}` },
        el("div", { class: "study-face front" },
          el("div", { class: "study-face-label", text: "Question" }),
          el("div", { class: "study-question", text: card.front }),
          card.hint ? el("div", { class: "study-hint", text: card.hint }) : null),
        el("div", { class: "study-face back" },
          el("div", { class: "study-face-label", text: "Answer" }),
          el("div", { class: "study-answer-text", text: card.back }),
          card.explanation ? el("div", { class: "study-explanation", text: card.explanation }) : null,
          card.source
            ? el("button", {
                class: "text-button study-source", type: "button",
                onclick: (event) => {
                  event.stopPropagation();
                  document.removeEventListener("keydown", onKey);
                  app.openPage(card.source.pageId, { blockId: card.source.blockId });
                },
              }, icon("link", 13), "Show source")
            : null),
      );
      const grades = el("div", { class: `study-grade${revealed ? " ready" : ""}` });
      const paintGrades = () => {
        clear(grades);
        grades.classList.toggle("ready", revealed);
        append(grades, revealed
          ? RATINGS.map(({ rating, label, key }) =>
              el("button", { class: `grade-key r${rating}`, type: "button", onclick: () => rate(rating) },
                el("kbd", { text: key }),
                el("span", { class: "grade-label", text: label }),
                el("span", { class: "grade-interval", text: formatInterval(card.intervals?.[rating]) })))
          : el("span", { class: "study-reveal-hint" }, "Click the card or press ", el("kbd", { text: "space" }), " to flip"));
      };

      /* Revealing toggles a class on the existing box rather than rebuilding
         it — a freshly built card is already flipped and has nothing to
         rotate from. */
      reveal = () => {
        if (revealed) return;
        revealed = true;
        flipper.classList.add("flipped");
        board.setAttribute("aria-label", "Rate this card");
        paintGrades();
      };
      const board = el("div", {
        class: "study-card-board", role: "button", tabindex: "0",
        "aria-label": revealed ? "Rate this card" : "Show the answer",
        onclick: () => reveal(),
      }, flipper);

      append(stage,
        el("div", { class: "study-top" },
          el("button", { class: "text-button", type: "button", onclick: () => { document.removeEventListener("keydown", onKey); draw(); } }, icon("close", 14), "Exit"),
          el("span", { class: "study-progress", text: `${index + 1} / ${total}` }),
          el("span", { class: "study-deck", text: deck?.name || "All decks" })),
        board,
        /* Scheduling still needs a judgement, so the four grades survive as a
           quiet keyboard row rather than four buttons under every card. */
        grades,
      );
      paintGrades();
      if (!revealed) queueMicrotask(() => board.focus());
    };

    paint();
  };

  draw();
  return view;
}
