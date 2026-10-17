# Clyra preservation ledger

This ledger prevents the supplied `AI Core Console(2).html` and the existing Clyra product from being flattened into a new generic dashboard.

| Reference capability / composition | Existing product implementation | Decision | Reason |
| --- | --- | --- | --- |
| `vp`, `dash`, `stage`, `par`, `bg` spatial composition | Shared React shell and workspace stage | Migrate composition | Adaptive DOM layout replaces fixed stage scaling while retaining centre/context/global planes. |
| `orbLayer` and procedural core | Existing Clyra orb/Bloub components | Evolve | Add a lightweight spatial orb state surface; retain existing voice/Bloub experiences. |
| Boot/materialisation choreography | Existing startup/Bloub transition | Retune | Use a short, skippable/reduced-motion-safe reveal; never show fake boot diagnostics. |
| Perspective side panels | Mission, projects, maps, runtime and capability APIs | Replace data, preserve relationship | Panel content comes from real endpoints and stored records only. |
| Spring dock magnification | Existing workspace switcher/source dock | Preserve and reduce | Keep physical proximity feedback but limit scale/travel and disable it for reduced motion. |
| `renderThread`, composer, chat history | `ClyraComposerShell` plus `App.tsx` session state | Preserve | This is the authoritative real conversation and streaming path. |
| `runAI` / `clLocal` | DeepSeek/Hermes/server mission routes | Replace | Prototype Claude/canned fallbacks are not production AI. |
| `openCall`, `clListen`, `clRender` | Voice call screen, dictation hook and local speech services | Preserve/migrate | Runtime-backed states remain truthful; unavailable microphone/STT stays unavailable. |
| `renderTasks` and seeded tasks | Cowork task store and mission state | Replace | Remove sample work from live UI. |
| Projects panel and sample progress | `/api/vibe/projects` | Replace | Show actual persisted projects and their stored status. |
| System/analytics/random metrics | Health/runtime/usage APIs | Replace | No random CPU, request, tool or success values. |
| Navigation/globe/`drawRoute` | Clyra Maps and Eye workspaces | Replace visual engine | Existing MapLibre/provider stack owns real maps, attribution and routes. |
| Search floating window | Atlas browser/research workspaces | Migrate interaction | Use same-origin browser and grounded research adapters. |
| `dockAct` | Existing workspace navigation | Preserve semantics | Dock/rail actions open real Clyra workspaces without resetting conversation state. |
| Three.js Forge | Existing Forge/editor sources plus reference subsystem | Audit before migration | Reference is useful but uses old remote Three r128 and local-only storage. |
| Settings window | Existing Settings modal and persisted config | Preserve | Surface only controls with real persistence or honest disabled states. |
| SVG icon sheet | Lucide plus existing product icons | Reinterpret | Maintain one audited icon language; do not duplicate a second 74-symbol runtime sheet. |
| Dark cyan glass palette | Existing light design tokens | Replace | Product requirement is warm-light porcelain, ink and restrained Clyra blue. |

## Intentionally not migrated

- `SAMPLE_TASKS`, synthetic analytics/messages/projects/weather and random live activity
- Hard-coded person/account names from the prototype
- Claude artifact host APIs
- Simulated Google permissions
- The fixed 1672 x 941 stage and homography-only responsiveness
- Remote Three r128 CDN dependency
- Fake progress, countdown-derived success and theatrical boot logs

The original file remains the immutable source reference at its supplied path and is identified by hash in `BASELINE_AUDIT.md`. A distributable legacy copy must exclude all local browser profiles, tokens, databases and user projects from the root checkout.
