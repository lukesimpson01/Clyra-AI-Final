# Hand-off prompt: finish the remaining Clyra Code work

You are continuing work on **Clyra**, a combined web + Electron desktop app (one codebase). You are working on **Clyra Code** (also called "Vibe Coder"): an AI coding workspace. Branch: `vibe-coder-polish-and-templates` (everything done so far is committed there). Do not push to `main`; open a PR from this branch or a child branch.

## 0. How the repo works (read first)

- Read `AGENTS.md` at the repo root. UI work follows a design pipeline (design direction → pixel-perfect implementation → visual QA in a real browser at 320/375/768/1024/1440px).
- Web and desktop are **the same app**: one `src/` tree served by `server.ts`. Never fork a screen per platform.
- Run the web app: `npm run dev:source` → http://localhost:3000 (plain web, no auth token needed for POSTs). `npm run dev` also launches Electron. Server-side changes (`lib/`, `server.ts`) need a restart (tsx has no watch). `src/` edits show on browser reload (HMR is off).
- Typecheck: `npx tsc --noEmit`. (There may be an unrelated pre-existing error in `src/components/maps/ClyraMapsWorkspace.tsx`; ignore it.)
- Tests: unit tests are `npx tsx tools/<name>-unit-tests.ts` (see `package.json` `test:*` scripts). UI specs: `CLYRA_URL=http://localhost:3000 npx playwright test -c playwright.clyra-code.config.ts tests/clyra-code/<file>.spec.ts` (needs a running dev server; slow, use `--timeout=150000`).
- `/__dev/agent-actions` (dev-only route, `src/dev-fixtures/agent-actions/AgentActionsHarness.tsx`) renders the Working timeline / plan / change pill with sample data; the Playwright spec `tests/clyra-code/activity.spec.ts` runs against it.
- The sqlite native module switches ABI between `npm run dev:source` (node) and `npm run desktop:dev` (electron). `npm run dev` handles both.

Where Clyra Code lives:
- UI: `src/components/clyra-code/` — `ClyraCodeWorkspace.tsx` (shell + welcome screen), `Sidebar.tsx`, `Composer.tsx`, `Conversation.tsx`, `CodexActivity.tsx` (Working header, activity rows/groups), `activityModel.ts` (pure logic: plan reducer, group labels, tool wording), `PlanCard.tsx`, `RightPanel.tsx` (preview/changes/files), `TemplateLibrary.tsx` (the Library / "template store"), `harness.css` (most Clyra Code styles), `store.ts` (event store, tool classification).
- Chat's own composer (the reference for item 1): `src/components/chat/ClyraComposerShell.tsx`, effort slider `src/components/chat/EffortSlider.tsx`.
- Agent runtime: `lib/deepseek-harness/DeepSeekHarnessRuntimeManager.ts` (DeepSeek harness SDK, JSON-RPC; prompts assembled in `startPrompt`-style method near "narrateNote"/"effortNote").
- Template library backend: `lib/clyra-code/library/registry.ts` (catalogue), `service.ts` (verify + `git clone`), routes in `server.ts` (`/api/clyra-code/library*`). Frontend API: `src/components/clyra-code/api.ts`.
- Design tab = embedded OpenDesign app in `third_party/open-design` (own build: `cd third_party/open-design/apps/web && PATH=~/.nvm/versions/node/v24.15.0/bin:$PATH pnpm build`; theme CSS in `apps/web/public/clyra-design.css`; the daemon caches the HTML shell, so restart it after a rebuild).
- Clyra Notes (separate vanilla JS app) is in `public/notes/` — do not modify unless a task says so; it is the **design reference** for the template gallery (see `public/notes/css/notion.css`, section "Templates: Notion's Marketplace", classes `.nm-*`).

## 1. Remaining tasks

### Task A — Real screenshots for the 40 library templates (largest task)

**Goal:** every template card and detail carousel shows real, good screenshots of the actual app running, taken by cloning, installing and running each one.

