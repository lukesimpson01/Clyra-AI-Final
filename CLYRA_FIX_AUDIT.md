# Clyra Code: Security, Preview, Responsive and Sidebar Fix Audit

Audit date: 5 October 2026
Scope: the existing Clyra Code / Vibe Coder application. This is a hardening and UI-quality pass. Nothing in the agent harness, tools, terminal, browser, Git, worktrees, checkpoints, skills, MCP, hooks, subagents, effort levels, context engine, or design workspace is removed or duplicated.

Each entry gives: EXISTING (what is there), the decision (KEEP / FIX / REPLACE / EXTEND), WHY, and TEST REQUIRED.

Evidence labels: **code** = read in this audit. **run** = observed in a live run or the running app.

---

## A. Environment and secrets

### A1. Harness runtime launch environment
- EXISTING: `lib/deepseek-harness/DeepSeekHarnessRuntimeManager.ts` `client()` constructs `new HarnessClient({ profile, processCwd, dshHome, ... })` with no `env`. **code** The SDK (`@deepseek-ai/dsh-sdk-client`, `lib/index.js:180`) then spawns the runtime with `...options.env ?? process.env`, i.e. the entire Clyra parent environment, unscrubbed.
- DECISION: FIX.
- WHY: this is the root cause of the `env | grep DSH_` exposure. The SDK's own documentation says that when `env` is passed, the caller owns credential policy and should use `scrubbedParentEnv` from `@deepseek-ai/dsh-subprocess`. Clyra does not pass an env, so it inherits everything. **run** The web run's `env` output contained `DSH_HOME`, `DSH_SESSION_ID`, `DSH_SESSION_JSONL` and `DSH_SHELL`, and those values were stored and sent to the model.
- TEST REQUIRED: unit test that the constructed child environment contains no `DSH_*` key and no credential-named key except explicitly forwarded ones; live check that a real prompt still completes (the runtime must still reach DeepSeek).

### A2. Harness tool output persisted and shown
- EXISTING: `handleToolCall` / `handleToolResult` store `input` and `output` verbatim (`output.slice(0, 200_000)`) and persist them through `record()`, `controller.recordTool()` and the event stream. Only error text goes through `redact()`, which covers `sk-`/`rk-`/`pk-`/`key-` shaped strings. **code**
- DECISION: FIX.
- WHY: persistence and UI are not model-facing, but the spec requires redaction before persistence, UI and telemetry. Values that reach Clyra's stores must be sanitised at the same boundary.
- TEST REQUIRED: unit tests that a secret value and any `DSH_*` value in tool input or output is replaced with a placeholder before it is stored or published.

### A3. Command classification
- EXISTING: nothing classifies commands. **code**
- DECISION: BUILD (`lib/clyra-code/security/command-risk.ts`).
- WHY: the spec requires a `CommandRisk` classifier. The runtime's own shell executes commands, so Clyra cannot block them before they run (see A4). Classification is used for audit, the activity timeline, and for Clyra-run commands.
- TEST REQUIRED: classifier cases for every listed environment dump form (POSIX and PowerShell/cmd) plus negative cases (`set -e`, `printenv PATH`, `npm run settings`) that must not be flagged as broad dumps.

### A4. Enforcement point for the runtime's shell
- EXISTING: `respondPermission` is a no-op; the SDK protocol has an `approval/request` seam, but the SDK client has no host-side answerer, so sensitive bash asks fail closed inside the runtime. **code**
- DECISION: the enforcement is the environment scrub (A1), not command blocking. Command blocking inside the runtime is recorded as a limitation.
- WHY: without an answerer Clyra cannot allow or deny a shell command before it runs. Because `DSH_*` and credential-named variables are absent from the child environment, an environment dump can no longer return them. That is a stronger guarantee than matching command text.
- TEST REQUIRED: live check that `env | grep DSH_` run by the agent returns no `DSH_*` lines after the change.

