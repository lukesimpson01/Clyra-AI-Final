# Game Maker — status

Durable implementation state. Update this as work continues.

**Last verified:** 2026-08-20 · Node v24.15.0 · macOS (darwin 24.6.0)

## Current milestone

All three of the specification's critical milestones are proven in a real
browser, plus 2D and voxel:

1. **Engine-control spine** — a text-only model inspects structured editor
   state, understands what the user is pointing at, makes a multi-step edit
   through semantic tools, and the whole turn undoes as one step. ✅
2. **Verified gameplay** — a bot walks to a door, presses interact, and the
   *runtime* confirms `door_opened` fired with zero runtime errors. ✅
3. **Coherent generated world** — "a medieval village beside a river" is one
   tool call producing terrain, ring roads, plots, buildings, props and NPCs,
   all navigable. ✅

## Working systems

| System | State | Evidence |
| --- | --- | --- |
| GameIR + migrations + validation | Working | unit suite |
| Transactional patches, optimistic concurrency, idempotency | Working | unit suite |
| Spatial index, world queries, scene summaries | Working | unit suite |
| Language grounding (here / this / left / behind / around) | Working | unit suite |
| History — an AI task is one undo | Working | unit + browser |
| 11 procedural generators, all seeded and deterministic | Working | unit suite |
| Navigation: tiled grid, A*, per-part collision, snapping | Working | unit + browser |
| Component library (40 components) + quests/dialogue/UI | Working | unit suite |
| Persistent PlayCanvas editor viewport, gizmos, selection | Working | browser |
| Sandboxed play runtime (3D, voxel, 2D) | Working | browser |
| Playtest DSL + bot | Working | browser |
| AI orchestrator with a live model | Working | browser (opt-in) |
| Persistence + reload recovery | Working | browser |
| Profiler against the performance contract | Working | browser |

## Broken / not implemented

- **Generated scripts do not execute.** `code.edit` validates and stores them;
  the runtime has no script host. Behaviour must come from components today.
- **No animation clips.** Characters have animation *states* but no motion.
- **Publish is incomplete.** It writes `project.json` + a manifest; it does not
  bundle hashed assets or return a public URL.
- **No edit-time voxel brush.** Blocks can only be changed in play mode.

## Known issues

- **Village door reachability is layout-dependent.** The playtest bot walks to
  a door and opens it reliably on the seeds exercised by the suite, and tries
  the three nearest candidates before failing. In a very dense random village
  a door can face a neighbour's wall with under a metre of clearance; the bot
  reports this precisely ("stopped 2.4m away, outside its 3.2m interaction
  range") rather than failing silently. Fixing it properly means plot layout
  guaranteeing door frontage, not more bot tuning.
- **The editor viewport pauses in a hidden browser tab.** `requestAnimationFrame`
  does not fire, so FPS reads 0. This is correct behaviour (spec §260) but can
  look like a hang when driving the app from a background tab.
- **Vite dev + sandboxed runtime needs permissive CORS.** The runtime iframe has
  an opaque origin, so every module it loads is fetched with `Origin: null`,
  including Vite's injected `/@vite/client`. `server.cors = { origin: "*" }` in
  the dev server config is required or the runtime silently never boots.
  Production serves plain static files and is unaffected.

## Architecture

Three layers: **editor** (React + `Editor3DEngine`), **runtime** (sandboxed
iframe, `World3D`/`World2D`), **generation** (procedural generators + the
server-side AI orchestrator). See `ARCHITECTURE.md`.

Engine choice: PlayCanvas 2.21 for 3D/voxel, Phaser 4.2 for 2D. Navigation and
physics are custom and deterministic — see the substitutions section of
`ARCHITECTURE.md` for why.

## Performance

Default profile is `8GB_SAFE`: 60 FPS target, 40 FPS floor, 700 draw calls,
900k triangles, 256 MB textures. The profiler reports every breach with a
specific cause and a suggested repair.

Bundle: the editor and each runtime document are separate entry points. A 3D
project never downloads Phaser (1.7 MB) and a 2D project never downloads
PlayCanvas (2.0 MB).

Navigation grid cell size scales with world span so a 500 m world stays
pathable inside the A* budget; collision is taken per mesh part with a
per-tile broad phase.

## Tests

```bash
npm run test:game-maker        # 97 headless checks, no browser needed
npm run test:game-maker:e2e    # 22 browser checks against a running dev server
GAME_MAKER_AI=1 npm run test:game-maker:e2e   # adds 5 live-model checks (billable)
```

The e2e suite expects `npm run dev` on port 3000. Worlds are pinned with
`?gmSeed=` so the suite exercises the same village every run; override with
`GAME_MAKER_SEED`.

Last run: **97 headless passed**, **22 browser passed**, **5 AI checks passed**
against DeepSeek.

## Dependency versions

`playcanvas` 2.21.4 · `phaser` 4.2.1 · `zod` 4.4.3 · `nanoid` 6.0.1 ·
`comlink` 4.4.2. All MIT except Comlink (Apache-2.0). See `DEPENDENCIES.md`.

## Next recommended task

Add a script host to the sandboxed runtime so `code.edit` output actually
runs — it is the one place where a tool reports success without the change
taking effect, which is exactly the kind of gap the verifier is meant to
catch and currently cannot.
