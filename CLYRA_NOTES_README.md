# Clyra Notes

Clyra Notes is Clyra's private, local-first study workspace. It combines portable Markdown notes, classes, class capture, sources, full-text search, backlinks, revision history, flashcards, and grounded AI without requiring an account or a separate service.

## Start

```bash
npm install
npm run dev:source
```

Open `http://127.0.0.1:3000/notes`, or choose **Notes** in Clyra's app launcher. The Express server deliberately binds to `127.0.0.1`; other devices cannot connect to it.

## Storage, backups, and exports

- SQLite data lives at `data/notes/clyra-notes.db`. SQLite WAL mode protects concurrent autosaves.
- Notes keep revision snapshots whenever their title or Markdown changes.
- **Export notes** in the command palette writes ordinary Markdown to `exports/<Class>/<Title>.md`, including readable YAML frontmatter.
- Back up either `data/notes/` (complete live database) or `exports/` (portable content). Original transcripts remain in the database and are never replaced by final notes.
- This repository does not include telemetry, accounts, cloud storage, or collaboration. Core editing, search, links, classes, review, and export work offline.

## Clyra integrations

**Ask Clyra** uses the existing `/api/clyra/chat` provider and `DEEPSEEK_API_KEY`; Notes does not create a second model integration. The current note is supplied as labelled context, and Clyra is instructed to distinguish student/teacher material from generated explanation. If the API is unavailable, the editor continues to work and presents a recoverable error.

Sources accept a webpage or YouTube URL and preserve its type and original URL beside the note. Clyra's existing AI Clip/YouTube tool remains the media pipeline rather than being duplicated. Attach its results as a source so the original URL and timestamps remain attributable. Web research likewise belongs to the existing Clyra search flow; researched text should be added as a web source before it is incorporated into a note.

## Class Mode

Choose **Start Class**, select a subject, and begin capture. The class window accepts ongoing speech-to-text output (or pasted simulated transcript when microphone transcription is unavailable). Ending class freezes the raw transcript and creates a separate structured Markdown note. Emphasis, definitions, exams, and homework phrases are surfaced in key ideas; the source transcript is not modified.

## Configuration

- `PORT` — Notes shares the main Clyra server (default `3000`).
- `DEEPSEEK_API_KEY` — enables Ask Clyra through Clyra's existing provider.
- Browser JavaScript must be enabled. Markdown rendering uses the existing `marked` dependency; a locally vendored browser build is included, so rendered preview also works while air-gapped.

## Privacy

All note, class, transcript, source, revision, and study data is stored locally. Only an explicit AI action sends the labelled note context to the configured Clyra model provider. Opening, typing, searching, reviewing, and exporting do not contact an AI provider.
