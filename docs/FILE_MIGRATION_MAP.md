# File migration map

The master prompt contains multiple proposed monorepo layouts. This repository already has a functioning architecture, so the migration uses its existing boundaries instead of duplicating services.

| Prompt concept | Existing / target path | Decision |
| --- | --- | --- |
| App shell / universal workspace | `src/App.tsx` | Preserve; make small additive integration changes only. |
| Global command surface | `src/components/chat/ClyraComposerShell.tsx` | Preserve real composer and transcript behavior; place spatial home around it. |
| Spatial Command Centre | `src/components/core-console/` | New, scoped adaptive view using existing APIs. |
| Design tokens / responsive states | `src/index.css` plus scoped `core-console.css` | Reuse global tokens; keep new rules scoped. |
| Orb scene / fallback | `src/components/core-console/CoreConsoleBackdrop.tsx`, existing Bloub/orb components | Use a low-cost semantic orb on Home; preserve richer focused experiences. |
| Autonomous Workbench / task view | `src/components/WorkspaceTaskView.tsx`, Cowork, Clyra Code and browser workspaces | Preserve. Do not create a second task model. |
| Vibe Coder | `src/components/clyra-code/`, `lib/clyra-code/`, OpenCode routes | Preserve current real adapter and lazy workspace. |
| Browser | `src/components/WebBrowserWorkspace.tsx`, `lib/openbrowser/`, Electron browser manager | Preserve. |
| Maps / Eye | `src/components/maps/`, `src/components/eye/`, `src/maps/`, `lib/maps/` | Preserve shared provider work; do not add a duplicate geo service tree. |
| Voice | `src/components/voice/`, `src/hooks/useVoiceCall.ts`, `backend/speech/`, `backend/voice-pipeline/` | Preserve and report device/runtime availability. |
| Tool registry / missions | `lib/clyra-agent/`, `lib/agent-events/`, `server.ts` | Preserve as the shared execution truth. |
| Hermes bridge | `lib/clyra-agent/hermes-runtime.ts` | Preserve version-pinned local gateway behavior. |
| Storage | Existing SQLite stores under `lib/` and runtime data directory | Preserve; keep DB/WAL/user records out of source snapshots. |
| Reference prototype | Supplied absolute path; hash in audit | Keep immutable. Migrate patterns, not monolithic production code. |

## Change boundary for this remaster

```text
src/components/core-console/CoreConsoleBackdrop.tsx
src/components/core-console/core-console.css
src/components/chat/ClyraComposerShell.tsx
src/App.tsx                       # minimal prop/navigation wiring only
docs/*                            # evidence and truth-status documents
```

The boundary deliberately avoids `server.ts`, Electron native managers, provider adapters, user projects, databases and browser profiles.
