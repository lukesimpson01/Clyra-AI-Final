# Game Maker architecture

Three layers, kept strictly apart. Nothing in one reaches into another
except through the interfaces named here.

```
                         ┌──────────────┐
                         │     USER     │
                         └──────┬───────┘
                                │
      EDITOR            ┌───────▼────────┐
      React 19          │  Workspace UI  │  src/features/game-maker/ui/
      (never holds an   │  store         │  store/editorStore.ts
      engine object)    └───────┬────────┘
                                │ plain IR only
                 ┌──────────────┼──────────────┐
                 │              │              │
        ┌────────▼───────┐ ┌────▼─────┐ ┌──────▼────────┐
        │ Editor3DEngine │ │  GameIR  │ │ Semantic tools│
        │ PlayCanvas     │ │ ir/      │ │ ai/tools.ts   │
        │ engine/        │ │          │ │ ai/executor.ts│
        └────────────────┘ └────┬─────┘ └──────┬────────┘
                                │              │ WebSocket
      RUNTIME                   │      ┌───────▼─────────┐
      sandboxed iframe   ┌──────▼────┐ │ AI Orchestrator │  lib/game-maker/
      opaque origin      │ Runtime   │ │ plan → execute  │
                         │ host      │ │ → verify → repair│
                         └──────┬────┘ └───────┬─────────┘
                                │ MessageChannel│
                    ┌───────────▼──────┐  ┌────▼──────┐
                    │ boot3d / boot2d  │  │ DeepSeek  │
                    │ World3D / World2D│  │ (server)  │
                    └──────────────────┘  └───────────┘
```

## The rules that hold it together

**No engine object in React state.** `editorStore` holds only plain IR.
`Editor3DEngine` owns the PlayCanvas application for the editor's whole
lifetime and pushes changes out through callbacks. A frame is never a React
render.

**One write path.** Every change — a gizmo drag, an inspector field, an AI
tool — goes through `editorStore.setProject`, which is what keeps history,
the viewport and autosave in agreement. `applyScenePatch` validates the whole
patch, dry-runs it on a copy, and only then commits, so a failed operation
leaves nothing behind.

**The engine resolves language, not the model.** "Here", "this", "to the
left" are resolved by `scene/grounding.ts` against a *frozen* `ContextFrame`
captured the instant the user pressed send. The model asks for a named
anchor; it never invents coordinates.

**Generators, not tool calls, make content.** A village is one
`scene.generate` call producing ~40 entities, roads, props and NPCs, all
deterministic from a seed. Every generated object records `GeneratorMetadata`
so changing one parameter rebuilds it coherently instead of patching walls.

**The runtime is untrusted.** It runs in an iframe with
`sandbox="allow-scripts"` and no `allow-same-origin`, so it has an opaque
origin and no access to the editor's DOM, cookies or storage. Every message
across the boundary is validated against a zod schema. Nothing is `eval`ed.

**Deterministic stepping.** Neither PlayCanvas's nor Phaser's own RAF loop is
used; both worlds are driven by explicit fixed steps. That is what lets the
playtest bot advance exactly 600 frames and assert on the result rather than
sleeping on wall-clock time.

## Module map

| Path | Responsibility |
| --- | --- |
| `ir/types.ts` | `GameProjectIR`, `SceneIR`, `EntityIR`, patches, `ContextFrame`, `ToolResult`. |
| `ir/schema.ts` | Zod schemas for every trust boundary. |
| `ir/patch.ts` | Transactional patching, optimistic concurrency, world transforms. |
| `ir/project.ts` | Project creation, schema migration, validation. |
| `scene/spatial.ts` | Uniform-grid spatial index: radius, bounds, nearest, raycast. |
| `scene/query.ts` | The structured world query the AI uses instead of the scene JSON. |
| `scene/summary.ts` | Hierarchical counts — what the model actually receives. |
| `scene/grounding.ts` | Anchors, directions, free-space search. |
| `history/history.ts` | One history for manual and AI edits; an AI task is one undo. |
| `procedural/` | Seeded PRNG, noise, mesh specs, materials, and 11 generators. |
| `nav/navmesh.ts` | Tiled walkability grid + A*, with per-part collision. |
| `gameplay/` | The component library and quests/dialogue/UI as data. |
| `runtime/` | Protocol, host, geometry compiler, `World3D`, `World2D`, boot kernels. |
| `playtest/` | The test DSL and the bot that drives the running game. |
| `ai/` | Tool definitions, the browser-side executor, the orchestrator client. |
| `engine/Editor3DEngine.ts` | The persistent editor viewport. |
| `store/editorStore.ts` | React-facing state and the single write path. |
| `ui/` | The workspace shell, panels and templates. |
| `lib/game-maker/` | Server: the AI orchestrator and project storage. |

## Deliberate substitutions

Two places depart from the specification, both for reasons that make the
product better rather than easier:

**Navigation** uses a tiled walkability grid with A* instead of Recast. It
needs no WASM asset pipeline, runs identically in the browser and in Node —
so navigation is covered by the headless suite — and `NavigationIR` stays
engine-neutral so Recast can replace the builder later.

**Physics** is a deterministic kinematic capsule sweep rather than a
rigid-body engine. Generated worlds are boxes and characters are capsules,
and exact reproducibility matters more here than barrels rolling downhill:
it is what makes an automated playtest a trustworthy signal.
