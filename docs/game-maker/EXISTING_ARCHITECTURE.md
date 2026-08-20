# Existing architecture (inspected before any change)

Inspected on 2026-08-20, branch `cursor/computer-agent-take-control-fb96`, Node v24.15.0.

## Repository shape

The git root is `/Users/lukesimpson/Documents/Coding Projects/Clyra-AI-Final`.
A nested `Clyra-AI-Final/` directory exists inside it but is a stale June snapshot
that is not tracked as the live source; **all work happens at the git root**.

Not a monorepo. Single Vite app + single Express/Node server.

```
src/                 React 19 client (Vite)
  App.tsx            Workspace shell; lazy-loads each workspace by tab id
  components/        One directory per workspace (forge, clyra-code, clipper, ...)
  index.css          8k-line hand-authored design system (no CSS modules)
server.ts            Express server, ~4200 lines, mounts every /api route
lib/                 Server-side modules imported by server.ts
electron/            Desktop wrapper (optional; the web app is primary)
tools/               tsx/node test + dev scripts, run via npm scripts
```

## Stack (detected, not assumed)

| Concern | Actual |
| --- | --- |
| Package manager | **npm** (`package-lock.json`; no pnpm/yarn lockfile) |
| Frontend | React 19 + TypeScript 5.8 + Vite 6 |
| Styling | Hand-written CSS in `src/index.css` + Tailwind 4 utilities + `cn()` helper |
| Icons / motion | `lucide-react`, `motion/react` (Framer Motion 12) |
| Code editor | `@monaco-editor/react` (already a dependency) |
| Server | Express 4 on `node:http`, started in `server.ts` |
| WebSockets | `ws`, attached via `server.on("upgrade")` path routing (see `lib/terminal-ws.ts`) |
| Realtime to client | SSE (`/api/opencode/events/:id`) and WebSocket (`/api/terminal`, voice) |
| LLM | DeepSeek V4 (OpenAI-compatible), **server-side only**, key `DEEPSEEK_API_KEY`, proxied by `handleClyraChat` at `POST /api/clyra/chat` |
| Vision | `POST /api/companion/vision-frame` |
| Project storage | `/api/vibe/projects/*` — file-backed projects under `clyraDataPath("projects")/<id>/files` |
| Existing 3D/2D libs | `three@0.185`, `pixi.js@8`, `@dimforge/rapier2d-compat`, `@dimforge/rapier3d-compat` |
| Tests | Plain `tsx` scripts under `tools/`, plus `@playwright/test` for a few suites |
| Deployment target | Local dev server + Electron desktop build |
| Auth | None in the web app path (single local user) |

## What Clyra Forge was (the thing being replaced)

`src/components/forge/` (~3,000 lines) was a *thin* editor over a flat
`ForgeScene` JSON:

- `model.ts` — flat `ForgeEntity[]` with a fixed `kind` union and untyped
  `components[]`. No hierarchy, no asset records, no IR versioning.
- `Forge3DViewport.tsx` / `Forge2DViewport.tsx` — three.js and pixi.js
  viewports recreated from React state.
- `physics2d/3d.ts` — Rapier simulation used only for the inspector.
- `api.ts` — the "AI" was **an OpenCode coding-agent session with shell
  access** prompted to hand-edit `src/scene.json`. There were no semantic
  tools, no validation of what the model wrote, no transaction, no undo of
  an AI turn, no context grounding, and no play-mode verification loop.
- `lib/opencode/forge-inspector-routes.ts` — read-only HTTP inspection of
  the persisted `scene.json`.

The replacement keeps the two genuinely good ideas from Forge — a
language-only model that verifies with inspection tools rather than vision,
and file-backed persistence through the existing vibe project API — and
rebuilds everything else against the GameIR/semantic-tool architecture.

## Integration points that must keep working

- `src/App.tsx:249` lazy-imports the workspace; tab id `"forge"`.
- `src/components/AppLauncher.tsx:45` launcher card for the same id.
- `server.ts:67,1426` registers the inspector routes.
- `package.json` script `test:forge`.
- `src/index.css:7940-7955` holds the workspace's CSS block.

All five are re-pointed at the new module rather than duplicated.
