# Clyra Chat Agent Audit

Audit date: 28 September 2026

## Existing functionality

- **Chat and streaming:** `src/App.tsx` retains the existing Composer, transcript, DeepSeek streaming path, interruptions, command palette and Clyra message renderers. Normal questions stay on the direct response path.
- **Supervisor-grade mission runtime:** `lib/clyra-agent/core.ts` contains the deterministic `MissionRuntime`. It validates tools and arguments, enforces state transitions, serialises writes, allows only explicitly safe read-only fan-out, verifies every result, detects repeated action loops, checkpoints each significant boundary, and only enters `COMPLETED` after verified graph nodes finish.
- **Durability:** `lib/clyra-agent/mission-store.ts` persists mission snapshots in SQLite/WAL. `lib/clyra-agent/server-mission-service.ts` restores interrupted work through a fresh observation boundary rather than replaying an in-flight action.
- **Tool abstraction:** `lib/clyra-agent/catalog.ts` exposes one typed catalog for Chat, Notes, Browser, Vibe, media, computer use, Spotify, email and project memory. Only adapters genuinely bound in the current host are surfaced.
- **Approvals and safety:** mission tools classify permissions and risk; approval is tied to the exact action. `lib/computer-use/policy.ts` blocks screen-content prompt injection and requires user takeover for credentials.
- **Computer/browser execution:** `lib/computer-use/browser-adapter.ts` is DOM/accessibility-first. `lib/computer-use/harness.ts` re-observes before and after input, verifies postconditions, pauses on handoff and detects stagnation. `electron/desktop-control.mjs` provides guarded input injection and an AI-presence overlay; `electron/screen-capture.mjs` provides explicit display capture with DPI metadata.
- **Chat presentation:** `src/components/MissionStatusCard.tsx` is driven by persisted mission data, not invented progress. It exposes task state, verified steps, real worker events, approval, pause, stop, resume and an activity disclosure from the same Chat message.
- **DeepSeek Flash vision:** `lib/ai/vision-router.ts` owns validated image data-URL requests (PNG/JPEG/WebP, bounded to 12 MB) using DeepSeek's Chat Completions `image_url` content. It keeps provider credentials server-side, labels results and usage, and treats text in images as untrusted content. Companion and voice/screen-share frames use it first; Gemini and local OCR remain explicit fallbacks where available.
- **Clyra integrations:** the repository includes managed browser, Vibe, Notes, Drive/Gmail/Docs/Sheets/Slides, Calendar, Spotify, research, automations, voice, Clyra Flow, Clip/Creator, Screen Companion and persistent project-memory integration points.

## Existing partial functionality

- The server-owned mission host currently binds verified Notes and structured browser-search actions. Desktop-only adapters are correctly not fabricated for the web server.
- Hermes can run broader local agent workflows through the same Chat activity card, but its live event stream supplies compact operational events rather than a complete durable graph from every third-party runtime.
- Desktop control provides cross-platform input fallbacks and an overlay, but native structured accessibility implementations and active-window/region capture require platform-specific validation beyond the current macOS host.
- Voice has a separate transport/session layer today. It carries Chat context, but it has not yet been proven against every Supervisor adapter in a real end-to-end run.
- Google integrations are present; current official-artwork provenance and live OAuth behaviour still need a connected-account review.

## Duplicate systems to consolidate

- The deterministic Mission Runtime and Hermes runtime both surface work in Chat. Their lifecycle event vocabulary is already normalised at `normalizeHermesEvent`; future work should extend that shared contract instead of adding another task dashboard.
- There are several computer-control experiments (Screen Companion, OpenCluely bridge, semantic computer harness). The `lib/computer-use` contracts should remain the common planner-facing boundary; experiments should be adapters beneath it.
- Browser work exists in both the managed browser runtime and the Vibe/browser helpers. Browser state should continue to be exposed through the common browser adapter/catalog rather than copied into feature-specific prompts.

## Missing or unproven requirements

- No complete, demonstrated macOS **and** Windows native computer-control matrix is available in this checkout.
- Screen perception has display capture but needs validated active-window and region capture APIs per platform before it can meet the full Screen Perception Service contract.
- DeepSeek image-input dispatch, request validation and local usage telemetry are implemented and contract-tested. A live provider-key check with an authorized sample frame is still required before claiming a real external vision run.
- Scoped local filesystem roots, artifact sessions with reversible edits, and native document/spreadsheet/slides editing need a single durable permissions and revision layer.
- The full acceptance workflows—Downloads cowork, five-tab browser, upload/sign-in handoff, worker crash recovery, network restart, and voice-to-Notes—remain unproven on real target machines.

## Reusable UI

- `src/components/chat/ClyraComposerShell.tsx` for Composer visual language and controls.
- `src/shared/clyra/ClyraMessage.tsx`, `src/components/MissionStatusCard.tsx` and the existing shimmer/motion utilities for quiet, in-conversation work feedback.
- `src/components/WorkspaceTaskView.tsx`, `src/components/WebBrowserWorkspace.tsx` and `src/components/AgentControlledPreview.tsx` for panel and takeover patterns.
- `src/components/voice/VoiceCallScreen.tsx` and `VoiceSignature.tsx` for the voice surface.

## Reusable backend

- `lib/clyra-agent/core.ts`, `catalog.ts`, `mission-store.ts` and `server-mission-service.ts` for planning, execution, verification, approvals and checkpoints.
- `lib/computer-use/*` for semantic observation, policy, coordinate conversion and browser-first control.
- `lib/openbrowser/browser-runtime.ts` for persistent browser state and controlled handoff.
- `electron/desktop-control.mjs`, `electron/screen-capture.mjs`, `electron/google-workspace-manager.mjs`, `electron/browser-manager.mjs` and `electron/preload.cjs` for secure desktop boundaries.

## Migration boundary

Keep Clyra Chat as the single control surface. Extend the shared tool catalog and mission contracts; do not add a second agent UI, renderer-side secrets, unverified completion state, or duplicated browser/filesystem/computer tools. Any new platform adapter must publish fresh structured evidence and pass the existing permission, checkpoint and verification boundaries before Chat can report success.
