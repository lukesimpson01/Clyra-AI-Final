# Clyra JARVIS 3.0 baseline audit

Audit date: 15 October 2026 (Australia/Sydney)

## Inputs and source identity

| Input | Role | SHA-256 / revision |
| --- | --- | --- |
| `/Users/lukesimpson/Documents/Coding Projects/Clyra-AI-Final` | Authoritative working product | `870bc3a75717dd9e3043f2b4826fdbb8bf0f3238` (working tree is newer) |
| `/Users/lukesimpson/Downloads/AI Core Console(2).html` | Spatial composition and interaction reference | `1279b33f241b38c1e99061aaf84a0ee4e98d068d48404edeb3791232e465b378` |

The reference HTML is 400,499 bytes and 3,952 lines. Its inline JavaScript parses successfully. It is a tightly coupled standalone prototype, not a safe production runtime to mount unchanged.

## Git safety boundary

The current branch is `cursor/computer-agent-take-control-fb96`. The checkout was already highly active before this remaster: 181 tracked files differ from HEAD (18,220 insertions, 23,272 deletions), with 312 status entries (96 modified/other, 85 deleted, 131 untracked). Those changes are treated as user work. This pass does not reset, stash, rebase, switch branches, or restore deleted paths.

A clean worktree created from HEAD would omit the working tree that currently contains the meaningful Chat, Maps, Voice, Browser, Clyra Code and agent-runtime implementation. For that reason the UI migration is intentionally additive and narrowly integrated.

## Privacy and repository hygiene finding

The checkout contains browser-profile databases and local runtime state, including tracked cookie/login/history databases, trust-token/passkey state, `data/google-web-tokens.json`, SQLite/WAL files, local projects, generated media and caches. These must not be copied into a legacy snapshot, distributable, installer, test fixture, or source archive. The instruction to preserve/copy sources applies to application source and the supplied HTML—not credentials, browser profiles, databases, user projects, caches, or `.env.local`.

This is a release-blocking repository-hygiene issue until affected paths are removed from distributable tracking and any exposed credentials are rotated by the owner.

## Existing architecture

- React 19, TypeScript 5.8, Vite 6, Tailwind 4
- Electron 43 desktop shell with a sandboxed renderer and preload bridge
- Express same-origin service (`server.ts`) with local-only APIs and WebSockets
- Motion, Three.js, MapLibre, Turf, Rapier, Monaco, xterm and FFmpeg-based media tools
- SQLite-backed missions/automations/notes and persisted Vibe projects
- Local whisper.cpp / Python voice pipeline where installed
- Hermes, Agent Zero, OpenCode, OpenPencil, OpenDesign and Eye adapters with independently reported health

Primary UI path:

```text
src/main.tsx
  -> src/App.tsx
  -> shared shell and lazy workspaces
  -> same-origin /api/* routes
  -> Electron preload/native managers when available
```

## Real read models available to the Command Centre

The spatial home can be populated without new mock data or new server routes:

- `/api/health`
- `/api/agent/runtime-status`
- `/api/opencode/status`
- `/api/speech/status`
- `/api/vibe/projects`
- `/api/cowork/tasks`
- `/api/agent/automations`
- `/api/agent/missions/interrupted`
- `/api/usage`

Unavailable requests must resolve to an explicit `Unavailable`, `Needs setup`, or `Offline` state; the UI must not substitute fixtures.

## Reference prototype classification

| Area | Classification | Evidence |
| --- | --- | --- |
| Fixed spatial dashboard, dock, portal transitions | Local-only design prototype | DOM/CSS/inline JS in the supplied HTML |
| Chat history and settings | Local-only | `localStorage` keys and browser-only state |
| Voice | Browser-dependent/local fallback | Web Speech APIs plus canned local commands |
| Three.js Forge | Functional local prototype | Lazy Three r128 scene, scene JSON/STL/PNG export |
| Tasks, projects, messages, analytics, weather | Fake/demo | Seeded values, static weather and synthetic totals |
| Globe routes, activity and system metrics | Fake/demo | Procedural/random visual datasets and hard-coded values |
| Google connections | Disconnected/simulated | UI toggles do not grant or use real account scopes |
| Claude artifact APIs | Environment-specific | `window.claude.use(...)` has no ordinary Vite/Electron equivalent |

## Design decisions from the audit

1. Preserve the prototype's hierarchy—central orb, two to four contextual panels, one command plane, dock/rail continuity—not its dark neon theme or fixed 1672 x 941 coordinate system.
2. Keep text and controls in accessible DOM. Use one lightweight SVG/CSS orb for the home state instead of adding another continuous WebGL scene.
3. Bind every status card to a real endpoint or local persisted record.
4. Keep the existing Chat composer and mission execution path. The Command Centre is a view of that same state, not another agent loop.
5. Keep Electron for this migration. A Tauri rewrite is not justified while native Electron managers and large uncommitted product work are active; it remains a separately measurable architecture decision.

## Baseline commands

```bash
cd '/Users/lukesimpson/Documents/Coding Projects/Clyra-AI-Final'
npm run lint
npm run build
npm run dev:source
```

`npm run dev:source` serves the web app at `http://127.0.0.1:3000`. `npm run desktop:dev` runs the Electron development shell and its private local service. Test results after this migration are recorded in `VERIFIED_IMPLEMENTATION_REPORT.md`.
