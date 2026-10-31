# Shorts in Clyra

Clyra's Shorts workspace runs the Shorts app. The app's code is unchanged; only Clyra's side was added to host it.

- `app/` holds the Shorts app: home, projects, fake text, Reddit, Would you rather, AutoClip and the other tools. It is a Vite server with its own API (`server/localApi.js`).
- `openfilm/` holds the advanced editor. It is the OpenFilm Studio fork with the Shorts tools built in: timeline, keyframes, transitions, mixer and the AI chat. The app starts it from `app/server/advancedStudio.js`.
- Clyra starts the app the first time Shorts opens, using `POST /api/shorts-app/start` (`lib/shorts-app/manager.ts`) on port 4173. `src/shorts/ShortsApp.tsx` then shows it in the workspace, with a "← Clyra" button to go back.
- The AI clipper (AutoClip) generates with Clyra's clipper backend, `/api/clipper/upload` and `/api/clipper/start`, which run `clipper-pipeline.py`.
  - The app's server passes those requests on to Clyra (`CLYRA_SERVER`).
  - It uses a bearer token that Clyra gives each launch. Clyra accepts that token for `/api/clipper/*` only.
- The old Shorts app (its UI, fake text, welcome screen and render host) is kept in `.archive/shorts-legacy/`, not deleted.
- `lib/shorts` is still in place. Its helpers (voices, TTS, media, library, project store) are used by the Clyra Editor (`lib/openfilm`), so its routes stay registered.

Setup on a fresh checkout: `npm run shorts:setup`. It installs the app's packages and the editor's (pnpm).
