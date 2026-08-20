# Game Maker dependencies

Every runtime dependency the Game Maker platform adds, why it is here, and
what it is licensed under. Versions are the ones in `package-lock.json` at
the time of writing; the lockfile is the source of truth from here on
(spec §284 — do not hard-code versions from a specification).

## Added for Game Maker

| Package | Version | License | Purpose | Client bundle | Server | Modified |
| --- | --- | --- | --- | --- | --- | --- |
| `playcanvas` | 2.21.4 | MIT | 3D editor viewport and the 3D/voxel play runtime. Entity/component system, WebGL2 renderer, transform gizmos, immediate-mode debug drawing. | Yes (editor + `game-runtime.html`) | No | No |
| `phaser` | 4.2.1 | MIT | The 2D play runtime: scenes, arcade physics, tilemap bodies, camera. | Yes (`game-runtime-2d.html` only) | No | No |
| `zod` | 4.4.3 | MIT | Schema validation for every trust boundary — AI tool arguments, scene patches, runtime bridge messages, component data — and JSON-Schema generation for the model's tool catalogue. | Yes | Yes | No |
| `nanoid` | 6.0.1 | MIT | Short collision-resistant ids. | Yes | No | No |
| `comlink` | 4.4.2 | Apache-2.0 | Worker RPC ergonomics for off-thread generation work. | Yes | No | No |

## Reused from the existing application

These were already dependencies; Game Maker uses them rather than adding an
equivalent (spec §33 — do not add duplicate libraries).

| Package | Used for |
| --- | --- |
| `react`, `react-dom` (19) | The editor shell. Engine objects never enter React state. |
| `lucide-react`, `motion` | Icons and motion, matching the rest of Clyra. |
| `@monaco-editor/react` | Available for script editing; the code path is wired through `code.edit`. |
| `ws` | The AI orchestrator's WebSocket, attached the same way `lib/terminal-ws.ts` does. |
| `express` | Project storage and publish routes. |
| `esbuild` | Server bundling (already the project's build step). |
| `@playwright/test` / `playwright` | The browser end-to-end suite. |
| `tsx` | Runs the headless unit suite. |

## Deliberately NOT added

| Candidate | Why not |
| --- | --- |
| `recast-navigation` + `@recast-navigation/playcanvas` | The specification names Recast for navmeshes. A tiled walkability grid with A* is used instead: it needs no WASM asset pipeline, runs identically in the browser, a worker and Node (so navigation is covered by the headless test suite), and answers exactly the questions asked of it. `NavigationIR` is engine-neutral, so swapping in Recast later changes only the builder. |
| `@gltf-transform/*`, `meshoptimizer` | The asset pipeline is entirely procedural today — meshes are generated from `MeshSpec` parameters, not imported glTF — so there is nothing yet for these to optimise. They become necessary the moment user-uploaded or GPU-generated GLB arrives. |
| `esbuild-wasm` | In-browser bundling is not needed while generated behaviour comes from the component library rather than from generated code. |
| `yjs` | Collaboration is explicitly out of scope for this milestone (spec §27). Entity ids are stable and all edits are addressable patches, so CRDTs can be layered on later. |
| `three`, `pixi.js` (already in the repo) | Retained for the other workspaces that use them. Game Maker uses PlayCanvas/Phaser because it needs an entity/component system and a 2D game framework, not a renderer. |
| `@dimforge/rapier*` (already in the repo) | The runtime uses a deterministic kinematic capsule sweep instead, because reproducible stepping is what makes automated playtests trustworthy. `PhysicsBackend` is the seam if a rigid-body engine is needed later. |

## Optional backends referenced by the specification

None are integrated, and none are required for the product to work. Every
generation path has a procedural implementation that runs offline.

| Service | Status |
| --- | --- |
| Blender worker | Not integrated. `AssetGeneratorProvider` is the seam. |
| TRELLIS.2 / Hunyuan3D (GPU 3D generation) | Not integrated. Model weight licences must be reviewed separately from code licences before any use (spec §12, §32). |
| ComfyUI (image generation) | Not integrated. It is AGPL-licensed server software; embedding it would have licensing consequences for this application and needs a deliberate decision (spec §31). |

## Research checkouts

`third_party/research/` (git-ignored) holds shallow clones used as
architectural reference only. No code was copied from them.

| Repository | What was taken from it |
| --- | --- |
| `playcanvas/editor-mcp-server` | The shape of the tool surface: small tool count, zod schemas, "when NOT to use this" in every description, structured ok/fail results with hints, batch operations. `src/features/game-maker/ai/tools.ts` follows these conventions. |
| `playcanvas/observer` | Reviewed and not adopted — the editor store already provides change notification without another dependency. |

PlayCanvas Engine, Phaser and PixiJS were studied through their published
type definitions and source in `node_modules`, which is the same code the
product ships against, rather than through separate clones.
