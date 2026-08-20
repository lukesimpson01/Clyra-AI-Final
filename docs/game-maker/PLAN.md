# Game Maker — implementation plan

`[x]` verified complete · `[~]` in progress · `[ ]` not started · `[!]` blocked

A feature is only `[x]` once a test proves it, not when it compiles.

## Phase 1 — Editor spine `[x]`

- [x] Inspect the existing app before changing anything → `EXISTING_ARCHITECTURE.md`
- [x] `GameProjectIR` / `SceneIR` / `EntityIR` with versioning and migrations
- [x] Transactional `scene.applyPatch` with optimistic concurrency + idempotency
- [x] Persistent PlayCanvas viewport (one app for the editor's lifetime)
- [x] Camera: orbit, pan, zoom, WASD fly, presets, frame selection, bookmarks
- [x] Selection: click, shift-multi, hover highlight, bounding boxes
- [x] Transform gizmos: translate/rotate/scale, world/local, snapping
- [x] Hierarchy: tree, drag-reparent, rename, hide, lock, search
- [x] Inspector: transform, components, live generator parameters
- [x] Unified undo/redo — an AI task collapses to one entry
- [x] Persistence: IndexedDB cache + server write-through, restore on reload

## Phase 2 — AI grounding `[x]`

- [x] `ContextFrame` frozen at send time: camera, cursor ray, hit, selection
- [x] Screen-space metadata so a text-only model can say "the tower on the right"
- [x] Spatial index: radius / bounds / nearest / overlap / raycast
- [x] Grounding for here, this, gaze, left/right, behind, around
- [x] Free-space search ("three barrels around this")
- [x] Hierarchical scene summaries instead of scene JSON

## Phase 3 — AI harness `[x]`

- [x] 23 semantic tools with zod schemas and "when NOT to use" guidance
- [x] Object-rooted JSON Schema enforced at build time
- [x] WebSocket orchestrator, server-side, key never in the browser
- [x] Full-duplex tool protocol (server plans, browser executes)
- [x] Explicit state machine: ground → plan → execute → verify → repair → commit
- [x] Effort levels FAST / STANDARD / DEEP
- [x] Checkpoints, transactions, repair budget
- [x] Tool discovery so the surface stays small
- [x] Verified end to end against a live model

## Phase 4 — Play mode `[x]`

- [x] Sandboxed iframe runtime, opaque origin, schema-validated bridge
- [x] One runtime document per engine (3D never downloads Phaser)
- [x] Deterministic fixed-step simulation
- [x] Input injection, state queries, event stream, metrics, render QA
- [x] Console mirroring into the editor

## Phase 5 — Playtesting `[x]`

- [x] Test DSL with strict parsing and line-accurate errors
- [x] Bot: navmesh pathing, approach positions, candidate retry
- [x] Assertions on live runtime state, not pixels
- [x] Failure classification for the repair loop
- [x] Door milestone proven in a real browser

## Phase 6 — Procedural world `[x]`

- [x] Seeded PRNG, value/fbm/ridged noise
- [x] Tiled terrain with erosion, rivers, biomes, build plateaus
- [x] Parametric building grammar (11 kinds, roofs, interiors, doors)
- [x] Settlements: districts, ring roads, plots, landmarks, props, NPCs
- [x] Fortresses, dungeons with guaranteed connectivity
- [x] Roads as splines with terrain draping and bridges
- [x] Instanced vegetation with slope/height rules and exclusions
- [x] Procedural PBR materials with content hashing and reuse

## Phase 7 — Gameplay `[x]`

- [x] 40-component library, schema-validated, with dependency reporting
- [x] Reusable controllers (first/third person, top-down, platformer, voxel)
- [x] Characters: 10 archetypes, modular meshes, equipment, behaviour
- [x] Quests and dialogue as data, with completability validation
- [x] UI primitives and per-mode defaults
- [x] Save-game fields, localisation keys

## Phase 8 — 2D `[x]`

- [x] Phaser adapter with deterministic stepping
- [x] Tilemap generation with proven reachability
- [x] Merged tile bodies, enemies, collectibles, goal triggers

## Phase 9 — Voxel `[x]`

- [x] Typed-array chunks, biomes, caves, ores, trees
- [x] Culled-face meshing with cross-chunk neighbours
- [x] Voxel raycast (DDA), break and place, dirty-chunk remeshing
- [x] Edits written back into the scene document so they survive a save
- [x] Proven in a browser: attack breaks a block, interact places one

## Phase 10 — Advanced assets `[ ]`

- [ ] Blender worker provider
- [ ] Remote GPU mesh/texture providers
- [ ] glTF import + optimisation pipeline (LODs, KTX2, meshopt)
- [ ] Character animation clips (states are defined; clips are not authored)

## Phase 11 — Polish `[~]`

- [x] Console, tests, profiler and history docks
- [x] Asset browser with provenance
- [x] Publish endpoint and manifest
- [ ] Ghost previews for pending AI changes (data path exists, UI does not)
- [ ] Camera-follow-AI toggle is wired but does not animate between shots
- [ ] Project gallery, onboarding

## Known gaps

- [ ] `code.edit` writes and syntax-checks project scripts, but the sandboxed
      runtime does not yet load or execute them. Everything generated today is
      expressed with the component library, which is the intended priority
      order (spec §137) — but a script the AI writes will not run.
- [ ] Voxel editing exists in play mode only; there is no edit-time block brush.
- [ ] Animation *states* are configured on every character; no animation clips
      are authored, so characters slide rather than walk.
- [ ] Publish writes a manifest and the project document; it does not yet copy
      a hashed asset bundle to a CDN.
- [ ] Collaboration (Yjs) — deliberately deferred; ids are stable and every
      edit is an addressable patch, so CRDTs can be layered on later.
