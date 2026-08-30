# Clyra Notes

Clyra Notes is Clyra's private, local-first study workspace: a block editor, spaced
repetition, practice tests and grounded AI in one document surface. There is no
account, no cloud service and no telemetry — everything lives in `data/notes/`.

## Start

```bash
npm install
npm run dev:source
```

Open `http://127.0.0.1:3000/notes`, or choose **Notes** in Clyra's app launcher. The
Express server deliberately binds to `127.0.0.1`; other devices cannot connect to it.

## The workspace

- **Shell** — resizable sidebar, desktop tabs (drag to reorder, middle-click to close,
  `⌘T` / `⌘W` / `⌘⇧T`), page toolbar and a document canvas. Below 860px the sidebar
  slides over the page from a menu button.
- **Editor** — a real block editor, not a textarea. Every block is a row in `blocks`
  with a stable id, so links, backlinks, AI citations and version history all address
  content precisely. Markdown shortcuts (`# `, `- `, `1. `, `[] `, `> `, `` ``` ``,
  `---`), a slash menu, an inline selection toolbar, drag-to-reorder, indent/outdent,
  multi-level nesting, undo/redo across structural edits.
- **Blocks** — text, three heading levels, bulleted/numbered/to-do/toggle lists,
  toggle headings, quote, callout, divider, code, equation, table, image, video,
  audio, file, PDF, bookmark, embed, columns, child page, page link, breadcrumb,
  table of contents, and study blocks (key term, study summary, learning objective,
  exam checklist, source, lecture transcript).
- **Search** — `⌘K` over page titles and block text, with match excerpts, course
  filters and keyboard navigation.
- **Pages** — icons, covers, favourites, duplicate, move, lock, full width, text size,
  font, automatic version history with restore, and a trash that restores.

## Study

- **Flashcards** use an FSRS-4.5 scheduler (stability, difficulty, lapses, review log)
  rather than SM-2, so the four answer buttons show honest intervals.
- **Practice tests** support multiple choice, multiple response, true/false, short
  answer, fill in the blank, matching, definition and extended response. Objective
  types are marked immediately; short answer and essay are graded by AI against the
  source material, crediting meaning rather than wording.
- Results break down by topic, and every answer links back to the block it came from.

## AI

**Ask Clyra** uses the existing `/api/clyra/chat` provider and `DEEPSEEK_API_KEY`;
Notes does not create a second model integration. AI is reached from Space on an
empty line, `/ai`, a text selection, or the workspace chat.

Generated flashcards, questions and answers carry the page and block they were
derived from, and those references are **validated against the workspace before they
are stored** — a source the model invented is dropped rather than shown. "Show
source" scrolls to the exact block and highlights it.

If `DEEPSEEK_API_KEY` is absent, every AI entry point is hidden rather than failing:
the editor, search, study and tests all work without it.

## Class capture

**Lecture notes** (`/lecture`, or the quick-start chip) start a recording session with
a small status strip — record, pause, stop — and append timestamped transcript
segments to the page as they are recognised. Stopping offers to write clean,
structured notes as a **child page**; the raw transcript is never overwritten.

## Storage, import and export

- SQLite lives at `data/notes/clyra-notes.db` in WAL mode; attachments are written to
  `data/notes/files/` so notes and their files back up together.
- Import Markdown, text, CSV and HTML as pages; other files upload and embed. Paste
  text or a URL to import as-is, or ask AI to structure it.
- Export a page as Markdown, a database as CSV, or the whole workspace with
  **Export all notes** (writes `exports/<Course>/<Title>.md`).
- The pre-block `pages.markdown` column is retained as a safety copy; the migration
  that converted it into blocks is additive and runs once.

## Editing model

Edits apply to the local cache first and persist on a debounce, so typing never waits
on the network. If a save fails the change is kept in memory and retried, and the
toolbar says `Offline` or `Save failed — retrying` instead of losing text.

## Tests

```bash
npm run test:notes
```

Runs the store against a throwaway copy of the workspace database, so migration is
exercised against real data without touching it.

## Configuration

- `PORT` — Notes shares the main Clyra server (default `3000`).
- `DEEPSEEK_API_KEY` — enables AI through Clyra's existing provider.

## Privacy

All note, transcript, source, revision and study data is stored locally. Only an
explicit AI action sends labelled note context to the configured provider. Opening,
typing, searching, reviewing and exporting do not contact an AI provider.
