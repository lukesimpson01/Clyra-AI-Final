# Clyra — agent instructions

## UI / frontend pipeline (mandatory)

Any task that creates or visibly changes UI in this repo must run the
three-step design pipeline, in order, before being declared done:

1. **design-director** — first, for any substantial UI change. Decide the
   visual direction, tokens, hierarchy and motion before writing markup.
2. **pixel-perfect-ui-engineer** — during implementation. Reuse existing
   tokens/components, CSS Grid/Flexbox, real states, a11y, reduced-motion,
   verify at 320/375/768/1024/1440px.
3. **visual-qa-and-refinement** — before completion. Run the app, inspect it
   in a real browser, screenshot at the required widths, fix defects, recheck
   (max ~3 repair cycles), report honestly.

Load each with the `skill` tool when its stage starts. Tiny in-kind tweaks
that match an existing pattern still get a one-line design decision note and
a visual check.

Backend-only tasks skip this pipeline and rely on unit tests instead.

## Web ⇄ Desktop: single source of truth (read this before UI work)

The web app and the Electron desktop app are **the same app**. There is no
separate desktop frontend. Both are served from the same `src/` tree by the
same `server.ts`:

- **Web** — `npm run dev` serves `src/` live on `http://localhost:3000`.
- **Desktop** — `npm run desktop:dev` launches Electron, which spawns
  `tsx server.ts` (dev mode) and loads `http://127.0.0.1:31415`.

In development both use Vite middleware mode, so **any edit to `src/` (or
`index.css`) is served immediately to both the web app and the desktop app —
no rebuild, no copy, no separate desktop code to keep in sync.**

Only the packaged desktop build differs: `desktop:prepare` / `desktop:build`
serve the compiled `dist/` folder, so run `npm run build` (Vite build) before
packaging or shipping a desktop binary. Day-to-day dev work never needs this.

Two things to remember:
1. Never create web-only or desktop-only forks of a screen/component. Put it
   in `src/` once and both surfaces get it.
2. The desktop dev service runs Vite with `hmr:false` (`server.ts`), so an
   already-open desktop window won't hot-reload — reload the window (or
   restart `desktop:dev`) to see the latest changes.

## Verification commands

- `npm run lint` — `tsc --noEmit` typecheck
- `npm run dev` — full stack on `http://localhost:3000`
- `npm run desktop:dev` — Electron desktop app (dev, live `src/`, port 31415)
- `npx playwright test -c playwright.clyra-code.config.ts` — UI specs against a running dev server (`CLYRA_URL` overrides the base)
