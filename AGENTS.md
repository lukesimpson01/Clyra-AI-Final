# AGENTS.md

## Cursor Cloud specific instructions

Clyra AI is a single local-first AI workspace (Chat, Vibe Coder / "Clyra Code", AI Browser,
AI Clipper, Creator Studio, Study Pal, Voice) served as a Node + Vite web app. There is no
database — state is stored on the local filesystem under gitignored dirs (`projects/`, `output/`, `.cache/`).

### Running the app (core dev service)
- Use `npm run dev:source` (`tsx server.ts`) to run the core app. It serves both the Express API
  and the Vite-middleware frontend at `http://localhost:3000`.
- Do NOT use `npm run dev` in this environment unless you specifically need the design canvas:
  `npm run dev` also spawns OpenPencil (`dev:openpencil`), which requires the Bun runtime plus a
  Rust/`wasm-bindgen`/`wasm-opt` toolchain. Bun is not installed here, so OpenPencil will fail —
  but that failure does not affect the core app started by `dev:source`. OpenPencil only powers the
  `/design` command inside Vibe Coder.
- The server is `tsx`-run and does not hot-reload on `.ts` changes; restart it after backend edits.

### Non-obvious startup notes
- The server prints two harmless warnings at boot that are safe to ignore:
  - `[voice] local pipeline unavailable ...` — the optional Python voice pipeline
    (`tools/setup-voice.sh`, Python 3.11 venv) is not installed. Voice is optional; the browser
    provides a fallback.
  - `[browser] background warmup did not complete ...` / "Please run npx playwright install" — the
    AI Browser needs Playwright's Chromium. Install it with `npx playwright install chromium`. The
    server still starts and serves everything else without it.
- LLM-backed features (Chat, Vibe Coder code generation, browser agent reasoning, study/research)
  require an external `DEEPSEEK_API_KEY`. Copy `.env.example` to `.env.local` and set the key
  (`.env.local` is gitignored). Without the key the app still runs and non-LLM flows work — e.g.
  creating a Vibe Coder project (`POST /api/vibe/projects`) scaffolds a project on disk with no key.
- Health check: `GET http://localhost:3000/api/health` → `{"status":"ok"}`.

### Lint / test / build (no server or API key required)
- Lint: `npm run lint` (`tsc --noEmit`).
- Unit tests (all `tsx`, run standalone): `npm run test:creator`, `test:clipper`, `test:voice`,
  `test:agent-controller`, `test:vibe-runtime`.
- E2E tests that DO need a running server / extras: `npm run test:browser` (needs Playwright Chromium),
  `npm run test:voice-e2e` (needs the voice pipeline). See `package.json` for the full script list.
- Build: `npm run build` (Vite build + esbuild server bundle to `dist/`).