**State now:** the catalogue (`lib/clyra-code/library/registry.ts`, `seeds`) has 40 verified GitHub templates in 8 categories. Only 3 have captures (`CAPTURED` map: astrofy, minipaint, uptime-kuma [setup screen only]). Files live in `public/library-shots/<id>-<n>.jpg`, served at `/library-shots/…`. The UI already supports many shots: card uses `sourceScreenshots[0]`, detail view has a carousel of `sourceScreenshots`.

**Do, for each of the 40 templates, one at a time (delete the checkout after each — disk is limited):**
1. `git clone --depth 1 <repo>` into a scratch dir outside the project.
2. Follow the repo's documented install/run steps (README). Provision what it needs: databases (Postgres/MySQL/Mongo/Redis — use Docker if available), toolchains (Go, Rust, Ruby, PHP, JDK), env vars with dummy values where safe. Use the app's own seed/demo data where it exists.
3. Run it, then capture **3–5 good 1440×900 screenshots** of the real running UI (landing/dashboard, a core feature screen, an editor/detail view). Playwright headless Chromium works: `node_modules/playwright`. Log in / complete first-run setup where needed so shots show the real product, not an empty setup form.
4. Save as `public/library-shots/<id>-1.jpg … -n.jpg` (JPEG q≈82), add to `CAPTURED` in `registry.ts` with accurate `alt` text. Keep provenance: captured from a local run of the unmodified upstream source, with the date.
5. Delete the clone and any containers/volumes. Record per template: ran / could not run + the exact reason. Never fabricate or mock a screenshot; if an app cannot be run, leave it without shots (the UI shows "No screenshots yet") and list it in the PR description.

**Environment note:** on the machine this was started on, free disk was ~2 GB and there was no Postgres/Mongo/Redis/MySQL/PHP/JDK, Ruby 2.6 only. You (a cloud agent) should have more room; check `df -h` first. Very large repos (Twenty, Metabase, NocoDB, Invoice Ninja, OpenHands, Medusa, Cal.com, Plane) need the most space; use their documented Docker images if cloning/building from source is impractical, and still record that.

Also: update each template's `warnings`/requirements text in `seeds` with what you actually observed (required services, keys, ports, build time) — currently it is written from general knowledge and unverified. Verify each licence by reading the repo's LICENSE; entries marked `License review` have mixed/custom licences (NocoDB, Twenty, Chatwoot, Invoice Ninja, Formbricks, Metabase, Medusa, Cap, Stoat, vercel/chatbot, miniPaint, Activepieces) — record the real licence in the text. Cal.com, Perplexica, LibreChat, Docusaurus were renamed upstream (cal.diy, Vane, LibreChat-AI, meta/docusaurus); the clone URLs still redirect.

### Task B — "Get" must install and launch (not just clone)

**State now:** clicking **Get** in the Library already runs `git clone --depth 1` pinned to a verified commit into a new project (confirmed in the UI: POST `/api/clyra-code/library/:id/import-plan` then `/import`, handler `get()` in `TemplateLibrary.tsx`, backend `cloneTemplateCheckout` in `service.ts`). It deliberately does **not** install dependencies or run scripts (security design: scan manifests first).

**Do:** after import, offer an explicit "Set up & run" step in the new project (existing Clyra Code flows: terminal dock, preview pane, `api.startRuntime`) that: shows the required services/keys from the template record; installs dependencies with the detected package manager; starts the dev server on a free port and points the preview pane at it; surfaces failures with logs. Keep the existing safety gate (user confirms before install scripts run). Do not auto-run anything without the user's click. Verify with at least 5 templates that need no external services (Astrofy, miniPaint, Excalidraw, Actual Budget, Uptime Kuma) end to end in the UI.

### Task C — Template page UI = Clyra Notes' template gallery

