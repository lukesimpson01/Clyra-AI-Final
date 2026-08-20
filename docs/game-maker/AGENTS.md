# Game Maker — the agent harness

How the AI actually drives the editor, and how to extend it without making it
worse. The design assumption throughout is a **modest model**: reliability
comes from a small tool surface, hard validation, deterministic generators and
a repair loop — not from the model being clever (spec §75).

## The loop

```
user types  →  freeze ContextFrame  →  server plans  →  browser executes tools
                                            ↑                    │
                                            └──── tool result ────┘
                                    →  verify  →  repair (max 3)  →  commit
```

- The **model runs on the server** (`lib/game-maker/orchestrator.ts`) so the
  API key never reaches the browser.
- The **tools run in the browser** (`ai/executor.ts`) because they touch the
  live editor scene and the sandboxed runtime.
- That is why the transport is a WebSocket: the server has to call back into
  the browser mid-turn.

## Effort levels

Chosen automatically from the request, overridable per task.

| Level | Budget | Behaviour |
| --- | --- | --- |
| `FAST` | 6 tool calls | Direct edits: move, rename, recolour. No plan, no playtest. |
| `STANDARD` | 22 | Plan briefly, act, validate, and playtest anything touching gameplay. |
| `DEEP` | 60 | Checkpoint first, build in stages, playtest, profile, repair. Produce one coherent playable slice — never attempt a whole 100-hour RPG in one run (spec §180). |

## The tool surface

23 tools. That number is a deliberate ceiling — a weak model shown 300 tools
becomes unreliable, so specialised operations are reached through
`tool.discover`, which returns only the two or three schemas that matter.

Every tool description follows the convention borrowed from the PlayCanvas
editor MCP server: **what it does, what it returns, and when NOT to use it.**
The last part is what stops a model reaching for `scene.applyPatch` when it
should have called a generator.

### Adding a tool

1. Define it in `ai/tools.ts` with a zod schema and a description that
   includes a "When NOT to use" sentence. The unit suite enforces both.
2. **The schema's JSON Schema root must be an object.** A discriminated union
   serialises to a root-level `anyOf`, which providers reject with an opaque
   400 on the first turn. Express variants as an `action` enum plus
   `superRefine`. `toolCatalogue()` throws at build time if you get this wrong.
3. Implement it in `ai/executor.ts`. Return `ok()` / `fail()` — never throw a
   bare error. Every failure needs a `code`, a human-readable `message`, and a
   `hint` telling the model exactly what to do next.
4. Add a case to `describeTool()` in the workspace so the activity feed shows
   plain language, not a tool name.

### Adding a generator

1. Implement `GeneratorDefinition` in `procedural/`. It must be pure, take an
   explicit seed, and never call `Math.random()`.
2. Record `GeneratorMetadata` on the root entity it creates — that is what
   makes "make this house two storeys" a re-run rather than a blind patch.
3. Declare `navigation: "obstacle" | "walkable"` on anything solid. Omitting it
   makes the navmesh offer a building's roof as walkable ground, and every
   path will try to climb over it.
4. Register it in `procedural/registry.ts`. It is now discoverable by the model
   with no prompt changes.

## What the model sees

Never the scene JSON. It receives a compact brief (`buildBrief`):

- project identity, genre, camera, art style, performance contract
- a hierarchical scene summary — "Village: 43 buildings, 84 props, 17 NPCs"
- the frozen context: selection, what the cursor was over, what is on screen
  with left/centre/right and distance
- the generator names available for this runtime mode

Everything else it must ask for. This is what keeps a 40,000-entity world
inside a small context budget.

## Grounding rules

The **engine** resolves relative language, not the model. `here`, `this`,
`there`, `to the left`, `behind this`, `around the castle` are anchors and
directions in `scene/grounding.ts`, resolved against the ContextFrame frozen
at the instant the user pressed send.

If the model invents coordinates, that is a prompt bug — the fix is to make
`scene.place` easier to reach, not to accept the guess.

When an anchor cannot be resolved the tool fails with a hint telling the model
to ask the user, rather than silently placing something at the origin.

## Verification

An agent's claim is not evidence (spec §133). After every non-FAST task the
orchestrator independently runs `project.validate` and reports `verified:
false` if structural errors remain — the UI says so rather than showing a
clean summary over a broken project.

For anything involving movement or interaction, the agent is instructed to run
`test.run`, which drives the real game and asserts on live runtime state.

## Repair

Failures are classified (`classifyFailure`) into `schema`, `navigation`,
`gameplay`, `physics`, `asset`, `performance`, `runtime`, `tool`. The loop is
capped at **3 repairs**; past that the task fails with the last concrete error
rather than burning the budget.

## Safety

- Tools declare permissions; `code.edit` requires approval.
- Generated code is never `eval`ed in the editor. The runtime is a sandboxed
  iframe with an opaque origin and no `allow-same-origin`, so it cannot reach
  the editor's DOM, cookies or storage.
- Every message crossing the runtime boundary is schema-validated in both
  directions.
- A patch planned against a stale scene revision is rejected, so an AI turn
  can never silently overwrite an edit the user made while it was thinking.

## Evaluating changes to the harness

When you change the system prompt, a tool schema, retrieval or planning, re-run
both suites and the AI leg:

```bash
npm run test:game-maker
npm run test:game-maker:e2e
GAME_MAKER_AI=1 npm run test:game-maker:e2e
```

Do not assume a longer prompt is better (spec §223). The failure modes worth
watching are: invalid tool calls, repeated identical failing calls, tool count
per task, and unwanted changes outside the request.