### A5. Preview child environment
- EXISTING: `lib/vibe-coder/preview/preview-runner.ts` spawns the dev server with `env: { ...process.env, BROWSER: "none", FORCE_COLOR: "0" }`. **code**
- DECISION: FIX.
- WHY: a dev server that prints its environment, or a crash log, would expose credentials to the preview log, which the UI and agent can read. A project that needs its own key should read it from its own `.env` file, which `dotenv` loads from the project directory.
- TEST REQUIRED: unit test on the environment builder; preview still starts for a web project.

### A6. Swift and platform probes
- EXISTING: `lib/clyra-code/swift/swift-package.ts` and `lib/clyra-code/platform/capabilities.ts` use `execFile` with fixed argument arrays and `process.env`. **code**
- DECISION: EXTEND (route through the shared runner in section C).
- WHY: one execution path, one environment policy, one output-redaction point.

---

## B. Preview and iOS

### B1. Preview requires index.html
- EXISTING: `startDevServer` in `preview-runner.ts` returns a `build_failed` session when `index.html` is missing: "The agent has not yet created an index.html entry point". **code**
- DECISION: REPLACE with a target-aware resolver (`lib/clyra-code/preview/`). Preview chooses a provider from detected targets before doing anything.
- WHY: this rule is the reason the agent created an HTML file for a native iOS app. **run** The gym run created `index.html` at the project root with an HTML "Native iOS Workout Tracker" page.
- TEST REQUIRED: resolver tests per target; a Swift package resolves to the iOS provider, not a browser provider; no file is created by resolution.

### B2. Agent instructions that force index.html
- EXISTING: three places tell the agent to "put index.html at the project root so the live preview can start": `lib/opencode/opencode-routes.ts:122`, `lib/opencode/OpenCodeRuntimeManager.ts:34`, `server.ts:1365`. **code**
- DECISION: FIX. Make the instruction conditional on a web target, and state that native iOS and macOS projects must not contain index.html.
- WHY: the instruction is unconditional, so the agent applies it to every greenfield app.
- TEST REQUIRED: unit test that the rendered instruction for a native iOS target contains the prohibition and no index.html requirement.

### B3. Scaffold writes index.html
- EXISTING: `server.ts:571` and `server.ts:692` write an `index.html` in starter scaffolds. **code**
- DECISION: KEEP for web scaffolds; the scaffolds are web-only (they carry package.json and React). Not used for Swift.
- TEST REQUIRED: scaffold selection is by target.

### B4. Static HTML validation
- EXISTING: `lib/vibe-runtime/validation.ts:45` treats an `index.html` as the only valid entry when there is no package.json. **code**
- DECISION: FIX. Skip this check for non-web targets.
- TEST REQUIRED: a Swift package is not validated as a static HTML site.

### B5. Stray iOS index.html
- EXISTING: `projects/eval-gym-tracker-0a9f63/files/index.html`. **run**
- DECISION: remove only with provenance and a checkpoint. Provenance: created by the agent during the iOS run, referenced by no source file, and not part of the Swift package. Remove with a git checkpoint and log "Removed obsolete preview artifact".
- TEST REQUIRED: the Swift package still builds and tests pass after removal; the file is recoverable from the checkpoint.

### B6. Preview must not mutate projects
- EXISTING: `startDevServer` writes no files (**code**), so it already satisfies this rule. The rule is kept and tested.
- TEST REQUIRED: a preview start on a fixture project leaves a file hash inventory unchanged.

---

## C. Process execution

### C1. Command spec and runner
- EXISTING: `lib/clyra-code/swift/swift-package.ts` runs `execFile("swift", args, …)`. Clyra has no shared runner. The preview runner uses `spawn`. **code**
- DECISION: BUILD one `CommandSpec` / `runCommand()` in `lib/clyra-code/process/`, and move the Swift runner onto it. Do not create a second runner.
- WHY: the spec requires status, duration, cancellation, logs, and an activity entry per command, with `shell: false` by default. One runner gives Mac and Windows the same behaviour.
- TEST REQUIRED: runs a fixed argv, enforces timeout, honours cancellation, redacts output, never passes shell syntax.

