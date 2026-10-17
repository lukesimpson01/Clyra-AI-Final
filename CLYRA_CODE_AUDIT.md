# Clyra Code Audit

Audit date: 5 October 2026
Scope: `/Users/lukesimpson/Documents/Coding Projects/Clyra-AI-Final` (git root; `package.json` lives here).

Evidence key: **grep** = file-level match counted across `lib/ src/ electron/ server.ts vibe-server.ts`. **code** = read in this audit. **run** = executed on this host. Anything without **run** is unverified at runtime.

## 1. What Clyra Code is today

- **UI**: `src/components/clyra-code/ClyraCodeWorkspace.tsx` (995 lines), `RightPanel.tsx` (1097), `Conversation.tsx`, `Composer.tsx`, `TerminalPanel.tsx`, `VisualInspector.tsx`, `UsageAnalytics.tsx`, `diff.ts`, `store.ts`. Loaded lazily from `src/App.tsx`. Presented as the Vibe Coder tab.
- **Agent harness**: `lib/opencode/OpenCodeRuntimeManager.ts` drives `@opencode-ai/sdk` (`createOpencode`). Plan preflight, usage analytics and internal prompts live in `lib/vibe-agent-v3/`.
- **Server surface**: `registerOpenCodeRoutes` (`lib/opencode/opencode-routes.ts`, mounted at `server.ts:2053`) exposes `/api/opencode/*` and `/api/vibe/*`.
- **Legacy/alt harnesses**: `lib/vibe-runtime/` (runtime, task controller, validation, model provider), `lib/cline/`, `lib/openhands/`. Their status is covered in §3.

## 2. Feature matrix

Legend: **KEEP** works, reuse as-is. **POLISH** works, needs UI/quality work. **EXTEND** partial, add to it. **REPLACE** wrong shape, rebuild. **BUILD** missing. **SKIP** already good, do not duplicate.

| Feature | Exists | Backend | UI | Tests | Action | Evidence |
|---|---|---|---|---|---|---|
| Agent harness (OpenCode SDK) | yes | 4/5 | 3/5 | poor | EXTEND | `OpenCodeRuntimeManager.ts` (grep + code) |
| Project target detection | partial | 2/5 | n/a | none | **BUILD** (this pass) | No target type; only web/desktop heuristics in preflight |
| Platform capability matrix | no | - | - | - | **BUILD** (this pass) | No `CAN_BUILD`-style model anywhere |
| DeepSeek provider / routing | yes | 4/5 | 3/5 | partial | KEEP | 26 files reference DeepSeek; `codingModelStatus()` |
| Effort levels | yes | 3/5 | 3/5 | weak | EXTEND | `normalizeEffort` in `vibe-agent-v3/preflight` |
| Plan mode / plan review | yes | 4/5 | 4/5 | partial | POLISH | `preflight.ts`, plan views in `components/vibe-coder/plan` |
| Ask / read-only mode | partial | 2/5 | 2/5 | none | EXTEND | No enforced read-only tool gate found in `opencode-routes.ts` |
| Debug / review modes | no | - | - | - | BUILD (later phase) | Only prompt text |
| Checkpoints + undo | yes | 4/5 | 3/5 | partial | KEEP | 37 grep hits; `/projects/:id/checkpoints/undo` |
| Diff rendering (unified) | yes | 4/5 | 3/5 | partial | POLISH | `components/clyra-code/diff.ts` |
| Split diff, hunk accept/reject | no | - | - | - | BUILD (later) | No hunk-level controls found |
| Terminal (PTY) | yes | 4/5 | 3/5 | weak | POLISH | `lib/terminal-ws.ts`, `node-pty` dep, `TerminalPanel.tsx` |
| Git (status/diff/commit) | yes | 3/5 | 2/5 | weak | EXTEND | `isomorphic-git` used in 5 files; `GitHubPopover.tsx` |
| Worktrees | partial | 2/5 | none | none | EXTEND (later) | 4 grep hits, no UI entry point |
| Browser / preview | yes | 4/5 | 3/5 | partial | KEEP | `lib/openbrowser/browser-runtime.ts`, `preview-proxy.ts` |
| Playwright web QA | partial | 3/5 | n/a | partial | EXTEND | `playwright` in 5 files; no agent-facing QA loop |
| Skills | partial | 2/5 | none | none | EXTEND | `lib/vibe-skills/frontend-design.ts` (19 lines, one skill) |
| MCP | partial | 2/5 | none | none | BUILD (later) | 3 grep hits |
| Hooks (Pre/Post tool, etc.) | no | - | - | - | BUILD (later) | 0 grep hits |
| Goals | yes | 3/5 | 3/5 | weak | EXTEND | 19 grep hits |
| Queue / steer | partial | 3/5 | 2/5 | weak | EXTEND | 9 grep hits |
| Side chat | partial | 2/5 | 2/5 | none | EXTEND | 2 grep hits |
| Monaco editor | yes | 3/5 | 3/5 | none | KEEP | `@monaco-editor/react` |
| Usage analytics | yes | 4/5 | 4/5 | partial | KEEP | `/api/vibe/v3/usage`, `UsageAnalytics.tsx` |
| Project memory / AGENTS.md | yes | 3/5 | 2/5 | weak | EXTEND | `DEFAULT_AGENTS_MD` in `OpenCodeRuntimeManager.ts` |
| Swift toolchain detection | no | - | - | - | **BUILD** (this pass) | 0 grep hits for `swift` in Clyra Code paths |
| Swift Package Manager runner | no | - | - | - | **BUILD** (this pass) | 0 grep hits |
| Swift build/test output parsing | no | - | - | - | **BUILD** (this pass) | - |
| iOS project discovery (xcodeproj / xcworkspace / Package.swift) | no | - | - | - | **BUILD** (this pass, detection only) | - |
| Xcode / simctl adapter | no | - | - | - | **BUILD** (this pass, gated) | Apple iOS code was deliberately removed earlier, see §4 |
| iOS Simulator runtime (boot/install/launch) | no | - | - | - | BUILD later, macOS + Xcode only | Needs full Xcode, not present here |
| SourceKit-LSP client | no | - | - | - | BUILD later | `sourcekit-lsp` binary present (run); no client code |
| Native iOS design skill / preview | no | - | - | - | BUILD later | - |
| Windows iOS emulator | no | - | - | - | R&D only | Do not ship |

