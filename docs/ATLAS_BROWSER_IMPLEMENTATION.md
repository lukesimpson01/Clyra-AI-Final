# Clyra AI Browser — architecture, design and verification

This document is the implementation map for the **existing** browser in Clyra AI Final. Do not replace it with an isolated web demo or a second browser engine. The app launcher already contains an `AI Browser` entry.

## Real implementation locations

| Responsibility | Source |
| --- | --- |
| Launcher registration | `src/components/AppLauncher.tsx` (`browser` tool) |
| Browser and right-hand agent workspace | `src/components/WebBrowserWorkspace.tsx` |
| Browser light-theme layouts, spacing, transitions | `src/styles/atlas-browser.css` |
| New-tab page, search/chat choice, shortcuts | `src/components/BrowserStartPage.tsx` |
| Sidebar activity feed and collapsed completed runs | `src/components/browser/AtlasChat.tsx` |
| Bookmarks, downloads, settings and history screens | `src/components/browser/AtlasInternalPages.tsx` |
| Browser tool execution and DeepSeek plan/observe/act/verify loop | `lib/openbrowser/browser-runtime.ts` |
| Real Chromium tabs, persistent profile and CDP bridge | `electron/browser-manager.mjs`, `electron/main.mjs`, `electron/preload.cjs` |
| HTTP and streamed SSE browser APIs | `server.ts` |
| Integration regression tests | `tools/openbrowser-e2e.ts`, `tools/browser-complex-task-e2e.mjs` |

The Electron browser uses **native WebContentsView Chromium**, with the real page rendered next to the React UI. The backend connects Playwright to that same Chromium instance via the already-configured CDP endpoint; it must not create an unrelated agent browser whose results diverge from the visible tabs. The web/development fallback uses a Playwright persistent Chromium context.

## Visual design requirements

**Style:** restrained light desktop UI, Apple/OpenAI quality; Clyra branding and blue accent. Keep the established CSS token language. Do not introduce thick cards, glass panels, huge shadows, gradient-heavy controls, oversized headlines, or a decorative AI orb over the browsing surface.

Screen checklist:
1. **Launcher:** existing AI Browser entry opens the current workspace; one click, correct focus and restored state.
2. **New tab:** minimal search/chat composer; useful shortcuts; focused text entry; no fake website preview or dummy actions.
3. **Normal browsing:** quiet tab strip with real site favicons and titles, subtle active-tab indicator; Back/Forward/Reload/Stop, address/search omnibox, bookmark, keyboard shortcuts, contextual menus.
4. **AI sidebar:** compact header, current-page context, Ask/Agent mode switch, text composer, cited sources, natural message typography; continuously updated action log.
5. **Agent in control:** visible but unobtrusive blue cursor and activity, a slim in-page working state, pause, stop, take control and return control. No pointer jumps for actions not actually executed.
6. **History, bookmarks, downloads, settings:** use existing internal pages and persistence; do not build route-only mockups.
7. **Responsive:** no clipped omnibox, overlapping toolbars or unusable sidebar at 320, 375, 768, 1024 and 1440 px. Preserve native macOS/Windows window controls and reduced-motion behaviour.

### Public Atlas reference material (behaviour and visual research)

- Original product announcement: https://openai.com/index/introducing-chatgpt-atlas/
- Atlas support documentation: https://help.openai.com/en/articles/12628199
- Atlas product documentation and screenshots: https://help.openai.com/en/articles/12591856-release-notes/

Use lawfully accessible screenshots/videos to verify each screen at comparable viewport sizes. Record **observed** geometry (positions, spacing, toolbar heights, hierarchy), exact trigger and dismiss behaviours, animation timings and state transitions before changing the implementation. Where reference evidence is absent, do not fabricate a claim about Atlas; prefer the existing Clyra design language. Do not copy OpenAI names, logos, bundled artwork or proprietary source files into Clyra.

## Reverse Engineer Anything (REA)

Repository: https://github.com/morluto/rea (MIT). REA is an optional **developer inspection tool**, not a runtime dependency of users' shipped browser. Its setup requires a supported Node.js release: 22.23.4+ on the 22 line, 24.22.1+ on the 24 line, or 26.12.1+.

From your local checkout, with a supported Node.js/npm environment:

