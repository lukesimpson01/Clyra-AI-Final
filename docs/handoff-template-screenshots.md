# Hand-off: run all 40 templates, capture real screenshots, finish launch testing

Self-contained brief for a cloud agent. Repo: `https://github.com/lukesimpson01/Clyra-AI-Final`, branch `vibe-coder-polish-and-templates`. Read `AGENTS.md` and `docs/handoff-cloud-agent-remaining-work.md` (section 0, "How the repo works") first.

## 1. What this is and where it goes

**Clyra Code** (a.k.a. Vibe Coder) is the AI-coding workspace inside Clyra (web app + Electron desktop, one codebase). Its **Library** (rail icon → `src/components/clyra-code/TemplateLibrary.tsx`) is a template gallery. It shows **40 starter templates**, each a public GitHub repo, in 8 categories. Clicking **Get** already runs `git clone --depth 1` (pinned commit) into a new Clyra Code project (`lib/clyra-code/library/service.ts` → `cloneTemplateCheckout`, routes in `server.ts` `/api/clyra-code/library/:id/import-plan` and `/import`). That part works and was confirmed in the UI.

The catalogue is `seeds` in `lib/clyra-code/library/registry.ts`. Captures are declared in the `CAPTURED` map in the same file and served from `public/library-shots/<id>-<n>.jpg` at `/library-shots/…`. Card shows `sourceScreenshots[0]`; the detail view shows a carousel of all of them. Only 3 templates have captures: `astrofy` (3), `minipaint` (1), `uptime-kuma` (1, first-run setup screen only). **37 have none** and show a generic fallback image.

## 2. Your tasks (all must be completed)

1. **Capture real screenshots of all 40 apps running** (3–5 each, 1440×900, JPEG q≈82), by cloning, installing, configuring and running each one. Redo `uptime-kuma` so shots show the real dashboard (complete first-run setup), and add `excalidraw` and `actual` (previously skipped; Node-only).
2. **Launch-test every template** exactly as its README documents; record the result.
3. **Update the catalogue** with what you observed: real licence (read `LICENSE`), requirements, ports, build time, and a `status` that reflects reality.
4. **Delete every checkout, container and volume** after capturing (disk-limited); only screenshots and catalogue changes are committed.
5. **Commit and push** to `origin` on this branch (or a child branch + PR).
6. Final: open the Library in the running web app and **screenshot it** (Discover + a detail view with the carousel) at 1440×900 to prove the carousel shows the new images; attach them to the PR description.

Never fake, mock, or stitch a screenshot. If an app genuinely cannot be run, leave it without shots, set the reason in its `warnings`, and list it in the PR. "Cannot run" must be backed by the actual error output.

## 3. Environment