Items marked **BUILD (later)** are deliberately out of this pass. Each is listed so the next pass starts from a known gap rather than a guess.

## 3. Duplicates to avoid

- Do **not** add a second agent loop. `OpenCodeRuntimeManager` is the loop. New target logic plugs in beside it.
- Do **not** add a second terminal, browser, editor, checkpoint store or model provider. Each already exists (table above).
- `lib/clyra-agent/core.ts` already has a `ToolRisk` type (`safe | review | sensitive`). The new Swift/iOS tools reuse that vocabulary rather than inventing one.
- The `lib/vibe-runtime/` harness and the Cline/OpenHands harnesses are alternates. They are not the default path. Do not extend them for this work.

## 4. Environment facts (this host, run)

| Check | Result |
|---|---|
| `xcode-select -p` | `/Library/Developer/CommandLineTools` (Command Line Tools only) |
| `xcodebuild -version` | Fails: requires full Xcode |
| `xcrun --find simctl` | Fails: not found |
| `xcrun --find swift` | `/Library/Developer/CommandLineTools/usr/bin/swift` |
| `swift --version` | Apple Swift 6.1.2 (swiftlang-6.1.2.1.2), target x86_64-apple-macosx15.0 |
| `sourcekit-lsp` | Present (no `--version` flag; `--help` works) |
| `lldb` | `/Library/Developer/CommandLineTools/usr/bin/lldb` |
| Node | v26.10.0 |
| `npx tsc --noEmit -p .` baseline | Clean (exit 0) |

**Consequence:** on this Mac, Swift packages can be built, tested and run. The iOS Simulator, `xcodebuild`, iOS builds and iOS UI tests cannot run until full Xcode is installed. Clyra must report them as unavailable, not simulate them.

Two findings from running real Swift packages on this host (**run**):

- **`import XCTest` fails** with "no such module 'XCTest'" under Command Line Tools. XCTest ships with full Xcode. Swift packages in this pass therefore use Swift Testing (`import Testing`), which works here.
- **Swift Testing needs a deployment target.** Without `platforms: [.macOS(.v14)]` in `Package.swift`, `swift test` fails with "concurrency is only available in macOS 10.15.0 or newer". Adding the line fixes it. This is the kind of failure the agent's repair loop should detect and fix from the compiler diagnostic, so it is recorded as a repair case.

## 5. Project history that constrains iOS work

`docs/release/RELEASE_BLOCKERS.md` records that Vibe Coder's native iOS/SwiftUI building (`lib/iphone/**`, `lib/mobile-platform-detect.ts`, the iPhone panels, the Apple skill libraries) was **removed at the user's explicit request**. This pass re-adds iOS support on the user's new instruction. The earlier removal is recorded here so that the reversal is deliberate and visible. The deleted code is not restored; the new layer is written fresh and smaller.

## 6. Other gaps found in the audit

- `tsconfig.json` includes only `src/`. `lib/**` and `server.ts` are not type-checked by `npm run lint`. New `lib/` code therefore needs its own test run, and the platform unit tests are the verification for this pass.
- No hooks system exists, so "run before edit / after build" behaviour cannot be implemented yet.
- No target-aware verification contract exists. Build/test success is judged by the OpenCode agent's own report, not by a structured result.

## 7. Scope of this pass

Built now, verified by running on this host:

