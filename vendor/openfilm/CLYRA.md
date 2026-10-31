# Clyra Editor (vendored OpenFilm Studio)

This folder is a modified copy of [OpenFilm](https://github.com/openfilm/openfilm) (`packages/openfilm`, MIT, see
`LICENSE`). Clyra runs it as a local child process (`lib/openfilm/manager.ts`) and frames it in Shorts.

Changes from upstream:

- Light theme by default, with Clyra blue as the accent (`studio/ui/src/globals.css`, `index.html`, `settings/theme.ts`).
- Renamed "Clyra Editor" in the UI and the OpenFilm logo replaced (the OpenFilm name and logo are trademarks, see `TRADEMARK.md`).
- `studio/server/providers/clyra.mjs`: a provider that serves speech-to-text (Whisper), voice-over (Creator voices) and
  subtitle translation through Clyra's server (`lib/openfilm/routes.ts`). `keys.mjs` selects it by default when Clyra starts the editor.
- `studio/ui/src/App.tsx`: tells the hosting frame which project is open.
- Update checks and the desktop-app/CLI onboarding are unused.

Setup: `npm run editor:setup` (installs and builds the UI). The built UI in `studio/ui/dist` is committed.