The Library (`TemplateLibrary.tsx`, opened from the rail's Library icon) must look and feel like the Notes templates gallery. A first pass is done (4:3 preview cards, 26px bold page title, section header, 4-column grid, hover Get pill, tech-stack chips). Still to do: category tabs/pills matching Notes' `.nm-*` styling, a Notes-style search field, "See all" per category, featured row per category, detail view with the screenshot carousel matching Notes' detail layout, correct dark-ish/light tokens. Group the 40 templates under the 8 categories in the sidebar. Verify at 1440/1024/768/375 widths. Keep the install ring/Get→Open morph working. Remove now-unused App-Store-style code (`Spotlight`, `RankRow`, `Shelf`) once nothing references it.

### Task D — Composer: copy Clyra Chat's composer 1:1

Compare `ClyraComposerShell.tsx` (Chat) with `Composer.tsx` (Clyra Code) and match Chat's: dimensions, radius, padding, toolbar layout and control order, placeholder style, bottom-docked positioning and width in conversation mode, hover/focus states, multiline growth. Keep all Clyra Code functions (attachments menu, commands like /plan, effort menu, question mode, draft prop, plan dock above it, border beam). The welcome screen layout (blue icon, headline, subtitle, project picker, composer, Recent cards) was **restored to the original** at the user's request — only the composer's look and the beam may change there. Screenshots of both apps side by side at 1440×900 as proof.

### Task E — Border beam polish

`Composer.tsx` wraps the composer in `BorderBeam` (`border-beam` npm package) — blue ("ocean" palette, static colours, `duration=2.6`), active on the welcome screen and while the agent runs. Requirements from the user: **blue only**, **constant speed — must not slow down at corners** (the package's conic-gradient rotation may appear slower along long edges/corners; if so, replace with a custom beam travelling along the border at constant linear speed, e.g. `offset-path`/`offset-distance` or an animated SVG stroke-dash on a rounded rect), only on the welcome screen or while the agent is working. Verify it is clearly visible (currently faint) and never active in an idle conversation.

### Task F — Effort levels: prove they change behaviour

Effort (`low|medium|high`) is passed to `DeepSeekHarnessRuntimeManager` → `createVibePreflight` and now injects an "Effort: low/high" instruction (and changes whether a todo plan is requested). **Not yet verified with a real run.** Run the same non-trivial prompt at Low and High; confirm measurable differences (tool-call count, plan present only at High, verification commands at High, shorter answer at Low); tune the instruction text if the difference is weak; add a unit test for the prompt assembly. Also confirm the effort slider (`EffortSlider.tsx`, shared by Chat and Clyra Code) shows **no per-level icons** (done) and the **ripple** at the top level travels across the fill (done; visually verify at 2×, and that it stops with `prefers-reduced-motion`). Chat uses the same slider — make sure Chat's effort mapping is not broken.

### Task G — Plan list and Working UI: live verification

Built and unit/fixture tested but **never seen in a real agent run**: grouped tool rows, narration between groups, the plan dock above the composer (collapsed by default, expands upward on hover/focus, collapses smoothly on leave), change pill, Git/browser/image/subagent/MCP wording (`activityModel.ts` `describeCall`). Run real tasks in the web app and verify: plan appears/updates from `todo_write`, steps never show "5/5" unless all completed, nothing remounts mid-run, scroll does not fight the user, and manually opened groups stay open. Also still missing from the original spec: worktree and code-review rows (no runtime tool exists — document as a limitation), approvals UI wording, interrupted-run + continue plan persistence, reconnect tests, 500-event performance test, dark-mode check.

### Task H — Sidebar and preview pane checks

Sidebar (`Sidebar.tsx`): Recent (5) + collapsible "All projects" (state in `localStorage` `clyra-code:sidebar-all-open`), 34px rows. Still to test: empty state, narrow/drawer widths, right-click menu anchoring, collapse. Preview pane (`RightPanel.tsx` `BrowserView`): top-right now has only three screen-size buttons, full screen, close; URL pill transparent until hover. Still to do: make the pane match the user's reference (tab strip + address row like a browser: back/forward/reload/inspect, address pill that blends in with no outline until hover), verify fullscreen and close work, and screen-size buttons actually resize the preview.

### Task I — Clean-up and tests

- `tools/clyra-code-library-unit-tests.ts` expects the old catalogue (≥50, `purffle-shorts`); rewrite it for the 40 templates (ids, 8 categories, valid GitHub URLs, no duplicates).
- Update or add Playwright specs for the Library gallery, Get flow (use a small repo like Astrofy), sidebar groups, preview toolbar. Old specs were updated for the new welcome heading ("What do you want to build?" is the heading again — revert my earlier string change in `tests/clyra-code/{library,sidebar,responsive,design-mode}.spec.ts` back to `What do you want to build?` since the original welcome was restored; the library spec's dialog name is `Clyra Library`).
- `FULL_SEEDS` was removed from `registry.ts` when the 40 were added; the earlier 68-entry catalogue is in git history if needed.
- Remove leftover test projects created by Get tests from the `projects/` data directory (dev-source stores data in `./projects`; desktop uses `~/Library/Application Support/Clyra/projects`).

## 2. Rules

- Reuse existing design tokens/components. No new colours, gradients, glows, or cards-in-cards (Apple/Notion-minimal).
- Never fake functionality, screenshots, test results, or plan completion. If something cannot be done, say so explicitly in the PR.
- Preserve the existing diff viewer (`InlineDiffCard`), terminal card (`TerminalCard`), editor and preview internals — only the outer presentation is being changed.
- Respect licences and third-party branding; do not redistribute cloned repos in this repo (screenshots only).
- Verify in a real browser (screenshots at 1440/1024/768/375). Report honestly: what you ran, what passed, what could not be done and why.
- Commit in small logical commits; end each with `Co-Authored-By: Claude <noreply@anthropic.com>`.

## 3. The 40 repositories (clone commands, category, licence, notes)

Source of truth is `seeds` in `lib/clyra-code/library/registry.ts`. All 40 URLs were checked against the GitHub API on 2026-11-10 (exist, not archived).

| # | Category | Template (replaces) | Clone | Licence | Known requirements (unverified) |
|---|---|---|---|---|---|
| 1 | AI Chats & Agents | LibreChat (ChatGPT) | `git clone https://github.com/danny-avila/LibreChat.git` | MIT | TypeScript, Node, MongoDB. Needs MongoDB and your own model API keys. |
| 2 | AI Chats & Agents | Vercel AI Chatbot (Claude) | `git clone https://github.com/vercel/chatbot.git` | License review | TypeScript, Next.js, Postgres. Needs a Postgres database and AI provider keys. Licence is not auto-detected; review it. |
| 3 | AI Chats & Agents | Perplexica (Perplexity) | `git clone https://github.com/ItzCrazyKns/Perplexica.git` | MIT | TypeScript, Next.js, SearxNG. Needs a SearxNG instance and a model provider. The repository has been renamed upstream (Vane). |
| 4 | AI Chats & Agents | OpenHands (Codex, Cursor) | `git clone https://github.com/OpenHands/OpenHands.git` | MIT | TypeScript, Python, Docker. Needs Docker and a model API key; very large repository. |
| 5 | AI Chats & Agents | bolt.diy (Lovable, Bolt) | `git clone https://github.com/stackblitz-labs/bolt.diy.git` | MIT | TypeScript, Remix, Node. Needs your own model provider keys. |
| 6 | Developer Tools | code-server (VS Code) | `git clone https://github.com/coder/code-server.git` | MIT | TypeScript, Node. Needs a built VS Code toolchain; heavy to build locally. |
| 7 | Developer Tools | Gitea (GitHub) | `git clone https://github.com/go-gitea/gitea.git` | MIT | Go, Node. Needs Go and Node to build. |
| 8 | Developer Tools | Hoppscotch (Postman) | `git clone https://github.com/hoppscotch/hoppscotch.git` | MIT | TypeScript, Vue, Postgres. Self-hosting needs a Postgres database. |
| 9 | Developer Tools | NocoDB (Airtable) | `git clone https://github.com/nocodb/nocodb.git` | License review | TypeScript, Vue, Node. Licence is custom / mixed — review before distributing. Very large repository. |
| 10 | Developer Tools | Uptime Kuma (Uptime monitoring) | `git clone https://github.com/louislam/uptime-kuma.git` | MIT | JavaScript, Vue, Node, SQLite. Runs with Node; no external services needed. |
| 11 | Productivity & Collaboration | AppFlowy (Notion) | `git clone https://github.com/AppFlowy-IO/AppFlowy.git` | AGPL-3.0 | Dart, Flutter, Rust. AGPL licence. Needs Flutter and Rust toolchains. |
| 12 | Productivity & Collaboration | Plane (Linear) | `git clone https://github.com/makeplane/plane.git` | AGPL-3.0 | TypeScript, Next.js, Python, Postgres. AGPL licence. Needs Postgres, Redis and Docker. |
| 13 | Productivity & Collaboration | WeKan (Trello) | `git clone https://github.com/wekan/wekan.git` | MIT | JavaScript, Meteor, MongoDB. Needs MongoDB and Meteor. |
| 14 | Productivity & Collaboration | ONLYOFFICE Docs (Google Docs, Office) | `git clone https://github.com/ONLYOFFICE/DocumentServer.git` | AGPL-3.0 | Shell, Docker. AGPL licence. Distributed as a server image; the repository is mostly packaging. |
| 15 | Productivity & Collaboration | Cal.com (Calendly) | `git clone https://github.com/calcom/cal.com.git` | MIT | TypeScript, Next.js, Postgres. Needs Postgres and calendar integrations. The repository is now cal.diy upstream. |
| 16 | Design, Video & Creative | Penpot (Figma) | `git clone https://github.com/penpot/penpot.git` | MPL-2.0 | Clojure, ClojureScript, Postgres. MPL-2.0. Full-stack deployment (Docker) required. |
| 17 | Design, Video & Creative | HyCanvas (Canva) | `git clone https://github.com/hyscaler/HyCanvas.git` | AGPL-3.0 | TypeScript, React. AGPL licence. A small project; confirm it runs before relying on it. |
| 18 | Design, Video & Creative | miniPaint (Photoshop) | `git clone https://github.com/viliusle/miniPaint.git` | License review | JavaScript. Licence is not auto-detected; review it. Runs as a static site. |
| 19 | Design, Video & Creative | OpenCut (CapCut) | `git clone https://github.com/OpenCut-app/OpenCut.git` | MIT | TypeScript, Next.js. Needs Node and a database for accounts. |
| 20 | Design, Video & Creative | Cap (Loom) | `git clone https://github.com/CapSoftware/Cap.git` | License review | Rust, Tauri, TypeScript. Mixed licence (AGPL and MIT parts) — review. Desktop capture needs native permissions. |
| 21 | Business & SaaS | Medusa (Shopify backend) | `git clone https://github.com/medusajs/medusa.git` | License review | TypeScript, Node, Postgres. Licence is not auto-detected; review it. Needs Postgres and Redis. |
| 22 | Business & SaaS | Twenty CRM (HubSpot, Salesforce) | `git clone https://github.com/twentyhq/twenty.git` | License review | TypeScript, React, NestJS, Postgres. Mixed licence (AGPL and commercial) — review. Needs Postgres and Redis. Very large repository. |
| 23 | Business & SaaS | Chatwoot (Intercom) | `git clone https://github.com/chatwoot/chatwoot.git` | License review | Ruby, Rails, Vue, Postgres. Mixed licence (MIT plus enterprise parts) — review. Needs Postgres and Redis. |
| 24 | Business & SaaS | Invoice Ninja (Invoicing, accounting) | `git clone https://github.com/invoiceninja/invoiceninja.git` | License review | PHP, Laravel, MySQL. Source-available licence — review the terms. Needs PHP and MySQL. |
| 25 | Business & SaaS | Formbricks (Typeform) | `git clone https://github.com/formbricks/formbricks.git` | License review | TypeScript, Next.js, Postgres. Mixed licence (AGPL plus enterprise parts) — review. Needs Postgres. |
| 26 | Social & Entertainment | Stoat (Discord) | `git clone https://github.com/stoatchat/stoatchat.git` | License review | Rust, MongoDB. Licence is not auto-detected; review it. Needs MongoDB and Redis. |
| 27 | Social & Entertainment | Pixelfed (Instagram) | `git clone https://github.com/pixelfed/pixelfed.git` | AGPL-3.0 | PHP, Laravel, MySQL. AGPL licence. Needs PHP, a database and Redis. |
| 28 | Social & Entertainment | PeerTube (YouTube) | `git clone https://github.com/Chocobozzz/PeerTube.git` | AGPL-3.0 | TypeScript, Node, Postgres, FFmpeg. AGPL licence. Needs Postgres, Redis and FFmpeg. |
| 29 | Social & Entertainment | Mastodon (Twitter / X) | `git clone https://github.com/mastodon/mastodon.git` | AGPL-3.0 | Ruby, Rails, Postgres. AGPL licence. Needs Postgres, Redis and Ruby. |
| 30 | Social & Entertainment | Navidrome (Spotify) | `git clone https://github.com/navidrome/navidrome.git` | GPL-3.0 | Go, React. GPL-3.0 licence. Needs Go and Node to build, and a music library. |
| 31 | Websites & Publishing | Next.js SaaS Starter (SaaS website) | `git clone https://github.com/nextjs/saas-starter.git` | MIT | TypeScript, Next.js, Postgres. Needs Postgres and Stripe keys for payments. |
| 32 | Websites & Publishing | Astrofy (Portfolio website) | `git clone https://github.com/manuelernestog/astrofy.git` | MIT | Astro, Tailwind. Static site; no external services. |
| 33 | Websites & Publishing | Medusa DTC Starter (Ecommerce storefront) | `git clone https://github.com/medusajs/dtc-starter.git` | MIT | TypeScript, Next.js. Needs a running Medusa backend. |
| 34 | Websites & Publishing | Ghost (Blog and newsletter) | `git clone https://github.com/TryGhost/Ghost.git` | MIT | TypeScript, Node, MySQL. Needs Node and MySQL; email needs a provider. |
| 35 | Websites & Publishing | Docusaurus (Documentation website) | `git clone https://github.com/facebook/docusaurus.git` | MIT | TypeScript, React. Cloning gives the framework monorepo, not a starter site; very large. |
| 36 | Automation & Data | Activepieces (Zapier) | `git clone https://github.com/activepieces/activepieces.git` | License review | TypeScript, Angular, NestJS, Postgres. Mixed licence (MIT plus enterprise parts) — review. Needs Postgres and Redis. |
| 37 | Automation & Data | Umami (Google Analytics) | `git clone https://github.com/umami-software/umami.git` | MIT | TypeScript, Next.js, Postgres. Needs Postgres. |
| 38 | Automation & Data | Actual Budget (Personal finance) | `git clone https://github.com/actualbudget/actual.git` | MIT | TypeScript, Node. Runs with Node; no external services. |
| 39 | Automation & Data | Metabase (Business intelligence) | `git clone https://github.com/metabase/metabase.git` | License review | Clojure, TypeScript. Mixed licence (AGPL plus commercial) — review. Needs a JDK; very large repository. |
| 40 | Automation & Data | Excalidraw (Miro) | `git clone https://github.com/excalidraw/excalidraw.git` | MIT | TypeScript, React. Runs with Node; no external services. |

Templates with captures already: astrofy, minipaint, uptime-kuma (setup screen only).