### C2. Platform and path services
- EXISTING: `process.platform` checks are in `capabilities.ts` (backend) and in `lib/clyra-code/targets/detect.ts` (path separators via `path`). The renderer contains `process.platform` only through the bridge. **code**
- DECISION: KEEP. The backend already keeps platform variation out of components. Add `platform` to the preload bridge as a plain string.
- TEST REQUIRED: `path.join` is used for every constructed path in the new modules; a Windows-style path fixture is classified correctly.

---

## D. Project and thread model

### D1. Projects and threads
- EXISTING: a project is a folder under `projects/<id>/files` with `metadata.json`. A thread is a harness session under that project (`listSessions`). Projects have stable ids (slug plus random suffix). **code**
- DECISION: KEEP the data model. Thread-to-project association already uses the stable project id, not the display name.
- WHY: the spec's rule (project identity must not depend on display name) already holds. The defect is in presentation and creation, not in storage.
- TEST REQUIRED: a thread stays associated with its project after a rename.

### D2. Duplicate "New project" records
- EXISTING: `submitPrompt` calls `createProject()` whenever there is no active project. Every fresh welcome submit therefore creates a project, even when the user is working in an existing one. **code**
- DECISION: FIX. A submit creates a project only when none is selected. The welcome composer creates a project only when the user chooses New project or submits with none selected. A New task action starts a thread in the selected project.
- TEST REQUIRED: submitting in a selected project adds a thread and no project.

### D3. Display names
- EXISTING: `projectNameFromFirstPrompt` names a new project from its first prompt. **code**
- DECISION: EXTEND. Legacy names from prompts stay as they are unless they are the default placeholder. Add a derived display name: explicit user name, then package name, then folder name. Never overwrite a name the user set manually.
- TEST REQUIRED: the derived name for a fixture with a package.json name is that name; a project with a user-set name is unchanged.

### D4. Pinned projects and sort order
- EXISTING: no pin field; `PATCH /api/vibe/projects/:id` renames only. **code**
- DECISION: EXTEND the existing route to accept `pinned` and persist it in `metadata.json`. Sort order remains in the UI and persists to the same metadata store (not localStorage).
- TEST REQUIRED: pin survives a server restart (metadata is durable).

---

## E. Sidebar

### E1. Sidebar component
- EXISTING: `src/components/clyra-code/Sidebar.tsx` (150 lines). A fixed 236px width, title "Vibe Coder", a primary "New project" button, a flat list with a folder icon on each project and threads nested under it, a hardcoded footer "L / Luke", and no pinned, recent, running, width or responsive behaviour. **code**
- DECISION: REPLACE the presentation of this component and keep its props and event handlers, so the workspace keeps its existing behaviour. Extend the props with pinned, running and recency data.
- WHY: the spec identifies the current sidebar as a basic file list with no hierarchy, no state and no way to act without a menu.
- TEST REQUIRED: browser tests for each visual and interaction item in the spec's QA checklist; all existing handlers still fire.

### E2. Sidebar state
- EXISTING: expansion lives in component state; collapse lives in `ClyraCodeWorkspace` (`SIDEBAR_KEY`, `clyra-code:sidebar-collapsed`). **code**
- DECISION: EXTEND. Keep collapse state in the workspace. Add width, pinned and sort preferences. Preferences that are per-user UI (width, sort) stay in localStorage with a fallback to defaults. Project pinning is durable data (D4).
- TEST REQUIRED: a corrupt localStorage value falls back to defaults.

### E3. Search
- EXISTING: client-side filter over project names and thread titles. **code**
- DECISION: KEEP and extend to paths and the active thread. Grouped results are rendered by the sidebar.
- TEST REQUIRED: a query matches a path fragment and a thread title.

