# Clyra Chat agentic remaster — implementation map

## Audit basis

This map was produced from the live repository, not from a product wish list.
It covers the renderer, server, Electron host, agent runtime, browser, cowork,
voice, automation, and the current test harness. Existing unrelated working
tree changes are intentionally preserved.

## Reuse as the foundation

| Concern | Existing implementation | Remaster role |
| --- | --- | --- |
| Chat language and composer | `src/App.tsx`, `src/components/chat/ClyraComposerShell.tsx`, chat CSS in `src/index.css` | Preserve the conversation layout, attachments, slash commands, streaming, voice entry point, drafts, and restrained motion. Agent work is rendered inside assistant messages rather than replacing Chat. |
| Live task presentation | `src/components/MissionStatusCard.tsx`, `AutomationStatusCard.tsx` | Continue to render concise verified state, progress, approvals, pause/stop/resume, and optional activity—not raw tool payloads or model deliberation. |
| Durable mission state | `lib/clyra-agent/core.ts`, `mission-store.ts`, `server-mission-service.ts` | Use the typed task graph, guarded transitions, safe restart, exact-action approval, evidence verification, bounded recovery, and SQLite checkpoints as the Supervisor execution substrate. |
| Tool contract | `lib/clyra-agent/catalog.ts` | Keep `ClyraTool` as the internal `AgentTool` contract: schemas, permissions, risk, availability, retry policy, verification strategy, OS support, and cancellation. |
| Browser | `electron/browser-manager.mjs`, `lib/openbrowser/browser-runtime.ts`, `WebBrowserWorkspace.tsx` | Keep the persistent Electron `WebContentsView` browser, profile/session/download state, CDP/Playwright observation path, semantic actions, native cursor events, and user takeover state. |
| Cowork artifacts | `src/components/cowork/`, `lib/rakazo/` | Reuse the file/document workspace and its safe artifact-oriented presentation instead of turning edits into downloads or chat-only text. |
| Code / terminal | `src/components/clyra-code/`, Electron terminal bridge, existing Vibe runtime | Use the current project, diff, terminal, build, and preview workspaces as the code worker surface. |
| Clyra internal apps | App launcher, Notes, Vibe, browser, study, media, Spotify, Google and research integrations | Surface installed/available app capabilities through the common tool catalog; do not hard-code a second set of UI-only app buttons. |
| Desktop host | `electron/desktop-control.mjs`, `scripts/opencluely-bridge/`, macOS input helper | Preserve native host controls and permission boundaries; route structured/native control before accessibility and pointer fallback. |
| Voice | `src/components/voice/`, `src/hooks/useVoiceCall.ts`, `backend/voice/`, `backend/speech/`, `vendor/whisper.cpp/` | Keep one conversation/task context for voice and typed chat, with local speech support, VAD, partial transcription, interruption handling, and compact voice UI. |
| Automations | `lib/clyra-agent/automation-engine.ts`, `AutomationStatusCard.tsx` | Reuse durable SQLite-backed scheduled tasks and the existing Chat card; extend parsing/trigger adapters without creating a disconnected product. |
| Tests and diagnostics | `tools/*agent*`, `*browser*`, `*cowork*`, `*voice*`, `*automation*`, `*windows*`, `*computer*` | Grow contract tests where runtime invariants change; run the full existing feature matrix and browser smoke after changes. |

## Existing features that must remain intact

- Standard answer/streaming chat must keep its fast path: simple questions do
  not boot the long-running agent loop.
- Chat drafts, history, attachments, command palette, copy/read-aloud,
  scrolling behavior, workspace launcher, and settings stay in place.
- Notes, Vibe Coder, AI Browser, Study, media/creator, Spotify, Google
  services, research, Screen Companion, and voice remain independent usable
  Clyra applications as well as agent capabilities.
- Browser state, tabs, downloads, cookie/profile partitions, manual takeover,
  and native UI are preserved.
- Permission gates remain action-specific. Credentials, CAPTCHA, payment,
  account/security actions, software installation, permanent deletion, and
  external sends are not silently executed.

## Required remaster work

1. **Supervisor scheduling** — make the task graph scheduler run dependency-
   independent, concurrency-safe tool nodes in parallel while maintaining
   checkpoint, cancellation, approval, verification, recovery, retry, and
   anti-loop invariants. The current deterministic runtime already models
   dependencies but executes ready nodes serially.
2. **Capability discovery boundary** — keep one live registry derived from
   adapters and expose the same availability/risk metadata to planner, UI,
   desktop host, and diagnostics. Unavailable features are omitted rather than
   appearing as pretend actions.
3. **Task graph evidence** — ensure completion is tied to verifier evidence,
   not a successful action call. Retain fresh-observation boundaries after
   pauses, restarts, takeover, and stale browser/desktop observations.
4. **Clyra Chat integration** — retain compact live cards and add any needed
   execution states without creating a dashboard or exposing hidden reasoning.
5. **Safety and recovery** — keep exact-action approval; test stale selectors,
   cancellation, checkpoint recovery, and user handoff before final QA.

## Execution priority

```
native Clyra/integration API
  -> scoped direct file or document operation
  -> application-specific API
  -> browser DOM / accessibility / Playwright
  -> OS accessibility tree
  -> keyboard and pointer control
  -> visual coordinate fallback (only when safe)
```

## Platform and verification boundary

This workspace is running on macOS. The macOS helper/native paths can be
exercised here where permissions and applications are available. Windows flows
will receive the repository's Windows compatibility and contract tests; a
genuine interactive Windows desktop validation requires a Windows host and is
recorded as such rather than claimed as completed from macOS.

## Acceptance checks for this change set

- Type-check/build are clean.
- Runtime tests prove independent read-only nodes overlap, dependent nodes do
  not start early, and mutation/approval nodes retain a safe serial boundary.
- Recovery, approval, cancellation, stale observation, browser, cowork,
  automation, voice, computer-control and integration tests continue to pass.
- Browser UI smoke is run in the requested browser environment.
- The final report separates observed test results from platform validation
  that cannot be honestly completed on the present host.
