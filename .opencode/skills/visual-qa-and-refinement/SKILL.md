---
name: visual-qa-and-refinement
description: Mandatory visual inspection before declaring UI work done. Start the app, open it in a real browser, capture screenshots at 320/375/768/1024/1440px, check console errors and broken assets, inspect every page and interaction, fix defects and recheck with a bounded loop, then report honestly what was and was not verified. Use AFTER UI implementation — final QA, "does it look right", screenshot checks, layout regressions.
---

# Visual QA & Refinement

Compiling code is not visual proof. Run this skill before declaring ANY UI
task complete.

## In this repo

- `npm run dev` — starts the full stack on `http://localhost:3000` (the
  Vibe Coder workspace opens from the "Vibe Coder" entry on the home screen).
- `npx playwright test -c playwright.clyra-code.config.ts` — UI specs against
  a running dev server (`CLYRA_URL` overrides the base URL).
- `npm run lint` — `tsc --noEmit` typecheck.

## Procedure

1. Start the app with the appropriate command and confirm it actually runs.
2. Open it in a real browser (Playwright or equivalent). Inspect the rendered
   page — never judge from source alone.
3. Capture screenshots at **320, 375, 768, 1024, 1440** px.
4. Inspect every important page and interaction: navigation, forms, menus,
   dialogs, responsive behavior, hover/focus states.
5. Check console errors, failed network requests, broken assets, runtime
   exceptions.
6. Look for overlapping elements, clipping, inconsistent spacing, alignment
   drift, wrong typography, poor contrast, awkward wrapping, empty regions.
7. Fix concrete issues found, then re-inspect.

## Bounded correction loop

Max ~3 focused repair cycles. If a blocker persists, say so explicitly: state
what remains unverified. Never loop endlessly or change things randomly to
look productive.

## Honest reporting

- Never claim tests, browser checks or screenshots succeeded unless they ran.
- If browser automation is unavailable, run the strongest static + runtime
  checks available and clearly report the limitation.
- Assess against the approved design brief / design system when no reference
  image exists.