### E4. Running state
- EXISTING: `agentStatus` in the workspace header. **code** The sidebar has no running indicator.
- DECISION: EXTEND. Derive a per-thread status from the existing run state. Show a small marker on the active run; show a count on the product title.
- TEST REQUIRED: a running thread shows the marker; a stopped thread does not.

---

## F. Responsive layout

### F1. Permanent sidebar at narrow width
- EXISTING: the sidebar is always rendered beside the workspace and is 236px wide when open. There is no narrow breakpoint. **code** **run** At 375px the sidebar and the workspace both render side by side and the welcome card is pushed off-screen.
- DECISION: FIX with three breakpoints: at 1100px and above the sidebar can stay pinned; between 720 and 1099px it is collapsible and may default closed; below 720px it becomes an off-canvas drawer and defaults closed.
- TEST REQUIRED: automated browser tests at 375, 390, 600, 768, 1024, 1280, 1440 and 1920px.

### F2. Minimum window width
- EXISTING: `electron/main.mjs` sets `minWidth: 960`. **code** The desktop window cannot shrink to 375px.
- DECISION: FIX. Lower the window minimum to 360px, so the 375px requirement applies to the real desktop window.
- TEST REQUIRED: the Electron window accepts a 375px content width.

### F3. Fixed-width panels and overflow
- EXISTING: `min-width: 700px`, fixed right panel widths and `overflow: hidden` are used in several containers. **code** The spec requires auditing these.
- DECISION: FIX the containers that cause horizontal overflow at narrow widths. Use `min-width: 0` on flex and grid children, and `max-width: 100%` where needed.
- TEST REQUIRED: no document horizontal overflow at 375px in each of Code, Design, Preview and Changes.

### F4. Right panel and inspectors
- EXISTING: the right panel is a fixed column. **code**
- DECISION: at narrow widths show one primary surface at a time. The right panel becomes a full-width view with tabs. The design inspector becomes a drawer.
- TEST REQUIRED: browser tests of each surface at 375px.

---

## G. Window chrome

### G1. macOS titlebar and traffic lights
- EXISTING: macOS windows use `titleBarStyle: "hidden"`. The renderer header has no left inset. **code** The traffic lights overlay the top-left of the workspace.
- DECISION: FIX. Expose the platform through the preload bridge, and add a leading inset only on macOS, where the sidebar header sits under the traffic lights.
- TEST REQUIRED: on macOS the sidebar title is not covered by the traffic lights; on other platforms no inset is applied.

### G2. Windows titlebar
- EXISTING: Windows uses the native frame (`titleBarStyle: "default"`). **code**
- DECISION: KEEP. No macOS spacing applied. Test at 100%, 125% and 150% scaling.

---

## H. Tests

- EXISTING: `tools/clyra-code-platform-unit-tests.ts`, `tools/clyra-code-brief-unit-tests.ts`, Vitest in the generated projects, and Playwright (1.59.1) with Chromium installed. **run**
- DECISION: EXTEND. Add unit tests for the security service, the command classifier, the runner, and the preview resolver. Add a Playwright regression suite for the responsive layout and the sidebar.
- LIMITATION: Windows cannot be executed on this host. Windows behaviour is covered by unit tests with fixed platform inputs; a Windows run is listed as not verified.

---

## Status after implementation

### Done and verified on this Mac