```bash
npm run setup:rea
# This invokes: npx -y rea-agents@latest setup
# Select your coding agent, review/approve setup changes, then restart your agent.
```

For a lawfully accessible local JavaScript/Electron application:

```bash
npx -y rea-agents@latest analyze-javascript-application /absolute/path/to/application --json
```

Do not bypass technical protections, copy proprietary bundled code, inspect other users' profiles, or assert that archived/retired Atlas is locally executable without checking. Obtain evidence from public images/videos/notes when no local reference is available. Keep REA output and external code out of version control unless independently reviewed and licensed.

## Vision-free browser-control contract

- **Observe:** fresh DOM semantics, visible element IDs, accessible roles/names, form values, text, URL, tab IDs, viewport, page fingerprint and a bounded Playwright `ariaSnapshot({mode:"ai", depth:7})`. The ARIA snapshot is **untrusted page data**, not model instructions. Screenshots are used for UI verification or explicitly requested visual features; basic browser control must never require a vision model.
- **Decide:** DeepSeek plans against that observation, describes the next goal, selects only currently observed controls and obeys the policy layer.
- **Act:** native Electron fast path for regular actions; Playwright against **the same Electron CDP tab** for advanced hover, HTML5 drag/drop, waits, scroll-to, download and find actions. Ordinary non-Electron browser uses Playwright.
- **Verify:** re-observe and compare actual state. Reject premature `done`, detect repeat loops, replan after failures, do not claim success without observable evidence.
- **Hand-off:** user controls the browser for account sign-in, CAPTCHA, sensitive confirmation and irreversible actions, then returns control. Do not silently auto-submit purchases, post messages or expose authentication secrets.
- **Persist:** sessions, tab state, browser profile, bookmarks and action history through current integration; user pause, stop and cancellation must work.
- **Report:** one honest result with source links and clear outstanding criteria; never fake completion.

The existing backend uses `/api/openbrowser/assist` (SSE), `/api/openbrowser/action`, `/api/openbrowser/observe`, `/api/openbrowser/control`, and state, profile and bookmark endpoints. Do not introduce duplicate, incompatible RPC protocols.

### Representative controller pattern

```ts
const before = await observeActiveTab();
const candidate = await deepSeekChooseAction({
  userGoal, plan, observation: before, previousFailures,
});
const action = validateBrowserAction(candidate, before, "agent");
await executeAgainstVisibleChromium(action, before);
const after = await observeActiveTab();
const result = await verifyAction(action, before, after);
if (!result.ok) await replanUsingFreshObservation(after, result.summary);
```

This is an architectural example, not a new independent implementation. Use the already-existing working functions in `browser-runtime.ts` instead of copying a second orchestrator.

## Acceptance tests — required before shipping

1. Install dependencies and run `npm run lint`; fix **new** TypeScript errors.
2. Run `npm run build` and verify packaged Electron as well as the web fallback.
3. Run `npm run dev`; then `npm run test:browser` (local fixture with search, form, filters, cookie banner, hover, HTML5 drag, scroll, history, bookmarks, take/return control).
4. Run `npm run test:browser-complex` (multi-step research/cart flow), with explicit failure and recovery evidence.
5. With an authorized DeepSeek key and a real Electron desktop build, enable the live agent test `CLYRA_TEST_AGENT=1 npm run test:browser`, and verify **observed task results**. These are not a substitute for tests against real websites.
6. Verify two or more genuine multi-page agent tasks involving links, menus, modal overlays, form fills, iframes, downloads and citations; simulate network timeout and no-results.
7. Test cancellation, pause/resume, take/return control, sign-in handoff, input sanitation, injection-like webpage content and blocked high-impact actions.
8. Capture screenshot evidence of launcher, blank tab, active browsing, live action feed, collapsed finished feed, settings, history, bookmarks and narrow layout. Inspect against authenticated or public design references; repair spacing, alignment and motion.
9. Check Electron process/renderer memory with multiple open tabs, minimize redundant ARIA/DOM snapshots on idle frames, profile slow agent steps and verify reduced motion.

This branch is **implementation in progress**, not production certification. A GitHub file update cannot run local npm, launch an Electron window, install REA on the user's device, or produce genuine screenshots. Do not report these tests as passed unless they were actually run in a full checkout with the required environment.