1. Platform capability matrix, host-probed, never inferred (`lib/clyra-code/platform/`).
2. Project target detection (`lib/clyra-code/targets/detect.ts`).
3. Swift Package runner with typed arguments and structured results (`lib/clyra-code/swift/`).
4. Swift/Xcode diagnostic parser (`lib/clyra-code/diagnostics/`).
5. Simulator device parser and `simctl` adapter that reports unavailable on hosts without Xcode (`lib/clyra-code/ios/`).
6. HTTP routes (registered in `server.ts` beside the OpenCode routes):
   - `GET /api/clyra-code/platform`: capability matrix, plus simulator listing only when the matrix confirms the Simulator is available.
   - `GET /api/clyra-code/projects/:projectId/targets`: detected targets for one project.
   - `POST /api/clyra-code/projects/:projectId/swift/:command`: `resolve`, `build`, `test`, `run`, `show-dependencies`, with validated options. Returns 409 when no Swift toolchain is present and 400 for bad input.
7. Unit tests: `tools/clyra-code-platform-unit-tests.ts`, script `test:clyra-code-platform`. Result on this host: **24 checks, 102 assertions, all pass**. This includes two real `swift build` / `swift test` runs and a real compile error with its file and line parsed.

Verified live over HTTP (**run**): platform route reports the Simulator unavailable with the Command Line Tools reason; targets detect a Swift package; `build` returns `ok` with the parsed build time; an unknown command returns 400; a `filter` containing `; rm -rf` returns 400.

UI (added in the follow-up pass): a **Platform** tab in the Clyra Code right panel (`src/components/clyra-code/PlatformView.tsx`, wired in `RightPanel.tsx`). It shows the host, detected project targets, Swift Resolve / Build / Test buttons (only for Swift packages on a host with a toolchain), a per-command result card with diagnostics and output, the toolchain and Apple capability rows with their reasons, and installed simulators or the reason they are unavailable. Verified in the running app against a real Swift package: a successful build and test, a deliberate compile error that showed the file, line and message, and the removal of stale results when a new command runs.

Not built yet: SourceKit-LSP client, iOS build/run/install, iOS discovery of schemes via `xcodebuild -list`, LLDB, hooks, MCP, worktree UI, design workspace, and the remaining §2 BUILD rows. Windows is not run here: the Windows branches are covered only by the matrix unit tests, with the Windows probe fed fixed values.

## 8. Welcome brief and iOS app type (follow-up pass)

- **Chips:** Website, Desktop app and **iOS app** under the welcome composer. A chip press toggles a guided brief in the composer (`src/components/clyra-code/ClyraCodeWorkspace.tsx`, `Composer.tsx`, `BriefComponents.tsx`). The chip is shown as selected while active.
- **Skeleton prompt:** "Describe your <app> idea" with a *What it does* example and a *How it looks* example for that platform. Clicking an example adds a labelled line to the brief. The skeleton disappears once the user types. Copy and directives live in `appBrief.ts`.
- **iOS honesty note:** the iOS brief shows a line taken from the real host probe. It says whether the Simulator is available, or that full Xcode is needed.
- **Routing:** `detectPlatformIntent` (`store.ts`) recognises iOS, iPhone, SwiftUI, UIKit and Xcode. Styling-only mentions such as "iOS-style" never select a platform. Prompts that name two platforms still ask.
- **Agent directive:** the iOS directive tells the agent to check with real Swift tooling and not to claim a simulator or device run that did not happen.
- **Verified:** `npm run test:clyra-code-brief` (43 assertions). In the app: the three chips; the brief for iOS and Desktop; example insertion; clearing and toggling; the submit path, where the iOS directive reached the agent session and the transcript showed only the user's text. Test run and test project were stopped and deleted.
- **Known limit:** at phone width (375px) the workspace's sidebar stays expanded, so the welcome card is pushed off-screen. Clyra Code is a desktop surface and this layout predates this pass. Not changed.

## 9. Status against the full remaster spec

Done in this and earlier passes (verified on this host): platform capability matrix, target detection, Swift Package runner with parsed results, compiler-diagnostic parser, simulator listing that refuses without Xcode, Platform tab, iOS app type with honest brief.

Not done. Each is a separate build, and several cannot run on this Mac:
- **Blocked on full Xcode (not installed here):** `xcodebuild` build/test/archive, simctl boot/install/launch, Simulator screenshots, XCTest and XCUI on iOS, code signing, LLDB, Xcode scheme discovery via `xcodebuild -list`.
- **Blocked on a Windows machine:** Windows Swift toolchain and SourceKit-LSP verification, Windows matrix rows measured on Windows.
- **Buildable here, not yet built:** SourceKit-LSP client (`sourcekit-lsp` is present), `swift format`, the iOS workspace header and tabs (CODE / DESIGN / PREVIEW / iOS / CHANGES), the target adapter interface, hooks, MCP, skills, worktree UI, GOALS, queue/steer, side chats, design review loop, and the remaining Clyra Code phases.
- **Not to be built as described:** the Experimental iOS Runtime (ipasim, touchHLE) is R&D only. Nothing here should present it as a simulator.

The full remaster is a multi-week scope. The next pass should pick its order. My recommendation is: SourceKit-LSP client, then the iOS workspace header and Xcode-gated states, then hooks.