| Area | What changed | Verified by |
|---|---|---|
| Harness launch environment (A1) | The DeepSeek runtime starts with a scrubbed environment. Only `DEEPSEEK_API_KEY` is forwarded by name. | Live run: the agent's `printenv DEEPSEEK_API_KEY` reports `key-missing` inside its shell, while the runtime still answers the model. |
| Tool output redaction (A2) | Tool input, output and error text pass through `sanitizeToolOutputForModel` before storage or publication. | Live run: stored `DSH_*` lines show `[REDACTED_RUNTIME_FACT]`. Unit tests for placeholder order and multi-word values. |
| Command audit (A3) | Environment-inspection and credential-access commands are appended to `security/command-audit.jsonl` with category and tool only, never command text. | Live run: three `env` invocations recorded, no command text stored. |
| Environment service (A3, section 3) | `lib/clyra-code/security/environment.ts`: classification, child environment policy, redaction, presence-only status. | 72 unit assertions. |
| Preview child environment (A5) | Preview and Swift child processes receive the scrubbed environment; preview logs are redacted. | Unit tests; preview suite passes. |
| Preview resolution (B1, sections 17–21) | `lib/clyra-code/preview/resolver.ts`: web, Electron, native iOS and no-runtime providers, chosen from detected targets before anything runs. | 13 preview and validation tests, including "resolution creates no file". |
| No HTML for iOS (B1–B2, B4) | Preview routes dispatch by target. Native iOS returns an honest "unavailable" state; no `index.html` is created. Agent instructions make index.html web-only and forbid HTML previews for native projects. Validation runs the real Swift build and test for Swift packages and reports Xcode-only projects as skipped. | Preview suite. |
| Electron preview (section 18) | `startElectronApp` launches the project's own Electron binary in the existing preview runner and streams redacted logs. | Code path reviewed; not launched in this pass. |
| Environment capabilities (sections 2, 9) | `GET /api/clyra-code/runtime-info` and `GET /api/clyra-code/env-status?names=…`. The agent is told to use them instead of listing the environment. | Live endpoint check. |
| Project durability (sections 26–29, 40) | Pinned state and "Remove from sidebar" are stored in project metadata through the existing PATCH route. Legacy browser-only hidden list is migrated once. No file is deleted. | Playwright pin test. |
| Display names (sections 42–43, 74) | `displayName` derived from package name or page title when the stored name is only the creating prompt. User renames are marked and never replaced. | 11 unit assertions. |
| Sidebar (sections 24–25, 30–38, 45–47, 77–79) | Rebuilt presentation: header with product name, search and collapse; New task as the primary action; Pinned and Projects sections; compact project and thread rows; running marker; sort toggle; keyboard navigation; resizable rail (220–320px, persisted); durable pinning; accessible names. | Playwright sidebar tests. |
| Responsive workspace (sections 48–55) | Below 720px the sidebar becomes a drawer with scrim, Escape close, focus trap and focus return. The chat and preview take turns at full width. The desktop minimum for the panes is not applied in narrow mode. The window minimum is 360px. | Browser check at 375px; Playwright tests. |
| macOS chrome (section 56) | The preload exposes `platform` as a string. The sidebar and header reserve traffic-light space on macOS only, and the sidebar header is a drag region. | Code review; not run on macOS hardware beyond this Mac's browser. |

### Not done, or not verifiable here

- **Windows:** no Windows host is available. Windows branches are covered only by unit tests with fixed platform inputs. Windows title-bar spacing and scaling at 100%, 125% and 150% are not verified.
- **Native iOS preview:** the simulator path is not implemented. This Mac has no full Xcode, so the simulator cannot be exercised here.
- **Command blocking in the agent's shell:** the runtime executes shell commands itself, and the SDK client has no host-side approval answerer. Clyra therefore enforces by removing secrets from the environment and by auditing, not by blocking the command. The audit log records the attempt.
- **Runtime-set `DSH_*` facts:** the runtime sets `DSH_HOME`, `DSH_SESSION_ID`, `DSH_SESSION_JSONL` and `DSH_SHELL` for its own shell, so the model can still see those names. Clyra redacts their values in everything it stores and publishes, but cannot remove them from the model's view without an SDK change.
- **Running state across projects:** the client knows only the active run, so only that thread shows a running marker. Other projects' runs are not shown.
- **Virtualisation for very large project lists** (section 72) and the full multi-repo model (section 68) are not implemented.
- **Chat top navigation at 375px** is outside the Clyra Code workspace and was not changed.