- First: `df -h /`, `docker info`, `node -v`, `go version`, `ruby -v`, `php -v`, `java -version`, `cargo -v`, `python3 -V`. The previous machine had ~2–3 GB free disk, no Postgres/Mongo/Redis/MySQL/PHP/JDK, Ruby 2.6 — that is why 37 were skipped. You need ≥40 GB free; large repos (Twenty, Metabase, NocoDB, Invoice Ninja, OpenHands, Medusa, Cal.com, Plane, Docusaurus monorepo) are 0.5–4 GB cloned, more installed.
- Prefer **Docker / docker compose** for anything needing databases or heavy toolchains (use the project's own compose file or official image). Use throwaway dummy secrets (never real keys). Bind to localhost.
- Work in a scratch dir **outside** the repo (e.g. `/tmp/tpl-work/<id>`); `rm -rf` it and `docker compose down -v` after each app. Process one app at a time.
- Screenshot tool: Playwright (already in `node_modules`). Script pattern:
  ```js
  import { chromium } from "playwright";
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  await p.goto(URL); /* log in / click through setup */ await p.waitForTimeout(2500);
  await p.screenshot({ path: `public/library-shots/${id}-1.jpg`, type: "jpeg", quality: 82 });
  ```
  Drive the real UI to good states: signed in, with realistic demo data (create a sample project/board/chat/document/monitor etc. through the app itself). Avoid empty states, login forms and error pages unless that is genuinely all the app has. No personal data, no real accounts. Check each image by eye (open it) before keeping it.
- Mobile-first or CLI/desktop-only apps: capture the web UI if it has one; Tauri/Flutter/Rust desktop apps (AppFlowy, Cap) need a native build — try, and if the platform cannot build or run them headless, record why.

## 4. Per-app procedure

For each row in section 6, in order:
1. `git clone --depth 1 <clone command>` into scratch. Note the commit.
2. Read the README / docs for the documented install + run path. Follow it literally (that is what "launch-tested as documented" means). Note deviations needed.
3. Install deps, provision services, run migrations/seed, start the app, wait for health.
4. Complete first-run setup (admin user etc.) and add demo content.
5. Capture 3–5 screenshots of distinct meaningful screens; save to `public/library-shots/<id>-<n>.jpg`.
6. Record in a table (put in the PR description): id, commit, install command(s), run command, port, time-to-run, services used, result (ran / partial / failed + exact error), screenshot count.
7. Tear down and delete everything.

Hints (verify; they may be outdated): LibreChat → docker compose (needs Mongo); vercel/chatbot → Postgres + `.env` AI keys (UI renders without a model call; shots of the empty chat + sidebar are acceptable only if real); Perplexica (renamed Vane) → docker compose with SearxNG; OpenHands → Docker image, UI on 3000; bolt.diy → `pnpm i && pnpm dev`; code-server → official install script or Docker; Gitea → single binary/Docker; Hoppscotch → docker compose; NocoDB → Docker, SQLite; Uptime Kuma → `npm ci --omit=dev` + build frontend (or download dist), SQLite; AppFlowy → Flutter desktop (may be impossible headless); Plane → docker compose; WeKan → Docker; ONLYOFFICE → official Docker image (repo is packaging); Cal.com (cal.diy) → Postgres + yarn/turbo; Penpot → docker compose; HyCanvas → npm; miniPaint → `npm i && npm run build`, serve statically; OpenCut → Next.js + Postgres via compose; Cap → Tauri desktop + web (may need native build); Medusa → `create-medusa-app` flow / Postgres; Twenty → docker compose; Chatwoot → docker compose; Invoice Ninja → docker compose (PHP/MySQL); Formbricks → docker compose; Stoat (stoatchat) → Rust + Mongo/Redis (heavy); Pixelfed → docker compose; PeerTube → docker compose; Mastodon → docker compose; Navidrome → Go build or Docker + a few free-licensed music files; nextjs/saas-starter → Postgres + Stripe test keys (dashboard renders without); Astrofy → `npm i && npm run dev`; medusa dtc-starter → needs a running Medusa backend; Ghost → `ghost-cli` or Docker; Docusaurus → the repo is the framework monorepo: instead scaffold the official `npx create-docusaurus` site for the screenshot and say so in `warnings`; Activepieces → docker compose; Umami → Postgres + pnpm build; Actual → `yarn` workspace, `yarn start:browser`; Metabase → Docker image or JAR (JDK 21); Excalidraw → `yarn && yarn start`.

## 5. Catalogue and UI updates (files to edit)

- `lib/clyra-code/library/registry.ts`: add each template to `CAPTURED` as `id: [["id-1.jpg","alt text"], …]` (alt = what the screen shows). Update that seed's description/warnings with verified facts; fix `license` from the actual LICENSE file (`MIT`, `AGPL-3.0`, `GPL-3.0`, `MPL-2.0`, `Apache-2.0`, or `License review` + explanation for mixed/custom). Where a repo was renamed upstream keep the original clone URL (redirects) but mention it.
- Keep screenshots ≤ ~150 KB each (JPEG q 80–85) to keep the repo small; do not commit anything else from the clones.
- Verify in the UI: `npm run dev:source`, open http://localhost:3000 → Vibe Coder → Library. Every card must show its first capture; every detail view must show the carousel of all captures with correct alt text. Fix any UI bug you find in `TemplateLibrary.tsx` (card `SourceVisual`, detail carousel ~line 800).
- Rewrite `tools/clyra-code-library-unit-tests.ts` for the 40-template catalogue (ids unique, 8 categories, GitHub URLs, every `CAPTURED` file exists on disk). Add it to your PR. Run: `npx tsx tools/clyra-code-library-unit-tests.ts`, `npx tsc --noEmit`.

## 6. The 40 templates

| # | id | Category | Name | Clone command | Licence | Needs (unverified) |
|---|---|---|---|---|---|---|
| 1 | `librechat` | AI Chats & Agents | LibreChat | `git clone https://github.com/danny-avila/LibreChat.git` | MIT | TypeScript, Node, MongoDB. Needs MongoDB and your own model API keys. |
| 2 | `vercel-chatbot` | AI Chats & Agents | Vercel AI Chatbot | `git clone https://github.com/vercel/chatbot.git` | License review | TypeScript, Next.js, Postgres. Needs a Postgres database and AI provider keys. Licence is not auto-detected; review it. |
| 3 | `perplexica` | AI Chats & Agents | Perplexica | `git clone https://github.com/ItzCrazyKns/Perplexica.git` | MIT | TypeScript, Next.js, SearxNG. Needs a SearxNG instance and a model provider. The repository has been renamed upstream (Vane). |
| 4 | `openhands` | AI Chats & Agents | OpenHands | `git clone https://github.com/OpenHands/OpenHands.git` | MIT | TypeScript, Python, Docker. Needs Docker and a model API key; very large repository. |
| 5 | `bolt-diy` | AI Chats & Agents | bolt.diy | `git clone https://github.com/stackblitz-labs/bolt.diy.git` | MIT | TypeScript, Remix, Node. Needs your own model provider keys. |
| 6 | `code-server` | Developer Tools | code-server | `git clone https://github.com/coder/code-server.git` | MIT | TypeScript, Node. Needs a built VS Code toolchain; heavy to build locally. |
| 7 | `gitea` | Developer Tools | Gitea | `git clone https://github.com/go-gitea/gitea.git` | MIT | Go, Node. Needs Go and Node to build. |
| 8 | `hoppscotch` | Developer Tools | Hoppscotch | `git clone https://github.com/hoppscotch/hoppscotch.git` | MIT | TypeScript, Vue, Postgres. Self-hosting needs a Postgres database. |
| 9 | `nocodb` | Developer Tools | NocoDB | `git clone https://github.com/nocodb/nocodb.git` | License review | TypeScript, Vue, Node. Licence is custom / mixed — review before distributing. Very large repository. |
| 10 | `uptime-kuma` | Developer Tools | Uptime Kuma | `git clone https://github.com/louislam/uptime-kuma.git` | MIT | JavaScript, Vue, Node, SQLite. Runs with Node; no external services needed. |
| 11 | `appflowy` | Productivity & Collaboration | AppFlowy | `git clone https://github.com/AppFlowy-IO/AppFlowy.git` | AGPL-3.0 | Dart, Flutter, Rust. AGPL licence. Needs Flutter and Rust toolchains. |
| 12 | `plane` | Productivity & Collaboration | Plane | `git clone https://github.com/makeplane/plane.git` | AGPL-3.0 | TypeScript, Next.js, Python, Postgres. AGPL licence. Needs Postgres, Redis and Docker. |
| 13 | `wekan` | Productivity & Collaboration | WeKan | `git clone https://github.com/wekan/wekan.git` | MIT | JavaScript, Meteor, MongoDB. Needs MongoDB and Meteor. |
| 14 | `onlyoffice` | Productivity & Collaboration | ONLYOFFICE Docs | `git clone https://github.com/ONLYOFFICE/DocumentServer.git` | AGPL-3.0 | Shell, Docker. AGPL licence. Distributed as a server image; the repository is mostly packaging. |
| 15 | `cal-diy` | Productivity & Collaboration | Cal.com | `git clone https://github.com/calcom/cal.com.git` | MIT | TypeScript, Next.js, Postgres. Needs Postgres and calendar integrations. The repository is now cal.diy upstream. |
| 16 | `penpot` | Design, Video & Creative | Penpot | `git clone https://github.com/penpot/penpot.git` | MPL-2.0 | Clojure, ClojureScript, Postgres. MPL-2.0. Full-stack deployment (Docker) required. |
| 17 | `hycanvas` | Design, Video & Creative | HyCanvas | `git clone https://github.com/hyscaler/HyCanvas.git` | AGPL-3.0 | TypeScript, React. AGPL licence. A small project; confirm it runs before relying on it. |
| 18 | `minipaint` | Design, Video & Creative | miniPaint | `git clone https://github.com/viliusle/miniPaint.git` | License review | JavaScript. Licence is not auto-detected; review it. Runs as a static site. |
| 19 | `opencut` | Design, Video & Creative | OpenCut | `git clone https://github.com/OpenCut-app/OpenCut.git` | MIT | TypeScript, Next.js. Needs Node and a database for accounts. |
| 20 | `cap` | Design, Video & Creative | Cap | `git clone https://github.com/CapSoftware/Cap.git` | License review | Rust, Tauri, TypeScript. Mixed licence (AGPL and MIT parts) — review. Desktop capture needs native permissions. |
| 21 | `medusa` | Business & SaaS | Medusa | `git clone https://github.com/medusajs/medusa.git` | License review | TypeScript, Node, Postgres. Licence is not auto-detected; review it. Needs Postgres and Redis. |
| 22 | `twenty` | Business & SaaS | Twenty CRM | `git clone https://github.com/twentyhq/twenty.git` | License review | TypeScript, React, NestJS, Postgres. Mixed licence (AGPL and commercial) — review. Needs Postgres and Redis. Very large repository. |
| 23 | `chatwoot` | Business & SaaS | Chatwoot | `git clone https://github.com/chatwoot/chatwoot.git` | License review | Ruby, Rails, Vue, Postgres. Mixed licence (MIT plus enterprise parts) — review. Needs Postgres and Redis. |
| 24 | `invoiceninja` | Business & SaaS | Invoice Ninja | `git clone https://github.com/invoiceninja/invoiceninja.git` | License review | PHP, Laravel, MySQL. Source-available licence — review the terms. Needs PHP and MySQL. |
| 25 | `formbricks` | Business & SaaS | Formbricks | `git clone https://github.com/formbricks/formbricks.git` | License review | TypeScript, Next.js, Postgres. Mixed licence (AGPL plus enterprise parts) — review. Needs Postgres. |
| 26 | `stoat` | Social & Entertainment | Stoat | `git clone https://github.com/stoatchat/stoatchat.git` | License review | Rust, MongoDB. Licence is not auto-detected; review it. Needs MongoDB and Redis. |
| 27 | `pixelfed` | Social & Entertainment | Pixelfed | `git clone https://github.com/pixelfed/pixelfed.git` | AGPL-3.0 | PHP, Laravel, MySQL. AGPL licence. Needs PHP, a database and Redis. |
| 28 | `peertube` | Social & Entertainment | PeerTube | `git clone https://github.com/Chocobozzz/PeerTube.git` | AGPL-3.0 | TypeScript, Node, Postgres, FFmpeg. AGPL licence. Needs Postgres, Redis and FFmpeg. |
| 29 | `mastodon` | Social & Entertainment | Mastodon | `git clone https://github.com/mastodon/mastodon.git` | AGPL-3.0 | Ruby, Rails, Postgres. AGPL licence. Needs Postgres, Redis and Ruby. |
| 30 | `navidrome` | Social & Entertainment | Navidrome | `git clone https://github.com/navidrome/navidrome.git` | GPL-3.0 | Go, React. GPL-3.0 licence. Needs Go and Node to build, and a music library. |
| 31 | `saas-starter` | Websites & Publishing | Next.js SaaS Starter | `git clone https://github.com/nextjs/saas-starter.git` | MIT | TypeScript, Next.js, Postgres. Needs Postgres and Stripe keys for payments. |
| 32 | `astrofy` | Websites & Publishing | Astrofy | `git clone https://github.com/manuelernestog/astrofy.git` | MIT | Astro, Tailwind. Static site; no external services. |
| 33 | `medusa-dtc` | Websites & Publishing | Medusa DTC Starter | `git clone https://github.com/medusajs/dtc-starter.git` | MIT | TypeScript, Next.js. Needs a running Medusa backend. |
| 34 | `ghost` | Websites & Publishing | Ghost | `git clone https://github.com/TryGhost/Ghost.git` | MIT | TypeScript, Node, MySQL. Needs Node and MySQL; email needs a provider. |
| 35 | `docusaurus` | Websites & Publishing | Docusaurus | `git clone https://github.com/facebook/docusaurus.git` | MIT | TypeScript, React. Cloning gives the framework monorepo, not a starter site; very large. |
| 36 | `activepieces` | Automation & Data | Activepieces | `git clone https://github.com/activepieces/activepieces.git` | License review | TypeScript, Angular, NestJS, Postgres. Mixed licence (MIT plus enterprise parts) — review. Needs Postgres and Redis. |
| 37 | `umami` | Automation & Data | Umami | `git clone https://github.com/umami-software/umami.git` | MIT | TypeScript, Next.js, Postgres. Needs Postgres. |
| 38 | `actual` | Automation & Data | Actual Budget | `git clone https://github.com/actualbudget/actual.git` | MIT | TypeScript, Node. Runs with Node; no external services. |
| 39 | `metabase` | Automation & Data | Metabase | `git clone https://github.com/metabase/metabase.git` | License review | Clojure, TypeScript. Mixed licence (AGPL plus commercial) — review. Needs a JDK; very large repository. |
| 40 | `excalidraw` | Automation & Data | Excalidraw | `git clone https://github.com/excalidraw/excalidraw.git` | MIT | TypeScript, React. Runs with Node; no external services. |

## 7. Git

- Commit small, logical commits (e.g. one per category of captures + one for catalogue/test changes). Message trailer: `Co-Authored-By: Claude <noreply@anthropic.com>`.
- `git push origin HEAD` (branch `vibe-coder-polish-and-templates`), then open a PR to `main` with the results table and the final Library screenshots. Never force-push, never commit clones, secrets, `.env` files, or build output.

## 8. Done means

All 40 either have 3–5 real screenshots visible in the Library carousel, or a documented, evidenced reason they cannot run; every launch result is recorded; catalogue licences/requirements are verified; unit test + typecheck pass; checkouts and containers are deleted; everything is pushed; the final Library screenshots are attached.
